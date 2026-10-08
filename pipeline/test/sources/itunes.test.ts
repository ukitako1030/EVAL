import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOOKUP_BATCH_SIZE, fetchItunes, itunes, lookupBatches, lookupUrl, parseItunes } from '../../src/sources/itunes';
import type { FetchCtx } from '../../src/sources/types';

const text = readFileSync(new URL('../fixtures/itunes/sample.json', import.meta.url), 'utf8');
const now = new Date('2026-10-08T06:00:00Z');

describe('lookupUrl', () => {
  it('sorts and de-duplicates the ids so every run asks the same URL, US storefront', () => {
    expect(lookupUrl(['6473753684', '1558240027', '6448311069', '6473753684'])).toBe(
      'https://itunes.apple.com/lookup?id=1558240027,6448311069,6473753684&country=us',
    );
  });
});

describe('lookupBatches', () => {
  it('splits the sorted, de-duplicated ids into batches of at most 100', () => {
    expect(LOOKUP_BATCH_SIZE).toBe(100);
    const ids = Array.from({ length: 250 }, (_, i) => String(1_000_000 + ((i * 7) % 250))); // unsorted, 250 distinct
    const batches = lookupBatches([...ids, ...ids.slice(0, 20)]); // 20 duplicates on top
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual([...new Set(ids)].sort((a, b) => Number(a) - Number(b)));
  });

  it('keeps exactly 100 ids in one batch and starts a new one at 101', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
    expect(lookupBatches(ids(100)).map((b) => b.length)).toEqual([100]);
    expect(lookupBatches(ids(101)).map((b) => b.length)).toEqual([100, 1]);
    expect(lookupBatches([])).toEqual([]);
  });
});

describe('parseItunes (fixture sample.json: 9 US apps)', () => {
  const body = JSON.parse(text); // the body starts with three newlines, which JSON.parse accepts
  const out = parseItunes(body, { now });
  const byKey = Object.fromEntries(out.map((o) => [o.key, o]));

  it('emits one observation per app with the lifetime rating count, stamped with the fetch month', () => {
    expect(out).toHaveLength(9);
    expect(byKey['6448311069']).toEqual({ signal: 'itunes', key: '6448311069', month: '2026-10', value: 11079400 }); // ChatGPT
    expect(byKey['6473753684']).toEqual({ signal: 'itunes', key: '6473753684', month: '2026-10', value: 275581 }); // Claude
    expect(byKey['6477489729'].value).toBe(2321604); // Gemini
    expect(byKey['6740410176'].value).toBe(1302); // Vibe by Mistral
    expect(out.every((o) => o.month === '2026-10' && o.signal === 'itunes')).toBe(true);
  });

  it('uses the month of the `now` it is given', () => {
    expect(parseItunes(body, { now: new Date('2026-12-31T23:59:59Z') })[0].month).toBe('2026-12');
  });

  it('skips results without a usable rating count (never 0) or id', () => {
    const odd = {
      resultCount: 5,
      results: [
        { trackId: 1, userRatingCount: 0 },
        { trackId: 2 },
        { trackId: 'abc', userRatingCount: 4 },
        { trackId: '33', userRatingCount: 5 },
        { trackId: 4, userRatingCount: 6 },
        null,
      ],
    };
    expect(parseItunes(odd, { now })).toEqual([
      { signal: 'itunes', key: '33', month: '2026-10', value: 5 },
      { signal: 'itunes', key: '4', month: '2026-10', value: 6 },
    ]);
    expect(parseItunes({ resultCount: 0, results: [] }, { now })).toEqual([]);
    expect(parseItunes({}, { now })).toEqual([]);
    expect(parseItunes(null, { now })).toEqual([]);
  });
});

