import { toMonth } from '../core/months';
import type { SignalObs } from '../core/types';
import type { FetchCtx, ScaleModule } from './types';

/** Fixed storefront: rating counts are per country (US ChatGPT 11.1 M, JP 2.6 M). */
const COUNTRY = 'us';

export interface ItunesRaw {
  results: { trackId: number; trackName?: string; userRatingCount?: number }[];
}

/** One stable URL per run: ids de-duplicated and sorted numerically (the CDN caches by exact query string). */
export function lookupUrl(ids: string[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  return `https://itunes.apple.com/lookup?id=${sorted.join(',')}&country=${COUNTRY}`;
}

export async function fetchItunes(ctx: FetchCtx): Promise<ItunesRaw> {
  const configured = [...new Set(ctx.keys('itunes').map((k) => k.trim()))];
  const bad = configured.filter((k) => !/^\d+$/.test(k));
  if (bad.length) ctx.log(`itunes: ignoring non-numeric ids ${bad.join(', ')}`);
  const ids = configured.filter((k) => /^\d+$/.test(k));
  if (!ids.length) throw new Error('no itunes app ids configured in units.yaml');
  // served as text/javascript with leading newlines; JSON.parse tolerates the whitespace
  const body = JSON.parse(await ctx.fetchText(lookupUrl(ids))) as { results?: unknown };
  if (!Array.isArray(body.results)) throw new Error('itunes: response has no results (format change?)');
  const results = (body.results as Record<string, unknown>[])
    .filter((r) => r && typeof r.trackId === 'number')
    .map((r) => ({
      trackId: r.trackId as number,
      trackName: typeof r.trackName === 'string' ? r.trackName : undefined,
      userRatingCount: typeof r.userRatingCount === 'number' ? r.userRatingCount : undefined,
    }));
  // unknown or removed ids are dropped silently by Apple
  const got = new Set(results.map((r) => String(r.trackId)));
  const missing = ids.filter((id) => !got.has(id));
  if (missing.length) ctx.log(`itunes: no result for ${missing.join(', ')} (removed from the ${COUNTRY.toUpperCase()} store?)`);
  return { results };
}

/** Lifetime rating count per app, stamped with the month of the fetch (there is no history; it accumulates run by run). */
export function parseItunes(raw: unknown, ctx: { now: Date }): SignalObs[] {
  const results = (raw as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const month = toMonth(ctx.now);
  const out: SignalObs[] = [];
  for (const r of results as Record<string, unknown>[]) {
    const id = typeof r?.trackId === 'number' ? r.trackId : typeof r?.trackId === 'string' && /^\d+$/.test(r.trackId) ? Number(r.trackId) : NaN;
    const count = r?.userRatingCount;
    if (!Number.isFinite(id) || typeof count !== 'number' || !Number.isFinite(count) || !(count > 0)) continue;
    out.push({ signal: 'itunes', key: String(id), month, value: count });
  }
  return out;
}

export const itunes: ScaleModule = {
  id: 'itunes',
  role: 'scale',
  history: 'accumulate',
  meta: {
    name: 'Apple App Store rating counts (US, iTunes Lookup API)',
    url: 'https://itunes.apple.com/lookup',
    license: 'Public API, rating counts only (terms unclear; no artwork)',
    credit: 'Apple App Store (iTunes Lookup API)',
  },
  fetch: fetchItunes,
  parse: parseItunes,
};
