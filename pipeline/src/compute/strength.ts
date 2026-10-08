import type { ValueKind } from '../core/types';
import { monthDiff, type Month } from '../core/months';
import { clamp, logit, sigmoid, weightedMean } from '../core/math';
import type { KindParams } from '../config/schemas';
import type { SeriesTable } from './assign';

export interface GroupScore {
  group: string;
  score: number;
  /** effective weight: configured group weight × freshness of the freshest series that scored the unit (see computeStrength) */
  weight: number;
  reconstructed: boolean;
  model: string;
}

export interface StrengthCell {
  s: number | null;
  /** number of groups contributing measured (non-reconstructed) data */
  measured: number;
  /** number of groups contributing reconstructed data */
  reconstructed: number;
  /** true when s was filled by fillEstimatedStrength */
  estimated: boolean;
  /** sorted by weight desc */
  breakdown: GroupScore[];
  /** model of the highest-weight group (used for new_model events) */
  bestModel: string | null;
}

/** Expected win probability of x against the month's leader (spec §6.1-2). */
export function winProb(kind: ValueKind, x: number, lead: number, k: KindParams): number {
  switch (kind) {
    case 'elo':
      return 1 / (1 + 10 ** ((lead - x) / k.elo.scale));
    case 'percent': {
      const c = (v: number) => clamp(v, k.percent.clampLo, k.percent.clampHi) / 100;
      return sigmoid((k.percent.scale ?? 1) * (logit(c(x)) - logit(c(lead))));
    }
    case 'minutes':
      return sigmoid(k.minutes.kappa * (Math.log2(Math.max(x, 1e-6)) - Math.log2(Math.max(lead, 1e-6))));
    case 'eci':
      return sigmoid((x - lead) / k.eci.tau);
  }
}

interface UnitSeriesScore {
  score: number;
  reconstructed: boolean;
  model: string;
}

/**
 * Per month: every series scores its units against the series leader; per group, the series used are the highest-priority
 * ones with measured data (any data if none is measured), where a fully fresh series beats a fading one of higher priority
 * (assign.ts freshness). For each unit, the hits of the chosen series are averaged weighted by freshness, and the group's
 * effective weight is its configured weight × the freshness of the freshest of those hits — so a source that stops
 * publishing fades out of the weighted mean over `fadeMonths` instead of dropping out at once.
 */
export function computeStrength(args: {
  tables: SeriesTable[];
  unitIds: string[];
  months: Month[];
  weights: Record<string, number>;
  kinds: KindParams;
  minUnits: number;
}): Map<string, Map<Month, StrengthCell>> {
  const out = new Map<string, Map<Month, StrengthCell>>(args.unitIds.map((id) => [id, new Map()]));
  for (const m of args.months) {
    // 1) per-series scores relative to the series leader
    const perSeries: { table: SeriesTable; fresh: number; scores: Map<string, UnitSeriesScore> }[] = [];
    for (const t of args.tables) {
      const present: [string, { value: number; model: string; reconstructed: boolean }][] = [];
      for (const [uid, byMonth] of t.points) {
        const p = byMonth.get(m);
        if (p) present.push([uid, p]);
      }
      if (present.length < args.minUnits) continue;
      const lead = Math.max(...present.map(([, p]) => p.value));
      const scores = new Map<string, UnitSeriesScore>();
      for (const [uid, p] of present) {
        scores.set(uid, { score: 200 * winProb(t.kind, p.value, lead, args.kinds), reconstructed: p.reconstructed, model: p.model });
      }
      // a series without a freshness entry for a month that has points counts as fully fresh
      perSeries.push({ table: t, fresh: t.freshness.get(m) ?? 1, scores });
    }
    // 2) per group: highest-priority series with measured data (any data if none is measured; a fresh series beats a
    //    fading one of higher priority), ties blended by freshness
    const groups = new Map<string, typeof perSeries>();
    for (const s of perSeries) {
      if (!groups.has(s.table.group)) groups.set(s.table.group, []);
      groups.get(s.table.group)!.push(s);
    }
    const unitGroups = new Map<string, GroupScore[]>();
    for (const [group, list] of groups) {
      const weight = args.weights[group] ?? 0;
      if (weight <= 0) continue;
      // a series that is only reconstructed this month must neither be averaged with nor override a measured one
      const hasMeasured = (s: (typeof perSeries)[number]) => [...s.scores.values()].some((h) => !h.reconstructed);
      const pool = list.some(hasMeasured) ? list.filter(hasMeasured) : list;
      // a stale (fading) series must not override a fresh one, e.g. the frozen arena-legacy snapshots vs current Arena data
      const freshPool = pool.filter((s) => s.fresh >= 1);
      const maxP = Math.max(...(freshPool.length ? freshPool : pool).map((s) => s.table.priority));
      const top = pool.filter((s) => s.table.priority === maxP);
      const ids = new Set(top.flatMap((s) => [...s.scores.keys()]));
      for (const uid of ids) {
        const hits = top.flatMap((s) => {
          const h = s.scores.get(uid);
          return h ? [{ ...h, fresh: s.fresh }] : [];
        });
        const totalFresh = hits.reduce((a, h) => a + h.fresh, 0);
        const score = hits.reduce((a, h) => a + h.fresh * h.score, 0) / totalFresh;
        const freshest = hits.reduce((best, h) => (h.fresh > best.fresh ? h : best));
        if (!unitGroups.has(uid)) unitGroups.set(uid, []);
        unitGroups.get(uid)!.push({
          group,
          score,
          weight: weight * freshest.fresh,
          reconstructed: hits.every((h) => h.reconstructed),
          model: freshest.model,
        });
      }
    }
    // 3) weighted combination
    for (const uid of args.unitIds) {
      const gs = (unitGroups.get(uid) ?? []).sort((a, b) => b.weight - a.weight || a.group.localeCompare(b.group));
      out.get(uid)!.set(m, {
        s: weightedMean(gs.map((g) => ({ value: g.score, weight: g.weight }))),
        measured: gs.filter((g) => !g.reconstructed).length,
        reconstructed: gs.filter((g) => g.reconstructed).length,
        estimated: false,
        breakdown: gs,
        bestModel: gs[0]?.model ?? null,
      });
    }
  }
  return out;
}

