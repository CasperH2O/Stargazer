import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
export const lib = (name) => require(`../stargazer/lib/${name}`);
export const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

// A fake clock: timers run only when advanced.
export function fakeClock(start = 1_000_000) {
  let now = start, seq = 0;
  const queue = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = ++seq; queue.set(id, { at: now + Math.max(0, ms || 0), fn }); return id; },
    clearTimeout(id) { queue.delete(id); },
    pending: () => queue.size,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of queue) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        queue.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = end;
    }
  };
}
// A fake net: url -> string | object | Error.
export function fakeNet(routes) {
  const calls = [];
  const find = (url) => { calls.push(url); for (const [k, v] of Object.entries(routes)) if (url.startsWith(k)) return v; return new Error('no_route ' + url); };
  const wrap = (v, map) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(map(v)));
  return {
    calls,
    text: (url) => wrap(find(url), (v) => (typeof v === 'string' ? v : JSON.stringify(v))),
    json: (url) => wrap(find(url), (v) => (typeof v === 'string' ? JSON.parse(v) : v)),
    get: (url) => wrap(find(url), (v) => ({ status: 200, headers: {}, body: Buffer.isBuffer(v) ? v : Buffer.from(String(v)), url })),
  };
}
