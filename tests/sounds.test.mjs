import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { lib } from './helpers.mjs';

const { Sounds, FILES } = lib('sounds.js');
const ROOT = '/opt/jibo/Jibo/Skills/@be/be/node_modules/jibo-anim-db-animations';
const tick = () => new Promise((resolve) => setImmediate(resolve));

// A jibo with the anim library, the loader (completes asynchronously, like the SDK's) and the sound
// plugin. fail: ids whose load completes with an error; throws: ids whose load() throws. Each played
// instance keeps the plugin's {complete} callback so a test can end it.
function fakeJibo({ fail = [], throws = [], root = ROOT } = {}) {
  const loads = [], instances = [];
  const jibo = {
    animDB: { getAnimByName: (name) => (name === 'jiboji_telescope_02' ? { name, resourceRoot: root } : null) },
    loader: {
      load(opts, { complete }) {
        if (throws.includes(opts.id)) throw new Error('bad asset');
        loads.push(opts);
        setImmediate(() => complete(fail.includes(opts.id) ? new Error('404') : null));
      },
    },
    sound: {
      play(id, options) {
        const volumes = [];
        const inst = {
          id, options, volumes, stopped: 0, destroyed: 0, _v: 1,
          get volume() { return this._v; }, set volume(v) { this._v = v; volumes.push(v); },
          stop() { this.stopped++; }, destroy() { this.destroyed++; },
          end() { options.complete(); },
        };
        instances.push(inst);
        return inst;
      },
    },
  };
  return { jibo, loads, instances };
}
function fakeLog() {
  const lines = { info: [], warn: [] };
  return { lines, info: (...a) => lines.info.push(a.join(' ')), warn: (...a) => lines.warn.push(a.join(' ')) };
}
const playing = (s) => Object.values(s.playing);

test('sounds: loads the two tripod sounds from the animation library, by absolute path', async () => {
  const { jibo, loads } = fakeJibo();
  const s = new Sounds(jibo, fakeLog());
  const p = s.prepare();
  assert.equal(s.prepare(), p, 'loads once');
  await p;
  assert.deepEqual(Object.keys(FILES).sort(), ['tripod1', 'tripod2'], 'no ambience any more');
  assert.deepEqual(loads.map((l) => l.id).sort(), ['stargazer-tripod1', 'stargazer-tripod2']);
  for (const l of loads) {
    const name = l.id.replace('stargazer-', '');
    assert.equal(l.src, path.join(ROOT, FILES[name]));
    assert.ok(l.src.startsWith(ROOT + '/audio/sfx/'), l.src);
    assert.ok(!l.loop, 'nothing loops');
  }
  assert.deepEqual(Object.keys(s.ready).sort(), ['tripod1', 'tripod2']);
});

test('sounds: play() plays by id at the asked volume, and an ended sound leaves playing', async () => {
  const { jibo, instances } = fakeJibo();
  const s = new Sounds(jibo, fakeLog());
  await s.prepare();
  s.play('tripod1', 0.5);
  s.play('tripod2');
  s.play('tripod1', 0.45);          // the same sound again: a second instance alongside
  assert.deepEqual(instances.map((i) => i.id), ['stargazer-tripod1', 'stargazer-tripod2', 'stargazer-tripod1']);
  assert.equal(instances[0].volume, 0.5);
  assert.deepEqual(instances[1].volumes, [], 'volume left alone when not given');
  assert.equal(instances[2].volume, 0.45);
  assert.deepEqual(playing(s), instances);
  instances[1].end();
  assert.deepEqual(playing(s), [instances[0], instances[2]], 'complete removes it from playing');
  instances[0].end(); instances[2].end();
  assert.deepEqual(s.playing, {});
  assert.ok(instances.every((i) => i.stopped === 0 && i.destroyed === 0), 'an ended sound is left to the plugin');
  s.play('ambience', 0.3);          // not a sound any more
  assert.equal(instances.length, 3);
});

test('sounds: unavailable without the anim library or the sound plugin, never throws', async () => {
  const cases = [
    null,
    {},
    { animDB: { getAnimByName: () => null }, loader: { load() { throw new Error('should not load'); } }, sound: { play() { throw new Error('no'); } } },
    { animDB: { getAnimByName: () => ({ resourceRoot: 42 }) }, loader: { load() { throw new Error('should not load'); } }, sound: { play() { throw new Error('no'); } } },
    { animDB: { getAnimByName: () => ({ resourceRoot: ROOT }) }, loader: { load() { throw new Error('should not load'); } } },   // no sound plugin
    { animDB: { getAnimByName: () => ({ resourceRoot: ROOT }) }, sound: { play() { throw new Error('no'); } } },                 // no loader
  ];
  for (const jibo of cases) {
    const log = fakeLog(), s = new Sounds(jibo, log);
    await assert.doesNotReject(s.prepare());
    assert.doesNotThrow(() => { s.play('tripod1', 0.5); s.play('tripod2'); s.close(); });
    await tick();
    assert.deepEqual(s.ready, {});
    assert.deepEqual(s.playing, {});
    assert.ok(log.lines.info.some((l) => l.includes('unavailable')));
  }
  const bare = new Sounds({ sound: { play() { throw new Error('no'); } } });   // no log
  assert.doesNotThrow(() => { bare.play('tripod1'); bare.close(); });
});

