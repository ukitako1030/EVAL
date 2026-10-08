import { describe, it, expect } from 'vitest';
import { WorldSchema, type World } from '../../src/compute/world';

const minimal: World = {
  generatedAt: '2026-10-12T00:00:00.000Z',
  months: ['2026-09', '2026-10'],
  partialMonth: '2026-10',
  orgs: { openai: { name: 'OpenAI', color: '#19c37d' } },
  fronts: [{ id: 'general', name: { ja: '総合戦線', en: 'General Front' } }],
  units: { general: { gpt: { org: 'openai', name: 'GPT' } } },
  series: { general: { gpt: [null, { s: 100, c: 100, q: 'medium' }] } },
  breakdown: { general: { gpt: { '2026-10': [{ source: 'arena-text', value: 100, weight: 0.5, kind: 'measured' }] } } },
  events: [{ month: '2026-10', front: 'general', unit: 'gpt', type: 'new_unit', text: { ja: 'a', en: 'a' } }],
  sources: [{ id: 'arena-text', group: 'arena-text', name: 'Arena', url: 'https://arena.ai', license: 'CC BY 4.0', credit: 'Arena', asOf: '2026-10-07' }],
};

describe('WorldSchema', () => {
  it('accepts a minimal world', () => {
    expect(WorldSchema.safeParse(minimal).success).toBe(true);
  });
  it('rejects series whose length differs from months', () => {
    const bad = structuredClone(minimal);
    bad.series.general.gpt = [null];
    expect(WorldSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects out-of-range values', () => {
    const bad = structuredClone(minimal);
    bad.series.general.gpt = [null, { s: 120, c: 100, q: 'high' }];
    expect(WorldSchema.safeParse(bad).success).toBe(false);
  });
});
