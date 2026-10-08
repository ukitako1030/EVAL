# site/scripts

## shoot.mjs — headless screenshots, console errors, fps

Drives the locally installed Google Chrome over the DevTools Protocol (no extra npm
dependencies; needs Node ≥ 22 for the global `WebSocket`). For every size it loads the page
fresh, captures JPEGs at the given times, prints console errors / uncaught exceptions /
failed requests, and optionally measures `requestAnimationFrame` fps.

The harness does **not** start a server — run one in another terminal first (from `site/`):

```sh
# dev server (HMR, fastest loop; enables the dev-only window.__renderer handle)
npx vite --port 5173 --strictPort

# or the production build, as GitHub Pages will serve it
npm run build && npx vite preview --port 4173 --strictPort
```

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
| `--eval <js>` / `--eval-at <ms>` | — / `1000` | run JS in the page (awaited) at that time, e.g. `"__renderer.focus({kind:'planet',x:356,y:-168,r:66})"` (dev server only) |
| `--resize <WxH@ms>` | — | resize the viewport mid-run; later shots are named `…-to<W>x<H>-…` |
| `--chrome <path>` | `$CHROME_PATH` or the usual install path | Chrome executable |

Exit code: `0` clean · `1` console errors / exceptions / failed requests were seen · `2` the
harness itself failed (server not reachable, Chrome not found, …). Console warnings are printed
but do not fail the run.

Notes:

- The first line of each size block prints the WebGL renderer (`gpu: …`). Headless Chrome uses
  the real GPU when one is available; fps measured on a software renderer (SwiftShader) is not
  representative.
- Dev-only debug hooks in `main.ts`: `?quality=0..3` pins the render quality level (works in
  preview too); `window.__renderer`, `__galaxy`, `__store` and `__world` expose the renderer,
  the galaxy overview, the app store and the loaded data (dev server only), e.g.
  `--eval "__store.set({ front: 'image' })"` zooms into a planet.
