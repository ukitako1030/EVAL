import { addMonths, type Month } from '../core/months';
import { sum, trailingMean } from '../core/math';
import type { Method } from '../config/schemas';
import type { SignalTable } from './signals';

export type ScaleMethod = Method['scale'];

/** A missing signal value is taken from up to this many previous months (monthly sources lag the current month). */
const CARRY_MONTHS = 2;

function valueAt(byMonth: Map<Month, number> | undefined, m: Month): number | undefined {
  if (!byMonth) return undefined;
  for (let k = 0; k <= CARRY_MONTHS; k++) {
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

/** Unsmoothed shares (0–1) for one month. */
export function scaleMonth(
  present: string[],
  m: Month,
  signals: SignalTable,
  method: ScaleMethod,
): Map<string, { share: number; components: number }> {
  // signal shares among units having the signal
  const sigShare = new Map<string, Map<string, number>>();
  for (const [sig, byUnit] of signals) {
    const vals = new Map<string, number>();
    for (const u of present) {
      const v = valueAt(byUnit.get(u), m);
      if (v != null && v > 0) vals.set(u, v);
    }
    if (vals.size) sigShare.set(sig, normalise(vals));
  }
  // component shares, normalised within S_c
  const comp = new Map<string, Map<string, number>>();
  for (const [cid, c] of Object.entries(method.components)) {
    const acc = new Map<string, number[]>();
    for (const sig of c.signals) {
      for (const [u, v] of sigShare.get(sig) ?? []) {
        if (!acc.has(u)) acc.set(u, []);
        acc.get(u)!.push(v);
      }
    }
    if (acc.size) comp.set(cid, normalise(new Map([...acc].map(([u, vs]) => [u, sum(vs) / vs.length]))));
  }
  // base
  const baseRaw = new Map<string, number>();
  for (const u of present) {
    const vs = method.base.map((b) => comp.get(b)?.get(u)).filter((v): v is number => v != null);
    if (vs.length) baseRaw.set(u, sum(vs) / vs.length);
  }
  let base: Map<string, number>;
  if (!baseRaw.size) {
    base = new Map(present.map((u) => [u, 1 / present.length]));
  } else {
    const nb = normalise(baseRaw);
    const floor = Math.min(...nb.values()) * method.floorFactor;
    for (const u of present) if (!nb.has(u)) nb.set(u, floor);
    base = normalise(nb);
  }
  // implied per component, combined
  const combined = new Map(present.map((u) => [u, 0]));
  for (const [cid, c] of Object.entries(method.components)) {
    const sh = comp.get(cid);
    const mass = sh ? sum([...sh.keys()].map((u) => base.get(u) ?? 0)) : 0;
    for (const u of present) {
      const implied = sh?.has(u) ? mass * sh.get(u)! : base.get(u)!;
      combined.set(u, combined.get(u)! + c.weight * implied);
    }
  }
  const shares = normalise(combined);
  const out = new Map<string, { share: number; components: number }>();
  for (const u of present) {
    const components = Object.keys(method.components).filter((cid) => comp.get(cid)?.has(u)).length;
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
