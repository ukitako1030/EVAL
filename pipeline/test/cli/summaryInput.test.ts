import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSummaryInput, parseSummaryArgs, resolveStatusFile } from '../../src/cli/summaryInput';
import { renderPrSummary } from '../../src/report/prSummary';

const REAL_WORLD = join(__dirname, '..', '..', '..', 'site', 'public', 'data', 'world.json');

describe('parseSummaryArgs', () => {
  it('reads --flag value and --flag=value, and maps `--before none` to null', () => {
    expect(parseSummaryArgs(['--before', 'none', '--after=w.json', '--status', 'latest', '--warnings', 'w.txt', '--out', 'o.md'])).toEqual({
      before: null,
      after: 'w.json',
      status: 'latest',
      warnings: 'w.txt',
      out: 'o.md',
    });
  });
  it('treats --warnings and --out as optional', () => {
    expect(parseSummaryArgs(['--before', 'b.json', '--after', 'a.json', '--status', 's.json'])).toMatchObject({ before: 'b.json', warnings: null, out: null });
  });
  it('rejects missing required flags, unknown flags and flags without a value', () => {
    expect(() => parseSummaryArgs(['--after', 'a.json', '--status', 's.json'])).toThrow('--before is required');
    expect(() => parseSummaryArgs(['--before', 'none', '--after', 'a', '--status', 's', '--nope', 'x'])).toThrow('unknown argument');
    expect(() => parseSummaryArgs(['--before', '--after', 'a', '--status', 's'])).toThrow('--before needs a value');
    expect(() => parseSummaryArgs(['--before', 'none', '--after', 'a', '--status'])).toThrow('--status needs a value');
  });
});

describe('resolveStatusFile', () => {
  it('returns a file path as given (resolved against cwd), the newest <date>.json of a directory, or of the raw dir for `latest`', () => {
    const dir = mkdtempSync(join(tmpdir(), 'status-'));
    mkdirSync(join(dir, '_status'));
    for (const f of ['2026-09-30.json', '2026-10-08.json', 'notes.txt']) writeFileSync(join(dir, '_status', f), '[]');
    expect(resolveStatusFile('x.json', join(dir, '_status'), dir)).toBe(join(dir, 'x.json'));
    expect(resolveStatusFile('_status', join(dir, 'nope'), dir)).toBe(join(dir, '_status', '2026-10-08.json'));
    expect(resolveStatusFile('latest', join(dir, '_status'), '/elsewhere')).toBe(join(dir, '_status', '2026-10-08.json'));
  });
  it('throws when there is nothing to pick', () => {
    const dir = mkdtempSync(join(tmpdir(), 'status-'));
    expect(() => resolveStatusFile('latest', join(dir, 'missing'), dir)).toThrow('no status file');
    mkdirSync(join(dir, 'empty'));
    expect(() => resolveStatusFile('empty', join(dir, '_status'), dir)).toThrow('no status file');
  });
});

describe.skipIf(!existsSync(REAL_WORLD))('loadSummaryInput', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summary-'));
  const write = (name: string, data: unknown) => {
    writeFileSync(join(dir, name), typeof data === 'string' ? data : JSON.stringify(data));
    return name;
  };
  const world = readFileSync(REAL_WORLD, 'utf8');
  write('world.json', world);
  write('status.json', [
    { id: 'a', status: 'ok', count: 3, ms: 1 },
    { id: 'b', status: 'failed', count: 0, error: 'boom', ms: 1 },
  ]);
  write('warnings.json', ['w1', 'w2']);
  const base = { before: 'world.json', after: 'world.json', status: 'status.json', warnings: 'warnings.json', out: null };
  const opts = { cwd: dir, rawStatusDir: join(dir, 'none'), env: {} as Record<string, string | undefined> };

  it('reads the world, status and warnings files (relative to cwd)', () => {
    const input = loadSummaryInput(base, opts);
    expect(input.before?.months).toEqual(input.after.months);
    expect(input.status.map((s) => s.id)).toEqual(['a', 'b']);
    expect(input.warnings).toEqual(['w1', 'w2']);
  });
  it('renders the real world.json against itself without movers or new events', () => {
    const md = renderPrSummary(loadSummaryInput(base, opts));
    expect(md).toMatch(/^## 今週の戦況更新（\d{4}-\d{2}-\d{2}）/);
    expect(md).toContain('追加された速報：0 件');
    expect(md).toContain('| b | boom |');
    expect(md).not.toContain('⚠');
  });
  it('renders the real first-run summary within the size GitHub accepts for a PR body', () => {
    const md = renderPrSummary(loadSummaryInput({ ...base, before: null }, opts));
    expect(md.length).toBeLessThan(65536);
    expect(md).toContain('前回との比較はありません');
  });
  it('treats an unreadable (old-schema) before as no comparison and says so', () => {
    write('old.json', { schemaVersion: 1 });
    const notes: string[] = [];
    const input = loadSummaryInput({ ...base, before: 'old.json' }, { ...opts, note: (m) => notes.push(m) });
    expect(input.before).toBeNull();
    expect(notes).toHaveLength(1);
  });
  it('fails on a missing or invalid after / before / status', () => {
    expect(() => loadSummaryInput({ ...base, after: 'missing.json' }, opts)).toThrow('--after world.json not found');
    expect(() => loadSummaryInput({ ...base, before: 'missing.json' }, opts)).toThrow('--before world.json not found');
    write('broken.json', '{ nope');
    expect(() => loadSummaryInput({ ...base, after: 'broken.json' }, opts)).toThrow('not valid JSON');
    write('badstatus.json', [{ id: 1 }]);
    expect(() => loadSummaryInput({ ...base, status: 'badstatus.json' }, opts)).toThrow('not a list of fetch statuses');
  });
  it('continues without warnings when the warnings file is missing, but rejects a malformed one', () => {
    const notes: string[] = [];
    expect(loadSummaryInput({ ...base, warnings: 'missing.json' }, { ...opts, note: (m) => notes.push(m) }).warnings).toEqual([]);
    expect(notes).toHaveLength(1);
    write('badwarn.json', { a: 1 });
    expect(() => loadSummaryInput({ ...base, warnings: 'badwarn.json' }, opts)).toThrow('not a list of strings');
    expect(loadSummaryInput({ ...base, warnings: null }, opts).warnings).toEqual([]);
  });
  it('collects the values of the secret environment variables for masking', () => {
    const input = loadSummaryInput(base, { ...opts, env: { OPENROUTER_API_KEY: 'sk-or-v1-abcdef123456', CLOUDFLARE_API_TOKEN: '', PATH: '/bin' } });
    expect(input.secrets).toEqual(['sk-or-v1-abcdef123456']);
  });
});
