'use strict';
// The opening: how the first picture appears (D24, D27). It runs in phases, each started by the
// one before it:
//
//   lookIn   the eyepiece shows at once and settles in                          (T.lookIn)
//   glance   with Look up only: it rises to the sky band while Jibo tilts his head (T.lookUp)
//   search   it glides from spot to spot in the sky band until the picture is in, and for at
//            least T.minSearch, so a fast load still feels like looking
//   acquire  it glides to the middle of the band with the dial fully lit       (T.acquire)
//   focus    the picture comes up inside the lens from black, blurred, and sharpens (T.focus)
//   reveal   the iris opens the lens to full screen and the barrel fades; then the caption
//
// The presenter makes one Opening per first picture (presenter.waiting) and hands it the picture
// with ready(entry). Animations run on the presenter's frame loop (presenter.run / presenter.at).
var util = require('./effects/util');
var eyepiece = require('./effects/eyepiece');
var Iris = require('./effects/iris').Iris;
var starfield = require('./effects/starfield');

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
    warp: 1300          // Starfield warp
};

function Opening(presenter) {
    var view = presenter.view;
    this.p = presenter;
    this.eyepiece = new eyepiece.Eyepiece(presenter.PIXI, presenter.layers.fx, {x: view.w / 2, y: view.h / 2, r: LENS_R, rand: presenter.rand});
    this.phase = 'lookIn';
    this.progress = 0;      // loading progress shown on the dial, 0..1
    this.ready = null;      // the picture's entry, once it is in
    this.path = null;       // the SearchPath, from the search on
    this.searchT = 0;       // time spent searching
    this.lastMove = -1;     // the last glide that got a tripod click
    this.done = false;      // revealed or ended
}

Opening.prototype.start = function () {
    var self = this, e = this.eyepiece, t = 0;
    this.p.cue('look');
    // Visible at once (no fade from black); it just settles into place.
    this.p.run({update: function (dt) {
        if (self.done || util.destroyed(e.c)) return true;
        t = Math.min(T.lookIn, t + dt);
        e.c.scale.set(util.lerp(1.06, 1, util.ease.outCubic(t / T.lookIn)));
        if (t < T.lookIn) return false;
        if (self.p.fx.lookUp) self.glance(); else self.startSearch();
        return true;
    }});
    this.p.run({update: function (dt) { return self.tick(dt); }});
};

// The picture is in: the search ends once it has lasted T.minSearch.
Opening.prototype.setReady = function (entry) { this.ready = entry; };

// Loading progress (0..1) lights the dial's ticks; it only ever goes up.
Opening.prototype.setProgress = function (p) {
    this.progress = Math.max(this.progress, p);
    this.eyepiece.setProgress(this.progress);
};

// Look up: the eyepiece rises to the sky band (stretching a little as it moves) and stays there,
// while the body tilts up and centres again (onLookUp 'up', then 'centre').
Opening.prototype.glance = function () {
    var self = this, e = this.eyepiece, onMove = this.p.opts.onLookUp || function () {};
    var t = 0, D = T.lookUp, centred = false;
    this.phase = 'glance';
    onMove('up');
    this.p.run({update: function (dt) {
        if (self.done) return true;
        t = Math.min(D, t + dt);
        var k = t / D, rise = util.ease.outBack(util.clamp01(k / 0.7)), moving = Math.sin(Math.PI * util.clamp01(k / 0.7));
        if (!util.destroyed(e.c)) {
            e.setOffset(0, SKY_Y * rise);
            e.c.scale.set(1 - 0.06 * moving, 1 + 0.08 * moving);
        }
        if (!centred && k >= 0.6) { centred = true; onMove('centre'); }
        if (t < D) return false;
        if (!util.destroyed(e.c)) e.c.scale.set(1, 1);
        self.startSearch();
        return true;
    }});
};

// Searching starts where the eyepiece is (the centre, or up already after Look up); without Look up
// its first glide takes it up to the sky band.
Opening.prototype.startSearch = function () {
    if (this.done || this.phase === 'search') return;
    this.phase = 'search';
    var from = {dx: this.eyepiece.dx || 0, dy: this.eyepiece.dy || 0};
    this.path = new eyepiece.SearchPath(this.p.rand, {ax: SEARCH.ax, ay: SEARCH.ay, cy: SKY_Y, from: from});
    this.p.cue('search');
};

// Every frame until the focus pull: the search (stars sliding past, the dial twitching like a focus
// knob, a tripod click as each glide starts) and the glide to the middle of the band.
Opening.prototype.tick = function (dt) {
    if (this.done) return true;
    var e = this.eyepiece;
    if (util.destroyed(e.c)) return false;
    if (this.phase === 'focus') return true;                   // the focus pull animates it from here
    e.update(dt);
    if (this.phase === 'search') {
        this.searchT += dt;
        var at = this.path.at(this.searchT);
        e.setOffset(at.dx, at.dy);
        e.setDial(0.16 * Math.sin(2 * Math.PI * this.searchT / 4300) + 0.05 * at.dx / 100);
        if (at.move > this.lastMove) {
            this.lastMove = at.move;
            if (at.move > 0) this.p.cue('move');
        }
        if (this.ready && this.searchT >= T.minSearch) this.acquire();
    } else if (this.phase === 'acquire') {
        this.acquireT = Math.min(T.acquire, this.acquireT + dt);
        var k = util.ease.inOutCubic(this.acquireT / T.acquire);
        e.setOffset(util.lerp(this.from.dx, 0, k), util.lerp(this.from.dy, SKY_Y, k));
        e.setDial(util.lerp(this.from.dial, 0, k));
        if (this.acquireT >= T.acquire) {
            this.phase = 'focus';
            this.focus(this.ready);
            return true;
        }
    }
    return false;
};

