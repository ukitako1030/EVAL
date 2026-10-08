import { toMonth } from '../core/months';
import type { SignalObs } from '../core/types';
import type { FetchCtx, ScaleModule } from './types';

/** Fixed storefront: rating counts are per country (US ChatGPT 11.1 M, JP 2.6 M). */
const COUNTRY = 'us';

export interface ItunesRaw {
  results: { trackId: number; trackName?: string; userRatingCount?: number }[];
}

/** Ids per lookup request. A single call with 22 ids was verified (docs/superpowers/recon/sources-scale.md); more apps are split into several calls instead of one ever-longer query string. */
export const LOOKUP_BATCH_SIZE = 100;

/** Ids de-duplicated and sorted numerically (the CDN caches by exact query string). */
const sortedUnique = (ids: string[]) => [...new Set(ids)].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));

/** The ids in lookup batches of at most `LOOKUP_BATCH_SIZE`: sorted and de-duplicated overall, so every run asks the same URLs. */
export function lookupBatches(ids: string[]): string[][] {
  const sorted = sortedUnique(ids);
  const out: string[][] = [];
  for (let i = 0; i < sorted.length; i += LOOKUP_BATCH_SIZE) out.push(sorted.slice(i, i + LOOKUP_BATCH_SIZE));
  return out;
}

/** One stable URL per batch: ids de-duplicated and sorted numerically. */
export function lookupUrl(ids: string[]): string {
  return `https://itunes.apple.com/lookup?id=${sortedUnique(ids).join(',')}&country=${COUNTRY}`;
}

export async function fetchItunes(ctx: FetchCtx): Promise<ItunesRaw> {
  const configured = [...new Set(ctx.keys('itunes').map((k) => k.trim()))];
  const bad = configured.filter((k) => !/^\d+$/.test(k));
  if (bad.length) ctx.log(`itunes: ignoring non-numeric ids ${bad.join(', ')}`);
  const ids = sortedUnique(configured.filter((k) => /^\d+$/.test(k)));
  if (!ids.length) throw new Error('no itunes app ids configured in units.yaml');
  const results: ItunesRaw['results'] = [];
  for (const batch of lookupBatches(ids)) {
    // served as text/javascript with leading newlines; JSON.parse tolerates the whitespace
    const body = JSON.parse(await ctx.fetchText(lookupUrl(batch))) as { results?: unknown };
    if (!Array.isArray(body.results)) throw new Error('itunes: response has no results (format change?)');
    for (const r of body.results as Record<string, unknown>[]) {
      if (!r || typeof r.trackId !== 'number') continue;
      results.push({
        trackId: r.trackId,
        trackName: typeof r.trackName === 'string' ? r.trackName : undefined,
        userRatingCount: typeof r.userRatingCount === 'number' ? r.userRatingCount : undefined,
      });
    }
  }
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
