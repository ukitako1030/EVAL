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
    const carry = CARRY_MONTHS;
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
    let r = new Map(covered.map((u) => [u, 1 / covered.length]));
    for (let i = 0; i < 50; i++) r = meanMaps(baseSignals.map((s) => implied(r, sigShare.get(s))), covered);
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
