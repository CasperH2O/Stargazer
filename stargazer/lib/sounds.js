'use strict';
// Telescope sounds for the eyepiece (0.4.0, user 2026-11-14): Jibo's own effects from his animation
// library (jibo-anim-db-animations audio, the "Fresh and Lively" December 2017 telescope set). They are
// played by absolute path from where the robot keeps that library, never copied into the skill.
//   tripod1/2  the telescope moving: looking in, each glide, finding the picture
// (The set's night-sky ambience, crickets, was dropped in 0.4.2: the user would rather not have it.)
// Loaded the way BEam's own skills load sounds (jibo.loader.load, then jibo.sound.play(id)).
// Everything is guarded: without the SDK sound plugin, or on any error, there is simply no sound.
// Runs in the skill page (Chromium 53 / Node 6): ES2015 only.
var path = require('path');

var DIR = 'audio/sfx/Fresh_and_Lively/December_2017/';
var FILES = {
    tripod1: DIR + 'sfx_jiboji_telescope_tripodmove01.ogg',
    tripod2: DIR + 'sfx_jiboji_telescope_tripodmove02.ogg'
};
// An animation from the same library; its resourceRoot is the library's folder.
var ANCHOR = 'jiboji_telescope_02';

function Sounds(jibo, log) {
    this.jibo = jibo; this.log = log || {info: function () {}, warn: function () {}};
    this.ready = {}; this.playing = {}; this.closed = false; this.loading = null; this.count = 0;
}
Sounds.prototype.root = function () {
    var db = this.jibo && this.jibo.animDB, anim = db && typeof db.getAnimByName === 'function' ? db.getAnimByName(ANCHOR) : null;
    return anim && typeof anim.resourceRoot === 'string' ? anim.resourceRoot : null;
};
// Starts loading both; resolves when done (failures are logged once and leave that sound out).
Sounds.prototype.prepare = function () {
    var self = this, j = this.jibo;
    if (this.loading) return this.loading;
    var root = this.root();
    if (!root || !j.loader || typeof j.loader.load !== 'function' || !j.sound || typeof j.sound.play !== 'function') {
        this.log.info('telescope sounds unavailable');
        return (this.loading = Promise.resolve());
    }
    this.loading = Promise.all(Object.keys(FILES).map(function (name) {
        var id = 'stargazer-' + name;
        return new Promise(function (resolve) {
            try {
                j.loader.load({id: id, src: path.join(root, FILES[name])}, {complete: function (error) {
                    if (error) self.log.warn('sound', name, 'not loaded:', error && error.message || error);
                    else self.ready[name] = id;
                    resolve();
                }});
            } catch (error) { self.log.warn('sound', name + ':', error && error.message || error); resolve(); }
        });
    }));
    return this.loading;
};
// Plays a short sound once it has loaded (one asked for before that is skipped). Playing sounds
// are kept until they end or close() stops them.
Sounds.prototype.play = function (name, volume) {
    var self = this, id = ++this.count, finished = false;
    if (this.closed || !this.ready[name]) return;
    try {
        var instance = this.jibo.sound.play(this.ready[name], {complete: function () { finished = true; delete self.playing[id]; }});
        if (!instance) return;
        if (typeof volume === 'number') try { instance.volume = volume; } catch (_) {}
        if (!finished) this.playing[id] = instance;          // it may already have finished during play()
    } catch (error) { this.log.warn('sound', name + ':', error && error.message || error); }
};
Sounds.prototype.close = function () {
    var self = this;
    this.closed = true;
    Object.keys(this.playing).forEach(function (id) {
        var instance = self.playing[id];
        delete self.playing[id];
        try { if (typeof instance.stop === 'function') instance.stop(); } catch (_) {}
        try { if (typeof instance.destroy === 'function') instance.destroy(); } catch (_) {}
    });
};

module.exports = {Sounds: Sounds, FILES: FILES};
