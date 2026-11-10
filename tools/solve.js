#!/usr/bin/env node
/*
 * Level analyser for Menhir (development tool, not needed to play).
 *
 *   node tools/solve.js               analyse every level in js/levels.js
 *   node tools/solve.js 3 5           only levels 3 and 5 (1-based)
 *   node tools/solve.js --check       also fail if a level's `par` is not its optimum,
 *                                     or if a level doesn't need what it teaches
 *   node tools/solve.js --show 4      print the move-optimal solution for level 4 (N/E/S/W keys)
 *   node tools/solve.js --file f.js   levels from another file (same format)
 *   node tools/solve.js --json        one JSON record per level
 *
 * Per level (all deterministic):
 *   pushes  fewest pushes that solve it (this is the par)
 *   moves   fewest key presses (walking + pushing) that solve it
 *   states  reachable positions (stone layout + the region the keeper can reach)
 *   dead%   share of those from which the level can no longer be won
 *   fatal   pushes available at the start, and how many are already fatal
 *   needs   necessity checks for what the level teaches (`teaches` in levels.js), by
 *           solving it again without the mechanic:
 *           domino: a stone in the way blocks instead of being knocked on
 *           frost:  frost becomes plain ground
 *           bog:    bog becomes a boulder (so no stone can be sunk to cross it)
 *           mark:   marked stones become plain stones
 *           "needed" = unsolvable without it; "shortcut"/"obstacle" = the optimum
 *           changes; "SAME" = it changes nothing, which fails --check.
 */
'use strict';
const path = require('path');
const L = require(path.join(__dirname, '..', 'js', 'logic.js'));
const V = require(path.join(__dirname, '..', 'js', 'solver.js'));

// Move-optimal solution: Dijkstra over exact post-push positions, where a push
// costs the walk to its tile plus one.
function moveOptimal(level, start, limit) {
  limit = limit || 400000;
  const heap = [];
  const push = (n) => { heap.push(n); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].c <= n.c) break; heap[i] = heap[p]; i = p; } heap[i] = n; };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      for (;;) {
        let l = 2 * i + 1, r = l + 1, m = i;
        if (l < heap.length && heap[l].c < (m === i ? last.c : heap[m].c)) m = l;
        if (r < heap.length && heap[r].c < (m === i ? last.c : heap[m].c)) m = r;
        if (m === i) break;
        heap[i] = heap[m]; i = m;
      }
      heap[i] = last;
    }
    return top;
  };
  const best = new Map();
  const startKey = L.stateKey(start);
  best.set(startKey, 0);
  push({ c: 0, st: start, key: startKey, prev: null, via: null });
  const done = new Set();
  while (heap.length) {
    const n = pop();
    if (done.has(n.key)) continue;
    done.add(n.key);
    if (done.size > limit) return null;
    if (L.isWon(level, n.st)) {
      const seq = [];
      for (let k = n; k.prev; k = k.prev) seq.unshift(k.via);
      let pushesN = 0;
      const moves = [];
      let st = start;
      for (const v of seq) {
        const w = V.walkPath(level, st, v.from);
        for (const d of w) { st = L.step(level, st, d).state; moves.push(d); }
        st = L.step(level, st, v.dir).state; moves.push(v.dir); pushesN++;
      }
      return { cost: n.c, moves, pushes: pushesN };
    }
    if (L.isHopeless(level, n.st)) continue;
    const reg = V.region(level, n.st);
    for (const p of V.pushes(level, n.st, reg)) {
      const c = n.c + p.dist + 1;
      const k = L.stateKey(p.next);
      if (best.has(k) && best.get(k) <= c) continue;
      best.set(k, c);
      push({ c, st: p.next, key: k, prev: n, via: { from: p.from, dir: p.dir } });
    }
  }
  return null;
}

// Full push graph from the start: which positions are dead.
function fullGraph(level, start, limit) {
  const A = new V.Analysis(level, start, limit || 400000);
  A.run();
  return A;
}

function withTerrain(def, from, to) {
  return Object.assign({}, def, { map: def.map.map((r) => r.split(from).join(to)) });
}
function plainOnly(def) {
  // every marked stone becomes a plain stone in the same place
  const conv = { U: 'P', D: 'P' };
  const objs = (def.objs || []).map((r) => r.split(''));
  for (let y = 0; y < objs.length; y++) for (let x = 0; x < objs[y].length; x++) {
    const c = objs[y][x];
    if (conv[c]) objs[y][x] = conv[c];
    const di = 'NESW'.indexOf(c);
    if (di >= 0) {
      const ox = x - L.DX[di], oy = y - L.DY[di];
      if (di % 2 === 1) { const a = Math.min(x, ox); objs[y][a] = '['; objs[y][a + 1] = ']'; }
      else { const a = Math.min(y, oy); objs[a][x] = 'n'; objs[a + 1][x] = 'u'; }
    }
  }
  return Object.assign({}, def, { objs: objs.map((r) => r.join('')) });
}

// Counts what a solution uses: T topple, R rise, L roll sideways, K knock-ons,
// F frost tips, B bog sinks, W water sinks.
function mechanics(level, start, moves) {
  const u = { T: 0, R: 0, L: 0, K: 0, F: 0, B: 0, W: 0 };
  let st = start;
  for (const d of moves) {
    const r = L.step(level, st, d);
    for (const e of r.events) {
      if (e.type !== 'roll') continue;
      if (L.isStanding(e.from.m)) u.T++;
      else if (L.isStanding(e.to.m)) u.R++;
      else u.L++;
      if (e.depth > 0) u.K++;
      if (e.wave > 0) u.F++;
      if (e.fate === 'bog') u.B++;
      if (e.fate === 'sink') u.W++;
    }
    st = r.state;
  }
  return Object.keys(u).filter((k) => u[k]).map((k) => k + u[k]).join(' ');
}

