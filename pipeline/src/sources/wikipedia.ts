import { addMonths, monthEnd, toMonth, type Month } from '../core/months';
import type { SignalObs } from '../core/types';
import { sleep, USER_AGENT } from './http';
import type { FetchCtx, ScaleModule } from './types';

const BASE = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user';
const START = '20221101';
/** ~170 requests/min, under the 200/min allowance of an identified client. */
export const REQUEST_GAP_MS = 350;
/** Pauses before re-asking after an HTTP 429. */
const RATE_LIMIT_WAITS_MS = [5_000, 15_000, 45_000];

export interface WikipediaRaw {
  /** the title exactly as configured in units.yaml (this is the signal key) */
  title: string;
  items: { timestamp: string; views: number }[];
}

export interface WikipediaDeps {
  sleep(ms: number): Promise<unknown>;
  gapMs: number;
}

/** The last fully elapsed calendar month; the API returns the current month as a partial sum. */
export function lastCompleteMonth(now: Date): Month {
  return addMonths(toMonth(now), -1);
}

/**
 * Monthly user pageviews of one article from 2022-11 up to the last day of `lastMonth`.
 * The end date must be that last day: `YYYYMM0100` would cut the final month down to its first day.
 */
export function pageviewsUrl(title: string, lastMonth: Month): string {
  const article = encodeURIComponent(title.replace(/ /g, '_'));
  return `${BASE}/${article}/monthly/${START}/${monthEnd(lastMonth).replace(/-/g, '')}`;
}

const httpStatus = (e: unknown, status: number) => new RegExp(`\\bHTTP ${status}\\b`).test(e instanceof Error ? e.message : String(e));

export async function fetchWikipedia(ctx: FetchCtx, deps: WikipediaDeps = { sleep, gapMs: REQUEST_GAP_MS }): Promise<WikipediaRaw[]> {
  const titles = [...new Set(ctx.keys('wikipedia'))];
  if (!titles.length) throw new Error('no wikipedia titles configured in units.yaml');
  const last = lastCompleteMonth(ctx.now);
  const out: WikipediaRaw[] = [];
  for (const [i, title] of titles.entries()) {
    if (i > 0) await deps.sleep(deps.gapMs);
    const url = pageviewsUrl(title, last);
    let body: { items?: unknown } | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        body = await ctx.fetchJson<{ items?: unknown }>(url, { headers: { 'User-Agent': USER_AGENT } });
        break;
      } catch (e) {
        if (httpStatus(e, 404)) break; // unknown title, or no views in the range (the two look alike)
        if (httpStatus(e, 429) && attempt < RATE_LIMIT_WAITS_MS.length) {
          ctx.log(`wikipedia ${title}: HTTP 429, waiting ${RATE_LIMIT_WAITS_MS[attempt] / 1000}s`);
          await deps.sleep(RATE_LIMIT_WAITS_MS[attempt]);
          continue;
        }
        throw e; // a partial snapshot would silently replace the full history, so do not skip other failures
      }
    }
    if (!body) {
      ctx.log(`wikipedia ${title}: 404, skipped (check the title or add its former titles)`);
      continue;
    }
    if (!Array.isArray(body.items)) throw new Error(`wikipedia ${title}: response has no items (format change?)`);
    const items = (body.items as { timestamp?: unknown; views?: unknown }[])
      .filter((it): it is { timestamp: string; views: number } => typeof it?.timestamp === 'string' && typeof it.views === 'number')
      .map((it) => ({ timestamp: it.timestamp, views: it.views }));
    out.push({ title, items });
  }
  if (!out.length) throw new Error('wikipedia: every title returned 404');
  return out;
}

/** Monthly timestamps look like `2023010100` (YYYYMM0100). Months with no views are absent, never 0. */
export function parseWikipedia(raw: unknown): SignalObs[] {
  if (!Array.isArray(raw)) return [];
  const out: SignalObs[] = [];
  for (const entry of raw as Partial<WikipediaRaw>[]) {
    if (!entry || typeof entry.title !== 'string' || !entry.title || !Array.isArray(entry.items)) continue;
    for (const it of entry.items) {
      const m = typeof it?.timestamp === 'string' ? /^(\d{4})(\d{2})\d{2,4}$/.exec(it.timestamp) : null;
      if (!m || +m[2] < 1 || +m[2] > 12) continue;
      if (typeof it.views !== 'number' || !Number.isFinite(it.views) || !(it.views > 0)) continue;
      out.push({ signal: 'wikipedia', key: entry.title, month: `${m[1]}-${m[2]}`, value: it.views });
    }
  }
  return out;
}

export const wikipedia: ScaleModule = {
  id: 'wikipedia',
  role: 'scale',
  history: 'full',
  meta: {
    name: 'Wikimedia pageviews (en.wikipedia, user traffic)',
    url: 'https://wikimedia.org/api/rest_v1/',
    license: 'CC0 1.0',
    credit: 'Wikimedia pageviews API (en.wikipedia.org, all-access, user agents), CC0 1.0',
  },
  fetch: (ctx) => fetchWikipedia(ctx),
  parse: (raw) => parseWikipedia(raw),
};
