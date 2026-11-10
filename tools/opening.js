#!/usr/bin/env node
/*
 * Measure the opening: from the title screen of a first visit to the first
 * island solved, and to the first island with a new rule (Domino Line)
 * solved (development tool).
 *
 *   node tools/opening.js [--phone] [--gap ms]
 *
 * Plays the move-optimal solutions with real input (keys, or the touch pad
 * with --phone), waiting for each animation plus a reaction gap (default
 * 250 ms) before the next input, and counts:
 *   inputs   key presses or taps, including Play and Next island
 *   seconds  wall-clock at that pace (animations, the win card's delay)
 *   words    distinct instruction text put in front of the player (lesson row,
 *            riddle, tips, the help page if it is open), and the reading time
 *            for it at 200 words a minute
 * A person also thinks; these numbers are a floor, for comparing versions.
 * Needs the game served at MENHIR_URL (default http://127.0.0.1:8861/index.html).
 */
'use strict';
const path = require('path');
const { launch, sleep } = require('./cdp.js');
const L = require(path.join(__dirname, '..', 'js', 'logic.js'));
const DEFS = require(path.join(__dirname, '..', 'js', 'levels.js'));
const { moveOptimal } = require('./solve.js');

const BASE = process.env.MENHIR_URL || 'http://127.0.0.1:8861/index.html';
const PHONE = process.argv.includes('--phone');
const gi = process.argv.indexOf('--gap');
const GAP = gi >= 0 ? +process.argv[gi + 1] : 250;
const DIRKEY = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];

// Text an instruction-reading player would read, wherever this build puts it.
const VISIBLE_TEXT = `(() => {
  const out = [];
  for (const sel of ['#coach', '#hint', '#howto[open]', '#stuck', '#toast.show']) {
    const el = document.querySelector(sel);
    if (!el || el.hidden || el.offsetParent === null) continue;
    const t = el.innerText.replace(/\\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
})()`;

(async () => {
  const [w, h] = PHONE ? [390, 844] : [1280, 800];
  const page = await launch({ width: w, height: h });
  await page.viewport(w, h, PHONE ? 3 : 1, PHONE);
  const seen = new Set();
  const look = async () => { for (const t of await page.eval(VISIBLE_TEXT)) seen.add(t); };
  const words = () => [...seen].reduce((n, t) => n + t.split(' ').length, 0);
  const settle = async () => {
    for (let i = 0; i < 200; i++) {
      if (await page.eval('!menhir.g.anim && !menhir.g.queue.length')) return;
      await sleep(20);
    }
  };
  let inputs = 0;
  const press = async (dir) => {
    inputs++;
    if (PHONE) {
      const b = await page.eval(`(() => { const r = document.querySelector('.pad-btn[data-dir="${dir}"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
      await page.touch([b]);
    } else await page.key(DIRKEY[dir], { wait: 0 });
    await settle();
    await look();
    await sleep(GAP);
  };
  const waitWin = async () => {
    for (let i = 0; i < 200; i++) {
      if (await page.eval('document.getElementById("win").classList.contains("open")')) return true;
      await sleep(25);
    }
    return false;
  };

  await page.goto(BASE, 1500);
  await look();
  const t0 = Date.now();
  const rows = [];
  inputs++;
  await page.eval('document.getElementById("btn-play").click()');
  await sleep(GAP);
  await look();
  for (const target of [0, 1]) {
    const rot = await page.eval('menhir.g.rot');
    const lvl = await page.eval('menhir.g.levelIndex');
    if (lvl !== target) { console.log('unexpected island', lvl + 1); process.exit(1); }
    const def = rot ? L.rotateDef(DEFS[target]) : DEFS[target];
    const { level, state } = L.parseLevel(def);
    for (const d of moveOptimal(level, state).moves) await press(d);
    const won = await waitWin();
    await look();
    const secs = (Date.now() - t0) / 1000;
    const wd = words();
    rows.push({ island: DEFS[target].name, won, inputs, secs, words: wd, read: wd / 200 * 60 });
    if (target === 0) {
      inputs++;
      await sleep(GAP);
      await page.eval('document.getElementById("btn-next").click()');
      await sleep(GAP);
      await look();
    }
  }
  console.log(`opening, ${PHONE ? 'phone (touch pad)' : 'desktop (keys)'}, reaction gap ${GAP} ms`);
  for (const r of rows) {
    console.log(`  title -> ${r.island.padEnd(12)} solved: ${r.won ? '' : 'NOT WON '}${r.inputs} inputs, ${r.secs.toFixed(1)} s playing, ` +
      `${r.words} words shown (${r.read.toFixed(0)} s to read), about ${(r.secs + r.read).toFixed(0)} s in all`);
  }
  if (page.errors.length) console.log('PAGE ERRORS: ' + page.errors.join(' | '));
  await page.close();
  process.exit(rows.every((r) => r.won) && !page.errors.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
