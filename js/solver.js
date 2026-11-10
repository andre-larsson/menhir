/*
 * Menhir - push-level solver, shared by the page (dead-end warning, hints)
 * and the Node tools. Depends only on MenhirLogic.
 *
 * A "position" is the stone layout (plus filled bogs) and the region the
 * keeper can walk to; edges are single pushes. Searches are breadth-first,
 * so paths are optimal in pushes.
 */
(function (root, factory) {
  const L = root.MenhirLogic || (typeof require === 'function' ? require('./logic.js') : null);
  const api = factory(L);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MenhirSolver = api;
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  // Cells the keeper can reach: { dist (Int32Array, -1 = unreachable), cells (BFS order), occ }
  function region(level, st) {
    const n = level.w * level.h;
    const occ = new Uint8Array(n);
    for (const s of st.stones) {
      if (s.sunk) continue;
      for (const [cx, cy] of L.stoneCells(s)) occ[cy * level.w + cx] = 1;
    }
    const dist = new Int32Array(n).fill(-1);
    const start = st.py * level.w + st.px;
    dist[start] = 0;
    const q = [start];
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % level.w, y = (i / level.w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + L.DX[d], ny = y + L.DY[d];
        if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
        const j = ny * level.w + nx;
        if (dist[j] >= 0 || occ[j] || !L.keeperCan(level, st, nx, ny)) continue;
        dist[j] = dist[i] + 1;
        q.push(j);
      }
    }
    return { dist, cells: q, occ };
  }

  // Every push the keeper can make from here: [{ from, dir, next, dist, events }]
  function pushes(level, st, reg, opts) {
    reg = reg || region(level, st);
    const out = [];
    for (const i of reg.cells) {
      const x = i % level.w, y = (i / level.w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + L.DX[d], ny = y + L.DY[d];
        if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
        if (!reg.occ[ny * level.w + nx]) continue;
        const r = L.step(level, { px: x, py: y, pf: d, stones: st.stones, filled: st.filled, moves: 0, pushes: 0 }, d, opts);
        if (!r.blocked) out.push({ from: i, dir: d, next: r.state, dist: reg.dist[i], events: r.events });
      }
    }
    return out;
  }

  function canonKey(level, st, reg) {
    reg = reg || region(level, st);
    let m = Infinity;
    for (const c of reg.cells) if (c < m) m = c;
    return L.stonesKey(st) + '#' + m;
  }

  // Breadth-first search in pushes. { status: 'win'|'dead'|'unknown', path: [{from, dir}], states }
  function solve(level, st, opts) {
    opts = opts || {};
    const limit = opts.limit || 300000;
    const won = opts.goal || ((s) => L.isWon(level, s));
    if (won(st)) return { status: 'win', path: [], states: 1 };
    const seen = new Map();
    const nodes = [{ st, parent: -1, via: null }];
    seen.set(canonKey(level, st), 0);
    for (let h = 0; h < nodes.length; h++) {
      if (nodes.length > limit) return { status: 'unknown', path: null, states: nodes.length };
      const n = nodes[h];
      if (L.isHopeless(level, n.st)) continue;
      for (const p of pushes(level, n.st, null, opts)) {
        const key = canonKey(level, p.next);
        if (seen.has(key)) continue;
        seen.set(key, nodes.length);
        nodes.push({ st: p.next, parent: h, via: { from: p.from, dir: p.dir } });
        if (won(p.next)) {
          const path = [];
          let k = nodes.length - 1;
          while (nodes[k].parent >= 0) { path.unshift(nodes[k].via); k = nodes[k].parent; }
          return { status: 'win', path, states: nodes.length };
        }
      }
    }
    return { status: 'dead', path: null, states: nodes.length };
  }

  /*
   * Whole-level analysis: every position reachable from `start`, mapped to
   * its distance in pushes to a win, or -1 if the level can no longer be won
   * from there. Incremental, so the page can spread it over a few frames:
   * call run(budgetMs) until it returns true.
   */
  function Analysis(level, start, limit) {
    this.level = level;
    this.limit = limit || 150000;
    this.ids = new Map();
    this.keys = [];
    this.queue = [];
    this.edges = [];
    this.won = [];
    this.head = 0;
    this.done = false;
    this.complete = false;
    this.dist = null;
    this.add(start);
  }
  Analysis.prototype.add = function (st) {
    const k = canonKey(this.level, st);
    const have = this.ids.get(k);
    if (have !== undefined) return have;
    const id = this.keys.length;
    this.ids.set(k, id);
    this.keys.push(k);
    this.queue.push(st);
    this.won.push(L.isWon(this.level, st));
    return id;
  };
  Analysis.prototype.run = function (budgetMs) {
    if (this.done) return true;
    const t0 = Date.now();
    while (this.head < this.queue.length) {
      if (this.keys.length > this.limit) {
        this.done = true; this.complete = false; this.queue = null; this.edges = null;
        return true;
      }
      const h = this.head++;
      const st = this.queue[h];
      this.queue[h] = null;
      const es = [];
      if (!this.won[h] && !L.isHopeless(this.level, st)) {
        for (const p of pushes(this.level, st)) es.push(this.add(p.next));
      }
      this.edges[h] = es;
      if (budgetMs != null && (h & 31) === 0 && Date.now() - t0 > budgetMs) return false;
    }
    // distances to a win, by reverse breadth-first search
    const n = this.keys.length;
    const rev = Array.from({ length: n }, () => []);
    this.edges.forEach((es, i) => { for (const j of es) rev[j].push(i); });
    const d = new Int32Array(n).fill(-1);
    const q = [];
    for (let i = 0; i < n; i++) if (this.won[i]) { d[i] = 0; q.push(i); }
    for (let k = 0; k < q.length; k++) for (const j of rev[q[k]]) if (d[j] < 0) { d[j] = d[q[k]] + 1; q.push(j); }
    this.dist = d;
    this.queue = null;
    this.done = true;
    this.complete = true;
    return true;
  };
  Analysis.prototype.size = function () { return this.keys.length; };
  Analysis.prototype.deadShare = function () {
    if (!this.complete) return null;
    let dead = 0;
    for (let i = 0; i < this.dist.length; i++) if (this.dist[i] < 0) dead++;
    return dead / this.dist.length;
  };

  // Pushes still needed to win from st (0 = won), -1 if it can't be won, null if unknown.
  function distance(level, info, st) {
    if (L.isWon(level, st)) return 0;
    if (L.isHopeless(level, st)) return -1;
    if (info && info.complete) {
      const id = info.ids.get(canonKey(level, st));
      if (id !== undefined) return info.dist[id];
    }
    const r = solve(level, st, { limit: 40000 });
    return r.status === 'win' ? r.path.length : r.status === 'dead' ? -1 : null;
  }

  // Best next push from st: { from, dir, d, walk } with the shortest walk among
  // the pushes that bring the win closest, or null if no push leads to a win.
  function hint(level, info, st) {
    const reg = region(level, st);
    let best = null;
    for (const p of pushes(level, st, reg)) {
      const dd = distance(level, info, p.next);
      if (dd === null || dd < 0) continue;
      if (!best || dd < best.d || (dd === best.d && p.dist < best.walk)) best = { from: p.from, dir: p.dir, d: dd, walk: p.dist };
    }
    return best;
  }

  // Shortest walk (directions 0..3) from the keeper to cell index `to`, or null.
  function walkPath(level, st, to) {
    const reg = region(level, st);
    if (reg.dist[to] < 0) return null;
    const out = [];
    let cur = to;
    while (reg.dist[cur] > 0) {
      const x = cur % level.w, y = (cur / level.w) | 0;
      for (let d = 0; d < 4; d++) {
        const px = x - L.DX[d], py = y - L.DY[d];
        if (px < 0 || py < 0 || px >= level.w || py >= level.h) continue;
        const pi = py * level.w + px;
        if (reg.dist[pi] === reg.dist[cur] - 1) { out.unshift(d); cur = pi; break; }
      }
    }
    return out;
  }

  return { region, pushes, canonKey, solve, Analysis, distance, hint, walkPath };
});
