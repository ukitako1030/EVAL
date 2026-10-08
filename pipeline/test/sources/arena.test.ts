import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parquetWriteBuffer } from 'hyparquet-writer';
import {
  arenaCoding,
  arenaCodingRaw,
  arenaImageEdit,
  arenaI2v,
  arenaModule,
  arenaT2i,
  arenaT2v,
  arenaText,
  arenaTextStyle,
  arenaWebdev,
} from '../../src/sources/arena';
import type { FetchCtx, StrengthModule } from '../../src/sources/types';

const fixture = (id: string): unknown[] => JSON.parse(readFileSync(new URL(`../fixtures/${id}/sample.rows.json`, import.meta.url), 'utf8'));
const ctx = { now: new Date('2026-10-12T06:00:00Z') };

describe('arena-text', () => {
  const obs = arenaText.parse(fixture('arena-text'), ctx);

  it('ignores the coding rows of the fixture', () => {
    const rows = fixture('arena-text') as { category: string; model_name: string; rating: number }[];
    const coding = rows.filter((r) => r.category === 'coding');
    expect(coding).toHaveLength(10);
    // o3 is 1409.08 overall and 1418.13 on the coding board; only the overall value may appear
    const o3 = obs.filter((o) => o.model === 'o3-2025-04-16' && o.date.startsWith('2025-05'));
    expect(o3.map((o) => o.value)).toEqual([1409.084701401796]);
    const codingValues = new Set(coding.map((r) => r.rating));
    expect(obs.some((o) => codingValues.has(o.value))).toBe(false);
  });

  it('keeps only the last snapshot of each month (2025-05-11 loses to 2025-05-19)', () => {
    const dates = [...new Set(obs.map((o) => o.date))];
    expect(dates).toEqual([
      '2023-05-08',
      '2023-12-06',
      '2024-01-09',
      '2024-06-02',
      '2025-01-05',
      '2025-05-19',
      '2025-11-05',
      '2026-04-02',
      '2026-08-12',
      '2026-10-02',
    ]);
    expect(obs.filter((o) => o.date === '2025-05-11')).toEqual([]);
    expect(obs.filter((o) => o.date === '2025-05-19')).toHaveLength(21);
  });

  it('maps an empty-string organization to undefined', () => {
    const row = obs.find((o) => o.model === 'dola-seed-2.0-pro' && o.date === '2026-04-02');
    expect(row).toBeDefined();
    expect(row!.org).toBeUndefined();
    expect('org' in row!).toBe(false);
  });

  it('maps one row to the exact observation', () => {
    expect(obs.find((o) => o.model === 'o3-2025-04-16' && o.date === '2025-05-19')).toEqual({
      series: 'arena-text',
      kind: 'elo',
      model: 'o3-2025-04-16',
      org: 'openai',
      date: '2025-05-19',
      dateKind: 'snapshot',
      value: 1409.084701401796,
    });
    // integer Elo of the 2023 era
    expect(obs.find((o) => o.model === 'vicuna-13b')).toEqual({
      series: 'arena-text',
      kind: 'elo',
      model: 'vicuna-13b',
      org: 'LMSYS',
      date: '2023-05-08',
      dateKind: 'snapshot',
      value: 1094,
    });
  });

  it('is deterministic: sorted by date, then rating descending', () => {
    const again = arenaText.parse([...fixture('arena-text')].reverse(), ctx);
    expect(again).toEqual(obs);
    for (let i = 1; i < obs.length; i++) {
      const [a, b] = [obs[i - 1], obs[i]];
      expect(a.date < b.date || (a.date === b.date && a.value >= b.value)).toBe(true);
    }
  });
});

describe('arena-coding-raw / arena-coding', () => {
  it('reads the coding category of the text fixture, last snapshot of the month only', () => {
    const obs = arenaCodingRaw.parse(fixture('arena-text'), ctx);
    expect(obs).toHaveLength(5);
    expect(obs.every((o) => o.series === 'arena-coding-raw' && o.date === '2025-05-19')).toBe(true);
    expect(obs[0]).toEqual({
      series: 'arena-coding-raw',
      kind: 'elo',
      model: 'o3-2025-04-16',
      org: 'openai',
      date: '2025-05-19',
      dateKind: 'snapshot',
      value: 1418.133791728032,
    });
  });
  it('yields nothing when the payload has no coding rows', () => {
    expect(arenaCoding.parse(fixture('arena-text-style'), ctx)).toEqual([]);
  });
});

