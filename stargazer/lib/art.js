'use strict';
// Shapes the SDK has no component for, painted once on a 2D canvas and shared as PIXI textures
// (anti-aliased PIXI 4 geometry is unreliable on the robot). Stargazer only needs the pager pill.

module.exports = function createArt(PIXI, document) {
    var cache = new Map();
    function shared(key, width, height, draw) {
        if (!cache.has(key)) {
            var element = document.createElement('canvas');
            element.width = Math.ceil(width);
            element.height = Math.ceil(height);
            draw(element.getContext('2d'));
            cache.set(key, PIXI.Texture.fromCanvas(element));
        }
        return cache.get(key);
    }
    return {
        // A rounded bar (the pager's track and thumb).
        pill: function (width, height, fill) {
            return shared(['pill', width, height, fill].join(':'), width, height, function (ctx) {
                var r = height / 2;
                ctx.fillStyle = fill;
                ctx.beginPath();
                ctx.moveTo(r, 0);
                ctx.lineTo(width - r, 0);
                ctx.arc(width - r, r, r, -Math.PI / 2, Math.PI / 2);
                ctx.lineTo(r, height);
                ctx.arc(r, r, r, Math.PI / 2, Math.PI * 1.5);
                ctx.closePath();
                ctx.fill();
            });
        },
        destroy: function () {
            cache.forEach(function (texture) { texture.destroy(true); });
            cache.clear();
        }
    };
};
