/*
 * Menhir - core rules.
 *
 * Pure, deterministic game logic shared by the browser game and the Node
 * tools (tools/*.js). No DOM access, no randomness, no clocks.
 *
 * World axes: x = east, y = south, z = up.
 * A stone is a 1x1x2 block. `m` says where it is and which way its marked
 * cap points:
 *   'U' standing, cap up          'D' standing, cap down
 *   'E' lying east-west, cap at the east end    'W' ... cap at the west end
 *   'S' lying north-south, cap at the south end 'N' ... cap at the north end
 * The anchor (x, y) of a lying stone is its west/north cell.
 * `k` is the stone's kind: 'p' plain (any standing stone counts on a socket)
 * or 'm' marked (counts only standing cap-up, i.e. sun mark to the sky).
 * Plain stones still track `m` so the renderer can show their true 3D
 * orientation, but the rules ignore which end is which.
 * `rot` (3x3 integer matrix, column-major images of the local axes) is kept
 * only for the renderer.
 *
 * The keeper is a single tile. Walking into a stone pushes it one quarter
 * turn. A moving stone knocks on any stone in its way (dominoes). After a
 * push, a stone with momentum keeps tipping the same way while any part of it
 * is on frost; when a sliding stone knocks another stone, it stops and the
 * knocked stone carries the momentum on.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MenhirLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Directions: 0 N, 1 E, 2 S, 3 W
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  const DIR_CHAR = 'NESW';

  // Terrain. OUTSIDE is the lake beyond the island's walled shore: nothing
  // can go there. WATER is an open pool on the island: stones sink in it.
  const OUTSIDE = 0, GROUND = 1, ROCK = 2, SOCKET = 3, BOG = 4, WATER = 5, FROST = 6;

  // ---- vector helpers for the visual rotation matrix ----
  // Roll toward horizontal direction d: up -> d, d -> down, other axis fixed.
  function rollVec(v, dir) {
    const dx = DX[dir], dy = DY[dir];
    const along = v[0] * dx + v[1] * dy;
    const up = v[2];
    const px = v[0] - along * dx, py = v[1] - along * dy;
    return [px + up * dx, py + up * dy, -along];
  }
  function rollRot(rot, dir) {
    const a = rollVec([rot[0], rot[1], rot[2]], dir);
    const b = rollVec([rot[3], rot[4], rot[5]], dir);
    const c = rollVec([rot[6], rot[7], rot[8]], dir);
    return [a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]];
  }
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  function rotForMark(m) {
    switch (m) {
      case 'U': return IDENTITY.slice();
      case 'E': return rollRot(IDENTITY, 1);
      case 'W': return rollRot(IDENTITY, 3);
      case 'S': return rollRot(IDENTITY, 2);
      case 'N': return rollRot(IDENTITY, 0);
      case 'D': return rollRot(rollRot(IDENTITY, 1), 1);
    }
    throw new Error('bad mark ' + m);
  }

  // Cap direction after rolling toward dir.
  function rollMark(m, dir) {
    const d = DIR_CHAR[dir];
    const back = DIR_CHAR[(dir + 2) % 4];
    if (m === 'U') return d;
    if (m === d) return 'D';
    if (m === 'D') return back;
    if (m === back) return 'U';
    return m; // rolling sideways: the cap keeps pointing the same way
  }

  function isStanding(m) { return m === 'U' || m === 'D'; }
  function isHoriz(m) { return m === 'E' || m === 'W'; }
  function isVert(m) { return m === 'N' || m === 'S'; }
  function orient(m) { return isStanding(m) ? 'S' : isHoriz(m) ? 'H' : 'V'; }

  function stoneCells(s) {
    if (isHoriz(s.m)) return [[s.x, s.y], [s.x + 1, s.y]];
    if (isVert(s.m)) return [[s.x, s.y], [s.x, s.y + 1]];
    return [[s.x, s.y]];
  }

  // Where a stone ends up when rolled one quarter turn toward dir.
  function rolledStone(s, dir) {
    const dx = DX[dir], dy = DY[dir];
    let cx = s.x, cy = s.y;
    if (isHoriz(s.m)) cx += 0.5;
    if (isVert(s.m)) cy += 0.5;
    const alongAxis = (isHoriz(s.m) && dx !== 0) || (isVert(s.m) && dy !== 0);
    const shift = isStanding(s.m) || alongAxis ? 1.5 : 1;
    cx += dx * shift;
    cy += dy * shift;
    const m = rollMark(s.m, dir);
    let x = cx, y = cy;
    if (isHoriz(m)) x -= 0.5;
    if (isVert(m)) y -= 0.5;
    return { x: Math.round(x), y: Math.round(y), m, k: s.k, rot: rollRot(s.rot, dir), sunk: false };
  }

  // ---- level parsing ----
  /*
   * def.map  : terrain rows.  '.' grass  '#' boulder  'o' socket  '%' bog
   *            '~' water pool  '*' frost  ' ' outside the walled shore
   * def.objs : overlay rows.  '@' the keeper
   *            plain stones:  'P' standing, '[]' lying east-west,
   *                           'n' over 'u' lying north-south
   *            marked stones: 'U' standing cap up, 'D' standing cap down;
   *                           lying: the capped end is a letter N/E/S/W pointing
   *                           away from its other half, which is '=' (east-west)
   *                           or '|' (north-south)
   */
  const TERRAIN = { '.': GROUND, '#': ROCK, 'o': SOCKET, '%': BOG, '~': WATER, '*': FROST, ' ': OUTSIDE };
  function parseLevel(def) {
    const map = def.map;
    const h = map.length;
    const w = Math.max.apply(null, map.map((r) => r.length));
    const tiles = new Array(w * h).fill(OUTSIDE);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = map[y][x] || ' ';
        const t = TERRAIN[ch];
        if (t === undefined) throw new Error(`Level "${def.name}": unknown terrain '${ch}' at ${x},${y}`);
        tiles[y * w + x] = t;
      }
    }
    const objs = def.objs || [];
    const stones = [];
    let player = null;
    const at = (x, y) => (objs[y] && objs[y][x]) || ' ';
    const used = new Set();
    const bad = (msg) => { throw new Error(`Level "${def.name}": ${msg}`); };
    for (let y = 0; y < objs.length; y++) {
      for (let x = 0; x < objs[y].length; x++) {
        const ch = objs[y][x];
        if (ch === '@') { player = { x, y }; continue; }
        if (ch === 'U' || ch === 'D') { stones.push({ x, y, m: ch, k: 'm' }); continue; }
        if (ch === 'P') { stones.push({ x, y, m: 'U', k: 'p' }); continue; }
        const di = DIR_CHAR.indexOf(ch);
        if (di >= 0) {
          const ox = x - DX[di], oy = y - DY[di];
          const want = di % 2 === 1 ? '=' : '|';
          if (at(ox, oy) !== want) bad(`stone end '${ch}' at ${x},${y} needs '${want}' behind it`);
          used.add(ox + ',' + oy);
          stones.push({ x: Math.min(x, ox), y: Math.min(y, oy), m: ch, k: 'm' });
        }
      }
    }
    for (let y = 0; y < objs.length; y++) {
      for (let x = 0; x < objs[y].length; x++) {
        const ch = objs[y][x];
        if (ch === '[') {
          if (at(x + 1, y) !== ']') bad(`'[' at ${x},${y} needs ']' east of it`);
          stones.push({ x, y, m: 'E', k: 'p' });
        } else if (ch === 'n') {
          if (at(x, y + 1) !== 'u') bad(`'n' at ${x},${y} needs 'u' south of it`);
          stones.push({ x, y, m: 'S', k: 'p' });
        } else if ((ch === '=' || ch === '|') && !used.has(x + ',' + y)) {
          bad(`unpaired '${ch}' at ${x},${y}`);
        }
      }
    }
    if (!player) bad('no keeper (@)');
    for (const s of stones) { s.rot = rotForMark(s.m); s.sunk = false; }
    const sockets = [];
    tiles.forEach((t, i) => { if (t === SOCKET) sockets.push(i); });
    const level = { name: def.name, w, h, tiles, sockets, def };
    const state = { px: player.x, py: player.y, pf: 2, stones, filled: [], moves: 0, pushes: 0 };
    if (!keeperCan(level, state, player.x, player.y)) bad('keeper on bad terrain');
    const seen = new Set();
    for (const s of stones) for (const [cx, cy] of stoneCells(s)) {
      const t = tileAt(level, state, cx, cy);
      if (t !== GROUND && t !== SOCKET && t !== FROST) bad(`stone on bad terrain at ${cx},${cy}`);
      if (seen.has(cx + ',' + cy) || (cx === player.x && cy === player.y)) bad(`overlap at ${cx},${cy}`);
      seen.add(cx + ',' + cy);
    }
    if (stones.length < sockets.length) bad('fewer stones than sockets');
    return { level, state };
  }

  function tileAt(level, state, x, y) {
    if (x < 0 || y < 0 || x >= level.w || y >= level.h) return OUTSIDE;
    const i = y * level.w + x;
    const t = level.tiles[i];
    if (t === BOG && state.filled.indexOf(i) >= 0) return GROUND;
    return t;
  }

  function stoneAt(state, x, y) {
    for (let i = 0; i < state.stones.length; i++) {
      const s = state.stones[i];
      if (s.sunk) continue;
      if (s.x === x && s.y === y) return i;
      if (isHoriz(s.m) && s.x + 1 === x && s.y === y) return i;
      if (isVert(s.m) && s.x === x && s.y + 1 === y) return i;
    }
    return -1;
  }

  function cloneStone(t) { return { x: t.x, y: t.y, m: t.m, k: t.k, rot: t.rot.slice(), sunk: t.sunk }; }
  function cloneState(s) {
    return {
      px: s.px, py: s.py, pf: s.pf, moves: s.moves, pushes: s.pushes || 0,
      filled: s.filled.slice(),
      stones: s.stones.map(cloneStone),
    };
  }

  // Terrain the keeper can stand on (ignoring stones).
  function keeperCan(level, state, x, y) {
    const t = tileAt(level, state, x, y);
    return t === GROUND || t === SOCKET || t === FROST;
  }
  function walkable(level, state, x, y) {
    return keeperCan(level, state, x, y) && stoneAt(state, x, y) < 0;
  }

  function onFrost(level, state, s) {
    return stoneCells(s).some(([cx, cy]) => tileAt(level, state, cx, cy) === FROST);
  }

  /*
   * Roll stone `idx` one quarter turn toward dir, knocking any stones in its
   * way along in the same direction (dominoes). Each stone moves at most once
   * per wave. Returns false if anything in the chain is blocked (a boulder,
   * the walled shore, the keeper, or a stone that cannot move); the caller
   * then rolls back. Appends one event per moving stone to ctx.events; a
   * knocked-on stone's event points at the event of the stone that hit it.
   */
  function rollStone(level, state, idx, dir, ctx, parent) {
    if (ctx.moved.has(idx)) return false;
    ctx.moved.add(idx);
    const s = state.stones[idx];
    const n = rolledStone(s, dir);
    const cells = stoneCells(n);
    const ev = {
      type: 'roll', stone: idx, dir, wave: ctx.wave,
      from: { x: s.x, y: s.y, m: s.m, k: s.k, rot: s.rot.slice() }, to: null,
      fate: null, fillCells: [], parent, kids: 0,
      depth: parent ? parent.depth + 1 : 0,
    };
    for (const [cx, cy] of cells) {
      const t = tileAt(level, state, cx, cy);
      if (t === ROCK || t === OUTSIDE) return false;
      if (cx === state.px && cy === state.py) return false;
    }
    for (const [cx, cy] of cells) {
      const other = stoneAt(state, cx, cy);
      if (other >= 0 && other !== idx) {
        if (ctx.noChain) return false;
        if (!rollStone(level, state, other, dir, ctx, ev)) return false;
        ev.kids++;
      }
    }
    for (const [cx, cy] of cells) {
      const other = stoneAt(state, cx, cy);
      if (other >= 0 && other !== idx) return false;
    }
    if (cells.some(([cx, cy]) => tileAt(level, state, cx, cy) === WATER)) ev.fate = 'sink';
    else if (cells.some(([cx, cy]) => tileAt(level, state, cx, cy) === BOG)) {
      ev.fate = 'bog';
      for (const [cx, cy] of cells) if (tileAt(level, state, cx, cy) === BOG) ev.fillCells.push(cy * level.w + cx);
    }
    s.x = n.x; s.y = n.y; s.m = n.m; s.rot = n.rot;
    if (ev.fate) {
      s.sunk = true;
      for (const i of ev.fillCells) state.filled.push(i);
      state.filled.sort((a, b) => a - b);
    }
    ev.to = { x: n.x, y: n.y, m: n.m, k: s.k, rot: n.rot.slice() };
    ctx.events.push(ev);
    return true;
  }

  // Stones that moved in a wave without knocking anything keep the momentum.
  function carriers(events) {
    return events.filter((e) => e.kids === 0 && !e.fate).map((e) => e.stone);
  }

  // How far a stone reaches in direction dir (for front-first ordering).
  function lead(s, dir) {
    let best = -Infinity;
    for (const [cx, cy] of stoneCells(s)) best = Math.max(best, cx * DX[dir] + cy * DY[dir]);
    return best;
  }

  /*
   * Resolve a push of stone idx toward dir on `state` (mutated). Wave 0 is the
   * keeper's push with its domino chain; it either happens completely or not
   * at all (returns false). Then, wave after wave, every stone with momentum
   * that has any part on frost tips once more (front-most first). A sliding
   * stone that is blocked stops where it is; one that knocks other stones
   * stops after its tip and the knocked stones carry the momentum on.
   */
  function resolvePush(level, state, idx, dir, events, opts) {
    const noChain = !!(opts && opts.noChain);
    const noFrost = !!(opts && opts.noFrost);
    const ctx0 = { moved: new Set(), events: [], wave: 0, noChain };
    if (!rollStone(level, state, idx, dir, ctx0, null)) return false;
    for (const e of ctx0.events) events.push(e);
    let momentum = carriers(ctx0.events);
    for (let wave = 1; wave < 400 && !noFrost; wave++) {
      const sliders = momentum.filter((i) => !state.stones[i].sunk && onFrost(level, state, state.stones[i]));
      if (!sliders.length) break;
      sliders.sort((a, b) => lead(state.stones[b], dir) - lead(state.stones[a], dir) || a - b);
      let moved = new Set();
      const next = [];
      for (const i of sliders) {
        if (moved.has(i)) continue;
        const snap = { stones: state.stones.map(cloneStone), filled: state.filled.slice() };
        const ctx = { moved: new Set(moved), events: [], wave, noChain };
        if (rollStone(level, state, i, dir, ctx, null)) {
          moved = ctx.moved;
          for (const e of ctx.events) events.push(e);
          for (const c of carriers(ctx.events)) next.push(c);
        } else {
          state.stones = snap.stones;
          state.filled = snap.filled;
        }
      }
      momentum = next;
    }
    return true;
  }

  /*
   * Attempt one input. dir is 0..3. Returns { state, events, pushed } or
   * { blocked: true, kind } without changing anything.
   * opts (for the solver's what-if checks): noChain (a stone in the way blocks
   * instead of being knocked on), noFrost (frost acts as plain ground).
   */
  function step(level, state, dir, opts) {
    const nx = state.px + DX[dir], ny = state.py + DY[dir];
    const hit = stoneAt(state, nx, ny);
    if (hit < 0) {
      if (!keeperCan(level, state, nx, ny)) return { blocked: true, kind: 'walk', at: [nx, ny] };
      const st = cloneState(state);
      st.pf = dir;
      st.px = nx; st.py = ny;
      st.moves = state.moves + 1;
      return { state: st, events: [{ type: 'walk', from: [state.px, state.py], to: [nx, ny], dir }], pushed: false };
    }
    const st = cloneState(state);
    st.pf = dir;
    const events = [];
    if (!resolvePush(level, st, hit, dir, events, opts)) return { blocked: true, kind: 'push', stone: hit };
    events.unshift({ type: 'walk', from: [state.px, state.py], to: [nx, ny], dir, push: true });
    st.px = nx; st.py = ny;
    st.moves = state.moves + 1;
    st.pushes = (state.pushes || 0) + 1;
    return { state: st, events, pushed: true };
  }

  function stoneSet(level, s) {
    return !s.sunk && isStanding(s.m) && (s.k === 'p' || s.m === 'U') && level.tiles[s.y * level.w + s.x] === SOCKET;
  }

  function socketStatus(level, state) {
    // For each socket: 'empty' | 'wrong' (marked stone standing cap down) | 'set'
    return level.sockets.map((i) => {
      const x = i % level.w, y = Math.floor(i / level.w);
      const k = stoneAt(state, x, y);
      if (k < 0) return 'empty';
      const s = state.stones[k];
      if (!isStanding(s.m)) return 'empty';
      if (s.k === 'p' || s.m === 'U') return 'set';
      return 'wrong';
    });
  }

  function isWon(level, state) {
    return level.sockets.length > 0 && socketStatus(level, state).every((s) => s === 'set');
  }

  function liveStones(state) { return state.stones.filter((s) => !s.sunk).length; }
  function isHopeless(level, state) { return liveStones(state) < level.sockets.length; }

  // Canonical key of the stones and filled bogs (stones of a kind are
  // interchangeable; a plain stone's cap and the visual rotation are ignored).
  function stonesKey(state) {
    const ss = [];
    for (const s of state.stones) {
      if (s.sunk) continue;
      ss.push(s.k === 'p' ? 'p' + orient(s.m) + s.x + ',' + s.y : 'm' + s.m + s.x + ',' + s.y);
    }
    ss.sort();
    return ss.join(';') + '|' + state.filled.join(',');
  }
  function stateKey(state) { return state.px + ',' + state.py + '|' + stonesKey(state); }

  // ---- 90-degree clockwise rotation (used to fit wide levels on tall screens) ----
  // A cell (x, y) of a level H rows tall moves to (H - 1 - y, x). The rules are
  // symmetric under rotation, so a rotated level is the same puzzle.
  const ROT_CHAR = { N: 'E', E: 'S', S: 'W', W: 'N', '=': '|', '|': '=', '[': 'n', ']': 'u', n: ']', u: '[' };
  function rotateDef(def) {
    const H = def.map.length;
    const W = Math.max.apply(null, def.map.map((r) => r.length));
    const map = [], objs = [];
    for (let ny = 0; ny < W; ny++) {
      let m = '', o = '';
      for (let nx = 0; nx < H; nx++) {
        const x = ny, y = H - 1 - nx;
        m += def.map[y][x] || ' ';
        const c = (def.objs && def.objs[y] && def.objs[y][x]) || ' ';
        o += ROT_CHAR[c] || c;
      }
      map.push(m); objs.push(o);
    }
    return Object.assign({}, def, { map, objs });
  }
  function rotateState(state, W, H) {
    // W, H: size of the level the state belongs to (before rotating)
    const rv = (a, b, c) => [-b, a, c];
    const st = cloneState(state);
    st.px = H - 1 - state.py; st.py = state.px; st.pf = (state.pf + 1) % 4;
    st.stones = state.stones.map((s) => {
      const cells = stoneCells(s).map(([x, y]) => [H - 1 - y, x]);
      const r = s.rot;
      const c0 = rv(r[0], r[1], r[2]), c1 = rv(r[3], r[4], r[5]), c2 = rv(r[6], r[7], r[8]);
      return {
        x: Math.min.apply(null, cells.map((c) => c[0])),
        y: Math.min.apply(null, cells.map((c) => c[1])),
        m: ROT_CHAR[s.m] || s.m, k: s.k,
        rot: c0.concat(c1, c2),
        sunk: s.sunk,
      };
    });
    st.filled = state.filled.map((i) => { const x = i % W, y = Math.floor(i / W); return x * H + (H - 1 - y); }).sort((a, b) => a - b);
    return st;
  }

  return {
    rotateDef, rotateState,
    DX, DY, DIR_CHAR, OUTSIDE, GROUND, ROCK, SOCKET, BOG, WATER, FROST,
    parseLevel, step, cloneState, tileAt, stoneAt, stoneCells, isWon, socketStatus, stoneSet,
    stateKey, stonesKey, liveStones, isHopeless, isStanding, isHoriz, isVert, orient,
    keeperCan, walkable, onFrost, rollRot, rotForMark, rolledStone,
  };
});
