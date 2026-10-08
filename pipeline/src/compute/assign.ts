import type { FrontId, Observation, ValueKind } from '../core/types';
import { addMonths, daysBetween, monthDiff, monthEnd, toMonth, type Month } from '../core/months';
import type { CompiledRelease, CompiledUnit } from '../config/load';

export interface AssignedPoint {
  value: number;
  model: string;
  reconstructed: boolean;
}

export interface SeriesTable {
  front: FrontId;
  group: string;
  series: string;
  priority: number;
  kind: ValueKind;
  /** unitId → month → point */
  points: Map<string, Map<Month, AssignedPoint>>;
  /**
   * month → freshness in (0, 1]: 1 while the series is active (release type) or its latest snapshot is fresh (snapshot type,
   * also for reconstructed months), then 1 − k/(fadeMonths+1) in the k-th month after that limit. Months without an entry
   * have no points.
   */
  freshness: Map<Month, number>;
}

export interface AssignParams {
  snapshotMaxAgeDays: number;
  releaseActiveMonths: number;
  /** a stale series keeps contributing for this many months, with linearly decreasing freshness (0 = cut off at once) */
  fadeMonths: number;
}

/** Freshness of the k-th month after a series' fresh limit (k ≤ 0: still fresh). 0 means the series no longer contributes. */
export function fadeFreshness(k: number, fadeMonths: number): number {
  return k <= 0 ? 1 : Math.max(0, 1 - k / (fadeMonths + 1));
}

/** The last month whose end is at most `maxAgeDays` after the snapshot date (the month before the snapshot's own month if none). */
function lastFreshMonth(snap: string, maxAgeDays: number): Month {
  let m = addMonths(toMonth(snap), -1);
  while (daysBetween(snap, monthEnd(addMonths(m, 1))) <= maxAgeDays) m = addMonths(m, 1);
  return m;
}

/**
 * The first unit whose model regex (and org regex, when the source reports an org) matches, or null.
 * A model matching any `exclude` regex (units.yaml `exclude`: third-party fine-tunes, multi-model rows) is never assigned.
 */
export function matchUnit(units: CompiledUnit[], obs: { model: string; org?: string }, exclude: RegExp[] = []): CompiledUnit | null {
  if (exclude.some((r) => r.test(obs.model))) return null;
  for (const u of units) {
    // orgMatch only applies when the source tells us the org (several sources don't; Arena has '' for legacy rows)
    if (u.orgRegex && obs.org && !u.orgRegex.test(obs.org)) continue;
    if (u.regexes.some((r) => r.test(obs.model))) return u;
  }
  return null;
}

export function unitExists(u: Pick<CompiledUnit, 'since' | 'until'>, m: Month): boolean {
  return m >= u.since && (!u.until || m <= u.until);
}

export function releaseOf(releases: CompiledRelease[], model: string): CompiledRelease | null {
  for (const r of releases) if (r.regex.test(model)) return r;
  return null;
}

/**
 * All observations must belong to ONE series (same series id, kind, dateKind) or this throws.
 * Observations with a non-finite value are dropped (with one warning; if none remain the table is empty);
 * dates are normalised to YYYY-MM-DD.
 */
