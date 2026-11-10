#!/usr/bin/env node
/*
 * Rules test (development tool). Every rule stated in the README and the
 * in-game "How to play" is checked here on a tiny hand-made board.
 *
 *   node tools/rules-test.js
 */
'use strict';
const path = require('path');
const L = require(path.join(__dirname, '..', 'js', 'logic.js'));
const S = require(path.join(__dirname, '..', 'js', 'solver.js'));
const LEVELS = require(path.join(__dirname, '..', 'js', 'levels.js'));

const N = 0, E = 1, So = 2, W = 3;
let failures = 0, count = 0;
function check(name, cond, extra) {
  count++;
  if (!cond) failures++;
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (!cond && extra !== undefined ? '  (' + extra + ')' : ''));
}
function board(map, objs) { return L.parseLevel({ name: 'test', map, objs }); }
function play(b, dirs) {
  let s = b.state, last = null;
  for (const d of dirs) {
    last = L.step(b.level, s, d);
    if (!last.blocked) s = last.state;
  }
  return { s, last };
}
const pose = (st, i) => { const t = st.stones[i]; return t.sunk ? 'sunk' : L.orient(t.m) + t.x + ',' + t.y; };
const at = (st) => st.px + ',' + st.py;

// ---------------------------------------------------------------- walking
{
  const b = board(
    ['        ',
     ' ..#~%* ',
     ' ...... ',
     '        '],
    ['        ',
     '        ',
     ' @      ',
     '        ']);
  let r = play(b, [N]);
  check('keeper walks onto grass', at(r.s) === '1,1');
  r = play(b, [W]);
  check('the walled shore blocks the keeper', r.last.blocked && at(r.s) === '1,2');
  r = play(b, [E, E, N]);
  check('a boulder blocks the keeper', r.last.blocked && at(r.s) === '3,2');
  r = play(b, [E, E, E, N]);
  check('the keeper cannot wade into water', r.last.blocked && at(r.s) === '4,2');
  r = play(b, [E, E, E, E, N]);
  check('the keeper cannot wade into bog', r.last.blocked && at(r.s) === '5,2');
  r = play(b, [E, E, E, E, E, N]);
  check('the keeper walks on frost', !r.last.blocked && at(r.s) === '6,1');
  check('walking is a move but not a push', r.s.moves === 6 && r.s.pushes === 0);
}

// ---------------------------------------------------------------- pushing one stone
{
  const b = board(
    ['        ',
     ' ...... ',
     ' ...... ',
     ' ...... ',
     '        '],
    ['        ',
     '        ',
     ' @P     ',
     '        ',
     '        ']);
  let r = play(b, [E]);
  check('walking into a standing stone topples it onto the next two tiles', pose(r.s, 0) === 'H3,2', pose(r.s, 0));
  check('the keeper steps into the tile the stone left', at(r.s) === '2,2' && r.s.pushes === 1);
  r = play(b, [E, E]);
  check('a lying stone pushed along its length rises on the tile beyond', pose(r.s, 0) === 'S5,2', pose(r.s, 0));
  r = play(b, [E, N, E, So]);
  check('a lying stone pushed from the side rolls one tile', pose(r.s, 0) === 'H3,3', pose(r.s, 0));
  r = play(b, [E, E, E, E]);
  check('a stone cannot be pushed through the walled shore', r.last.blocked && pose(r.s, 0) === 'S5,2' && at(r.s) === '4,2');
}
{
  const b = board(
    ['       ',
     ' ...#. ',
     '       '],
    ['       ',
     ' @P    ',
     '       ']);
  const r = play(b, [E]);
  check('a boulder blocks a stone, and nothing moves', r.last.blocked && pose(r.s, 0) === 'S2,1' && at(r.s) === '1,1');
}

