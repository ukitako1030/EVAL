import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { REQUEST_GAP_MS, fetchWikipedia, lastCompleteMonth, pageviewsUrl, parseWikipedia, wikipedia } from '../../src/sources/wikipedia';
import { USER_AGENT } from '../../src/sources/http';
import type { FetchCtx } from '../../src/sources/types';

const fixtureText = (name: string) => readFileSync(new URL(`../fixtures/wikipedia/${name}`, import.meta.url), 'utf8');
const fixture = (name: string) => JSON.parse(fixtureText(name)) as { items: { article: string; timestamp: string; views: number }[] };

describe('lastCompleteMonth / pageviewsUrl', () => {
  it('is the month before `now`', () => {
    expect(lastCompleteMonth(new Date('2026-10-08T06:00:00Z'))).toBe('2026-09');
    expect(lastCompleteMonth(new Date('2027-01-01T00:00:00Z'))).toBe('2026-12');
  });

  it('builds the per-article monthly URL ending on the last day of the last complete month', () => {
    expect(pageviewsUrl('ChatGPT', '2026-09')).toBe(
      'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/ChatGPT/monthly/20221101/20260930',
    );
    // YYYYMM0100 would return only the first day of the final month (verified against the live API)
    expect(pageviewsUrl('ChatGPT', '2026-02')).toMatch(/\/monthly\/20221101\/20260228$/);
    expect(pageviewsUrl('ChatGPT', '2028-02')).toMatch(/\/20280229$/);
  });

  it('turns spaces into underscores and percent-encodes the rest (case is kept)', () => {
    expect(pageviewsUrl('Claude (AI)', '2026-09')).toContain('/user/Claude_(AI)/monthly/');
    expect(pageviewsUrl('Bard_(chatbot)', '2026-09')).toContain('/user/Bard_(chatbot)/monthly/');
    expect(pageviewsUrl('AC/DC', '2026-09')).toContain('/user/AC%2FDC/monthly/');
    expect(pageviewsUrl('Flux (text-to-image model)', '2026-09')).toContain('/user/Flux_(text-to-image_model)/monthly/');
  });
});

describe('parseWikipedia (fixtures)', () => {
  it('maps timestamp 2023010100 to month 2023-01 and keeps the views', () => {
    const out = parseWikipedia([{ title: 'ChatGPT', items: fixture('sample-chatgpt.json').items }]);
    expect(out).toHaveLength(46);
    expect(out[0]).toEqual({ signal: 'wikipedia', key: 'ChatGPT', month: '2022-12', value: 1882964 });
    expect(out[1]).toEqual({ signal: 'wikipedia', key: 'ChatGPT', month: '2023-01', value: 5349371 });
    expect(out[out.length - 1]).toEqual({ signal: 'wikipedia', key: 'ChatGPT', month: '2026-09', value: 1811003 });
  });

  it('keys every title separately, as configured (former titles are summed later by signals.ts)', () => {
    const out = parseWikipedia([
      { title: 'Bard_(chatbot)', items: fixture('sample-bard.json').items },
      { title: 'Google_Gemini', items: fixture('sample-google-gemini.json').items },
    ]);
    expect([...new Set(out.map((o) => o.key))]).toEqual(['Bard_(chatbot)', 'Google_Gemini']);
    expect(out.find((o) => o.key === 'Bard_(chatbot)')).toEqual({ signal: 'wikipedia', key: 'Bard_(chatbot)', month: '2023-02', value: 16163 });
    expect(out.find((o) => o.key === 'Google_Gemini')).toEqual({ signal: 'wikipedia', key: 'Google_Gemini', month: '2023-10', value: 595 });
  });

  it('skips zero views, malformed timestamps and entries, never emitting 0', () => {
    const out = parseWikipedia([
      {
        title: 'X',
        items: [
          { timestamp: '2024010100', views: 0 },
          { timestamp: '2024020100', views: 12 },
          { timestamp: '2024130100', views: 5 },
          { timestamp: 'garbage', views: 5 },
          { timestamp: '2024030100', views: Number.NaN },
          { timestamp: '2024040100', views: '7' },
          { timestamp: '20240501', views: 3 },
          null,
        ],
      },
      { title: '', items: [{ timestamp: '2024020100', views: 1 }] },
      { title: 'Y' },
      null,
    ]);
    expect(out).toEqual([
      { signal: 'wikipedia', key: 'X', month: '2024-02', value: 12 },
      { signal: 'wikipedia', key: 'X', month: '2024-05', value: 3 },
    ]);
    expect(parseWikipedia({})).toEqual([]);
    expect(parseWikipedia(null)).toEqual([]);
  });
});

