import type { Month } from '../core/months';
import type { SignalObs } from '../core/types';
import { gunzipText } from './lib/archive';
import type { FetchCtx, ScaleModule } from './types';

const LISTING_URL = 'https://api.github.com/repos/zakird/crux-top-lists/contents/data/global';
const fileUrl = (yyyymm: string) => `https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/global/${yyyymm}.csv.gz`;

/** Half-step rank buckets exist from this month on (202211); older files only have 1k/10k/100k/1M. */
const FIRST_MONTH = '202211';
/** Without backfill, only the newest files can have changed. */
const RECENT_MONTHS = 2;

/**
 * Representative rank per CrUX bucket: the geometric mean of the bucket's bounds (bucket 1000 is taken as 100–1000).
 * The file's `rank` column is a bucket upper bound, not a rank; `signals.ts` turns the value into 1/rank.
 */
export const CRUX_REP: Readonly<Record<number, number>> = {
  1000: 316,
  5000: 2236,
  10000: 7071,
  50000: 22361,
  100000: 70711,
  500000: 223607,
  1000000: 707107,
};

export interface CruxRaw {
  /** 'YYYY-MM' */
  month: Month;
  /** best (smallest) bucket per configured host that appears in the month's top 1M */
  rows: { host: string; bucket: number }[];
}

/** 'YYYYMM' strings of the monthly files in a GitHub contents listing, ascending (`current.csv.gz` etc. are ignored). */
export function cruxFileMonths(listing: unknown): string[] {
  if (!Array.isArray(listing)) return [];
  const out = new Set<string>();
  for (const entry of listing) {
    const name = (entry as { name?: unknown } | null)?.name;
    const m = typeof name === 'string' ? /^(\d{6})\.csv\.gz$/.exec(name) : null;
    if (m) out.add(m[1]);
  }
  return [...out].sort();
}

/** Months to download: everything from 202211 with backfill, otherwise the newest two available. */
export function selectCruxMonths(available: string[], backfill: boolean): string[] {
  return backfill ? available.filter((m) => m >= FIRST_MONTH) : available.slice(-RECENT_MONTHS);
}

/** The origins that stand for a configured host: `https://h` and `https://www.h` (a key already holding a scheme is used as is). */
function originsOf(host: string): string[] {
  if (/^https?:\/\//i.test(host)) return [host.replace(/\/+$/, '')];
  return [`https://${host}`, `https://www.${host}`];
}

/**
 * Scans a CrUX `origin,rank` CSV (1 M rows, no quoting) for the configured hosts and returns the best bucket per host.
 * Scanned line by line instead of through a CSV parser, because it only needs the handful of matching rows.
 */
export function scanCruxCsv(text: string, hosts: string[]): { host: string; bucket: number }[] {
  const owners = new Map<string, string[]>(); // origin -> configured hosts it counts for (each host is judged independently)
  for (const h of hosts) {
    for (const o of originsOf(h)) {
      const list = owners.get(o);
      if (!list) owners.set(o, [h]);
      else if (!list.includes(h)) list.push(h);
    }
  }
  const best = new Map<string, number>();
  let pos = 0;
  while (pos < text.length) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1) nl = text.length;
    const comma = text.lastIndexOf(',', nl);
    if (comma > pos) {
      const hit = owners.get(text.slice(pos, comma));
      if (hit) {
        const bucket = Number(text.slice(comma + 1, nl).trim());
        if (Number.isFinite(bucket) && bucket > 0) {
          for (const host of hit) {
            const cur = best.get(host);
            if (cur === undefined || bucket < cur) best.set(host, bucket);
          }
        }
      }
    }
    pos = nl + 1;
  }
  return [...new Set(hosts)].filter((h) => best.has(h)).map((host) => ({ host, bucket: best.get(host)! }));
}

export async function fetchCrux(ctx: FetchCtx): Promise<CruxRaw[]> {
  const hosts = [...new Set(ctx.keys('crux'))];
  if (!hosts.length) throw new Error('no crux hosts configured in units.yaml');
  const listing = await ctx.fetchJson<unknown>(LISTING_URL);
  const months = selectCruxMonths(cruxFileMonths(listing), ctx.backfill);
  if (!months.length) throw new Error('crux: no monthly files found in the listing (format change?)');
  const out: CruxRaw[] = [];
  let lastError: unknown;
  for (const yyyymm of months) {
    try {
      const text = gunzipText(await ctx.fetchBytes(fileUrl(yyyymm)));
      out.push({ month: `${yyyymm.slice(0, 4)}-${yyyymm.slice(4)}`, rows: scanCruxCsv(text, hosts) });
    } catch (e) {
      lastError = e;
      ctx.log(`crux ${yyyymm}: skipped (${(e as Error).message})`);
    }
  }
  if (!out.length) throw lastError instanceof Error ? lastError : new Error('crux: no month could be downloaded');
  return out;
}

export function parseCrux(raw: unknown): SignalObs[] {
  if (!Array.isArray(raw)) return [];
  const out: SignalObs[] = [];
  for (const item of raw as Partial<CruxRaw>[]) {
    if (!item || typeof item.month !== 'string' || !/^\d{4}-\d{2}$/.test(item.month) || !Array.isArray(item.rows)) continue;
    for (const row of item.rows) {
      const value = row && typeof row.bucket === 'number' ? CRUX_REP[row.bucket] : undefined;
      if (value === undefined || typeof row.host !== 'string' || !row.host) continue;
      out.push({ signal: 'crux', key: row.host, month: item.month, value });
    }
  }
  return out;
}

export const crux: ScaleModule = {
  id: 'crux',
  role: 'scale',
  history: 'accumulate',
  meta: {
    name: 'Chrome UX Report top origins (zakird/crux-top-lists)',
    url: 'https://github.com/zakird/crux-top-lists',
    license: 'CC BY 4.0',
    credit: 'Chrome UX Report (Google), CC BY 4.0, via zakird/crux-top-lists',
  },
  fetch: fetchCrux,
  parse: parseCrux,
};
