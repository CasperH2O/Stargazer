import test from 'node:test';
import assert from 'node:assert/strict';
import { lib, fakeClock } from './helpers.mjs';
import { createPixi } from './pixi-stub.mjs';

const { Images, sniff } = lib('images.js');

const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D]);
const HTML = Buffer.from('<!doctype html><html>not a picture</html>');

const flush = () => new Promise((resolve) => setImmediate(resolve));

// net.get calls wait until the test settles them.
function deferredNet() {
  const calls = [];
  return {
    calls,
    get(url) {
      let call;
      const promise = new Promise((resolve, reject) => { call = { url, resolve: (body) => resolve({ status: 200, headers: {}, body, url }), reject }; });
      calls.push(call);
      return promise;
    },
  };
}

// Blob URLs and <img> decoding the test drives by hand (img.finish / img.fail).
function fakeWindow() {
  const clock = fakeClock();
  const urls = new Set(), images = [];
  let seq = 0;
  class Blob { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } }
  class Image {
    constructor() { this.naturalWidth = 0; this.naturalHeight = 0; this.onload = null; this.onerror = null; this._src = ''; images.push(this); }
    get src() { return this._src; }
    set src(v) { this._src = v; }
    finish(w, h) { this.naturalWidth = w; this.naturalHeight = h; if (this.onload) this.onload(); }
    fail() { if (this.onerror) this.onerror(); }
  }
  return {
    clock, urls, images, Blob, Image,
    URL: { createObjectURL: () => { const u = 'blob:' + ++seq; urls.add(u); return u; }, revokeObjectURL: (u) => urls.delete(u) },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  };
}

function setup() {
  const { PIXI, made } = createPixi();
  const net = deferredNet(), win = fakeWindow();
  const images = new Images({ PIXI, net, window: win });
  return { PIXI, made, net, win, images };
}
const item = (key) => ({ key, imageUrl: 'https://example.invalid/' + key + '.jpg' });
const rejectsWith = (promise, message) => assert.rejects(promise, (e) => e.message === message);

