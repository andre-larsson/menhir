/*
 * Menhir - canvas renderer.
 *
 * Oblique "three-quarter" projection: screen x = x, screen y = y*K - z*HZ
 * (in tiles). Stones are drawn as real boxes so they can tip about an edge
 * during animation; only faces turned toward the viewer are filled.
 */
(function (root) {
  'use strict';
  const L = root.MenhirLogic;

  const K = 0.8;        // ground depth foreshortening
  const HZ = 0.47;      // screen height of one unit of z (in tiles)
  const WATER_Z = -0.42;
  const VIEW = norm([0, HZ, K]);
  const LIGHT = norm([-0.45, -0.35, 0.82]);

  // Durations (ms) - shared with main.js. `glide` is one tip of a frost slide.
  const TIMING = { walk: 110, roll: 190, topple: 240, rise: 240, glide: 150, sink: 520, bog: 600 };
  const RIM_T = 0.2;   // thickness of the dry-stone wall on the shore (tiles)
  const RIM_H = 0.3;   // its height (z units)

  const COL = {
    waterTop: '#25336f', waterBot: '#1a2450',
    ripple: 'rgba(170,185,255,0.16)',
    foam: 'rgba(190,205,255,0.20)',
    grassA: '#7f9f55', grassB: '#779850', grassEdge: '#90b062',
    cliff: '#6b4a32', cliffDark: '#4b3324',
    rockTop: '#7e7a70', rockSide: '#5c5850', rockMoss: '#6f8a48',
    stone: [186, 190, 198],        // plain stones: cool grey
    stoneM: [198, 192, 180],       // marked stones: warmer grey
    frostA: '#b4cddd', frostB: '#a9c4d6', frostEdge: 'rgba(235,248,255,0.45)',
    wallTop: [150, 145, 133], wallFace: [112, 106, 96],
    lantern: '#ffd27a', lanternCase: '#4a3a2a',
    ochre: [214, 150, 58],
    sun: [244, 197, 92],
    socket: '#b3ac9d', socketDeep: '#8a8476',
    bog: '#463a28', bogHi: '#5a4b31', bogDark: '#2f271b',
    earth: '#5e4a34',
    cloak: '#c45a2c', cloakDark: '#8f3d1d', cloakHi: '#dc7444',
    face: '#f0d2b0',
  };

  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { t = clamp(t, 0, 1); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); }
  // A single tip eases in and out; a frost slide builds speed on its first
  // tip, glides on at a steady pace and settles on its last one.
  function easeFor(kind, t) {
    t = clamp(t, 0, 1);
    if (kind === 'in') return t * t;
    if (kind === 'lin') return t;
    if (kind === 'out') return 1 - (1 - t) * (1 - t);
    return ease(t);
  }
  function hash(x, y, s) {
    let h = (x * 374761393 + y * 668265263 + (s || 0) * 982451653) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function rgb(c, k, a) {
    return `rgba(${Math.round(clamp(c[0] * k, 0, 255))},${Math.round(clamp(c[1] * k, 0, 255))},${Math.round(clamp(c[2] * k, 0, 255))},${a == null ? 1 : a})`;
  }
  function shadeOf(n) { return 0.56 + 0.46 * clamp(dot(n, LIGHT) * 0.5 + 0.5, 0, 1); }

  // Rotate vector v "toward" horizontal direction dir by angle th (radians):
  // at th = 90deg, up -> dir and dir -> down.
  function tipVec(v, dir, th) {
    const dx = L.DX[dir], dy = L.DY[dir];
    const a = v[0] * dx + v[1] * dy;
    const z = v[2];
    const px = v[0] - a * dx, py = v[1] - a * dy;
    const c = Math.cos(th), s = Math.sin(th);
    const a2 = a * c + z * s, z2 = -a * s + z * c;
    return [px + a2 * dx, py + a2 * dy, z2];
  }

  // Box geometry of a resting stone: center + axis columns.
  function stoneBox(s) {
    let cx = s.x + 0.5, cy = s.y + 0.5, cz = 1;
    if (L.isHoriz(s.m)) { cx += 0.5; cz = 0.5; }
    if (L.isVert(s.m)) { cy += 0.5; cz = 0.5; }
    const r = s.rot;
    return { c: [cx, cy, cz], ax: [r[0], r[1], r[2]], ay: [r[3], r[4], r[5]], az: [r[6], r[7], r[8]] };
  }

  // Box mid-roll: rotate the start box about its leading bottom edge.
  function rollingBox(from, dir, th) {
    const b = stoneBox(from);
    const dx = L.DX[dir], dy = L.DY[dir];
    // half extent along dir = |component of each local half axis along dir|
    const he = [0.5, 0.5, 1];
    const axes = [b.ax, b.ay, b.az];
    let ext = 0;
    for (let i = 0; i < 3; i++) ext += Math.abs(axes[i][0] * dx + axes[i][1] * dy) * he[i];
    const pivot = [b.c[0] + dx * ext, b.c[1] + dy * ext, 0];
    const rel = [b.c[0] - pivot[0], b.c[1] - pivot[1], b.c[2]];
    const r2 = tipVec(rel, dir, th);
    return {
      c: [pivot[0] + r2[0], pivot[1] + r2[1], r2[2]],
      ax: tipVec(b.ax, dir, th), ay: tipVec(b.ay, dir, th), az: tipVec(b.az, dir, th),
    };
  }

  const FACES = [
    // local normal, origin (in half-extent units), u, v  ; kind
    { n: [1, 0, 0], o: [1, -1, -1], u: [0, 2, 0], v: [0, 0, 2], kind: 'side', id: 0 },
    { n: [-1, 0, 0], o: [-1, 1, -1], u: [0, -2, 0], v: [0, 0, 2], kind: 'side', id: 1 },
    { n: [0, 1, 0], o: [1, 1, -1], u: [-2, 0, 0], v: [0, 0, 2], kind: 'side', id: 2 },
    { n: [0, -1, 0], o: [-1, -1, -1], u: [2, 0, 0], v: [0, 0, 2], kind: 'side', id: 3 },
    { n: [0, 0, 1], o: [-1, -1, 1], u: [2, 0, 0], v: [0, 2, 0], kind: 'mark', id: 4 },
    { n: [0, 0, -1], o: [-1, 1, -1], u: [2, 0, 0], v: [0, -2, 0], kind: 'base', id: 5 },
  ];

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1;
      this.W = 300; this.H = 150;
      this.T = 48; this.ox = 0; this.oy = 0;
      this.particles = [];
      this.sinkers = [];
      this.levelKey = null;
    }

    clearEffects() { this.particles = []; this.sinkers = []; this.beams = []; this.shakes = []; }

    resize(w, h, dpr) {
      this.W = w; this.H = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.levelKey = null; // force re-fit
    }

    measure(level) {
      // Fit the bounding box of land tiles, with a margin.
      let x0 = level.w, y0 = level.h, x1 = -1, y1 = -1;
      for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) {
        if (level.tiles[y * level.w + x] !== L.OUTSIDE) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
      const mx = 0.7, myTop = 1.25, myBot = 0.75;
      const bw = (x1 - x0 + 1) + mx * 2;
      const bh = (y1 - y0 + 1) * K + myTop + myBot;
      const T = Math.max(14, Math.floor(Math.min(this.W / bw, this.H / bh, 104)));
      const pw = (x1 - x0 + 1) * T;
      const ph = (y1 - y0 + 1) * K * T;
      return {
        T,
        bounds: { x0, y0, x1, y1 },
        ox: Math.round((this.W - pw) / 2 - x0 * T),
        oy: Math.round((this.H - ph) / 2 - y0 * K * T + (myTop - myBot) * T * 0.5),
      };
    }

    fit(level) {
      const m = this.measure(level);
      this.T = m.T; this.ox = m.ox; this.oy = m.oy; this.bounds = m.bounds;
    }

    P(x, y, z) { return [this.ox + x * this.T, this.oy + (y * K - z * HZ) * this.T]; }

    // ---------------------------------------------------------------- frame
    draw(g, now) {
      const ctx = this.ctx;
      const level = g.level;
      const key = g.levelIndex + ':' + g.rot + ':' + this.W + 'x' + this.H;
      if (key !== this.levelKey) { this.fit(level); this.levelKey = key; this.fireflies = null; }
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.now = now;
      const state = g.state;
      const anim = g.anim;
      const el = anim ? now - anim.start : Infinity;
      // While animating, terrain fills from bogs appear once the stone has sunk.
      const filledNow = this.visibleFilled(state, anim, el);

      this.drawWater(now, g.dawn);
      this.drawFireflies(now, g.dawn, false);

      // island intro: rise out of the water and fade in
      const iu = clamp((now - (g.intro || 0)) / 520, 0, 1);
      const ie = 1 - Math.pow(1 - iu, 3);
      const [shx, shy] = this.shakeOffset(now);
      ctx.save();
      ctx.translate(shx, shy + (1 - ie) * this.T * 0.7);
      ctx.globalAlpha = 0.15 + 0.85 * ie;

      this.drawIsland(level, state, filledNow, now);
      const walls = this.wallSegs(level);
      for (const wseg of walls) if (wseg.side !== 'S') this.drawWall(wseg);
      this.drawSockets(level, state, anim, el, now, g.dawn);
      if (g.hint) this.drawHint(g.hint, now);
      if (g.hover) this.drawHover(g.hover, state);

      // Collect drawables, sort by depth (row of the southern edge), then draw.
      const items = [];
      for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) {
        if (level.tiles[y * level.w + x] === L.ROCK) items.push({ depth: y + 1, x, kind: 'rock', tx: x, ty: y });
      }
      for (const wseg of walls) if (wseg.side === 'S') items.push({ depth: wseg.y1 - 0.05, x: wseg.x0, kind: 'wall', seg: wseg });
      this.collectStones(state, anim, el, items);
      const pl = this.playerPose(state, anim, el, g);
      items.push({ depth: pl.y + 1.0, x: pl.x, kind: 'player', pose: pl });
      items.sort((a, b) => a.depth - b.depth || a.x - b.x);
      let afterPlayer = false, occluded = false;
      for (const it of items) {
        if (it.kind === 'rock') this.drawRock(it.tx, it.ty);
        else if (it.kind === 'wall') this.drawWall(it.seg);
        else if (it.kind === 'stone') { this.drawStone(it); if (afterPlayer && Math.abs(it.x - (pl.x + 0.5)) < 1.6) occluded = true; }
        else { this.drawPlayer(it.pose, now, false); afterPlayer = true; }
      }
      // x-ray silhouette so the keeper stays readable behind tall stones
      if (occluded) this.drawPlayer(pl, now, true);
      if (g.showPreviews && g.showPreviews.length) this.drawPreviews(g.showPreviews, level, now - g.idleSince);
      this.drawParticles(now);
      this.drawBeams(now);
      if (g.dawn > 0) this.drawDawn(level, state, g.dawn, now);
      ctx.restore();
      this.drawFireflies(now, g.dawn, true);
    }

    // ---------------------------------------------------------------- input mapping
    screenToTile(sx, sy) {
      return [Math.floor((sx - this.ox) / this.T), Math.floor((sy - this.oy) / (this.T * K))];
    }
    tileToScreen(x, y) { return this.P(x + 0.5, y + 0.5, 0); }

    // ---------------------------------------------------------------- shake
    shake(amp, delay) {
      this.shakes = this.shakes || [];
      this.shakes.push({ at: performance.now() + (delay || 0), amp });
    }
    shakeOffset(now) {
      if (!this.shakes || !this.shakes.length) return [0, 0];
      let x = 0, y = 0;
      this.shakes = this.shakes.filter((k) => now - k.at < 260);
      for (const k of this.shakes) {
        const t = (now - k.at) / 260;
        if (t < 0) continue;
        const a = k.amp * (1 - t) * (1 - t);
        x += Math.sin(now / 17 + k.at) * a * 0.6;
        y += Math.cos(now / 13 + k.at) * a;
      }
      return [x, y];
    }

    // ---------------------------------------------------------------- beams (stone set)
    beam(x, y, delay) {
      this.beams = this.beams || [];
      this.beams.push({ x, y, at: performance.now() + (delay || 0) });
    }
    drawBeams(now) {
      if (!this.beams || !this.beams.length) return;
      const ctx = this.ctx, T = this.T;
      this.beams = this.beams.filter((b) => now - b.at < 1100);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const b of this.beams) {
        const t = (now - b.at) / 1100;
        if (t < 0) continue;
        const grow = easeOut(Math.min(1, t * 4));
        const fade = 1 - t;
        const [cx, cy] = this.P(b.x, b.y, 2);
        const h = T * 5 * grow;
        const w = T * (0.55 - 0.25 * t);
        const gr = ctx.createLinearGradient(0, cy - h, 0, cy);
        gr.addColorStop(0, 'rgba(255,215,130,0)');
        gr.addColorStop(1, `rgba(255,215,130,${0.55 * fade})`);
        ctx.fillStyle = gr;
        ctx.fillRect(cx - w / 2, cy - h, w, h);
        // ground ring
        const [gx, gy] = this.P(b.x, b.y, 0);
        ctx.strokeStyle = `rgba(255,220,140,${0.8 * fade})`;
        ctx.lineWidth = Math.max(1.5, T * 0.05);
        ctx.beginPath();
        ctx.ellipse(gx, gy, T * (0.4 + t * 1.3), T * (0.4 + t * 1.3) * K, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---------------------------------------------------------------- fireflies
    drawFireflies(now, dawn, front) {
      const ctx = this.ctx, T = this.T, b = this.bounds;
      if (!b) return;
      if (!this.fireflies) {
        this.fireflies = [];
        const n = 14;
        for (let i = 0; i < n; i++) this.fireflies.push({
          x: b.x0 - 1 + Math.random() * (b.x1 - b.x0 + 3), y: b.y0 - 1 + Math.random() * (b.y1 - b.y0 + 3),
          z: 0.6 + Math.random() * 1.8, ph: Math.random() * 100, sp: 0.4 + Math.random() * 0.6, front: i % 2 === 0,
        });
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const f of this.fireflies) {
        if (f.front !== front) continue;
        const t = now / 1000 * f.sp + f.ph;
        const x = f.x + Math.sin(t * 0.7) * 0.9 + Math.sin(t * 1.9) * 0.2;
        const y = f.y + Math.cos(t * 0.5) * 0.7;
        const z = f.z + Math.sin(t * 1.3) * 0.3;
        const blink = Math.max(0, Math.sin(t * 2.3 + f.ph));
        const a = (0.15 + 0.6 * blink) * (1 - dawn * 0.7);
        if (a < 0.02) continue;
        const [sx, sy] = this.P(x, y, z);
        const r = T * 0.16;
        const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        gr.addColorStop(0, `rgba(255,240,170,${a})`);
        gr.addColorStop(0.25, `rgba(230,240,140,${a * 0.5})`);
        gr.addColorStop(1, 'rgba(200,230,120,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // ---------------------------------------------------------------- hover path (walk-to)
    drawHover(h, state) {
      const ctx = this.ctx, T = this.T;
      if (!h.ok) return;
      ctx.save();
      ctx.fillStyle = 'rgba(255,232,175,0.85)';
      let last = null;
      for (const [x, y] of h.cells.slice(0, -1)) {
        if (last && last[0] === x && last[1] === y) continue; // turning on the spot
        last = [x, y];
        const [sx, sy] = this.P(x + 0.5, y + 0.5, 0);
        ctx.beginPath(); ctx.ellipse(sx, sy, T * 0.085, T * 0.085 * K, 0, 0, Math.PI * 2); ctx.fill();
      }
      const [tx, ty] = this.P(h.x + 0.5, h.y + 0.5, 0);
      ctx.strokeStyle = 'rgba(255,230,170,0.85)';
      ctx.lineWidth = Math.max(1.5, T * 0.04);
      ctx.beginPath(); ctx.ellipse(tx, ty, T * 0.3, T * 0.3 * K, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // ---------------------------------------------------------------- push previews
    drawPreviews(list, level, idleMs) {
      const ctx = this.ctx;
      const fade = clamp((idleMs - 90) / 220, 0, 1);
      if (fade <= 0) return;
      ctx.save();
      for (const p of list) {
        // Every stone this push would move, at the pose it comes to rest in,
        // with a dotted trail through its tips when frost carries it further.
        const byStone = new Map();
        for (const e of p.rolls) {
          if (!byStone.has(e.stone)) byStone.set(e.stone, []);
          byStone.get(e.stone).push(e);
        }
        let badgeAt = null;
        for (const evs of byStone.values()) {
          evs.sort((a, b) => a.wave - b.wave);
          const last = evs[evs.length - 1];
          if (evs.length > 1 || evs[0].depth > 0) this.drawTrail(evs, fade);
          const box = stoneBox(last.to);
          let col = [235, 240, 255];
          const rest = { x: last.to.x, y: last.to.y, m: last.to.m, k: last.to.k, sunk: false };
          const onSocket = L.isStanding(rest.m) && level.tiles[rest.y * level.w + rest.x] === L.SOCKET;
          if (!last.fate && L.stoneSet(level, rest)) col = [255, 210, 110];
          else if (!last.fate && onSocket) col = [255, 140, 165];
          if (last.fate === 'sink') { col = [140, 190, 255]; box.c = [box.c[0], box.c[1], box.c[2] + WATER_Z]; }
          if (last.fate === 'bog') col = [200, 160, 100];
          this.drawGhostBox(box, col, fade, last.fate, last.to.k);
          if (evs[0].wave === 0 && evs[0].depth === 0) badgeAt = box;
        }
        if (badgeAt) this.drawKeyBadge(badgeAt, p.dir, fade);
      }
      ctx.restore();
    }

    drawTrail(evs, fade) {
      const ctx = this.ctx, T = this.T;
      const pts = [stoneBox(evs[0].from).c].concat(evs.map((e) => stoneBox(e.to).c)).map((c) => this.P(c[0], c[1], 0.04));
      ctx.save();
      ctx.strokeStyle = `rgba(215,235,255,${0.55 * fade})`;
      ctx.lineWidth = Math.max(1.2, T * 0.035);
      ctx.setLineDash([T * 0.05, T * 0.07]);
      ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(215,235,255,${0.75 * fade})`;
      for (let i = 1; i < pts.length - 1; i++) {
        ctx.beginPath(); ctx.ellipse(pts[i][0], pts[i][1], T * 0.06, T * 0.06 * K, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    drawGhostBox(b, col, fade, fate, kind) {
      const ctx = this.ctx, T = this.T;
      const E = [0.47, 0.47, 0.97];
      const toW = (l) => [
        b.c[0] + b.ax[0] * l[0] * E[0] + b.ay[0] * l[1] * E[1] + b.az[0] * l[2] * E[2],
        b.c[1] + b.ax[1] * l[0] * E[0] + b.ay[1] * l[1] * E[1] + b.az[1] * l[2] * E[2],
        b.c[2] + b.ax[2] * l[0] * E[0] + b.ay[2] * l[1] * E[1] + b.az[2] * l[2] * E[2],
      ];
      const dirW = (l) => [
        b.ax[0] * l[0] + b.ay[0] * l[1] + b.az[0] * l[2],
        b.ax[1] * l[0] + b.ay[1] * l[1] + b.az[1] * l[2],
        b.ax[2] * l[0] + b.ay[2] * l[1] + b.az[2] * l[2],
      ];
      const pulse = 0.85 + 0.15 * Math.sin(this.now / 300);
      ctx.lineWidth = Math.max(1, T * 0.028);
      ctx.setLineDash([T * 0.09, T * 0.06]);
      ctx.lineJoin = 'round';
      for (const f of FACES) {
        const n = dirW(f.n);
        if (dot(n, VIEW) <= 1e-4) continue;
        const o = toW(f.o);
        const pu = toW([f.o[0] + f.u[0], f.o[1] + f.u[1], f.o[2] + f.u[2]]);
        const pv = toW([f.o[0] + f.v[0], f.o[1] + f.v[1], f.o[2] + f.v[2]]);
        const [x0, y0] = this.P(o[0], o[1], o[2]);
        const [x1, y1] = this.P(pu[0], pu[1], pu[2]);
        const [x2, y2] = this.P(pv[0], pv[1], pv[2]);
        ctx.beginPath();
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1 + x2 - x0, y1 + y2 - y0); ctx.lineTo(x2, y2); ctx.closePath();
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.1 * fade * pulse})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.75 * fade * pulse})`;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // where the sun mark would be (marked stones only)
      if (kind === 'm') {
        const m = toW([0, 0, 1]);
        const [mx, my] = this.P(m[0], m[1], m[2]);
        const up = b.az[2] > 0.5;
        ctx.fillStyle = `rgba(255,205,95,${(up ? 0.95 : 0.55) * fade})`;
        ctx.beginPath(); ctx.arc(mx, my, Math.max(2, T * (up ? 0.09 : 0.06)), 0, Math.PI * 2); ctx.fill();
      }
      if (fate === 'sink') {
        const c = this.P(b.c[0], b.c[1], WATER_Z + 0.05);
        ctx.strokeStyle = `rgba(150,200,255,${0.7 * fade})`;
        ctx.beginPath(); ctx.ellipse(c[0], c[1], T * 0.6, T * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }

    drawKeyBadge(b, dir, fade) {
      // small arrow showing which direction key makes this push
      const ctx = this.ctx, T = this.T;
      let top = -1e9;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const z = b.c[2] + b.ax[2] * sx * 0.5 + b.ay[2] * sy * 0.5 + b.az[2] * sz;
        top = Math.max(top, z);
      }
      const [cx, cy0] = this.P(b.c[0], b.c[1], top);
      const r = Math.max(9, T * 0.17);
      const cy = cy0 - r - T * 0.08;
      ctx.fillStyle = `rgba(20,26,52,${0.82 * fade})`;
      ctx.strokeStyle = `rgba(255,230,170,${0.9 * fade})`;
      ctx.lineWidth = Math.max(1, T * 0.025);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const ang = Math.atan2(L.DY[dir], L.DX[dir]);
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(ang);
      ctx.strokeStyle = `rgba(255,236,190,${fade})`;
      ctx.lineWidth = Math.max(1.5, r * 0.22);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-r * 0.45, 0); ctx.lineTo(r * 0.45, 0);
      ctx.moveTo(r * 0.1, -r * 0.35); ctx.lineTo(r * 0.45, 0); ctx.lineTo(r * 0.1, r * 0.35);
      ctx.stroke();
      ctx.restore();
    }

    visibleFilled(state, anim, el) {
      // bog tiles look filled only once the stone has mostly sunk
      const pending = new Set();
      for (const k of this.sinkers) if (k.fate === 'bog' && this.now < k.at + k.dur * 0.6) for (const i of k.fillCells) pending.add(i);
      return pending.size ? state.filled.filter((i) => !pending.has(i)) : state.filled;
    }

    // ---------------------------------------------------------------- water
    drawWater(now, dawn) {
      const ctx = this.ctx;
      const gr = ctx.createLinearGradient(0, 0, 0, this.H);
      gr.addColorStop(0, COL.waterTop);
      gr.addColorStop(1, COL.waterBot);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, this.W, this.H);
      if (dawn > 0) {
        const g2 = ctx.createRadialGradient(this.W / 2, this.H * 1.05, 10, this.W / 2, this.H * 1.05, Math.max(this.W, this.H) * 0.9);
        g2.addColorStop(0, `rgba(255,190,110,${0.38 * dawn})`);
        g2.addColorStop(0.5, `rgba(240,140,120,${0.16 * dawn})`);
        g2.addColorStop(1, 'rgba(240,140,120,0)');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, this.W, this.H);
      }
      // gentle ripples
      const T = this.T;
      ctx.strokeStyle = COL.ripple;
      ctx.lineWidth = Math.max(1, T * 0.03);
      ctx.lineCap = 'round';
      const cols = Math.ceil(this.W / T) + 2, rows = Math.ceil(this.H / (T * K)) + 2;
      const gx0 = Math.floor(-this.ox / T) - 1, gy0 = Math.floor(-this.oy / (T * K)) - 1;
      ctx.beginPath();
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const gx = gx0 + i, gy = gy0 + j;
        const h = hash(gx, gy, 7);
        if (h > 0.3) continue;
        const ph = now / 1000 * (0.5 + h) + h * 40;
        const len = (0.18 + 0.2 * hash(gx, gy, 9)) * T * (0.6 + 0.4 * Math.sin(ph));
        const [sx, sy] = this.P(gx + hash(gx, gy, 3), gy + hash(gx, gy, 4), WATER_Z);
        const drift = Math.sin(ph * 0.7) * T * 0.08;
        ctx.moveTo(sx - len / 2 + drift, sy);
        ctx.lineTo(sx + len / 2 + drift, sy);
      }
      ctx.stroke();
    }

    // ---------------------------------------------------------------- island
    land(level, x, y) {
      if (x < 0 || y < 0 || x >= level.w || y >= level.h) return false;
      const t = level.tiles[y * level.w + x];
      return t !== L.OUTSIDE && t !== L.WATER;
    }
    outside(level, x, y) {
      if (x < 0 || y < 0 || x >= level.w || y >= level.h) return true;
      return level.tiles[y * level.w + x] === L.OUTSIDE;
    }

    tilePath(level, x, y, z, grow) {
      // Rounded rectangle; corners round only where the island turns outward
      // into open water. Along the walled shore the top extends under the wall.
      const ctx = this.ctx, T = this.T;
      const r = T * 0.32;
      const lw = (dx, dy) => this.land(level, x + dx, y + dy);
      const ow = (dx, dy) => this.outside(level, x + dx, y + dy);
      const round = (dx, dy) => !lw(dx, 0) && !lw(0, dy) && !(ow(dx, 0) || ow(0, dy)) ? r : 0;
      const rNW = round(-1, -1), rNE = round(1, -1), rSE = round(1, 1), rSW = round(-1, 1);
      const [ax, ay] = this.P(x, y, z);
      const w = T, h = T * K;
      const wt = RIM_T * T;
      const gside = (dx, dy) => lw(dx, dy) ? 0 : ow(dx, dy) ? wt + grow : grow;
      const gl = gside(-1, 0), gr = gside(1, 0), gt = gside(0, -1), gb = gside(0, 1);
      const X0 = ax - gl, X1 = ax + w + gr, Y0 = ay - gt * K, Y1 = ay + h + gb * K;
      const k = K;
      ctx.moveTo(X0 + rNW, Y0);
      ctx.lineTo(X1 - rNE, Y0);
      if (rNE) ctx.ellipse(X1 - rNE, Y0 + rNE * k, rNE, rNE * k, 0, -Math.PI / 2, 0); else ctx.lineTo(X1, Y0);
      ctx.lineTo(X1, Y1 - rSE * k);
      if (rSE) ctx.ellipse(X1 - rSE, Y1 - rSE * k, rSE, rSE * k, 0, 0, Math.PI / 2); else ctx.lineTo(X1, Y1);
      ctx.lineTo(X0 + rSW, Y1);
      if (rSW) ctx.ellipse(X0 + rSW, Y1 - rSW * k, rSW, rSW * k, 0, Math.PI / 2, Math.PI); else ctx.lineTo(X0, Y1);
      ctx.lineTo(X0, Y0 + rNW * k);
      if (rNW) ctx.ellipse(X0 + rNW, Y0 + rNW * k, rNW, rNW * k, 0, Math.PI, Math.PI * 1.5); else ctx.lineTo(X0, Y0);
      ctx.closePath();
    }

    drawIsland(level, state, filled, now) {
      const ctx = this.ctx, T = this.T;
      const cliffH = -WATER_Z * HZ * T;
      // foam halo
      ctx.fillStyle = COL.foam;
      ctx.beginPath();
      for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) {
        if (!this.land(level, x, y)) continue;
        this.tilePath(level, x, y, WATER_Z, T * (0.13 + 0.03 * Math.sin(now / 900 + x + y)));
      }
      ctx.fill();
      // cliffs: extrude each shoreline tile down to the water
      for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) {
        if (!this.land(level, x, y) || this.land(level, x, y + 1)) continue;
        const [ax, ay] = this.P(x, y + 1 + (this.outside(level, x, y + 1) ? RIM_T : 0), 0);
        const gr = ctx.createLinearGradient(0, ay - T * 0.3, 0, ay + cliffH);
        gr.addColorStop(0, COL.cliff);
        gr.addColorStop(1, COL.cliffDark);
        ctx.fillStyle = gr;
        ctx.beginPath();
        this.tilePath(level, x, y, WATER_Z, 0);
        ctx.fill();
        ctx.beginPath();
        const r = T * 0.32;
        const l = this.land(level, x - 1, y) ? 0 : r, rr = this.land(level, x + 1, y) ? 0 : r;
        ctx.rect(ax, ay - T * K * 0.5, T, cliffH + T * K * 0.5 - Math.max(l, rr) * K * 0.2);
        ctx.fill();
        // pebbles at the waterline
        for (let i = 0; i < 2; i++) {
          if (hash(x, y, 20 + i) > 0.55) continue;
          const px = ax + T * (0.15 + 0.7 * hash(x, y, 30 + i));
          ctx.fillStyle = 'rgba(140,135,125,0.9)';
          ctx.beginPath();
          ctx.ellipse(px, ay + cliffH - T * 0.02, T * 0.07, T * 0.04, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // tops
      for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) {
        const i = y * level.w + x;
        const t = level.tiles[i];
        if (t === L.WATER || t === L.OUTSIDE) continue;
        let fill;
        if (t === L.BOG) fill = filled.indexOf(i) >= 0 ? COL.earth : COL.bog;
        else fill = (x + y) % 2 ? COL.grassA : COL.grassB;
        ctx.fillStyle = fill;
        ctx.beginPath();
        this.tilePath(level, x, y, 0, 0);
        ctx.fill();
        if (t === L.BOG) {
          if (filled.indexOf(i) >= 0) this.drawFilledBog(x, y);
          else this.drawBog(x, y, now);
        } else if (t === L.FROST) {
          this.drawFrost(x, y, now);
        } else if (t === L.GROUND || t === L.ROCK) {
          this.drawGrassDetail(x, y);
        }
        if (t !== L.BOG) this.drawReeds(level, x, y);
      }
      // light rim along north edges for a soft bevel
      ctx.strokeStyle = 'rgba(200,230,150,0.25)';
      ctx.lineWidth = Math.max(1, T * 0.035);
      ctx.beginPath();
      for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) {
        if (!this.land(level, x, y) || this.land(level, x, y - 1) || this.outside(level, x, y - 1)) continue;
        const [ax, ay] = this.P(x, y, 0);
        const l = this.land(level, x - 1, y) ? 0 : T * 0.3, r = this.land(level, x + 1, y) ? 0 : T * 0.3;
        ctx.moveTo(ax + l, ay + 1);
        ctx.lineTo(ax + T - r, ay + 1);
      }
      ctx.stroke();
    }

    drawGrassDetail(x, y) {
      const ctx = this.ctx, T = this.T;
      const n = Math.floor(hash(x, y, 1) * 3);
      for (let i = 0; i < n; i++) {
        const u = 0.15 + 0.7 * hash(x, y, 40 + i), v = 0.15 + 0.7 * hash(x, y, 50 + i);
        const [sx, sy] = this.P(x + u, y + v, 0);
        ctx.strokeStyle = 'rgba(70,100,45,0.55)';
        ctx.lineWidth = Math.max(1, T * 0.025);
        ctx.beginPath();
        ctx.moveTo(sx - T * 0.04, sy); ctx.lineTo(sx - T * 0.06, sy - T * 0.08);
        ctx.moveTo(sx, sy); ctx.lineTo(sx + T * 0.005, sy - T * 0.1);
        ctx.moveTo(sx + T * 0.04, sy); ctx.lineTo(sx + T * 0.07, sy - T * 0.07);
        ctx.stroke();
      }
      if (hash(x, y, 2) < 0.22) {
        const u = 0.2 + 0.6 * hash(x, y, 60), v = 0.2 + 0.6 * hash(x, y, 61);
        const [sx, sy] = this.P(x + u, y + v, 0);
        ctx.fillStyle = hash(x, y, 62) < 0.5 ? 'rgba(245,240,225,0.9)' : 'rgba(240,200,110,0.9)';
        const r = T * 0.028;
        for (let k = 0; k < 4; k++) {
          ctx.beginPath();
          ctx.arc(sx + Math.cos(k * 1.57) * r, sy + Math.sin(k * 1.57) * r * K, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    drawBog(x, y, now) {
      const ctx = this.ctx, T = this.T;
      ctx.fillStyle = COL.bogHi;
      for (let i = 0; i < 3; i++) {
        const [sx, sy] = this.P(x + 0.2 + 0.6 * hash(x, y, 70 + i), y + 0.2 + 0.6 * hash(x, y, 80 + i), 0);
        ctx.beginPath();
        ctx.ellipse(sx, sy, T * (0.1 + 0.08 * hash(x, y, 90 + i)), T * 0.06 * K, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // bubbles
      for (let i = 0; i < 2; i++) {
        const per = 2200 + 900 * hash(x, y, 100 + i);
        const t = ((now + hash(x, y, 110 + i) * per) % per) / per;
        if (t > 0.4) continue;
        const [sx, sy] = this.P(x + 0.25 + 0.5 * hash(x, y, 120 + i), y + 0.25 + 0.5 * hash(x, y, 130 + i), 0);
        ctx.strokeStyle = `rgba(150,140,100,${0.7 * (1 - t / 0.4)})`;
        ctx.lineWidth = Math.max(1, T * 0.02);
        ctx.beginPath();
        ctx.ellipse(sx, sy, T * 0.05 * (0.4 + t * 2), T * 0.05 * (0.4 + t * 2) * K, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(30,22,12,0.35)';
      ctx.lineWidth = Math.max(1, T * 0.03);
      ctx.beginPath();
      const [ax, ay] = this.P(x, y, 0);
      ctx.rect(ax + T * 0.06, ay + T * K * 0.06, T * 0.88, T * K * 0.88);
      ctx.stroke();
    }

    drawFilledBog(x, y) {
      const ctx = this.ctx, T = this.T;
      const [ax, ay] = this.P(x, y, 0);
      const pad = T * 0.1;
      ctx.fillStyle = rgb(COL.stone, 0.8);
      roundRect(ctx, ax + pad, ay + pad * K, T - pad * 2, (T - pad * 2) * K, T * 0.08);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,30,20,0.45)';
      ctx.lineWidth = Math.max(1, T * 0.025);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(ax + pad * 1.6, ay + pad * K * 1.6);
      ctx.lineTo(ax + T - pad * 1.6, ay + pad * K * 1.6);
      ctx.stroke();
    }

    // ---------------------------------------------------------------- walled shore
    // Low dry-stone walls along every edge between the island and the lake.
    // Each segment is a box just outside the tile edge; corners are covered by
    // extending north/south segments sideways.
    wallSegs(level) {
      if (this._wallsFor === level) return this._walls;
      const segs = [];
      const out = (x, y) => this.outside(level, x, y);
      for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) {
        if (out(x, y)) continue;
        const ew = out(x - 1, y) ? RIM_T : 0, ee = out(x + 1, y) ? RIM_T : 0;
        if (out(x, y - 1)) segs.push({ side: 'N', x0: x - ew, x1: x + 1 + ee, y0: y - RIM_T, y1: y, sx: x, sy: y });
        if (out(x, y + 1)) segs.push({ side: 'S', x0: x - ew, x1: x + 1 + ee, y0: y + 1, y1: y + 1 + RIM_T, sx: x, sy: y });
        if (out(x - 1, y)) segs.push({ side: 'W', x0: x - RIM_T, x1: x, y0: y, y1: y + 1, sx: x, sy: y });
        if (out(x + 1, y)) segs.push({ side: 'E', x0: x + 1, x1: x + 1 + RIM_T, y0: y, y1: y + 1, sx: x, sy: y });
      }
      this._wallsFor = level;
      this._walls = segs;
      return segs;
    }

    drawWall(w) {
      const ctx = this.ctx, T = this.T;
      const top = [this.P(w.x0, w.y0, RIM_H), this.P(w.x1, w.y0, RIM_H), this.P(w.x1, w.y1, RIM_H), this.P(w.x0, w.y1, RIM_H)];
      const fb0 = this.P(w.x0, w.y1, 0), fb1 = this.P(w.x1, w.y1, 0);
      // south-facing front
      ctx.fillStyle = rgb(COL.wallFace, 1);
      ctx.beginPath();
      ctx.moveTo(top[3][0], top[3][1]); ctx.lineTo(top[2][0], top[2][1]); ctx.lineTo(fb1[0], fb1[1]); ctx.lineTo(fb0[0], fb0[1]);
      ctx.closePath(); ctx.fill();
      // coursed stones on the front: two courses with staggered joints
      const fh = fb0[1] - top[3][1];
      if (w.x1 - w.x0 > 0.5 && fh > 2) {
        ctx.strokeStyle = 'rgba(40,36,30,0.45)';
        ctx.lineWidth = Math.max(1, T * 0.018);
        ctx.beginPath();
        ctx.moveTo(fb0[0], top[3][1] + fh * 0.5); ctx.lineTo(fb1[0], top[3][1] + fh * 0.5);
        for (let c = 0; c < 2; c++) {
          let u = w.x0 + (c ? 0.12 : 0.3) * hash(w.sx, w.sy, 300 + c);
          while (u < w.x1 - 0.12) {
            const px = this.P(u, w.y1, 0)[0];
            const yA = top[3][1] + fh * (c ? 0.5 : 0), yB = top[3][1] + fh * (c ? 1 : 0.5);
            ctx.moveTo(px, yA); ctx.lineTo(px, yB);
            u += 0.24 + 0.16 * hash(Math.round(u * 10), w.sy + c, 310 + w.sx);
          }
        }
        ctx.stroke();
        // a little light on the upper course
        ctx.fillStyle = 'rgba(255,240,215,0.07)';
        ctx.fillRect(fb0[0], top[3][1], fb1[0] - fb0[0], fh * 0.5);
      }
      // top
      ctx.fillStyle = rgb(COL.wallTop, 1);
      ctx.beginPath();
      top.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(40,36,30,0.4)';
      ctx.lineWidth = Math.max(1, T * 0.02);
      ctx.stroke();
      // capstones and moss
      const len = Math.max(w.x1 - w.x0, w.y1 - w.y0);
      const n = Math.max(1, Math.round(len / 0.34));
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        const cx = w.side === 'N' || w.side === 'S' ? w.x0 + (w.x1 - w.x0) * f : (w.x0 + w.x1) / 2;
        const cy = w.side === 'N' || w.side === 'S' ? (w.y0 + w.y1) / 2 : w.y0 + (w.y1 - w.y0) * f;
        const [px, py] = this.P(cx, cy, RIM_H);
        const hv = hash(w.sx * 7 + k, w.sy, 320);
        ctx.fillStyle = hv < 0.25 ? 'rgba(111,138,72,0.85)' : `rgba(${168 + hv * 20},${162 + hv * 18},${150 + hv * 14},0.9)`;
        ctx.beginPath();
        ctx.ellipse(px, py, T * (0.1 + 0.04 * hv), T * 0.06 * K, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ---------------------------------------------------------------- frost
    drawFrost(x, y, now) {
      const ctx = this.ctx, T = this.T;
      const [ax, ay] = this.P(x, y, 0);
      ctx.fillStyle = (x + y) % 2 ? COL.frostA : COL.frostB;
      ctx.fillRect(ax, ay, T, T * K);
      // sheen
      const gr = ctx.createLinearGradient(ax, ay, ax + T, ay + T * K);
      gr.addColorStop(0, 'rgba(255,255,255,0.22)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0)');
      gr.addColorStop(1, 'rgba(120,160,200,0.12)');
      ctx.fillStyle = gr;
      ctx.fillRect(ax, ay, T, T * K);
      // cracks
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = Math.max(1, T * 0.018);
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const u = 0.1 + 0.8 * hash(x, y, 400 + k), v = 0.1 + 0.8 * hash(x, y, 410 + k);
        const [p0x, p0y] = this.P(x + u, y + v, 0);
        const [p1x, p1y] = this.P(x + u + (hash(x, y, 420 + k) - 0.5) * 0.5, y + v + (hash(x, y, 430 + k) - 0.5) * 0.5, 0);
        ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y);
      }
      ctx.stroke();
      // frame, so frost reads as its own surface
      ctx.strokeStyle = COL.frostEdge;
      ctx.strokeRect(ax + T * 0.04, ay + T * K * 0.04, T * 0.92, T * K * 0.92);
      // glints
      for (let k = 0; k < 2; k++) {
        const tw = 0.5 + 0.5 * Math.sin(now / 520 + hash(x, y, 440 + k) * 6.28);
        if (tw < 0.6) continue;
        const [cx, cy] = this.P(x + 0.15 + 0.7 * hash(x, y, 450 + k), y + 0.15 + 0.7 * hash(x, y, 460 + k), 0);
        const r = T * 0.07 * tw;
        ctx.strokeStyle = `rgba(255,255,255,${0.9 * tw})`;
        ctx.beginPath();
        ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
        ctx.moveTo(cx, cy - r * 0.8); ctx.lineTo(cx, cy + r * 0.8);
        ctx.stroke();
      }
    }

    // Reeds on banks that face an open-water pool (no wall there).
    drawReeds(level, x, y) {
      const ctx = this.ctx, T = this.T;
      for (let d = 0; d < 4; d++) {
        const nx = x + L.DX[d], ny = y + L.DY[d];
        if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h || level.tiles[ny * level.w + nx] !== L.WATER) continue;
        ctx.strokeStyle = 'rgba(70,96,52,0.9)';
        ctx.lineWidth = Math.max(1, T * 0.022);
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const t = 0.2 + 0.6 * hash(x * 4 + d, y, 470 + k);
          const ex = d === 1 ? 0.9 : d === 3 ? 0.1 : t, ey = d === 2 ? 0.9 : d === 0 ? 0.1 : t;
          const [bx, by] = this.P(x + ex, y + ey, 0);
          const hgt = T * (0.16 + 0.1 * hash(x, y * 4 + d, 480 + k));
          ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + T * 0.02, by - hgt * 0.6, bx + T * 0.05 * (hash(x, y, 490 + k) - 0.3), by - hgt);
        }
        ctx.stroke();
      }
    }

    // ---------------------------------------------------------------- hint
    drawHint(h, now) {
      const ctx = this.ctx, T = this.T;
      const p = 0.6 + 0.4 * Math.sin(now / 240);
      const [cx, cy] = this.P(h.x + 0.5, h.y + 0.5, 0);
      ctx.save();
      ctx.strokeStyle = `rgba(150,230,255,${0.55 + 0.4 * p})`;
      ctx.fillStyle = `rgba(150,230,255,${0.12 + 0.1 * p})`;
      ctx.lineWidth = Math.max(2, T * 0.05);
      ctx.beginPath(); ctx.ellipse(cx, cy, T * 0.36, T * 0.36 * K, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // arrow pointing the way to push
      const dx = L.DX[h.dir], dy = L.DY[h.dir];
      const [tx, ty] = this.P(h.x + 0.5 + dx * 0.95, h.y + 0.5 + dy * 0.95, 0.05);
      const [bx, by] = this.P(h.x + 0.5 + dx * 0.45, h.y + 0.5 + dy * 0.45, 0.05);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2.5, T * 0.07);
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(tx, ty);
      const ang = Math.atan2(ty - by, tx - bx), hl = T * 0.2;
      ctx.moveTo(tx - Math.cos(ang - 0.6) * hl, ty - Math.sin(ang - 0.6) * hl); ctx.lineTo(tx, ty);
      ctx.lineTo(tx - Math.cos(ang + 0.6) * hl, ty - Math.sin(ang + 0.6) * hl);
      ctx.stroke();
      ctx.restore();
    }

    // ---------------------------------------------------------------- sockets
    drawSockets(level, state, anim, el, now, dawn) {
      const ctx = this.ctx, T = this.T;
      const busy = anim && el < anim.dur;
      const status = L.socketStatus(level, state);
      level.sockets.forEach((i, k) => {
        const x = i % level.w, y = Math.floor(i / level.w);
        const [cx, cy] = this.P(x + 0.5, y + 0.5, 0);
        const st = busy ? 'empty' : status[k];
        const R = T * 0.42;
        if (st === 'set') {
          const pulse = 0.75 + 0.25 * Math.sin(now / 420 + k);
          const gl = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.9);
          gl.addColorStop(0, `rgba(255,214,120,${0.55 * pulse})`);
          gl.addColorStop(1, 'rgba(255,214,120,0)');
          ctx.fillStyle = gl;
          ctx.beginPath();
          ctx.ellipse(cx, cy, R * 1.9, R * 1.9 * K, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // carved disc
        ctx.fillStyle = COL.socketDeep;
        ctx.beginPath(); ctx.ellipse(cx, cy + T * 0.02, R, R * K, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = COL.socket;
        ctx.beginPath(); ctx.ellipse(cx, cy, R, R * K, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = st === 'set' ? '#e6b955' : st === 'wrong' ? '#8c6f84' : '#9a9384';
        ctx.beginPath(); ctx.ellipse(cx, cy, R * 0.74, R * 0.74 * K, 0, 0, Math.PI * 2); ctx.fill();
        // engraved sun
        ctx.strokeStyle = st === 'set' ? 'rgba(255,240,200,0.95)' : 'rgba(70,64,55,0.55)';
        ctx.lineWidth = Math.max(1, T * 0.035);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.ellipse(cx, cy, R * 0.26, R * 0.26 * K, 0, 0, Math.PI * 2);
        for (let a = 0; a < 8; a++) {
          const ang = a * Math.PI / 4;
          const c = Math.cos(ang), s = Math.sin(ang);
          ctx.moveTo(cx + c * R * 0.38, cy + s * R * 0.38 * K);
          ctx.lineTo(cx + c * R * 0.58, cy + s * R * 0.58 * K);
        }
        ctx.stroke();
        if (st === 'wrong') {
          // upside-down stone: a rose glow wide enough to show around the stone's base
          const p = 0.5 + 0.5 * Math.sin(now / 260);
          const gl = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.9);
          gl.addColorStop(0, `rgba(255,120,150,${0.35 + 0.25 * p})`);
          gl.addColorStop(1, 'rgba(255,120,150,0)');
          ctx.fillStyle = gl;
          ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.9, R * 1.9 * K, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = `rgba(255,150,170,${0.45 + 0.4 * p})`;
          ctx.lineWidth = Math.max(1.5, T * 0.045);
          ctx.setLineDash([T * 0.08, T * 0.06]);
          ctx.beginPath(); ctx.ellipse(cx, cy + T * 0.04, R * 1.38, R * 1.38 * K, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    }

    // ---------------------------------------------------------------- rocks
    drawRock(x, y) {
      const ctx = this.ctx, T = this.T;
      const h = 0.55 + 0.15 * hash(x, y, 5);
      const pts = [];
      const N = 9;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + hash(x, y, 6) * 0.6;
        const rr = 0.36 + 0.08 * hash(x, y, 200 + i);
        pts.push([x + 0.5 + Math.cos(a) * rr, y + 0.5 + Math.sin(a) * rr]);
      }
      // shadow
      ctx.fillStyle = 'rgba(20,25,10,0.28)';
      ctx.beginPath();
      const [sx, sy] = this.P(x + 0.58, y + 0.6, 0);
      ctx.ellipse(sx, sy, T * 0.46, T * 0.42 * K, 0, 0, Math.PI * 2);
      ctx.fill();
      // side skirt: polygon of bottom ring + top ring hull (draw bottom ring, quads, top)
      ctx.fillStyle = COL.rockSide;
      ctx.beginPath();
      pts.forEach(([px, py], i) => { const [a, b] = this.P(px, py, 0); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); });
      ctx.closePath(); ctx.fill();
      for (let i = 0; i < N; i++) {
        const p = pts[i], q = pts[(i + 1) % N];
        const [a0, b0] = this.P(p[0], p[1], 0), [a1, b1] = this.P(q[0], q[1], 0);
        const [a2, b2] = this.P(q[0], q[1], h), [a3, b3] = this.P(p[0], p[1], h);
        const ny = (p[0] - q[0]); // outward-ish normal y component for shading
        ctx.fillStyle = ny > 0 ? '#5a564d' : '#6a665c';
        ctx.beginPath(); ctx.moveTo(a0, b0); ctx.lineTo(a1, b1); ctx.lineTo(a2, b2); ctx.lineTo(a3, b3); ctx.closePath(); ctx.fill();
      }
      const top = pts.map(([px, py]) => this.P(px, py, h));
      ctx.fillStyle = COL.rockTop;
      ctx.beginPath();
      top.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(25,22,18,0.35)';
      ctx.lineWidth = Math.max(1, T * 0.02);
      ctx.stroke();
      // moss cap
      const [mx, my] = this.P(x + 0.45 + 0.1 * hash(x, y, 8), y + 0.45, h);
      ctx.fillStyle = 'rgba(111,138,72,0.85)';
      ctx.beginPath();
      ctx.ellipse(mx, my, T * 0.2, T * 0.13 * K, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(140,165,90,0.7)';
      ctx.beginPath();
      ctx.ellipse(mx - T * 0.05, my - T * 0.02, T * 0.09, T * 0.06 * K, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---------------------------------------------------------------- stones
    collectStones(state, anim, el, items) {
      // A stone can move several times in one push (frost slides): one roll
      // event per tip, scheduled back to back by main.js.
      const rolling = new Map();
      if (anim) for (const e of anim.events) if (e.type === 'roll') {
        if (!rolling.has(e.stone)) rolling.set(e.stone, []);
        rolling.get(e.stone).push(e);
      }
      for (const list of rolling.values()) list.sort((a, b) => a.t0 - b.t0);
      const push = (box, idx, alpha, set, sinking, fate, kind) => {
        // depth: southern-most extent of the box footprint
        const south = box.c[1] + (Math.abs(box.ax[1]) * 0.5 + Math.abs(box.ay[1]) * 0.5 + Math.abs(box.az[1]) * 1);
        items.push({ depth: south, south, x: box.c[0], kind: 'stone', box, idx, alpha, set, sinking, fate, mk: kind });
      };
      const now = this.now;
      const pendingSink = (idx) => this.sinkers.find((k) => k.idx === idx && now < k.at);
      const lv = this.curLevel;
      state.stones.forEach((s, idx) => {
        const list = rolling.get(idx);
        const waiting = pendingSink(idx);
        if (list) {
          const last = list[list.length - 1];
          if (last.fate && el >= last.t0 + last.dur) { // handed over to the sinker effect
            if (waiting) push(stoneBox(waiting.pose), idx, 1, false, false, null, s.k);
            return;
          }
          let box;
          const cur = list.find((e) => el < e.t0 + e.dur);
          if (!cur) box = stoneBox(last.to);
          else if (el < cur.t0) box = stoneBox(cur.from);
          else box = rollingBox(cur.from, cur.dir, easeFor(cur.ease, (el - cur.t0) / cur.dur) * Math.PI / 2);
          push(box, idx, 1, false, false, null, s.k);
        } else {
          if (s.sunk) { if (waiting) push(stoneBox(waiting.pose), idx, 1, false, false, null, s.k); return; }
          push(stoneBox(s), idx, 1, !!(lv && L.stoneSet(lv, s)), false, null, s.k);
        }
      });
      // stones sinking into water or bog (cosmetic, does not block input)
      this.sinkers = this.sinkers.filter((k) => now - k.at < k.dur);
      for (const k of this.sinkers) {
        const u = (now - k.at) / k.dur;
        if (u < 0) continue;
        const box = stoneBox(k.pose);
        const depth = k.fate === 'bog' ? (L.isStanding(k.pose.m) ? 2 : 1) : 2.4;
        box.c = [box.c[0], box.c[1], box.c[2] - easeOut(u) * depth];
        const alpha = k.fate === 'bog' ? 1 - Math.max(0, u - 0.6) / 0.4 : 1 - u * 0.85;
        push(box, k.idx, alpha, false, true, k.fate, k.pose.k);
      }
    }

    addSinker(e, at) {
      this.sinkers.push({ pose: e.to, fate: e.fate, idx: e.stone, at, dur: e.fate === 'bog' ? TIMING.bog : TIMING.sink, fillCells: e.fillCells || [] });
    }

    isSocket(x, y) {
      const lv = this.curLevel;
      return lv && lv.tiles[y * lv.w + x] === L.SOCKET;
    }

    drawStone(it) {
      const ctx = this.ctx, T = this.T;
      const b = it.box;
      const E = [0.47, 0.47, 0.97];
      const ax = b.ax, ay = b.ay, az = b.az;
      const toW = (l) => [
        b.c[0] + ax[0] * l[0] * E[0] + ay[0] * l[1] * E[1] + az[0] * l[2] * E[2],
        b.c[1] + ax[1] * l[0] * E[0] + ay[1] * l[1] * E[1] + az[1] * l[2] * E[2],
        b.c[2] + ax[2] * l[0] * E[0] + ay[2] * l[1] * E[1] + az[2] * l[2] * E[2],
      ];
      const dirW = (l) => [
        ax[0] * l[0] + ay[0] * l[1] + az[0] * l[2],
        ax[1] * l[0] + ay[1] * l[1] + az[1] * l[2],
        ax[2] * l[0] + ay[2] * l[1] + az[2] * l[2],
      ];
      ctx.save();
      // clip below water / bog surface while sinking
      if (it.sinking) {
        ctx.beginPath();
        const line = this.P(0, it.south, it.fate === 'bog' ? 0 : WATER_Z)[1];
        ctx.rect(0, -10, this.W, line + 10);
        ctx.clip();
      }
      ctx.globalAlpha = it.alpha;
      // ground shadow (only when resting near ground level)
      if (!it.sinking) {
        let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          const p = toW([sx, sy, sz]);
          minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]);
          miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]);
        }
        const [s0x, s0y] = this.P(minx + 0.06, miny + 0.1, 0);
        const [s1x, s1y] = this.P(maxx + 0.1, maxy + 0.14, 0);
        ctx.fillStyle = 'rgba(15,20,10,0.25)';
        roundRect(ctx, s0x, s0y, s1x - s0x, s1y - s0y, T * 0.18);
        ctx.fill();
      }
      for (const f of FACES) {
        const n = dirW(f.n);
        if (dot(n, VIEW) <= 1e-4) continue;
        const o = toW(f.o);
        const pu = toW([f.o[0] + f.u[0], f.o[1] + f.u[1], f.o[2] + f.u[2]]);
        const pv = toW([f.o[0] + f.v[0], f.o[1] + f.v[1], f.o[2] + f.v[2]]);
        const [x0, y0] = this.P(o[0], o[1], o[2]);
        const [x1, y1] = this.P(pu[0], pu[1], pu[2]);
        const [x2, y2] = this.P(pv[0], pv[1], pv[2]);
        const ux = x1 - x0, uy = y1 - y0, vx = x2 - x0, vy = y2 - y0;
        const sh = shadeOf(n);
        // face polygon
        ctx.beginPath();
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1 + vx, y1 + vy); ctx.lineTo(x2, y2); ctx.closePath();
        const fg = ctx.createLinearGradient(x0, y0, x0 + ux + vx, y0 + uy + vy);
        const base = it.mk === 'm' ? COL.stoneM : COL.stone;
        fg.addColorStop(0, rgb(base, sh * 1.04));
        fg.addColorStop(1, rgb(base, sh * 0.9));
        ctx.fillStyle = fg;
        ctx.fill();
        // decals in face space
        ctx.save();
        ctx.clip();
        ctx.transform(ux, uy, vx, vy, x0, y0);
        this.stoneDecal(f, it, sh, n[2] > 0.5);
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1 + vx, y1 + vy); ctx.lineTo(x2, y2); ctx.closePath();
        ctx.strokeStyle = 'rgba(40,40,58,0.55)';
        ctx.lineWidth = Math.max(1, T * 0.022);
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      ctx.restore();
    }

    stoneDecal(f, it, sh, facingUp) {
      const ctx = this.ctx;
      const seed = it.idx * 7 + f.id;
      if (it.mk !== 'm' && f.kind !== 'side') {
        // plain stone: both ends alike, a carved ring that lights up when set
        if (it.set && facingUp) {
          const p = 0.8 + 0.2 * Math.sin(this.now / 400);
          ctx.fillStyle = `rgba(255,220,130,${0.5 * p})`;
          ctx.beginPath(); ctx.arc(0.5, 0.5, 0.46, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = rgb(COL.ochre, sh * 1.2);
        } else ctx.strokeStyle = rgb([90, 94, 112], sh, 0.45);
        ctx.lineWidth = 0.06;
        ctx.beginPath(); ctx.arc(0.5, 0.5, 0.24, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(0.5, 0.5, 0.07, 0, Math.PI * 2); ctx.stroke();
        return;
      }
      if (f.kind === 'side') {
        // subtle grain
        ctx.fillStyle = rgb([120, 125, 140], sh, 0.18);
        for (let i = 0; i < 4; i++) {
          const u = hash(seed, i, 1), v = 0.08 + 0.5 * hash(seed, i, 2);
          ctx.fillRect(u * 0.8, v, 0.08 + 0.12 * hash(seed, i, 3), 0.015);
        }
        // lichen
        ctx.fillStyle = rgb([128, 150, 80], sh, 0.55);
        const nl = 1 + Math.floor(hash(seed, 0, 4) * 2);
        for (let i = 0; i < nl; i++) {
          ctx.beginPath();
          ctx.ellipse(0.2 + 0.6 * hash(seed, i, 5), 0.12 + 0.4 * hash(seed, i, 6), 0.08 + 0.06 * hash(seed, i, 7), 0.035, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // carved motif (different on each face so rolls are readable)
        ctx.strokeStyle = rgb([70, 72, 92], sh, 0.5);
        ctx.lineWidth = 0.045;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const m = f.id % 4;
        if (m === 0) { // spiral
          for (let a = 0; a < 12; a++) {
            const ang = a * 0.75, r = 0.04 + a * 0.017;
            const px = 0.5 + Math.cos(ang) * r, py = 0.36 + Math.sin(ang) * r * 0.5;
            if (a) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          }
        } else if (m === 1) { // three cups
          for (let a = 0; a < 3; a++) { ctx.moveTo(0.35 + a * 0.15 + 0.04, 0.36); ctx.arc(0.35 + a * 0.15, 0.36, 0.04, 0, Math.PI * 2); }
        } else if (m === 2) { // chevrons
          ctx.moveTo(0.3, 0.3); ctx.lineTo(0.5, 0.4); ctx.lineTo(0.7, 0.3);
          ctx.moveTo(0.3, 0.42); ctx.lineTo(0.5, 0.52); ctx.lineTo(0.7, 0.42);
        } else { // ring and line
          ctx.moveTo(0.5 + 0.09, 0.4); ctx.arc(0.5, 0.4, 0.09, 0, Math.PI * 2);
          ctx.moveTo(0.5, 0.2); ctx.lineTo(0.5, 0.28);
        }
        ctx.stroke();
        // ochre band near the marked end (marked stones only)
        if (it.mk === 'm') {
          ctx.fillStyle = rgb(COL.ochre, sh * (it.set ? 1.15 : 1));
          ctx.fillRect(-0.01, 0.74, 1.02, 0.1);
          ctx.fillStyle = rgb([255, 230, 170], sh, 0.25);
          ctx.fillRect(-0.01, 0.74, 1.02, 0.02);
        }
      } else if (f.kind === 'mark') {
        // sun glyph
        const glow = it.set ? 1 : 0;
        if (glow) {
          const p = 0.8 + 0.2 * Math.sin(this.now / 400);
          ctx.fillStyle = `rgba(255,220,130,${0.5 * p})`;
          ctx.beginPath(); ctx.arc(0.5, 0.5, 0.48, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = rgb(COL.ochre, sh * (glow ? 1.2 : 1));
        ctx.strokeStyle = rgb(COL.ochre, sh * (glow ? 1.2 : 1));
        ctx.beginPath(); ctx.arc(0.5, 0.5, 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 0.07;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let a = 0; a < 8; a++) {
          const ang = a * Math.PI / 4;
          ctx.moveTo(0.5 + Math.cos(ang) * 0.25, 0.5 + Math.sin(ang) * 0.25);
          ctx.lineTo(0.5 + Math.cos(ang) * 0.37, 0.5 + Math.sin(ang) * 0.37);
        }
        ctx.stroke();
      } else {
        // plain base: a faint worn ring
        ctx.strokeStyle = rgb([90, 92, 110], sh, 0.35);
        ctx.lineWidth = 0.05;
        ctx.beginPath(); ctx.arc(0.5, 0.5, 0.22, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // ---------------------------------------------------------------- player
    playerPose(state, anim, el, g) {
      // Facing is only for show: the keeper looks the way they last moved.
      let x = state.px, y = state.py, ang = Math.atan2(L.DY[state.pf], L.DX[state.pf]), bob = 0, lean = 0;
      const now = this.now;
      if (anim) {
        const sp = anim.speed || 1;
        for (const e of anim.events) {
          if (e.type === 'walk') {
            const dur = TIMING.walk * sp;
            const t = ease(el / dur);
            x = e.from[0] + (e.to[0] - e.from[0]) * t;
            y = e.from[1] + (e.to[1] - e.from[1]) * t;
            bob = Math.sin(Math.PI * clamp(el / dur, 0, 1)) * 0.06;
            if (e.push) lean = Math.sin(Math.PI * clamp(el / (dur * 1.8), 0, 1)) * 0.12;
          } else if (e.type === 'bump') {
            const t = clamp(el / 160, 0, 1);
            const bump = Math.sin(t * Math.PI) * 0.1;
            if (e.dir != null) { x += L.DX[e.dir] * bump; y += L.DY[e.dir] * bump; ang = Math.atan2(L.DY[e.dir], L.DX[e.dir]); }
          }
        }
      }
      if (g && g.won && g.dawn > 0) {
        // a little celebration hop at dawn
        const t = (now - g.wonAt) / 1000;
        if (t > 0) bob = Math.abs(Math.sin(t * 6.5)) * 0.2 * Math.max(0.15, 1 - t / 3);
      }
      const breath = Math.sin(now / 650) * 0.022;
      return { x: x + Math.cos(ang) * lean, y: y + Math.sin(ang) * lean, ang, bob, breath };
    }

    drawPlayer(pl, now, ghost) {
      const ctx = this.ctx, T = this.T;
      const cx = pl.x + 0.5, cy = pl.y + 0.5;
      const fx = Math.cos(pl.ang), fy = Math.sin(pl.ang);
      const z0 = pl.bob;
      ctx.save();
      if (ghost) ctx.globalAlpha = 0.32;
      // warm pool of lantern light on the ground
      const flick = 0.85 + 0.1 * Math.sin(now / 90) + 0.05 * Math.sin(now / 37);
      if (!ghost) {
        const [gx, gy] = this.P(cx, cy, 0);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const gl = ctx.createRadialGradient(gx, gy, 0, gx, gy, T * 1.15);
        gl.addColorStop(0, `rgba(255,190,100,${0.2 * flick})`);
        gl.addColorStop(1, 'rgba(255,190,100,0)');
        ctx.fillStyle = gl;
        ctx.beginPath(); ctx.ellipse(gx, gy, T * 1.15, T * 1.15 * K, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        const [shx, shy] = this.P(cx + 0.04, cy + 0.06, 0);
        ctx.fillStyle = 'rgba(15,20,10,0.3)';
        ctx.beginPath(); ctx.ellipse(shx, shy, T * 0.27, T * 0.2 * K, 0, 0, Math.PI * 2); ctx.fill();
      }
      // the lantern hangs from the keeper's right hand
      const side = [-fy, fx];
      const lw = [cx + side[0] * 0.3 + fx * 0.12, cy + side[1] * 0.3 + fy * 0.12, 0.3 + z0];
      const lantern = () => {
        const [hx, hy] = this.P(lw[0], lw[1], lw[2] + 0.2);
        const [lx, ly] = this.P(lw[0], lw[1], lw[2]);
        const s = T * 0.075;
        ctx.strokeStyle = COL.lanternCase;
        ctx.lineWidth = Math.max(1, T * 0.02);
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(lx, ly - s * 1.3); ctx.stroke();
        if (!ghost) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const gr = ctx.createRadialGradient(lx, ly, 0, lx, ly, T * 0.42);
          gr.addColorStop(0, `rgba(255,214,140,${0.6 * flick})`);
          gr.addColorStop(1, 'rgba(255,214,140,0)');
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(lx, ly, T * 0.42, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = COL.lanternCase;
        roundRect(ctx, lx - s, ly - s * 1.3, s * 2, s * 2.6, s * 0.5);
        ctx.fill();
        ctx.fillStyle = COL.lantern;
        roundRect(ctx, lx - s * 0.62, ly - s * 0.9, s * 1.24, s * 1.8, s * 0.35);
        ctx.fill();
        // hand
        ctx.fillStyle = COL.face;
        ctx.beginPath(); ctx.arc(hx, hy, Math.max(1.5, T * 0.04), 0, Math.PI * 2); ctx.fill();
      };
      const behind = side[1] < -0.2 || (Math.abs(side[1]) <= 0.2 && fy < 0); // lantern behind the body
      if (behind) lantern();
      // cloak (bell shape)
      const [bx, by] = this.P(cx, cy, z0);
      const [, topY] = this.P(cx, cy, 0.78 + z0 + (pl.breath || 0));
      const w = T * 0.29;
      const hgt = by - topY;
      ctx.fillStyle = COL.cloakDark;
      ctx.beginPath();
      ctx.ellipse(bx, by, w, w * 0.5 * K, 0, 0, Math.PI * 2);
      ctx.fill();
      const gr = ctx.createLinearGradient(bx - w, 0, bx + w, 0);
      gr.addColorStop(0, COL.cloakHi);
      gr.addColorStop(0.55, COL.cloak);
      gr.addColorStop(1, COL.cloakDark);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(bx - w, by);
      ctx.bezierCurveTo(bx - w * 0.95, by - hgt * 0.6, bx - w * 0.55, topY, bx, topY);
      ctx.bezierCurveTo(bx + w * 0.55, topY, bx + w * 0.95, by - hgt * 0.6, bx + w, by);
      ctx.quadraticCurveTo(bx, by + w * 0.5 * K, bx - w, by);
      ctx.closePath();
      ctx.fill();
      // hood / head
      const [hx, hy] = this.P(cx, cy, 0.86 + z0 + (pl.breath || 0));
      const hr = T * 0.17;
      ctx.fillStyle = COL.cloak;
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.arc(hx - hr * 0.35, hy - hr * 0.35, hr * 0.45, 0, Math.PI * 2); ctx.fill();
      // face opening toward the facing direction (visible unless facing north)
      if (fy > -0.75) {
        const fxo = fx * hr * 0.42, fyo = Math.max(0, fy) * hr * 0.18 + hr * 0.1;
        ctx.fillStyle = '#3a2418';
        ctx.beginPath(); ctx.ellipse(hx + fxo, hy + fyo, hr * 0.62, hr * 0.56, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = COL.face;
        ctx.beginPath(); ctx.ellipse(hx + fxo * 1.1, hy + fyo + hr * 0.06, hr * 0.48, hr * 0.42, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2a1a12';
        const ex = hx + fxo * 1.35, ey = hy + fyo + hr * 0.04;
        const sep = hr * 0.22 * (1 - Math.abs(fx) * 0.45);
        const blink = (now % 4200) < 120 ? 0.25 : 1;
        for (const sgn of Math.abs(fx) > 0.8 ? [fx > 0 ? 1 : -1] : [-1, 1]) {
          ctx.beginPath(); ctx.ellipse(ex + sgn * sep, ey, hr * 0.07, hr * 0.1 * blink, 0, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        // back of the hood: a little point
        ctx.fillStyle = COL.cloakDark;
        ctx.beginPath();
        ctx.moveTo(hx - hr * 0.3, hy + hr * 0.5);
        ctx.quadraticCurveTo(hx, hy + hr * 1.5, hx + hr * 0.3, hy + hr * 0.5);
        ctx.fill();
      }
      if (!behind) lantern();
      ctx.restore();
    }

    // ---------------------------------------------------------------- effects
    burst(kind, x, y, z, n, delay) {
      const now = performance.now() + (delay || 0);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = kind === 'spark' ? 0.2 + Math.random() * 0.5 : 0.5 + Math.random() * 1.2;
        this.particles.push({
          kind, born: now, life: kind === 'spark' ? 900 + Math.random() * 700 : kind === 'dust' || kind === 'ice' ? 450 : 650,
          x: x + (Math.random() - 0.5) * 0.6, y: y + (Math.random() - 0.5) * 0.6, z,
          vx: Math.cos(a) * sp * (kind === 'spark' ? 0.3 : 1), vy: Math.sin(a) * sp * (kind === 'spark' ? 0.3 : 1),
          vz: kind === 'spark' ? 0.6 + Math.random() * 0.8 : kind === 'dust' || kind === 'ice' ? 0.3 + Math.random() * 0.4 : 1.6 + Math.random() * 1.4,
        });
      }
    }

    drawParticles(now) {
      const ctx = this.ctx, T = this.T;
      const keep = [];
      for (const p of this.particles) {
        const t = (now - p.born) / p.life;
        if (t >= 1 || t < 0) { if (t < 0) keep.push(p); continue; }
        keep.push(p);
        const s = (now - p.born) / 1000;
        let x = p.x + p.vx * s, y = p.y + p.vy * s, z = p.z + p.vz * s;
        if (p.kind === 'splash') z = p.z + p.vz * s - 6 * s * s;
        if (p.kind === 'dust' || p.kind === 'ice') { x = p.x + p.vx * s * 0.6; y = p.y + p.vy * s * 0.6; }
        const [sx, sy] = this.P(x, y, z);
        if (p.kind === 'spark') {
          ctx.fillStyle = `rgba(255,222,140,${(1 - t) * 0.9})`;
          ctx.beginPath(); ctx.arc(sx, sy, T * 0.035 * (1 - t * 0.5), 0, Math.PI * 2); ctx.fill();
        } else if (p.kind === 'ice') {
          ctx.fillStyle = `rgba(235,248,255,${(1 - t) * 0.8})`;
          ctx.beginPath(); ctx.arc(sx, sy, T * 0.03 * (1 - t * 0.4), 0, Math.PI * 2); ctx.fill();
        } else if (p.kind === 'dust') {
          ctx.fillStyle = `rgba(210,200,170,${(1 - t) * 0.35})`;
          ctx.beginPath(); ctx.arc(sx, sy, T * (0.05 + t * 0.1), 0, Math.PI * 2); ctx.fill();
        } else if (p.kind === 'splash') {
          ctx.fillStyle = `rgba(200,220,255,${(1 - t) * 0.85})`;
          ctx.beginPath(); ctx.arc(sx, sy, T * 0.035, 0, Math.PI * 2); ctx.fill();
        } else if (p.kind === 'ring') {
          const [rx, ry] = this.P(p.x, p.y, p.z);
          ctx.strokeStyle = `rgba(200,220,255,${(1 - t) * 0.6})`;
          ctx.lineWidth = Math.max(1, T * 0.03);
          ctx.beginPath(); ctx.ellipse(rx, ry, T * (0.3 + t * 0.9), T * (0.3 + t * 0.9) * K * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
        } else if (p.kind === 'mud') {
          ctx.fillStyle = `rgba(90,70,40,${(1 - t) * 0.9})`;
          const zz = p.z + p.vz * s * 0.6 - 5 * s * s;
          const [mx, my] = this.P(x, y, Math.max(0, zz));
          ctx.beginPath(); ctx.arc(mx, my, T * 0.04, 0, Math.PI * 2); ctx.fill();
        }
      }
      this.particles = keep;
    }

    drawDawn(level, state, dawn, now) {
      // pillars of light rising from every lit socket, and golden motes drifting up
      const ctx = this.ctx, T = this.T;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const b = this.bounds;
      if (b) {
        for (let i = 0; i < 26; i++) {
          const per = 3200 + 1700 * hash(i, 3, 77);
          const t = ((now + hash(i, 5, 78) * per) % per) / per;
          const x = b.x0 - 0.5 + (b.x1 - b.x0 + 2) * hash(i, 7, 79) + Math.sin(now / 900 + i) * 0.25;
          const y = b.y0 - 0.5 + (b.y1 - b.y0 + 2) * hash(i, 9, 80);
          const [sx, sy] = this.P(x, y, t * 3.2);
          const a = dawn * Math.sin(Math.PI * t) * 0.8;
          ctx.fillStyle = `rgba(255,214,130,${a})`;
          ctx.beginPath(); ctx.arc(sx, sy, T * (0.025 + 0.02 * hash(i, 1, 81)), 0, Math.PI * 2); ctx.fill();
        }
      }
      for (const i of level.sockets) {
        const x = i % level.w, y = Math.floor(i / level.w);
        const [cx, cy] = this.P(x + 0.5, y + 0.5, 2);
        const h = T * 4 * easeOut(dawn);
        const gr = ctx.createLinearGradient(0, cy - h, 0, cy);
        gr.addColorStop(0, 'rgba(255,200,110,0)');
        gr.addColorStop(1, `rgba(255,200,110,${0.32 * dawn})`);
        ctx.fillStyle = gr;
        const w = T * 0.36 * (0.9 + 0.1 * Math.sin(now / 300 + i));
        ctx.fillRect(cx - w / 2, cy - h, w, h);
      }
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  root.MenhirRender = { Renderer, TIMING, WATER_Z };
})(window);
