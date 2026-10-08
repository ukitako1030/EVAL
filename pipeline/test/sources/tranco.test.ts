import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { API_GAP_MS, candidateDates, fetchTranco, parseTranco, scanTrancoCsv, tranco, trancoMonths } from '../../src/sources/tranco';
import type { FetchCtx } from '../../src/sources/types';

const fixtureText = (name: string) => readFileSync(new URL(`../fixtures/tranco/${name}`, import.meta.url), 'utf8');
const list = fixtureText('sample-list.csv');
const metaOk = JSON.parse(fixtureText('sample-list-date-subdomains.json')) as Record<string, unknown>;

describe('candidateDates', () => {
  it('starts at the last day of the month and goes back three more days', () => {
    expect(candidateDates('2023-01')).toEqual(['2023-01-31', '2023-01-30', '2023-01-29', '2023-01-28']);
    expect(candidateDates('2022-11')).toEqual(['2022-11-30', '2022-11-29', '2022-11-28', '2022-11-27']);
    expect(candidateDates('2024-02')).toEqual(['2024-02-29', '2024-02-28', '2024-02-27', '2024-02-26']); // leap year
    expect(candidateDates('2025-02')[0]).toBe('2025-02-28');
    expect(candidateDates('2026-12')).toEqual(['2026-12-31', '2026-12-30', '2026-12-29', '2026-12-28']);
  });
});

describe('trancoMonths', () => {
  it('returns the last two complete months, or 2022-11 up to the last complete month with backfill', () => {
    const now = new Date('2026-10-08T06:00:00Z');
    expect(trancoMonths(now, false)).toEqual(['2026-08', '2026-09']);
    const all = trancoMonths(now, true);
    expect(all[0]).toBe('2022-11');
    expect(all[all.length - 1]).toBe('2026-09');
    expect(all).toHaveLength(47);
    expect(trancoMonths(new Date('2026-01-05T00:00:00Z'), false)).toEqual(['2025-11', '2025-12']);
  });
});

describe('scanTrancoCsv', () => {
  it('reads exact ranks for the requested hosts from the 2026-10-07 subdomain list', () => {
    const hosts = ['chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai', 'www.perplexity.ai', 'klingai.com', 'kling.ai', 'sora.chatgpt.com', 'bard.google.com'];
    expect(scanTrancoCsv(list, hosts)).toEqual({
      'chatgpt.com': 105,
      'chat.openai.com': 6014,
      'claude.ai': 543,
      'gemini.google.com': 1514,
      'perplexity.ai': 864,
      'www.perplexity.ai': 9901,
      'klingai.com': 16617,
      'kling.ai': 18680,
      'sora.chatgpt.com': 850037,
      // bard.google.com is not in the list -> absent, not 0
    });
  });

  it('matches whole domains only and keeps the requested order', () => {
    expect(scanTrancoCsv(list, ['openai.com', 'suno', 'google.com'])).toEqual({ 'openai.com': 114, 'google.com': 1 });
    expect(Object.keys(scanTrancoCsv(list, ['suno.com', 'chatgpt.com']))).toEqual(['suno.com', 'chatgpt.com']);
  });

  it('accepts CRLF, a missing final newline and blank lines', () => {
    const crlf = '1,google.com\r\n\r\n105,chatgpt.com\r\n543,claude.ai';
    expect(scanTrancoCsv(crlf, ['chatgpt.com', 'claude.ai', 'google.com'])).toEqual({ 'chatgpt.com': 105, 'claude.ai': 543, 'google.com': 1 });
    expect(scanTrancoCsv(list.replace(/\n/g, '\r\n'), ['claude.ai'])).toEqual({ 'claude.ai': 543 });
  });

  it('ignores non-integer or non-positive ranks', () => {
    expect(scanTrancoCsv('0,a.com\nx,b.com\n1.5,c.com\n7,d.com\n', ['a.com', 'b.com', 'c.com', 'd.com'])).toEqual({ 'd.com': 7 });
  });
});

describe('parseTranco', () => {
  it('turns ranks into rank signals keyed by host', () => {
    const raw = [
      { month: '2026-08', listId: 'AAAAA', ranks: scanTrancoCsv(list, ['chatgpt.com', 'claude.ai']) },
      { month: '2026-09', listId: 'V348N', ranks: scanTrancoCsv(list, ['gemini.google.com', 'grok.com']) },
    ];
    expect(parseTranco(raw)).toEqual([
      { signal: 'tranco', key: 'chatgpt.com', month: '2026-08', value: 105 },
      { signal: 'tranco', key: 'claude.ai', month: '2026-08', value: 543 },
      { signal: 'tranco', key: 'gemini.google.com', month: '2026-09', value: 1514 },
      { signal: 'tranco', key: 'grok.com', month: '2026-09', value: 4132 },
    ]);
  });

  it('skips bad entries and invalid ranks, and returns [] for an unusable payload', () => {
    const out = parseTranco([
      { month: '2026-09', listId: 'X', ranks: { 'a.com': 0, 'b.com': -3, 'c.com': Number.NaN, 'd.com': '5', 'e.com': 9 } },
      { month: 'September', ranks: { 'f.com': 1 } },
      { month: '2026-08' },
      null,
    ]);
    expect(out).toEqual([{ signal: 'tranco', key: 'e.com', month: '2026-09', value: 9 }]);
    expect(parseTranco({})).toEqual([]);
    expect(parseTranco(undefined)).toEqual([]);
  });
});

