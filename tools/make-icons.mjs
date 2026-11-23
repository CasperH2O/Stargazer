#!/usr/bin/env node
// Development tool: renders our own glyphs (tools/glyphs.mjs) to the PNG icons the skill ships.
// Not run on the robot. Needs Playwright with Chromium; pass its package path if it is not
// resolvable from here:  node tools/make-icons.mjs [path/to/node_modules/playwright]
//
//   stargazer/resources/icons/tile-<name>.png    330x300  SkillButton icons
//   stargazer/resources/icons/action-<name>.png  265x265  ActionButton icons
//   icon.png                                               330x330  store / main-menu icon
//
// Style (ui/jibo-ui-classic iconography, derived): white glyph, navy cut-outs, soft long
// shadow toward the lower right (black, at most about 0.2 alpha).

// Tile placement (iconography.drawingBox): a SkillButton is a circle of diameter 330 whose
// bottom is cut off at y=300, so the circle's centre is (165, 165) in the 330x300 canvas. Each
// tile glyph is rendered once, its opaque bounding box is measured (shadow excluded), and the
// glyph is shifted so that box is centred on (165, 165) - not on the visible 300 px shape.
//
// icon.png: rendered like a tile, then put 15 px down on the 330x330 canvas the 5x1 docs ask for;
// the menu centres it on the button, so the glyph lands where a stock 330x300 icon's does (D43).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glyphs, NAVY } from './glyphs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = join(ROOT, 'stargazer', 'resources', 'icons');
mkdirSync(ICONS, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');

const TILES = ['hubble', 'webb', 'noirlab', 'kenburns', 'iris', 'lookup', 'starfield',
  'speak', 'caption', 'slideshow', 'layers', 'timer', 'sound'];
const ACTIONS = ['gear', 'refresh'];
// [file, canvas w, h, glyph box, glyph x, glyph y, shadow length, glyph name, square side (optional)]
// Tiles and icon.png pass null for x/y: the glyph's measured opaque box is centred on TILE_CENTRE.
const TILE_CENTRE = [165, 165];
const jobs = [
  ...TILES.map((n) => [`tile-${n}.png`, 330, 300, 180, null, null, 110, n]),
  ...ACTIONS.map((n) => [`action-${n}.png`, 265, 265, 150, 57.5, 57.5, 80, n]),
  ['../../../icon.png', 330, 300, 190, null, null, 140, 'telescope', 330]
];
const svg = (name, black) => {
  let body = glyphs[name];
  if (black) body = body.replaceAll('#fff', '#000').replaceAll(NAVY, '#000');
  return 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">${body}</svg>`).toString('base64');
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
for (const [file, w, h, box, gx, gy, len, name, side] of jobs) {
  const data = await page.evaluate(async ({ w, h, box, gx, gy, len, side, centre, white, black }) => {
    const load = (src) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
    const [g, s] = await Promise.all([load(white), load(black)]);
    const canvas = (cw, ch) => Object.assign(document.createElement('canvas'), { width: cw, height: ch });
    if (gx === null) {
      // Measure the glyph's opaque bounding box (alpha >= 128) at its final size, then place it
      // with whole-pixel offsets so its centre lands on `centre` (within half a pixel).
      const m = canvas(box, box), mx = m.getContext('2d');
      mx.drawImage(g, 0, 0, box, box);
      const a = mx.getImageData(0, 0, box, box).data;
      let x0 = box, y0 = box, x1 = -1, y1 = -1;
      for (let y = 0; y < box; y++) for (let x = 0; x < box; x++) {
        if (a[(y * box + x) * 4 + 3] >= 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) throw new Error('empty glyph');
      gx = Math.round(centre[0] - (x0 + x1) / 2);
      gy = Math.round(centre[1] - (y0 + y1) / 2);
    }
    // Long shadow: the silhouette swept toward the lower right, fading along its length.
    const sh = canvas(w, h), sx = sh.getContext('2d');
    for (let d = 0; d <= len; d += 1) sx.drawImage(s, gx + d, gy + d, box, box);
    sx.globalCompositeOperation = 'destination-in';
    const fade = sx.createLinearGradient(gx + box * 0.5, gy + box * 0.5, gx + box * 0.5 + len, gy + box * 0.5 + len);
    fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    sx.fillStyle = fade; sx.fillRect(0, 0, w, h);
    const out = canvas(w, h), ctx = out.getContext('2d');
    ctx.globalAlpha = 0.2; ctx.drawImage(sh, 0, 0); ctx.globalAlpha = 1;
    ctx.drawImage(g, gx, gy, box, box);
    if (!side) return out.toDataURL('image/png');
    const square = canvas(side, side);
    square.getContext('2d').drawImage(out, 0, (side - h) / 2);
    return square.toDataURL('image/png');
  }, { w, h, box, gx, gy, len, side: side || 0, centre: TILE_CENTRE, white: svg(name, false), black: svg(name, true) });
  writeFileSync(join(ICONS, file), Buffer.from(data.split(',')[1], 'base64'));
}
await browser.close();
console.log(`wrote ${jobs.length} icons`);
