import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lib } from './helpers.mjs';
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const manifest = readJson('manifest.json'), pkg = readJson('stargazer/package.json');
const S = lib('settings.js');

// BEam's permissions: microphone, camera, background, local-network, jibo-apis, read-jibo-files,
// edit-jibo-files, read-kb, edit-kb, run-programs. Stargazer needs none. The scans below are a
// text heuristic; lab/check-permissions.cjs in the workspace runs the code under BEam's own guard.
const KNOWN = ['microphone', 'camera', 'background', 'local-network', 'jibo-apis', 'read-jibo-files',
  'edit-jibo-files', 'read-kb', 'edit-kb', 'run-programs'];
const CODE = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (name.endsWith('.js')) CODE.push({ file: relative(root, file).split(sep).join('/'), text: readFileSync(file, 'utf8') });
  }
})(join(root, 'stargazer'));
const uses = (pattern) => CODE.filter((c) => pattern.test(c.text)).map((c) => c.file);
const versionParts = (v) => v.split('.').map(Number);
function atLeast(version, minimum) {
  const a = versionParts(version), b = versionParts(minimum);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

test('manifest and package agree, and the skill is for BEam 3.2.0 or newer', () => {
  assert.equal(manifest.type, 'skill');
  assert.equal(pkg.name, '@be/stargazer');
  assert.equal(manifest.version, pkg.version);
  assert.match(manifest.supported, /^\d+\.\d+\.\d+$/);
  assert.ok(atLeast(manifest.supported, '3.2.0'), 'older "supported" turns the skill off in BEam 3.2.0');
  assert.equal(pkg.jibo.type, 'asset-pack');
  assert.equal(manifest.themes, false);
});

test('permissions: the manifest declares what the code needs', () => {
  const needed = [];
  if (uses(/jibo\.jetstream|globalEvents|getUserMedia\(\s*\{[^}]*audio|\.globalTurnResult|localTurnResult/).length) needed.push('microphone');
  if (uses(/jibo\.media\b|getUserMedia\(\s*\{[^}]*video/).length) needed.push('camera');
  if (pkg.jibo.background) needed.push('background');
  if (uses(/jibo-kb|jibo\.kb\b/).length) needed.push('read-kb');
  if (uses(/child_process/).length) needed.push('run-programs');
  // A raw socket or browser network API could reach the robot or the home network: it needs
  // jibo-apis or local-network depending on the address, which a text scan cannot tell.
  assert.deepEqual(uses(/require\('(net|dgram|tls|dns)'\)|\bfetch\(|XMLHttpRequest|WebSocket|EventSource/), [],
    'raw network use: decide jibo-apis or local-network, then extend this test');
  const declared = manifest.permissions || [];
  assert.deepEqual(declared.slice().sort(), needed.slice().sort());
  declared.forEach((p) => assert.ok(KNOWN.includes(p), p + ' is not a BEam permission'));
});

test('the code reaches the outside world only through net.js (https to public servers) and settings.js (its own folder)', () => {
  const ok = { fs: ['stargazer/lib/settings.js'], http: ['stargazer/lib/net.js'], https: ['stargazer/lib/net.js'], url: ['stargazer/lib/net.js'] };
  for (const c of CODE) {
    for (const m of c.text.matchAll(/require\('([^.'][^']*)'\)/g)) {
      const name = m[1];
      if (['path', 'jibo', '@be/be-framework'].includes(name)) continue;
      assert.ok(ok[name] && ok[name].includes(c.file), c.file + ' requires ' + name);
    }
  }
  assert.deepEqual(uses(/\bos\b\s*=\s*require|process\.(env|binding)\b/).filter((f) => f !== 'stargazer/lib/settings.js'), []);
});

test('every server address is a public name, never the robot or the home network', () => {
  // The names BEam treats as the robot or the home network (skill-permissions.js hostNeeds).
  const local = (h) => h === 'localhost' || /^(127|10|192\.168|169\.254)\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /\.(local|lan|home|internal)$/.test(h) || !/[.:]/.test(h);
  const hosts = new Set();
  for (const c of CODE) for (const m of c.text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) hosts.add(m[1].toLowerCase());
  assert.ok(hosts.size >= 4);
  for (const h of hosts) assert.ok(!local(h) && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h), h + ' looks local');
});

test('files are kept in the skill\'s own Knowledge folder, so no file permission is needed', () => {
  // BEam's own section is the package name without "@be/".
  const own = '/opt/jibo/Knowledge/' + pkg.name.replace(/^@be\//, '');
  assert.equal(S.NAME, pkg.name.replace(/^@be\//, ''));
  assert.ok(S.ROBOT_DATA === own || S.ROBOT_DATA.startsWith(own + '/'), S.ROBOT_DATA);
  assert.ok(!S.ROBOT_DATA.includes('..'));
});

test('on the robot the data folder is that folder (unless a test folder is set)', () => {
  const fs = require('fs'), exists = fs.existsSync, saved = process.env.STARGAZER_DATA_DIR;
  delete process.env.STARGAZER_DATA_DIR;
  fs.existsSync = (p) => p === '/opt/jibo/Jibo/Skills' || exists(p);
  try { assert.equal(S.dataRoot(), S.ROBOT_DATA); } finally {
    fs.existsSync = exists;
    if (saved !== undefined) process.env.STARGAZER_DATA_DIR = saved;
  }
});

test('a blocked file call (BEam throws when a permission is missing) never breaks Stargazer', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  // Real files, so statSync succeeds and the blocked call is the read itself.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stargazer-blocked-'));
  ['settings.json', 'seen.json', 'sources.json'].forEach((n) => fs.writeFileSync(path.join(dir, n), '{}'));
  const names = ['mkdirSync', 'writeFileSync', 'readFileSync', 'readdirSync', 'renameSync', 'unlinkSync', 'chmodSync'];
  const saved = {};
  const blocked = () => { throw new Error('@be/stargazer needs the edit-kb permission to do this'); };
  names.forEach((n) => { saved[n] = fs[n]; fs[n] = blocked; });
  try {
    const store = new S.Store(dir);
    assert.deepEqual(store.read(), S.clean());
    assert.deepEqual(store.seen(), []);
    assert.deepEqual(store.history(), {});
    assert.deepEqual(store.markSeen([], 'hubble:potm2610a'), ['hubble:potm2610a']);
    assert.ok(store.remember({}, { source: 'hubble', key: 'hubble:potm2610a', date: 1 }, 5).hubble);
    assert.throws(() => store.write(S.clean()), /permission/);   // screen.js catches this and logs it
  } finally {
    names.forEach((n) => { fs[n] = saved[n]; });
    fs.rmSync ? fs.rmSync(dir, { recursive: true, force: true }) : ['settings.json', 'seen.json', 'sources.json'].forEach((n) => fs.unlinkSync(path.join(dir, n)));
  }
});

// BEam matches the whole sentence heard after "Hey Jibo" against `phrases` and asks for no permission
// for it (beacon/lib/launch-phrases.js has the rules).
test('launch phrases: a valid list in the manifest, the store text lists them', () => {
  const phrases = manifest.phrases;
  assert.ok(Array.isArray(phrases) && phrases.length >= 1 && phrases.length <= 20);
  const seen = new Set();
  for (const phrase of phrases) {
    assert.ok(typeof phrase === 'string' && phrase.length <= 100, phrase);
    assert.match(phrase, /^[a-z' ]+$/, 'lower case words only: ' + phrase);
    assert.ok(!seen.has(phrase), 'listed twice: ' + phrase);
    seen.add(phrase);
  }
  const store = readFileSync(join(root, 'README.md'), 'utf8').toLowerCase();
  // "star gazer" is how speech recognition may spell the name; it is not offered to the owner.
  for (const phrase of phrases.filter((p) => !/star gazer/.test(p))) assert.ok(store.includes('"' + phrase + '"'), 'the store text lists "' + phrase + '"');
});

// The 5x1 Store shows the repository's README.md and BEacon the same file from the ZIP; BEacon's
// Markdown has no tables or code blocks.
test('README.md is plain store text: no tables, no code blocks', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.ok(!/^\s*\|/m.test(readme), 'a table row');
  assert.ok(!/^```/m.test(readme), 'a code block');
});
