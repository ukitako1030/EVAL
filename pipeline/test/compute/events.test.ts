import { describe, it, expect, vi } from 'vitest';
import { detectEvents, prettyModel, type FrontCells } from '../../src/compute/events';

const params = { newModelMinDelta: 3, surgeStrength: 5, surgeScale: 5, leadHysteresis: 1, maxPerFrontMonth: 3 };
const front = { id: 'general' as const, name: { ja: '総合戦線', en: 'General Front' } };

type CellTuple = [number, number, string | null] | [number, number, string | null, string] | [number, number, string | null, string, string[]];
/** [s, c, bestModel, q = 'high', groups = ['g']] */
const cells = (data: Record<string, (null | CellTuple)[]>): FrontCells =>
  new Map(
    Object.entries(data).map(([u, arr]) => [
      u,
      arr.map((v) => (v ? { s: v[0], c: v[1], bestModel: v[2], q: (v[3] ?? 'high') as 'high' | 'estimated', groups: v[4] ?? ['g'] } : null)),
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
  it('turns a trailing _<effort> into a parenthesised lower-case suffix', () => {
    expect(pm('claude-sonnet-5-5_max')).toBe('Claude Sonnet 5.5 (max)');
    expect(pm('gpt-5.2-2025-12-11_high')).toBe('GPT 5.2 (high)');
    expect(pm('gpt-5.4-2026-03-05_xhigh')).toBe('GPT 5.4 (xhigh)');
    expect(pm('o4-mini-2025-04-16_medium')).toBe('o4 Mini (medium)');
    expect(pm('gpt-5-nano_low')).toBe('GPT 5 Nano (low)');
    expect(pm('gpt-5_minimal')).toBe('GPT 5 (minimal)');
    expect(pm('glm-5.2_MAX')).toBe('Glm 5.2 (max)');
  });
  it('also turns a trailing -<effort> into a suffix, except -max (a model name: Codex Max, FLUX.2 Max)', () => {
    expect(pm('claude-sonnet-5.5-xhigh')).toBe('Claude Sonnet 5.5 (xhigh)');
    expect(pm('gpt-5-high')).toBe('GPT 5 (high)');
    expect(pm('gemini-3.5-flash-medium')).toBe('Gemini 3.5 Flash (medium)');
    expect(pm('gpt-5-mini-2025-08-07-low')).toBe('GPT 5 Mini (low)');
    expect(pm('gpt-5-minimal')).toBe('GPT 5 (minimal)');
    expect(pm('o3-mini-HIGH')).toBe('o3 Mini (high)');
    expect(pm('gpt-5.1-codex-max')).toBe('GPT 5.1 Codex Max');
    expect(pm('flux-2-max')).toBe('Flux 2 Max');
  });
  it('handles _unknown together with an effort, and leaves other suffixes and lone words alone', () => {
    expect(pm('gpt-5.5_high_unknown')).toBe('GPT 5.5 (high)');
    expect(pm('claude-opus-4-5-20251101_16K')).toBe('Claude Opus 4.5');
    expect(pm('high')).toBe('High');
    expect(pm('_high')).toBe('High');
    expect(pm('-high')).toBe('High');
    expect(pm('gpt-5-highest')).toBe('GPT 5 Highest');
  });
  it('lets release display names take precedence', () => {
    expect(pm('claude-3-5-sonnet-20240620')).toBe('Claude 3.5 Sonnet');
    expect(prettyModel('claude-3-5-sonnet-20240620', [{ regex: /^claude-3-5-sonnet/i, release: '2024-06', display: 'Sonnet 3.5 (June)' }])).toBe('Sonnet 3.5 (June)');
  });
});

describe('detectEvents', () => {
  const months = ['2024-01', '2024-02', '2024-03', '2024-04'];
  const names = { gpt: 'GPT', claude: 'Claude' };
  // 2024-03: claude overtakes on strength (+10, new model), gpt drops 6 (a fall: never an event).
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
    expect(types('2024-03')).toEqual(['lead_change:claude', 'new_model:claude']);
    expect(types('2024-04')).toEqual(['scale_lead_change:claude']);
  });
  it('marks lead changes, scale lead changes and the new model of the month\'s strength leader as major', () => {
    const major = ev.map((e) => `${e.month}:${e.type}:${e.major}`);
    expect(major).toEqual([
      '2024-02:new_unit:false',
      '2024-03:lead_change:true',
      '2024-03:new_model:true', // claude leads in 2024-03
      '2024-04:scale_lead_change:true',
    ]);
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
        { month: '2024-03', front: 'general', unit: 'claude', type: 'new_model', hide: true },
        { month: '2024-02', front: 'general', unit: 'claude', type: 'new_unit', text: { ja: 'Claude 2 参戦', en: 'Claude 2 joins' } },
      ],
      custom: [{ month: '2024-01', front: 'general', unit: 'gpt', text: { ja: '開戦', en: 'War begins' } }],
    });
    expect(ev2.some((e) => e.type === 'new_model')).toBe(false);
    expect(ev2.find((e) => e.type === 'new_unit')!.text.ja).toBe('Claude 2 参戦');
    expect(ev2.find((e) => e.type === 'new_unit')!.major).toBe(false);
    expect(ev2.find((e) => e.type === 'custom')).toMatchObject({ month: '2024-01', major: true });
  });
  it('emits only upward surges (strength or scale), never "falls back"', () => {
    const c2 = cells({
      a: [[100, 50, 'a-1'], [100, 50, 'a-1'], [100, 50, 'a-1'], [100, 30, 'a-1']],
      b: [[80, 10, 'b-1'], [60, 10, 'b-1'], [70, 10, 'b-1'], [70, 30, 'b-1']], // −20, then +10, then scale +20
    });
    const e = detectEvents({ front, months, cells: c2, unitNames: { a: 'A', b: 'B' }, params, releases: [], overrides: [], custom: [] });
    expect(e.filter((x) => x.type === 'surge').map((x) => `${x.month}:${x.unit}`)).toEqual(['2024-03:b', '2024-04:b']);
    expect(e.find((x) => x.type === 'surge')!.text.en).toBe('B surges — General Front');
    expect(e.find((x) => x.type === 'surge')!.major).toBe(false);
  });
  describe('source-mix changes (a unit\'s set of contributing groups differs from the previous month)', () => {
    /** a cell with per-group values; weights default to 0.5 */
    const cell = (s: number, parts: Record<string, number>, weights: Record<string, number> = {}) => ({
      s,
      c: 10,
      bestModel: null,
      q: 'high' as const,
      groups: Object.keys(parts),
      parts: Object.fromEntries(Object.entries(parts).map(([g, value]) => [g, { value, weight: weights[g] ?? 0.5 }])),
    });
    it('judges a strength surge also on the groups present in both months (a source appearing or fading out is no surge)', () => {
      const fc: FrontCells = new Map([
        ['a', [cell(100, { x: 100, y: 100 }), cell(100, { x: 100, y: 100 }), cell(100, { x: 100, y: 100 })]],
        // 2024-02: y appears with a high value (+15 overall, x unchanged) → no surge;
        // 2024-03: y fades out completely while x jumps +30 (+15 overall) → surge
        ['b', [cell(60, { x: 60 }), cell(75, { x: 60, y: 90 }), cell(90, { x: 90 })]],
        // 2024-03: z disappears, which lifts c by 20 although its remaining source did not move → no surge
        ['c', [cell(50, { x: 70, z: 30 }), cell(50, { x: 70, z: 30 }), cell(70, { x: 70 })]],
        // 2024-03: x rises 10 but the displayed strength falls (a strong source faded out) → no surge
        ['d', [cell(70, { x: 50, y: 90 }), cell(70, { x: 50, y: 90 }), cell(60, { x: 60 })]],
      ]);
      const e = detectEvents({ front, months: months.slice(0, 3), cells: fc, unitNames: {}, params: { ...params, surgeStrength: 8 }, releases: [], overrides: [], custom: [] });
      expect(e.map((x) => `${x.month}:${x.type}:${x.unit}`)).toEqual(['2024-03:surge:b']);
    });
    it('reports a lead change despite a source-mix change when it also holds on a like-for-like basis', () => {
      // 2024-02: b's new model lifts x from 90 to 100 and b is also scored by a new source y; a stays put.
      // On x alone b went 90 → 100 and overtook a (95): a real lead change.
      const fc: FrontCells = new Map([
        ['a', [cell(95, { x: 95 }), cell(95, { x: 95 })]],
        ['b', [cell(90, { x: 90 }), cell(98, { x: 100, y: 96 })]],
      ]);
      const e = detectEvents({ front, months: months.slice(0, 2), cells: fc, unitNames: {}, params: { ...params, surgeStrength: 20 }, releases: [], overrides: [], custom: [] });
      expect(e.map((x) => `${x.month}:${x.type}:${x.unit}`)).toEqual(['2024-02:lead_change:b']);
    });
    it('hands the lead over silently when it only changed because a source faded out of the leader\'s mix', () => {
      // a led thanks to source y; y fades out of a's mix in 2024-02 and b, unchanged, is now ahead
      const fc: FrontCells = new Map([
        ['a', [cell(97, { x: 94, y: 100 }), cell(94, { x: 94 }), cell(94, { x: 94 })]],
        ['b', [cell(96, { x: 96 }), cell(96, { x: 96 }), cell(96, { x: 96 })]],
      ]);
      const e = detectEvents({ front, months: months.slice(0, 3), cells: fc, unitNames: {}, params, releases: [], overrides: [], custom: [] });
      expect(e.filter((x) => x.type === 'lead_change')).toEqual([]);
    });
    it('suppresses surges of that unit when no per-group values are known', () => {
      const c2 = cells({
        a: [[100, 50, 'a-1', 'high', ['x', 'y']], [100, 50, 'a-1', 'high', ['x', 'y']], [100, 50, 'a-1', 'high', ['x', 'y']]],
        // +15 when y appears, then +15 with the same groups (listed in another order)
        b: [[60, 10, 'b-1', 'high', ['x']], [75, 10, 'b-1', 'high', ['x', 'y']], [90, 10, 'b-1', 'high', ['y', 'x']]],
      });
      const e = detectEvents({ front, months: months.slice(0, 3), cells: c2, unitNames: {}, params, releases: [], overrides: [], custom: [] });
      expect(e.map((x) => `${x.month}:${x.type}:${x.unit}`)).toEqual(['2024-03:surge:b']);
    });
    it('without per-group values, suppresses a lead change when the new leader\'s groups changed, and hands the lead over silently', () => {
      const c2 = cells({
        a: [[100, 50, 'a-1', 'high', ['x']], [100, 50, 'a-1', 'high', ['x']], [100, 50, 'a-1', 'high', ['x']], [100, 50, 'a-1', 'high', ['x']]],
        b: [[90, 10, 'b-1', 'high', ['x']], [103, 10, 'b-1', 'high', ['x', 'y']], [103, 10, 'b-1', 'high', ['x', 'y']], [99, 10, 'b-1', 'high', ['x', 'y']]],
      });
      const e = detectEvents({ front, months, cells: c2, unitNames: {}, params, releases: [], overrides: [], custom: [] });
      // 2024-02: no lead change, no surge (b's sources changed); 2024-03: b already leads; 2024-04: a is back ahead by 1 → real lead change
      expect(e.map((x) => `${x.month}:${x.type}:${x.unit}`)).toEqual(['2024-04:lead_change:a']);
    });
    it('without per-group values, suppresses a lead change when the previous leader\'s groups changed', () => {
      const c2 = cells({
        a: [[100, 50, 'a-1', 'high', ['x', 'y']], [95, 50, 'a-1', 'high', ['x']], [95, 50, 'a-1', 'high', ['x']]],
        b: [[98, 10, 'b-1', 'high', ['x', 'y']], [98, 10, 'b-1', 'high', ['x', 'y']], [98, 10, 'b-1', 'high', ['x', 'y']]],
      });
      const e = detectEvents({ front, months: months.slice(0, 3), cells: c2, unitNames: {}, params, releases: [], overrides: [], custom: [] });
      expect(e.filter((x) => x.type === 'lead_change')).toEqual([]);
    });
    it('still reports a lead change taken by a unit that was absent the month before', () => {
      const c2 = cells({
        a: [[100, 50, 'a-1'], [100, 50, 'a-1']],
        b: [null, [110, 10, 'b-1', 'high', ['x', 'y']]],
      });
      const e = detectEvents({ front, months: months.slice(0, 2), cells: c2, unitNames: {}, params, releases: [], overrides: [], custom: [] });
      expect(e.map((x) => `${x.month}:${x.type}:${x.unit}`)).toEqual(['2024-02:lead_change:b', '2024-02:new_unit:b']);
    });
  });
  it('reports new models only for units ranked in the top 3 by strength that month; only the leader\'s is major', () => {
    const c2 = cells({
      a: [[100, 40, 'a-1'], [100, 40, 'a-2']], // leader, new model (+0: below newModelMinDelta)
      b: [[90, 30, 'b-1'], [94, 30, 'b-2']], // 2nd, new model +4
      c: [[86, 20, 'c-1'], [90, 20, 'c-2']], // 3rd, new model +4
      d: [[82, 10, 'd-1'], [86, 10, 'd-2']], // 4th, new model +4 → not reported
    });
    const e = detectEvents({ front, months: months.slice(0, 2), cells: c2, unitNames: {}, params, releases: [], overrides: [], custom: [] });
    expect(e.map((x) => `${x.type}:${x.unit}:${x.major}`)).toEqual(['new_model:b:false', 'new_model:c:false']);
    const lead = cells({ a: [[100, 40, 'a-1'], [104, 40, 'a-2']], b: [[90, 30, 'b-1'], [90, 30, 'b-1']] });
    const e2 = detectEvents({ front, months: months.slice(0, 2), cells: lead, unitNames: {}, params, releases: [], overrides: [], custom: [] });
    expect(e2.map((x) => `${x.type}:${x.unit}:${x.major}`)).toEqual(['new_model:a:true']);
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
