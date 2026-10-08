import { describe, it, expect, vi } from 'vitest';
import { detectEvents, prettyModel, type FrontCells } from '../../src/compute/events';

const params = { newModelMinDelta: 3, surgeStrength: 5, surgeScale: 5, leadHysteresis: 1, maxPerFrontMonth: 3 };
const front = { id: 'general' as const, name: { ja: '総合戦線', en: 'General Front' } };

const cells = (data: Record<string, (null | [number, number, string | null] | [number, number, string | null, string])[]>): FrontCells =>
  new Map(
    Object.entries(data).map(([u, arr]) => [
      u,
      arr.map((v) => (v ? { s: v[0], c: v[1], bestModel: v[2], q: (v[3] ?? 'high') as 'high' | 'estimated' } : null)),
    ]),
  );

describe('prettyModel', () => {
  it('uses release display names, else strips dates and title-cases', () => {
    expect(prettyModel('dall-e-3', [{ regex: /^dall-e-3/i, release: '2023-10', display: 'DALL·E 3' }])).toBe('DALL·E 3');
    expect(prettyModel('claude-3-opus-20240229', [])).toBe('Claude 3 Opus');
    expect(prettyModel('gemini-2.5-pro', [])).toBe('Gemini 2.5 Pro');
  });
});

describe('prettyModel fallback', () => {
  const pm = (m: string) => prettyModel(m, []);
  it.each([
    ['claude-3-5-sonnet-20240620', 'Claude 3.5 Sonnet'],
    ['gpt-4o-2024-05-13', 'GPT 4o'],
    ['gemini-2.5-pro-exp-03-25', 'Gemini 2.5 Pro'],
    ['claude-3-7-sonnet-20250219-thinking-32k', 'Claude 3.7 Sonnet'],
    ['o1-preview', 'o1'],
    ['gemini-3-pro-image-preview-2k (nano-banana-pro)', 'Gemini 3 Pro Image (Nano Banana Pro)'],
    ['Claude Opus 4.5', 'Claude Opus 4.5'],
  ])('%s -> %s', (input, expected) => {
    expect(pm(input)).toBe(expected);
  });
  it('joins split version digits', () => {
    expect(pm('claude-opus-4-1')).toBe('Claude Opus 4.1');
    expect(pm('claude-3-5-haiku')).toBe('Claude 3.5 Haiku');
  });
  it('removes dates anywhere and trailing 4-digit date tokens', () => {
    expect(pm('claude-opus-4-20250514-thinking')).toBe('Claude Opus 4');
    expect(pm('gpt-4-0125-preview')).toBe('GPT 4');
    expect(pm('mistral-large-2411')).toBe('Mistral Large');
    expect(pm('gpt-4-turbo-2024-04-09')).toBe('GPT 4 Turbo');
    expect(pm('gemini-2.5-pro-preview-03-25')).toBe('Gemini 2.5 Pro');
  });
  it('keeps o-series lowercase and uppercases gpt', () => {
    expect(pm('o3-mini')).toBe('o3 Mini');
    expect(pm('o4-mini-2025-04-16')).toBe('o4 Mini');
    expect(pm('gpt-5')).toBe('GPT 5');
  });
  it('drops repeated trailing noise only outside parentheses and keeps a non-empty name', () => {
    expect(pm('foo-latest-exp')).toBe('Foo');
    expect(pm('foo (bar-preview)')).toBe('Foo (Bar Preview)');
    expect(pm('preview')).toBe('Preview');
  });
  it('strips a trailing _unknown', () => {
    expect(pm('gpt-5.5_unknown')).toBe('GPT 5.5');
    expect(pm('claude-opus-5-5_unknown')).toBe('Claude Opus 5.5');
    expect(pm('gpt-5.5_UNKNOWN')).toBe('GPT 5.5');
  });
  it('turns a trailing _<effort> into a parenthesised, capitalised suffix', () => {
    expect(pm('claude-sonnet-5-5_max')).toBe('Claude Sonnet 5.5 (Max)');
    expect(pm('gpt-5.2-2025-12-11_high')).toBe('GPT 5.2 (High)');
    expect(pm('gpt-5.4-2026-03-05_xhigh')).toBe('GPT 5.4 (Xhigh)');
    expect(pm('o4-mini-2025-04-16_medium')).toBe('o4 Mini (Medium)');
    expect(pm('gpt-5-nano_low')).toBe('GPT 5 Nano (Low)');
    expect(pm('gpt-5_minimal')).toBe('GPT 5 (Minimal)');
    expect(pm('glm-5.2_MAX')).toBe('Glm 5.2 (Max)');
  });
  it('handles _unknown together with an effort, and leaves other suffixes and lone words alone', () => {
    expect(pm('gpt-5.5_high_unknown')).toBe('GPT 5.5 (High)');
    expect(pm('claude-opus-4-5-20251101_16K')).toBe('Claude Opus 4.5');
    expect(pm('high')).toBe('High');
    expect(pm('_high')).toBe('High');
    expect(pm('gpt-5-high')).toBe('GPT 5 High'); // only an underscore-separated suffix is an effort
  });
  it('lets release display names take precedence', () => {
    expect(pm('claude-3-5-sonnet-20240620')).toBe('Claude 3.5 Sonnet');
    expect(prettyModel('claude-3-5-sonnet-20240620', [{ regex: /^claude-3-5-sonnet/i, release: '2024-06', display: 'Sonnet 3.5 (June)' }])).toBe('Sonnet 3.5 (June)');
  });
});

