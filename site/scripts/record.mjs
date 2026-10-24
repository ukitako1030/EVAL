#!/usr/bin/env node
// Deterministic frame capture for promo videos (Chrome DevTools Protocol, no extra dependencies; Node >= 22).
//
// The page's clock is replaced before any page script runs (Page.addScriptToEvaluateOnNewDocument): once the app is up,
// `performance.now()` and `requestAnimationFrame` are virtual, and every output frame advances the virtual clock by
// exactly 1/fps s, runs the pending rAF callbacks (PixiJS ticker -> playback, galaxy, battle, render) and then takes a
// Page.captureScreenshot. However slow a capture is, the frames are evenly spaced in the app's time: no stutter.
// The site source is not changed. Needs the window.__* handles: dev server or a VITE_DEBUG_HOOKS=1 build (README).
//
//   node scripts/record.mjs --url "http://localhost:4791/?t=2026-10&front=general&quality=1" --out <frames dir>
//
// The shot list (what happens on which frame) is PLAN below: { at: seconds, js: page-side code }.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const URL_ = args.url ?? 'http://localhost:4791/?t=2026-10&front=general&quality=1';
const OUT = path.resolve(args.out ?? 'frames');
const W = Number(args.width ?? 540);
const H = Number(args.height ?? 960);
const DPR = Number(args.dpr ?? 2);
const FPS = Number(args.fps ?? 30);
const WARMUP_MS = Number(args.warmup ?? 5000);

// ---- the shot list (seconds of output video) ----
const HOOK_END = 2.5; // zoomed-in battle
const RAMP_START = 4.2; // 2022-11 held (camera zooms out, 開戦 caption) until here
const RAMP_END = 20.2; // 2022-11 -> 2026-10
const END = 24.0; // final state held for the end card
const PLAN = [
  {
    at: 0,
    js: `(() => { const s = __store.get(); __store.set({ front: 'general', playing: false, t: __world.months.length - 1 });
      const tg = __galaxy.cameraTarget('general');
      if (tg && tg.kind === 'planet') __renderer.focus({ ...tg, r: tg.r * 0.8 }, { durationMs: ${HOOK_END * 1000 + 300} }); })()`,
  },
  { at: HOOK_END, js: `__store.set({ front: null, t: 0, playing: false })` },
];
/**
 * Months (index into world.months) the timeline slows down on, so their caption (compose-promo.mjs) is read while that
 * month is on screen: 2024-03, 2025-03, 2025-08, 2026-06 (general-front lead changes).
 */
const KEY_MONTHS = [16, 28, 33, 43];
const DWELL = { before: 0.1, after: 0.8, rate: 0.12, edge: 0.25 }; // months; rate = speed inside the dwell (1 = cruise)
/** playback speed (months per unit time) at month position m: cruise 1, dwell near key months, eased at both ends */
function rate(m, last) {
  const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  let w = 0;
  for (const k of KEY_MONTHS) {
    const a = k - DWELL.before;
    const b = k + DWELL.after;
    w = Math.max(w, Math.min(smooth((m - (a - DWELL.edge)) / DWELL.edge), smooth((b + DWELL.edge - m) / DWELL.edge)));
  }
  const ends = Math.min(smooth(m / 1.2), smooth((last - m) / 1.2)); // ease in / out over ~1 month
  return Math.max(0.2, ends) * (1 - (1 - DWELL.rate) * w);
}
let table = null;
/** t (fractional month index) as a function of video time during the ramp */
function rampT(sec, last) {
  if (!table) {
    const N = last * 1000;
    const acc = new Float64Array(N + 1);
    for (let i = 1; i <= N; i++) acc[i] = acc[i - 1] + 1 / 1000 / rate((i - 0.5) / 1000, last);
    table = { N, acc, total: acc[N] };
  }
  const u = Math.min(1, Math.max(0, (sec - RAMP_START) / (RAMP_END - RAMP_START))) * table.total;
  let lo = 0;
  let hi = table.N;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table.acc[mid] <= u) lo = mid;
    else hi = mid;
  }
  const span = table.acc[hi] - table.acc[lo];
  return (lo + (span > 0 ? (u - table.acc[lo]) / span : 0)) / 1000;
}
/** video time (s) at which the ramp reaches month position m */
const secAt = (m, last) => {
  rampT(RAMP_START, last);
  return RAMP_START + (table.acc[Math.round(m * 1000)] / table.total) * (RAMP_END - RAMP_START);
};

const VCLOCK = `(() => {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const st = { manual: false, vt: 0, queue: [], id: 1, cancelled: new Set() };
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
  window.__rec = {
    start() { st.vt = realNow(); st.manual = true; },
    step(ms) {
      st.vt += ms;
      const q = st.queue; st.queue = [];
      for (const { id, cb } of q) if (!st.cancelled.has(id)) cb(st.vt);
      return q.length;
    },
    pending() { return st.queue.length; },
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
    await sleep(WARMUP_MS); // fonts, textures, the first-frame layout
    await ev(`document.fonts.ready.then(() => true)`);
    await ev(`__rec.start()`);
    // rAF callbacks requested before the switch are still waiting for a real frame: let them land in the virtual queue
    for (let i = 0; i < 50 && !(await ev(`__rec.pending()`)); i++) {
      await send('Page.captureScreenshot', { format: 'jpeg', quality: 10 });
      await sleep(50);
    }
    const last = await ev(`__world.months.length - 1`);
    const frames = Math.round(END * FPS);
    const dt = 1000 / FPS;
    const plan = [...PLAN];
    // let the first cue settle a few virtual frames before frame 0 is captured
    await ev(plan.shift().js);
    for (let k = 0; k < 6; k++) await ev(`__rec.step(${dt})`);
    const t0 = Date.now();
    for (let f = 0; f < frames; f++) {
      const sec = f / FPS;
      while (plan.length && plan[0].at <= sec + 1e-9) await ev(plan.shift().js);
      if (sec >= RAMP_START) await ev(`__store.set({ t: ${rampT(sec, last).toFixed(5)} })`);
      const n = await ev(`__rec.step(${dt})`);
      if (n === 0) console.log(`frame ${f}: no rAF callback pending`);
      const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 95, captureBeyondViewport: false });
      fs.writeFileSync(path.join(OUT, `f${String(f).padStart(4, '0')}.jpg`), Buffer.from(r.data, 'base64'));
      if (f % 60 === 0) console.log(`frame ${f}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    // caption cues for compose-promo.mjs: when each key month starts and when its dwell ends
    const cues = { rampStart: RAMP_START, rampEnd: RAMP_END, end: END, months: {} };
    for (const k of KEY_MONTHS) cues.months[k] = { start: +secAt(k, last).toFixed(3), end: +secAt(k + DWELL.after, last).toFixed(3) };
    fs.writeFileSync(path.join(OUT, 'cues.json'), JSON.stringify(cues, null, 2));
    console.log(`done: ${frames} frames -> ${OUT}`, JSON.stringify(cues.months));
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
