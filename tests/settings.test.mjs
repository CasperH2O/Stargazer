import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lib } from './helpers.mjs';
const S = lib('settings.js');

test('defaults: calm effects, 10 s, no slideshow, read title, ESA Earth from Space off', () => {
  const v = S.clean();
  assert.deepEqual(v.effects, { kenBurns: true, iris: true, lookUp: false, starfield: false });
  assert.equal(v.showFor, 10); assert.equal(v.slideshow, 0); assert.equal(v.readTitle, true); assert.equal(v.caption, true);
  assert.equal(v.sources['esa-efs'], false);
  assert.equal(S.enabledSources(v).length, 7);
});

test('clean() drops unknown keys and bad values, and never allows zero sources', () => {
  const v = S.clean({ showFor: 7, slideshow: 'x', effects: { iris: false, bogus: true }, sources: Object.fromEntries(S.SOURCES.map((s) => [s, false])), extra: 1 });
  assert.equal(v.showFor, 10); assert.equal(v.slideshow, 0); assert.equal(v.effects.iris, false); assert.equal(v.extra, undefined);
  assert.ok(S.enabledSources(v).length > 0);
});

test('the last source on cannot be turned off', () => {
  let v = S.clean({ sources: { apod: true, hubble: false, webb: false, eso: false, noirlab: false, 'nasa-iotd': false, epic: false, 'esa-efs': false } });
  const r = S.toggleSource(v, 'apod');
  assert.equal(r.refused, 'lastSource');
  assert.equal(S.toggleSource(v, 'eso').values.sources.eso, true);
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
  let h = store.remember({}, { source: 'apod', key: 'apod:2026-11-14', date: 5 }, 7);
  h = store.remember(h, { source: 'eso', key: 'eso:potw1', date: undefined }, 8);
  assert.deepEqual(store.history(), { apod: { key: 'apod:2026-11-14', date: 5, at: 7 }, eso: { key: 'eso:potw1', date: 0, at: 8 } });
  writeFileSync(join(root, 'sources.json'), JSON.stringify({ apod: { key: 3 }, bogus: { key: 'x' }, eso: { key: 'e', date: 'NaN' } }));
  assert.deepEqual(store.history(), { eso: { key: 'e', date: 0, at: 0 } });
  assert.deepEqual(readdirSync(root).sort(), ['seen.json', 'settings.json', 'sources.json']);
  writeFileSync(join(root, 'settings.json'), 'not json');
  assert.deepEqual(store.read(), S.clean());
});
