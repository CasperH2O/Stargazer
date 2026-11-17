'use strict';
// The info overlay's text: the title, the description in pages and the credit, broken into lines
// that fit the overlay's labels (layout.js has the maths), and which description page is showing.
var layout = require('./layout'), sources = require('./sources');
var I = layout.info;

class InfoPages {
    constructor() { this.reset(); }
    reset() { this.key = null; this.text = null; this.page = 0; this.count = 0; }
    // The overlay is closed: the next opening starts on the first page (the broken text is kept).
    close() { this.page = 0; this.count = 0; }
    // `item`'s text as {title: {lines, size}, pages: [[line]], credit: {lines, size}}, broken once per
    // picture; a new picture starts on page 1. `measure` is {title, body, credit}, the width
    // functions of the three labels (null while the labels are not built: this returns null too).
    prepare(item, measure) {
        var key = [item.key, item.title, item.description, item.credit, item.license].join('|');
        if (this.key !== key) {
            if (!measure.title || !measure.body || !measure.credit) return null;
            this.key = key;
            this.page = 0;
            this.text = {
                title: layout.wrapFit(item.title, I.title.width, I.title.size, I.title.min, I.title.lines, measure.title),
                pages: layout.paginate(layout.wrap(item.description, I.body.width, I.body.size, measure.body), I.body.lines, I.more.lines),
                credit: layout.wrapFit(sources.creditLine(item), I.credit.width, I.credit.size, I.credit.size, I.credit.lines, measure.credit)
            };
        }
        this.count = this.text.pages.length;
        this.page = Math.min(this.page, this.count - 1);
        return this.text;
    }
    canBack() { return this.page > 0; }
    canForward() { return this.page < this.count - 1; }
    // Moves one page (-1 or 1); false when there is none.
    turn(direction) {
        var page = this.page + direction;
        if (page < 0 || page >= this.count) return false;
        this.page = page;
        return true;
    }
}

module.exports = {InfoPages: InfoPages};
