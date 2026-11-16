'use strict';
// What Stargazer stores, in its own data folder (it survives skill updates):
//   settings.json  the person's choices
//   seen.json      ids of pictures already shown, for the "New" mark (at most SEEN_MAX)
//   sources.json   the newest picture last shown from each source (used by catalog.js)
// Pictures are never written to disk. Everything written here is bounded in entries AND bytes, and
// never larger than the limit the same file is read back with (LIMITS): a file the reader would
// refuse is a list silently reset to empty, so writeJson() refuses to write one (D33).
var fs = require('fs'), path = require('path');

var NAME = 'stargazer';
// Only sources whose TLS chains the robot's 2016 root certificates can verify (D25). Keys of
// removed sources in an old settings.json are dropped by clean().
var SOURCES = ['hubble', 'webb', 'noirlab'];
var EFFECTS = ['kenBurns', 'iris', 'lookUp', 'starfield'];
var SHOW_FOR = [10, 30, 60, 300, 0];   // seconds before Jibo's eye returns; 0 = until closed
var SLIDESHOW = [0, 1, 5, 30];         // minutes between pictures; 0 = off
var SEEN_MAX = 300;
var KEY_MAX = 64;            // longest picture id/key kept (ours are about 20: 'hubble:potm2610a')
var TMP_STALE_MS = 60000;    // a .tmp file this old is a leftover of an interrupted write
// Largest file read back (readJson) and so largest file written (writeJson).
var LIMITS = {'settings.json': 4 * 1024, 'seen.json': 64 * 1024, 'sources.json': 16 * 1024};
// seen.json is trimmed to this on write, well under its read limit even for 3-byte characters.
var SEEN_BYTES = 32 * 1024;

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
// A usable picture id or key: a non-empty string of at most KEY_MAX characters.
function validKey(value) { return typeof value === 'string' && value.length > 0 && value.length <= KEY_MAX; }
function finite(value) { var n = Number(value); return isFinite(n) ? n : 0; }
// The ids that may be kept, oldest first: valid strings only, each once (its latest place), at
// most SEEN_MAX and at most SEEN_BYTES as JSON. The oldest go first.
function cleanSeen(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = list.length - 1; i >= 0; i--) {
        if (validKey(list[i]) && out.indexOf(list[i]) < 0) out.push(list[i]);
        if (out.length >= SEEN_MAX) break;
    }
    out.reverse();
    while (out.length && Buffer.byteLength(JSON.stringify(out), 'utf8') > SEEN_BYTES) out.shift();
    return out;
}
function readJson(file, limit) {
    try {
        var st = fs.statSync(file);
        if (!st.isFile() || st.size > limit) return null;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) { return null; }
}
// Atomic: a half-written file is never read back.
// A failed write removes its .tmp file; sweepTemporary() removes those an interrupted one left.
function writeJson(root, name, value) {
    var text = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(text, 'utf8') > LIMITS[name]) throw Error(name + ' would be over its ' + LIMITS[name] + ' byte limit');
    ensureDirectory(root);
    var target = path.join(root, name), temporary = target + '.tmp';
    try {
        fs.writeFileSync(temporary, text, {mode: 384});
        fs.renameSync(temporary, target);
    } catch (error) {
        try { fs.unlinkSync(temporary); } catch (_) {}
        throw error;
    }
    try { fs.chmodSync(target, 384); } catch (_) { /* the simulator's file system keeps host modes */ }
}

// Removes *.tmp files in the data folder that are older than TMP_STALE_MS.
function sweepTemporary(root, now) {
    try {
        fs.readdirSync(root).forEach(function (name) {
            if (!/\.tmp$/.test(name)) return;
            try {
                var file = path.join(root, name), st = fs.statSync(file);
                if (st.isFile() && now - st.mtime.getTime() > TMP_STALE_MS) fs.unlinkSync(file);
            } catch (_) {}
        });
    } catch (_) { /* no data folder yet */ }
}

class Store {
    constructor(root) { this.root = root || dataRoot(); this.swept = false; }
    read() {
        if (!this.swept) { this.swept = true; sweepTemporary(this.root, Date.now()); }
        return clean(readJson(path.join(this.root, 'settings.json'), LIMITS['settings.json']));
    }
    write(values) { var v = clean(values); writeJson(this.root, 'settings.json', v); return v; }
    seen() { return cleanSeen(readJson(path.join(this.root, 'seen.json'), LIMITS['seen.json'])); }
    // Oldest first, the first one to go once full. An id already in the list keeps its place and
    // costs no write: it is not refreshed, so after SEEN_MAX newer pictures it shows "New" once
    // more, which is harmless (D33). An id that is not a valid key is not recorded.
    markSeen(list, id) {
        if (!validKey(id)) return list;
        if (list.indexOf(id) >= 0) return list;
        var next = cleanSeen(list.concat([id]));
        try { writeJson(this.root, 'seen.json', next); } catch (_) {}
        return next;
    }
    // The newest picture last shown from each source ({id: {key, date, at}}), so the next opening
    // knows without downloading which sources may have something new (catalog.js isFresh).
    history() {
        var given = readJson(path.join(this.root, 'sources.json'), LIMITS['sources.json']), out = {};
        if (!given || typeof given !== 'object') return out;
        SOURCES.forEach(function (id) {
            var h = given[id];
            if (h && validKey(h.key)) out[id] = {key: h.key, date: finite(h.date), at: finite(h.at)};
        });
        return out;
    }
    // At most one entry per known source, so the file stays a few hundred bytes.
    remember(history, item, now) {
        if (!item || SOURCES.indexOf(item.source) < 0 || !validKey(item.key)) return history;
        var next = {};
        SOURCES.forEach(function (id) { if (history && history[id]) next[id] = history[id]; });
        next[item.source] = {key: item.key, date: finite(item.date), at: finite(now || Date.now())};
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
    NAME: NAME, SOURCES: SOURCES, EFFECTS: EFFECTS, SHOW_FOR: SHOW_FOR, SLIDESHOW: SLIDESHOW, DEFAULTS: DEFAULTS, SEEN_MAX: SEEN_MAX, KEY_MAX: KEY_MAX, LIMITS: LIMITS, SEEN_BYTES: SEEN_BYTES,
    clean: clean, dataRoot: dataRoot, onRobot: onRobot, Store: Store,
    toggleSource: toggleSource, toggleEffect: toggleEffect, nextShowFor: nextShowFor, nextSlideshow: nextSlideshow, toggle: toggle,
    enabledSources: enabledSources, closeAfter: closeAfter
};
