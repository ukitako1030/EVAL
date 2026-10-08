import { describe, it, expect } from 'vitest';
import { renderReport } from '../../src/report/html';
import type { World } from '../../src/compute/world';

const w: World = {
  generatedAt: '2026-10-12T00:00:00.000Z',
  months: ['2026-09', '2026-10'],
  partialMonth: '2026-10',
  orgs: { openai: { name: 'OpenAI', color: '#19c37d' } },
  fronts: [{ id: 'general', name: { ja: '総合戦線', en: 'General Front' } }],
  units: { general: { gpt: { org: 'openai', name: 'GPT' } } },
  series: { general: { gpt: [{ s: 90, c: 100, q: 'high' }, { s: 100, c: 100, q: 'medium' }] } },
  breakdown: { general: { gpt: {} } },
  events: [{ month: '2026-10', front: 'general', unit: 'gpt', type: 'lead_change', text: { ja: '首位交代', en: 'Lead' } }],
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
});
