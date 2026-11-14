'use strict';
// All picture sources by id, in the order the Sources menu shows them, plus the credit line.
var dj = require('./djangoplicity').SOURCES;
var LIST = [require('./apod'), dj.hubble, dj.webb, dj.eso, dj.noirlab, require('./nasa-iotd'), require('./epic'), require('./esa-efs')];
var BY_ID = {};
LIST.forEach(function (s) { BY_ID[s.id] = s; });

// The third caption line: public domain "Image: NASA", photographer's copyright "© Name",
// open licences "© Holder · CC BY 4.0".
function creditLine(item) {
    var c = item.credit || '';
    if (!c) return '';
    if (item.license === 'pd') return 'Image: ' + c;
    if (item.license && item.license !== 'copyright') return '© ' + c + ' · ' + item.license;
    return '© ' + c;
}
// The info overlay has room for three lines (about 170 characters at 36 px).
function short(description) { return require('./text').sentences(description, 2, 170); }
module.exports = {LIST: LIST, BY_ID: BY_ID, get: function (id) { return BY_ID[id]; }, creditLine: creditLine, short: short};
