import { parquetMetadata, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

export interface ParquetReadOpts {
  /** columns to read; the others are never decoded */
  columns: string[];
  /** applied to every row after bigint → number conversion; rows for which it returns false are dropped */
  filter?: (row: Record<string, unknown>) => boolean;
  /** rows decoded at a time (default 50 000), so a 1.2 M-row file never has all its rows in memory at once */
  chunkRows?: number;
}

const DEFAULT_CHUNK_ROWS = 50_000;

/** The whole buffer when `bytes` spans one exactly, otherwise a copy of the viewed range. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = bytes.buffer;
  if (buf instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === buf.byteLength) return buf;
  return bytes.slice().buffer;
}

/** hyparquet returns INT64 as bigint, which JSON cannot hold and `===`/arithmetic with numbers trips over. */
function plain(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(plain);
  if (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  }
  return v;
}

export async function readParquetRows(bytes: Uint8Array, opts: ParquetReadOpts): Promise<Record<string, unknown>[]> {
  const chunkRows = opts.chunkRows ?? DEFAULT_CHUNK_ROWS;
  if (!Number.isInteger(chunkRows) || chunkRows < 1) throw new RangeError(`chunkRows must be a positive integer, got ${chunkRows}`);
  const file = toArrayBuffer(bytes);
  const metadata = parquetMetadata(file);
  const total = Number(metadata.num_rows);
  const out: Record<string, unknown>[] = [];
  for (let rowStart = 0; rowStart < total; rowStart += chunkRows) {
    const rowEnd = Math.min(rowStart + chunkRows, total);
    const chunk = await parquetReadObjects({ file, metadata, columns: opts.columns, rowStart, rowEnd, compressors });
    for (const raw of chunk) {
      const row: Record<string, unknown> = {};
      for (const k of Object.keys(raw)) row[k] = plain(raw[k]);
      if (!opts.filter || opts.filter(row)) out.push(row);
    }
  }
  return out;
}
