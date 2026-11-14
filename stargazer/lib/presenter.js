'use strict';
// Shows pictures with the chosen effects. It has no timers of its own: the caller drives
// update(dt) every frame. It does not own the textures either: when a picture has left the screen
// its texture goes back through opts.onRetire(texture), exactly once. Anything scheduled for a
// picture is dropped once a newer picture has replaced it.
//
//   var p = new Presenter(PIXI, root, {view, effects: {kenBurns, iris, lookUp, starfield},
//                                      seed, onLookUp, onRetire, onShown, onCue, showCaption});
//   p.wait();                                 // the eyepiece searches the sky while it loads
//   p.progress(0..1);                         // its dial lights up as loading goes on
//   p.show(texture, {title, line, credit});   // first call: the opening; later calls cross-fade
//   p.update(dtMs); ... p.destroy();
//
// The opening: an eyepiece searches the sky near the top of the screen; once the picture is in,
// the picture comes into focus inside the lens and the iris opens it to full screen (D24, D27).
// opts.onCue(name) marks the moments for sound: 'look', 'search', 'move', 'found', 'reveal'.
var util = require('./effects/util');
var kenburns = require('./effects/kenburns');
var Iris = require('./effects/iris').Iris;
var starfield = require('./effects/starfield');
var eyepiece = require('./effects/eyepiece');
var Caption = require('./caption').Caption;

var LENS_R = 180;                       // the eyepiece's lens radius
// The eyepiece searches a band near the top of the screen: SKY_Y above the centre, +-SEARCH.ax px
// sideways and +-SEARCH.ay px up and down. The picture opens from there too.
var SKY_Y = -95, SEARCH = {ax: 300, ay: 15};
// Durations in ms.
var T = {
    lookIn: 650,        // the eyepiece settles in
    lookUp: 1100,       // with Look up: it rises while Jibo tilts his head
    minSearch: 1300,    // it searches at least this long, even when the picture is in sooner
    acquire: 750,       // it glides to the middle of the band
    focus: 1400,        // the picture comes into focus inside the lens
    iris: 1500,         // the iris opens to full screen
    open: 650,          // the barrel opens outward and fades
    warp: 1300,         // Starfield warp
    caption: 700,       // caption fade-in
    captionOut: 300,    // caption fade-out before a cross-fade
    cross: 1200         // cross-fade to the next picture (slideshow)
};

