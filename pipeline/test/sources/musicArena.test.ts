import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { musicArena, parseMusicArena, parseTsv } from '../../src/sources/musicArena';
import type { FetchCtx } from '../../src/sources/types';

const read = (f: string) => readFileSync(new URL(`../fixtures/music-arena/${f}`, import.meta.url), 'utf8');
const earlyVocal = read('official-vocal_leaderboard_20250728_to_20250831.tsv');
const lateVocal = read('official-vocal_leaderboard_20250728_to_20260731.tsv');
const lateInstrumental = read('official-instrumental_leaderboard_20250728_to_20260731.tsv');
const now = new Date('2026-10-12T06:00:00Z');

describe('music-arena parse', () => {
  it('parses the early format (system keys, "+x / -y" CIs, extra license column, one-decimal scores)', () => {
    const obs = parseMusicArena([{ date: '2025-08-31', board: 'vocal', text: earlyVocal }]);
    expect(obs).toHaveLength(5);
    expect(obs[0]).toEqual({ series: 'music-arena@vocal', kind: 'elo', model: 'riffusion-fuzz-1-0', date: '2025-08-31', dateKind: 'snapshot', value: 1172.5 });
    expect(obs[1]).toMatchObject({ model: 'riffusion-fuzz-1-1', value: 1087.3 });
    expect(obs[4]).toMatchObject({ model: 'acestep', value: 660.1 });
  });

  it('parses the late format (display names, "±x" CIs, integer scores)', () => {
    const vocal = parseMusicArena([{ date: '2026-07-31', board: 'vocal', text: lateVocal }]);
    expect(vocal).toHaveLength(9);
    expect(vocal[0]).toEqual({ series: 'music-arena@vocal', kind: 'elo', model: 'Riffusion FUZZ v1.0', date: '2026-07-31', dateKind: 'snapshot', value: 1132 });
    expect(vocal.find((o) => o.model === 'Lyria 3 Pro')?.value).toBe(1107);

    const inst = parseMusicArena([{ date: '2026-07-31', board: 'instrumental', text: lateInstrumental }]);
    expect(inst).toHaveLength(15);
    expect(inst[0]).toMatchObject({ series: 'music-arena@instrumental', model: 'Lyria 3 Pro', value: 1394, date: '2026-07-31' });
    expect(inst.find((o) => o.model === 'Stable Audio 3 (Medium)')?.value).toBe(1333);
    expect(inst.find((o) => o.model === 'MusicGen Small')?.value).toBe(794);
  });

  it('combines several files and tolerates YYYYMMDD folder dates', () => {
    const obs = parseMusicArena([
      { date: '20250831', board: 'vocal', text: earlyVocal },
      { date: '2026-07-31', board: 'vocal', text: lateVocal },
      { date: '2026-07-31', board: 'instrumental', text: lateInstrumental },
    ]);
    expect(obs).toHaveLength(5 + 9 + 15);
    expect(new Set(obs.map((o) => o.series))).toEqual(new Set(['music-arena@vocal', 'music-arena@instrumental']));
    expect(obs[0].date).toBe('2025-08-31');
  });

  it('skips unusable rows and files but never throws', () => {
    const text = 'Rank\tModel\tArena Score\n1\tA\t1000\n2\t\t900\n3\tB\tn/a\n4\tC\t850.5\r\n5\n';
    expect(parseMusicArena([{ date: '2026-01-31', board: 'vocal', text }]).map((o) => [o.model, o.value])).toEqual([
      ['A', 1000],
      ['C', 850.5],
    ]);
    expect(parseMusicArena([null, { date: 'bad', board: 'vocal', text }, { date: '2026-01-31', board: 'jazz', text }, { date: '2026-01-31', board: 'vocal' }])).toEqual([]);
    expect(parseMusicArena([{ date: '2026-01-31', board: 'vocal', text: 'no header only' }])).toEqual([]);
    expect(parseMusicArena('x')).toEqual([]);
    expect(parseMusicArena([])).toEqual([]);
  });

  it('parseTsv handles a BOM and ragged rows', () => {
    expect(parseTsv('﻿a\tb\n1\t2\n3\n')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '' },
    ]);
  });
});

