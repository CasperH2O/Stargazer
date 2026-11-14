// A small stand-in for PIXI 4.6.2, enough for presenter.js, caption.js, the effects and images.js.
// It mirrors the destroy semantics that matter: destroy() detaches from the parent and sets
// _destroyed, Container.destroy({children}) destroys the children once, and a second
// Graphics.destroy() throws (PIXI nulls graphicsData). Every object is recorded in `made`.

class Point {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y === undefined ? x : y; }
}

export function createPixi() {
  const made = { containers: [], sprites: [], graphics: [], texts: [], textures: [], baseTextures: [] };

  class DisplayObject {
    constructor() {
      this.parent = null; this.alpha = 1; this.visible = true; this.rotation = 0; this.mask = null;
      this.position = new Point(); this.scale = new Point(1, 1); this.transform = {};
      this._destroyed = false;
    }
    get x() { return this.position.x; } set x(v) { this.position.x = v; }
    get y() { return this.position.y; } set y(v) { this.position.y = v; }
    destroy() {
      if (this.parent) this.parent.removeChild(this);
      this.transform = null; this.parent = null; this.mask = null;
      this._destroyed = true;
    }
  }
  class Container extends DisplayObject {
    constructor() { super(); this.children = []; made.containers.push(this); }
    addChild(child) {
      if (this._destroyed) throw new Error('addChild on a destroyed container');
      if (child.parent) child.parent.removeChild(child);
      child.parent = this; this.children.push(child); return child;
    }
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i < 0) return null;
      child.parent = null; this.children.splice(i, 1); return child;
    }
    setChildIndex(child, index) {
      const i = this.children.indexOf(child);
      if (i < 0) throw new Error('setChildIndex: not a child');
      this.children.splice(i, 1); this.children.splice(index, 0, child);
    }
    removeChildren() { const old = this.children; this.children = []; old.forEach((c) => { c.parent = null; }); return old; }
    destroy(options) {
      super.destroy();
      const deep = typeof options === 'boolean' ? options : options && options.children;
      const old = this.removeChildren();
      if (deep) old.forEach((c) => c.destroy(options));
    }
  }
  class Sprite extends Container {
    constructor(texture) { super(); this.texture = texture; this.anchor = new Point(); this._w = texture ? texture.width : 0; this._h = texture ? texture.height : 0; made.sprites.push(this); }
    get width() { return this._w * this.scale.x; } set width(v) { this.scale.x = this._w ? v / this._w : 1; }
    get height() { return this._h * this.scale.y; } set height(v) { this.scale.y = this._h ? v / this._h : 1; }
    destroy(options) {
      super.destroy(options);
      const tex = typeof options === 'boolean' ? options : options && options.texture;
      if (tex) this.texture.destroy(!!(options && options.baseTexture));
      this.texture = null;
    }
  }
  class Graphics extends Container {
    constructor() { super(); this.graphicsData = []; made.graphics.push(this); }
    clear() { this.graphicsData.length = 0; return this; }
    lineStyle() { return this; }
    beginFill() { return this; }
    endFill() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    arc() { this.graphicsData.push('arc'); return this; }
    drawCircle() { this.graphicsData.push('circle'); return this; }
    drawPolygon() { this.graphicsData.push('poly'); return this; }
    drawRect() { this.graphicsData.push('rect'); return this; }
    destroy(options) {
      super.destroy(options);
      if (this.graphicsData === null) throw new TypeError("Cannot read property 'length' of null");   // as PIXI 4.6.2
      this.graphicsData = null;
    }
  }
  class Text extends Sprite {
    constructor(text, style) { super(null); this.style = Object.assign({}, style); this._text = text; made.texts.push(this); }
    get text() { return this._text; } set text(v) { this._text = v; }
    get width() { return String(this._text).length * this.style.fontSize * 0.5; } set width(v) {}
    get height() { return this.style.fontSize; } set height(v) {}
  }
  class BaseTexture {
    constructor(source) { this.source = source || null; this._destroyed = false; made.baseTextures.push(this); }
    destroy() { this.source = null; this._destroyed = true; }
  }
  class Texture {
    constructor(baseTexture) {
      this.baseTexture = baseTexture;
      const s = baseTexture && baseTexture.source;
      this.width = (s && (s.naturalWidth || s.width)) || 1; this.height = (s && (s.naturalHeight || s.height)) || 1;
      this.destroyed = 0; made.textures.push(this);
    }
    static fromCanvas(canvas) { const t = new Texture(new BaseTexture(canvas)); t.fromCanvas = true; return t; }
    destroy(base) { this.destroyed++; if (base && this.baseTexture) this.baseTexture.destroy(); this.baseTexture = null; }
  }
  const PIXI = { Container, Sprite, Graphics, Text, Texture, BaseTexture, Point, SCALE_MODES: { LINEAR: 1, NEAREST: 0 } };
  return { PIXI, made };
}

// A 2D canvas stand-in (caption gradient, presenter backdrop).
export function createDocument() {
  const ctx = {
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {}, drawImage() {}, fillStyle: null,
  };
  return { createElement: (tag) => ({ tag, width: 0, height: 0, getContext: () => ctx }) };
}

// A picture texture as images.js would hand it over (an <img> as the base texture's source).
export function picture(PIXI, w, h, name) {
  const t = new PIXI.Texture(new PIXI.BaseTexture({ naturalWidth: w, naturalHeight: h, name }));
  t.name = name;
  return t;
}
