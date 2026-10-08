/**
 * Pure org-highlight maths (no PixiJS): per-org brightness targets, the eased transitions between them, the
 * highlighted org's gentle pulse (one flash-budget grant per cycle) and which territory wedge a point on a
 * planet falls in (hover picking from the planet's own frontline maths — no per-pixel picking).
 */
import { CORE, TAU } from './layout';

/** the highlighted org's territories and fleets */
export const HOVER_GAIN = 1.6;
/** everyone else while an org is highlighted */
export const DIM_GAIN = 0.35;
/** transition time (s) */
export const FADE_S = 0.2;
/** a brightening the flash budget refuses is slowed to this, so fast hovering cannot strobe */
export const SLOW_FADE_S = 0.6;
/** pulse rate (≤ 1 Hz); a period longer than the budget's 1.2 s window keeps the pulse to one slot at a time */
export const PULSE_HZ = 0.8;
/** brightness swing of one pulse at full intensity (scaled by the granted intensity, ≤ 0.35) */
export const PULSE_DEPTH = 0.5;
/** the first pulse starts this far into a cycle-length delay (−0.4 cycle = 0.5 s after the highlight starts) */
export const PULSE_DELAY = 0.4;

export function emphasisTarget(org: string, hoverOrg: string | null): number {
  return hoverOrg === null ? 1 : org === hoverOrg ? HOVER_GAIN : DIM_GAIN;
}

export interface Tween {
  from: number;
  to: number;
  /** progress 0..1 */
  p: number;
  dur: number;
  value: number;
}

export function tween(value = 1): Tween {
  return { from: value, to: value, p: 1, dur: FADE_S, value };
}

/** start easing from the current value toward `to` over `dur` seconds (no-op when already heading there) */
export function retarget(tw: Tween, to: number, dur: number): void {
  if (to === tw.to) return;
  tw.from = tw.value;
  tw.to = to;
  tw.p = 0;
  tw.dur = Math.max(1e-3, dur);
}

/** advance by `dt` seconds (smoothstep ease) and return the value */
export function stepTween(tw: Tween, dt: number): number {
  if (tw.p < 1) {
    tw.p = Math.min(1, tw.p + Math.max(0, dt) / tw.dur);
    const e = tw.p * tw.p * (3 - 2 * tw.p);
    tw.value = tw.p >= 1 ? tw.to : tw.from + (tw.to - tw.from) * e;
  }
  return tw.value;
}

/** raised cosine: 0 → 1 → 0 over one cycle (phase 0..1) */
export function pulseWave(phase: number): number {
  return 0.5 - 0.5 * Math.cos(TAU * phase);
}

export interface Pulse {
  /** cycles; negative = waiting for the first cycle */
  phase: number;
  /** this cycle's granted swing */
  amp: number;
}

export function pulse(): Pulse {
  return { phase: -PULSE_DELAY, amp: 0 };
}

/**
 * Advance a pulse by `dt` s and return its extra brightness (0..amp). Every new cycle asks `grant()` for its swing
 * (route it through the flash budget: 0 = this cycle stays dark), so a pulse never costs more than one grant per cycle.
 */
export function stepPulse(p: Pulse, dt: number, grant: () => number): number {
  const next = p.phase + Math.max(0, dt) * PULSE_HZ;
  if (next >= 0 && (p.phase < 0 || Math.floor(next) > Math.floor(p.phase))) p.amp = Math.max(0, grant());
  p.phase = next >= 1 ? next % 1 : next;
  return p.phase < 0 ? 0 : p.amp * pulseWave(p.phase);
}

/**
 * Index of the territory wedge under the planet-local point (`x`, `y`) of a planet of radius `R` with `n` wedges,
 * where `rangeAt(k, rho)` is wedge k's current angular range at radius fraction rho (the planet's frontline maths,
 * wobble included). −1 over the core, beyond the rim, or when the planet has no territories.
 */
export function wedgeIndexAt(x: number, y: number, R: number, n: number, rangeAt: (k: number, rho: number) => readonly [number, number] | number[]): number {
  if (n <= 0 || !(R > 0)) return -1;
  const rho = Math.hypot(x, y) / R;
  if (!(rho >= CORE && rho <= 1)) return -1;
  if (n === 1) return 0;
  const th = Math.atan2(y, x);
  for (let k = 0; k < n; k++) {
    const r = rangeAt(k, rho);
    const a0 = r[0];
    const span = r[1] - a0;
    if (!(span > 0)) continue;
    let a = (th - a0) % TAU;
    if (a < 0) a += TAU;
    if (a < span) return k;
  }
  return -1;
}
