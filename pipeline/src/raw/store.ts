import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type HistoryMode = 'full' | 'accumulate';

const DATED_JSON = /^\d{4}-\d{2}-\d{2}\.json$/;
/** Stable file name of a `full` source: it never changes, so a weekly refresh shows up as an in-place diff. */
export const CURRENT_JSON = 'current.json';
/** The header line saveSnapshot writes; read from the first bytes so the date of a big file is cheap to get. */
const HEADER = /^\{"sourceId":"(?:[^"\\]|\\.)*","date":"(\d{4}-\d{2}-\d{2})"/;
const HEADER_BYTES = 1024;

interface SnapshotFile<T> {
  sourceId: string;
  date: string;
  items: T[];
}

interface SnapshotRef {
  date: string;
  file: string;
}

/**
 * Writes raw/<sourceId>/... with one item per line (git-friendly diffs).
 * 'full' sources contain their whole history in every fetch, so they use ONE stable file, current.json (the snapshot
 * date lives inside it), and any legacy <date>.json files of the source are deleted once the new file is on disk.
 * 'accumulate' sources keep one <date>.json per fetch.
 * The file is written to <name>.tmp and renamed into place, so re-running on the same date replaces it atomically.
 */
export function saveSnapshot<T>(rawDir: string, sourceId: string, date: string, items: T[], mode: HistoryMode): string {
  const dir = join(rawDir, sourceId);
  mkdirSync(dir, { recursive: true });
  const body = items.map((it) => JSON.stringify(it)).join(',\n');
  const text = `{"sourceId":${JSON.stringify(sourceId)},"date":${JSON.stringify(date)},"items":[\n${body}\n]}\n`;
  const name = mode === 'full' ? CURRENT_JSON : `${date}.json`;
  const path = join(dir, name);
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  if (mode === 'full') {
    // delete legacy date-named snapshots only after the new one is safely on disk
    for (const f of readdirSync(dir)) if (DATED_JSON.test(f)) rmSync(join(dir, f));
  }
  return path;
}

/** The snapshot date stored in the header of `path`; falls back to parsing the whole file when the header is unusual. */
function readDate(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const n = readSync(fd, buf, 0, HEADER_BYTES, 0);
    const m = HEADER.exec(buf.toString('utf8', 0, n));
    if (m) return m[1];
  } finally {
    closeSync(fd);
  }
  const file = JSON.parse(readFileSync(path, 'utf8')) as Partial<SnapshotFile<unknown>>;
  if (typeof file.date !== 'string') throw new Error(`${path}: snapshot file has no date`);
  return file.date;
}

/** Every snapshot file of a source (dated files and current.json), oldest first; on a date tie current.json comes last. */
function snapshotRefs(rawDir: string, sourceId: string): SnapshotRef[] {
  const dir = join(rawDir, sourceId);
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir);
  const refs: SnapshotRef[] = names.filter((f) => DATED_JSON.test(f)).map((f) => ({ date: f.slice(0, 10), file: f }));
  if (names.includes(CURRENT_JSON)) refs.push({ date: readDate(join(dir, CURRENT_JSON)), file: CURRENT_JSON });
  return refs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.file === CURRENT_JSON ? 1 : b.file === CURRENT_JSON ? -1 : 0));
}

export function listSnapshotDates(rawDir: string, sourceId: string): string[] {
  return [...new Set(snapshotRefs(rawDir, sourceId).map((r) => r.date))];
}

export function latestSnapshotDate(rawDir: string, sourceId: string): string | null {
  const d = listSnapshotDates(rawDir, sourceId);
  return d.length ? d[d.length - 1] : null;
}

function readItems<T>(rawDir: string, sourceId: string, ref: SnapshotRef): T[] {
  const file = JSON.parse(readFileSync(join(rawDir, sourceId, ref.file), 'utf8')) as SnapshotFile<T>;
  return file.items;
}

export function loadSource<T>(rawDir: string, sourceId: string, mode: HistoryMode): T[] {
  const refs = snapshotRefs(rawDir, sourceId);
  if (!refs.length) return [];
  if (mode === 'full') return readItems<T>(rawDir, sourceId, refs[refs.length - 1]);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const ref of refs) {
    for (const it of readItems<T>(rawDir, sourceId, ref)) {
      const key = JSON.stringify(it);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(it);
      }
    }
  }
  return out;
}
