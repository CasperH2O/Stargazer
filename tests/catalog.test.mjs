import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib, fakeNet } from './helpers.mjs';
const Catalog = lib('catalog.js'), images = lib('images.js'), net = lib('net.js');

function source(id, list, resolve) { return { id, short: id, list: () => (list instanceof Error ? Promise.reject(list) : Promise.resolve(list)), resolve }; }

test('one source at a time: fresh sources first (in random order), the avoided one last', () => {
  const DAY = 86400000, now = 100 * DAY, log = { info() {}, warn() {} };
  const memory = { m: { at: now - 1000, items: [{ key: 'm1', date: 1 }] }, n: { at: now - 1000, items: [{ key: 'n1', date: 1 }] } };
  const reg = { hubble: source('hubble', []), webb: source('webb', []), noirlab: source('noirlab', []), m: source('m', []), n: source('n', []), x: source('x', []) };
  const c = new Catalog({ net: {}, log, memory, sources: reg, now: () => now });
  const history = {
    noirlab: { key: 'noirlab:old', date: now - 8 * DAY },     // weekly, 8 days ago: fresh
    hubble: { key: 'hubble:old', date: now - 10 * DAY },      // monthly, 10 days ago: not fresh
    webb: { key: 'webb:old', date: 0, at: now - 31 * DAY }    // monthly, no date, shown 31 days ago: fresh
  };
  const seen = ['m1'];
  assert.equal(c.isFresh('noirlab', seen, history), true);
  assert.equal(c.isFresh('hubble', seen, history), false);
  assert.equal(c.isFresh('webb', seen, history), true);
  assert.equal(c.isFresh('m', seen, history), false);        // list in memory, newest already seen
  assert.equal(c.isFresh('n', seen, history), true);         // list in memory, newest unseen
  assert.equal(c.isFresh('x', seen, history), true);         // never shown here
  const order = c.order(['noirlab', 'hubble', 'webb', 'm', 'n', 'x', 'gone'], seen, history, () => 0.5);
  assert.deepEqual(order.slice(0, 4).sort(), ['n', 'noirlab', 'webb', 'x']);
  assert.deepEqual(order.slice(4).sort(), ['hubble', 'm']);
  const avoided = c.order(['noirlab', 'webb', 'x'], seen, history, Math.random, 'noirlab');
  assert.equal(avoided[2], 'noirlab'); assert.equal(avoided.length, 3);
});

test('only the chosen source is fetched; its own newest-first order is kept (undated listing items) and remembered for an hour', async () => {
  let calls = 0, other = 0, now = 0;
  const memory = {};
  const sources = {
    a: { id: 'a', short: 'A', list: () => { calls++; return Promise.resolve([{ key: 'x', date: 0, source: 'a', needsResolve: true }, { key: 'old', date: 1, source: 'a' }]); }, resolve: () => Promise.reject(new Error('page down')) },
    b: { id: 'b', short: 'B', list: () => { other++; return Promise.resolve([]); } },
    c: source('c', new Error('down'))
  };
  const c = new Catalog({ net: {}, memory, sources, now: () => now, log: { info() {}, warn() {} } });
  const items = await c.list('a');
  assert.deepEqual(items.map((i) => i.key), ['x', 'old']);
  assert.equal(other, 0);
  now += 30 * 60000; await c.list('a');
  assert.equal(calls, 1);
  now += 31 * 60000; await c.list('a');
  assert.equal(calls, 2);
  await assert.rejects(c.list('b'), /empty/);
  await assert.rejects(c.list('c'), /down/);
  const it = await c.resolve(items[0]);
  assert.equal(it.credit, 'A'); assert.equal(it.needsResolve, false);
  assert.equal(it.title, 'A');                               // a listing item without a title gets the source's name
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
