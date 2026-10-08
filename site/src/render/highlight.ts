/**
 * Org highlight (mockup B): while `state.hoverOrg` is set, that org's territories on every planet — and its
 * fleets — brighten (× 1.6) with a gentle ≤ 1 Hz pulse, everyone else dims to 35 %; 200 ms eased transitions.
 * Each pulse cycle and each brightening transition asks the app's flash budget first (a refused pulse stays
 * dark, a refused brightening runs slower), so hovering can never strobe. Reduced motion: no pulse.
 *
 * The lit look itself (additive tint + bright edge over the org's wedges) is ./highlightOverlay.
 *
 * Also makes the territories hoverable: moving a mouse / pen over a planet sets `hoverOrg` to the org of the
 * wedge under it (picked with the planet's own frontline maths, `rangeAt`), leaving clears it.
 */
import { Point, type FederatedPointerEvent } from 'pixi.js';
import type { World } from '../data/types';
import type { FlashBudget } from '../fx/flashBudget';
import type { AppState, Store } from '../state/store';
import type { Fleets } from './fleets';
import type { Galaxy } from './galaxy';
import type { Planet } from './planet';
import { DIM_GAIN, FADE_S, HOVER_GAIN, PULSE_DEPTH, SLOW_FADE_S, emphasisTarget, pulse, retarget, stepPulse, stepTween, tween, wedgeIndexAt, type Tween } from './emphasis';
import { createHighlightOverlay } from './highlightOverlay';

export interface HighlightOptions {
  world: World;
  store: Store<AppState>;
  /** the app-wide flash limiter (shares the galaxy's clock) */
  flashes?: Pick<FlashBudget, 'request'> | null;
  /** fleets to brighten / dim with their org */
  fleets?: Pick<Fleets, 'setEmphasis'> | null;
}

export interface Highlight {
  /** advance the transitions and the pulse; call once per frame */
  update(dt: number): void;
  /** current brightness multiplier of an org (1 while nothing is highlighted) */
  level(org: string): number;
  destroy(): void;
}

/** intensity used when no flash budget is wired (the budget's own cap) */
const DEFAULT_INTENSITY = 0.35;

export function createHighlight(galaxy: Galaxy, opts: HighlightOptions): Highlight {
  const { world, store } = opts;
  const flashes = opts.flashes ?? null;
  const fleets = opts.fleets ?? null;
  const orgIds = [...new Set([...Object.keys(world.orgs), ...Object.values(world.units).flatMap((u) => Object.values(u).map((x) => x.org))])];
  const tweens: Tween[] = orgIds.map(() => tween());
  const byOrg = new Map<string, Tween>(orgIds.map((o, i) => [o, tweens[i]]));
  /** orgs the world does not list follow "everyone else" */
  const others = tween();
  const pl = pulse();
  let hovered: string | null = null;
  let pulseMul = 1;
  let active = false;
  const planets = world.fronts.map((f) => galaxy.planet(f.id)).filter((p): p is Planet => p !== null);
  const overlay = createHighlightOverlay(galaxy, planets);
  /** 0..1: how far an org has risen toward the highlight level */
  const rise = (org: string): number => {
    const t = byOrg.get(org);
    return t ? Math.min(1, Math.max(0, (t.value - 1) / (HOVER_GAIN - 1))) : 0;
  };

  const level = (org: string): number => {
    const t = byOrg.get(org) ?? others;
    return org === hovered ? t.value * pulseMul : t.value;
  };
  const grant = () => (store.get().reducedMotion ? 0 : (flashes ? flashes.request(1, galaxy.time) : DEFAULT_INTENSITY) * PULSE_DEPTH);

  function retargetAll(hoverOrg: string | null) {
    const h = hoverOrg !== null && byOrg.has(hoverOrg) ? hoverOrg : null;
    if (h === hovered) return;
    // every change brightens something (the new org, or everyone coming back): one budget request per change
    const fast = flashes ? flashes.request(1, galaxy.time) > 0 : true;
    orgIds.forEach((org, i) => {
      const t = tweens[i];
      const to = emphasisTarget(org, h);
      retarget(t, to, to > t.value && !fast ? SLOW_FADE_S : FADE_S);
    });
    const to = h === null ? 1 : DIM_GAIN;
    retarget(others, to, to > others.value && !fast ? SLOW_FADE_S : FADE_S);
    hovered = h;
    Object.assign(pl, pulse());
  }

  // ---- territory hover → hoverOrg
  const pt = new Point();
  let wedgeOrg: string | null = null;
  function setWedgeOrg(org: string | null) {
    if (org === wedgeOrg) return;
    const prev = wedgeOrg;
    wedgeOrg = org;
    if (org !== null) store.set({ hoverOrg: org });
    else if (store.get().hoverOrg === prev) store.set({ hoverOrg: null });
  }
  const offs: (() => void)[] = [];
  for (const f of world.fronts) {
    const p = galaxy.planet(f.id);
    if (!p) continue;
    const move = (e: FederatedPointerEvent) => {
      if (e.pointerType === 'touch') return;
      e.getLocalPosition(p.root, pt);
      const k = wedgeIndexAt(pt.x, pt.y, p.slot.r, p.wedges.length, p.rangeAt);
      setWedgeOrg(k >= 0 ? p.wedges[k].org : null);
    };
    const out = () => setWedgeOrg(null);
    p.root.on('pointermove', move);
    p.root.on('pointerout', out);
    offs.push(() => {
      p.root.off('pointermove', move);
      p.root.off('pointerout', out);
    });
  }

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.hoverOrg !== prev.hoverOrg) retargetAll(s.hoverOrg);
  });
  retargetAll(store.get().hoverOrg);

  return {
    update(dt) {
      stepTween(others, dt);
      let settled = others.p >= 1 && others.value === 1;
      let moving = others.p < 1;
      for (let i = 0; i < tweens.length; i++) {
        const t = tweens[i];
        stepTween(t, dt);
        if (t.p < 1) moving = true;
        if (t.p < 1 || t.value !== 1) settled = false;
      }
      pulseMul = hovered !== null ? 1 + stepPulse(pl, dt, grant) : 1;
      const want = hovered !== null || !settled;
      if (want || active) overlay.update(dt, rise, (pulseMul - 1) / (DEFAULT_INTENSITY * PULSE_DEPTH), moving || !want);
      if (want !== active) {
        active = want;
        galaxy.setEmphasis(want ? level : null);
        fleets?.setEmphasis(want ? level : null);
      }
    },
    level,
    destroy() {
      unsubscribe();
      for (const off of offs) off();
      overlay.destroy();
      if (active) {
        galaxy.setEmphasis(null);
        fleets?.setEmphasis(null);
      }
    },
  };
}
