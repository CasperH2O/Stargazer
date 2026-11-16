import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib, fakeClock } from './helpers.mjs';
const Model = lib('model.js'), S = lib('settings.js');

function setup(values) {
  const clock = fakeClock(), events = [];
  const model = new Model(values, { timers: clock, onExit: () => events.push('exit'), onNext: () => events.push('next'), onSave: () => events.push('save'), onChange: () => {} });
  return { clock, model, events };
}
const ITEM = { key: 'a', title: 'A' };

test('the picture stays 10 s after it is fully shown, then Jibo\'s eye returns', () => {
  const { clock, model, events } = setup();
  model.viewing(ITEM, {});
  clock.advance(60000);
  assert.deepEqual(events, [], 'nothing before the reveal');
  model.shown();
  clock.advance(9999); assert.deepEqual(events, []);
  clock.advance(1); assert.deepEqual(events, ['exit']);
});

test('a touch restarts the time; info and menus pause it; coming back restarts it', () => {
  const { clock, model, events } = setup();
  model.viewing(ITEM, {}); model.shown();
  clock.advance(8000); model.touch(); clock.advance(8000);
  assert.deepEqual(events, []);
  model.openInfo(); clock.advance(60000); assert.deepEqual(events, []);
  model.openSettings(); model.tapHub('more'); clock.advance(60000); assert.deepEqual(events, []);
  assert.equal(model.back(), null); assert.equal(model.back(), null); assert.equal(model.back(), null);
  assert.equal(model.top(), 'viewer');
  clock.advance(10000); assert.deepEqual(events, ['exit']);
});

test('until closed: no timer; slideshow: next picture every N minutes and never closes', () => {
  let { clock, model, events } = setup({ showFor: 0 });
  model.viewing(ITEM, {}); model.shown(); clock.advance(3600000); assert.deepEqual(events, []);
  ({ clock, model, events } = setup({ showFor: 10, slideshow: 5 }));
  model.viewing(ITEM, {}); model.shown();
  clock.advance(5 * 60000); assert.deepEqual(events, ['next']);
  model.viewing({ key: 'b' }, {}); model.shown();
  clock.advance(5 * 60000); assert.deepEqual(events, ['next', 'next']);
});

test('swipe down: menus go back one level, the picture leaves', () => {
  const { model } = setup();
  model.viewing(ITEM, {}); model.openInfo(); model.openSettings(); model.tapHub('sources');
  assert.equal(model.top(), 'sources');
  assert.equal(model.back(), null); assert.equal(model.top(), 'settings');
  assert.equal(model.back(), null); assert.equal(model.back(), null);
  assert.equal(model.back(), 'exit');
});

test('menus: captions, refusal notice, cycling More', () => {
  const { model, events } = setup({ sources: { hubble: true, webb: false, noirlab: false } });
  model.viewing(ITEM, {}); model.openSettings(); model.tapHub('sources');
  assert.deepEqual(model.view().tiles.items.map((i) => [i.id, i.icon]), [['hubble', 'hubble'], ['webb', 'webb'], ['noirlab', 'noirlab']]);
  model.tapItem('sources', 'hubble');
  let vm = model.view();
  assert.equal(vm.status, 'At least one source has to stay on');
  assert.equal(vm.tiles.items.find((i) => i.id === 'hubble').caption, 'On');
  assert.equal(vm.tiles.items.find((i) => i.id === 'webb').caption, 'Off · tap to turn on');
  assert.deepEqual(events, []);
  model.back(); model.tapHub('more');
  model.tapItem('more', 'showFor');
  vm = model.view();
  assert.equal(vm.tiles.items[0].caption, '30 seconds');
  model.tapItem('more', 'slideshow');
  vm = model.view();
  assert.equal(vm.tiles.items[1].caption, 'Every minute');
  assert.equal(vm.tiles.items[0].caption, 'Open while slideshow runs');
  assert.equal(vm.tiles.items[2].caption, 'On · title only');
  assert.deepEqual(events, ['save', 'save']);
  assert.ok(vm.tiles.pager, 'six items, two pages of three');
  assert.deepEqual(vm.tiles.items.map((i) => i.id), ['showFor', 'slideshow', 'readTitle', 'readDescription', 'caption', 'sounds']);
  assert.equal(vm.tiles.items[3].caption, 'Off · tap to turn on');
  model.tapItem('more', 'readDescription');
  vm = model.view();
  assert.equal(vm.tiles.items[3].caption, 'On');
  assert.equal(vm.tiles.items[2].caption, 'On', 'the title tile no longer says "title only"');
  assert.deepEqual(events, ['save', 'save', 'save']);
  assert.equal(vm.tiles.canBack, false); assert.equal(vm.tiles.canForward, true);
});

test('settings hub summarises; offline shows a retry', () => {
  const { model } = setup();
  model.viewing(ITEM, {}); model.openSettings();
  const vm = model.view();
  assert.deepEqual(vm.tiles.items.map((i) => i.caption), ['3 of 3 on', '3 of 4 on', 'Show for 10 seconds']);
  model.offline();
  assert.equal(model.view().button.kind, 'retry');
});
