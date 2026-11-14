'use strict';
// Jibo's eye, drawn by the skill (a skill view hides the real one), and the "look up" glance:
// the eye rises and stretches towards the sky, holds, and settles back before the reveal.
// The robot's head movement is not done here: LookUp calls opts.onMove('up' | 'centre') and the
// screen wires that to the body (phase 2 spike), so the effect works the same without a body.
var util = require('./util');

function Eye(PIXI, layer, opts) {
    this.x0 = opts.x; this.y0 = opts.y; this.r = opts.r || 150;
    this.c = new PIXI.Container(); this.c.position.set(this.x0, this.y0);
    this.glow = new PIXI.Graphics();
    for (var i = 6; i >= 1; i--) { this.glow.beginFill(0x9fd2ff, 0.035 * (7 - i)); this.glow.drawCircle(0, 0, this.r + i * 9); this.glow.endFill(); }
    this.disc = new PIXI.Graphics(); this.disc.beginFill(0xffffff, 1); this.disc.drawCircle(0, 0, this.r); this.disc.endFill();
    this.c.addChild(this.glow); this.c.addChild(this.disc);
    layer.addChild(this.c);
}
Eye.prototype.set = function (dx, dy, sx, sy) { this.c.position.set(this.x0 + dx, this.y0 + dy); this.c.scale.set(sx, sy); };
Eye.prototype.destroy = function () { if (this.c) { if (this.c.parent) this.c.parent.removeChild(this.c); this.c.destroy({children: true}); this.c = null; } };

// Offsets of the glance at time t (ms): pure, tested.
function glanceAt(t, duration, rise) {
    var k = util.clamp01(t / duration);
    var up;
    if (k < 0.35) up = util.ease.outCubic(k / 0.35);
    else if (k < 0.6) up = 1;
    else up = 1 - util.ease.inOutCubic((k - 0.6) / 0.4);
    // stretch while moving, a small squash on arrival at the top
    var moving = k < 0.35 ? Math.sin(Math.PI * k / 0.35) : k >= 0.6 ? Math.sin(Math.PI * (k - 0.6) / 0.4) : 0;
    return {dy: -rise * up, sx: 1 - 0.08 * moving, sy: 1 + 0.1 * moving - (k >= 0.35 && k < 0.45 ? 0.06 * Math.sin(Math.PI * (k - 0.35) / 0.1) : 0)};
}

function LookUp(eye, opts) {
    opts = opts || {};
    this.eye = eye; this.duration = opts.duration || 1100; this.rise = opts.rise || 120;
    this.onMove = opts.onMove || function () {};
    this.t = 0; this.done = false; this.sent = 0;
}
LookUp.prototype.update = function (dt) {
    if (this.done) return true;
    if (this.sent === 0) { this.sent = 1; this.onMove('up'); }
    this.t = Math.min(this.duration, this.t + dt);
    if (this.sent === 1 && this.t >= this.duration * 0.6) { this.sent = 2; this.onMove('centre'); }
    var g = glanceAt(this.t, this.duration, this.rise);
    this.eye.set(0, g.dy, g.sx, g.sy);
    if (this.t >= this.duration) this.done = true;
    return this.done;
};

module.exports = { Eye: Eye, LookUp: LookUp, glanceAt: glanceAt };
