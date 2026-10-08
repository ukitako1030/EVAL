import { describe, it, expect } from 'vitest';
import { renderPrSummary, findMovers, newEvents, cell, redactSecrets } from '../../src/report/prSummary';
import { validateWorld, type World } from '../../src/compute/world';
import type { FetchStatus } from '../../src/sources/run';

type Cell = NonNullable<World['series'][string][string][number]>;
const c = (s: number, cc: number): Cell => ({ s, c: cc, q: 'high', qs: 'high', qc: 'high' });

/** Two fronts; months 2026-09 and 2026-10. GPT and Claude on general, Suno on music. */
function makeWorld(over: Partial<World> = {}): World {
  return {
    schemaVersion: 2,
    generatedAt: '2026-10-05T12:00:00.000Z',
    dataLicense: 'Derived data.',
    dataLicenseJa: '派生データ。',
    months: ['2026-09', '2026-10'],
    partialMonth: '2026-10',
    orgs: { openai: { name: 'OpenAI', color: '#19c37d' }, anthropic: { name: 'Anthropic', color: '#d97757' } },
    fronts: [
      { id: 'general', name: { ja: '総合戦線', en: 'General Front' } },
      { id: 'music', name: { ja: '音楽戦線', en: 'Music Front' } },
    ],
    units: {
      general: {
        gpt: { org: 'openai', name: 'GPT', since: '2022-11' },
        claude: { org: 'anthropic', name: 'Claude', since: '2023-03' },
      },
      music: { suno: { org: 'openai', name: 'Suno', since: '2023-12' } },
    },
    announcements: {},
    series: {
      general: { gpt: [c(90, 80), c(92, 81)], claude: [c(85, 40), c(88, 41)] },
      music: { suno: [c(70, 50), c(71, 51)] },
    },
    breakdown: { general: { gpt: {}, claude: {} }, music: { suno: {} } },
    scaleBreakdown: { general: { gpt: {}, claude: {} }, music: { suno: {} } },
    events: [],
    sources: [
      { id: 'arena-text', group: 'arena-text', name: 'Arena (Text)', url: 'https://example.com/a', license: 'CC BY 4.0', credit: 'Arena', asOf: '2026-10-05', dataThrough: '2026-10-02' },
    ],
    ...over,
  };
}

const okStatus = (id: string): FetchStatus => ({ id, status: 'ok', count: 10, ms: 5 });
const status: FetchStatus[] = [okStatus('arena-text'), { id: 'cloudflare', status: 'skipped', count: 0, error: 'missing env: CLOUDFLARE_API_TOKEN', ms: 0 }];

const ev = (over: Partial<World['events'][number]> = {}): World['events'][number] => ({
  month: '2026-10',
  front: 'general',
  unit: 'gpt',
  type: 'new_model',
  text: { ja: 'GPT-6 登場', en: 'GPT-6 arrives' },
  major: false,
  ...over,
});

const render = (over: Partial<Parameters<typeof renderPrSummary>[0]> = {}) =>
  renderPrSummary({ before: makeWorld(), after: makeWorld(), status, warnings: [], ...over });

