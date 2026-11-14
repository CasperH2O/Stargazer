'use strict';
// The eyepiece (0.4.0, user 2026-11-14): while the picture loads, Jibo's eye turns into a telescope
// eyepiece that slowly searches the sky. Colours come from Jibo's own telescope animation art
// (jibo-anim-db-animations textures/emojis/telescope-*.png): slate barrel, cyan glass, white
// highlight. The eyepiece is drawn with plain Graphics only (no filters: the robot's GPU is weak).
//
//   var e = new Eyepiece(PIXI, layer, {x, y, r, rand});
//   e.setOffset(dx, dy)      // where it has wandered to (the stars inside move the other way)
//   e.setProgress(0..1)      // the dial's ticks light up as loading goes on
//   e.setInterior(alpha)     // the black sky inside the lens (fades away for the focus pull)
//   e.update(dt); e.destroy();
var util = require('./util');

var PALETTE = {
    cyanLight: 0x22EEFF, cyan: 0x22DDEE, cyanMid: 0x11CCDD, cyanDeep: 0x1188AA,
    slateLight: 0x555566, slate: 0x444455, edge: 0x333344, deep: 0x222233, white: 0xFFFFFF
};
var TICKS = 60;

function Eyepiece(PIXI, layer, opts) {
    var r = this.r = opts.r || 150, rand = opts.rand || Math.random;
    this.x0 = opts.x; this.y0 = opts.y; this.progress = 0; this.shownProgress = 0; this.litDrawn = -1; this.t = 0; this.drift = 0; this.dx = 0; this.dy = 0;
    var c = this.c = new PIXI.Container();
    c.position.set(this.x0, this.y0);

    // Soft cyan halo outside the barrel: rings only, so nothing tints the lens (the picture shows there).
    var halo = new PIXI.Graphics();
    for (var i = 0; i < 7; i++) { halo.lineStyle(9, PALETTE.cyanMid, 0.16 * (1 - i / 7)); halo.drawCircle(0, 0, r + 32 + i * 8); }
    c.addChild(halo);

    // The sky inside the lens: black, with stars that slide past while it searches.
    var sky = this.sky = new PIXI.Container();
    var black = this.black = new PIXI.Graphics();
    black.beginFill(0x000000, 1); black.drawCircle(0, 0, r + 1); black.endFill();
    var stars = this.stars = new PIXI.Graphics();
    for (var s = 0; s < 170; s++) {
        var sx = (rand() - 0.5) * 1700, sy = (rand() - 0.5) * 1150, big = rand() < 0.12;
        stars.beginFill(rand() < 0.15 ? PALETTE.cyanLight : PALETTE.white, 0.35 + rand() * 0.6);
        stars.drawCircle(sx, sy, big ? 2.6 : 1.1 + rand() * 0.9); stars.endFill();
    }
    var lensMask = this.lensMask = new PIXI.Graphics();
    lensMask.beginFill(0xffffff, 1); lensMask.drawCircle(0, 0, r); lensMask.endFill();
    stars.mask = lensMask;
    sky.addChild(black); sky.addChild(stars); sky.addChild(lensMask);
    c.addChild(sky);

    // The barrel: dark edge, slate ring, inner bevel, and a white highlight like the art's.
    var barrel = new PIXI.Graphics();
    barrel.lineStyle(26, PALETTE.slate, 1); barrel.drawCircle(0, 0, r + 13);
    barrel.lineStyle(4, PALETTE.edge, 1); barrel.drawCircle(0, 0, r + 27);
    barrel.lineStyle(4, PALETTE.slateLight, 1); barrel.drawCircle(0, 0, r + 2);
    barrel.lineStyle(4, PALETTE.white, 0.75); barrel.arc(0, 0, r + 15, Math.PI * 1.08, Math.PI * 1.36);
    barrel.lineStyle(3, PALETTE.cyanDeep, 0.9); barrel.drawCircle(0, 0, r - 1);   // the glass's cyan rim
    c.addChild(barrel);

    // The focus dial: ticks that turn like a focus knob; lit ones show how far loading has come.
    var dial = this.dial = new PIXI.Container();
    var ticks = new PIXI.Graphics();
    for (var k = 0; k < TICKS; k++) {
        var a = k / TICKS * Math.PI * 2, major = k % 5 === 0, r1 = r + 34, r2 = r + (major ? 50 : 43);
        ticks.lineStyle(major ? 4 : 3, PALETTE.slateLight, 1);
        ticks.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); ticks.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    }
    var lit = this.lit = new PIXI.Graphics();
    dial.addChild(ticks); dial.addChild(lit);
    c.addChild(dial);

    // The fixed index notch at the top.
    var notch = new PIXI.Graphics();
    notch.beginFill(PALETTE.cyanLight, 1);
    notch.moveTo(-9, -(r + 66)); notch.lineTo(9, -(r + 66)); notch.lineTo(0, -(r + 54)); notch.closePath(); notch.endFill();
    c.addChild(notch);

    layer.addChild(c);
    this.drawLit();
}
// Ticks light from the top, clockwise, in the dial's own frame (so they turn with it).
Eyepiece.prototype.drawLit = function () {
    var n = Math.round(util.clamp01(this.shownProgress) * TICKS), r = this.r;
    if (n === this.litDrawn || util.destroyed(this.lit)) return;
    this.litDrawn = n;
    var g = this.lit;
    g.clear();
    for (var k = 0; k < n; k++) {
        var a = -Math.PI / 2 + k / TICKS * Math.PI * 2, major = k % 5 === 0, r1 = r + 34, r2 = r + (major ? 50 : 43);
        g.lineStyle(major ? 4 : 3, k === n - 1 ? PALETTE.cyanLight : PALETTE.cyanMid, 1);
        g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    }
};
Eyepiece.prototype.setOffset = function (dx, dy) {
    if (util.destroyed(this.c)) return;
    this.dx = dx; this.dy = dy;
    this.c.position.set(this.x0 + dx, this.y0 + dy);
    this.stars.position.set(-dx * 1.15 + this.drift, -dy * 1.15);   // the sky slides past the other way
};
Eyepiece.prototype.setProgress = function (p) { this.progress = Math.max(this.progress, util.clamp01(p)); };
Eyepiece.prototype.setInterior = function (alpha) { if (!util.destroyed(this.sky)) this.sky.alpha = alpha; };
Eyepiece.prototype.setDial = function (rotation) { if (!util.destroyed(this.dial)) this.dial.rotation = rotation; };
Eyepiece.prototype.update = function (dt) {
    if (util.destroyed(this.c)) return;
    this.t += dt;
    this.drift = (this.t / 1000) * 6;                              // the sky turns slowly, too
    // Lit ticks catch up with the progress smoothly.
    this.shownProgress += (this.progress - this.shownProgress) * Math.min(1, dt / 350);
    if (this.progress - this.shownProgress < 0.002) this.shownProgress = this.progress;
    this.drawLit();
    this.setOffset(this.dx, this.dy);
};
Eyepiece.prototype.destroy = function () {
    if (this.stars && !util.destroyed(this.stars)) this.stars.mask = null;
    util.dispose(this.c, {children: true});
    this.c = null;
};

