import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFetch } from '../../src/sources/run';
import type { SourceModule, FetchCtx } from '../../src/sources/types';
import { loadSource } from '../../src/raw/store';

const meta = { name: 'X', url: 'https://x', license: 'CC BY 4.0', credit: 'X' };
const ok: SourceModule = {
  id: 'ok-src',
  role: 'strength',
  group: 'g',
  history: 'full',
  meta,
  fetch: async () => '1,2',
  parse: (raw) =>
    String(raw)
      .split(',')
      .map((v) => ({ series: 'ok-src', kind: 'elo', model: 'm', date: '2026-10-01', dateKind: 'snapshot', value: Number(v) })),
};
const broken: SourceModule = { ...ok, id: 'broken', fetch: async () => { throw new Error('HTTP 503'); } };
const keyed: SourceModule = { ...ok, id: 'keyed', needsEnv: ['SOME_KEY'] };
const empty: SourceModule = { ...ok, id: 'empty', parse: () => [] };
const stat: SourceModule = { ...ok, id: 'static-src', static: true };

const ctx = (): FetchCtx => ({
  env: {},
  now: new Date('2026-10-12T06:00:00Z'),
  backfill: false,
  keys: () => [],
  fetchText: async () => '',
  fetchBytes: async () => new Uint8Array(),
  fetchJson: async <T>() => ({}) as T,
  log: () => {},
});

describe('runFetch', () => {
  it('saves ok sources, isolates failures, skips missing keys, treats empty parse as failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raw-'));
    const status = await runFetch([ok, broken, keyed, empty, stat], ctx(), dir);
    expect(status.map((s) => [s.id, s.status])).toEqual([
      ['ok-src', 'ok'],
      ['broken', 'failed'],
      ['keyed', 'skipped'],
      ['empty', 'failed'],
      ['static-src', 'skipped'],
    ]);
    expect(status[1].error).toContain('HTTP 503');
    expect(status[2].error).toContain('SOME_KEY');
    expect(status[4].error).toContain('static');
    expect(loadSource<{ value: number }>(dir, 'ok-src', 'full').map((o) => o.value)).toEqual([1, 2]);
    const saved = JSON.parse(readFileSync(join(dir, '_status', '2026-10-12.json'), 'utf8'));
    expect(saved).toHaveLength(5);
  });
  it('runs only selected ids', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raw-'));
    const status = await runFetch([ok, broken], ctx(), dir, ['ok-src']);
    expect(status.map((s) => s.id)).toEqual(['ok-src']);
  });
});
