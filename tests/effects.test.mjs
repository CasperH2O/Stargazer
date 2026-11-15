// The effects: Ken Burns plans, iris radius, starfield helpers, eyepiece search path and horizon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createPixi } from './pixi-stub.mjs';

const require = createRequire(import.meta.url);
const util = require('../stargazer/lib/effects/util.js');
const kb = require('../stargazer/lib/effects/kenburns.js');
const iris = require('../stargazer/lib/effects/iris.js');
const star = require('../stargazer/lib/effects/starfield.js');
const eyepiece = require('../stargazer/lib/effects/eyepiece.js');

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

test('starfield helpers', () => {
  const s = star.makeStars(100, util.rng(1));
  assert.equal(s.length, 100);
  assert.ok(s.every((x) => x.d > 0 && x.d <= 1 && x.size >= 1));
  assert.equal(star.sparklePoints(0, 0, 10).length, 16);
});

// The search path: glides to random spots inside an ellipse (ax x ay around (0, cy)), pausing at each.
const inEllipse = (p, ax, ay, cy = 0) => (p.dx / ax) ** 2 + ((p.dy - cy) / ay) ** 2 <= 1 + 1e-9;
const sample = (path, ms, step = 16) => { const out = []; for (let t = 0; t <= ms; t += step) out.push(Object.assign({ t }, path.at(t))); return out; };
// The presenter's sky band near the top of the screen (presenter.js SKY_Y, SEARCH).
const SKY = { ax: 300, ay: 15, cy: -95 };
const PATHS = [
  [undefined, 300, 100, 0, { dx: 0, dy: 0 }],
  [{ ax: 120, ay: 40 }, 120, 40, 0, { dx: 0, dy: 0 }],
  [{ ...SKY, from: { dx: 0, dy: 0 } }, 300, 15, -95, { dx: 0, dy: 0 }],             // no Look up: from the centre
  [{ ...SKY, from: { dx: 0, dy: -95 } }, 300, 15, -95, { dx: 0, dy: -95 }],          // after the glance
  [{ ...SKY, from: { dx: 40, dy: -88 } }, 300, 15, -95, { dx: 40, dy: -88 }],
];

test('eyepiece search path starts where it is told and moves continuously, into and then inside its ellipse', () => {
  for (const [opts, ax, ay, cy, from] of PATHS) {
    for (let seed = 1; seed <= 20; seed++) {
      const path = new eyepiece.SearchPath(util.rng(seed), opts);
      const start = path.at(0);
      assert.ok(Math.abs(start.dx - from.dx) < 1e-9 && Math.abs(start.dy - from.dy) < 1e-9, JSON.stringify(start));
      assert.equal(start.move, 0);
      assert.equal(start.moving, true, 'it sets off at once');
      assert.deepEqual(path.segs[0].from, from, 'the first glide starts at opts.from');
      const first = path.segs[0];
      let prev = start, maxR = 0;
      for (const p of sample(path, 60000)) {
        assert.ok(Number.isFinite(p.dx) && Number.isFinite(p.dy));
        if (p.t >= first.t1) assert.ok(inEllipse(p, ax, ay, cy), `seed ${seed} t=${p.t}: ${p.dx},${p.dy}`);
        else {
          // The first glide runs straight from the start to a spot in the ellipse.
          const between = (v, a, b) => v >= Math.min(a, b) - 1e-9 && v <= Math.max(a, b) + 1e-9;
          assert.ok(between(p.dx, first.from.dx, first.to.dx) && between(p.dy, first.from.dy, first.to.dy), `seed ${seed} t=${p.t}: off the first glide`);
        }
        // Fastest glide: inOutCubic peaks at 3x the mean speed, which is dist / (900 + 2.2 dist) < 1/2.2 px/ms.
        assert.ok(Math.hypot(p.dx - prev.dx, p.dy - prev.dy) <= 3 * 16 / 2.2 + 1e-9, `seed ${seed}: jump at t=${p.t}`);
        if (p.t >= first.t1) maxR = Math.max(maxR, Math.abs(p.dx / ax));
        prev = p;
      }
      assert.ok(maxR > 0.6, `seed ${seed}: it does look around sideways (${maxR})`);
    }
  }
});

test('eyepiece search path in the sky band stays within dx ±ax and cy ±ay for a long run', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const path = new eyepiece.SearchPath(util.rng(seed), { ...SKY, from: { dx: 0, dy: SKY.cy } });
    let minDy = Infinity, maxDy = -Infinity;
    for (const p of sample(path, 180000, 20)) {
      assert.ok(Math.abs(p.dx) <= SKY.ax + 1e-6, `seed ${seed} t=${p.t}: dx ${p.dx}`);
      assert.ok(Math.abs(p.dy - SKY.cy) <= SKY.ay + 1e-6, `seed ${seed} t=${p.t}: dy ${p.dy}`);
      minDy = Math.min(minDy, p.dy); maxDy = Math.max(maxDy, p.dy);
    }
    assert.ok(maxDy - minDy > 5, `seed ${seed}: it moves up and down a little too (${minDy}..${maxDy})`);
    for (const g of path.segs) {
      const k = Math.hypot(g.to.dx / SKY.ax, (g.to.dy - SKY.cy) / SKY.ay);
      assert.ok(k >= 0.45 - 1e-9 && k <= 1 + 1e-9, `spot at ${k} of the ellipse`);
    }
  }
});

