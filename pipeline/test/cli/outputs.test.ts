import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchExitCode, uniqueWarnings, writeStatusLatest, writeWarnings } from '../../src/cli/outputs';
import type { FetchStatus } from '../../src/sources/run';

const st = (id: string, status: FetchStatus['status']): FetchStatus => ({ id, status, count: status === 'ok' ? 1 : 0, ms: 1, ...(status === 'ok' ? {} : { error: 'x' }) });
const tmp = () => mkdtempSync(join(tmpdir(), 'outputs-'));

describe('writeWarnings', () => {
  it('writes a deduplicated JSON array of strings, in first-seen order', () => {
    const out = join(tmp(), 'out'); // does not exist yet
    expect(writeWarnings(out, ['b', 'a', 'b', 'a', 'c'])).toEqual(['b', 'a', 'c']);
    expect(JSON.parse(readFileSync(join(out, 'warnings.json'), 'utf8'))).toEqual(['b', 'a', 'c']);
  });
  it('writes an empty array when there are no warnings', () => {
    const out = tmp();
    writeWarnings(out, []);
    expect(JSON.parse(readFileSync(join(out, 'warnings.json'), 'utf8'))).toEqual([]);
  });
  it('overwrites the previous run', () => {
    const out = tmp();
    writeWarnings(out, ['old']);
    writeWarnings(out, ['new']);
    expect(JSON.parse(readFileSync(join(out, 'warnings.json'), 'utf8'))).toEqual(['new']);
  });
  it('uniqueWarnings keeps distinct messages that differ only in case or whitespace', () => {
    expect(uniqueWarnings(['a', 'A', 'a ', 'a'])).toEqual(['a', 'A', 'a ']);
  });
});

describe('fetchExitCode', () => {
  it('is 0 when everything succeeded', () => {
    expect(fetchExitCode([st('a', 'ok'), st('b', 'ok')])).toBe(0);
  });
  it('stays 0 when only some sources failed (the pull request reports them)', () => {
    expect(fetchExitCode([st('a', 'ok'), st('b', 'failed'), st('c', 'skipped')])).toBe(0);
  });
  it('is 1 when every non-skipped source failed', () => {
    expect(fetchExitCode([st('a', 'failed'), st('b', 'failed')])).toBe(1);
    expect(fetchExitCode([st('a', 'failed'), st('s', 'skipped'), st('b', 'failed')])).toBe(1);
    expect(fetchExitCode([st('a', 'failed')])).toBe(1);
  });
  it('is 0 when nothing was attempted (all skipped, or no sources)', () => {
    expect(fetchExitCode([st('s', 'skipped'), st('t', 'skipped')])).toBe(0);
    expect(fetchExitCode([])).toBe(0);
  });
});

describe('writeStatusLatest', () => {
  const rawWith = (date: string, content: unknown): string => {
    const raw = tmp();
    mkdirSync(join(raw, '_status'));
    writeFileSync(join(raw, '_status', `${date}.json`), typeof content === 'string' ? content : JSON.stringify(content));
    return raw;
  };
  const read = (out: string) => JSON.parse(readFileSync(join(out, 'status-latest.json'), 'utf8'));

  it("copies the day's recorded status (which holds the other sources after a partial run)", () => {
    const recorded = [st('a', 'ok'), st('b', 'failed'), st('c', 'skipped')];
    const out = join(tmp(), 'out');
    const written = writeStatusLatest(out, rawWith('2026-10-08', recorded), '2026-10-08', [st('b', 'ok')]);
    expect(written).toEqual(recorded);
    expect(read(out)).toEqual(recorded);
  });
  it("falls back to this run's status when the day's file is missing or unreadable", () => {
    const run = [st('a', 'ok')];
    const out = tmp();
    expect(writeStatusLatest(out, rawWith('2026-10-07', []), '2026-10-08', run)).toEqual(run);
    expect(read(out)).toEqual(run);
    expect(writeStatusLatest(out, rawWith('2026-10-08', '{ nope'), '2026-10-08', run)).toEqual(run);
    expect(writeStatusLatest(out, rawWith('2026-10-08', [{ id: 5 }]), '2026-10-08', run)).toEqual(run);
  });
});
