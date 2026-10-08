/**
 * One planet of the galaxy overview (ported from mockups/a-galaxy.html `drawPlanet`): dark sphere,
 * territory wedges in org colours (area = scale), animated frontlines that wobble and bulge toward the
 * weaker side (strength pressure), offensive pulses and glow ∝ strength, fog over estimated data,
 * sphere shading, rim light, atmosphere halo in the leader's colour and a tilted ring.
 *
 * Wedge / frontline geometry is rebuilt only when the galaxy grants a rebuild slot (≈ 20 Hz, staggered)
 * and something moved; brightness, flicker, pulses, dashes and fog drift are per-frame updates. All of it is
 * drawn into dynamic meshes (./dynMesh) refilled in place: territory brightness and frontline flicker only
 * rescale vertex alphas, and nothing is allocated per frame. Off-screen planets skip their drawing.
 */
import { Circle, Container, Sprite } from 'pixi.js';
import type { FrontId } from '../data/types';
import type { UnitFrame } from '../data/timeline';
import type { FlashBudget } from '../fx/flashBudget';
import { START_ANGLE, TAU, borderAngle, followGlow, frontlines, territories, wedgeBrightness, type Frontline, type PlanetSlot, type Wedge } from './layout';
import { createFog } from './fog';
import { createPlanetDecor } from './planetDecor';
import { drawFrontline, drawPulses, drawRimGlow, fillStep, fillWedge, rimEnd, rimStart, sampleRho, type PulseView } from './planetDraw';
import { colorGain, hexColor, mixColor } from './color';
import { createDynMesh, type DynMesh } from './dynMesh';
import { fillCircle, rgba, strokeArc, strokeCircle } from './meshBuild';
import type { PlanetTextures } from './planetTextures';

export interface PlanetFrame {
  /** animation clock (s) */
  time: number;
  /** clock for the flash budget (s) */
  now: number;
  /** world units per screen pixel (1 / camera scale) */
  px: number;
  /** this planet may rebuild its wedge geometry this frame */
  rebuild: boolean;
  reduced: boolean;
  hover: boolean;
  /** sudden glow rises go through this (see `followGlow`) */
  flashes: Pick<FlashBudget, 'request'> | null;
  /** per-org brightness multiplier (org highlight, Task 12); null = 1 for everyone */
  emphasis: ((org: string) => number) | null;
  /** false while the planet is entirely off screen: state keeps updating, drawing is skipped (default true) */
  visible?: boolean;
}

export interface Planet {
  readonly id: FrontId;
  readonly root: Container;
  /** planet-local slot between the frontlines and the fog (the zoomed swarm battle draws here, under the fog and sphere shading) */
  readonly inner: Container;
  readonly slot: PlanetSlot;
  /** current territories (latest frames) */
  readonly wedges: readonly Wedge[];
  readonly lines: readonly Frontline[];
  /** rank-1 unit of the frames (by the store's sort order) */
  readonly leader: UnitFrame | null;
  /** atmosphere colour (leader colour mixed with cyan) */
  readonly atmosphere: number;
  /** animated world position (slot + gentle bob) */
  readonly x: number;
  readonly y: number;
  setSlot(slot: PlanetSlot): void;
  setFrames(frames: readonly UnitFrame[]): void;
  update(dt: number, f: PlanetFrame): void;
  /** frontline k's current angle at radius fraction rho (local, radians) */
  borderAt(k: number, rho: number): number;
  /** wedge k's current angular range at radius fraction rho */
  rangeAt(k: number, rho: number): [number, number];
  /** displayed brightness 0..1.12 of a unit's territory */
  brightness(id: string): number;
  /** fog opacity multiplier (1 = full; the zoomed battle thins the veil so the swarms stay visible in it) */
  setFogFade(k: number): void;
  destroy(): void;
}

const ATM_BASE = 0x3cc8ff;
const NO_ATM = 0x3c78c8;
const NO_LEAD = 0x5a7bb0;
const CROSSFADE = 0.35;
/** reduced motion: frontlines keep a gentle, frozen wobble */
export const REDUCED_AMP = 0.35;
/** border samples per frontline at most (NS + 1, NS ≤ 30) */
const MAX_SAMPLES = 31;
/** vertex alphas are 8-bit: smaller brightness steps are not worth a colour upload */
const ALPHA_EPS = 0.5 / 255;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function changed(a: readonly Wedge[], b: readonly Wedge[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || Math.abs(x.a0 - y.a0) > 0.0015 || Math.abs(x.a1 - y.a1) > 0.0015 || Math.abs(x.s - y.s) > 0.25 || Math.abs(x.fogBlend - y.fogBlend) > 0.01)
      return true;
  }
  return false;
}

