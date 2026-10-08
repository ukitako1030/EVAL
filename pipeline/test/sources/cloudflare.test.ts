import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BACKFILL_START, backfillWindows, cloudflare, fetchCloudflare, parseCloudflare, rankingUrl, recentWindow } from '../../src/sources/cloudflare';
import type { FetchCtx } from '../../src/sources/types';

const docExample = JSON.parse(readFileSync(new URL('../fixtures/cloudflare/sample.json', import.meta.url), 'utf8')) as {
  result: { meta: unknown; serie_0: Record<string, unknown> };
  success: boolean;
};

/** The documented 200 example with per-service rank arrays added (the docs example only has `timestamps`). */
function withServices(services: Record<string, unknown[]>, timestamps: string[]) {
  return { ...docExample, result: { ...docExample.result, serie_0: { timestamps, ...services } } };
}

describe('parseCloudflare', () => {
  it('the documented example without per-service arrays carries no ranking', () => {
    expect(docExample.result.serie_0.timestamps).toEqual(['2022-09-02T00:00:00Z']);
    expect(parseCloudflare(docExample)).toEqual([]);
  });

  it('takes the best (lowest) rank of each month for each service', () => {
    const ts = ['2025-01-30T00:00:00Z', '2025-01-31T00:00:00Z', '2025-02-01T00:00:00Z', '2025-02-02T00:00:00Z', '2025-02-03T00:00:00Z'];
    const resp = withServices(
      {
        'ChatGPT / OpenAI': [1, 1, 1, 2, 1],
        'Claude / Anthropic': [4, 3, 5, 2, 6],
        'Google Gemini': ['5', '5', '4', '4', '3'], // numeric strings are allowed by the API spec
      },
      ts,
    );
    expect(parseCloudflare(resp)).toEqual([
      { signal: 'cloudflare', key: 'ChatGPT / OpenAI', month: '2025-01', value: 1 },
      { signal: 'cloudflare', key: 'Claude / Anthropic', month: '2025-01', value: 3 },
      { signal: 'cloudflare', key: 'Google Gemini', month: '2025-01', value: 5 },
      { signal: 'cloudflare', key: 'ChatGPT / OpenAI', month: '2025-02', value: 1 },
      { signal: 'cloudflare', key: 'Claude / Anthropic', month: '2025-02', value: 2 },
      { signal: 'cloudflare', key: 'Google Gemini', month: '2025-02', value: 3 },
    ]);
  });

  it('follows the spec example {"Google":[2],"timestamps":[…]} and keeps service names verbatim', () => {
    const out = parseCloudflare({ success: true, result: { serie_0: { Google: [2], timestamps: ['2025-03-15T00:00:00Z'] } } });
    expect(out).toEqual([{ signal: 'cloudflare', key: 'Google', month: '2025-03', value: 2 }]);
  });

  it('treats null, blank, zero, negative and non-numeric entries as gaps, never as ranks', () => {
    const ts = ['2025-04-01T00:00:00Z', '2025-04-02T00:00:00Z', '2025-04-03T00:00:00Z', '2025-04-04T00:00:00Z', '2025-04-05T00:00:00Z'];
    const resp = withServices(
      {
        A: [null, 0, -3, 'x', ''],
        B: [null, 0, 7, 'x', ''],
        C: [9, 8], // shorter than the timestamps: only the aligned entries count
      },
      ts,
    );
    expect(parseCloudflare(resp)).toEqual([
      { signal: 'cloudflare', key: 'B', month: '2025-04', value: 7 },
      { signal: 'cloudflare', key: 'C', month: '2025-04', value: 8 },
    ]);
  });

  it('merges several date windows (an array of responses), keeping the best rank where they overlap', () => {
    const w1 = withServices({ ChatGPT: [3, 2] }, ['2025-12-30T00:00:00Z', '2025-12-31T00:00:00Z']);
    const w2 = withServices({ ChatGPT: [1, 4], Claude: [5, 5] }, ['2025-12-31T00:00:00Z', '2026-01-01T00:00:00Z']);
    expect(parseCloudflare([w1, w2])).toEqual([
      { signal: 'cloudflare', key: 'ChatGPT', month: '2025-12', value: 1 }, // 12-31: min(2, 1)
      { signal: 'cloudflare', key: 'Claude', month: '2025-12', value: 5 },
      { signal: 'cloudflare', key: 'ChatGPT', month: '2026-01', value: 4 },
      { signal: 'cloudflare', key: 'Claude', month: '2026-01', value: 5 },
    ]);
  });

  it('returns [] for unusable payloads', () => {
    expect(parseCloudflare(null)).toEqual([]);
    expect(parseCloudflare({})).toEqual([]);
    expect(parseCloudflare({ success: false, errors: [{ code: 10000 }] })).toEqual([]);
    expect(parseCloudflare('x')).toEqual([]);
    expect(parseCloudflare([null, { result: {} }])).toEqual([]);
    expect(parseCloudflare(withServices({ A: [1] }, ['not a date']))).toEqual([]);
  });
});

