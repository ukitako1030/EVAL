/**
 * Zoomed planet view (spec §7, mockup C): while `state.front` is set and the camera has zoomed in, the
 * focused planet's interior turns into a particle-swarm battle (./swarm + ./swarmView) — one swarm per unit,
 * homed on the same territory wedges the overview shows (animated edges via `planet.borderAt`), drawn in the
 * planet's `inner` slot (clipped to the disc, under the planet's fog and sphere shading, so fogged swarms sit
 * in their fog). Screen-space labels mark each swarm's centroid. Arriving units warp in on a beam, leaving
 * units fade, `shockwave(unit)` blasts a coloured ring from a swarm; every bright effect asks the shared
 * flash budget first (no white, nothing full-screen). Clicking a swarm selects its unit.
 */
import { CanvasSource, Circle, Container, Graphics, Texture, type FederatedPointerEvent } from 'pixi.js';
import type { FrontId } from '../data/types';
import type { AppState, Store } from '../state/store';
import type { FlashBudget } from '../fx/flashBudget';
import type { Renderer } from './app';
import type { Galaxy } from './galaxy';
import type { Planet } from './planet';
import { cameraFor } from './camera';
import { START_ANGLE, TAU, strHash } from './layout';
import { hexColor } from './color';
import { glowTexture } from './bgTextures';
import { MAX_UNITS, SECTOR_SAMPLES, createSwarm, sectorRho, type SwarmUnitIn } from './swarm';
import { createSwarmView, type SwarmLook } from './swarmView';
import { createBattleFx, type FxView } from './battleFx';
import { createBattleLabels, type LabelFrame, type SwarmLabel } from './battleLabels';

export interface BattleOptions {
  store: Store<AppState>;
  /** the app-wide flash limiter (shockwaves and warp-ins ask it first); null = never flash */
  flashes?: FlashBudget | null;
  /**
   * Clock (s) for flash requests — must be the one every other requester of the same budget uses. Default: seconds of
   * rendered frames since creation, which is the galaxy's clock when both are created before the first frame.
   */
  now?: () => number;
}

export interface Battle {
  /** the front whose battle is shown (also while it fades out), or null */
  readonly front: FrontId | null;
  /** screen-space swarm labels (in `renderer.layers.fx`) */
  readonly labels: Container;
  /** call once per frame after `galaxy.update` */
  update(dt: number): void;
  /**
   * Emit a coloured shockwave from that unit's swarm (Task 15: when a banner for the shown front starts).
   * Its brightness is whatever the flash budget grants. Returns false when the unit has no swarm on screen.
   */
  shockwave(unitId: string): boolean;
  /** run the battle in this front's planet regardless of the camera (portrait layout); null = follow `state.front` + zoom */
  setPinned(front: FrontId | null): void;
  /** re-render text after web fonts load */
  refreshText(): void;
  destroy(): void;
}

const CAP_DESKTOP = 2500;
const CAP_MOBILE = 900;
const VEIL = 0x02050f;
const VEIL_ALPHA = 0.72;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function streakTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 8;
  const g = c.getContext('2d');
  if (g) {
    const gr = g.createLinearGradient(0, 0, 32, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.fillRect(0, 2.5, 32, 3);
    // a rounder, brighter head
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(28, 1.5, 4, 5);
  }
  return new Texture({ source: new CanvasSource({ resource: c, resolution: 1 }) });
}

