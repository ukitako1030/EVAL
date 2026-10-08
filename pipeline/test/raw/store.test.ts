import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as nodeFs from 'node:fs';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

function writeSnapshotFile(file: string, id: string, date: string, items: unknown[]): void {
  mkdirSync(join(dir, id), { recursive: true });
  const body = items.map((it) => JSON.stringify(it)).join(',\n');
  writeFileSync(join(dir, id, file), `{"sourceId":${JSON.stringify(id)},"date":${JSON.stringify(date)},"items":[\n${body}\n]}\n`);
}
const writeLegacy = (id: string, date: string, items: unknown[]): void => writeSnapshotFile(`${date}.json`, id, date, items);
const writeCurrent = (id: string, date: string, items: unknown[]): void => writeSnapshotFile('current.json', id, date, items);

describe('raw store', () => {
  it('saves one item per line and lists dates ascending', () => {
    saveSnapshot(dir, 'src-a', '2026-10-05', [{ a: 1 }, { a: 2 }], 'accumulate');
    saveSnapshot(dir, 'src-a', '2026-09-28', [{ a: 0 }], 'accumulate');
    const text = readFileSync(join(dir, 'src-a', '2026-10-05.json'), 'utf8');
    expect(text.split('\n').filter((l) => l.startsWith('{"a"'))).toHaveLength(2);
    expect(listSnapshotDates(dir, 'src-a')).toEqual(['2026-09-28', '2026-10-05']);
    expect(latestSnapshotDate(dir, 'src-a')).toBe('2026-10-05');
    expect(listSnapshotDates(dir, 'missing')).toEqual([]);
    expect(latestSnapshotDate(dir, 'missing')).toBeNull();
  });
  it('writes one item per line in current.json too', () => {
    saveSnapshot(dir, 'src-full', '2026-10-05', [{ a: 1 }, { a: 2 }], 'full');
    const text = readFileSync(join(dir, 'src-full', 'current.json'), 'utf8');
    expect(text.split('\n').filter((l) => l.startsWith('{"a"'))).toHaveLength(2);
  });
  it('full history writes a stable current.json, keeps the date inside and loads it', () => {
    const path = saveSnapshot(dir, 'full-src', '2026-09-28', [{ v: 1 }], 'full');
    expect(path).toBe(join(dir, 'full-src', 'current.json'));
    saveSnapshot(dir, 'full-src', '2026-10-05', [{ v: 2 }], 'full');
    expect(readdirSync(join(dir, 'full-src'))).toEqual(['current.json']);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ sourceId: 'full-src', date: '2026-10-05', items: [{ v: 2 }] });
    expect(loadSource(dir, 'full-src', 'full')).toEqual([{ v: 2 }]);
    expect(listSnapshotDates(dir, 'full-src')).toEqual(['2026-10-05']);
    expect(latestSnapshotDate(dir, 'full-src')).toBe('2026-10-05');
  });
  it('full history does not change the file name from one week to the next (stable diffs)', () => {
    saveSnapshot(dir, 'stable', '2026-09-28', [{ v: 1 }, { v: 2 }], 'full');
    const before = readFileSync(join(dir, 'stable', 'current.json'), 'utf8');
    saveSnapshot(dir, 'stable', '2026-10-05', [{ v: 1 }, { v: 2 }], 'full');
    const after = readFileSync(join(dir, 'stable', 'current.json'), 'utf8');
    expect(readdirSync(join(dir, 'stable'))).toEqual(['current.json']);
    expect(after).toBe(before.replace('2026-09-28', '2026-10-05'));
  });
  it('saving a full source deletes its legacy date-named files', () => {
    writeLegacy('legacy-full', '2026-09-28', [{ v: 1 }]);
    writeLegacy('legacy-full', '2026-09-21', [{ v: 0 }]);
    saveSnapshot(dir, 'legacy-full', '2026-10-05', [{ v: 2 }], 'full');
    expect(readdirSync(join(dir, 'legacy-full'))).toEqual(['current.json']);
    expect(loadSource(dir, 'legacy-full', 'full')).toEqual([{ v: 2 }]);
  });
  it('legacy date-named files of a full source are still readable (latest wins)', () => {
    writeLegacy('legacy-read', '2026-09-28', [{ v: 1 }]);
    writeLegacy('legacy-read', '2026-10-05', [{ v: 2 }]);
    expect(listSnapshotDates(dir, 'legacy-read')).toEqual(['2026-09-28', '2026-10-05']);
    expect(latestSnapshotDate(dir, 'legacy-read')).toBe('2026-10-05');
    expect(loadSource(dir, 'legacy-read', 'full')).toEqual([{ v: 2 }]);
  });
  it('current.json takes its date from inside the file and wins over an older legacy file', () => {
    writeLegacy('mixed', '2026-09-28', [{ v: 1 }]);
    writeCurrent('mixed', '2026-10-05', [{ v: 2 }]);
    expect(listSnapshotDates(dir, 'mixed')).toEqual(['2026-09-28', '2026-10-05']);
    expect(latestSnapshotDate(dir, 'mixed')).toBe('2026-10-05');
    expect(loadSource(dir, 'mixed', 'full')).toEqual([{ v: 2 }]);
  });
  it('a legacy file newer than current.json (e.g. after a manual import) still wins for full sources', () => {
    writeCurrent('newer-legacy', '2026-09-28', [{ v: 1 }]);
    writeLegacy('newer-legacy', '2026-10-05', [{ v: 2 }]);
    expect(latestSnapshotDate(dir, 'newer-legacy')).toBe('2026-10-05');
    expect(loadSource(dir, 'newer-legacy', 'full')).toEqual([{ v: 2 }]);
  });
  it('reads the date of a current.json that was formatted differently (fallback parse)', () => {
    mkdirSync(join(dir, 'pretty'), { recursive: true });
    writeFileSync(join(dir, 'pretty', 'current.json'), JSON.stringify({ items: [{ v: 7 }], date: '2026-10-06', sourceId: 'pretty' }, null, 2));
    expect(latestSnapshotDate(dir, 'pretty')).toBe('2026-10-06');
    expect(loadSource(dir, 'pretty', 'full')).toEqual([{ v: 7 }]);
  });
  it('accumulate sources keep dated files and never write current.json', () => {
    saveSnapshot(dir, 'acc-dated', '2026-09-28', [{ v: 1 }], 'accumulate');
    saveSnapshot(dir, 'acc-dated', '2026-10-05', [{ v: 2 }], 'accumulate');
    expect(readdirSync(join(dir, 'acc-dated'))).toEqual(['2026-09-28.json', '2026-10-05.json']);
  });
  it('full history keeps the old snapshot when the new write fails', () => {
    saveSnapshot(dir, 'safe', '2026-09-28', [{ v: 1 }], 'full');
    expect(() => saveSnapshot(dir, 'safe', '2026-10-05', [{ v: 1n }], 'full')).toThrow();
    expect(listSnapshotDates(dir, 'safe')).toEqual(['2026-09-28']);
    expect(readdirSync(join(dir, 'safe'))).toEqual(['current.json']);
    expect(loadSource(dir, 'safe', 'full')).toEqual([{ v: 1 }]);
  });
  it('a failed write of a full source keeps its legacy files', () => {
    writeLegacy('legacy-safe', '2026-09-28', [{ v: 1 }]);
    expect(() => saveSnapshot(dir, 'legacy-safe', '2026-10-05', [{ v: 1n }], 'full')).toThrow();
    expect(readdirSync(join(dir, 'legacy-safe'))).toEqual(['2026-09-28.json']);
    expect(loadSource(dir, 'legacy-safe', 'full')).toEqual([{ v: 1 }]);
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
  it('a full source writes current.json.tmp first and renames it over current.json', () => {
    const path = saveSnapshot(dir, 'atomic5', '2026-10-05', [{ v: 1 }], 'full');
    expect(vi.mocked(nodeFs.renameSync).mock.calls).toEqual([[join(dir, 'atomic5', 'current.json.tmp'), join(dir, 'atomic5', 'current.json')]]);
    expect(path).toBe(join(dir, 'atomic5', 'current.json'));
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
