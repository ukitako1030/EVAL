import { addMonths, toMonth } from '../core/months';
import type { SignalObs } from '../core/types';
import { parseCsv } from './lib/csv';
import { toNumber } from './lib/values';
import type { ScaleModule } from './types';

const FROM = { int: '202301', label: '2023-01' };
/** Columns that are not a chatbot: the date and the (always ~0) remainder bucket. */
const SKIP_LABELS = new Set(['Date', 'Other']);

/**
 * Worldwide, all devices, monthly, 2023-01 … previous month, CSV. The range must span at least two months,
 * otherwise StatCounter answers in a different ("bar") format. The current month is partial, so it is left out.
 */
export function statcounterUrl(now: Date): string {
  const last = addMonths(toMonth(now), -1);
  const toInt = last.replace('-', '');
  return (
    'https://gs.statcounter.com/chart.php?device=Desktop%20%26%20Mobile%20%26%20Tablet%20%26%20Console' +
    '&device_hidden=desktop%2Bmobile%2Btablet%2Bconsole&multi-device=true&statType_hidden=ai_chatbot' +
    '&region_hidden=ww&granularity=monthly&statType=AI%20Chatbot&region=Worldwide' +
    `&fromInt=${FROM.int}&toInt=${toInt}&fromMonthYear=${FROM.label}&toMonthYear=${last}&csv=1`
  );
}

/**
 * Parses the "line graph" CSV (`"Date","ChatGPT",…,"Other"`, then `YYYY-MM,share,…` with columns in a query-dependent order).
 * Months before coverage come back as all-zero rows after the real ones; those are missing data, not 0 %, and are dropped.
 */
export function parseStatcounter(raw: unknown): SignalObs[] {
  if (typeof raw !== 'string') return [];
  let rows: Record<string, string>[];
  try {
    rows = parseCsv(raw);
  } catch {
    return [];
  }
  const out: SignalObs[] = [];
  const dated = rows
    .map((r) => ({ r, month: /^\d{4}-\d{2}/.test((r.Date ?? '').trim()) ? r.Date.trim().slice(0, 7) : null }))
    .filter((x): x is { r: Record<string, string>; month: string } => x.month !== null)
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  for (const { r, month } of dated) {
    const shares = Object.entries(r)
      .filter(([label]) => label.trim() !== 'Date')
      .map(([label, v]) => [label.trim(), toNumber(v)] as const);
    if (!shares.some(([, v]) => v !== null && v > 0)) continue; // all-zero (or unreadable) row = month not covered
    for (const [label, value] of shares) {
      if (SKIP_LABELS.has(label) || value === null || !(value > 0)) continue;
      out.push({ signal: 'statcounter', key: label, month, value });
    }
  }
  return out;
}

export const statcounter: ScaleModule = {
  id: 'statcounter',
  role: 'scale',
  history: 'full',
  meta: {
    name: 'StatCounter Global Stats: AI Chatbot Market Share',
    url: 'https://gs.statcounter.com/ai-chatbot-market-share',
    license: 'CC BY-SA 3.0',
    credit: 'AI Chatbot Market Share, StatCounter Global Stats (https://gs.statcounter.com), CC BY-SA 3.0',
  },
  fetch: (ctx) => ctx.fetchText(statcounterUrl(ctx.now)),
  parse: (raw) => parseStatcounter(raw),
};
