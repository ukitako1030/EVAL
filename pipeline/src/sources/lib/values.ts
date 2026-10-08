const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Number, bigint or numeric string (also "85.06%") → number; blanks, "-", "🚧", NaN, ±Infinity and anything else → null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s*%$/, '');
  if (!NUMERIC.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Real calendar date → "YYYY-MM-DD", otherwise null (so 2025-02-30 is rejected). */
function ymd(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(t.getTime()) || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

const EXCEL_MIN = 20000;
const EXCEL_MAX = 80000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30); // Excel serial 0 under the 1900 leap-year quirk (valid from 1900-03-01)

/**
 * Accepts YYYY-MM-DD, YYYYMMDD (string or number), ISO date-times (the date as written, no time-zone shift),
 * JS Dates (UTC date) and Excel serial numbers 20000–80000. Anything else → null.
 */
export function isoDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    if (v >= EXCEL_MIN && v <= EXCEL_MAX) return new Date(EXCEL_EPOCH + Math.floor(v) * 86_400_000).toISOString().slice(0, 10);
    if (Number.isInteger(v) && v >= 10_000_101 && v <= 99_991_231) return isoDate(String(v));
    return null;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  if (/^\d{5}(?:\.\d+)?$/.test(s)) return isoDate(Number(s));
  return null;
}

/** Keeps only the rows whose date equals the latest date present in their calendar month (rows without an ISO date are dropped). */
export function lastPerMonth<T>(rows: T[], dateOf: (r: T) => string): T[] {
  const latest = new Map<string, string>();
  for (const r of rows) {
    const d = dateOf(r);
    if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
    const month = d.slice(0, 7);
    const cur = latest.get(month);
    if (cur === undefined || d > cur) latest.set(month, d);
  }
  return rows.filter((r) => {
    const d = dateOf(r);
    return /^\d{4}-\d{2}-\d{2}/.test(d) && latest.get(d.slice(0, 7)) === d;
  });
}
