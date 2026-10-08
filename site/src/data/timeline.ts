import type { Confidence, FrontId, UnitMonth, World } from './types';

export type SortBy = 'strength' | 'scale';

export interface UnitFrame {
  id: string;
  front: FrontId;
  org: string;
  name: string;
  color: string;
  s: number;
  c: number;
  q: Confidence;
  /** 0 = clear … 1 = thick fog; follows `q`, so it switches at the midpoint between two months (use for labels) */
  fog: number;
  /** like `fog`, but interpolated between the two months' fog values — what the renderer should draw */
  fogBlend: number;
  /** 0..1 while a unit arrives or leaves; 1 = fully present. `s` and `c` are NOT scaled by it; ranking is (see `frontFrame`) */
  presence: number;
  /** 1-based rank by the requested sort, from the interpolated values */
  rank: number;
  /** previous whole month's rank − this whole month's rank (positive = moved up); 0 when not ranked last month */
  rankDelta: number;
}

export const FOG: Record<Confidence, number> = { high: 0, medium: 0.25, reconstructed: 0.5, estimated: 0.8 };
/** an unknown confidence is drawn as estimated (thick fog) */
const fogOf = (q: Confidence): number => FOG[q] ?? FOG.estimated;

/** Clamps `t` to the month range; a non-finite `t` (NaN, ±Infinity) maps to the last month so no caller ever sees NaN. */
export function clampT(world: World, t: number): number {
  const last = world.months.length - 1;
  return Number.isFinite(t) ? Math.min(Math.max(t, 0), last) : last;
}

/** The whole month `t` is in (the month the HUD shows, the URL shares and the detail panel explains). */
export function monthIndex(world: World, t: number): number {
  return Math.floor(clampT(world, t) + 1e-9);
}

export function monthLabel(world: World, t: number): string {
  return world.months[monthIndex(world, t)].replace('-', '.');
}

/** Plain code-unit comparison: tie-breaks must not depend on the viewer's locale / ICU data. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const keyOf = (sortBy: SortBy) => (m: { s: number; c: number }) => (sortBy === 'strength' ? m.s : m.c);

function computeRanks(world: World, front: FrontId, i: number, sortBy: SortBy): Map<string, number> {
  const S = world.series[front] ?? {};
  const key = keyOf(sortBy);
  const ids = Object.keys(S).filter((u) => S[u][i]);
  ids.sort((a, b) => key(S[b][i] as UnitMonth) - key(S[a][i] as UnitMonth) || cmp(a, b));
  return new Map(ids.map((u, k) => [u, k + 1]));
}

type RankCache = Record<SortBy, Partial<Record<FrontId, ReadonlyMap<string, number>[]>>>;
/** world data never changes after load: whole-month ranks are computed once per (world, front, month, sortBy) */
const rankCache = new WeakMap<World, RankCache>();
const NO_RANKS: ReadonlyMap<string, number> = new Map();

/** Unit id → 1-based rank among the units with data in whole month `i` (memoised; do not mutate the result). */
export function ranksAt(world: World, front: FrontId, i: number, sortBy: SortBy): ReadonlyMap<string, number> {
  let c = rankCache.get(world);
  if (!c) {
    c = { strength: {}, scale: {} };
    rankCache.set(world, c);
  }
  const byMonth = (c[sortBy][front] ??= []);
  return (byMonth[i] ??= computeRanks(world, front, i, sortBy));
}

/** world.units[front] as entries, computed once per world */
const unitEntryCache = new WeakMap<World, Partial<Record<FrontId, [string, World['units'][FrontId][string]][]>>>();
function unitEntries(world: World, front: FrontId): [string, World['units'][FrontId][string]][] {
  let c = unitEntryCache.get(world);
  if (!c) {
    c = {};
    unitEntryCache.set(world, c);
  }
  return (c[front] ??= Object.entries(world.units[front] ?? {}));
}

