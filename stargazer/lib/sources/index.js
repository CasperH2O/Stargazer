'use strict';
// All picture sources by id, in the order the Sources menu shows them, plus the credit line.
var dj = require('./djangoplicity').SOURCES;
var LIST = [dj.hubble, dj.webb, dj.noirlab];
var BY_ID = {};
LIST.forEach(function (s) { BY_ID[s.id] = s; });

// The third caption line: "© Holder · CC BY 4.0", or "© Holder" when the item names no licence.
function creditLine(item) {
    var c = item.credit || '';
    if (!c) return '';
    return item.license ? '© ' + c + ' · ' + item.license : '© ' + c;
}
module.exports = {LIST: LIST, BY_ID: BY_ID, get: function (id) { return BY_ID[id]; }, creditLine: creditLine};
