/**
 * Galaxy overview (mockup A): seven planets — the general front as the hub, six fronts orbiting it —
 * joined by animated data streams, with frontline sparks, orbit decoration, hover reticle, click-to-
 * enter and screen-space labels. Owns layout (pure maths in ./layout) and orchestrates ./planet,
 * ./sparks and ./labels. Feed it the current frames of every front once per frame via `update`.
 */
import { Container, Graphics, Sprite } from 'pixi.js';
import type { FrontId, Localized, World } from '../data/types';
import type { UnitFrame } from '../data/timeline';
import type { AppState, Store } from '../state/store';
import type { FlashBudget } from '../fx/flashBudget';
import type { Renderer } from './app';
import { GALAXY_EXTENT, cameraFor, type CameraTarget } from './camera';
import { galaxyLayout, isPortrait, strHash, type GalaxyLayout } from './layout';
import { createPlanet, type Planet, type PlanetFrame } from './planet';
import { createPlanetTextures } from './planetTextures';
import { createSparks } from './sparks';
import { createGalaxyLabels } from './labels';

export interface GalaxyOptions {
  world: World;
  store: Store<AppState>;
  /** the app-wide flash limiter; sudden glow rises are routed through it */
  flashes?: FlashBudget | null;
}

export interface Galaxy {
  /** world-space root, added to `renderer.layers.world` */
  readonly root: Container;
  /** world-space slots other renderers draw into (fleets: behind / front of the planets) */
  readonly layers: { readonly behind: Container; readonly planets: Container; readonly front: Container };
  /** screen-space labels, added to `renderer.layers.fx` */
  readonly labels: Container;
  readonly layout: GalaxyLayout;
  /** advance animation and draw; `frames` = `frontFrame(world, f, state.t, state.sortBy)` for every front */
  update(dt: number, frames: Partial<Record<FrontId, readonly UnitFrame[]>>): void;
  planet(front: FrontId): Planet | null;
  /** camera target for the overview (null) or a planet */
  cameraTarget(front: FrontId | null): CameraTarget;
  /**
   * point `u` (0 = at the front's planet … 1 = at the hub) along a data stream; null for the hub itself (and before
   * the first `update`). Pass `out` to have it filled instead of allocating (fleets call this per ship per frame).
   */
  streamPoint(front: FrontId, u: number, out?: { x: number; y: number }): { x: number; y: number } | null;
  /** the galaxy's animation clock (s) — also the `now` its flash-budget requests use, so share it with other effects */
  readonly time: number;
  /** per-org territory brightness multiplier (org highlight); null = everyone at 1 */
  setEmphasis(fn: ((org: string) => number) | null): void;
  /** which front is the big centre planet in the portrait layout (default general) */
  setPortraitFocus(front: FrontId | null): void;
  /** called when the layout changes (resize / orientation): re-aim the camera */
  onLayoutChange(cb: (layout: GalaxyLayout) => void): () => void;
  /** re-render text after web fonts finish loading */
  refreshText(): void;
  destroy(): void;
}

interface Stream {
  front: FrontId;
  p: number[]; // p0x p0y p1x p1y p2x p2y p3x p3y
  seed: number;
  len: number;
  xs: Float64Array;
  ys: Float64Array;
  ls: Float64Array;
}

const STREAM_SAMPLES = 40;
const REBUILD_EVERY = 1 / 20;
const PACKETS = 5;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function bez(p: number[], t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]];
}

