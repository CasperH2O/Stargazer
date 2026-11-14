import test from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';
import { createPixi, createDocument, picture } from './pixi-stub.mjs';

globalThis.document = createDocument();   // caption.js paints its gradient on a global canvas
const Presenter = lib('presenter.js');
const T = Presenter.TIMING;
// From show() (or wait()) until the first picture's caption, with any effects, plus a margin:
// look in, the look-up glance, the shortest search, centring, focus pull, iris, caption.
const OPEN = T.lookIn + T.lookUp + T.minSearch + T.acquire + T.focus + T.iris + 150 + 400;
const LENS_R = 180;
const FRAME = 16;
// The eyepiece looks at the sky band near the top: SKY_Y above the centre, ±ax sideways, ±ay up and down.
const SKY_Y = -95, SEARCH = { ax: 300, ay: 15 }, TOL = 1e-6;
const CX = 640, SKY_CY = 360 + SKY_Y;

const CONFIGS = [
  {},
  { iris: true },
  { kenBurns: true },
  { lookUp: true },
  { lookUp: true, starfield: true },
  { lookUp: true, starfield: true, iris: true, kenBurns: true },
];
const label = (fx) => Object.keys(fx).join('+') || 'none';

function setup(effects, opts = {}) {
  const { PIXI, made } = createPixi();
  const stage = new PIXI.Container(), root = new PIXI.Container();
  stage.addChild(root);
  const shown = [], retired = [], textures = {}, cues = [], blurs = [];
  const p = new Presenter(PIXI, root, Object.assign({
    view: { w: 1280, h: 720 }, effects, seed: 7, document: createDocument(),
    onShown: (tex) => shown.push(tex.name),
    onRetire: (tex) => retired.push(tex.name),
    onCue: (name) => cues.push({ name, at: p.now }),
    onLookUp: (dir) => cues.push({ name: 'head-' + dir, at: p.now }),
  }, opts));
  // The focus-pull overlays' canvas textures, as the presenter makes them.
  const blurLevels = p.blurLevels;
  p.blurLevels = function (entry) { const out = blurLevels.call(this, entry); blurs.push(...out.map((b) => b.texture)); return out; };
  // Portrait pictures: shown "contain" over a blurred backdrop (a canvas texture) unless Ken Burns.
  const pic = (name) => (textures[name] = picture(PIXI, 600, 1400, name));
  const show = (name) => p.show(pic(name), { title: 'Picture ' + name, line: 'line', credit: 'credit' });
  const order = [];
  const showInOrder = (name) => { order.push(name); show(name); };
  // Pictures in the picture layer, bottom to top, by name.
  const layered = () => p.layers.pic.children.map((h) => h.children.find((c) => c.texture && c.texture.name).texture.name);
  // Nothing may sit above a newer picture: the layer is in show order and the current one is on top.
  const checkOrder = () => {
    const names = layered(), idx = names.map((n) => order.indexOf(n));
    for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1], `older picture ${names[i]} above ${names[i - 1]} (bottom to top: ${names.join(',')})`);
    if (p.current && names.length && p.current.holder.parent) assert.equal(names[names.length - 1], p.current.texture.name);
  };
  const step = (ms, each) => { assert.ok(Number.isFinite(ms), `step(${ms})`); for (let t = 0; t < ms; t += FRAME) { p.update(FRAME); if (each) each(); } };
  const stepUntil = (done, max = 20000, each) => {
    for (let t = 0; !done(); t += FRAME) {
      assert.ok(t < max, 'never reached the expected moment');
      p.update(FRAME); if (each) each();
    }
  };
  const cueNames = () => cues.map((c) => c.name).filter((n) => !n.startsWith('head-'));
  const phase = () => p.waiting && p.waiting.phase;
  return { PIXI, made, stage, root, p, shown, retired, textures, cues, blurs, cueNames, phase, show: showInOrder, step, stepUntil, checkOrder, layered };
}

const canvasTextures = (made) => made.textures.filter((t) => t.fromCanvas);
const once = (list) => [...list].sort();
// A live object masked by a destroyed Graphics crashes PIXI 4's mask manager on the next render.
const momentsFor = (fx) => Object.keys(MOMENTS).filter((m) => m !== 'glance' || fx.lookUp);
const deadMasks = (made) => made.containers.filter((c) => !c._destroyed && c.mask && c.mask._destroyed);
const allGraphicsGone = (made) => made.graphics.filter((g) => !g._destroyed).length === 0;

