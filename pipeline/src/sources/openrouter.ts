import { addMonths, toMonth } from '../core/months';
import type { SignalObs } from '../core/types';
import { parseCsv } from './lib/csv';
import { isoDate, toNumber } from './lib/values';
import type { FetchCtx, ScaleModule } from './types';

/** Rolling 30 days, no key. Last resort: the `latest.*` aliases can briefly mix snapshot dates right after a publish. */
const KEYLESS_URL = 'https://openrouter.ai/api/v1/datasets/exports/rankings-daily/latest.csv';
/** Manifest of the newest snapshot; its `files.csv.url` is the immutable dated file (what the README tells readers to download). */
const MANIFEST_URL = 'https://openrouter.ai/api/v1/datasets/exports/rankings-daily/latest.manifest.json';
const DATED_CSV_URL = /^https:\/\/openrouter\.ai\/api\/v1\/datasets\/exports\/rankings-daily\/\d{4}-\d{2}-\d{2}\.csv$/;
/** Documented keyed endpoint: `start_date`/`end_date` inclusive, at most 366 days per call. */
const KEYED_URL = 'https://openrouter.ai/api/v1/datasets/rankings-daily';
export const DATASET_START = '2025-01-01';
const MAX_WINDOW_DAYS = 366;
const DAY_MS = 86_400_000;

export interface KeyedRow {
  date: string;
  model_permaslug: string;
  /** a string in the API response */
  total_tokens: string | number;
}

/** Keyless: the CSV text. Keyed: the concatenated `data` arrays (no rank or share fields, only tokens). */
export type OpenRouterRaw = string | { data: KeyedRow[] };

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const utcDay = (day: string) => Date.parse(`${day}T00:00:00Z`);
/** Last calendar day of the month containing `t`, as an epoch ms. */
const monthEndOf = (t: number) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
};

/**
 * Inclusive [start, end] windows of at most `maxDays` days covering start … end, aligned to months: every window starts on
 * a 1st (when `start` does) and every window but the last ends on a month's last day, so no month is split across two calls.
 * Only when a single month is longer than `maxDays` is a window cut inside a month.
 */
export function dateWindows(start: string, end: string, maxDays = MAX_WINDOW_DAYS): [string, string][] {
  const out: [string, string][] = [];
  const last = utcDay(end);
  const span = maxDays * DAY_MS;
  for (let from = utcDay(start); from <= last; ) {
    let to: number;
    if (last - from < span) {
      to = last;
    } else {
      // the latest month end that still fits in `maxDays` days
      to = monthEndOf(from);
      if (to - from >= span) to = from + span - DAY_MS;
      else for (let next = monthEndOf(to + DAY_MS); next - from < span; next = monthEndOf(to + DAY_MS)) to = next;
    }
    out.push([isoDay(from), isoDay(to)]);
    from = to + DAY_MS;
  }
  return out;
}

/**
 * The keyless CSV, from the newest dated snapshot named by the manifest. The `latest.csv` alias is only the fallback,
 * because right after a publish it can serve a mix of two snapshot dates.
 */
async function fetchKeyless(ctx: FetchCtx): Promise<string> {
  try {
    const manifest = await ctx.fetchJson<{ files?: { csv?: { url?: unknown } } } | null>(MANIFEST_URL);
    const url = manifest?.files?.csv?.url;
    if (typeof url === 'string' && DATED_CSV_URL.test(url)) return await ctx.fetchText(url);
    ctx.log('openrouter: the manifest names no dated csv (format change?), falling back to latest.csv');
  } catch (e) {
    ctx.log(`openrouter: manifest or dated csv unavailable (${(e as Error).message}), falling back to latest.csv`);
  }
  return ctx.fetchText(KEYLESS_URL);
}

export async function fetchOpenRouter(ctx: FetchCtx): Promise<OpenRouterRaw> {
  const key = ctx.env.OPENROUTER_API_KEY;
  if (!(key && ctx.backfill)) {
    if (ctx.backfill) ctx.log('openrouter: no OPENROUTER_API_KEY, so only the rolling 30 days are available (history starts 2026-08 without a key)');
    return fetchKeyless(ctx);
  }
  // the current UTC day is live and incomplete, so stop at yesterday
  const end = isoDay(utcDay(ctx.now.toISOString().slice(0, 10)) - DAY_MS);
  const data: KeyedRow[] = [];
  for (const [from, to] of dateWindows(DATASET_START, end)) {
    const url = `${KEYED_URL}?start_date=${from}&end_date=${to}&period=day`;
    const body = await ctx.fetchJson<{ data?: unknown }>(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!Array.isArray(body.data)) throw new Error(`openrouter ${from}..${to}: response has no data (format change?)`);
    data.push(...(body.data as KeyedRow[]));
    ctx.log(`openrouter ${from}..${to}: ${body.data.length} rows`);
  }
  return { data };
}

