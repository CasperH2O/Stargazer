'use strict';
// "Look up" on the body: Jibo tilts his head towards the sky while the picture opens, then
// centres again. Skills on BEam's SDK have no jibo.animate; motion goes through jibo.expression
// and jibo.animDB, as BEam's own dance and radio skills do: attention OFF (so he does not look
// straight back at a face), a stock pose played on the BODY channels only (so our screen and
// eye drawing are untouched), then centerRobot on the body and the attention mode released.
// Every call is guarded: without them (or on error) the effect simply has no body part.
// Runs on the robot's Node 6: ES2015 only.
//
// The opening (0.3.0, user 2026-11-14): Jibo's own telescope jiboji (jiboji_telescope_02: eye,
// overlay, body and sound, 5.6 s) plays on his real eye BEFORE Stargazer's view goes up (a skill
// view hides the real eye). Loaded the way BEam's idle skill plays animDB animations
// (createFromConfig + play), with a cache name: without one createFromConfig never finishes on the
// robot (Jibo Talk 0.6.6); the cache is 'global', as in BEam's idle skill.
// Be points jibo.loader.basePath and jibo.sound.basePath at the active skill's folder
// (SkillSwitchUtil), and the eye loads the jiboji's textures by their relative names against it:
// from a custom skill they were looked for in Stargazer's package (telescope-01.png not found, no
// telescope on the eye; seen in the sim). While the jiboji plays (no Stargazer view or assets
// load then) both point at the animation library, and they are restored right after.
// It does not end neutral, so the whole robot is centred afterwards.

var POSE = 'Body_Look_Center_Up_01';
var JIBOJI = 'jiboji_telescope_02';
var JIBOJI_CACHE = 'global';
var LOAD_MS = 4000, PLAY_MS = 10000, CENTRE_MS = 3000;
var REAL_TIMERS = {setTimeout: function (fn, ms) { return setTimeout(fn, ms); }, clearTimeout: function (h) { clearTimeout(h); }};

