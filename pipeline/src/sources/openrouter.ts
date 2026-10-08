import { toMonth } from '../core/months';
import type { SignalObs } from '../core/types';
import { parseCsv } from './lib/csv';
import { isoDate, toNumber } from './lib/values';
import type { FetchCtx, ScaleModule } from './types';

/** Rolling 30 days, no key. */
const KEYLESS_URL = 'https://openrouter.ai/api/v1/datasets/exports/rankings-daily/latest.csv';
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

/** Inclusive [start, end] windows of at most `maxDays` days covering start … end. */
export function dateWindows(start: string, end: string, maxDays = MAX_WINDOW_DAYS): [string, string][] {
  const out: [string, string][] = [];
  const last = Date.parse(`${end}T00:00:00Z`);
  for (let from = Date.parse(`${start}T00:00:00Z`); from <= last; from += maxDays * DAY_MS) {
    out.push([isoDay(from), isoDay(Math.min(from + (maxDays - 1) * DAY_MS, last))]);
  }
  return out;
}

export async function fetchOpenRouter(ctx: FetchCtx): Promise<OpenRouterRaw> {
  const key = ctx.env.OPENROUTER_API_KEY;
  if (!(key && ctx.backfill)) {
    if (ctx.backfill) ctx.log('openrouter: no OPENROUTER_API_KEY, so only the rolling 30 days are available (history starts 2026-08 without a key)');
    return ctx.fetchText(KEYLESS_URL);
  }
  // the current UTC day is live and incomplete, so stop at yesterday
  const end = isoDay(Date.parse(`${ctx.now.toISOString().slice(0, 10)}T00:00:00Z`) - DAY_MS);
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

/** (date, slug, share-of-that-day's-tokens) rows from either raw shape. Keyed rows carry tokens only, so shares are tokens / the day's total (the `other` row included). */
function dailyShares(raw: unknown): DailyShare[] {
  if (typeof raw === 'string') {
    let rows: Record<string, string>[];
    try {
      rows = parseCsv(raw);
    } catch {
      return [];
    }
    const out: DailyShare[] = [];
    for (const r of rows) {
      const date = isoDate(r.date);
      const share = toNumber(r.share_of_daily_tokens);
      const slug = (r.model_permaslug ?? '').trim();
      if (date && slug && share !== null && share > 0) out.push({ date, slug, share });
    }
    return out;
  }
  const data = (raw as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
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
  return out;
}

/**
 * Per (model slug, month): the mean over the month's days of the model's share of that day's tokens.
 * The denominator is the number of days of that month present in the data, with a day on which the model is not listed
 * (outside the daily top 50) counting as 0. Averaging only over the days a model was listed would overstate the
 * rarely listed ones and break additivity, because `signals.ts` sums all slugs behind one unit prefix.
 * Partial months at the edge of a 30-day window are averaged over the days they have.
 */
export function parseOpenRouter(raw: unknown): SignalObs[] {
  const unique = new Map<string, DailyShare>();
  for (const r of dailyShares(raw)) unique.set(`${r.date}\u0000${r.slug}`, r);
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
