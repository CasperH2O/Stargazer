import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync, utimesSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lib } from './helpers.mjs';
const S = lib('settings.js');

test('defaults: calm effects, 10 s, no slideshow, read title, every source on', () => {
  const v = S.clean();
  assert.deepEqual(v.effects, { kenBurns: true, iris: true, lookUp: true, starfield: false });
  assert.equal(v.showFor, 10); assert.equal(v.slideshow, 0); assert.equal(v.readTitle, true); assert.equal(v.caption, true);
  assert.deepEqual(v.sources, { hubble: true, webb: true, noirlab: true });
  assert.deepEqual(S.enabledSources(v), ['hubble', 'webb', 'noirlab']);
});

test('an old settings.json with removed sources (APOD, ESO, NASA, EPIC, ESA Earth from Space) still loads', () => {
  const old = { apod: true, hubble: false, webb: true, eso: true, noirlab: false, 'nasa-iotd': true, epic: true, 'esa-efs': false };
  assert.deepEqual(S.clean({ sources: old }).sources, { hubble: false, webb: true, noirlab: false });
  // Only removed sources on: the remaining ones fall back to their defaults rather than all off.
  const onlyRemoved = S.clean({ sources: { apod: true, hubble: false, webb: false, eso: true, noirlab: false, epic: true } });
  assert.deepEqual(onlyRemoved.sources, { hubble: true, webb: true, noirlab: true });
});

test('clean() drops unknown keys and bad values, and never allows zero sources', () => {
  const v = S.clean({ showFor: 7, slideshow: 'x', effects: { iris: false, bogus: true }, sources: Object.fromEntries(S.SOURCES.map((s) => [s, false])), extra: 1 });
  assert.equal(v.showFor, 10); assert.equal(v.slideshow, 0); assert.equal(v.effects.iris, false); assert.equal(v.extra, undefined);
  assert.ok(S.enabledSources(v).length > 0);
});

test('the last source on cannot be turned off', () => {
  let v = S.clean({ sources: { hubble: true, webb: false, noirlab: false } });
  const r = S.toggleSource(v, 'hubble');
  assert.equal(r.refused, 'lastSource');
  assert.equal(S.toggleSource(v, 'noirlab').values.sources.noirlab, true);
});

test('Show for and slideshow cycle through their steps; a slideshow keeps it open', () => {
  let v = S.clean(), seen = [];
  for (let i = 0; i < 5; i++) { seen.push(v.showFor); v = S.nextShowFor(v).values; }
  assert.deepEqual(seen, [10, 30, 60, 300, 0]);
  assert.equal(v.showFor, 10);
  assert.equal(S.closeAfter(v), 10);
  v = S.nextSlideshow(v).values;
  assert.equal(v.slideshow, 1);
  assert.equal(S.closeAfter(v), 0);
});

test('store: atomic private settings.json, capped seen.json, per-source history, nothing else written', () => {
  const root = join(mkdtempSync(join(tmpdir(), 'stargazer-')), 'data');
  const store = new S.Store(root);
  assert.deepEqual(store.read(), S.clean());
  store.write({ ...S.clean(), showFor: 60 });
  assert.equal(store.read().showFor, 60);
  assert.equal(statSync(join(root, 'settings.json')).mode & 0o777, 0o600);
  let seen = [];
  for (let i = 0; i < S.SEEN_MAX + 20; i++) seen = store.markSeen(seen, 'k' + i);
  assert.equal(seen.length, S.SEEN_MAX);
  assert.equal(store.seen().length, S.SEEN_MAX);
  assert.deepEqual(store.history(), {});
  let h = store.remember({}, { source: 'hubble', key: 'hubble:potm2610a', date: 5 }, 7);
  h = store.remember(h, { source: 'noirlab', key: 'noirlab:iotw2645a', date: undefined }, 8);
  assert.deepEqual(store.history(), { hubble: { key: 'hubble:potm2610a', date: 5, at: 7 }, noirlab: { key: 'noirlab:iotw2645a', date: 0, at: 8 } });
  // A removed source (apod) is dropped like an unknown one.
  writeFileSync(join(root, 'sources.json'), JSON.stringify({ webb: { key: 3 }, bogus: { key: 'x' }, apod: { key: 'apod:old', date: 1 }, noirlab: { key: 'e', date: 'NaN' } }));
  assert.deepEqual(store.history(), { noirlab: { key: 'e', date: 0, at: 0 } });
  assert.deepEqual(readdirSync(root).sort(), ['seen.json', 'settings.json', 'sources.json']);
  writeFileSync(join(root, 'settings.json'), 'not json');
  assert.deepEqual(store.read(), S.clean());
});

