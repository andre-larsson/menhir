#!/usr/bin/env node
/*
 * Puzzle proxies for Menhir levels (development tool).
 *
 *   node tools/fun.js [--file levels.js] [--runs 200] [--json] [level numbers]
 *
 * Proxies (see GAME_NOTES.md for why each one stands in for "fun"):
 *   greedy%   share of runs a "follow-your-nose" bot solves the level. It always
 *             makes the push that brings the stones closest to standing on the
 *             sockets (single-stone push distance, best assignment of stones to
 *             sockets), never repeats a position, and breaks ties at random.
 *             High = the level can be solved without an idea.
 *   rand%     share of random push sequences (up to 80 pushes) that solve it:
 *             a rough difficulty ordering.
 *   detours   pushes on the push-optimal solution that move the stones further
 *             from the goal by that same measure (the "aha" moves).
 *   dead%     share of reachable positions from which the level can't be won.
 *   silent    average pushes a human-ish player (greedy with 25% random pushes)
 *             makes after the level became unwinnable, before the game says so:
 *             "lost" = told only when too few stones are left (no assist),
 *             "bar"  = with the "no way forward" bar.
 *   walk/push walking steps per push on the move-optimal solution (busywork).
 */
'use strict';
const path = require('path');
const L = require(path.join(__dirname, '..', 'js', 'logic.js'));
const V = require(path.join(__dirname, '..', 'js', 'solver.js'));
const A = require('./solve.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------ single-stone distances
const MS = { p: ['U', 'E', 'S'], m: ['U', 'D', 'E', 'W', 'N', 'S'] };
function poseKey(s) { return (s.k === 'p' ? L.orient(s.m) : s.m) + s.x + ',' + s.y; }

function buildTables(level, start) {
  const kinds = {};
  for (const s of start.stones) kinds[s.k] = true;
  const tables = {};
  const empty = { stones: [], filled: [] };
  for (const k of Object.keys(kinds)) {
    const index = new Map(), list = [];
    for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) for (const m of MS[k]) {
      const s = { x, y, m, k, rot: L.rotForMark(m), sunk: false };
      const ok = L.stoneCells(s).every(([cx, cy]) => { const t = L.tileAt(level, empty, cx, cy); return t === L.GROUND || t === L.SOCKET || t === L.FROST; });
      if (!ok) continue;
      index.set(poseKey(s), list.length);
      list.push(s);
    }
    const rev = list.map(() => []);
    list.forEach((s, i) => {
      const cells = L.stoneCells(s);
      const seen = new Set();
      for (const [cx, cy] of cells) for (let d = 0; d < 4; d++) {
        const fx = cx - L.DX[d], fy = cy - L.DY[d];
        if (cells.some(([a, b]) => a === fx && b === fy)) continue;
        if (!L.keeperCan(level, empty, fx, fy)) continue;
        const r = L.step(level, { px: fx, py: fy, pf: d, stones: [s], filled: [], moves: 0, pushes: 0 }, d);
        if (r.blocked || r.state.stones[0].sunk) continue;
        const j = index.get(poseKey(r.state.stones[0]));
        if (j === undefined || seen.has(j)) continue;
        seen.add(j);
        rev[j].push(i);
      }
    });
    tables[k] = {
      index,
      dist: level.sockets.map((si) => {
        const gx = si % level.w, gy = (si / level.w) | 0;
        const dist = new Int32Array(list.length).fill(-1);
        const q = [];
        list.forEach((s, i) => { if (s.x === gx && s.y === gy && L.isStanding(s.m) && (k === 'p' || s.m === 'U')) { dist[i] = 0; q.push(i); } });
        for (let h = 0; h < q.length; h++) for (const j of rev[q[h]]) if (dist[j] < 0) { dist[j] = dist[q[h]] + 1; q.push(j); }
        return dist;
      }),
    };
  }
  return tables;
}

const BIG = 40;
function heuristic(level, tables, st) {
  if (L.isWon(level, st)) return -1;
  const alive = st.stones.filter((s) => !s.sunk);
  const K = level.sockets.length;
  if (alive.length < K) return 999;
  const cost = alive.map((s) => {
    const t = tables[s.k];
    const pi = t.index.get(poseKey(s));
    return level.sockets.map((_, k) => { const d = pi === undefined ? -1 : t.dist[k][pi]; return d < 0 ? BIG : d; });
  });
  let best = Infinity;
  (function assign(k, used, sum) {
    if (sum >= best) return;
    if (k === K) { best = sum; return; }
    for (let i = 0; i < alive.length; i++) {
      if (used & (1 << i)) continue;
      assign(k + 1, used | (1 << i), sum + cost[i][k]);
    }
  })(0, 0, 0);
  return best;
}

// ------------------------------------------------------------ bots
function bot(level, tables, start, rng, eps, maxPushes, onPush) {
  let st = start;
  const visited = new Set([V.canonKey(level, st)]);
  for (let k = 0; k < maxPushes; k++) {
    const ps = V.pushes(level, st);
    if (!ps.length) return false;
    let cand = ps.map((p) => ({ p, key: V.canonKey(level, p.next), h: eps >= 1 ? 0 : heuristic(level, tables, p.next) }));
    const fresh = cand.filter((c) => !visited.has(c.key));
    if (fresh.length) cand = fresh;
    let pick;
    if (rng() < eps) pick = cand[Math.floor(rng() * cand.length)];
    else {
      const m = Math.min.apply(null, cand.map((c) => c.h));
      const bests = cand.filter((c) => c.h === m);
      pick = bests[Math.floor(rng() * bests.length)];
    }
    st = pick.p.next;
    visited.add(pick.key);
    if (onPush) onPush(st);
    if (L.isWon(level, st)) return true;
    if (L.isHopeless(level, st)) return false;
  }
  return false;
}