test('images: sniff knows JPEG, PNG and WebP by their first bytes, nothing else', () => {
  assert.equal(sniff(JPEG), 'image/jpeg');
  assert.equal(sniff(PNG), 'image/png');
  assert.equal(sniff(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniff(HTML), null);
  assert.equal(sniff(Buffer.from([0xFF, 0xD8])), null);
});

test('images: a picture decodes into a texture; the blob URL is revoked', async () => {
  const s = setup();
  const p = s.images.load(item('a'));
  s.net.calls[0].resolve(JPEG);
  await flush();
  assert.equal(s.win.images.length, 1);
  s.win.images[0].finish(800, 600);
  const pic = await p;
  assert.equal(pic.key, 'a');
  assert.equal(pic.width, 800);
  assert.equal(pic.height, 600);
  assert.equal(s.images.count(), 1);
  assert.equal(s.win.urls.size, 0);
  s.images.release('a');
  assert.equal(pic.texture.destroyed, 1, 'release destroys the texture');
  assert.equal(s.images.count(), 0);
});

test('images: the same key loads once while alive, again after release', async () => {
  const s = setup();
  const p1 = s.images.load(item('a')), p2 = s.images.load(item('a'));
  assert.equal(p1, p2);
  assert.equal(s.net.calls.length, 1);
  s.net.calls[0].resolve(JPEG);
  await flush();
  s.win.images[0].finish(100, 100);
  await p1;
  assert.equal(s.images.load(item('a')), p1, 'still alive: same promise');
  assert.equal(s.net.calls.length, 1);
  s.images.release('a');
  s.images.load(item('a'));
  assert.equal(s.net.calls.length, 2);
});

for (const how of ['release', 'close']) {
  test(`images: ${how}() while the download is pending rejects with released and decodes nothing`, async () => {
    const s = setup();
    const p = s.images.load(item('a'));
    if (how === 'release') s.images.release('a'); else s.images.close();
    assert.equal(s.images.count(), 0);
    s.net.calls[0].resolve(JPEG);
    await rejectsWith(p, 'released');
    await flush();
    assert.equal(s.win.images.length, 0, 'no decode started');
    assert.equal(s.images.count(), 0);
    assert.deepEqual(Object.keys(s.images.live), []);
  });

  test(`images: ${how}() while decoding rejects with released and destroys the late texture`, async () => {
    const s = setup();
    const p = s.images.load(item('a'));
    s.net.calls[0].resolve(JPEG);
    await flush();
    assert.equal(s.win.images.length, 1, 'decode started');
    if (how === 'release') s.images.release('a'); else s.images.close();
    s.win.images[0].finish(640, 480);
    await rejectsWith(p, 'released');
    await flush();
    assert.equal(s.made.textures.length, 1);
    assert.equal(s.made.textures[0].destroyed, 1, 'late texture destroyed');
    assert.ok(s.made.baseTextures[0]._destroyed, 'and its base texture');
    assert.equal(s.win.urls.size, 0, 'blob URL revoked');
    assert.deepEqual(Object.keys(s.images.live), []);
  });
}

test('images: a key loaded again after a pending release keeps the new load alive', async () => {
  const s = setup();
  const first = s.images.load(item('a'));
  s.images.release('a');
  const second = s.images.load(item('a'));
  assert.notEqual(first, second);
  s.net.calls[0].resolve(JPEG);
  s.net.calls[1].resolve(JPEG);
  await rejectsWith(first, 'released');
  await flush();
  s.win.images.forEach((img) => img.finish(320, 200));
  const pic = await second;
  await flush();
  assert.deepEqual(Object.keys(s.images.live), ['a']);
  assert.equal(s.images.live.a.picture, pic);
  assert.equal(pic.texture.destroyed, 0);
});

test('images: keep() releases all other keys, pending or loaded', async () => {
  const s = setup();
  const a = s.images.load(item('a')), b = s.images.load(item('b'));
  s.net.calls[0].resolve(JPEG);
  await flush();
  s.win.images[0].finish(100, 100);
  const picA = await a;
  s.images.keep(['b']);
  assert.equal(picA.texture.destroyed, 1);
  assert.deepEqual(Object.keys(s.images.live), ['b']);
  s.images.keep([]);
  s.net.calls[1].resolve(JPEG);
  await rejectsWith(b, 'released');
  assert.equal(s.images.count(), 0);
});

test('images: non-image bytes, broken, oversized or slow pictures are refused and leave nothing behind', async () => {
  const s = setup();
  const html = s.images.load(item('html'));
  s.net.calls[0].resolve(HTML);
  await rejectsWith(html, 'not_an_image');
  assert.equal(s.win.images.length, 0, 'never handed to <img>');

  const broken = s.images.load(item('broken'));
  s.net.calls[1].resolve(PNG);
  await flush();
  s.win.images[0].fail();
  await rejectsWith(broken, 'decode_failed');

  const huge = s.images.load(item('huge'));
  s.net.calls[2].resolve(JPEG);
  await flush();
  s.win.images[1].finish(4096, 1024);
  await rejectsWith(huge, 'bad_size');

  const slow = s.images.load(item('slow'));
  s.net.calls[3].resolve(JPEG);
  await flush();
  s.win.clock.advance(15000);
  await rejectsWith(slow, 'decode_timeout');

  const failed = s.images.load(item('offline'));
  s.net.calls[4].reject(new Error('offline'));
  await rejectsWith(failed, 'offline');

  await flush();
  assert.deepEqual(Object.keys(s.images.live), []);
  assert.equal(s.win.urls.size, 0, 'every blob URL revoked');
  assert.equal(s.made.textures.length, 0, 'no texture made');
  assert.equal(s.win.clock.pending(), 0, 'no decode timer left');
});

// A loaded picture, ready for the on-screen counting tests.
async function loaded(s, key) {
  const n = s.net.calls.length, p = s.images.load(item(key));
  s.net.calls[n].resolve(JPEG);
  await flush();
  s.win.images[s.win.images.length - 1].finish(100, 100);
  return p;
}

test('images: a picture stays alive while a sprite shows it; the last retire releases it', async () => {
  const s = setup();
  const a = await loaded(s, 'a');
  s.images.showing('a'); s.images.showing('a');            // shown twice (e.g. a cross-fade back to it)
  s.images.keep([]);
  assert.deepEqual(Object.keys(s.images.live), ['a'], 'keep() never drops a picture on screen');
  s.images.retired(a.texture, null);
  assert.equal(a.texture.destroyed, 0, 'still shown once');
  s.images.retired(a.texture, null);
  assert.equal(a.texture.destroyed, 1, 'released once nothing shows it');
  assert.equal(s.images.count(), 0);
});

test('images: the current picture is not released when its sprite goes', async () => {
  const s = setup();
  const a = await loaded(s, 'a');
  s.images.showing('a');
  s.images.retired(a.texture, 'a');
  assert.equal(a.texture.destroyed, 0);
  assert.deepEqual(Object.keys(s.images.live), ['a']);
  s.images.keep(['b']);
  assert.equal(a.texture.destroyed, 1, 'no longer on screen: keep() may drop it');
});

test('images: retired() for an unknown or released texture does nothing', async () => {
  const s = setup();
  const a = await loaded(s, 'a');
  s.images.showing('a');
  s.images.release('a');
  s.images.retired(a.texture, null);
  s.images.retired({}, null);
  assert.equal(s.images.count(), 0);
  assert.deepEqual(s.images.onScreen, {});
});
