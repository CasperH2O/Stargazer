import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib, fakeNet } from './helpers.mjs';
const Catalog = lib('catalog.js'), images = lib('images.js'), net = lib('net.js');

function source(id, list, resolve) { return { id, short: id, list: () => (list instanceof Error ? Promise.reject(list) : Promise.resolve(list)), resolve }; }

test('interleaves sources (newest of each first), skips a failing one, starts at the newest unseen', async () => {
  const log = { info() {}, warn() {} };
  const c = new Catalog({ net: {}, log, memory: {}, sources: {
    a: source('a', [{ key: 'a1', date: 9 }, { key: 'a2', date: 8 }, { key: 'a3', date: 7 }]),
    b: source('b', new Error('down')),
    c: source('c', [{ key: 'c1', date: 2 }, { key: 'a1', date: 9 }]) } });
  const items = await c.load(['a', 'b', 'c']);
  assert.deepEqual(items.map((i) => i.key), ['a1', 'c1', 'a2', 'a3']);
  assert.deepEqual(c.failed, ['b']);
  assert.equal(c.startIndex(['a1']), 1);
  assert.equal(c.startIndex(['a1', 'c1', 'a2', 'a3']), 0);
});

test('lists are remembered for an hour; a failed resolve still shows the picture', async () => {
  let calls = 0, now = 0;
  const memory = {};
  const sources = { a: { id: 'a', short: 'A', list: () => { calls++; return Promise.resolve([{ key: 'x', date: 1, source: 'a', needsResolve: true }]); }, resolve: () => Promise.reject(new Error('page down')) } };
  const c = new Catalog({ net: {}, memory, sources, now: () => now, log: { info() {}, warn() {} } });
  await c.load(['a']); now += 30 * 60000; await c.load(['a']);
  assert.equal(calls, 1);
  now += 31 * 60000; await c.load(['a']);
  assert.equal(calls, 2);
  const it = await c.resolve(c.items[0]);
  assert.equal(it.credit, 'A'); assert.equal(it.needsResolve, false);
});

test('images: only real JPEG/PNG/WebP bytes are accepted', () => {
  assert.equal(images.sniff(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(images.sniff(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(images.sniff(Buffer.from('<html>not an image</html>')), null);
});

test('net: follows redirects, caps the size, keeps bytes in memory', async () => {
  const { EventEmitter } = await import('node:events');
  function transport(routes) {
    const lib = { request(opts, cb) {
      const req = new EventEmitter(); req.abort = () => {}; req.end = () => setImmediate(() => {
        const r = routes[opts.hostname + opts.path];
        const res = new EventEmitter(); res.statusCode = r.status; res.headers = r.headers || {}; res.resume = () => {};
        cb(res); if (r.body) res.emit('data', Buffer.from(r.body)); res.emit('end');
      }); return req; } };
    return { http: lib, https: lib };
  }
  const tr = transport({ 'a.test/x': { status: 301, headers: { location: 'https://b.test/y' } }, 'b.test/y': { status: 200, body: 'hello' }, 'c.test/big': { status: 200, headers: { 'content-length': '999999999' } } });
  assert.equal(await net.text('https://a.test/x', {}, tr), 'hello');
  await assert.rejects(net.get('https://c.test/big', {}, tr), /too_large/);
  await assert.rejects(net.get('ftp://x/y', {}, tr), /bad_url/);
});
