'use strict';
// The classic Jibo look for Stargazer's menus: tokens and pure geometry for the 1280x720 screen.
// Colours, sizes and fonts come from the jibo-ui-classic style guide; values marked PROPOSED are
// not stock. No PIXI or DOM here.

var color = {
    text: '#FFFFFF', muted: '#BBC6CA', caption: '#828191', danger: '#FD362F', success: '#A3FF4A',
    accent: '#25F2FB', track: '#21202B', thumb: '#37364A', warning: '#FF892F'
};
// Stock gradient pairs [highlight, shadow] (tokens color.tileGradients).
var pairs = {
    grey: [0xBBC6CA, 0x434D55],
    confirm: [0xA3FF4A, 0x2A7922],
    space: [0x3765AB, 0x1A2563]   // Stargazer's tiles (manifest buttonColor)
};
var font = {title: 'Proxima Nova Soft', body: 'Proxima Nova Light'};

// Title 80 bold (stock dialog title size). The status line under it: PROPOSED.
var title = {x: 640, y: 88, size: 80, width: 1120};
var status = {one: {y: 174, size: 45}, width: 1120};
// Tile row: stock 330x300 SkillButtons and 50 px labels; x 120 + i*355 keeps the row inside
// the conservative safe area (x 120-1160). PROPOSED: stock MenuView uses 112.5 + i*362.5, y 276.
var tiles = {
    x: 120, y: 230, width: 330, step: 355, perPage: 3,
    label: {y: 590, size: 50, min: 40, width: 320},
    caption: {y: 642, size: 36, width: 330},
    dim: 0.38,
    // A drag past `flip` px turns one page (stock List.PAN_THRESHOLD). Past the first or last
    // page the row follows the finger at `resistance`, up to `stretch` px.
    flip: 150, resistance: 0.3, stretch: 120,
    spring: {stiffness: 0.1, damping: 0.6, rest: 0.5, step: 1000 / 60}
};
// Stock pager bar: 1190x10 at (45, 670), thumb = one page.
var pager = {x: 45, y: 670, width: 1190, height: 10};
// Dialog (the offline screen): one stock 264 px ActionButton centred at y 468 (PROPOSED: stock
// 480 reaches below the 600 px safe line), its caption under it, and a two-line message.
var dialog = {button: 264, y: 460, single: 468, caption: 640, captionSize: 45,
    large: {y: 206, size: 50, line: 62, width: 1060}};
// Info overlay: a small gear button in the top right corner (inside the safe area), the title (up
// to 2 lines, shrinking from `size` to `min`), a meta line, and the description in pages that
// are word-wrapped to fit: page 1 under the meta line (5 lines, then the credit), later pages
// higher up (8 lines, no meta or credit). A horizontal pan turns the page, like a menu list.
var info = {
    gear: {x: 1108, y: 74, size: 104},
    title: {x: 640, y: 82, size: 54, min: 44, line: 60, lines: 2, width: 780},
    meta: {y: 180, size: 36, min: 30, width: 980},
    body: {x: 150, y: 214, size: 36, line: 47, width: 980, lines: 5},
    more: {x: 150, y: 170, size: 36, line: 47, width: 980, lines: 8},
    credit: {y: 475, size: 30, line: 38, width: 980, lines: 2},
    // A new page slides in from `enter` px aside and fades in; a page being dragged fades out
    // over `fade` px.
    enter: 300, fade: 360
};

