import { addMonths, type Month } from '../core/months';
import { sum, trailingMean } from '../core/math';
import type { Method } from '../config/schemas';
import type { SignalTable } from './signals';

export type ScaleMethod = Method['scale'];

/** A missing signal value is taken from up to this many previous months (monthly sources lag the current month). */
const CARRY_MONTHS = 2;

function valueAt(byMonth: Map<Month, number> | undefined, m: Month, carry: number): number | undefined {
  if (!byMonth) return undefined;
  for (let k = 0; k <= carry; k++) {
    const v = byMonth.get(addMonths(m, -k));
    if (v != null) return v;
  }
  return undefined;
}

export interface ScaleCell {
  /** share 0–100 within the front */
  c: number;
  /** number of components with data for this unit this month */
  components: number;
}

function normalise(m: Map<string, number>): Map<string, number> {
  const tot = sum(m.values());
  return new Map([...m].map(([k, v]) => [k, tot > 0 ? v / tot : 0]));
}

/** A signal spreads only the reference mass of the units it covers: implied(u) = M·share(u) if covered, else ref(u). */
function implied(ref: Map<string, number>, share: Map<string, number> | undefined): Map<string, number> {
  if (!share) return ref;
  const mass = sum([...share.keys()].map((u) => ref.get(u) ?? 0));
  return new Map([...ref].map(([u, r]) => [u, share.has(u) ? mass * share.get(u)! : r]));
}

/** Convergence threshold (max absolute change of any unit's mass per iteration) and iteration cap of {@link baseFixedPoint}. */
const BASE_TOLERANCE = 1e-12;
const BASE_MAX_ITERATIONS = 100_000;

/**
 * Fixed point of  r = mean over the base signals of implied(r, signal)  on the `covered` units, starting from the uniform
 * distribution and iterating until max |r' − r| < 1e-12 (or 100 000 iterations, with a warning). Returns shares summing to 1.
 *
 * Disconnected coverage: group the units into connected components, where two units are connected if some base signal covers
 * both. A signal only redistributes mass among the units it covers, so every iteration preserves the total mass of each
 * component; together with the uniform start (1/n per unit) this means that each component's total mass is PROPORTIONAL TO
 * ITS NUMBER OF UNITS, and the signals only decide how that mass is split inside the component. Two base signals that share
 * no unit therefore say nothing about their relative sizes, and no signal is allowed to inflate the units it covers
 * (a one-unit component keeps 1/n, a 3-unit component keeps 3/n). Inside a component the fixed point is unique and the
 * iteration converges to it, however weakly the signals overlap.
 */
export function baseFixedPoint(
  covered: string[],
  signals: Map<string, number>[],
  opts: { maxIter?: number; tol?: number; onWarn?: (msg: string) => void } = {},
): Map<string, number> {
  const maxIter = opts.maxIter ?? BASE_MAX_ITERATIONS;
  const tol = opts.tol ?? BASE_TOLERANCE;
  const n = covered.length;
  const index = new Map(covered.map((u, i) => [u, i]));
  // per signal: indices and shares (0–1) of the covered units it knows
  const sig = signals.map((m) => {
    const idx: number[] = [];
    const sh: number[] = [];
    for (const [u, v] of m) {
      const i = index.get(u);
      if (i != null) {
        idx.push(i);
        sh.push(v);
      }
    }
    const covers = new Uint8Array(n);
    for (const i of idx) covers[i] = 1;
    return { idx, sh, covers };
  });
  let r = new Float64Array(n).fill(1 / n);
  let next = new Float64Array(n);
  let converged = false;
  let iterations = 0;
  while (iterations < maxIter) {
    iterations++;
    next.fill(0);
    for (const { idx, sh, covers } of sig) {
      let mass = 0;
      for (const i of idx) mass += r[i];
      // a signal spreads the mass of the units it covers and leaves the other units as they are
      for (let k = 0; k < idx.length; k++) next[idx[k]] += mass * sh[k];
      for (let i = 0; i < n; i++) if (!covers[i]) next[i] += r[i];
    }
    let delta = 0;
    for (let i = 0; i < n; i++) {
      next[i] /= sig.length;
      delta = Math.max(delta, Math.abs(next[i] - r[i]));
    }
    [r, next] = [next, r];
    if (delta < tol) {
      converged = true;
      break;
    }
  }
  if (!converged) {
    (opts.onWarn ?? console.warn)(
      `scale: base fixed point did not converge after ${iterations} iterations (${n} units, ${signals.length} signals); using the last iterate`,
    );
  }
  return new Map(covered.map((u, i) => [u, r[i]]));
}

