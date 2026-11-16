import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';
const createLog = lib('log.js');

test('log lines are tagged and cut at a fixed length (remote error text can be long)', () => {
  const lines = [];
  const log = createLog({ info: (t) => lines.push(t), warn: (t) => lines.push(t), error: (t) => lines.push(t) });
  log.info('hello', 3);
  log.warn('x'.repeat(1e6));
  assert.equal(lines[0], '[stargazer] hello 3');
  assert.ok(lines[1].length <= 520 && lines[1].startsWith('[stargazer] xxx'), String(lines[1].length));
});
