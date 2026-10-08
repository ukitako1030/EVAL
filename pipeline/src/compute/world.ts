import { z } from 'zod';
import { FrontIdSchema, LocalizedSchema, MonthStr, EventTypeSchema } from '../config/schemas';

export const UnitMonthSchema = z.object({
  s: z.number().min(0).max(100),
  c: z.number().min(0).max(100),
  q: z.enum(['high', 'medium', 'reconstructed', 'estimated']),
});

const COLOR = /^#[0-9a-fA-F]{6}$/;

function isHttpUrl(s: string): boolean {
  try {
    const p = new URL(s).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

export const WorldSchema = z
  .object({
    generatedAt: z.string(),
    months: z.array(MonthStr).min(1),
    partialMonth: MonthStr,
    orgs: z.record(z.string(), z.object({ name: z.string(), color: z.string() })),
    fronts: z.array(z.object({ id: FrontIdSchema, name: LocalizedSchema })),
    units: z.record(z.string(), z.record(z.string(), z.object({ org: z.string(), name: z.string() }))),
    series: z.record(z.string(), z.record(z.string(), z.array(UnitMonthSchema.nullable()))),
    breakdown: z.record(
      z.string(),
      z.record(
        z.string(),
        z.record(
          z.string(),
          z.array(z.object({ source: z.string(), value: z.number(), weight: z.number(), kind: z.enum(['measured', 'reconstructed']) })),
        ),
      ),
    ),
    events: z.array(
      z.object({
        month: MonthStr,
        front: FrontIdSchema,
        unit: z.string(),
        type: EventTypeSchema,
        text: LocalizedSchema,
        model: z.string().optional(),
        from: z.string().optional(),
      }),
    ),
    sources: z.array(
      z.object({ id: z.string(), group: z.string(), name: z.string(), url: z.string(), license: z.string(), credit: z.string(), asOf: z.string().nullable() }),
    ),
  })
  .superRefine((w, ctx) => {
    const bad = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const has = (o: object | undefined, k: string) => o !== undefined && Object.hasOwn(o, k);

    // months / partialMonth
    w.months.forEach((m, i) => {
      if (i > 0 && m <= w.months[i - 1]) bad(['months', i], `${m} does not come after ${w.months[i - 1]} (months must be strictly increasing)`);
    });
    const months = new Set(w.months);
    if (!months.has(w.partialMonth)) bad(['partialMonth'], `partialMonth ${w.partialMonth} is not one of the months`);

    // fronts
    const frontIds = new Set<string>();
    w.fronts.forEach((f, i) => {
      if (frontIds.has(f.id)) bad(['fronts', i, 'id'], `duplicate front id ${f.id}`);
      frontIds.add(f.id);
    });
    const perFront: [string, Record<string, unknown>][] = [
      ['units', w.units],
      ['series', w.series],
      ['breakdown', w.breakdown],
    ];
    for (const [label, table] of perFront) {
      for (const key of Object.keys(table)) if (!frontIds.has(key)) bad([label, key], `${label} key "${key}" is not a front id`);
      for (const id of frontIds) if (!has(table, id)) bad([label, id], `${label} is missing front "${id}" (use {} for a front without units)`);
    }

    // units ↔ orgs ↔ series
    for (const f of frontIds) {
      const units = w.units[f];
      const series = w.series[f];
      for (const [u, def] of Object.entries(units ?? {})) {
        if (!has(w.orgs, def.org)) bad(['units', f, u, 'org'], `units.${f}.${u} refers to unknown org "${def.org}"`);
        if (series && !has(series, u)) bad(['series', f, u], `units.${f}.${u} has no series`);
      }
      for (const [u, arr] of Object.entries(series ?? {})) {
        if (arr.length !== w.months.length) bad(['series', f, u], `series.${f}.${u} has ${arr.length} entries, expected ${w.months.length}`);
        if (units && !has(units, u)) bad(['series', f, u], `series.${f}.${u} has no unit definition`);
      }
    }

    // events
    w.events.forEach((e, i) => {
      if (!months.has(e.month)) bad(['events', i, 'month'], `event month ${e.month} is not one of the months`);
      if (e.type !== 'custom' && !has(w.units[e.front], e.unit)) bad(['events', i, 'unit'], `event unit "${e.unit}" does not exist in front ${e.front}`);
    });

    // breakdown
    const groups = new Set(w.sources.map((s) => s.group));
    for (const [f, units] of Object.entries(w.breakdown)) {
      if (!frontIds.has(f)) continue; // already reported above
      for (const [u, byMonth] of Object.entries(units)) {
        if (!has(w.units[f], u)) bad(['breakdown', f, u], `breakdown.${f}.${u} has no unit definition`);
        for (const [m, rows] of Object.entries(byMonth)) {
          if (!months.has(m)) bad(['breakdown', f, u, m], `breakdown month ${m} is not one of the months`);
          rows.forEach((row, k) => {
            if (!groups.has(row.source)) bad(['breakdown', f, u, m, k, 'source'], `breakdown source "${row.source}" matches no sources[].group`);
          });
        }
      }
    }

    // sources / orgs
    w.sources.forEach((s, i) => {
      if (!isHttpUrl(s.url)) bad(['sources', i, 'url'], `source url "${s.url}" is not an http(s) URL`);
    });
    for (const [id, org] of Object.entries(w.orgs)) {
      if (!COLOR.test(org.color)) bad(['orgs', id, 'color'], `org color "${org.color}" is not #rrggbb`);
    }
  });

export type World = z.infer<typeof WorldSchema>;

export function validateWorld(w: unknown): World {
  const r = WorldSchema.safeParse(w);
  if (!r.success) throw new Error(`world.json invalid: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data;
}
