'use strict';
// Presents pictures with the chosen effects. It owns no timers: the screen drives update(dt) from
// the PIXI ticker (the effect videos drive it frame by frame). It owns no textures either: when a
// picture has left the screen it hands its texture back through opts.onRetire(texture).
//
//   var p = new Presenter(PIXI, root, {view, effects: {kenBurns, iris, lookUp, starfield},
//                                      seed, onLookUp, onRetire, onShown, showCaption});
//   p.show(texture, {title, line, credit});   // first call plays the intro, later calls cross-fade
//   p.update(dtMs); ... p.destroy();
var util = require('./effects/util');
var kenburns = require('./effects/kenburns');
var Iris = require('./effects/iris').Iris;
var starfield = require('./effects/starfield');
var lookup = require('./effects/lookup');
var Caption = require('./caption').Caption;

var EYE_R = 150;
var T = {lookUp: 1100, warp: 1300, iris: 1500, fade: 900, caption: 700, cross: 1200, captionOut: 300};

function Presenter(PIXI, root, opts) {
    this.PIXI = PIXI; this.root = root; this.opts = opts || {};
    this.view = this.opts.view || {w: 1280, h: 720};
    this.fx = this.opts.effects || {};
    this.rand = util.rng(this.opts.seed || Date.now());
    this.layers = {};
    ['back', 'pic', 'fx', 'cap'].forEach(function (k) { this.layers[k] = new PIXI.Container(); root.addChild(this.layers[k]); }, this);
    this.caption = new Caption(PIXI, this.layers.cap, this.view);
    this.now = 0; this.events = []; this.anims = []; this.current = null; this.shown = 0;
}

Presenter.prototype.at = function (delay, fn) { this.events.push({at: this.now + delay, fn: fn}); };
Presenter.prototype.run = function (anim) { this.anims.push(anim); return anim; };

// A sprite for the texture, placed by Ken Burns or statically (cover when it nearly fits, else
// contain over a blurred copy of itself).
Presenter.prototype.place = function (texture) {
    var PIXI = this.PIXI, view = this.view;
    var img = {w: texture.width, h: texture.height};
    var holder = new PIXI.Container();
    var sprite = new PIXI.Sprite(texture);
    var entry = {texture: texture, holder: holder, sprite: sprite, kb: null, back: null};
    if (this.fx.kenBurns) {
        entry.kb = new kenburns.Runner(sprite, img, view, this.rand, {duration: 24000});
    } else {
        var cover = Math.max(view.w / img.w, view.h / img.h), contain = Math.min(view.w / img.w, view.h / img.h);
        var nearly = contain / cover > 0.82;
        sprite.anchor.set(0.5); sprite.position.set(view.w / 2, view.h / 2); sprite.scale.set(nearly ? cover : contain);
        if (!nearly) entry.back = this.backdrop(texture, holder);
    }
    holder.addChild(sprite);
    return entry;
};

// Blurred backdrop without a filter: draw the picture into a tiny 2D canvas (two linear
// downscale steps, 1280 -> 160 -> 32) and stretch that back up. No renderer or shader needed.
Presenter.prototype.backdrop = function (texture, holder) {
    var PIXI = this.PIXI, view = this.view, img = texture.baseTexture && texture.baseTexture.source;
    var doc = this.opts.document || (typeof document !== 'undefined' ? document : null);
    if (!img || !doc) return null;
    var aspect = view.h / view.w;
    function canvas(w) { var c = doc.createElement('canvas'); c.width = w; c.height = Math.round(w * aspect); return c; }
    var mid = canvas(160), small = canvas(32);
    try {
        mid.getContext('2d').drawImage(img, 0, 0, mid.width, mid.height);
        small.getContext('2d').drawImage(mid, 0, 0, small.width, small.height);
    } catch (_) { return null; }
    var tex = PIXI.Texture.fromCanvas(small, PIXI.SCALE_MODES.LINEAR);
    var s = new PIXI.Sprite(tex); s.width = view.w; s.height = view.h; s.alpha = 0.42;
    holder.addChild(s);
    return {sprite: s, rt: tex};
};