/** How long a unit's last measured strength is carried through a data gap before the neighbour/rank rules apply. */
const CARRY_STRENGTH_MONTHS = 6;

/** Spec §6.1-7: fill s for existing units that have no strength data. Mutates `cells`. */
export function fillEstimatedStrength(args: {
  cells: Map<string, Map<Month, StrengthCell>>;
  /** unitId → month → scale share (0–100) */
  shares: Map<string, Map<Month, number | null>>;
  months: Month[];
  exists: (unitId: string, m: Month) => boolean;
  floor: number;
  step: number;
}): void {
  const ids = [...args.cells.keys()];
  const share = (u: string, m: Month) => args.shares.get(u)?.get(m) ?? 0;
  /** last month each unit had a measured or reconstructed value (estimated values never refresh it) */
  const lastKnown = new Map<string, { s: number; month: Month }>();
  for (const m of args.months) {
    const present = ids.filter((u) => args.exists(u, m));
    const cell = (u: string) => args.cells.get(u)!.get(m);
    const measured = present.filter((u) => cell(u)?.s != null);
    for (const u of measured) lastKnown.set(u, { s: cell(u)!.s!, month: m });
    const missing = present.filter((u) => cell(u)?.s == null);
    if (!missing.length) continue;
    const estimates = new Map<string, number>();
    // a unit that was measured recently keeps its last value (avoids jumping to a neighbour's value during a data gap)
    const fresh: string[] = [];
    for (const u of missing) {
      const k = lastKnown.get(u);
      if (k && monthDiff(k.month, m) <= CARRY_STRENGTH_MONTHS) estimates.set(u, k.s);
      else fresh.push(u);
    }
    if (fresh.length && measured.length) {
      // never (or long ago) measured: neutral prior = median of this month's measured strengths (never the leader's 100)
      const vals = measured.map((v) => cell(v)!.s!).sort((a, b) => a - b);
      const mid = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
      for (const u of fresh) estimates.set(u, mid);
    } else if (fresh.length) {
      const ranked = [...fresh].sort((a, b) => share(b, m) - share(a, m));
      ranked.forEach((u, i) => estimates.set(u, Math.max(args.floor, 100 - args.step * i)));
    }
    for (const [u, s] of estimates) {
      args.cells.get(u)!.set(m, { s, measured: 0, reconstructed: 0, estimated: true, breakdown: [], bestModel: null });
    }
  }
}
