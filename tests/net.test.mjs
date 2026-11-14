import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lib } from './helpers.mjs';

const net = lib('net.js');

// A fake http/https transport. routes: 'host/path' -> {status, headers, chunks: [string], end: bool, abortAfter: bool, hang: bool, delay: ms}.
// Records every request (with its headers) and every abort.
function transport(routes) {
  const requests = [], aborts = [];
  const lib = {
    request(opts, cb) {
      const key = opts.hostname + opts.path;
      requests.push({ key, protocol: opts.protocol, headers: opts.headers });
      const req = new EventEmitter();
      req.aborted = false;
      req.abort = () => { req.aborted = true; aborts.push(key); };
      req.end = () => setTimeout(() => {
        const r = routes[key];
        if (!r) { req.emit('error', new Error('no_route ' + key)); return; }
        if (r.hang) return; // never responds
        const res = new EventEmitter();
        res.statusCode = r.status; res.headers = r.headers || {}; res.resume = () => {};
        cb(res);
        for (const c of r.chunks || []) { if (req.aborted) return; res.emit('data', Buffer.from(c)); }
        if (req.aborted) return;
        if (r.abortAfter) { res.emit('aborted'); return; }
        if (r.end !== false) res.emit('end');
      }, (routes[key] && routes[key].delay) || 0);
      return req;
    }
  };
  return { http: lib, https: lib, requests, aborts };
}

test('net: a body without Content-Length that grows past maxBytes is cut off (too_large) and the request aborted', async () => {
  const tr = transport({ 'a.test/big': { status: 200, chunks: ['x'.repeat(600), 'y'.repeat(600), 'z'.repeat(600)] } });
  await assert.rejects(net.get('https://a.test/big', { maxBytes: 1000 }, tr), /too_large/);
  assert.deepEqual(tr.aborts, ['a.test/big']);
  // Exactly at the cap is still fine.
  const ok = transport({ 'a.test/fit': { status: 200, chunks: ['x'.repeat(500), 'y'.repeat(500)] } });
  const r = await net.get('https://a.test/fit', { maxBytes: 1000 }, ok);
  assert.equal(r.body.length, 1000);
  assert.deepEqual(ok.aborts, []);
});

test('net: a server that never answers rejects with timeout and the request is aborted', async () => {
  const tr = transport({ 'slow.test/x': { hang: true } });
  const started = Date.now();
  await assert.rejects(net.get('http://slow.test/x', { timeoutMs: 30 }, tr), /timeout/);
  assert.ok(Date.now() - started < 2000);
  assert.deepEqual(tr.aborts, ['slow.test/x']);
});

test('net: a body that starts but never ends also times out', async () => {
  const tr = transport({ 'slow.test/body': { status: 200, chunks: ['partial'], end: false } });
  await assert.rejects(net.get('http://slow.test/body', { timeoutMs: 30 }, tr), /timeout/);
  assert.deepEqual(tr.aborts, ['slow.test/body']);
});

test('net: timeoutMs bounds the whole get, redirects included (not each hop)', async () => {
  // Each hop answers well within the timeout, but the chain as a whole does not.
  const tr = transport({
    'hop.test/1': { status: 302, headers: { location: '/2' }, delay: 40 },
    'hop.test/2': { status: 302, headers: { location: '/3' }, delay: 40 },
    'hop.test/3': { status: 302, headers: { location: '/4' }, delay: 40 },
    'hop.test/4': { status: 200, chunks: ['late'], delay: 40 }
  });
  await assert.rejects(net.get('http://hop.test/1', { timeoutMs: 100 }, tr), /timeout/);
  assert.equal(tr.aborts.length, 1);
  // With room for the whole chain it arrives.
  assert.equal(await net.text('http://hop.test/1', { timeoutMs: 1000 }, tr), 'late');
});

