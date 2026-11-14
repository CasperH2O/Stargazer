// Pure parts of the effects: Ken Burns plans, iris radius, look-up glance, starfield helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const util = require('../stargazer/lib/effects/util.js');
const kb = require('../stargazer/lib/effects/kenburns.js');
const iris = require('../stargazer/lib/effects/iris.js');
const lookup = require('../stargazer/lib/effects/lookup.js');
const star = require('../stargazer/lib/effects/starfield.js');

const VIEW = { w: 1280, h: 720 };
const IMAGES = { landscape: { w: 1280, h: 853 }, portrait: { w: 1280, h: 1920 }, square: { w: 1080, h: 1080 }, small: { w: 660, h: 456 }, panorama: { w: 1280, h: 400 } };

// The visible window must stay inside the picture for the whole plan (no black edges).
function assertCovers(p, label) {
  for (let i = 0; i <= 50; i++) {
    const s = kb.at(p, (p.duration * i) / 50);
    const left = s.x - (p.img.w / 2) * s.scale, top = s.y - (p.img.h / 2) * s.scale;
    const right = left + p.img.w * s.scale, bottom = top + p.img.h * s.scale;
    assert.ok(left <= 0.01 && top <= 0.01 && right >= VIEW.w - 0.01 && bottom >= VIEW.h - 0.01, `${label} step ${i}: ${left},${top},${right},${bottom}`);
  }
}

test('Ken Burns plans always cover the screen', () => {
  for (const [name, img] of Object.entries(IMAGES)) {
    for (let seed = 1; seed <= 40; seed++) assertCovers(kb.plan(img, VIEW, util.rng(seed)), `${name}/${seed}`);
  }
});

test('Ken Burns chains plans without a jump', () => {
  const rand = util.rng(3);
  const a = kb.plan(IMAGES.landscape, VIEW, rand);
  const end = kb.at(a, a.duration);
  const b = kb.plan(IMAGES.landscape, VIEW, rand, { from: end });
  const start = kb.at(b, 0);
  for (const k of ['scale', 'x', 'y']) assert.ok(Math.abs(start[k] - end[k]) < 1e-9, k);
  assertCovers(b, 'chained');
});

test('Ken Burns pans portraits along their length', () => {
  const p = kb.plan(IMAGES.portrait, VIEW, util.rng(5));
  assert.ok(Math.abs(p.to.cy - p.from.cy) > 500, `vertical travel ${Math.abs(p.to.cy - p.from.cy)}`);
});

test('Ken Burns is reproducible for a seed', () => {
  assert.deepEqual(kb.plan(IMAGES.square, VIEW, util.rng(9)), kb.plan(IMAGES.square, VIEW, util.rng(9)));
});

test('iris starts at the eye, breathes in, and ends covering the corners', () => {
  const to = iris.coverRadius(VIEW, 640, 360);
  assert.ok(to > Math.hypot(640, 360));
  assert.equal(iris.radiusAt(0, 150, to, 1500), 150);
  assert.ok(iris.radiusAt(120, 150, to, 1500) < 150);
  assert.ok(Math.abs(iris.radiusAt(1500, 150, to, 1500) - to) < 1e-9);
  let prev = 0;
  for (let t = 300; t <= 1500; t += 50) { const r = iris.radiusAt(t, 150, to, 1500); assert.ok(r >= prev - 1e-9); prev = r; }
});

test('look-up glance rises, holds and returns', () => {
  assert.equal(lookup.glanceAt(0, 1000, 120).dy, -0);
  assert.ok(Math.abs(lookup.glanceAt(500, 1000, 120).dy + 120) < 1e-9);
  assert.ok(Math.abs(lookup.glanceAt(1000, 1000, 120).dy) < 1e-9);
});

test('starfield helpers', () => {
  const s = star.makeStars(100, util.rng(1));
  assert.equal(s.length, 100);
  assert.ok(s.every((x) => x.d > 0 && x.d <= 1 && x.size >= 1));
  assert.equal(star.sparklePoints(0, 0, 10).length, 16);
});
