import { describe, it, expect } from 'vitest';
import { WorldSchema, validateWorld, type World } from '../../src/compute/world';

const minimal: World = {
  schemaVersion: 2,
  generatedAt: '2026-10-12T00:00:00.000Z',
  months: ['2026-09', '2026-10'],
  partialMonth: '2026-10',
  orgs: { openai: { name: 'OpenAI', color: '#19c37d' } },
  fronts: [{ id: 'general', name: { ja: '総合戦線', en: 'General Front' } }],
  units: { general: { gpt: { org: 'openai', name: 'GPT', since: '2022-11', announcements: 'chatgpt' } } },
  announcements: { chatgpt: { metric: 'WAU', points: [{ date: '2025-10-06', value: 800000000, url: 'https://openai.com/' }] } },
  series: { general: { gpt: [null, { s: 100, c: 100, q: 'medium', qs: 'high', qc: 'medium' }] } },
  breakdown: { general: { gpt: { '2026-10': [{ source: 'arena-text', value: 100, weight: 0.5, kind: 'measured', model: 'gpt-5', share: 1 }] } } },
  scaleBreakdown: { general: { gpt: { '2026-10': [{ component: 'consumer', share: 100, signals: ['crux', 'tranco'] }] } } },
  events: [{ month: '2026-10', front: 'general', unit: 'gpt', type: 'new_unit', text: { ja: 'a', en: 'a' }, major: false }],
  sources: [
    { id: 'arena-text', group: 'arena-text', name: 'Arena', url: 'https://arena.ai', license: 'CC BY 4.0', credit: 'Arena', asOf: '2026-10-07', dataThrough: '2026-10-02' },
  ],
};

/** Deep-clones the minimal world, lets the caller break it, and returns the issue paths (dot-joined). */
function paths(mutate: (w: World) => void): string[] {
  const w = structuredClone(minimal);
  mutate(w);
  const r = WorldSchema.safeParse(w);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
}

