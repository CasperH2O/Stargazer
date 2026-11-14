'use strict';
// Stargazer's face UI: one SDK View. The picture (lib/presenter.js and its effects) is a PIXI layer
// at the bottom of the view's stage; the info overlay, menus and offline screen are the SDK's own
// Labels, SkillButtons and ActionButtons in the classic look, shown per screen from model.view().
// The view lifecycle, paging and hidden-view cleanup follow the Bluetooth skill (same author).
// Runs in the skill page (Chromium 53 / Node 6): ES2015 only.
var path = require('path');
var layout = require('./layout'), createArt = require('./art'), createLog = require('./log');
var Model = require('./model'), S = require('./settings'), Presenter = require('./presenter');
var Catalog = require('./catalog'), Images = require('./images').Images, net = require('./net');
var sources = require('./sources'), Motion = require('./motion').Motion;
var C = layout.color, P = layout.pairs, TL = layout.tiles, I = layout.info;

function OWN(name) { return path.join(__dirname, '..', 'resources', 'icons', name + '.png'); }
var LISTS = ['sources', 'effects', 'more'];
var RETRY_MS = 60000;        // offline: try again by itself every minute
var WATCHDOG_MS = 20000;     // still loading after this long: log where it is stuck (and every 20 s after)
var GIVE_UP_MS = 90000;      // still loading after this long: show the offline screen (it retries by itself)
var CLOSE_MS = 3000;         // our own limit for the view's close, shorter than Be's 5 s force-close
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function day(ms) { if (!ms) return ''; var d = new Date(ms); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }

