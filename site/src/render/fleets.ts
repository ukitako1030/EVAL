/**
 * Fleets (mockup A `updateFleets` / `drawFleets`): small org-coloured ships flying the data streams between the
 * hub and the fronts each org fights on (`orgDeployment`). Ships per org ∝ fronts × summed share (./fleetMath),
 * at most 140 on desktop / 60 on phones × `particleScale`, fewer while the war is smaller than at its peak.
 * Single-front orgs orbit their planet on the ring plane instead (dimmer while behind it).
 *
 * Every ship is ship `k` of its org with its own deterministic random stream; it fades in / out as the allocation
 * changes and leaves a short engine trail. Ships live in a fixed pool of particles (trail, glow, body — one set
 * behind the planets, one in front): nothing is allocated per frame. The deployment is re-read at most four times
 * a second, and only while `t` moves.
 */
import { CanvasSource, Container, Particle, ParticleContainer, Texture } from 'pixi.js';
import { orgDeployment } from '../data/timeline';
import type { FrontId, World } from '../data/types';
import type { AppState, Store } from '../state/store';
import type { Renderer } from './app';
import type { Galaxy } from './galaxy';
import type { Planet } from './planet';
import { cameraFor } from './camera';
import { glowTexture } from './bgTextures';
import { colorGain, hexColor } from './color';
import { TAU } from './layout';
import {
  FLEET_CAP_DESKTOP,
  Leg,
  RIM_HUB,
  RIM_SAT,
  advance,
  allocateFleets,
  arcPoint,
  fleetBudget,
  fleetCap,
  fleetPeak,
  fleetWeight,
  laneEnvelope,
  legU,
  nextLeg,
  orbitPoint,
  pickWeighted,
  rand01,
  randIn,
  shipSeed,
  shortArc,
  type Rng,
  type Vec,
} from './fleetMath';

export interface FleetsOptions {
  world: World;
  store: Store<AppState>;
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

interface Ship extends Rng {
  live: boolean;
  org: number;
  k: number;
  dying: boolean;
  alpha: number;
  leg: Leg;
  at: number;
  dest: number;
  s: number;
  a0: number;
  a1: number;
  /** fraction of the galaxy width per second */
  speed: number;
  /** −1..1: side of the stream the ship flies on (fleets spread across the stream instead of riding its dashes) */
  lane: number;
  /** orbit radius (× r), angle and angular speed */
  rr: number;
  oa: number;
  ow: number;
  x: number;
  y: number;
  hx: number;
  hy: number;
  behind: boolean;
  /** which particle set is lit: 0 behind, 1 front, −1 none */
  layer: number;
  hist: Float32Array;
  hi: number;
  hn: number;
  hacc: number;
  /** [behind trail, glow, body, front trail, glow, body] */
  parts: Particle[];
}

const MAX_SHIPS = FLEET_CAP_DESKTOP;
const HN = 8;
const HIST_DT = 0.022;
const REFRESH_S = 0.25;
/** destination weight of a front the org holds no territory on (its share is 0..1) */
const FRONT_BIAS = 0.04;
const DART_W = 32;
const DART_H = 20;
const STREAK_W = 32;
const STREAK_H = 4;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  draw(g);
  return new Texture({ source: new CanvasSource({ resource: c, resolution: 1 }) });
}

function shipTextures() {
  // arrowhead pointing +x (mockup A ship: nose 1.4 sz ahead, notched tail 1 sz behind)
  const dart = canvasTexture(DART_W, DART_H, (g) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(31, 10);
    g.lineTo(1, 1);
    g.lineTo(9.5, 10);
    g.lineTo(1, 19);
    g.closePath();
    g.fill();
  });
  // engine trail: transparent tail → bright head at the right edge
  const streak = canvasTexture(STREAK_W, STREAK_H, (g) => {
    const gr = g.createLinearGradient(0, 0, STREAK_W, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.fillRect(0, 1, STREAK_W, 2);
  });
  return { dart, streak, glow: glowTexture() };
}

