import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  describe('_status file', () => {
    const statusPath = (dir: string) => join(dir, '_status', '2026-10-12.json');
    const saved = (dir: string) => JSON.parse(readFileSync(statusPath(dir), 'utf8')) as { id: string; status: string; count?: number }[];
    const fixedBroken: SourceModule = { ...ok, id: 'broken' };

    it('a run with only ids merges into the existing file: same id replaced, others kept, new ids appended', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'raw-'));
      await runFetch([ok, broken, keyed], ctx(), dir);
      expect(saved(dir).map((s) => [s.id, s.status])).toEqual([
        ['ok-src', 'ok'],
        ['broken', 'failed'],
        ['keyed', 'skipped'],
      ]);
      await runFetch([ok, fixedBroken, keyed], ctx(), dir, ['broken']);
      expect(saved(dir).map((s) => [s.id, s.status])).toEqual([
        ['ok-src', 'ok'],
        ['broken', 'ok'],
        ['keyed', 'skipped'],
      ]);
      // an id the file does not have yet is appended
      await runFetch([ok, { ...ok, id: 'later' }], ctx(), dir, ['later']);
      expect(saved(dir).map((s) => s.id)).toEqual(['ok-src', 'broken', 'keyed', 'later']);
    });
    it('does not duplicate an id when the same only-run is repeated', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'raw-'));
      await runFetch([ok], ctx(), dir, ['ok-src']);
      await runFetch([ok], ctx(), dir, ['ok-src']);
      expect(saved(dir).map((s) => s.id)).toEqual(['ok-src']);
    });
    it('a full run (no only) overwrites the file', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'raw-'));
      await runFetch([ok, broken, keyed], ctx(), dir);
      await runFetch([ok], ctx(), dir);
      expect(saved(dir).map((s) => s.id)).toEqual(['ok-src']);
    });
    it('starts fresh when the existing file is unreadable or not a status list', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'raw-'));
      mkdirSync(join(dir, '_status'));
      writeFileSync(statusPath(dir), '{not json');
      await runFetch([ok], ctx(), dir, ['ok-src']);
      expect(saved(dir).map((s) => s.id)).toEqual(['ok-src']);
      writeFileSync(statusPath(dir), '{"a":1}');
      await runFetch([ok], ctx(), dir, ['ok-src']);
      expect(saved(dir).map((s) => s.id)).toEqual(['ok-src']);
    });
    it('returns only the statuses of this run', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'raw-'));
      await runFetch([ok, broken], ctx(), dir);
      const status = await runFetch([ok, fixedBroken], ctx(), dir, ['broken']);
      expect(status.map((s) => s.id)).toEqual(['broken']);
    });
  });
});