interface DailyShare {
  date: string;
  slug: string;
  share: number;
}

interface Daily {
  rows: DailyShare[];
  /**
   * First month the data covers from its 1st day on, or null when every month in `rows` is complete by construction.
   * A keyless CSV is a rolling 30-day window, so the month it starts in is usually a short tail of 1-2 days. `accumulate`
   * lets the latest fetch win, and that tail would overwrite a good full-month value, so such a month is not emitted.
   * The month the window ends in is fine: it starts inside the window and only the days still to come are missing.
   */
  firstCompleteMonth: string | null;
}

/** (date, slug, share-of-that-day's-tokens) rows from either raw shape. Keyed rows carry tokens only, so shares are tokens / the day's total (the `other` row included). */
function dailyShares(raw: unknown): Daily {
  if (typeof raw === 'string') {
    let rows: Record<string, string>[];
    try {
      rows = parseCsv(raw);
    } catch {
      return { rows: [], firstCompleteMonth: null };
    }
    const out: DailyShare[] = [];
    let windowStart: string | null = null; // earliest date of any dated row, `other` rows and zero shares included
    for (const r of rows) {
      const date = isoDate(r.date);
      if (!date) continue;
      if (windowStart === null || date < windowStart) windowStart = date;
      const share = toNumber(r.share_of_daily_tokens);
      const slug = (r.model_permaslug ?? '').trim();
      if (slug && share !== null && share > 0) out.push({ date, slug, share });
    }
    if (windowStart === null) return { rows: out, firstCompleteMonth: null };
    const startMonth = toMonth(windowStart);
    return { rows: out, firstCompleteMonth: windowStart.endsWith('-01') ? startMonth : addMonths(startMonth, 1) };
  }
  const data = (raw as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return { rows: [], firstCompleteMonth: null };
  const tokens = new Map<string, Map<string, number>>(); // date -> slug -> tokens (last wins on a duplicate)
  for (const r of data as Partial<KeyedRow>[]) {
    const date = isoDate(r?.date);
    const n = toNumber(r?.total_tokens);
    const slug = typeof r?.model_permaslug === 'string' ? r.model_permaslug.trim() : '';
    if (!date || !slug || n === null || !(n > 0)) continue;
    if (!tokens.has(date)) tokens.set(date, new Map());
    tokens.get(date)!.set(slug, n);
  }
  const out: DailyShare[] = [];
  for (const [date, bySlug] of tokens) {
    const total = [...bySlug.values()].reduce((a, b) => a + b, 0);
    for (const [slug, n] of bySlug) out.push({ date, slug, share: n / total });
  }
  return { rows: out, firstCompleteMonth: null };
}

/**
 * Per (model slug, month): the mean over the month's days of the model's share of that day's tokens.
 * The denominator is the number of days of that month present in the data, with a day on which the model is not listed
 * (outside the daily top 50) counting as 0. Averaging only over the days a model was listed would overstate the
 * rarely listed ones and break additivity, because `signals.ts` sums all slugs behind one unit prefix.
 * The running month is averaged over the days it has so far. In a keyless 30-day window the month the window starts in
 * is left out unless the window starts on its 1st (see `Daily.firstCompleteMonth`); keyed data is fetched in month-aligned
 * windows and is never trimmed.
 */
export function parseOpenRouter(raw: unknown): SignalObs[] {
  const { rows, firstCompleteMonth } = dailyShares(raw);
  const unique = new Map<string, DailyShare>();
  for (const r of rows) if (firstCompleteMonth === null || toMonth(r.date) >= firstCompleteMonth) unique.set(`${r.date}\u0000${r.slug}`, r);
  const daysIn = new Map<string, Set<string>>();
  const sums = new Map<string, { slug: string; month: string; sum: number }>();
  for (const { date, slug, share } of unique.values()) {
    const month = toMonth(date);
    if (!daysIn.has(month)) daysIn.set(month, new Set());
    daysIn.get(month)!.add(date);
    if (slug === 'other') continue; // the long tail is not a model
    const k = `${month}\u0000${slug}`;
    const cur = sums.get(k);
    if (cur) cur.sum += share;
    else sums.set(k, { slug, month, sum: share });
  }
  return [...sums.values()]
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map(({ slug, month, sum }) => ({ signal: 'openrouter' as const, key: slug, month, value: sum / daysIn.get(month)!.size }));
}

export const openrouter: ScaleModule = {
  id: 'openrouter',
  role: 'scale',
  history: 'accumulate',
  meta: {
    name: 'OpenRouter model rankings (daily token share)',
    url: 'https://openrouter.ai/rankings',
    license: 'CC BY 4.0',
    // "<date>" is a placeholder for the snapshot date: the report layer is expected to substitute the source's `asOf`
    credit: 'Source: OpenRouter (openrouter.ai/rankings), as of <date>',
  },
  fetch: fetchOpenRouter,
  parse: (raw) => parseOpenRouter(raw),
};