describe('fetchTranco', () => {
  const zipOf = (csv: string) => zipSync({ 'top-1m.csv': strToU8(csv) });
  const notFound = (url: string) => new Error(`HTTP 404 for ${url}`);

  function stub(over: { lookup?: (date: string, call: number) => unknown; zip?: (id: string) => Uint8Array; keys?: string[]; backfill?: boolean } = {}) {
    const calls: string[] = [];
    const logs: string[] = [];
    const naps: number[] = [];
    let n = 0;
    const lookup =
      over.lookup ??
      ((date: string) => {
        if (date === '2026-08-31') throw notFound(date); // the month's last day has no daily list -> falls back one day
        return { ...metaOk, list_id: `L${date.replace(/-/g, '')}` };
      });
    const ctx: FetchCtx = {
      env: {},
      now: new Date('2026-10-08T06:00:00Z'),
      backfill: over.backfill ?? false,
      keys: (s) => (s === 'tranco' ? (over.keys ?? ['chatgpt.com', 'claude.ai', 'bard.google.com']) : []),
      fetchText: async () => '',
      fetchBytes: async (url) => {
        calls.push(url);
        const id = url.split('/').pop()!;
        return over.zip ? over.zip(id) : zipOf(id === 'L20260830' ? list.replace(/\n/g, '\r\n') : list);
      },
      fetchJson: async <T>(url: string) => {
        calls.push(url);
        const date = /date\/(\d{4}-\d{2}-\d{2})\?/.exec(url)![1];
        return lookup(date, n++) as T;
      },
      log: (m) => logs.push(m),
    };
    return { ctx, calls, logs, naps, deps: { sleep: async (ms: number) => void naps.push(ms), apiGapMs: API_GAP_MS } };
  }

  it('falls back to the previous day on a 404 and reads the daily zip of the list', async () => {
    const { ctx, calls, logs, deps } = stub();
    const raw = await fetchTranco(ctx, deps);
    expect(calls).toEqual([
      'https://tranco-list.eu/api/lists/date/2026-08-31?subdomains=true',
      'https://tranco-list.eu/api/lists/date/2026-08-30?subdomains=true',
      'https://tranco-list.eu/download_daily/L20260830',
      'https://tranco-list.eu/api/lists/date/2026-09-30?subdomains=true',
      'https://tranco-list.eu/download_daily/L20260930',
    ]);
    expect(raw).toEqual([
      { month: '2026-08', listId: 'L20260830', ranks: { 'chatgpt.com': 105, 'claude.ai': 543 } },
      { month: '2026-09', listId: 'L20260930', ranks: { 'chatgpt.com': 105, 'claude.ai': 543 } },
    ]);
    // the list id never reaches the signals (`parse` drops it), so the fetch log is where it is recorded
    expect(logs.filter((l) => l.startsWith('tranco ') && l.includes('list '))).toEqual([
      'tranco 2026-08: list L20260830 (2026-08-30)',
      'tranco 2026-09: list L20260930 (2026-09-30)',
    ]);
    expect(tranco.parse(raw, { now: ctx.now })).toHaveLength(4);
    expect(JSON.stringify(tranco.parse(raw, { now: ctx.now }))).not.toContain('L2026');
  });

  it('waits at least 1.1 s between API calls', async () => {
    const { ctx, naps, deps } = stub();
    await fetchTranco(ctx, deps);
    // 3 API calls -> at most 2 gaps, each close to the full 1100 ms because the stubbed calls return instantly
    expect(naps.length).toBeGreaterThanOrEqual(1);
    expect(naps.length).toBeLessThanOrEqual(2);
    for (const ms of naps) {
      expect(ms).toBeGreaterThan(API_GAP_MS - 250);
      expect(ms).toBeLessThanOrEqual(API_GAP_MS);
    }
  });

  it('treats `available: false` like a 404, and skips a month when all four candidates are missing', async () => {
    const { ctx, calls, logs, deps } = stub({
      lookup: (date) => {
        if (date.startsWith('2026-08')) return { available: false };
        return { ...metaOk, list_id: 'GOOD1' };
      },
    });
    const raw = await fetchTranco(ctx, deps);
    expect(raw.map((r) => r.month)).toEqual(['2026-09']);
    expect(calls.filter((c) => c.includes('/api/lists/date/2026-08'))).toHaveLength(4);
    expect(logs.some((l) => l.includes('2026-08') && l.includes('no list found'))).toBe(true);
  });

  it('retries after an HTTP 429 with a pause', async () => {
    let first = true;
    const { ctx, naps, deps } = stub({
      lookup: (date) => {
        if (first) {
          first = false;
          throw new Error(`HTTP 429 for ${date}`);
        }
        return { ...metaOk, list_id: 'RETRY' };
      },
    });
    const raw = await fetchTranco(ctx, deps);
    expect(raw).toHaveLength(2);
    expect(naps).toContain(5_000);
  });

  it('fails when nothing could be loaded and when no host is configured', async () => {
    const down = stub({ lookup: (date) => { throw new Error(`HTTP 503 for ${date}`); } });
    await expect(fetchTranco(down.ctx, down.deps)).rejects.toThrow('HTTP 503');
    const emptyZip = stub({ zip: () => zipSync({ 'readme.txt': strToU8('x') }) });
    await expect(fetchTranco(emptyZip.ctx, emptyZip.deps)).rejects.toThrow(/top-1m\.csv not found/);
    const none = stub({ keys: [] });
    await expect(fetchTranco(none.ctx, none.deps)).rejects.toThrow(/no tranco hosts/);
  });
});

describe('tranco module', () => {
  it('declares an accumulating scale source citing the Tranco paper', () => {
    expect(tranco).toMatchObject({ id: 'tranco', role: 'scale', history: 'accumulate' });
    expect(tranco.meta.credit).toBe("Tranco list (Le Pochat et al., NDSS 2019), monthly lists ending at each month's last day; non-commercial");
  });

  it('does not promise list IDs in the credit: parse drops them', () => {
    expect(tranco.meta.credit).not.toMatch(/list IDs?/i);
  });
});
