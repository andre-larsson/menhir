#!/usr/bin/env node
/*
 * In-play teaching and readability checks in headless Chrome (development tool).
 *
 *   node tools/teach-test.js            all checks
 *   node tools/teach-test.js --quick    skip the full title-to-finale run
 *
 * Needs the game served at MENHIR_URL (default http://127.0.0.1:8861/index.html).
 * Covers: the title screen, each island's lesson (wording for keyboard and
 * touch, steps advancing on the right events, board highlights), one-off tips,
 * lessons and tips not repeating, the tips switch, readable text sizes on every
 * target viewport, and a full run from the title through all twelve islands
 * with real key presses and no help page.
 */
'use strict';
const path = require('path');
const { launch, sleep } = require('./cdp.js');
const L = require(path.join(__dirname, '..', 'js', 'logic.js'));
const V = require(path.join(__dirname, '..', 'js', 'solver.js'));
const C = require(path.join(__dirname, '..', 'js', 'coach.js'));
const DEFS = require(path.join(__dirname, '..', 'js', 'levels.js'));
const { moveOptimal } = require('./solve.js');

const BASE = process.env.MENHIR_URL || 'http://127.0.0.1:8861/index.html';
const QUICK = process.argv.includes('--quick');
const MIN_TEXT_PX = 13;
let failures = 0, count = 0;
function check(name, cond, extra) {
  count++;
  if (!cond) failures++;
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (!cond && extra !== undefined ? '  (' + extra + ')' : ''));
}
const DIRKEY = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
const idx = (name) => DEFS.findIndex((d) => d.name === name);
const parsed = (i, rot) => L.parseLevel(rot ? L.rotateDef(DEFS[i]) : DEFS[i]);
const solution = (i, rot) => { const { level, state } = parsed(i, rot); return moveOptimal(level, state).moves; };

// A walk plus a push into a stone that cannot move, from an island's start.
function blockedPush(i) {
  const { level, state } = parsed(i, 0);
  for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) {
    const walk = V.walkPath(level, state, y * level.w + x);
    if (!walk) continue;
    let s = state;
    for (const d of walk) s = L.step(level, s, d).state;
    for (let d = 0; d < 4; d++) {
      if (L.stoneAt(s, s.px + L.DX[d], s.py + L.DY[d]) < 0) continue;
      if (L.step(level, s, d).blocked) return walk.concat([d]);
    }
  }
  return null;
}

async function helpers(page) {
  const settle = async () => {
    for (let i = 0; i < 150; i++) {
      if (await page.eval('!menhir.g.anim && !menhir.g.queue.length')) return;
      await sleep(25);
    }
  };
  const keys = async (dirs, gap) => { for (const d of dirs) { await page.key(DIRKEY[d]); await settle(); if (gap) await sleep(gap); } };
  const coach = () => page.eval('menhir.coach()');
  const st = () => page.eval(`(() => { const g = menhir.g; return { lvl: g.levelIndex + 1, rot: g.rot, pushes: g.state.pushes, won: g.won, dead: g.dead,
    win: document.getElementById('win').classList.contains('open'), menu: document.getElementById('menu').classList.contains('open'),
    toast: document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').textContent : '',
    tip: document.getElementById('toast').classList.contains('tip') }; })()`);
  return { settle, keys, coach, st };
}

// Every rendered text node with a font size below the minimum.
const SMALL_TEXT = `(() => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('.sr-only')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    let hidden = false;
    for (let p = el; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none' || +c.opacity === 0) { hidden = true; break; } }
    if (hidden) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const px = parseFloat(cs.fontSize);
    if (px < ${MIN_TEXT_PX}) out.push(px + 'px "' + n.textContent.trim().slice(0, 30) + '"');
  }
  return out;
})()`;

