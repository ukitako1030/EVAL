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

export function prettyModel(model: string, releases: CompiledRelease[]): string {
  const r = releaseOf(releases, model);
  if (r?.display) return r.display;
  return model
    .replace(/[-_](\d{8}|\d{4}-\d{2}-\d{2}|\d{4})$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b([a-z])/g, (ch) => ch.toUpperCase());
}

function text(type: EventType, front: { name: Localized }, unit: string, extra: { model?: string; from?: string; down?: boolean }): Localized {
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

  months.forEach((m, i) => {
    const at = (u: string, k: number) => cells.get(u)![k];
    const present = ids.filter((u) => at(u, i));
    // estimated values are placeholders, not measurements: they never lead and never move
    const measured = present.filter((u) => at(u, i)!.q !== 'estimated');
    const push = (type: EventType, unit: string, extra: { model?: string; from?: string; down?: boolean } = {}) =>
      raw.push({ month: m, front: front.id, unit, type, text: text(type, front, name(unit), extra), ...(extra.model ? { model: extra.model } : {}), ...(extra.from ? { from: extra.from } : {}) });

    // leaders with hysteresis. A leader whose cell is merely *estimated* keeps the lead (an estimate is a placeholder,
    // not evidence that it fell behind); the lead is handed over without hysteresis only when the leader's cell is null.
    const candS = argmax(measured, (u) => at(u, i)!.s);
    if (candS) {
      const cellS = leadS ? at(leadS, i) : null;
      const take = !leadS || !cellS || (cellS.q !== 'estimated' && candS !== leadS && at(candS, i)!.s >= cellS.s + params.leadHysteresis);
      if (take) {
        if (i > 0 && leadS) push('lead_change', candS, { from: name(leadS) });
        leadS = candS;
      }
    }
    const candC = argmax(present, (u) => at(u, i)!.c);
    if (candC) {
      const cellC = leadC ? at(leadC, i) : null;
      const take = !leadC || !cellC || (candC !== leadC && at(candC, i)!.c >= cellC.c + params.leadHysteresis);
      if (take) {
        if (i > 0 && leadC) push('scale_lead_change', candC, { from: name(leadC) });
        leadC = candC;
      }
    }
    if (i === 0) return;
    for (const u of present) {
      const cur = at(u, i)!;
      const prev = at(u, i - 1);
      if (!prev) {
        push('new_unit', u);
        continue;
      }
      if (cur.q === 'estimated' || prev.q === 'estimated') continue;
      const ds = cur.s - prev.s;
      const newModel = cur.bestModel && prev.bestModel && cur.bestModel !== prev.bestModel && ds >= params.newModelMinDelta;
      if (newModel) push('new_model', u, { model: prettyModel(cur.bestModel!, args.releases) });
      else if (Math.abs(ds) >= params.surgeStrength || cur.c - prev.c >= params.surgeScale) push('surge', u, { down: ds <= -params.surgeStrength });
    }
  });

  // cap per month by priority (stable within a priority)
  const byMonth = new Map<Month, WorldEvent[]>();
  for (const e of raw) {
    if (!byMonth.has(e.month)) byMonth.set(e.month, []);
    byMonth.get(e.month)!.push(e);
  }
  let out: WorldEvent[] = [];
  for (const m of months) {
    const list = (byMonth.get(m) ?? []).map((e, k) => ({ e, k }));
    list.sort((a, b) => PRIORITY[a.e.type] - PRIORITY[b.e.type] || a.k - b.k);
    out.push(...list.slice(0, params.maxPerFrontMonth).map((x) => x.e));
  }

  // overrides
  out = out.flatMap((e) => {
    const o = args.overrides.find((x) => x.month === e.month && x.front === e.front && x.unit === e.unit && x.type === e.type);
    if (!o) return [e];
    if (o.hide) return [];
    return [o.text ? { ...e, text: o.text } : e];
  });
  for (const c of args.custom.filter((c) => c.front === front.id)) {
    out.push({ month: c.month, front: c.front, unit: c.unit, type: 'custom', text: c.text });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month) || PRIORITY[a.type] - PRIORITY[b.type]);
}
