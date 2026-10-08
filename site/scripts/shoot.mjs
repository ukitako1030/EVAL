#!/usr/bin/env node
// Headless screenshot + fps harness (Chrome DevTools Protocol, no extra dependencies; Node ≥ 22 for global WebSocket).
// See scripts/README.md. Example:
//   node scripts/shoot.mjs --url "http://localhost:5173/?t=2025-03" --out shots/ --sizes 1440x900,390x844 --at 1500,6000 --fps
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HELP = `usage: node scripts/shoot.mjs [options]
  --url <url>        page to load (default http://localhost:5173/)
  --out <dir>        output directory (default shots/)
  --sizes <list>     comma-separated WxH (default 1440x900,390x844); widths < 768 use mobile emulation
  --at <list>        comma-separated ms after navigation to capture at (default 1500,6000)
  --fps              after the last capture, measure requestAnimationFrame fps over --fps-ms
  --fps-ms <ms>      fps sampling window (default 3000)
  --name <prefix>    file name prefix (default: derived from the URL query)
  --dpr <n>          device scale factor (default 1 desktop, 2 mobile)
  --eval <js>        evaluate this JS in the page at --eval-at ms (e.g. drive the dev-only window.__renderer)
  --eval-at <ms>     when to run --eval (default 1000)
  --resize <WxH@ms>  resize the viewport to WxH at ms (checks the page follows a window resize)
  --chrome <path>    Chrome executable (default: $CHROME_PATH or the usual install location)
exit code: 0 ok · 1 console errors / exceptions seen · 2 harness failure`;

function parseArgs(argv) {
  const o = { url: 'http://localhost:5173/', out: 'shots/', sizes: '1440x900,390x844', at: '1500,6000', fps: false, 'fps-ms': '3000' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(HELP);
      process.exit(0);
    }
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const key = a.slice(2);
    if (key === 'fps') o.fps = true;
    else if (i + 1 < argv.length) o[key] = argv[++i];
    else throw new Error(`missing value for ${a}`);
  }
  return o;
}

function findChrome(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found — pass --chrome <path> or set CHROME_PATH');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nameFromUrl(u) {
  const q = new URL(u).search.slice(1);
  const s = decodeURIComponent(q).replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'shot';
}

