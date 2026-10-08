import type { Confidence, FrontId, Localized } from '../core/types';
import type { Month } from '../core/months';
import type { CompiledRelease } from '../config/load';
import type { EventsFile, Method } from '../config/schemas';
import { releaseOf } from './assign';

export type EventType = 'new_unit' | 'new_model' | 'lead_change' | 'scale_lead_change' | 'surge' | 'custom';

export interface WorldEvent {
  month: Month;
  front: FrontId;
  unit: string;
  type: EventType;
  text: Localized;
  model?: string;
  from?: string;
}

/** unitId → per-month cell aligned with `months` (null = not present). `bestModel` comes from the front's event group. */
export type FrontCells = Map<string, ({ s: number; c: number; bestModel: string | null; q: Confidence } | null)[]>;

const PRIORITY: Record<EventType, number> = { lead_change: 0, new_unit: 1, new_model: 2, scale_lead_change: 3, surge: 4, custom: 5 };

const MM = '(?:0[1-9]|1[0-2])';
const DD = '(?:0[1-9]|[12]\\d|3[01])';
const END = '(?=[-_ (]|$)'; // a date token must end at a separator, a parenthesis or the end of the string
const DATE_ISO = new RegExp(`[-_ ](?:19|20)\\d{2}-${MM}-${DD}${END}`, 'g'); // -2024-05-13
const DATE_COMPACT = new RegExp(`[-_ ](?:19|20)\\d{2}${MM}${DD}${END}`, 'g'); // -20240620
const DATE_MM_DD = new RegExp(`[-_ ]${MM}-${DD}${END}`, 'g'); // -03-25 (the year is gone, e.g. gemini-2.5-pro-exp-03-25)
const DATE_TOKEN_4 = new RegExp(`^(?:${MM}${DD}|\\d{2}${MM})$`); // trailing -MMDD (0613) or -YYMM (2411)
const NOISE_TOKEN = /^(?:preview|exp|latest|thinking|\d+k)$/i;

function caseToken(t: string): string {
  if (/^gpt$/i.test(t)) return 'GPT';
  if (/^o\d+$/.test(t)) return t; // o1, o3, o4 stay lowercase
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Display name for a model id. Release display names win; otherwise strip dates/suffixes and title-case. */
export function prettyModel(model: string, releases: CompiledRelease[]): string {
  const r = releaseOf(releases, model);
  if (r?.display) return r.display;

  // the parenthesised part is kept as written (only title-cased); everything before it is cleaned up
  const open = model.indexOf('(');
  const head = (open < 0 ? model : model.slice(0, open)).replace(DATE_ISO, '').replace(DATE_COMPACT, '').replace(DATE_MM_DD, '');
  const tail = open < 0 ? '' : model.slice(open);

  let tokens = head.split(/[\s_-]+/).filter(Boolean);
  while (tokens.length > 1 && (NOISE_TOKEN.test(tokens[tokens.length - 1]) || DATE_TOKEN_4.test(tokens[tokens.length - 1]))) tokens.pop();

  // claude-3-5-sonnet → 3.5: two single-digit tokens in a row are a split version number
  const joined: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (/^\d$/.test(tokens[i]) && /^\d$/.test(tokens[i + 1] ?? '')) {
      joined.push(`${tokens[i]}.${tokens[i + 1]}`);
      i++;
    } else joined.push(tokens[i]);
  }
  tokens = joined;

  const main = tokens.map(caseToken).join(' ');
  return [main, tail ? titleParen(tail) : ''].filter(Boolean).join(' ') || model;
}

function titleParen(tail: string): string {
  return tail.replace(/[-_]+/g, ' ').replace(/[^\s()]+/g, (w) => caseToken(w));
}

function text(type: EventType, front: { name: Localized }, unit: string, extra: { model?: string; from?: string; down?: boolean }): Localized {
  // `unit` and `extra.from` are display names here; the event itself stores unit ids
  const f = front.name;
  switch (type) {
    case 'new_unit':
      return { ja: `${unit} 参戦 — ${f.ja}`, en: `${unit} enters the ${f.en}` };
    case 'new_model':
      return { ja: `${extra.model} 投入 — ${f.ja}`, en: `${extra.model} deployed — ${f.en}` };
    case 'lead_change':
      return { ja: `${f.ja}で首位交代：${extra.from} → ${unit}`, en: `Lead change on the ${f.en}: ${extra.from} → ${unit}` };
    case 'scale_lead_change':
      return { ja: `${f.ja}で最大勢力が交代：${extra.from} → ${unit}`, en: `Largest force on the ${f.en}: ${extra.from} → ${unit}` };
    case 'surge':
      return extra.down
        ? { ja: `${unit} 後退 — ${f.ja}`, en: `${unit} falls back — ${f.en}` }
        : { ja: `${unit} 急伸 — ${f.ja}`, en: `${unit} surges — ${f.en}` };
    case 'custom':
      return { ja: '', en: '' };
  }
}

function argmax(ids: string[], v: (id: string) => number): string | null {
  let best: string | null = null;
  for (const id of ids) if (best === null || v(id) > v(best)) best = id;
  return best;
}