describe('WorldSchema', () => {
  it('accepts a minimal world', () => {
    expect(WorldSchema.safeParse(minimal).success).toBe(true);
  });
  it('requires schemaVersion 2', () => {
    expect(paths((w) => ((w as { schemaVersion: number }).schemaVersion = 1))).toEqual(['schemaVersion']);
    expect(paths((w) => delete (w as Partial<World>).schemaVersion)).toEqual(['schemaVersion']);
  });
  it('rejects series whose length differs from months', () => {
    const bad = structuredClone(minimal);
    bad.series.general.gpt = [null];
    expect(WorldSchema.safeParse(bad).success).toBe(false);
    expect(paths((w) => (w.series.general.gpt = [null]))).toEqual(['series.general.gpt']);
  });
  it('rejects out-of-range values', () => {
    const bad = structuredClone(minimal);
    bad.series.general.gpt = [null, { s: 120, c: 100, q: 'high', qs: 'high', qc: 'high' }];
    expect(WorldSchema.safeParse(bad).success).toBe(false);
  });
  it('requires the strength and scale confidences qs and qc in each cell', () => {
    type Cell = NonNullable<World['series'][string][string][number]>;
    expect(paths((w) => delete (w.series.general.gpt[1] as Partial<Cell>).qs)).toEqual(['series.general.gpt.1.qs']);
    expect(paths((w) => delete (w.series.general.gpt[1] as Partial<Cell>).qc)).toEqual(['series.general.gpt.1.qc']);
    expect(paths((w) => ((w.series.general.gpt[1] as { qc: string }).qc = 'reconstructed'))).toEqual(['series.general.gpt.1.qc']);
  });

  describe('months', () => {
    it('must be strictly increasing (sorted, unique)', () => {
      expect(paths((w) => (w.months = ['2026-10', '2026-09']))).toEqual(['months.1']);
      expect(paths((w) => (w.months = ['2026-10', '2026-10']))).toEqual(['months.1']);
    });
    it('partialMonth must be one of the months', () => {
      expect(paths((w) => (w.partialMonth = '2026-11'))).toEqual(['partialMonth']);
    });
  });

  describe('fronts', () => {
    it('ids must be unique', () => {
      expect(paths((w) => w.fronts.push({ id: 'general', name: { ja: 'x', en: 'x' } }))).toEqual(['fronts.1.id']);
    });
    it('units, series and breakdown keys must be front ids', () => {
      expect(
        paths((w) => {
          w.units.bogus = {};
          w.series.bogus = {};
          w.breakdown.bogus = {};
          w.scaleBreakdown.bogus = {};
        }),
      ).toEqual(['units.bogus', 'series.bogus', 'breakdown.bogus', 'scaleBreakdown.bogus']);
    });
    it('every front must be present in units, series, breakdown and scaleBreakdown (a front with no units is {})', () => {
      expect(paths((w) => w.fronts.push({ id: 'image', name: { ja: '画像', en: 'Image' } }))).toEqual([
        'units.image',
        'series.image',
        'breakdown.image',
        'scaleBreakdown.image',
      ]);
      expect(
        paths((w) => {
          w.fronts.push({ id: 'image', name: { ja: '画像', en: 'Image' } });
          w.units.image = {};
          w.series.image = {};
          w.breakdown.image = {};
          w.scaleBreakdown.image = {};
        }),
      ).toEqual([]);
    });
  });

  describe('units', () => {
    it('org must exist in orgs', () => {
      expect(paths((w) => (w.units.general.gpt.org = 'nope'))).toEqual(['units.general.gpt.org']);
    });
    it('since is a required YYYY-MM month; announcements is an optional series key', () => {
      expect(paths((w) => delete (w.units.general.gpt as Partial<World['units'][string][string]>).since)).toEqual(['units.general.gpt.since']);
      expect(paths((w) => (w.units.general.gpt.since = '2022-11-30'))).toEqual(['units.general.gpt.since']);
      expect(paths((w) => (w.units.general.gpt.announcements = 42 as unknown as string))).toEqual(['units.general.gpt.announcements']);
    });
    it('an announcements key must name an exported announcements series', () => {
      expect(paths((w) => (w.units.general.gpt.announcements = 'nope'))).toEqual(['units.general.gpt.announcements']);
      expect(paths((w) => delete w.units.general.gpt.announcements)).toEqual([]);
    });
    it('announcement points need a date, a positive value and an http(s) url', () => {
      expect(paths((w) => (w.announcements.chatgpt.points[0].date = '2025-10'))).toEqual(['announcements.chatgpt.points.0.date']);
      expect(paths((w) => (w.announcements.chatgpt.points[0].value = 0))).toEqual(['announcements.chatgpt.points.0.value']);
      expect(paths((w) => (w.announcements.chatgpt.points[0].url = 'openai.com'))).toEqual(['announcements.chatgpt.points.0.url']);
      expect(paths((w) => (w.announcements.chatgpt.metric = 'YAU' as never))).toEqual(['announcements.chatgpt.metric']);
    });
    it('every unit needs a series and every series a unit', () => {
      expect(paths((w) => (w.units.general.extra = { org: 'openai', name: 'Extra', since: '2022-11' }))).toEqual(['series.general.extra']);
      expect(paths((w) => (w.series.general.ghost = [null, null]))).toEqual(['series.general.ghost']);
    });
  });

  describe('events', () => {
    it('every event says whether it is major', () => {
      expect(paths((w) => delete (w.events[0] as Partial<World['events'][number]>).major)).toEqual(['events.0.major']);
      expect(paths((w) => (w.events[0].major = true))).toEqual([]);
    });
    it('month must be one of the months', () => {
      expect(paths((w) => (w.events[0].month = '2020-01'))).toEqual(['events.0.month']);
    });
    it('unit must exist in the event front (except custom events)', () => {
      expect(paths((w) => (w.events[0].unit = 'ghost'))).toEqual(['events.0.unit']);
      expect(
        paths((w) => {
          w.events[0].unit = 'ghost';
          w.events[0].type = 'custom';
        }),
      ).toEqual([]);
    });
  });

  describe('breakdown', () => {
    it('rows name the model and carry a share between 0 and 1', () => {
      type Row = World['breakdown'][string][string][string][number];
      expect(paths((w) => delete (w.breakdown.general.gpt['2026-10'][0] as Partial<Row>).model)).toEqual(['breakdown.general.gpt.2026-10.0.model']);
      expect(paths((w) => delete (w.breakdown.general.gpt['2026-10'][0] as Partial<Row>).share)).toEqual(['breakdown.general.gpt.2026-10.0.share']);
      expect(paths((w) => (w.breakdown.general.gpt['2026-10'][0].share = 1.2))).toEqual(['breakdown.general.gpt.2026-10.0.share']);
    });
    it('month keys must be one of the months', () => {
      expect(paths((w) => (w.breakdown.general.gpt['2020-01'] = []))).toEqual(['breakdown.general.gpt.2020-01']);
    });
    it('unit must exist', () => {
      expect(paths((w) => (w.breakdown.general.ghost = {}))).toEqual(['breakdown.general.ghost']);
    });
    it('source must equal some sources[].group', () => {
      expect(paths((w) => (w.breakdown.general.gpt['2026-10'][0].source = 'nowhere'))).toEqual(['breakdown.general.gpt.2026-10.0.source']);
      // matches on the group, not the source id
      expect(
        paths((w) => {
          w.sources[0].id = 'arena-text-a';
          w.sources[0].group = 'arena-text';
        }),
      ).toEqual([]);
    });
  });

  describe('scaleBreakdown', () => {
    it('unit must exist and month keys must be months', () => {
      expect(paths((w) => (w.scaleBreakdown.general.ghost = {}))).toEqual(['scaleBreakdown.general.ghost']);
      expect(paths((w) => (w.scaleBreakdown.general.gpt['2020-01'] = []))).toEqual(['scaleBreakdown.general.gpt.2020-01']);
    });
    it('share is 0–100 and signals are signal ids', () => {
      expect(paths((w) => (w.scaleBreakdown.general.gpt['2026-10'][0].share = 101))).toEqual(['scaleBreakdown.general.gpt.2026-10.0.share']);
      expect(paths((w) => (w.scaleBreakdown.general.gpt['2026-10'][0].signals = ['nope' as never]))).toEqual(['scaleBreakdown.general.gpt.2026-10.0.signals.0']);
    });
  });

  describe('sources and orgs', () => {
    it('dataThrough is a YYYY-MM-DD date, a YYYY-MM month or null', () => {
      expect(paths((w) => (w.sources[0].dataThrough = '2026-09'))).toEqual([]);
      expect(paths((w) => (w.sources[0].dataThrough = null))).toEqual([]);
      expect(paths((w) => (w.sources[0].dataThrough = '2026'))).toEqual(['sources.0.dataThrough']);
      expect(paths((w) => delete (w.sources[0] as Partial<World['sources'][number]>).dataThrough)).toEqual(['sources.0.dataThrough']);
    });
    it('source url must be http(s)', () => {
      expect(paths((w) => (w.sources[0].url = 'ftp://arena.ai'))).toEqual(['sources.0.url']);
      expect(paths((w) => (w.sources[0].url = 'arena.ai'))).toEqual(['sources.0.url']);
      expect(paths((w) => (w.sources[0].url = 'http://arena.ai/x'))).toEqual([]);
    });
    it('org color must be #rrggbb', () => {
      expect(paths((w) => (w.orgs.openai.color = 'green'))).toEqual(['orgs.openai.color']);
      expect(paths((w) => (w.orgs.openai.color = '#fff'))).toEqual(['orgs.openai.color']);
    });
  });

  it('validateWorld reports the path of every issue', () => {
    const bad = structuredClone(minimal);
    bad.partialMonth = '2030-01';
    expect(() => validateWorld(bad)).toThrow(/partialMonth/);
  });
});
