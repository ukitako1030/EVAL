/**
 * One planet of the galaxy overview (ported from mockups/a-galaxy.html `drawPlanet`): dark sphere,
 * territory wedges in org colours (area = scale), animated frontlines that wobble and bulge toward the
 * weaker side (strength pressure), offensive pulses and glow ∝ strength, fog over estimated data,
 * sphere shading, rim light, atmosphere halo in the leader's colour and a tilted ring.
 *
 * Wedge / frontline geometry is rebuilt only when the galaxy grants a rebuild slot (≈ 20 Hz, staggered)
 * and something moved; brightness, flicker, pulses, dashes and fog drift are per-frame property updates.
 */
import { Circle, Container, Graphics, Sprite } from 'pixi.js';
import type { FrontId } from '../data/types';
import type { UnitFrame } from '../data/timeline';
import type { FlashBudget } from '../fx/flashBudget';
import { START_ANGLE, TAU, borderAngle, followGlow, frontlines, territories, wedgeBrightness, type Frontline, type PlanetSlot, type Wedge } from './layout';
import { createFog } from './fog';
import { createPlanetDecor } from './planetDecor';
import { arcPath, drawFrontline, drawPulses, drawRimGlow, rimRange, sampleRho, wedgePolygon } from './planetDraw';
import { colorGain, hexColor, mixColor } from './color';
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
}

export interface Planet {
  readonly id: FrontId;
  readonly root: Container;
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
  destroy(): void;
}

const ATM_BASE = 0x3cc8ff;
const NO_ATM = 0x3c78c8;
const NO_LEAD = 0x5a7bb0;
const CROSSFADE = 0.35;
/** reduced motion: frontlines keep a gentle, frozen wobble */
export const REDUCED_AMP = 0.35;
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

interface WedgeLayer {
  c: Container;
  g: Map<string, Graphics>;
}

