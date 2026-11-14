'use strict';
// NASA EPIC: the whole sunlit Earth, photographed about a dozen times a day by DSCOVR from 1.5
// million km (published 2-3 days later). Of the latest day's frames we take the one whose centre
// is nearest to the robot's own longitude (from its time zone), so Jibo shows "his" side of the
// planet. The caption names the region under the centre and gives its coordinates.
// Public domain, credit "NASA EPIC Team".
var API = 'https://epic.gsfc.nasa.gov/api/natural';
var ARCHIVE = 'https://epic.gsfc.nasa.gov/archive/natural/';

// Coarse names by longitude band (EPIC's centre is always near the equator), then latitude.
function region(lat, lon) {
    if (lon >= -180 && lon < -110) return 'the Pacific Ocean';
    if (lon < -35) return lat > 15 ? 'North America' : lat < -10 ? 'South America' : 'the Americas';
    if (lon < -10) return 'the Atlantic Ocean';
    if (lon < 45) return lat > 35 ? 'Europe and Africa' : 'Africa and the Atlantic';
    if (lon < 75) return lat > 20 ? 'the Middle East and Asia' : 'the Indian Ocean';
    if (lon < 100) return lat > 15 ? 'India and Asia' : 'the Indian Ocean';
    if (lon < 125) return lat < -10 ? 'Australia' : 'Southeast Asia';
    if (lon < 155) return lat < -10 ? 'Australia and the Pacific' : 'East Asia and the Pacific';
    return 'the Pacific Ocean';
}
function degrees(v, positive, negative) { return Math.abs(Math.round(v)) + '°' + (Math.round(v) === 0 ? '' : v >= 0 ? positive : negative); }
// Longitude of noon in this time zone: UTC+1 -> 15°E.
function homeLongitude(offsetMinutes) { return -offsetMinutes / 60 * 15; }
function lonDistance(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

function pick(frames, longitude) {
    var best = null;
    frames.forEach(function (f) {
        var c = f && (f.centroid_coordinates || f.coords && f.coords.centroid_coordinates);
        if (!c || !f.image || !f.date) return;
        var d = lonDistance(c.lon, longitude);
        if (!best || d < best.d) best = {frame: f, c: c, d: d};
    });
    return best;
}
function parse(frames, offsetMinutes) {
    if (!Array.isArray(frames) || !frames.length) return [];
    var best = pick(frames, homeLongitude(offsetMinutes || 0));
    if (!best) return [];
    var f = best.frame, day = String(f.date).split(' ')[0].split('-');
    return [{key: 'epic:' + f.image, source: 'epic', title: 'Earth over ' + region(best.c.lat, best.c.lon),
        line: degrees(best.c.lat, 'N', 'S') + ' ' + degrees(best.c.lon, 'E', 'W') + ' · seen by DSCOVR from 1.5 million km',
        credit: 'NASA EPIC Team', license: 'pd',
        description: 'The whole sunlit side of Earth, photographed by NASA\'s EPIC camera on the DSCOVR spacecraft, a million miles away, on ' + day.join('-') + '.',
        date: Date.parse(day.join('-') + 'T12:00:00Z') || 0, link: 'https://epic.gsfc.nasa.gov/',
        imageUrl: ARCHIVE + day[0] + '/' + day[1] + '/' + day[2] + '/jpg/' + f.image + '.jpg', needsResolve: false}];
}
module.exports = {
    id: 'epic', label: 'Earth (NASA EPIC)', short: 'NASA EPIC', parse: parse, region: region, homeLongitude: homeLongitude,
    list: function (net) {
        return net.json(API).then(function (frames) {
            var list = parse(frames, new Date().getTimezoneOffset());
            if (!list.length) throw Error('epic_empty');
            return list;
        });
    }
};
