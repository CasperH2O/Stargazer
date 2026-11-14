'use strict';
// Shapes the stock SDK has no component for, painted once on a 2D canvas and shared as PIXI
// textures (anti-aliased PIXI 4 geometry is unreliable on the robot): the "connected" check
// badge, the dashed "searching" placeholder tile, spinner rings and the pager pill.
// Tiles and buttons themselves are the SDK's own SkillButtons and ActionButtons.
var layout = require('./layout');

module.exports = function createArt(PIXI, document) {
    var cache = new Map(), c = layout.color;
    function shared(key, width, height, draw) {
        if (!cache.has(key)) {
            var element = document.createElement('canvas');
            element.width = Math.ceil(width); element.height = Math.ceil(height);
            draw(element.getContext('2d'));
            cache.set(key, PIXI.Texture.fromCanvas(element));
        }
        return cache.get(key);
    }
    function hex(value) { var s = value.toString(16); while (s.length < 6) s = '0' + s; return '#' + s; }
    return {
        // White ring, confirm-green disc, white tick (stock confirm pair).
        badge: function (size) {
            return shared('badge:' + size, size, size, function (ctx) {
                var r = size / 2, pair = layout.pairs.confirm;
                ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = size * 0.1; ctx.shadowOffsetY = size * 0.035;
                ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(r, r * 0.96, r * 0.9, 0, Math.PI * 2); ctx.fill();
                ctx.shadowColor = 'transparent';
                var g = ctx.createLinearGradient(size * 0.15, size * 0.1, size * 0.7, size * 0.9);
                g.addColorStop(0, hex(pair[0])); g.addColorStop(1, hex(pair[1]));
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(r, r * 0.96, r * 0.74, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = size * 0.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                ctx.beginPath(); ctx.moveTo(size * 0.32, size * 0.5); ctx.lineTo(size * 0.45, size * 0.63); ctx.lineTo(size * 0.69, size * 0.36); ctx.stroke();
            });
        },
        // The tile outline (circle cut flat at the bottom, as SkillButtons render), dashed.
        placeholder: function () {
            var t = layout.tiles;
            return shared('placeholder', t.width, t.height, function (ctx) {
                ctx.save(); ctx.beginPath(); ctx.rect(0, 0, t.width, t.height); ctx.clip();
                ctx.strokeStyle = c.thumb; ctx.lineWidth = 5; ctx.setLineDash([14, 10]);
                ctx.beginPath(); ctx.arc(t.width / 2, t.width / 2, t.width / 2 - 3, 0, Math.PI * 2); ctx.stroke();
                ctx.restore();
            });
        },
        // Track circle with a quarter arc in the accent colour; rotate the sprite to spin it.
        ring: function (radius, width) {
            var size = 2 * (radius + width);
            return shared('ring:' + radius + ':' + width, size, size, function (ctx) {
                var r = size / 2;
                ctx.lineWidth = width; ctx.strokeStyle = c.track;
                ctx.beginPath(); ctx.arc(r, r, radius, 0, Math.PI * 2); ctx.stroke();
                ctx.strokeStyle = c.accent; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.arc(r, r, radius, -Math.PI / 2, 0); ctx.stroke();
            });
        },
        pill: function (width, height, fill) {
            return shared(['pill', width, height, fill].join(':'), width, height, function (ctx) {
                var r = height / 2;
                ctx.fillStyle = fill; ctx.beginPath();
                ctx.moveTo(r, 0); ctx.lineTo(width - r, 0); ctx.arc(width - r, r, r, -Math.PI / 2, Math.PI / 2);
                ctx.lineTo(r, height); ctx.arc(r, r, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); ctx.fill();
            });
        },
        destroy: function () { cache.forEach(function (texture) { texture.destroy(true); }); cache.clear(); }
    };
};
