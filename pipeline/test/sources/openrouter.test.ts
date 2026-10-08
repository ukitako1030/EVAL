import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dateWindows, fetchOpenRouter, openrouter, parseOpenRouter } from '../../src/sources/openrouter';
import type { FetchCtx } from '../../src/sources/types';

const csv = readFileSync(new URL('../fixtures/openrouter/sample.csv', import.meta.url), 'utf8');
const now = new Date('2026-10-08T06:00:00Z');

describe('parseOpenRouter (fixture: 2026-09-30, 2026-10-01 and 2026-10-07)', () => {
  const out = parseOpenRouter(csv);
  const at = (key: string, month: string) => out.find((o) => o.key === key && o.month === month);

  it('averages the daily token share per (slug, month)', () => {
    // 2026-09 has one day in the file, 2026-10 has two
    expect(at('anthropic/claude-opus-5.5-20260921', '2026-09')).toEqual({
      signal: 'openrouter',
      key: 'anthropic/claude-opus-5.5-20260921',
      month: '2026-09',
      value: 0.018032923073822982,
    });
    expect(at('anthropic/claude-opus-5.5-20260921', '2026-10')!.value).toBeCloseTo((0.015292476305202387 + 0.035150820285933713) / 2, 15);
    expect(at('deepseek/deepseek-v4.1-flash-20260910', '2026-10')!.value).toBeCloseTo((0.15138091588276595 + 0.2993197303783515) / 2, 15);
    expect(at('openai/gpt-6-luna-20260922', '2026-09')!.value).toBe(0.04440567077859936);
  });

  it('divides by the days present in the month, so a model listed on one of two days counts half', () => {
    // stealth/space-bunny-alpha: 22.0 % on 10-01, not listed on 10-07 -> mean over the 2 days present
    expect(at('stealth/space-bunny-alpha', '2026-10')!.value).toBeCloseTo(0.2203560810912277 / 2, 15);
    expect(at('qwen/qwen3.7-flash-20260727', '2026-10')!.value).toBeCloseTo(0.0027774321291856386 / 2, 15);
    expect(at('upstage/solar-pro4-20260810', '2026-10')!.value).toBeCloseTo(0.007454119837492597 / 2, 15);
    expect(at('qwen/qwen3.7-flash-20260727', '2026-09')).toBeUndefined(); // absent, not 0
  });

  it('is additive: all model slugs of a month sum to the mean of (1 − other)', () => {
    const oct = out.filter((o) => o.month === '2026-10').reduce((a, o) => a + o.value, 0);
    expect(oct).toBeCloseTo(1 - (0.06318046578703666 + 0.07052741120831148) / 2, 12);
    const sep = out.filter((o) => o.month === '2026-09').reduce((a, o) => a + o.value, 0);
    expect(sep).toBeCloseTo(1 - 0.0615291472011154, 12);
  });

  it('leaves out the `other` bucket and emits only positive finite values, sorted by month then slug', () => {
    expect(out.some((o) => o.key === 'other')).toBe(false);
    expect(out.every((o) => o.signal === 'openrouter' && Number.isFinite(o.value) && o.value > 0 && o.value <= 1)).toBe(true);
    const order = out.map((o) => `${o.month} ${o.key}`);
    expect(order).toEqual([...order].sort());
    // 50 models per day: 9-30 -> 50, plus the models first listed on later days
    const pairs = new Set(
      csv
        .trim()
        .split(/\r?\n/)
        .slice(1)
        .map((l) => l.split(','))
        .filter(([, slug]) => slug !== 'other')
        .map(([date, slug]) => `${date.slice(0, 7)} ${slug}`),
    );
    expect(out).toHaveLength(pairs.size);
    expect(out.filter((o) => o.month === '2026-09')).toHaveLength(50);
  });

  it('gives the same result for CRLF line endings (the real export uses CRLF)', () => {
    expect(parseOpenRouter(csv.replace(/\n/g, '\r\n'))).toEqual(out);
  });

  it('skips bad rows and returns [] for an unusable payload', () => {
    const text = [
      'date,model_permaslug,rank,total_tokens,share_of_daily_tokens',
      '2026-09-30,a/ok,1,100,0.5',
      'not-a-date,a/bad-date,2,100,0.2',
      '2026-09-30,,3,100,0.2',
      '2026-09-30,a/zero,4,0,0',
      '2026-09-30,a/nan,5,100,abc',
      '2026-09-30,other,,100,0.5',
    ].join('\n');
    expect(parseOpenRouter(text)).toEqual([{ signal: 'openrouter', key: 'a/ok', month: '2026-09', value: 0.5 }]);
    expect(parseOpenRouter('')).toEqual([]);
    expect(parseOpenRouter('<html>rate limited</html>')).toEqual([]);
    expect(parseOpenRouter(null)).toEqual([]);
    expect(parseOpenRouter({})).toEqual([]);
  });
});

