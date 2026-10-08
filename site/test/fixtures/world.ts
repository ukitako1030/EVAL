import type { World } from '../../src/data/types';

export function makeWorld(): World {
  const fronts = ['general', 'code', 'agent', 'image', 'video', 'speech', 'music'] as const;
  const empty = Object.fromEntries(fronts.map((f) => [f, {}])) as World['units'];
  const w: World = {
    generatedAt: '2025-04-15T00:00:00.000Z',
    months: ['2025-01', '2025-02', '2025-03', '2025-04'],
    partialMonth: '2025-04',
    orgs: { openai: { name: 'OpenAI', color: '#19c37d' }, anthropic: { name: 'Anthropic', color: '#ff8a4c' }, google: { name: 'Google', color: '#4c8dff' } },
    fronts: fronts.map((id) => ({ id, name: { ja: id + 'JA', en: id + 'EN' } })),
    units: { ...empty },
    series: structuredClone(empty) as unknown as World['series'],
    breakdown: structuredClone(empty) as unknown as World['breakdown'],
    events: [
      { month: '2025-01', front: 'general', unit: 'gpt', type: 'custom', text: { ja: '開戦', en: 'War begins' } },
      { month: '2025-03', front: 'general', unit: 'claude', type: 'lead_change', text: { ja: '首位交代', en: 'Lead change' }, from: 'gpt' },
      { month: '2025-03', front: 'image', unit: 'nb', type: 'new_unit', text: { ja: 'NB 参戦', en: 'NB enters' } },
      { month: '2025-04', front: 'general', unit: 'gemini', type: 'surge', text: { ja: '急伸', en: 'Surge' } },
    ],
    sources: [{ id: 'arena-text', group: 'arena-text', name: 'Arena', url: 'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset', license: 'CC BY 4.0', credit: 'Arena, CC BY 4.0', asOf: '2025-04-10' }],
  };
  w.units.general = { gpt: { org: 'openai', name: 'GPT' }, claude: { org: 'anthropic', name: 'Claude' }, gemini: { org: 'google', name: 'Gemini' } };
  w.series.general = {
    gpt: [{ s: 100, c: 70, q: 'high' }, { s: 100, c: 66, q: 'high' }, { s: 90, c: 60, q: 'high' }, { s: 92, c: 58, q: 'high' }],
    claude: [{ s: 80, c: 30, q: 'medium' }, { s: 90, c: 30, q: 'medium' }, { s: 100, c: 28, q: 'high' }, { s: 100, c: 27, q: 'high' }],
    gemini: [null, null, { s: 70, c: 12, q: 'estimated' }, { s: 85, c: 15, q: 'reconstructed' }],
  };
  w.units.image = { nb: { org: 'google', name: 'Nano Banana' } };
  w.series.image = { nb: [null, null, { s: 100, c: 100, q: 'medium' }, { s: 100, c: 100, q: 'medium' }] };
  w.breakdown.general = { gpt: { '2025-01': [{ source: 'arena-text', value: 100, weight: 0.5, kind: 'measured' }] }, claude: {}, gemini: {} };
  w.breakdown.image = { nb: {} };
  return w;
}
