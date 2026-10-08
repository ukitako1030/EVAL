import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DESIGN_ARENA_CATEGORIES,
  designArena,
  designArenaImage,
  designArenaMusic,
  designArenaTts,
  designArenaVideo,
  parseDesignArena,
} from '../../src/sources/designArena';
import { runFetch } from '../../src/sources/run';
import { loadSource } from '../../src/raw/store';
import type { FetchCtx } from '../../src/sources/types';

const text = readFileSync(new URL('../fixtures/designarena/docs-example.json', import.meta.url), 'utf8');
const example = JSON.parse(text);
const now = new Date('2026-10-12T06:00:00Z');

/** A context whose fetchJson records every call; no real network. */
function ctxWith(env: Record<string, string | undefined>, respond: (url: string) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const ctx: FetchCtx = {
    env,
    now,
    backfill: false,
    keys: () => [],
    fetchText: async () => '',
    fetchBytes: async () => new Uint8Array(),
    fetchJson: async <T>(url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return respond(url) as T;
    },
    log: () => {},
  };
  return { ctx, calls };
}

describe('designarena parse (docs example)', () => {
  it('maps displayName / elo to elo snapshot observations stamped with the fetch day', () => {
    expect(parseDesignArena(example, 'image', now)).toEqual([
      { series: 'designarena-image', kind: 'elo', model: 'Claude Opus 4.6', date: '2026-10-12', dateKind: 'snapshot', value: 1390 },
      { series: 'designarena-image', kind: 'elo', model: 'GPT-5.1 Codex', date: '2026-10-12', dateKind: 'snapshot', value: 1298 },
      { series: 'designarena-image', kind: 'elo', model: 'v0-1.5-lg', date: '2026-10-12', dateKind: 'snapshot', value: 1280 },
    ]);
  });

  it('names the series after the category and accepts JSON text', () => {
    expect(parseDesignArena(text, 'tts', now).map((o) => o.series)).toEqual(Array(3).fill('designarena-tts'));
  });

  it('gives [] for an empty board (music today), an error envelope or garbage', () => {
    expect(parseDesignArena({ success: true, data: [], meta: { arena: 'models', category: 'music', lastUpdated: null } }, 'music', now)).toEqual([]);
    expect(parseDesignArena({ success: false, error: { code: 'INVALID_CATEGORY', message: 'x' } }, 'music', now)).toEqual([]);
    expect(parseDesignArena({}, 'music', now)).toEqual([]);
    expect(parseDesignArena('<html>', 'music', now)).toEqual([]);
    expect(parseDesignArena(null, 'music', now)).toEqual([]);
  });

  it('skips a bad row without dropping the others', () => {
    const bad = { success: true, data: [null, { displayName: 'A' }, { elo: 1200 }, { displayName: 'B', elo: 'n/a' }, { displayName: ' C ', elo: 1210 }] };
    expect(parseDesignArena(bad, 'video', now).map((o) => [o.model, o.value])).toEqual([['C', 1210]]);
  });
});

describe('designarena modules', () => {
  const all = [designArenaImage, designArenaVideo, designArenaTts, designArenaMusic];

  it('declares one keyed, accumulating strength module per category', () => {
    expect(DESIGN_ARENA_CATEGORIES).toEqual(['image', 'video', 'tts', 'music']);
    expect(all.map((m) => m.id)).toEqual(['designarena-image', 'designarena-video', 'designarena-tts', 'designarena-music']);
    for (const m of all) {
      expect(m).toMatchObject({ role: 'strength', group: m.id, history: 'accumulate', needsEnv: ['DESIGNARENA_API_KEY'] });
      expect(m.meta.credit).toContain('Design Arena (designarena.ai)');
      expect(m.meta.credit).toContain('https://designarena.ai'); // visible link required by their terms
    }
  });

  it('fetches only the documented keyed API endpoint with a Bearer header', async () => {
    for (const cat of DESIGN_ARENA_CATEGORIES) {
      const { ctx, calls } = ctxWith({ DESIGNARENA_API_KEY: 'test-key-123' }, () => example);
      const raw = await designArena(cat).fetch(ctx);
      expect(raw).toEqual(example);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`https://www.designarena.ai/api/v1/leaderboard/models/${cat}`);
      expect(calls[0].url).not.toMatch(/designarena\.ai\/api\/(?!v1\/)/); // never the website's internal routes
      expect(calls[0].init?.headers).toEqual({ Authorization: 'Bearer test-key-123' });
    }
  });

  it('refuses to fetch without a key (and does not touch the network)', async () => {
    const { ctx, calls } = ctxWith({}, () => example);
    await expect(designArenaImage.fetch(ctx)).rejects.toThrow(/DESIGNARENA_API_KEY/);
    expect(calls).toHaveLength(0);
  });
});

describe('designarena through runFetch', () => {
  it('is skipped (no request made) when DESIGNARENA_API_KEY is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raw-'));
    const { ctx, calls } = ctxWith({}, () => example);
    const status = await runFetch([designArenaImage, designArenaVideo, designArenaTts, designArenaMusic], ctx, dir);
    expect(status.map((s) => [s.id, s.status])).toEqual([
      ['designarena-image', 'skipped'],
      ['designarena-video', 'skipped'],
      ['designarena-tts', 'skipped'],
      ['designarena-music', 'skipped'],
    ]);
    expect(status[0].error).toContain('DESIGNARENA_API_KEY');
    expect(calls).toHaveLength(0);
  });

  it('saves a snapshot with a key, and records an empty board as failed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raw-'));
    const empty = { success: true, data: [], meta: { arena: 'models', category: 'music', lastUpdated: null }, timestamp: '2026-10-12T06:00:00.000Z' };
    const { ctx, calls } = ctxWith({ DESIGNARENA_API_KEY: 'test-key-123' }, (url) => (url.endsWith('/music') ? empty : example));
    const status = await runFetch([designArenaImage, designArenaMusic], ctx, dir);
    expect(status.map((s) => [s.id, s.status, s.count])).toEqual([
      ['designarena-image', 'ok', 3],
      ['designarena-music', 'failed', 0],
    ]);
    expect(status[1].error).toContain('0 items');
    expect(calls.map((c) => c.url)).toEqual([
      'https://www.designarena.ai/api/v1/leaderboard/models/image',
      'https://www.designarena.ai/api/v1/leaderboard/models/music',
    ]);
    expect(loadSource<{ model: string; value: number }>(dir, 'designarena-image', 'accumulate').map((o) => [o.model, o.value])).toEqual([
      ['Claude Opus 4.6', 1390],
      ['GPT-5.1 Codex', 1298],
      ['v0-1.5-lg', 1280],
    ]);
  });
});