test('eyepiece search path pauses between glides and counts them up', () => {
  for (const opts of [undefined, { ...SKY, from: { dx: 0, dy: 0 } }]) {
    for (let seed = 1; seed <= 20; seed++) {
      const path = new eyepiece.SearchPath(util.rng(seed), opts);
      const s = sample(path, 60000, 10);
      let pauses = 0, holdStart = -1, last = s[0];
      for (const p of s.slice(1)) {
        assert.ok(p.move === last.move || p.move === last.move + 1, `seed ${seed}: move ${last.move} -> ${p.move}`);
        if (p.move === last.move + 1) {
          assert.equal(last.moving, false, 'a new glide starts only after a pause');
          assert.ok(p.moving);
        }
        if (!p.moving) {
          if (last.moving) { holdStart = p.t; pauses++; }
          else assert.ok(p.dx === last.dx && p.dy === last.dy, 'stands still while pausing');
        }
        if (p.moving && !last.moving && holdStart >= 0) {
          const hold = p.t - holdStart;
          assert.ok(hold >= 350 - 10 && hold <= 1050 + 10, `seed ${seed}: pause of ${hold} ms`);
        }
        last = p;
      }
      assert.ok(pauses >= 15, `seed ${seed}: ${pauses} pauses in a minute`);
      assert.ok(last.move >= 15);
      // Glides take 900 ms plus 2.2 ms per pixel.
      for (const g of path.segs) {
        const dist = Math.hypot(g.to.dx - g.from.dx, g.to.dy - g.from.dy);
        assert.ok(Math.abs(g.t1 - g.t0 - (900 + 2.2 * dist)) < 1e-6);
        assert.ok(g.t2 - g.t1 >= 350 && g.t2 - g.t1 <= 1050);
      }
    }
  }
});

test('eyepiece search path never picks a spot close sideways to the last one', () => {
  for (const [opts, ax, ay, cy] of [[undefined, 300, 100, 0], [{ ...SKY, from: { dx: 0, dy: 0 } }, 300, 15, -95], [{ ...SKY, from: { dx: 0, dy: -95 } }, 300, 15, -95]]) {
    let close = 0, total = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const path = new eyepiece.SearchPath(util.rng(seed), opts);
      path.at(120000);
      for (let i = 0; i < path.segs.length; i++) {
        const g = path.segs[i];
        if (i > 0) assert.deepEqual(g.from, path.segs[i - 1].to, 'each glide starts where the last ended');
        assert.ok(inEllipse(g.to, ax, ay, cy));
        total++;
        // Apart sideways: the band can be flat, so the vertical distance does not count.
        if (Math.abs(g.to.dx - g.from.dx) / ax < 0.45) close++;
      }
    }
    // 12 tries per spot: a spot too close to the last one only when all 12 were.
    assert.ok(close / total < 0.01, `${close} of ${total} spots too close`);
  }
});

test('eyepiece search path is reproducible for a seed and independent of how it is sampled', () => {
  for (const opts of [undefined, { ...SKY, from: { dx: 0, dy: 0 } }]) {
    const a = new eyepiece.SearchPath(util.rng(11), opts), b = new eyepiece.SearchPath(util.rng(11), opts), c = new eyepiece.SearchPath(util.rng(12), opts);
    const fine = sample(a, 30000, 16), coarse = [];
    for (let t = 0; t <= 30000; t += 16 * 7) coarse.push(Object.assign({ t }, b.at(t)));
    for (const p of coarse) assert.deepEqual(p, fine[p.t / 16]);
    assert.deepEqual(a.segs, b.segs.slice(0, a.segs.length));
    assert.notDeepEqual(sample(c, 30000, 16), fine, 'another seed, another path');
  }
});

test('eyepiece: grass along the bottom of the lens at first, out of view in the sky band; the scene stays put', async () => {
  const { SKY_Y, SEARCH, LENS_R, HORIZON } = require('../stargazer/lib/opening.js');
  const { PIXI } = createPixi(), layer = new PIXI.Container();
  const e = new eyepiece.Eyepiece(PIXI, layer, { x: 640, y: 360, r: LENS_R, rand: util.rng(3), horizon: HORIZON });
  // Where the horizon is on screen, and how far below the lens's bottom edge its blade tips are.
  const horizon = () => [e.c.position.x + e.scene.position.x, e.c.position.y + e.scene.position.y + e.ground.position.y];
  const belowLens = () => horizon()[1] - eyepiece.TIP - (e.c.position.y + LENS_R);
  e.setOffset(0, 0);
  assert.ok(belowLens() < -50, 'grass along the bottom of the lens at the start');
  for (const [dx, dy] of [[0, SKY_Y], [SEARCH.ax, SKY_Y - SEARCH.ay], [-SEARCH.ax, SKY_Y + SEARCH.ay]]) {
    e.setOffset(dx, dy);
    assert.deepEqual(horizon().map((v) => v + 0), [640, 360 + HORIZON], `the scene stays put with the lens at ${dx},${dy}`);
    assert.ok(belowLens() > 0, `no grass in the lens at ${dx},${dy}`);
  }
  e.update(5000);
  assert.deepEqual(horizon().map((v) => v + 0), [640, 360 + HORIZON], 'the sky does not drift');
  assert.ok(e.scene.mask === e.lensMask && e.ground.parent === e.scene && e.stars.parent === e.scene, 'stars and grass are both inside the lens');
  e.destroy();
  assert.equal(layer.children.length, 0);
});
