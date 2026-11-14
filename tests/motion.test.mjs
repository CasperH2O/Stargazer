// The telescope jiboji player (lib/motion.js) against a fake jibo.animDB / jibo.expression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib, fakeClock } from './helpers.mjs';
const { Motion, JIBOJI } = lib('motion.js');

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() { for (let i = 0; i < 10; i++) await tick(); }

function fakeJibo(over = {}) {
  const events = [];
  const playback = {
    play() { events.push('play'); return over.play ? over.play() : Promise.resolve(); },
    stop() { events.push('stop'); }
  };
  const jibo = {
    events, playback,
    loader: { activeCache: '@be/stargazer', basePath: '/skill' }, sound: { basePath: '/skill' },
    animDB: { getAnimByName(name) {
      events.push('get ' + name);
      if (over.missing) return null;
      return { resourceRoot: '/be/node_modules/jibo-anim-db-animations', createFromConfig(config) { events.push('base ' + jibo.loader.basePath + ' ' + jibo.sound.basePath); events.push('create ' + config.cache); return over.create ? over.create() : Promise.resolve(playback); } };
    } },
    expression: {
      dofs: { BODY: 'body' }, AttentionMode: { OFF: 'off' },
      pushAttentionMode(mode) { events.push('attention ' + mode); return Promise.resolve({ release() { events.push('release'); } }); },
      centerRobot(config) { events.push(config ? 'centre body' : 'centre all'); return Promise.resolve(); }
    }
  };
  return jibo;
}
const quiet = { info() {}, warn() {} };

test('plays jiboji_telescope_02 from the global cache (textures resolve there) with attention off, then centres the whole robot', async () => {
  const jibo = fakeJibo();
  assert.equal(await new Motion(jibo, quiet).jiboji(), 'played');
  assert.equal(JIBOJI, 'jiboji_telescope_02');
  assert.deepEqual(jibo.events, ['attention off', 'get jiboji_telescope_02', 'base /be/node_modules/jibo-anim-db-animations /be/node_modules/jibo-anim-db-animations', 'create global', 'play', 'centre all', 'release']);
  assert.equal(jibo.loader.basePath, '/skill', 'the skill base path is back');
  assert.equal(jibo.sound.basePath, '/skill');
});

test('a missing animation or a load that never finishes is skipped (the view still opens)', async () => {
  const missing = fakeJibo({ missing: true });
  assert.equal(await new Motion(missing, quiet).jiboji(), 'anim_missing');
  assert.deepEqual(missing.events.slice(-2), ['centre all', 'release']);

  const clock = fakeClock();
  const stuck = fakeJibo({ create: () => new Promise(() => {}) });
  const result = new Motion(stuck, quiet, clock).jiboji();
  await settle(); clock.advance(4000); await settle();
  assert.equal(await result, 'load_timeout');

  const clock2 = fakeClock();
  const endless = fakeJibo({ play: () => new Promise(() => {}) });
  const played = new Motion(endless, quiet, clock2).jiboji();
  await settle(); clock2.advance(10000); await settle();
  assert.equal(await played, 'play_timeout');
  assert.ok(endless.events.includes('stop'));
});

test('closing while it plays stops it, centres and releases attention', async () => {
  let finish;
  const jibo = fakeJibo({ play: () => new Promise((resolve) => { finish = resolve; }) });
  const motion = new Motion(jibo, quiet);
  const result = motion.jiboji();
  await settle();
  assert.equal(jibo.loader.basePath, '/be/node_modules/jibo-anim-db-animations');
  motion.close();
  assert.equal(jibo.loader.basePath, '/skill', 'closing gives the base path back at once');
  assert.deepEqual(jibo.events.slice(-3), ['stop', 'centre all', 'release']);
  finish();
  assert.equal(await result, 'stopped');
  assert.equal(await motion.jiboji(), 'closed');
});

test('without animDB (an old SDK) nothing plays', async () => {
  assert.equal(await new Motion({ expression: {} }, quiet).jiboji(), 'unavailable');
});
