'use strict';
// Which picture to show: one source, chosen at random, and that source's newest picture.
//
// order() puts "fresh" sources first: those known, without downloading, to have a picture not
// shown yet. That is when its list in memory has an unseen newest picture, or (no list in memory)
// it never showed a picture here or its publishing cadence has passed since the last one shown.
// Only the chosen source's list is fetched (list()); the caller moves on to the next on failure.
// Lists stay in memory for an hour, shared between openings. resolve() fills in the details a
// source reads from the picture's own page just before it is shown.
var sources = require('./sources');

var PER_SOURCE = 3, FRESH_MS = 60 * 60 * 1000, LIST_TIMEOUT = 25000, DAY = 24 * 60 * 60 * 1000;
// How often each source publishes a new picture, in days (notes/SOURCES.md).
var CADENCE_DAYS = {noirlab: 7, hubble: 30, webb: 30};
var memory = {};   // source id -> {at, items}  (module level: survives closing and reopening)

function withTimeout(promise, ms, timers) {
    return new Promise(function (resolve, reject) {
        var timer = timers.setTimeout(function () { reject(Error('timeout')); }, ms);
        promise.then(function (v) { timers.clearTimeout(timer); resolve(v); }, function (e) { timers.clearTimeout(timer); reject(e); });
    });
}

// options: {net, log, timers, now, sources, memory}
function Catalog(options) {
    this.net = options.net; this.log = options.log || {info: function () {}, warn: function () {}};
    this.timers = options.timers || {setTimeout: function (f, ms) { return setTimeout(f, ms); }, clearTimeout: function (h) { clearTimeout(h); }};
    this.now = options.now || function () { return Date.now(); };
    this.registry = options.sources || sources.BY_ID;
    this.memory = options.memory || memory;
}
// The list still in memory for this source, or null.
Catalog.prototype.cached = function (id) {
    var cached = this.memory[id];
    return cached && this.now() - cached.at < FRESH_MS ? cached.items : null;
};
// history: {source id: {key, date, at}}, the newest picture last shown from each source.
Catalog.prototype.isFresh = function (id, seen, history) {
    var items = this.cached(id);
    if (items) return items.length > 0 && seen.indexOf(items[0].key) < 0;
    var last = history && history[id];
    if (!last) return true;
    var from = last.date || last.at || 0;
    return this.now() >= from + (CADENCE_DAYS[id] || 1) * DAY;
};
// The order to try the enabled sources in: fresh ones first, each group shuffled. `avoid` (the
// source just shown, for the slideshow) goes last.
Catalog.prototype.order = function (ids, seen, history, random, avoid) {
    var self = this;
    random = random || Math.random;
    function shuffle(list) {
        for (var i = list.length - 1; i > 0; i--) { var j = Math.floor(random() * (i + 1)), t = list[i]; list[i] = list[j]; list[j] = t; }
        return list;
    }
    var known = ids.filter(function (id) { return self.registry[id] && id !== avoid; });
    var fresh = known.filter(function (id) { return self.isFresh(id, seen, history); });
    var stale = known.filter(function (id) { return fresh.indexOf(id) < 0; });
    var order = shuffle(fresh).concat(shuffle(stale));
    if (avoid && ids.indexOf(avoid) >= 0 && this.registry[avoid]) order.push(avoid);
    return order;
};
// One source's pictures, newest first (fetched, or from memory). Rejects when the source fails or
// has nothing.
Catalog.prototype.list = function (id) {
    var self = this, source = this.registry[id], items = this.cached(id), now = this.now();
    if (!source) return Promise.reject(Error('unknown_source'));
    if (items) return items.length ? Promise.resolve(items) : Promise.reject(Error('empty'));
    var fetched = Promise.resolve().then(function () { return source.list(self.net, PER_SOURCE); });
    return withTimeout(fetched, LIST_TIMEOUT, self.timers).then(function (list) {
        list = (list || []).slice();        // every source lists newest first (listing items may have no date)
        self.memory[id] = {at: now, items: list};
        if (!list.length) throw Error('empty');
        return list;
    });
};
// Fills in page details when the source needs them; a failure still shows the picture.
Catalog.prototype.resolve = function (item) {
    var source = this.registry[item.source], self = this;
    if (!item.needsResolve || !source || !source.resolve) return Promise.resolve(item);
    return source.resolve(item, this.net).catch(function (error) {
        self.log.warn('details for', item.key, 'unavailable:', error && error.message || error);
        item.needsResolve = false;
        if (!item.title) item.title = source.label || source.short;   // listing items get their title from the page
        if (!item.line) item.line = source.short;
        if (!item.credit) item.credit = source.short;
        return item;
    });
};
Catalog.CADENCE_DAYS = CADENCE_DAYS;
Catalog.forget = function () { Object.keys(memory).forEach(function (k) { delete memory[k]; }); };

module.exports = Catalog;