Presenter.prototype.retire = function (entry) {
    if (!entry || entry.retired) return;
    entry.retired = true;
    if (entry.holder.parent) entry.holder.parent.removeChild(entry.holder);
    if (entry.back) entry.back.rt.destroy(true);
    entry.holder.destroy({children: true});            // sprites only; the texture goes back to the owner
    if (this.opts.onRetire) this.opts.onRetire(entry.texture);
};

Presenter.prototype.show = function (texture, info) {
    if (this.shown++ === 0) this.intro(texture, info); else this.next(texture, info);
};

// While the first picture loads: Jibo's eye with a slow "focusing" arc around it. The intro then
// starts from this same eye, so there is no jump.
Presenter.prototype.wait = function () {
    if (this.waiting || this.shown) return;
    var PIXI = this.PIXI, cx = this.view.w / 2, cy = this.view.h / 2;
    var eye = new lookup.Eye(PIXI, this.layers.fx, {x: cx, y: cy, r: EYE_R});
    var ring = new PIXI.Graphics(); ring.position.set(cx, cy); this.layers.fx.addChild(ring);
    ring.lineStyle(8, 0x21202B, 1); ring.drawCircle(0, 0, EYE_R + 30);
    ring.lineStyle(8, 0x9FD2FF, 1); ring.arc(0, 0, EYE_R + 30, -Math.PI / 2, 0);
    var self = this;
    this.waiting = {eye: eye, ring: ring};
    this.run({update: function (dt) {
        if (self.waiting && self.waiting.ring === ring) { ring.rotation += dt / 1000 * Math.PI; return false; }
        if (ring.parent) ring.parent.removeChild(ring); ring.destroy(); return true;
    }});
};

Presenter.prototype.intro = function (texture, info) {
    var self = this, fx = this.fx, PIXI = this.PIXI, view = this.view;
    var cx = view.w / 2, cy = view.h / 2;
    var entry = this.current = this.place(texture);
    this.caption.set(info);
    var waited = this.waiting; this.waiting = null;
    var useEye = fx.iris || fx.lookUp || fx.starfield || !!waited;
    var eye = waited ? waited.eye : useEye ? new lookup.Eye(PIXI, this.layers.fx, {x: cx, y: cy, r: EYE_R}) : null;
    var tReveal = useEye && !waited ? 500 : 0;          // let the eye be seen before it changes
    if (fx.lookUp) { this.run(new lookup.LookUp(eye, {duration: T.lookUp, rise: 120, onMove: this.opts.onLookUp})); tReveal = T.lookUp - 150; }
    if (fx.starfield) {
        var tWarp = fx.lookUp ? T.lookUp * 0.55 : 300;
        this.at(tWarp, function () {
            var w = new starfield.Warp(PIXI, self.layers.fx, {view: view, cx: cx, cy: cy, duration: T.warp, rand: self.rand});
            self.layers.fx.setChildIndex(w.g, 0);      // behind the eye
            self.run(w);
        });
        tReveal = Math.max(tReveal, tWarp + T.warp * 0.7);
    }
    this.at(tReveal, function () {
        if (entry.retired) { if (eye && eye.c) eye.destroy(); return; }   // replaced before it was revealed
        self.layers.pic.addChild(entry.holder);
        if (entry.kb) self.run(kenBurnsAnim(entry));
        var revealMs = fx.iris ? T.iris : T.fade;
        if (fx.iris) {
            self.run(new Iris(PIXI, entry.holder, self.layers.fx, {view: view, cx: cx, cy: cy, from: EYE_R, duration: T.iris}));
        } else {
            entry.holder.alpha = 0;
            self.run(fade(entry.holder, 0, 1, T.fade));
        }
        if (eye) self.run(fadeThen(eye.c, 1, 0, fx.iris ? 450 : T.fade, function () { eye.destroy(); }));
        self.at(revealMs + 150, function () { self.showCaption(); });
    });
};

