import test from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';
import { createPixi, createDocument, picture } from './pixi-stub.mjs';

globalThis.document = createDocument();   // caption.js paints its gradient on a global canvas
const Presenter = lib('presenter.js');
const T = Presenter.TIMING;

const CONFIGS = [
  {},
  { iris: true },
  { kenBurns: true },
  { lookUp: true },                  // reveal at 950 ms: inside a cross-fade that started before it
  { lookUp: true, starfield: true },
  { lookUp: true, starfield: true, iris: true, kenBurns: true },
];
const label = (fx) => Object.keys(fx).join('+') || 'none';

function setup(effects, opts = {}) {
  const { PIXI, made } = createPixi();
  const stage = new PIXI.Container(), root = new PIXI.Container();
  stage.addChild(root);
  const shown = [], retired = [], textures = {};
  const p = new Presenter(PIXI, root, Object.assign({
    view: { w: 1280, h: 720 }, effects, seed: 7, document: createDocument(),
    onShown: (tex) => shown.push(tex.name),
    onRetire: (tex) => retired.push(tex.name),
  }, opts));
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
  const step = (ms, each) => { for (let t = 0; t < ms; t += 16) { p.update(16); if (each) each(); } };
  return { PIXI, made, stage, root, p, shown, retired, textures, show: showInOrder, step, checkOrder, layered };
}

const canvasTextures = (made) => made.textures.filter((t) => t.fromCanvas);
const once = (list) => [...list].sort();

for (const fx of CONFIGS) {
  for (const waited of [false, true]) {
    test(`presenter (${label(fx)}${waited ? ', after wait()' : ''}): a picture replaced mid-intro never shows, never lands above the newer one, leaks nothing`, () => {
      const s = setup(fx);
      if (waited) { s.p.wait(); s.step(500); }
      s.show('A');
      s.step(200, s.checkOrder);
      s.show('B');
      s.step(7000, s.checkOrder);
      assert.deepEqual(s.shown, ['B']);
      assert.deepEqual(s.retired, ['A']);
      assert.deepEqual(s.layered(), ['B']);
      assert.equal(s.p.layers.fx.children.length, 0, 'eye, ring and effects are gone');
      assert.ok(s.made.graphics.every((g) => g._destroyed), 'every Graphics destroyed');
      assert.equal(s.textures.A.destroyed, 0, 'the presenter never destroys a picture texture');
    });
  }

  test(`presenter (${label(fx)}): a picture replaced mid-cross-fade never fires onShown nor brings its caption back`, () => {
    const s = setup(fx);
    s.show('A');
    s.step(4000, s.checkOrder);
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

  test(`presenter (${label(fx)}): onRetire hands back every texture exactly once, also through destroy()`, () => {
    const s = setup(fx);
    s.show('A');
    s.step(4000);
    s.show('B');
    s.step(300);
    s.show('C');                     // B is still fading in, A still under it
    s.step(100);
    s.p.destroy();
    assert.deepEqual(once(s.retired), ['A', 'B', 'C']);
    assert.ok(Object.values(s.textures).every((t) => t.destroyed === 0));
    assert.ok(canvasTextures(s.made).length >= 1);
    assert.ok(canvasTextures(s.made).every((t) => t.destroyed === 1), 'backdrops and caption gradient destroyed once');
    assert.ok(s.made.graphics.every((g) => g._destroyed));
    assert.equal(s.root.children.length, 0);
    s.p.update(16); s.p.destroy();   // harmless afterwards
    assert.deepEqual(once(s.retired), ['A', 'B', 'C']);
  });

  test(`presenter (${label(fx)}): destroy() after the SDK destroyed the stage does not throw and still retires`, () => {
    const s = setup(fx);
    s.show('A');
    s.step(2000);                    // mid intro: iris, warp, eye fade or look-up still running
    s.show('B');
    s.step(200);                     // mid cross-fade: next() warp running
    s.stage.destroy({ children: true });
    assert.doesNotThrow(() => s.p.destroy());
    assert.deepEqual(once(s.retired), ['A', 'B']);
    assert.ok(canvasTextures(s.made).every((t) => t.destroyed === 1), 'backdrops and caption gradient destroyed once');
  });
}

test('presenter: destroy() while waiting or before the intro reveal', () => {
  const a = setup({ lookUp: true, starfield: true });
  a.p.wait();
  a.step(300);
  assert.doesNotThrow(() => a.p.destroy());
  assert.ok(a.made.graphics.every((g) => g._destroyed), 'eye and ring destroyed');
  assert.deepEqual(a.retired, []);

  const b = setup({ lookUp: true, starfield: true });
  b.p.wait();
  b.show('A');
  b.step(100);
  b.p.destroy();
  assert.deepEqual(b.retired, ['A']);
  assert.deepEqual(b.shown, []);
  assert.ok(b.made.graphics.every((g) => g._destroyed));
});

test('presenter: a covered or switched-off caption still reports onShown once', () => {
  const s = setup({ starfield: true }, { showCaption: false });
  s.show('A');
  s.step(3000);
  s.p.cover(true);
  s.show('B');
  s.step(3000);
  assert.deepEqual(s.shown, ['A', 'B']);
  assert.equal(s.p.caption.target, 0);
});
