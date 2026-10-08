import type { FrontId, Observation, ValueKind } from '../core/types';
import { addMonths, daysBetween, monthEnd, toMonth, type Month } from '../core/months';
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
}

export interface AssignParams {
  snapshotMaxAgeDays: number;
  releaseActiveMonths: number;
}

export function matchUnit(units: CompiledUnit[], obs: { model: string; org?: string }): CompiledUnit | null {
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

/** All observations must belong to ONE series (same series id, kind, dateKind). */
export function assignSeries(args: {
  front: FrontId;
  group: string;
  priority: number;
  observations: Observation[];
  units: CompiledUnit[];
  months: Month[];
  releases: CompiledRelease[];
  params: AssignParams;
}): SeriesTable {
  const obs = args.observations;
  if (!obs.length) throw new Error('assignSeries: empty observations');
  const first = obs[0];
  const table: SeriesTable = {
    front: args.front,
    group: args.group,
    series: first.series,
    priority: args.priority,
    kind: first.kind,
    points: new Map(),
  };
  const unitById = new Map(args.units.map((u) => [u.id, u]));
  const byUnit = new Map<string, Observation[]>();
  for (const o of obs) {
    const u = matchUnit(args.units, o);
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
    for (const [unitId, list] of byUnit) {
      const u = unitById.get(unitId)!;
      const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
      for (const m of args.months) {
        if (m < firstMonth || m > lastActive || !unitExists(u, m)) continue;
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
      if (daysBetween(snap, end) > args.params.snapshotMaxAgeDays) continue;
      for (const [unitId, o] of bestAt.get(snap) ?? new Map<string, Observation>()) {
        if (unitExists(unitById.get(unitId)!, m)) put(unitId, m, { value: o.value, model: o.model, reconstructed: false });
      }
      continue;
    }
    // m is before the first snapshot → reconstruct from the first snapshot using release months
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