// Found it: glide to the middle of the sky band with the dial fully lit.
Opening.prototype.acquire = function () {
    var e = this.eyepiece;
    this.phase = 'acquire';
    this.acquireT = 0;
    this.from = {dx: e.dx, dy: e.dy, dial: e.dial.rotation};
    e.setProgress(1);
    this.p.cue('found');
};

// The focus pull: inside the lens (with the iris; full screen without it) the picture comes up from
// black, very blurred, and sharpens while the focus dial turns.
Opening.prototype.focus = function (entry) {
    var self = this, p = this.p, PIXI = p.PIXI, e = this.eyepiece;
    if (!entry || entry !== p.current || entry.retired) {
        this.end();
        if (entry) p.retire(entry);
        return;
    }
    var inLens = !!p.fx.iris, lens = null;
    p.layers.pic.addChild(entry.holder);
    p.startKenBurns(entry);
    var blur = p.blurLevels(entry);
    if (inLens) {
        lens = new PIXI.Graphics();
        lens.beginFill(0xffffff, 1);
        lens.drawCircle(p.view.w / 2, p.view.h / 2 + SKY_Y, LENS_R);
        lens.endFill();
        p.layers.fx.addChild(lens);
        entry.holder.mask = lens;
    } else entry.holder.alpha = 0;
    var t = 0, F = T.focus, ease = util.ease.inOutSine;
    p.run({update: function (dt) {
        if (entry !== p.current || entry.retired || self.done) {
            // The holder stays on screen under the cross-fade, and a destroyed mask breaks PIXI's render.
            if (lens && entry.holder.mask === lens) entry.holder.mask = null;
            util.dispose(lens);
            self.end();
            return true;
        }
        t = Math.min(F, t + dt);
        var fromBlack = ease(util.progress(t, 0, F * 0.35));
        if (inLens) e.setInterior(1 - fromBlack);
        else {
            entry.holder.alpha = fromBlack;
            e.c.alpha = 1 - ease(util.progress(t, 0, F * 0.5));
        }
        // Most blurred first: each level fades in turn, uncovering the next sharper one.
        blur.forEach(function (b, i) {
            var span = 0.72 / blur.length;
            b.sprite.alpha = 1 - ease(util.progress(t, F * (0.28 + i * span), F * span));
        });
        p.followBlur(entry);
        e.setDial(0.9 * util.ease.inOutCubic(t / F));         // the focus knob turns
        e.update(dt);
        if (t < F) return false;
        self.reveal(entry, lens);
        return true;
    }});
};

// In focus: the iris opens the lens to the whole screen and the barrel opens outward and fades.
// Then the caption.
Opening.prototype.reveal = function (entry, lens) {
    var p = this.p, PIXI = p.PIXI, view = p.view, cx = view.w / 2, cy = view.h / 2 + SKY_Y, e = this.eyepiece;
    p.dropBlur(entry);
    this.finish();
    p.cue('reveal');
    if (lens) {
        if (entry.holder.mask === lens) entry.holder.mask = null;
        util.dispose(lens);
        p.run(new Iris(PIXI, entry.holder, p.layers.fx, {view: view, cx: cx, cy: cy, from: LENS_R, duration: T.iris}));
    }
    if (p.fx.starfield) {
        var warp = new starfield.Warp(PIXI, p.layers.fx, {view: view, cx: cx, cy: cy, duration: T.warp, rand: p.rand});
        p.layers.fx.setChildIndex(warp.g, 0);
        p.run(warp);
    }
    var t = 0, a0 = util.destroyed(e.c) ? 0 : e.c.alpha;
    p.run({update: function (dt) {
        if (util.destroyed(e.c)) return true;
        t = Math.min(T.open, t + dt);
        var k = t / T.open;
        e.c.scale.set(1 + 0.5 * util.ease.inCubic(k));
        e.c.alpha = a0 * (1 - util.ease.outCubic(k));
        if (t < T.open) return false;
        e.destroy();
        return true;
    }});
    p.at((lens ? T.iris : 0) + 150, function () { p.showCaption(entry); });
};

// The opening is over: the presenter no longer waits on it.
Opening.prototype.finish = function () {
    this.done = true;
    if (this.p.waiting === this) this.p.waiting = null;
};

// Ends the opening at once (a newer picture replaced it, or the presenter goes away).
Opening.prototype.end = function () {
    if (this.done && this.p.waiting !== this) return;
    this.finish();
    this.eyepiece.destroy();
};

module.exports = {Opening: Opening, TIMING: T, LENS_R: LENS_R, SKY_Y: SKY_Y, SEARCH: SEARCH};
