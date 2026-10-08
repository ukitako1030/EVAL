import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { latestLivebenchRelease, livebenchCoding } from '../../src/sources/livebench';
import type { FetchCtx } from '../../src/sources/types';
import type { Observation } from '../../src/core/types';

const file = (name: string) => readFileSync(new URL(`../fixtures/livebench/${name}`, import.meta.url), 'utf8');
const TABLE = file('sample.csv');
const CATEGORIES = JSON.parse(file('categories_2026_06_25.json')) as Record<string, string[]>;
const NOW = new Date('2026-10-12T06:00:00Z');
const parse = (raw: unknown, now = NOW): Observation[] => livebenchCoding.parse(raw, { now });
const byModel = (obs: Observation[], model: string) => obs.filter((o) => o.model === model);

describe('livebenchCoding.parse', () => {
  const obs = parse({ release: '2026-06-25', table: TABLE, categories: CATEGORIES });

  it('takes the mean of the Coding columns (code_generation, code_completion), computed by hand', () => {
    expect(CATEGORIES.Coding).toEqual(['code_generation', 'code_completion']);
    // claude-opus-4-5-...: code_completion 80.435, code_generation 78.873
    const [opus45] = byModel(obs, 'claude-opus-4-5-20251101-thinking-64k-high-effort');
    expect(opus45).toMatchObject({ series: 'livebench-coding', kind: 'percent', dateKind: 'snapshot', date: '2026-10-12' });
    expect(opus45.value).toBeCloseTo((80.435 + 78.873) / 2, 9);
    expect(opus45.value).toBeCloseTo(79.654, 9);
    // claude-opus-4-7-xhigh-effort: code_completion 78.261, code_generation 85.915
    const [opus47] = byModel(obs, 'claude-opus-4-7-xhigh-effort');
    expect(opus47.value).toBeCloseTo(82.088, 9);
    // Agentic Coding (javascript/typescript/python) is a separate category and does not leak in
    expect(Object.keys(CATEGORIES)).toContain('Agentic Coding');
  });

  it('emits one observation per model of the table, with no organisation (the CSV has none)', () => {
    expect(TABLE.trim().split('\n')).toHaveLength(70);
    expect(obs).toHaveLength(69);
    expect(new Set(obs.map((o) => o.model)).size).toBe(69);
    expect('org' in obs[0]).toBe(false);
  });

  it('dates every row with the injected now', () => {
    expect(new Set(obs.map((o) => o.date))).toEqual(new Set(['2026-10-12']));
    expect(new Set(parse({ table: TABLE, categories: CATEGORIES }, new Date('2027-01-05T23:59:59Z')).map((o) => o.date))).toEqual(
      new Set(['2027-01-05']),
    );
  });

  it('ignores empty, NaN and missing cells and skips models without any coding score', () => {
    const table = [
      'model,AMPS_Hard,code_completion,code_generation,javascript',
      'both,1,80,60,99',
      'only-generation,1,,60,99',
      'nan-completion,1,NaN,40,99',
      'none,1,,,99',
      'none-nan,1,NaN,nan,99',
      'short-row,1',
      ',1,50,50,99',
      'zero,1,0,0,99',
    ].join('\n');
    const rows = parse({ table, categories: CATEGORIES });
    expect(rows.map((o) => [o.model, o.value])).toEqual([
      ['both', 70],
      ['only-generation', 60],
      ['nan-completion', 40],
      ['zero', 0],
    ]);
  });

  it('follows the release’s own category file (older releases name the columns differently)', () => {
    const cats = JSON.parse(file('categories_2025_04_02.json')) as Record<string, string[]>;
    expect(cats.Coding).toEqual(['LCB_generation', 'coding_completion']);
    const old = parse({ release: '2025-04-02', table: file('sample_2025_04_02.csv'), categories: cats });
    expect(old).toHaveLength(32);
    expect(byModel(old, 'amazon.nova-pro-v1:0')[0].value).toBeCloseTo(20, 9);
    expect(byModel(old, 'chatgpt-4o-latest-2025-03-27')[0].value).toBeCloseTo((37.333 + 40) / 2, 9);
  });

  it('returns [] when the payload is unusable', () => {
    expect(parse(undefined)).toEqual([]);
    expect(parse('table')).toEqual([]);
    expect(parse({ table: TABLE })).toEqual([]);
    expect(parse({ table: TABLE, categories: {} })).toEqual([]);
    expect(parse({ table: TABLE, categories: { Coding: 'code_generation' } })).toEqual([]);
    expect(parse({ table: 42, categories: CATEGORIES })).toEqual([]);
  });

  it('declares the LiveBench meta, an accumulating history and the livebench-coding group', () => {
    expect(livebenchCoding).toMatchObject({
      id: 'livebench-coding',
      role: 'strength',
      group: 'livebench-coding',
      history: 'accumulate',
      meta: { license: 'Apache-2.0 / CC BY-SA 4.0', credit: 'LiveBench (livebench.ai), Apache-2.0 / CC BY-SA 4.0' },
    });
  });
});

