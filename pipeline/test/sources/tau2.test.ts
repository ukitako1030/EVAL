import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { parseTau2, stripPersonalData, tau2 } from '../../src/sources/tau2';
import type { FetchCtx } from '../../src/sources/types';

type Json = Record<string, unknown>;
const dir = new URL('../fixtures/tau2/', import.meta.url);
const load = (name: string) => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as Json;
const sample = (JSON.parse(readFileSync(new URL('sample.json', dir), 'utf8')) as { path: string; submission: Json }[]).map((e) => e.submission);
const byName = (name: string) => sample.find((s) => s['model_name'] === name)!;

describe('tau2 fixtures', () => {
  it('contain no e-mail addresses', () => {
    const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toMatch(email);
  });
});

describe('tau2 parse', () => {
  it('one standard submission with four domains → four observations with exact values', () => {
    const obs = parseTau2([load('submission-gpt-5-2_sierra_2026-02-26.json')]);
    const base = { kind: 'percent', model: 'GPT-5.2', org: 'OpenAI', date: '2025-12-11', dateKind: 'release' } as const;
    expect(obs).toEqual([
      { ...base, series: 'tau2@airline', value: 83 },
      { ...base, series: 'tau2@retail', value: 81.58 },
      { ...base, series: 'tau2@telecom', value: 89.69 },
      { ...base, series: 'tau2@banking_knowledge', value: 32.22 },
    ]);
  });

  it('banking-only submission (null domains) → one observation, release date from model_release', () => {
    expect(parseTau2([load('submission-claude-opus-5_sierra_2026-08-04.json')])).toEqual([
      {
        series: 'tau2@banking_knowledge',
        kind: 'percent',
        model: 'Claude Opus 5',
        org: 'Anthropic',
        date: '2026-07-24',
        dateKind: 'release',
        value: 48.71134020618557,
      },
    ]);
  });

  it('skips custom submissions', () => {
    expect(load('submission-distyl-buttonagent_distyl_2026-03-25.json')['submission_type']).toBe('custom');
    expect(parseTau2([load('submission-distyl-buttonagent_distyl_2026-03-25.json')])).toEqual([]);
    const obs = parseTau2(sample);
    const names = new Set(obs.map((o) => o.model));
    expect(names.has('Distyl ButtonAgent')).toBe(false);
    expect(names.has('Nemotron-Orchestrator-8B')).toBe(false); // custom legacy
  });

  it('treats a missing submission_type as standard (legacy rows)', () => {
    const gemini = byName('Gemini 3.0 Pro');
    expect(gemini['submission_type']).toBeUndefined();
    const obs = parseTau2([gemini]);
    expect(obs.map((o) => [o.series, o.value]).sort()).toEqual([
      ['tau2@airline', 73],
      ['tau2@retail', 85.3],
      ['tau2@telecom', 98],
    ]);
    expect(obs.every((o) => o.model === 'Gemini 3.0 Pro' && o.org === 'Google' && o.date === '2025-11-18')).toBe(true);
  });

  it('uses model_release.release_date over submission_date (and falls back to submission_date)', () => {
    // submission_date is the typo 2024-09-23, the release date is 2025-09-23
    expect(parseTau2([byName('Qwen3-Max')]).every((o) => o.date === '2025-09-23')).toBe(true);
    const noRelease = { ...load('submission-gpt-5-2_sierra_2026-02-26.json'), model_release: undefined };
    expect(parseTau2([noRelease]).every((o) => o.date === '2026-02-26')).toBe(true);
  });

  it('skips voice-modality rows and never throws on a bad entry', () => {
    const voice = { ...load('submission-gpt-5-2_sierra_2026-02-26.json'), modality: 'voice' };
    const noScore = { ...load('submission-gpt-5-2_sierra_2026-02-26.json'), results: { retail: { pass_1: null }, airline: { pass_1: 'n/a' }, telecom: 'x' } };
    expect(parseTau2([voice, noScore, null, 'x', 42, {}, { model_name: 'M', submission_date: 'garbage', results: { retail: { pass_1: 1 } } }])).toEqual([]);
  });

  it('whole sample: only standard text rows, four known series', () => {
    const obs = parseTau2(sample);
    expect(new Set(obs.map((o) => o.series))).toEqual(new Set(['tau2@airline', 'tau2@retail', 'tau2@telecom', 'tau2@banking_knowledge']));
    // 12 sample submissions: 2 custom + 2 custom voice are skipped → 8 parsed
    expect(new Set(obs.map((o) => o.model))).toEqual(
      new Set(['GPT-5.2', 'Claude Opus 5', 'Gemini 3.0 Pro', 'Grok 4.5', 'DeepSeek-V3.2', 'Qwen3.5-397B-A17B', 'Qwen3-Max', 'Muse Spark 1.1']),
    );
    expect(obs.find((o) => o.model === 'Grok 4.5')).toMatchObject({ series: 'tau2@banking_knowledge', org: 'xAI', date: '2026-07-16', value: 47.93814432989691 });
  });

  it('returns [] for an unusable payload', () => {
    expect(parseTau2(undefined)).toEqual([]);
    expect(parseTau2({})).toEqual([]);
    expect(parseTau2([])).toEqual([]);
  });
});

