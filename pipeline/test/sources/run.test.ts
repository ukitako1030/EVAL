import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFetch } from '../../src/sources/run';
import type { SourceModule, FetchCtx } from '../../src/sources/types';
import { latestSnapshotDate, listSnapshotDates, loadSource } from '../../src/raw/store';

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
  describe('shrink guard (full sources)', () => {
    /** parse() yields as many items as the fetched text says: fetch returns the item count as a string. */
    const counting = (id: string, history: 'full' | 'accumulate', n: { v: number }): SourceModule => ({
      ...ok,
      id,
      history,
      fetch: async () => String(n.v),
      parse: (raw) =>
        Array.from({ length: Number(raw) }, (_, i) => ({ series: id, kind: 'elo' as const, model: `m${i}`, date: '2026-10-01', dateKind: 'snapshot' as const, value: i })),
    });
    const laterCtx = (): FetchCtx => ({ ...ctx(), now: new Date('2026-10-19T06:00:00Z') });
    const savedCount = (dir: string, id: string, mode: 'full' | 'accumulate') => loadSource<unknown>(dir, id, mode).length;

    it('refuses to replace a full snapshot with fewer than 90% of its items and records a failure', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'raw-'));
      const n = { v: 10 };
      const mod = counting('shrink', 'full', n);
      expect((await runFetch([mod], ctx(), dir))[0].status).toBe('ok');
      n.v = 8;
      const [st] = await runFetch([mod], laterCtx(), dir);
      expect(st.status).toBe('failed');
      expect(st.error).toBe('refusing to replace 10 items with 8 (format change?)');
      expect(st.count).toBe(0);
      expect(savedCount(dir, 'shrink', 'full')).toBe(10);
      expect(latestSnapshotDate(dir, 'shrink')).toBe('2026-10-12');
      const recorded = JSON.parse(readFileSync(join(dir, '_status', '2026-10-19.json'), 'utf8')) as { id: string; status: string; error?: string }[];
      expect(recorded).toEqual([expect.objectContaining({ id: 'shrink', status: 'failed', error: 'refusing to replace 10 items with 8 (format change?)' })]);
    });
    it('accepts exactly 90%, equal and larger snapshots', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'raw-'));
      const n = { v: 10 };
      const mod = counting('edge', 'full', n);
      await runFetch([mod], ctx(), dir);
      n.v = 9;
      expect((await runFetch([mod], laterCtx(), dir))[0].status).toBe('ok');
      expect(savedCount(dir, 'edge', 'full')).toBe(9);
      n.v = 9;
      expect((await runFetch([mod], laterCtx(), dir))[0].status).toBe('ok');
      n.v = 20;
      expect((await runFetch([mod], laterCtx(), dir))[0].status).toBe('ok');
      expect(savedCount(dir, 'edge', 'full')).toBe(20);
    });
    it('does not guard the first fetch, and a source with a corrupt snapshot can be replaced', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'raw-'));
      const n = { v: 3 };
      const mod = counting('fresh', 'full', n);
      expect((await runFetch([mod], ctx(), dir))[0].status).toBe('ok');
      writeFileSync(join(dir, 'fresh', 'current.json'), '{broken');
      n.v = 1;
      expect((await runFetch([mod], laterCtx(), dir))[0].status).toBe('ok');
      expect(savedCount(dir, 'fresh', 'full')).toBe(1);
    });
    it('does not apply to accumulate sources (they only add a dated file)', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'raw-'));
      const n = { v: 10 };
      const mod = counting('acc', 'accumulate', n);
      await runFetch([mod], ctx(), dir);
      n.v = 2;
      expect((await runFetch([mod], laterCtx(), dir))[0].status).toBe('ok');
      expect(listSnapshotDates(dir, 'acc')).toEqual(['2026-10-12', '2026-10-19']);
    });
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
