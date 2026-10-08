import { z } from 'zod';
import { DateStr, FrontIdSchema, LocalizedSchema, MonthStr, EventTypeSchema, SignalIdSchema } from '../config/schemas';

const ConfidenceSchema = z.enum(['high', 'medium', 'reconstructed', 'estimated']);

export const UnitMonthSchema = z.object({
  s: z.number().min(0).max(100),
  c: z.number().min(0).max(100),
  /** overall confidence (the lower of qs and qc), used for the fog */
  q: ConfidenceSchema,
  /** strength confidence */
  qs: ConfidenceSchema,
  /** scale confidence (scale is never reconstructed) */
  qc: z.enum(['high', 'medium', 'estimated']),
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

/** Bumped whenever the shape of world.json changes in a way the website must know about. */
export const SCHEMA_VERSION = 2;

export const WorldSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    generatedAt: z.string(),
    months: z.array(MonthStr).min(1),
    partialMonth: MonthStr,
    orgs: z.record(z.string(), z.object({ name: z.string(), color: z.string() })),
    fronts: z.array(z.object({ id: FrontIdSchema, name: LocalizedSchema })),
    units: z.record(
      z.string(),
      z.record(
        z.string(),
        // since: the unit's first month; announcements: key of its official user-count series in `announcements`
        z.object({ org: z.string(), name: z.string(), since: MonthStr, announcements: z.string().optional() }),
      ),
    ),
    series: z.record(z.string(), z.record(z.string(), z.array(UnitMonthSchema.nullable()))),
    breakdown: z.record(
      z.string(),
      z.record(
        z.string(),
        z.record(
          z.string(),
          z.array(
            z.object({
              /** strength source group (matches sources[].group) */
              source: z.string(),
              /** score 0–100 against the group's leader */
              value: z.number(),
              /** effective weight: configured weight × freshness */
              weight: z.number(),
              kind: z.enum(['measured', 'reconstructed']),
              /** the source's model name that produced the value */
              model: z.string(),
              /** weight / sum of the unit-month's weights */
              share: z.number().min(0).max(1),
            }),
          ),
        ),
      ),
    ),
    /** front → unit → month (only months where the unit exists) → per scale component */
    scaleBreakdown: z.record(
      z.string(),
      z.record(
        z.string(),
        z.record(
          z.string(),
          z.array(
            z.object({
              component: z.string(),
              /** the component's implied share 0–100 for the unit (smoothed like c; c is their mean weighted by component weight) */
              share: z.number().min(0).max(100),
              /** signals that covered the unit this month (empty: the component fell back to the base share) */
              signals: z.array(SignalIdSchema),
            }),
          ),
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
        major: z.boolean(),
      }),
    ),
    sources: z.array(
      z.object({
        id: z.string(),
        group: z.string(),
        name: z.string(),
        url: z.string(),
        license: z.string(),
        credit: z.string(),
        /** date of the latest raw snapshot file */
        asOf: z.string().nullable(),
        /** latest observation date (strength) or signal month (scale) in the source's data */
        dataThrough: z.union([DateStr, MonthStr]).nullable(),
      }),
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
      ['scaleBreakdown', w.scaleBreakdown],
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

    // scaleBreakdown
    for (const [f, units] of Object.entries(w.scaleBreakdown)) {
      if (!frontIds.has(f)) continue; // already reported above
      for (const [u, byMonth] of Object.entries(units)) {
        if (!has(w.units[f], u)) bad(['scaleBreakdown', f, u], `scaleBreakdown.${f}.${u} has no unit definition`);
        for (const m of Object.keys(byMonth)) {
          if (!months.has(m)) bad(['scaleBreakdown', f, u, m], `scaleBreakdown month ${m} is not one of the months`);
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
