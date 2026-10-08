import type { Observation, ValueKind } from '../core/types';
import { unzipTexts } from './lib/archive';
import { parseCsv } from './lib/csv';
import { memoBytes } from './lib/memo';
import { isoDate, toNumber } from './lib/values';
import type { StrengthModule } from './types';

const ECI_URL = 'https://epoch.ai/data/eci_scores.csv';
const ZIP_URL = 'https://epoch.ai/data/benchmark_data.zip';

const CREDIT = 'Epoch AI, "Data on AI Benchmarking" / "Epoch Capabilities Index", CC BY 4.0';

function text(v: string | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** The CSV rows of a raw payload, or null when the payload is not CSV text at all. */
function rowsOf(raw: unknown): Record<string, string>[] | null {
  if (typeof raw !== 'string') return null;
  try {
    return parseCsv(raw);
  } catch {
    return null;
  }
}

function observation(
  series: string,
  kind: ValueKind,
  model: string,
  org: string,
  date: string | null,
  value: number | null,
): Observation | null {
  if (!model || date === null || value === null) return null;
  const obs: Observation = { series, kind, model, date, dateKind: 'release', value };
  if (org) obs.org = org;
  return obs;
}

/**
 * Epoch Capabilities Index: one row per model group, `date` is the model's release date.
 * Standalone CSV (byte-identical to epoch_capabilities_index/eci_scores.csv inside the benchmark zip).
 */
export const epochEci: StrengthModule = {
  id: 'epoch-eci',
  role: 'strength',
  group: 'epoch-eci',
  history: 'full',
  meta: { name: 'Epoch Capabilities Index', url: 'https://epoch.ai/data', license: 'CC BY 4.0', credit: CREDIT },
  fetch: (ctx) => ctx.fetchText(ECI_URL),
  parse(raw) {
    const rows = rowsOf(raw);
    if (!rows) return [];
    const out: Observation[] = [];
    for (const row of rows) {
      const obs = observation('epoch-eci', 'eci', text(row['Model']), text(row['Organization']), isoDate(row['date']), toNumber(row['eci']));
      if (obs) out.push(obs);
    }
    return out;
  },
};

export interface EpochBenchmarkCfg {
  /** module id, also used as the series id */
  id: string;
  /** CSV file name inside benchmark_data.zip */
  file: string;
  /** header of the score column, exactly as written in the CSV */
  scoreCol: string;
  kind: ValueKind;
  /** multiplied onto the parsed score (100 turns a 0-1 fraction into a percent) */
  scale: number;
  /** weight key in method.yaml strength.weights */
  group: string;
  /** meta.name */
  name: string;
  /**
   * Column naming the methodology version a row was measured under (e.g. `METR-Horizon-v1.1`). When a model has rows
   * from several versions only its newest version's rows are kept; rows with no version count as the oldest.
   */
  versionCol?: string;
}

/** The trailing dotted number of a version label ("METR-Horizon-v1.10" -> [1, 10]); null when there is none. */
function versionKey(label: string): number[] | null {
  const m = /(\d+(?:\.\d+)*)\s*$/.exec(label);
  return m ? m[1].split('.').map(Number) : null;
}

/** Numeric, component-wise comparison (1.10 > 1.9; 1 = 1.0); no version sorts below every version. */
function compareVersions(a: number[] | null, b: number[] | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One benchmark CSV of the Epoch AI Benchmarking Hub zip. Every row carries the model's `Release date`
 * and `Organization`, so no join with the model metadata is needed. Several rows per model are kept as they are
 * (agents, effort variants; picking one is the strength computation's job), except that with `versionCol` a model's
 * rows from older methodology versions are dropped in favour of its newest version's.
 */
export function epochBenchmark(cfg: EpochBenchmarkCfg): StrengthModule {
  const entry = new RegExp(`(?:^|/)${escapeRegExp(cfg.file)}$`);
  return {
    id: cfg.id,
    role: 'strength',
    group: cfg.group,
    history: 'full',
    meta: { name: cfg.name, url: 'https://epoch.ai/data', license: 'CC BY 4.0', credit: CREDIT },
    async fetch(ctx) {
      // the six benchmark modules share one 2.4 MB download
      const zip = await memoBytes(ZIP_URL, () => ctx.fetchBytes(ZIP_URL));
      const files = unzipTexts(zip, entry);
      const path = Object.keys(files).sort((a, b) => a.length - b.length)[0];
      if (path === undefined) throw new Error(`${cfg.file} not found in ${ZIP_URL}`);
      return files[path];
    },
    parse(raw) {
      const rows = rowsOf(raw);
      if (!rows) return [];
      const out: { obs: Observation; version: number[] | null }[] = [];
      for (const row of rows) {
        const score = toNumber(row[cfg.scoreCol]);
        const obs = observation(
          cfg.id,
          cfg.kind,
          text(row['Model version']) || text(row['Name']),
          text(row['Organization']),
          isoDate(row['Release date']),
          score === null ? null : score * cfg.scale,
        );
        if (obs) out.push({ obs, version: cfg.versionCol ? versionKey(text(row[cfg.versionCol])) : null });
      }
      if (!cfg.versionCol) return out.map((r) => r.obs);
      const newest = new Map<string, number[] | null>();
      for (const { obs, version } of out) {
        const cur = newest.get(obs.model);
        if (cur === undefined || compareVersions(version, cur) > 0) newest.set(obs.model, version);
      }
      return out.filter((r) => compareVersions(r.version, newest.get(r.obs.model)!) === 0).map((r) => r.obs);
    },
  };
}

export const epochTerminalBench = epochBenchmark({
  id: 'epoch-terminalbench',
  file: 'terminalbench_external.csv',
  scoreCol: 'Accuracy mean',
  kind: 'percent',
  scale: 100,
  group: 'terminalbench',
  name: 'Epoch AI Benchmarking Hub: Terminal-Bench',
});

export const epochSwebench = epochBenchmark({
  id: 'epoch-swebench',
  file: 'swe_bench_verified.csv',
  scoreCol: 'mean_score',
  kind: 'percent',
  scale: 100,
  group: 'swebench',
  name: 'Epoch AI Benchmarking Hub: SWE-bench Verified',
});

export const epochMetr = epochBenchmark({
  id: 'epoch-metr',
  file: 'metr_time_horizons_external.csv',
  scoreCol: 'Time horizon',
  kind: 'minutes',
  scale: 1,
  group: 'metr',
  name: 'Epoch AI Benchmarking Hub: METR time horizons',
  versionCol: 'METR version',
});

/**
 * Vending-Bench 2 final balance in USD. Scaled to thousands of dollars (0.001) so that the linear comparison
 * with τ = 8 treats an $8k gap as one e-fold of win odds.
 */
export const epochVending = epochBenchmark({
  id: 'epoch-vending',
  file: 'vending_bench_2_external.csv',
  scoreCol: 'Score',
  kind: 'eci',
  scale: 0.001,
  group: 'vending',
  name: 'Epoch AI Benchmarking Hub: Vending-Bench 2',
});

export const epochApex = epochBenchmark({
  id: 'epoch-apex',
  file: 'apex_agents_external.csv',
  scoreCol: 'Pass@1 score',
  kind: 'percent',
  scale: 100,
  group: 'apex',
  name: 'Epoch AI Benchmarking Hub: APEX-Agents',
});

/** Original OSWorld: scores are already percent. */
export const epochOsworld = epochBenchmark({
  id: 'epoch-osworld',
  file: 'os_world_external.csv',
  scoreCol: 'Score',
  kind: 'percent',
  scale: 1,
  group: 'osworld',
  name: 'Epoch AI Benchmarking Hub: OSWorld',
});

/** OSWorld 2.0: binary accuracy is a 0-1 fraction. */
export const epochOsworld2 = epochBenchmark({
  id: 'epoch-osworld2',
  file: 'osworld_2_external.csv',
  scoreCol: 'Binary accuracy',
  kind: 'percent',
  scale: 100,
  group: 'osworld',
  name: 'Epoch AI Benchmarking Hub: OSWorld 2.0',
});
