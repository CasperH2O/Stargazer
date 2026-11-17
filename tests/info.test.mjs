import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';
const { InfoPages } = lib('info.js');

const measure = (text, size) => text.length * size / 2;       // every character is half the font size wide
const measures = { title: measure, body: measure, credit: measure };
const words = Array.from({ length: 300 }, (_, i) => 'word' + (i % 10)).join(' ');
const item = { key: 'a1', title: 'Cat\'s Eye', description: words, credit: 'NASA' };

test('info: the text is broken once per picture; a new picture starts on page 1', () => {
  const info = new InfoPages();
  const first = info.prepare(item, measures);
  assert.ok(info.count >= 3 && first.pages.length === info.count, 'a long description takes several pages');
  assert.equal(info.prepare(item, measures), first, 'cached');
  info.turn(1);
  assert.equal(info.page, 1);
  info.prepare(item, measures);
  assert.equal(info.page, 1, 'the same picture keeps its page');
  info.prepare({ ...item, key: 'a2' }, measures);
  assert.equal(info.page, 0);
});

test('info: turn stays within the pages, close goes back to page 1 and keeps the text', () => {
  const info = new InfoPages();
  const text = info.prepare(item, measures);
  assert.equal(info.turn(-1), false); assert.equal(info.canBack(), false);
  while (info.turn(1)) { /* to the last page */ }
  assert.equal(info.page, info.count - 1); assert.equal(info.canForward(), false); assert.equal(info.canBack(), true);
  info.close();
  assert.equal(info.page, 0);
  assert.equal(info.prepare(item, measures), text);
});

test('info: nothing is made while a label is not built yet', () => {
  const info = new InfoPages();
  assert.equal(info.prepare(item, { title: measure, body: null, credit: measure }), null);
  assert.ok(info.prepare(item, measures));
});
