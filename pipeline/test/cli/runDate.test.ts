import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDate } from '../../src/cli/runDate';

const rawWithStatus = (files: string[]): string => {
  const raw = mkdtempSync(join(tmpdir(), 'rundate-'));
  mkdirSync(join(raw, '_status'));
  for (const f of files) writeFileSync(join(raw, '_status', f), '[]');
  return raw;
};
const fallback = () => new Date('2030-01-01T08:30:00Z');

describe('runDate', () => {
  it('is noon UTC of the latest raw/_status/<date>.json, so reruns of compute are deterministic', () => {
    const raw = rawWithStatus(['2026-09-30.json', '2026-10-08.json', '2026-10-01.json']);
    expect(runDate(raw, fallback).toISOString()).toBe('2026-10-08T12:00:00.000Z');
  });
  it('ignores files that are not a valid <date>.json', () => {
    const raw = rawWithStatus(['2026-10-01.json', '2026-13-40.json', '2026-10-09.json.tmp', 'notes.txt', '2026-10-02.json']);
    expect(runDate(raw, fallback).toISOString()).toBe('2026-10-02T12:00:00.000Z');
  });
  it('falls back to the given clock when there is no status file', () => {
    expect(runDate(rawWithStatus([]), fallback).toISOString()).toBe('2030-01-01T08:30:00.000Z');
    expect(runDate(mkdtempSync(join(tmpdir(), 'rundate-none-')), fallback).toISOString()).toBe('2030-01-01T08:30:00.000Z');
  });
  it('defaults the fallback to the current time', () => {
    const before = Date.now();
    const d = runDate(rawWithStatus([])).getTime();
    expect(d).toBeGreaterThanOrEqual(before);
    expect(d).toBeLessThanOrEqual(Date.now());
  });
});