// Paging with the stock back-fill: the last page is always full (it repeats earlier items).
function pages(count) { return Math.max(1, Math.ceil(count / tiles.perPage)); }
function pageStart(page, count) { return Math.max(0, Math.min(page * tiles.perPage, count - tiles.perPage)); }
function pageOf(start, count) {
    for (var p = pages(count) - 1; p > 0; --p) {
        if (start >= pageStart(p, count)) return p;
    }
    return 0;
}
// Clamp a start index to a real page start after the list changed.
function clampStart(start, count) { return pageStart(pageOf(Math.max(0, start), count), count); }
function pagerBar(start, count) { return pagerAt(pageOf(start, count), pages(count)); }
// The pager bar with the thumb on page `page` of `pageCount` (null for a single page).
function pagerAt(page, pageCount) {
    if (pageCount < 2) return null;
    var thumb = Math.round(pager.width / pageCount);
    return {
        track: {x: pager.x, y: pager.y, width: pager.width, height: pager.height},
        thumb: {x: pager.x + Math.round((pager.width - thumb) * page / (pageCount - 1)), y: pager.y, width: thumb, height: pager.height}
    };
}
function slotX(k) { return tiles.x + k * tiles.step; }
// Follow the finger; past the first or last page the row only stretches.
function drag(delta, canBack, canForward) {
    var blocked = delta > 0 && !canBack || delta < 0 && !canForward;
    if (blocked) return Math.max(-tiles.stretch, Math.min(tiles.stretch, delta * tiles.resistance));
    var limit = tiles.step * tiles.perPage;
    return Math.max(-limit, Math.min(limit, delta));
}
// -1 back a page, +1 forward, 0 stay.
function release(delta, canBack, canForward) {
    if (delta <= -tiles.flip && canForward) return 1;
    if (delta >= tiles.flip && canBack) return -1;
    return 0;
}
// One frame of a damped spring towards `target`; settles exactly on it.
function spring(state, target) {
    var s = tiles.spring;
    var velocity = (state.velocity + (target - state.x) * s.stiffness) * s.damping, x = state.x + velocity;
    if (Math.abs(target - x) < s.rest && Math.abs(velocity) < s.rest) return {x: target, velocity: 0, settled: true};
    return {x: x, velocity: velocity, settled: false};
}

// Long names: shrink from `size` down to `min` px, then end in an ellipsis (PROPOSED; stock
// only shrinks). `measure(text, size)` returns the rendered width. Returns {text, size}.
function fit(value, width, size, min, measure) {
    value = String(value || '');
    for (var s = size; s >= min; --s) {
        if (measure(value, s) <= width) return {text: value, size: s};
    }
    var characters = Array.from(value), low = 0, high = characters.length;
    while (low < high) {
        var middle = Math.ceil((low + high) / 2);
        if (measure(characters.slice(0, middle).join('').trim() + '…', min) <= width) low = middle;
        else high = middle - 1;
    }
    return {text: low ? characters.slice(0, low).join('').trim() + '…' : '…', size: min};
}

// Greedy word wrap into lines no wider than `width` at `size`. A word wider than a whole line is
// cut by characters.
function wrap(value, width, size, measure) {
    var words = String(value || '').split(/\s+/).filter(Boolean), lines = [], line = '';
    words.forEach(function (word) {
        var next = line ? line + ' ' + word : word;
        if (measure(next, size) <= width) { line = next; return; }
        if (line) { lines.push(line); line = ''; }
        var characters = Array.from(word);
        while (characters.length > 1 && measure(characters.join(''), size) > width) {
            // The most characters that still fit (at least one), found by bisection.
            var fits = 1, over = characters.length;
            while (over - fits > 1) {
                var middle = Math.floor((fits + over) / 2);
                if (measure(characters.slice(0, middle).join(''), size) <= width) fits = middle; else over = middle;
            }
            lines.push(characters.slice(0, fits).join(''));
            characters = characters.slice(fits);
        }
        line = characters.join('');
    });
    if (line) lines.push(line);
    return lines;
}
// Wrapped text in at most `maxLines` lines: the biggest size from `size` down to `min` where it
// fits, else the lines at `min` with the last one ending in an ellipsis. Returns {lines, size}.
function wrapFit(value, width, size, min, maxLines, measure) {
    var lines;
    for (var s = size; s >= min; --s) {
        lines = wrap(value, width, s, measure);
        if (lines.length <= maxLines) return {lines: lines, size: s};
    }
    lines = wrap(value, width, min, measure).slice(0, maxLines);
    var last = lines[maxLines - 1].replace(/[\s.,;:]+$/, '');
    lines[maxLines - 1] = fit(last + '…', width, min, min, measure).text;
    return {lines: lines, size: min};
}
// Lines split into pages: `first` lines on page 1, `rest` on each later page (always one page).
function paginate(lines, first, rest) {
    var pages = [lines.slice(0, first)], at = first;
    while (at < lines.length) { pages.push(lines.slice(at, at + rest)); at += rest; }
    return pages;
}

module.exports = {
    color: color, pairs: pairs, font: font, title: title, status: status, tiles: tiles, pager: pager,
    dialog: dialog, info: info,
    pages: pages, pageStart: pageStart, pageOf: pageOf, clampStart: clampStart, pagerBar: pagerBar, pagerAt: pagerAt, slotX: slotX,
    drag: drag, release: release, spring: spring, fit: fit, wrap: wrap, wrapFit: wrapFit, paginate: paginate
};
