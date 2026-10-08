import type { ValueKind } from '../core/types';
import type { Month } from '../core/months';
import { clamp, logit, sigmoid, weightedMean } from '../core/math';
import type { KindParams } from '../config/schemas';
import type { SeriesTable } from './assign';

export interface GroupScore {
  group: string;
  score: number;
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
      return sigmoid(logit(c(x)) - logit(c(lead)));
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
    const perSeries: { table: SeriesTable; scores: Map<string, UnitSeriesScore> }[] = [];
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
      perSeries.push({ table: t, scores });
    }
    // 2) per group: highest-priority series with data, ties averaged
    const groups = new Map<string, typeof perSeries>();
    for (const s of perSeries) {
      if (!groups.has(s.table.group)) groups.set(s.table.group, []);
      groups.get(s.table.group)!.push(s);
    }
    const unitGroups = new Map<string, GroupScore[]>();
    for (const [group, list] of groups) {
      const weight = args.weights[group] ?? 0;
      if (weight <= 0) continue;
      const maxP = Math.max(...list.map((s) => s.table.priority));
      const top = list.filter((s) => s.table.priority === maxP);
      const ids = new Set(top.flatMap((s) => [...s.scores.keys()]));
      for (const uid of ids) {
        const hits = top.map((s) => s.scores.get(uid)).filter((h): h is UnitSeriesScore => h !== undefined);
        const score = hits.reduce((a, h) => a + h.score, 0) / hits.length;
        if (!unitGroups.has(uid)) unitGroups.set(uid, []);
        unitGroups.get(uid)!.push({ group, score, weight, reconstructed: hits.every((h) => h.reconstructed), model: hits[0].model });
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
  for (const m of args.months) {
    const present = ids.filter((u) => args.exists(u, m));
    const cell = (u: string) => args.cells.get(u)!.get(m);
    const measured = present.filter((u) => cell(u)?.s != null);
    const missing = present.filter((u) => cell(u)?.s == null);
    if (!missing.length) continue;
    const estimates = new Map<string, number>();
    if (measured.length) {
      for (const u of missing) {
        let best = measured[0];
        for (const v of measured) if (Math.abs(share(u, m) - share(v, m)) < Math.abs(share(u, m) - share(best, m))) best = v;
        estimates.set(u, cell(best)!.s!);
      }
    } else {
      const ranked = [...missing].sort((a, b) => share(b, m) - share(a, m));
      ranked.forEach((u, i) => estimates.set(u, Math.max(args.floor, 100 - args.step * i)));
    }
    for (const [u, s] of estimates) {
      args.cells.get(u)!.set(m, { s, measured: 0, reconstructed: 0, estimated: true, breakdown: [], bestModel: null });
    }
  }
}