export function assignSeries(args: {
  front: FrontId;
  group: string;
  priority: number;
  observations: Observation[];
  units: CompiledUnit[];
  months: Month[];
  releases: CompiledRelease[];
  params: AssignParams;
  /** units.yaml `exclude`: models matching any of these are assigned to no unit (default none) */
  exclude?: RegExp[];
}): SeriesTable {
  if (!args.observations.length) throw new Error('assignSeries: empty observations');
  const finite = args.observations.filter((o) => Number.isFinite(o.value));
  const dropped = args.observations.length - finite.length;
  if (dropped > 0) {
    console.warn(`assignSeries: dropped ${dropped} observation(s) with non-finite value in series "${args.observations[0].series}"`);
  }
  if (!finite.length) {
    // one broken source must not crash the whole computation: contribute nothing
    const f = args.observations[0];
    return { front: args.front, group: args.group, series: f.series, priority: args.priority, kind: f.kind, points: new Map(), freshness: new Map() };
  }
  // a time part ("2024-05-31T12:00:00Z") must not push a row out of its month
  const obs = finite.map((o) => ({ ...o, date: o.date.slice(0, 10) }));
  const first = obs[0];
  const mixed = obs.find((o) => o.series !== first.series || o.kind !== first.kind || o.dateKind !== first.dateKind);
  if (mixed) {
    throw new Error(
      `assignSeries: mixed series/kind/dateKind (expected ${first.series}/${first.kind}/${first.dateKind}, got ${mixed.series}/${mixed.kind}/${mixed.dateKind} for model "${mixed.model}")`,
    );
  }
  const table: SeriesTable = {
    front: args.front,
    group: args.group,
    series: first.series,
    priority: args.priority,
    kind: first.kind,
    points: new Map(),
    freshness: new Map(),
  };
  const fade = args.params.fadeMonths;
  const unitById = new Map(args.units.map((u) => [u.id, u]));
  const byUnit = new Map<string, Observation[]>();
  for (const o of obs) {
    const u = matchUnit(args.units, o, args.exclude ?? []);
    if (!u) continue;
    if (!byUnit.has(u.id)) byUnit.set(u.id, []);
    byUnit.get(u.id)!.push(o);
  }
  const put = (unitId: string, m: Month, p: AssignedPoint) => {
    if (!table.points.has(unitId)) table.points.set(unitId, new Map());
    table.points.get(unitId)!.set(m, p);
  };

  if (first.dateKind === 'release') {
    const dates = obs.map((o) => o.date).sort();
    const firstMonth = toMonth(dates[0]);
    const lastActive = addMonths(toMonth(dates[dates.length - 1]), args.params.releaseActiveMonths);
    for (const m of args.months) {
      if (m < firstMonth) continue;
      const f = fadeFreshness(monthDiff(lastActive, m), fade);
      if (f > 0) table.freshness.set(m, f);
    }
    for (const [unitId, list] of byUnit) {
      const u = unitById.get(unitId)!;
      const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
      for (const m of args.months) {
        if (!table.freshness.has(m) || !unitExists(u, m)) continue;
        const end = monthEnd(m);
        let best: Observation | null = null;
        for (const o of sorted) {
          if (o.date > end) break;
          if (!best || o.value > best.value) best = o;
        }
        if (best) put(unitId, m, { value: best.value, model: best.model, reconstructed: false });
      }
    }
    return table;
  }

  // snapshot type
  const snapDates = [...new Set(obs.map((o) => o.date))].sort();
  const bestAt = new Map<string, Map<string, Observation>>(); // date → unitId → best obs
  for (const [unitId, list] of byUnit) {
    for (const o of list) {
      if (!bestAt.has(o.date)) bestAt.set(o.date, new Map());
      const cur = bestAt.get(o.date)!.get(unitId);
      if (!cur || o.value > cur.value) bestAt.get(o.date)!.set(unitId, o);
    }
  }
  const firstSnap = snapDates[0];
  for (const m of args.months) {
    const end = monthEnd(m);
    let snap: string | null = null;
    for (const d of snapDates) {
      if (d <= end) snap = d;
      else break;
    }
    if (snap) {
      const fresh = daysBetween(snap, end) <= args.params.snapshotMaxAgeDays;
      const f = fresh ? 1 : fadeFreshness(monthDiff(lastFreshMonth(snap, args.params.snapshotMaxAgeDays), m), fade);
      if (f <= 0) continue;
      table.freshness.set(m, f);
      for (const [unitId, o] of bestAt.get(snap) ?? new Map<string, Observation>()) {
        if (unitExists(unitById.get(unitId)!, m)) put(unitId, m, { value: o.value, model: o.model, reconstructed: false });
      }
      continue;
    }
    // m is before the first snapshot → reconstruct from the first snapshot using release months
    table.freshness.set(m, 1);
    for (const [unitId, list] of byUnit) {
      const u = unitById.get(unitId)!;
      if (!unitExists(u, m)) continue;
      let best: Observation | null = null;
      for (const o of list) {
        if (o.date !== firstSnap) continue;
        const rel = releaseOf(args.releases, o.model);
        if (!rel || rel.release > m) continue;
        if (!best || o.value > best.value) best = o;
      }
      if (best) put(unitId, m, { value: best.value, model: best.model, reconstructed: true });
    }
  }
  return table;
}

/** Splits a source's observations by series id. */
export function bySeries(obs: Observation[]): Map<string, Observation[]> {
  const out = new Map<string, Observation[]>();
  for (const o of obs) {
    if (!out.has(o.series)) out.set(o.series, []);
    out.get(o.series)!.push(o);
  }
  return out;
}
