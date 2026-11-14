'use strict';
// NASA Image of the Day (RSS). The enclosure is the full original (often 8 MB+); NASA's media
// server resizes it with ?w=1280. Public domain; the credit lives on the linked page only, so
// the caption credits "NASA".
var t = require('./text');

var FEED = 'https://www.nasa.gov/feeds/iotd-feed/';
function parse(xml) {
    return t.items(xml).map(function (it) {
        var url = t.attr(it, 'enclosure', 'url');
        if (!url || !/\.(jpe?g|png|webp)(\?|$)/i.test(url)) return null;
        var link = t.plain(t.tag(it, 'link'));
        return {key: 'nasa-iotd:' + (t.plain(t.tag(it, 'guid')) || link), source: 'nasa-iotd', title: t.plain(t.tag(it, 'title')),
            line: 'NASA Image of the Day', credit: 'NASA', license: 'pd', description: t.sentences(t.plain(t.tag(it, 'description')), 2, 260),
            date: t.date(t.plain(t.tag(it, 'pubDate'))), link: link, imageUrl: url.split('?')[0] + '?w=1280', needsResolve: false};
    }).filter(Boolean);
}
module.exports = {
    id: 'nasa-iotd', label: 'NASA Image of the Day', short: 'NASA', parse: parse,
    list: function (net, count) {
        return net.text(FEED).then(function (xml) {
            var list = parse(xml);
            if (!list.length) throw Error('nasa_iotd_empty');
            return list.slice(0, count || 6);
        });
    }
};