// --- Bounded storage (D33): entries, bytes and the read limits ---
const tmpRoot = () => join(mkdtempSync(join(tmpdir(), 'stargazer-')), 'data');
const { LIMITS, KEY_MAX, SEEN_MAX } = S;

test('seen.json: a very long id does not push the file over its read limit and wipe the list', () => {
  const root = tmpRoot(), store = new S.Store(root);
  let seen = [];
  for (let i = 0; i < 10; i++) seen = store.markSeen(seen, 'k' + i);
  seen = store.markSeen(seen, 'x'.repeat(100 * 1024));   // not recorded
  assert.equal(seen.length, 10);
  assert.deepEqual(store.seen(), seen, 'the list survives a round trip');
  assert.ok(statSync(join(root, 'seen.json')).size <= LIMITS['seen.json']);
  // The same for ids just over the key limit, many times over.
  for (let i = 0; i < 400; i++) seen = store.markSeen(seen, 'y' + String(i).padStart(KEY_MAX, '0'));
  assert.equal(store.seen().length, 10);
});

test('seen.json: worst case (full list, longest 3-byte keys) stays under the read limit', () => {
  const root = tmpRoot(), store = new S.Store(root);
  let seen = [];
  for (let i = 0; i < SEEN_MAX + 50; i++) seen = store.markSeen(seen, String(i).padStart(4, '0') + '€'.repeat(KEY_MAX - 4));
  const size = statSync(join(root, 'seen.json')).size;
  assert.ok(size <= LIMITS['seen.json'], `${size} bytes`);
  assert.ok(seen.length > 100 && seen.length <= SEEN_MAX);
  assert.deepEqual(store.seen(), seen, 'nothing is lost on reading it back');
  assert.equal(seen[seen.length - 1].slice(0, 4), String(SEEN_MAX + 49).padStart(4, '0'), 'the newest is kept, the oldest go first');
});

test('seen.json: duplicates, non-strings, empty and over-long entries in a file are cleaned on read', () => {
  const root = tmpRoot(), store = new S.Store(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'seen.json'), JSON.stringify(['a', 'b', 'a', 1, null, {}, ['c'], '', 'z'.repeat(KEY_MAX + 1), 'c', 'b']));
  assert.deepEqual(store.seen(), ['a', 'c', 'b']);
  writeFileSync(join(root, 'seen.json'), JSON.stringify(Array.from({ length: 5000 }, (_, i) => 'id' + i)));
  const list = store.seen();
  assert.equal(list.length, SEEN_MAX);
  assert.equal(list[list.length - 1], 'id4999');
  writeFileSync(join(root, 'seen.json'), '{"not":"a list"}');
  assert.deepEqual(store.seen(), []);
});

test('seen.json: markSeen ignores invalid ids, and a known id keeps its place without a write', () => {
  const root = tmpRoot(), store = new S.Store(root);
  let seen = store.markSeen([], 'a');
  seen = store.markSeen(seen, 'b');
  const before = readFileSync(join(root, 'seen.json'), 'utf8');
  for (const bad of [undefined, null, 5, {}, '', 'q'.repeat(KEY_MAX + 1)]) assert.equal(store.markSeen(seen, bad), seen);
  assert.equal(store.markSeen(seen, 'a'), seen, 'a known id returns the same list');
  assert.equal(readFileSync(join(root, 'seen.json'), 'utf8'), before);
  // Eviction is by first sight: after SEEN_MAX newer ids the oldest, even if shown again, is gone.
  for (let i = 0; i < SEEN_MAX; i++) { seen = store.markSeen(seen, 'n' + i); seen = store.markSeen(seen, 'n' + i); }
  assert.equal(seen.indexOf('a'), -1);
  assert.equal(seen.length, SEEN_MAX);
});

test('seen.json: a file already over the read limit is replaced by the next valid write', () => {
  const root = tmpRoot(), store = new S.Store(root);
  store.markSeen([], 'first');
  writeFileSync(join(root, 'seen.json'), JSON.stringify(['a'.repeat(LIMITS['seen.json'] + 10)]));
  assert.deepEqual(store.seen(), []);
  const next = store.markSeen(store.seen(), 'fresh');
  assert.deepEqual(next, ['fresh']);
  assert.deepEqual(store.seen(), ['fresh']);
});