/** Minimal CDP client over the page target's WebSocket. */
async function connect(wsUrl, onEvent) {
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
    } else if (m.method) onEvent(m.method, m.params);
  });
  const send = (method, params = {}, timeoutMs = 30000) =>
    new Promise((res, rej) => {
      const i = ++id;
      const timer = setTimeout(() => {
        pending.delete(i);
        rej(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      pending.set(i, { res: (v) => (clearTimeout(timer), res(v)), rej: (e) => (clearTimeout(timer), rej(e)) });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { send, close: () => ws.close() };
}

const FPS_PROBE = (ms) => `new Promise((resolve) => {
  const t0 = performance.now(); let last = t0, n = 0; const gaps = [];
  function f(t) {
    gaps.push(t - last); last = t; n++;
    if (t - t0 < ${ms}) requestAnimationFrame(f);
    else {
      gaps.shift(); gaps.sort((a, b) => a - b);
      const p = (q) => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] : 0;
      resolve({ fps: (n - 1) * 1000 / (t - t0), frames: n - 1, p50: p(0.5), p95: p(0.95), worst: gaps.length ? gaps[gaps.length - 1] : 0,
        long: gaps.filter((g) => g > 25).length });
    }
  }
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(f); });
})`;

const GPU_PROBE = `(() => { try {
  const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
  if (!gl) return 'no WebGL';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
} catch (e) { return 'probe failed: ' + e; } })()`;

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const sizes = o.sizes.split(',').map((s) => {
    const m = /^(\d+)x(\d+)$/.exec(s.trim());
    if (!m) throw new Error(`bad size ${s} (want WxH)`);
    return { w: Number(m[1]), h: Number(m[2]) };
  });
  const times = o.at.split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!times.length) throw new Error('--at needs at least one time in ms');
  const fpsMs = Number(o['fps-ms']) || 3000;
  let resize = null;
  if (o.resize) {
    const m = /^(\d+)x(\d+)@(\d+)$/.exec(o.resize);
    if (!m) throw new Error(`bad --resize ${o.resize} (want WxH@ms)`);
    resize = { w: Number(m[1]), h: Number(m[2]), ms: Number(m[3]) };
  }
  const prefix = o.name ?? nameFromUrl(o.url);
  const outDir = path.resolve(o.out);
  fs.mkdirSync(outDir, { recursive: true });

  if (/^https?:/.test(o.url)) {
    try {
      await fetch(o.url, { method: 'GET' });
    } catch {
      throw new Error(`${o.url} is not reachable — start a server first (npx vite --port 5173, or npm run build && npx vite preview --port 4173)`);
    }
  }

  const chrome = findChrome(o.chrome);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwar-shoot-'));
  const proc = spawn(
    chrome,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'],
    { stdio: 'ignore' },
  );
  let client;
  let failed = false;
  try {
    let port;
    for (let i = 0; i < 100 && !port; i++) {
      try {
        port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      } catch {
        await sleep(100);
      }
    }
    if (!port) throw new Error('Chrome did not open a DevTools port');
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
      } catch {}
      if (!target) await sleep(100);
    }
    if (!target) throw new Error('no page target');

    let current = [];
    const warnings = [];
    client = await connect(target.webSocketDebuggerUrl, (method, p) => {
      if (method === 'Runtime.exceptionThrown') {
        const d = p.exceptionDetails;
        current.push(`exception: ${d.exception?.description ?? d.text} (${d.url ?? ''}:${d.lineNumber ?? ''})`);
      } else if (method === 'Runtime.consoleAPICalled') {
        const text = p.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
        if (p.type === 'error' || p.type === 'assert') current.push(`console.${p.type}: ${text}`);
        else if (p.type === 'warning') warnings.push(`console.warn: ${text}`);
      } else if (method === 'Log.entryAdded' && p.entry.level === 'error') {
        current.push(`log: ${p.entry.text}${p.entry.url ? ` (${p.entry.url})` : ''}`);
      }
    });
    const { send } = client;
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Log.enable');
    const version = await send('Browser.getVersion');
    const desktopUA = version.userAgent;
    const chromeVer = /Chrome\/([\d.]+)/.exec(desktopUA)?.[1] ?? '130.0.0.0';
    const mobileUA = `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Mobile Safari/537.36`;
    console.log(`chrome ${version.product} · ${o.url}`);

    let gpuShown = false;
    let errorCount = 0;
    for (const { w, h } of sizes) {
      const mobile = w < 768;
      const dpr = o.dpr ? Number(o.dpr) : mobile ? 2 : 1;
      await send('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: dpr, mobile,
        screenOrientation: h >= w ? { type: 'portraitPrimary', angle: 0 } : { type: 'landscapePrimary', angle: 90 },
      });
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
      await send('Emulation.setUserAgentOverride', { userAgent: mobile ? mobileUA : desktopUA });
      current = [];
      warnings.length = 0;
      const t0 = Date.now();
      await send('Page.navigate', { url: o.url });
      console.log(`\n[${w}x${h}${mobile ? ' mobile' : ''} @${dpr}x]`);
      const steps = times.map((ms) => ({ ms, kind: 'shot' }));
      if (o.eval) steps.push({ ms: Number(o['eval-at'] ?? 1000), kind: 'eval' });
      if (resize) steps.push({ ms: resize.ms, kind: 'resize' });
      steps.sort((a, b) => a.ms - b.ms || (a.kind === 'shot' ? 1 : -1));
      let shotW = w;
      let shotH = h;
      for (const { ms, kind } of steps) {
        const wait = t0 + ms - Date.now();
        if (wait > 0) await sleep(wait);
        if (kind === 'resize') {
          shotW = resize.w;
          shotH = resize.h;
          await send('Emulation.setDeviceMetricsOverride', { width: shotW, height: shotH, deviceScaleFactor: dpr, mobile });
          console.log(`  resize @${ms}ms → ${shotW}x${shotH}`);
          continue;
        }
        if (kind === 'eval') {
          const r = await send('Runtime.evaluate', { expression: o.eval, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) current.push(`--eval threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
          else console.log(`  eval @${ms}ms → ${JSON.stringify(r.result?.value) ?? 'undefined'}`);
          continue;
        }
        const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
        const resized = shotW !== w || shotH !== h ? `-to${shotW}x${shotH}` : '';
        const file = path.join(outDir, `${prefix}-${w}x${h}${resized}-${String(ms).padStart(5, '0')}ms.jpg`);
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        console.log(`  shot ${path.relative(process.cwd(), file)}`);
      }
      if (!gpuShown) {
        const g = await send('Runtime.evaluate', { expression: GPU_PROBE, returnByValue: true });
        console.log(`  gpu: ${g.result?.value}`);
        gpuShown = true;
      }
      if (o.fps) {
        const r = await send('Runtime.evaluate', { expression: FPS_PROBE(fpsMs), awaitPromise: true, returnByValue: true }, fpsMs + 30000);
        const v = r.result?.value;
        if (v) {
          console.log(`  fps: ${v.fps.toFixed(1)} over ${fpsMs} ms (${v.frames} frames; frame p50 ${v.p50.toFixed(1)} ms, p95 ${v.p95.toFixed(1)} ms, worst ${v.worst.toFixed(1)} ms, ${v.long} > 25 ms)`);
        } else console.log(`  fps: probe failed ${JSON.stringify(r.exceptionDetails ?? r).slice(0, 300)}`);
      }
      for (const wmsg of warnings) console.log(`  ${wmsg}`);
      console.log(`  errors: ${current.length ? '\n    ' + current.join('\n    ') : 'none'}`);
      errorCount += current.length;
    }
    if (errorCount) process.exitCode = 1;
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    client?.close();
    proc.kill();
    await sleep(400);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
    if (failed) process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(`shoot: ${err.message}`);
  process.exitCode = 2;
});