describe('fetchWikipedia', () => {
  const notFound = (url: string) => new Error(`HTTP 404 for ${url}`);

  function stub(over: { titles?: string[]; serve?: (url: string, call: number) => unknown } = {}) {
    const urls: string[] = [];
    const inits: (RequestInit | undefined)[] = [];
    const logs: string[] = [];
    const naps: number[] = [];
    let n = 0;
    const serve =
      over.serve ??
      ((url: string) => {
        if (url.includes('/ChatGPT/')) return fixture('sample-chatgpt.json');
        if (url.includes('/Bard_(chatbot)/')) return fixture('sample-bard.json');
        throw notFound(url);
      });
    const ctx: FetchCtx = {
      env: {},
      now: new Date('2026-10-08T06:00:00Z'),
      backfill: false,
      keys: (s) => (s === 'wikipedia' ? (over.titles ?? ['ChatGPT', 'Bard (chatbot)', 'No Such Article']) : []),
      fetchText: async () => '',
      fetchBytes: async () => new Uint8Array(),
      fetchJson: async <T>(url: string, init?: RequestInit) => {
        urls.push(url);
        inits.push(init);
        return serve(url, n++) as T;
      },
      log: (m) => logs.push(m),
    };
    return { ctx, urls, inits, logs, naps, deps: { sleep: async (ms: number) => void naps.push(ms), gapMs: REQUEST_GAP_MS } };
  }

  it('requests each configured title with the descriptive User-Agent and skips a 404 (logged)', async () => {
    const { ctx, urls, inits, logs, naps, deps } = stub();
    const raw = await fetchWikipedia(ctx, deps);
    expect(urls).toEqual([
      'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/ChatGPT/monthly/20221101/20260930',
      'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Bard_(chatbot)/monthly/20221101/20260930',
      'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/No_Such_Article/monthly/20221101/20260930',
    ]);
    for (const init of inits) expect(init?.headers).toEqual({ 'User-Agent': USER_AGENT });
    expect(raw.map((r) => (r as { title: string }).title)).toEqual(['ChatGPT', 'Bard (chatbot)']); // keyed as configured
    expect(logs.some((l) => l.includes('No Such Article') && l.includes('404'))).toBe(true);
    expect(naps).toEqual([REQUEST_GAP_MS, REQUEST_GAP_MS]); // between requests only, i.e. ≤ ~170 per minute
    const out = wikipedia.parse(raw, { now: ctx.now });
    expect(out.filter((o) => o.key === 'ChatGPT')).toHaveLength(46);
    expect(out.find((o) => o.key === 'Bard (chatbot)')).toEqual({ signal: 'wikipedia', key: 'Bard (chatbot)', month: '2023-02', value: 16163 });
  });

  it('strips the response down to timestamp and views', async () => {
    const { ctx, deps } = stub({ titles: ['ChatGPT'] });
    const [first] = (await fetchWikipedia(ctx, deps)) as { items: Record<string, unknown>[] }[];
    expect(first.items[0]).toEqual({ timestamp: '2022120100', views: 1882964 });
  });

  it('waits and retries after an HTTP 429, but fails on other HTTP errors', async () => {
    let first = true;
    const retry = stub({
      titles: ['ChatGPT'],
      serve: (url) => {
        if (first) {
          first = false;
          throw new Error(`HTTP 429 for ${url}`);
        }
        return fixture('sample-chatgpt.json');
      },
    });
    expect(await fetchWikipedia(retry.ctx, retry.deps)).toHaveLength(1);
    expect(retry.naps).toEqual([5_000]);

    const banned = stub({ serve: (url) => { throw new Error(`HTTP 403 for ${url}`); } });
    await expect(fetchWikipedia(banned.ctx, banned.deps)).rejects.toThrow('HTTP 403');
  });

  it('fails when no title is configured, when all titles are 404 and when the body has no items', async () => {
    await expect(fetchWikipedia(stub({ titles: [] }).ctx)).rejects.toThrow(/no wikipedia titles/);
    const none = stub({ titles: ['A', 'B'] });
    await expect(fetchWikipedia(none.ctx, none.deps)).rejects.toThrow(/every title returned 404/);
    const odd = stub({ titles: ['A'], serve: () => ({ detail: 'x' }) });
    await expect(fetchWikipedia(odd.ctx, odd.deps)).rejects.toThrow(/no items/);
  });
});

describe('wikipedia module', () => {
  it('declares a full-history CC0 scale source', () => {
    expect(wikipedia).toMatchObject({ id: 'wikipedia', role: 'scale', history: 'full' });
    expect(wikipedia.meta.license).toBe('CC0 1.0');
  });
});
