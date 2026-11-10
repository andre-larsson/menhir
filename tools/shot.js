#!/usr/bin/env node
/*
 * Screenshot a level in headless Chrome (development tool).
 *   node tools/shot.js out.png [query] [width height [scale mobile]]
 *   node tools/shot.js /tmp/l3.png "level=3&play=NNE" 390 844 2 mobile
 * Expects the game served at MENHIR_URL (default http://127.0.0.1:8861/index.html).
 */
'use strict';
const { launch, sleep } = require('./cdp.js');
(async () => {
  const [out, query, w, h, scale, mobile] = process.argv.slice(2);
  const base = process.env.MENHIR_URL || 'http://127.0.0.1:8861/index.html';
  const page = await launch({ width: +w || 1280, height: +h || 800 });
  await page.viewport(+w || 1280, +h || 800, +scale || 1, mobile === 'mobile');
  await page.goto(base + '?' + (query || 'level=1'), 1400);
  if (process.env.EVAL) { await page.eval(process.env.EVAL); await sleep(+process.env.WAIT || 600); }
  await page.shot(out);
  if (page.errors.length) console.log('PAGE ERRORS:', page.errors.join(' | '));
  await page.close();
  console.log(out);
})().catch((e) => { console.error(e); process.exit(1); });
