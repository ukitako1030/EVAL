import { addMonths, monthEnd, monthRange, toMonth, type Month } from '../core/months';
import type { SignalObs } from '../core/types';
import { sleep } from './http';
import { unzipTexts } from './lib/archive';
import type { FetchCtx, ScaleModule } from './types';

const API = 'https://tranco-list.eu/api/lists/date';
const DOWNLOAD = 'https://tranco-list.eu/download_daily';

const FIRST_MONTH: Month = '2022-11';
const RECENT_MONTHS = 2;
/** The API allows 1 query per second (HTTP 429 above that). */
export const API_GAP_MS = 1100;
/** Days tried for a month: its last day, then 1, 2 and 3 days earlier (a few daily lists are missing). */
const CANDIDATE_DAYS = 4;
/** Pauses before re-asking after an HTTP 429. */
const RATE_LIMIT_WAITS_MS = [5_000, 15_000, 45_000];

export interface TrancoRaw {
  /** 'YYYY-MM' */
  month: Month;
  /** Tranco list id that the ranks were read from; kept in the raw snapshot and logged per month, not emitted as a signal */
  listId: string;
  /** configured host -> rank (1 = most popular); hosts that are not in the top 1M are absent */
  ranks: Record<string, number>;
}

export interface TrancoDeps {
  sleep(ms: number): Promise<unknown>;
  apiGapMs: number;
}

/** The dates to ask the API for, in order: the month's last day, then −1, −2 and −3 days. */
export function candidateDates(month: Month): string[] {
  const last = Date.parse(`${monthEnd(month)}T00:00:00Z`);
  return Array.from({ length: CANDIDATE_DAYS }, (_, i) => new Date(last - i * 86_400_000).toISOString().slice(0, 10));
}

/** Complete calendar months to fetch: 2022-11 … last complete month with backfill, otherwise the last two. */
export function trancoMonths(now: Date, backfill: boolean): Month[] {
  const last = addMonths(toMonth(now), -1);
  return backfill ? monthRange(FIRST_MONTH, last) : monthRange(addMonths(last, 1 - RECENT_MONTHS), last);
}

/**
 * Scans a Tranco `rank,domain` list (no header, CRLF or LF) for the configured hosts (exact match).
 * Scanned line by line instead of through a CSV parser, because it only needs the handful of matching rows.
 */
export function scanTrancoCsv(text: string, hosts: string[]): Record<string, number> {
  const wanted = new Set(hosts);
  const found = new Map<string, number>();
  let pos = 0;
  while (pos < text.length) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1) nl = text.length;
    const comma = text.indexOf(',', pos);
    if (comma !== -1 && comma < nl) {
      const domain = text.slice(comma + 1, nl).trim();
      if (wanted.has(domain)) {
        const rank = Number(text.slice(pos, comma).trim());
        if (Number.isInteger(rank) && rank >= 1) {
          const cur = found.get(domain);
          if (cur === undefined || rank < cur) found.set(domain, rank);
        }
      }
    }
    pos = nl + 1;
  }
  return Object.fromEntries(hosts.filter((h) => found.has(h)).map((h) => [h, found.get(h)!]));
}

const httpStatus = (e: unknown, status: number) => new RegExp(`\\bHTTP ${status}\\b`).test(e instanceof Error ? e.message : String(e));

interface ListMeta {
  list_id?: unknown;
  available?: unknown;
  failed?: unknown;
}

export async function fetchTranco(ctx: FetchCtx, deps: TrancoDeps = { sleep, apiGapMs: API_GAP_MS }): Promise<TrancoRaw[]> {
  const hosts = [...new Set(ctx.keys('tranco'))];
  if (!hosts.length) throw new Error('no tranco hosts configured in units.yaml');

  let lastApiCall = 0;
  const throttle = async () => {
    const wait = lastApiCall + deps.apiGapMs - Date.now();
    if (lastApiCall && wait > 0) await deps.sleep(wait);
    lastApiCall = Date.now();
  };

  /** One metadata call; null when the list does not exist (HTTP 404 or `available: false`). */
  async function lookup(date: string): Promise<{ listId: string } | null> {
    for (let attempt = 0; ; attempt++) {
      await throttle();
      try {
        const meta = await ctx.fetchJson<ListMeta>(`${API}/${date}?subdomains=true`);
        if (!meta || typeof meta.list_id !== 'string' || !meta.list_id || meta.available === false || meta.failed === true) return null;
        return { listId: meta.list_id };
      } catch (e) {
        if (httpStatus(e, 404)) return null;
        if (httpStatus(e, 429) && attempt < RATE_LIMIT_WAITS_MS.length) {
          ctx.log(`tranco ${date}: HTTP 429, waiting ${RATE_LIMIT_WAITS_MS[attempt] / 1000}s`);
          await deps.sleep(RATE_LIMIT_WAITS_MS[attempt]);
          continue;
        }
        throw e;
      }
    }
  }

  const out: TrancoRaw[] = [];
  let lastError: unknown;
  for (const month of trancoMonths(ctx.now, ctx.backfill)) {
    try {
      let list: { listId: string } | null = null;
      let date = '';
      for (date of candidateDates(month)) {
        list = await lookup(date);
        if (list) break;
      }
      if (!list) {
        ctx.log(`tranco ${month}: no list found for ${candidateDates(month).join(', ')}`);
        continue;
      }
      const zip = await ctx.fetchBytes(`${DOWNLOAD}/${list.listId}`);
      const files = Object.values(unzipTexts(zip, /(^|\/)top-1m\.csv$/));
      if (!files.length) throw new Error(`list ${list.listId}: top-1m.csv not found in the zip (format change?)`);
      out.push({ month, listId: list.listId, ranks: scanTrancoCsv(files[0], hosts) });
      ctx.log(`tranco ${month}: list ${list.listId} (${date})`);
    } catch (e) {
      lastError = e;
      ctx.log(`tranco ${month}: skipped (${(e as Error).message})`);
    }
  }
  if (!out.length) throw lastError instanceof Error ? lastError : new Error('tranco: no list could be loaded');
  return out;
}

export function parseTranco(raw: unknown): SignalObs[] {
  if (!Array.isArray(raw)) return [];
  const out: SignalObs[] = [];
  for (const item of raw as Partial<TrancoRaw>[]) {
    if (!item || typeof item.month !== 'string' || !/^\d{4}-\d{2}$/.test(item.month) || !item.ranks || typeof item.ranks !== 'object') continue;
    for (const [host, rank] of Object.entries(item.ranks)) {
      if (typeof rank === 'number' && Number.isFinite(rank) && rank >= 1) out.push({ signal: 'tranco', key: host, month: item.month, value: rank });
    }
  }
  return out;
}

export const tranco: ScaleModule = {
  id: 'tranco',
  role: 'scale',
  history: 'accumulate',
  meta: {
    name: 'Tranco top sites list (with subdomains)',
    url: 'https://tranco-list.eu',
    license: 'No licence of its own; cite Le Pochat et al., NDSS 2019 (non-commercial use; includes Cloudflare Radar data, CC BY-NC 4.0)',
    // no list IDs here: `parse` drops `listId`, so they live only in the raw snapshot and the fetch log
    credit: "Tranco list (Le Pochat et al., NDSS 2019), monthly lists ending at each month's last day; non-commercial",
  },
  fetch: (ctx) => fetchTranco(ctx),
  parse: parseTranco,
};