export function createGalaxy(renderer: Renderer, opts: GalaxyOptions): Galaxy {
  const { world, store } = opts;
  const flashes = opts.flashes ?? null;
  const tex = createPlanetTextures();
  const names = new Map<FrontId, Localized>(world.fronts.map((f) => [f.id, f.name]));

  const root = new Container({ label: 'galaxy' });
  const decor = new Container({ label: 'orbit-decor' });
  const orbitGlow = new Graphics();
  const orbitDash = new Graphics();
  const orbitTicks = new Graphics();
  const orbitOuter = new Graphics();
  for (const g of [orbitGlow, orbitDash, orbitTicks, orbitOuter]) g.blendMode = 'add';
  // the dashed orbit and the tick ring are circles inside a squashing wrapper: rotating the inner
  // graphic slides the dashes along the ellipse instead of turning the ellipse
  const dashWrap = new Container();
  const tickWrap = new Container();
  dashWrap.addChild(orbitDash);
  tickWrap.addChild(orbitTicks);
  decor.addChild(orbitGlow, orbitOuter, dashWrap, tickWrap);
  const streamG = new Graphics();
  streamG.blendMode = 'add';
  const packets = new Container({ label: 'packets' });
  const behind = new Container({ label: 'behind' });
  const planetLayer = new Container({ label: 'planets' });
  const sparks = createSparks(tex.streak);
  const front = new Container({ label: 'front' });
  const reticle = new Graphics();
  reticle.blendMode = 'add';
  root.addChild(decor, streamG, packets, behind, planetLayer, sparks.container, front, reticle);
  renderer.layers.world.addChild(root);
  const labels = createGalaxyLabels();
  renderer.layers.fx.addChild(labels.container);

  let portraitFocus: FrontId | null = null;
  let layoutKey = '';
  let layout: GalaxyLayout = computeLayout();
  const planets: Planet[] = layout.planets.map((s) => createPlanet(s, tex));
  const byId = new Map<FrontId, Planet>(planets.map((p) => [p.id, p]));
  const rebuildAcc = planets.map((_, i) => REBUILD_EVERY - (i * REBUILD_EVERY) / planets.length);
  const streams: Stream[] = [];
  const packetSprites: Sprite[] = [];
  const layoutCbs = new Set<(l: GalaxyLayout) => void>();
  let hovered: FrontId | null = null;
  let emphasis: ((org: string) => number) | null = null;
  let time = 0;
  let decorPx = 0;

  for (const p of planets) {
    planetLayer.addChild(p.root);
    p.root.on('pointerover', () => (hovered = p.id));
    p.root.on('pointerout', () => {
      if (hovered === p.id) hovered = null;
    });
    p.root.on('pointertap', () => store.set({ front: p.id, selectedUnit: null }));
  }

  function computeLayout(): GalaxyLayout {
    const vp = renderer.viewport;
    const area = isPortrait(vp) ? { w: 600, h: (600 * vp.h) / Math.max(1, vp.w) } : GALAXY_EXTENT;
    const l = galaxyLayout(area, world.fronts, { focus: portraitFocus });
    layoutKey = `${l.portrait}|${Math.round(l.extent.w)}x${Math.round(l.extent.h)}|${l.hub}`;
    return l;
  }

  function relayoutIfNeeded() {
    const prev = layoutKey;
    const next = computeLayout();
    if (layoutKey === prev) return;
    layout = next;
    for (const s of layout.planets) byId.get(s.id)?.setSlot(s);
    decorPx = 0;
    for (const cb of layoutCbs) cb(layout);
  }

  function drawDecor(px: number) {
    const { w, h } = layout.extent;
    const rx = w * (layout.portrait ? 0.44 : 0.47);
    const ry = h * (layout.portrait ? 0.36 : 0.42);
    const k = ry / rx;
    orbitGlow.clear().ellipse(0, 0, rx, ry).stroke({ width: 14 * px, color: 0x5ac8ff, alpha: 0.045 });
    orbitOuter.clear().ellipse(0, 0, rx * 1.27, ry * 1.33).stroke({ width: px, color: 0xa078ff, alpha: 0.08 });
    // dashed orbit + tick ring drawn as circles and squashed into ellipses, so rotating them moves the dashes
    orbitDash.clear();
    const n = Math.round((Math.PI * 2 * rx) / (12 * px));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      orbitDash.moveTo(Math.cos(a) * rx, Math.sin(a) * rx).arc(0, 0, rx, a, a + ((Math.PI * 2) / n) * 0.18);
    }
    orbitDash.stroke({ width: px, color: 0x5ac8ff, alpha: 0.22 });
    dashWrap.scale.set(1, k);
    orbitTicks.clear();
    const R2 = rx * 1.27;
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const L = (i % 8 === 0 ? 10 : 4) * px;
      orbitTicks.moveTo(Math.cos(a) * R2, Math.sin(a) * R2).lineTo(Math.cos(a) * (R2 + L), Math.sin(a) * (R2 + L));
    }
    orbitTicks.stroke({ width: px, color: 0x78dcff, alpha: 0.2 });
    tickWrap.scale.set(1, (ry * 1.33) / R2);
    decorPx = px;
  }

  function updateStreams(px: number, scale: number, t: number, reduced: boolean) {
    const hub = byId.get(layout.hub);
    streamG.clear();
    if (!hub) return;
    const wz = clamp(scale, 0.6, 2.5);
    const bend = 0.073 * layout.extent.w;
    let si = 0;
    for (const p of planets) {
      if (p === hub) continue;
      let s = streams[si];
      if (!s) {
        s = { front: p.id, p: new Array(8).fill(0), seed: strHash(p.id) / (Math.PI * 2), len: 0, xs: new Float64Array(STREAM_SAMPLES + 1), ys: new Float64Array(STREAM_SAMPLES + 1), ls: new Float64Array(STREAM_SAMPLES + 1) };
        streams[si] = s;
        for (let i = 0; i < PACKETS; i++) {
          const sp = new Sprite({ texture: tex.glow, anchor: 0.5, tint: 0x7fefff });
          sp.blendMode = 'add';
          packets.addChild(sp);
          packetSprites.push(sp);
        }
      }
      s.front = p.id;
      let dx = hub.x - p.x;
      let dy = hub.y - p.y;
      const L = Math.hypot(dx, dy) || 1;
      dx /= L;
      dy /= L;
      const nx = -dy;
      const ny = dx;
      const q = s.p;
      q[0] = p.x + dx * p.slot.r * 1.1;
      q[1] = p.y + dy * p.slot.r * 1.1;
      q[6] = hub.x - dx * hub.slot.r * 1.14;
      q[7] = hub.y - dy * hub.slot.r * 1.14;
      q[2] = q[0] + (q[6] - q[0]) * 0.33 + nx * bend;
      q[3] = q[1] + (q[7] - q[1]) * 0.33 + ny * bend;
      q[4] = q[0] + (q[6] - q[0]) * 0.66 + nx * bend;
      q[5] = q[1] + (q[7] - q[1]) * 0.66 + ny * bend;
      let len = 0;
      for (let i = 0; i <= STREAM_SAMPLES; i++) {
        const [x, y] = bez(q, i / STREAM_SAMPLES);
        if (i) len += Math.hypot(x - s.xs[i - 1], y - s.ys[i - 1]);
        s.xs[i] = x;
        s.ys[i] = y;
        s.ls[i] = len;
      }
      s.len = len;
      const curve = () => streamG.moveTo(q[0], q[1]).bezierCurveTo(q[2], q[3], q[4], q[5], q[6], q[7]);
      curve().stroke({ width: 9 * wz * px, color: 0x28aaff, alpha: 0.05 });
      curve().stroke({ width: 2.2 * wz * px, color: 0x3cd2ff, alpha: 0.16 });
      // travelling dashes
      const dash = 3 * wz * px;
      const period = 15 * wz * px;
      const off = reduced ? 0 : (t * 34 * px) % period;
      let j = 0;
      for (let d = off - period; d < len; d += period) {
        const a = Math.max(0, d);
        const b = Math.min(len, d + dash);
        if (b <= a) continue;
        while (j < STREAM_SAMPLES - 1 && s.ls[j + 1] < a) j++;
        const pa = at(s, a, j);
        let k = j;
        while (k < STREAM_SAMPLES - 1 && s.ls[k + 1] < b) k++;
        const pb = at(s, b, k);
        streamG.moveTo(pa[0], pa[1]).lineTo(pb[0], pb[1]);
      }
      streamG.stroke({ width: 1.5 * wz * px, color: 0x82f0ff, alpha: 0.55 });
      for (let i = 0; i < PACKETS; i++) {
        const sp = packetSprites[si * PACKETS + i];
        let u = reduced ? (i + 0.5) / PACKETS : (t * 0.2 + i / PACKETS + s.seed) % 1;
        if (i % 2) u = 1 - u;
        const [x, y] = bez(q, u);
        sp.position.set(x, y);
        sp.width = sp.height = 18 * wz * px;
        sp.alpha = 0.55 * Math.sin(u * Math.PI);
      }
      si++;
    }
  }

  function at(s: Stream, d: number, i: number): [number, number] {
    const l0 = s.ls[i];
    const l1 = s.ls[i + 1];
    const f = l1 > l0 ? clamp((d - l0) / (l1 - l0), 0, 1) : 0;
    return [s.xs[i] + (s.xs[i + 1] - s.xs[i]) * f, s.ys[i] + (s.ys[i + 1] - s.ys[i]) * f];
  }

  function drawReticle(px: number, t: number) {
    reticle.clear();
    const st = store.get();
    const p = hovered ? byId.get(hovered) : null;
    if (!p || st.front === p.id) return;
    const rr = p.slot.r * 1.3 + 6 * px;
    for (let i = 0; i < 4; i++) {
      const a = t * 0.9 + (i * Math.PI) / 2;
      reticle.moveTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr).arc(p.x, p.y, rr, a, a + 0.5);
    }
    reticle.stroke({ width: 1.6 * px, color: 0x78f0ff, alpha: 0.9 });
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      reticle.moveTo(p.x + Math.cos(a) * (rr + 8 * px), p.y + Math.sin(a) * (rr + 8 * px)).arc(p.x, p.y, rr + 8 * px, a, a + ((Math.PI * 2) / n) * 0.3);
    }
    reticle.stroke({ width: px, color: 0x78f0ff, alpha: 0.35 });
  }

  return {
    root,
    layers: { behind, planets: planetLayer, front },
    labels: labels.container,
    get layout() {
      return layout;
    },
    get time() {
      return time;
    },
    update(dt, frames) {
      time += dt;
      const st = store.get();
      const reduced = st.reducedMotion;
      relayoutIfNeeded();
      const cam = renderer.camera;
      const scale = Math.max(1e-6, cam.scale);
      const px = 1 / scale;
      if (decorPx === 0 || Math.abs(px / decorPx - 1) > 0.1) drawDecor(px);
      if (!reduced) {
        orbitDash.rotation = (time * 12 * px) / (layout.extent.w * 0.47);
        orbitTicks.rotation = time * 0.01;
      }

      // one flash grant per frame at most, shared by every territory that brightens suddenly
      let grant: number | null = null;
      const proxy = { request: (i: number, now: number) => (grant ??= flashes ? flashes.request(1, now) : i) };
      sparks.setScale(renderer.particleScale);
      planets.forEach((p, i) => {
        const fr = frames[p.id];
        if (fr) p.setFrames(fr);
        rebuildAcc[i] += dt;
        const rebuild = rebuildAcc[i] >= REBUILD_EVERY;
        if (rebuild) rebuildAcc[i] = Math.min(REBUILD_EVERY, rebuildAcc[i] - REBUILD_EVERY);
        const f: PlanetFrame = { time, now: time, px, rebuild, reduced, hover: hovered === p.id && st.front !== p.id, flashes: proxy, emphasis };
        p.update(dt, f);
        sparks.emit(p, dt, px, reduced);
      });
      sparks.update(dt, px);
      updateStreams(px, scale, time, reduced);
      drawReticle(px, reduced ? 0 : time);

      const ov = cameraFor({ kind: 'galaxy', extent: layout.extent }, renderer.viewport).scale;
      const zoom = scale / Math.max(1e-6, ov);
      labels.update(planets, names, {
        lang: st.lang,
        toScreen: (x, y) => renderer.worldToScreen(x, y),
        scale,
        alpha: clamp(1 - (zoom - 1.15) / 0.6, 0, 1),
        compact: layout.portrait,
        hover: hovered && st.front !== hovered ? hovered : null,
        screen: { w: renderer.app.screen.width, h: renderer.app.screen.height },
      });
    },
    planet(id) {
      return byId.get(id) ?? null;
    },
    cameraTarget(id) {
      const s = id ? layout.planets.find((p) => p.id === id) : null;
      return s ? { kind: 'planet', x: s.x, y: s.y, r: s.r } : { kind: 'galaxy', extent: layout.extent };
    },
    streamPoint(id, u, out) {
      if (id === layout.hub) return null;
      for (let i = 0; i < streams.length; i++) {
        const s = streams[i];
        if (s.front !== id) continue;
        const q = s.p;
        const t = clamp(u, 0, 1);
        const v = 1 - t;
        const a = v * v * v;
        const b = 3 * v * v * t;
        const c = 3 * v * t * t;
        const d = t * t * t;
        const o = out ?? { x: 0, y: 0 };
        o.x = a * q[0] + b * q[2] + c * q[4] + d * q[6];
        o.y = a * q[1] + b * q[3] + c * q[5] + d * q[7];
        return o;
      }
      return null;
    },
    setEmphasis(fn) {
      emphasis = fn;
    },
    setPortraitFocus(id) {
      portraitFocus = id;
    },
    onLayoutChange(cb) {
      layoutCbs.add(cb);
      return () => void layoutCbs.delete(cb);
    },
    refreshText() {
      labels.refresh();
    },
    destroy() {
      layoutCbs.clear();
      for (const p of planets) p.destroy();
      sparks.destroy();
      labels.destroy();
      root.destroy({ children: true });
      tex.destroy();
    },
  };
}
