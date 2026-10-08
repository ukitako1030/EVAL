import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { utils, write } from 'xlsx';
import { OSWORLD_XLSX_URL, osworld, parseOsworld, readOsworldXlsx } from '../../src/sources/osworld';
import type { FetchCtx } from '../../src/sources/types';

vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xlsx')>();
  return { ...actual, read: vi.fn(actual.read) };
});

type Row = Record<string, unknown>;
const rows = JSON.parse(readFileSync(new URL('../fixtures/osworld/sample.rows.json', import.meta.url), 'utf8')) as Row[];
const general = (model: string, steps: number) => rows.find((r) => r['Model'] === model && r['Max steps'] === steps && r['Approach type'] === 'General model')!;

describe('osworld parse', () => {
  const obs = parseOsworld(rows);

  it('keeps only General model rows with a numeric score and a date', () => {
    expect(rows.filter((r) => r['Approach type'] === 'General model')).toHaveLength(37);
    expect(obs).toHaveLength(37);
    expect(new Set(obs.map((o) => o.series))).toEqual(new Set(['osworld-verified']));
    expect(obs.every((o) => o.kind === 'percent' && o.dateKind === 'release')).toBe(true);
  });

  it('excludes Agentic framework, Specialized and Unknown rows', () => {
    expect(rows.filter((r) => r['Approach type'] === 'Agentic framework').length).toBeGreaterThan(0);
    const names = new Set(obs.map((o) => o.model));
    for (const r of rows.filter((x) => x['Approach type'] !== 'General model')) expect(names.has(String(r['Model']))).toBe(false);
    expect(obs.some((o) => o.model.includes(' w/ '))).toBe(false);
    expect(names.has('computer-use-preview')).toBe(false);
  });

  it('maps one concrete row exactly', () => {
    expect(obs.find((o) => o.model === 'claude-sonnet-4-6')).toEqual({
      series: 'osworld-verified',
      kind: 'percent',
      model: 'claude-sonnet-4-6',
      org: 'Anthropic',
      date: '2026-03-08',
      dateKind: 'release',
      value: 72.11,
    });
    expect(obs.find((o) => o.model === 'claude-fable-5[1m]')).toMatchObject({ org: 'Anthropic', date: '2026-08-01', value: 85.96 });
  });

  it('emits one observation per step budget (the compute stage takes the best)', () => {
    expect(obs.filter((o) => o.model === 'o3').map((o) => o.value)).toEqual([9.1, 17.17, 23]);
  });

  it('drops placeholder scores (🚧, -, blank), undated rows and out-of-range scores', () => {
    const base = general('claude-sonnet-4-6', 100);
    const bad = [
      { ...base, Model: 'ph-construction', 'Success rate': '🚧' },
      { ...base, Model: 'ph-dash', 'Success rate': '-' },
      { ...base, Model: 'ph-null', 'Success rate': null },
      { ...base, Model: 'ph-undated', Date: null },
      { ...base, Model: 'ph-range', 'Success rate': 130 },
      { ...base, Model: '', 'Success rate': 50 },
      null,
      'not a row',
    ];
    const good = { ...base, Model: 'ok-string-score', 'Success rate': '55.5' };
    const got = parseOsworld([...bad, good]);
    expect(got.map((o) => [o.model, o.value])).toEqual([['ok-string-score', 55.5]]);
  });

  it('converts Excel serial dates and returns [] for an unusable payload', () => {
    const base = general('claude-sonnet-4-6', 100);
    expect(parseOsworld([{ ...base, Date: 45886 }])[0].date).toBe('2025-08-17');
    expect(parseOsworld('nope')).toEqual([]);
    expect(parseOsworld(null)).toEqual([]);
    expect(parseOsworld([])).toEqual([]);
  });
});

describe('osworld fetch', () => {
  // A tiny workbook shaped like the real sheet: mixed real date cells / raw serials, emoji placeholders, an empty trailing column.
  const date = (serial: number) => ({ t: 'n', v: serial, z: 'd-mmm-yy' });
  const sheet = utils.aoa_to_sheet([
    ['Model', 'Institution', 'Approach type', 'Max steps', 'Date', 'Success rate', 'thunderbird'],
    ['claude-sonnet-4-6', 'Anthropic', 'General model', 100, date(46089), 72.11, date(46371)],
    ['Kimi K2.5', 'Moonshot AI', 'General model', 100, 46053, 63.3, '10/15'],
    ['agent s3 w/ Opus 4.5', 'Simular', 'Agentic framework', 100, 45886, 69.9, null],
    ['aguvis-72b', 'Specialized', 'Specialized model', 100, null, '🚧', null],
    ['qwen-x', 'Qwen', 'General model', 15, 45886, '-', null],
  ]);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, sheet, 'Eval Results');
  utils.book_append_sheet(wb, utils.aoa_to_sheet([['ignored']]), 'Other');
  const bytes = new Uint8Array(write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);

  it('reads the first sheet and turns every Date cell into YYYY-MM-DD', () => {
    const out = readOsworldXlsx(bytes);
    expect(out).toHaveLength(5);
    expect(out.map((r) => r['Date'])).toEqual(['2026-03-08', '2026-01-31', '2025-08-17', null, '2025-08-17']);
    expect(out[0]).toMatchObject({ Model: 'claude-sonnet-4-6', 'Success rate': 72.11, 'Max steps': 100 });
    expect(out[3]['Success rate']).toBe('🚧');
    expect(JSON.parse(JSON.stringify(out))).toEqual(out); // JSON-serialisable
  });

  it('asks SheetJS for the first sheet only and neither formulas nor rich-text HTML', () => {
    const read = vi.mocked(XLSX.read);
    read.mockClear();
    readOsworldXlsx(bytes);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][1]).toMatchObject({ type: 'array', sheets: 0, cellFormula: false, cellHTML: false });
    const wb = read.mock.results[0].value as XLSX.WorkBook;
    expect(wb.SheetNames).toHaveLength(2); // names are always listed …
    expect(Object.keys(wb.Sheets)).toEqual(['Eval Results']); // … but only the first sheet is parsed
  });

  it('downloads the documented URL and parses to observations', async () => {
    const seen: string[] = [];
    const ctx = {
      fetchBytes: async (url: string) => {
        seen.push(url);
        return bytes;
      },
    } as unknown as FetchCtx;
    const raw = await osworld.fetch(ctx);
    expect(seen).toEqual([OSWORLD_XLSX_URL]);
    expect(osworld.parse(raw, { now: new Date('2026-10-08T00:00:00Z') }).map((o) => [o.model, o.date, o.value])).toEqual([
      ['claude-sonnet-4-6', '2026-03-08', 72.11],
      ['Kimi K2.5', '2026-01-31', 63.3],
    ]);
  });

  it('downloads from the HTTPS host directly (os-world.github.io 301-redirects to plain http)', () => {
    expect(OSWORLD_XLSX_URL).toBe('https://osworld-v1.xlang.ai/static/data/osworld_verified_results.xlsx');
    expect(new URL(OSWORLD_XLSX_URL).protocol).toBe('https:');
  });

  it('declares the module contract', () => {
    expect(osworld).toMatchObject({ id: 'osworld', role: 'strength', group: 'osworld', history: 'full' });
    expect(osworld.meta.license).toBe('CC BY-SA 4.0');
  });
});