describe('latestLivebenchRelease', () => {
  const dates = ['2024-07-26', '2024-06-24', '2025-04-02', '2026-06-25', '2026-01-08', '2025-12-23'];

  it('picks the newest date of the LIVE_BENCH_RELEASES set, whatever the order', () => {
    const py = `import os\nLIVE_BENCH_RELEASES = {${dates.map((d) => `"${d}"`).join(', ')}}\nOTHER = "2030-01-01"\n`;
    expect(latestLivebenchRelease(py)).toBe('2026-06-25');
  });

  it('ignores dates outside the definition and copes with multi-line sets, comments and lists', () => {
    const py = [
      '# updated 2031-02-03',
      'LAST_CHECK = "2031-02-03"',
      'LIVE_BENCH_RELEASES = {',
      '    "2024-07-26",  # first',
      '    "2026-06-25",',
      '    "2025-04-02",',
      '}',
      'if release in LIVE_BENCH_RELEASES: pass',
      'LIVE_BENCH_HF_ORGANIZATION = "livebench"  # 2032-01-01 ',
    ].join('\n');
    expect(latestLivebenchRelease(py)).toBe('2026-06-25');
    expect(latestLivebenchRelease('LIVE_BENCH_RELEASES: set[str] = {"2024-07-26", "2025-01-01"}')).toBe('2025-01-01');
    expect(latestLivebenchRelease("LIVE_BENCH_RELEASES = ['2024-07-26', '2025-01-01']")).toBe('2025-01-01');
  });

  it('throws when the definition is missing or holds no dates', () => {
    expect(() => latestLivebenchRelease('x = 1')).toThrow('LIVE_BENCH_RELEASES');
    expect(() => latestLivebenchRelease('LIVE_BENCH_RELEASES = set()')).toThrow('LIVE_BENCH_RELEASES');
  });
});

describe('livebenchCoding.fetch', () => {
  const COMMON =
    'LAST = "2031-01-01"\nLIVE_BENCH_RELEASES = {"2024-07-26", "2026-06-25", "2026-01-08"}\n';

  it('reads the newest release from common.py, then the table and categories of that release', async () => {
    const texts: string[] = [];
    const jsons: string[] = [];
    const ctx = {
      fetchText: async (url: string) => {
        texts.push(url);
        return url.endsWith('common.py') ? COMMON : TABLE;
      },
      fetchJson: async (url: string) => {
        jsons.push(url);
        return CATEGORIES;
      },
    } as unknown as FetchCtx;

    const raw = await livebenchCoding.fetch(ctx);

    expect(texts).toEqual([
      'https://raw.githubusercontent.com/LiveBench/LiveBench/main/livebench/common.py',
      'https://livebench.ai/table_2026_06_25.csv',
    ]);
    expect(jsons).toEqual(['https://livebench.ai/categories_2026_06_25.json']);
    expect(raw).toEqual({ release: '2026-06-25', table: TABLE, categories: CATEGORIES });
    expect(parse(raw)).toHaveLength(69);
  });

  it('propagates a download failure instead of returning a half-filled payload', async () => {
    const ctx = {
      fetchText: async (url: string) => {
        if (url.endsWith('common.py')) return COMMON;
        throw new Error('HTTP 404 for table');
      },
      fetchJson: async () => CATEGORIES,
    } as unknown as FetchCtx;
    await expect(livebenchCoding.fetch(ctx)).rejects.toThrow('HTTP 404');
  });
});
