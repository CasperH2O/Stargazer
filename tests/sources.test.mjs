// Every source parser against saved responses (2026-11-14), plus the tricky cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib, fixture, fakeNet } from './helpers.mjs';

const t = lib('sources/text.js'), src = lib('sources/index.js');
const apod = lib('sources/apod.js'), iotd = lib('sources/nasa-iotd.js'), epic = lib('sources/epic.js'), efs = lib('sources/esa-efs.js');
const dj = lib('sources/djangoplicity.js').SOURCES;

test('text helpers decode entities, strip HTML and cut sentences', () => {
  assert.equal(t.plain('&lt;p&gt;A &amp; B&#8217;s &lt;a href="x"&gt;star&lt;/a&gt;.&lt;/p&gt;'), 'A & B’s star.');
  assert.equal(t.plain('<![CDATA[Hera spies]]>'), 'Hera spies');
  assert.equal(t.sentences('One. Two. Three.', 2, 100), 'One. Two.');
  assert.equal(t.sentences('U.S. Air Force jets made a heart. It was seen. Third.', 1, 300), 'U.S. Air Force jets made a heart.');
  assert.equal(t.sentences('Shot by M. Libralato. Next.', 1, 300), 'Shot by M. Libralato.');
  assert.ok(t.sentences('x'.repeat(400) + '.', 2, 260).length <= 260);
  assert.equal(t.row('<tr><th class="title">Name:</th><td><a>M 30</a></td></tr>', 'Name'), 'M 30');
  assert.ok(t.date('14 Nov. 2025') > 0);
});

test('APOD: today, photographer credit, screen-size URL', () => {
  const [it] = apod.parse(JSON.parse(fixture('apod.json')));
  assert.equal(it.title, 'Apollo 12 and Surveyor 3');
  assert.equal(it.license, 'copyright');
  assert.equal(it.credit, 'Kevin Frank');
  assert.match(it.imageUrl, /\?w=1280&h=720&fit=clip$/);
  assert.equal(src.creditLine(it), '© Kevin Frank');
});

test('APOD: video days and the broken official API (NASA logo) give nothing', () => {
  assert.deepEqual(apod.parse({ title: 'A video', url: 'https://youtube.com/x', media_type: 'video', date: '2026-11-01' }), []);
  assert.deepEqual(apod.parse({ title: 'NASA Science', url: 'https://science.nasa.gov/nasa-logo@2x.png', media_type: 'image' }), []);
  const pd = apod.parse({ title: 'T', url: 'https://apod.nasa.gov/x.jpg', media_type: 'image', date: '2026-11-02' })[0];
  assert.equal(src.creditLine(pd), 'Image: NASA');
});

test('APOD falls back to the official API when the mirror fails', async () => {
  const net = fakeNet({ 'https://apod.as93.net': new Error('down'), 'https://api.nasa.gov': { title: 'Official', url: 'https://apod.nasa.gov/o.jpg', media_type: 'image', date: '2026-11-14' } });
  const [it] = await apod.list(net);
  assert.equal(it.title, 'Official');
});

test('ESA/Hubble: feed is stale, listing has the newer monthly picture', async () => {
  const net = fakeNet({ 'https://esahubble.org/images/potm/feed/': fixture('hubble-feed.xml'), 'https://esahubble.org/images/potm/': fixture('hubble-listing.html') });
  const list = await dj.hubble.list(net, 6);
  assert.match(list[0].code, /^potm\d{4}a$/);
  assert.equal(list[0].imageUrl, `https://cdn.esahubble.org/archives/images/screen/${list[0].code}.jpg`);
  assert.ok(list.length <= 6);
});

