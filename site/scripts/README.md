# site/scripts

## shoot.mjs — headless screenshots, console errors, fps

Drives the locally installed Google Chrome over the DevTools Protocol (no extra npm
dependencies; needs Node ≥ 22 for the global `WebSocket`). For every size it loads the page
fresh, captures JPEGs at the given times, prints console errors / uncaught exceptions /
failed requests, and optionally measures `requestAnimationFrame` fps.

The harness does **not** start a server — run one in another terminal first (from `site/`):

```sh
# dev server (HMR, fastest loop; debug switches and window.__* handles on)
npx vite --port 5173 --strictPort

# or the production build, as GitHub Pages will serve it (debug switches and handles OFF)
npm run build && npx vite preview --port 4173 --strictPort

# or a production build with the debug hooks compiled in (fps / flash runs on minified code)
VITE_DEBUG_HOOKS=1 npx vite build --outDir dist-debug && npx vite preview --outDir dist-debug --port 4174 --strictPort
```

The debug switches (`?quality`, `?hover`, `?debugFlash`) and the `window.__*` handles only work on the
dev server or in a build made with `VITE_DEBUG_HOOKS=1` (on PowerShell: `$env:VITE_DEBUG_HOOKS='1'; npx vite build --outDir dist-debug`).
The deployed build ignores them, and its address bar drops them. Never deploy a `VITE_DEBUG_HOOKS` build.

Then, also from `site/`:

```sh
node scripts/shoot.mjs --url "http://localhost:5173/?t=2025-03" --out shots/ --sizes 1440x900,390x844 --at 1500,6000 --fps
# against the preview build
node scripts/shoot.mjs --url "http://localhost:4173/?t=2025-03" --fps
# npm alias
npm run shoot -- --url "http://localhost:5173/" --fps
```

| option | default | meaning |
| --- | --- | --- |
| `--url <url>` | `http://localhost:5173/` | page to load (`file://` works too, e.g. the mockups) |
| `--out <dir>` | `shots/` | output directory (git-ignored) |
| `--sizes <WxH,…>` | `1440x900,390x844` | viewports; widths < 768 get mobile emulation (touch, mobile UA, DPR 2) |
| `--at <ms,…>` | `1500,6000` | capture times, in ms after navigation starts |
| `--fps` | off | after the last capture, sample rAF for `--fps-ms` and print fps, p50/p95/worst frame time, frames > 25 ms |
| `--fps-ms <ms>` | `3000` | fps sampling window |
| `--name <prefix>` | from the URL query | file name prefix → `<prefix>-<W>x<H>-<ms>ms.jpg` |
| `--dpr <n>` | 1 desktop, 2 mobile | device scale factor |
| `--eval <js>` / `--eval-at <ms>` | — / `1000` | run JS in the page (awaited) at that time, e.g. `"__renderer.focus({kind:'planet',x:356,y:-168,r:66})"` (the `__*` handles: dev server / debug build only) |
| `--eval-file <path>` | — | like `--eval`, the JS read from a file (scripted runs, e.g. a playback with battle-news shockwaves) |
| `--eval-timeout <ms>` | `30000` | how long an awaited `--eval` may run |
| `--cpu-throttle <n>` | `1` | DevTools CPU throttling (`4` ≈ a mid-range phone) — fps under a slow CPU |
| `--console` | off | also print the page's `console.log` / `console.info` lines (e.g. the `?debugFlash` log) |
| `--reduced-motion` | off | emulate `prefers-reduced-motion: reduce` (CDP `Emulation.setEmulatedMedia`) |
| `--resize <WxH@ms>` | — | resize the viewport mid-run; later shots are named `…-to<W>x<H>-…` |
| `--swipe <x1,y1,x2,y2@ms;…>` | — | one-finger touch swipes (CDP `Input.dispatchTouchEvent`, ~180 ms each, mobile sizes) — e.g. `300,400,80,410@3000` swipes left on a phone (next front) |
| `--chrome <path>` | `$CHROME_PATH` or the usual install path | Chrome executable |

Exit code: `0` clean · `1` console errors / exceptions / failed requests were seen · `2` the
harness itself failed (server not reachable, Chrome not found, …). Console warnings are printed
but do not fail the run.

Notes:

- The first line of each size block prints the WebGL renderer (`gpu: …`). Headless Chrome uses
  the real GPU when one is available; fps measured on a software renderer (SwiftShader) is not
  representative.
- Debug query parameters read by `main.ts` (dev server or `VITE_DEBUG_HOOKS=1` build only — a plain
  `npm run build` ignores them): `?quality=0..3` pins the render quality level (otherwise the fps governor steps it down on slow
  machines), `?hover=<org>` pins the org highlight, e.g. `?hover=google`, and `?debugFlash` logs the
  flashes the flash budget granted per second to the console (`--console` prints them) and keeps
  running totals on `window.__flashStats` (`maxPerSecond` = most grants in any 1 s window; `perSecond`
  keeps the last 600 seconds).
- App state from the URL: `?t=YYYY-MM` opens paused at that month (a shared link: no intro),
  `?front=<id>` zooms into a front, `?lang=ja|en`. Without `t`, a fresh browser profile — which is
  what every harness run gets — plays the first-visit intro (title card, then the war from 2022-11 at 1×).
  Unit detail without dev handles: `--eval "document.querySelector('.rank-name[data-unit=gpt]').click()"`.
- Handles on the dev server and in a `VITE_DEBUG_HOOKS=1` build: `window.__renderer`, `__galaxy`, `__store`,
  `__world`, `__fleets`, `__highlight` and `__battle` expose the renderer, the galaxy overview, the
  app store, the loaded data, the fleets, the org highlight and the zoomed swarm battle, e.g.
  `--eval "__store.set({ front: 'image' })"` zooms into a planet, `--eval "__fleets.count"` prints
  how many ships are flying and `__battle.shockwave('gpt')` fires a shockwave.
- `scripts/flash-run.js` (page-side, for `--eval-file`, page opened with `?debugFlash`): presses the app's
  own speed (→ 4×) and play buttons, so the real playback (holds on news months), banner queue and battle
  shockwaves run until playback stops at the last month (or `window.FLASH_RUN_TO`, e.g. `'2025-12'`, is
  reached); logs every banner and a summary (`window.__flashRun`), then fires a burst of 12 shockwaves in
  ~1.1 s (`window.__battle`). Needs `?debugFlash`, so run it against the dev server or a
  `VITE_DEBUG_HOOKS=1` build (port 4174 above), not the plain preview build. E.g.
  `node scripts/shoot.mjs --url "http://localhost:5173/?front=general&t=2022-11&debugFlash" --sizes 1440x900 --eval-file scripts/flash-run.js --eval-at 3500 --at 4000 --fps --fps-ms 70000 --console`