(async () => {
  // ------------------------------------------------------------ title and First Light (keyboard)
  const page = await launch({ width: 1280, height: 800 });
  await page.viewport(1280, 800, 1, false);
  const { settle, keys, coach, st } = await helpers(page);
  await page.goto(BASE, 1300);
  let s = await st();
  check('first visit shows the title screen', s.menu);
  check('the Play button has focus, so Enter starts', await page.eval('document.activeElement && document.activeElement.id === "btn-play"'));
  await page.key('Enter');
  s = await st();
  let c = await coach();
  check('Play starts First Light with its lesson', !s.menu && s.lvl === 1 && c.lesson === 'basics' && c.step === 0, JSON.stringify(c));
  check('step 1 states the goal and the keyboard controls', /socket/.test(c.text) && /arrow keys/.test(await page.eval('document.getElementById("coach-sub").textContent')));
  check('step 1 marks the stone and the socket on the board', c.tiles === 2, c.tiles);
  const fl = parsed(0, s.rot || 0);
  const sol1 = solution(0, s.rot || 0);
  await keys([sol1[0]]);
  await sleep(450);
  c = await coach();
  check('after a step the lesson moves on to pushing', c.step === 1 && /Walk into the stone/.test(c.text), JSON.stringify(c));
  const firstPush = sol1.findIndex((d, k) => { let t = fl.state; for (let j = 0; j < k; j++) t = L.step(fl.level, t, sol1[j]).state; return L.step(fl.level, t, d).pushed; });
  await keys(sol1.slice(1, firstPush));
  await sleep(300);
  check('the dashed preview is showing when the lesson mentions it', !!(await page.eval('menhir.g.showPreviews && menhir.g.showPreviews.length')));
  await keys([sol1[firstPush]]);
  await sleep(450);
  c = await coach();
  check('after the first push it explains rising', c.step === 2 && /along its length/.test(c.text), JSON.stringify(c));
  await keys(sol1.slice(firstPush + 1));
  await sleep(1500);
  s = await st();
  c = await coach();
  check('solving First Light finishes its lesson and remembers it', s.win && c.seen.basics === true, JSON.stringify(c));
  check('no highlight is drawn once the island is solved', c.tiles === 0, c.tiles);

  // ------------------------------------------------------------ Domino Line: dismiss with the x
  await page.key('Enter');
  c = await coach();
  check('Domino Line opens with the domino lesson', c.lesson === 'domino' && /knocks over/.test(c.text), JSON.stringify(c));
  check('it says what is new in a label', /New: dominoes/.test(await page.eval('document.getElementById("coach-chip").textContent')));
  await page.eval('document.getElementById("coach-x").click()');
  c = await coach();
  check('the x hides the lesson and remembers it', c.row === null && c.seen.domino === true, JSON.stringify(c));
  await page.goto(BASE + '?level=2', 900);
  c = await coach();
  check('a seen lesson does not come back; the riddle shows instead', c.lesson === null && c.row === 'riddle' && c.text === DEFS[1].hint, JSON.stringify(c));
  await page.goto(BASE + '?level=1', 900);
  c = await coach();
  check('a solved island with a seen lesson shows no message row', c.row === null, JSON.stringify(c));

  // ------------------------------------------------------------ the other rule islands
  const expectTiles = { frost: 4, knock: 4 + 2 };
  for (const [name, id, re] of [['Hoarfrost', 'frost', /off the ice/], ['Black Ice', 'knock', /knocks it on/], ['Peat Bog', 'bog', /Bog swallows/], ['Sunside Up', 'mark', /sun facing the sky/]]) {
    await page.goto(BASE + `?level=${idx(name) + 1}`, 900);
    c = await coach();
    check(`${name} teaches its rule (${id})`, c.lesson === id && re.test(c.text) && c.tiles > 0, JSON.stringify(c));
    if (expectTiles[id]) check(`${name} marks the right tiles`, c.tiles === expectTiles[id], c.tiles);
  }
  // Peat Bog: the lesson moves on once a stone fills the bog
  const pb = idx('Peat Bog');
  await page.goto(BASE + `?level=${pb + 1}`, 900);
  s = await st();
  const pbSol = solution(pb, s.rot);
  const pbLv = parsed(pb, s.rot);
  let t = pbLv.state, bogAt = -1;
  for (let k = 0; k < pbSol.length && bogAt < 0; k++) { const r = L.step(pbLv.level, t, pbSol[k]); if (r.events.some((e) => e.fate === 'bog')) bogAt = k; t = r.state; }
  await keys(pbSol.slice(0, bogAt + 1));
  await sleep(500);
  c = await coach();
  check('after a stone fills the bog, the lesson says it is firm ground', c.step === 1 && /firm ground/.test(c.text) && c.tiles > 0, JSON.stringify(c));
  check('the bog lesson also covers water, so its tip is not repeated', c.seen['tip:water'] === true);
  await page.goto(BASE + `?level=${idx('Cascade') + 1}`, 900);
  c = await coach();
  check('an island with no new rule shows only its riddle', c.lesson === null && c.row === 'riddle', JSON.stringify(c));

  // ------------------------------------------------------------ one-off tips
  // Blocked push: the first island where one can be made from the start by walking
  let blk = -1, bp = null;
  for (let i = 0; i < DEFS.length && !bp; i++) { bp = blockedPush(i); if (bp) blk = i; }
  check('found a blocked push to test with', !!bp);
  if (bp) {
    await page.goto(BASE + `?level=${blk + 1}&touch=0`, 900);
    s = await st();
    if (s.rot === 0) {
      await keys(bp);
      s = await st();
      check('a blocked push explains chains, once', s.tip && /Blocked/.test(s.toast), JSON.stringify(s));
      await page.goto(BASE + `?level=${blk + 1}`, 900);
      await keys(bp);
      s = await st();
      check('the blocked tip does not repeat', !/Blocked/.test(s.toast), JSON.stringify(s));
    }
  }
  // Dead end: the bar explains itself the first time only
  const fi = idx('First Light');
  const fLv = parsed(fi, 0);
  const info = new V.Analysis(fLv.level, fLv.state); info.run();
  let fatal = null;
  for (const p of V.pushes(fLv.level, fLv.state)) if (V.distance(fLv.level, info, p.next) === -1) { fatal = V.walkPath(fLv.level, fLv.state, p.from).concat([p.dir]); break; }
  await page.goto(BASE + `?level=${fi + 1}`, 900);
  s = await st();
  if (fatal && s.rot === 0) {
    await keys(fatal);
    await sleep(300);
    const sub = () => page.eval('(() => { const e = document.getElementById("stuck-sub"); return !document.getElementById("stuck").hidden && !e.hidden ? e.textContent : ""; })()');
    check('the first dead end explains the bar and Rewind', /Rewind goes back/.test(await sub()));
    await page.eval('document.getElementById("btn-rewind").click()');
    await keys([fatal[fatal.length - 1]]);
    await sleep(300);
    s = await st();
    check('the second time, the bar is short', s.dead && (await sub()) === '' && !(await page.eval('document.getElementById("stuck").hidden')));
  }
  // Hint: offered after two restarts on an island from Hoarfrost on
  await page.goto(BASE + `?level=${idx('Frozen Lane') + 1}`, 900);
  await keys([0]);
  await page.key('KeyR');
  await keys([0]);
  await page.key('KeyR');
  s = await st();
  check('after two restarts, the Hint button is offered', s.tip && /Hint/.test(s.toast) && await page.eval('document.getElementById("btn-hint").classList.contains("nudge")'), JSON.stringify(s));
  // Water: shown when a stone is about to (or does) sink, on an island where it wasn't taught
  await page.eval('localStorage.removeItem("menhir2.coach")');
  const ko = idx('Knock-On');
  await page.goto(BASE + `?level=${ko + 1}`, 900);
  s = await st();
  await keys(solution(ko, s.rot), 0);
  await sleep(600);
  c = await coach();
  check('water is explained when a stone first meets it', c.seen['tip:water'] === true, JSON.stringify(c.seen));

  // ------------------------------------------------------------ switches
  await page.eval('localStorage.removeItem("menhir2.coach")');
  await page.goto(BASE + `?level=${idx('Hoarfrost') + 1}`, 900);
  await page.key('Escape');
  await page.eval('document.getElementById("opt-tips").click()');
  await page.key('Escape');
  c = await coach();
  check('turning tips off removes the lesson', c.lesson === null, JSON.stringify(c));
  await page.goto(BASE + `?level=${idx('Black Ice') + 1}`, 900);
  c = await coach();
  check('with tips off, a new island has no lesson', c.lesson === null && c.row === 'riddle', JSON.stringify(c));
  await page.key('Escape');
  await page.eval('document.getElementById("btn-tips-reset").click()');
  await page.key('Escape');
  c = await coach();
  check('"Show all tips again" turns them back on', c.lesson === 'knock', JSON.stringify(c));
  await page.goto(BASE + `?level=${idx('Hoarfrost') + 1}&coach=0`, 900);
  c = await coach();
  check('?coach=0 hides lessons for one page load', c.lesson === null);
  check('no page errors (desktop)', page.errors.length === 0, page.errors.join(' | ').slice(0, 400));
  await page.close();

  // ------------------------------------------------------------ touch wording and the pad
  const phone = await launch({ width: 390, height: 844 });
  await phone.viewport(390, 844, 3, true);
  const P = await helpers(phone);
  await phone.goto(BASE, 1300);
  await phone.eval('document.getElementById("btn-play").click()');
  c = await P.coach();
  check('on a phone, step 1 teaches swipe, pad and tap', /Swipe/.test(await phone.eval('document.getElementById("coach-sub").textContent')) && c.step === 0);
  check('the pad glows while the lesson asks you to walk', await phone.eval('document.getElementById("app").classList.contains("coach-pad")'));
  const ps = await P.st();
  const psol = solution(0, ps.rot);
  const padBtn = async (dir) => {
    const b = await phone.eval(`(() => { const r = document.querySelector('.pad-btn[data-dir="${dir}"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await phone.touch([b]);
    await P.settle();
  };
  await padBtn(psol[0]);
  await sleep(450);
  c = await P.coach();
  check('the pad stops glowing after the first step', c.step >= 1 && !(await phone.eval('document.getElementById("app").classList.contains("coach-pad")')), JSON.stringify(c));
  check('step 2 mentions tapping the stone on a phone', /tap it/.test(c.text), c.text);
  for (const d of psol.slice(1)) await padBtn(d);
  await sleep(1500);
  check('First Light can be solved with the pad while the lesson shows', (await P.st()).win);
  check('no page errors (phone)', phone.errors.length === 0, phone.errors.join(' | ').slice(0, 400));
  await phone.close();

  // ------------------------------------------------------------ readable text on every viewport
  const VIEWPORTS = [['desktop', 1280, 800, 1, false], ['phone', 390, 844, 3, true], ['small phone', 360, 640, 2, true],
    ['landscape phone', 844, 390, 3, true], ['small landscape', 640, 360, 2, true]];
  const cas = idx('Cascade');
  for (const [vn, w, h, sc, mob] of VIEWPORTS) {
    const p = await launch({ width: w, height: h });
    await p.viewport(w, h, sc, mob);
    await p.goto(BASE, 1300);
    const play = await p.eval('(() => { const r = document.getElementById("btn-play").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; })()');
    check(`${vn}: the Play button is in view on the title`, play);
    const small = [];
    small.push(...(await p.eval(SMALL_TEXT)).map((x) => 'title ' + x));
    await p.eval('document.getElementById("howto").open = true');
    small.push(...(await p.eval(SMALL_TEXT)).map((x) => 'help ' + x));
    await p.eval('document.getElementById("btn-play").click()');
    await sleep(400);
    small.push(...(await p.eval(SMALL_TEXT)).map((x) => 'lesson ' + x));
    await p.goto(BASE + `?level=${cas + 1}&coach=0`, 600);
    const rot = await p.eval('menhir.g.rot');
    await p.goto(BASE + `?level=${cas + 1}&coach=0&play=` + solution(cas, rot).map((d) => L.DIR_CHAR[d]).join(''), 2400);
    small.push(...(await p.eval(SMALL_TEXT)).map((x) => 'win ' + x));
    check(`${vn}: no text smaller than ${MIN_TEXT_PX}px on title, help, lesson or win card`, small.length === 0, small.slice(0, 6).join('; '));
    const over = await p.eval('document.documentElement.scrollWidth > innerWidth + 1');
    check(`${vn}: no sideways scrolling`, !over);
    check(`${vn}: no page errors`, p.errors.length === 0, p.errors.join(' | ').slice(0, 300));
    await p.close();
  }

  // ------------------------------------------------------------ the whole set from the title, no help page
  if (!QUICK) {
    const run = await launch({ width: 1280, height: 800 });
    await run.viewport(1280, 800, 1, false);
    const R = await helpers(run);
    await run.goto(BASE, 1300);
    await run.key('Enter');
    let lessonsSeen = 0, ok = true;
    for (let i = 0; i < DEFS.length; i++) {
      let r = await R.st();
      if (r.lvl !== i + 1) { ok = false; console.log('     expected island', i + 1, 'got', r.lvl); break; }
      c = await R.coach();
      const want = C.lessonFor(DEFS[i].name);
      if (!!want !== !!c.lesson) { ok = false; console.log('     lesson mismatch on', DEFS[i].name, JSON.stringify(c)); }
      if (c.lesson) lessonsSeen++;
      await R.keys(solution(i, r.rot));
      await sleep(1400);
      r = await R.st();
      if (!r.win || r.pushes !== DEFS[i].par) { ok = false; console.log('     not solved in par:', DEFS[i].name, JSON.stringify(r)); break; }
      await run.key('Enter');
      await sleep(200);
    }
    const end = await R.st();
    check('a fresh player goes from the title through all 12 islands, each lesson on its island', ok && end.menu, JSON.stringify(end));
    check(`six islands teach a rule in play (${lessonsSeen})`, lessonsSeen === Object.keys(C.LESSONS).length);
    check('the help page was never opened', !(await run.eval('document.getElementById("howto").open')));
    check('no page errors in the full run', run.errors.length === 0, run.errors.join(' | ').slice(0, 300));
    await run.close();
  }

  console.log(failures ? `${failures} of ${count} teaching checks FAILED` : `all ${count} teaching checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
