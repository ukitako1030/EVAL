#!/usr/bin/env node
// Deterministic capture of the site's REAL playback (v2 promo): phone layout, zoomed 総合戦線 with the ranking panel,
// from 2022-11 at the site's 4x speed — the app's own playback engine, holds, battle-news banners, shockwaves and
// ranking reshuffles run; nothing is drawn on top here (compose-promo.mjs --variant v2 adds only the end card).
//
// Page clock: before any page script runs, performance.now / requestAnimationFrame / setTimeout / setInterval are
// wrapped; once the app is up they switch to a virtual clock, and CSS / Web Animations are paused and seeked to it every
// step. Each output frame advances that clock by a fixed amount, so frames are evenly spaced however slow capture is.
//   - while playback holds on a news month (every banner starts, and every shockwave fires, in a hold):
//     BANNER_RATE virtual s per output s
//   - while the months move: QUIET_RATE virtual s per output s (fast-forward)
// The flash budget runs on the app's clock (≤ 3 per virtual second); banner time is never sped up, so the video keeps it.
//
// Optional per-run news filter (page-side, not the source): FILTER below drops repetitive minor general-front items so
// the run fits ~45 s. Needs the window.__* handles: dev server or a VITE_DEBUG_HOOKS=1 build (README).
//   node scripts/record-playback.mjs --url "http://localhost:4791/?t=2022-11&front=general&quality=1" --out <dir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const URL_ = args.url ?? 'http://localhost:4791/?t=2022-11&front=general&quality=1';
const OUT = path.resolve(args.out ?? 'frames-v2');
const W = Number(args.width ?? 540);
const H = Number(args.height ?? 960);
const DPR = Number(args.dpr ?? 2);
const FPS = 30;
const BANNER_RATE = Number(args['banner-rate'] ?? 0.8); // < 1: banners (0.8 s per banner at 4x) stay ~1 s on screen
const QUIET_RATE = Number(args['quiet-rate'] ?? 3);
const TAIL = Number(args.tail ?? 4.2); // seconds after playback ends (final state + end card)
const MAX_SECONDS = 90;

/** [month, text-prefix] of general-front news left out of this run (repeats of minor "急伸" / model-drop items) */
const FILTER = [
  ['2023-05', 'GPT 急伸'],
  ['2023-09', 'Llama 2 投入'],
  ['2024-04', 'Llama 3 投入'],
  ['2024-07', 'Llama 3.1'],
  ['2024-08', 'Mistral 急伸'],
  ['2024-09', 'Llama / Muse 急伸'],
  ['2024-10', 'Llama / Muse 急伸'],
  ['2024-11', 'Llama / Muse 急伸'],
  ['2025-04', 'Llama / Muse 急伸'],
  ['2025-05', 'Mistral 急伸'],
  ['2026-04', 'Llama / Muse 急伸'],
];

