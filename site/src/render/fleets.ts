/**
 * Fleets (mockup A `updateFleets`): small org-coloured ships flying the data streams between the hub and the
 * fronts each org fights on (`orgDeployment`). Ships per org ∝ fronts × summed share (./fleetMath), at most 140 on
 * desktop / 60 on phones × `particleScale`, fewer while the war is smaller than at its peak. A multi-front org's
 * ships circle a planet, run its stream in to the hub, round the hub and run out to the next front; single-front
 * orgs orbit their planet on the ring plane instead (passing behind it).
 *
 * Every ship is ship `k` of its org with its own deterministic random stream; it fades in / out as the allocation
 * changes. Ships live in a fixed pool (looks: ./fleetSprites): nothing is allocated per frame. The deployment is
 * re-read at most four times a second, and only while `t` moves.
 */
import { createFrameSource, orgDeploymentFrom, type FrameSource } from '../data/timeline';
import type { FrontId, World } from '../data/types';
import type { AppState, Store } from '../state/store';
import type { Renderer } from './app';
import type { Galaxy } from './galaxy';
import type { Planet } from './planet';
import { cameraFor } from './camera';
import { colorGain, hexColor } from './color';
import { TAU } from './layout';
import { createFleetSprites, type ShipView } from './fleetSprites';
import { FLEET_CAP_DESKTOP, Leg, RIM_HUB, RIM_SAT, advance, allocateFleets, arcPoint, fleetBudget, fleetCap, fleetPeak, fleetWeight } from './fleetMath';
import { laneEnvelope, legU, nextLeg, orbitPoint, pickWeighted, rand01, randIn, shipSeed, shortArc, type Rng, type Vec } from './fleetMath';

export interface FleetsOptions {
  world: World;
  store: Store<AppState>;
  /** the app's shared per-frame frames (main.ts): the deployment is read from them instead of recomputing every front */
  frames?: FrameSource;
}

export interface Fleets {
  /** advance and draw; call after `galaxy.update` each frame with the store's `t` */
  update(dt: number, t: number): void;
  /** per-org brightness multiplier (org highlight); null = 1 for everyone */
  setEmphasis(fn: ((org: string) => number) | null): void;
  /** ships alive, fading ones included */
  readonly count: number;
  /** ships allocated to an org at the last deployment refresh */
  wanted(org: string): number;
  destroy(): void;
}

interface Org {
  id: string;
  color: number;
  gain: number;
  weight: number;
  want: number;
  /** fronts the org fights on (indices into world.fronts) and its share of each (destination weights) */
  nf: number;
  fr: Int8Array;
  fw: Float64Array;
}

interface Ship extends Rng, ShipView {
  /** pool slot */
  i: number;
  live: boolean;
  org: number;
  k: number;
  dying: boolean;
  leg: Leg;
  at: number;
  dest: number;
  /** progress along the leg, arc start / end angle */
  s: number;
  a0: number;
  a1: number;
  /** fraction of the galaxy width per second */
  speed: number;
  /** −1..1: side of the stream the ship flies on (fleets spread across a stream instead of riding its dashes) */
  lane: number;
  /** orbit radius (× r), angle and angular speed */
  rr: number;
  oa: number;
  ow: number;
}

