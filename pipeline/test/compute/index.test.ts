import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
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
});
