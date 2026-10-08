import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSnapshot, listSnapshotDates, loadSource, latestSnapshotDate } from '../../src/raw/store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'raw-'));
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
  it('accumulate merges all files and de-duplicates identical items', () => {
    saveSnapshot(dir, 'acc', '2026-09-28', [{ k: 'x', m: '2026-09' }], 'accumulate');
    saveSnapshot(dir, 'acc', '2026-10-05', [{ k: 'x', m: '2026-09' }, { k: 'x', m: '2026-10' }], 'accumulate');
    expect(loadSource(dir, 'acc', 'accumulate')).toEqual([
      { k: 'x', m: '2026-09' },
      { k: 'x', m: '2026-10' },
    ]);
  });
});
