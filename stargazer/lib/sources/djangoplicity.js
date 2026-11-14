'use strict';
// ESA/Hubble, ESA/Webb and NOIRLab run the same image archive (djangoplicity), so one module
// covers all three. The newest code comes from the RSS feed or, when the feed is stale or empty
// (Hubble's stopped at Dec 2025 when it went monthly; Webb's came back empty once), from the
// listing page. The image is the archive's 1280 px "screen" JPEG. Name, constellation, distance and
// the credit come from the image page when the picture is about to be shown (resolve).
// All three publish under CC BY 4.0, which needs the credit shown with the picture.
var t = require('./text');

// Together these stay under the catalog's 25 s per source, so a hanging feed still leaves time
// for the listing.
var FIRST = {timeoutMs: 8000}, FALLBACK = {timeoutMs: 15000};

var CODE = /\/images\/((?:potm|potw|iotw)\d{4}[a-z])\/?/;

// yymm or yyww as a sortable number: potm2610a -> 2610, potw2645a -> 2645.
function serial(code) { var m = /(\d{4})/.exec(code || ''); return m ? Number(m[1]) : 0; }

function create(spec) {
    // spec: {id, label, short, feed, listing, page (base URL for /images/<code>/), cdn, telescope}
    function item(code, title, date, description) {
        return {key: spec.id + ':' + code, source: spec.id, code: code, title: title || '', line: '', credit: '', license: 'CC BY 4.0',
            description: description || '', date: date || 0, link: spec.page + code + '/', imageUrl: spec.cdn + '/screen/' + code + '.jpg',
            needsResolve: true};
    }
    function fromFeed(xml) {
        return t.items(xml).map(function (it) {
            var link = t.plain(t.tag(it, 'link')), m = CODE.exec(link);
            if (!m) return null;
            var description = t.plain(t.tag(it, 'description')).replace(/^(potm|potw|iotw)\d+[a-z]?\s*-\s*/, '');
            var title = t.plain(t.tag(it, 'title'));
            // Some feeds (Webb) carry only "potm2610 - <title>": no description then.
            return item(m[1], title, t.date(t.plain(t.tag(it, 'pubDate'))), description === title ? '' : t.sentences(description, 2, 260));
        }).filter(Boolean);
    }
    function fromListing(html) {
        var seen = {}, out = [], re = new RegExp(CODE.source, 'g'), m;
        while ((m = re.exec(html))) if (!seen[m[1]]) { seen[m[1]] = true; out.push(item(m[1])); }
        return out;
    }
    return {
        id: spec.id, label: spec.label, short: spec.short, fromFeed: fromFeed, fromListing: fromListing,
        // Newest first, at most `count`; the listing is read only when the feed looks stale.
        list: function (net, count) {
            count = count || 6;
            var problems = [];
            return net.text(spec.feed, FIRST).catch(function (e) { problems.push('feed ' + (e && e.message || e)); return ''; }).then(function (xml) {
                var feed = fromFeed(xml);
                var newest = feed.length ? Math.max.apply(null, feed.map(function (i) { return i.date; })) : 0;
                var stale = !feed.length || Date.now() - newest > 45 * 24 * 3600 * 1000;
                if (!stale || !spec.listing) return feed;
                return net.text(spec.listing, FALLBACK).then(function (html) {
                    var listed = fromListing(html), known = {};
                    feed.forEach(function (i) { known[i.code] = true; });
                    return listed.filter(function (i) { return !known[i.code]; }).concat(feed);
                }, function (e) { problems.push('listing ' + (e && e.message || e)); return feed; });
            }).then(function (list) {
                if (!list.length) throw Error(spec.id + '_empty' + (problems.length ? ' (' + problems.join('; ') + ')' : ''));
                list.sort(function (a, b) { return serial(b.code) - serial(a.code) || b.date - a.date; });
                return list.slice(0, count);
            });
        },
        resolve: function (it, net) { return net.text(it.link).then(function (html) { return fill(it, html, spec); }); },
        fill: function (it, html) { return fill(it, html, spec); }
    };
}

// Reads the image page into the item: title (when the feed gave none), date, caption line and credit.
function fill(it, html, spec) {
    if (!it.title) it.title = t.plain((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html) || ['', ''])[1]);
    if (!it.date) it.date = t.date(t.row(html, 'Release date').replace(/,.*$/, ''));
    if (!it.description) {
        // The text starts with the first paragraph after the title.
        var h1 = html.indexOf('</h1>'), desc = h1 >= 0 ? /<p>([\s\S]*?)<\/p>/.exec(html.slice(h1)) : null;
        it.description = desc ? t.sentences(t.plain(desc[1]), 2, 260) : '';
    }
    var name = t.row(html, 'Name').split(', ')[0], constellation = t.row(html, 'Constellation');
    // A name that only repeats the constellation or is a category ("Arizona", "La Silla") still helps place it.
    var parts = [];
    if (name) parts.push(name);
    if (constellation && constellation !== name) parts.push(constellation);
    parts.push(spec.telescope);
    it.line = parts.join(' · ');
    var credit = /class="credit"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    it.credit = credit ? t.plain(credit[1]).replace(/Acknowledgements?:[\s\S]*$/i, '').replace(/\s+\//g, '/').trim() : spec.short;
    it.needsResolve = false;
    return it;
}

var SOURCES = {
    hubble: create({id: 'hubble', label: 'ESA/Hubble', short: 'ESA/Hubble', telescope: 'Hubble',
        feed: 'https://esahubble.org/images/potm/feed/', listing: 'https://esahubble.org/images/potm/',
        page: 'https://esahubble.org/images/', cdn: 'https://cdn.esahubble.org/archives/images'}),
    webb: create({id: 'webb', label: 'ESA/Webb', short: 'ESA/Webb', telescope: 'Webb',
        feed: 'https://esawebb.org/images/potm/feed/', listing: 'https://esawebb.org/images/potm/',
        page: 'https://esawebb.org/images/', cdn: 'https://cdn.esawebb.org/archives/images'}),
    noirlab: create({id: 'noirlab', label: 'NOIRLab', short: 'NOIRLab', telescope: 'NOIRLab',
        feed: 'https://noirlab.edu/public/images/iotw/feed/', listing: 'https://noirlab.edu/public/images/iotw/',
        page: 'https://noirlab.edu/public/images/', cdn: 'https://storage.noirlab.edu/media/archives/images'})
};

module.exports = {create: create, serial: serial, SOURCES: SOURCES, FIRST: FIRST, FALLBACK: FALLBACK};
