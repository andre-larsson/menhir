#!/usr/bin/env node
/*
 * Print a level's push-optimal solution as a sequence of boards (development tool).
 *   node tools/show.js 4                 level 4 of js/levels.js
 *   node tools/show.js 2 --file f.js     level 2 of another file
 * Legend: @ keeper, P plain standing, [] / n u plain lying, U D marked standing
 * (cap up/down), =E W= |S N| marked lying (letter = capped end); terrain
 * . grass  o socket  # boulder  % bog  ~ water  * frost.
 */
'use strict';
const path = require('path');
const L = require(path.join(__dirname, '..', 'js', 'logic.js'));
const V = require(path.join(__dirname, '..', 'js', 'solver.js'));
const args = process.argv.slice(2);
let file = path.join(__dirname, '..', 'js', 'levels.js');
const fi = args.indexOf('--file');
if (fi >= 0) { file = path.resolve(args[fi + 1]); args.splice(fi, 2); }
const defs = require(file);
const def = defs[(+args[0] || 1) - 1];
const { level, state } = L.parseLevel(def);
const CH = { [L.OUTSIDE]: ' ', [L.GROUND]: '.', [L.ROCK]: '#', [L.SOCKET]: 'o', [L.BOG]: '%', [L.WATER]: '~', [L.FROST]: '*' };
function board(st) {
  const g = [];
  for (let y = 0; y < level.h; y++) { g.push([]); for (let x = 0; x < level.w; x++) g[y].push(CH[L.tileAt(level, st, x, y)]); }
  for (const s of st.stones) {
    if (s.sunk) continue;
    const c = L.stoneCells(s);
    if (L.isStanding(s.m)) g[s.y][s.x] = s.k === 'p' ? 'P' : s.m;
    else if (s.k === 'p') { if (L.isHoriz(s.m)) { g[s.y][s.x] = '['; g[s.y][s.x + 1] = ']'; } else { g[s.y][s.x] = 'n'; g[s.y + 1][s.x] = 'u'; } }
    else {
      const capAt = s.m === 'E' || s.m === 'S' ? 1 : 0;
      c.forEach(([x, y], i) => { g[y][x] = i === capAt ? s.m : (L.isHoriz(s.m) ? '=' : '|'); });
    }
  }
  g[st.py][st.px] = '@';
  return g.map((r) => r.join(''));
}
const sol = V.solve(level, state);
if (sol.status !== 'win') { console.log(sol.status); process.exit(1); }
let st = state;
const frames = [['start', board(st)]];
for (const p of sol.path) {
  const fx = p.from % level.w, fy = (p.from / level.w) | 0;
  const r = L.step(level, { px: fx, py: fy, pf: p.dir, stones: st.stones, filled: st.filled, moves: 0, pushes: 0 }, p.dir);
  st = r.state;
  const n = r.events.filter((e) => e.type === 'roll');
  frames.push([`${'NESW'[p.dir]} from ${fx},${fy} (${n.length} tips${n.some((e) => e.depth) ? ', knock' : ''}${n.some((e) => e.wave) ? ', frost' : ''})`, board(st)]);
}
console.log(`${def.name}: ${sol.path.length} pushes`);
// print frames side by side, 4 per row
for (let i = 0; i < frames.length; i += 4) {
  const row = frames.slice(i, i + 4);
  const w = level.w + 2;
  console.log(row.map(([t]) => (t.length > 26 ? t.slice(0, 26) : t).padEnd(Math.max(w, 28))).join(''));
  for (let y = 0; y < level.h; y++) console.log(row.map(([, b]) => b[y].padEnd(Math.max(w, 28))).join(''));
}