// Moments of the opening at which a newer picture may arrive (or the presenter may be torn down).
// 'glance' only happens with Look up.
const MOMENTS = {
  lookIn: (s) => { s.step(200); assert.equal(s.phase(), 'lookIn'); },
  glance: (s) => { s.stepUntil(() => s.phase() === 'glance'); s.step(T.lookUp / 2); assert.equal(s.phase(), 'glance'); },
  search: (s) => { s.stepUntil(() => s.phase() === 'search'); s.step(300); },
  acquire: (s) => { s.stepUntil(() => s.phase() === 'acquire'); s.step(T.acquire / 2); },
  focus: (s) => { s.stepUntil(() => s.phase() === 'focus'); s.step(T.focus / 2); },
  reveal: (s) => { s.stepUntil(() => s.cueNames().includes('reveal')); s.step(100); },   // before the caption (150 ms without the iris)
};

for (const fx of CONFIGS) {
  for (const waited of [false, true]) {
    for (const moment of momentsFor(fx)) {
      const reach = MOMENTS[moment];
      test(`presenter (${label(fx)}${waited ? ', after wait()' : ''}): a picture replaced mid-opening (${moment}) never shows, never lands above the newer one, leaks nothing`, () => {
        const s = setup(fx);
        if (waited) { s.p.wait(); s.step(300); }   // still looking in: lookIn (200 ms more) stays inside T.lookIn
        s.show('A');
        reach(s);
        s.checkOrder();
        s.show('B');
        s.step(7000, () => { s.checkOrder(); assert.deepEqual(deadMasks(s.made), [], 'a picture masked by a destroyed lens'); });
        assert.deepEqual(s.shown, ['B']);
        assert.deepEqual(s.retired, ['A']);
        assert.deepEqual(s.layered(), ['B']);
        assert.equal(s.p.waiting, null);
        assert.equal(s.p.layers.fx.children.length, 0, 'eyepiece, lens and effects are gone');
        assert.ok(allGraphicsGone(s.made), 'every Graphics destroyed');
        assert.ok(s.blurs.every((t) => t.destroyed === 1), 'focus-pull textures destroyed once');
        assert.equal(s.textures.A.destroyed, 0, 'the presenter never destroys a picture texture');
      });
    }
  }

  test(`presenter (${label(fx)}): a picture replaced mid-cross-fade never fires onShown nor brings its caption back`, () => {
    const s = setup(fx);
    s.show('A');
    s.step(OPEN, s.checkOrder);
    assert.deepEqual(s.shown, ['A']);
    s.show('B');
    s.step(300, s.checkOrder);
    s.show('C');
    // Until C's own caption is due the caption stays on its way out.
    s.step(T.cross * 0.6 - 32, () => { s.checkOrder(); assert.equal(s.p.caption.target, 0, 'caption faded back in for a replaced picture'); });
    s.step(4000, s.checkOrder);
    assert.deepEqual(s.shown, ['A', 'C']);
    assert.deepEqual(s.retired, ['A', 'B']);
    assert.equal(s.p.caption.target, 1);
    assert.equal(s.p.caption.title.text, 'Picture C');
  });

  test(`presenter (${label(fx)}): the opening runs through to onShown exactly once, leaving only the picture`, () => {
    const s = setup(fx);
    s.show('A');
    s.step(OPEN);
    assert.deepEqual(s.shown, ['A']);
    assert.equal(s.p.waiting, null);
    assert.deepEqual(s.layered(), ['A']);
    assert.equal(s.p.current.holder.mask, null);
    assert.equal(s.p.current.holder.alpha, 1);
    assert.equal(s.p.current.blur, null);
    assert.ok(s.blurs.length >= 2, 'focus-pull overlays');
    assert.ok(s.blurs.every((t) => t.destroyed === 1), 'dropped at the reveal');
    s.step(5000);
    assert.equal(s.p.layers.fx.children.length, 0);
    assert.ok(allGraphicsGone(s.made));
    assert.deepEqual(s.shown, ['A']);
  });

  test(`presenter (${label(fx)}): onRetire hands back every texture exactly once, also through destroy()`, () => {
    const s = setup(fx);
    s.show('A');
    s.step(OPEN);
    s.show('B');
    s.step(300);
    s.show('C');                     // B is still fading in, A still under it
    s.step(100);
    s.p.destroy();
    assert.deepEqual(once(s.retired), ['A', 'B', 'C']);
    assert.ok(Object.values(s.textures).every((t) => t.destroyed === 0));
    assert.ok(canvasTextures(s.made).length >= 3, 'caption gradient and two focus-pull overlays at least');
    assert.ok(canvasTextures(s.made).every((t) => t.destroyed === 1), 'backdrops, focus-pull overlays and caption gradient destroyed once');
    assert.ok(allGraphicsGone(s.made));
    assert.equal(s.root.children.length, 0);
    s.p.update(16); s.p.destroy();   // harmless afterwards
    assert.deepEqual(once(s.retired), ['A', 'B', 'C']);
  });

  for (const moment of ['lookIn', 'glance', 'search', 'focus', 'reveal'].filter((m) => momentsFor(fx).includes(m))) {
    test(`presenter (${label(fx)}): destroy() after the SDK destroyed the stage (${moment}) does not throw and still retires`, () => {
      for (const replaced of [true, false]) {
        const s = setup(fx);
        s.show('A');
        MOMENTS[moment](s);
        if (replaced) { s.show('B'); s.step(200); }   // mid cross-fade: next() warp running
        s.stage.destroy({ children: true });
        assert.doesNotThrow(() => s.p.destroy());
        assert.deepEqual(once(s.retired), replaced ? ['A', 'B'] : ['A']);
        assert.ok(canvasTextures(s.made).every((t) => t.destroyed === 1), 'backdrops, focus-pull overlays and caption gradient destroyed once');
        assert.ok(Object.values(s.textures).every((t) => t.destroyed === 0));
      }
    });
  }
}

