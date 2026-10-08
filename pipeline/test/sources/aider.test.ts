import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { aiderEdit, aiderPolyglot } from '../../src/sources/aider';
import type { FetchCtx } from '../../src/sources/types';
import type { Observation } from '../../src/core/types';

const yml = (id: string) => readFileSync(new URL(`../fixtures/${id}/sample.yml`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-12T06:00:00Z');
const byModel = (obs: Observation[], model: string) => obs.filter((o) => o.model === model);

describe('aiderEdit', () => {
  const obs = aiderEdit.parse(yml('aider-edit'), { now: NOW });

  it('maps model, pass_rate_2 and the model release date', () => {
    expect(obs).toHaveLength(27);
    expect(byModel(obs, 'claude-3-5-sonnet-20241022')).toEqual([
      { series: 'aider-edit', kind: 'percent', model: 'claude-3-5-sonnet-20241022', date: '2024-10-22', dateKind: 'release', value: 84.2 },
    ]);
  });

  it('prefers `released`, then `_released`, then the run date', () => {
    // gpt-3.5-turbo-0301: released 2023-03-01, run 2023-11-06
    expect(byModel(obs, 'gpt-3.5-turbo-0301')[0]).toMatchObject({ date: '2023-03-01', value: 57.9 });
    // claude-3-opus-20240229: only `_released: 2024-02-29`, run 2024-05-01
    expect(byModel(obs, 'claude-3-opus-20240229')[0]).toMatchObject({ date: '2024-02-29', value: 68.4 });
    // the granite3 entry has neither, so its run date is used
    expect(byModel(obs, 'ollama/granite3-dense:8b')).toEqual([
      { series: 'aider-edit', kind: 'percent', model: 'ollama/granite3-dense:8b', date: '2024-11-28', dateKind: 'release', value: 20.3 },
    ]);
  });

  it('parses a CRLF file to the same observations as the LF one', () => {
    const lf = yml('aider-edit');
    expect(lf).not.toContain('\r'); // .gitattributes (eol=lf) stores the originally-CRLF granite3 entry with LF
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(crlf).toContain('model: ollama/granite3-dense:8b\r\n');
    const parsed = aiderEdit.parse(crlf, { now: NOW });
    expect(parsed).toEqual(obs);
    expect(byModel(parsed, 'ollama/granite3-dense:8b')).toHaveLength(1); // no stray \r in the model name
    // a file that mixes both, as upstream does
    const mixed = lf.replace(/(- dirname: 2024-11-28-14-41-46[^]*?)\n\n/, (m) => m.replace(/\n/g, '\r\n'));
    expect(mixed).toContain('\r\n');
    expect(aiderEdit.parse(mixed, { now: NOW })).toEqual(obs);
  });

  it('keeps commit hashes that YAML reads as numbers from disturbing the parse', () => {
    expect(yml('aider-edit')).toMatch(/commit_hash: \d+\n/);
    expect(obs.every((o) => Number.isFinite(o.value))).toBe(true);
  });

  it('declares the Aider meta, group and priority', () => {
    expect(aiderEdit).toMatchObject({
      id: 'aider-edit',
      role: 'strength',
      group: 'aider',
      priority: 1,
      history: 'full',
      meta: { license: 'Apache-2.0' },
    });
  });

  it('fetches the YAML from the Aider repo', async () => {
    const urls: string[] = [];
    const ctx = { fetchText: async (url: string) => (urls.push(url), yml('aider-edit')) } as unknown as FetchCtx;
    const raw = await aiderEdit.fetch(ctx);
    expect(urls).toEqual(['https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/edit_leaderboard.yml']);
    expect(aiderEdit.parse(raw, { now: NOW })).toEqual(obs);
  });
});

describe('aiderPolyglot', () => {
  const obs = aiderPolyglot.parse(yml('aider-polyglot'), { now: NOW });

  it('maps model, pass_rate_2 and the run date (the file has no release dates)', () => {
    expect(obs).toHaveLength(26);
    expect(byModel(obs, 'gpt-5 (high)')).toEqual([
      { series: 'aider-polyglot', kind: 'percent', model: 'gpt-5 (high)', date: '2025-08-23', dateKind: 'release', value: 88 },
    ]);
    expect(byModel(obs, 'o1-2024-12-17 (high)')).toEqual([
      { series: 'aider-polyglot', kind: 'percent', model: 'o1-2024-12-17 (high)', date: '2024-12-21', dateKind: 'release', value: 61.7 },
    ]);
  });

  it('keeps architect combos as written', () => {
    expect(byModel(obs, 'DeepSeek R1 + claude-3-5-sonnet-20241022')).toHaveLength(1);
  });

  it('declares the Aider meta, group and priority', () => {
    expect(aiderPolyglot).toMatchObject({
      id: 'aider-polyglot',
      role: 'strength',
      group: 'aider',
      priority: 2,
      history: 'full',
      meta: { license: 'Apache-2.0' },
    });
  });

  it('fetches the YAML from the Aider repo', async () => {
    const urls: string[] = [];
    const ctx = { fetchText: async (url: string) => (urls.push(url), yml('aider-polyglot')) } as unknown as FetchCtx;
    await aiderPolyglot.fetch(ctx);
    expect(urls).toEqual(['https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml']);
  });
});

describe('aider parsing robustness', () => {
  it('skips entries without model, score or date, and returns [] for unusable payloads', () => {
    const doc = [
      '- model: ok',
      '  pass_rate_2: 50.5',
      '  date: 2025-01-02',
      '- model: no-score',
      '  date: 2025-01-02',
      '- date: 2025-01-02',
      '  pass_rate_2: 10',
      '- model: no-date',
      '  pass_rate_2: 10',
      '- model: bad-date',
      '  pass_rate_2: 10',
      '  date: someday',
      '- just a string',
      '- model: released-wins',
      '  pass_rate_2: "12.5"',
      '  released: 2024-12-31',
      '  date: 2025-02-01',
    ].join('\n');
    expect(aiderPolyglot.parse(doc, { now: NOW })).toEqual([
      { series: 'aider-polyglot', kind: 'percent', model: 'ok', date: '2025-01-02', dateKind: 'release', value: 50.5 },
      { series: 'aider-polyglot', kind: 'percent', model: 'released-wins', date: '2024-12-31', dateKind: 'release', value: 12.5 },
    ]);
    expect(aiderPolyglot.parse('model: not a list', { now: NOW })).toEqual([]);
    expect(aiderPolyglot.parse('- [unclosed', { now: NOW })).toEqual([]);
    expect(aiderPolyglot.parse(undefined, { now: NOW })).toEqual([]);
  });
});
