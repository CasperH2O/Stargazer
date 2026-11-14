'use strict';
// Navigation, settings menus and timers of Stargazer, independent of PIXI and the SDK (tested).
//
// The base screen is the picture ('viewer'), or 'loading' / 'offline' before there is one. On
// top of it: 'info' (tap the picture), and the menus 'settings' -> 'sources' | 'effects' | 'more'.
// Swipe down goes back one level; on the base screen it leaves the skill (Jibo's eye returns).
//
// Timers (user, 2026-11-14): the picture stays for "Show for" seconds (default 10) and then Jibo's
// eye returns; a touch on the picture restarts that time, and it waits while the info overlay or
// a menu is open. A running slideshow keeps Stargazer open and moves on every N minutes.
// Runs on the robot's Node 6: ES2015 only.
var L = require('./layout'), S = require('./settings'), sources = require('./sources');
var REAL_TIMERS = {setTimeout: function (fn, ms) { return setTimeout(fn, ms); }, clearTimeout: function (h) { clearTimeout(h); }};
var C = L.color;

var TEXT = {
    settings: 'Settings', settingsStatus: 'Stargazer · a new picture every day',
    sources: 'Sources', sourcesStatus: 'Pictures come from the sources that are on', lastSource: 'At least one source has to stay on',
    effects: 'Effects', effectsStatus: 'How a new picture appears',
    more: 'More', moreStatus: 'Timing and voice',
    on: 'On', offTap: 'Off · tap to turn on', experimental: 'Off · experimental',
    loading: 'Looking at the sky…',
    offlineTitle: 'Can\'t reach the sky', offlineBody: 'Jibo couldn\'t get today\'s picture.\nCheck his internet connection.', retry: 'Try again'
};
var EFFECTS = [
    {id: 'kenBurns', label: 'Ken Burns', icon: 'kenburns'},
    {id: 'iris', label: 'Telescope iris', icon: 'iris'},
    {id: 'lookUp', label: 'Look up', icon: 'lookup'},
    {id: 'starfield', label: 'Starfield', icon: 'starfield'}
];
var MORE = [
    {id: 'showFor', label: 'Show for', icon: 'timer'},
    {id: 'slideshow', label: 'Slideshow', icon: 'slideshow'},
    {id: 'readTitle', label: 'Read title aloud', icon: 'speak'},
    {id: 'caption', label: 'Show caption', icon: 'caption'}
];
var HUB = [
    {id: 'sources', label: 'Sources', icon: 'layers'},
    {id: 'effects', label: 'Effects', icon: 'starfield'},
    {id: 'more', label: 'More', icon: 'slideshow'}
];
var SOURCE_ICON = {apod: 'apod', hubble: 'hubble', webb: 'webb', eso: 'eso', noirlab: 'noirlab', 'nasa-iotd': 'iotd', epic: 'epic', 'esa-efs': 'efs'};

function showForText(seconds) {
    return seconds === 0 ? 'Until I close it' : seconds < 60 ? seconds + ' seconds' : seconds === 60 ? '1 minute' : seconds / 60 + ' minutes';
}
function slideshowText(minutes) { return minutes === 0 ? 'Off' : minutes === 1 ? 'Every minute' : 'Every ' + minutes + ' minutes'; }

class Model {
    // options: {timers, onChange(), onExit(), onNext(), onSave(values), onRetry()}
    constructor(values, options) {
        options = options || {};
        this.values = S.clean(values);
        this.timers = options.timers || REAL_TIMERS;
        this.hooks = {change: options.onChange, exit: options.onExit, next: options.onNext, save: options.onSave, retry: options.onRetry};
        this.base = 'loading'; this.stack = [];
        this.starts = {sources: 0, effects: 0, more: 0};
        this.notice = null; this.picture = null; this.revealed = false;
        this.closeTimer = null; this.slideTimer = null; this.closed = false;
    }
    call(name) { var fn = this.hooks[name]; if (fn && !this.closed) fn.apply(null, Array.prototype.slice.call(arguments, 1)); }
    emit() { this.call('change'); }
    top() { return this.stack.length ? this.stack[this.stack.length - 1] : this.base; }
    covered() { return this.stack.length > 0; }

    // ---------- base screen ----------
    loading() { this.base = 'loading'; this.revealed = false; this.stopTimers(); this.emit(); }
    offline() { this.base = 'offline'; this.revealed = false; this.stack = []; this.stopTimers(); this.emit(); }
    // A picture is on its way (item = catalog entry, extra = {isNew, sourceLabel}).
    viewing(item, extra) { this.base = 'viewer'; this.picture = {item: item, isNew: !!(extra && extra.isNew), source: extra && extra.sourceLabel || ''}; this.revealed = false; this.stopTimers(); this.emit(); }
    // A new picture is loading: the timers wait (the info overlay keeps describing the one shown).
    pause() { this.revealed = false; this.stopTimers(); }
    // The picture is fully on screen: the "Show for" time starts now.
    shown() { this.revealed = true; this.armTimers(); }
    touch() { if (this.top() === 'viewer') this.armTimers(); }

