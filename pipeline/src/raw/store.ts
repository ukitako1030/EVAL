import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type HistoryMode = 'full' | 'accumulate';

const DATED_JSON = /^\d{4}-\d{2}-\d{2}\.json$/;

interface SnapshotFile<T> {
  sourceId: string;
  date: string;
  items: T[];
}

/**
 * Writes raw/<sourceId>/<date>.json with one item per line (git-friendly diffs).
 * The file is written to <date>.json.tmp and renamed into place, so re-running on the same date replaces it atomically.
 * 'full' sources contain their whole history in every fetch, so older files are deleted.
 */
export function saveSnapshot<T>(rawDir: string, sourceId: string, date: string, items: T[], mode: HistoryMode): string {
  const dir = join(rawDir, sourceId);
  mkdirSync(dir, { recursive: true });
  const body = items.map((it) => JSON.stringify(it)).join(',\n');
  const text = `{"sourceId":${JSON.stringify(sourceId)},"date":${JSON.stringify(date)},"items":[\n${body}\n]}\n`;
  const path = join(dir, `${date}.json`);
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  if (mode === 'full') {
    // delete older snapshots only after the new one is safely on disk
    for (const f of readdirSync(dir)) if (DATED_JSON.test(f) && f !== `${date}.json`) rmSync(join(dir, f));
  }
  return path;
}

export function listSnapshotDates(rawDir: string, sourceId: string): string[] {
  const dir = join(rawDir, sourceId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => DATED_JSON.test(f))
    .map((f) => f.slice(0, 10))
    .sort();
}

export function latestSnapshotDate(rawDir: string, sourceId: string): string | null {
  const d = listSnapshotDates(rawDir, sourceId);
  return d.length ? d[d.length - 1] : null;
}

function readItems<T>(rawDir: string, sourceId: string, date: string): T[] {
  const file = JSON.parse(readFileSync(join(rawDir, sourceId, `${date}.json`), 'utf8')) as SnapshotFile<T>;
  return file.items;
}

export function loadSource<T>(rawDir: string, sourceId: string, mode: HistoryMode): T[] {
  const dates = listSnapshotDates(rawDir, sourceId);
  if (!dates.length) return [];
  if (mode === 'full') return readItems<T>(rawDir, sourceId, dates[dates.length - 1]);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const d of dates) {
    for (const it of readItems<T>(rawDir, sourceId, d)) {
      const key = JSON.stringify(it);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(it);
      }
    }
  }
  return out;
}