test('presenter: destroy() while waiting or before the reveal', () => {
  const a = setup({ lookUp: true, starfield: true });
  a.p.wait();
  a.step(300);
  assert.doesNotThrow(() => a.p.destroy());
  assert.ok(allGraphicsGone(a.made), 'eyepiece destroyed');
  assert.deepEqual(a.retired, []);

  const searching = setup({ iris: true });
  searching.p.wait();
  searching.stepUntil(() => searching.phase() === 'search');
  searching.step(1000);
  searching.p.destroy();
  assert.ok(allGraphicsGone(searching.made), 'eyepiece destroyed');
  assert.equal(searching.root.children.length, 0);
  searching.p.wait();               // nothing comes back after destroy()
  searching.p.update(16);
  assert.equal(searching.made.graphics.filter((g) => !g._destroyed).length, 0);

  const b = setup({ lookUp: true, starfield: true });
  b.p.wait();
  b.show('A');
  b.step(100);
  b.p.destroy();
  assert.deepEqual(b.retired, ['A']);
  assert.deepEqual(b.shown, []);
  assert.ok(allGraphicsGone(b.made));

  for (const fx of [{}, { iris: true, kenBurns: true }]) {
    const c = setup(fx);
    c.show('A');
    MOMENTS.focus(c);
    const levels = c.p.current.blur.length;
    assert.ok(levels >= 2);
    c.p.destroy();
    assert.deepEqual(c.retired, ['A']);
    assert.deepEqual(c.shown, []);
    assert.ok(allGraphicsGone(c.made), 'eyepiece and lens destroyed');
    assert.equal(c.blurs.length, levels);
    assert.ok(canvasTextures(c.made).every((t) => t.destroyed === 1), 'focus-pull overlays destroyed once');
  }
});

test('presenter: a covered or switched-off caption still reports onShown once', () => {
  const s = setup({ starfield: true }, { showCaption: false });
  s.show('A');
  s.step(OPEN);
  s.p.cover(true);
  s.show('B');
  s.step(3000);
  assert.deepEqual(s.shown, ['A', 'B']);
  assert.equal(s.p.caption.target, 0);
});