describe('rankingUrl / backfillWindows', () => {
  it('asks for the Generative AI category with %20-style escaping', () => {
    expect(rankingUrl({ dateRange: '90d' })).toBe(
      'https://api.cloudflare.com/client/v4/radar/ranking/internet_services/timeseries_groups?serviceCategory=Generative%20AI&limit=20&dateRange=90d&format=JSON',
    );
    expect(rankingUrl({ dateStart: '2025-01-26T00:00:00.000Z', dateEnd: '2026-01-25T00:00:00.000Z' })).toBe(
      'https://api.cloudflare.com/client/v4/radar/ranking/internet_services/timeseries_groups?serviceCategory=Generative%20AI&limit=20&dateStart=2025-01-26T00%3A00%3A00.000Z&dateEnd=2026-01-25T00%3A00%3A00.000Z&format=JSON',
    );
  });

  it('covers 2025-01-26 up to now in windows of at most 364 days', () => {
    const w = backfillWindows(BACKFILL_START, new Date('2026-10-08T06:00:00Z'));
    expect(w).toEqual([
      ['2025-01-26T00:00:00.000Z', '2026-01-25T00:00:00.000Z'],
      ['2026-01-25T00:00:00.000Z', '2026-10-08T06:00:00.000Z'],
    ]);
    expect(backfillWindows(BACKFILL_START, new Date('2025-02-10T00:00:00Z'))).toEqual([['2025-01-26T00:00:00.000Z', '2025-02-10T00:00:00.000Z']]);
  });
});

describe('recentWindow', () => {
  it('starts on the 1st of the month two months back, so every emitted month is covered from its 1st day, and ends now', () => {
    expect(recentWindow(new Date('2026-10-08T06:00:00Z'))).toEqual(['2026-08-01T00:00:00.000Z', '2026-10-08T06:00:00.000Z']);
    expect(recentWindow(new Date('2026-10-01T00:00:00Z'))).toEqual(['2026-08-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z']);
    expect(recentWindow(new Date('2026-12-31T23:59:59Z'))).toEqual(['2026-10-01T00:00:00.000Z', '2026-12-31T23:59:59.000Z']);
  });

  it('crosses a year boundary and stays inside the 364-day range limit', () => {
    expect(recentWindow(new Date('2027-01-05T12:00:00Z'))).toEqual(['2026-11-01T00:00:00.000Z', '2027-01-05T12:00:00.000Z']);
    expect(recentWindow(new Date('2027-02-28T00:00:00Z'))[0]).toBe('2026-12-01T00:00:00.000Z');
    for (const d of ['2026-03-31T00:00:00Z', '2026-05-31T23:00:00Z', '2026-12-31T00:00:00Z']) {
      const [from, to] = recentWindow(new Date(d));
      expect(Date.parse(to) - Date.parse(from)).toBeLessThanOrEqual(364 * 86_400_000);
      expect(from.endsWith('-01T00:00:00.000Z')).toBe(true);
    }
  });
});

