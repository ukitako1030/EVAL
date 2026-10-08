import { todayISO } from '../core/months';
import type { Observation } from '../core/types';
import { parseCsv } from './lib/csv';
import { toNumber } from './lib/values';
import type { StrengthModule } from './types';

const COMMON_PY = 'https://raw.githubusercontent.com/LiveBench/LiveBench/main/livebench/common.py';
const SITE = 'https://livebench.ai';

/**
 * Every release date in the `LIVE_BENCH_RELEASES = {"2024-07-26", ...}` definition of LiveBench's common.py, once each,
 * oldest first. Only dates inside that one collection count, not the other dates the file may mention.
 */
export function livebenchReleases(commonPy: string): string[] {
  const def = /LIVE_BENCH_RELEASES\s*(?::[^=\n]+)?=(?!=)\s*(?:\{([^}]*)\}|\[([^\]]*)\]|\(([^)]*)\))/.exec(commonPy);
  const body = def ? (def[1] ?? def[2] ?? def[3]) : '';
  const dates = [...new Set([...body.matchAll(/["'](\d{4}-\d{2}-\d{2})["']/g)].map((m) => m[1]))].sort();
  if (dates.length === 0) throw new Error('LIVE_BENCH_RELEASES not found in LiveBench common.py');
  return dates;
}

/** Newest date of `LIVE_BENCH_RELEASES` (see livebenchReleases). */
export function latestLivebenchRelease(commonPy: string): string {
  return livebenchReleases(commonPy).at(-1)!;
}

/** Task columns of the "Coding" category. They are renamed between releases, so the release's own categories file is the authority. */
function codingColumns(categories: unknown): string[] {
  if (typeof categories !== 'object' || categories === null) return [];
  const coding = (categories as Record<string, unknown>).Coding;
  return Array.isArray(coding) ? coding.filter((c): c is string => typeof c === 'string') : [];
}

/**
 * LiveBench Coding score of the current release, snapshotted on every run.
 *
 * Each release table keeps gaining models after its release date and scores get re-run, so a table cannot be dated
 * by its release; we record today's value for every model instead and build our own history (history: accumulate).
 * Coding score = mean of the release's `Coding` task columns, ignoring empty cells, as the site computes it.
 */
export const livebenchCoding: StrengthModule = {
  id: 'livebench-coding',
  role: 'strength',
  group: 'livebench-coding',
  history: 'accumulate',
  meta: {
    name: 'LiveBench (Coding)',
    url: SITE,
    license: 'Apache-2.0 / CC BY-SA 4.0',
    credit: 'LiveBench (livebench.ai), Apache-2.0 / CC BY-SA 4.0',
  },
  async fetch(ctx) {
    const releases = livebenchReleases(await ctx.fetchText(COMMON_PY));
    const release = releases.at(-1)!;
    ctx.log(`livebench: using release ${release} (${releases.length} releases found in common.py)`);
    const stamp = release.replace(/-/g, '_');
    const [table, categories] = await Promise.all([
      ctx.fetchText(`${SITE}/table_${stamp}.csv`),
      ctx.fetchJson<unknown>(`${SITE}/categories_${stamp}.json`),
    ]);
    return { release, table, categories };
  },
  parse(raw, { now }) {
    if (typeof raw !== 'object' || raw === null) return [];
    const { table, categories } = raw as { table?: unknown; categories?: unknown };
    const columns = codingColumns(categories);
    if (typeof table !== 'string' || columns.length === 0) return [];
    let rows: Record<string, string>[];
    try {
      rows = parseCsv(table);
    } catch {
      return [];
    }
    const date = todayISO(now);
    const out: Observation[] = [];
    for (const row of rows) {
      const model = typeof row.model === 'string' ? row.model.trim() : '';
      const scores = columns.map((c) => toNumber(row[c])).filter((v): v is number => v !== null);
      if (!model || scores.length === 0) continue;
      const value = scores.reduce((sum, v) => sum + v, 0) / scores.length;
      out.push({ series: 'livebench-coding', kind: 'percent', model, date, dateKind: 'snapshot', value });
    }
    return out;
  },
};