function Motion(jibo, log, timers) {
    this.jibo = jibo; this.log = log || {info: function () {}, warn: function () {}};
    this.timers = timers || REAL_TIMERS;
    this.attention = null; this.busy = null; this.closed = false; this.playback = null;
}
Motion.prototype.limit = function (promise, ms, code) {
    var timers = this.timers;
    return new Promise(function (resolve, reject) {
        var timer = timers.setTimeout(function () { reject(Error(code)); }, ms);
        Promise.resolve(promise).then(function (v) { timers.clearTimeout(timer); resolve(v); }, function (e) { timers.clearTimeout(timer); reject(e); });
    });
};
Motion.prototype.offAttention = function () {
    var self = this, ex = this.jibo.expression;
    if (this.attention || typeof ex.pushAttentionMode !== 'function' || !ex.AttentionMode) return Promise.resolve();
    return Promise.resolve(ex.pushAttentionMode(ex.AttentionMode.OFF)).then(function (handle) {
        if (!handle) return;
        if (self.closed) { try { handle.release(); } catch (_) {} return; }
        self.attention = handle;
    });
};
// Plays a whole animDB animation (eye, overlay, body, sound) and centres the robot after it.
// Always resolves, to 'played' | 'stopped' | the failure code; a failure just skips the animation.
Motion.prototype.jiboji = function (name) {
    var self = this, j = this.jibo, ex = j && j.expression, started = Date.now();
    name = name || JIBOJI;
    if (this.closed) return Promise.resolve('closed');
    if (!ex || typeof ex.centerRobot !== 'function' || !j.animDB || typeof j.animDB.getAnimByName !== 'function') return Promise.resolve('unavailable');
    var outcome = 'played';
    return this.offAttention().then(function () {
        var asset = j.animDB.getAnimByName(name);
        if (!asset || typeof asset.createFromConfig !== 'function') throw Error('anim_missing');
        if (self.closed) throw Error('closed');
        self.borrowBase(asset.resourceRoot);
        return self.limit(asset.createFromConfig({cache: JIBOJI_CACHE}), LOAD_MS, 'load_timeout');
    }).then(function (playback) {
        if (self.closed) { try { playback.stop(); } catch (_) {} throw Error('closed'); }
        self.playback = playback;
        self.log.info('jiboji', name, 'playing after', (Date.now() - started) + ' ms');
        return self.limit(playback.play(), PLAY_MS, 'play_timeout');
    }).catch(function (error) {
        outcome = error && error.message || String(error);
        if (outcome !== 'closed') self.log.warn('jiboji', name + ':', outcome);
        if (self.playback) try { self.playback.stop(); } catch (_) {}
    }).then(function () {
        self.playback = null;
        self.returnBase();
        if (self.closed) return outcome === 'played' ? 'stopped' : outcome;
        return self.limit(ex.centerRobot(), CENTRE_MS, 'centre_timeout').catch(function (error) {
            self.log.warn('centre after jiboji:', error && error.message || error);
        }).then(function () {
            self.release();
            self.log.info('jiboji', name, 'done (' + outcome + ') after', (Date.now() - started) + ' ms');
            return outcome;
        });
    });
};
Motion.prototype.available = function () {
    var j = this.jibo, ex = j && j.expression;
    return !!(ex && ex.dofs && ex.dofs.BODY && typeof ex.centerRobot === 'function' && j.animDB && typeof j.animDB.getAnimByName === 'function');
};
// direction: 'up' | 'centre' (the presenter's onLookUp hook).
Motion.prototype.move = function (direction) {
    if (this.closed || !this.available()) return Promise.resolve();
    return direction === 'up' ? this.up() : this.centre();
};
Motion.prototype.up = function () {
    var self = this, j = this.jibo, ex = j.expression, BODY = ex.dofs.BODY;
    this.busy = this.offAttention().then(function () {
        var pose = j.animDB.getAnimByName(POSE);
        if (!pose || typeof pose.play !== 'function') throw Error('pose_missing');
        var playing = pose.play({cache: j.loader && j.loader.activeCache, dofs: BODY});
        return playing && playing.result;
    }).catch(function (error) { self.log.warn('look up:', error && error.message || error); });
    return this.busy;
};
Motion.prototype.centre = function () {
    var self = this, ex = this.jibo.expression;
    return Promise.resolve(this.busy).then(function () {
        return ex.centerRobot({dofs: ex.dofs.BODY});
    }).catch(function (error) { self.log.warn('centre:', error && error.message || error); }).then(function () { self.release(); });
};
Motion.prototype.release = function () {
    var handle = this.attention;
    this.attention = null;
    if (handle && typeof handle.release === 'function') try { handle.release(); } catch (_) {}
};
// Relative asset paths resolve against the animation library while the jiboji plays.
Motion.prototype.borrowBase = function (root) {
    var j = this.jibo;
    if (this.borrowed || typeof root !== 'string' || !root) return;
    this.borrowed = {root: root, loader: j.loader ? j.loader.basePath : undefined, sound: j.sound ? j.sound.basePath : undefined};
    try { if (j.loader) j.loader.basePath = root; if (j.sound) j.sound.basePath = root; } catch (_) {}
};
// Put the skill's base paths back, unless something (a skill switch) has changed them meanwhile.
Motion.prototype.returnBase = function () {
    var j = this.jibo, b = this.borrowed;
    if (!b) return;
    this.borrowed = null;
    try {
        if (j.loader && j.loader.basePath === b.root) j.loader.basePath = b.loader;
        if (j.sound && j.sound.basePath === b.root) j.sound.basePath = b.sound;
    } catch (_) {}
};
Motion.prototype.close = function () {
    if (this.closed) return;
    this.returnBase();
    var hadAttention = !!this.attention, playing = this.playback;
    this.closed = true;
    this.playback = null;
    if (playing) try { playing.stop(); } catch (_) {}    // closed during the jiboji
    if (hadAttention || playing) {
        var ex = this.jibo.expression;
        try { Promise.resolve(playing ? ex.centerRobot() : ex.centerRobot({dofs: ex.dofs.BODY})).catch(function () {}); } catch (_) {}
    }
    this.release();
};

module.exports = {Motion: Motion, POSE: POSE, JIBOJI: JIBOJI};
