'use strict';
// Telescope iris: Jibo's eye becomes a round lens that opens up to show the picture.
// A circular Graphics mask grows from the eye's radius to the screen's half-diagonal, with a thin
// glowing ring at its edge. radiusAt() is pure (tested).
var util = require('./util');

function coverRadius(view, cx, cy) {
    var dx = Math.max(cx, view.w - cx), dy = Math.max(cy, view.h - cy);
    return Math.sqrt(dx * dx + dy * dy) + 4;
}

// Radius at time t (ms): a short "focus" breath (slightly smaller) then an eased opening.
function radiusAt(t, from, to, duration) {
    var breath = Math.min(240, duration * 0.2);
    if (t <= breath) return from * (1 - 0.12 * Math.sin(Math.PI * t / breath));
    var k = util.ease.inOutCubic(util.clamp01((t - breath) / (duration - breath)));
    return util.lerp(from, to, k);
}

// PIXI, target (the DisplayObject to reveal), layer (where mask and ring live), opts {view, cx, cy, from, duration}
function Iris(PIXI, target, layer, opts) {
    this.view = opts.view; this.cx = opts.cx; this.cy = opts.cy;
    this.from = opts.from; this.to = coverRadius(opts.view, opts.cx, opts.cy);
    this.duration = opts.duration || 1300; this.t = 0; this.done = false;
    this.mask = new PIXI.Graphics(); this.ring = new PIXI.Graphics();
    layer.addChild(this.mask); layer.addChild(this.ring);
    this.target = target; target.mask = this.mask;
    this.draw();
}
Iris.prototype.draw = function () {
    var r = radiusAt(this.t, this.from, this.to, this.duration);
    var k = util.clamp01(this.t / this.duration);
    this.mask.clear(); this.mask.beginFill(0xffffff, 1); this.mask.drawCircle(this.cx, this.cy, r); this.mask.endFill();
    this.ring.clear();
    var a = 1 - util.ease.inCubic(k);                        // the ring fades as the lens opens
    if (a > 0.01) {
        this.ring.lineStyle(14, 0x6fb7ff, 0.18 * a); this.ring.drawCircle(this.cx, this.cy, r + 6);
        this.ring.lineStyle(5, 0xd8ecff, 0.85 * a); this.ring.drawCircle(this.cx, this.cy, r);
    }
    return r;
};
Iris.prototype.update = function (dt) {
    if (this.done) return true;
    this.t = Math.min(this.duration, this.t + dt);
    this.draw();
    if (this.t >= this.duration) this.finish();
    return this.done;
};
Iris.prototype.finish = function () {
    if (this.done) return;
    this.done = true;
    if (this.target && this.target.mask === this.mask) this.target.mask = null;
    this.destroy();
};
Iris.prototype.destroy = function () {
    [this.mask, this.ring].forEach(function (g) { util.dispose(g); });
    this.mask = this.ring = null;
};

module.exports = { Iris: Iris, radiusAt: radiusAt, coverRadius: coverRadius };
