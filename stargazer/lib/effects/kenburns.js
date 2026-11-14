'use strict';
// Ken Burns: a slow pan and zoom across a still picture. The picture always covers the screen.
// plan() is pure (tested); at() turns a plan and a time into a sprite transform (anchor 0.5).
var util = require('./util');

// img {w,h}, view {w,h}, rand () -> 0..1, opts {duration ms, zoom [min,max], from (previous end state)}
function plan(img, view, rand, opts) {
    opts = opts || {};
    var cover = Math.max(view.w / img.w, view.h / img.h);
    var zoomMin = (opts.zoom && opts.zoom[0]) || 1.04, zoomMax = (opts.zoom && opts.zoom[1]) || 1.22;
    var tall = img.h * cover > view.h * 1.25, wide = img.w * cover > view.w * 1.25;

    function half(z) { return {hw: view.w / 2 / (cover * z), hh: view.h / 2 / (cover * z)}; }
    // A centre (in image pixels) that keeps the visible window inside the picture; u,v in 0..1.
    function centre(z, u, v) {
        var w = half(z);
        return {cx: util.lerp(w.hw, img.w - w.hw, u), cy: util.lerp(w.hh, img.h - w.hh, v)};
    }
    var zoomIn = rand() < 0.5;
    var zIn = util.lerp(zoomMin, zoomMin + 0.06, rand()), zOut = util.lerp(zoomMax - 0.08, zoomMax, rand());
    var z0 = zoomIn ? zIn : zOut, z1 = zoomIn ? zOut : zIn;
    var u0, v0, u1, v1;
    if (tall) {            // portrait: travel along the long side, top to bottom or back
        var down = rand() < 0.5;
        u0 = 0.4 + 0.2 * rand(); u1 = 0.4 + 0.2 * rand(); v0 = down ? 0.05 : 0.95; v1 = down ? 0.95 : 0.05;
    } else if (wide) {     // panorama: travel sideways
        var right = rand() < 0.5;
        v0 = 0.4 + 0.2 * rand(); v1 = 0.4 + 0.2 * rand(); u0 = right ? 0.05 : 0.95; u1 = right ? 0.95 : 0.05;
    } else {               // drift between two random spots, biased towards the middle
        u0 = 0.2 + 0.6 * rand(); v0 = 0.2 + 0.6 * rand(); u1 = 0.2 + 0.6 * rand(); v1 = 0.2 + 0.6 * rand();
    }
    var from;
    if (opts.from) from = {z: opts.from.z, cx: opts.from.cx, cy: opts.from.cy};
    else { var c0 = centre(z0, u0, v0); from = {z: z0, cx: c0.cx, cy: c0.cy}; }
    var c1 = centre(z1, u1, v1);
    return {
        img: {w: img.w, h: img.h}, view: {w: view.w, h: view.h}, cover: cover,
        duration: opts.duration || 24000, from: from, to: {z: z1, cx: c1.cx, cy: c1.cy}
    };
}

// The visible state at time t (ms) as {z, cx, cy} and the matching sprite transform.
function at(p, t) {
    var k = util.ease.inOutSine(util.clamp01(t / p.duration));
    var z = util.lerp(p.from.z, p.to.z, k), cx = util.lerp(p.from.cx, p.to.cx, k), cy = util.lerp(p.from.cy, p.to.cy, k);
    var s = p.cover * z;
    return {z: z, cx: cx, cy: cy, scale: s, x: p.view.w / 2 - (cx - p.img.w / 2) * s, y: p.view.h / 2 - (cy - p.img.h / 2) * s};
}

// Runs plans back to back on a sprite: when one ends the next starts from where it stopped.
function Runner(sprite, img, view, rand, opts) {
    this.sprite = sprite; this.img = img; this.view = view; this.rand = rand; this.opts = opts || {};
    this.t = 0; this.plan = plan(img, view, rand, this.opts);
    this.apply();
}
Runner.prototype.apply = function () {
    var s = at(this.plan, this.t);
    if (!this.sprite || this.sprite._destroyed || !this.sprite.transform) return s;   // its picture has gone
    this.sprite.anchor.set(0.5); this.sprite.scale.set(s.scale); this.sprite.position.set(s.x, s.y);
    return s;
};
Runner.prototype.update = function (dt) {
    this.t += dt;
    if (this.t >= this.plan.duration) {
        var end = at(this.plan, this.plan.duration);
        this.plan = plan(this.img, this.view, this.rand, {duration: this.opts.duration, zoom: this.opts.zoom, from: end});
        this.t = 0;
    }
    return this.apply();
};

module.exports = { plan: plan, at: at, Runner: Runner };