function Presenter(PIXI, root, opts) {
    this.PIXI = PIXI; this.root = root; this.opts = opts || {};
    this.view = this.opts.view || {w: 1280, h: 720};
    this.fx = this.opts.effects || {};
    this.rand = util.rng(this.opts.seed || Date.now());
    this.layers = {};
    ['back', 'pic', 'fx', 'cap'].forEach(function (k) { this.layers[k] = new PIXI.Container(); root.addChild(this.layers[k]); }, this);
    this.caption = new Caption(PIXI, this.layers.cap, this.view);
    this.now = 0; this.events = []; this.anims = []; this.current = null; this.shown = 0;
    this.entries = [];   // every picture placed and not yet retired (the current one and any on its way out)
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
    this.entries.push(entry);
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

// Hands the texture back even when tearing down its sprites fails (the stage may be gone already).
Presenter.prototype.retire = function (entry) {
    if (!entry || entry.retired) return;
    entry.retired = true;
    var i = this.entries.indexOf(entry);
    if (i >= 0) this.entries.splice(i, 1);
    try {
        try { if (entry.blur) this.dropBlur(entry); if (entry.back) entry.back.rt.destroy(true); }
        finally { util.dispose(entry.holder, {children: true}); }   // sprites only; the texture goes back to the owner
    } finally {
        if (this.opts.onRetire) this.opts.onRetire(entry.texture);
    }
};

Presenter.prototype.show = function (texture, info) {
    if (this.shown++ === 0) this.intro(texture, info); else this.next(texture, info);
};

// While the first picture loads, the eyepiece shows at once and searches until show() hands it
// the picture. With Look up, it first rises while Jibo tilts his head.
Presenter.prototype.wait = function () {
    if (this.waiting || this.current || this.destroyed) return;   // not once a picture is placed (show() counts before intro())
    var self = this, cx = this.view.w / 2, cy = this.view.h / 2;
    var e = new eyepiece.Eyepiece(this.PIXI, this.layers.fx, {x: cx, y: cy, r: LENS_R, rand: this.rand});
    var w = this.waiting = {eyepiece: e, phase: 'lookIn', searchT: 0, lastMove: -1, progress: 0, ready: null, path: null};
    this.cue('look');
    var t = 0;
    // Visible at once (no fade from black); it just settles into place.
    this.run({update: function (dt) {
        if (w.done || util.destroyed(e.c)) return true;
        t = Math.min(T.lookIn, t + dt);
        var k = util.ease.outCubic(t / T.lookIn);
        e.c.scale.set(util.lerp(1.06, 1, k));
        if (t < T.lookIn) return false;
        if (self.fx.lookUp) self.glance(w); else self.startSearch(w);
        return true;
    }});
    this.run({update: function (dt) { return self.waitTick(w, dt); }});
};
// Look up: the eyepiece rises to the sky band near the top (stretching a little as it moves) and
// stays there, while the body tilts up and centres again (onLookUp 'up', then 'centre').
Presenter.prototype.glance = function (w) {
    var self = this, e = w.eyepiece, onMove = this.opts.onLookUp || function () {}, t = 0, D = T.lookUp, centred = false;
    w.phase = 'glance';
    onMove('up');
    this.run({update: function (dt) {
        if (w.done) return true;
        t = Math.min(D, t + dt);
        var k = t / D, rise = util.ease.outBack(util.clamp01(k / 0.7)), moving = Math.sin(Math.PI * util.clamp01(k / 0.7));
        if (!util.destroyed(e.c)) { e.setOffset(0, SKY_Y * rise); e.c.scale.set(1 - 0.06 * moving, 1 + 0.08 * moving); }
        if (!centred && k >= 0.6) { centred = true; onMove('centre'); }
        if (t < D) return false;
        if (!util.destroyed(e.c)) e.c.scale.set(1, 1);
        self.startSearch(w);
        return true;
    }});
};
// Searching starts where the eyepiece is (the centre, or up already after Look up); without Look up
// its first glide takes it up to the sky band.
Presenter.prototype.startSearch = function (w) {
    if (w.done || w.phase === 'search') return;
    w.phase = 'search';
    var from = {dx: w.eyepiece.dx || 0, dy: w.eyepiece.dy || 0};
    w.path = new eyepiece.SearchPath(this.rand, {ax: SEARCH.ax, ay: SEARCH.ay, cy: SKY_Y, from: from});
    this.cue('search');
};
// Searching: the eyepiece glides from spot to spot, pausing at each (SearchPath), the stars inside
// sliding past and the dial twitching like a focus knob. A creak of the tripod as each glide starts.
// Once the picture is in (and it has searched for at least T.minSearch, so a fast load still feels
// like looking), it glides to the middle of the sky band, where the picture comes into focus.
Presenter.prototype.waitTick = function (w, dt) {
    if (w.done) return true;
    var e = w.eyepiece;
    if (!e || util.destroyed(e.c)) return false;
    if (w.phase === 'focus') return true;                      // the focus pull animates it from here
    e.update(dt);
    if (w.phase === 'search') {
        w.searchT += dt;
        var p = w.path.at(w.searchT);
        e.setOffset(p.dx, p.dy);
        e.setDial(0.16 * Math.sin(2 * Math.PI * w.searchT / 4300) + 0.05 * p.dx / 100);
        if (p.move > w.lastMove) { w.lastMove = p.move; if (p.move > 0) this.cue('move'); }
        if (w.ready && w.searchT >= T.minSearch) this.acquire(w);
    } else if (w.phase === 'acquire') {
        w.acquireT = Math.min(T.acquire, w.acquireT + dt);
        var k = util.ease.inOutCubic(w.acquireT / T.acquire);
        e.setOffset(util.lerp(w.from.dx, 0, k), util.lerp(w.from.dy, SKY_Y, k));
        e.setDial(util.lerp(w.from.dial, 0, k));
        if (w.acquireT >= T.acquire) { w.phase = 'focus'; this.focus(w, w.ready); return true; }
    }
    return false;
};
// Found it: glide to the middle of the sky band with the dial fully lit.
Presenter.prototype.acquire = function (w) {
    var e = w.eyepiece;
    w.phase = 'acquire'; w.acquireT = 0;
    w.from = {dx: e.dx, dy: e.dy, dial: e.dial.rotation};
    e.setProgress(1);
    this.cue('found');
};
// Loading progress (0..1) lights the dial's ticks; it only ever goes up.
Presenter.prototype.progress = function (p) {
    var w = this.waiting;
    if (!w) return;
    w.progress = Math.max(w.progress, p);
    if (w.eyepiece) w.eyepiece.setProgress(w.progress);
};
Presenter.prototype.cue = function (name) {
    if (this.opts.onCue) try { this.opts.onCue(name); } catch (_) {}
};
// Ends the loading look at once (the opening was replaced, or the presenter goes away).
Presenter.prototype.endWait = function () {
    var w = this.waiting;
    if (!w) return;
    this.waiting = null; w.done = true;
    if (w.eyepiece) w.eyepiece.destroy();
};

Presenter.prototype.intro = function (texture, info) {
    if (!this.waiting) this.wait();                            // the opening always looks through the eyepiece
    var entry = this.current = this.place(texture);
    this.caption.set(info);
    this.waiting.ready = entry;
};

// Blurred copies of the picture for the focus pull, made once per picture on the CPU (no GPU
// filters on the robot): canvas blur() at a few sizes, or without ctx.filter a downscale chain
// stretched back up. They lie over the sharp sprite and follow it (Ken Burns moves it).
var BLUR_LEVELS = [{width: 480, blur: 1.5}, {width: 240, blur: 4}, {width: 160, blur: 9}];
var DOWNSCALE_LEVELS = [{width: 128}, {width: 40}, {width: 12}];
Presenter.prototype.blurLevels = function (entry) {
    var PIXI = this.PIXI, src = entry.texture.baseTexture && entry.texture.baseTexture.source;
    var doc = this.opts.document || (typeof document !== 'undefined' ? document : null);
    if (!src || !doc || !entry.texture.width) return [];
    var aspect = entry.texture.height / entry.texture.width, prev = src, out = [];
    var probe = doc.createElement('canvas').getContext('2d');
    var filtered = !!probe && typeof probe.filter === 'string';
    (filtered ? BLUR_LEVELS : DOWNSCALE_LEVELS).forEach(function (level) {
        var c = doc.createElement('canvas');
        c.width = level.width; c.height = Math.max(1, Math.round(level.width * aspect));
        try {
            var ctx = c.getContext('2d');
            if (filtered) { ctx.filter = 'blur(' + level.blur + 'px)'; ctx.drawImage(src, 0, 0, c.width, c.height); }
            else { ctx.drawImage(prev, 0, 0, c.width, c.height); prev = c; }
        } catch (_) { return; }
        var tex = PIXI.Texture.fromCanvas(c, PIXI.SCALE_MODES.LINEAR);
        var s = new PIXI.Sprite(tex);
        entry.holder.addChild(s);
        out.unshift({sprite: s, texture: tex, width: c.width, height: c.height});   // most blurred first
    });
    // The most blurred lies on top: add the sprites in that order.
    out.forEach(function (b) { entry.holder.removeChild(b.sprite); });
    out.slice().reverse().forEach(function (b) { entry.holder.addChild(b.sprite); });
    entry.blur = out;
    this.followBlur(entry);
    return out;
};
Presenter.prototype.followBlur = function (entry) {
    var sp = entry.sprite;
    (entry.blur || []).forEach(function (b) {
        if (util.destroyed(b.sprite)) return;
        b.sprite.anchor.set(sp.anchor.x, sp.anchor.y);
        b.sprite.position.set(sp.position.x, sp.position.y);
        b.sprite.rotation = sp.rotation;
        b.sprite.scale.set(sp.scale.x * entry.texture.width / b.width, sp.scale.y * entry.texture.height / b.height);
    });
};
Presenter.prototype.dropBlur = function (entry) {
    var blur = entry.blur || [];
    entry.blur = null;
    blur.forEach(function (b) {
        try { util.dispose(b.sprite); } finally { b.texture.destroy(true); }
    });
};

// The focus pull: inside the lens (with the iris; full screen without it) the picture comes up from
// black, very blurred, and sharpens in two steps while the focus dial turns.
Presenter.prototype.focus = function (w, entry) {
    var self = this, PIXI = this.PIXI, fx = this.fx, view = this.view, cx = view.w / 2, cy = view.h / 2 + SKY_Y, e = w.eyepiece;
    if (!entry || entry !== this.current || entry.retired) { this.endWait(); if (entry) this.retire(entry); return; }
    var inLens = !!fx.iris, lens = null;
    this.layers.pic.addChild(entry.holder);
    if (entry.kb) this.run(kenBurnsAnim(entry));
    var blur = this.blurLevels(entry);
    if (inLens) {
        lens = new PIXI.Graphics(); lens.beginFill(0xffffff, 1); lens.drawCircle(cx, cy, LENS_R); lens.endFill();
        this.layers.fx.addChild(lens);
        entry.holder.mask = lens;
    } else entry.holder.alpha = 0;
    var t = 0, F = T.focus, ease = util.ease.inOutSine;
    this.run({update: function (dt) {
        if (entry !== self.current || entry.retired || w.done) {
            // The holder stays on screen under the cross-fade, and a destroyed mask breaks PIXI's render.
            if (lens && entry.holder.mask === lens) entry.holder.mask = null;
            util.dispose(lens); self.endWait(); return true;
        }
        t = Math.min(F, t + dt);
        var from = ease(util.progress(t, 0, F * 0.35));        // out of the black
        if (inLens) e.setInterior(1 - from);
        else { entry.holder.alpha = from; e.c.alpha = 1 - ease(util.progress(t, 0, F * 0.5)); }
        // Most blurred first: each level fades in turn, uncovering the next sharper one.
        blur.forEach(function (b, i) {
            var span = 0.72 / blur.length;
            b.sprite.alpha = 1 - ease(util.progress(t, F * (0.28 + i * span), F * span));
        });
        self.followBlur(entry);
        e.setDial(0.9 * util.ease.inOutCubic(t / F));         // the focus knob turns
        e.update(dt);
        if (t < F) return false;
        self.reveal(w, entry, lens);
        return true;
    }});
};

// In focus: the iris opens the lens to the whole screen and the barrel opens outward and fades.
Presenter.prototype.reveal = function (w, entry, lens) {
    var self = this, fx = this.fx, PIXI = this.PIXI, view = this.view, cx = view.w / 2, cy = view.h / 2 + SKY_Y, e = w.eyepiece;
    this.dropBlur(entry);
    this.waiting = null; w.done = true;
    this.cue('reveal');
    if (lens) {
        if (entry.holder.mask === lens) entry.holder.mask = null;
        util.dispose(lens);
        this.run(new Iris(PIXI, entry.holder, this.layers.fx, {view: view, cx: cx, cy: cy, from: LENS_R, duration: T.iris}));
    }
    if (fx.starfield) {
        var warp = new starfield.Warp(PIXI, this.layers.fx, {view: view, cx: cx, cy: cy, duration: T.warp, rand: this.rand});
        this.layers.fx.setChildIndex(warp.g, 0);
        this.run(warp);
    }
    var t = 0, a0 = util.destroyed(e.c) ? 0 : e.c.alpha;
    this.run({update: function (dt) {
        if (util.destroyed(e.c)) return true;
        t = Math.min(T.open, t + dt);
        var k = t / T.open;
        e.c.scale.set(1 + 0.5 * util.ease.inCubic(k)); e.c.alpha = a0 * (1 - util.ease.outCubic(k));
        if (t < T.open) return false;
        e.destroy();
        return true;
    }});
    this.at((lens ? T.iris : 0) + 150, function () { self.showCaption(entry); });
};

// The picture is in: its caption shows and the owner hears about it (onShown(texture)), once per
// picture and only while it is still the current one.
Presenter.prototype.showCaption = function (entry) {
    if (!entry || entry !== this.current || entry.shown) return;
    entry.shown = true;
    this.captionDue = true;
    this.captionFade(T.caption);
    if (this.opts.onShown) this.opts.onShown(entry.texture);
    if (this.opts.showCaption === false || this.covered) return;
    if (this.fx.starfield) {
        var self = this;
        this.at(T.caption * 0.5, function () {
            if (entry !== self.current) return;
            self.run(new starfield.Twinkle(self.PIXI, self.layers.cap, self.caption.sparkleSpots(), {duration: 3600}));
        });
    }
};

Presenter.prototype.next = function (texture, info) {
    var self = this, old = this.current;
    this.endWait();                                            // a newer picture while the eyepiece still looked
    var entry = this.current = this.place(texture);
    entry.holder.alpha = 0;
    this.layers.pic.addChild(entry.holder);
    if (entry.kb) this.run(kenBurnsAnim(entry));
    this.captionDue = false;
    this.caption.fade(0, T.captionOut);
    if (this.fx.starfield) {
        var w = new starfield.Warp(this.PIXI, this.layers.fx,
            {view: this.view, cx: this.view.w / 2, cy: this.view.h / 2, n: 140, duration: T.cross, rand: this.rand});
        w.g.alpha = 0.6; this.run(w);
    }
    this.run(fadeThen(entry.holder, 0, 1, T.cross, function () { self.retire(old); }));
    this.at(T.captionOut, function () { if (entry === self.current) self.caption.set(info); });
    this.at(T.cross * 0.6, function () { self.showCaption(entry); });
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
    if (this.destroyed) return;
    this.now += dt;
    var due = this.events.filter(function (e) { return e.at <= this.now; }, this);
    this.events = this.events.filter(function (e) { return e.at > this.now; }, this);
    due.forEach(function (e) { e.fn(); });
    // An animation may start others (the search starts the focus pull, which starts the reveal):
    // those land in the fresh list and are kept, not lost when the running ones are filtered.
    var running = this.anims;
    this.anims = [];
    var kept = running.filter(function (a) { return !a.update(dt); });
    this.anims = kept.concat(this.anims);
    this.caption.update(dt);
};

// On close the SDK may already have destroyed the stage (root, layers and effect graphics). Each
// step runs on its own so a failing one never skips the rest: every texture still goes back
// through onRetire and our own canvas textures (backdrops, caption gradient) are destroyed.
// Throws the first error afterwards, if any.
Presenter.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    var first = null;
    function step(fn) { try { fn(); } catch (error) { if (!first) first = error; } }
    var waiting = this.waiting, anims = this.anims, entries = this.entries.slice(), layers = this.layers;
    this.waiting = null; this.anims = []; this.events = []; this.current = null;
    if (waiting) {
        waiting.done = true;
        if (waiting.eyepiece) step(function () { waiting.eyepiece.destroy(); });
    }
    anims.forEach(function (a) { if (a.destroy) step(function () { a.destroy(); }); });
    entries.forEach(function (entry) { step(this.retire.bind(this, entry)); }, this);
    step(this.caption.destroy.bind(this.caption));
    Object.keys(layers).forEach(function (k) {
        step(function () { util.dispose(layers[k], {children: true}); });
    });
    if (first) throw first;
};

// Ken Burns keeps moving a picture until it has left the screen (also during its cross-fade out).
function kenBurnsAnim(entry) { return {update: function (dt) { if (entry.retired) return true; entry.kb.update(dt); return false; }}; }
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
