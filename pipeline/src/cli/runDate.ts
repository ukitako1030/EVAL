import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const STATUS_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

/**
 * The instant a compute run stands for: noon UTC of the latest fetch, i.e. the newest raw/_status/<date>.json
 * (written by `npm run fetch`), so that recomputing the same raw data always gives the same world.json.
 * Falls back to `fallback()` (default: the current time) when there is no valid status file.
 */
export function runDate(rawDir: string, fallback: () => Date = () => new Date()): Date {
  const dir = join(rawDir, '_status');
  if (!existsSync(dir)) return fallback();
  const dates = readdirSync(dir)
    .map((f) => STATUS_FILE.exec(f)?.[1])
    .filter((d): d is string => d !== undefined)
    .filter((d) => {
      const t = new Date(`${d}T12:00:00Z`);
      return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; // rejects 2026-13-40, 2026-02-30
    })
    .sort();
  return dates.length ? new Date(`${dates[dates.length - 1]}T12:00:00Z`) : fallback();
}
