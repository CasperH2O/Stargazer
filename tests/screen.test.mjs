// The screen's lifecycle against a fake SDK: open -> load -> show -> close -> reopen, with the
// view callbacks fired late, failing, or never. The picture work (Presenter, Images, Catalog) is
// stubbed; their own tests cover them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';
const createScreen = lib('screen.js'), S = lib('settings.js');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle() { for (let i = 0; i < 10; i++) await tick(); }

class Node { constructor() { this.children = []; this.parent = null; this.position = { set() {} }; this.visible = true; }
  addChild(c) { c.parent = this; this.children.push(c); return c; } addChildAt(c) { return this.addChild(c); }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parent = null; } destroy() { this._destroyed = true; } }
class Graphics extends Node { beginFill() {} drawRect() {} endFill() {} }
class Sprite extends Node { constructor(texture) { super(); this.texture = texture; } }
global.PIXI = { Container: Node, Graphics, Sprite, Texture: { EMPTY: {} } };

function fakeSdk() {
  const calls = [];
  const views = {
    calls, currentView: null, viewStackLength: 1, created: 0,
    ActionData: { CALLBACK: 'cb' }, GESTURE: { SWIPE_DOWN: 'sd', TAP: 'tap', PAN: 'pan' }, TRANSITION: { IN: 'in', OUT: 'out' },
    STATE: { DESTROYED: 'destroyed' }, _viewProcess: { active: false, processQueue: [] }, ComponentGroup: { prototype: { destroy() {} } },
    createView() {
      views.created++;
      return { state: 'created', stage: null, viewStateStacked: false, addAction() {}, clearActions() {}, getComponentById() { return null; } };
    },
    changeView(options, onComplete, onFailure, onLoaded) { calls.push({ options, onComplete, onFailure, onLoaded }); }
  };
  return { face: { views, tween: { stop() {} } }, tts: null };
}
// Fire the add's callbacks the way the SDK does: loaded (stage ready), then complete.
function load(jibo, call) { const v = call.options.addView; v.stage = new Node(); v.state = 'loaded'; jibo.face.views.currentView = v; call.onLoaded(); }
function complete(call) { call.options.addView.state = 'opened'; call.onComplete(); }

function harness(over = {}) {
  const jibo = fakeSdk(), log = [];
  const presenters = [];
  class Presenter {
    constructor(PIXI, root, opts) { this.opts = opts; this.shows = []; this.updates = 0; presenters.push(this); }
    wait() {} configure() {} cover() {} progress(p) { this.lastProgress = p; }
    show(texture, info) { this.shows.push({ texture, info }); this.opts.onShown(); }
    update() { this.updates++; if (over.updateThrows && this.updates <= over.updateThrows) throw new Error('boom'); }
    destroy() { this.destroyed = true; }
  }
  class Images {
    constructor() { this.live = {}; this.closed = false; }
    load(item) { return over.imageLoad ? over.imageLoad(item) : Promise.resolve({ key: item.key, texture: { key: item.key } }); }
    keep() {} release() {} count() { return 0; } close() { this.closed = true; }
  }
  const lists = over.lists || { a: [{ key: 'a1', source: 'a', title: 'A one' }] };
  const orders = [];
  class Catalog {
    order(ids, seen, history, random, avoid) { orders.push(avoid || null); return over.order || Object.keys(lists).filter((id) => id !== avoid).concat(avoid ? [avoid] : []); }
    list(id) { const l = lists[id]; return l instanceof Error ? Promise.reject(l) : Promise.resolve(l); }
    resolve(item) { return Promise.resolve(item); }
  }
  const store = { read: () => S.clean(over.values), write: (v) => v, seen: () => [], history: () => ({}), markSeen: (l, k) => l.concat([k]), remember: (h, item) => ({ ...h, [item.source]: { key: item.key } }) };
  class BeSkill { constructor() { this.log = { info: (t) => log.push(t), warn: (t) => log.push(t), error: (t) => log.push(t) }; } exit(o) { this.exited = o; } destroy(done) { done(); } }
  const Skill = createScreen(jibo, BeSkill, {
    store, Presenter, Images, Catalog, createArt: () => ({ pill: () => ({}), destroy() {} }), document: {},
    Motion: class { move() {} close() {} }, Sounds: over.Sounds, closeMs: 50, watchdogMs: 20, giveUpMs: 60
  });
  return { jibo, views: jibo.face.views, skill: new Skill(), presenters, log, orders };
}
function close(skill) { return new Promise((resolve) => skill.close((error) => resolve(error))); }

