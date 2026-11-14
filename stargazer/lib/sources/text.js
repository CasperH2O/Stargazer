'use strict';
// Small, forgiving text helpers for the sources' RSS and HTML. No DOM, so the same code runs in
// the Node tests and on the robot.

var ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
    ndash: '–', mdash: '—', hellip: '…', deg: '°', eacute: 'é', egrave: 'è', ouml: 'ö', uuml: 'ü', auml: 'ä', aacute: 'á', iacute: 'í', oacute: 'ó', ntilde: 'ñ', ccedil: 'ç'};
function decode(s) {
    return String(s == null ? '' : s).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, function (all, code) {
        if (code[0] === '#') {
            var n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
        }
        var e = ENTITIES[code.toLowerCase()];
        return e !== undefined ? e : all;
    });
}
// HTML (possibly escaped inside XML) to one line of plain text.
function plain(s) {
    var once = decode(s);
    if (/<[a-z\/!]/i.test(once)) once = once.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>/gi, ' ').replace(/<[^>]+>/g, ' ');
    return decode(once).replace(/\s+/g, ' ').replace(/\s+([,.;:!?)])/g, '$1').trim();
}
function tag(xml, name) {
    var m = String(xml).match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>'));
    return m ? m[1] : '';
}
function items(xml) { return String(xml).split(/<item[\s>]/).slice(1).map(function (s) { return s.split('</item>')[0]; }); }
// The cell after a "Key:" header cell (djangoplicity "About the Object" tables).
function row(html, key) {
    var m = String(html).match(new RegExp('<t[hd][^>]*>\\s*' + key + ':?\\s*</t[hd]>\\s*<td[^>]*>([\\s\\S]*?)</td>'));
    return m ? plain(m[1]).replace(/\s+([,\/])\s*/g, '$1 ').replace(/\/ /g, '/') : '';
}
// The first `count` sentences of a text, at most `max` characters. A sentence ends at . ! or ?
// followed by a space and a capital, unless the word before is an initial or a short
// abbreviation ("U.S.", "M. Libralato", "Dr.").
function sentences(s, count, max) {
    s = String(s || '').trim();
    var ends = 0, cut = s.length, re = /[.!?]["'’”)]?\s+(?=["'‘“(]?[A-Z0-9])/g, m;
    while ((m = re.exec(s))) {
        var before = s.slice(0, m.index).split(/\s+/).pop() || '';
        if (/^([A-Z]\.?)+$/.test(before.replace(/\.$/, '') + '') && before.replace(/[^A-Za-z]/g, '').length <= 2) continue;
        if (/^(Dr|Mr|Mrs|Ms|St|Jr|Sr|vs|etc|No|Vol|Fig|approx|ca)$/i.test(before)) continue;
        if (++ends === count) { cut = m.index + m[0].trimRight().length; break; }
    }
    var out = s.slice(0, cut).trim();
    if (out.length > max) out = out.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
    return out;
}
function date(value) { var t = Date.parse(String(value || '').replace(/(\d)\.(\s)/, '$1$2')); return isFinite(t) ? t : 0; }

module.exports = {decode: decode, plain: plain, tag: tag, items: items, row: row, sentences: sentences, date: date};
