'use strict';
// HTTP(S) GET into memory, the way BEam's own skills fetch (Node http/https; BEam's music skill
// reaches lrclib.net like this). Bodies are capped in size and time and never touch the disk.
// Redirects are followed (up to 4); timeoutMs covers the whole get, redirects included.
// get(url, {maxBytes, timeoutMs, accept}) -> Promise<{status, headers, body: Buffer, url}>;
// text(url) and json(url) are shorthands.
// Runs on the robot's Node 6: ES2015 only.
var http = require('http'), https = require('https'), urlLib = require('url');

var USER_AGENT = 'Stargazer/0.4 (Jibo skill)';
var DEFAULT_MAX = 4 * 1024 * 1024, DEFAULT_TIMEOUT = 20000;

function get(target, options, transport) {
    options = options || {};
    transport = transport || {http: http, https: https};
    var maxBytes = options.maxBytes || DEFAULT_MAX, timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT;
    // One deadline for the whole get, redirects included: a per-hop timer would let a redirecting
    // server stretch a caller's budget (catalog.js gives a source 25 s) up to five times.
    var hops = 0, deadline = Date.now() + timeoutMs;
    function once(address) {
        return new Promise(function (resolve, reject) {
            var u = urlLib.parse(address), lib = u.protocol === 'https:' ? transport.https : transport.http;
            if (!/^https?:$/.test(u.protocol || '')) { reject(Error('bad_url')); return; }
            var done = false, request, timer;
            function finish(error, value) {
                if (done) return;
                done = true; clearTimeout(timer);
                if (error) { try { if (request) request.abort(); } catch (_) {} reject(error); } else resolve(value);
            }
            request = lib.request({protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.path, method: 'GET',
                headers: {'User-Agent': USER_AGENT, 'Accept': options.accept || '*/*'}}, function (response) {
                var status = response.statusCode, headers = response.headers || {};
                if (status >= 300 && status < 400 && headers.location) {
                    try { response.resume(); } catch (_) {}
                    finish(null, {redirect: urlLib.resolve(address, headers.location)});
                    return;
                }
                if (Number(headers['content-length']) > maxBytes) { finish(Error('too_large')); return; }
                var chunks = [], size = 0;
                response.on('data', function (chunk) {
                    if (done) return;
                    var bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
                    size += bytes.length;
                    if (size > maxBytes) { finish(Error('too_large')); return; }
                    chunks.push(bytes);
                });
                response.on('error', function (error) { finish(error); });
                response.on('aborted', function () { finish(Error('aborted')); });
                response.on('end', function () { finish(null, {status: status, headers: headers, body: Buffer.concat(chunks), url: address}); });
            });
            request.on('error', function (error) { finish(error); });
            timer = setTimeout(function () { finish(Error('timeout')); }, Math.max(0, deadline - Date.now()));
            request.end();
        }).then(function (result) {
            if (result.redirect) {
                if (++hops > 4) throw Error('too_many_redirects');
                return once(result.redirect);
            }
            if (result.status !== 200) throw Error('http_' + result.status);
            return result;
        });
    }
    return once(target);
}

function text(target, options, transport) { return get(target, options, transport).then(function (r) { return r.body.toString('utf8'); }); }
function json(target, options, transport) {
    return text(target, Object.assign({accept: 'application/json'}, options), transport).then(function (body) { return JSON.parse(body); });
}

module.exports = {get: get, text: text, json: json, USER_AGENT: USER_AGENT};
