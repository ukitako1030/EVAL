import { describe, it, expect, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { zipSync, strToU8 } from 'fflate';
import * as hyparquet from 'hyparquet';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { parseCsv } from '../../src/sources/lib/csv';
import { readParquetRows } from '../../src/sources/lib/parquet';
import { unzipTexts, gunzipText } from '../../src/sources/lib/archive';
import { toNumber, isoDate, lastPerMonth } from '../../src/sources/lib/values';
import { memoBytes } from '../../src/sources/lib/memo';

vi.mock('hyparquet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('hyparquet')>();
  return { ...actual, parquetReadObjects: vi.fn(actual.parquetReadObjects) };
});

describe('parseCsv', () => {
  it('handles CRLF and a quoted multi-line field', () => {
    const text = 'id,note,n\r\n1,"line one\r\nline two, with comma",5\r\n2,plain,6\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      { id: '1', note: 'line one\r\nline two, with comma', n: '5' },
      { id: '2', note: 'plain', n: '6' },
    ]);
  });
  it('strips a BOM, skips empty lines and tolerates ragged rows', () => {
    expect(parseCsv('﻿a,b\n1,2\n\n3\n4,5,6\n')).toEqual([{ a: '1', b: '2' }, { a: '3' }, { a: '4', b: '5' }]);
  });
  it('returns [] for header-only or empty input', () => {
    expect(parseCsv('a,b\n')).toEqual([]);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('toNumber', () => {
  it.each<[unknown, number | null]>([
    [5, 5],
    [-1.5, -1.5],
    [0, 0],
    [12n, 12],
    ['42', 42],
    [' 3.14 ', 3.14],
    ['-7', -7],
    ['1e3', 1000],
    ['.5', 0.5],
    ['85.06%', 85.06],
    ['85.06 %', 85.06],
    ['0%', 0],
    ['', null],
    ['   ', null],
    ['-', null],
    ['🚧', null],
    ['n/a', null],
    ['12abc', null],
    ['0x10', null],
    [null, null],
    [undefined, null],
    [NaN, null],
    ['NaN', null],
    [Infinity, null],
    [true, null],
    [{}, null],
  ])('%s -> %s', (input, expected) => {
    expect(toNumber(input)).toBe(expected);
  });
});

describe('isoDate', () => {
  it.each<[unknown, string | null]>([
    ['2025-05-14', '2025-05-14'],
    ['20250514', '2025-05-14'],
    [20250514, '2025-05-14'],
    ['2025-07-28T09:28:54-04:00', '2025-07-28'],
    ['2025-07-28T09:28:54.123Z', '2025-07-28'],
    ['2025-07-28 09:28:54', '2025-07-28'],
    [new Date(Date.UTC(2025, 6, 28, 23, 59)), '2025-07-28'],
    [45870, '2025-08-01'],
    [45870.75, '2025-08-01'],
    ['45870', '2025-08-01'],
    [20000, '1954-10-03'],
    [80000, '2119-01-11'],
    [19999, null],
    [80001, null],
    ['2025-02-30', null],
    ['20251340', null],
    ['yesterday', null],
    ['', null],
    [null, null],
    [undefined, null],
    [new Date('nope'), null],
  ])('%s -> %s', (input, expected) => {
    expect(isoDate(input)).toBe(expected);
  });
});

describe('lastPerMonth', () => {
  it('keeps only the rows on the latest date of each calendar month', () => {
    const rows = [
      { d: '2025-05-11', v: 1 },
      { d: '2025-05-19', v: 2 },
      { d: '2025-05-19', v: 3 },
      { d: '2025-06-02', v: 4 },
      { d: '2025-04-30', v: 5 },
      { d: '2025-04-01', v: 6 },
    ];
    expect(lastPerMonth(rows, (r) => r.d).map((r) => r.v)).toEqual([2, 3, 4, 5]);
  });
  it('handles empty input', () => {
    expect(lastPerMonth([], (r: { d: string }) => r.d)).toEqual([]);
  });
});

describe('archive helpers', () => {
  it('gunzipText round-trips', () => {
    const text = 'héllo, 世界\nline two\n';
    expect(gunzipText(gzipSync(Buffer.from(text, 'utf8')))).toBe(text);
  });
  it('unzipTexts returns only the entries whose name matches', () => {
    const zip = zipSync({
      'data/a.csv': strToU8('a,b\n1,2\n'),
      'data/b.csv': strToU8('x,y\n3,4\n'),
      'readme.txt': strToU8('ignore me'),
      'data/': new Uint8Array(0),
    });
    expect(unzipTexts(zip, /\.csv$/)).toEqual({ 'data/a.csv': 'a,b\n1,2\n', 'data/b.csv': 'x,y\n3,4\n' });
    expect(unzipTexts(zip, /^data\/a/)).toEqual({ 'data/a.csv': 'a,b\n1,2\n' });
    expect(unzipTexts(zip, /nothing/)).toEqual({});
  });
  it('unzipTexts is not confused by a global/sticky regex', () => {
    const zip = zipSync({ 'a.csv': strToU8('1'), 'b.csv': strToU8('2') });
    expect(Object.keys(unzipTexts(zip, /\.csv$/g)).sort()).toEqual(['a.csv', 'b.csv']);
  });
});

describe('memoBytes', () => {
  it('loads once per key, even for concurrent callers', async () => {
    const load = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const [a, b] = await Promise.all([memoBytes('memo-shared', load), memoBytes('memo-shared', load)]);
    const c = await memoBytes('memo-shared', load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
  });
  it('keeps keys separate and does not cache failures', async () => {
    const other = vi.fn(async () => new Uint8Array([9]));
    expect(Array.from(await memoBytes('memo-other', other))).toEqual([9]);
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw new Error('network down');
      return new Uint8Array([7]);
    };
    await expect(memoBytes('memo-flaky', flaky)).rejects.toThrow('network down');
    expect(Array.from(await memoBytes('memo-flaky', flaky))).toEqual([7]);
    expect(calls).toBe(2);
  });
});

describe('readParquetRows', () => {
  // 3 columns, 5 rows, `votes` is INT64 (read back as bigint by hyparquet)
  const file = new Uint8Array(
    parquetWriteBuffer({
      columnData: [
        { name: 'model', data: ['a', 'b', 'c', 'd', 'e'], type: 'STRING' },
        { name: 'votes', data: [10n, 20n, 30n, 40n, 50n], type: 'INT64' },
        { name: 'score', data: [1.5, 2.5, 3.5, 4.5, 5.5], type: 'DOUBLE' },
      ],
    }),
  );

  it('reads the requested columns only and converts bigint to number', async () => {
    const rows = await readParquetRows(file, { columns: ['model', 'votes'] });
    expect(rows).toEqual([
      { model: 'a', votes: 10 },
      { model: 'b', votes: 20 },
      { model: 'c', votes: 30 },
      { model: 'd', votes: 40 },
      { model: 'e', votes: 50 },
    ]);
    expect(rows.every((r) => typeof r.votes === 'number')).toBe(true);
  });

  it('applies the filter per chunk, reading chunkRows rows at a time', async () => {
    const spy = vi.mocked(hyparquet.parquetReadObjects);
    spy.mockClear();
    const seen: unknown[] = [];
    const rows = await readParquetRows(file, {
      columns: ['model', 'votes', 'score'],
      chunkRows: 2,
      filter: (r) => {
        seen.push(r.votes);
        return (r.votes as number) >= 30;
      },
    });
    expect(rows).toEqual([
      { model: 'c', votes: 30, score: 3.5 },
      { model: 'd', votes: 40, score: 4.5 },
      { model: 'e', votes: 50, score: 5.5 },
    ]);
    // the filter sees numbers, not bigints
    expect(seen).toEqual([10, 20, 30, 40, 50]);
    // 5 rows in chunks of 2 → [0,2) [2,4) [4,5)
    expect(spy.mock.calls.map(([o]) => [o.rowStart, o.rowEnd])).toEqual([
      [0, 2],
      [2, 4],
      [4, 5],
    ]);
  });

  it('defaults to chunks of 50 000 rows', async () => {
    const spy = vi.mocked(hyparquet.parquetReadObjects);
    spy.mockClear();
    await readParquetRows(file, { columns: ['model'] });
    expect(spy.mock.calls.map(([o]) => [o.rowStart, o.rowEnd])).toEqual([[0, 5]]);
  });

  it('returns [] when nothing matches, and reads from a Uint8Array view with a byte offset', async () => {
    expect(await readParquetRows(file, { columns: ['model'], filter: () => false })).toEqual([]);
    const padded = new Uint8Array(file.byteLength + 16);
    padded.set(file, 7);
    const view = padded.subarray(7, 7 + file.byteLength);
    expect(await readParquetRows(view, { columns: ['model', 'votes'], filter: (r) => r.model === 'b' })).toEqual([{ model: 'b', votes: 20 }]);
  });

  it('works across several row groups', async () => {
    const multi = new Uint8Array(
      parquetWriteBuffer({
        columnData: [{ name: 'n', data: [1n, 2n, 3n, 4n, 5n, 6n, 7n], type: 'INT64' }],
        rowGroupSize: 3,
      }),
    );
    const rows = await readParquetRows(multi, { columns: ['n'], chunkRows: 2, filter: (r) => (r.n as number) % 2 === 1 });
    expect(rows.map((r) => r.n)).toEqual([1, 3, 5, 7]);
  });
});