test('sounds: a sound asked for before it has loaded is skipped, not played late', async () => {
  const { jibo, instances } = fakeJibo();
  const s = new Sounds(jibo, fakeLog());
  const p = s.prepare();
  s.play('tripod1', 0.8);            // too early: skipped
  s.play('tripod2');
  assert.equal(instances.length, 0);
  await p; await tick();
  assert.equal(instances.length, 0, 'nothing plays once it is in');
  assert.deepEqual(s.playing, {});
  s.play('tripod1', 0.8);            // now it plays
  assert.deepEqual(instances.map((i) => i.id), ['stargazer-tripod1']);
});

test('sounds: close() stops and destroys every playing sound and plays nothing afterwards', async () => {
  const { jibo, instances } = fakeJibo();
  const s = new Sounds(jibo, fakeLog());
  await s.prepare();
  s.play('tripod1', 0.8);
  s.play('tripod2', 0.45);
  s.play('tripod1', 0.45);
  instances[2].end();               // already over: not stopped again
  s.close();
  assert.deepEqual(instances.map((i) => [i.stopped, i.destroyed]), [[1, 1], [1, 1], [0, 0]]);
  assert.deepEqual(s.playing, {});
  s.play('tripod1'); s.play('tripod2', 0.5);
  await tick();
  assert.equal(instances.length, 3, 'nothing after close');
  assert.doesNotThrow(() => s.close());
  assert.deepEqual(instances.map((i) => [i.stopped, i.destroyed]), [[1, 1], [1, 1], [0, 0]], 'a second close stops nothing twice');

  // Before the sounds have loaded: they never play.
  const f = fakeJibo(), x = new Sounds(f.jibo, fakeLog());
  const q = x.prepare();
  x.close();
  await q; await tick();
  x.play('tripod1', 0.8);
  assert.equal(f.instances.length, 0);
});

test('sounds: close() survives instances whose stop or destroy throws, or that have neither', async () => {
  const { jibo } = fakeJibo();
  const s = new Sounds(jibo, fakeLog());
  await s.prepare();
  const made = [
    { stop() { throw new Error('gone'); }, destroy() { this.destroyed = true; } },
    { stop() { this.stopped = true; }, destroy() { throw new Error('gone'); } },
    {},
  ];
  let n = 0;
  jibo.sound.play = () => made[n++];
  s.play('tripod1'); s.play('tripod2'); s.play('tripod1');
  assert.equal(playing(s).length, 3);
  assert.doesNotThrow(() => s.close());
  assert.equal(made[0].destroyed, true, 'destroyed even when stop threw');
  assert.equal(made[1].stopped, true);
  assert.deepEqual(s.playing, {});
});

test('sounds: a sound that fails to load is left out, the other still plays', async () => {
  for (const [opts, bad, good, why] of [
    [{ fail: ['stargazer-tripod1'] }, 'tripod1', 'tripod2', '404'],
    [{ throws: ['stargazer-tripod2'] }, 'tripod2', 'tripod1', 'bad asset'],
  ]) {
    const { jibo, instances } = fakeJibo(opts);
    const log = fakeLog(), s = new Sounds(jibo, log);
    await s.prepare();
    assert.deepEqual(Object.keys(s.ready), [good]);
    assert.equal(log.lines.warn.length, 1);
    assert.ok(log.lines.warn.some((l) => l.includes(bad) && l.includes(why)), log.lines.warn.join('|'));
    s.play(bad, 0.8);
    assert.equal(instances.length, 0);
    s.play(good, 0.8);
    assert.deepEqual(instances.map((i) => i.id), ['stargazer-' + good]);
  }
  const both = fakeJibo({ fail: ['stargazer-tripod1', 'stargazer-tripod2'] });
  const s = new Sounds(both.jibo, fakeLog());
  await s.prepare();
  assert.deepEqual(s.ready, {});
  assert.doesNotThrow(() => { s.play('tripod1'); s.play('tripod2'); s.close(); });
  assert.equal(both.instances.length, 0);
});

test('sounds: a sound plugin that throws or returns nothing is survived', async () => {
  const { jibo } = fakeJibo();
  const log = fakeLog(), s = new Sounds(jibo, log);
  await s.prepare();
  jibo.sound.play = () => { throw new Error('audio context gone'); };
  assert.doesNotThrow(() => s.play('tripod1', 0.8));
  assert.ok(log.lines.warn.some((l) => l.includes('audio context gone')));
  assert.deepEqual(s.playing, {});
  jibo.sound.play = () => null;
  assert.doesNotThrow(() => s.play('tripod2', 0.5));
  assert.deepEqual(s.playing, {}, 'nothing kept for a sound that did not start');
  // An instance whose volume cannot be set still plays.
  const stubborn = { set volume(v) { throw new Error('read-only'); }, stop() {}, destroy() {} };
  jibo.sound.play = () => stubborn;
  assert.doesNotThrow(() => s.play('tripod1', 0.8));
  assert.deepEqual(playing(s), [stubborn]);
  assert.doesNotThrow(() => s.close());
});
