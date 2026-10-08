import { read, utils } from 'xlsx';
import type { Observation } from '../core/types';
import { isoDate, toNumber } from './lib/values';
import type { FetchCtx, StrengthModule } from './types';

/**
 * Served directly over HTTPS by the site host (byte-identical to the OS-World/OS-World.github.io raw copy, checked 2026-10-08).
 * Do not use `https://os-world.github.io/static/data/…`: it answers 301 to `http://osworld-v1.xlang.ai/…`, a cleartext download.
 * `http.ts` additionally refuses any https request that ends on an http URL.
 */
export const OSWORLD_XLSX_URL = 'https://osworld-v1.xlang.ai/static/data/osworld_verified_results.xlsx';

type Row = Record<string, unknown>;

/**
 * Reads the first sheet of the OSWorld-Verified workbook into plain rows.
 * `raw: true` keeps the numeric score cells numbers (placeholders such as "🚧" and "-" stay strings);
 * date cells come out as Excel serial numbers (real dates and hand-typed serials alike), which `isoDate` turns into
 * "YYYY-MM-DD" so the result is JSON-serialisable.
 */
export function readOsworldXlsx(bytes: Uint8Array): Row[] {
  const wb = read(bytes, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('OSWorld xlsx has no sheets');
  const rows = utils.sheet_to_json<Row>(sheet, { raw: true, defval: null });
  return rows.map((r) => ({ ...r, Date: isoDate(r['Date']) }));
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Pure parser for the rows produced by `readOsworldXlsx` (also accepts rows whose Date is still an Excel serial). */
export function parseOsworld(raw: unknown): Observation[] {
  if (!Array.isArray(raw)) return [];
  const out: Observation[] = [];
  for (const row of raw as unknown[]) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Row;
    if (str(r['Approach type']) !== 'General model') continue;
    const model = str(r['Model']);
    const value = toNumber(r['Success rate']); // "🚧" and "-" placeholders → null
    const date = isoDate(r['Date']);
    if (!model || value === null || value < 0 || value > 100 || !date) continue;
    const org = str(r['Institution']);
    out.push({
      series: 'osworld-verified',
      kind: 'percent',
      model,
      ...(org ? { org } : {}),
      date,
      dateKind: 'release',
      value,
    });
  }
  return out;
}

export const osworld: StrengthModule = {
  id: 'osworld',
  role: 'strength',
  group: 'osworld',
  history: 'full',
  meta: {
    name: 'OSWorld-Verified',
    url: 'https://os-world.github.io/',
    license: 'CC BY-SA 4.0',
    credit: 'OSWorld-Verified leaderboard (xlang.ai / os-world.github.io), CC BY-SA 4.0',
  },
  async fetch(ctx: FetchCtx) {
    return readOsworldXlsx(await ctx.fetchBytes(OSWORLD_XLSX_URL));
  },
  parse: (raw) => parseOsworld(raw),
};
