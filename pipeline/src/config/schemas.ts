import { z } from 'zod';
import { FRONT_IDS, SIGNAL_IDS } from '../core/types';

export const MonthStr = z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM');
export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const FrontIdSchema = z.enum(FRONT_IDS);
export const SignalIdSchema = z.enum(SIGNAL_IDS);
export const LocalizedSchema = z.object({ ja: z.string().min(1), en: z.string().min(1) });

export const UnitScaleSchema = z
  .object({
    announcements: z.string().optional(),
    crux: z.array(z.string()).optional(),
    tranco: z.array(z.string()).optional(),
    cloudflare: z.array(z.string()).optional(),
    statcounter: z.array(z.string()).optional(),
    ramp: z.array(z.string()).optional(),
    openrouter: z.array(z.string()).optional(), // slug prefixes
    wikipedia: z.array(z.string()).optional(),
    itunes: z.array(z.string()).optional(),
  })
  .strict();

export const UnitSchema = z
  .object({
    org: z.string(),
    name: z.string().min(1),
    since: MonthStr,
    until: MonthStr.optional(),
    match: z.array(z.string()).default([]),
    orgMatch: z.string().optional(),
    scale: UnitScaleSchema.default({}),
  })
  .strict()
  .superRefine((u, ctx) => {
    if (u.until !== undefined && u.until < u.since) {
      ctx.addIssue({ code: 'custom', path: ['until'], message: `until (${u.until}) must not be before since (${u.since})` });
    }
  });

export const UnitsFileSchema = z.object({
  /** Case-insensitive regexes: a model matching any of them is assigned to no unit (third-party fine-tunes, multi-model rows). */
  exclude: z.array(z.string()).default([]),
  orgs: z.record(z.string(), z.object({ name: z.string(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })),
  fronts: z.record(z.string(), z.object({ name: LocalizedSchema, units: z.record(z.string(), UnitSchema).default({}) })),
});

export const MethodSchema = z.object({
  start: MonthStr,
  strength: z.object({
    minUnits: z.number().int().min(1),
    snapshotMaxAgeDays: z.number().int().positive(),
    releaseActiveMonths: z.number().int().min(0),
    kinds: z.object({
      elo: z.object({ scale: z.number().positive() }),
      // scale (default 1) multiplies the logit gap: < 1 softens benchmarks whose top models are far apart
      percent: z.object({ clampLo: z.number(), clampHi: z.number(), scale: z.number().positive().optional() }).superRefine((p, ctx) => {
        if (!(p.clampLo > 0 && p.clampLo < p.clampHi && p.clampHi < 100)) {
          ctx.addIssue({ code: 'custom', message: 'expected 0 < clampLo < clampHi < 100' });
        }
      }),
      minutes: z.object({ kappa: z.number().positive() }),
      eci: z.object({ tau: z.number().positive() }),
    }),
    estimate: z.object({ floor: z.number(), step: z.number() }),
    weights: z.record(z.string(), z.record(z.string(), z.number().positive())),
  }),
  scale: z.object({
    smoothingMonths: z.number().int().min(1),
    announcementStaleMonths: z.number().int().min(0),
    metricFactors: z.object({ MAU: z.number().positive(), WAU: z.number().positive(), DAU: z.number().positive() }),
    floorFactor: z.number().positive(),
    components: z.record(z.string(), z.object({ weight: z.number().positive(), signals: z.array(SignalIdSchema).min(1) })),
    base: z.array(z.string()).min(1),
  }),
  events: z.object({
    newModelMinDelta: z.number(),
    surgeStrength: z.number(),
    surgeScale: z.number(),
    leadHysteresis: z.number(),
    maxPerFrontMonth: z.number().int().positive(),
  }),
});
export type Method = z.infer<typeof MethodSchema>;
export type KindParams = Method['strength']['kinds'];

export const MetricSchema = z.enum(['MAU', 'WAU', 'DAU']);
export const AnnouncementsSchema = z.object({
  series: z.record(
    z.string(),
    z.object({
      metric: MetricSchema,
      points: z.array(
        z.object({
          date: DateStr,
          value: z.number().positive(),
          metric: MetricSchema.optional(),
          url: z.url({ protocol: /^https?$/ }),
          note: z.string().optional(),
        }),
      ),
    }),
  ),
});
export type Announcements = z.infer<typeof AnnouncementsSchema>;
export type AnnSeries = Announcements['series'][string];

export const EVENT_TYPES = ['new_unit', 'new_model', 'lead_change', 'scale_lead_change', 'surge', 'custom'] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export const EventsFileSchema = z.object({
  overrides: z
    .array(
      z.object({
        month: MonthStr,
        front: FrontIdSchema,
        unit: z.string(),
        type: EventTypeSchema,
        text: LocalizedSchema.optional(),
        hide: z.boolean().optional(),
      }),
    )
    .default([]),
  custom: z
    .array(z.object({ month: MonthStr, front: FrontIdSchema, unit: z.string(), text: LocalizedSchema }))
    .default([]),
});
export type EventsFile = z.infer<typeof EventsFileSchema>;

export const ReleasesFileSchema = z.object({
  models: z.array(z.object({ match: z.string(), release: MonthStr, display: z.string().optional() })).default([]),
});
