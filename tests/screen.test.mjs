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
global.PIXI = { Container: Node, Graphics, Sprite, Texture: { EMPTY: {} },
  TextMetrics: { measureText: (text, style) => ({ width: text.length * style.fontSize * 0.5 }) } };   // 18 px per character at 36 px

function fakeSdk() {
  const calls = [];
  const views = {
    calls, currentView: null, viewStackLength: 1, created: 0,
    ActionData: { CALLBACK: 'cb' }, GESTURE: { SWIPE_DOWN: 'sd', TAP: 'tap', PAN: 'pan' }, TRANSITION: { IN: 'in', OUT: 'out' },
    STATE: { DESTROYED: 'destroyed' }, _viewProcess: { active: false, processQueue: [] }, ComponentGroup: { prototype: { destroy() {} } },
    createView() {
      views.created++;
      return { state: 'created', stage: null, viewStateStacked: false, addAction() {}, clearActions() {}, getComponentById(id) { return views.components ? views.components(id) : null; } };
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
    keep() {} release() {} showing() {} retired() {} count() { return 0; } close() { this.closed = true; }
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
    Motion: class { move() {} close() {} }, Sounds: over.Sounds, closeMs: 50, watchdogMs: 20, giveUpMs: 60, speechWaitMs: 80
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

test('open while on screen (a launch phrase) removes the old view before adding a new one', async () => {
  const { jibo, views, skill, log } = harness();
  skill.open(); await settle(); load(jibo, views.calls[0]); complete(views.calls[0]);
  const old = skill.view;
  skill.open();                                      // Be opens again without a close
  assert.ok(log.some((l) => /closing the view still there first/.test(l)));
  assert.equal(views.created, 1, 'no new view on top of the old one');
  await settle();
  assert.equal(views.calls[1].options.remove, true);
  assert.equal(views.calls[1].options.leaveEmpty, true);
  views.currentView = null; views.calls[1].onComplete(); await settle();
  assert.equal(views.created, 2);
  assert.ok(views.calls[2].options.addView && views.calls[2].options.addView !== old);
  load(jibo, views.calls[2]);
  assert.equal(skill.model.base, 'viewer');
  const again = close(skill); await settle(); views.calls[3].onComplete(); await again;
});

test('a view left over from a failed close is closed on open, then a new one opens', async () => {
  const { jibo, views, skill } = harness();
  skill.open(); await settle(); load(jibo, views.calls[0]); complete(views.calls[0]);
  skill.view.state = 'destroyed'; views.currentView = null;   // Be reset the face
  skill.open(); await settle();
  assert.equal(views.created, 2);
  load(jibo, views.calls[1]);
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

// SDK Labels and buttons as plain objects, made on first use; `views._touchManager` records the pan gesture.
function withComponents(views) {
  const made = {}, gestures = [];
  views.components = (id) => made[id] || (made[id] = { id, style: { fontSize: 36 }, bounds: { width: 980, height: 400 }, display: { x: 150, y: 0, visible: true, alpha: 1 }, text: ' ' });
  views._touchManager = { addGesture: (g, fn) => gestures.push(g), removeGesture: (g) => gestures.splice(gestures.indexOf(g), 1) };
  return { made, gestures };
}
const WORDS = 'Thick clouds of cold hydrogen gas dominate the scene forming a complex network of ridges cavities and glowing filaments'.split(' ');
function longText(count) { const out = []; for (let i = 0; i < count; i++) out.push(WORDS[i % WORDS.length]); return out.join(' ') + '.'; }

test('info overlay: the full description in pages that fit, a horizontal pan turns them, swipe down closes', async () => {
  const item = { key: 'a1', source: 'a', title: 'A very long title that cannot possibly fit on a single line of the screen, ' + longText(30), description: longText(190), credit: 'ESA/Hubble & NASA, J. Doe', license: 'CC BY 4.0' };
  const { jibo, views, skill } = harness({ lists: { a: [item] } });
  const { made, gestures } = withComponents(views);
  skill.open(); await settle(); load(jibo, views.calls[0]); complete(views.calls[0]);
  skill.tapPicture();
  const lines = (id) => made[id].text.split('\n');
  assert.ok(skill.overlay.count >= 3, 'a long text takes several pages: ' + skill.overlay.count);
  assert.ok(lines('info-body').length <= 5 && lines('info-body').length >= 4, 'page 1 has 5 lines');
  for (const l of lines('info-body')) assert.ok(l.length * 18 <= 980, 'line fits: ' + l);
  assert.ok(made['info-title'].text.split('\n').length <= 2 && made['info-title'].text.endsWith('…'), 'a title that cannot fit ends in an ellipsis on line 2');
  assert.ok(made['info-title'].style.fontSize === 44 && made['info-title']._originalFontSize === 44, 'shrunk to the minimum');
  assert.equal(made['info-credit'].text, '© ESA/Hubble & NASA, J. Doe · CC BY 4.0');
  assert.equal(made['btn-settings'].display.visible, true);
  assert.ok(!skill.ids.includes('cap-settings'), 'no caption under the gear');
  assert.equal(made['info-body'].display.visible, true);
  assert.equal(made['info-more'].display.visible, false);
  assert.equal(skill.decor.thumb.visible, true, 'pager bar');
  assert.deepEqual(gestures, ['pan'], 'the pan gesture is on while there are pages');

  skill.onPan({ deltaX: 200, isFinal: false }); skill.onPan({ deltaX: 200, isFinal: true });
  assert.equal(skill.overlay.page, 0, 'no page before the first');
  skill.onPan({ deltaX: -80, isFinal: false }); assert.ok(made['info-body'].display.alpha < 1, 'fades while dragged');
  skill.onPan({ deltaX: -80, isFinal: true });
  assert.equal(skill.overlay.page, 0, 'a short drag turns nothing');
  skill.onPan({ deltaX: -200, isFinal: false }); skill.onPan({ deltaX: -200, isFinal: true });
  assert.equal(skill.overlay.page, 1);
  assert.equal(made['info-body'].display.visible, false);
  assert.equal(made['info-more'].display.visible, true);
  assert.equal(made['info-credit'].display.visible, false, 'later pages are text only');
  assert.ok(lines('info-more').length <= 8);
  for (const l of lines('info-more')) assert.ok(l.length * 18 <= 980);
  await wait(900);
  assert.equal(skill.slide.x, 0, 'the new page slid to rest');
  assert.equal(made['info-more'].display.alpha, 1);
  assert.equal(made['info-more'].display.x, 150);

  skill.swipeDown();
  assert.equal(skill.model.top(), 'viewer');
  assert.equal(skill.overlay.page, 0);
  assert.deepEqual(gestures, [], 'the pan gesture is off again');
  const closing = close(skill); await settle(); views.calls[1].onComplete(); await closing;
});

test('info overlay: a short description is one page, no pan, the title stays at full size', async () => {
  const item = { key: 'a1', source: 'a', title: 'Cat\'s Eye', description: 'A planetary nebula.', credit: 'NASA' };
  const { jibo, views, skill } = harness({ lists: { a: [item] } });
  const { made, gestures } = withComponents(views);
  skill.open(); await settle(); load(jibo, views.calls[0]); complete(views.calls[0]);
  skill.tapPicture();
  assert.equal(skill.overlay.count, 1);
  assert.equal(made['info-body'].text, 'A planetary nebula.');
  assert.equal(made['info-title'].text, 'Cat\'s Eye');
  assert.equal(made['info-title'].style.fontSize, 54);
  assert.equal(skill.decor.thumb.visible, false);
  assert.deepEqual(gestures, []);
  skill.press('settings');
  assert.equal(skill.model.top(), 'settings');
  const closing = close(skill); await settle(); views.calls[1].onComplete(); await closing;
});

function fakeTts(jibo) {
  const t = { said: [], stops: 0, speak(text) { t.said.push(text); return new Promise(() => {}); }, stop() { t.stops++; return Promise.resolve(); } };
  jibo.tts = t;
  return t;
}
const LONG = { key: 'a1', source: 'a', title: 'Cat\'s Eye', description: 'A planetary nebula. See https://example.org/x for [more] details. It is *old*.' };
// Opens a skill with a fake voice, runs `check`, and closes the skill.
async function speaking(values, item, check) {
  const h = harness({ lists: { a: [item || LONG] }, values });
  const tts = fakeTts(h.jibo);
  h.skill.open(); await settle(); load(h.jibo, h.views.calls[0]); complete(h.views.calls[0]);
  try { await check(tts, h); }
  finally { const closing = close(h.skill); await settle(); h.views.calls[1].onComplete(); await closing; }
}

test('read aloud: the title by default; the description only when asked, after the title, as one clean text', async () => {
  await speaking({}, null, (tts) => assert.deepEqual(tts.said, ['Cat\'s Eye.'], 'default: title only'));
  await speaking({ readDescription: true }, null, (tts) => assert.deepEqual(tts.said, ['Cat\'s Eye. A planetary nebula. See for details. It is old.']));
  await speaking({ readTitle: false, readDescription: true }, null, (tts) => assert.deepEqual(tts.said, ['A planetary nebula. See for details. It is old.'], 'description alone'));
  await speaking({ readTitle: false }, null, (tts) => assert.deepEqual(tts.said, [], 'both off: silent'));
});

test('read aloud: a long description is cut on a sentence at 900 characters and said in pieces of at most 450; nothing is said without a description', async () => {
  const description = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const h = harness({ lists: { a: [{ ...LONG, description }] }, values: { readTitle: false, readDescription: true } });
  const reading = readingUntilFinished(fakeTts(h.jibo));
  const tts = h.jibo.tts;
  h.skill.open(); await settle(); load(h.jibo, h.views.calls[0]); complete(h.views.calls[0]);
  try {
    assert.equal(tts.said.length, 1, 'one piece at a time');
    reading.finish(); await settle();
    assert.equal(tts.said.length, 2);
    reading.finish(); await settle();
    assert.equal(tts.said.length, 2, 'no third piece');
    assert.equal(h.skill.speaking, false, 'the reading ended after the last piece');
    const all = tts.said.join(' ');
    assert.ok(tts.said.every((p) => p.length <= 450 && /here\.$/.test(p)), tts.said.map((p) => p.length).join(','));
    assert.ok(all.length <= 900 && all.length > 800, all.length);
  } finally { const closing = close(h.skill); await settle(); h.views.calls[1].onComplete(); await closing; }
  await speaking({ readTitle: false, readDescription: true }, { ...LONG, description: '' }, (tts) => assert.deepEqual(tts.said, []));
});

test('read aloud: turning the setting off, a slideshow advance and closing cut the speech', async () => {
  await speaking({ readDescription: true }, null, (tts, h) => {
    assert.equal(h.skill.speaking, true);
    h.skill.saved(S.clean({ readDescription: true }));
    assert.equal(tts.stops, 0, 'unrelated save: no cut');
    h.skill.saved(S.clean({ readDescription: false }));
    assert.equal(tts.stops, 1, 'description switched off while it is read');
    h.skill.speak('Hello.', { readTitle: true, readDescription: false });
    h.skill.saved(S.clean({ readDescription: false }));
    assert.equal(tts.stops, 1, 'a title-only speech is not cut by that');
    h.skill.next();
    assert.equal(tts.stops, 2, 'the next picture cuts the speech');
  });
});

// A reading that ends when `finish()` is called.
function readingUntilFinished(tts) { const r = { finish: null }; tts.speak = (text) => { tts.said.push(text); return new Promise((resolve) => { r.finish = resolve; }); }; return r; }

test('show time over: the eye waits for the reading to end', async () => {
  const h = harness({ lists: { a: [LONG] }, values: { readDescription: true } });
  const reading = readingUntilFinished(fakeTts(h.jibo));
  h.skill.open(); await settle(); load(h.jibo, h.views.calls[0]); complete(h.views.calls[0]);
  try {
    h.skill.showTimeOver();
    assert.equal(h.skill.leaving, false, 'still reading');
    reading.finish(); await settle();
    assert.equal(h.skill.leaving, true, 'left when the reading ended');
  } finally { const closing = close(h.skill); await settle(); h.views.calls[1].onComplete(); await closing; }
});

test('show time over: without a reading it leaves at once; a menu opened meanwhile cancels the exit', async () => {
  const quiet = harness({ lists: { a: [LONG] } });
  quiet.skill.open(); await settle(); load(quiet.jibo, quiet.views.calls[0]); complete(quiet.views.calls[0]);
  quiet.skill.showTimeOver();
  assert.equal(quiet.skill.leaving, true);
  let closing = close(quiet.skill); await settle(); quiet.views.calls[1].onComplete(); await closing;

  const h = harness({ lists: { a: [LONG] }, values: { readDescription: true } });
  const reading = readingUntilFinished(fakeTts(h.jibo));
  h.skill.open(); await settle(); load(h.jibo, h.views.calls[0]); complete(h.views.calls[0]);
  h.skill.showTimeOver();
  h.skill.model.openInfo();
  reading.finish(); await settle();
  assert.equal(h.skill.leaving, false, 'the person is still here');
  assert.equal(h.skill.exitTimer, null);
  closing = close(h.skill); await settle(); h.views.calls[1].onComplete(); await closing;
});

test('show time over: a reading that never ends is cut after speechWaitMs', async () => {
  const h = harness({ lists: { a: [LONG] }, values: { readDescription: true } });
  const tts = fakeTts(h.jibo);
  h.skill.open(); await settle(); load(h.jibo, h.views.calls[0]); complete(h.views.calls[0]);
  try {
    h.skill.showTimeOver();
    assert.equal(h.skill.leaving, false);
    await wait(150);
    assert.equal(tts.stops, 1, 'the speech was cut');
    assert.equal(h.skill.leaving, true);
  } finally { const closing = close(h.skill); await settle(); h.views.calls[1].onComplete(); await closing; }
});

test('read aloud: a speech that was cut does not end the one that replaced it', async () => {
  await speaking({ readDescription: true }, null, async (tts, h) => {
    const ends = [];
    tts.speak = (text) => { tts.said.push(text); return new Promise((resolve) => ends.push(resolve)); };
    h.skill.speak('First.', {});
    h.skill.stopSpeaking();
    h.skill.speak('Second.', {});
    ends[0](); await settle();
    assert.equal(h.skill.speaking, true, 'the first speech ending says nothing about the second');
    ends[1](); await settle();
    assert.equal(h.skill.speaking, false);
  });
});

test('read aloud: nothing is said when a menu already covers the picture', async () => {
  const h = harness({ lists: { a: [LONG] }, values: { readDescription: true } });
  const tts = fakeTts(h.jibo);
  h.skill.open(); await settle(); h.skill.model.openSettings(); load(h.jibo, h.views.calls[0]); complete(h.views.calls[0]);
  try { assert.deepEqual(tts.said, []); }
  finally { const closing = close(h.skill); await settle(); h.views.calls[1].onComplete(); await closing; }
});

test('read aloud: a stop by someone else (another speaker, "Hey Jibo") ends the whole reading, not only its piece', async () => {
  const description = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const h = harness({ lists: { a: [{ ...LONG, description }] }, values: { readTitle: false, readDescription: true } });
  const reading = readingUntilFinished(fakeTts(h.jibo));
  const tts = h.jibo.tts, handlers = new Set();
  tts.stopped = { on: (f) => handlers.add(f), off: (f) => handlers.delete(f) };
  h.skill.open(); await settle(); load(h.jibo, h.views.calls[0]); complete(h.views.calls[0]);
  try {
    assert.equal(tts.said.length, 1);
    assert.equal(handlers.size, 1, 'listening for stops while reading');
    handlers.forEach((f) => f());                    // someone else stops the speech
    reading.finish(); await settle();
    assert.equal(tts.said.length, 1, 'no next piece');
    assert.equal(h.skill.speaking, false);
    assert.equal(handlers.size, 0, 'no listener left');
  } finally { const closing = close(h.skill); await settle(); h.views.calls[1].onComplete(); await closing; }
});

test('read aloud: the stop that tts.speak sends to a speech still finishing does not cut the reading', async () => {
  const description = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const h = harness({ lists: { a: [{ ...LONG, description }] }, values: { readTitle: false, readDescription: true } });
  const reading = readingUntilFinished(fakeTts(h.jibo));
  const tts = h.jibo.tts, handlers = new Set();
  tts.stopped = { on: (f) => handlers.add(f), off: (f) => handlers.delete(f) };
  h.skill.open(); await settle(); load(h.jibo, h.views.calls[0]); complete(h.views.calls[0]);
  try {
    tts.isTalking = true;                            // piece 1 resolved, but the engine still says it is talking
    reading.finish(); await settle();
    assert.equal(tts.said.length, 2);
    handlers.forEach((f) => f());                    // the stop tts.speak sends before piece 2
    tts.isTalking = false;
    reading.finish(); await settle();
    assert.equal(h.skill.speaking, false, 'piece 2 was the last; the reading ended normally');
    assert.equal(handlers.size, 0);
  } finally { const closing = close(h.skill); await settle(); h.views.calls[1].onComplete(); await closing; }
});

test('open while on screen, then Be closes the skill before the old view is gone: no reopen', async () => {
  const { jibo, views, skill } = harness();
  skill.open(); await settle(); load(jibo, views.calls[0]); complete(views.calls[0]);
  skill.open();                                      // a launch phrase: the old view is being closed
  await settle();
  const beClosed = close(skill);                     // Be switches away meanwhile
  views.currentView = null; views.calls[1].onComplete();
  await beClosed; await settle();
  assert.equal(views.created, 1, 'no new view after Be closed the skill');
  assert.equal(skill.view, null);
  assert.equal(skill.model, null);
});
