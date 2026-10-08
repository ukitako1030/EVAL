/**
 * `territories` / `frontlines` (./layout) for the per-frame path: the same results, written into arrays and objects
 * the caller keeps from frame to frame. During playback a planet's frames change every frame, and building fresh
 * wedges, frontlines and `prev|cur` key strings for seven planets each time was steady garbage; here the wedge and
 * frontline objects are reused by index and a frontline's key (and seed) is rebuilt only when its neighbours change.
 * Results are identical to the allocating versions (same arithmetic, same order) — test/render/layout.test.ts.
 */
import type { UnitFrame } from '../data/timeline';
import { MAX_BULGE, START_ANGLE, TAU, strHash, type Frontline, type Wedge } from './layout';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const finite = (v: number, d = 0) => (Number.isFinite(v) ? v : d);

// scratch: indices into `frames` of the units that get territory, and their weights (single-threaded, reused)
let order = new Int32Array(32);
let weight = new Float64Array(32);

/** `territories(frames)` written into `out` (its Wedge objects reused by index); returns `out` */
export function territoriesInto(frames: readonly UnitFrame[], out: Wedge[]): Wedge[] {
  if (order.length < frames.length) {
    order = new Int32Array(frames.length * 2);
    weight = new Float64Array(frames.length * 2);
  }
  // present units and their weights, summed in frame order (as `territories` does)
  let n = 0;
  let total = 0;
  for (let i = 0; i < frames.length; i++) {
    const u = frames[i];
    if (!(finite(u.presence) > 0)) continue;
    const w = Math.max(0, finite(u.c)) * Math.min(1, finite(u.presence));
    order[n] = i;
    weight[i] = w;
    total += w;
    n++;
  }
  if (total > 0) {
    let k = 0;
    for (let j = 0; j < n; j++) if (weight[order[j]] > 0) order[k++] = order[j];
    n = k;
  } else {
    for (let j = 0; j < n; j++) weight[order[j]] = 1;
    total = n;
  }
  // largest first, ties by id (insertion sort: a front has a handful of units, and no comparator closure)
  for (let j = 1; j < n; j++) {
    const x = order[j];
    let k = j - 1;
    while (k >= 0 && before(frames, weight, x, order[k])) {
      order[k + 1] = order[k];
      k--;
    }
    order[k + 1] = x;
  }
  let a = START_ANGLE;
  for (let k = 0; k < n; k++) {
    const u = frames[order[k]];
    const wt = weight[order[k]];
    const share = wt / total;
    const a0 = a;
    a = k === n - 1 ? START_ANGLE + TAU : a + share * TAU;
    const w = (out[k] ??= { id: '', org: '', name: '', color: '', s: 0, c: 0, fog: 0, fogBlend: 0, presence: 0, rank: 0, weight: 0, share: 0, a0: 0, a1: 0 });
    w.id = u.id;
    w.org = u.org;
    w.name = u.name;
    w.color = u.color;
    w.s = finite(u.s);
    w.c = finite(u.c);
    w.fog = finite(u.fog);
    w.fogBlend = finite(u.fogBlend);
    w.presence = finite(u.presence);
    w.rank = u.rank;
    w.weight = wt;
    w.share = share;
    w.a0 = a0;
    w.a1 = a;
  }
  out.length = n;
  return out;
}

/** does frame x sort before frame y (larger weight first, then smaller id) */
function before(frames: readonly UnitFrame[], weight: Float64Array, x: number, y: number): boolean {
  const d = weight[y] - weight[x];
  if (d !== 0) return d < 0;
  return frames[x].id < frames[y].id;
}

/** is `key` exactly `p + '|' + c` (checked without building the string) */
function keyIs(key: string, p: string, c: string): boolean {
  return key.length === p.length + 1 + c.length && key.charCodeAt(p.length) === 124 && key.startsWith(p) && key.endsWith(c);
}

/** `frontlines(wedges)` written into `out` (its Frontline objects reused by index); returns `out` */
export function frontlinesInto(wedges: readonly Wedge[], out: Frontline[]): Frontline[] {
  const n = wedges.length;
  if (n < 2) {
    out.length = 0;
    return out;
  }
  for (let k = 0; k < n; k++) {
    const prev = wedges[(k - 1 + n) % n];
    const cur = wedges[k];
    const ds = finite(prev.s - cur.s);
    let b = out[k];
    if (!b) {
      const key = prev.id + '|' + cur.id;
      b = { k, key, prev, cur, base: 0, push: 0, fierce: 0, maxL: 0, maxR: 0, seed: strHash(key) };
      out[k] = b;
    } else if (!keyIs(b.key, prev.id, cur.id)) {
      b.key = prev.id + '|' + cur.id;
      b.seed = strHash(b.key);
    }
    b.k = k;
    b.prev = prev;
    b.cur = cur;
    b.base = cur.a0;
    b.push = clamp(ds / 10, -1, 1);
    b.fierce = clamp(1 - Math.abs(ds) / 14, 0.12, 1);
    b.maxL = (prev.a1 - prev.a0) * MAX_BULGE;
    b.maxR = (cur.a1 - cur.a0) * MAX_BULGE;
  }
  out.length = n;
  return out;
}