/** a territory's vertices in a wedge layer's mesh and the brightness last applied to them */
interface WedgeRange {
  id: string;
  v0: number;
  v1: number;
  alpha: number;
}

interface WedgeLayer {
  m: DynMesh;
  ranges: WedgeRange[];
  n: number;
}

/** the fields of a frame that territories / frontlines / the leader are derived from */
const SNAP = 8;

export function createPlanet(slot0: PlanetSlot, tex: PlanetTextures): Planet {
  let slot = slot0;
  const root = new Container({ label: `planet-${slot.id}` });
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.interactiveChildren = false;

  const decor = createPlanetDecor(tex);
  const body = new Sprite({ texture: tex.body, anchor: 0.5 });
  const layers: WedgeLayer[] = [0, 1].map((i) => ({ m: createDynMesh({ label: `wedges-${i}` }), ranges: [], n: 0 }));
  const coreDark = new Sprite({ texture: tex.coreDark, anchor: 0.5 });
  const edges = createDynMesh({ label: 'rim-glow', blendMode: 'add' });
  const anim = createDynMesh({ label: 'pulses', blendMode: 'add' });
  const surface = new Sprite({ texture: tex.surface, anchor: 0.5 });
  surface.blendMode = 'add';
  const lineMesh = createDynMesh({ label: 'frontlines', blendMode: 'add' });
  const inner = new Container({ label: 'inner' });
  const fog = createFog(tex.cloud);
  const shade = new Sprite({ texture: tex.shade, anchor: 0.5 });
  const highlight = new Sprite({ texture: tex.highlight, anchor: 0.5 });
  highlight.blendMode = 'add';
  root.addChild(decor.back, body, layers[0].m.mesh, layers[1].m.mesh, coreDark, edges.mesh, anim.mesh, surface, lineMesh.mesh, inner, fog.container, shade, highlight, decor.front);

  let wedges: Wedge[] = [];
  let lines: Frontline[] = [];
  let leader: UnitFrame | null = null;
  let atm = NO_ATM;
  let leadCol = NO_LEAD;
  const disp = new Map<string, number>();

  // frames snapshot: unchanged frames (paused playback) keep the derived territories
  const snapId: string[] = [];
  const snapStr: string[] = [];
  let snapNum = new Float64Array(16 * SNAP);
  let snapN = -1;

  // geometry state
  let geoWedges: Wedge[] = [];
  const geoIds: string[] = [];
  let geoInit = false;
  let geoPx = 0;
  let dirty = true;
  let active = 0;
  let ghost = -1;
  let ghostT = 0;
  const ang: Float64Array[] = [];
  const angPool: Float64Array[] = [];
  const lineV0: number[] = [];
  const lineV1: number[] = [];
  const lineA: number[] = [];
  let lineN = 0;
  let animEmpty = false;

  // decor key
  let decorDirty = true;
  let dR = 0;
  let dPx = 0;
  let dHub = false;
  let dAtm = -1;
  let dLead = -1;

  let x = slot.x;
  let y = slot.y;
  let tAnim = 0;
  let amp = 1;
  let hoverAmt = 0;
  let edgeKey = 0;
  let shown = true;

  const level = (w: Wedge, emph: PlanetFrame['emphasis']) => Math.min(1, disp.get(w.id) ?? 0.5) * (emph ? emph(w.org) : 1) * w.presence;

  /** rim glow is baked into the geometry: a cheap fingerprint tells when brightness / emphasis moved enough */
  function edgeSignature(emph: PlanetFrame['emphasis']): number {
    let key = 0;
    for (let k = 0; k < wedges.length; k++) key += Math.round(level(wedges[k], emph) * 40) * (k + 1);
    return key;
  }

  function borderAt(k: number, rho: number): number {
    const b = lines[k];
    return b ? borderAngle(b, rho, tAnim, amp) : START_ANGLE;
  }
  function rangeStart(k: number, rho: number): number {
    if (lines.length < 2) return wedges.length ? START_ANGLE : 0;
    return borderAt(k, rho);
  }
  function rangeEnd(k: number, rho: number): number {
    const n = lines.length;
    if (n < 2) return wedges.length ? START_ANGLE + TAU : 0;
    return borderAt((k + 1) % n, rho) + (k === n - 1 ? TAU : 0);
  }
  function rangeAt(k: number, rho: number): [number, number] {
    return [rangeStart(k, rho), rangeEnd(k, rho)];
  }

  const pulse: PulseView = {
    wedges,
    lines,
    bright: (id) => disp.get(id) ?? 0.5,
    emph: null,
    rangeStart,
    rangeEnd,
    borderAt,
    R: 1,
    px: 1,
    sr: 1,
    t: 0,
    ph: 0,
  };

  function sizeParts(R: number) {
    body.width = body.height = coreDark.width = coreDark.height = 2 * R;
    shade.width = shade.height = highlight.width = highlight.height = surface.width = surface.height = 2 * R;
    root.hitArea = new Circle(0, 0, R * 1.15);
  }
  sizeParts(slot.r);

  function sameFrames(frames: readonly UnitFrame[]): boolean {
    if (frames.length !== snapN) return false;
    for (let i = 0; i < frames.length; i++) {
      const u = frames[i];
      const o = i * SNAP;
      const so = i * 4;
      if (u.id !== snapId[i] || u.org !== snapStr[so] || u.name !== snapStr[so + 1] || u.color !== snapStr[so + 2] || u.q !== snapStr[so + 3]) return false;
      if (u.s !== snapNum[o] || u.c !== snapNum[o + 1] || u.presence !== snapNum[o + 2] || u.fog !== snapNum[o + 3]) return false;
      if (u.fogBlend !== snapNum[o + 4] || u.rank !== snapNum[o + 5] || u.rankDelta !== snapNum[o + 6]) return false;
    }
    return true;
  }

  function snapshot(frames: readonly UnitFrame[]) {
    if (snapNum.length < frames.length * SNAP) snapNum = new Float64Array(frames.length * SNAP * 2);
    snapN = frames.length;
    snapId.length = frames.length;
    snapStr.length = frames.length * 4;
    for (let i = 0; i < frames.length; i++) {
      const u = frames[i];
      const o = i * SNAP;
      const so = i * 4;
      snapId[i] = u.id;
      snapStr[so] = u.org;
      snapStr[so + 1] = u.name;
      snapStr[so + 2] = u.color;
      snapStr[so + 3] = u.q;
      snapNum[o] = u.s;
      snapNum[o + 1] = u.c;
      snapNum[o + 2] = u.presence;
      snapNum[o + 3] = u.fog;
      snapNum[o + 4] = u.fogBlend;
      snapNum[o + 5] = u.rank;
      snapNum[o + 6] = u.rankDelta;
    }
  }

  function clearLayer(L: WedgeLayer) {
    L.n = 0;
    L.m.begin();
    L.m.end();
  }

  function rebuildGeometry(R: number, px: number, sr: number, emph: PlanetFrame['emphasis']) {
    const n = wedges.length;
    const NS = sr > 220 ? 30 : sr > 110 ? 22 : 14;
    ang.length = lines.length;
    for (let k = 0; k < lines.length; k++) {
      const a = (angPool[k] ??= new Float64Array(MAX_SAMPLES));
      const b = lines[k];
      for (let i = 0; i <= NS; i++) a[i] = borderAngle(b, sampleRho(i, NS), tAnim, amp);
      ang[k] = a;
    }

    // territories are ordered by scale: when two swap places, cross-fade instead of popping
    let same = geoIds.length === n;
    for (let k = 0; same && k < n; k++) same = geoIds[k] === wedges[k].id;
    if (geoInit && !same && n > 0) {
      if (ghost >= 0) clearLayer(layers[ghost]);
      ghost = active;
      active = 1 - active;
      ghostT = 0;
      const lo = Math.min(root.getChildIndex(layers[0].m.mesh), root.getChildIndex(layers[1].m.mesh));
      root.setChildIndex(layers[active].m.mesh, lo);
      root.setChildIndex(layers[ghost].m.mesh, lo + 1);
      layers[active].m.mesh.alpha = 1;
    }
    geoInit = true;
    geoIds.length = n;
    for (let k = 0; k < n; k++) geoIds[k] = wedges[k].id;

    const L = layers[active];
    const wb = L.m.buf;
    const rimW = Math.max(2 * px, R * 0.05);
    const step = fillStep(sr);
    L.m.begin();
    edges.begin();
    edgeKey = edgeSignature(emph);
    for (let k = 0; k < n; k++) {
      const w = wedges[k];
      const col = hexColor(w.color);
      const gain = colorGain(col);
      const o0 = rimStart(ang, k, n, NS);
      const o1 = rimEnd(ang, k, n, NS);
      const v0 = wb.nv;
      if (n === 1) {
        fillCircle(wb, 0, 0, R, rgba(col, 0.8 * gain));
        strokeCircle(wb, 0, 0, R - rimW / 2, rimW, rgba(col, gain));
      } else {
        fillWedge(wb, ang[k], ang[(k + 1) % n], k === n - 1 ? TAU : 0, NS, R, rgba(col, 0.8 * gain), step);
        if (o1 - o0 > 0.004) strokeArc(wb, 0, 0, R - rimW / 2, o0, o1, rimW, rgba(col, gain));
      }
      const r = (L.ranges[k] ??= { id: '', v0: 0, v1: 0, alpha: 0 });
      r.id = w.id;
      r.v0 = v0;
      r.v1 = wb.nv;
      r.alpha = Number.NaN; // re-applied by the per-frame pass
      drawRimGlow(edges.buf, col, o0, o1, R, px, level(w, emph));
    }
    L.n = n;
    L.m.end();
    L.m.keepColors();
    edges.end();

    lineMesh.begin();
    for (let k = 0; k < lines.length; k++) {
      const b = lines[k];
      lineV0[k] = lineMesh.buf.nv;
      drawFrontline(lineMesh.buf, b, ang[k], NS, R, px, sr, level(b.prev, emph), level(b.cur, emph));
      lineV1[k] = lineMesh.buf.nv;
      lineA[k] = Number.NaN; // re-applied by the per-frame flicker
    }
    lineN = lines.length;
    lineMesh.end();
    lineMesh.keepColors();

    fog.rebuild(wedges, n >= 2 ? ang : null, NS, R, step);
    for (const id of disp.keys()) {
      let live = false;
      for (let k = 0; k < n && !live; k++) live = wedges[k].id === id;
      if (!live) disp.delete(id);
    }
    geoWedges = wedges;
    geoPx = px;
    dirty = false;
  }

  function findWedge(id: string): Wedge | null {
    for (let k = 0; k < wedges.length; k++) if (wedges[k].id === id) return wedges[k];
    return null;
  }

  return {
    get id() {
      return slot.id;
    },
    root,
    inner,
    get slot() {
      return slot;
    },
    get wedges() {
      return wedges;
    },
    get lines() {
      return lines;
    },
    get leader() {
      return leader;
    },
    get atmosphere() {
      return atm;
    },
    get x() {
      return x;
    },
    get y() {
      return y;
    },
    setSlot(next) {
      if (next.r !== slot.r) sizeParts(next.r);
      slot = next;
      decorDirty = true;
      dirty = true;
    },
    setFrames(frames) {
      if (sameFrames(frames)) return;
      snapshot(frames);
      const w = territories(frames);
      leader = null;
      for (let i = 0; i < frames.length && !leader; i++) if (frames[i].rank === 1) leader = frames[i];
      if (!dirty && changed(w, geoWedges)) dirty = true;
      wedges = w;
      lines = frontlines(w);
      pulse.wedges = wedges;
      pulse.lines = lines;
    },
    update(dt, f) {
      const R = slot.r;
      const px = f.px;
      const sr = R / px;
      tAnim = f.reduced ? 0 : f.time;
      amp = f.reduced ? REDUCED_AMP : 1;
      const bob = f.reduced ? 0 : R * 0.08;
      x = slot.x + Math.sin(f.time * 0.31 + slot.ph) * bob;
      y = slot.y + Math.cos(f.time * 0.23 + slot.ph * 1.7) * bob * 1.2;
      root.position.set(x, y);

      leadCol = leader ? hexColor(leader.color) : NO_LEAD;
      atm = leader ? mixColor(hexColor(leader.color), ATM_BASE, 0.55) : NO_ATM;

      for (const w of wedges) {
        const target = wedgeBrightness(w.s) + (leader && w.id === leader.id ? 0.12 : 0);
        disp.set(w.id, followGlow(disp.get(w.id) ?? target, target, dt, f.flashes, f.now));
      }
      hoverAmt += ((f.hover ? 1 : 0) - hoverAmt) * Math.min(1, dt * 8);

      const visible = f.visible !== false;
      if (visible !== shown) {
        shown = visible;
        root.visible = visible;
      }
      // off screen: keep the state above (positions, glow levels) current, skip the drawing until it is back
      if (!visible) return;

      const pxKey = Math.round(Math.log(px) * 20);
      if (decorDirty || R !== dR || pxKey !== dPx || slot.hub !== dHub || atm !== dAtm || leadCol !== dLead) {
        decorDirty = false;
        dR = R;
        dPx = pxKey;
        dHub = slot.hub;
        dAtm = atm;
        dLead = leadCol;
        decor.rebuild({ R, px, hub: slot.hub, atm, lead: leadCol });
      }

      const pxMoved = Math.abs(px / Math.max(1e-9, geoPx) - 1) > 0.03;
      if (f.rebuild && !dirty && f.reduced && edgeSignature(f.emphasis) !== edgeKey) dirty = true;
      if (f.rebuild && (dirty || !f.reduced || pxMoved)) rebuildGeometry(R, px, sr, f.emphasis);

      // per-frame looks: territory brightness (glow ∝ strength), cross-fade, frontline flicker
      const L = layers[active];
      let moved = false;
      for (let r = 0; r < L.n; r++) {
        const rg = L.ranges[r];
        const w = findWedge(rg.id);
        if (!w) continue;
        const b = disp.get(w.id) ?? 0.5;
        const a = clamp((0.6 + 0.4 * b) * (0.35 + 0.65 * w.presence) * (f.emphasis ? f.emphasis(w.org) : 1), 0, 1);
        if (Math.abs(a - rg.alpha) > ALPHA_EPS || rg.alpha !== rg.alpha) {
          L.m.setAlpha(rg.v0, rg.v1, a);
          rg.alpha = a;
          moved = true;
        }
      }
      if (moved) L.m.flushColors();
      if (ghost >= 0) {
        ghostT += dt;
        layers[ghost].m.mesh.alpha = Math.max(0, 1 - ghostT / CROSSFADE);
        if (ghostT >= CROSSFADE || f.reduced) {
          clearLayer(layers[ghost]);
          ghost = -1;
        }
      }
      for (let k = 0; k < lineN; k++) {
        const b = lines[k];
        if (!b) continue;
        const a = f.reduced ? 0.85 : 0.75 + 0.25 * Math.sin(f.time * 5 + b.seed * 5) * Math.sin(f.time * 2.3 + b.seed);
        if (Math.abs(a - lineA[k]) <= ALPHA_EPS) continue;
        lineA[k] = a;
        lineMesh.setAlpha(lineV0[k], lineV1[k], a);
      }
      lineMesh.flushColors();

      if (!f.reduced) {
        pulse.emph = f.emphasis;
        pulse.R = R;
        pulse.px = px;
        pulse.sr = sr;
        pulse.t = f.time;
        pulse.ph = slot.ph;
        anim.begin();
        drawPulses(anim.buf, pulse);
        anim.end();
        animEmpty = false;
      } else if (!animEmpty) {
        anim.begin();
        anim.end();
        animEmpty = true;
      }
      fog.update(f.time, R, rangeStart, rangeEnd, f.reduced);
      surface.rotation = tAnim * 0.008;
      decor.update(f.time, slot.ph, hoverAmt, f.reduced, f.rebuild && !f.reduced);
    },
    borderAt,
    rangeAt,
    brightness(id) {
      return disp.get(id) ?? 0;
    },
    setFogFade(k) {
      const a = clamp(k, 0, 1);
      if (Math.abs(fog.container.alpha - a) > 0.002) fog.container.alpha = a;
    },
    destroy() {
      fog.destroy();
      decor.destroy();
      for (const L of layers) L.m.destroy();
      edges.destroy();
      anim.destroy();
      lineMesh.destroy();
      root.destroy({ children: true });
    },
  };
}
