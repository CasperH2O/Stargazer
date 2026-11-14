'use strict';
// What Stargazer stores, in its own data folder (it survives skill updates):
//   settings.json  the person's choices
//   seen.json      ids of pictures already shown, for the "New" mark (at most SEEN_MAX)
//   sources.json   the newest picture last shown from each source (used by catalog.js)
// Pictures are never written to disk.
var fs = require('fs'), path = require('path');

var NAME = 'stargazer';
// Only sources whose TLS chains the robot's 2016 root certificates can verify (D25). Keys of
// removed sources in an old settings.json are dropped by clean().
var SOURCES = ['hubble', 'webb', 'noirlab'];
var EFFECTS = ['kenBurns', 'iris', 'lookUp', 'starfield'];
var SHOW_FOR = [10, 30, 60, 300, 0];   // seconds before Jibo's eye returns; 0 = until closed
var SLIDESHOW = [0, 1, 5, 30];         // minutes between pictures; 0 = off
var SEEN_MAX = 300;

var DEFAULTS = {
    sources: {hubble: true, webb: true, noirlab: true},
    effects: {kenBurns: true, iris: true, lookUp: true, starfield: false},   // D29
    showFor: 10,
    slideshow: 0,
    readTitle: true,       // the title only, never the description
    caption: true,
    sounds: true           // Jibo's tripod clicks while the eyepiece searches
};

function copyDefaults() { return JSON.parse(JSON.stringify(DEFAULTS)); }
function bools(given, keys, fallback) {
    var out = {};
    keys.forEach(function (key) { out[key] = given && typeof given[key] === 'boolean' ? given[key] : fallback[key]; });
    return out;
}
// Known keys with valid values only; anything else falls back to its default. At least one
// source stays on.
function clean(values) {
    var given = values && typeof values === 'object' ? values : {}, d = DEFAULTS;
    var out = {
        sources: bools(given.sources, SOURCES, d.sources),
        effects: bools(given.effects, EFFECTS, d.effects),
        showFor: SHOW_FOR.indexOf(given.showFor) >= 0 ? given.showFor : d.showFor,
        slideshow: SLIDESHOW.indexOf(given.slideshow) >= 0 ? given.slideshow : d.slideshow,
        readTitle: typeof given.readTitle === 'boolean' ? given.readTitle : d.readTitle,
        caption: typeof given.caption === 'boolean' ? given.caption : d.caption,
        sounds: typeof given.sounds === 'boolean' ? given.sounds : d.sounds
    };
    if (!SOURCES.some(function (id) { return out.sources[id]; })) out.sources = copyDefaults().sources;
    return out;
}

function onRobot() { return fs.existsSync('/opt/jibo/Jibo/Skills'); }
// BEacon keeps custom-skill data under Knowledge/beacon on the robot, /tmp/beam-beacon elsewhere.
function dataRoot() {
    if (process.env.STARGAZER_DATA_DIR) return path.resolve(process.env.STARGAZER_DATA_DIR);
    return onRobot() ? '/opt/jibo/Knowledge/beacon/custom-skills/' + NAME : '/tmp/beam-beacon/custom-skills/' + NAME;
}
// mkdir -p with private (0700) directories.
function ensureDirectory(dir) {
    try { fs.mkdirSync(dir, 448); }
    catch (error) {
        if (error.code === 'ENOENT') { ensureDirectory(path.dirname(dir)); fs.mkdirSync(dir, 448); }
        else if (error.code !== 'EEXIST' || !fs.statSync(dir).isDirectory()) throw error;
    }
    return dir;
}
function readJson(file, limit) {
    try {
        var st = fs.statSync(file);
        if (!st.isFile() || st.size > limit) return null;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) { return null; }
}
// Atomic: a half-written file is never read back.
function writeJson(root, name, value) {
    ensureDirectory(root);
    var target = path.join(root, name), temporary = target + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value) + '\n', {mode: 384});
    fs.renameSync(temporary, target);
    try { fs.chmodSync(target, 384); } catch (_) { /* the simulator's file system keeps host modes */ }
}

class Store {
    constructor(root) { this.root = root || dataRoot(); }
    read() { return clean(readJson(path.join(this.root, 'settings.json'), 4096)); }
    write(values) { var v = clean(values); writeJson(this.root, 'settings.json', v); return v; }
    seen() {
        var list = readJson(path.join(this.root, 'seen.json'), 64 * 1024);
        if (!Array.isArray(list)) return [];
        return list.filter(function (x) { return typeof x === 'string'; }).slice(-SEEN_MAX);
    }
    markSeen(list, id) {
        if (list.indexOf(id) >= 0) return list;
        var next = list.concat([id]).slice(-SEEN_MAX);
        try { writeJson(this.root, 'seen.json', next); } catch (_) {}
        return next;
    }
    // The newest picture last shown from each source ({id: {key, date, at}}), so the next opening
    // knows without downloading which sources may have something new (catalog.js isFresh).
    history() {
        var given = readJson(path.join(this.root, 'sources.json'), 16 * 1024), out = {};
        if (!given || typeof given !== 'object') return out;
        SOURCES.forEach(function (id) {
            var h = given[id];
            if (h && typeof h.key === 'string') out[id] = {key: h.key, date: Number(h.date) || 0, at: Number(h.at) || 0};
        });
        return out;
    }
    remember(history, item, now) {
        var next = Object.assign({}, history);
        next[item.source] = {key: item.key, date: Number(item.date) || 0, at: now || Date.now()};
        try { writeJson(this.root, 'sources.json', next); } catch (_) {}
        return next;
    }
}

// Settings rules used by the menus (pure).
function toggleSource(values, id) {
    var v = clean(values);
    if (v.sources[id] && SOURCES.filter(function (s) { return v.sources[s]; }).length === 1) return {values: v, refused: 'lastSource'};
    v.sources[id] = !v.sources[id];
    return {values: v};
}
function toggleEffect(values, id) { var v = clean(values); v.effects[id] = !v.effects[id]; return {values: v}; }
function cycle(list, value) { return list[(list.indexOf(value) + 1) % list.length]; }
function nextShowFor(values) { var v = clean(values); v.showFor = cycle(SHOW_FOR, v.showFor); return {values: v}; }
function nextSlideshow(values) { var v = clean(values); v.slideshow = cycle(SLIDESHOW, v.slideshow); return {values: v}; }
function toggle(values, key) { var v = clean(values); v[key] = !v[key]; return {values: v}; }
function enabledSources(values) { return SOURCES.filter(function (id) { return values.sources[id]; }); }
// Seconds the picture stays before Jibo's eye returns, or 0 for "until closed". A running
// slideshow keeps Stargazer open.
function closeAfter(values) { return values.slideshow ? 0 : values.showFor; }

module.exports = {
    NAME: NAME, SOURCES: SOURCES, EFFECTS: EFFECTS, SHOW_FOR: SHOW_FOR, SLIDESHOW: SLIDESHOW, DEFAULTS: DEFAULTS, SEEN_MAX: SEEN_MAX,
    clean: clean, dataRoot: dataRoot, onRobot: onRobot, Store: Store,
    toggleSource: toggleSource, toggleEffect: toggleEffect, nextShowFor: nextShowFor, nextSlideshow: nextSlideshow, toggle: toggle,
    enabledSources: enabledSources, closeAfter: closeAfter
};