const MAX_SHIPS = FLEET_CAP_DESKTOP;
const REFRESH_S = 0.25;
/** destination weight of a front the org holds no territory on (shares are 0..1) */
const FRONT_BIAS = 0.04;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function createFleets(galaxy: Galaxy, renderer: Renderer, opts: FleetsOptions): Fleets {
  const { world, store } = opts;
  const frames = opts.frames ?? createFrameSource(world);
  const sprites = createFleetSprites(galaxy, MAX_SHIPS);
  const fronts: FrontId[] = world.fronts.map((f) => f.id);
  const frontIdx = new Map<FrontId, number>(fronts.map((f, i) => [f, i]));
  const planets: Planet[] = fronts.map((f) => galaxy.planet(f)).filter((p): p is Planet => p !== null);
  const orgIds = [...new Set([...Object.keys(world.orgs), ...Object.values(world.units).flatMap((u) => Object.values(u).map((x) => x.org))])];
  const orgIdx = new Map<string, number>(orgIds.map((o, i) => [o, i]));
  const orgs: Org[] = orgIds.map((id) => {
    const color = hexColor(world.orgs[id]?.color ?? '#888888');
    return { id, color, gain: colorGain(color), weight: 0, want: 0, nf: 0, fr: new Int8Array(fronts.length), fw: new Float64Array(fronts.length) };
  });
  const weights: number[] = orgs.map(() => 0);
  const alloc: number[] = [];
  const present = new Uint8Array(orgs.length * MAX_SHIPS);
  const streamLen = new Float64Array(fronts.length);
  const peak = fleetPeak(world);
  const ships: Ship[] = Array.from({ length: MAX_SHIPS }, (_, i) => ({
    i, live: false, org: 0, k: 0, rng: 1, dying: false, alpha: 0, leg: Leg.Loiter, at: 0, dest: 0, s: 0, a0: 0, a1: 0,
    speed: 0.08, lane: 0, rr: 1.5, oa: 0, ow: 0, x: 0, y: 0, hx: 1, hy: 0, behind: false,
  }));

  const tmp: Vec = { x: 0, y: 0 };
  const tmpB: Vec = { x: 0, y: 0 };
  let emphasis: ((org: string) => number) | null = null;
  let hubId: FrontId = galaxy.layout.hub;
  let hub = frontIdx.get(hubId) ?? 0;
  let extentW = galaxy.layout.extent.w;
  let ovScale = 1;
  let cap = 0;
  let lastT = Number.NaN;
  let slowAcc = REFRESH_S;
  let first = true;
  let alive = 0;
  let cursor = 0;
  /** a spawn found the pool full (fading ships still hold slots): refresh again soon even if `t` stands still */
  let short = false;
  let layoutDirty = false;
  /** widest lane offset (world units) */
  let laneW = 0;
  const offLayout = galaxy.onLayoutChange(() => (layoutDirty = true));

  const rimOf = (fi: number) => planets[fi].slot.r * (fi === hub ? RIM_HUB : RIM_SAT);
  const angleAround = (fi: number, x: number, y: number) => Math.atan2(y - planets[fi].y, x - planets[fi].x);

  function pickDest(sh: Ship): number {
    const o = orgs[sh.org];
    let ex = -1;
    for (let j = 0; j < o.nf; j++) if (o.fr[j] === sh.at) ex = j;
    const j = pickWeighted(o.fw, o.nf, ex, rand01(sh), FRONT_BIAS);
    return j >= 0 ? o.fr[j] : sh.at;
  }

  /** live end angle of an arc leg (stream mouths move with the planets' bob); NaN when the stream is missing */
  function arcEnd(sh: Ship): number {
    if (sh.leg === Leg.Loiter) return sh.a1;
    const toExit = sh.leg === Leg.ToExit;
    const m = galaxy.streamPoint(fronts[toExit ? sh.at : sh.dest], toExit ? 0 : 1, tmpB);
    if (!m) return Number.NaN;
    const c = planets[toExit ? sh.at : hub];
    return shortArc(sh.a0, Math.atan2(m.y - c.y, m.x - c.x));
  }

  function legLen(sh: Ship): number {
    if (sh.leg === Leg.Out) return streamLen[sh.at];
    if (sh.leg === Leg.In) return streamLen[sh.dest];
    return Math.abs(arcEnd(sh) - sh.a0) * rimOf(sh.leg === Leg.HubArc ? hub : sh.at);
  }

  /** position at the current leg / progress into `out`; false when the geometry is missing */
  function posOf(sh: Ship, out: Vec): boolean {
    sh.behind = false;
    if (sh.leg === Leg.Orbit) {
      const p = planets[sh.at];
      sh.behind = orbitPoint(p.x, p.y, sh.rr * p.slot.r, sh.oa, out);
      return true;
    }
    if (sh.leg === Leg.Out || sh.leg === Leg.In) {
      const f = sh.leg === Leg.Out ? sh.at : sh.dest;
      const u = legU(sh.leg, sh.s);
      if (f === hub || !galaxy.streamPoint(fronts[f], u, out)) return false;
      // lane offset across the stream, zero at both mouths so arcs and streams still join up
      const off = sh.lane * laneW * laneEnvelope(u);
      if (off !== 0 && galaxy.streamPoint(fronts[f], u < 0.98 ? u + 0.02 : u - 0.02, tmpB)) {
        const dir = u < 0.98 ? 1 : -1;
        const tx = (tmpB.x - out.x) * dir;
        const ty = (tmpB.y - out.y) * dir;
        const L = Math.sqrt(tx * tx + ty * ty) || 1;
        out.x -= (ty / L) * off;
        out.y += (tx / L) * off;
      }
      return true;
    }
    const c = sh.leg === Leg.HubArc ? hub : sh.at;
    const a1 = arcEnd(sh);
    if (Number.isNaN(a1)) return false;
    arcPoint(planets[c].x, planets[c].y, rimOf(c), sh.a0 + (a1 - sh.a0) * clamp(sh.s, 0, 1), out);
    return true;
  }

  function startLeg(sh: Ship, leg: Leg) {
    sh.leg = leg;
    sh.s = 0;
    if (leg === Leg.Loiter || leg === Leg.ToExit) sh.a0 = angleAround(sh.at, sh.x, sh.y);
    else if (leg === Leg.HubArc) sh.a0 = angleAround(hub, sh.x, sh.y);
    if (leg === Leg.Loiter) sh.a1 = sh.a0 + (rand01(sh) < 0.5 ? -1 : 1) * randIn(sh, 0.6, 2.4);
  }

  /** (re)place a ship from scratch for its org's current deployment; `initial` scatters it along its route */
  function place(sh: Ship, initial: boolean) {
    const o = orgs[sh.org];
    sprites.resetTrail(sh.i);
    if (o.nf === 0) {
      sh.dying = true;
      sh.alpha = 0;
      return;
    }
    if (o.nf === 1) {
      sh.leg = Leg.Orbit;
      sh.at = o.fr[0];
      sh.rr = sh.at === hub ? randIn(sh, 1.2, 1.5) : randIn(sh, 1.3, 1.85);
      sh.oa = rand01(sh) * TAU;
      sh.ow = (rand01(sh) < 0.5 ? -1 : 1) * randIn(sh, 0.35, 0.8);
    } else {
      sh.at = o.fr[Math.max(0, pickWeighted(o.fw, o.nf, -1, rand01(sh), FRONT_BIAS))];
      arcPoint(planets[sh.at].x, planets[sh.at].y, rimOf(sh.at), rand01(sh) * TAU, tmp);
      sh.x = tmp.x;
      sh.y = tmp.y;
      startLeg(sh, Leg.Loiter);
      if (initial && rand01(sh) < 0.55) {
        // already under way, somewhere along a stream: out of its planet toward the hub, or from the hub to the next front
        sh.dest = pickDest(sh);
        sh.leg = sh.at !== hub ? Leg.Out : Leg.In;
        sh.s = rand01(sh);
      } else if (initial) sh.s = rand01(sh) * 0.8;
    }
    if (posOf(sh, tmp)) {
      sh.x = tmp.x;
      sh.y = tmp.y;
    }
  }

  function warp(sh: Ship) {
    sh.alpha = 0;
    place(sh, false);
  }

  function finishLeg(sh: Ship) {
    if (orgs[sh.org].nf < 2) return warp(sh);
    if (sh.leg === Leg.Loiter) sh.dest = pickDest(sh);
    else if (sh.leg === Leg.Out) sh.at = hub;
    else if (sh.leg === Leg.In) sh.at = sh.dest;
    startLeg(sh, nextLeg(sh.leg, sh.at, sh.dest, hub));
  }

  function spawn(org: number, k: number, initial: boolean): boolean {
    for (let n = 0; n < MAX_SHIPS; n++) {
      const sh = ships[cursor];
      cursor = (cursor + 1) % MAX_SHIPS;
      if (sh.live) continue;
      sh.live = true;
      sh.org = org;
      sh.k = k;
      sh.rng = shipSeed(orgs[org].id, k);
      sh.dying = false;
      sh.alpha = 0;
      sh.speed = randIn(sh, 0.065, 0.115);
      sh.lane = randIn(sh, -1, 1);
      place(sh, initial);
      alive++;
      return true;
    }
    return false;
  }

  function refresh(t: number) {
    lastT = t;
    for (const o of orgs) o.weight = o.nf = 0;
    // this frame's shared frames (already computed for the galaxy: a cache hit, whatever the sort order)
    for (const d of orgDeploymentFrom(world, frames(t, store.get().sortBy))) {
      const o = orgs[orgIdx.get(d.org) ?? -1];
      if (!o) continue;
      o.weight = fleetWeight(d);
      for (const f of d.fronts) {
        const fi = frontIdx.get(f);
        if (fi === undefined || o.nf >= o.fr.length) continue;
        o.fr[o.nf] = fi;
        o.fw[o.nf++] = 0;
      }
    }
    // destination weights: the org's share of each planet it fights on (current territories)
    for (let fi = 0; fi < planets.length; fi++) {
      for (const w of planets[fi].wedges) {
        const o = orgs[orgIdx.get(w.org) ?? -1];
        if (o) for (let j = 0; j < o.nf; j++) if (o.fr[j] === fi) o.fw[j] += w.share;
      }
    }
    let total = 0;
    for (let i = 0; i < orgs.length; i++) total += weights[i] = orgs[i].weight;
    allocateFleets(weights, fleetBudget(total, peak, cap), alloc);
    for (let i = 0; i < orgs.length; i++) orgs[i].want = alloc[i];

    // reconcile the pool with the allocation: ship k of an org lives while k < want
    present.fill(0);
    for (const sh of ships) {
      if (!sh.live) continue;
      const o = orgs[sh.org];
      sh.dying = sh.k >= o.want;
      if (sh.dying) continue;
      present[sh.org * MAX_SHIPS + sh.k] = 1;
      // a single-front org's orbiters follow it to a new front, or start routing once it spreads out
      if (sh.leg === Leg.Orbit && (o.nf !== 1 || o.fr[0] !== sh.at)) warp(sh);
    }
    short = false;
    for (let i = 0; i < orgs.length; i++)
      for (let k = 0; k < orgs[i].want && k < MAX_SHIPS; k++) if (!present[i * MAX_SHIPS + k] && !spawn(i, k, first)) short = true;
    first = false;
  }

  function slowTick(t: number) {
    const L = galaxy.layout;
    extentW = L.extent.w;
    ovScale = cameraFor({ kind: 'galaxy', extent: L.extent }, renderer.viewport).scale;
    const nextCap = fleetCap(L.portrait || renderer.app.screen.width < 768, renderer.particleScale);
    for (let fi = 0; fi < fronts.length; fi++) {
      let len = 0;
      for (let i = 0; i <= 16; i++) {
        if (!galaxy.streamPoint(fronts[fi], i / 16, tmpB)) break;
        if (i) len += Math.hypot(tmpB.x - tmp.x, tmpB.y - tmp.y);
        tmp.x = tmpB.x;
        tmp.y = tmpB.y;
      }
      streamLen[fi] = len;
    }
    if (L.hub !== hubId || layoutDirty) {
      hubId = L.hub;
      hub = frontIdx.get(hubId) ?? 0;
      layoutDirty = false;
      for (const sh of ships) if (sh.live) warp(sh);
    }
    if (nextCap !== cap || t !== lastT || short) {
      cap = nextCap;
      refresh(t);
    }
  }

  return {
    update(dt, t) {
      slowAcc += dt;
      if (slowAcc >= REFRESH_S || first) {
        slowAcc = 0;
        slowTick(t);
      }
      if (!alive) return;
      const mdt = dt * (store.get().reducedMotion ? 0.2 : 1);
      const ws = renderer.layers.world.scale.x || 1;
      const px = 1 / ws;
      const sz = clamp(3.5 * Math.sqrt(ws / ovScale), 3, 5) * px;
      laneW = 5 * px;
      for (let i = 0; i < ships.length; i++) {
        const sh = ships[i];
        if (!sh.live) continue;
        sh.alpha += ((sh.dying ? 0 : 1) - sh.alpha) * Math.min(1, dt * 2.5);
        if (sh.dying && sh.alpha < 0.03) {
          sh.live = false;
          sprites.hide(i);
          alive--;
          continue;
        }
        if (sh.leg === Leg.Orbit) sh.oa += sh.ow * mdt;
        else {
          const len = legLen(sh);
          sh.s = Number.isNaN(len) ? 1 : advance(sh.s, sh.speed * extentW, mdt, len);
          if (sh.s >= 1) finishLeg(sh);
        }
        if (!posOf(sh, tmp)) {
          // its stream vanished (the hub moved): start over elsewhere, hidden until it fades back in
          warp(sh);
          sprites.hide(i);
          continue;
        }
        const dx = tmp.x - sh.x;
        const dy = tmp.y - sh.y;
        if (dx * dx + dy * dy > 1e-8) {
          sh.hx = dx;
          sh.hy = dy;
        }
        sh.x = tmp.x;
        sh.y = tmp.y;
        sprites.track(i, sh.x, sh.y, dt);
        const o = orgs[sh.org];
        sprites.draw(i, sh, o.color, o.gain, emphasis ? emphasis(o.id) : 1, px, sz);
      }
    },
    setEmphasis(fn) {
      emphasis = fn;
    },
    get count() {
      return alive;
    },
    wanted(org) {
      return orgs[orgIdx.get(org) ?? -1]?.want ?? 0;
    },
    destroy() {
      offLayout();
      sprites.destroy();
    },
  };
}
