import { describe, it, expect } from 'vitest';
import { renderReport } from '../../src/report/html';
import type { World } from '../../src/compute/world';

const w: World = {
  schemaVersion: 2,
  generatedAt: '2026-10-12T00:00:00.000Z',
  months: ['2026-09', '2026-10'],
  partialMonth: '2026-10',
  orgs: { openai: { name: 'OpenAI', color: '#19c37d' } },
  fronts: [{ id: 'general', name: { ja: '総合戦線', en: 'General Front' } }],
  units: { general: { gpt: { org: 'openai', name: 'GPT', since: '2022-11' } } },
  announcements: {},
  series: { general: { gpt: [{ s: 90, c: 100, q: 'high', qs: 'high', qc: 'high' }, { s: 100, c: 100, q: 'medium', qs: 'high', qc: 'medium' }] } },
  breakdown: { general: { gpt: {} } },
  scaleBreakdown: { general: { gpt: {} } },
  events: [{ month: '2026-10', front: 'general', unit: 'gpt', type: 'lead_change', text: { ja: '首位交代', en: 'Lead' }, major: true }],
  sources: [],
};

describe('renderReport', () => {
  it('renders fronts, latest values, sparklines and events', () => {
    const html = renderReport(w);
    expect(html).toContain('<title>AI WAR データ確認レポート</title>');
    expect(html).toContain('総合戦線');
    expect(html).toContain('GPT');
    expect(html).toContain('<svg');
    expect(html).toContain('首位交代');
    expect(html).toContain('medium');
  });
  it('keeps a valid #rrggbb org colour', () => {
    const html = renderReport(w);
    expect(html).toContain('background:#19c37d');
    expect(html).toContain('stroke="#19c37d"');
  });
  it('never lets an org colour break out of the style/stroke attributes', () => {
    const evil = '#fff"><script>alert(1)</script><i style="x:';
    for (const color of [evil, 'red', '#12345', '#1234567', 'url(javascript:alert(1))', '#ggg000', '']) {
      const html = renderReport({ ...w, orgs: { openai: { name: 'OpenAI', color } } });
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('javascript:');
      expect(html).toContain('background:#888');
      expect(html).toContain('stroke="#888"');
    }
  });
  it('does not crash for a unit that has no series entry (or a front without a series table)', () => {
    const extra: World = {
      ...w,
      units: { general: { gpt: { org: 'openai', name: 'GPT', since: '2022-11' }, ghost: { org: 'openai', name: 'Ghost', since: '2022-11' } } },
    };
    const html = renderReport(extra);
    expect(html).toContain('Ghost');
    expect(html.indexOf('GPT')).toBeLessThan(html.indexOf('Ghost')); // units with data sort first
    const noTable = renderReport({ ...extra, series: {} });
    expect(noTable).toContain('Ghost');
    expect(noTable).toContain('GPT');
  });
});
