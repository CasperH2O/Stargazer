'use strict';
// The pictures on offer: the newest few from every source that is on, interleaved so that sources
// take turns (each source's newest first, ordered by date, then each source's second newest, ...).
// A daily source therefore cannot bury the weekly and monthly ones. Lists are fetched in parallel;
// a source that fails is skipped (and logged), so one broken feed never blocks the others. Only metadata is kept (in memory, for an hour, shared between
// openings while Be runs). Details a source reads from the picture's own page (credit, object)
// are filled in by resolve() just before the picture is shown.
// Runs on the robot's Node 6: ES2015 only.
var sources = require('./sources');

var PER_SOURCE = 6, FRESH_MS = 60 * 60 * 1000, LIST_TIMEOUT = 25000;
var memory = {};   // source id -> {at, items}  (module level: survives closing and reopening)

function withTimeout(promise, ms, timers) {
    return new Promise(function (resolve, reject) {
        var timer = timers.setTimeout(function () { reject(Error('timeout')); }, ms);
        promise.then(function (v) { timers.clearTimeout(timer); resolve(v); }, function (e) { timers.clearTimeout(timer); reject(e); });
    });
}

// options: {net, log, timers, now}
function Catalog(options) {
    this.net = options.net; this.log = options.log || {info: function () {}, warn: function () {}};
    this.timers = options.timers || {setTimeout: function (f, ms) { return setTimeout(f, ms); }, clearTimeout: function (h) { clearTimeout(h); }};
    this.now = options.now || function () { return Date.now(); };
    this.registry = options.sources || sources.BY_ID;
    this.memory = options.memory || memory;
    this.items = []; this.failed = [];
}
// Loads the lists of the enabled source ids; resolves to the merged list (may be empty).
Catalog.prototype.load = function (ids) {
    var self = this, now = this.now();
    this.failed = [];
    return Promise.all(ids.map(function (id) {
        var source = self.registry[id], cached = self.memory[id];
        if (!source) return [];
        if (cached && now - cached.at < FRESH_MS) return cached.items;
        return withTimeout(Promise.resolve().then(function () { return source.list(self.net, PER_SOURCE); }), LIST_TIMEOUT, self.timers).then(function (items) {
            self.memory[id] = {at: now, items: items};
            return items;
        }, function (error) {
            self.failed.push(id);
            self.log.warn('source', id, 'skipped:', error && error.message || error);
            return cached ? cached.items : [];
        });
    })).then(function (lists) {
        self.items = interleave(lists);
        return self.items;
    });
};
// Fills in page details when the source needs them; a failure still shows the picture.
Catalog.prototype.resolve = function (item) {
    var source = this.registry[item.source], self = this;
    if (!item.needsResolve || !source || !source.resolve) return Promise.resolve(item);
    return source.resolve(item, this.net).catch(function (error) {
        self.log.warn('details for', item.key, 'unavailable:', error && error.message || error);
        item.needsResolve = false;
        if (!item.line) item.line = source.short;
        if (!item.credit) item.credit = source.short;
        return item;
    });
};
// Where to start: the newest picture not seen before, else the newest.
Catalog.prototype.startIndex = function (seen) {
    for (var i = 0; i < this.items.length; i++) if (seen.indexOf(this.items[i].key) < 0) return i;
    return 0;
};
function byDate(a, b) { return (b.date || 0) - (a.date || 0); }
function interleave(lists) {
    var seen = {}, out = [];
    // A picture that two sources share counts once, for the source listed first.
    var unique = lists.map(function (l) { return l.slice().sort(byDate).filter(function (item) { if (seen[item.key]) return false; seen[item.key] = true; return true; }); });
    var depth = Math.max.apply(null, [0].concat(unique.map(function (l) { return l.length; })));
    for (var r = 0; r < depth; r++) unique.map(function (l) { return l[r]; }).filter(Boolean).sort(byDate).forEach(function (item) { out.push(item); });
    return out;
}
Catalog.interleave = interleave;
Catalog.forget = function () { Object.keys(memory).forEach(function (k) { delete memory[k]; }); };

module.exports = Catalog;