test('presenter: the opening cues look, search, (move…), found, reveal in that order, once each', () => {
  for (const fx of [{}, { lookUp: true, iris: true, starfield: true }]) {
    const s = setup(fx);
    s.p.wait();
    s.stepUntil(() => s.phase() === 'search');
    s.step(9000);                   // a slow download: it keeps searching and turns round
    assert.equal(s.phase(), 'search');
    s.show('A');
    s.step(OPEN);
    const names = s.cueNames();
    assert.match(names.join(','), /^look,search,(move,)+found,reveal$/, names.join(','));
    // A creak as each glide starts: a glide takes at least 900 ms and the pause after it 350 ms.
    const moves = s.cues.filter((c) => c.name === 'move').map((c) => c.at);
    assert.ok(moves.length >= 3, `keeps looking around (${moves.length} moves)`);
    for (let i = 1; i < moves.length; i++) assert.ok(moves[i] - moves[i - 1] >= 1250 - FRAME, `moves ${moves[i - 1]} and ${moves[i]}`);
    assert.ok(!names.some((n) => /eye/.test(n)), 'no eye cue');
    const at = (name) => s.cues.find((c) => c.name === name).at;
    assert.equal(at('look'), 0, 'the eyepiece looks in at once');
    if (fx.lookUp) {
      const all = s.cues.map((c) => c.name);
      assert.ok(all.indexOf('look') < all.indexOf('head-up') && all.indexOf('head-up') < all.indexOf('head-centre') && all.indexOf('head-centre') < all.indexOf('search'), all.join(','));
      assert.ok(at('search') >= T.lookIn + T.lookUp, 'searches after looking in and the glance');
      assert.ok(at('search') < T.lookIn + T.lookUp + 3 * FRAME, 'and straight after');
    } else {
      assert.ok(!s.cues.some((c) => c.name.startsWith('head-')), 'no head moves without Look up');
      assert.ok(at('search') >= T.lookIn && at('search') < T.lookIn + 3 * FRAME, 'searches straight after looking in');
    }
    assert.deepEqual(s.shown, ['A']);
  }
});

test('presenter: a picture that is ready at once still searches for T.minSearch before it is found', () => {
  for (const fx of [{}, { lookUp: true }, { iris: true }]) {
    const s = setup(fx);
    s.show('A');                    // no wait(): show() starts the eyepiece itself
    assert.ok(s.p.waiting, 'show() starts the opening');
    assert.equal(s.p.waiting.ready, s.p.current);
    s.stepUntil(() => s.cueNames().includes('found'));
    const at = (name) => s.cues.find((c) => c.name === name).at;
    // The search counts the frame it starts in, so 'found' may come one frame before T.minSearch.
    assert.ok(at('found') - at('search') >= T.minSearch - FRAME, `searched only ${at('found') - at('search')} ms`);
    assert.ok(at('found') - at('search') < T.minSearch + 100, 'but not much longer');
    s.stepUntil(() => s.cueNames().includes('reveal'));
    assert.ok(at('reveal') - at('found') >= T.acquire + T.focus, 'centres, then pulls focus');
    s.step(OPEN);
    assert.match(s.cueNames().join(','), /^look,search,(move,)*found,reveal$/);
    assert.deepEqual(s.shown, ['A']);
  }
});

test('presenter: progress() only goes up and lights the dial ticks', () => {
  const s = setup({});
  s.p.progress(0.5);                // before wait(): nothing to light, no throw
  s.p.wait();
  s.p.progress(0.4);                // still looking in: the eyepiece is there at once
  const e = s.p.waiting.eyepiece, lines = () => e.lit.graphicsData.filter((d) => d === 'line').length;
  assert.equal(e.progress, 0.4);
  s.stepUntil(() => s.phase() === 'search');
  s.step(2500);
  assert.equal(e.shownProgress, 0.4, 'the lit ticks catch up');
  assert.equal(lines(), 24, '40% of the 60 ticks');
  s.p.progress(0.2);                // never back
  s.step(500);
  assert.equal(s.p.waiting.progress, 0.4);
  assert.equal(e.progress, 0.4);
  assert.equal(lines(), 24);
  s.p.progress(0.75);
  let last = e.shownProgress;
  s.step(3000, () => { assert.ok(e.shownProgress >= last, 'shown progress never drops'); last = e.shownProgress; });
  assert.equal(e.shownProgress, 0.75);
  assert.equal(lines(), 45);
  s.p.progress(7);                  // clamped
  s.step(3000);
  assert.equal(e.progress, 1);
  assert.equal(lines(), 60);
  s.show('A');
  s.step(OPEN);
  assert.doesNotThrow(() => s.p.progress(0.9));   // after the opening: ignored
  assert.equal(s.p.waiting, null);
});

