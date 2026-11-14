// Every source parser against saved responses (2026-11-14), plus the tricky cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib, fixture, fakeNet } from './helpers.mjs';

const t = lib('sources/text.js'), src = lib('sources/index.js');
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

// Records the options each request is made with (fakeNet itself ignores them).
function recording(net) {
  const seen = [];
  const wrap = (fn) => (url, options) => { seen.push([url, options && options.timeoutMs]); return fn(url, options); };
  return { seen, text: wrap(net.text), json: wrap(net.json), get: wrap(net.get) };
}

test('the feed-then-listing chain fits the catalog budget: feed 8 s, listing 15 s (a hanging feed still leaves the listing time)', async () => {
  const djm = lib('sources/djangoplicity.js');
  assert.ok(djm.FIRST.timeoutMs + djm.FALLBACK.timeoutMs < 25000);
  const h = recording(fakeNet({ 'https://esahubble.org/images/potm/feed/': new Error('timeout'), 'https://esahubble.org/images/potm/': fixture('hubble-listing.html') }));
  const list = await dj.hubble.list(h, 6);
  assert.ok(list.length > 0);
  assert.deepEqual(h.seen, [['https://esahubble.org/images/potm/feed/', 8000], ['https://esahubble.org/images/potm/', 15000]]);
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

test('NOIRLab: feed item filled from its page, CC BY 4.0 credit line', () => {
  const [it] = dj.noirlab.fromFeed(fixture('noirlab-feed.xml'));
  assert.equal(it.title, 'Tucson Twinkling at Twilight');
  dj.noirlab.fill(it, fixture('noirlab-page.html'));
  assert.equal(it.line, 'Arizona · NOIRLab');
  assert.equal(src.creditLine(it), '© H. Stockebrand/KPNO/NOIRLab/NSF/AURA · CC BY 4.0');
  assert.equal(src.creditLine({ credit: 'Someone', license: '' }), '© Someone');
  assert.equal(src.creditLine({ credit: '' }), '');
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

test('every source has an id, label and list()', () => {
  assert.deepEqual(src.LIST.map((s) => s.id), ['hubble', 'webb', 'noirlab']);
  for (const s of src.LIST) { assert.equal(typeof s.list, 'function'); assert.ok(s.label); }
});