// ---------------------------------------------------------------- dominoes
{
  const b = board(
    ['             ',
     ' ........... ',
     '             '],
    ['             ',
     ' @P.P.P      ',
     '             ']);
  const r = play(b, [E]);
  check('dominoes: a falling stone knocks on stones two tiles apart in a chain',
    pose(r.s, 0) === 'H3,1' && pose(r.s, 1) === 'H5,1' && pose(r.s, 2) === 'H7,1', [0, 1, 2].map((i) => pose(r.s, i)).join(' '));
  const ev = [0, 1, 2].map((i) => r.last.events.filter((e) => e.stone === i));
  check('each stone moves once, knocked on by the one before', ev.every((x) => x.length === 1) && ev[1][0].parent === ev[0][0] && ev[2][0].parent === ev[1][0]);
  const r2 = play(b, [E, E]);
  check('pushing the fallen line raises every stone (each lands where the next one stood up from)',
    pose(r2.s, 0) === 'S5,1' && pose(r2.s, 1) === 'S7,1' && pose(r2.s, 2) === 'S9,1', [0, 1, 2].map((i) => pose(r2.s, i)).join(' '));
}
{
  const b = board(
    ['        ',
     ' ...... ',
     '        '],
    ['        ',
     ' @PP    ',
     '        ']);
  const r = play(b, [E]);
  check('standing stones side by side jam: nothing moves', r.last.blocked && pose(r.s, 0) === 'S2,1' && pose(r.s, 1) === 'S3,1');
}
{
  const b = board(
    ['         ',
     ' .....#. ',
     '         '],
    ['         ',
     ' @P.P    ',
     '         ']);
  const r = play(b, [E]);
  check('if any stone in the chain is blocked, nothing moves', r.last.blocked && pose(r.s, 0) === 'S2,1' && pose(r.s, 1) === 'S4,1');
}
{
  const b = board(
    ['         ',
     ' ....... ',
     '         '],
    ['         ',
     ' @P.[]   ',
     '         ']);
  const r = play(b, [E]);
  check('a stone falling onto the end of a lying stone stands it up', pose(r.s, 0) === 'H3,1' && pose(r.s, 1) === 'S6,1', pose(r.s, 0) + ' ' + pose(r.s, 1));
  const r2 = L.step(b.level, b.state, E, { noChain: true });
  check('(solver what-if) with chains off, a stone in the way blocks', r2.blocked);
}

// ---------------------------------------------------------------- frost
{
  const b = board(
    ['            ',
     ' ...****... ',
     '            '],
    ['            ',
     ' @P         ',
     '            ']);
  const r = play(b, [E]);
  const rolls = r.last.events.filter((e) => e.type === 'roll');
  check('frost: a pushed stone keeps tipping while any part of it is on frost', pose(r.s, 0) === 'S8,1' && rolls.length === 4, pose(r.s, 0) + ' tips ' + rolls.length);
  check('frost: it stops once it is completely off the frost', !L.onFrost(b.level, r.s, r.s.stones[0]));
  check('the keeper is not affected by frost (one step per push)', at(r.s) === '2,1');
  const r2 = L.step(b.level, b.state, E, { noFrost: true });
  check('(solver what-if) with frost off, the stone tips once', pose(r2.state, 0) === 'H3,1');
}
{
  const b = board(
    ['          ',
     ' ...****# ',
     '          '],
    ['          ',
     ' @P       ',
     '          ']);
  const r = play(b, [E]);
  check('frost: a sliding stone that is blocked stops, even on frost', pose(r.s, 0) === 'H6,1' && L.onFrost(b.level, r.s, r.s.stones[0]), pose(r.s, 0));
}
{
  const b = board(
    ['              ',
     ' ...***...... ',
     '              '],
    ['              ',
     ' @P.....P     ',
     '              ']);
  const r = play(b, [E]);
  check('frost + dominoes: a sliding stone that knocks another stops, and the knocked stone tips once off the ice',
    pose(r.s, 0) === 'S8,1' && pose(r.s, 1) === 'H9,1', pose(r.s, 0) + ' ' + pose(r.s, 1));
}
{
  const b = board(
    ['              ',
     ' ...*******.. ',
     '              '],
    ['              ',
     ' @P.....P     ',
     '              ']);
  const r = play(b, [E]);
  const second = r.last.events.filter((e) => e.stone === 1);
  check('frost + dominoes: a knocked stone that lands on frost slides on', pose(r.s, 0) === 'S8,1' && pose(r.s, 1) === 'S11,1' && second.length >= 2 && !L.onFrost(b.level, r.s, r.s.stones[1]), pose(r.s, 0) + ' ' + pose(r.s, 1) + ' tips ' + second.length);
}