test('djangoplicity page: name, constellation, credit and description', () => {
  const it = dj.hubble.fill({ title: '', description: '', date: 0, code: 'potm2610a' }, fixture('hubble-page.html'));
  assert.equal(it.title, 'Lessons from a stellar instructor');
  assert.equal(it.line, 'M 30 · Capricornus · Hubble');
  assert.match(it.credit, /^ESA\/Hubble & NASA, M\. Libralato/);
  assert.match(it.description, /Messier 30/);
  assert.ok(it.date > 0);
  const w = dj.webb.fill({ title: 'x', description: '' }, fixture('webb-page.html'));
  assert.equal(w.line, 'Dorado · Webb');
  assert.doesNotMatch(w.credit, /Acknowledgement/);
});

test('ESO: feed items, first name only, credit without stray spaces', () => {
  const [it] = dj.eso.fromFeed(fixture('eso-feed.xml'));
  assert.equal(it.title, 'Lights in the sky');
  assert.equal(it.imageUrl, 'https://cdn.eso.org/images/screen/potw2645a.jpg');
  dj.eso.fill(it, fixture('eso-page.html'));
  assert.equal(it.line, 'Carina Nebula · ESO');
  assert.equal(src.creditLine(it), '© J. Rodrigues/ESO · CC BY 4.0');
});

test('NOIRLab: the malformed feed <img> is ignored, the URL is built from the code', () => {
  const [it] = dj.noirlab.fromFeed(fixture('noirlab-feed.xml'));
  assert.equal(it.imageUrl, 'https://storage.noirlab.edu/media/archives/images/screen/iotw2645a.jpg');
  assert.equal(it.link, 'https://noirlab.edu/public/images/iotw2645a/');
});

test('Webb: an empty feed falls back to the listing', async () => {
  const net = fakeNet({ 'https://esawebb.org/images/potm/feed/': fixture('webb-feed.xml'), 'https://esawebb.org/images/potm/': fixture('webb-listing.html') });
  const list = await dj.webb.list(net, 3);
  assert.equal(list.length, 3);
  assert.match(list[0].code, /^potm\d{4}a$/);
});

test('NASA Image of the Day: resized enclosure, public domain', () => {
  const [it] = iotd.parse(fixture('nasa-iotd-feed.xml'));
  assert.equal(it.title, 'Outbursts from a Massive Star');
  assert.match(it.imageUrl, /\.jpg\?w=1280$/);
  assert.equal(src.creditLine(it), 'Image: NASA');
});

test('EPIC: the frame over our own time zone, named and placed', () => {
  const frames = JSON.parse(fixture('epic.json'));
  const [it] = epic.parse(frames, 0);
  assert.match(it.title, /^Earth over /);
  assert.match(it.line, /^\d+°[NS]? \d+°[EW]? · seen by DSCOVR/);
  assert.match(it.imageUrl, /^https:\/\/epic\.gsfc\.nasa\.gov\/archive\/natural\/\d{4}\/\d{2}\/\d{2}\/jpg\/epic_1b_\d+\.jpg$/);
  assert.equal(epic.region(0, -150), 'the Pacific Ocean');
  assert.equal(epic.region(40, 10), 'Europe and Africa');
  assert.equal(epic.homeLongitude(-60), 15);
});

test('ESA Earth from Space: place from the title, credit and open licence from the page', () => {
  const list = efs.parse(JSON.parse(fixture('esa-efs.json')));
  assert.ok(list.length >= 1);
  assert.ok(!/^Earth from Space/.test(list[0].title));
  const it = efs.fill({ credit: 'ESA', license: '' }, fixture('esa-efs-page.html'));
  assert.match(it.credit, /Copernicus Sentinel data/);
  assert.equal(it.license, 'CC BY-SA 3.0 IGO');
});

test('every source has an id, label and list()', () => {
  assert.deepEqual(src.LIST.map((s) => s.id), ['apod', 'hubble', 'webb', 'eso', 'noirlab', 'nasa-iotd', 'epic', 'esa-efs']);
  for (const s of src.LIST) { assert.equal(typeof s.list, 'function'); assert.ok(s.label); }
});
