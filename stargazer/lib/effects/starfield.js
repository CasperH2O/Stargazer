'use strict';
// Starfield: a short "warp" of stars streaming out of Jibo's eye before the picture appears, and a
// few twinkling sparkles around the caption afterwards. One Graphics object each, redrawn per frame.
var util = require('./util');

function makeStars(n, rand) {
    var stars = [];
    for (var i = 0; i < n; i++) {
        stars.push({a: rand() * Math.PI * 2, d: 0.02 + rand() * 0.98, v: 0.6 + rand() * 1.4, size: 1 + rand() * 2.2, tint: rand() < 0.15 ? 0xbcd6ff : 0xffffff});
    }
    return stars;
}

// opts {view, cx, cy, n, duration, rand}
function Warp(PIXI, layer, opts) {
    this.view = opts.view; this.cx = opts.cx; this.cy = opts.cy;
    this.duration = opts.duration || 1200; this.t = 0; this.done = false;
    this.reach = Math.sqrt(this.view.w * this.view.w + this.view.h * this.view.h) / 2;
    this.stars = makeStars(opts.n || 220, opts.rand || Math.random);
    this.g = new PIXI.Graphics(); layer.addChild(this.g);
    this.draw();
}
// Stars accelerate outwards (speed ramps up), streaks lengthen, then everything fades.
Warp.prototype.draw = function () {
    var k = util.clamp01(this.t / this.duration);
    var speed = util.ease.inCubic(k);
    var fade = k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1;
    var g = this.g; g.clear();
    for (var i = 0; i < this.stars.length; i++) {
        var s = this.stars[i];
        var d = (s.d + speed * s.v * 1.6) % 1.15;               // 0..1.15 of the reach, wraps once
        var r = d * d * this.reach;                             // perspective: faster near the edge
        var len = 4 + speed * 160 * d * s.v;
        var ca = Math.cos(s.a), sa = Math.sin(s.a);
        var x1 = this.cx + ca * r, y1 = this.cy + sa * r, x0 = this.cx + ca * Math.max(0, r - len), y0 = this.cy + sa * Math.max(0, r - len);
        var a = fade * Math.min(1, d * 2.2);
        if (a < 0.02) continue;
        g.lineStyle(s.size * (0.6 + d), s.tint, a);
        g.moveTo(x0, y0); g.lineTo(x1, y1);
    }
};
Warp.prototype.update = function (dt) {
    if (this.done) return true;
    this.t = Math.min(this.duration, this.t + dt);
    this.draw();
    if (this.t >= this.duration) { this.done = true; this.destroy(); }
    return this.done;
};
Warp.prototype.destroy = function () { util.dispose(this.g); this.g = null; };

// Four-point sparkle polygon around (x, y) with arm length L.
function sparklePoints(x, y, L) {
    var w = L * 0.18;
    return [x, y - L, x + w, y - w, x + L, y, x + w, y + w, x, y + L, x - w, y + w, x - L, y, x - w, y - w];
}

// A handful of sparkles that pulse a few times around the given points, then fade out.
// points [{x, y, size, delay}], opts {duration}
function Twinkle(PIXI, layer, points, opts) {
    this.points = points; this.duration = (opts && opts.duration) || 3600; this.t = 0; this.done = false;
    this.g = new PIXI.Graphics(); layer.addChild(this.g);
    this.draw();
}
Twinkle.prototype.draw = function () {
    var g = this.g; g.clear();
    for (var i = 0; i < this.points.length; i++) {
        var p = this.points[i];
        var t = this.t - (p.delay || 0);
        if (t <= 0) continue;
        var life = this.duration - (p.delay || 0);
        var k = util.clamp01(t / life);
        var pulse = Math.pow(Math.sin(Math.PI * Math.min(1, t / 900)), 2) * (1 - k) + 0.35 * Math.sin(t / 140) * (1 - k);
        var L = p.size * Math.max(0, pulse);
        if (L < 1) continue;
        g.beginFill(0xffffff, Math.min(1, 0.4 + pulse)); g.drawPolygon(sparklePoints(p.x, p.y, L)); g.endFill();
        g.beginFill(0xbcd6ff, 0.25 * pulse); g.drawCircle(p.x, p.y, L * 0.45); g.endFill();
    }
};
Twinkle.prototype.update = function (dt) {
    if (this.done) return true;
    this.t = Math.min(this.duration, this.t + dt);
    this.draw();
    if (this.t >= this.duration) { this.done = true; this.destroy(); }
    return this.done;
};
Twinkle.prototype.destroy = Warp.prototype.destroy;

module.exports = { Warp: Warp, Twinkle: Twinkle, makeStars: makeStars, sparklePoints: sparklePoints };
