#!/usr/bin/env node
/*
 * Screenshot sheet: every main screen at every target viewport (development tool).
 *
 *   node tools/shots.js <out-dir> [screen,screen,...] [viewport,viewport,...]
 *
 * Screens:   title, play, coach, preview, stuck, win, levels, frost
 * Viewports: desktop (1280x800), phone (390x844), small (360x640),
 *            land (844x390), smalland (640x360)
 * Files are named <viewport>-<screen>.png. Every launch starts with empty
 * storage, so "title" is what a first-time visitor sees.
 * Needs the game served at MENHIR_URL (default http://127.0.0.1:8861/index.html).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { launch, sleep } = require('./cdp.js');
const L = require(path.join(__dirname, '..', 'js', 'logic.js'));
const V = require(path.join(__dirname, '..', 'js', 'solver.js'));
const DEFS = require(path.join(__dirname, '..', 'js', 'levels.js'));
const { moveOptimal } = require('./solve.js');

const BASE = process.env.MENHIR_URL || 'http://127.0.0.1:8861/index.html';
const VIEWPORTS = {
  desktop: [1280, 800, 1, false],
  phone: [390, 844, 3, true],
  small: [360, 640, 2, true],
  land: [844, 390, 3, true],
  smalland: [640, 360, 2, true],
};
const keysOf = (moves) => moves.map((d) => L.DIR_CHAR[d]).join('');
function solutionKeys(i) {
  const { level, state } = L.parseLevel(DEFS[i]);
  return keysOf(moveOptimal(level, state).moves);
}
function fatalKeys(i) {
  const { level, state } = L.parseLevel(DEFS[i]);
  const info = new V.Analysis(level, state); info.run();
  for (const p of V.pushes(level, state)) {
    if (V.distance(level, info, p.next) === -1) return keysOf(V.walkPath(level, state, p.from).concat([p.dir]));
  }
  return '';
}
const idx = (name) => DEFS.findIndex((d) => d.name === name);

// Each screen: [query, setup-eval or null, wait ms]. Query null = first visit, no params.
const SCREENS = {
  title: () => [null, null, 1600],
  play: () => ['level=1&coach=0', null, 1500],
  coach: () => ['level=1', null, 1700],
  preview: () => ['level=' + (idx('Black Ice') + 1) + '&coach=0', null, 1700],
  frost: () => ['level=' + (idx('Hoarfrost') + 1), null, 1700],
  stuck: () => { const i = idx('First Light'); return ['level=' + (i + 1) + '&coach=0&play=' + fatalKeys(i), null, 1500]; },
  win: () => { const i = idx('Cascade'); return ['level=' + (i + 1) + '&coach=0&play=' + solutionKeys(i), null, 2600]; },
  levels: () => ['level=5&coach=0', `(() => {
      const p = { best: {}, perfect: {}, current: 4, seenMenu: true, preview: true, deadBar: true };
      ${JSON.stringify(DEFS.slice(0, 4).map((d) => [d.name, d.par]))}.forEach(([n, par], k) => { p.best[n] = par + (k === 2 ? 1 : 0); if (k !== 2) p.perfect[n] = true; });
      localStorage.setItem('menhir2.progress', JSON.stringify(p));
      localStorage.setItem('menhir.progress', JSON.stringify(p));
      return true; })()`, 0],
};

(async () => {
  const out = process.argv[2];
  if (!out) { console.error('usage: node tools/shots.js <out-dir> [screens] [viewports]'); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const screens = process.argv[3] ? process.argv[3].split(',') : Object.keys(SCREENS);
  const vps = process.argv[4] ? process.argv[4].split(',') : Object.keys(VIEWPORTS);
  let errors = 0;
  for (const vp of vps) {
    const [w, h, scale, mobile] = VIEWPORTS[vp];
    for (const sc of screens) {
      const page = await launch({ width: w, height: h });
      await page.viewport(w, h, scale, mobile);
      const [query, setup, wait] = SCREENS[sc]();
      if (setup) {
        await page.goto(BASE + '?level=1&coach=0', 500);
        await page.eval(setup);
      }
      await page.goto(BASE + (query ? '?' + query : ''), wait);
      if (sc === 'levels') { await page.eval('document.getElementById("btn-menu").click()'); await sleep(600); }
      const file = path.join(out, `${vp}-${sc}.png`);
      await page.shot(file);
      if (page.errors.length) { errors++; console.log(`PAGE ERRORS (${vp} ${sc}): ${page.errors.join(' | ')}`); }
      await page.close();
      console.log(file);
    }
  }
  process.exit(errors ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