const VCLOCK = `(() => {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const realSetTimeout = window.setTimeout.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  const realSetInterval = window.setInterval.bind(window);
  const realClearInterval = window.clearInterval.bind(window);
  const st = { manual: false, vt: 0, queue: [], id: 1, cancelled: new Set(), timers: new Map(), tid: 1e9 };
  performance.now = () => (st.manual ? st.vt : realNow());
  window.requestAnimationFrame = (cb) => {
    const id = st.id++;
    if (st.manual) st.queue.push({ id, cb });
    else realRaf(() => {
      if (st.cancelled.has(id)) return;
      if (st.manual) st.queue.push({ id, cb }); else cb(performance.now());
    });
    return id;
  };
  window.cancelAnimationFrame = (id) => { st.cancelled.add(id); st.queue = st.queue.filter((q) => q.id !== id); };
  // timers made after the switch run on the virtual clock (e.g. a banner's exit removal)
  window.setTimeout = (cb, ms = 0, ...a) => {
    if (!st.manual) return realSetTimeout(cb, ms, ...a);
    const id = st.tid++; st.timers.set(id, { due: st.vt + Math.max(0, +ms || 0), cb, a, every: 0 }); return id;
  };
  window.setInterval = (cb, ms = 0, ...a) => {
    if (!st.manual) return realSetInterval(cb, ms, ...a);
    const every = Math.max(1, +ms || 0); const id = st.tid++; st.timers.set(id, { due: st.vt + every, cb, a, every }); return id;
  };
  window.clearTimeout = (id) => (st.timers.has(id) ? st.timers.delete(id) : realClearTimeout(id));
  window.clearInterval = (id) => (st.timers.has(id) ? st.timers.delete(id) : realClearInterval(id));
  const animStart = new WeakMap();
  function seekAnimations() {
    for (const a of document.getAnimations()) {
      if (!animStart.has(a)) {
        // where it is now (it may have started a moment ago in real time), from the virtual clock's point of view
        const ct = typeof a.currentTime === 'number' ? a.currentTime : 0;
        animStart.set(a, st.vt - ct);
        a.pause();
      }
      try { a.currentTime = Math.max(0, st.vt - animStart.get(a)); } catch {}
    }
  }
  window.__rec = {
    start() { st.vt = realNow(); st.manual = true; },
    pending() { return st.queue.length; },
    step(ms) {
      st.vt += ms;
      for (const [id, t] of [...st.timers].sort((x, y) => x[1].due - y[1].due)) {
        if (t.due > st.vt) continue;
        if (t.every) t.due += t.every; else st.timers.delete(id);
        try { typeof t.cb === 'function' ? t.cb(...t.a) : 0; } catch (e) { console.error(e); }
      }
      const q = st.queue; st.queue = [];
      for (const { id, cb } of q) if (!st.cancelled.has(id)) cb(st.vt);
      seekAnimations();
      return q.length;
    },
    /** is battle news on screen (incl. a banner leaving)? */
    news() { return document.querySelectorAll('#hud-banners .banner, .hud-banners .banner').length > 0; },
  };
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('DevTools WebSocket failed')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(`${m.error.message} ${m.error.data ?? ''}`));
      else res(m.result ?? {});
    } else if (m.method === 'Runtime.exceptionThrown') console.log('page exception:', m.params.exceptionDetails.exception?.description);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.log('console.error:', m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { send, close: () => ws.close() };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (/^f\d+\.jpg$/.test(f)) fs.rmSync(path.join(OUT, f));
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', process.env.CHROME_PATH].find((p) => p && fs.existsSync(p));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwar-rec-'));
  const proc = spawn(
    chrome,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', 'about:blank'],
    { stdio: 'ignore' },
  );
  let client;
  try {
    let port;
    for (let i = 0; i < 100 && !port; i++) {
      try {
        port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      } catch {
        await sleep(100);
      }
    }
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
      } catch {}
      if (!target) await sleep(100);
    }
    client = await connect(target.webSocketDebuggerUrl);
    const { send } = client;
    await send('Runtime.enable');
    await send('Page.enable');
    const version = await send('Browser.getVersion');
    const chromeVer = /Chrome\/([\d.]+)/.exec(version.userAgent)?.[1] ?? '130.0.0.0';
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setUserAgentOverride', {
      userAgent: `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Mobile Safari/537.36`,
    });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: VCLOCK });
    await send('Page.navigate', { url: URL_ });
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result?.value;
    };
    for (let i = 0; i < 100; i++) {
      if (await ev(`!!(window.__store && window.__renderer)`).catch(() => false)) break;
      await sleep(200);
    }
    // news filter, then a front round-trip so playback / the banner queue are rebuilt from the filtered list
    const removed = await ev(`(() => {
      const drop = ${JSON.stringify(FILTER)};
      const ev = __world.events; let n = 0;
      for (let i = ev.length - 1; i >= 0; i--) {
        const e = ev[i];
        if (e.front === 'general' && drop.some(([m, p]) => e.month === m && e.text.ja.startsWith(p))) { ev.splice(i, 1); n++; }
      }
      __store.set({ front: 'code' }); __store.set({ front: 'general', t: 0, playing: false, speed: 4 });
      return n; })()`);
    console.log(`news filter: ${removed} general-front items left out`);
    await sleep(4000); // camera settles, fonts, textures
    await ev(`document.fonts.ready.then(() => true)`);
    await ev(`__rec.start()`);
    for (let i = 0; i < 50 && !(await ev(`__rec.pending()`)); i++) {
      await send('Page.captureScreenshot', { format: 'jpeg', quality: 10 });
      await sleep(50);
    }
    for (let k = 0; k < 6; k++) await ev(`__rec.step(${1000 / FPS})`);
    await ev(`__store.set({ playing: true })`); // press play at 2022-11: 開戦 news + hold, then the war at 4x

    const frameMs = 1000 / FPS;
    const t0 = Date.now();
    const log = [];
    let endAt = -1;
    let f = 0;
    let prevT = -1;
    for (; f < MAX_SECONDS * FPS; f++) {
      const st = await ev(`(() => { const s = __store.get(); return { t: s.t, playing: s.playing, news: __rec.news() }; })()`);
      if (endAt < 0 && !st.playing && st.t > 1) endAt = f;
      if (endAt >= 0 && f >= endAt + Math.round(TAIL * FPS)) break;
      // virtual ms for this output frame, in ≤ 1/30 s rAF steps (the app's animation dt stays the usual frame time)
      // holding (playback paused on a news month: t not moving) or stopped → banner time; months moving → fast-forward
      const holding = !st.playing || st.t === prevT;
      prevT = st.t;
      const rate = holding ? BANNER_RATE : QUIET_RATE;
      let left = frameMs * rate;
      while (left > 1e-6) {
        const step = Math.min(frameMs, left);
        await ev(`__rec.step(${step})`);
        left -= step;
      }
      const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 95 });
      fs.writeFileSync(path.join(OUT, `f${String(f).padStart(4, '0')}.jpg`), Buffer.from(r.data, 'base64'));
      log.push({ f, t: +st.t.toFixed(3), news: st.news, rate });
      if (f % 90 === 0) console.log(`frame ${f} t=${st.t.toFixed(2)} news=${st.news} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    const cues = { fps: FPS, frames: f, playbackEnd: endAt / FPS, end: f / FPS, endCard: endAt / FPS + 0.5 };
    fs.writeFileSync(path.join(OUT, 'cues.json'), JSON.stringify(cues, null, 2));
    fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(log));
    console.log(`done: ${f} frames (${(f / FPS).toFixed(1)} s) -> ${OUT}`, JSON.stringify(cues));
  } finally {
    client?.close();
    proc.kill();
    await sleep(500);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
}

main().catch((err) => {
  console.error(`record: ${err.message}`);
  process.exitCode = 2;
});