// ---------------------------------------------------------------- water and bog
{
  const b = board(
    ['        ',
     ' ...~.. ',
     ' ...... ',
     '        '],
    ['        ',
     ' @P     ',
     '        ',
     '        ']);
  const r = play(b, [E]);
  check('water: a stone that touches open water sinks and is lost', r.s.stones[0].sunk && L.liveStones(r.s) === 0);
}
{
  const b = board(
    ['         ',
     ' ...%%o. ',
     ' ....... ',
     '         '],
    ['         ',
     ' @P   P  ',
     '         ',
     '         ']);
  const r = play(b, [E]);
  check('bog: a stone that touches bog sinks into it', r.s.stones[0].sunk);
  check('bog: the bog under it becomes firm ground, the rest stays bog', L.tileAt(b.level, r.s, 4, 1) === L.GROUND && L.tileAt(b.level, r.s, 5, 1) === L.BOG);
  const r2 = play(b, [E, E, E]);
  check('the keeper can walk on filled bog', !r2.last.blocked && at(r2.s) === '4,1');
}
{
  const map = ['       ', ' ..~o. ', ' ..... ', '       '];
  const one = board(map, ['       ', ' @P    ', '       ', '       ']);
  check('losing the only stone for a socket is hopeless', L.isHopeless(one.level, play(one, [E]).s));
  const two = board(map, ['       ', ' @P    ', '    P  ', '       ']);
  check('losing a spare stone is not hopeless', !L.isHopeless(two.level, play(two, [E]).s));
}

// ---------------------------------------------------------------- sockets and marks
{
  const b = board(
    ['        ',
     ' ....o. ',
     '        '],
    ['        ',
     ' @P     ',
     '        ']);
  let r = play(b, [E, E]);
  check('a plain stone standing on a socket sets it, whichever end is up', L.isWon(b.level, r.s));
  const m = board(
    ['        ',
     ' ....o. ',
     '        '],
    ['        ',
     ' @U     ',
     '        ']);
  r = play(m, [E, E]);
  check('a marked stone standing cap-down on a socket does not count', !L.isWon(m.level, r.s) && L.socketStatus(m.level, r.s)[0] === 'wrong');
  const m2 = board(
    ['        ',
     ' ....o. ',
     '        '],
    ['        ',
     ' @D     ',
     '        ']);
  r = play(m2, [E, E]);
  check('a marked stone standing cap-up (sun to the sky) on a socket counts', L.isWon(m2.level, r.s));
  const m3 = board(
    ['        ',
     ' ...... ',
     ' ...... ',
     ' ...... ',
     '        '],
    ['        ',
     '   @    ',
     '   =E   ',
     '        ',
     '        ']);
  r = play(m3, [So]);
  check('rolling a lying stone sideways keeps its cap pointing the same way', r.s.stones[0].m === 'E' && r.s.stones[0].y === 3, r.s.stones[0].m + r.s.stones[0].y);
  const ly = board(['        ', ' ...o.. ', '        '], ['        ', ' @P     ', '        ']);
  const lr = play(ly, [E]);
  check('a lying stone across a socket does not count', L.stoneAt(lr.s, 4, 1) === 0 && L.socketStatus(ly.level, lr.s)[0] === 'empty');
}

// ---------------------------------------------------------------- rotation
{
  for (let i = 0; i < LEVELS.length; i++) {
    const def = LEVELS[i];
    const a = L.parseLevel(def), r = L.parseLevel(L.rotateDef(def));
    const rs = L.rotateState(a.state, a.level.w, a.level.h);
    check(`rotating level ${i + 1} gives the same puzzle`, L.stateKey(rs) === L.stateKey(r.state));
  }
}

// ---------------------------------------------------------------- level invariants
{
  for (let i = 0; i < LEVELS.length; i++) {
    const { level, state } = L.parseLevel(LEVELS[i]);
    let ok = true;
    for (let k = 0; k < level.tiles.length; k++) {
      if (level.tiles[k] !== L.WATER) continue;
      const x = k % level.w, y = Math.floor(k / level.w);
      for (let d = 0; d < 4; d++) if (L.tileAt(level, state, x + L.DX[d], y + L.DY[d]) === L.OUTSIDE) ok = false;
    }
    check(`level ${i + 1}: open water is inside the island (a wall never borders water)`, ok);
  }
}

// ---------------------------------------------------------------- solver
{
  const b = board(
    ['        ',
     ' ....o. ',
     '        '],
    ['        ',
     ' @P     ',
     '        ']);
  const r = S.solve(b.level, b.state);
  check('solver finds the 2-push solution', r.status === 'win' && r.path.length === 2);
  const info = new S.Analysis(b.level, b.state);
  info.run();
  check('analysis: start is 2 pushes from a win', S.distance(b.level, info, b.state) === 2);
}

console.log(failures ? `${failures} of ${count} FAILED` : `all ${count} rule checks passed`);
process.exit(failures ? 1 : 0);