describe('fetchCloudflare', () => {
  const now = new Date('2026-10-08T06:00:00Z');
  const body = withServices({ 'ChatGPT / OpenAI': [1, 1], 'Claude / Anthropic': [3, 2] }, ['2026-10-06T00:00:00Z', '2026-10-07T00:00:00Z']);

  function stub(over: { env?: Record<string, string | undefined>; backfill?: boolean; reply?: unknown } = {}) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const logs: string[] = [];
    const ctx: FetchCtx = {
      env: over.env ?? { CLOUDFLARE_API_TOKEN: 'cf-test-token' },
      now,
      backfill: over.backfill ?? false,
      keys: () => [],
      fetchText: async () => '',
      fetchBytes: async () => new Uint8Array(),
      fetchJson: async <T>(url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return (over.reply ?? body) as T;
      },
      log: (m) => logs.push(m),
    };
    return { ctx, calls, logs };
  }

  it('requests from the 1st of the month two months back (not a bare 90d) with a bearer token and logs the exact service names', async () => {
    const { ctx, calls, logs } = stub();
    const raw = await fetchCloudflare(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(rankingUrl({ dateStart: '2026-08-01T00:00:00.000Z', dateEnd: '2026-10-08T06:00:00.000Z' }));
    expect(calls[0].url).not.toContain('dateRange');
    expect(calls[0].init?.headers).toEqual({ Authorization: 'Bearer cf-test-token' });
    expect(logs.join('\n')).toContain('ChatGPT / OpenAI | Claude / Anthropic');
    expect(logs.join('\n')).not.toContain('cf-test-token');
    expect(cloudflare.parse(raw, { now })).toEqual([
      { signal: 'cloudflare', key: 'ChatGPT / OpenAI', month: '2026-10', value: 1 },
      { signal: 'cloudflare', key: 'Claude / Anthropic', month: '2026-10', value: 2 },
    ]);
  });

  it('with backfill requests one call per window', async () => {
    const { ctx, calls } = stub({ backfill: true });
    const raw = await fetchCloudflare(ctx);
    expect(calls.map((c) => c.url)).toEqual(
      backfillWindows(BACKFILL_START, now).map(([dateStart, dateEnd]) => rankingUrl({ dateStart, dateEnd })),
    );
    expect(raw).toHaveLength(2);
  });

  it('backfill skips a window that fails (logged) and keeps the others', async () => {
    const { ctx, logs } = stub({ backfill: true });
    const ok = ctx.fetchJson;
    let n = 0;
    ctx.fetchJson = async <T>(url: string, init?: RequestInit) => {
      if (n++ === 0) throw new Error(`HTTP 503 for ${url}`);
      return ok<T>(url, init);
    };
    const raw = await fetchCloudflare(ctx);
    expect(raw).toHaveLength(1);
    const skipped = logs.filter((l) => l.includes('skipped'));
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain('2025-01-26..2026-01-25'); // the first window, by its dates
    expect(skipped[0]).toContain('HTTP 503');
    expect(skipped[0]).not.toContain('cf-test-token');
    expect(cloudflare.parse(raw, { now })).toHaveLength(2); // the second window's data still comes through
  });

  it('backfill also skips a window whose response has no series', async () => {
    const { ctx, logs } = stub({ backfill: true });
    const ok = ctx.fetchJson;
    let n = 0;
    ctx.fetchJson = async <T>(url: string, init?: RequestInit) => (n++ === 1 ? ({ success: false, result: null } as T) : ok<T>(url, init));
    const raw = await fetchCloudflare(ctx);
    expect(raw).toHaveLength(1);
    expect(logs.some((l) => l.includes('skipped') && l.includes('2026-01-25..2026-10-08') && l.includes('serie_0'))).toBe(true);
  });

  it('throws only when no window succeeds, with the cause in the message', async () => {
    const { ctx, logs } = stub({ backfill: true });
    ctx.fetchJson = async <T>(url: string) => {
      throw new Error(`HTTP 403 for ${url}`) as T;
    };
    await expect(fetchCloudflare(ctx)).rejects.toThrow(/no window succeeded.*HTTP 403/);
    expect(logs.filter((l) => l.includes('skipped'))).toHaveLength(2);
  });

  it('fails without a token or when the response has no series (e.g. wrong token scope)', async () => {
    await expect(fetchCloudflare(stub({ env: {} }).ctx)).rejects.toThrow(/CLOUDFLARE_API_TOKEN/);
    await expect(fetchCloudflare(stub({ reply: { success: false, errors: [{ code: 10000 }], result: null } }).ctx)).rejects.toThrow(/serie_0/);
    await expect(fetchCloudflare(stub({ reply: { success: true, result: {} } }).ctx)).rejects.toThrow(/serie_0/);
  });
});

describe('cloudflare module', () => {
  it('needs CLOUDFLARE_API_TOKEN and is an accumulating CC BY-NC scale source', () => {
    expect(cloudflare).toMatchObject({ id: 'cloudflare', role: 'scale', history: 'accumulate', needsEnv: ['CLOUDFLARE_API_TOKEN'] });
    expect(cloudflare.meta.license).toBe('CC BY-NC 4.0');
  });
});