describe('detectEvents', () => {
  const months = ['2024-01', '2024-02', '2024-03', '2024-04'];
  const names = { gpt: 'GPT', claude: 'Claude' };
  // 2024-03: claude overtakes on strength (+10, new model), gpt drops 6 (surge down).
  // 2024-04: claude overtakes on scale (42 vs 35) without a +5 scale jump of its own.
  const c = cells({
    gpt: [[100, 80, 'gpt-4'], [100, 78, 'gpt-4'], [94, 60, 'gpt-4'], [94, 35, 'gpt-4']],
    claude: [null, [90, 22, 'claude-2'], [100, 40, 'claude-3-opus-20240229'], [100, 42, 'claude-3-opus-20240229']],
  });
  const ev = detectEvents({ front, months, cells: c, unitNames: names, params, releases: [], overrides: [], custom: [] });
  const types = (m: string) => ev.filter((e) => e.month === m).map((e) => `${e.type}:${e.unit}`);

  it('detects arrivals, model jumps, lead and scale-lead changes', () => {
    expect(types('2024-01')).toEqual([]); // first month: initial leaders, no events; gpt existing from start is not "new"
    expect(types('2024-02')).toEqual(['new_unit:claude']);
    expect(types('2024-03')).toEqual(['lead_change:claude', 'new_model:claude', 'surge:gpt']);
    expect(types('2024-04')).toEqual(['scale_lead_change:claude']);
  });
  it('stores the previous leader unit id (not its display name) in from', () => {
    const lead = ev.find((e) => e.type === 'lead_change')!;
    expect(lead.from).toBe('gpt');
    expect(lead.unit).toBe('claude');
    const scale = ev.find((e) => e.type === 'scale_lead_change')!;
    expect(scale.from).toBe('gpt');
    expect(scale.text.en).toBe('Largest force on the General Front: GPT → Claude');
    // events other than leader changes carry no `from`
    expect(ev.filter((e) => e.type !== 'lead_change' && e.type !== 'scale_lead_change').some((e) => 'from' in e)).toBe(false);
  });
  it('writes localized text', () => {
    const lead = ev.find((e) => e.type === 'lead_change')!;
    expect(lead.text.ja).toBe('総合戦線で首位交代：GPT → Claude');
    expect(lead.text.en).toBe('Lead change on the General Front: GPT → Claude');
    const nm = ev.find((e) => e.type === 'new_model')!;
    expect(nm.text.ja).toBe('Claude 3 Opus 投入 — 総合戦線');
  });
  it('applies overrides and custom events', () => {
    const ev2 = detectEvents({
      front,
      months,
      cells: c,
      unitNames: names,
      params,
      releases: [],
      overrides: [
        { month: '2024-03', front: 'general', unit: 'gpt', type: 'surge', hide: true },
        { month: '2024-02', front: 'general', unit: 'claude', type: 'new_unit', text: { ja: 'Claude 2 参戦', en: 'Claude 2 joins' } },
      ],
      custom: [{ month: '2024-01', front: 'general', unit: 'gpt', text: { ja: '開戦', en: 'War begins' } }],
    });
    expect(ev2.some((e) => e.type === 'surge')).toBe(false);
    expect(ev2.find((e) => e.type === 'new_unit')!.text.ja).toBe('Claude 2 参戦');
    expect(ev2.find((e) => e.type === 'custom')!.month).toBe('2024-01');
  });
  it('ignores estimated cells for lead changes, model jumps and surges', () => {
    const est = cells({
      a: [[100, 50, 'a-1'], [100, 50, 'a-1'], [100, 50, 'a-1']],
      b: [[94, 50, null, 'estimated'], [100, 70, null, 'estimated'], [80, 70, 'b-1']],
    });
    const ev4 = detectEvents({ front, months: ['2024-01', '2024-02', '2024-03'], cells: est, unitNames: { a: 'A', b: 'B' }, params, releases: [], overrides: [], custom: [] });
    // 2024-02: b is estimated → no strength lead / model / surge events (its scale is real, so a scale-lead change is allowed);
    // 2024-03: b measured but the previous month was estimated → no surge
    expect(ev4.filter((e) => e.unit === 'b').map((e) => e.type)).toEqual(['scale_lead_change']);
  });
  it('keeps the lead while the leader\'s cell is estimated (no flip-flop)', () => {
    const flip = cells({
      a: [[100, 50, 'a-1'], [100, 50, 'a-1', 'estimated'], [100, 50, 'a-1']],
      b: [[95, 40, 'b-1'], [95, 40, 'b-1'], [95, 40, 'b-1']],
    });
    const e = detectEvents({ front, months: ['2024-01', '2024-02', '2024-03'], cells: flip, unitNames: { a: 'A', b: 'B' }, params, releases: [], overrides: [], custom: [] });
    expect(e.filter((x) => x.type === 'lead_change' || x.type === 'scale_lead_change')).toEqual([]);
  });
  it('hands the strength lead to the best measured unit as soon as the leader is gone (no hysteresis)', () => {
    const gone = cells({
      a: [[100, 50, 'a-1'], [100, 50, 'a-1'], null],
      b: [[99.8, 40, 'b-1'], [99.8, 40, 'b-1'], [99.8, 40, 'b-1']],
      c: [[10, 5, 'c-1'], [10, 5, 'c-1'], [100, 45, null, 'estimated']],
    });
    const e = detectEvents({ front, months: ['2024-01', '2024-02', '2024-03'], cells: gone, unitNames: { a: 'A', b: 'B', c: 'C' }, params, releases: [], overrides: [], custom: [] });
    // estimated c (s=100) must not take the lead; measured b does
    expect(e.filter((x) => x.type === 'lead_change').map((x) => `${x.month}:${x.unit}`)).toEqual(['2024-03:b']);
  });
  it('hands the scale lead over as soon as the scale leader is gone', () => {
    const gone = cells({
      a: [[100, 80, 'a-1'], [100, 80, 'a-1'], null],
      b: [[90, 79.5, 'b-1'], [90, 79.5, 'b-1'], [90, 79.5, 'b-1']],
    });
    const e = detectEvents({ front, months: ['2024-01', '2024-02', '2024-03'], cells: gone, unitNames: { a: 'A', b: 'B' }, params, releases: [], overrides: [], custom: [] });
    expect(e.filter((x) => x.type === 'scale_lead_change').map((x) => `${x.month}:${x.unit}`)).toEqual(['2024-03:b']);
  });
  it('emits new_unit only on a unit\'s first appearance, not when it disappears and returns', () => {
    const back = cells({
      a: [[100, 50, 'a-1'], [100, 50, 'a-1'], [100, 50, 'a-1'], [100, 50, 'a-1']],
      b: [null, [60, 10, 'b-1'], null, [60, 10, 'b-1']],
    });
    const e = detectEvents({ front, months, cells: back, unitNames: { a: 'A', b: 'B' }, params, releases: [], overrides: [], custom: [] });
    expect(e.filter((x) => x.type === 'new_unit').map((x) => `${x.month}:${x.unit}`)).toEqual(['2024-02:b']);
  });
  describe('overrides vs the per-month cap', () => {
    // 2024-02: b, c, d, e all surge (+10) while a keeps the lead → 4 candidate events in one month
    const surgeCells = cells({
      a: [[100, 50, null], [100, 50, null]],
      b: [[50, 10, null], [60, 10, null]],
      c: [[50, 10, null], [60, 10, null]],
      d: [[50, 10, null], [60, 10, null]],
      e: [[50, 10, null], [60, 10, null]],
    });
    const run = (overrides: Parameters<typeof detectEvents>[0]['overrides']) =>
      detectEvents({ front, months: ['2024-01', '2024-02'], cells: surgeCells, unitNames: {}, params: { ...params, maxPerFrontMonth: 3 }, releases: [], overrides, custom: [] });

    it('hidden events do not consume slots', () => {
      expect(run([]).map((e) => e.unit)).toEqual(['b', 'c', 'd']);
      const shown = run([{ month: '2024-02', front: 'general', unit: 'b', type: 'surge', hide: true }]);
      expect(shown.map((e) => e.unit)).toEqual(['c', 'd', 'e']);
    });
    it('warns about overrides that match no detected event', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        run([
          { month: '2024-02', front: 'general', unit: 'b', type: 'surge', hide: true },
          { month: '2024-02', front: 'general', unit: 'zzz', type: 'surge', hide: true },
        ]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('zzz');
      } finally {
        warn.mockRestore();
      }
    });
    it('does not warn when every override matches', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        run([{ month: '2024-02', front: 'general', unit: 'b', type: 'surge', hide: true }]);
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });
  it('caps events per front-month', () => {
    const ev3 = detectEvents({ front, months, cells: c, unitNames: names, params: { ...params, maxPerFrontMonth: 1 }, releases: [], overrides: [], custom: [] });
    expect(ev3.filter((e) => e.month === '2024-03').map((e) => e.type)).toEqual(['lead_change']);
  });
});
