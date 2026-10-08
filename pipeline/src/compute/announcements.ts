import { daysBetween, monthDiff, monthEnd, toMonth, type Month } from '../core/months';
import { logInterp } from '../core/math';
import type { AnnSeries } from '../config/schemas';

/**
 * MAU-equivalent users per month (spec §6.2-2):
 * - nothing before the first announcement,
 * - geometric interpolation (by day) between announcements,
 * - the last value is carried for `staleMonths` months, then dropped.
 * A month's value is evaluated at the month's last day; a point dated inside the month counts as "≤ month end".
 */
export function announcementMonthly(
  series: AnnSeries,
  months: Month[],
  factors: { MAU: number; WAU: number; DAU: number },
  staleMonths: number,
): Map<Month, number> {
  const pts = [...series.points]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ date: p.date, v: p.value * factors[p.metric ?? series.metric] }));
  const out = new Map<Month, number>();
  if (!pts.length) return out;
  const origin = pts[0].date;
  const day = (d: string) => daysBetween(origin, d);
  for (const m of months) {
    const end = monthEnd(m);
    let prev: (typeof pts)[number] | null = null;
    let next: (typeof pts)[number] | null = null;
    for (const p of pts) {
      if (p.date <= end) prev = p;
      else {
        next = p;
        break;
      }
    }
    if (!prev) continue;
    if (toMonth(prev.date) === m) {
      out.set(m, prev.v);
    } else if (next) {
      out.set(m, logInterp(day(prev.date), prev.v, day(next.date), next.v, day(end)));
    } else if (monthDiff(toMonth(prev.date), m) <= staleMonths) {
      out.set(m, prev.v);
    }
  }
  return out;
}
