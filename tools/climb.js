#!/usr/bin/env node
/*
 * Hill-climbing level search (development tool).
 *
 *   node tools/climb.js --seed seeds/x.json [--iters 3000] [--rng 1] [--out out.json]
 *
 * The seed file is a level def (map + objs) plus search settings:
 *   teaches:   necessity checks that must pass (domino, frost, mark)
 *   pushes:    [min, max] pushes for the solution
 *   maxStates: cap on reachable positions (keeps the in-page dead-end check fast)
 *   mutate:    which edits are allowed: "stones" (move/turn stones), "sockets",
 *              "keeper", "frost", "rock", "bog", "water", "shape" (grow/shrink the island)
 *   lock:      list of "x,y" cells whose terrain must not change
 * Every candidate must stay solvable; the score rewards a greedy bot failing,
 * detours on the optimal path, dead ends, and solution length, and penalizes
 * walking and island size. Prints the best layout found.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require(path.join(__dirname, '..', 'js', 'logic.js'));
const V = require(path.join(__dirname, '..', 'js', 'solver.js'));
const F = require('./fun.js');
const A = require('./solve.js');

const args = process.argv.slice(2);
const opt = { iters: 2000, rng: 1, out: null, seed: null, quiet: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--seed') opt.seed = args[++i];
  else if (a === '--iters') opt.iters = +args[++i];
  else if (a === '--rng') opt.rng = +args[++i];
  else if (a === '--out') opt.out = args[++i];
  else if (a === '--quiet') opt.quiet = true;
}
const seed = JSON.parse(fs.readFileSync(opt.seed, 'utf8'));
const rng = F.mulberry32(opt.rng * 7919 + 13);
const ri = (n) => Math.floor(rng() * n);

function toGrid(def) {
  const H = def.map.length, W = Math.max.apply(null, def.map.map((r) => r.length));
  const map = [], obj = [];
  for (let y = 0; y < H; y++) {
    map.push([]); obj.push([]);
    for (let x = 0; x < W; x++) { map[y].push(def.map[y][x] || ' '); obj[y].push((def.objs && def.objs[y] && def.objs[y][x]) || ' '); }
  }
  return { W, H, map, obj };
}
function fromGrid(g, base) {
  return Object.assign({}, base, { map: g.map.map((r) => r.join('')), objs: g.obj.map((r) => r.join('')) });
}
function clone(g) { return { W: g.W, H: g.H, map: g.map.map((r) => r.slice()), obj: g.obj.map((r) => r.slice()) }; }

const STONE_CH = new Set(['P', 'U', 'D', '[', ']', 'n', 'u', '=', '|', 'N', 'E', 'S', 'W']);
const FLOOR = new Set(['.', 'o', '*']);
function freeCell(g, x, y, extraOk) {
  if (x < 1 || y < 1 || x >= g.W - 1 || y >= g.H - 1) return false;
  const t = g.map[y][x];
  return (FLOOR.has(t) || (extraOk && extraOk.has(t))) && g.obj[y][x] === ' ';
}
// Remove the stone covering (x, y) from the overlay; returns its kind ('p'|'m').
function liftStone(g, x, y) {
  const c = g.obj[y][x];
  let cells = [[x, y]], kind = 'p';
  if (c === 'P') kind = 'p';
  else if (c === 'U' || c === 'D') kind = 'm';
  else if (c === '[') cells.push([x + 1, y]);
  else if (c === ']') cells.push([x - 1, y]);
  else if (c === 'n') cells.push([x, y + 1]);
  else if (c === 'u') cells.push([x, y - 1]);
  else {
    kind = 'm';
    // marked lying: find the partner
    const di = 'NESW'.indexOf(c);
    if (di >= 0) cells.push([x - L.DX[di], y - L.DY[di]]);
    else for (let d = 0; d < 4; d++) {
      const nx = x + L.DX[d], ny = y + L.DY[d];
      const nc = g.obj[ny] && g.obj[ny][nx];
      if (nc === 'NESW'[d] && ((c === '=' && d % 2 === 1) || (c === '|' && d % 2 === 0))) { cells.push([nx, ny]); break; }
    }
  }
  for (const [cx, cy] of cells) g.obj[cy][cx] = ' ';
  return kind;
}
function placeStone(g, kind) {
  for (let tries = 0; tries < 60; tries++) {
    const x = 1 + ri(g.W - 2), y = 1 + ri(g.H - 2);
    const o = ri(3);
    if (o === 0) {
      if (!freeCell(g, x, y)) continue;
      g.obj[y][x] = kind === 'p' ? 'P' : (rng() < 0.5 ? 'U' : 'D');
      return true;
    }
    const x2 = o === 1 ? x + 1 : x, y2 = o === 2 ? y + 1 : y;
    if (!freeCell(g, x, y) || !freeCell(g, x2, y2)) continue;
    if (kind === 'p') {
      if (o === 1) { g.obj[y][x] = '['; g.obj[y2][x2] = ']'; } else { g.obj[y][x] = 'n'; g.obj[y2][x2] = 'u'; }
    } else if (o === 1) {
      if (rng() < 0.5) { g.obj[y][x] = '='; g.obj[y2][x2] = 'E'; } else { g.obj[y][x] = 'W'; g.obj[y2][x2] = '='; }
    } else if (rng() < 0.5) { g.obj[y][x] = '|'; g.obj[y2][x2] = 'S'; } else { g.obj[y][x] = 'N'; g.obj[y2][x2] = '|'; }
    return true;
  }
  return false;
}
function cellsWith(g, pred) {
  const out = [];
  for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (pred(g.map[y][x], g.obj[y][x], x, y)) out.push([x, y]);
  return out;
}
const locked = new Set(seed.lock || []);
const muts = seed.mutate || ['stones', 'sockets', 'keeper'];

function mutate(g0) {
  const g = clone(g0);
  const kind = muts[ri(muts.length)];
  if (kind === 'stones') {
    const st = cellsWith(g, (t, o) => STONE_CH.has(o) && o !== '=' && o !== '|' && o !== ']' && o !== 'u');
    if (!st.length) return null;
    const [x, y] = st[ri(st.length)];
    const k = liftStone(g, x, y);
    if (!placeStone(g, k)) return null;
  } else if (kind === 'sockets') {
    const so = cellsWith(g, (t, o, x, y) => t === 'o' && !locked.has(x + ',' + y));
    if (!so.length) return null;
    const [x, y] = so[ri(so.length)];
    const fr = cellsWith(g, (t, o, xx, yy) => t === '.' && !locked.has(xx + ',' + yy));
    if (!fr.length) return null;
    const [nx, ny] = fr[ri(fr.length)];
    g.map[y][x] = '.'; g.map[ny][nx] = 'o';
  } else if (kind === 'keeper') {
    const k = cellsWith(g, (t, o) => o === '@')[0];
    const fr = cellsWith(g, (t, o) => FLOOR.has(t) && o === ' ');
    const [nx, ny] = fr[ri(fr.length)];
    g.obj[k[1]][k[0]] = ' '; g.obj[ny][nx] = '@';
  } else if (kind === 'frost' || kind === 'rock' || kind === 'bog' || kind === 'water') {
    const ch = { frost: '*', rock: '#', bog: '%', water: '~' }[kind];
    const cand = cellsWith(g, (t, o, x, y) => (t === '.' || t === ch) && !locked.has(x + ',' + y) && (o === ' ' || ch === '*'));
    if (!cand.length) return null;
    const [x, y] = cand[ri(cand.length)];
    g.map[y][x] = g.map[y][x] === ch ? '.' : ch;
  } else if (kind === 'shape') {
    const edge = cellsWith(g, (t, o, x, y) => x > 0 && y > 0 && x < g.W - 1 && y < g.H - 1 && !locked.has(x + ',' + y) &&
      ((t === ' ' && [0, 1, 2, 3].some((d) => g.map[y + L.DY[d]][x + L.DX[d]] !== ' ')) || (t === '.' && o === ' ' && [0, 1, 2, 3].some((d) => g.map[y + L.DY[d]][x + L.DX[d]] === ' '))));
    if (!edge.length) return null;
    const [x, y] = edge[ri(edge.length)];
    g.map[y][x] = g.map[y][x] === ' ' ? '.' : ' ';
  }
  return g;
}

const P = seed.pushes || [3, 14];
const maxStates = seed.maxStates || 40000;
function evaluate(def) {
  let parsed;
  try { parsed = L.parseLevel(def); } catch (e) { return null; }
  const { level, state } = parsed;
  // water pools must not touch the outside (keeps the walled shore consistent)
  for (let i = 0; i < level.tiles.length; i++) if (level.tiles[i] === L.WATER) {
    const x = i % level.w, y = (i / level.w) | 0;
    for (let d = 0; d < 4; d++) if (L.tileAt(level, state, x + L.DX[d], y + L.DY[d]) === L.OUTSIDE) return null;
  }
  const sol = V.solve(level, state, { limit: maxStates });
  if (sol.status !== 'win') return null;
  const pushes = sol.path.length;
  if (pushes < P[0] || pushes > P[1]) return null;
  const teaches = def.teaches || [];
  if (teaches.includes('domino') && V.solve(level, state, { noChain: true, limit: maxStates }).status === 'win') return null;
  if (teaches.includes('frost')) {
    const p = L.parseLevel(A.withTerrain(def, '*', '.'));
    const r = V.solve(p.level, p.state, { limit: maxStates });
    if (r.status === 'win' && (r.path.length === pushes || seed.frostTool)) return null;
  }
  if (teaches.includes('bog')) {
    const p = L.parseLevel(A.withTerrain(def, '%', '#'));
    if (V.solve(p.level, p.state, { limit: maxStates }).status === 'win') return null;
  }
  if (teaches.includes('mark')) {
    const p = L.parseLevel(A.plainOnly(def));
    const r = V.solve(p.level, p.state, { limit: maxStates });
    if (r.status === 'win' && r.path.length >= pushes) return null;
  }
  const G = new V.Analysis(level, state, maxStates);
  G.run();
  if (!G.complete) return null;
  const dead = G.deadShare();
  const tables = F.buildTables(level, state);
  let g = 0;
  const brng = F.mulberry32(77);
  const runs = 24;
  for (let r = 0; r < runs; r++) if (F.bot(level, tables, state, brng, 0, 40)) g++;
  const greedy = g / runs;
  // detours and walking along the push-optimal path
  let detours = 0, walk = 0, st = state, h0 = F.heuristic(level, tables, st);
  let knocks = 0, frostTips = 0;
  for (const p of sol.path) {
    walk += V.region(level, st).dist[p.from];
    const r = L.step(level, { px: p.from % level.w, py: (p.from / level.w) | 0, pf: p.dir, stones: st.stones, filled: st.filled, moves: 0, pushes: 0 }, p.dir);
    for (const e of r.events) if (e.type === 'roll') { if (e.depth > 0) knocks++; if (e.wave > 0) frostTips++; }
    st = r.state;
    const h1 = F.heuristic(level, tables, st);
    if (h1 > h0) detours++;
    h0 = h1;
  }
  let floor = 0;
  for (const t of level.tiles) if (t !== L.OUTSIDE && t !== L.WATER && t !== L.ROCK) floor++;
  const w = seed.weights || {};
  const score = 2 * Math.min(detours, 4) + 6 * (1 - greedy) + 0.6 * Math.min(pushes, P[1]) + 2 * dead
    - (w.walk == null ? 0.3 : w.walk) * Math.max(0, walk - 2 * pushes) - (w.floor || 0.05) * floor
    + (w.knocks || 0) * Math.min(knocks, 4) + (w.frost || 0) * Math.min(frostTips, 6) - (w.states || 0) * G.size() / 10000;
  return { score, pushes, walk, greedy, detours, dead, states: G.size(), floor, knocks, frostTips };
}

let cur = toGrid(seed);
let curDef = fromGrid(cur, seed);
let curE = evaluate(curDef);
if (!curE) {
  // Find a start that passes every check: random-walk through layouts that
  // stay solvable, restarting from the seed now and then.
  const solvable = (d) => {
    try { const p = L.parseLevel(d); return V.solve(p.level, p.state, { limit: maxStates }).status === 'win'; } catch (e) { return false; }
  };
  let walk = cur;
  for (let i = 0; i < 40000 && !curE; i++) {
    if (i % 400 === 399) walk = toGrid(seed);
    const g = mutate(walk);
    if (!g) continue;
    const d = fromGrid(g, seed);
    if (!solvable(d)) continue;
    walk = g;
    const e = evaluate(d);
    if (e) { cur = g; curDef = d; curE = e; }
  }
  if (!curE) { console.error('no solvable start found'); process.exit(1); }
}
let best = { g: cur, def: curDef, e: curE };
const t0 = Date.now();
for (let it = 0; it < opt.iters; it++) {
  let g = mutate(cur);
  if (!g) continue;
  if (rng() < 0.3) { const g2 = mutate(g); if (g2) g = g2; }
  const d = fromGrid(g, seed);
  const e = evaluate(d);
  if (!e) continue;
  const temp = 0.6 * (1 - it / opt.iters);
  if (e.score >= curE.score || rng() < Math.exp((e.score - curE.score) / Math.max(0.01, temp))) {
    cur = g; curDef = d; curE = e;
    if (e.score > best.e.score) {
      best = { g, def: d, e };
      if (!opt.quiet) console.error(`[${it}] score ${e.score.toFixed(2)} pushes ${e.pushes} walk ${e.walk} greedy ${(e.greedy * 100).toFixed(0)}% detours ${e.detours} dead ${(e.dead * 100).toFixed(0)}% states ${e.states} floor ${e.floor} knocks ${e.knocks} frost ${e.frostTips}`);
    }
  }
}
const out = { name: seed.name, teaches: seed.teaches, map: best.def.map, objs: best.def.objs, eval: best.e, secs: Math.round((Date.now() - t0) / 1000) };
console.log(JSON.stringify(out));
console.log(best.def.map.map((r, y) => r.split('').map((c, x) => (best.def.objs[y][x] !== ' ' ? best.def.objs[y][x] : c)).join('')).join('\n'));
if (opt.out) fs.writeFileSync(opt.out, JSON.stringify(out, null, 1));