export function createFleets(galaxy: Galaxy, renderer: Renderer, opts: FleetsOptions): Fleets {
  const { world, store } = opts;
  const tex = shipTextures();
  const GLOW_W = tex.glow.width;

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

  const layer = (label: string) => {
    const c = new Container({ label });
    c.eventMode = 'none';
    const pcs = [tex.streak, tex.glow, tex.dart].map((texture) => {
      const pc = new ParticleContainer({ texture, dynamicProperties: { position: true, rotation: true, vertex: true, color: true } });
      pc.blendMode = 'add';
      c.addChild(pc);
      return pc;
    });
    return { c, pcs };
  };
  const back = layer('fleets-behind');
  const front = layer('fleets');
  galaxy.layers.behind.addChild(back.c);
  galaxy.layers.front.addChild(front.c);

  const ships: Ship[] = [];
  for (let i = 0; i < MAX_SHIPS; i++) {
    const parts: Particle[] = [];
    for (const L of [back, front]) {
      L.pcs.forEach((pc, j) => {
        const p = new Particle({ texture: j === 0 ? tex.streak : j === 1 ? tex.glow : tex.dart, anchorX: j === 0 ? 1 : j === 1 ? 0.5 : 0.42, anchorY: 0.5, alpha: 0, scaleX: 0, scaleY: 0 });
        pc.addParticle(p);
        parts.push(p);
      });
    }
    ships.push({
      live: false, org: 0, k: 0, rng: 1, dying: false, alpha: 0, leg: Leg.Loiter, at: 0, dest: 0, s: 0, a0: 0, a1: 0, speed: 0.08,
      lane: 0, rr: 1.5, oa: 0, ow: 0, x: 0, y: 0, hx: 1, hy: 0, behind: false, layer: -1, hist: new Float32Array(HN * 2), hi: 0, hn: 0, hacc: 0, parts,
    });
  }

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
    const c = sh.leg === Leg.HubArc ? hub : sh.at;
    return Math.abs(arcEnd(sh) - sh.a0) * rimOf(c);
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
        const L = Math.hypot(tx, ty) || 1;
        out.x -= (ty / L) * off;
        out.y += (tx / L) * off;
      }
      return true;
    }
    const c = sh.leg === Leg.HubArc ? hub : sh.at;
    const a1 = arcEnd(sh);
    if (Number.isNaN(a1)) return false;
    const p = planets[c];
    arcPoint(p.x, p.y, rimOf(c), sh.a0 + (a1 - sh.a0) * clamp(sh.s, 0, 1), out);
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
    sh.hn = 0;
    sh.hacc = 0;
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
      const a = rand01(sh) * TAU;
      arcPoint(planets[sh.at].x, planets[sh.at].y, rimOf(sh.at), a, tmp);
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
    const o = orgs[sh.org];
    if (o.nf < 2) return warp(sh);
    if (sh.leg === Leg.Loiter) sh.dest = pickDest(sh);
    else if (sh.leg === Leg.Out) sh.at = hub;
    else if (sh.leg === Leg.In) sh.at = sh.dest;
    startLeg(sh, nextLeg(sh.leg, sh.at, sh.dest, hub));
  }

  function release(sh: Ship) {
    sh.live = false;
    sh.layer = -1;
    for (const p of sh.parts) p.alpha = 0;
    alive--;
  }

  function spawn(org: number, k: number, initial: boolean) {
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
      sh.layer = -1;
      sh.speed = randIn(sh, 0.065, 0.115);
      sh.lane = randIn(sh, -1, 1);
      place(sh, initial);
      alive++;
      return;
    }
  }

  function refresh(t: number) {
    lastT = t;
    for (const o of orgs) {
      o.weight = 0;
      o.nf = 0;
    }
    for (const d of orgDeployment(world, t)) {
      const i = orgIdx.get(d.org);
      if (i === undefined) continue;
      const o = orgs[i];
      o.weight = fleetWeight(d);
      for (const f of d.fronts) {
        const fi = frontIdx.get(f);
        if (fi === undefined || o.nf >= o.fr.length) continue;
        o.fr[o.nf] = fi;
        o.fw[o.nf] = 0;
        o.nf++;
      }
    }
    // destination weights: the org's share of each planet it fights on (current territories)
    for (let fi = 0; fi < planets.length; fi++) {
      for (const w of planets[fi].wedges) {
        const o = orgs[orgIdx.get(w.org) ?? -1];
        if (!o) continue;
        for (let j = 0; j < o.nf; j++) if (o.fr[j] === fi) o.fw[j] += w.share;
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
      // a single-front org's orbiters follow it when it changes front; ships of an org that spread out start routing
      if (sh.leg === Leg.Orbit && (o.nf !== 1 || o.fr[0] !== sh.at)) warp(sh);
    }
    for (let i = 0; i < orgs.length; i++) for (let k = 0; k < orgs[i].want && k < MAX_SHIPS; k++) if (!present[i * MAX_SHIPS + k]) spawn(i, k, first);
    first = false;
  }

  function slowTick(t: number) {
    const L = galaxy.layout;
    extentW = L.extent.w;
    ovScale = cameraFor({ kind: 'galaxy', extent: L.extent }, renderer.viewport).scale;
    const nextCap = fleetCap(L.portrait || renderer.app.screen.width < 768, renderer.particleScale);
    for (let fi = 0; fi < fronts.length; fi++) {
      let len = 0;
      let px = 0;
      let py = 0;
      for (let i = 0; i <= 16; i++) {
        if (!galaxy.streamPoint(fronts[fi], i / 16, tmp)) break;
        if (i) len += Math.hypot(tmp.x - px, tmp.y - py);
        px = tmp.x;
        py = tmp.y;
      }
      streamLen[fi] = len;
    }
    if (L.hub !== hubId || layoutDirty) {
      hubId = L.hub;
      hub = frontIdx.get(hubId) ?? 0;
      layoutDirty = false;
      for (const sh of ships) if (sh.live) warp(sh);
    }
    if (nextCap !== cap || t !== lastT) {
      cap = nextCap;
      refresh(t);
    }
  }

  function draw(sh: Ship, px: number, sz: number) {
    const o = orgs[sh.org];
    const L = sh.behind ? 0 : 1;
    if (L !== sh.layer) {
      if (sh.layer >= 0) for (let j = 0; j < 3; j++) sh.parts[sh.layer * 3 + j].alpha = 0;
      for (let j = 0; j < 3; j++) sh.parts[L * 3 + j].tint = o.color;
      sh.layer = L;
    }
    const e = emphasis ? emphasis(o.id) : 1;
    const boost = Math.max(0, e - 1);
    const a = sh.alpha * (sh.behind ? 0.45 : 1) * Math.min(1, e);
    const trail = sh.parts[L * 3];
    const glow = sh.parts[L * 3 + 1];
    const body = sh.parts[L * 3 + 2];
    const rot = Math.atan2(sh.hy, sh.hx);
    body.x = glow.x = trail.x = sh.x;
    body.y = glow.y = trail.y = sh.y;
    body.rotation = rot;
    body.scaleX = (2.4 * sz * (1 + 0.2 * boost)) / DART_W;
    body.scaleY = (1.5 * sz * (1 + 0.2 * boost)) / DART_H;
    body.alpha = a * (0.6 + 0.4 * o.gain);
    glow.scaleX = glow.scaleY = (5.6 * sz * (1 + 0.4 * boost)) / GLOW_W;
    glow.alpha = 0.6 * a * o.gain * (1 + 1.2 * boost);
    if (sh.hn > 1) {
      const j = (sh.hi - sh.hn + HN) % HN;
      const dx = sh.x - sh.hist[j * 2];
      const dy = sh.y - sh.hist[j * 2 + 1];
      const len = Math.hypot(dx, dy);
      trail.rotation = Math.atan2(dy, dx);
      trail.scaleX = len / STREAK_W;
      trail.scaleY = ((1.6 + 0.6 * boost) * px) / (STREAK_H / 2);
      trail.alpha = len > 0.6 * px ? 0.8 * a * (0.6 + 0.4 * o.gain) : 0;
    } else trail.alpha = 0;
  }

  return {
    update(dt, t) {
      slowAcc += dt;
      if (slowAcc >= REFRESH_S || first) {
        slowAcc = 0;
        slowTick(t);
      }
      if (!alive) return;
      const reduced = store.get().reducedMotion;
      const mdt = dt * (reduced ? 0.2 : 1);
      const ws = renderer.layers.world.scale.x || 1;
      const px = 1 / ws;
      const sz = clamp(3.5 * Math.sqrt(ws / ovScale), 3, 5) * px;
      laneW = 5 * px;
      for (const sh of ships) {
        if (!sh.live) continue;
        sh.alpha += ((sh.dying ? 0 : 1) - sh.alpha) * Math.min(1, dt * 2.5);
        if (sh.dying && sh.alpha < 0.03) {
          release(sh);
          continue;
        }
        if (sh.leg === Leg.Orbit) sh.oa += sh.ow * mdt;
        else {
          const len = legLen(sh);
          sh.s = Number.isNaN(len) ? 1 : advance(sh.s, sh.speed * extentW, mdt, len);
          if (sh.s >= 1) finishLeg(sh);
        }
        if (!posOf(sh, tmp)) {
          warp(sh);
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
        sh.hacc += dt;
        if (sh.hacc >= HIST_DT || sh.hn === 0) {
          sh.hacc = sh.hn === 0 ? 0 : sh.hacc % HIST_DT;
          sh.hist[sh.hi * 2] = sh.x;
          sh.hist[sh.hi * 2 + 1] = sh.y;
          sh.hi = (sh.hi + 1) % HN;
          sh.hn = Math.min(HN, sh.hn + 1);
        }
        draw(sh, px, sz);
      }
    },
    setEmphasis(fn) {
      emphasis = fn;
    },
    get count() {
      return alive;
    },
    wanted(org) {
      const i = orgIdx.get(org);
      return i === undefined ? 0 : orgs[i].want;
    },
    destroy() {
      offLayout();
      back.c.destroy({ children: true });
      front.c.destroy({ children: true });
      tex.dart.destroy(true);
      tex.streak.destroy(true);
      tex.glow.destroy(true);
    },
  };
}