export function detectEvents(args: {
  front: { id: FrontId; name: Localized };
  months: Month[];
  cells: FrontCells;
  unitNames: Record<string, string>;
  params: Method['events'];
  releases: CompiledRelease[];
  overrides: EventsFile['overrides'];
  custom: EventsFile['custom'];
}): WorldEvent[] {
  const { front, months, cells, params } = args;
  const ids = [...cells.keys()];
  const name = (u: string) => args.unitNames[u] ?? u;
  const raw: WorldEvent[] = [];
  let leadS: string | null = null;
  let leadC: string | null = null;
  const seen = new Set<string>(); // units that have had a cell in any earlier month (or this one)

  months.forEach((m, i) => {
    const at = (u: string, k: number) => cells.get(u)![k];
    const present = ids.filter((u) => at(u, i));
    // a unit that disappears and comes back is not "new" again; units present in the first month are not new either
    const fresh = new Set(present.filter((u) => !seen.has(u)));
    for (const u of present) seen.add(u);
    // estimated values are placeholders, not measurements: they never lead and never move
    const measured = present.filter((u) => at(u, i)!.q !== 'estimated');
    const push = (type: EventType, unit: string, extra: { model?: string; from?: string; down?: boolean } = {}) =>
      raw.push({
        month: m,
        front: front.id,
        unit,
        type,
        text: text(type, front, name(unit), { ...extra, ...(extra.from ? { from: name(extra.from) } : {}) }),
        ...(extra.model ? { model: extra.model } : {}),
        ...(extra.from ? { from: extra.from } : {}),
      });

    // leaders with hysteresis. A leader whose cell is merely *estimated* keeps the lead (an estimate is a placeholder,
    // not evidence that it fell behind); the lead is handed over without hysteresis only when the leader's cell is null.
    const candS = argmax(measured, (u) => at(u, i)!.s);
    if (candS) {
      const cellS = leadS ? at(leadS, i) : null;
      const take = !leadS || !cellS || (cellS.q !== 'estimated' && candS !== leadS && at(candS, i)!.s >= cellS.s + params.leadHysteresis);
      if (take) {
        if (i > 0 && leadS) push('lead_change', candS, { from: leadS });
        leadS = candS;
      }
    }
    const candC = argmax(present, (u) => at(u, i)!.c);
    if (candC) {
      const cellC = leadC ? at(leadC, i) : null;
      const take = !leadC || !cellC || (candC !== leadC && at(candC, i)!.c >= cellC.c + params.leadHysteresis);
      if (take) {
        if (i > 0 && leadC) push('scale_lead_change', candC, { from: leadC });
        leadC = candC;
      }
    }
    if (i === 0) return;
    for (const u of present) {
      const cur = at(u, i)!;
      const prev = at(u, i - 1);
      if (!prev) {
        if (fresh.has(u)) push('new_unit', u);
        continue;
      }
      if (cur.q === 'estimated' || prev.q === 'estimated') continue;
      const ds = cur.s - prev.s;
      const newModel = cur.bestModel && prev.bestModel && cur.bestModel !== prev.bestModel && ds >= params.newModelMinDelta;
      if (newModel) push('new_model', u, { model: prettyModel(cur.bestModel!, args.releases) });
      else if (Math.abs(ds) >= params.surgeStrength || cur.c - prev.c >= params.surgeScale) push('surge', u, { down: ds <= -params.surgeStrength });
    }
  });

  // overrides first, so that a hidden event does not take up one of the per-month slots
  const used = new Set<number>();
  const overridden = raw.flatMap((e) => {
    const hits = args.overrides.map((o, k) => ({ o, k })).filter(({ o }) => o.month === e.month && o.front === e.front && o.unit === e.unit && o.type === e.type);
    if (!hits.length) return [e];
    for (const h of hits) used.add(h.k);
    if (hits.some(({ o }) => o.hide)) return [];
    const text = hits.find(({ o }) => o.text)?.o.text;
    return [text ? { ...e, text } : e];
  });
  args.overrides.forEach((o, k) => {
    if (!used.has(k)) console.warn(`events.yaml override matched no detected event: ${o.month} ${o.front} ${o.unit} ${o.type}`);
  });

  // cap per month by priority (stable within a priority)
  const byMonth = new Map<Month, WorldEvent[]>();
  for (const e of overridden) {
    if (!byMonth.has(e.month)) byMonth.set(e.month, []);
    byMonth.get(e.month)!.push(e);
  }
  const out: WorldEvent[] = [];
  for (const m of months) {
    const list = (byMonth.get(m) ?? []).map((e, k) => ({ e, k }));
    list.sort((a, b) => PRIORITY[a.e.type] - PRIORITY[b.e.type] || a.k - b.k);
    out.push(...list.slice(0, params.maxPerFrontMonth).map((x) => x.e));
  }
  for (const c of args.custom.filter((c) => c.front === front.id)) {
    out.push({ month: c.month, front: c.front, unit: c.unit, type: 'custom', text: c.text });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month) || PRIORITY[a.type] - PRIORITY[b.type]);
}
