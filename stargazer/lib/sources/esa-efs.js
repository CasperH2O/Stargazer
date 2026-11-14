'use strict';
// ESA's weekly "Earth from Space". esa.int moved to a new site in 2026 and dropped its RSS feeds;
// its JSON search API still lists the series (relevance-sorted, so we sort by date). Only a
// 660 px preview is reachable (originals are ~27 MB), so this source is EXPERIMENTAL and off by
// default (decision D3). The credit and licence come from the picture's page.
var t = require('./text');

var SEARCH = 'https://www.esa.int/api/search?q=%22Earth%20from%20Space%22&category=multimedia&contentType=image&pageSize=60';
var SITE = 'https://www.esa.int';
var SATELLITE = /(Copernicus Sentinel-\d[A-Za-z]?|Sentinel-\d[A-Za-z]?|Pléiades Neo|Pleiades Neo|Landsat[- ]\d+|Proba-V|SMOS|CryoSat|Envisat|IRIDE|ISS)/;

function parse(data) {
    var results = data && data.hits && data.hits.images && data.hits.images.results || [];
    return results.filter(function (r) { return r && /^Earth from Space:/.test(r.title || '') && r.thumbnail && r.thumbnail.single; }).map(function (r) {
        var open = (r.cta || []).filter(function (c) { return c && c.label === 'Open' && c.url; })[0];
        var description = t.plain(r.description), sat = SATELLITE.exec(description);
        return {key: 'esa-efs:' + (r.mediaId || r.title), source: 'esa-efs', title: t.plain(r.title).replace(/^Earth from Space:\s*/, ''),
            line: 'Earth from Space' + (sat ? ' · ' + sat[1] : ''), credit: 'ESA', license: '', description: t.sentences(description, 2, 260),
            date: t.date(r.date), link: open ? SITE + open.url : SITE, imageUrl: r.thumbnail.single.url, needsResolve: !!open};
    }).sort(function (a, b) { return b.date - a.date; });
}
function fill(it, html) {
    var credit = /credits-text">([^<]*)</.exec(html), licence = /license">([^<]*)</g, m, found = '';
    while ((m = licence.exec(html))) { var v = t.plain(m[1]); if (v && !/^No ESA licen/i.test(v)) { found = v; break; } }
    if (credit) it.credit = t.plain(credit[1]);
    // "CC BY-SA 3.0 IGO or ESA Standard Licence": the open licence is the one that applies to us.
    it.license = found ? found.replace(/\s+or ESA Standard Licen[cs]e$/i, '') : '';
    it.needsResolve = false;
    return it;
}
module.exports = {
    id: 'esa-efs', label: 'ESA Earth from Space', short: 'ESA', experimental: true, parse: parse, fill: fill,
    list: function (net, count) {
        return net.json(SEARCH).then(function (data) {
            var list = parse(data);
            if (!list.length) throw Error('esa_efs_empty');
            return list.slice(0, count || 6);
        });
    },
    resolve: function (it, net) { return net.text(it.link).then(function (html) { return fill(it, html); }); }
};
