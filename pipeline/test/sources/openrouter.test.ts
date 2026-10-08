import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dateWindows, fetchOpenRouter, openrouter, parseOpenRouter } from '../../src/sources/openrouter';
import type { FetchCtx } from '../../src/sources/types';

const csv = readFileSync(new URL('../fixtures/openrouter/sample.csv', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../fixtures/openrouter/sample-manifest.json', import.meta.url), 'utf8')) as {
  files: { csv: { url: string } };
};
const now = new Date('2026-10-08T06:00:00Z');

/**
 * The fixture's 2026-09-30 rows copied to 2026-09-01: a window that starts on the 1st of September, so September counts as a
 * complete month (two days with identical shares). The raw fixture starts on 09-30, i.e. September is only a one-day tail.
 */
const fromSep1 = (() => {
  const lines = csv.trim().split(/\r?\n/);
  const copied = lines.slice(1).filter((l) => l.startsWith('2026-09-30,')).map((l) => l.replace('2026-09-30', '2026-09-01'));
  return [lines[0], ...copied, ...lines.slice(1)].join('\r\n');
})();

describe('parseOpenRouter (window 2026-09-01, 2026-09-30, 2026-10-01 and 2026-10-07)', () => {
  const out = parseOpenRouter(fromSep1);
  const at = (key: string, month: string) => out.find((o) => o.key === key && o.month === month);

  it('averages the daily token share per (slug, month)', () => {
    // 2026-09 has two (identical) days in the file, 2026-10 has two
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
    // 50 models per day: 9-01 and 9-30 -> 50, plus the models first listed on later days
    const pairs = new Set(
      fromSep1
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
    expect(parseOpenRouter(fromSep1.replace(/\r\n/g, '\n'))).toEqual(out);
  });

  it('skips bad rows and returns [] for an unusable payload', () => {
    const text = [
      'date,model_permaslug,rank,total_tokens,share_of_daily_tokens',
      '2026-10-01,a/ok,1,100,0.5',
      'not-a-date,a/bad-date,2,100,0.2',
      '2026-10-01,,3,100,0.2',
      '2026-10-01,a/zero,4,0,0',
      '2026-10-01,a/nan,5,100,abc',
      '2026-10-01,other,,100,0.5',
    ].join('\n');
    expect(parseOpenRouter(text)).toEqual([{ signal: 'openrouter', key: 'a/ok', month: '2026-10', value: 0.5 }]);
    expect(parseOpenRouter('')).toEqual([]);
    expect(parseOpenRouter('<html>rate limited</html>')).toEqual([]);
    expect(parseOpenRouter(null)).toEqual([]);
    expect(parseOpenRouter({})).toEqual([]);
  });
});

describe('parseOpenRouter: the first month of a rolling 30-day window', () => {
  // `accumulate` sources let the latest fetch of a (signal, key, month) win, so a 1-2 day tail of a month must never be emitted
  const header = 'date,model_permaslug,rank,total_tokens,share_of_daily_tokens';
  const row = (date: string, slug = 'a/m', share = 0.5) => `${date},${slug},1,100,${share}`;
  const months = (out: { month: string }[]) => [...new Set(out.map((o) => o.month))];

  it('drops a month whose 1st day is outside the window (the fixture starts on 09-30, a one-day tail)', () => {
    const out = parseOpenRouter(csv);
    expect(months(out)).toEqual(['2026-10']);
    expect(out.some((o) => o.month === '2026-09')).toBe(false);
  });

  it('keeps the running month: it starts inside the window, however few days it has so far', () => {
    const out = parseOpenRouter([header, row('2026-09-29'), row('2026-09-30'), row('2026-10-01', 'a/m', 0.2)].join('\n'));
    expect(out).toEqual([{ signal: 'openrouter', key: 'a/m', month: '2026-10', value: 0.2 }]);
  });

  it('keeps the first month when the window starts exactly on its 1st day', () => {
    const out = parseOpenRouter([header, row('2026-09-01', 'a/m', 0.4), row('2026-09-02', 'a/m', 0.2), row('2026-10-01', 'a/m', 0.1)].join('\n'));
    expect(out.map((o) => o.month)).toEqual(['2026-09', '2026-10']);
    expect(out[0].value).toBeCloseTo(0.3, 12);
    expect(out[1].value).toBe(0.1);
  });

  it('drops only the leading month of a 30-day window that starts mid-month', () => {
    const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 8 + i)).toISOString().slice(0, 10)); // 09-08 … 10-07
    const out = parseOpenRouter([header, ...days.map((d) => row(d))].join('\r\n'));
    expect(months(out)).toEqual(['2026-10']);
    expect(out[0].value).toBe(0.5);
  });

  it('judges the window by all its dated rows, including `other` rows', () => {
    const late = parseOpenRouter([header, row('2026-09-30', 'other'), row('2026-10-01')].join('\n'));
    expect(months(late)).toEqual(['2026-10']);
    const early = parseOpenRouter([header, '2026-09-01,other,,100,0.5', row('2026-09-02')].join('\n'));
    expect(months(early)).toEqual(['2026-09']);
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
  it('splits 2025-01-01 … 2026-10-07 into month-aligned windows of at most 366 days', () => {
    expect(dateWindows('2025-01-01', '2026-10-07')).toEqual([
      ['2025-01-01', '2025-12-31'],
      ['2026-01-01', '2026-10-07'],
    ]);
    expect(dateWindows('2025-01-01', '2025-03-01')).toEqual([['2025-01-01', '2025-03-01']]);
    expect(dateWindows('2025-01-01', '2025-01-01')).toEqual([['2025-01-01', '2025-01-01']]);
    expect(dateWindows('2025-01-02', '2025-01-01')).toEqual([]);
  });

  it('starts every window on a 1st and ends every window but the last on a month end, so no month is split', () => {
    const w = dateWindows('2025-01-01', '2026-10-07', 100);
    expect(w).toEqual([
      ['2025-01-01', '2025-03-31'],
      ['2025-04-01', '2025-06-30'],
      ['2025-07-01', '2025-09-30'],
      ['2025-10-01', '2025-12-31'],
      ['2026-01-01', '2026-03-31'],
      ['2026-04-01', '2026-06-30'],
      ['2026-07-01', '2026-10-07'], // 99 days: the last window simply ends at `end`
    ]);
    for (const [from, to] of w) {
      expect(from.endsWith('-01')).toBe(true);
      expect((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1).toBeLessThanOrEqual(100);
    }
    // a window never ends mid-month except the last one
    for (const [, to] of w.slice(0, -1)) expect(new Date(Date.parse(to) + 86_400_000).getUTCDate()).toBe(1);
  });

  it('copes with a window limit shorter than a month (cuts inside the month rather than looping forever)', () => {
    expect(dateWindows('2025-01-01', '2025-01-20', 10)).toEqual([
      ['2025-01-01', '2025-01-10'],
      ['2025-01-11', '2025-01-20'],
    ]);
  });
});

describe('fetchOpenRouter', () => {
  const DATED_URL = manifest.files.csv.url; // https://openrouter.ai/api/v1/datasets/exports/rankings-daily/2026-10-08.csv
  const MANIFEST_URL = 'https://openrouter.ai/api/v1/datasets/exports/rankings-daily/latest.manifest.json';
  const LATEST_URL = 'https://openrouter.ai/api/v1/datasets/exports/rankings-daily/latest.csv';

  function stub(over: { env?: Record<string, string | undefined>; backfill?: boolean; manifest?: unknown; failUrls?: string[] } = {}) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const logs: string[] = [];
    const ctx: FetchCtx = {
      env: over.env ?? {},
      now,
      backfill: over.backfill ?? false,
      keys: () => [],
      fetchText: async (url, init) => {
        calls.push({ url, init });
        if (over.failUrls?.includes(url)) throw new Error(`HTTP 404 for ${url}`);
        return csv;
      },
      fetchBytes: async () => new Uint8Array(),
      fetchJson: async <T>(url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === MANIFEST_URL) {
          if (over.failUrls?.includes(url)) throw new Error(`HTTP 503 for ${url}`);
          return ('manifest' in over ? over.manifest : manifest) as T;
        }
        const start = /start_date=([\d-]+)/.exec(url)![1];
        return { data: [{ date: start, model_permaslug: `x/${start}`, total_tokens: '10' }, { date: start, model_permaslug: 'other', total_tokens: '10' }] } as T;
      },
      log: (m) => logs.push(m),
    };
    return { ctx, calls, logs };
  }

  it('without a key reads the manifest, then the newest dated CSV it names, not latest.csv (which can mix snapshots)', async () => {
    const plain = stub();
    expect(await fetchOpenRouter(plain.ctx)).toBe(csv);
    expect(DATED_URL).toBe('https://openrouter.ai/api/v1/datasets/exports/rankings-daily/2026-10-08.csv');
    expect(plain.calls.map((c) => c.url)).toEqual([MANIFEST_URL, DATED_URL]);
  });

  it('keeps reading the keyless exports when asked to backfill without a key (with a note)', async () => {
    const bf = stub({ backfill: true });
    expect(await fetchOpenRouter(bf.ctx)).toBe(csv);
    expect(bf.calls.map((c) => c.url)).toEqual([MANIFEST_URL, DATED_URL]);
    expect(bf.logs.some((l) => l.includes('OPENROUTER_API_KEY'))).toBe(true);
  });

  it('falls back to latest.csv when the manifest cannot be read, has no csv url, or names an unexpected url', async () => {
    const down = stub({ failUrls: [MANIFEST_URL] });
    expect(await fetchOpenRouter(down.ctx)).toBe(csv);
    expect(down.calls.map((c) => c.url)).toEqual([MANIFEST_URL, LATEST_URL]);
    expect(down.logs.some((l) => l.includes('latest.csv'))).toBe(true);

    const unexpected = [
      {},
      null,
      { files: {} },
      { files: { csv: { url: 5 } } },
      { files: { csv: { url: 'https://evil.example/2026-10-08.csv' } } },
      { files: { csv: { url: LATEST_URL } } },
    ];
    for (const bad of unexpected) {
      const s = stub({ manifest: bad });
      expect(await fetchOpenRouter(s.ctx)).toBe(csv);
      expect(s.calls.map((c) => c.url)).toEqual([MANIFEST_URL, LATEST_URL]);
    }
  });

  it('falls back to latest.csv when the dated file cannot be fetched', async () => {
    const s = stub({ failUrls: [DATED_URL] });
    expect(await fetchOpenRouter(s.ctx)).toBe(csv);
    expect(s.calls.map((c) => c.url)).toEqual([MANIFEST_URL, DATED_URL, LATEST_URL]);
  });

  it('with a key but no backfill still uses the keyless exports, without the key', async () => {
    const s = stub({ env: { OPENROUTER_API_KEY: 'sk-test' } });
    await fetchOpenRouter(s.ctx);
    expect(s.calls.map((c) => c.url)).toEqual([MANIFEST_URL, DATED_URL]);
    expect(s.calls.every((c) => c.init === undefined)).toBe(true);
  });

  it('with a key and backfill walks 2025-01-01 … yesterday in month-aligned windows of ≤366 days with a bearer token', async () => {
    const { ctx, calls } = stub({ env: { OPENROUTER_API_KEY: 'sk-test' }, backfill: true });
    const raw = (await fetchOpenRouter(ctx)) as { data: { date: string }[] };
    expect(calls.map((c) => c.url)).toEqual([
      'https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=2025-01-01&end_date=2025-12-31&period=day',
      'https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=2026-01-01&end_date=2026-10-07&period=day',
    ]);
    for (const c of calls) expect(c.init?.headers).toEqual({ Authorization: 'Bearer sk-test' });
    expect(raw.data.map((r) => r.date)).toEqual(['2025-01-01', '2025-01-01', '2026-01-01', '2026-01-01']);
    expect(openrouter.parse(raw, { now })).toHaveLength(2); // `other` is not a model
  });

  it('every month of a keyed backfill lies wholly inside one window (so none is a short tail)', async () => {
    const { ctx, calls } = stub({ env: { OPENROUTER_API_KEY: 'sk-test' }, backfill: true });
    ctx.now = new Date('2027-03-15T00:00:00Z');
    await fetchOpenRouter(ctx);
    const windows = calls.map((c) => [/start_date=([\d-]+)/.exec(c.url)![1], /end_date=([\d-]+)/.exec(c.url)![1]]);
    expect(windows).toEqual([
      ['2025-01-01', '2025-12-31'],
      ['2026-01-01', '2026-12-31'],
      ['2027-01-01', '2027-03-14'],
    ]);
    for (const [from] of windows) expect(from.endsWith('-01')).toBe(true);
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
