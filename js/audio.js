/* Menhir - synthesized sound effects and a small generative ambient score (Web Audio, no files). */
(function (root) {
  'use strict';
  let ctx = null;
  let master = null, sfxBus = null, musicBus = null, echo = null;
  let muted = false;
  let music = true;
  try {
    muted = localStorage.getItem('menhir2.muted') === '1';
    music = localStorage.getItem('menhir2.music') !== '0';
  } catch (e) { /* storage unavailable */ }

  function ensure() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 1;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = music ? 1 : 0;
    musicBus.connect(master);
    // a soft feedback echo shared by the music
    echo = ctx.createDelay(1.5);
    echo.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    echo.connect(lp); lp.connect(fb); fb.connect(echo);
    const wet = ctx.createGain(); wet.gain.value = 0.5;
    lp.connect(wet); wet.connect(musicBus);
    return ctx;
  }

  let noise = null;
  function noiseBuffer() {
    const len = ctx.sampleRate * 0.6;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function tone(freq, t0, dur, opts) {
    opts = opts || {};
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const vol = opts.vol == null ? 0.3 : opts.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(opts.bus || sfxBus);
    if (opts.send) g.connect(echo);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function hiss(t0, dur, opts) {
    opts = opts || {};
    if (!noise) noise = noiseBuffer();
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter || 'bandpass';
    f.frequency.setValueAtTime(opts.freq || 900, t0);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    f.Q.value = opts.q || 1.2;
    const g = ctx.createGain();
    const vol = opts.vol == null ? 0.2 : opts.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t0, Math.random() * 0.2);
    src.stop(t0 + dur + 0.05);
  }

  const vary = (f) => f * (0.94 + Math.random() * 0.12);
  const SET_NOTES = [659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5];

  const sounds = {
    step(t) { hiss(t, 0.05, { freq: vary(2400), vol: 0.03, q: 0.8 }); },
    glide(t, n) {
      // a stone skating on frost: an icy hiss and a light tick per tip
      hiss(t, 0.17, { freq: 3200 + (n || 0) * 120, to: 2200, vol: 0.06, q: 1.4, attack: 0.02 });
      tone(vary(1500), t + 0.12, 0.06, { type: 'triangle', vol: 0.04, to: 1100 });
    },
    hint(t) {
      tone(880, t, 0.5, { vol: 0.05, send: true });
      tone(1318.5, t + 0.08, 0.5, { vol: 0.035, send: true });
    },
    stuck(t) {
      // soft, low and short: "this can no longer be won"
      tone(174.6, t, 0.7, { type: 'sine', vol: 0.07 });
      tone(164.8, t + 0.18, 0.8, { type: 'sine', vol: 0.06 });
    },
    bump(t) { tone(110, t, 0.09, { type: 'triangle', vol: 0.12, to: 80 }); },
    roll(t) {
      tone(vary(150), t, 0.16, { type: 'triangle', vol: 0.22, to: 70 });
      hiss(t, 0.12, { freq: 380, vol: 0.12, q: 0.9 });
    },
    topple(t, depth) {
      const f = vary(120) * (1 + (depth || 0) * 0.08);
      tone(f, t + 0.04, 0.26, { type: 'triangle', vol: 0.3, to: f * 0.42 });
      hiss(t + 0.04, 0.18, { freq: 300, vol: 0.15, q: 0.8 });
    },
    rise(t) {
      tone(vary(95), t, 0.22, { type: 'triangle', vol: 0.26, to: 140 });
      hiss(t + 0.08, 0.14, { freq: 520, vol: 0.1 });
    },
    knock(t, depth) {
      // wooden clack when one stone strikes another
      const f = 900 + (depth || 1) * 120;
      tone(f, t, 0.07, { type: 'square', vol: 0.05, to: f * 0.6 });
      hiss(t, 0.06, { freq: 1800, vol: 0.12, q: 3 });
    },
    set(t, n) {
      const f = SET_NOTES[Math.min(SET_NOTES.length - 1, Math.max(0, (n || 1) - 1))];
      tone(f, t + 0.05, 1.1, { vol: 0.13 });
      tone(f * 1.5, t + 0.13, 1.3, { vol: 0.07 });
      tone(f * 2, t + 0.2, 0.9, { vol: 0.035 });
    },
    sink(t) {
      hiss(t, 0.5, { freq: 1600, to: 260, vol: 0.22, q: 0.6, attack: 0.02 });
      tone(320, t + 0.05, 0.35, { vol: 0.08, to: 120 });
    },
    bog(t) {
      tone(140, t, 0.45, { type: 'sine', vol: 0.25, to: 45 });
      hiss(t, 0.35, { freq: 260, to: 120, vol: 0.12, q: 2 });
    },
    undo(t) { tone(520, t, 0.08, { type: 'sine', vol: 0.05, to: 390 }); },
    intro(t) {
      [587.33, 880, 1174.66].forEach((f, i) => tone(f, t + i * 0.09, 0.9, { vol: 0.045, send: true }));
    },
    win(t) {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
      notes.forEach((f, i) => tone(f, t + i * 0.1, 1.8 - i * 0.12, { vol: 0.1, send: true }));
      tone(261.63, t, 2.4, { vol: 0.08, type: 'triangle' });
      tone(392.0, t + 0.2, 2.2, { vol: 0.05, type: 'triangle' });
    },
  };

  // ---------------------------------------------------------------- music
  // Slow pad chords and sparse pentatonic plucks, scheduled a little ahead.
  const CHORDS = [
    [146.83, 220.0, 261.63, 329.63], // Dm9-ish
    [116.54, 174.61, 220.0, 293.66], // Bb maj
    [130.81, 196.0, 261.63, 329.63], // C
    [110.0, 164.81, 220.0, 261.63],  // Am
  ];
  const SCALE = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46, 783.99, 880.0];
  let musicTimer = null, nextChordAt = 0, chordIdx = 0, nextPluckAt = 0;

  function pad(chord, t0, dur) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.03, t0 + 2.2);
    g.gain.setValueAtTime(0.03, t0 + dur - 2.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    lp.connect(g); g.connect(musicBus);
    chord.forEach((f, i) => {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(lp);
        o.start(t0);
        o.stop(t0 + dur + 0.1);
      }
    });
  }

  function musicTick() {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (t + 1 > nextChordAt) {
      const start = Math.max(t + 0.1, nextChordAt);
      pad(CHORDS[chordIdx % CHORDS.length], start, 9.5);
      chordIdx++;
      nextChordAt = start + 8;
    }
    if (t + 0.5 > nextPluckAt) {
      const start = Math.max(t + 0.05, nextPluckAt);
      const f = SCALE[Math.floor(Math.random() * SCALE.length)];
      tone(f, start, 1.6, { vol: 0.028, attack: 0.01, bus: musicBus, send: true });
      if (Math.random() < 0.3) tone(f * 1.5, start + 0.21, 1.2, { vol: 0.016, bus: musicBus, send: true });
      nextPluckAt = start + 0.9 + Math.random() * 2.6;
    }
  }

  function startMusic() {
    if (musicTimer || !ctx) return;
    nextChordAt = ctx.currentTime + 0.2;
    nextPluckAt = ctx.currentTime + 1.5;
    musicTimer = setInterval(musicTick, 250);
    musicTick();
  }

  root.MenhirAudio = {
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      startMusic();
    },
    play(name, delay, arg) {
      if (muted) return;
      if (!ensure() || ctx.state !== 'running') return;
      const fn = sounds[name];
      if (fn) fn(ctx.currentTime + (delay || 0), arg);
    },
    isMuted() { return muted; },
    setMuted(m) {
      muted = !!m;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.6, ctx.currentTime, 0.05);
      try { localStorage.setItem('menhir2.muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
    },
    musicOn() { return music; },
    setMusic(on) {
      music = !!on;
      if (musicBus) musicBus.gain.setTargetAtTime(music ? 1 : 0, ctx.currentTime, 0.3);
      try { localStorage.setItem('menhir2.music', music ? '1' : '0'); } catch (e) { /* ignore */ }
    },
  };
})(window);
