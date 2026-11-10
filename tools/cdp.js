/*
 * Tiny Chrome DevTools Protocol helper for the browser checks (development tool).
 * Talks to headless Chrome over --remote-debugging-pipe, so it opens no ports.
 *
 *   const { launch } = require('./cdp.js');
 *   const page = await launch({ width: 1280, height: 800 });
 *   await page.goto('http://127.0.0.1:8861/index.html?level=2');
 *   await page.eval('menhir.g.state.pushes');
 *   await page.close();
 */
'use strict';
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(opts) {
  opts = opts || {};
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'menhir-chrome-'));
  const chrome = cp.spawn(opts.chrome || 'google-chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-pipe', '--mute-audio', '--hide-scrollbars',
    '--user-data-dir=' + prof, `--window-size=${opts.width || 1280},${opts.height || 800}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const toChrome = chrome.stdio[3], fromChrome = chrome.stdio[4];
  let buf = '', id = 0;
  const pending = new Map();
  const listeners = [];
  fromChrome.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      else for (const f of listeners) f(msg);
    }
  });
  function raw(method, params, sessionId) {
    return new Promise((resolve) => {
      const k = ++id;
      pending.set(k, resolve);
      const m = { id: k, method, params: params || {} };
      if (sessionId) m.sessionId = sessionId;
      toChrome.write(JSON.stringify(m) + '\0');
    });
  }
  const t = await raw('Target.createTarget', { url: 'about:blank' });
  const a = await raw('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
  const sid = a.result.sessionId;
  const errors = [];
  listeners.push((msg) => {
    if (msg.sessionId !== sid) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(JSON.stringify(msg.params.args.map((x) => x.value || x.description)));
  });
  const send = (m, p) => raw(m, p, sid);
  await send('Page.enable');
  await send('Runtime.enable');
  const page = {
    errors,
    send,
    async viewport(w, h, scale, mobile) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale || 1, mobile: !!mobile });
      if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    },
    async goto(url, wait) {
      await send('Page.navigate', { url });
      await sleep(wait == null ? 900 : wait);
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error('eval failed: ' + expr + ' -> ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description));
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    async shot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    },
    async key(code, opts2) {
      opts2 = opts2 || {};
      const KEYS = {
        ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
        KeyZ: ['z', 90], KeyR: ['r', 82], KeyH: ['h', 72], KeyP: ['p', 80], KeyL: ['l', 76], KeyM: ['m', 77], KeyN: ['n', 78],
        Enter: ['Enter', 13], Escape: ['Escape', 27], BracketRight: [']', 221], BracketLeft: ['[', 219], Backspace: ['Backspace', 8],
        KeyW: ['w', 87], KeyA: ['a', 65], KeyS: ['s', 83], KeyD: ['d', 68],
      };
      const [key, vk] = KEYS[code];
      const mods = opts2.shift ? 8 : 0;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: opts2.shift && key.length === 1 ? key.toUpperCase() : key, code, windowsVirtualKeyCode: vk, modifiers: mods, autoRepeat: !!opts2.repeat });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: mods });
      await sleep(opts2.wait == null ? 40 : opts2.wait);
    },
    async touch(points) {
      // points: [[x, y], ...] path of one finger
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0][0], y: points[0][1] }] });
      for (let i = 1; i < points.length; i++) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: points[i][0], y: points[i][1] }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(60);
    },
    async click(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(60);
    },
    async close() {
      try { chrome.kill(); } catch (e) { /* ignore */ }
      await sleep(200);
      try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    },
  };
  return page;
}

module.exports = { launch, sleep };
