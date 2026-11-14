'use strict';
// Pictures in memory only (D6): the bytes are downloaded into a Buffer, wrapped in a Blob URL,
// decoded by an <img> and handed to PIXI as a texture. The URL is revoked once the image has
// decoded, and releasing a picture destroys its texture, so the decoded pixels go too.
// A picture stays alive while it is on screen: showing(key) counts each sprite that shows it and
// retired(texture) counts one off again, releasing the picture when nothing shows it any more.

var MAX_BYTES = 3 * 1024 * 1024, MAX_SIDE = 2048, DECODE_TIMEOUT = 15000;

// Image type from the first bytes; anything else is refused.
function sniff(bytes) {
    if (!bytes || bytes.length < 12) return null;
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return null;
}

// deps: {PIXI, net, window (Blob, URL, Image, setTimeout), log}
function Images(deps) {
    this.PIXI = deps.PIXI; this.net = deps.net; this.win = deps.window || (typeof window !== 'undefined' ? window : global);
    this.log = deps.log || {info: function () {}, warn: function () {}};
    this.live = {};       // key -> {promise, picture}
    this.onScreen = {};   // key -> how many sprites still show it
    this.closed = false;
}
// Resolves to {key, texture, width, height}; the same key is loaded once while alive.
Images.prototype.load = function (item) {
    var self = this, key = item.key;
    if (this.live[key]) return this.live[key].promise;
    var slot = this.live[key] = {picture: null};
    slot.promise = this.net.get(item.imageUrl, {maxBytes: MAX_BYTES, timeoutMs: 30000, accept: 'image/*'}).then(function (response) {
        if (self.closed || self.live[key] !== slot) throw Error('released');
        return self.decode(response.body);
    }).then(function (texture) {
        var picture = {key: key, texture: texture, width: texture.width, height: texture.height};
        if (self.closed || self.live[key] !== slot) { texture.destroy(true); throw Error('released'); }
        slot.picture = picture;
        return picture;
    });
    slot.promise.catch(function () { if (self.live[key] === slot) delete self.live[key]; });
    return slot.promise;
};
Images.prototype.decode = function (body) {
    var PIXI = this.PIXI, win = this.win;
    var bytes = new Uint8Array(body.buffer ? body.buffer.slice(body.byteOffset, body.byteOffset + body.length) : body);
    var type = sniff(bytes);
    if (!type) return Promise.reject(Error('not_an_image'));
    return new Promise(function (resolve, reject) {
        var url = win.URL.createObjectURL(new win.Blob([bytes], {type: type}));
        var image = new win.Image(), timer;
        function done(error) {
            win.clearTimeout(timer);
            image.onload = image.onerror = null;
            win.URL.revokeObjectURL(url);
            if (error) { image.src = ''; reject(error); return; }
            if (!image.naturalWidth || image.naturalWidth > MAX_SIDE || image.naturalHeight > MAX_SIDE) {
                image.src = '';
                reject(Error('bad_size'));
                return;
            }
            resolve(new PIXI.Texture(new PIXI.BaseTexture(image, PIXI.SCALE_MODES.LINEAR)));
        }
        timer = win.setTimeout(function () { done(Error('decode_timeout')); }, DECODE_TIMEOUT);
        image.onload = function () { done(null); };
        image.onerror = function () { done(Error('decode_failed')); };
        image.src = url;
    });
};
// Drop every picture except the given keys and those still on screen.
Images.prototype.keep = function (keys) {
    var self = this;
    Object.keys(this.live).forEach(function (key) {
        if (keys.indexOf(key) < 0 && !self.onScreen[key]) self.release(key);
    });
};
// One more sprite shows this picture.
Images.prototype.showing = function (key) {
    this.onScreen[key] = (this.onScreen[key] || 0) + 1;
};
// A sprite showing this texture has gone. The picture is released once nothing shows it, unless it
// is `current` (the key of the picture that is meant to be on screen).
Images.prototype.retired = function (texture, current) {
    var self = this;
    Object.keys(this.live).forEach(function (key) {
        var slot = self.live[key];
        if (!slot.picture || slot.picture.texture !== texture) return;
        self.onScreen[key] = Math.max(0, (self.onScreen[key] || 0) - 1);
        if (!self.onScreen[key] && key !== current) self.release(key);
    });
};
Images.prototype.release = function (key) {
    var slot = this.live[key];
    delete this.onScreen[key];
    if (!slot) return;
    delete this.live[key];
    if (slot.picture) {
        var source = slot.picture.texture.baseTexture && slot.picture.texture.baseTexture.source;
        slot.picture.texture.destroy(true);
        if (source) try { source.src = ''; } catch (_) {}
        slot.picture = null;
    }
};
Images.prototype.count = function () { return Object.keys(this.live).length; };
Images.prototype.close = function () {
    this.closed = true;
    var self = this;
    Object.keys(this.live).forEach(function (key) { self.release(key); });
};

module.exports = {Images: Images, sniff: sniff, MAX_BYTES: MAX_BYTES, MAX_SIDE: MAX_SIDE};