test('a picture that is in before the view has loaded is shown once it loads (no endless loading)', async () => {
  const { jibo, views, skill, presenters } = harness();
  skill.open();
  await settle();                                    // catalog + image resolve at once (cached lists on a reopen)
  assert.equal(presenters.length, 0);                // the view has not loaded yet: nothing to draw on
  assert.equal(skill.model.base, 'loading');
  assert.ok(skill.pending, 'the picture waits instead of being dropped');
  load(jibo, views.calls[0]);
  assert.equal(presenters.length, 1);
  assert.equal(presenters[0].shows.length, 1);
  assert.equal(skill.model.base, 'viewer');
  assert.equal(skill.pending, null);
  complete(views.calls[0]);
  const closing = close(skill); await settle(); views.calls[1].onComplete(); assert.equal(await closing, undefined);
});

test('a close whose remove fails leaves no view behind, and the next open makes a new one', async () => {
  const { jibo, views, skill } = harness();
  skill.open(); await settle(); load(jibo, views.calls[0]); complete(views.calls[0]);
  const closing = close(skill); await settle();
  views.calls[1].onFailure();
  const error = await closing;
  assert.match(String(error), /stargazer_view_close_failed/);   // Be resets the face on an error
  assert.equal(skill.view, null); assert.equal(skill.closing, null); assert.equal(skill.presenter, null);
  views.currentView = null;
  skill.open();
  assert.equal(views.created, 2, 'the second open is not a dead one');
  await settle(); load(jibo, views.calls[2]);
  assert.equal(skill.model.base, 'viewer');
  const again = close(skill); await settle(); views.calls[3].onComplete(); await again;
});

test('a close that never hears back gives up by itself (Be resetting the face drops its callbacks)', async () => {
  const { jibo, views, skill } = harness();
  skill.open(); await settle(); load(jibo, views.calls[0]); complete(views.calls[0]);
  const error = await close(skill);                 // nobody calls the remove's callbacks
  assert.match(String(error), /stargazer_view_close_timeout/);
  assert.equal(skill.view, null); assert.equal(skill.closing, null);
});

test('a hidden view that cannot be cleaned up still clears the view (the open after it works)', async () => {
  const { jibo, views, skill } = harness();
  skill.open(); await settle(); load(jibo, views.calls[0]); complete(views.calls[0]);
  views.currentView = { state: 'opened' };          // "Hey Jibo" on top of ours,
  views._viewProcess.active = true;                 // and its view process still running
  const error = await close(skill);
  assert.match(String(error), /hidden_view_cleanup_unavailable/);
  assert.equal(skill.view, null);
  views._viewProcess.active = false;
  skill.open(); assert.equal(views.created, 2);
  await settle(); load(jibo, views.calls[1]);
  const again = close(skill); await settle(); views.calls[2].onComplete(); await again;
});

test('open while the last close is still running waits for it, then opens', async () => {
  const { jibo, views, skill, log } = harness();
  skill.open(); await settle(); load(jibo, views.calls[0]); complete(views.calls[0]);
  const closing = close(skill); await settle();
  skill.open();
  assert.equal(views.created, 1);
  views.calls[1].onComplete(); await closing; await settle();
  assert.equal(views.created, 2);
  assert.ok(log.some((l) => /while the last close is still running/.test(l)));
  load(jibo, views.calls[2]);
  const again = close(skill); await settle(); views.calls[3].onComplete(); await again;
});

