import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTtsArena, ttsArena } from '../../src/sources/ttsArena';
import type { FetchCtx } from '../../src/sources/types';

const read = (f: string) => readFileSync(new URL(`../fixtures/tts-arena/${f}`, import.meta.url), 'utf8');
const sample = JSON.parse(read('sample.json')) as { rows: { id: string; name: string; elo: number; suspended: boolean }[] };
const now = new Date('2026-10-12T06:00:00Z');

describe('tts-arena parse', () => {
  const obs = parseTtsArena(sample, now);

  it('emits one elo snapshot observation per non-suspended row, stamped with the fetch day', () => {
    expect(sample.rows).toHaveLength(39);
    expect(obs).toHaveLength(38);
    expect(obs.every((o) => o.series === 'tts-arena' && o.kind === 'elo' && o.dateKind === 'snapshot' && o.date === '2026-10-12')).toBe(true);
  });

  it('maps concrete rows exactly', () => {
    expect(obs[0]).toEqual({ series: 'tts-arena', kind: 'elo', model: 'async-1', date: '2026-10-12', dateKind: 'snapshot', value: 1561 });
    expect(obs.find((o) => o.model === 'inworld-max')?.value).toBe(1558);
    expect(obs.find((o) => o.model === 'luck-dolphin')?.value).toBe(1566); // "Aurora"; elo is not monotonic in rank (ranked by CI lower bound)
    expect(obs.find((o) => o.model === 'star-june-2026')?.value).toBe(1540); // stealth row without url
  });

  it('keys models by the stable id, not the display name (names drift between app versions)', () => {
    const ids = new Set(sample.rows.filter((r) => !r.suspended).map((r) => r.id));
    expect(new Set(obs.map((o) => o.model))).toEqual(ids);
    expect(obs.some((o) => o.model === 'Aurora' || o.model === 'CastleFlow v1.0')).toBe(false);
    expect(parseTtsArena({ rows: [{ id: 'minimax-speech-02-hd', name: 'MiniMax Speech-02-HD', elo: 1500 }, { id: 'minimax-speech-02-hd', name: 'MiniMax Speech 02 HD', elo: 1501 }] }, now).map((o) => o.model)).toEqual([
      'minimax-speech-02-hd',
      'minimax-speech-02-hd',
    ]);
  });

  it('falls back to the display name when the id is missing, empty or not a string', () => {
    const rows = [
      { name: ' No Id ', elo: 1 },
      { id: '', name: 'Empty Id', elo: 2 },
      { id: '  ', name: 'Blank Id', elo: 3 },
      { id: 7, name: 'Numeric Id', elo: 4 },
      { id: ' trimmed-id ', name: 'Has Id', elo: 5 },
      { id: '', name: '', elo: 6 },
    ];
    expect(parseTtsArena({ rows }, now).map((o) => o.model)).toEqual(['No Id', 'Empty Id', 'Blank Id', 'Numeric Id', 'trimmed-id']);
  });

  it('leaves out the suspended (vote manipulation) row but keeps retired ones', () => {
    expect(sample.rows.find((r) => r.suspended)?.id).toBe('vocu');
    expect(obs.some((o) => o.model === 'vocu')).toBe(false);
    expect(obs.some((o) => o.model === 'async-1')).toBe(true); // active: false
  });

  it('uses the date of the given clock and accepts JSON text', () => {
    expect(parseTtsArena(read('sample.json'), new Date('2026-11-03T23:59:00Z'))[0].date).toBe('2026-11-03');
    expect(parseTtsArena(read('sample-preliminary.json'), now)).toHaveLength(44); // 46 rows, 2 suspended
  });

  it('skips bad rows and returns [] for an unusable payload', () => {
    expect(parseTtsArena({ rows: [null, 'x', { name: 'A' }, { elo: 1500 }, { id: 'b', name: 'B', elo: 'n/a' }, { name: 'C', elo: 1400 }] }, now).map((o) => o.model)).toEqual(['C']);
    expect(parseTtsArena({ rows: [] }, now)).toEqual([]);
    expect(parseTtsArena({}, now)).toEqual([]);
    expect(parseTtsArena('<html>', now)).toEqual([]);
    expect(parseTtsArena(null, now)).toEqual([]);
  });
});

describe('tts-arena module', () => {
  it('fetches /api/leaderboard and parses with ctx.now', async () => {
    const seen: string[] = [];
    const ctx = {
      fetchJson: async (url: string) => {
        seen.push(url);
        return sample;
      },
    } as unknown as FetchCtx;
    const raw = await ttsArena.fetch(ctx);
    expect(seen).toEqual(['https://tts-agi-tts-arena-v2.hf.space/api/leaderboard']);
    expect(ttsArena.parse(raw, { now })).toHaveLength(38);
  });

  it('declares the module contract', () => {
    expect(ttsArena).toMatchObject({ id: 'tts-arena', role: 'strength', group: 'tts-arena', history: 'accumulate' });
  });
});
