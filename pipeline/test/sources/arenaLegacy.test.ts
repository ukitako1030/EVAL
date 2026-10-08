import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arenaLegacy } from '../../src/sources/arenaLegacy';
import { runFetch } from '../../src/sources/run';
import { loadSource } from '../../src/raw/store';
import type { Observation } from '../../src/core/types';
import type { FetchCtx } from '../../src/sources/types';

const ctx = { now: new Date('2026-10-12T06:00:00Z') };
const fetchCtx = (): FetchCtx => ({
  env: {},
  now: ctx.now,
  backfill: false,
  keys: () => [],
  fetchText: async () => '',
  fetchBytes: async () => new Uint8Array(),
  fetchJson: async <T>() => ({}) as T,
  log: () => {},
});

const good = (over: Partial<Observation> = {}): Observation => ({
  series: 'arena-legacy',
  kind: 'elo',
  model: 'claude-2',
  org: 'Anthropic',
  date: '2023-08-02',
  dateKind: 'snapshot',
  value: 1135,
  ...over,
});

describe('arenaLegacy module', () => {
  it('is a static, low-priority member of the arena-text group', () => {
    expect(arenaLegacy.id).toBe('arena-legacy');
    expect(arenaLegacy.role).toBe('strength');
    expect(arenaLegacy.group).toBe('arena-text');
    expect(arenaLegacy.priority).toBe(3);
    expect(arenaLegacy.history).toBe('full');
    expect(arenaLegacy.static).toBe(true);
    expect(arenaLegacy.meta.license).toBe('Apache-2.0');
    expect(arenaLegacy.meta.credit).toContain('lmarena-ai/arena-leaderboard');
    expect(arenaLegacy.meta.credit).toContain('Apache-2.0');
  });

  it('fetch rejects: the data is imported by a script', async () => {
    await expect(arenaLegacy.fetch(fetchCtx())).rejects.toThrow('static source: run scripts/import_arena_legacy.py');
  });
});

describe('arenaLegacy.parse', () => {
  it('keeps valid items unchanged', () => {
    const noOrg: Observation = { series: 'arena-legacy', kind: 'elo', model: 'x', date: '2023-08-02', dateKind: 'snapshot', value: 1000.5 };
    const items = [good(), good({ model: 'gpt-4', org: 'OpenAI', value: 1251, date: '2023-05-22' }), noOrg];
    expect(arenaLegacy.parse(items, ctx)).toEqual(items);
  });

  it('drops an item with a non-finite value and keeps its neighbours', () => {
    const items = [good({ model: 'a' }), good({ model: 'nan', value: Number.NaN }), good({ model: 'inf', value: Number.POSITIVE_INFINITY }), good({ model: 'b' })];
    expect(arenaLegacy.parse(items, ctx).map((o) => o.model)).toEqual(['a', 'b']);
    // JSON turns NaN into null; a numeric string is not an Observation value either
    expect(arenaLegacy.parse(JSON.parse(JSON.stringify(items)), ctx).map((o) => o.model)).toEqual(['a', 'b']);
    expect(arenaLegacy.parse([{ ...good(), value: '1135' }], ctx)).toEqual([]);
  });

  it('drops items with another kind, another dateKind, a bad date, no model or junk', () => {
    const bad: unknown[] = [
      { ...good(), kind: 'percent' },
      { ...good(), dateKind: 'release' },
      { ...good(), date: '2023-02-30' },
      { ...good(), date: '2023-08' },
      { ...good(), date: '20230802' },
      { ...good(), model: '' },
      { ...good(), model: undefined },
      { ...good(), series: undefined },
      null,
      'text',
      7,
      [],
    ];
    expect(arenaLegacy.parse([...bad, good({ model: 'kept' })], ctx).map((o) => o.model)).toEqual(['kept']);
  });

  it('turns an empty or non-string org into an absent org', () => {
    const out = arenaLegacy.parse([good({ org: '' }), { ...good(), org: 42 }], ctx);
    expect(out).toHaveLength(2);
    for (const o of out) expect('org' in o).toBe(false);
  });

  it('accepts the whole snapshot file shape and returns [] for an unusable payload', () => {
    expect(arenaLegacy.parse({ sourceId: 'arena-legacy', date: '2026-10-08', items: [good()] }, ctx)).toEqual([good()]);
    expect(arenaLegacy.parse(null, ctx)).toEqual([]);
    expect(arenaLegacy.parse('nope', ctx)).toEqual([]);
    expect(arenaLegacy.parse({ items: 'x' }, ctx)).toEqual([]);
    expect(arenaLegacy.parse([], ctx)).toEqual([]);
  });
});

describe('committed raw snapshot (raw/arena-legacy)', () => {
  const rawDir = fileURLToPath(new URL('../../raw', import.meta.url));
  const items = loadSource<unknown>(rawDir, 'arena-legacy', 'full');
  const obs = arenaLegacy.parse(items, ctx);

  it('is entirely valid', () => {
    expect(items.length).toBeGreaterThan(3000);
    expect(obs).toHaveLength(items.length);
    expect(obs.every((o) => o.series === 'arena-legacy' && o.org !== undefined)).toBe(true);
  });

  it('covers every month from 2023-05 to 2025-08, one snapshot date per month', () => {
    const byMonth = new Map<string, Set<string>>();
    for (const o of obs) byMonth.set(o.date.slice(0, 7), (byMonth.get(o.date.slice(0, 7)) ?? new Set()).add(o.date));
    const months = [...byMonth.keys()].sort();
    expect(months[0]).toBe('2023-05');
    expect(months.at(-1)).toBe('2025-08');
    expect(months).toHaveLength(28);
    for (const dates of byMonth.values()) expect(dates.size).toBe(1);
  });

  it('holds the retired models the current dataset dropped (survivorship fix)', () => {
    const claudeBefore2024 = obs.filter((o) => o.model.startsWith('claude') && o.date < '2024-01-01');
    expect(claudeBefore2024.length).toBeGreaterThan(0);
    expect(obs.find((o) => o.model === 'claude-2' && o.date === '2023-08-02')).toEqual(good());
    expect(obs.find((o) => o.model === 'gpt-4' && o.date === '2023-05-22')).toEqual({
      series: 'arena-legacy',
      kind: 'elo',
      model: 'gpt-4',
      org: 'OpenAI',
      date: '2023-05-22',
      dateKind: 'snapshot',
      value: 1251,
    });
    expect(obs.some((o) => o.model === 'bard-jan-24-gemini-pro' && o.date === '2024-01-25' && o.value === 1214.9)).toBe(true);
    expect(obs.some((o) => o.model === 'gemini-2.5-pro-exp-03-25' && o.date === '2025-04-23')).toBe(true);
  });
});

describe('runFetch with a static source', () => {
  it('reports it as skipped without fetching or writing a snapshot', async () => {
    const spy = vi.spyOn(arenaLegacy, 'fetch');
    const dir = mkdtempSync(join(tmpdir(), 'raw-'));
    const status = await runFetch([arenaLegacy], fetchCtx(), dir);
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({ id: 'arena-legacy', status: 'skipped', count: 0 });
    expect(status[0].error).toContain('static');
    expect(spy).not.toHaveBeenCalled();
    expect(existsSync(join(dir, 'arena-legacy'))).toBe(false);
    spy.mockRestore();
  });
});
