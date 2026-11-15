import test from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';

const { Motion, POSE } = lib('motion.js');

// A jibo whose pushAttentionMode resolves only when the test says so.
function fakeJibo() {
  const calls = [], handles = [];
  let resolvePush;
  const jibo = {
    expression: {
      dofs: { BODY: ['body'] },
      AttentionMode: { OFF: 'off' },
      pushAttentionMode(mode) {
        calls.push('push ' + mode);
        const handle = { released: 0, release() { this.released++; calls.push('release'); } };
        handles.push(handle);
        return new Promise((resolve) => { resolvePush = () => resolve(handle); });
      },
      centerRobot() { calls.push('centre'); return Promise.resolve(); },
    },
    animDB: { getAnimByName: (name) => ({ play() { calls.push('play ' + name); return { result: Promise.resolve() }; } }) },
  };
  return { jibo, calls, handles, finishPush: () => resolvePush() };
}
const quiet = { info() {}, warn() {} };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('up then centre: attention off, pose, centre, attention back', async () => {
  const { jibo, calls, handles, finishPush } = fakeJibo();
  const motion = new Motion(jibo, quiet);
  const up = motion.move('up');
  await tick();
  finishPush();
  await up;
  await motion.move('centre');
  assert.deepEqual(calls, ['push off', 'play ' + POSE, 'centre', 'release']);
  assert.equal(handles[0].released, 1);
  assert.equal(motion.attention, null);
});

test('closed while attention is being pushed: released, no pose, nothing left behind', async () => {
  const { jibo, calls, handles, finishPush } = fakeJibo();
  const warnings = [];
  const motion = new Motion(jibo, { info() {}, warn: (...a) => warnings.push(a.join(' ')) });
  const up = motion.move('up');
  await tick();
  motion.close();
  finishPush();
  await up;
  assert.deepEqual(calls, ['push off', 'release']);
  assert.equal(handles[0].released, 1);
  assert.equal(motion.attention, null);
  assert.deepEqual(warnings, []);
});

test('closed after the pose started: centred and attention back', async () => {
  const { jibo, calls, finishPush } = fakeJibo();
  const motion = new Motion(jibo, quiet);
  const up = motion.move('up');
  await tick();
  finishPush();
  await up;
  motion.close();
  assert.deepEqual(calls, ['push off', 'play ' + POSE, 'centre', 'release']);
  assert.equal(motion.attention, null);
});

test('no body APIs: nothing happens', async () => {
  const motion = new Motion({}, quiet);
  assert.equal(motion.available(), false);
  await motion.move('up');
  motion.close();
});
