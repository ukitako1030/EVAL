import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeWorld } from '../../src/compute/index';
import { saveSnapshot } from '../../src/raw/store';
import type { SourceModule } from '../../src/sources/types';
import type { Observation, SignalObs } from '../../src/core/types';

const FRONTS = ['general', 'code', 'agent', 'image', 'video', 'speech', 'music'];
const meta = { name: 'Fake', url: 'https://fake', license: 'CC BY 4.0', credit: 'Fake' };
const arena: SourceModule = { id: 'fake-arena', role: 'strength', group: 'arena-text', history: 'full', meta, fetch: async () => null, parse: () => [] };
const wiki: SourceModule = { id: 'fake-wiki', role: 'scale', history: 'full', meta, fetch: async () => null, parse: () => [] };

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'world-'));
  mkdirSync(join(dir, 'curated'));
  mkdirSync(join(dir, 'config'));
  const fronts = FRONTS.map((f) =>
    f === 'general'
      ? `  general:
    name: { ja: 総合戦線, en: General Front }
    units:
      gpt: { org: openai, name: GPT, since: 2022-11, match: ['^gpt'], scale: { wikipedia: [ChatGPT] } }
      claude: { org: anthropic, name: Claude, since: 2023-03, match: ['^claude'], scale: { wikipedia: [Claude] } }`
      : `  ${f}:\n    name: { ja: ${f}, en: ${f} }\n    units: {}`,
  ).join('\n');
  writeFileSync(
    join(dir, 'curated', 'units.yaml'),
    `orgs:\n  openai: { name: OpenAI, color: '#19c37d' }\n  anthropic: { name: Anthropic, color: '#ff8a4c' }\nfronts:\n${fronts}\n`,
  );
  writeFileSync(join(dir, 'curated', 'announcements.yaml'), 'series: {}\n');
  writeFileSync(join(dir, 'curated', 'events.yaml'), 'custom:\n  - { month: 2022-11, front: general, unit: gpt, text: { ja: 開戦, en: War begins } }\n');
  writeFileSync(join(dir, 'curated', 'releases.yaml'), 'models: []\n');
  writeFileSync(
    join(dir, 'config', 'method.yaml'),
    `start: 2022-11
strength:
  minUnits: 2
  snapshotMaxAgeDays: 92
  releaseActiveMonths: 3
  kinds: { elo: { scale: 400 }, percent: { clampLo: 0.5, clampHi: 99.5 }, minutes: { kappa: 1 }, eci: { tau: 8 } }
  estimate: { floor: 60, step: 6 }
  weights:
    general: { arena-text: 1 }
scale:
  smoothingMonths: 1
  announcementStaleMonths: 6
  metricFactors: { MAU: 1, WAU: 1.4, DAU: 2.5 }
  floorFactor: 0.5
  components:
    users: { weight: 0.45, signals: [announcements] }
    attention: { weight: 0.1, signals: [wikipedia] }
  base: [attention]
events: { newModelMinDelta: 3, surgeStrength: 5, surgeScale: 5, leadHysteresis: 1, maxPerFrontMonth: 3 }
`,
  );
  const obs: Observation[] = [
    { series: 'fake-arena', kind: 'elo', model: 'gpt-4', date: '2023-05-31', dateKind: 'snapshot', value: 1250 },
    { series: 'fake-arena', kind: 'elo', model: 'claude-1', date: '2023-05-31', dateKind: 'snapshot', value: 1150 },
  ];
  saveSnapshot(join(dir, 'raw'), 'fake-arena', '2026-10-05', obs, 'full');
  const sig: SignalObs[] = [
    { signal: 'wikipedia', key: 'ChatGPT', month: '2023-05', value: 900 },
    { signal: 'wikipedia', key: 'Claude', month: '2023-05', value: 100 },
  ];
  saveSnapshot(join(dir, 'raw'), 'fake-wiki', '2026-10-05', sig, 'full');
  // a source whose raw file is corrupt JSON
  mkdirSync(join(dir, 'raw', 'fake-corrupt'));
  writeFileSync(join(dir, 'raw', 'fake-corrupt', '2026-10-05.json'), '{"sourceId":"fake-corrupt","date":"2026-10-05","items":[{"series":');
  // a source whose single series mixes value kinds
  const mixed: Observation[] = [
    { series: 'fake-mixed', kind: 'elo', model: 'gpt-4', date: '2023-05-31', dateKind: 'snapshot', value: 1100 },
    { series: 'fake-mixed', kind: 'percent', model: 'claude-1', date: '2023-05-31', dateKind: 'snapshot', value: 80 },
  ];
  saveSnapshot(join(dir, 'raw'), 'fake-mixed', '2026-10-05', mixed, 'full');
});

