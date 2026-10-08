import { describe, it, expect } from 'vitest';
import { parseUnits, parseMethod, parseAnnouncements, parseEvents, parseReleases } from '../../src/config/load';

const FRONTS = ['general', 'code', 'agent', 'image', 'video', 'speech', 'music'];
const frontsYaml = (extra = '') =>
  FRONTS.map((f) => `  ${f}:\n    name: { ja: ${f}JA, en: ${f}EN }\n    units: {}`).join('\n') + extra;

const UNITS = `
orgs:
  openai: { name: OpenAI, color: '#19c37d' }
fronts:
${frontsYaml().replace(
  '  general:\n    name: { ja: generalJA, en: generalEN }\n    units: {}',
  `  general:
    name: { ja: 総合戦線, en: General Front }
    units:
      gpt:
        org: openai
        name: GPT
        since: 2022-11
        match: ['^gpt', '^o[134]']
        scale: { crux: [chatgpt.com], wikipedia: [ChatGPT] }`,
)}
`;

const METHOD = `
start: 2022-11
strength:
  minUnits: 2
  snapshotMaxAgeDays: 92
  releaseActiveMonths: 3
  kinds: { elo: { scale: 400 }, percent: { clampLo: 0.5, clampHi: 99.5 }, minutes: { kappa: 1 }, eci: { tau: 8 } }
  estimate: { floor: 60, step: 6 }
  weights:
    general: { arena-text: 0.5, epoch-eci: 0.5 }
scale:
  smoothingMonths: 3
  announcementStaleMonths: 6
  metricFactors: { MAU: 1, WAU: 1.4, DAU: 2.5 }
  floorFactor: 0.5
  components:
    users: { weight: 0.45, signals: [announcements] }
    attention: { weight: 0.1, signals: [wikipedia] }
  base: [attention]
events: { newModelMinDelta: 3, surgeStrength: 5, surgeScale: 5, leadHysteresis: 1, maxPerFrontMonth: 3 }
`;

describe('config loaders', () => {
  it('parses and compiles units', () => {
    const u = parseUnits(UNITS);
    expect(u.orgs.openai.color).toBe('#19c37d');
    expect(u.fronts.general.name.en).toBe('General Front');
    const gpt = u.units.general[0];
    expect(gpt.id).toBe('gpt');
    expect(gpt.since).toBe('2022-11');
    expect(gpt.regexes[0].test('GPT-4o')).toBe(true); // case-insensitive
    expect(gpt.regexes[1].test('o3-pro')).toBe(true);
    expect(gpt.scale.crux).toEqual(['chatgpt.com']);
    expect(u.units.code).toEqual([]);
  });
  it('rejects units with unknown org', () => {
    expect(() => parseUnits(UNITS.replace('org: openai', 'org: nobody'))).toThrow(/unknown org "nobody"/);
  });
  it('does not resolve inherited property names as orgs or base components', () => {
    expect(() => parseUnits(UNITS.replace('org: openai', 'org: toString'))).toThrow(/unknown org "toString"/);
    expect(() => parseMethod(METHOD.replace('base: [attention]', 'base: [toString]'))).toThrow(/base component "toString"/);
  });
  it('rejects the same scale key configured for two units of one front', () => {
    const withSecond = (scale: string) =>
      UNITS.replace(
        'scale: { crux: [chatgpt.com], wikipedia: [ChatGPT] }',
        `scale: { crux: [chatgpt.com], wikipedia: [ChatGPT], announcements: chatgpt }
      gpt2:
        org: openai
        name: GPT2
        since: 2023-01
        scale: ${scale}`,
      );
    expect(() => parseUnits(withSecond('{ crux: [chatgpt.com] }'))).toThrow(/general.*crux.*chatgpt\.com/);
    expect(() => parseUnits(withSecond('{ wikipedia: [Other, ChatGPT] }'))).toThrow(/general.*wikipedia.*ChatGPT/);
    expect(() => parseUnits(withSecond('{ announcements: chatgpt }'))).toThrow(/general.*announcements.*chatgpt/);
    // distinct keys are fine, and so is the same key on different fronts
    expect(() => parseUnits(withSecond('{ crux: [chat.openai.com] }'))).not.toThrow();
    const twoFronts = UNITS.replace(
      '    units: {}',
      `    units:
      cursor:
        org: openai
        name: Cursor
        since: 2023-01
        scale: { crux: [chatgpt.com] }`,
    );
    expect(() => parseUnits(twoFronts)).not.toThrow();
  });
  it('rejects a missing front', () => {
    expect(() => parseUnits(UNITS.replace(/  music:[\s\S]*$/, ''))).toThrow(/music/);
  });
  it('parses method and rejects unknown base component', () => {
    const m = parseMethod(METHOD);
    expect(m.strength.weights.general['arena-text']).toBe(0.5);
    expect(() => parseMethod(METHOD.replace('base: [attention]', 'base: [nope]'))).toThrow(/base component "nope"/);
  });
  it('parses announcements, requiring a url on every point', () => {
    const a = parseAnnouncements(`
series:
  chatgpt:
    metric: WAU
    points:
      - { date: 2023-11-06, value: 100000000, url: https://example.com/a }
`);
    expect(a.series.chatgpt.points[0].value).toBe(100000000);
    expect(() =>
      parseAnnouncements(`
series:
  chatgpt: { metric: WAU, points: [ { date: 2023-11-06, value: 1 } ] }
`),
    ).toThrow();
  });
  it('parses events and releases', () => {
    const e = parseEvents(`
overrides:
  - { month: 2025-03, front: general, unit: gemini, type: new_model, text: { ja: あ, en: a } }
  - { month: 2025-04, front: general, unit: gpt, type: surge, hide: true }
custom:
  - { month: 2022-11, front: general, unit: gpt, text: { ja: 開戦, en: War begins } }
`);
    expect(e.overrides).toHaveLength(2);
    expect(e.custom[0].text.ja).toBe('開戦');
    const r = parseReleases(`
models:
  - { match: '^dall-e-3', release: 2023-10, display: DALL·E 3 }
`);
    expect(r[0].regex.test('DALL-E-3')).toBe(true);
    expect(r[0].release).toBe('2023-10');
    expect(r[0].display).toBe('DALL·E 3');
  });
});
