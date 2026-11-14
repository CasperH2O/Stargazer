// Loader: which source and picture are tried, in which order, and cancelling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';

const Loader = lib('loader.js');
const silent = { info() {}, warn() {} };

// lists: source id -> [item] or Error; failing: item keys whose picture fails.
function setup(lists, failing = []) {
  const tried = [], kept = [];
  const catalog = {
    list: (id) => { tried.push('list ' + id); const l = lists[id]; return l instanceof Error ? Promise.reject(l) : Promise.resolve(l); },
    resolve: (item) => Promise.resolve(item),
  };
  const images = {
    keep: (keys) => kept.push(keys.join(',')),
    load: (item) => { tried.push('load ' + item.key); return failing.includes(item.key) ? Promise.reject(new Error('bad')) : Promise.resolve({ key: item.key }); },
  };
  return { tried, kept, loader: new Loader({ catalog, images, log: silent }) };
}
const items = (id, n) => Array.from({ length: n }, (_, i) => ({ key: id + i, source: id }));

test('loader: the first source that lists, with its newest picture', async () => {
  const s = setup({ a: items('a', 3), b: items('b', 3) });
  const hooks = [];
  const found = await s.loader.load(['a', 'b'], { onListed: () => hooks.push('listed'), onLoaded: () => hooks.push('loaded') });
  assert.equal(found.item.key, 'a0');
  assert.deepEqual(found.picture, { key: 'a0' });
  assert.deepEqual(s.tried, ['list a', 'load a0']);
  assert.deepEqual(s.kept, ['a0'], 'other pictures may go before a new one loads');
  assert.deepEqual(hooks, ['listed', 'loaded']);
  assert.equal(s.loader.busy(), false);
});

test('loader: a failing source is skipped; a failing newest picture falls back to the one before it, then the next source', async () => {
  const s = setup({ a: new Error('offline'), b: items('b', 3), c: items('c', 1) }, ['b0', 'b1']);
  const found = await s.loader.load(['a', 'b', 'c']);
  assert.equal(found.item.key, 'c0');
  assert.deepEqual(s.tried, ['list a', 'list b', 'load b0', 'load b1', 'list c', 'load c0'], 'never more than the two newest');
});

test('loader: nothing loads -> rejects', async () => {
  const s = setup({ a: new Error('offline') });
  await assert.rejects(s.loader.load(['a']), /no picture could be loaded/);
  await assert.rejects(s.loader.load([]), /no picture could be loaded/);
});

test('loader: cancel() or a newer load() stops the one in flight', async () => {
  const s = setup({ a: items('a', 1), b: items('b', 1) });
  const first = s.loader.load(['a']);
  s.loader.cancel();
  await assert.rejects(first, /cancelled/);
  assert.deepEqual(s.tried, ['list a'], 'no picture loaded after the cancel');

  const older = s.loader.load(['a']), newer = s.loader.load(['b']);
  await assert.rejects(older, /cancelled/);
  assert.equal((await newer).item.key, 'b0');
});