describe('music-arena fetch', () => {
  const API = 'https://api.github.com/repos/gclef-cmu/music-arena/contents/components/frontend/ma_frontend/leaderboard';
  const RAW = 'https://raw.githubusercontent.com/gclef-cmu/music-arena/main/components/frontend/ma_frontend/leaderboard';
  const dir = (name: string) => ({ name, type: 'dir' });
  const file = (name: string) => ({ name, type: 'file' });

  const listings: Record<string, unknown> = {
    [API]: [dir('20250831'), dir('20260731'), { name: 'README.md', type: 'file' }, dir('assets')],
    [`${API}/20250831`]: [file('instrumental_leaderboard_20250728_to_20250831.tsv'), file('vocal_leaderboard_20250728_to_20250831.tsv')],
    [`${API}/20260731`]: [file('vocal_leaderboard_20250728_to_20260731.tsv'), file('instrumental_leaderboard_20250728_to_20260731.tsv'), file('notes.txt')],
  };
  const texts: Record<string, string> = {
    [`${RAW}/20250831/instrumental_leaderboard_20250728_to_20250831.tsv`]: 'Rank\tModel\tArena Score\n1\tsao\t1100.2\n',
    [`${RAW}/20250831/vocal_leaderboard_20250728_to_20250831.tsv`]: earlyVocal,
    [`${RAW}/20260731/vocal_leaderboard_20250728_to_20260731.tsv`]: lateVocal,
    [`${RAW}/20260731/instrumental_leaderboard_20250728_to_20260731.tsv`]: lateInstrumental,
  };
  const ctx = (calls: string[], overrides: Record<string, string | Error> = {}) =>
    ({
      log: () => {},
      fetchJson: async (url: string) => {
        calls.push(url);
        if (!(url in listings)) throw new Error(`HTTP 404 for ${url}`);
        return listings[url];
      },
      fetchText: async (url: string) => {
        calls.push(url);
        const o = overrides[url];
        if (o instanceof Error) throw o;
        if (typeof o === 'string') return o;
        if (!(url in texts)) throw new Error(`HTTP 404 for ${url}`);
        return texts[url];
      },
    }) as unknown as FetchCtx;

  it('lists the snapshot folders and downloads both boards of each', async () => {
    const calls: string[] = [];
    const raw = (await musicArena.fetch(ctx(calls))) as { date: string; board: string; text: string }[];
    expect(raw.map((r) => [r.date, r.board])).toEqual([
      ['2025-08-31', 'vocal'],
      ['2025-08-31', 'instrumental'],
      ['2026-07-31', 'vocal'],
      ['2026-07-31', 'instrumental'],
    ]);
    expect(raw[0].text).toBe(earlyVocal);
    expect(calls.filter((u) => u.startsWith(API))).toEqual([API, `${API}/20250831`, `${API}/20260731`]);
    expect(calls.filter((u) => u.startsWith(RAW))).toHaveLength(4);
    expect(JSON.parse(JSON.stringify(raw))).toEqual(raw);
    expect(musicArena.parse(raw, { now })).toHaveLength(5 + 1 + 9 + 15);
  });

  it('fails (instead of returning a partial history) when a download fails or nothing is found', async () => {
    const bad = `${RAW}/20260731/vocal_leaderboard_20250728_to_20260731.tsv`;
    await expect(musicArena.fetch(ctx([], { [bad]: new Error('HTTP 503') }))).rejects.toThrow(/HTTP 503/);
    const empty = { log: () => {}, fetchJson: async () => [{ name: 'README.md', type: 'file' }], fetchText: async () => '' } as unknown as FetchCtx;
    await expect(musicArena.fetch(empty)).rejects.toThrow(/no YYYYMMDD/);
  });

  it('declares the module contract', () => {
    expect(musicArena).toMatchObject({ id: 'music-arena', role: 'strength', group: 'music-arena', history: 'full' });
    expect(musicArena.meta.license).toBe('CC BY 4.0');
  });
});