function analyse(def, opts) {
  opts = opts || {};
  const { level, state } = L.parseLevel(def);
  const t0 = Date.now();
  const sol = V.solve(level, state, { limit: opts.limit || 600000 });
  const out = { name: def.name, par: def.par, pushes: sol.status === 'win' ? sol.path.length : null, status: sol.status };
  let floor = 0;
  for (const t of level.tiles) if (t !== L.OUTSIDE && t !== L.WATER && t !== L.ROCK) floor++;
  out.floor = floor;
  out.stones = state.stones.length;
  out.marked = state.stones.filter((s) => s.k === 'm').length;
  if (sol.status !== 'win') return out;
  const G = fullGraph(level, state, opts.limit);
  out.states = G.size();
  out.complete = G.complete;
  if (G.complete) {
    out.dead = Math.round(1000 * G.deadShare()) / 10;
    const startPushes = V.pushes(level, state);
    out.start = startPushes.length;
    out.startFatal = startPushes.filter((p) => V.distance(level, G, p.next) === -1).length;
  }
  if (!opts.quick) {
    const mo = moveOptimal(level, state);
    if (mo) {
      out.moves = mo.moves.length;
      out.movePushes = mo.pushes;
      out.solution = mo.moves.map((d) => L.DIR_CHAR[d]).join('');
      out.walk = Math.round(10 * (mo.moves.length - mo.pushes) / mo.pushes) / 10;
      out.uses = mechanics(level, state, mo.moves);
    }
    // necessity checks: what happens to the optimum without the mechanic?
    //   needed       the island can't be solved without it
    //   shortcut: N  without it the optimum is N (> par): it saves pushes
    //   obstacle: N  without it the optimum is N (< par): it is what makes the island hard
    //   SAME N       it changes nothing (fails --check)
    const teaches = def.teaches || [];
    out.needs = {};
    const verdict = (r) => r.status !== 'win' ? (r.status === 'dead' ? 'needed' : r.status)
      : r.path.length === out.pushes ? 'SAME ' + r.path.length
      : (r.path.length > out.pushes ? 'shortcut: ' : 'obstacle: ') + r.path.length + ' without';
    if (teaches.includes('domino')) out.needs.domino = verdict(V.solve(level, state, { noChain: true, limit: 600000 }));
    if (teaches.includes('frost')) {
      const p = L.parseLevel(withTerrain(def, '*', '.'));
      out.needs.frost = verdict(V.solve(p.level, p.state, { limit: 600000 }));
    }
    if (teaches.includes('bog')) {
      const p = L.parseLevel(withTerrain(def, '%', '#'));
      out.needs.bog = verdict(V.solve(p.level, p.state, { limit: 600000 }));
    }
    if (teaches.includes('mark')) {
      const p = L.parseLevel(plainOnly(def));
      const r = V.solve(p.level, p.state, { limit: 600000 });
      out.needs.mark = r.status !== 'win' ? r.status : r.path.length < out.pushes ? 'matters: ' + r.path.length + ' if plain' : 'SAME ' + r.path.length;
    }
  }
  out.ms = Date.now() - t0;
  return out;
}

function needsOk(r) {
  for (const k of Object.keys(r.needs || {})) {
    const v = r.needs[k];
    if (v.startsWith('SAME')) return false;
  }
  return true;
}

module.exports = { analyse, moveOptimal, fullGraph, mechanics, withTerrain, plainOnly, needsOk };

if (require.main === module) {
  const args = process.argv.slice(2);
  let file = path.join(__dirname, '..', 'js', 'levels.js');
  let check = false, show = false, json = false;
  const only = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') file = path.resolve(args[++i]);
    else if (args[i] === '--check') check = true;
    else if (args[i] === '--show') show = true;
    else if (args[i] === '--json') json = true;
    else only.push(parseInt(args[i], 10));
  }
  const defs = require(file);
  let ok = true;
  defs.forEach((def, i) => {
    if (only.length && !only.includes(i + 1)) return;
    const r = analyse(def);
    r.level = i + 1;
    if (json) { console.log(JSON.stringify(r)); }
    else if (r.status !== 'win') {
      console.log(`${String(i + 1).padStart(2)}. ${def.name.padEnd(16)} ${r.status.toUpperCase()}`);
    } else {
      const needs = Object.keys(r.needs || {}).map((k) => `${k}: ${r.needs[k]}`).join(', ');
      console.log(`${String(i + 1).padStart(2)}. ${def.name.padEnd(16)} pushes ${String(r.pushes).padStart(2)}  moves ${String(r.moves).padStart(3)}  walk/push ${String(r.walk).padStart(4)}  states ${String(r.states).padStart(6)}  dead ${String(r.dead).padStart(5)}%  fatal ${r.startFatal}/${r.start}  floor ${r.floor}  uses ${r.uses}${needs ? '  needs [' + needs + ']' : ''}  (${r.ms} ms)`);
      if (show) console.log('    ' + r.solution);
    }
    if (r.status !== 'win') ok = false;
    if (check && r.status === 'win') {
      if (def.par !== r.pushes) { ok = false; console.log(`    PAR MISMATCH: level says ${def.par}, solver finds ${r.pushes}`); }
      if (!needsOk(r)) { ok = false; console.log('    NECESSITY FAILED: the level can be solved without what it teaches'); }
    }
  });
  process.exit(ok ? 0 : 1);
}