export function createBattle(renderer: Renderer, galaxy: Galaxy, opts: BattleOptions): Battle {
  const { store } = opts;
  const flashes = opts.flashes ?? null;
  const tex = { streak: streakTexture(), glow: glowTexture() };
  const sim = createSwarm({ capacity: CAP_DESKTOP, seed: 1 });
  const view = createSwarmView(CAP_DESKTOP, tex);
  const fx = createBattleFx(tex.glow);
  const labels = createBattleLabels();
  renderer.layers.fx.addChild(labels.container);

  // world-space parts, re-parented into the shown planet's `inner` slot
  const root = new Container({ label: 'battle' });
  root.eventMode = 'none';
  const content = new Container({ label: 'battle-content' });
  const veil = new Graphics();
  const mask = new Graphics();
  content.addChild(veil, view.container, fx.container);
  content.mask = mask;
  root.addChild(content, mask);
  // click / hover target above the planet (the planet's own tap handler would clear the selection)
  const hit = new Container({ label: 'battle-hit' });
  hit.eventMode = 'none';
  galaxy.layers.front.addChild(hit);

  const color = new Uint32Array(MAX_UNITS);
  const look: SwarmLook = { color, vis: 0, reduced: false };
  const ins: SwarmUnitIn[] = [];
  const labelPool: SwarmLabel[] = [];
  const labelList: SwarmLabel[] = [];
  let shown: FrontId | null = null;
  let planet: Planet | null = null;
  let pinned: FrontId | null = null;
  let first = true;
  let vis = 0;
  let time = 0;
  let maskR = 0;
  let hovered: string | null = null;
  const now = opts.now ?? (() => time);

  function activate(front: FrontId) {
    const p = galaxy.planet(front);
    if (!p) return;
    shown = front;
    planet = p;
    sim.reset(Math.floor(strHash(front) * 1e6) + 1);
    view.clear();
    fx.clear();
    labels.clear();
    p.inner.addChild(root);
    first = true;
    maskR = 0;
    vis = 0;
  }

  function deactivate() {
    root.parent?.removeChild(root);
    labels.clear();
    fx.clear();
    view.clear();
    shown = null;
    planet = null;
    hovered = null;
    hit.eventMode = 'none';
    vis = 0;
  }

  /** how far the camera has arrived at the planet (0 = overview / elsewhere … 1 = zoomed in) */
  function arrival(front: FrontId): number {
    const t = galaxy.cameraTarget(front);
    if (t.kind !== 'planet') return 0;
    const vp = renderer.viewport;
    const s1 = cameraFor(t, vp).scale;
    const s0 = cameraFor(galaxy.cameraTarget(null), vp).scale;
    const cam = renderer.camera;
    const zoom = s1 > s0 * 1.02 ? clamp((Math.log(cam.scale) - Math.log(s0)) / (Math.log(s1) - Math.log(s0)), 0, 1) : 1;
    const pan = clamp(1 - Math.hypot(cam.x - t.x, cam.y - t.y) / (t.r * 2.5), 0, 1);
    return Math.min(zoom, pan);
  }

  /** a point in the middle of a unit's territory at radius fraction rho (normalised), written to `out`; false if none */
  function homePoint(id: string, rho: number, out: { x: number; y: number }): boolean {
    if (!planet) return false;
    const ws = planet.wedges;
    let k = -1;
    for (let i = 0; i < ws.length && k < 0; i++) if (ws[i].id === id) k = i;
    if (k < 0) return false;
    let a: number;
    if (ws.length < 2) a = START_ANGLE + TAU / 2;
    else {
      const n = ws.length;
      // the territory's edges are frontlines k and k + 1 (planet.rangeAt without the tuple)
      a = (planet.borderAt(k, rho) + planet.borderAt((k + 1) % n, rho) + (k === n - 1 ? TAU : 0)) / 2;
    }
    out.x = Math.cos(a) * rho;
    out.y = Math.sin(a) * rho;
    return true;
  }
  const home = { x: 0, y: 0 };

  function select(e: FederatedPointerEvent, commit: boolean) {
    if (!planet || !shown) return;
    const R = planet.slot.r;
    const l = hit.toLocal(e.global);
    const nx = l.x / R;
    const ny = l.y / R;
    let slot = sim.pick(nx, ny, 0.06);
    if (slot < 0) slot = sim.sectorAt(nx, ny);
    const id = slot >= 0 ? sim.units.id[slot] : null;
    hovered = id;
    hit.cursor = id ? 'pointer' : 'default';
    if (commit && id) store.set({ selectedUnit: id });
  }
  hit.on('pointertap', (e) => select(e, true));
  hit.on('pointermove', (e) => select(e, false));
  hit.on('pointerout', () => (hovered = null));

  function syncUnits(p: Planet, budget: number, reduced: boolean) {
    const ws = p.wedges;
    let n = 0;
    for (const w of ws) {
      const u = (ins[n] ??= { id: '', s: 0, c: 0, presence: 0, fog: 0, hasSector: true });
      u.id = w.id;
      u.s = w.s;
      u.c = w.c;
      u.presence = w.presence;
      u.fog = w.fogBlend;
      u.hasSector = true;
      n++;
    }
    ins.length = n;
    syncOpts.instant = first;
    syncOpts.warp = !first && !reduced;
    sim.sync(ins, budget, syncOpts);
    // home sectors = the planet's territories, sampled along their animated frontlines
    const nw = ws.length;
    for (let k = 0; k < nw; k++) {
      const slot = sim.slotOf(ws[k].id);
      if (slot < 0) continue;
      color[slot] = hexColor(ws[k].color);
      const row = slot * (SECTOR_SAMPLES + 1) * 2;
      for (let j = 0; j <= SECTOR_SAMPLES; j++) {
        const rho = sectorRho(j);
        if (nw < 2) {
          sim.sectors[row + j * 2] = START_ANGLE;
          sim.sectors[row + j * 2 + 1] = START_ANGLE + TAU;
        } else {
          sim.sectors[row + j * 2] = p.borderAt(k, rho);
          sim.sectors[row + j * 2 + 1] = p.borderAt((k + 1) % nw, rho) + (k === nw - 1 ? TAU : 0);
        }
      }
    }
    for (let q = 0; q < sim.arrivals.n; q++) {
      const slot = sim.arrivals.slot[q];
      const id = sim.units.id[slot];
      if (!id || !homePoint(id, 0.6, home)) continue;
      sim.setWarp(slot, home.x, home.y, 0.9);
      // one flash for the whole warp-in: the beam's glow and the spark spray are bright only if it is granted
      const grant = flashes ? flashes.request(1, now()) : 0;
      fx.warp(home.x, home.y, color[slot], grant);
      view.burst(home.x, home.y, color[slot], 28, 240, 0.7, grant > 0);
    }
    first = false;
  }

  // per-frame views handed to the labels / effects / simulation, reused
  const lf: LabelFrame = { lang: 'ja', cx: 0, cy: 0, sr: 1, alpha: 0, compact: false, selected: null, hovered: null, screen: { w: 1, h: 1 }, dt: 0 };
  const selView = { x: 0, y: 0, color: 0, r: 0.13 };
  const fxView: FxView = { R: 1, px: 1, vis: 0, time: 0, reduced: false, selected: null };
  const syncOpts = { instant: false, warp: false };
  const stepOpts = { reduced: false };

  function updateLabels(p: Planet, dt: number, st: AppState, compact: boolean, scale: number) {
    labelList.length = 0;
    const u = sim.units;
    for (const w of p.wedges) {
      const slot = sim.slotOf(w.id);
      if (slot < 0 || u.alive[slot] < 3) continue;
      const l = (labelPool[labelList.length] ??= { id: '', name: '', rank: 0, s: 0, c: 0, color: 0, fog: 0, x: 0, y: 0, hx: 0, hy: 0, share: 0 });
      l.id = w.id;
      l.name = w.name;
      l.rank = w.rank;
      l.s = w.s;
      l.c = w.c;
      l.color = color[slot];
      l.fog = w.fog;
      l.x = u.cx[slot];
      l.y = u.cy[slot];
      l.share = w.share;
      const ok = homePoint(w.id, 0.72, home);
      l.hx = ok ? home.x : l.x;
      l.hy = ok ? home.y : l.y;
      labelList.push(l);
    }
    const c = renderer.worldToScreen(p.x, p.y);
    const scr = renderer.app.screen;
    lf.lang = st.lang;
    lf.cx = c.x;
    lf.cy = c.y;
    lf.sr = p.slot.r * scale;
    lf.alpha = vis;
    lf.compact = compact;
    lf.selected = st.selectedUnit;
    lf.hovered = hovered;
    lf.screen.w = scr.width;
    lf.screen.h = scr.height;
    lf.dt = dt;
    labels.update(labelList, lf);
  }

  return {
    get front() {
      return shown;
    },
    labels: labels.container,
    update(dt) {
      time += dt;
      const st = store.get();
      const want = pinned ?? st.front;
      if (want && !shown) activate(want);
      if (!shown || !planet) return;
      // switching planets: fade the old battle out first
      const target = want !== shown ? 0 : pinned ? 1 : smoothstep(0.45, 0.95, arrival(shown));
      vis = st.reducedMotion ? target : vis + (target - vis) * Math.min(1, dt * (target < vis ? 10 : 6));
      if (vis < 0.01 && want !== shown) {
        // faded out after leaving (or switching) the front: tear down, start the next one fresh
        deactivate();
        if (want) activate(want);
        return;
      }
      const p = planet;
      const R = p.slot.r;
      const cam = renderer.camera;
      const px = 1 / Math.max(1e-6, cam.scale);
      const compact = galaxy.layout.portrait || renderer.app.screen.width < 768;
      const reduced = st.reducedMotion;
      if (maskR !== R) {
        maskR = R;
        mask.clear().circle(0, 0, R * 0.995).fill(0xffffff);
        veil.clear().circle(0, 0, R).fill({ color: VEIL });
        hit.hitArea = new Circle(0, 0, R);
      }
      veil.alpha = VEIL_ALPHA * vis;

      const budget = Math.round((compact ? CAP_MOBILE : CAP_DESKTOP) * renderer.particleScale);
      syncUnits(p, budget, reduced);
      stepOpts.reduced = reduced;
      sim.step(dt, time, stepOpts);
      look.vis = vis;
      look.reduced = reduced;
      view.draw(sim, R, px, look, dt);

      const sel = st.selectedUnit ? sim.slotOf(st.selectedUnit) : -1;
      const u = sim.units;
      fxView.R = R;
      fxView.px = px;
      fxView.vis = vis;
      fxView.time = time;
      fxView.reduced = reduced;
      if (sel >= 0 && u.alive[sel] >= 3) {
        selView.x = u.cx[sel];
        selView.y = u.cy[sel];
        selView.color = color[sel];
        fxView.selected = selView;
      } else fxView.selected = null;
      fx.update(dt, fxView);
      updateLabels(p, dt, st, compact, cam.scale);
      // the overview's planet titles and territory names make way for the swarm labels
      galaxy.labels.alpha *= 1 - vis;

      hit.position.set(p.x, p.y);
      hit.eventMode = vis > 0.5 ? 'static' : 'none';
      if (hit.eventMode === 'none') hovered = null;
    },
    shockwave(unitId) {
      if (!shown || !planet || vis < 0.3) return false;
      const slot = sim.slotOf(unitId);
      const u = sim.units;
      if (slot < 0 || !u.present[slot]) return false;
      let x = u.cx[slot];
      let y = u.cy[slot];
      if (u.alive[slot] < 3) {
        if (!homePoint(unitId, 0.6, home)) return false;
        x = home.x;
        y = home.y;
      }
      // one flash for the whole shockwave (glow, rings, spark spray): denied → every part of it is dim
      const grant = flashes ? flashes.request(1, now()) : 0;
      fx.shock(x, y, color[slot], grant);
      if (!store.get().reducedMotion) {
        sim.shock(slot, x, y, 1);
        view.burst(x, y, color[slot], 48, 320, 0.9, grant > 0);
      }
      return true;
    },
    setPinned(front) {
      pinned = front;
    },
    refreshText() {
      labels.refresh();
    },
    destroy() {
      deactivate();
      hit.destroy();
      labels.destroy();
      fx.destroy();
      view.destroy();
      root.destroy({ children: true });
      tex.streak.destroy(true);
      tex.glow.destroy(true);
    },
  };
}