Presenter.prototype.showCaption = function () {
    if (this.opts.onShown) this.opts.onShown();
    this.captionDue = true;
    this.captionFade(T.caption);
    if (this.opts.showCaption === false || this.covered) return;
    if (this.fx.starfield) {
        var self = this;
        this.at(T.caption * 0.5, function () { self.run(new starfield.Twinkle(self.PIXI, self.layers.cap, self.caption.sparkleSpots(), {duration: 3600})); });
    }
};

Presenter.prototype.next = function (texture, info) {
    var self = this, old = this.current;
    var entry = this.current = this.place(texture);
    entry.holder.alpha = 0;
    this.layers.pic.addChild(entry.holder);
    if (entry.kb) this.run(kenBurnsAnim(entry));
    this.captionDue = false;
    this.caption.fade(0, T.captionOut);
    if (this.fx.starfield) {
        var w = new starfield.Warp(this.PIXI, this.layers.fx, {view: this.view, cx: this.view.w / 2, cy: this.view.h / 2, n: 140, duration: T.cross, rand: this.rand});
        w.g.alpha = 0.6; this.run(w);
    }
    this.run(fadeThen(entry.holder, 0, 1, T.cross, function () { self.retire(old); }));
    this.at(T.captionOut, function () { self.caption.set(info); });
    this.at(T.cross * 0.6, function () { self.showCaption(); });
};

// Settings changed while open: effects apply from the next picture, the caption at once.
Presenter.prototype.configure = function (options) {
    if (options.effects) this.fx = options.effects;
    if (options.showCaption !== undefined) {
        this.opts.showCaption = options.showCaption;
        this.captionFade(300);
    }
};
// The info overlay or a menu covers the picture: hide the caption under it.
Presenter.prototype.cover = function (covered) {
    if (this.covered === covered) return;
    this.covered = covered;
    this.captionFade(covered ? 150 : 400);
};
// The caption shows once its picture is in (captionDue), unless switched off or covered.
Presenter.prototype.captionFade = function (ms) {
    this.caption.fade(this.captionDue && !this.covered && this.opts.showCaption !== false ? 1 : 0, ms);
};

Presenter.prototype.update = function (dt) {
    this.now += dt;
    var due = this.events.filter(function (e) { return e.at <= this.now; }, this);
    this.events = this.events.filter(function (e) { return e.at > this.now; }, this);
    due.forEach(function (e) { e.fn(); });
    this.anims = this.anims.filter(function (a) { return !a.update(dt); });
    this.caption.update(dt);
};

Presenter.prototype.destroy = function () {
    if (this.waiting) { this.waiting.eye.destroy(); this.waiting = null; }
    this.anims.forEach(function (a) { if (a.destroy) a.destroy(); });
    this.anims = []; this.events = [];
    this.retire(this.current); this.current = null;
    this.caption.destroy();
    var root = this.root;
    Object.keys(this.layers).forEach(function (k) { root.removeChild(this.layers[k]); this.layers[k].destroy({children: true}); }, this);
};

// Ken Burns keeps moving a picture until it has left the screen (also during its cross-fade out).
function kenBurnsAnim(entry) { return {update: function (dt) { if (entry.retired) return true; entry.kb.update(dt); return false; }}; }
function fade(obj, from, to, ms) { return fadeThen(obj, from, to, ms, null); }
function fadeThen(obj, from, to, ms, then) {
    var t = 0;
    obj.alpha = from;
    return {update: function (dt) {
        t = Math.min(ms, t + dt);
        obj.alpha = util.lerp(from, to, util.ease.inOutSine(t / ms));
        if (t >= ms) { if (then) then(); return true; }
        return false;
    }};
}

Presenter.TIMING = T;
module.exports = Presenter;
