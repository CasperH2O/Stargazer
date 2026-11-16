// Pure geometry: word wrap, fitted lines, description pages and the pager bar for them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';
const L = lib('layout.js');

const measure = (text, size) => Array.from(text).length * size / 2;   // 10 px per character at 20 px

test('wrap: greedy words, nothing wider than the width, a long word is cut', () => {
  assert.deepEqual(L.wrap('one two three four', 90, 20, measure), ['one two', 'three', 'four']);
  assert.deepEqual(L.wrap('', 90, 20, measure), []);
  assert.deepEqual(L.wrap('  a   b ', 90, 20, measure), ['a b']);
  const cut = L.wrap('abcdefghijklmnopqrstuvwxyz', 100, 20, measure);
  assert.equal(cut.join(''), 'abcdefghijklmnopqrstuvwxyz');
  for (const line of cut) assert.ok(measure(line, 20) <= 100);
});

test('wrapFit: the biggest size that fits, else the minimum with an ellipsis on the last line', () => {
  assert.deepEqual(L.wrapFit('short', 200, 20, 10, 2, measure), { lines: ['short'], size: 20 });
  const shrunk = L.wrapFit('aaaa bbbb cccc dddd', 80, 20, 10, 2, measure);   // 4 lines at 20, 2 lines from 17 px
  assert.equal(shrunk.size, 17); assert.equal(shrunk.lines.length, 2);
  const cut = L.wrapFit('aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll', 100, 20, 10, 2, measure);
  assert.equal(cut.size, 10); assert.equal(cut.lines.length, 2);
  assert.ok(cut.lines[1].endsWith('…'));
  for (const line of cut.lines) assert.ok(measure(line, 10) <= 100);
  const fixed = L.wrapFit('aaaa bbbb cccc dddd eeee ffff', 100, 20, 20, 2, measure);   // min = size: never shrinks
  assert.equal(fixed.size, 20); assert.ok(fixed.lines[1].endsWith('…'));
});

test('paginate: the first page is short, later pages are longer, always one page', () => {
  const lines = Array.from({ length: 20 }, (_, i) => 'l' + i);
  const pages = L.paginate(lines, 5, 8);
  assert.deepEqual(pages.map((p) => p.length), [5, 8, 7]);
  assert.deepEqual([].concat(...pages), lines);
  assert.deepEqual(L.paginate([], 5, 8), [[]]);
  assert.deepEqual(L.paginate(['a', 'b'], 5, 8), [['a', 'b']]);
});

test('pagerAt: the thumb is one page wide and moves across the track; one page has no bar', () => {
  assert.equal(L.pagerAt(0, 1), null);
  const first = L.pagerAt(0, 4), last = L.pagerAt(3, 4);
  assert.equal(first.thumb.x, first.track.x);
  assert.equal(first.thumb.width, Math.round(first.track.width / 4));
  assert.equal(last.thumb.x + last.thumb.width, last.track.x + last.track.width);
  assert.deepEqual(L.pagerBar(0, 4), L.pagerAt(0, 2), 'menu lists use the same bar');
});

test('the overlay fits the safe area: gear inside x 120-1160, text above y 600', () => {
  const I = L.info, g = I.gear;
  assert.ok(g.x - g.size / 2 >= 120 && g.x + g.size / 2 <= 1160 && g.size >= 100);
  assert.ok(I.title.x - I.title.width / 2 >= 120 && I.title.x + I.title.width / 2 <= g.x - g.size / 2, 'title clear of the gear');
  assert.ok(I.body.x >= 120 && I.body.x + I.body.width <= 1160 && I.more.x + I.more.width <= 1160);
  assert.ok(I.body.y + I.body.lines * I.body.line <= I.credit.y, 'credit under page 1');
  assert.ok(I.credit.y + I.credit.lines * I.credit.line <= 600);
  assert.ok(I.more.y + I.more.lines * I.more.line <= 600);
  assert.ok(I.title.y + I.title.lines * I.title.line / 2 <= I.meta.y - I.meta.size / 2, 'meta under the title');
  assert.ok(I.meta.y + I.meta.size / 2 <= I.body.y);
  assert.ok(I.title.y + I.title.lines * I.title.line / 2 <= I.more.y, 'later pages under the title');
});