test('sources.json: one entry per known source, short keys, finite numbers, under its read limit', () => {
  const root = tmpRoot(), store = new S.Store(root);
  let h = {};
  h = store.remember(h, { source: 'hubble', key: 'k'.repeat(100 * 1024), date: 1 }, 1);   // too long: ignored
  h = store.remember(h, { source: 'bogus', key: 'bogus:1', date: 1 }, 1);                  // unknown source: ignored
  h = store.remember(h, { source: 'apod', key: 'apod:1', date: 1 }, 1);                    // removed source: ignored
  h = store.remember(h, { key: 'nosource' }, 1);
  h = store.remember(h, null, 1);
  assert.deepEqual(h, {});
  for (let i = 0; i < 50; i++) for (const source of S.SOURCES) h = store.remember(h, { source, key: source + ':' + '€'.repeat(KEY_MAX - source.length - 1), date: i }, i);
  assert.deepEqual(Object.keys(h).sort(), S.SOURCES.slice().sort());
  assert.ok(statSync(join(root, 'sources.json')).size < LIMITS['sources.json'] / 8);
  assert.deepEqual(store.history(), h);
  // A tampered file: unknown ids, long keys, infinite numbers.
  writeFileSync(join(root, 'sources.json'), '{"hubble":{"key":"' + 'k'.repeat(KEY_MAX + 1) + '"},"webb":{"key":"webb:1","date":1e999,"at":-1e999},"x":{"key":"x"}}');
  assert.deepEqual(store.history(), { webb: { key: 'webb:1', date: 0, at: 0 } });
  // An old in-memory history with an unknown id does not get written back.
  const written = store.remember({ ghost: { key: 'g', date: 1, at: 1 } }, { source: 'noirlab', key: 'noirlab:iotw2645a', date: 1 }, 2);
  assert.deepEqual(Object.keys(written), ['noirlab']);
});

test('settings.json: junk and huge values are not written back; the file is tiny and bounded', () => {
  const root = tmpRoot(), store = new S.Store(root);
  const junk = { showFor: 10, extra: 'x'.repeat(1e6), sources: { hubble: true, bogus: 'x'.repeat(1e5) }, effects: { iris: true, more: [1, 2, 3] } };
  store.write(junk);
  const size = statSync(join(root, 'settings.json')).size;
  assert.ok(size < 512 && size < LIMITS['settings.json'], `${size} bytes`);
  const all = S.clean({ sources: { hubble: true, webb: true, noirlab: true }, effects: { kenBurns: true, iris: true, lookUp: true, starfield: true }, showFor: 300, slideshow: 30, readTitle: true, caption: true, sounds: true });
  assert.ok(Buffer.byteLength(JSON.stringify(all)) < LIMITS['settings.json'] / 8);
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ showFor: 60, pad: 'x'.repeat(LIMITS['settings.json']) }));
  assert.deepEqual(store.read(), S.clean(), 'a file over the read limit reads as the defaults');
});

test('writeJson refuses to write a file its own reader would discard, and leaves no .tmp behind', () => {
  const root = tmpRoot(), store = new S.Store(root);
  store.markSeen([], 'a');
  // Forge a write over the limit through the store's own path: a source entry that passes validKey
  // cannot do it, so exercise the guard by shrinking the limit.
  const original = LIMITS['seen.json'];
  LIMITS['seen.json'] = 8;
  try { assert.deepEqual(store.markSeen(['a'], 'bbbbbbbbbbbb'), ['a', 'bbbbbbbbbbbb']); } finally { LIMITS['seen.json'] = original; }
  assert.deepEqual(store.seen(), ['a'], 'the refused write left the old file alone');
  assert.deepEqual(readdirSync(root).sort(), ['seen.json']);
});

test('.tmp leftovers of an interrupted write are swept on the next read; fresh ones are left alone', () => {
  const root = tmpRoot(), store = new S.Store(root);
  store.write(S.clean());
  const old = join(root, 'sources.json.tmp'), fresh = join(root, 'seen.json.tmp'), other = join(root, 'notes.txt');
  writeFileSync(old, '{"half'); writeFileSync(fresh, '["half'); writeFileSync(other, 'keep');
  const longAgo = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(old, longAgo, longAgo);
  new S.Store(root).read();
  assert.deepEqual(readdirSync(root).sort(), ['notes.txt', 'seen.json.tmp', 'settings.json']);
  // A write over a leftover replaces it instead of adding another file.
  const s2 = new S.Store(root);
  s2.markSeen([], 'a');
  assert.deepEqual(readdirSync(root).sort(), ['notes.txt', 'seen.json', 'settings.json']);
  // Reading before the folder exists is fine.
  assert.deepEqual(new S.Store(join(root, 'nope')).read(), S.clean());
});