describe('tau2 fetch', () => {
  const BASE = 'https://sierra-tau-bench-public.s3.us-west-2.amazonaws.com/submissions';
  const withEmail = (name: string) => ({
    ...load('submission-claude-opus-5_sierra_2026-08-04.json'),
    model_name: name,
    contact_info: { email: 'person@example.com', name: 'P. Erson', github: 'perso' },
    methodology: { notes: 'questions to other.person@example.org please' },
  });

  it('reads submissions + legacy_submissions (never voice_submissions) and strips personal data', async () => {
    const calls: string[] = [];
    const files: Record<string, unknown> = {
      [`${BASE}/manifest.json`]: { submissions: ['a_x_2026', 'b.y_z_2026'], voice_submissions: ['v_voice_2026'], legacy_submissions: ['c_legacy_2025', 'a_x_2026'] },
      [`${BASE}/a_x_2026/submission.json`]: withEmail('A'),
      [`${BASE}/b.y_z_2026/submission.json`]: withEmail('B'),
      [`${BASE}/c_legacy_2025/submission.json`]: withEmail('C'),
      [`${BASE}/v_voice_2026/submission.json`]: withEmail('VOICE'),
    };
    const ctx = {
      log: () => {},
      fetchJson: async (url: string) => {
        calls.push(url);
        if (!(url in files)) throw new Error(`HTTP 404 for ${url}`);
        return structuredClone(files[url]);
      },
    } as unknown as FetchCtx;

    const raw = (await tau2.fetch(ctx)) as Json[];
    expect(calls).toHaveLength(4); // manifest + 3 distinct dirs
    expect(calls.some((u) => u.includes('v_voice_2026'))).toBe(false);
    expect(raw.map((s) => s['model_name'])).toEqual(['A', 'B', 'C']);
    for (const s of raw) {
      expect(s).not.toHaveProperty('contact_info');
      expect(JSON.stringify(s)).not.toMatch(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    }
    expect((raw[0]['methodology'] as Json)['notes']).toBe('questions to <redacted> please');
    expect(tau2.parse(raw, { now: new Date('2026-10-08T00:00:00Z') })).toHaveLength(3);
  });

  it('fails the whole fetch when any submission cannot be downloaded (a partial snapshot would replace the full history)', async () => {
    const manifest = { submissions: ['ok_1', 'gone_2', 'ok_3'] };
    const ctx = {
      log: () => {},
      fetchJson: async (url: string) => {
        if (url.endsWith('manifest.json')) return manifest;
        if (url.includes('gone_2')) throw new Error('HTTP 404');
        return withEmail('OK');
      },
    } as unknown as FetchCtx;
    await expect(tau2.fetch(ctx)).rejects.toThrow(/tau2: gone_2: HTTP 404/);
    await expect(tau2.fetch({ log: () => {}, fetchJson: async () => ({ voice_submissions: ['v'] }) } as unknown as FetchCtx)).rejects.toThrow(
      /no submissions/,
    );
  });

  it('stripPersonalData drops contact_info and scrubs stray addresses', () => {
    const out = stripPersonalData({ contact_info: { email: 'a@b.co' }, references: [{ title: 'mail me at a@b.co', url: 'https://x.y' }], keep: 1 });
    expect(out).toEqual({ references: [{ title: 'mail me at <redacted>', url: 'https://x.y' }], keep: 1 });
  });

  it('declares the module contract', () => {
    expect(tau2).toMatchObject({ id: 'tau2', role: 'strength', group: 'tau2', history: 'full' });
    expect(tau2.meta.license).toBe('MIT');
  });
});
