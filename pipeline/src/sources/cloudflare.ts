import { toMonth } from '../core/months';
import type { SignalObs } from '../core/types';
import { toNumber } from './lib/values';
import type { FetchCtx, ScaleModule } from './types';

const ENDPOINT = 'https://api.cloudflare.com/client/v4/radar/ranking/internet_services/timeseries_groups';
/** Exact value of the category filter. */
const CATEGORY = 'Generative AI';
/** Daily data has been published since 2025-01-26 (launch post); the API floor is not documented. */
export const BACKFILL_START = '2025-01-26T00:00:00Z';
/** `dateRange[]` accepts at most 364d; the same bound is used for explicit windows. */
const MAX_WINDOW_DAYS = 364;
/** Without backfill, the last two complete months plus the running one: this many months back from the current one. */
const RECENT_MONTHS_BACK = 2;
/** How many top services to return (the API default is 5). The category has far fewer than this. */
const SERVICE_LIMIT = 20;
const DAY_MS = 86_400_000;

/** Radar API response: `result.serie_0` = `{ timestamps: [...], "<service>": [rank, ...] }`. */
interface RadarResponse {
  result?: { serie_0?: Record<string, unknown> };
}

/** Consecutive windows of at most `maxDays` days: [start, end) pairs as ISO date-times, the last ending at `end`. */
export function backfillWindows(start: string, end: Date, maxDays = MAX_WINDOW_DAYS): [string, string][] {
  const out: [string, string][] = [];
  const last = end.getTime();
  for (let from = Date.parse(start); from < last; from += maxDays * DAY_MS) {
    out.push([new Date(from).toISOString(), new Date(Math.min(from + maxDays * DAY_MS, last)).toISOString()]);
  }
  return out;
}

/**
 * The range for a non-backfill run: from the 1st day of the month two months back until now. A bare `90d` range starts
 * mid-month, so its first month would be a short tail, and the latest fetch of a month wins in an accumulate source.
 */
export function recentWindow(now: Date): [string, string] {
  const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - RECENT_MONTHS_BACK, 1);
  return [new Date(from).toISOString(), now.toISOString()];
}

/** Query string with `%20`-style escaping (URLSearchParams would write "Generative+AI"). */
export function rankingUrl(range: { dateRange: string } | { dateStart: string; dateEnd: string }): string {
  const pairs: [string, string][] = [
    ['serviceCategory[]', CATEGORY],
    ['limit', String(SERVICE_LIMIT)],
    ...('dateRange' in range
      ? [['dateRange[]', range.dateRange] as [string, string]]
      : ([['dateStart[]', range.dateStart], ['dateEnd[]', range.dateEnd]] as [string, string][])),
    ['format', 'JSON'],
  ];
  return `${ENDPOINT}?${pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
}

export async function fetchCloudflare(ctx: FetchCtx): Promise<RadarResponse[]> {
  const token = ctx.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('missing env: CLOUDFLARE_API_TOKEN');
  const windows = ctx.backfill ? backfillWindows(BACKFILL_START, ctx.now) : [recentWindow(ctx.now)];
  const out: RadarResponse[] = [];
  let lastError = '';
  // a failed window only loses its own months (an accumulate source can fill them on a later run), so skip it and keep the rest
  for (const [dateStart, dateEnd] of windows) {
    try {
      const body = await ctx.fetchJson<RadarResponse & { success?: boolean }>(rankingUrl({ dateStart, dateEnd }), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (body?.success === false || !body?.result?.serie_0) throw new Error('response has no result.serie_0 (token scope or format change?)');
      out.push({ result: { serie_0: body.result.serie_0 } });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      ctx.log(`cloudflare ${dateStart.slice(0, 10)}..${dateEnd.slice(0, 10)}: skipped (${lastError})`);
    }
  }
  if (!out.length) throw new Error(`cloudflare: no window succeeded (${lastError})`);
  // the exact service names go into units.yaml, so make them visible on the first real run
  const names = new Set<string>();
  for (const r of out) for (const k of Object.keys(r.result?.serie_0 ?? {})) if (k !== 'timestamps') names.add(k);
  ctx.log(`cloudflare: services ${[...names].join(' | ')}`);
  return out;
}

/**
 * Daily rank series per service → best (lowest) rank within each calendar month.
 * Accepts one API response or an array of them (several date windows). Ranks may be numbers or numeric strings;
 * null/blank/zero/negative entries are gaps, never ranks.
 */
export function parseCloudflare(raw: unknown): SignalObs[] {
  const responses = Array.isArray(raw) ? raw : [raw];
  const best = new Map<string, { key: string; month: string; rank: number }>();
  for (const resp of responses as (RadarResponse | null)[]) {
    const serie = resp?.result?.serie_0;
    const timestamps = serie?.timestamps;
    if (!serie || !Array.isArray(timestamps)) continue;
    for (const [service, values] of Object.entries(serie)) {
      if (service === 'timestamps' || !Array.isArray(values)) continue;
      for (let i = 0; i < Math.min(values.length, timestamps.length); i++) {
        const ts = timestamps[i];
        const rank = toNumber(values[i]);
        if (typeof ts !== 'string' || !/^\d{4}-\d{2}/.test(ts) || rank === null || !(rank >= 1)) continue;
        const month = toMonth(ts);
        const k = `${service}\u0000${month}`;
        const cur = best.get(k);
        if (!cur || rank < cur.rank) best.set(k, { key: service, month, rank });
      }
    }
  }
  return [...best.values()]
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ key, month, rank }) => ({ signal: 'cloudflare' as const, key, month, value: rank }));
}

export const cloudflare: ScaleModule = {
  id: 'cloudflare',
  role: 'scale',
  history: 'accumulate',
  needsEnv: ['CLOUDFLARE_API_TOKEN'],
  meta: {
    name: 'Cloudflare Radar: Generative AI service ranking',
    url: 'https://radar.cloudflare.com/ai-insights',
    license: 'CC BY-NC 4.0',
    credit: 'Cloudflare Radar (radar.cloudflare.com), CC BY-NC 4.0',
  },
  fetch: fetchCloudflare,
  parse: (raw) => parseCloudflare(raw),
};
