'use strict';
// The caption over the picture: a soft dark gradient at the bottom, the title, one line of
// "object · constellation · telescope", and the credit. Sizes follow the classic style guide:
// nothing under 30 px, text inside the 80 px side margins and above the 40 px bottom margin.
var util = require('./effects/util');
var FONT = {title: 'Proxima Nova Soft', body: 'Proxima Nova Light'};
var X = 80, MAX_W = 1120;

function gradientTexture(PIXI, h) {
    var c = document.createElement('canvas'); c.width = 4; c.height = h;
    var ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.45, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0.82)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, h);
    return PIXI.Texture.fromCanvas(c);
}

// Shrinks the font down to `min`, then ends the text with an ellipsis so it fits in maxW.
function fit(PIXI, text, str, size, min, maxW) {
    str = str || ' ';
    text.style.fontSize = size; text.text = str;
    while (text.width > maxW && text.style.fontSize > min) { text.style.fontSize -= 2; text.text = str; }
    if (text.width > maxW) {
        var s = str;
        while (s.length > 1 && text.width > maxW) { s = s.slice(0, -1); text.text = s.replace(/[\s,·]+$/, '') + '…'; }
    }
}

function Caption(PIXI, layer, view) {
    this.PIXI = PIXI; this.view = view;
    this.c = new PIXI.Container(); this.c.alpha = 0; layer.addChild(this.c);
    this.gradTex = gradientTexture(PIXI, 320);
    this.grad = new PIXI.Sprite(this.gradTex); this.grad.width = view.w; this.grad.height = 320; this.grad.y = view.h - 320;
    this.title = new PIXI.Text(' ', {fontFamily: FONT.title, fontWeight: 'bold', fontSize: 52, fill: 0xffffff, dropShadow: true, dropShadowAlpha: 0.5, dropShadowDistance: 2, dropShadowBlur: 6});
    this.line = new PIXI.Text(' ', {fontFamily: FONT.body, fontSize: 36, fill: 0xd6e2ff, dropShadow: true, dropShadowAlpha: 0.5, dropShadowDistance: 2, dropShadowBlur: 4});
    this.credit = new PIXI.Text(' ', {fontFamily: FONT.body, fontSize: 30, fill: 0xbbc6ca});
    [this.grad, this.title, this.line, this.credit].forEach(function (d) { this.c.addChild(d); }, this);
    this.title.position.set(X, 530); this.line.position.set(X, 594); this.credit.position.set(X, 642);
    this.target = 0; this.speed = 0;
}
// info {title, line, credit}
Caption.prototype.set = function (info) {
    fit(this.PIXI, this.title, info.title, 52, 40, MAX_W);
    fit(this.PIXI, this.line, info.line, 36, 30, MAX_W);
    fit(this.PIXI, this.credit, info.credit || '', 30, 30, MAX_W);  // formatted by the source ("© … · CC BY 4.0", "Image: NASA")
    this.credit.visible = !!info.credit;
};
// Title anchor points for sparkles, in screen space.
Caption.prototype.sparkleSpots = function () {
    var t = this.title, y = t.y + t.height * 0.45;
    return [
        {x: t.x + t.width + 26, y: y - 14, size: 22, delay: 0},
        {x: t.x + t.width * 0.62, y: t.y - 6, size: 14, delay: 500},
        {x: t.x - 22, y: y + 16, size: 12, delay: 1100}
    ];
};
Caption.prototype.fade = function (to, ms) { this.target = to; this.speed = ms > 0 ? 1 / ms : Infinity; };
Caption.prototype.update = function (dt) {
    if (!this.c) return;
    var a = this.c.alpha;
    if (a === this.target) return;
    var step = this.speed === Infinity ? 1 : dt * this.speed;
    this.c.alpha = a < this.target ? Math.min(this.target, a + step) : Math.max(this.target, a - step);
};
// The SDK may already have destroyed the stage (and so this container); the gradient's canvas
// texture is ours either way.
Caption.prototype.destroy = function () {
    if (!this.c) return;
    var c = this.c, tex = this.gradTex;
    this.c = null; this.gradTex = null;
    try { util.dispose(c, {children: true}); } finally { tex.destroy(true); }
};

module.exports = { Caption: Caption, FONT: FONT };
