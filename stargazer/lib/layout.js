'use strict';
// Classic Jibo look for Stargazer's menus: tokens and pure geometry for 1280x720 (the paging
// and fitting helpers come from the Bluetooth skill by the same author).
// Colours, sizes and fonts come from the jibo-ui-classic style guide (ui/jibo-ui-classic).
// Values marked PROPOSED are not stock; see DESIGN-NOTES.md. No PIXI or DOM here, so it is
// unit tested directly. Runs on the robot's Node 6: ES2015 only.

var color = {
    text: '#FFFFFF', muted: '#BBC6CA', caption: '#828191', danger: '#FD362F', success: '#A3FF4A',
    accent: '#25F2FB', track: '#21202B', thumb: '#37364A', warning: '#FF892F', sky: '#D6E2FF'
};
// Stock gradient pairs [highlight, shadow] (tokens color.tileGradients).
var pairs = {
    blue: [0x3765AB, 0x1A2563], cyan: [0x25F2FB, 0x107799], grey: [0xBBC6CA, 0x434D55],
    confirm: [0xA3FF4A, 0x2A7922], cancel: [0xFD362F, 0x990024], neutral: [0x58586D, 0x282735],
    space: [0x3765AB, 0x1A2563]   // Stargazer's tiles (manifest buttonColor)
};
var font = {title: 'Proxima Nova Soft', body: 'Proxima Nova Light'};

var screen = {width: 1280, height: 720};
// Title 80 bold (stock dialog title size). Status line(s) under it: PROPOSED.
var title = {x: 640, y: 88, size: 80, width: 1120};
var status = {one: {y: 174, size: 45}, two: {y: [162, 206], size: 36}, width: 1120};
// Tile row: stock 330x300 SkillButtons and 50 px labels; x 120 + i*355 keeps the row inside
// the conservative safe area (x 120-1160). PROPOSED: stock MenuView uses 112.5 + i*362.5, y 276.
var tiles = {x: 120, y: 230, width: 330, height: 300, step: 355, perPage: 3,
    label: {y: 590, size: 50, min: 40, width: 320}, caption: {y: 642, size: 36, width: 330},
    badge: {x: 236, y: 8, size: 84}, dim: 0.38,
    // Two tiles (settings) are centred as a pair.
    pair: [297.5, 652.5],
    // A drag past `flip` px turns one page (stock List.PAN_THRESHOLD); `slop` is the tap threshold.
    flip: 150, resistance: 0.3, stretch: 120,
    spring: {stiffness: 0.1, damping: 0.6, rest: 0.5, step: 1000 / 60}};
// Stock pager bar (extracted): 1190x10 at (45, 670), thumb = one page.
var pager = {x: 45, y: 670, width: 1190, height: 10};
// Dialog: stock 264 ActionButtons centred at x 370 / 900; y-centre 460 (PROPOSED, stock 480
// reaches y 612, below the 600 px safe line). Cancel / destructive left, confirm right.
var dialog = {button: 264, left: 370, right: 900, centre: 640, y: 460, single: 468, caption: 640, captionSize: 45,
    body: {y: 140, size: 45, line: 56, width: 1060}, large: {y: 206, size: 50, line: 62, width: 1060},
    code: {y: 266, size: 120}};
// Info overlay: title, meta line, description (3 lines), credit, one 150 px Settings button.
var info = {title: {y: 82, size: 60}, meta: {y: 146, size: 36}, body: {y: 190, size: 36, line: 47, width: 980, lines: 3},
    credit: {y: 352, size: 30}, buttons: {y: 480, size: 150, x: 640}, caption: {y: 582, size: 36}};
var hint = {y: 664, size: 30};

// Paging with the stock back-fill: the last page is always full (it repeats earlier items).
function pages(count) { return Math.max(1, Math.ceil(count / tiles.perPage)); }
function pageStart(page, count) { return Math.max(0, Math.min(page * tiles.perPage, count - tiles.perPage)); }
function pageOf(start, count) {
    for (var p = pages(count) - 1; p > 0; --p) if (start >= pageStart(p, count)) return p;
    return 0;
}
// Clamp a start index to a real page start after the list changed.
function clampStart(start, count) { return pageStart(pageOf(Math.max(0, start), count), count); }
function pagerBar(start, count) {
    var count_ = pages(count);
    if (count_ < 2) return null;
    var page = pageOf(start, count), thumb = Math.round(pager.width / count_);
    return {track: {x: pager.x, y: pager.y, width: pager.width, height: pager.height},
        thumb: {x: pager.x + Math.round((pager.width - thumb) * page / (count_ - 1)), y: pager.y, width: thumb, height: pager.height}};
}
function slotX(k) { return tiles.x + k * tiles.step; }
// Follow the finger; past the first or last page the row only stretches.
function drag(delta, canBack, canForward) {
    if (delta > 0 && !canBack || delta < 0 && !canForward) return Math.max(-tiles.stretch, Math.min(tiles.stretch, delta * tiles.resistance));
    return Math.max(-tiles.step * tiles.perPage, Math.min(tiles.step * tiles.perPage, delta));
}
// -1 back a page, +1 forward, 0 stay.
function release(delta, canBack, canForward) {
    if (delta <= -tiles.flip && canForward) return 1;
    if (delta >= tiles.flip && canBack) return -1;
    return 0;
}
// One frame of a damped spring towards `target`; settles exactly on it.
function spring(state, target) {
    var s = tiles.spring, velocity = (state.velocity + (target - state.x) * s.stiffness) * s.damping, x = state.x + velocity;
    if (Math.abs(target - x) < s.rest && Math.abs(velocity) < s.rest) return {x: target, velocity: 0, settled: true};
    return {x: x, velocity: velocity, settled: false};
}

// Long names: shrink from `size` down to `min` px, then end in an ellipsis (PROPOSED; stock
// only shrinks). `measure(text, size)` returns the rendered width. Returns {text, size}.
function fit(value, width, size, min, measure) {
    value = String(value || '');
    for (var s = size; s >= min; --s) if (measure(value, s) <= width) return {text: value, size: s};
    var characters = Array.from(value), low = 0, high = characters.length;
    while (low < high) {
        var middle = Math.ceil((low + high) / 2);
        if (measure(characters.slice(0, middle).join('').trim() + '…', min) <= width) low = middle; else high = middle - 1;
    }
    return {text: low ? characters.slice(0, low).join('').trim() + '…' : '…', size: min};
}
module.exports = {
    color: color, pairs: pairs, font: font, screen: screen, title: title, status: status, tiles: tiles, pager: pager,
    dialog: dialog, info: info, hint: hint,
    pages: pages, pageStart: pageStart, pageOf: pageOf, clampStart: clampStart, pagerBar: pagerBar, slotX: slotX,
    drag: drag, release: release, spring: spring, fit: fit
};