test('a view left over from a failed close is dropped on open', async () => {
  const { jibo, views, skill, log } = harness();
  skill.open(); await settle(); load(jibo, views.calls[0]); complete(views.calls[0]);
  skill.open();                                      // Be opens again without a close (or after a reset)
  assert.equal(views.created, 2);
  assert.ok(log.some((l) => /dropping a view left from the last opening/.test(l)));
  await settle(); load(jibo, views.calls[1]);
  const again = close(skill); await settle(); views.calls[2].onComplete(); await again;
});

test('loading that never finishes is logged and ends on the offline screen', async () => {
  const { jibo, views, skill, log } = harness({ imageLoad: () => new Promise(() => {}) });
  skill.open(); await settle(); load(jibo, views.calls[0]);
  await wait(120);
  assert.ok(log.some((l) => /still loading after/.test(l)));
  assert.equal(skill.model.base, 'offline');
  const again = close(skill); await settle(); views.calls[1].onComplete(); await again;
});

test('one bad frame does not stop the animation loop', async () => {
  const { jibo, views, skill, presenters, log } = harness({ updateThrows: 2 });
  skill.open(); await settle(); load(jibo, views.calls[0]);
  await wait(120);
  assert.ok(presenters[0].updates > 4, 'frames keep coming after the errors');
  assert.equal(log.filter((l) => /frame failed/.test(l)).length, 1);
  const again = close(skill); await settle(); views.calls[1].onComplete(); await again;
});

test('one source per picture: a failing source falls back to another; the slideshow avoids the source just shown', async () => {
  const { jibo, views, skill, presenters, orders } = harness({ order: ['bad', 'b', 'c'], lists: { bad: new Error('down'), b: [{ key: 'b1', source: 'b', title: 'B' }], c: [{ key: 'c1', source: 'c', title: 'C' }] } });
  skill.open(); await settle(); load(jibo, views.calls[0]);
  assert.equal(presenters[0].shows.length, 1);
  assert.equal(skill.current.item.key, 'b1');
  skill.next(); await settle();
  assert.deepEqual(orders, [null, 'b']);
  const again = close(skill); await settle(); views.calls[1].onComplete(); await again;
});

test('the presenter\'s cues play the tripod sounds while "Telescope sounds" is on; search and reveal are silent', async () => {
  for (const on of [true, false]) {
    const made = [];
    class Sounds {
      constructor(jibo) { this.plays = []; this.prepared = 0; this.closed = false; made.push(this); }
      prepare() { this.prepared++; return Promise.resolve(); }
      play(name, volume) { this.plays.push([name, volume]); }
      close() { this.closed = true; }
    }
    const { jibo, views, skill, presenters } = harness({ Sounds, values: { sounds: on } });
    skill.open(); await settle(); load(jibo, views.calls[0]); complete(views.calls[0]);
    assert.equal(made.length, 1);
    assert.equal(made[0].prepared, on ? 1 : 0, 'loaded only when switched on');
    const cue = presenters[0].opts.onCue;
    for (const name of ['look', 'search', 'move', 'move', 'move', 'found', 'reveal']) cue(name);
    assert.deepEqual(made[0].plays, on
      ? [['tripod1', 0.8], ['tripod2', 0.45], ['tripod1', 0.45], ['tripod2', 0.45], ['tripod2', 0.8]]
      : []);
    made[0].plays.length = 0;
    cue('search'); cue('reveal'); cue('nonsense');
    assert.deepEqual(made[0].plays, [], 'search and reveal play nothing');
    const closing = close(skill); await settle(); views.calls[1].onComplete(); await closing;
    assert.equal(made[0].closed, true, 'sounds closed with the skill');
    assert.doesNotThrow(() => cue('look'));
    assert.deepEqual(made[0].plays, [], 'nothing after close');
  }
});