test('net: a redirect loop stops with too_many_redirects', async () => {
  const tr = transport({
    'loop.test/a': { status: 302, headers: { location: '/b' } },
    'loop.test/b': { status: 302, headers: { location: '/a' } }
  });
  await assert.rejects(net.get('https://loop.test/a', {}, tr), /too_many_redirects/);
  assert.equal(tr.requests.length, 5); // the first request plus 4 followed hops
});

test('net: a redirect to a non-http(s) scheme is refused (bad_url) without a request for it', async () => {
  const tr = transport({ 'evil.test/x': { status: 301, headers: { location: 'file:///etc/passwd' } } });
  await assert.rejects(net.get('https://evil.test/x', {}, tr), /bad_url/);
  assert.deepEqual(tr.requests.map((r) => r.key), ['evil.test/x']);
  // Directly, too, for any non-http(s) scheme.
  await assert.rejects(net.get('file:///etc/passwd', {}, tr), /bad_url/);
  await assert.rejects(net.get('ftp://evil.test/x', {}, tr), /bad_url/);
  assert.equal(tr.requests.length, 1);
});

test('net: relative redirects resolve against the current address', async () => {
  const tr = transport({
    'r.test/dir/page': { status: 301, headers: { location: 'next?q=1' } },
    'r.test/dir/next?q=1': { status: 307, headers: { location: '/root/final' } },
    'r.test/root/final': { status: 302, headers: { location: '//cdn.test/img.jpg' } },
    'cdn.test/img.jpg': { status: 200, chunks: ['done'] }
  });
  const r = await net.get('https://r.test/dir/page', {}, tr);
  assert.equal(r.body.toString(), 'done');
  assert.equal(r.url, 'https://cdn.test/img.jpg');
  assert.deepEqual(tr.requests.map((q) => q.key), ['r.test/dir/page', 'r.test/dir/next?q=1', 'r.test/root/final', 'cdn.test/img.jpg']);
  assert.equal(tr.requests[3].protocol, 'https:');
});

test('net: a non-200 status rejects as http_<status>', async () => {
  const tr = transport({ 'a.test/missing': { status: 404, chunks: ['<h1>Not found</h1>'] }, 'a.test/err': { status: 500 } });
  await assert.rejects(net.text('https://a.test/missing', {}, tr), /http_404/);
  await assert.rejects(net.json('https://a.test/err', {}, tr), /http_500/);
  // A 3xx without a Location header is not a redirect either.
  const nl = transport({ 'a.test/304': { status: 304 } });
  await assert.rejects(net.get('https://a.test/304', {}, nl), /http_304/);
});

test('net: a response cut off mid-body rejects with aborted', async () => {
  const tr = transport({ 'a.test/cut': { status: 200, chunks: ['half a bo'], abortAfter: true } });
  await assert.rejects(net.get('https://a.test/cut', {}, tr), /aborted/);
});

test('net: json() parses the body and asks for application/json; get() sends the user agent and */*', async () => {
  const tr = transport({ 'api.test/v1': { status: 200, chunks: ['{"title":', '"M31","n":2}'] }, 'api.test/raw': { status: 200, chunks: ['x'] }, 'api.test/bad': { status: 200, chunks: ['<html>'] } });
  assert.deepEqual(await net.json('https://api.test/v1', {}, tr), { title: 'M31', n: 2 });
  assert.equal(tr.requests[0].headers.Accept, 'application/json');
  assert.equal(tr.requests[0].headers['User-Agent'], net.USER_AGENT);
  await net.get('https://api.test/raw', undefined, tr);
  assert.equal(tr.requests[1].headers.Accept, '*/*');
  // Options pass through json(): a caller's accept and timeout are kept, and the shared options object is not changed.
  const opts = { timeoutMs: 8000 };
  await net.json('https://api.test/v1', opts, tr);
  assert.deepEqual(opts, { timeoutMs: 8000 });
  await assert.rejects(net.json('https://api.test/bad', {}, tr), SyntaxError);
});
