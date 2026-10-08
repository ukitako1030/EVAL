import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { swebench } from '../../src/sources/swebench';
import type { FetchCtx } from '../../src/sources/types';

const RAW = JSON.parse(readFileSync(new URL('../fixtures/swebench/sample.json', import.meta.url), 'utf8')) as {
  leaderboards: { name: string; results: Record<string, unknown>[] }[];
};
const NOW = new Date('2026-10-12T06:00:00Z');
const verified = RAW.leaderboards.find((b) => b.name === 'Verified')!.results;

/** Same predicate as the module: agent name, a "Mini: " tag, or the version key. */
const isMini = (r: Record<string, unknown>) =>
  r.agent === 'mini-SWE-agent' ||
  ((r.tags as string[] | undefined) ?? []).some((t) => t.startsWith('Mini: ')) ||
  'mini-swe-agent_version' in r;

describe('swebench', () => {
  const obs = swebench.parse(RAW, { now: NOW });

  it('emits exactly the Verified mini-SWE-agent runs of the fixture', () => {
    const minis = verified.filter(isMini);
    expect(verified).toHaveLength(54);
    expect(minis).toHaveLength(47);
    expect(obs).toHaveLength(minis.length);
    // the other boards (Multilingual is all mini-SWE-agent too) and the non-mini Verified rows (79.2 is the top non-mini score) are left out
    expect(obs.every((o) => o.series === 'swebench' && o.kind === 'percent' && o.dateKind === 'release')).toBe(true);
    expect(obs.map((o) => o.value)).not.toContain(79.2);
  });

  it('maps model_display, model_org, model_release_date and resolved', () => {
    const rows = obs.filter((o) => o.model === 'Claude 4.5 Opus');
    expect(rows).toEqual([
      { series: 'swebench', kind: 'percent', model: 'Claude 4.5 Opus', org: 'Anthropic', date: '2025-11-24', dateKind: 'release', value: 76.8 },
      { series: 'swebench', kind: 'percent', model: 'Claude 4.5 Opus', org: 'Anthropic', date: '2025-11-24', dateKind: 'release', value: 74.4 },
    ]);
  });

  it('declares the SWE-bench meta', () => {
    expect(swebench).toMatchObject({
      id: 'swebench',
      role: 'strength',
      group: 'swebench',
      history: 'full',
      meta: { license: 'CC BY-NC 4.0', url: 'https://www.swebench.com' },
    });
    expect(swebench.meta.credit).toContain('CC BY-NC 4.0');
  });

  describe('mini row identification and fallbacks', () => {
    const wrap = (...results: unknown[]) => ({ leaderboards: [{ name: 'Verified', results }] });

    it('accepts agent name, Mini tag and version key alone, and rejects other scaffolds', () => {
      const raw = wrap(
        { name: 'A', agent: 'mini-SWE-agent', model_display: 'A', resolved: 10, date: '2026-01-01' },
        { name: 'B', agent: 'SWE-agent', tags: ['Mini: 1.0.0'], model_display: 'B', resolved: 20, date: '2026-01-02' },
        { name: 'C', 'mini-swe-agent_version': '2.0.0', model_display: 'C', resolved: 30, date: '2026-01-03' },
        { name: 'D', agent: 'SWE-agent', tags: ['Model: d'], model_display: 'D', resolved: 40, date: '2026-01-04' },
      );
      expect(swebench.parse(raw, { now: NOW }).map((o) => o.model)).toEqual(['A', 'B', 'C']);
    });

    it('model falls back from model_display to the Model tag to name; date from release date to run date', () => {
      const raw = wrap(
        { name: 'N1', agent: 'mini-SWE-agent', model_display: 'Shown', tags: ['Model: tagged'], model_release_date: 20250102, date: '2026-02-01', resolved: 1 },
        { name: 'N2', agent: 'mini-SWE-agent', model_display: null, tags: ['Org: X', 'Model: tagged-2', 'Model: other'], model_release_date: null, date: '2026-02-02', resolved: 2 },
        { name: 'N3', agent: 'mini-SWE-agent', model_display: '', tags: [], model_org: 'Acme', date: '2026-02-03', resolved: 3 },
      );
      expect(swebench.parse(raw, { now: NOW })).toEqual([
        { series: 'swebench', kind: 'percent', model: 'Shown', date: '2025-01-02', dateKind: 'release', value: 1 },
        { series: 'swebench', kind: 'percent', model: 'tagged-2', date: '2026-02-02', dateKind: 'release', value: 2 },
        { series: 'swebench', kind: 'percent', model: 'N3', org: 'Acme', date: '2026-02-03', dateKind: 'release', value: 3 },
      ]);
    });

    it('skips rows without a score or any date, and returns [] when the Verified board is missing', () => {
      const raw = wrap(
        { name: 'ok', agent: 'mini-SWE-agent', date: '2026-02-03', resolved: 3 },
        { name: 'no score', agent: 'mini-SWE-agent', date: '2026-02-03', resolved: null },
        { name: 'no date', agent: 'mini-SWE-agent', resolved: 3 },
        'not a row',
      );
      expect(swebench.parse(raw, { now: NOW }).map((o) => o.model)).toEqual(['ok']);
      expect(swebench.parse({ leaderboards: [{ name: 'Lite', results: [] }] }, { now: NOW })).toEqual([]);
      expect(swebench.parse('nope', { now: NOW })).toEqual([]);
      expect(swebench.parse(null, { now: NOW })).toEqual([]);
      expect(swebench.parse([], { now: NOW })).toEqual([]); // an array is not the top-level object
      expect(swebench.parse({ leaderboards: [['Verified']] }, { now: NOW })).toEqual([]); // nor is an array a board
    });
  });

  it('fetch reads the master-branch JSON and keeps only the Verified board without per-instance details', async () => {
    const urls: string[] = [];
    const ctx = {
      fetchJson: async (url: string) => (urls.push(url), RAW),
    } as unknown as FetchCtx;
    const slim = await swebench.fetch(ctx);
    expect(urls).toEqual(['https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json']);
    // the fixture keeps per_instance_details on one mini row; fetch drops it
    expect(verified.some((r) => 'per_instance_details' in r)).toBe(true);
    expect(JSON.stringify(slim)).not.toContain('per_instance_details');
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(RAW).length);
    expect(swebench.parse(slim, { now: NOW })).toEqual(obs);
  });
});
