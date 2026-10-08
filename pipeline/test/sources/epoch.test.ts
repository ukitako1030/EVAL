import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import {
  epochApex,
  epochBenchmark,
  epochEci,
  epochMetr,
  epochOsworld,
  epochOsworld2,
  epochSwebench,
  epochTerminalBench,
  epochVending,
} from '../../src/sources/epoch';
import type { FetchCtx } from '../../src/sources/types';
import type { Observation } from '../../src/core/types';

const fixture = (id: string) => readFileSync(new URL(`../fixtures/${id}/sample.csv`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-12T06:00:00Z');
const parse = (mod: { parse(raw: unknown, ctx: { now: Date }): Observation[] }, id: string) => mod.parse(fixture(id), { now: NOW });
const byModel = (obs: Observation[], model: string) => obs.filter((o) => o.model === model);

describe('epochEci', () => {
  const obs = parse(epochEci, 'epoch-eci');

  it('maps a row to an ECI observation dated at the model release', () => {
    expect(byModel(obs, 'Claude Opus 5.5')).toEqual([
      { series: 'epoch-eci', kind: 'eci', model: 'Claude Opus 5.5', org: 'Anthropic', date: '2026-09-22', dateKind: 'release', value: 167.33 },
    ]);
    expect(byModel(obs, 'GPT-6 Astra')).toEqual([
      { series: 'epoch-eci', kind: 'eci', model: 'GPT-6 Astra', org: 'OpenAI', date: '2026-09-03', dateKind: 'release', value: 166.45 },
    ]);
  });

  it('keeps every fixture row, keeps multi-org values whole and leaves org off blank-org rows', () => {
    expect(obs).toHaveLength(57);
    expect(byModel(obs, 'Gemini 2.0 Flash (Dec 2024)')[0].org).toBe('Google DeepMind,Google');
    const noOrg = byModel(obs, 'PaLM 2-L')[0];
    expect(noOrg).toEqual({ series: 'epoch-eci', kind: 'eci', model: 'PaLM 2-L', date: '2023-05-17', dateKind: 'release', value: 115.02 });
    expect('org' in noOrg).toBe(false);
  });

  it('declares the Epoch meta and group', () => {
    expect(epochEci).toMatchObject({
      id: 'epoch-eci',
      role: 'strength',
      group: 'epoch-eci',
      history: 'full',
      meta: {
        name: 'Epoch Capabilities Index',
        url: 'https://epoch.ai/data',
        license: 'CC BY 4.0',
        credit: 'Epoch AI, "Data on AI Benchmarking" / "Epoch Capabilities Index", CC BY 4.0',
      },
    });
  });

  it('skips rows without model, date or score and returns [] for an unusable payload', () => {
    const csv = [
      'Model,Display name,eci,eci_ci_low,eci_ci_high,date,Organization',
      'Good,Good,150,,,2026-01-01,Acme',
      ',,150,,,2026-01-01,Acme',
      'NoDate,NoDate,150,,,,Acme',
      'BadDate,BadDate,150,,,2026-02-30,Acme',
      'NoScore,NoScore,,,,2026-01-01,Acme',
      'NaNScore,NaNScore,NaN,,,2026-01-01,Acme',
    ].join('\n');
    expect(epochEci.parse(csv, { now: NOW }).map((o) => o.model)).toEqual(['Good']);
    expect(epochEci.parse(undefined, { now: NOW })).toEqual([]);
    expect(epochEci.parse({ not: 'csv' }, { now: NOW })).toEqual([]);
  });

  it('fetches the standalone CSV', async () => {
    const urls: string[] = [];
    const ctx = stubCtx({ fetchText: async (url) => (urls.push(url), fixture('epoch-eci')) });
    const raw = await epochEci.fetch(ctx);
    expect(urls).toEqual(['https://epoch.ai/data/eci_scores.csv']);
    expect(epochEci.parse(raw, { now: NOW })).toHaveLength(57);
  });
});

describe('epoch benchmark-hub modules', () => {
  it('Terminal-Bench: fraction → percent, unlinked rows skipped', () => {
    const obs = parse(epochTerminalBench, 'epoch-terminalbench');
    const top = obs.find((o) => o.model === 'gpt-5.5_unknown' && o.value > 80)!;
    expect(top).toMatchObject({
      series: 'epoch-terminalbench',
      kind: 'percent',
      model: 'gpt-5.5_unknown',
      org: 'OpenAI',
      date: '2026-04-23',
      dateKind: 'release',
    });
    expect(top.value).toBeCloseTo(84.7191011236, 9);
    // 46 fixture rows, 2 of them unlinked (blank Model version, no Name)
    expect(obs).toHaveLength(44);
    // several agents per model are all kept
    expect(byModel(obs, 'gpt-5.5_unknown').length).toBeGreaterThan(1);
    expect(epochTerminalBench.group).toBe('terminalbench');
  });

  it('SWE-bench Verified (Epoch run): fraction → percent', () => {
    const obs = parse(epochSwebench, 'epoch-swebench');
    expect(obs).toHaveLength(23);
    const [row] = byModel(obs, 'glm-5.2_max');
    expect(row).toMatchObject({ series: 'epoch-swebench', kind: 'percent', org: 'Z.ai (Zhipu AI)', date: '2026-06-16', dateKind: 'release' });
    expect(row.value).toBeCloseTo(78.7, 9);
    expect(epochSwebench.group).toBe('swebench');
  });

  it('METR: minutes as written, rows without a release date skipped', () => {
    const obs = parse(epochMetr, 'epoch-metr');
    expect(byModel(obs, 'claude-mythos-preview-early')).toEqual([
      {
        series: 'epoch-metr',
        kind: 'minutes',
        model: 'claude-mythos-preview-early',
        org: 'Anthropic',
        date: '2026-04-07',
        dateKind: 'release',
        value: 1044.780145,
      },
    ]);
    // davinci-002 has a score but an empty Release date
    expect(fixture('epoch-metr')).toMatch(/^davinci-002,0\.144057,0\.161869,,OpenAI/m);
    expect(byModel(obs, 'davinci-002')).toEqual([]);
    expect(obs).toHaveLength(26);
    expect(epochMetr.group).toBe('metr');
  });

  it('Vending-Bench 2: dollars → thousands of dollars on the eci scale, negatives kept', () => {
    const obs = parse(epochVending, 'epoch-vending');
    expect(obs).toHaveLength(32);
    const [row] = byModel(obs, 'claude-opus-5-5_unknown');
    expect(row).toMatchObject({ series: 'epoch-vending', kind: 'eci', org: 'Anthropic', date: '2026-09-22', dateKind: 'release' });
    expect(row.value).toBeCloseTo(9.235248333, 9);
    const [loss] = byModel(obs, 'gpt-5-mini-2025-08-07_unknown');
    expect(loss.value).toBeCloseTo(-0.031184, 9);
    expect(epochVending.group).toBe('vending');
  });

  it('APEX-Agents: Pass@1 fraction → percent', () => {
    const obs = parse(epochApex, 'epoch-apex');
    expect(obs).toHaveLength(35);
    const [row] = byModel(obs, 'gemini-4-argon_unknown');
    expect(row).toMatchObject({ series: 'epoch-apex', kind: 'percent', org: 'Google DeepMind', date: '2026-09-30', dateKind: 'release' });
    expect(row.value).toBeCloseTo(82.2, 9);
    expect(epochApex.group).toBe('apex');
  });

  it('OSWorld: scores are already percent; unlinked agents and the blank score are skipped', () => {
    const obs = parse(epochOsworld, 'epoch-osworld');
    expect(byModel(obs, 'claude-sonnet-4-6')).toEqual([
      { series: 'epoch-osworld', kind: 'percent', model: 'claude-sonnet-4-6', org: 'Anthropic', date: '2026-02-17', dateKind: 'release', value: 72.1 },
    ]);
    // 19 rows: 5 unlinked (no Model version and no Release date), plus kimi-k2.5 once with an empty Score
    expect(obs).toHaveLength(13);
    expect(obs.filter((o) => o.model === 'kimi-k2.5').map((o) => o.value)).toEqual([63.3]);
    expect(epochOsworld.group).toBe('osworld');
  });

  it('OSWorld 2.0: binary accuracy fraction → percent', () => {
    const obs = parse(epochOsworld2, 'epoch-osworld2');
    expect(obs).toHaveLength(16);
    const [row] = byModel(obs, 'claude-opus-5_max');
    expect(row).toMatchObject({ series: 'epoch-osworld2', kind: 'percent', org: 'Anthropic', date: '2026-07-24', dateKind: 'release' });
    expect(row.value).toBeCloseTo(31.43, 9);
    expect(epochOsworld2.group).toBe('osworld');
  });

  it('uses Name when Model version is blank, and skips a row whose score is not a number', () => {
    const mod = epochBenchmark({ id: 'epoch-x', file: 'x.csv', scoreCol: 'S', kind: 'percent', scale: 100, group: 'x', name: 'X' });
    const csv = ['Model version,S,Release date,Organization,Name', ',0.5,2026-01-02,Acme,Display Name', ' padded ,0.25,2026-01-03,,', 'm3,n/a,2026-01-04,Acme,'].join('\n');
    expect(mod.parse(csv, { now: NOW })).toEqual([
      { series: 'epoch-x', kind: 'percent', model: 'Display Name', org: 'Acme', date: '2026-01-02', dateKind: 'release', value: 50 },
      { series: 'epoch-x', kind: 'percent', model: 'padded', date: '2026-01-03', dateKind: 'release', value: 25 },
    ]);
  });

  it('every hub module declares CC BY 4.0 Epoch credit and a unique id', () => {
    const mods = [epochTerminalBench, epochSwebench, epochMetr, epochVending, epochApex, epochOsworld, epochOsworld2];
    expect(new Set(mods.map((m) => m.id)).size).toBe(mods.length);
    for (const m of mods) {
      expect(m.role).toBe('strength');
      expect(m.history).toBe('full');
      expect(m.meta.name).toMatch(/^Epoch AI Benchmarking Hub/);
      expect(m.meta.license).toBe('CC BY 4.0');
      expect(m.meta.credit).toBe('Epoch AI, "Data on AI Benchmarking" / "Epoch Capabilities Index", CC BY 4.0');
      expect(m.meta.url).toBe('https://epoch.ai/data');
    }
  });
});

describe('epoch benchmark zip download', () => {
  // The zip holds fixture CSVs for three modules plus one decoy whose name only ends the same way.
  const ZIP = zipSync({
    'README.md': strToU8('readme'),
    'terminalbench_external.csv': strToU8(fixture('epoch-terminalbench')),
    'metr_time_horizons_external.csv': strToU8(fixture('epoch-metr')),
    'osworld_2_external.csv': strToU8(fixture('epoch-osworld2')),
    'old/terminalbench_external.csv': strToU8('Model version,Accuracy mean,Release date\ndecoy,0.1,2020-01-01\n'),
    'epoch_capabilities_index/eci_scores.csv': strToU8(fixture('epoch-eci')),
  });

  it('extracts the module file from the zip, downloading the zip once for all modules', async () => {
    const urls: string[] = [];
    const ctx = stubCtx({ fetchBytes: async (url) => (urls.push(url), ZIP) });

    const tbRaw = await epochTerminalBench.fetch(ctx);
    const metrRaw = await epochMetr.fetch(ctx);
    const osRaw = await epochOsworld2.fetch(ctx);

    expect(urls).toEqual(['https://epoch.ai/data/benchmark_data.zip']);
    expect(tbRaw).toBe(fixture('epoch-terminalbench')); // root file, not the decoy under old/
    expect(epochTerminalBench.parse(tbRaw, { now: NOW })).toEqual(parse(epochTerminalBench, 'epoch-terminalbench'));
    expect(epochMetr.parse(metrRaw, { now: NOW })).toEqual(parse(epochMetr, 'epoch-metr'));
    expect(epochOsworld2.parse(osRaw, { now: NOW })).toEqual(parse(epochOsworld2, 'epoch-osworld2'));
  });

  it('fails clearly when the zip lacks the module file', async () => {
    const ctx = stubCtx({ fetchBytes: async () => ZIP });
    await expect(epochVending.fetch(ctx)).rejects.toThrow('vending_bench_2_external.csv not found');
  });

  it('does not mistake osworld_2 for the original OSWorld file', async () => {
    const ctx = stubCtx({ fetchBytes: async () => ZIP });
    await expect(epochOsworld.fetch(ctx)).rejects.toThrow('os_world_external.csv not found');
  });
});

function stubCtx(over: Partial<FetchCtx>): FetchCtx {
  return {
    env: {},
    now: NOW,
    backfill: false,
    keys: () => [],
    fetchText: async () => {
      throw new Error('unexpected fetchText');
    },
    fetchBytes: async () => {
      throw new Error('unexpected fetchBytes');
    },
    fetchJson: async () => {
      throw new Error('unexpected fetchJson');
    },
    log: () => {},
    ...over,
  };
}
