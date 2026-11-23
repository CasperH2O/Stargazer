import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';
const { cleanDescription, spokenText } = lib('speech.js');
const { DESCRIPTION_MAX } = lib('sources/text.js');

const item = { title: 'Cat\'s Eye', description: 'A planetary nebula. See https://example.org/x for [more] details. It is *old*.' };

test('cleanDescription: no links, bracketed notes or markup; one line', () => {
  assert.equal(cleanDescription(item.description), 'A planetary nebula. See for details. It is old.');
  assert.equal(cleanDescription(undefined), '');
});

test('cleanDescription: whole sentences, at most DESCRIPTION_MAX characters', () => {
  const long = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const said = cleanDescription(long);
  assert.ok(said.length <= DESCRIPTION_MAX && said.length > DESCRIPTION_MAX - 60 && /here\.$/.test(said), said.length);
});

test('spokenText: title and description as one utterance, and which settings it came from', () => {
  assert.deepEqual(spokenText(item, { readTitle: true, readDescription: false }), { text: 'Cat\'s Eye.', readsTitle: true, readsDescription: false });
  assert.deepEqual(spokenText(item, { readTitle: true, readDescription: true }),
    { text: 'Cat\'s Eye. A planetary nebula. See for details. It is old.', readsTitle: true, readsDescription: true });
  assert.deepEqual(spokenText(item, { readTitle: false, readDescription: false }), { text: '', readsTitle: false, readsDescription: false });
});

test('spokenText: a setting without text behind it reads nothing, so turning it off cuts nothing', () => {
  assert.deepEqual(spokenText({ title: 'T', description: '' }, { readTitle: true, readDescription: true }), { text: 'T.', readsTitle: true, readsDescription: false });
  assert.equal(spokenText({ title: '', description: 'Text.' }, { readTitle: true, readDescription: false }).text, '');
});

test('utterances: pieces of at most 450 characters, split after a sentence, with markup characters escaped', () => {
  const { utterances } = lib('speech.js');
  assert.deepEqual(utterances('Stars & dust <1>.'), ['Stars &amp; dust &lt;1&gt;.']);
  assert.deepEqual(utterances(''), []);
  const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i} is here.`).join(' ');
  const pieces = utterances(long);
  assert.ok(pieces.length > 1 && pieces.every((p) => p.length <= 450 && /here\.$/.test(p)));
  assert.equal(pieces.join(' '), long);
  const word = 'a'.repeat(500);
  assert.ok(utterances(word).every((p) => p.length <= 450), 'a piece without spaces is cut hard');
});