test('presenter: found lights the whole dial even when progress never came', () => {
  const s = setup({});
  s.show('A');
  s.stepUntil(() => s.phase() === 'focus');
  assert.equal(s.p.waiting.eyepiece.progress, 1);
});

test('presenter: without the iris the picture fades in full screen, unmasked, and the eyepiece fades away', () => {
  for (const fx of [{}, { starfield: true, kenBurns: true }]) {
    const s = setup(fx);
    s.show('A');
    s.stepUntil(() => s.phase() === 'focus');
    const entry = s.p.current, e = s.p.waiting.eyepiece;
    assert.equal(entry.holder.parent, s.p.layers.pic);
    const levels = entry.blur.slice(), gone = levels.map(() => -1);
    assert.ok(levels.length >= 2, 'blurred levels');
    let alpha = entry.holder.alpha, eyeAlpha = e.c.alpha, t = 0;
    assert.ok(alpha < 0.05, 'from black');
    s.stepUntil(() => s.cueNames().includes('reveal'), 5000, () => {
      t += 16;
      levels.forEach((b, i) => { if (gone[i] < 0 && b.sprite.alpha === 0) gone[i] = t; });   // the last one clears on the reveal frame
      if (s.cueNames().includes('reveal')) return;
      assert.equal(entry.holder.mask, null, 'no lens without the iris');
      assert.ok(entry.holder.alpha >= alpha && e.c.alpha <= eyeAlpha);
      alpha = entry.holder.alpha; eyeAlpha = e.c.alpha;
    });
    assert.equal(alpha, 1, 'in full before the reveal');
    assert.ok(gone[0] > 0 && gone.every((g, i) => i === 0 || g > gone[i - 1]), `the blur sharpens in turn, most blurred first (${gone})`);
    assert.equal(entry.blur, null);
    assert.ok(levels.every((b) => b.sprite._destroyed && b.texture.destroyed === 1));
    s.step(OPEN);
    assert.equal(entry.holder.mask, null);
    assert.equal(entry.holder.alpha, 1);
    assert.equal(s.p.layers.fx.children.length, 0);
    assert.ok(allGraphicsGone(s.made), 'no eyepiece or lens left');
    assert.deepEqual(s.shown, ['A']);
  }
});

test('presenter: with the iris the picture is masked by the lens during the focus pull and unmasked after the reveal', () => {
  const s = setup({ iris: true });
  s.show('A');
  s.stepUntil(() => s.phase() === 'focus');
  const entry = s.p.current, e = s.p.waiting.eyepiece, lens = entry.holder.mask;
  assert.ok(lens && !lens._destroyed, 'masked by the lens');
  assert.equal(lens.parent, s.p.layers.fx);
  assert.equal(entry.holder.alpha, 1);
  let sky = e.sky.alpha;
  s.stepUntil(() => s.cueNames().includes('reveal'), 5000, () => {
    if (s.cueNames().includes('reveal')) return;
    assert.equal(entry.holder.mask, lens);
    assert.ok(e.sky.alpha <= sky, 'the black inside the lens fades');
    sky = e.sky.alpha;
  });
  assert.equal(sky, 0);
  assert.ok(lens._destroyed, 'lens gone at the reveal');
  assert.ok(entry.holder.mask && entry.holder.mask !== lens && !entry.holder.mask._destroyed, 'the iris takes over');
  s.step(T.iris + 100);
  assert.equal(entry.holder.mask, null, 'unmasked once the iris is open');
  s.step(OPEN);
  assert.equal(s.p.layers.fx.children.length, 0);
  assert.ok(allGraphicsGone(s.made));
  assert.deepEqual(deadMasks(s.made), []);
  assert.deepEqual(s.shown, ['A']);
});