/** The text of one `### heading` section (up to the next heading or rule). */
const section = (md: string, heading: string): string => md.split(`### ${heading}`)[1].split(/\n(?:###|---)/)[0];

const withGeneral = (general: World['series'][string], base: World = makeWorld()): World => ({ ...base, series: { ...base.series, general } });

describe('test fixtures', () => {
  it('are valid worlds', () => {
    expect(() => validateWorld(makeWorld())).not.toThrow();
  });
});

describe('renderPrSummary: header, totals and footer', () => {
  it('titles the summary with the date of after.generatedAt and counts the sources', () => {
    const md = render({ status: [okStatus('a'), okStatus('b'), { id: 'x', status: 'failed', count: 0, error: 'boom', ms: 1 }, { id: 'y', status: 'skipped', count: 0, error: 'z', ms: 0 }] });
    expect(md).toMatch(/^## 今週の戦況更新（2026-10-05）\n/);
    expect(md).toContain('成功 2 ／ スキップ 1 ／ 失敗 1');
  });
  it('ends with the merge and correction hints', () => {
    const md = render();
    expect(md).toContain('承認（マージ）するとサイトに反映されます。');
    expect(md).toContain('数字がおかしい場合は、この PR にコメントするか、該当行を curated/*.yaml で修正してください。');
  });
});

describe('leaders', () => {
  it('shows the strength and scale leaders of every front', () => {
    const md = render();
    expect(md).toContain('### 首位');
    expect(md).toContain('| 総合戦線 | GPT（92.0） | GPT（81.0） |');
    expect(md).toContain('| 音楽戦線 | Suno（71.0） | Suno（51.0） |');
  });
  it('flags a changed strength leader with a warning sign, before → after', () => {
    const after = withGeneral({ gpt: [c(90, 80), c(92, 81)], claude: [c(85, 40), c(95, 41)] });
    expect(render({ after })).toContain('| 総合戦線 | GPT（92.0）→ Claude（95.0） ⚠ | GPT（81.0） |');
  });
  it('flags a changed scale leader independently of the strength leader', () => {
    const after = withGeneral({ gpt: [c(90, 80), c(92, 30)], claude: [c(85, 40), c(88, 60)] });
    expect(render({ after })).toContain('| 総合戦線 | GPT（92.0） | GPT（81.0）→ Claude（60.0） ⚠ |');
  });
  it('does not flag an unchanged leader, only shows the value moving', () => {
    const before = withGeneral({ gpt: [c(90, 80), c(91, 81)], claude: [c(85, 40), c(88, 41)] });
    const md = render({ before });
    expect(md).toContain('GPT（91.0 → 92.0）');
    expect(md).not.toContain('⚠');
  });
  it('compares the latest month of each world when a new month began', () => {
    const before = makeWorld({ months: ['2026-08', '2026-09'], partialMonth: '2026-09', series: { general: { gpt: [c(80, 70), c(85, 75)], claude: [c(70, 30), c(90, 35)] }, music: { suno: [c(60, 40), c(65, 45)] } } });
    expect(render({ before })).toContain('Claude（90.0）→ GPT（92.0） ⚠'); // leader of before's latest month (2026-09)
  });
});

describe('movers (大きな変動)', () => {
  it('lists units whose strength moved by 3 or more, or whose scale moved by 2 or more', () => {
    const before = makeWorld({ series: { general: { gpt: [c(90, 80), c(90, 81)], claude: [c(85, 40), c(88, 41)] }, music: { suno: [c(70, 50), c(70, 51)] } } });
    const after = makeWorld({
      series: {
        general: { gpt: [c(90, 80), c(93, 81)], claude: [c(85, 40), c(88, 43)] }, // gpt: Δs 3.0 (hit); claude: Δc 2.0 (hit)
        music: { suno: [c(70, 50), c(72.9, 52.9)] }, // Δs 2.9, Δc 1.9: below both thresholds
      },
    });
    const s = section(render({ before, after }), '大きな変動');
    expect(s).toContain('GPT');
    expect(s).toContain('Claude');
    expect(s).not.toContain('Suno');
    expect(s).toContain('90.0 → 93.0（+3.0）');
    expect(s).toContain('41.0 → 43.0（+2.0）');
  });
  it('shows a decrease with a minus sign', () => {
    const after = withGeneral({ gpt: [c(90, 80), c(92, 81)], claude: [c(85, 40), c(80, 41)] });
    expect(section(render({ after }), '大きな変動')).toContain('88.0 → 80.0（−8.0）');
  });
  it('states that nothing moved when nothing crossed a threshold', () => {
    expect(section(render(), '大きな変動')).toContain('該当なし');
  });
  it('sorts by the largest absolute move and caps the list at 15 rows', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `u${String(i).padStart(2, '0')}`);
    const units = Object.fromEntries(ids.map((id) => [id, { org: 'openai', name: `Unit ${id}`, since: '2023-01' }]));
    const mk = (delta: (i: number) => number): World =>
      makeWorld({
        units: { general: units, music: {} },
        series: { general: Object.fromEntries(ids.map((id, i) => [id, [c(50, 10), c(50 + delta(i), 10)]])), music: {} },
        breakdown: { general: {}, music: {} },
        scaleBreakdown: { general: {}, music: {} },
      });
    const before = mk(() => 0);
    const after = mk((i) => 3 + i); // u19 moves most (+22), u00 least (+3)
    const movers = findMovers(before, after);
    expect(movers).toHaveLength(20);
    expect(movers[0].unit).toBe('u19');
    expect(movers[19].unit).toBe('u00');
    const s = section(renderPrSummary({ before, after, status: [], warnings: [] }), '大きな変動');
    expect(s.match(/^\| 総合戦線 \|/gm)).toHaveLength(15);
    expect(s).toContain('Unit u19');
    expect(s).not.toContain('Unit u00');
    expect(s).toContain('ほか 5 件');
  });
  it('compares the same month when before already has it, and the previous latest month otherwise', () => {
    // same latest month on both sides: only 2026-10 is compared (2026-09 differs hugely but is ignored)
    const sameMonth = withGeneral({ gpt: [c(10, 10), c(92, 81)], claude: [c(85, 40), c(88, 41)] });
    expect(findMovers(sameMonth, makeWorld())).toEqual([]);
    // a new month began: after's 2026-10 is compared with before's latest (2026-09), not with 2026-08
    const older = makeWorld({ months: ['2026-08', '2026-09'], partialMonth: '2026-09', series: { general: { gpt: [c(0, 0), c(80, 70)], claude: [c(85, 40), c(88, 41)] }, music: { suno: [c(70, 50), c(71, 51)] } } });
    const movers = findMovers(older, makeWorld());
    expect(movers.map((m) => m.unit)).toEqual(['gpt']);
    expect(movers[0].ds).toBe(12);
  });
  it('skips units without a value on either side and units that are new', () => {
    expect(findMovers(withGeneral({ gpt: [c(90, 80), null], claude: [c(85, 40), c(88, 41)] }), makeWorld())).toEqual([]);
    const base = makeWorld();
    const withoutClaude = makeWorld({ units: { general: { gpt: base.units.general.gpt }, music: base.units.music }, series: { general: { gpt: base.series.general.gpt }, music: base.series.music } });
    expect(findMovers(withoutClaude, makeWorld())).toEqual([]);
  });
});

describe('new events (新しい戦況速報)', () => {
  const old = ev({ month: '2026-09', text: { ja: '前から知られていた', en: 'old' } });
  it('lists events that are in after but not in before, by month|front|unit|type', () => {
    const fresh = ev({ unit: 'claude', text: { ja: 'Claude 新モデル', en: 'Claude' } });
    const md = render({ before: makeWorld({ events: [old] }), after: makeWorld({ events: [old, fresh] }) });
    const s = section(md, '新しい戦況速報');
    expect(s).toContain('Claude 新モデル');
    expect(s).not.toContain('前から知られていた');
    expect(md).toContain('追加された速報：1 件');
  });
  it('treats the same month|front|unit|type with different text as already known', () => {
    const edited = { ...old, text: { ja: '言い回しを直した', en: 'reworded' } };
    expect(newEvents(makeWorld({ events: [old] }), makeWorld({ events: [edited] }))).toEqual([]);
  });
  it('counts a repeated key beyond what before had as new', () => {
    expect(newEvents(makeWorld({ events: [old] }), makeWorld({ events: [old, { ...old, text: { ja: '二つ目', en: 'second' } }] }))).toHaveLength(1);
  });
  it('puts major events first, then the newest month', () => {
    const events = [
      ev({ month: '2026-08', text: { ja: '古い通常', en: 'a' } }),
      ev({ month: '2026-10', unit: 'claude', text: { ja: '新しい通常', en: 'b' } }),
      ev({ month: '2026-07', front: 'music', unit: 'suno', text: { ja: '古い重大', en: 'c' }, major: true }),
    ];
    expect(newEvents(makeWorld(), makeWorld({ events })).map((e) => e.text.ja)).toEqual(['古い重大', '新しい通常', '古い通常']);
  });
  it('shows at most 20 events and counts the rest', () => {
    const many = Array.from({ length: 25 }, (_, i) => ev({ month: '2025-01', type: 'custom', text: { ja: `速報${i}`, en: `n${i}` }, front: 'general', unit: `u${i}` }));
    const s = section(render({ after: makeWorld({ events: many }) }), '新しい戦況速報');
    expect(s.match(/^- (?!ほか)/gm)).toHaveLength(20);
    expect(s).toContain('- ほか 5 件');
  });
  it('marks major events and shows the Japanese text', () => {
    const md = render({ after: makeWorld({ events: [ev({ major: true })] }) });
    expect(md).toContain('- ★ 2026-10 総合戦線：GPT-6 登場');
  });
  it('says so when there are none', () => {
    expect(section(render(), '新しい戦況速報')).toContain('新しい速報はありません');
  });
});

describe('new units (新部隊)', () => {
  it('lists units that are in after.units but not in before.units', () => {
    const base = makeWorld();
    const before = makeWorld({ units: { general: { gpt: base.units.general.gpt }, music: base.units.music } });
    const s = section(render({ before }), '新部隊');
    expect(s).toContain('Claude');
    expect(s).toContain('Anthropic');
    expect(s).not.toContain('Suno');
  });
  it('says so when there are none', () => {
    expect(section(render(), '新部隊')).toContain('新しい部隊はありません');
  });
});

describe('data sources and warnings', () => {
  it('lists failed and skipped sources with their messages, outside the collapsed table', () => {
    const md = render({
      status: [
        okStatus('arena-text'),
        { id: 'epoch-eci', status: 'failed', count: 0, error: 'HTTP 503', ms: 9 },
        { id: 'cloudflare', status: 'skipped', count: 0, error: 'missing env: CLOUDFLARE_API_TOKEN', ms: 0 },
      ],
    });
    const visible = section(md, 'データ源').split('<details>')[0];
    expect(visible).toContain('| epoch-eci | HTTP 503 |');
    expect(visible).toContain('| cloudflare | missing env: CLOUDFLARE_API_TOKEN |');
    expect(visible).not.toContain('arena-text');
  });
  it('has a collapsed table of every source with dataThrough', () => {
    const md = render();
    expect(md).toContain('<details><summary>すべてのデータ源（2）</summary>');
    expect(md).toContain('| arena-text | 成功 | 2026-10-02 | 2026-10-05 |');
    expect(md).toContain('| cloudflare | スキップ | — | — |'); // a status entry without a sources[] row
    expect(md).toContain('</details>');
  });
  it('says nothing failed when nothing failed', () => {
    expect(section(render(), 'データ源')).toContain('取得に失敗したデータ源はありません');
  });
  it('lists the warnings once each, and omits the section without warnings', () => {
    const md = render({ warnings: ['unit foo has no data', 'unit foo has no data', 'series bar is stale'] });
    expect(section(md, '警告').match(/^- /gm)).toHaveLength(2);
    expect(render()).not.toContain('### 警告');
  });
});

describe('escaping and secrets', () => {
  it('escapes pipes and newlines in table cells', () => {
    expect(cell('a|b\nc\r\nd')).toBe('a\\|b c d');
    const md = render({ status: [{ id: 'x|y', status: 'failed', count: 0, error: 'bad | pipe\nsecond line', ms: 1 }] });
    const row = '| x\\|y | bad \\| pipe second line |';
    expect(md).toContain(row);
    expect(row.split(/(?<!\\)\|/)).toHaveLength(4); // '', two cells, ''
  });
  it('escapes pipes in unit and event text too', () => {
    const w = makeWorld({ events: [ev({ text: { ja: 'a | b', en: 'x' } })] });
    const md = render({ after: { ...w, units: { ...w.units, general: { ...w.units.general, gpt: { ...w.units.general.gpt, name: 'GPT | mini' } } } } });
    expect(md).toContain('GPT \\| mini');
    expect(md).toContain('a \\| b');
  });
  it('defuses @mentions and HTML', () => {
    expect(cell('@cf/meta/llama and @someone')).not.toMatch(/@[a-z]/);
    expect(cell('<script>')).toBe('&lt;script&gt;');
  });
  it('masks credentials that appear in error messages', () => {
    expect(redactSecrets('GET https://x.test/v1?api_key=abc123def456&page=2 failed')).toBe('GET https://x.test/v1?api_key=***&page=2 failed');
    expect(redactSecrets('401 Authorization: Bearer abcdefghijklmnop')).toBe('401 Authorization: Bearer ***');
    expect(redactSecrets('token is sekretvalue12345 here', ['sekretvalue12345'])).toBe('token is *** here');
    expect(redactSecrets('short ab', ['ab'])).toBe('short ab'); // too short to be treated as a secret
    expect(redactSecrets('missing env: DESIGNARENA_API_KEY')).toBe('missing env: DESIGNARENA_API_KEY');
  });
  it('never prints a secret value found in a status error or a warning', () => {
    const md = render({
      secrets: ['super-secret-token-value'],
      status: [{ id: 'x', status: 'failed', count: 0, error: 'rejected super-secret-token-value', ms: 1 }],
      warnings: ['could not use super-secret-token-value'],
    });
    expect(md).not.toContain('super-secret-token-value');
    expect(md).toContain('rejected ***');
  });
});

describe('first run (before: null)', () => {
  it('renders the leaders and sources without any diff', () => {
    const md = renderPrSummary({ before: null, after: makeWorld({ events: [ev()] }), status, warnings: [] });
    expect(md).toContain('### 首位');
    expect(md).toContain('| 総合戦線 | GPT（92.0） | GPT（81.0） |');
    expect(md).toContain('前回のデータがないため、前回との比較はありません');
    expect(md).not.toContain('⚠');
    expect(md).not.toContain('→');
    expect(md).not.toContain('### 大きな変動');
    expect(md).not.toContain('### 新しい戦況速報');
    expect(md).not.toContain('### 新部隊');
    expect(md).toContain('### データ源');
    expect(md).toContain('承認（マージ）するとサイトに反映されます。');
  });
});
