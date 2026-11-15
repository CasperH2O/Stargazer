'use strict';
// The telescope eyepiece that searches the sky while the picture loads. Colours come from Jibo's
// own telescope animation art: slate barrel, cyan glass, white highlight. What it looks at (stars
// over a grassy horizon) stays put on the screen while the lens moves over it: it starts with the
// grass along the bottom of the lens and rises to the sky, where the grass is out of view. The grass has the
// shape of Jibo's jiboji grass (grass-mound) in night greens from his tree emoji. Plain Graphics
// only (no filters: the robot's GPU is weak).
//
//   var e = new Eyepiece(PIXI, layer, {x, y, r, rand, horizon});   // horizon: px below the start centre
//   e.setOffset(dx, dy)      // where it has wandered to (the scene inside stays put)
//   e.setProgress(0..1)      // the dial's ticks light up as loading goes on
//   e.setInterior(alpha)     // the black sky inside the lens (fades away for the focus pull)
//   e.update(dt); e.destroy();
var util = require('./util');

var PALETTE = {
    cyanLight: 0x22EEFF, cyan: 0x22DDEE, cyanMid: 0x11CCDD, cyanDeep: 0x1188AA,
    slateLight: 0x555566, slate: 0x444455, edge: 0x333344, deep: 0x222233, white: 0xFFFFFF
};
// Night grass, from the horizon down: the bottom of the canopy in emojis/hf/tree.png, into the
// darkest shadow under it.
var GRASS = [0x2D6A22, 0x194D12, 0x12470A, 0x073F00];
var TIP = 6.5;          // the tallest blade tip above the horizon
var TICKS = 60;

function mix(a, b, k) {
    var r = Math.round(util.lerp(a >> 16, b >> 16, k)), g = Math.round(util.lerp((a >> 8) & 255, (b >> 8) & 255, k)), bl = Math.round(util.lerp(a & 255, b & 255, k));
    return (r << 16) | (g << 8) | bl;
}
// The grass in its own frame: the horizon at y 0, a row of small blade tips above it like
// grass-mound's, and a gradient down through GRASS. Its own seed, so the search path's random
// numbers stay as they were.
function drawGrass(g, r) {
    var rand = util.rng(20171), W = 800, DEPTH = 2 * r, BAND = 4, FADE = 0.4 * r;
    g.beginFill(GRASS[0], 1);
    var pts = [-W, 4], x = -W;
    while (x < W) {
        pts.push(x, 0);
        x += 2 + rand() * 2.5; pts.push(x, -(2 + rand() * (TIP - 2)));
        x += 2 + rand() * 2.5;
    }
    pts.push(W, 0, W, 4);
    g.drawPolygon(pts); g.endFill();
    for (var y = 0; y < DEPTH; y += BAND) {
        var k = util.clamp01(y / FADE) * (GRASS.length - 1), i = Math.min(GRASS.length - 2, Math.floor(k));
        g.beginFill(mix(GRASS[i], GRASS[i + 1], k - i), 1);
        g.drawRect(-W, y, 2 * W, BAND + 1); g.endFill();
    }
}

function Eyepiece(PIXI, layer, opts) {
    var r = this.r = opts.r || 150, rand = opts.rand || Math.random;
    this.x0 = opts.x; this.y0 = opts.y;     // the centre it wanders from
    this.dx = 0; this.dy = 0;               // where it has wandered to
    this.progress = 0;                      // loading progress, 0..1
    this.shownProgress = 0;                 // the lit ticks catch up with it smoothly
    this.litDrawn = -1;                     // lit tick count last drawn
    var c = this.c = new PIXI.Container();
    c.position.set(this.x0, this.y0);

    // Soft cyan halo outside the barrel: rings only, so nothing tints the lens (the picture shows there).
    var halo = new PIXI.Graphics();
    for (var i = 0; i < 7; i++) {
        halo.lineStyle(9, PALETTE.cyanMid, 0.16 * (1 - i / 7));
        halo.drawCircle(0, 0, r + 32 + i * 8);
    }
    c.addChild(halo);

    // The sky inside the lens: black, and the scene (stars, grass) that the lens moves over.
    var sky = this.sky = new PIXI.Container();
    var black = this.black = new PIXI.Graphics();
    black.beginFill(0x000000, 1); black.drawCircle(0, 0, r + 1); black.endFill();
    var stars = this.stars = new PIXI.Graphics();
    for (var s = 0; s < 170; s++) {
        var sx = (rand() - 0.5) * 1700, sy = (rand() - 0.5) * 1150, big = rand() < 0.12;
        stars.beginFill(rand() < 0.15 ? PALETTE.cyanLight : PALETTE.white, 0.35 + rand() * 0.6);
        stars.drawCircle(sx, sy, big ? 2.6 : 1.1 + rand() * 0.9); stars.endFill();
    }
    var ground = this.ground = new PIXI.Graphics();
    drawGrass(ground, r);
    ground.position.y = opts.horizon || 0;
    var scene = this.scene = new PIXI.Container();
    scene.addChild(stars); scene.addChild(ground);
    var lensMask = this.lensMask = new PIXI.Graphics();
    lensMask.beginFill(0xffffff, 1); lensMask.drawCircle(0, 0, r); lensMask.endFill();
    scene.mask = lensMask;
    sky.addChild(black); sky.addChild(scene); sky.addChild(lensMask);
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
    this.scene.position.set(-dx, -dy);      // the lens moves, the scene stays put
};
Eyepiece.prototype.setProgress = function (p) { this.progress = Math.max(this.progress, util.clamp01(p)); };
Eyepiece.prototype.setInterior = function (alpha) { if (!util.destroyed(this.sky)) this.sky.alpha = alpha; };
Eyepiece.prototype.setDial = function (rotation) { if (!util.destroyed(this.dial)) this.dial.rotation = rotation; };
Eyepiece.prototype.update = function (dt) {
    if (util.destroyed(this.c)) return;
    // Lit ticks catch up with the progress smoothly.
    this.shownProgress += (this.progress - this.shownProgress) * Math.min(1, dt / 350);
    if (this.progress - this.shownProgress < 0.002) this.shownProgress = this.progress;
    this.drawLit();
    this.setOffset(this.dx, this.dy);
};
Eyepiece.prototype.destroy = function () {
    if (this.scene && !util.destroyed(this.scene)) this.scene.mask = null;
    util.dispose(this.c, {children: true});
    this.c = null;
};

// How the eyepiece looks around while it searches: it glides to a spot, pauses there as if
// looking, and moves on. Spots are random (seeded) inside an ellipse and always well apart sideways.
//   var path = new SearchPath(rand, {ax, ay, cy, from});   // ax, ay: half-widths; cy: the ellipse's
//                                                           // vertical offset; from: start {dx, dy}
//   path.at(tMs) -> {dx, dy, move: index of the current glide, moving: true while gliding}
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

module.exports = {Eyepiece: Eyepiece, SearchPath: SearchPath, PALETTE: PALETTE, GRASS: GRASS, TIP: TIP, TICKS: TICKS};
