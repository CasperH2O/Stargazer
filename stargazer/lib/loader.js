'use strict';
// Finds one picture to show: tries the sources in the given order (catalog.order) and, per source,
// its newest picture, or the one before it when the newest can't be loaded. A source that fails
// is skipped and logged.
//
//   var loader = new Loader({catalog, images, log, since});
//   loader.load(order, {onListed(), onLoaded()}) -> Promise<{item, picture}>
//   loader.cancel();     // stops the load in flight (a new load() also does)
//
// A cancelled load stops trying and rejects with Error('cancelled').

function Loader(opts) {
    this.catalog = opts.catalog;
    this.images = opts.images;
    this.log = opts.log;
    this.since = opts.since || function () { return ''; };
    this.run = null;            // the load in flight; a new object per load()
}

Loader.prototype.load = function (order, hooks) {
    var self = this, run = this.run = {}, cancelled = Error('cancelled');
    hooks = hooks || {};
    function current() { return self.run === run; }
    function call(name) { if (hooks[name]) hooks[name](); }

    // The newest picture of order[n], else the next source.
    function trySource(n) {
        if (!current()) return Promise.reject(cancelled);
        if (n >= order.length) return Promise.reject(Error('no picture could be loaded'));
        var id = order[n], at = Date.now();
        return self.catalog.list(id).then(function (items) {
            if (!current()) throw cancelled;
            self.log.info('source', id, 'listed', items.length, 'in', (Date.now() - at) + ' ms');
            call('onListed');
            return tryItem(items.slice(0, 2), 0, function () { return trySource(n + 1); });
        }, function (error) {
            if (!current()) throw cancelled;
            self.log.warn('source', id, 'skipped:', error && error.message || error);
            return trySource(n + 1);
        });
    }
    // items[n] with its details and its picture, else the next item, else otherwise().
    function tryItem(items, n, otherwise) {
        if (!current()) return Promise.reject(cancelled);
        if (n >= items.length) return otherwise();
        var item = items[n], at = Date.now();
        self.images.keep([item.key]);
        return Promise.all([self.catalog.resolve(item), self.images.load(item)]).then(function (results) {
            if (!current()) throw cancelled;
            self.log.info('picture', item.key, 'loaded in', (Date.now() - at) + ' ms (' + self.since() + ')');
            call('onLoaded');
            return {item: item, picture: results[1]};
        }, function (error) {
            if (!current()) throw cancelled;
            self.log.warn('picture', item.key, 'failed:', error && error.message || error);
            return tryItem(items, n + 1, otherwise);
        });
    }
    return trySource(0).then(function (found) {
        if (current()) self.run = null;
        return found;
    }, function (error) {
        if (current()) self.run = null;
        throw error;
    });
};

Loader.prototype.cancel = function () { this.run = null; };
Loader.prototype.busy = function () { return !!this.run; };

module.exports = Loader;