export function frontFrame(world: World, front: FrontId, t: number, sortBy: SortBy = 'strength'): UnitFrame[] {
  const tt = clampT(world, t);
  const i0 = Math.floor(tt + 1e-9);
  const i1 = Math.min(i0 + 1, world.months.length - 1);
  const f = Math.max(0, tt - i0); // tt can sit up to 1e-9 below a whole month, where i0 already rounds up
  const out: UnitFrame[] = [];
  for (const [id, u] of unitEntries(world, front)) {
    const arr = world.series[front]?.[id] ?? [];
    const a = arr[i0];
    const b = arr[i1];
    let s: number, c: number, q: Confidence, presence: number, fogBlend: number;
    if (a && b) {
      s = a.s + (b.s - a.s) * f;
      c = a.c + (b.c - a.c) * f;
      q = f < 0.5 ? a.q : b.q;
      fogBlend = fogOf(a.q) + (fogOf(b.q) - fogOf(a.q)) * f;
      presence = 1;
    } else if (a) {
      ({ s, c, q } = a);
      fogBlend = fogOf(q);
      presence = i1 === i0 ? 1 : 1 - f;
    } else if (b) {
      ({ s, c, q } = b);
      fogBlend = fogOf(q);
      presence = f;
    } else continue;
    presence = Math.min(Math.max(presence, 0), 1);
    if (!(presence > 0)) continue;
    // parseWorld repairs world.json, but these values position geometry: never let a NaN through to PixiJS
    if (!Number.isFinite(s)) s = 0;
    if (!Number.isFinite(c)) c = 0;
    out.push({ id, front, org: u.org, name: u.name, color: world.orgs[u.org]?.color ?? '#888888', s, c, q, fog: fogOf(q), fogBlend, presence, rank: 0, rankDelta: 0 });
  }
  // an arriving / leaving unit ranks by what is visible of it, so a nearly invisible unit never jumps to the top
  const key = keyOf(sortBy);
  const rankKey = (u: UnitFrame) => key(u) * u.presence;
  out.sort((x, y) => rankKey(y) - rankKey(x) || cmp(x.id, y.id));
  const prev = i0 > 0 ? ranksAt(world, front, i0 - 1, sortBy) : NO_RANKS;
  const cur = ranksAt(world, front, i0, sortBy);
  for (let k = 0; k < out.length; k++) {
    const u = out[k];
    u.rank = k + 1;
    const p = prev.get(u.id);
    const r = cur.get(u.id);
    u.rankDelta = p !== undefined && r !== undefined ? p - r : 0;
  }
  return out;
}

export interface OrgDeployment {
  org: string;
  name: string;
  color: string;
  fronts: FrontId[];
  /** sum over fronts of share × presence (0..700) */
  totalShare: number;
}

/** Every front's frame at `t` — what the renderer and the HUD share each animation frame. */
export type Frames = Partial<Record<FrontId, readonly UnitFrame[]>>;

export function allFrames(world: World, t: number, sortBy: SortBy = 'strength'): Frames {
  const out: Frames = {};
  for (const f of world.fronts) out[f.id] = frontFrame(world, f.id, t, sortBy);
  return out;
}

export type FrameSource = (t: number, sortBy: SortBy) => Frames;

/**
 * `allFrames`, recomputed only when `t` or `sortBy` changes: one computation per animation frame however many
 * components (galaxy, battle, ranking, deployment) ask for it.
 */
export function createFrameSource(world: World): FrameSource {
  let lastT = Number.NaN;
  let lastSort: SortBy | null = null;
  let frames: Frames = {};
  return (t, sortBy) => {
    if (!Object.is(t, lastT) || sortBy !== lastSort) {
      lastT = t;
      lastSort = sortBy;
      frames = allFrames(world, t, sortBy);
    }
    return frames;
  };
}

export function orgDeployment(world: World, t: number): OrgDeployment[] {
  return orgDeploymentFrom(world, allFrames(world, t));
}

/** `orgDeployment` from frames already computed for that `t` (in any sort order: the result does not depend on it). */
export function orgDeploymentFrom(world: World, frames: Frames): OrgDeployment[] {
  const by = new Map<string, OrgDeployment>();
  for (const f of world.fronts) {
    for (const u of frames[f.id] ?? []) {
      let d = by.get(u.org);
      if (!d) {
        d = { org: u.org, name: world.orgs[u.org]?.name ?? u.org, color: u.color, fronts: [], totalShare: 0 };
        by.set(u.org, d);
      }
      if (!d.fronts.includes(f.id)) d.fronts.push(f.id);
      d.totalShare += u.c * u.presence;
    }
  }
  return [...by.values()].sort((a, b) => b.fronts.length - a.fronts.length || b.totalShare - a.totalShare || cmp(a.org, b.org));
}