test('presenter: the focus-pull overlays lie over the sharp picture, most blurred on top, made with canvas blur() when there is one', () => {
  for (const filter of [false, true]) {
    const doc = createDocument({ filter });
    const s = setup({ kenBurns: true }, { document: doc });
    s.show('A');
    s.stepUntil(() => s.phase() === 'focus');
    const entry = s.p.current, kids = entry.holder.children;
    assert.ok(entry.blur.length >= 2);
    assert.ok(kids.indexOf(entry.sprite) < kids.indexOf(entry.blur[entry.blur.length - 1].sprite), 'over the sharp sprite');
    assert.equal(kids[kids.length - 1], entry.blur[0].sprite, 'the most blurred one on top');
    for (let i = 1; i < entry.blur.length; i++) assert.ok(kids.indexOf(entry.blur[i].sprite) < kids.indexOf(entry.blur[i - 1].sprite));
    if (filter) assert.ok(doc.ctx.filters.filter((f) => /^blur\(/.test(f)).length >= entry.blur.length, `drawn with blur(): ${doc.ctx.filters}`);
    s.step(T.focus / 2);
    for (const b of entry.blur) {                // they follow the moving (Ken Burns) sprite
      assert.deepEqual([b.sprite.position.x, b.sprite.position.y], [entry.sprite.position.x, entry.sprite.position.y]);
      assert.ok(Math.abs(b.sprite.scale.x * b.width - entry.sprite.scale.x * entry.texture.width) < 1e-6);
    }
    s.step(OPEN);
    assert.equal(entry.blur, null);
    assert.ok(s.blurs.length >= 2 && s.blurs.every((t) => t.destroyed === 1));
    assert.deepEqual(s.shown, ['A']);
  }
});

test('presenter: the eyepiece is there at once, fully visible, settles in and (without Look up) goes straight to searching', () => {
  for (const start of ['wait', 'show']) {
    const s = setup({});
    if (start === 'wait') s.p.wait(); else s.show('A');
    const w = s.p.waiting, e = w.eyepiece;
    assert.ok(e && e.c && !e.c._destroyed, 'the eyepiece is made by wait() itself');
    assert.ok(!w.eye, 'no white eye');
    assert.deepEqual(s.p.layers.fx.children, [e.c], 'nothing but the eyepiece');
    assert.equal(e.r, LENS_R);
    assert.equal(e.c.alpha, 1, 'visible from the start, no fade from black');
    assert.equal(s.phase(), 'lookIn');
    assert.deepEqual(s.cueNames(), ['look']);
    let scale = Infinity;
    s.stepUntil(() => s.phase() !== 'lookIn', 2000, () => {
      assert.equal(e.c.alpha, 1);
      assert.ok(e.c.scale.x <= scale && e.c.scale.x >= 1 && e.c.scale.x <= 1.06, `scale ${e.c.scale.x}`);
      scale = e.c.scale.x;
    });
    assert.equal(e.c.scale.x, 1, 'settled');
    assert.equal(s.phase(), 'search', 'no glance without Look up');
    assert.deepEqual(s.cueNames(), ['look', 'search']);
    assert.ok(Math.abs(s.p.now - T.lookIn) < FRAME);
  }
});

test('presenter: with Look up the eyepiece rises to the sky band while Jibo tilts his head, stays up and searches there', () => {
  const s = setup({ lookUp: true });
  s.p.wait();
  const e = s.p.waiting.eyepiece, cy = 360;
  assert.equal(e.c.alpha, 1, 'visible from the first frame');
  s.p.update(FRAME);
  assert.equal(e.c.alpha, 1);
  s.stepUntil(() => s.phase() === 'glance');
  assert.ok(Math.abs(s.p.now - T.lookIn) < FRAME, `glances once it has looked in (${s.p.now})`);
  assert.equal(s.p.waiting.path, null, 'no search path before the search');
  let minDy = 0, top = Infinity, arrived = -1, stretched = false;
  const heads = () => s.cues.filter((c) => c.name.startsWith('head-')).map((c) => c.name);
  s.stepUntil(() => s.phase() !== 'glance', 3000, () => {
    if (s.phase() !== 'glance') return;
    assert.equal(e.c.alpha, 1);
    assert.equal(s.p.waiting.path, null);
    assert.ok(e.dy <= TOL, `never below the centre (dy ${e.dy})`);
    if (arrived < 0 && e.dy <= SKY_Y + TOL) arrived = s.p.now;
    if (arrived >= 0) assert.ok(e.dy <= SKY_Y + TOL, `up there it never sinks back towards the centre (dy ${e.dy})`);
    if (e.c.scale.x < 1 && e.c.scale.y > 1) stretched = true;
    assert.ok(e.c.scale.x >= 1 - 0.06 - TOL && e.c.scale.y <= 1 + 0.08 + TOL, `a small stretch (${e.c.scale.x}, ${e.c.scale.y})`);
    minDy = Math.min(minDy, e.dy); top = Math.min(top, e.c.position.y);
  });
  assert.ok(arrived >= 0 && arrived <= T.lookIn + 0.7 * T.lookUp + FRAME, `up by 70% of the glance (${arrived})`);
  assert.ok(minDy <= SKY_Y + TOL, `rises to the sky band (dy ${minDy})`);
  assert.ok(top < cy + SKY_Y + TOL, 'the eyepiece itself moves up');
  assert.ok(stretched, 'it stretches as it moves');
  assert.deepEqual(heads(), ['head-up', 'head-centre'], 'onLookUp hears up, then centre');
  const at = (name) => s.cues.find((c) => c.name === name).at;
  assert.ok(at('head-up') >= T.lookIn && at('head-up') < T.lookIn + 2 * FRAME, 'the head tilts as the glance starts');
  assert.ok(at('head-centre') >= T.lookIn + 0.6 * T.lookUp - FRAME && at('head-centre') < at('search'));
  assert.equal(s.phase(), 'search');
  assert.ok(Math.abs(e.dy - SKY_Y) < TOL && Math.abs(e.dx) < TOL, `stays up (${e.dx}, ${e.dy})`);
  assert.ok(e.c.scale.x === 1 && e.c.scale.y === 1, 'unstretched');
  const path = s.p.waiting.path;
  assert.ok(path, 'searching makes its path');
  assert.ok(Math.abs(path.from.dy - SKY_Y) < TOL && Math.abs(path.from.dx) < TOL, 'the search starts where the glance left it');
  assert.deepEqual([path.ax, path.ay, path.cy], [SEARCH.ax, SEARCH.ay, SKY_Y]);
  assert.deepEqual(s.cueNames(), ['look', 'search']);
  // It searches up there, never back down to the centre.
  s.step(5000, () => assert.ok(e.dy <= SKY_Y + SEARCH.ay + TOL, `below the band (dy ${e.dy})`));
  assert.deepEqual(heads(), ['head-up', 'head-centre'], 'the head moves once');
});

test('presenter: without Look up the first glide takes the eyepiece from the centre up into the sky band', () => {
  const s = setup({});
  s.p.wait();
  s.stepUntil(() => s.phase() === 'search');
  const w = s.p.waiting, e = w.eyepiece, path = w.path;
  assert.deepEqual(path.from, { dx: 0, dy: 0 }, 'it sets off from the centre');
  assert.deepEqual([path.ax, path.ay, path.cy], [SEARCH.ax, SEARCH.ay, SKY_Y]);
  path.at(0);
  const first = path.segs[0];
  assert.ok(Math.abs(first.to.dy - SKY_Y) <= SEARCH.ay + TOL, `into the band (${first.to.dy})`);
  let dy = e.dy;
  s.stepUntil(() => w.searchT >= first.t1, 5000, () => {
    assert.ok(e.dy <= dy + TOL, `only goes up on the way (${dy} -> ${e.dy})`);
    dy = e.dy;
  });
  assert.ok(Math.abs(e.dy - SKY_Y) <= SEARCH.ay + TOL, `in the band (${e.dy})`);
  s.step(15000, () => assert.ok(e.dy <= SKY_Y + SEARCH.ay + TOL && Math.abs(e.dy - SKY_Y) <= SEARCH.ay + TOL, `left the band (dy ${e.dy})`));
});

test('presenter: while searching the eyepiece glides between spots in the sky band, a creak per glide', () => {
  for (const fx of [{ lookUp: true }, {}]) {
    const s = setup(fx);
    s.p.wait();
    s.stepUntil(() => s.phase() === 'search');
    const w = s.p.waiting, e = w.eyepiece, path = w.path;
    path.at(0);
    const settled = fx.lookUp ? 0 : path.segs[0].t1;   // without Look up: once the first glide is up
    let prev = { dx: e.dx, dy: e.dy }, still = 0;
    s.step(15000, () => {
      if (w.searchT >= settled) {
        assert.ok(Math.abs(e.dx) <= SEARCH.ax + TOL, `within ±${SEARCH.ax} sideways (${e.dx})`);
        assert.ok(Math.abs(e.dy - SKY_Y) <= SEARCH.ay + TOL, `within ${SKY_Y}±${SEARCH.ay} (${e.dy})`);
      }
      assert.ok(e.dy <= TOL, `never below the centre (${e.dy})`);
      assert.ok(Math.hypot(e.dx - prev.dx, e.dy - prev.dy) <= 3 * FRAME / 2.2 + TOL, 'glides, never jumps');
      if (e.dx === prev.dx && e.dy === prev.dy) still++;
      prev = { dx: e.dx, dy: e.dy };
    });
    assert.ok(still > 20, 'pauses between glides');
    const moves = s.cueNames().filter((n) => n === 'move').length;
    assert.equal(moves, w.lastMove, 'a creak for every glide after the first');
    assert.equal(path.at(w.searchT).move, w.lastMove);
    assert.ok(moves >= 5, `${moves} glides in 15 s`);
  }
});

test('presenter: once the picture is in, the eyepiece glides to the middle of the sky band, not the centre', () => {
  for (const fx of [{}, { lookUp: true, iris: true }]) {
    const s = setup(fx);
    s.p.wait();
    s.stepUntil(() => s.phase() === 'search');
    s.step(2500);
    const e = s.p.waiting.eyepiece;
    s.show('A');
    s.stepUntil(() => s.phase() === 'acquire');
    s.stepUntil(() => s.phase() !== 'acquire', 3000, () => {
      assert.ok(e.dy <= SKY_Y + SEARCH.ay + TOL, `stays up while it centres (dy ${e.dy})`);
    });
    assert.equal(s.phase(), 'focus');
    assert.ok(Math.abs(e.dx) < TOL && Math.abs(e.dy - SKY_Y) < TOL, `at (0, ${SKY_Y}): (${e.dx}, ${e.dy})`);
    assert.deepEqual([e.c.position.x, e.c.position.y], [CX, SKY_CY]);
  }
});

test('presenter: the lens is the eyepiece\'s size everywhere: eyepiece, focus-pull lens and iris', () => {
  const s = setup({ iris: true });
  s.show('A');
  const e = s.p.waiting.eyepiece;
  assert.equal(e.r, LENS_R);
  assert.deepEqual(e.lensMask.circles.map((c) => c.r), [LENS_R], 'the stars are masked by the lens');
  s.stepUntil(() => s.phase() === 'focus');
  const lens = s.p.current.holder.mask;
  assert.deepEqual(lens.circles, [{ x: CX, y: SKY_CY, r: LENS_R }], 'the lens sits where the eyepiece is, up in the sky band');
  s.stepUntil(() => s.cueNames().includes('reveal'));
  const iris = s.p.anims.find((a) => a.mask && a.from !== undefined);
  assert.ok(iris, 'the iris runs');
  assert.equal(iris.from, LENS_R);
  assert.equal(s.p.current.holder.mask, iris.mask);
  const r0 = iris.mask.circles[0].r;
  assert.ok(r0 <= LENS_R && r0 > LENS_R * 0.85, `opens from the lens (${r0})`);
});

test('presenter: the iris and the starfield warp open from the eyepiece up in the sky band', () => {
  const s = setup({ iris: true, starfield: true, lookUp: true });
  s.show('A');
  s.stepUntil(() => s.cueNames().includes('reveal'));
  const iris = s.p.anims.find((a) => a.mask && a.from !== undefined);
  const warp = s.p.anims.find((a) => a.g && a !== iris && a.cx !== undefined);
  assert.ok(iris && warp, 'iris and warp run');
  assert.deepEqual([iris.cx, iris.cy], [CX, SKY_CY]);
  assert.deepEqual([iris.mask.circles[0].x, iris.mask.circles[0].y], [CX, SKY_CY]);
  assert.deepEqual([warp.cx, warp.cy], [CX, SKY_CY]);
  s.step(OPEN);
  assert.deepEqual(s.shown, ['A']);
});
