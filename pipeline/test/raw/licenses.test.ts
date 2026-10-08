import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { lacksExplicitLicense, licenseIndex } from '../../src/raw/licenses';
import { SOURCES } from '../../src/sources/index';

const mod = (id: string, over: Partial<{ name: string; url: string; license: string; credit: string }> = {}) => ({
  id,
  meta: { name: `Name ${id}`, url: `https://example.org/${id}`, license: 'CC BY 4.0', credit: `Credit ${id}`, ...over },
});

describe('lacksExplicitLicense', () => {
  it('flags licence text that says "no explicit", "unclear" or "cited" (any case)', () => {
    expect(lacksExplicitLicense('No explicit data licence (code: Apache-2.0)')).toBe(true);
    expect(lacksExplicitLicense('Public API, rating counts only (terms unclear; no artwork)')).toBe(true);
    expect(lacksExplicitLicense('Leaderboard, CITED only')).toBe(true);
    expect(lacksExplicitLicense('No licence of its own; cite Le Pochat et al., NDSS 2019')).toBe(true);
  });
  it('does not flag a stated licence', () => {
    for (const l of ['CC BY 4.0', 'Apache-2.0 / CC BY-SA 4.0', 'MIT', 'CC0 1.0', 'Free to use with attribution (Design Arena API terms)']) {
      expect(lacksExplicitLicense(l)).toBe(false);
    }
  });
});

describe('licenseIndex', () => {
  const md = licenseIndex([
    mod('a', { license: 'CC BY 4.0' }),
    mod('b', { license: 'No explicit data licence (code: MIT)', credit: 'B | pipe\nnewline' }),
    mod('c', { license: 'CC0 1.0' }),
  ]);

  it('explains what the raw files are and that the file is generated', () => {
    expect(md).toMatch(/^# /);
    expect(md).toContain('normalised extracts');
    expect(md).toContain('recomputation');
    expect(md).toContain('npm run fetch');
  });
  it('has a table with one row per module, in order, with id, name, licence, credit and url', () => {
    const rows = md.split('\n').filter((l) => /^\| `/.test(l));
    expect(rows.map((r) => r.split('|')[1].trim())).toEqual(['`a`', '`b`', '`c`']);
    expect(md).toContain('| id | name | licence | credit | url |');
    expect(rows[0]).toBe('| `a` | Name a | CC BY 4.0 | Credit a | https://example.org/a |');
  });
  it('escapes pipes and newlines inside cells so the table stays intact', () => {
    const row = md.split('\n').find((l) => l.startsWith('| `b`'))!;
    expect(row).toContain('B \\| pipe newline');
    expect(row.replace(/\\\|/g, '').split('|')).toHaveLength(7); // leading/trailing empty + 5 cells
  });
  it('lists the sources without an explicit data licence in their own section', () => {
    const section = md.slice(md.indexOf('## Sources without an explicit data licence'), md.indexOf('| id |'));
    expect(section).toContain('`b`');
    expect(section).not.toContain('`a`');
    expect(section).not.toContain('`c`');
  });
  it('says so when every source has an explicit licence', () => {
    const all = licenseIndex([mod('a'), mod('c')]);
    expect(all).toContain('None.');
  });
  it('is deterministic (no timestamp) and ends with a single newline', () => {
    expect(licenseIndex([mod('a')])).toBe(licenseIndex([mod('a')]));
    expect(md.endsWith('|\n')).toBe(true);
  });
});

describe('committed raw/LICENSES.md', () => {
  it('is up to date with the SOURCES registry (regenerate with `npm run fetch`)', () => {
    const committed = readFileSync(new URL('../../raw/LICENSES.md', import.meta.url), 'utf8');
    expect(committed).toBe(licenseIndex(SOURCES));
  });
  it('lists every registered module exactly once', () => {
    const committed = readFileSync(new URL('../../raw/LICENSES.md', import.meta.url), 'utf8');
    for (const m of SOURCES) expect(committed.split(`| \`${m.id}\` |`)).toHaveLength(2);
  });
});
