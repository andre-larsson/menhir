/* Menhir - game controller: input, undo/rewind, assists, level flow, animation scheduling. */
(function () {
  'use strict';
  const L = window.MenhirLogic;
  const S = window.MenhirSolver;
  const Audio = window.MenhirAudio;
  const { Renderer, TIMING } = window.MenhirRender;
  const DEFS = window.MENHIR_LEVELS;
  const C = window.MenhirCoach;
  const params = new URLSearchParams(location.search);

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const canvas = $('board');
  const stage = $('stage');
  const renderer = new Renderer(canvas);

  // ------------------------------------------------------------ persistence
  // A separate key from the earlier Menhir build, so the two never share scores.
  const STORE = 'menhir2.progress';
  let progress = { best: {}, perfect: {}, current: 0, seenMenu: false, preview: true, deadBar: true };
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) progress = Object.assign(progress, JSON.parse(raw));
  } catch (e) { /* storage unavailable: play without saving */ }
  progress.perfect = progress.perfect || {};
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(progress)); } catch (e) { /* ignore */ }
  }
  const isPerfect = (d) => !!progress.perfect[d.name];
  const isSolved = (d) => progress.best[d.name] != null;

  // What the in-play lessons and tips have already shown, so replays don't nag.
  const COACH_STORE = 'menhir2.coach';
  let coachMem = { seen: {}, off: false };
  try {
    const raw = localStorage.getItem(COACH_STORE);
    if (raw) coachMem = Object.assign(coachMem, JSON.parse(raw));
  } catch (e) { /* storage unavailable */ }
  coachMem.seen = coachMem.seen || {};
  function saveCoach() {
    try { localStorage.setItem(COACH_STORE, JSON.stringify(coachMem)); } catch (e) { /* ignore */ }
  }
  // ?coach=0 turns lessons and tips off for this page load only (screenshots, tools).
  const coachParamOff = params.get('coach') === '0';
  const tipsOn = () => !coachParamOff && !coachMem.off;
  const isTouch = () => app.classList.contains('touch');

  // ------------------------------------------------------------ game state
  // Each level in two variants: as designed, and rotated 90 degrees (used when
  // that fits the screen much better, e.g. a wide level on a portrait phone).
  const variants = DEFS.map(() => [null, null]);
  function variant(i, r) {
    if (!variants[i][r]) variants[i][r] = L.parseLevel(r ? L.rotateDef(DEFS[i]) : DEFS[i]);
    return variants[i][r];
  }
  function bestRotation(i, current) {
    const t0 = renderer.measure(variant(i, 0).level).T;
    const t1 = renderer.measure(variant(i, 1).level).T;
    if (current === 1) return t0 >= t1 * 1.2 ? 0 : 1;
    return t1 >= t0 * 1.2 ? 1 : 0;
  }
  const g = {
    levelIndex: 0,
    rot: 0,
    level: null,
    state: null,
    initial: null,
    undo: [],
    anim: null,
    queue: [],          // pending inputs: { dir, group, repeat }
    won: false,
    wonAt: 0,
    dawn: 0,
    intro: 0,
    idleSince: 0,
    preview: progress.preview !== false,
    previews: null,     // cached push previews for the current state
    previewFor: null,
    hover: null,        // { x, y, cells } for mouse hover
    hint: null,         // { x, y, dir } tile to push from
    hinted: false,      // a hint was used on this attempt
    dead: false,        // the level can no longer be won from here
    analyses: [],       // per rotation: whole-level analysis (MenhirSolver.Analysis)
    coach: null,        // { lesson, step } while an island's lesson is showing
    coachRow: null,     // 'lesson' | 'riddle' | null: what the message row shows
    coachTiles: null,   // tiles to highlight on the board for the current step
    restarts: 0,        // on this visit to the island (for the hint tip)
    deadCount: 0,       // times the dead-end bar appeared on this visit
    loadedAt: 0,
  };

  function analysis() { return g.analyses[g.rot] || null; }
  function startAnalysis() {
    if (!g.analyses[g.rot]) g.analyses[g.rot] = new S.Analysis(g.level, g.initial, 60000);
  }

  function loadLevel(i, opts) {
    i = Math.max(0, Math.min(DEFS.length - 1, i));
    g.levelIndex = i;
    g.undo = [];
    g.anim = null;
    g.queue = [];
    g.won = false;
    g.dawn = 0;
    g.hover = null;
    g.hint = null;
    g.hinted = false;
    g.dead = false;
    g.analyses = [];
    g.warnedUpsideDown = false;
    g.intro = now();
    g.idleSince = now();
    g.loadedAt = now();
    g.restarts = 0;
    g.deadCount = 0;
    setupCoach();
    // The message row changes the board's space: fit the canvas before
    // choosing the rotation and laying out the island.
    fitCanvas();
    g.rot = bestRotation(i, -1);
    g.level = variant(i, g.rot).level;
    g.initial = variant(i, g.rot).state;
    g.state = L.cloneState(g.initial);
    startAnalysis();
    renderer.curLevel = g.level;
    renderer.clearEffects();
    progress.current = i;
    save();
    $('lvl-num').textContent = String(i + 1);
    $('lvl-name').textContent = DEFS[i].name;
    document.title = `Menhir · ${DEFS[i].name}`;
    closeOverlay('win');
    setStuck();
    updateHud();
    if (!opts || !opts.quiet) { toast(null); Audio.play('intro'); }
  }

  function updateHud() {
    $('pushes-n').textContent = String(g.state.pushes);
    $('pushes-word').textContent = g.state.pushes === 1 ? 'push' : 'pushes';
    const par = DEFS[g.levelIndex].par;
    $('par-n').textContent = par != null ? String(par) : '–';
    $('moves-n').textContent = String(g.state.moves);
    app.dataset.state = g.won ? 'won' : 'playing';
  }

  // ------------------------------------------------------------ toast
  // A tip holds the spot until it times out; ordinary notes wait their turn
  // (they are dropped). toast(null) clears everything, e.g. on a new island.
  let toastTimer = 0, tipUntil = 0;
  function toast(msg, ms, tip) {
    const el = $('toast');
    if (msg !== null && !tip && now() < tipUntil) return;
    clearTimeout(toastTimer);
    if (!msg) { el.classList.remove('show'); tipUntil = 0; return; }
    el.textContent = msg;
    el.classList.toggle('tip', !!tip);
    el.classList.add('show');
    tipUntil = tip ? now() + (ms || 2600) : 0;
    toastTimer = setTimeout(() => { el.classList.remove('show'); tipUntil = 0; }, ms || 2600);
  }

  // ------------------------------------------------------------ lessons in play
  // The message row under the island name shows the lesson of an island that
  // brings in a new rule, one step at a time, with what it talks about marked
  // on the board. Otherwise it shows the island's riddle until it is solved.
  function setupCoach() {
    const d = DEFS[g.levelIndex];
    const lesson = C.lessonFor(d.name);
    g.coach = lesson && tipsOn() && !coachMem.seen[lesson.id] ? { lesson, step: 0 } : null;
    if (g.coach && lesson.covers) { lesson.covers.forEach((t) => { coachMem.seen['tip:' + t] = true; }); saveCoach(); }
    g.coachRow = g.coach ? 'lesson' : !isSolved(d) && d.hint ? 'riddle' : null;
    g.coachTiles = null;
    g.coachTilesFor = null;
    renderCoach();
  }

  function coachStep() { return g.coach ? g.coach.lesson.steps[g.coach.step] || null : null; }

  function renderCoach() {
    const row = $('coach');
    const d = DEFS[g.levelIndex];
    row.hidden = !g.coachRow;
    row.classList.toggle('lesson', g.coachRow === 'lesson');
    row.classList.toggle('riddle', g.coachRow === 'riddle');
    let chip = '', text = '', sub = '';
    if (g.coachRow === 'lesson' && g.coach) {
      const steps = g.coach.lesson.steps;
      const st = steps[Math.min(g.coach.step, steps.length - 1)];
      chip = g.coach.lesson.chip;
      text = C.say(st.text, isTouch());
      sub = C.say(st.sub, isTouch());
    } else if (g.coachRow === 'riddle') text = d.hint;
    $('coach-chip').textContent = chip;
    $('coach-chip').hidden = !chip;
    $('coach-text').textContent = text;
    $('coach-sub').textContent = sub;
    $('coach-sub').hidden = !sub;
    $('coach-x').setAttribute('aria-label', g.coachRow === 'lesson' ? 'Hide this tip' : 'Hide');
    const step = coachStep();
    app.classList.toggle('coach-pad', !!(step && step.pad && !g.won));
    // replay the entrance animation when the text changes
    const key = g.levelIndex + ':' + g.coachRow + ':' + (g.coach ? g.coach.step : '');
    if (row.dataset.key !== key) {
      row.dataset.key = key;
      row.classList.remove('enter');
      void row.offsetWidth;
      row.classList.add('enter');
    }
  }

  // Game events of one move: { move, push, slide, bog, sink, win }.
  function coachEvent(ev) {
    if (!g.coach) return;
    const steps = g.coach.lesson.steps;
    const before = g.coach.step;
    const after = ev.win ? steps.length : C.advance(g.coach.lesson, before, ev);
    if (after === before) return;
    g.coach.step = after;
    if (after >= steps.length) { coachMem.seen[g.coach.lesson.id] = true; saveCoach(); }
    renderCoach();
  }

  function hideCoach() {
    if (g.coach) { coachMem.seen[g.coach.lesson.id] = true; saveCoach(); }
    g.coach = null;
    g.coachRow = null;
    renderCoach();
  }

  // One-off tips for moments that can come up on any island.
  function showTip(id, ms) {
    if (!tipsOn() || coachMem.seen['tip:' + id]) return false;
    coachMem.seen['tip:' + id] = true;
    saveCoach();
    toast(C.say(C.TIPS[id], isTouch()), ms || 6000, true);
    return true;
  }
  function nudge(ids, ms) {
    ids.forEach((id) => $(id).classList.add('nudge'));
    setTimeout(() => ids.forEach((id) => $(id).classList.remove('nudge')), ms);
  }
  // Offer the hint button to a player who seems stuck (from island 3 on).
  function maybeHintTip() {
    if (g.levelIndex < 2 || g.won || coachMem.seen['tip:hint'] || !tipsOn()) return;
    const long = now() - g.loadedAt > 90000 && g.state.pushes >= DEFS[g.levelIndex].par;
    if (g.deadCount >= 2 || g.restarts >= 2 || long) {
      if (showTip('hint', 7000)) nudge(['btn-hint', 'pad-hint'], 7000);
    }
  }

  // Tiles the current lesson step talks about, in the current rotation.
  function computeCoachTiles() {
    const step = coachStep();
    if (!step || !step.hl || g.won) return null;
    if (g.coachTilesFor === g.state && g.coachTilesStep === step) return g.coachTiles;
    const lv = g.level, st = g.state, out = [];
    const add = (x, y) => { if (!out.some(([a, b]) => a === x && b === y)) out.push([x, y]); };
    const live = st.stones.filter((t) => !t.sunk);
    for (const h of step.hl) {
      if (h === 'socket') lv.sockets.forEach((i) => add(i % lv.w, Math.floor(i / lv.w)));
      else if (h === 'stones' || h === 'marked') {
        live.forEach((t) => { if (h === 'stones' || t.k === 'm') L.stoneCells(t).forEach(([x, y]) => add(x, y)); });
      } else if (h === 'far') {
        let far = null, fd = -1;
        live.forEach((t) => { const dd = Math.abs(t.x - st.px) + Math.abs(t.y - st.py); if (dd > fd) { fd = dd; far = t; } });
        if (far) L.stoneCells(far).forEach(([x, y]) => add(x, y));
      } else if (h === 'keeper') add(st.px, st.py);
      else {
        for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
          const base = lv.tiles[y * lv.w + x], t = L.tileAt(lv, st, x, y);
          if ((h === 'frost' && t === L.FROST) || (h === 'bog' && t === L.BOG) || (h === 'water' && t === L.WATER) ||
              (h === 'filled' && base === L.BOG && t !== L.BOG)) add(x, y);
        }
      }
    }
    g.coachTiles = out;
    g.coachTilesFor = g.state;
    g.coachTilesStep = step;
    return out;
  }

  // ------------------------------------------------------------ moves
  function now() { return performance.now(); }

  function animating() { return g.anim && now() - g.anim.start < g.anim.dur; }

  // Give each event a start time, duration and easing; returns the blocking duration.
  // A knocked-on stone starts when the stone hitting it is halfway down; a
  // frost slide tip follows straight on from the stone's previous tip.
  function schedule(events, speed) {
    let total = 0;
    for (const e of events) if (e.type === 'walk') total = Math.max(total, TIMING.walk * speed);
    const rolls = events.filter((e) => e.type === 'roll').sort((a, b) => a.wave - b.wave || a.depth - b.depth);
    const byStone = new Map();
    for (const e of rolls) {
      if (!byStone.has(e.stone)) byStone.set(e.stone, []);
      byStone.get(e.stone).push(e);
    }
    for (const e of rolls) {
      const fromUp = L.isStanding(e.from.m), toUp = L.isStanding(e.to.m);
      e.kind = fromUp ? 'topple' : toUp ? 'rise' : 'roll';
      const own = byStone.get(e.stone);
      const k = own.indexOf(e);
      const prev = k > 0 ? own[k - 1] : null;
      const next = k < own.length - 1 ? own[k + 1] : null;
      e.slide = !!prev;
      e.dur = prev ? TIMING.glide : TIMING[e.kind];
      if (e.parent) e.t0 = e.parent.t0 + e.parent.dur * 0.5;
      else if (prev) e.t0 = prev.t0 + prev.dur;
      else e.t0 = 0;
      if (e.parent && prev) e.t0 = Math.max(e.t0, prev.t0 + prev.dur);
      e.ease = prev && next ? 'lin' : prev ? 'out' : next ? 'in' : 'inout';
      total = Math.max(total, e.t0 + e.dur); // sinking afterwards is cosmetic and non-blocking
    }
    return total;
  }

  function socketAt(x, y) { return g.level.tiles[y * g.level.w + x] === L.SOCKET; }

  function effectsFor(events, after) {
    const t = now();
    let setCount = L.socketStatus(g.level, after).filter((s) => s === 'set').length;
    const setsHere = [];
    const lastOf = new Map();
    for (const e of events) if (e.type === 'roll') lastOf.set(e.stone, e);
    for (const e of events) {
      if (e.type === 'walk') Audio.play('step');
      if (e.type !== 'roll') continue;
      const landMs = e.t0 + e.dur;
      const land = landMs / 1000;
      if (e.slide) Audio.play('glide', e.t0 / 1000, e.wave);
      else Audio.play(e.kind, e.t0 / 1000, e.depth);
      if (e.depth > 0) Audio.play('knock', e.t0 / 1000, e.depth);
      const cells = L.stoneCells(e.to);
      const cx = cells.reduce((a, c) => a + c[0], 0) / cells.length + 0.5;
      const cy = cells.reduce((a, c) => a + c[1], 0) / cells.length + 0.5;
      const onIce = cells.some(([x, y]) => L.tileAt(g.level, after, x, y) === L.FROST);
      if (e.fate) renderer.addSinker(e, t + landMs);
      if (e.fate === 'sink') {
        Audio.play('sink', land);
        renderer.burst('splash', cx, cy, -0.4, 18, landMs);
        renderer.burst('ring', cx, cy, -0.42, 2, landMs);
        renderer.shake(2, landMs);
      } else if (e.fate === 'bog') {
        Audio.play('bog', land);
        renderer.burst('mud', cx, cy, 0.05, 14, landMs);
        renderer.shake(3, landMs);
      } else {
        renderer.burst(onIce ? 'ice' : 'dust', cx, cy, 0.05, e.kind === 'roll' ? 5 : 9, landMs);
        if (lastOf.get(e.stone) === e) renderer.shake(e.kind === 'topple' ? 3.2 : e.kind === 'rise' ? 2.2 : 1.2, landMs);
        const rest = lastOf.get(e.stone) === e;
        if (rest && L.stoneSet(g.level, Object.assign({ sunk: false }, e.to))) setsHere.push({ e, cx, cy, landMs });
      }
    }
    // chime for each newly set stone, rising in pitch with how many are set
    setCount -= setsHere.length;
    setsHere.sort((a, b) => a.landMs - b.landMs).forEach((s) => {
      setCount++;
      Audio.play('set', s.landMs / 1000, setCount);
      renderer.burst('spark', s.cx, s.cy, 1.9, 22, s.landMs);
      renderer.beam(s.e.to.x + 0.5, s.e.to.y + 0.5, s.landMs);
    });
  }

  function tryMove(dir, opts) {
    opts = opts || {};
    if (g.won) return false;
    const res = L.step(g.level, g.state, dir);
    if (res.blocked) {
      if (opts.repeat) return false;
      g.anim = { start: now(), dur: 160, events: [{ type: 'bump', dir }] };
      Audio.play('bump');
      g.queue = g.queue.filter((q) => !q.group); // abandon an auto-walk
      if (!opts.group && L.stoneAt(g.state, g.state.px + L.DX[dir], g.state.py + L.DY[dir]) >= 0) showTip('blocked', 5500);
      return false;
    }
    // Held keys walk but never push: a stone only moves on a fresh press.
    if (res.pushed && (opts.repeat || opts.group)) return false;
    const speed = opts.group ? 0.72 : 1;
    const dur = schedule(res.events, speed);
    if (!opts.group) {
      g.undo.push(g.state);
      if (g.undo.length > 3000) g.undo.shift();
    }
    g.state = res.state;
    g.anim = { start: now(), dur, events: res.events, speed, pushing: res.pushed };
    g.hover = null;
    effectsFor(res.events, g.state);
    updateHud();
    if (res.pushed) {
      g.hint = null;
      const before = g.dead;
      checkDead();
      if (g.dead && !before) {
        const st = g.state;
        g.deadCount++;
        setTimeout(() => { if (g.state === st && g.dead && stuckShown()) Audio.play('stuck'); }, dur);
        maybeHintTip();
      }
    }
    if (!g.warnedUpsideDown && L.socketStatus(g.level, g.state).includes('wrong')) {
      g.warnedUpsideDown = true;
      setTimeout(() => toast('Upside down: a marked stone must stand with its sun to the sky.', 3600, true), dur);
    }
    const rolls = res.events.filter((e) => e.type === 'roll');
    const ev = {
      move: true, push: !!res.pushed, win: L.isWon(g.level, g.state),
      slide: rolls.some((e) => e.slide), bog: rolls.some((e) => e.fate === 'bog'), sink: rolls.some((e) => e.fate === 'sink'),
    };
    setTimeout(() => coachEvent(ev), Math.min(dur, 400));
    if (ev.sink) setTimeout(() => showTip('water'), dur);
    const stonesMoved = new Set(rolls.map((e) => e.stone)).size;
    const glides = rolls.filter((e) => e.slide).length;
    if (stonesMoved >= 3) setTimeout(() => toast(stonesMoved >= 4 ? `Cascade! ${stonesMoved} stones` : 'Domino!', 1500), dur * 0.6);
    else if (stonesMoved === 2 && glides) setTimeout(() => toast('Knock-on!', 1300), dur * 0.6);
    if (L.isWon(g.level, g.state)) {
      g.won = true;
      g.queue = [];
      g.wonAt = now() + dur;
      g.dead = false;
      setStuck();
      const d = DEFS[g.levelIndex];
      const prevBest = progress.best[d.name];
      const wasPerfect = isPerfect(d);
      const pushes = g.state.pushes;
      if (prevBest == null || pushes < prevBest) progress.best[d.name] = pushes;
      const perfectNow = d.par != null && pushes <= d.par && !g.hinted;
      if (perfectNow) progress.perfect[d.name] = true;
      save();
      const wonState = g.state;
      setTimeout(() => { if (g.won && g.state === wonState) Audio.play('win'); }, dur + 150);
      setTimeout(() => showWin(prevBest, wasPerfect, perfectNow), dur + 1100);
    }
    return true;
  }

  // ------------------------------------------------------------ dead ends
  // Has the level become unwinnable? Answered from the whole-level analysis
  // once it is ready; until then by a small search (unknown counts as alive).
  function isDead(st) {
    if (L.isWon(g.level, st)) return false;
    if (L.isHopeless(g.level, st)) return true;
    const A = analysis();
    if (A && A.complete) {
      const id = A.ids.get(S.canonKey(g.level, st));
      if (id !== undefined) return A.dist[id] < 0;
    }
    return S.solve(g.level, st, { limit: 3000 }).status === 'dead';
  }
  function checkDead() {
    g.dead = !g.won && isDead(g.state);
    setStuck();
  }
  function stuckShown() { return g.dead && (progress.deadBar !== false || L.isHopeless(g.level, g.state)); }
  function setStuck() {
    const show = stuckShown();
    $('stuck').hidden = !show;
    if (show) {
      $('stuck-text').textContent = L.isHopeless(g.level, g.state) ? 'A stone was lost. No way forward from here.' : 'No way forward from here.';
      // The first time, say what the bar means and what Rewind does.
      if (!g.teachingRewind && tipsOn() && !coachMem.seen['tip:rewind']) g.teachingRewind = true;
      $('stuck-sub').hidden = !g.teachingRewind;
      if (g.teachingRewind) $('stuck-sub').textContent = C.TIPS.rewind;
      $('stuck').classList.toggle('teach', !!g.teachingRewind);
    } else if (g.teachingRewind) {
      g.teachingRewind = false;
      coachMem.seen['tip:rewind'] = true;
      saveCoach();
      $('stuck-sub').hidden = true;
      $('stuck').classList.remove('teach');
    }
  }

  function doUndo() {
    if (g.won) { closeOverlay('win'); g.won = false; }
    if (!g.undo.length) { toast('Nothing to undo', 1200); return; }
    g.state = g.undo.pop();
    afterJump();
    Audio.play('undo');
    toast('');
  }

  // Undo back to the most recent position from which the level can still be won.
  function doRewind() {
    if (!g.dead) return;
    let n = 0;
    while (g.undo.length && isDead(g.state)) { g.state = g.undo.pop(); n++; }
    afterJump();
    Audio.play('undo');
    toast(n === 1 ? 'Rewound 1 move.' : `Rewound ${n} moves.`, 1800);
  }

  function doRestart() {
    if (g.won) { closeOverlay('win'); g.won = false; }
    if (g.state.moves === 0 && !g.undo.length) return;
    g.undo.push(g.state);
    g.state = L.cloneState(g.initial);
    g.restarts++;
    afterJump();
    Audio.play('undo');
    toast(app.classList.contains('touch') ? 'Restarted (Undo brings your moves back)' : 'Restarted (Z brings your moves back)', 1800);
    maybeHintTip();
  }

  function afterJump() {
    g.anim = null;
    g.queue = [];
    g.hint = null;
    g.idleSince = now();
    renderer.clearEffects();
    checkDead();
    updateHud();
  }

  // ------------------------------------------------------------ hints
  function doHint() {
    if (g.won || isOpen('menu')) return;
    if (g.dead) { toast('No way forward from here. Rewind first.', 2400); return; }
    const h = S.hint(g.level, analysis(), g.state);
    if (!h) { toast('No hint available yet.', 1500); return; }
    g.hinted = true;
    g.hint = { x: h.from % g.level.w, y: Math.floor(h.from / g.level.w), dir: h.dir };
    Audio.play('hint');
    const more = h.d === 0 ? 'That finishes it.' : h.d === 1 ? 'One more push after that.' : `${h.d} more pushes after that.`;
    toast(null);
    toast(`Push ${['north', 'east', 'south', 'west'][h.dir]} from the marked tile. ${more}`, 3600);
  }

  // When more input is waiting, hurry the current animation along so that
  // fast players never lose a move and the board keeps up with them.
  function hurry() {
    if (!g.anim) return;
    const remaining = g.anim.start + g.anim.dur - now();
    if (remaining > 45) g.anim.start -= remaining - 45;
  }

  function input(dir, isRepeat) {
    Audio.unlock();
    if (isOpen('menu')) return;
    if (g.won) return;
    // a key press interrupts an auto-walk
    if (g.queue.some((q) => q.group)) g.queue = g.queue.filter((q) => !q.group);
    if (animating()) {
      if (isRepeat) return; // held keys repeat at the animation's pace
      if (g.queue.length < 8) g.queue.push({ dir });
      hurry();
      return;
    }
    tryMove(dir, { repeat: !!isRepeat });
  }

  // ------------------------------------------------------------ walk-to-tile
  // Shortest walk to (tx, ty) that never pushes anything.
  function findWalk(tx, ty) {
    const lv = g.level, s0 = g.state;
    if (tx < 0 || ty < 0 || tx >= lv.w || ty >= lv.h) return null;
    if (!L.walkable(lv, s0, tx, ty)) return null;
    const dirs = S.walkPath(lv, s0, ty * lv.w + tx);
    if (!dirs) return null;
    const cells = [];
    let x = s0.px, y = s0.py;
    for (const d of dirs) { x += L.DX[d]; y += L.DY[d]; cells.push([x, y]); }
    return { dirs, cells };
  }

  // Tap/click a tile: walk there; tap a stone right next to the keeper: push it.
  function tapTile(tx, ty) {
    if (isOpen('menu') || g.won || animating()) return;
    const s0 = g.state;
    const k = L.stoneAt(s0, tx, ty);
    if (k >= 0) {
      for (let d = 0; d < 4; d++) if (s0.px + L.DX[d] === tx && s0.py + L.DY[d] === ty) { tryMove(d); return; }
      Audio.play('bump');
      return;
    }
    const w = findWalk(tx, ty);
    if (!w || !w.dirs.length) { if (w === null) Audio.play('bump'); return; }
    g.undo.push(g.state);
    g.queue = w.dirs.slice(1).map((dir) => ({ dir, group: true }));
    tryMove(w.dirs[0], { group: true });
  }

  // ------------------------------------------------------------ push previews
  function computePreviews() {
    if (g.previewFor === g.state) return g.previews;
    const list = [];
    for (let d = 0; d < 4; d++) {
      const r = L.step(g.level, g.state, d);
      if (r.blocked || !r.pushed) continue;
      list.push({ dir: d, rolls: r.events.filter((e) => e.type === 'roll') });
    }
    g.previews = list;
    g.previewFor = g.state;
    // A preview that drops a stone into open water is the moment to explain water.
    if (list.some((p) => p.rolls.some((e) => e.fate === 'sink'))) showTip('water');
    return list;
  }

  function setPreview(on, quiet) {
    g.preview = on;
    progress.preview = on;
    save();
    $('btn-preview').classList.toggle('off', !on);
    $('btn-preview').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!quiet) toast(on ? 'Push previews on' : 'Push previews off', 1200);
  }

  // ------------------------------------------------------------ overlays
  function isOpen(id) { return $(id).classList.contains('open'); }
  function openOverlay(id) { $(id).classList.add('open'); }
  function closeOverlay(id) { $(id).classList.remove('open'); }

  const SUN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>';

  function buildMenu() {
    const list = $('level-list');
    list.innerHTML = '';
    let solved = 0, perfect = 0;
    DEFS.forEach((d, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'level-card';
      const best = progress.best[d.name];
      if (best != null) { b.classList.add('done'); solved++; }
      if (isPerfect(d)) { b.classList.add('perfect'); perfect++; }
      if (i === g.levelIndex) b.classList.add('current');
      b.innerHTML = `<span class="n">${i + 1}</span><span class="nm"></span><span class="st"></span><span class="medal">${SUN_SVG}</span>`;
      b.querySelector('.nm').textContent = d.name;
      let st;
      if (best != null) st = `Best ${best} · par ${d.par}`;
      else if (i === g.levelIndex && g.state && g.state.moves) st = 'In progress';
      else st = d.tag || 'Unsolved';
      if (i === playTarget()) b.classList.add('next');
      b.querySelector('.st').textContent = st;
      b.setAttribute('aria-label', `${i + 1}. ${d.name}. ${st}${isPerfect(d) ? '. Golden sun' : ''}`);
      b.addEventListener('click', () => {
        Audio.unlock();
        if (i !== g.levelIndex || g.won) loadLevel(i);
        closeMenu();
      });
      li.appendChild(b);
      list.appendChild(li);
    });
    $('progress-line').innerHTML = solved || perfect
      ? `<b>${solved}</b> of ${DEFS.length} islands at dawn <span class="dot">·</span> <span class="gold">${SUN_SVG}<b>${perfect}</b> golden ${perfect === 1 ? 'sun' : 'suns'}</span>`
      : `${DEFS.length} islands. Match each one’s par without hints for a golden sun.`;
    const t = playTarget();
    const fresh = !progress.seenMenu && solved === 0 && !(g.state && g.state.moves);
    $('play-label').textContent = fresh ? 'Play' : t === g.levelIndex && !g.won ? 'Continue' : 'Play on';
    $('play-sub').textContent = `${t + 1} · ${DEFS[t].name}`;
    $('btn-music').textContent = Audio.musicOn() ? 'Music: on' : 'Music: off';
    $('opt-deadbar').checked = progress.deadBar !== false;
    $('opt-tips').checked = !coachMem.off;
  }

  // The island the big Play button leads to: the current one, or after a
  // solved one, the next island not yet solved.
  function playTarget() {
    if (!g.won) return g.levelIndex;
    for (let k = 1; k <= DEFS.length; k++) {
      const j = (g.levelIndex + k) % DEFS.length;
      if (!isSolved(DEFS[j])) return j;
    }
    return Math.min(g.levelIndex + 1, DEFS.length - 1);
  }
  function playFromMenu() {
    const t = playTarget();
    if (t !== g.levelIndex || g.won) loadLevel(t);
    closeMenu();
  }

  function openMenu() {
    buildMenu();
    closeOverlay('win');
    openOverlay('menu');
    $('menu').scrollTop = 0;
    if (!isTouch()) $('btn-play').focus({ preventScroll: true });
  }
  function closeMenu() {
    closeOverlay('menu');
    if (!progress.seenMenu) Audio.play('intro');
    progress.seenMenu = true;
    save();
    g.intro = now();
  }

  function showWin(prevBest, wasPerfect, perfectNow) {
    if (!g.won) return;
    const d = DEFS[g.levelIndex];
    $('win-name').textContent = d.name;
    const p = g.state.pushes;
    let stats = `<b>${p}</b> ${p === 1 ? 'push' : 'pushes'} <span class="dot">·</span> par ${d.par}`;
    if (prevBest != null && p < prevBest) stats += ` <span class="dot">·</span> new best`;
    else if (prevBest != null) stats += ` <span class="dot">·</span> best ${prevBest}`;
    $('win-stats').innerHTML = stats;
    const medal = $('win-medal');
    medal.classList.toggle('gold', perfectNow);
    let note;
    if (perfectNow && !wasPerfect) note = 'Golden sun: you matched the fewest possible pushes.';
    else if (perfectNow) note = 'Golden sun again.';
    else if (g.hinted && p <= d.par) note = 'Within par, but with a hint. Solve it unaided for a golden sun.';
    else note = `Solve it in ${d.par} ${d.par === 1 ? 'push' : 'pushes'} without hints for a golden sun.`;
    const allDone = DEFS.every(isSolved);
    if (g.levelIndex === DEFS.length - 1 && allDone) note += ' Every island has seen the dawn. Thank you for playing!';
    $('win-note').textContent = note;
    $('win-note').classList.toggle('gold', perfectNow);
    $('btn-next').textContent = g.levelIndex === DEFS.length - 1 ? 'All islands' : 'Next island';
    $('btn-replay').textContent = perfectNow ? 'Replay' : 'Try again';
    openOverlay('win');
    $('btn-next').focus({ preventScroll: true });
  }

  function nextLevel() {
    if (g.levelIndex === DEFS.length - 1) { openMenu(); return; }
    loadLevel(g.levelIndex + 1);
  }

  // ------------------------------------------------------------ keyboard
  const KEYMAP = {
    ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3,
  };
  window.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) {
      if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyZ') { ev.preventDefault(); doUndo(); }
      return;
    }
    const code = ev.code;
    if (isOpen('menu')) {
      if (code === 'Escape' && g.level) { ev.preventDefault(); closeMenu(); }
      // Enter starts from the title unless another control has focus.
      const a = document.activeElement;
      if (code === 'Enter' && (!a || a === document.body || a === $('btn-play'))) { ev.preventDefault(); Audio.unlock(); playFromMenu(); }
      return;
    }
    if (isOpen('win')) {
      if (code === 'Enter' || code === 'KeyN' || code === 'Space') { ev.preventDefault(); nextLevel(); return; }
      if (code === 'Escape') { ev.preventDefault(); closeOverlay('win'); return; }
    }
    if (code in KEYMAP) { ev.preventDefault(); input(KEYMAP[code], ev.repeat); return; }
    switch (code) {
      case 'KeyZ':
        ev.preventDefault();
        if (ev.shiftKey && g.dead) doRewind(); else doUndo();
        break;
      case 'Backspace': case 'KeyU': ev.preventDefault(); doUndo(); break;
      case 'KeyR': ev.preventDefault(); if (!ev.repeat) doRestart(); break;
      case 'KeyH': ev.preventDefault(); if (!ev.repeat) doHint(); break;
      case 'Escape': case 'KeyL': ev.preventDefault(); openMenu(); break;
      case 'KeyM': toggleSound(); break;
      case 'KeyP': setPreview(!g.preview); break;
      case 'BracketRight': case 'PageDown': loadLevel(g.levelIndex + 1); break;
      case 'BracketLeft': case 'PageUp': loadLevel(g.levelIndex - 1); break;
      case 'KeyN': case 'Enter': if (g.won) { ev.preventDefault(); nextLevel(); } break;
      default: break;
    }
  });

  // ------------------------------------------------------------ touch / pointer
  function markTouch() {
    if (!app.classList.contains('touch')) { app.classList.add('touch'); renderCoach(); requestAnimationFrame(resize); }
  }
  const forceTouch = params.get('touch');
  if (forceTouch === '1' || (forceTouch !== '0' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) app.classList.add('touch');
  if (forceTouch !== '0') window.addEventListener('touchstart', markTouch, { passive: true });

  document.querySelectorAll('.pad-btn[data-dir]').forEach((b) => {
    b.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      b.classList.add('pressed');
      input(parseInt(b.dataset.dir, 10));
    });
    const up = () => b.classList.remove('pressed');
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  });
  $('pad-undo').addEventListener('click', () => { Audio.unlock(); doUndo(); });
  $('pad-restart').addEventListener('click', () => { Audio.unlock(); doRestart(); });
  $('pad-hint').addEventListener('click', () => { Audio.unlock(); doHint(); });

  // Board: swipe to move, tap/click a tile to walk there (or push a stone next to you).
  let swipe = null;
  function tileAtEvent(ev) {
    const r = canvas.getBoundingClientRect();
    return renderer.screenToTile(ev.clientX - r.left, ev.clientY - r.top);
  }
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0) return;
    swipe = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, done: false };
  });
  stage.addEventListener('pointermove', (ev) => {
    if (swipe && swipe.id === ev.pointerId && !swipe.done) {
      const dx = ev.clientX - swipe.x, dy = ev.clientY - swipe.y;
      const th = 26;
      if (Math.abs(dx) >= th || Math.abs(dy) >= th) {
        swipe.done = true;
        if (Math.abs(dx) > Math.abs(dy)) input(dx > 0 ? 1 : 3);
        else input(dy > 0 ? 2 : 0);
      }
      return;
    }
    if (ev.pointerType === 'mouse' && g.level && !isOpen('menu')) {
      const [tx, ty] = tileAtEvent(ev);
      if (g.hover && g.hover.x === tx && g.hover.y === ty && g.hover.state === g.state) return;
      const w = animating() || g.won ? null : findWalk(tx, ty);
      g.hover = { x: tx, y: ty, state: g.state, cells: w ? w.cells : null, ok: !!(w && w.dirs.length) };
    }
  });
  stage.addEventListener('pointerleave', () => { g.hover = null; });
  stage.addEventListener('pointerup', (ev) => {
    if (swipe && swipe.id === ev.pointerId && !swipe.done) {
      const moved = Math.hypot(ev.clientX - swipe.x, ev.clientY - swipe.y);
      if (moved < 12) {
        Audio.unlock();
        const [tx, ty] = tileAtEvent(ev);
        tapTile(tx, ty);
      }
    }
    swipe = null;
  });
  stage.addEventListener('pointercancel', () => { swipe = null; });

  // ------------------------------------------------------------ buttons
  $('btn-undo').addEventListener('click', () => { Audio.unlock(); doUndo(); });
  $('btn-restart').addEventListener('click', () => { Audio.unlock(); doRestart(); });
  $('btn-hint').addEventListener('click', () => { Audio.unlock(); doHint(); });
  $('btn-rewind').addEventListener('click', () => { Audio.unlock(); doRewind(); });
  $('btn-menu').addEventListener('click', () => { Audio.unlock(); openMenu(); });
  $('btn-next').addEventListener('click', () => { Audio.unlock(); nextLevel(); });
  $('btn-win-stay').addEventListener('click', () => closeOverlay('win'));
  $('btn-replay').addEventListener('click', () => { Audio.unlock(); doRestart(); });
  $('coach-x').addEventListener('click', () => { hideCoach(); });
  $('btn-sound').addEventListener('click', () => { Audio.unlock(); toggleSound(); });
  $('btn-preview').addEventListener('click', () => setPreview(!g.preview));
  $('btn-music').addEventListener('click', () => {
    Audio.unlock();
    Audio.setMusic(!Audio.musicOn());
    $('btn-music').textContent = Audio.musicOn() ? 'Music: on' : 'Music: off';
  });
  $('opt-deadbar').addEventListener('change', () => {
    progress.deadBar = $('opt-deadbar').checked;
    save();
    setStuck();
  });
  $('opt-tips').addEventListener('change', () => {
    coachMem.off = !$('opt-tips').checked;
    saveCoach();
    if (coachMem.off && g.coach) { g.coach = null; g.coachRow = !isSolved(DEFS[g.levelIndex]) && DEFS[g.levelIndex].hint ? 'riddle' : null; renderCoach(); }
    else if (!coachMem.off && !g.won && !(g.state && g.state.pushes)) setupCoach();
  });
  $('btn-tips-reset').addEventListener('click', () => {
    coachMem.seen = {};
    coachMem.off = false;
    saveCoach();
    $('opt-tips').checked = true;
    if (!g.won) setupCoach();
    toast('Tips will show again', 1600);
  });
  $('menu').addEventListener('click', (ev) => { if (ev.target === $('menu') && progress.seenMenu) closeMenu(); });
  $('btn-play').addEventListener('click', () => { Audio.unlock(); playFromMenu(); });

  // Pointer clicks should not leave focus on a HUD button (Space/Enter would re-trigger it).
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('.icon-btn, .pad-btn, .stuck button');
    if (b && ev.detail > 0) b.blur();
  });

  function toggleSound() {
    Audio.setMuted(!Audio.isMuted());
    $('btn-sound').classList.toggle('muted', Audio.isMuted());
    toast(Audio.isMuted() ? 'Sound off' : 'Sound on', 1000);
  }
  $('btn-sound').classList.toggle('muted', Audio.isMuted());
  setPreview(g.preview, true);

  // ------------------------------------------------------------ layout + loop
  function fitCanvas() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(50, r.width), h = Math.max(50, r.height);
    if (w !== renderer.W || h !== renderer.H || dpr !== renderer.dpr) renderer.resize(w, h, dpr);
  }
  function resize() {
    fitCanvas();
    if (g.level) {
      const want = bestRotation(g.levelIndex, g.rot);
      if (want !== g.rot) switchRotation(want);
    }
  }

  // Carry the current game (state + undo history) over to the other orientation.
  function switchRotation(want) {
    const turns = want === 1 ? 1 : 3;
    const conv = (st) => {
      let s = st, w = g.level.w, h = g.level.h;
      for (let k = 0; k < turns; k++) { s = L.rotateState(s, w, h); const t = w; w = h; h = t; }
      return s;
    };
    g.anim = null;
    g.queue = [];
    g.hover = null;
    g.hint = null;
    g.state = conv(g.state);
    g.undo = g.undo.map(conv);
    g.rot = want;
    g.level = variant(g.levelIndex, want).level;
    g.initial = variant(g.levelIndex, want).state;
    startAnalysis();
    renderer.curLevel = g.level;
    renderer.clearEffects();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);

  function frame() {
    const t = now();
    // Spread the whole-level analysis over a few frames.
    const A = analysis();
    if (A && !A.done) {
      A.run(6);
      if (A.done) checkDead();
    }
    if (g.anim && t - g.anim.start >= g.anim.dur) {
      g.anim = null;
      g.idleSince = t;
      if (g.queue.length) {
        const q = g.queue.shift();
        tryMove(q.dir, { group: q.group });
        if (g.queue.length && !q.group) hurry();
      }
    }
    if (g.won && t > g.wonAt) g.dawn = Math.min(1, g.dawn + 0.012);
    else if (!g.won && g.dawn > 0) g.dawn = Math.max(0, g.dawn - 0.05);
    // previews only while idle (and not mid auto-walk)
    g.showPreviews = g.preview && !g.anim && !g.won && !g.queue.length && t - g.idleSince > 90 ? computePreviews() : null;
    g.coachTiles = computeCoachTiles();
    if (!g.won && t - (g.hintCheckAt || 0) > 1000) { g.hintCheckAt = t; maybeHintTip(); }
    renderer.draw(g, t);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ boot
  let startAt = Math.min(progress.current || 0, DEFS.length - 1);
  if (params.has('level')) startAt = Math.max(0, Math.min(DEFS.length - 1, parseInt(params.get('level'), 10) - 1 || 0));
  resize();
  loadLevel(startAt, { quiet: true });
  // ?play=NESW... replays key presses instantly (used by the automated checks).
  if (params.has('play')) {
    for (const c of params.get('play').toUpperCase()) {
      const d = 'NESW'.indexOf(c);
      if (d < 0 || g.won) continue;
      tryMove(d);
      g.anim = null;
    }
  }
  // debug/testing hook (used by the automated checks; harmless for players)
  window.menhir = {
    g, input, undo: doUndo, rewind: doRewind, restart: doRestart, hint: doHint, load: loadLevel, tap: tapTile, findWalk,
    tileToScreen: (x, y) => renderer.tileToScreen(x, y),
    analysisDone: () => { const A = analysis(); return !!(A && A.done); },
    coach: () => ({ row: g.coachRow, lesson: g.coach ? g.coach.lesson.id : null, step: g.coach ? g.coach.step : null,
      text: $('coach').hidden ? '' : $('coach-text').textContent, tiles: g.coachTiles ? g.coachTiles.length : 0, seen: Object.assign({}, coachMem.seen) }),
  };
  if (!progress.seenMenu && !params.has('level')) openMenu();
  requestAnimationFrame(frame);
})();