describe('parseOpenRouter (keyed API rows)', () => {
  it('derives the share from tokens / the day total, `other` row included', () => {
    const data = [
      { date: '2026-05-10', model_permaslug: 'openai/gpt-4o-2024-05-13', total_tokens: '600' },
      { date: '2026-05-10', model_permaslug: 'anthropic/claude-x', total_tokens: '300' },
      { date: '2026-05-10', model_permaslug: 'other', total_tokens: '100' },
      { date: '2026-05-11', model_permaslug: 'openai/gpt-4o-2024-05-13', total_tokens: '200' },
      { date: '2026-05-11', model_permaslug: 'other', total_tokens: '200' },
      { date: '2026-06-01', model_permaslug: 'anthropic/claude-x', total_tokens: 50 },
      { date: '2026-06-01', model_permaslug: 'bad', total_tokens: 'many' },
    ];
    const out = parseOpenRouter({ data });
    expect(out).toHaveLength(3);
    const get = (k: string, m: string) => out.find((o) => o.key === k && o.month === m)!.value;
    expect(get('openai/gpt-4o-2024-05-13', '2026-05')).toBeCloseTo((0.6 + 0.5) / 2, 12);
    expect(get('anthropic/claude-x', '2026-05')).toBeCloseTo((0.3 + 0) / 2, 12);
    expect(get('anthropic/claude-x', '2026-06')).toBe(1);
  });
});

describe('dateWindows', () => {
  it('splits 2025-01-01 … 2026-10-07 into windows of at most 366 days', () => {
    expect(dateWindows('2025-01-01', '2026-10-07')).toEqual([
      ['2025-01-01', '2026-01-01'],
      ['2026-01-02', '2026-10-07'],
    ]);
    expect(dateWindows('2025-01-01', '2025-03-01')).toEqual([['2025-01-01', '2025-03-01']]);
    expect(dateWindows('2025-01-01', '2025-01-01')).toEqual([['2025-01-01', '2025-01-01']]);
    expect(dateWindows('2025-01-02', '2025-01-01')).toEqual([]);
  });
});

describe('fetchOpenRouter', () => {
  function stub(over: { env?: Record<string, string | undefined>; backfill?: boolean } = {}) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const logs: string[] = [];
    const ctx: FetchCtx = {
      env: over.env ?? {},
      now,
      backfill: over.backfill ?? false,
      keys: () => [],
      fetchText: async (url, init) => {
        calls.push({ url, init });
        return csv;
      },
      fetchBytes: async () => new Uint8Array(),
      fetchJson: async <T>(url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const start = /start_date=([\d-]+)/.exec(url)![1];
        return { data: [{ date: start, model_permaslug: `x/${start}`, total_tokens: '10' }, { date: start, model_permaslug: 'other', total_tokens: '10' }] } as T;
      },
      log: (m) => logs.push(m),
    };
    return { ctx, calls, logs };
  }

  it('without a key fetches the keyless 30-day CSV, even when asked to backfill (with a note)', async () => {
    const plain = stub();
    expect(await fetchOpenRouter(plain.ctx)).toBe(csv);
    expect(plain.calls.map((c) => c.url)).toEqual(['https://openrouter.ai/api/v1/datasets/exports/rankings-daily/latest.csv']);

    const bf = stub({ backfill: true });
    expect(await fetchOpenRouter(bf.ctx)).toBe(csv);
    expect(bf.logs.some((l) => l.includes('OPENROUTER_API_KEY'))).toBe(true);
  });

  it('with a key but no backfill still uses the keyless CSV', async () => {
    const s = stub({ env: { OPENROUTER_API_KEY: 'sk-test' } });
    await fetchOpenRouter(s.ctx);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].url).toContain('/exports/rankings-daily/latest.csv');
    expect(s.calls[0].init).toBeUndefined();
  });

  it('with a key and backfill walks 2025-01-01 … yesterday in windows of ≤366 days with a bearer token', async () => {
    const { ctx, calls } = stub({ env: { OPENROUTER_API_KEY: 'sk-test' }, backfill: true });
    const raw = (await fetchOpenRouter(ctx)) as { data: { date: string }[] };
    expect(calls.map((c) => c.url)).toEqual([
      'https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=2025-01-01&end_date=2026-01-01&period=day',
      'https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=2026-01-02&end_date=2026-10-07&period=day',
    ]);
    for (const c of calls) expect(c.init?.headers).toEqual({ Authorization: 'Bearer sk-test' });
    expect(raw.data.map((r) => r.date)).toEqual(['2025-01-01', '2025-01-01', '2026-01-02', '2026-01-02']);
    expect(openrouter.parse(raw, { now })).toHaveLength(2); // `other` is not a model
  });

  it('fails when a keyed response has no data array', async () => {
    const s = stub({ env: { OPENROUTER_API_KEY: 'sk-test' }, backfill: true });
    s.ctx.fetchJson = async <T>() => ({ error: { code: 401 } }) as T;
    await expect(fetchOpenRouter(s.ctx)).rejects.toThrow(/no data/);
  });
});

describe('openrouter module', () => {
  it('declares an accumulating CC BY 4.0 scale source', () => {
    expect(openrouter).toMatchObject({ id: 'openrouter', role: 'scale', history: 'accumulate' });
    expect(openrouter.meta.license).toBe('CC BY 4.0');
    expect(openrouter.meta.credit).toBe('Source: OpenRouter (openrouter.ai/rankings), as of <date>');
    expect(openrouter.needsEnv).toBeUndefined(); // the key is optional
  });
});
