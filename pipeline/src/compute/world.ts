import { z } from 'zod';
import { FrontIdSchema, LocalizedSchema, MonthStr, EventTypeSchema } from '../config/schemas';

export const UnitMonthSchema = z.object({
  s: z.number().min(0).max(100),
  c: z.number().min(0).max(100),
  q: z.enum(['high', 'medium', 'reconstructed', 'estimated']),
});

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
    for (const [f, units] of Object.entries(w.series)) {
      for (const [u, arr] of Object.entries(units)) {
        if (arr.length !== w.months.length) {
          ctx.addIssue({ code: 'custom', message: `series.${f}.${u} has ${arr.length} entries, expected ${w.months.length}` });
        }
        if (!w.units[f]?.[u]) ctx.addIssue({ code: 'custom', message: `series.${f}.${u} has no unit definition` });
      }
    }
  });

export type World = z.infer<typeof WorldSchema>;

export function validateWorld(w: unknown): World {
  const r = WorldSchema.safeParse(w);
  if (!r.success) throw new Error(`world.json invalid: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data;
}
