import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchStatus } from '../sources/run';

/** Warnings without repeats, in the order they first appeared. */
export function uniqueWarnings(warnings: readonly string[]): string[] {
  return [...new Set(warnings)];
}

/** Writes <outDir>/warnings.json (a JSON array of strings, deduplicated; `[]` when there are none) and returns the list. */
export function writeWarnings(outDir: string, warnings: readonly string[]): string[] {
  const unique = uniqueWarnings(warnings);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'warnings.json'), JSON.stringify(unique, null, 2) + '\n');
  return unique;
}

/**
 * Exit code of `npm run fetch`. Some sources failing is normal (the weekly pull request reports them), so that stays 0;
 * only when every source that was attempted (not skipped) failed — a network outage, say — is it 1, so that the
 * workflow stops instead of opening a pull request with no new data.
 */
export function fetchExitCode(status: readonly FetchStatus[]): 0 | 1 {
  const attempted = status.filter((s) => s.status !== 'skipped');
  return attempted.length > 0 && attempted.every((s) => s.status === 'failed') ? 1 : 0;
}

function isStatusList(v: unknown): v is FetchStatus[] {
  return Array.isArray(v) && v.every((s) => s && typeof s.id === 'string' && ['ok', 'skipped', 'failed'].includes(s.status));
}

/**
 * Writes <outDir>/status-latest.json, the status of the run for the pull request summary.
 * That is the day's raw/_status/<date>.json (which, after a run restricted to some sources, also holds the other
 * sources fetched earlier that day), or `thisRun` when that file is missing or unreadable. Returns what it wrote.
 */
export function writeStatusLatest(outDir: string, rawDir: string, date: string, thisRun: FetchStatus[]): FetchStatus[] {
  let status = thisRun;
  const recorded = join(rawDir, '_status', `${date}.json`);
  if (existsSync(recorded)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(recorded, 'utf8'));
      if (isStatusList(parsed)) status = parsed;
    } catch {
      // keep thisRun
    }
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'status-latest.json'), JSON.stringify(status, null, 2) + '\n');
  return status;
}