describe('computeWorld', () => {
  it('builds a valid world from raw + curated', () => {
    const w = computeWorld({
      rawDir: join(dir, 'raw'),
      curatedDir: join(dir, 'curated'),
      methodPath: join(dir, 'config', 'method.yaml'),
      modules: [arena, wiki],
      now: new Date('2023-06-15T00:00:00Z'),
    });
    expect(w.schemaVersion).toBe(2);
    expect(w.generatedAt).toBe('2023-06-15T00:00:00.000Z');
    expect(w.months).toEqual(['2022-11', '2022-12', '2023-01', '2023-02', '2023-03', '2023-04', '2023-05', '2023-06']);
    expect(w.partialMonth).toBe('2023-06');
    const gpt = w.series.general.gpt;
    const claude = w.series.general.claude;
    expect(gpt[0]).toEqual({ s: 100, c: 100, q: 'estimated' }); // alone, no data
    expect(claude[3]).toBeNull(); // 2023-02: not yet
    expect(gpt[6]!.s).toBe(100);
    expect(claude[6]!.s).toBeCloseTo(200 / (1 + 10 ** 0.25), 1);
    expect(gpt[6]!.c).toBeCloseTo(90, 1);
    expect(gpt[6]!.q).toBe('medium');
    expect(w.breakdown.general.gpt['2023-05'][0]).toMatchObject({ source: 'arena-text', weight: 1, kind: 'measured' });
    expect(w.events.find((e) => e.type === 'new_unit' && e.unit === 'claude')?.month).toBe('2023-03');
    expect(w.events.find((e) => e.type === 'custom')?.text.ja).toBe('開戦');
    expect(w.sources.map((s) => s.id)).toEqual(['fake-arena', 'fake-wiki']);
    expect(w.sources[0].asOf).toBe('2026-10-05');
    expect(w.fronts).toHaveLength(7);
  });
  it('skips a corrupt source and a series that mixes kinds with warnings, and still produces the world', () => {
    const corrupt: SourceModule = { ...arena, id: 'fake-corrupt' };
    const mixed: SourceModule = { ...arena, id: 'fake-mixed' };
    const base = {
      rawDir: join(dir, 'raw'),
      curatedDir: join(dir, 'curated'),
      methodPath: join(dir, 'config', 'method.yaml'),
      now: new Date('2023-06-15T00:00:00Z'),
    };
    const clean = computeWorld({ ...base, modules: [arena, wiki] });
    const warnings: string[] = [];
    const w = computeWorld({ ...base, modules: [corrupt, arena, mixed, wiki], onWarn: (m) => warnings.push(m) });
    expect(w.series).toEqual(clean.series);
    expect(w.breakdown).toEqual(clean.breakdown);
    expect(warnings.some((m) => m.includes('fake-corrupt'))).toBe(true);
    expect(warnings.some((m) => m.includes('fake-mixed'))).toBe(true);
    // the series warning says where it happened (general is the only front with weights for arena-text)
    expect(warnings.find((m) => m.includes('fake-mixed'))).toMatch(/general/);
    expect(warnings).toHaveLength(2);
  });
  it('drops invalid strength items on load with one warning per module and still uses the valid ones', () => {
    const valid: Observation[] = [
      { series: 'fake-dirty', kind: 'elo', model: 'gpt-4', date: '2023-05-31', dateKind: 'snapshot', value: 1250 },
      { series: 'fake-dirty', kind: 'elo', model: 'claude-1', date: '2023-05-31', dateKind: 'snapshot', value: 1150 },
    ];
    const bad = [
      { series: 'fake-dirty', kind: 'bogus', model: 'gpt-4', date: '2023-05-31', dateKind: 'snapshot', value: 1 }, // unknown kind
      { series: 'fake-dirty', kind: 'elo', model: 'gpt-4', date: '2023-05-31', dateKind: 'weekly', value: 1 }, // unknown dateKind
      { series: 'fake-dirty', kind: 'elo', model: 'gpt-4', date: '2023-05-31', dateKind: 'snapshot', value: '1200' }, // string value
      { series: 'fake-dirty', kind: 'elo', model: 'gpt-4', date: '2023-05-31', dateKind: 'snapshot', value: null }, // NaN serialised by JSON
      { series: 'fake-dirty', kind: 'elo', date: '2023-05-31', dateKind: 'snapshot', value: 1200 }, // no model
      { series: 7, kind: 'elo', model: 'gpt-4', date: '2023-05-31', dateKind: 'snapshot', value: 1200 }, // series not a string
      { series: 'fake-dirty', kind: 'elo', model: 'gpt-4', date: 20230531, dateKind: 'snapshot', value: 1200 }, // date not a string
      null,
      'oops',
    ];
    const raw = join(dir, 'raw-dirty-strength');
    saveSnapshot(raw, 'fake-dirty', '2026-10-05', [valid[0], ...bad, valid[1]], 'full');
    const dirty: SourceModule = { ...arena, id: 'fake-dirty' };
    const base = { rawDir: raw, curatedDir: join(dir, 'curated'), methodPath: join(dir, 'config', 'method.yaml'), now: new Date('2023-06-15T00:00:00Z') };
    const warnings: string[] = [];
    const w = computeWorld({ ...base, modules: [dirty], onWarn: (m) => warnings.push(m) });
    const clean = computeWorld({ ...base, rawDir: join(dir, 'raw'), modules: [arena] });
    expect(w.series).toEqual(clean.series);
    expect(w.breakdown).toEqual(clean.breakdown);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('fake-dirty');
    expect(warnings[0]).toContain(String(bad.length));
  });
  it('drops invalid scale items on load with one warning per module', () => {
    const bad = [
      { signal: 'bogus', key: 'ChatGPT', month: '2023-05', value: 5 },
      { signal: 'wikipedia', key: 42, month: '2023-05', value: 5 },
      { signal: 'wikipedia', key: 'ChatGPT', month: '2023-5', value: 5 },
      { signal: 'wikipedia', key: 'ChatGPT', month: '2023-05-31', value: 5 },
      { signal: 'wikipedia', key: 'ChatGPT', month: '2023-05', value: 0 },
      { signal: 'wikipedia', key: 'ChatGPT', month: '2023-05', value: -3 },
      { signal: 'wikipedia', key: 'ChatGPT', month: '2023-05', value: '900' },
      { signal: 'wikipedia', key: 'ChatGPT', month: '2023-05', value: null },
      null,
    ];
    const good: SignalObs[] = [
      { signal: 'wikipedia', key: 'ChatGPT', month: '2023-05', value: 900 },
      { signal: 'wikipedia', key: 'Claude', month: '2023-05', value: 100 },
    ];
    const raw = join(dir, 'raw-dirty-scale');
    saveSnapshot(raw, 'fake-wiki', '2026-10-05', [good[0], ...bad, good[1]], 'full');
    const base = { rawDir: raw, curatedDir: join(dir, 'curated'), methodPath: join(dir, 'config', 'method.yaml'), now: new Date('2023-06-15T00:00:00Z') };
    const warnings: string[] = [];
    const w = computeWorld({ ...base, modules: [wiki], onWarn: (m) => warnings.push(m) });
    const clean = computeWorld({ ...base, rawDir: join(dir, 'raw'), modules: [wiki] });
    expect(w.series).toEqual(clean.series);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('fake-wiki');
    expect(warnings[0]).toContain(String(bad.length));
  });
  it("passes units.yaml's top-level exclude to the unit matching", () => {
    const curated = join(dir, 'curated-exclude');
    mkdirSync(curated);
    for (const f of ['announcements.yaml', 'events.yaml', 'releases.yaml']) writeFileSync(join(curated, f), readFileSync(join(dir, 'curated', f)));
    const unitsYaml = readFileSync(join(dir, 'curated', 'units.yaml'), 'utf8');
    writeFileSync(join(curated, 'units.yaml'), `exclude:\n  - 'ft$'\n${unitsYaml}`);
    const withFineTune: Observation[] = [
      { series: 'fake-arena', kind: 'elo', model: 'gpt-4', date: '2023-05-31', dateKind: 'snapshot', value: 1250 },
      { series: 'fake-arena', kind: 'elo', model: 'claude-1', date: '2023-05-31', dateKind: 'snapshot', value: 1150 },
      { series: 'fake-arena', kind: 'elo', model: 'claude-1-super-ft', date: '2023-05-31', dateKind: 'snapshot', value: 1400 }, // third-party fine-tune
    ];
    const raw = join(dir, 'raw-exclude');
    saveSnapshot(raw, 'fake-arena', '2026-10-05', withFineTune, 'full');
    const base = { methodPath: join(dir, 'config', 'method.yaml'), now: new Date('2023-06-15T00:00:00Z'), modules: [arena] };
    const excluded = computeWorld({ ...base, rawDir: raw, curatedDir: curated });
    // the same data without the exclude rule would put Claude ahead of GPT
    const notExcluded = computeWorld({ ...base, rawDir: raw, curatedDir: join(dir, 'curated') });
    expect(notExcluded.series.general.claude[6]!.s).toBe(100);
    // with it, the world is exactly the one built from the data without the fine-tune
    const clean = computeWorld({ ...base, rawDir: join(dir, 'raw'), curatedDir: join(dir, 'curated') });
    expect(excluded.series).toEqual(clean.series);
    expect(excluded.breakdown).toEqual(clean.breakdown);
  });
  it('does not warn when every item is valid', () => {
    const warnings: string[] = [];
    computeWorld({
      rawDir: join(dir, 'raw'),
      curatedDir: join(dir, 'curated'),
      methodPath: join(dir, 'config', 'method.yaml'),
      modules: [arena, wiki],
      now: new Date('2023-06-15T00:00:00Z'),
      onWarn: (m) => warnings.push(m),
    });
    expect(warnings).toEqual([]);
  });
  it('keeps the latest fetch when an accumulate scale source repeats a (signal, key, month)', () => {
    const accWiki: SourceModule = { ...wiki, id: 'fake-wiki-acc', history: 'accumulate' };
    const base = { curatedDir: join(dir, 'curated'), methodPath: join(dir, 'config', 'method.yaml'), now: new Date('2023-06-15T00:00:00Z') };
    const run = (files: [string, number][]) => {
      const raw = mkdtempSync(join(tmpdir(), 'acc-'));
      for (const [date, gptValue] of files) {
        const items: SignalObs[] = [
          { signal: 'wikipedia', key: 'ChatGPT', month: '2023-05', value: gptValue },
          { signal: 'wikipedia', key: 'Claude', month: '2023-05', value: 100 },
        ];
        saveSnapshot(raw, 'fake-wiki-acc', date, items, 'accumulate');
      }
      return computeWorld({ ...base, rawDir: raw, modules: [accWiki] });
    };
    const revised = run([['2026-10-04', 900], ['2026-10-05', 300]]); // the later fetch revised 900 down to 300
    const onlyLatest = run([['2026-10-05', 300]]);
    const onlyOld = run([['2026-10-04', 900]]);
    expect(onlyOld.series.general.gpt[6]!.c).not.toBeCloseTo(onlyLatest.series.general.gpt[6]!.c, 1); // the data actually matters
    expect(revised.series).toEqual(onlyLatest.series);
    // and the order of the dates in the files decides, not the size of the value
    const raised = run([['2026-10-04', 300], ['2026-10-05', 900]]);
    expect(raised.series).toEqual(onlyOld.series);
  });
  it('reports through console.warn when no onWarn is given', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const corrupt: SourceModule = { ...arena, id: 'fake-corrupt' };
      const w = computeWorld({
        rawDir: join(dir, 'raw'),
        curatedDir: join(dir, 'curated'),
        methodPath: join(dir, 'config', 'method.yaml'),
        modules: [corrupt, arena, wiki],
        now: new Date('2023-06-15T00:00:00Z'),
      });
      expect(w.series.general.gpt[6]!.s).toBe(100);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('fake-corrupt'));
    } finally {
      spy.mockRestore();
    }
  });
});
