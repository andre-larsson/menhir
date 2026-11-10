#!/usr/bin/env node
/*
 * End-to-end input test in headless Chrome (development tool).
 *
 *   node tools/input-test.js
 *
 * Needs the game served at MENHIR_URL (default http://127.0.0.1:8861/index.html),
 * e.g. python3 -m http.server 8861 --bind 127.0.0.1 --directory <this folder>.
 * Drives real keyboard, mouse and touch events, then reads the game state
 * through the page's window.menhir hook.
 */
'use strict';
const path = require('path');
const { launch, sleep } = require('./cdp.js');
const L = require(path.join(__dirname, '..', 'js', 'logic.js'));
const V = require(path.join(__dirname, '..', 'js', 'solver.js'));
const DEFS = require(path.join(__dirname, '..', 'js', 'levels.js'));
const { moveOptimal } = require('./solve.js');

const BASE = process.env.MENHIR_URL || 'http://127.0.0.1:8861/index.html';
let failures = 0, count = 0;
function check(name, cond, extra) {
  count++;
  if (!cond) failures++;
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (!cond && extra !== undefined ? '  (' + extra + ')' : ''));
}
const DIRKEY = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
const find = (pred) => DEFS.findIndex(pred);

(async () => {
  const page = await launch({ width: 1280, height: 800 });
  const st = () => page.eval(`(() => { const g = menhir.g; return { lvl: g.levelIndex + 1, rot: g.rot, px: g.state.px, py: g.state.py, moves: g.state.moves, pushes: g.state.pushes,
    won: g.won, dead: g.dead, hint: g.hint, undo: g.undo.length, win: document.getElementById('win').classList.contains('open'),
    menu: document.getElementById('menu').classList.contains('open'), stuck: !document.getElementById('stuck').hidden }; })()`);
  const settle = async () => {
    for (let i = 0; i < 100; i++) {
      if (await page.eval('!menhir.g.anim && !menhir.g.queue.length')) return;
      await sleep(30);
    }
  };
  const keys = async (dirs) => { for (const d of dirs) { await page.key(DIRKEY[d]); await settle(); } };
  const solution = (i, rot) => {
    const def = rot ? L.rotateDef(DEFS[i]) : DEFS[i];
    const { level, state } = L.parseLevel(def);
    return moveOptimal(level, state).moves;
  };

  // ---------------------------------------------------------------- first visit
  await page.goto(BASE, 1200);
  let s = await st();
  check('first visit opens the title screen, How to play closed', s.menu && !(await page.eval('document.getElementById("howto").open')));
  await page.key('Escape');
  s = await st();
  check('Escape closes the menu', !s.menu);
  check('starts on island 1', s.lvl === 1, s.lvl);

  // ---------------------------------------------------------------- keyboard solve, win flow
  await keys(solution(0, s.rot));
  await sleep(1500);
  s = await st();
  check('keyboard solves island 1', s.won && s.pushes === DEFS[0].par, JSON.stringify(s));
  check('the win card opens', s.win);
  check('solving within par without hints earns a golden sun', await page.eval('document.getElementById("win-medal").classList.contains("gold")'));
  await page.key('KeyZ');
  s = await st();
  check('undo after winning takes the win back', !s.won && !s.win && s.pushes === DEFS[0].par - 1, JSON.stringify(s));
  await page.goto(BASE + '?level=1', 900);
  await keys(solution(0, 0));
  await sleep(1400);
  await page.key('Enter');
  s = await st();
  check('Enter goes to the next island', s.lvl === 2 && s.moves === 0, JSON.stringify(s));

  // ---------------------------------------------------------------- restart and undo
  await keys([3, 2]);
  const before = await st();
  await page.key('KeyR');
  s = await st();
  check('R restarts the island (as one undoable step)', s.moves === 0 && s.undo === before.undo + 1, JSON.stringify(s));
  await page.key('KeyZ');
  s = await st();
  check('undo brings the moves from before the restart back', s.moves === before.moves && s.px === before.px && s.py === before.py, JSON.stringify(s));

  // ---------------------------------------------------------------- held keys walk but never push
  await page.goto(BASE + '?level=1', 900);
  s = await st();
  const lv1 = L.parseLevel(DEFS[0]);
  // walk west with a held key (auto-repeat events)
  await page.key('ArrowLeft', { repeat: true });
  await settle();
  s = await st();
  check('a held key walks', s.moves === 1 && s.px === lv1.state.px - 1, JSON.stringify(s));
  // stand right above the stone, then hold down
  const stone = lv1.state.stones[0];
  await page.eval(`menhir.load(0)`);
  const path0 = V.walkPath(lv1.level, lv1.state, (stone.y - 1) * lv1.level.w + stone.x);
  await keys(path0);
  const atStone = await st();
  await page.key('ArrowDown', { repeat: true });
  await settle();
  s = await st();
  check('a held key never pushes a stone', s.pushes === 0 && s.moves === atStone.moves, JSON.stringify(s));
  check('...and says so once, with a tip', await page.eval('document.getElementById("toast").classList.contains("tip") && /never pushes/.test(document.getElementById("toast").textContent)'));
  await page.key('ArrowDown');
  await settle();
  s = await st();
  check('a fresh key press pushes it', s.pushes === 1 && s.py === stone.y, JSON.stringify(s));

  // ---------------------------------------------------------------- fast typing, other undo keys
  await page.goto(BASE + '?level=1', 900);
  await page.key('ArrowLeft', { wait: 0 });
  await page.key('ArrowDown', { wait: 0 });
  await page.key('ArrowDown', { wait: 0 });
  await settle();
  s = await st();
  check('keys typed during an animation are queued, not lost', s.moves === 3, JSON.stringify(s));
  await page.key('Backspace');
  s = await st();
  check('Backspace undoes', s.moves === 2, s.moves);
  await page.key('KeyZ');
  s = await st();
  check('Z undoes', s.moves === 1, s.moves);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'u', code: 'KeyU', windowsVirtualKeyCode: 85 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'u', code: 'KeyU', windowsVirtualKeyCode: 85 });
  s = await st();
  check('U undoes', s.moves === 0, s.moves);
  const music0 = await page.eval('MenhirAudio.musicOn()');
  await page.eval('document.getElementById("btn-music").click()');
  check('the Music button toggles the music', (await page.eval('MenhirAudio.musicOn()')) !== music0);
  await page.eval('document.getElementById("btn-music").click()');

  // ---------------------------------------------------------------- walls
  await page.goto(BASE + '?level=1', 900);
  for (let i = 0; i < 6; i++) await page.key('ArrowUp', { wait: 260 });
  await settle();
  s = await st();
  check('the walled shore stops the keeper', s.py >= 1 && L.keeperCan(lv1.level, lv1.state, s.px, s.py), JSON.stringify(s));

  // ---------------------------------------------------------------- dead end, rewind
  // find a level and a first push that is fatal
  let deadCase = null;
  for (let i = 0; i < DEFS.length && !deadCase; i++) {
    const { level, state } = L.parseLevel(DEFS[i]);
    const info = new V.Analysis(level, state); info.run();
    for (const p of V.pushes(level, state)) {
      if (V.distance(level, info, p.next) === -1) { deadCase = { i, walk: V.walkPath(level, state, p.from), dir: p.dir }; break; }
    }
  }
  check('found an island with a fatal first push', !!deadCase);
  if (deadCase) {
    await page.goto(BASE + `?level=${deadCase.i + 1}`, 900);
    s = await st();
    if (s.rot === 0) {
      await keys(deadCase.walk.concat([deadCase.dir]));
      await sleep(500);
      s = await st();
      check('a fatal push shows "No way forward"', s.dead && s.stuck, JSON.stringify(s));
      await page.key('KeyH');
      s = await st();
      check('hint refuses while stuck', !s.hint);
      await page.key('KeyZ', { shift: true });
      await settle();
      s = await st();
      check('Shift+Z rewinds to the last winnable position', !s.dead && !s.stuck && s.pushes === 0, JSON.stringify(s));
      await keys([deadCase.dir]);
      await page.eval('document.getElementById("opt-deadbar").click()');
      s = await st();
      check('turning the warning off hides the bar', s.dead && !s.stuck, JSON.stringify(s));
      await page.eval('document.getElementById("opt-deadbar").click()');
      s = await st();
      check('turning it on shows it again', s.stuck);
      await page.eval('document.getElementById("btn-rewind").click()');
      s = await st();
      check('the Rewind button rewinds', !s.dead && !s.stuck, JSON.stringify(s));
    }
  }

  // ---------------------------------------------------------------- hints
  const hintLevel = find((d) => (d.teaches || []).includes('frost') && (d.teaches || []).includes('domino'));
  await page.goto(BASE + `?level=${hintLevel + 1}`, 900);
  for (let i = 0; i < 40; i++) await page.eval('menhir.analysisDone()') || await sleep(50);
  for (let guard = 0; guard < 30; guard++) {
    s = await st();
    if (s.won) break;
    await page.key('KeyH');
    const plan = await page.eval(`(() => { const g = menhir.g, h = g.hint; if (!h) return null;
      const w = MenhirSolver.walkPath(g.level, g.state, h.y * g.level.w + h.x); return w ? w.concat([h.dir]) : null; })()`);
    if (!plan) break;
    await keys(plan);
  }
  await sleep(1500);
  s = await st();
  check(`following hints solves ${DEFS[hintLevel].name} in par pushes`, s.won && s.pushes === DEFS[hintLevel].par, JSON.stringify(s));
  check('a hinted solve earns no golden sun', !(await page.eval('document.getElementById("win-medal").classList.contains("gold")')));

  // ---------------------------------------------------------------- previews
  await page.goto(BASE + `?level=${hintLevel + 1}`, 900);
  const sol = solution(hintLevel, 0);
  const firstPush = sol.findIndex((d, k) => {
    const { level, state } = L.parseLevel(DEFS[hintLevel]);
    let t = state;
    for (let j = 0; j < k; j++) t = L.step(level, t, sol[j]).state;
    return L.step(level, t, d).pushed;
  });
  await keys(sol.slice(0, firstPush));
  await sleep(500);
  const pv = await page.eval(`(() => { const p = menhir.g.showPreviews; if (!p) return null; return p.map((x) => ({ dir: x.dir, stones: new Set(x.rolls.map((r) => r.stone)).size, tips: x.rolls.length, knocks: x.rolls.filter((r) => r.depth > 0).length })); })()`);
  const pvMain = pv && pv.find((x) => x.dir === sol[firstPush]);
  check('push previews show the whole chain (frost tips and knock-ons)', !!pvMain && pvMain.stones >= 2 && pvMain.knocks >= 1 && pvMain.tips >= 3, JSON.stringify(pv));
  await page.key('KeyP');
  await sleep(200);
  check('P turns the previews off', (await page.eval('menhir.g.showPreviews')) === null);
  await page.key('KeyP');

  // ---------------------------------------------------------------- mouse: click to walk, click a stone to push
  await page.goto(BASE + '?level=1', 900);
  const target = { x: lv1.state.px - 1, y: lv1.state.py + 2 };
  let pt = await page.eval(`(() => { const r = document.getElementById('board').getBoundingClientRect(); const p = menhir.tileToScreen(${target.x}, ${target.y}); return [r.left + p[0], r.top + p[1]]; })()`);
  await page.click(pt[0], pt[1]);
  await sleep(900);
  await settle();
  s = await st();
  check('clicking a tile walks there without pushing', s.px === target.x && s.py === target.y && s.pushes === 0, JSON.stringify(s));
  check('the whole walk is one undo step', s.undo === 1, s.undo);
  await page.eval('menhir.load(0)');
  await keys(path0);
  pt = await page.eval(`(() => { const r = document.getElementById('board').getBoundingClientRect(); const p = menhir.tileToScreen(${stone.x}, ${stone.y}); return [r.left + p[0], r.top + p[1]]; })()`);
  await page.click(pt[0], pt[1]);
  await settle();
  s = await st();
  check('clicking the stone next to the keeper pushes it', s.pushes === 1, JSON.stringify(s));

  // ---------------------------------------------------------------- menu and level keys
  await page.key('BracketRight');
  s = await st();
  check('] goes to the next island', s.lvl === 2, s.lvl);
  await page.key('BracketLeft');
  s = await st();
  check('[ goes to the previous island', s.lvl === 1, s.lvl);
  await page.key('Escape');
  s = await st();
  check('Esc opens the level select', s.menu);
  await page.eval('document.querySelectorAll(".level-card")[2].click()');
  s = await st();
  check('picking an island in the level select loads it', !s.menu && s.lvl === 3, JSON.stringify(s));
  const muted0 = await page.eval('MenhirAudio.isMuted()');
  await page.key('KeyM');
  check('M toggles sound', (await page.eval('MenhirAudio.isMuted()')) !== muted0);
  await page.key('KeyM');
  check('no page errors on desktop', page.errors.length === 0, page.errors.join(' | ').slice(0, 400));
  await page.close();

  // ---------------------------------------------------------------- phone: touch, pad, portrait rotation
  const phone = await launch({ width: 390, height: 844 });
  await phone.viewport(390, 844, 3, true);
  const pst = () => phone.eval('(() => { const g = menhir.g; return { lvl: g.levelIndex + 1, rot: g.rot, px: g.state.px, py: g.state.py, moves: g.state.moves, pushes: g.state.pushes, won: g.won }; })()');
  const psettle = async () => { for (let i = 0; i < 100; i++) { if (await phone.eval('!menhir.g.anim && !menhir.g.queue.length')) return; await sleep(30); } };
  await phone.goto(BASE + '?level=1', 1200);
  check('the touch pad is shown on a phone', await phone.eval('getComputedStyle(document.getElementById("pad")).display !== "none"'));
  const tileCenter = (x, y) => phone.eval(`(() => { const r = document.getElementById('board').getBoundingClientRect(); const p = menhir.tileToScreen(${x}, ${y}); return [r.left + p[0], r.top + p[1]]; })()`);
  let p0 = await pst();
  const c0 = await tileCenter(p0.px, p0.py);
  await phone.touch([[c0[0], c0[1]], [c0[0] - 15, c0[1]], [c0[0] - 50, c0[1]]]);
  await psettle();
  let p1 = await pst();
  check('swiping moves the keeper one step', p1.moves === 1 && (p1.px !== p0.px || p1.py !== p0.py), JSON.stringify(p1));
  const padBtn = async (dir) => {
    const b = await phone.eval(`(() => { const r = document.querySelector('.pad-btn[data-dir="${dir}"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await phone.touch([b]);
    await psettle();
  };
  await padBtn((p1.rot === 1 ? 0 : 1)); // undo the swipe's direction loosely: any legal pad move
  const p2 = await pst();
  check('the on-screen pad moves the keeper', p2.moves === 2, JSON.stringify(p2));
  // tap a free tile two steps away
  const lvState = await phone.eval('(() => { const g = menhir.g; const out = []; for (let y = 0; y < g.level.h; y++) for (let x = 0; x < g.level.w; x++) if (MenhirLogic.walkable(g.level, g.state, x, y) && Math.abs(x - g.state.px) + Math.abs(y - g.state.py) >= 2) out.push([x, y]); return out; })()');
  const tgt = lvState[0];
  const tc = await tileCenter(tgt[0], tgt[1]);
  await phone.touch([tc]);
  await sleep(1200);
  await psettle();
  const p3 = await pst();
  check('tapping a tile walks there', p3.px === tgt[0] && p3.py === tgt[1] && p3.pushes === 0, JSON.stringify(p3) + ' -> ' + tgt);
  // portrait: a wide island is shown rotated, and its rotated solution wins
  const wide = DEFS.findIndex((d) => { const W = Math.max.apply(null, d.map.map((r) => r.length)); return W >= d.map.length * 1.8; });
  await phone.goto(BASE + `?level=${wide + 1}`, 1000);
  let pw = await pst();
  check(`a wide island (${DEFS[wide].name}) is rotated to fit a portrait phone`, pw.rot === 1, JSON.stringify(pw));
  const rsol = solution(wide, pw.rot);
  for (const d of rsol) {
    await padBtn(d);
  }
  await sleep(1500);
  pw = await pst();
  check('the rotated island can be solved with the pad', pw.won, JSON.stringify(pw));
  // rotating the device mid-puzzle keeps the progress
  await phone.goto(BASE + `?level=${wide + 1}`, 1000);
  await padBtn(rsol[0]); await padBtn(rsol[1]);
  const mid = await pst();
  await phone.viewport(844, 390, 3, true);
  await sleep(600);
  const after = await pst();
  check('turning the phone mid-puzzle keeps moves and progress', after.rot === 0 && after.moves === mid.moves, JSON.stringify(mid) + ' -> ' + JSON.stringify(after));
  check('no page errors on the phone', phone.errors.length === 0, phone.errors.join(' | ').slice(0, 400));
  await phone.close();

  console.log(failures ? `${failures} of ${count} input checks FAILED` : `all ${count} input checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
