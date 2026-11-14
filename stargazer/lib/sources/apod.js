'use strict';
// NASA Astronomy Picture of the Day. The official API (api.nasa.gov) has been broken since
// Oct 2026 (HTTP 500, or the NASA logo for every date), so the community mirror apod.as93.net
// comes first and the official API is the fallback (decision D2). Only today's picture is
// available. Days with a video (media_type "video"/"other") are skipped. Many APOD pictures are
// the photographer's copyright, not NASA's public domain: the credit is always shown.
var t = require('./text');

var MIRROR = 'https://apod.as93.net/apod';
var OFFICIAL = 'https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY';

// Pictures on NASA's image service can be asked for at screen size.
function screenUrl(u) {
    if (/assets\.science\.nasa\.gov\/dynamicimage\//.test(u)) return u.split('?')[0] + '?w=1280&h=720&fit=clip';
    return u;
}
function cleanCredit(copyright) {
    return t.plain(copyright).replace(/\s*Image Credit\s*(&|and)?\s*Copyright:\s*/i, '').replace(/^.*Copyright:\s*/i, '').replace(/^©\s*/, '').trim();
}
function parse(j) {
    if (!j || typeof j !== 'object' || !j.title || !j.url) return [];
    if (j.media_type && j.media_type !== 'image') return [];
    // The broken official API answers with the NASA logo: never show that as a picture.
    if (/nasa-logo/i.test(j.url) || /^NASA Science$/.test(j.title)) return [];
    var credit = j.copyright ? cleanCredit(j.copyright) : 'NASA';
    return [{key: 'apod:' + (j.date || j.title), source: 'apod', title: t.plain(j.title),
        line: 'Astronomy Picture of the Day', credit: credit, license: j.copyright ? 'copyright' : 'pd',
        description: t.sentences(t.plain(j.explanation), 2, 260), date: t.date(j.date), link: 'https://apod.nasa.gov/apod/',
        imageUrl: screenUrl(j.url), needsResolve: false}];
}
module.exports = {
    id: 'apod', label: 'NASA APOD', short: 'NASA APOD', parse: parse, screenUrl: screenUrl,
    list: function (net) {
        return net.json(MIRROR).then(parse).catch(function () { return []; }).then(function (list) {
            return list.length ? list : net.json(OFFICIAL).then(parse);
        }).then(function (list) {
            if (!list.length) throw Error('apod_no_picture_today');
            return list;
        });
    }
};
