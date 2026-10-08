import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as nodeFs from 'node:fs';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

import { saveSnapshot, listSnapshotDates, loadSource, latestSnapshotDate } from '../../src/raw/store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'raw-'));
  vi.mocked(nodeFs.renameSync).mockReset();
});

describe('raw store', () => {
  it('saves one item per line and lists dates ascending', () => {
    saveSnapshot(dir, 'src-a', '2026-10-05', [{ a: 1 }, { a: 2 }], 'full');
    saveSnapshot(dir, 'src-a', '2026-09-28', [{ a: 0 }], 'accumulate');
    const text = readFileSync(join(dir, 'src-a', '2026-10-05.json'), 'utf8');
    expect(text.split('\n').filter((l) => l.startsWith('{"a"'))).toHaveLength(2);
    expect(listSnapshotDates(dir, 'src-a')).toEqual(['2026-09-28', '2026-10-05']);
    expect(latestSnapshotDate(dir, 'src-a')).toBe('2026-10-05');
    expect(listSnapshotDates(dir, 'missing')).toEqual([]);
  });
  it('full history keeps only the newest file and loads it', () => {
    saveSnapshot(dir, 'full-src', '2026-09-28', [{ v: 1 }], 'full');
    saveSnapshot(dir, 'full-src', '2026-10-05', [{ v: 2 }], 'full');
    expect(readdirSync(join(dir, 'full-src'))).toEqual(['2026-10-05.json']);
    expect(loadSource(dir, 'full-src', 'full')).toEqual([{ v: 2 }]);
  });
  it('full history keeps the old snapshot when the new write fails', () => {
    saveSnapshot(dir, 'safe', '2026-09-28', [{ v: 1 }], 'full');
    expect(() => saveSnapshot(dir, 'safe', '2026-10-05', [{ v: 1n }], 'full')).toThrow();
    expect(listSnapshotDates(dir, 'safe')).toEqual(['2026-09-28']);
    expect(loadSource(dir, 'safe', 'full')).toEqual([{ v: 1 }]);
  });
  it('writes atomically: no .tmp file remains and re-running the same date replaces the content', () => {
    saveSnapshot(dir, 'atomic', '2026-10-05', [{ v: 1 }], 'accumulate');
    saveSnapshot(dir, 'atomic', '2026-10-05', [{ v: 2 }, { v: 3 }], 'accumulate');
    expect(readdirSync(join(dir, 'atomic'))).toEqual(['2026-10-05.json']);
    expect(loadSource(dir, 'atomic', 'accumulate')).toEqual([{ v: 2 }, { v: 3 }]);
  });
  it('writes <date>.json.tmp first and renames it over <date>.json', () => {
    const path = saveSnapshot(dir, 'atomic3', '2026-10-05', [{ v: 1 }], 'accumulate');
    expect(vi.mocked(nodeFs.renameSync).mock.calls).toEqual([[join(dir, 'atomic3', '2026-10-05.json.tmp'), join(dir, 'atomic3', '2026-10-05.json')]]);
    expect(path).toBe(join(dir, 'atomic3', '2026-10-05.json'));
  });
  it('if the rename fails the previous snapshot is untouched and the .tmp file is removed', () => {
    saveSnapshot(dir, 'atomic4', '2026-10-05', [{ v: 1 }], 'accumulate');
    vi.mocked(nodeFs.renameSync).mockImplementationOnce(() => {
      throw new Error('rename failed');
    });
    expect(() => saveSnapshot(dir, 'atomic4', '2026-10-05', [{ v: 2 }], 'accumulate')).toThrow('rename failed');
    expect(readdirSync(join(dir, 'atomic4'))).toEqual(['2026-10-05.json']);
    expect(loadSource(dir, 'atomic4', 'accumulate')).toEqual([{ v: 1 }]);
  });
  it('a failed write leaves neither a .tmp file nor a damaged snapshot of the same date', () => {
    saveSnapshot(dir, 'atomic2', '2026-10-05', [{ v: 1 }], 'accumulate');
    expect(() => saveSnapshot(dir, 'atomic2', '2026-10-05', [{ v: 1n }], 'accumulate')).toThrow();
    expect(readdirSync(join(dir, 'atomic2'))).toEqual(['2026-10-05.json']);
    expect(loadSource(dir, 'atomic2', 'accumulate')).toEqual([{ v: 1 }]);
  });
  it('accumulate merges all files and de-duplicates identical items', () => {
    saveSnapshot(dir, 'acc', '2026-09-28', [{ k: 'x', m: '2026-09' }], 'accumulate');
    saveSnapshot(dir, 'acc', '2026-10-05', [{ k: 'x', m: '2026-09' }, { k: 'x', m: '2026-10' }], 'accumulate');
    expect(loadSource(dir, 'acc', 'accumulate')).toEqual([
      { k: 'x', m: '2026-09' },
      { k: 'x', m: '2026-10' },
    ]);
  });
});
