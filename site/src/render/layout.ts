/**
 * Pure galaxy maths (no PixiJS): where the planets sit, how a front's units split a planet into
 * territory wedges, how the frontlines between them wobble and bulge, and how glow follows strength.
 * Angles are radians in screen orientation (y down), so increasing angles run clockwise; −π/2 is "up".
 */
import type { FrontId } from '../data/types';
import type { UnitFrame } from '../data/timeline';
import type { FlashBudget } from '../fx/flashBudget';

export const TAU = Math.PI * 2;
/** the largest territory starts at 12 o'clock */
export const START_ANGLE = -Math.PI / 2;
/** radius of the planet's central core, as a fraction of the planet radius (wedges start here) */
export const CORE = 0.17;
/** viewports narrower than this (and taller than wide) get the portrait layout */
export const PORTRAIT_MAX_W = 768;

export interface Extent {
  w: number;
  h: number;
}

export interface PlanetSlot {
  id: FrontId;
  /** world position (the galaxy's centre is the origin) */
  x: number;
  y: number;
  r: number;
  /** animation phase offset */
  ph: number;
  /** the large central planet the data streams run to */
  hub: boolean;
  /** where the planet's title goes */
  labelSide: 'above' | 'below';
}

export interface GalaxyLayout {
  /** world box to fit into the viewport (pass to `cameraFor({ kind: 'galaxy', extent })`) */
  extent: Extent;
  portrait: boolean;
  hub: FrontId;
  /** every front, in `world.fronts` order */
  planets: PlanetSlot[];
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function isPortrait(view: Extent): boolean {
  return view.w < PORTRAIT_MAX_W && view.h > view.w;
}

/** Landscape reference box (= camera GALAXY_EXTENT) and the six satellite slots, clockwise from top-left, as fractions of it. */
const REF = { w: 960, h: 590 };
const SLOTS: [number, number][] = [
  [-0.352, -0.31],
  [0.352, -0.31],
  [0.415, 0],
  [0.352, 0.3],
  [-0.352, 0.3],
  [-0.415, 0],
];
const HUB_R = 0.144; // × width
const SAT_R = 0.0635; // × width

/**
 * Planet positions for the galaxy overview. Landscape: the general front is the large hub at the centre
 * and the others orbit it clockwise from top-left in `fronts` order; everything scales with `area`
 * (keeping the 960 : 590 aspect). Portrait (phones): only the focused front (default general) is large,
 * at the centre, with the others in a row above and a row below.
 */
export function galaxyLayout(area: Extent, fronts: readonly { id: FrontId }[], opts: { focus?: FrontId | null } = {}): GalaxyLayout {
  const ids = fronts.map((f) => f.id);
  if (!ids.length) return { extent: { w: Math.max(1, area.w), h: Math.max(1, area.h) }, portrait: isPortrait(area), hub: 'general', planets: [] };
  return isPortrait(area) ? portrait(area, ids, opts.focus ?? null) : landscape(area, ids);
}

function landscape(area: Extent, ids: FrontId[]): GalaxyLayout {
  const s = Math.max(1e-6, Math.min(area.w / REF.w, area.h / REF.h));
  const W = REF.w * s;
  const H = REF.h * s;
  const hub = ids.includes('general') ? 'general' : ids[0];
  const sats = ids.filter((id) => id !== hub);
  const pos = new Map<FrontId, PlanetSlot>();
  pos.set(hub, { id: hub, x: 0, y: 0, r: HUB_R * W, ph: 0, hub: true, labelSide: 'above' });
  sats.forEach((id, i) => {
    let fx: number, fy: number;
    if (sats.length === SLOTS.length) [fx, fy] = SLOTS[i];
    else {
      const a = (-150 * Math.PI) / 180 + (i * TAU) / sats.length;
      fx = Math.cos(a) * 0.415;
      fy = Math.sin(a) * 0.31;
    }
    const y = fy * H;
    pos.set(id, { id, x: fx * W, y, r: SAT_R * W, ph: 1.3 * (i + 1), hub: false, labelSide: y > 0.02 * H ? 'below' : 'above' });
  });
  return { extent: { w: W, h: H }, portrait: false, hub, planets: ids.map((id) => pos.get(id)!) };
}

function portrait(area: Extent, ids: FrontId[], focus: FrontId | null): GalaxyLayout {
  const W = Math.max(1, area.w);
  const H = Math.max(area.h, W * 1.3);
  const hub = focus && ids.includes(focus) ? focus : ids.includes('general') ? 'general' : ids[0];
  const hubR = 0.27 * W;
  const r = 0.085 * W;
  const rowY = clamp(0.36 * H, hubR + 0.35 * W, H / 2 - r - 0.13 * W);
  const others = ids.filter((id) => id !== hub);
  const top = Math.ceil(others.length / 2);
  const pos = new Map<FrontId, PlanetSlot>();
  pos.set(hub, { id: hub, x: 0, y: 0, r: hubR, ph: 0, hub: true, labelSide: 'above' });
  others.forEach((id, i) => {
    const row = i < top ? 0 : 1;
    const n = row === 0 ? top : others.length - top;
    const j = row === 0 ? i : i - top;
    const x = n > 1 ? (-0.33 + (0.66 * j) / (n - 1)) * W : 0;
    pos.set(id, { id, x, y: row === 0 ? -rowY : rowY, r, ph: 1.3 * (i + 1), hub: false, labelSide: row === 0 ? 'above' : 'below' });
  });
  return { extent: { w: W, h: H }, portrait: true, hub, planets: ids.map((id) => pos.get(id)!) };
}

// ---------------------------------------------------------------------------------------------
// territories

export interface Wedge {
  id: string;
  org: string;
  name: string;
  color: string;
  s: number;
  c: number;
  fog: number;
  fogBlend: number;
  presence: number;
  rank: number;
  /** c × presence — what the angle is proportional to */
  weight: number;
  /** 0..1 of the planet */
  share: number;
  /** start / end angle (a1 ≥ a0; the last wedge ends at START_ANGLE + 2π) */
  a0: number;
  a1: number;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const finite = (v: number, d = 0) => (Number.isFinite(v) ? v : d);

/**
 * A front's planet split into territory wedges: ordered by scale (c × presence, largest first; ties by id),
 * contiguous from −90° clockwise, angles proportional to c × presence (renormalised to 360°). Units without
 * territory (left, zero or broken scale) are dropped; if nobody has any scale yet, present units share equally.
 */
export function territories(frames: readonly UnitFrame[]): Wedge[] {
  const present = frames.filter((u) => finite(u.presence) > 0);
  let list = present.map((u) => ({ u, weight: Math.max(0, finite(u.c)) * Math.min(1, finite(u.presence)) }));
  let total = list.reduce((a, x) => a + x.weight, 0);
  if (total > 0) list = list.filter((x) => x.weight > 0);
  else {
    list = list.map((x) => ({ u: x.u, weight: 1 }));
    total = list.length;
  }
  list.sort((x, y) => y.weight - x.weight || cmp(x.u.id, y.u.id));
  let a = START_ANGLE;
  return list.map(({ u, weight }, k) => {
    const share = weight / total;
    const a0 = a;
    a = k === list.length - 1 ? START_ANGLE + TAU : a + share * TAU;
    return {
      id: u.id,
      org: u.org,
      name: u.name,
      color: u.color,
      s: finite(u.s),
      c: finite(u.c),
      fog: finite(u.fog),
      fogBlend: finite(u.fogBlend),
      presence: finite(u.presence),
      rank: u.rank,
      weight,
      share,
      a0,
      a1: a,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// frontlines

export interface Frontline {
  /** index of the wedge this line starts (it sits between wedges k−1 and k) */
  k: number;
  key: string;
  prev: Wedge;
  cur: Wedge;
  /** undisturbed angle (= cur.a0) */
  base: number;
  /** −1..1: > 0 = prev is stronger and pushes into cur (toward larger angles) */
  push: number;
  /** 0.12..1: how evenly matched the two sides are (wobble, sparks) */
  fierce: number;
  /** how far the line may move into prev / cur (radians) */
  maxL: number;
  maxR: number;
  seed: number;
}

export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (((h >>> 0) % 10000) / 10000) * TAU;
}

export function frontlines(wedges: readonly Wedge[]): Frontline[] {
  const n = wedges.length;
  if (n < 2) return [];
  const out: Frontline[] = [];
  for (let k = 0; k < n; k++) {
    const prev = wedges[(k - 1 + n) % n];
    const cur = wedges[k];
    const ds = finite(prev.s - cur.s);
    const key = prev.id + '|' + cur.id;
    out.push({
      k,
      key,
      prev,
      cur,
      base: cur.a0,
      push: clamp(ds / 10, -1, 1),
      fierce: clamp(1 - Math.abs(ds) / 14, 0.12, 1),
      maxL: (prev.a1 - prev.a0) * 0.42,
      maxR: (cur.a1 - cur.a0) * 0.42,
      seed: strHash(key),
    });
  }
  return out;
}

/**
 * Frontline angle at radius fraction `rho` (CORE..1) and time `t` (s). The line wobbles — more when the
 * neighbours are evenly matched — and bulges toward the weaker side by the strength difference. `amp`
 * scales the motion (0 = still, for reduced motion). Never leaves 42 % of either neighbouring wedge.
 */
export function borderAngle(b: Frontline, rho: number, t: number, amp = 1): number {
  const rp = clamp((rho - CORE) / (1 - CORE), 0, 1);
  const s = b.seed;
  const w = (0.01 + 0.026 * b.fierce) * amp;
  const wob =
    w === 0
      ? 0
      : w * (Math.sin(rho * 9 + t * 1.3 + s) + 0.6 * Math.sin(rho * 17 - t * 2.1 + s * 2.3) + 0.35 * Math.sin(rho * 33 + t * 3.7 + s * 0.7)) * smoothstep(0, 0.2, rp);
  const push = b.push * 0.12 * Math.sin(Math.PI * rp * 0.85) * (0.85 + 0.15 * amp * Math.sin(t * 1.7 + s));
  return b.base + clamp((wob + push) / Math.max(rho, 0.22), -b.maxL, b.maxR);
}

// ---------------------------------------------------------------------------------------------
// glow

/** Territory brightness 0.06..1 from strength (mockup A: 50 → dim, 95+ → full). */
export function wedgeBrightness(s: number): number {
  return clamp((finite(s, 0) - 50) / 45, 0.06, 1);
}

const GLOW_RISE = 0.8; // per second without a flash grant
const GLOW_FALL = 6; // exponential rate
const GLOW_JUMP = 0.15; // a rise bigger than this is a "sudden brightening"

/**
 * One step of a displayed glow level following its target. Dimming is quick; brightening is
 * rate-limited, and a sudden rise may only jump by what the flash budget grants (WCAG 2.3.1).
 */
export function followGlow(current: number, target: number, dt: number, budget: Pick<FlashBudget, 'request'> | null, now: number): number {
  if (!Number.isFinite(target)) return current;
  if (!Number.isFinite(current)) return target;
  if (target <= current) return current + (target - current) * Math.min(1, Math.max(0, dt) * GLOW_FALL);
  let c = current;
  if (budget && target - c > GLOW_JUMP) c += Math.min(target - c, budget.request(target - c, now));
  const step = GLOW_RISE * Math.max(0, dt);
  return target - c <= step ? target : c + step;
}