// How the eyepiece looks around while it searches (user, 2026-11-14: "move around a bit more"):
// it glides to a spot somewhere on the screen, pauses there as if looking, and moves on. Spots are
// random (seeded) inside an ellipse of ax x ay around the centre, never too close to the last one.
// Pure apart from the given rand (tested):  var path = new SearchPath(rand); path.at(tMs) ->
// {dx, dy, move: index of the glide in progress or just finished, moving: true while gliding}.
// opts: {ax, ay: half-widths of the ellipse; cy: its vertical centre (offset from the screen
// centre); from: where the eyepiece starts}. Spots must be apart sideways (the band can be flat).
function SearchPath(rand, opts) {
    opts = opts || {};
    this.rand = rand || Math.random;
    this.ax = opts.ax || 300; this.ay = opts.ay === undefined ? 100 : opts.ay; this.cy = opts.cy || 0;
    this.from = opts.from || {dx: 0, dy: 0};
    this.segs = []; this.end = 0; this.i = 0;
}
SearchPath.prototype.extend = function () {
    var last = this.segs[this.segs.length - 1], from = last ? last.to : this.from, to = null;
    for (var tries = 0; tries < 12; tries++) {
        var a = this.rand() * Math.PI * 2, k = 0.45 + 0.55 * Math.sqrt(this.rand());
        to = {dx: Math.cos(a) * k * this.ax, dy: this.cy + Math.sin(a) * k * this.ay};
        if (Math.abs(to.dx - from.dx) / this.ax >= 0.45) break;
    }
    var dist = Math.sqrt(Math.pow(to.dx - from.dx, 2) + Math.pow(to.dy - from.dy, 2));
    var move = 900 + dist * 2.2, hold = 350 + this.rand() * 700;
    this.segs.push({t0: this.end, t1: this.end + move, t2: this.end + move + hold, from: from, to: to});
    this.end += move + hold;
};
SearchPath.prototype.at = function (t) {
    while (this.end <= t) this.extend();
    if (!this.segs.length) this.extend();
    while (this.i < this.segs.length - 1 && this.segs[this.i].t2 <= t) this.i++;
    var g = this.segs[this.i], k = util.ease.inOutCubic(util.progress(t, g.t0, g.t1 - g.t0));
    return {dx: util.lerp(g.from.dx, g.to.dx, k), dy: util.lerp(g.from.dy, g.to.dy, k), move: this.i, moving: t < g.t1};
};

module.exports = {Eyepiece: Eyepiece, SearchPath: SearchPath, PALETTE: PALETTE, TICKS: TICKS};