export function createPlanet(slot0: PlanetSlot, tex: PlanetTextures): Planet {
  let slot = slot0;
  const root = new Container({ label: `planet-${slot.id}` });
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.interactiveChildren = false;

  const decor = createPlanetDecor(tex);
  const body = new Sprite({ texture: tex.body, anchor: 0.5 });
  const layers: WedgeLayer[] = [0, 1].map((i) => ({ c: new Container({ label: `wedges-${i}` }), g: new Map() }));
  const coreDark = new Sprite({ texture: tex.coreDark, anchor: 0.5 });
  const edges = new Graphics();
  edges.blendMode = 'add';
  const anim = new Graphics();
  anim.blendMode = 'add';
  const surface = new Sprite({ texture: tex.surface, anchor: 0.5 });
  surface.blendMode = 'add';
  const lineLayer = new Container({ label: 'frontlines' });
  const fog = createFog(tex.cloud);
  const shade = new Sprite({ texture: tex.shade, anchor: 0.5 });
  const highlight = new Sprite({ texture: tex.highlight, anchor: 0.5 });
  highlight.blendMode = 'add';
  root.addChild(decor.back, body, layers[0].c, layers[1].c, coreDark, edges, anim, surface, lineLayer, fog.container, shade, highlight, decor.front);
  const lineGfx: Graphics[] = [];

  let wedges: Wedge[] = [];
  let lines: Frontline[] = [];
  let leader: UnitFrame | null = null;
  let atm = NO_ATM;
  let leadCol = NO_LEAD;
  const disp = new Map<string, number>();

  let geoWedges: Wedge[] = [];
  let geoOrder: string | null = null;
  let geoPx = 0;
  let dirty = true;
  let active = 0;
  let ghost = -1;
  let ghostT = 0;
  let decorKey = '';
  let x = slot.x;
  let y = slot.y;
  let tAnim = 0;
  let amp = 1;
  let hoverAmt = 0;
  let edgeKey = 0;

  /** rim glow is baked into the geometry: a cheap fingerprint tells when brightness / emphasis moved enough */
  function edgeSignature(emph: PlanetFrame['emphasis']): number {
    let key = 0;
    wedges.forEach((w, k) => (key += Math.round(Math.min(1, disp.get(w.id) ?? 0.5) * (emph ? emph(w.org) : 1) * w.presence * 40) * (k + 1)));
    return key;
  }

  function borderAt(k: number, rho: number): number {
    const b = lines[k];
    return b ? borderAngle(b, rho, tAnim, amp) : START_ANGLE;
  }
  function rangeAt(k: number, rho: number): [number, number] {
    const n = lines.length;
    if (n < 2) return wedges.length ? [START_ANGLE, START_ANGLE + TAU] : [0, 0];
    return [borderAt(k, rho), borderAt((k + 1) % n, rho) + (k === n - 1 ? TAU : 0)];
  }

  function sizeParts(R: number) {
    body.width = body.height = coreDark.width = coreDark.height = 2 * R;
    shade.width = shade.height = highlight.width = highlight.height = surface.width = surface.height = 2 * R;
    root.hitArea = new Circle(0, 0, R * 1.15);
  }
  sizeParts(slot.r);

  function rebuildGeometry(R: number, px: number, sr: number, emph: PlanetFrame['emphasis']) {
    const n = wedges.length;
    const NS = sr > 220 ? 30 : sr > 110 ? 22 : 14;
    const ang = lines.map((b) => {
      const a = new Float64Array(NS + 1);
      for (let i = 0; i <= NS; i++) a[i] = borderAngle(b, sampleRho(i, NS), tAnim, amp);
      return a;
    });

    // territories are ordered by scale: when two swap places, cross-fade instead of popping
    const order = wedges.map((w) => w.id).join('|');
    if (geoOrder !== null && order !== geoOrder && n > 0) {
      if (ghost >= 0) for (const g of layers[ghost].g.values()) g.visible = false;
      ghost = active;
      active = 1 - active;
      ghostT = 0;
      const lo = Math.min(root.getChildIndex(layers[0].c), root.getChildIndex(layers[1].c));
      root.setChildIndex(layers[active].c, lo);
      root.setChildIndex(layers[ghost].c, lo + 1);
      layers[active].c.alpha = 1;
    }
    geoOrder = order;

    const L = layers[active];
    const used = new Set<string>();
    const polys: (number[] | null)[] = [];
    const rimW = Math.max(2 * px, R * 0.05);
    edges.clear();
    edgeKey = edgeSignature(emph);
    wedges.forEach((w, k) => {
      let g = L.g.get(w.id);
      if (!g) {
        g = new Graphics();
        L.g.set(w.id, g);
        L.c.addChild(g);
      }
      g.visible = true;
      used.add(w.id);
      const col = hexColor(w.color);
      const gain = colorGain(col);
      const [o0, o1] = rimRange(ang, k, n, NS);
      g.clear();
      if (n === 1) {
        g.circle(0, 0, R).fill({ color: col, alpha: 0.8 * gain });
        g.circle(0, 0, R - rimW / 2).stroke({ width: rimW, color: col, alpha: gain });
        polys.push(null);
      } else {
        const pts = wedgePolygon(ang[k], ang[(k + 1) % n], k === n - 1 ? TAU : 0, NS, R);
        g.poly(pts).fill({ color: col, alpha: 0.8 * gain });
        if (o1 - o0 > 0.004) arcPath(g, R - rimW / 2, o0, o1).stroke({ width: rimW, color: col, alpha: gain });
        polys.push(pts);
      }
      drawRimGlow(edges, col, o0, o1, R, px, Math.min(1, disp.get(w.id) ?? 0.5) * (emph ? emph(w.org) : 1) * w.presence);
    });
    for (const [id, g] of L.g) {
      if (used.has(id)) continue;
      g.destroy();
      L.g.delete(id);
    }

    lines.forEach((b, k) => {
      let g = lineGfx[k];
      if (!g) {
        g = new Graphics();
        g.blendMode = 'add';
        lineGfx[k] = g;
        lineLayer.addChild(g);
      }
      g.visible = true;
      const lv = (w: Wedge) => Math.min(1, disp.get(w.id) ?? 0.5) * (emph ? emph(w.org) : 1) * w.presence;
      drawFrontline(g, b, ang[k], NS, R, px, sr, lv(b.prev), lv(b.cur));
    });
    for (let k = lines.length; k < lineGfx.length; k++) lineGfx[k].visible = false;

    fog.rebuild(wedges, polys);
    for (const id of disp.keys()) if (!wedges.some((w) => w.id === id)) disp.delete(id);
    geoWedges = wedges;
    geoPx = px;
    dirty = false;
  }

  return {
    get id() {
      return slot.id;
    },
    root,
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
      decorKey = '';
      dirty = true;
    },
    setFrames(frames) {
      const w = territories(frames);
      leader = frames.find((u) => u.rank === 1) ?? null;
      if (!dirty && changed(w, geoWedges)) dirty = true;
      wedges = w;
      lines = frontlines(w);
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
      const key = `${R}|${Math.round(Math.log(px) * 20)}|${slot.hub}|${atm}|${leadCol}`;
      if (key !== decorKey) {
        decorKey = key;
        decor.rebuild({ R, px, hub: slot.hub, atm, lead: leadCol });
      }

      for (const w of wedges) {
        const target = wedgeBrightness(w.s) + (leader && w.id === leader.id ? 0.12 : 0);
        disp.set(w.id, followGlow(disp.get(w.id) ?? target, target, dt, f.flashes, f.now));
      }

      const pxMoved = Math.abs(px / Math.max(1e-9, geoPx) - 1) > 0.03;
      if (f.rebuild && !dirty && f.reduced && edgeSignature(f.emphasis) !== edgeKey) dirty = true;
      if (f.rebuild && (dirty || !f.reduced || pxMoved)) rebuildGeometry(R, px, sr, f.emphasis);

      // per-frame looks: territory brightness (glow ∝ strength), cross-fade, frontline flicker
      const L = layers[active];
      for (const w of wedges) {
        const g = L.g.get(w.id);
        if (!g) continue;
        const b = disp.get(w.id) ?? 0.5;
        g.alpha = clamp((0.6 + 0.4 * b) * (0.35 + 0.65 * w.presence) * (f.emphasis ? f.emphasis(w.org) : 1), 0, 1);
      }
      if (ghost >= 0) {
        ghostT += dt;
        layers[ghost].c.alpha = Math.max(0, 1 - ghostT / CROSSFADE);
        if (ghostT >= CROSSFADE || f.reduced) {
          for (const g of layers[ghost].g.values()) g.visible = false;
          ghost = -1;
        }
      }
      lines.forEach((b, k) => {
        const g = lineGfx[k];
        if (g) g.alpha = f.reduced ? 0.85 : 0.75 + 0.25 * Math.sin(f.time * 5 + b.seed * 5) * Math.sin(f.time * 2.3 + b.seed);
      });

      anim.clear();
      if (!f.reduced) drawPulses(anim, { wedges, lines, bright: (id) => disp.get(id) ?? 0.5, emph: f.emphasis, rangeAt, borderAt, R, px, sr, t: f.time, ph: slot.ph });
      fog.update(f.time, R, rangeAt, f.reduced);
      surface.rotation = tAnim * 0.008;
      hoverAmt += ((f.hover ? 1 : 0) - hoverAmt) * Math.min(1, dt * 8);
      decor.update(f.time, slot.ph, hoverAmt, f.reduced);
    },
    borderAt,
    rangeAt,
    brightness(id) {
      return disp.get(id) ?? 0;
    },
    destroy() {
      fog.destroy();
      decor.destroy();
      root.destroy({ children: true });
    },
  };
}
