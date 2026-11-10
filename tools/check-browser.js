#!/usr/bin/env node
/*
 * Replays every island's move-optimal solution in headless Chrome and checks
 * that the real page registers a win in exactly par pushes (development tool).
 *   node tools/check-browser.js [--shots dir]
 * Needs the game served at MENHIR_URL (default http://127.0.0.1:8861/index.html).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { launch, sleep } = require('./cdp.js');
const L = require(path.join(__dirname, '..', 'js', 'logic.js'));
const DEFS = require(path.join(__dirname, '..', 'js', 'levels.js'));
const { moveOptimal } = require('./solve.js');
const BASE = process.env.MENHIR_URL || 'http://127.0.0.1:8861/index.html';
const si = process.argv.indexOf('--shots');
const shots = si >= 0 ? process.argv[si + 1] : null;
(async () => {
  const page = await launch({ width: 1280, height: 800 });
  await page.viewport(1280, 800, 1, false);
  let bad = 0;
  for (let i = 0; i < DEFS.length; i++) {
    const { level, state } = L.parseLevel(DEFS[i]);
    const sol = moveOptimal(level, state).moves.map((d) => L.DIR_CHAR[d]).join('');
    if (shots) {
      await page.goto(`${BASE}?level=${i + 1}`, 1300);
      await page.shot(path.join(shots, `level${String(i + 1).padStart(2, '0')}.png`));
    }
    await page.goto(`${BASE}?level=${i + 1}&play=${sol}`, 700);
    const r = await page.eval('({ won: menhir.g.won, pushes: menhir.g.state.pushes, moves: menhir.g.state.moves })');
    const ok = r.won && r.pushes === DEFS[i].par;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(i + 1).padStart(2)}. ${DEFS[i].name.padEnd(14)} won=${r.won} pushes=${r.pushes} (par ${DEFS[i].par}) moves=${r.moves}`);
  }
  if (page.errors.length) { bad++; console.log('PAGE ERRORS: ' + page.errors.join(' | ')); }
  await page.close();
  console.log(bad ? `${bad} FAILED` : 'every island is won by its solution in the browser');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
