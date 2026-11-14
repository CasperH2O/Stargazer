import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
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