    armTimers() {
        this.stopTimers();
        if (this.closed || this.base !== 'viewer' || !this.revealed || this.covered()) return;
        var self = this, close = S.closeAfter(this.values), slide = this.values.slideshow;
        if (close > 0) this.closeTimer = this.timers.setTimeout(function () { self.closeTimer = null; self.call('exit'); }, close * 1000);
        if (slide > 0) this.slideTimer = this.timers.setTimeout(function () { self.slideTimer = null; self.revealed = false; self.call('next', 1); }, slide * 60000);
    }
    stopTimers() {
        if (this.closeTimer) this.timers.clearTimeout(this.closeTimer);
        if (this.slideTimer) this.timers.clearTimeout(this.slideTimer);
        this.closeTimer = this.slideTimer = null;
    }

    // ---------- navigation ----------
    push(name) { this.stack.push(name); this.notice = null; this.stopTimers(); this.emit(); }
    openInfo() { if (this.base === 'viewer' && !this.covered()) this.push('info'); }
    openSettings() { this.push('settings'); }
    // 'exit' when the skill should leave.
    back() {
        if (!this.stack.length) return 'exit';
        this.stack.pop(); this.notice = null;
        if (!this.stack.length) this.armTimers();
        this.emit();
        return null;
    }
    tapHub(id) { if (this.top() === 'settings' && (id === 'sources' || id === 'effects' || id === 'more')) this.push(id); }
    setStart(list, start) { this.starts[list] = start; this.emit(); }
    retry() { if (this.base === 'offline') { this.loading(); this.call('retry'); } }

    // ---------- settings ----------
    apply(result) {
        this.notice = result.refused === 'lastSource' ? {text: TEXT.lastSource, color: C.warning} : null;
        if (!result.refused) { this.values = result.values; this.call('save', this.values); }
        this.emit();
    }
    tapItem(list, id) {
        if (list === 'sources') this.apply(S.toggleSource(this.values, id));
        else if (list === 'effects') this.apply(S.toggleEffect(this.values, id));
        else if (list === 'more') {
            if (id === 'showFor') this.apply(S.nextShowFor(this.values));
            else if (id === 'slideshow') this.apply(S.nextSlideshow(this.values));
            else if (id === 'readTitle' || id === 'caption') this.apply(S.toggle(this.values, id));
        }
    }

    // ---------- what the screen draws ----------
    listItems(list) {
        var v = this.values;
        function onOff(on, offText) { return on ? {caption: TEXT.on, captionColor: C.success, dim: false} : {caption: offText || TEXT.offTap, captionColor: C.caption, dim: true}; }
        if (list === 'sources') return S.SOURCES.map(function (id) {
            var s = sources.get(id), state = onOff(v.sources[id], s.experimental ? TEXT.experimental : null);
            return Object.assign({id: id, label: s.label, icon: SOURCE_ICON[id]}, state);
        });
        if (list === 'effects') return EFFECTS.map(function (e) { return Object.assign({id: e.id, label: e.label, icon: e.icon}, onOff(v.effects[e.id])); });
        return MORE.map(function (m) {
            var base = {id: m.id, label: m.label, icon: m.icon};
            if (m.id === 'showFor') return Object.assign(base, v.slideshow ? {caption: 'Open while slideshow runs', captionColor: C.caption, dim: true} : {caption: showForText(v.showFor), captionColor: C.success, dim: false});
            if (m.id === 'slideshow') return Object.assign(base, v.slideshow ? {caption: slideshowText(v.slideshow), captionColor: C.success, dim: false} : {caption: 'Off · tap to turn on', captionColor: C.caption, dim: true});
            if (m.id === 'readTitle') return Object.assign(base, v.readTitle ? {caption: 'On · title only', captionColor: C.success, dim: false} : onOff(false));
            return Object.assign(base, onOff(v[m.id]));
        });
    }
    view() {
        var top = this.top(), v = this.values;
        var vm = {screen: top, base: this.base, covered: this.covered(), title: '', status: '', statusColor: C.muted, tiles: null, picture: this.picture};
        if (top === 'settings') {
            var on = S.enabledSources(v).length, fx = S.EFFECTS.filter(function (k) { return v.effects[k]; }).length;
            vm.title = TEXT.settings; vm.status = TEXT.settingsStatus;
            var captions = {sources: on + ' of ' + S.SOURCES.length + ' on', effects: fx + ' of ' + S.EFFECTS.length + ' on',
                more: v.slideshow ? slideshowText(v.slideshow) : 'Show for ' + showForText(v.showFor).toLowerCase()};
            vm.tiles = {kind: 'hub', items: HUB.map(function (h) { return {id: h.id, label: h.label, icon: h.icon, caption: captions[h.id], captionColor: C.muted}; })};
        } else if (top === 'sources' || top === 'effects' || top === 'more') {
            vm.title = TEXT[top]; vm.status = TEXT[top + 'Status'];
            var items = this.listItems(top), count = items.length, start = L.clampStart(this.starts[top], count);
            vm.tiles = {kind: 'list', list: top, items: items, start: start, pager: L.pagerBar(start, count),
                canBack: start > 0, canForward: start < L.pageStart(L.pages(count) - 1, count)};
        } else if (top === 'offline') {
            vm.title = TEXT.offlineTitle; vm.titleColor = C.danger; vm.body = TEXT.offlineBody; vm.button = {kind: 'retry', caption: TEXT.retry};
        } else if (top === 'loading') {
            vm.hint = TEXT.loading;
        }
        if (this.notice) { vm.status = this.notice.text; vm.statusColor = this.notice.color; }
        return vm;
    }
    close() { this.closed = true; this.stopTimers(); }
}

Model.TEXT = TEXT; Model.showForText = showForText; Model.slideshowText = slideshowText;
module.exports = Model;