function meanMaps(maps: Map<string, number>[], keys: string[]): Map<string, number> {
  return new Map(keys.map((u) => [u, sum(maps.map((m) => m.get(u) ?? 0)) / maps.length]));
}

/** Unsmoothed shares (0–1) for one month. */
export function scaleMonth(
  present: string[],
  m: Month,
  signals: SignalTable,
  method: ScaleMethod,
): Map<string, { share: number; components: number }> {
  // signal shares among the present units that have the signal
  const sigShare = new Map<string, Map<string, number>>();
  for (const [sig, byUnit] of signals) {
    // announcements are already interpolated/staled per month upstream; carrying them would revive dropped values
    const carry = sig === 'announcements' ? 0 : CARRY_MONTHS;
    const vals = new Map<string, number>();
    for (const u of present) {
      const v = valueAt(byUnit.get(u), m, carry);
      if (v != null && v > 0) vals.set(u, v);
    }
    if (vals.size) sigShare.set(sig, normalise(vals));
  }
  // base: fixed point of r = mean over base signals of implied(r, signal) on the units covered by any base signal
  const baseSignals = [
    ...new Set(method.base.flatMap((b) => method.components[b].signals)),
  ].filter((s) => sigShare.has(s));
  const covered = present.filter((u) => baseSignals.some((s) => sigShare.get(s)!.has(u)));
  let base: Map<string, number>;
  if (!covered.length) {
    base = new Map(present.map((u) => [u, 1 / present.length]));
  } else {
    const r = baseFixedPoint(covered, baseSignals.map((s) => sigShare.get(s)!));
    const floor = Math.min(...r.values()) * method.floorFactor;
    base = normalise(new Map(present.map((u) => [u, r.get(u) ?? floor])));
  }
  // each component: every signal spreads the base mass of the units it covers; signals are averaged; components are weighted
  const combined = new Map(present.map((u) => [u, 0]));
  for (const c of Object.values(method.components)) {
    const maps = c.signals.filter((s) => sigShare.has(s)).map((s) => implied(base, sigShare.get(s)));
    const impliedC = maps.length ? meanMaps(maps, present) : base;
    for (const u of present) combined.set(u, combined.get(u)! + c.weight * impliedC.get(u)!);
  }
  const shares = normalise(combined);
  const out = new Map<string, { share: number; components: number }>();
  for (const u of present) {
    const components = Object.values(method.components).filter((c) => c.signals.some((s) => sigShare.get(s)?.has(u))).length;
    out.set(u, { share: shares.get(u)!, components });
  }
  return out;
}

export function computeScale(args: {
  unitIds: string[];
  months: Month[];
  exists: (unitId: string, m: Month) => boolean;
  signals: SignalTable;
  method: ScaleMethod;
}): Map<string, Map<Month, ScaleCell | null>> {
  const raw = args.months.map((m) => {
    const present = args.unitIds.filter((u) => args.exists(u, m));
    return present.length ? scaleMonth(present, m, args.signals, args.method) : new Map<string, { share: number; components: number }>();
  });
  const smoothed = new Map<string, (number | null)[]>();
  for (const u of args.unitIds) {
    smoothed.set(u, trailingMean(raw.map((r) => r.get(u)?.share ?? null), args.method.smoothingMonths));
  }
  const out = new Map<string, Map<Month, ScaleCell | null>>(args.unitIds.map((u) => [u, new Map()]));
  args.months.forEach((m, i) => {
    const tot = sum(args.unitIds.map((u) => smoothed.get(u)![i] ?? 0));
    for (const u of args.unitIds) {
      const v = smoothed.get(u)![i];
      out.get(u)!.set(m, v == null ? null : { c: tot > 0 ? (100 * v) / tot : 0, components: raw[i].get(u)!.components });
    }
  });
  return out;
}