// deps (tests only): {store, net, Presenter, Images, Catalog, createArt, Motion, document, closeMs, watchdogMs, giveUpMs}
module.exports = function createScreen(jibo, BeSkill, deps) {
    deps = deps || {};
    var PresenterClass = deps.Presenter || Presenter, ImagesClass = deps.Images || Images, CatalogClass = deps.Catalog || Catalog;
    var makeArt = deps.createArt || createArt, MotionClass = deps.Motion || Motion;
    var closeMs = deps.closeMs || CLOSE_MS, watchdogMs = deps.watchdogMs || WATCHDOG_MS, giveUpMs = deps.giveUpMs || GIVE_UP_MS;
    function doc() { return deps.document || (typeof document !== 'undefined' ? document : undefined); }
    function frame(fn) { return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16); }
    return class StargazerSkill extends BeSkill {
        constructor() {
            super(...arguments);
            this.diagnostics = createLog(this.log);
            this.view = null; this.model = null; this.vm = null; this.leaving = false; this.closing = null;
            this.cache = new Map(); this.labels = {}; this.fills = {}; this.ids = []; this.rows = {};
            this.decor = null; this.art = null; this.presenter = null; this.images = null; this.catalog = null;
            this.token = 0; this.loop = null; this.retryTimer = null; this.watchdog = null;
            this.slide = {x: 0, velocity: 0, target: 0}; this.dragging = null; this.animation = null; this.pan = null; this.tapping = false;
            this.spoken = null; this.speaking = false; this.dirty = false; this.sourcesKey = null; this.store = null; this.seen = []; this.history = {};
            this.onScreen = {}; this.current = null; this.pending = null; this.opening = null; this.loadingSince = 0; this.openedAt = 0; this.openings = 0;
        }
        // Milliseconds since this opening started, for the log.
        since() { return (Date.now() - this.openedAt) + ' ms'; }
        active() {
            var views = jibo.face.views;
            return !!this.view && !this.closing && !this.leaving && views.currentView === this.view && this.view.state !== 'destroyed' &&
                !this.view.inputLocked && !(views._viewProcess && views._viewProcess.active);
        }
        open() {
            var self = this, views = jibo.face.views;
            this.openedAt = Date.now(); this.openings++;
            // A close still in flight: open once it has settled (it gives up after CLOSE_MS).
            if (this.closing) {
                this.diagnostics.warn('open #' + this.openings + ' while the last close is still running: waiting for it');
                this.closing.then(function () { self.open(); }, function () { self.open(); });
                return;
            }
            // Left over from an opening whose close failed (Be then resets the face): start clean.
            if (this.view || this.model) {
                this.diagnostics.warn('open #' + this.openings + ': dropping state left from the last opening (view', (this.view ? this.view.state : 'none') + ')');
                this.halt(); this.disposeDecor(); this.view = null;
                if (this.model) { this.model.close(); this.model = null; }
            }
            this.leaving = false; this.closing = null; this.slide = {x: 0, velocity: 0, target: 0};
            this.dirty = false; this.sourcesKey = null; this.spoken = null; this.current = null; this.pending = null; this.onScreen = {};
            if (!views || !views.createView || !views.changeView || !global.PIXI) { this.exit({noElementsOfSurprise: true}); return; }
            this.store = deps.store || new S.Store();
            var values = this.store.read();
            this.seen = this.store.seen();
            this.history = this.store.history();
            this.model = new Model(values, {
                onChange: function () { self.render(); },
                onExit: function () { self.diagnostics.info('show time over: back to the eye'); self.leave(); },
                onNext: function () { self.next(); },
                onSave: function (v) { self.saved(v); },
                onRetry: function () { self.start(); }
            });
            this.motion = new MotionClass(jibo, this.diagnostics);
            this.images = new ImagesClass({PIXI: global.PIXI, net: deps.net || net, log: this.diagnostics});
            this.catalog = new CatalogClass({net: deps.net || net, log: this.diagnostics});
            this.diagnostics.info('opened #' + this.openings + '; sources', S.enabledSources(values).join(','), '; effects', S.EFFECTS.filter(function (k) { return values.effects[k]; }).join(',') || 'none');
            // The picture loads while Jibo looks through his telescope (the jiboji plays on his real
            // eye, which our view would hide); the view goes up when the jiboji is over.
            this.start();
            var opening = this.opening = {};
            this.motion.jiboji().then(function () {
                if (self.opening !== opening || !self.model || self.closing) return;
                self.opening = null;
                self.showView();
            });
        }
        showView() {
            var self = this, views = jibo.face.views;
            this.view = views.createView('View', this.config(views));
            this.view.viewStateStacked = true;
            this.view.addAction(views.ActionData.CALLBACK, {callback: function () { self.swipeDown(); }}, true, false, views.GESTURE.SWIPE_DOWN);
            var view = this.view;
            function ours() { return self.view === view && !!self.model && !self.closing; }
            views.changeView({addView: this.view, transitionOpen: views.TRANSITION.IN, transitionClose: views.TRANSITION.OUT},
                function () { if (ours()) { self.diagnostics.info('view open after', self.since()); self.render(); } },
                function () { self.diagnostics.warn('view failed to open after', self.since()); if (ours()) self.leave(); },
                function () { if (ours()) { self.diagnostics.info('view loaded after', self.since()); self.ensureDecor(); self.render(); } });
        }

        // ---------- pictures ----------
        // One source, chosen at random among those known to have something new (catalog.js), and
        // its newest picture. With a picture on screen (slideshow) it stays until the next one is in.
        start(avoid) {
            var self = this, token = ++this.token, values = this.model.values, replacing = !!this.current;
            if (!replacing) {
                this.model.loading();
                if (this.presenter) this.presenter.wait();
                this.armWatchdog(token);
            } else this.model.pause();
            var order = this.catalog.order(S.enabledSources(values), this.seen, this.history, Math.random, avoid);
            this.diagnostics.info('picture choice:', order.join(' > ') || 'none', '(' + this.since() + ')');
            this.trySource(order, 0, token);
        }
        trySource(order, n, token) {
            var self = this;
            if (token !== this.token || !this.model) return;
            if (n >= order.length) { this.failed('no picture could be loaded', token); return; }
            var id = order[n], at = Date.now();
            this.catalog.list(id).then(function (items) {
                if (token !== self.token || !self.model) return;
                self.diagnostics.info('source', id, 'listed', items.length, 'in', (Date.now() - at) + ' ms');
                // Its newest picture; the one before it only if the newest can't be loaded.
                self.tryItem(items.slice(0, 2), 0, token, function () { self.trySource(order, n + 1, token); });
            }, function (error) {
                if (token !== self.token) return;
                self.diagnostics.warn('source', id, 'skipped:', error && error.message || error);
                self.trySource(order, n + 1, token);
            });
        }
        tryItem(items, n, token, otherwise) {
            var self = this;
            if (token !== this.token || !this.model) return;
            if (n >= items.length) { otherwise(); return; }
            var item = items[n], at = Date.now();
            this.keepImages([item.key]);
            Promise.all([this.catalog.resolve(item), this.images.load(item)]).then(function (results) {
                if (token !== self.token || !self.model) return;
                self.diagnostics.info('picture', item.key, 'loaded in', (Date.now() - at) + ' ms (' + self.since() + ')');
                self.present({item: item, picture: results[1], token: token});
            }, function (error) {
                if (token !== self.token) return;
                self.diagnostics.warn('picture', item.key, 'failed:', error && error.message || error);
                self.tryItem(items, n + 1, token, otherwise);
            });
        }
        // Hands a loaded picture to the presenter. The presenter only exists once the view has
        // loaded (ensureDecor); a picture that is in sooner waits in this.pending for it.
        present(next) {
            if (next.token !== this.token || !this.model) return;
            if (!this.presenter) {
                this.pending = next;
                this.diagnostics.info('picture ready before the view: waiting for it (' + this.since() + ')');
                return;
            }
            this.pending = null;
            this.disarmWatchdog();
            var item = next.item, source = sources.get(item.source);
            this.current = {item: item, picture: next.picture, token: next.token};
            this.model.viewing(item, {isNew: this.seen.indexOf(item.key) < 0, sourceLabel: source ? source.label : ''});
            this.onScreen[item.key] = (this.onScreen[item.key] || 0) + 1;
            this.presenter.configure({effects: this.model.values.effects, showCaption: this.model.values.caption});
            this.presenter.show(next.picture.texture, {title: item.title, line: item.line, credit: sources.creditLine(item)});
            this.render();                      // the info overlay may now show the resolved details
        }
        failed(reason, token) {
            if (token !== this.token || !this.model) return;
            if (this.current) {                 // slideshow: keep the picture on screen, try again next time
                this.diagnostics.warn('next picture:', reason, '- keeping this one');
                this.model.shown();
                return;
            }
            this.offline(reason);
        }
        offline(reason) {
            var self = this;
            this.diagnostics.warn('offline:', reason || '', '(' + this.since() + ')');
            this.disarmWatchdog();
            if (!this.model) return;
            this.token++;                       // anything still loading is no longer wanted
            this.pending = null;
            this.model.offline();
            clearTimeout(this.retryTimer);
            this.retryTimer = setTimeout(function () { if (self.model && self.model.base === 'offline') self.model.retry(); }, RETRY_MS);
        }
        // Loading that takes too long is logged with where it is stuck, and given up on after GIVE_UP_MS.
        armWatchdog(token) {
            var self = this;
            this.disarmWatchdog();
            this.loadingSince = Date.now();
            this.watchdog = setInterval(function () {
                if (token !== self.token || !self.model || self.model.base !== 'loading') { self.disarmWatchdog(); return; }
                var waited = Date.now() - self.loadingSince;
                self.diagnostics.warn('still loading after', waited + ' ms:', JSON.stringify(self.state()));
                if (waited >= giveUpMs) self.offline('loading took too long');
            }, watchdogMs);
        }
        disarmWatchdog() { if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; } }
        // A one-line summary of the skill's state for the log.
        state() {
            var views = jibo.face.views, v = this.view;
            return {view: v ? v.state : null, current: !!(v && views && views.currentView === v), decor: !!this.decor, presenter: !!this.presenter,
                pending: this.pending ? this.pending.item.key : null, base: this.model ? this.model.base : null, stack: this.model ? this.model.stack.join('/') : null,
                images: this.images ? this.images.count() : null, loop: !!this.loop, closing: !!this.closing, leaving: this.leaving, token: this.token};
        }
        // Slideshow: another source's newest picture.
        next() {
            if (!this.model || this.model.base !== 'viewer') return;
            this.stopSpeaking();
            this.start(this.current && this.current.item.source);
        }
        // Keep these pictures and every picture still on screen (shown or fading out); release the rest.
        keepImages(keys) {
            var self = this, keep = keys.slice();
            Object.keys(this.onScreen).forEach(function (key) { if (self.onScreen[key] > 0) keep.push(key); });
            this.images.keep(keep);
        }
        // The presenter is done with a texture (its sprite has gone).
        retired(texture) {
            var self = this;
            Object.keys(this.images.live).forEach(function (key) {
                var slot = self.images.live[key];
                if (!slot.picture || slot.picture.texture !== texture) return;
                self.onScreen[key] = Math.max(0, (self.onScreen[key] || 0) - 1);
                if (!self.onScreen[key] && (!self.current || self.current.item.key !== key)) self.images.release(key);
            });
        }
        // The picture is fully on screen.
        shown() {
            if (!this.model || !this.current || this.current.token !== this.token) return;   // a newer picture is loading
            var item = this.current.item;
            this.diagnostics.info('showing', item.key, '(' + this.since() + ')');
            this.model.shown();
            this.seen = this.store.markSeen(this.seen, item.key);
            this.history = this.store.remember(this.history, item);
            if (this.model.values.readTitle && this.spoken !== item.key && !this.model.covered()) { this.spoken = item.key; this.speak(item.title); }
        }
        speak(text) {
            var self = this, tts = jibo.tts;
            if (!tts || typeof tts.speak !== 'function' || !text) return;
            this.speaking = true;
            try { Promise.resolve(tts.speak(text)).catch(function () {}).then(function () { self.speaking = false; }); } catch (_) { this.speaking = false; }
        }
        stopSpeaking() {
            if (!this.speaking) return;
            this.speaking = false;
            try { Promise.resolve(jibo.tts.stop()).catch(function () {}); } catch (_) {}
        }
        saved(values) {
            try { this.store.write(values); } catch (error) { this.diagnostics.warn('settings not saved:', error && error.message); }
            if (this.presenter) this.presenter.configure({effects: values.effects, showCaption: values.caption});
            this.dirty = this.dirty || this.sourcesKey !== S.enabledSources(values).join(',');
        }

        // ---------- input ----------
        swipeDown() {
            if (this.leaving || !this.model) return;
            if (this.dragging || this.animation) { this.dragging = null; this.settle(0); }
            var top = this.model.top();
            if (LISTS.indexOf(top) >= 0) this.slide = {x: 0, velocity: 0, target: 0};
            if (this.model.back() === 'exit') { this.leave(); return; }
            if (!this.model.covered() && this.dirty) { this.dirty = false; this.sourcesKey = S.enabledSources(this.model.values).join(','); this.current = null; this.start(); }
        }
        leave() {
            if (this.leaving) return;
            this.leaving = true;
            this.exit({noElementsOfSurprise: true});
        }
        tapPicture() {
            if (!this.model || this.model.top() !== 'viewer') return;
            this.model.openInfo();
        }
        press(kind) {
            var m = this.model;
            if (!m) return;
            if (kind === 'retry') m.retry();
            else if (kind === 'settings') { this.sourcesKey = S.enabledSources(m.values).join(','); m.openSettings(); }
        }

        // ---------- the view's components ----------
        config(views) {
            var self = this, components = [];
            this.ids = []; this.cache = new Map(); this.labels = {}; this.fills = {}; this.rows = {};
            function callback(fn) { return {type: views.ActionData.CALLBACK, data: {callback: function () { if (self.active() && !self.dragging && !self.animation) fn(); }}}; }
            function label(id, x, y, size, width, options) {
                options = options || {};
                var fill = options.fill || C.text;
                self.ids.push(id); self.labels[id] = null; self.fills[id] = fill;
                var style = {fontFamily: options.bold ? layout.font.title : layout.font.body, fontSize: size, fill: fill, align: 'center', fontWeight: options.bold ? 'bold' : 'normal'};
                if (options.lines) { style.wordWrap = true; style.wordWrapWidth = width; style.lineHeight = options.line; }
                components.push({type: 'Label', id: id, text: ' ', position: {x: x, y: y}, targetAnchor: {x: 0.5, y: options.lines ? 0 : 0.5},
                    bounds: {width: width, height: options.lines ? options.lines * options.line + size * 0.6 : size * 1.6}, style: style});
            }
            function tile(id, icon, x, fn) {
                self.ids.push(id);
                components.push({type: 'SkillButton', id: id, iconSrc: OWN('tile-' + icon), colors: P.space, position: {x: x, y: TL.y}, action: callback(fn)});
            }
            function action(id, icon, colors, cx, cy, size, fn) {
                self.ids.push(id);
                var scale = size / layout.dialog.button;
                components.push({type: 'ActionButton', id: id, iconSrc: OWN('action-' + icon), colors: colors, position: {x: cx - size / 2, y: cy - size / 2},
                    transform: {scaleX: scale, scaleY: scale}, action: callback(fn)});
            }
            label('title', 640, layout.title.y, layout.title.size, layout.title.width, {bold: true});
            label('status', 640, layout.status.one.y, layout.status.one.size, layout.status.width, {fill: C.muted});
            // Settings hub: three tiles.
            [['sources', 'layers'], ['effects', 'starfield'], ['more', 'slideshow']].forEach(function (spec, i) {
                var x = layout.slotX(i);
                tile('hub-' + spec[0], spec[1], x, function () { if (self.model) self.model.tapHub(spec[0]); });
                label('hub-' + spec[0] + '-label', x + TL.width / 2, TL.label.y, TL.label.size, TL.label.width);
                label('hub-' + spec[0] + '-caption', x + TL.width / 2, TL.caption.y, TL.caption.size, TL.caption.width + 20, {fill: C.muted});
            });
            // The three lists: one tile per item; paging slides the row (place()).
            var probe = new Model(S.DEFAULTS);
            LISTS.forEach(function (list) {
                self.rows[list] = [];
                probe.listItems(list).forEach(function (item, n) {
                    var base = list + '-' + item.id, x = layout.slotX(n);
                    tile(base, item.icon, x, function () { if (self.model) self.model.tapItem(list, item.id); });
                    label(base + '-label', x + TL.width / 2, TL.label.y, TL.label.size, TL.label.width);
                    label(base + '-caption', x + TL.width / 2, TL.caption.y, TL.caption.size, TL.caption.width + 20);
                    self.rows[list].push({id: item.id, ids: [base, base + '-label', base + '-caption'], n: n});
                });
            });
            // Info overlay.
            label('info-title', 640, I.title.y, I.title.size, layout.title.width, {bold: true});
            label('info-meta', 640, I.meta.y, I.meta.size, layout.title.width, {fill: C.muted});
            label('info-body', 640, I.body.y, I.body.size, I.body.width, {lines: I.body.lines, line: I.body.line});
            label('info-credit', 640, I.credit.y, I.credit.size, layout.title.width, {fill: C.muted});
            action('btn-settings', 'gear', P.grey, I.buttons.x, I.buttons.y, I.buttons.size, function () { self.press('settings'); });
            label('cap-settings', I.buttons.x, I.caption.y, I.caption.size, 300);
            // Offline.
            label('body', 640, layout.dialog.large.y - 40, layout.dialog.large.size - 5, layout.dialog.large.width, {lines: 2, line: layout.dialog.large.line});
            action('btn-retry', 'refresh', P.confirm, 640, layout.dialog.single, layout.dialog.button, function () { self.press('retry'); });
            label('cap-retry', 640, layout.dialog.caption + (layout.dialog.single - layout.dialog.y), layout.dialog.captionSize, 400);
            // Loading.
            label('hint', 640, 620, 45, layout.title.width, {fill: C.muted});
            return {viewConfig: {type: 'View', id: 'stargazer', category: 'gui', ignoreSwipeDown: true, transitionStageOnly: true}, componentConfigs: components};
        }
        // Buttons are built once their icons load, after the view opens: a component not there
        // yet is looked up again next time instead of being cached as missing.
        component(id) {
            var c = this.cache.get(id);
            if (!c && this.view) { c = this.view.getComponentById(id); if (c) this.cache.set(id, c); }
            return c;
        }
        show(id, visible) { var c = this.component(id); if (c && c.display) c.display.visible = visible; }
        alpha(id, value) { var c = this.component(id); if (c && c.display) c.display.alpha = value; }
        fill(id, value) {
            var c = this.component(id);
            if (!c || this.fills[id] === value) return;
            this.fills[id] = value;
            if (c.style) c.style.fill = value;
            if (c.textDisplay && c.textDisplay.style) c.textDisplay.style.fill = value;
        }
        text(id, value, min) {
            value = value || ' ';
            var key = value + '|' + (min || '');
            if (this.labels[id] === key) return;
            var c = this.component(id);
            if (c) { c.text = this.fit(c, value, min); this.labels[id] = key; }
        }
        fit(component, value, min) {
            var PIXI = global.PIXI, style = component.style, bounds = component.bounds;
            if (!PIXI || !PIXI.TextMetrics || !style || !bounds || !bounds.width || style.wordWrap) return value;
            var base = component._originalFontSize || style.fontSize;
            return layout.fit(value, bounds.width, base, Math.min(base, min || base), function (candidate, size) {
                var copy = typeof style.clone === 'function' ? style.clone() : Object.assign({}, style);
                copy.fontSize = size;
                return PIXI.TextMetrics.measureText(candidate, copy).width;
            }).text;
        }

        // ---------- drawing ----------
        render() {
            try { this.draw(); } catch (error) { this.diagnostics.error('render failed:', error && error.stack || error); }
        }
        draw() {
            if (!this.view || !this.model || typeof this.view.getComponentById !== 'function' || this.view.state === 'destroyed') return;
            this.ensureDecor();
            var vm = this.vm = this.model.view(), want = {}, self = this;
            function on(id) { want[id] = true; }
            var menu = vm.tiles !== null;
            if (vm.title) { this.text('title', vm.title, 56); this.fill('title', vm.titleColor || C.text); on('title'); }
            if (vm.status) { this.text('status', vm.status, 32); this.fill('status', vm.statusColor); on('status'); }
            if (vm.tiles && vm.tiles.kind === 'hub') vm.tiles.items.forEach(function (item) {
                var id = 'hub-' + item.id;
                on(id); on(id + '-label'); on(id + '-caption');
                self.text(id + '-label', item.label, TL.label.min); self.text(id + '-caption', item.caption, 30);
            });
            if (vm.tiles && vm.tiles.kind === 'list') this.renderList(vm.tiles, on);
            this.panning(!!(vm.tiles && vm.tiles.kind === 'list' && vm.tiles.items.length > TL.perPage));
            if (vm.screen === 'info' && vm.picture) this.renderInfo(vm.picture, on);
            if (vm.body) { this.text('body', vm.body); on('body'); }
            if (vm.button) { on('btn-' + vm.button.kind); this.text('cap-' + vm.button.kind, vm.button.caption); on('cap-' + vm.button.kind); }
            if (vm.hint) { this.text('hint', vm.hint); on('hint'); }
            this.ids.forEach(function (id) { self.show(id, !!want[id]); });
            // The picture layer: hidden under menus and the offline screen, dimmed under the info overlay.
            if (this.decor) {
                this.decor.root.visible = !menu && vm.screen !== 'offline';
                this.decor.scrim.visible = vm.screen === 'info';
                var bar = vm.tiles && vm.tiles.pager;
                this.decor.track.visible = this.decor.thumb.visible = !!bar;
                if (bar) { this.decor.thumb.texture = this.art.pill(bar.thumb.width, bar.thumb.height, C.thumb); this.decor.thumb.position.set(bar.thumb.x, bar.thumb.y); }
            }
            if (this.presenter) this.presenter.cover(vm.covered);
            this.tapOnPicture(vm.screen === 'viewer');
            this.place(this.slide.x);
        }
        renderList(t, on) {
            var self = this, row = this.rows[t.list];
            this.listShown = t.list;
            t.items.forEach(function (item, n) {
                var ids = row[n].ids, rel = n - t.start;
                if (rel < -1 || rel > TL.perPage) return;
                on(ids[0]); self.alpha(ids[0], item.dim ? TL.dim : 1);
                if (rel >= 0 && rel < TL.perPage) {
                    on(ids[1]); on(ids[2]);
                    self.text(ids[1], item.label, TL.label.min); self.fill(ids[1], item.dim ? C.caption : C.text);
                    self.text(ids[2], item.caption, 30); self.fill(ids[2], item.captionColor);
                }
            });
        }
        renderInfo(p, on) {
            var item = p.item;
            this.text('info-title', item.title, 44); on('info-title');
            this.text('info-meta', (p.isNew ? 'New · ' : '') + [p.source, day(item.date)].filter(Boolean).join(' · '), 30); on('info-meta');
            this.fill('info-meta', p.isNew ? C.accent : C.muted);
            if (item.description) { this.text('info-body', sources.short(item.description)); on('info-body'); }
            var credit = sources.creditLine(item);
            if (credit) { this.text('info-credit', credit, 30); on('info-credit'); }
            on('btn-settings'); this.text('cap-settings', 'Settings'); on('cap-settings');
        }
        // A tap anywhere on the picture opens the info overlay. A view-wide tap action would
        // swallow the buttons' taps, so it exists only while the bare picture shows.
        tapOnPicture(on) {
            var views = jibo.face.views, self = this;
            if (!this.view || on === this.tapping) return;
            this.tapping = on;
            if (on) this.view.addAction(views.ActionData.CALLBACK, {callback: function () { if (self.active()) { if (self.model) self.model.touch(); self.tapPicture(); } }}, true, false, views.GESTURE.TAP);
            else if (typeof this.view.clearActions === 'function') this.view.clearActions(views.GESTURE.TAP);
        }
        ensureDecor() {
            var PIXI = global.PIXI, self = this;
            if (this.decor) return true;
            if (!this.model || !this.view || !this.view.stage || !PIXI || !doc()) return false;
            var art = this.art = makeArt(PIXI, doc());
            var root = new PIXI.Container(), scrim = new PIXI.Graphics(), below = new PIXI.Container();
            scrim.beginFill(0x000000, 0.72); scrim.drawRect(0, 0, 1280, 720); scrim.endFill(); scrim.visible = false;
            var track = new PIXI.Sprite(art.pill(layout.pager.width, layout.pager.height, C.track)); track.position.set(layout.pager.x, layout.pager.y);
            var thumb = new PIXI.Sprite(PIXI.Texture.EMPTY);
            below.addChild(scrim); below.addChild(track); below.addChild(thumb);
            this.view.stage.addChildAt(below, 0);
            this.view.stage.addChildAt(root, 0);
            this.decor = {root: root, scrim: scrim, below: below, track: track, thumb: thumb};
            this.presenter = new PresenterClass(PIXI, root, {
                view: {w: 1280, h: 720}, effects: this.model.values.effects, showCaption: this.model.values.caption, document: doc(),
                onLookUp: function (direction) { self.motion.move(direction); },
                onRetire: function (texture) { self.retired(texture); },
                onShown: function () { self.shown(); }
            });
            if (this.model.base === 'loading') this.presenter.wait();
            this.rest = {};     // where each list component sits at rest (place() offsets it); recorded on first use
            var last = Date.now(), checked = last, errors = 0;
            var token = this.loop = {};
            (function tick() {
                if (self.loop !== token) return;
                try {
                    var now = Date.now(), dt = Math.max(0, Math.min(100, now - last));
                    last = now;
                    if (self.presenter) self.presenter.update(dt);
                    // Components that arrived after the last render get their visibility now.
                    if (now - checked > 250) { checked = now; if (self.ids.some(function (id) { return !self.cache.has(id); })) self.render(); }
                    errors = 0;
                } catch (error) {
                    // One bad frame must not stop the loop (the picture would never be revealed).
                    if (++errors === 1) self.diagnostics.error('frame failed:', error && error.stack || error);
                    if (errors === 30 && self.model && self.model.base !== 'offline') self.offline('the picture could not be drawn');
                }
                if (self.loop === token) frame(tick);
            })();
            this.diagnostics.info('picture layer ready after', this.since());
            // A picture that was in before the view had loaded.
            if (this.pending) this.present(this.pending);
            return true;
        }

        // ---------- horizontal pans: change picture in the viewer, page a menu list ----------
        panning(on) {
            var views = jibo.face.views, touch = views._touchManager, gesture = views.GESTURE;
            if (!touch || !gesture || typeof touch.addGesture !== 'function') return;
            // Destroying any view removes every gesture (TouchManager.removeAllGestures), ours included.
            if (on && this.pan && '_panHorizontalGesture' in touch && !touch._panHorizontalGesture) { this.diagnostics.info('pan gesture was removed: adding it again'); this.pan = null; }
            if (on && !this.pan) { this.pan = this.onPan.bind(this); touch.addGesture(gesture.PAN, this.pan); }
            else if (!on && this.pan) { touch.removeGesture(gesture.PAN); this.pan = null; this.dragging = null; }
        }
        onPan(event) {
            if (!this.active() || !this.model) { if (this.dragging) { this.dragging = null; this.settle(0); } return; }
            var total = typeof event.deltaX === 'number' && isFinite(event.deltaX) ? event.deltaX : null;
            var t = this.vm && this.vm.tiles;
            if (!t || t.kind !== 'list') return;
            if (!this.dragging) {
                if (event.isFinal) return;
                this.animation = null; this.dragging = {base: this.slide.x, total: 0};
            }
            if (total !== null) this.dragging.total = total;
            else if (event.srcEvent && isFinite(event.srcEvent.movementX)) this.dragging.total += event.srcEvent.movementX;
            if (event.isFinal) {
                var turn = layout.release(this.dragging.total, t.canBack, t.canForward);
                this.dragging = null;
                if (turn) this.turn(turn); else this.settle(0);
                return;
            }
            this.place(this.dragging.base + layout.drag(this.dragging.total, t.canBack, t.canForward));
        }
        turn(direction) {
            var t = this.vm && this.vm.tiles;
            if (!t || t.kind !== 'list' || !this.model) return;
            var count = t.items.length, start = layout.pageStart(layout.pageOf(t.start, count) + direction, count);
            if (start === t.start) { this.settle(0); return; }
            this.slide.x += (start - t.start) * TL.step;
            this.model.setStart(t.list, start);
            this.settle(0);
        }
        settle(target) {
            var self = this;
            this.slide.target = target;
            if (this.animation) return;
            var token = this.animation = {}, last = Date.now();
            function tick() {
                if (self.animation !== token) return;
                var now = Date.now(), steps = Math.min(4, Math.max(1, Math.round((now - last) / TL.spring.step))), state = self.slide;
                last = now;
                for (var i = 0; i < steps && !state.settled; ++i) state = layout.spring(state, self.slide.target);
                self.slide = {x: state.x, velocity: state.velocity, target: self.slide.target};
                self.place(state.x);
                if (state.settled) self.animation = null; else frame(tick);
            }
            frame(tick);
        }
        // List tiles sit at slotX(n - start) + the drag offset.
        place(x) {
            this.slide.x = x;
            var t = this.vm && this.vm.tiles, self = this;
            if (!this.view || !this.rest || !t || t.kind !== 'list') return;
            var offset = Math.round(x) - t.start * TL.step;
            this.rows[t.list].forEach(function (r) {
                r.ids.forEach(function (id) {
                    var c = self.component(id);
                    if (!c || !c.display) return;
                    if (self.rest[id] == null) self.rest[id] = c.display.x;
                    c.display.x = self.rest[id] + offset;
                });
            });
        }

        // ---------- closing ----------
        halt() {
            this.token++; this.loop = null; this.pending = null; this.opening = null;
            clearTimeout(this.retryTimer); this.retryTimer = null;
            this.disarmWatchdog();
            this.panning(false); this.animation = null; this.dragging = null; this.slide = {x: 0, velocity: 0, target: 0};
            this.stopSpeaking();
            if (this.motion) this.motion.close();
        }
        disposeDecor() {
            if (this.presenter) { try { this.presenter.destroy(); } catch (error) { this.diagnostics.warn('presenter', error && error.message); } this.presenter = null; }
            if (this.images) { this.images.close(); this.images = null; }
            var d = this.decor;
            if (d) [d.root, d.below].forEach(function (layer) { if (!layer._destroyed) { if (layer.parent) layer.parent.removeChild(layer); layer.destroy({children: true}); } });
            if (this.art) this.art.destroy();
            this.decor = null; this.art = null; this.current = null; this.pending = null; this.onScreen = {};
        }
        // Closing always ends with this.view cleared and the picture layer gone, also when the SDK
        // can't remove the view (another view process is running, or Be reset the face): a view
        // left set would make the next open() a dead one. Such a close reports its error to Be,
        // which then resets the face.
        close(done) {
            done = done || function () {};
            if (this.closing) { this.closing.then(function () { done(); }, done); return; }
            var self = this, started = Date.now();
            this.halt();
            if (this.model) { this.model.close(); this.model = null; }
            this.vm = null;
            this.closing = Promise.resolve().then(function () {
                var views = jibo.face.views, view = self.view;
                if (!view) return;
                if (views.currentView !== view) {
                    if (view.state !== 'destroyed') self.disposeHidden(views, view);
                    return;
                }
                return new Promise(function (resolve, reject) {
                    var timer = setTimeout(function () { reject(Error('stargazer_view_close_timeout')); }, closeMs);
                    views.changeView({remove: true, leaveEmpty: views.viewStackLength === 1, transitionClose: views.TRANSITION.OUT},
                        function () { clearTimeout(timer); resolve(); }, function () { clearTimeout(timer); reject(Error('stargazer_view_close_failed')); });
                });
            }).then(function () { self.view = null; self.disposeDecor(); }, function (error) {
                self.diagnostics.warn('close:', error && error.message || error, JSON.stringify(self.state()));
                self.view = null; self.disposeDecor(); throw error;
            });
            this.closing.then(function () {
                self.diagnostics.info('closed in', (Date.now() - started) + ' ms');
                self.closing = null; self.leaving = false; self.tapping = false; done();
            }, function (error) { self.closing = null; self.leaving = false; self.tapping = false; done(error); });
        }
        // Another view covers ours (e.g. "Hey Jibo"): tear down only our own hidden group.
        disposeHidden(views, view) {
            var process = views._viewProcess, tween = jibo.face.tween;
            if (!process || process.active || process.processQueue && process.processQueue.length ||
                !views.ComponentGroup || !views.STATE || !tween || typeof tween.stop !== 'function' || !view.viewStateStacked)
                throw Error('stargazer_hidden_view_cleanup_unavailable');
            var visited = [], parents = [], cursor = views.currentView;
            while (cursor) {
                if (visited.indexOf(cursor) >= 0) throw Error('stargazer_view_parent_cycle');
                visited.push(cursor);
                if (cursor.pausedParent === view) parents.push(cursor);
                cursor = cursor.pausedParent;
            }
            parents.forEach(function (parent) { parent.pausedParent = view.pausedParent; });
            view.pausedParent = null;
            view.status = views.STATE.DESTROYED;
            views.ComponentGroup.prototype.destroy.call(view);
            if (view.stage) {
                tween.stop(view.stage);
                if (view.stage.parent) view.stage.parent.removeChild(view.stage);
                view.stage.destroy({children: true});
            }
            if (view.pauseOverlay) view.pauseOverlay.destroy();
            view.pauseOverlay = null; view._stage = null; view._viewManager = null; view._viewState = null;
        }
        destroy(done) { this.close(error => super.destroy(baseError => done(error || baseError))); }
    };
};