describe('fetchItunes', () => {
  function stub(keys: string[], body: string = text) {
    const urls: string[] = [];
    const logs: string[] = [];
    const ctx = {
      now,
      keys: (s: string) => (s === 'itunes' ? keys : []),
      fetchText: async (url: string) => {
        urls.push(url);
        return body;
      },
      log: (m: string) => logs.push(m),
    } as unknown as FetchCtx;
    return { ctx, urls, logs };
  }

  it('does one sorted lookup, keeps only id, name and count, and parses to observations', async () => {
    const { ctx, urls, logs } = stub(['6673753684x', '6473753684', '6448311069', '1558240027', '6448311069']);
    const raw = (await fetchItunes(ctx)) as { results: unknown[] };
    expect(urls).toEqual(['https://itunes.apple.com/lookup?id=1558240027,6448311069,6473753684&country=us']);
    expect(logs.some((l) => l.includes('6673753684x'))).toBe(true); // non-numeric id ignored, with a warning
    expect(raw.results).toHaveLength(9); // the stub returns the whole fixture regardless of the ids asked for
    expect(raw.results[0]).toEqual({ trackId: 6448311069, trackName: 'ChatGPT', userRatingCount: 11079400 });
    expect(Object.keys(raw.results[0] as object).sort()).toEqual(['trackId', 'trackName', 'userRatingCount']);
    expect(itunes.parse(raw, { now }).find((o) => o.key === '6448311069')?.value).toBe(11079400);
  });

  it('looks up at most 100 ids per request, and merges the results of all batches', async () => {
    const ids = Array.from({ length: 230 }, (_, i) => String(6_000_000_000 + i * 3));
    const urls: string[] = [];
    const ctx = {
      now,
      keys: (s: string) => (s === 'itunes' ? [...ids].reverse() : []), // unsorted on purpose
      fetchText: async (url: string) => {
        urls.push(url);
        const asked = /id=([\d,]+)&/.exec(url)![1].split(',');
        const results = asked.map((id) => ({ trackId: Number(id), trackName: `app ${id}`, userRatingCount: 10 }));
        return '\n\n\n' + JSON.stringify({ resultCount: results.length, results }); // the real body starts with newlines
      },
      log: () => {},
    } as unknown as FetchCtx;
    const raw = (await fetchItunes(ctx)) as { results: { trackId: number }[] };
    expect(urls).toHaveLength(3);
    const askedPerCall = urls.map((u) => /id=([\d,]+)&/.exec(u)![1].split(','));
    expect(askedPerCall.map((a) => a.length)).toEqual([100, 100, 30]);
    expect(askedPerCall.flat()).toEqual(ids); // ascending, none lost or repeated
    for (const u of urls) expect(u).toMatch(/^https:\/\/itunes\.apple\.com\/lookup\?id=[\d,]+&country=us$/);
    expect(raw.results.map((r) => String(r.trackId))).toEqual(ids);
    expect(itunes.parse(raw, { now })).toHaveLength(230);
  });

  it('reports ids with no result across batches, and fails if any batch is not a lookup result', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => String(1000 + i));
    const logs: string[] = [];
    const answer = (url: string) => {
      const asked = /id=([\d,]+)&/.exec(url)![1].split(',').filter((id) => id !== '1120' && id !== '1130'); // two ids gone from the store
      return JSON.stringify({ resultCount: asked.length, results: asked.map((id) => ({ trackId: Number(id), userRatingCount: 1 })) });
    };
    const ctx = { now, keys: () => ids, fetchText: async (url: string) => answer(url), log: (m: string) => logs.push(m) } as unknown as FetchCtx;
    const raw = (await fetchItunes(ctx)) as { results: unknown[] };
    expect(raw.results).toHaveLength(148);
    expect(logs.filter((l) => l.includes('no result'))).toHaveLength(1);
    expect(logs.find((l) => l.includes('no result'))).toContain('1120, 1130');

    let call = 0;
    const bad = { ...ctx, fetchText: async (url: string) => (call++ === 1 ? '{"errorMessage":"nope"}' : answer(url)) } as unknown as FetchCtx;
    await expect(fetchItunes(bad)).rejects.toThrow(/no results/);
  });

  it('logs ids that Apple silently dropped', async () => {
    const { ctx, logs } = stub(['6448311069', '6744034028']); // the Sora app is gone from the store
    await fetchItunes(ctx);
    expect(logs.some((l) => l.includes('6744034028') && l.includes('no result'))).toBe(true);
    expect(logs.some((l) => l.includes('6448311069'))).toBe(false);
  });

  it('fails when no id is configured or the response is not a lookup result', async () => {
    await expect(fetchItunes(stub([]).ctx)).rejects.toThrow(/no itunes app ids/);
    await expect(fetchItunes(stub(['1'], '{"errorMessage":"nope"}').ctx)).rejects.toThrow(/no results/);
    await expect(fetchItunes(stub(['1'], '<html>').ctx)).rejects.toThrow();
  });
});

describe('itunes module', () => {
  it('declares an accumulating scale source with the App Store credit', () => {
    expect(itunes).toMatchObject({ id: 'itunes', role: 'scale', history: 'accumulate' });
    expect(itunes.meta.credit).toBe('Apple App Store (iTunes Lookup API)');
  });
});