describe('arena-image-edit', () => {
  const rows = fixture('arena-image-edit') as { category: string; leaderboard_publish_date: string; model_name: string }[];
  const obs = arenaImageEdit.parse(rows, ctx);

  it('emits nothing for dates that only had multi_image_edit rows', () => {
    expect(rows.some((r) => r.leaderboard_publish_date === '2026-01-23' && r.category === 'multi_image_edit')).toBe(true);
    expect(rows.some((r) => r.leaderboard_publish_date === '2026-01-23' && r.category === 'overall')).toBe(false);
    expect(obs.filter((o) => o.date === '2026-01-23')).toEqual([]);
  });

  it('does not let multi_image_edit rows leak into the overall snapshot of the same date', () => {
    const multi = new Set(rows.filter((r) => r.category === 'multi_image_edit' && r.leaderboard_publish_date === '2026-10-06').map((r) => r.model_name));
    const overall = new Set(rows.filter((r) => r.category === 'overall' && r.leaderboard_publish_date === '2026-10-06').map((r) => r.model_name));
    const latest = obs.filter((o) => o.date === '2026-10-06');
    expect(latest).toHaveLength(overall.size);
    expect(latest.every((o) => overall.has(o.model))).toBe(true);
    expect(multi.size).toBeGreaterThan(0);
  });

  it('keeps one snapshot per month', () => {
    expect([...new Set(obs.map((o) => o.date))]).toEqual(['2025-06-24', '2025-10-01', '2026-01-26', '2026-10-06']);
  });
});

describe('arena-t2i', () => {
  it('keeps one snapshot per month (a 09-30 / 10-01 pair stays) and only the overall category', () => {
    const obs = arenaT2i.parse(fixture('arena-t2i'), ctx);
    const dates = [...new Set(obs.map((o) => o.date))];
    expect(dates).toEqual(['2025-01-05', '2025-06-24', '2025-09-30', '2025-10-01', '2026-01-29', '2026-10-07']);
    expect(obs.filter((o) => o.date === '2026-10-07')).toHaveLength(82);
    expect(obs.filter((o) => o.date === '2025-01-05')).toHaveLength(7);
    // english / chinese rows of 2025-01-24 would have made a second January snapshot
    expect(obs.filter((o) => o.date.startsWith('2025-01'))).toHaveLength(7);
  });
});

describe('every arena fixture', () => {
  const cases: [string, StrengthModule][] = [
    ['arena-text', arenaText],
    ['arena-text-style', arenaTextStyle],
    ['arena-webdev', arenaWebdev],
    ['arena-t2i', arenaT2i],
    ['arena-image-edit', arenaImageEdit],
    ['arena-t2v', arenaT2v],
    ['arena-i2v', arenaI2v],
  ];
  it.each(cases)('%s parses to finite elo snapshots under its own series id', (id, mod) => {
    const obs = mod.parse(fixture(id), ctx);
    expect(obs.length).toBeGreaterThan(0);
    for (const o of obs) {
      expect(o.kind).toBe('elo');
      expect(o.dateKind).toBe('snapshot');
      expect(o.series).toBe(id);
      expect(Number.isFinite(o.value)).toBe(true);
      expect(o.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.model).not.toBe('');
      expect(o.org === undefined || o.org !== '').toBe(true);
    }
    // at most one snapshot date per calendar month
    const months = new Map<string, Set<string>>();
    for (const o of obs) months.set(o.date.slice(0, 7), (months.get(o.date.slice(0, 7)) ?? new Set()).add(o.date));
    for (const dates of months.values()) expect(dates.size).toBe(1);
  });

  it('video fixtures turn empty organizations into undefined', () => {
    const t2v = arenaT2v.parse(fixture('arena-t2v'), ctx);
    expect(t2v.some((o) => o.org === undefined)).toBe(true);
    expect(t2v.some((o) => o.org !== undefined)).toBe(true);
  });
});

describe('parse robustness', () => {
  const row = (over: Record<string, unknown>) => ({
    model_name: 'm',
    organization: 'o',
    rating: 1000,
    category: 'overall',
    leaderboard_publish_date: '2026-01-10',
    ...over,
  });

  it('skips bad rows without throwing', () => {
    const raw = [
      row({ model_name: 'ok' }),
      row({ model_name: 'nan', rating: Number.NaN }),
      row({ model_name: 'null', rating: null }),
      row({ model_name: 'inf', rating: Number.POSITIVE_INFINITY }),
      row({ model_name: 'nodate', leaderboard_publish_date: 'soon' }),
      row({ model_name: '' }),
      null,
      'junk',
      42,
    ];
    expect(arenaText.parse(raw, ctx).map((o) => o.model)).toEqual(['ok']);
  });

  it('a date whose only rows have non-finite ratings does not claim its month', () => {
    const raw = [row({ model_name: 'early', leaderboard_publish_date: '2026-01-05' }), row({ model_name: 'late', rating: Number.NaN, leaderboard_publish_date: '2026-01-20' })];
    expect(arenaText.parse(raw, ctx).map((o) => [o.model, o.date])).toEqual([['early', '2026-01-05']]);
  });

  it('returns [] for an unusable payload', () => {
    expect(arenaText.parse(null, ctx)).toEqual([]);
    expect(arenaText.parse({ rows: [] }, ctx)).toEqual([]);
    expect(arenaText.parse([], ctx)).toEqual([]);
  });
});

