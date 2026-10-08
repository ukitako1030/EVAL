export type Month = string; // 'YYYY-MM'

export function toMonth(date: string | Date): Month {
  if (typeof date === 'string') {
    const m = /^(\d{4})-(\d{2})/.exec(date);
    if (!m) throw new Error(`toMonth: unparseable date "${date}"`);
    return `${m[1]}-${m[2]}`;
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function addMonths(m: Month, n: number): Month {
  const [y, mo] = m.split('-').map(Number);
  const idx = y * 12 + (mo - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function monthRange(start: Month, end: Month): Month[] {
  const out: Month[] = [];
  for (let m = start; m <= end; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Last calendar day of the month as 'YYYY-MM-DD'. */
export function monthEnd(m: Month): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}

/** b − a in whole days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

/** b − a in months. */
export function monthDiff(a: Month, b: Month): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function todayISO(now: Date): string {
  return now.toISOString().slice(0, 10);
}
