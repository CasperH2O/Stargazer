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

const TILES = ['apod', 'hubble', 'webb', 'eso', 'noirlab', 'iotd', 'epic', 'efs', 'kenburns', 'iris', 'lookup', 'starfield',
  'speak', 'caption', 'slideshow', 'layers', 'timer'];
const ACTIONS = ['prev', 'next', 'gear', 'refresh'];
// [file, canvas w, h, glyph box, glyph x, glyph y, shadow length]
const jobs = [
  ...TILES.map((n) => [`tile-${n}.png`, 330, 300, 180, 75, 52, 110, n]),
  ...ACTIONS.map((n) => [`action-${n}.png`, 265, 265, 150, 57.5, 57.5, 80, n]),
  ['../../../icon.png', 330, 330, 190, 70, 64, 140, 'telescope']
];
const svg = (name, black) => {
  let body = glyphs[name];
  if (black) body = body.replaceAll('#fff', '#000').replaceAll(NAVY, '#000');
  return 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">${body}</svg>`).toString('base64');
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
for (const [file, w, h, box, gx, gy, len, name] of jobs) {
  const data = await page.evaluate(async ({ w, h, box, gx, gy, len, white, black }) => {
    const load = (src) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
    const [g, s] = await Promise.all([load(white), load(black)]);
    const canvas = (cw, ch) => Object.assign(document.createElement('canvas'), { width: cw, height: ch });
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
    return out.toDataURL('image/png');
  }, { w, h, box, gx, gy, len, white: svg(name, false), black: svg(name, true) });
  writeFileSync(join(ICONS, file), Buffer.from(data.split(',')[1], 'base64'));
}
await browser.close();
console.log(`wrote ${jobs.length} icons`);