describe('module constants', () => {
  it.each([
    [arenaText, 'arena-text', 'arena-text', 1],
    [arenaTextStyle, 'arena-text-style', 'arena-text', 2],
    [arenaCoding, 'arena-coding', 'arena-coding', 2],
    [arenaCodingRaw, 'arena-coding-raw', 'arena-coding', 1],
    [arenaWebdev, 'arena-webdev', 'arena-webdev', 1],
    [arenaT2i, 'arena-t2i', 'arena-image', 1],
    [arenaImageEdit, 'arena-image-edit', 'arena-image', 1],
    [arenaT2v, 'arena-t2v', 'arena-video', 1],
    [arenaI2v, 'arena-i2v', 'arena-video', 1],
  ] as [StrengthModule, string, string, number][])('%s', (mod, id, group, priority) => {
    expect(mod.id).toBe(id);
    expect(mod.role).toBe('strength');
    expect(mod.group).toBe(group);
    expect(mod.priority).toBe(priority);
    expect(mod.history).toBe('full');
    expect(mod.static).toBeUndefined();
    expect(mod.meta.url).toBe('https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset');
    expect(mod.meta.license).toBe('CC BY 4.0');
    expect(mod.meta.credit).toBe('Arena leaderboard dataset (lmarena-ai/leaderboard-dataset), CC BY 4.0');
    expect(mod.meta.name).toMatch(/^Arena \(.+\)$/);
  });
});

describe('fetch (offline, synthetic parquet)', () => {
  const file = new Uint8Array(
    parquetWriteBuffer({
      columnData: [
        { name: 'model_name', data: ['a', 'b', 'c'], type: 'STRING' },
        { name: 'organization', data: ['x', '', 'z'], type: 'STRING' },
        { name: 'license', data: ['Proprietary', 'MIT', 'MIT'], type: 'STRING' },
        { name: 'rating', data: [1500.5, 1400.25, 1450], type: 'DOUBLE' },
        { name: 'vote_count', data: [10n, 20n, 30n], type: 'INT64' },
        { name: 'category', data: ['overall', 'overall', 'coding'], type: 'STRING' },
        { name: 'leaderboard_publish_date', data: ['2026-10-01', '2026-10-01', '2026-10-01'], type: 'STRING' },
      ],
    }),
  );

  const makeCtx = (calls: string[]): FetchCtx => ({
    env: {},
    now: new Date('2026-10-12T06:00:00Z'),
    backfill: false,
    keys: () => [],
    fetchText: async () => '',
    fetchBytes: async (url) => {
      calls.push(url);
      return file;
    },
    fetchJson: async <T>() => ({}) as T,
    log: () => {},
  });

  it('downloads the subset parquet once for modules sharing it and filters by category', async () => {
    const calls: string[] = [];
    const c = makeCtx(calls);
    const mod = arenaModule({ id: 'arena-synth', subset: 'synthetic_subset', group: 'g', name: 'Synthetic' });
    const coding = arenaModule({ id: 'arena-synth-coding', subset: 'synthetic_subset', category: 'coding', group: 'g', name: 'Synthetic coding' });

    const rawOverall = await mod.fetch(c);
    const rawCoding = await coding.fetch(c);

    expect(calls).toEqual(['https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/synthetic_subset/full-00000-of-00001.parquet']);
    expect(rawOverall).toEqual([
      { model_name: 'a', organization: 'x', rating: 1500.5, category: 'overall', leaderboard_publish_date: '2026-10-01' },
      { model_name: 'b', organization: '', rating: 1400.25, category: 'overall', leaderboard_publish_date: '2026-10-01' },
    ]);
    expect(rawCoding).toEqual([{ model_name: 'c', organization: 'z', rating: 1450, category: 'coding', leaderboard_publish_date: '2026-10-01' }]);
    expect(() => JSON.stringify(rawOverall)).not.toThrow();

    expect(mod.parse(rawOverall, ctx)).toEqual([
      { series: 'arena-synth', kind: 'elo', model: 'a', org: 'x', date: '2026-10-01', dateKind: 'snapshot', value: 1500.5 },
      { series: 'arena-synth', kind: 'elo', model: 'b', date: '2026-10-01', dateKind: 'snapshot', value: 1400.25 },
    ]);
  });
});