function analyseFun(def, idx, runs, opts) {
  opts = opts || {};
  const { level, state } = L.parseLevel(def);
  const base = A.analyse(def, { quick: !!opts.quick });
  if (base.status !== 'win') return Object.assign({ level: idx + 1 }, base);
  const tables = buildTables(level, state);
  const G = A.fullGraph(level, state);
  const isDead = (st) => V.distance(level, G, st) === -1;

  let g = 0;
  let rng = mulberry32(1000 + idx);
  for (let r = 0; r < runs; r++) if (bot(level, tables, state, rng, 0, 60)) g++;
  let rnd = 0;
  rng = mulberry32(3000 + idx);
  const rruns = opts.quick ? 0 : runs * 2;
  for (let r = 0; r < rruns; r++) if (bot(level, tables, state, rng, 1, 80)) rnd++;

  // silent dead ends
  rng = mulberry32(5000 + idx);
  let silentLost = 0, silentBar = 0, deadRuns = 0;
  const playouts = opts.quick ? 0 : runs;
  for (let r = 0; r < playouts; r++) {
    let count = 0, deadAt = -1, lostAt = -1, barAt = -1;
    bot(level, tables, state, rng, 0.25, 60, (st) => {
      count++;
      const dead = isDead(st);
      if (deadAt < 0 && dead) deadAt = count;
      if (deadAt >= 0 && lostAt < 0 && L.isHopeless(level, st)) lostAt = count;
      if (barAt < 0 && (dead || L.isHopeless(level, st))) barAt = count; // what the page shows
    });
    if (deadAt >= 0) {
      deadRuns++;
      silentLost += (lostAt >= 0 ? lostAt : count) - deadAt;
      silentBar += (barAt >= 0 ? barAt : count) - deadAt;
    }
  }

  // detours along the push-optimal path
  const sol = V.solve(level, state);
  let detours = 0, st = state, h0 = heuristic(level, tables, st);
  for (const p of sol.path) {
    const r = L.step(level, { px: p.from % level.w, py: (p.from / level.w) | 0, pf: p.dir, stones: st.stones, filled: st.filled, moves: 0, pushes: 0 }, p.dir);
    st = r.state;
    const h1 = heuristic(level, tables, st);
    if (h1 > h0) detours++;
    h0 = h1;
  }
  const r1 = (x) => Math.round(10 * x) / 10;
  return Object.assign(base, {
    level: idx + 1,
    greedy: r1(100 * g / runs), rand: rruns ? r1(100 * rnd / rruns) : null, detours,
    silentLost: deadRuns ? r1(silentLost / deadRuns) : 0, silentBar: deadRuns ? r1(silentBar / deadRuns) : 0, deadRuns,
  });
}

module.exports = { buildTables, heuristic, bot, analyseFun, mulberry32 };

if (require.main === module) {
  const args = process.argv.slice(2);
  let file = path.join(__dirname, '..', 'js', 'levels.js');
  let runs = 200, json = false;
  const only = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') file = path.resolve(args[++i]);
    else if (args[i] === '--runs') runs = +args[++i];
    else if (args[i] === '--json') json = true;
    else only.push(+args[i]);
  }
  const defs = require(file);
  const rows = [];
  defs.forEach((d, i) => {
    if (only.length && !only.includes(i + 1)) return;
    const r = analyseFun(d, i, runs);
    rows.push(r);
    if (json) console.log(JSON.stringify(r));
  });
  if (!json) {
    const cols = ['level', 'name', 'floor', 'stones', 'pushes', 'moves', 'walk', 'states', 'dead', 'greedy', 'rand', 'detours', 'silentLost', 'silentBar', 'uses', 'needs'];
    const head = ['#', 'name', 'floor', 'stones', 'pushes', 'moves', 'walk/push', 'states', 'dead%', 'greedy%', 'rand%', 'detours', 'silent(lost)', 'silent(bar)', 'uses', 'needs'];
    const fmt = (r, c) => {
      const v = r[c];
      if (v === null || v === undefined) return '-';
      if (c === 'needs') return Object.keys(v).map((k) => k + ':' + (v[k].startsWith('SAME') ? 'NO' : v[k].startsWith('needed') ? 'needed' : v[k].split(':')[0])).join(' ') || '-';
      if (c === 'stones') return r.marked ? `${v} (${r.marked}m)` : String(v);
      return String(v);
    };
    const table = [head].concat(rows.map((r) => cols.map((c) => fmt(r, c))));
    const w = head.map((_, c) => Math.max.apply(null, table.map((t) => t[c].length)));
    table.forEach((t) => console.log(t.map((v, c) => (c === 1 || c >= 14 ? v.padEnd(w[c]) : v.padStart(w[c]))).join('  ')));
    const mean = (k) => { const v = rows.map((r) => r[k]).filter((x) => typeof x === 'number'); return Math.round(10 * v.reduce((s, x) => s + x, 0) / v.length) / 10; };
    console.log(`mean walk/push ${mean('walk')}, mean silent (lost only) ${mean('silentLost')}, with bar ${mean('silentBar')}, max moves ${Math.max.apply(null, rows.map((r) => r.moves || 0))}, runs ${runs}`);
  }
}
