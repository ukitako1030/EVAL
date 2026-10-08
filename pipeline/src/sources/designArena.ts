import type { Observation } from '../core/types';
import { todayISO } from '../core/months';
import { isObject } from './lib/privacy';
import { toNumber } from './lib/values';
import type { FetchCtx, StrengthModule } from './types';

/**
 * Design Arena (Arcada Labs) through its documented, keyed public API only:
 *   GET https://www.designarena.ai/api/v1/leaderboard/models/{category}   Authorization: Bearer <key>
 * The website's own `/api/...` routes are disallowed by robots.txt and the terms of service and are never called here.
 * Apply for a free key at https://designarena.ai/developers/apply and export it as DESIGNARENA_API_KEY.
 */
export const DESIGN_ARENA_CATEGORIES = ['image', 'video', 'tts', 'music'] as const;
export type DesignArenaCategory = (typeof DESIGN_ARENA_CATEGORIES)[number];

const API_BASE = 'https://www.designarena.ai/api/v1/leaderboard/models';
const ENV_KEY = 'DESIGNARENA_API_KEY';

/**
 * Pure parser for a `LeaderboardResponse` (object or JSON text): `data[].displayName` / `data[].elo`, stamped with the fetch day
 * (the API has no history; `meta.lastUpdated` is only the last recalculation). An empty board, an error envelope or anything
 * else unusable gives `[]`, which `runFetch` records as a failed fetch.
 */
export function parseDesignArena(raw: unknown, category: DesignArenaCategory, now: Date): Observation[] {
  let body = raw;
  if (typeof raw === 'string') {
    try {
      body = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!isObject(body) || body['success'] === false || !Array.isArray(body['data'])) return [];
  const date = todayISO(now);
  const out: Observation[] = [];
  for (const row of body['data'] as unknown[]) {
    if (!isObject(row)) continue;
    const model = typeof row['displayName'] === 'string' ? row['displayName'].trim() : '';
    const value = toNumber(row['elo']);
    if (!model || value === null) continue;
    out.push({ series: `designarena-${category}`, kind: 'elo', model, date, dateKind: 'snapshot', value });
  }
  return out;
}

export function designArena(category: DesignArenaCategory): StrengthModule {
  const id = `designarena-${category}`;
  return {
    id,
    role: 'strength',
    group: id,
    history: 'accumulate',
    needsEnv: [ENV_KEY],
    meta: {
      name: `Design Arena (${category})`,
      url: 'https://designarena.ai',
      license: 'Free to use with attribution (Design Arena API terms)',
      credit: 'Design Arena (designarena.ai), https://designarena.ai',
    },
    async fetch(ctx: FetchCtx) {
      const key = ctx.env[ENV_KEY];
      if (!key) throw new Error(`${ENV_KEY} is not set`);
      return ctx.fetchJson<unknown>(`${API_BASE}/${category}`, { headers: { Authorization: `Bearer ${key}` } });
    },
    parse: (raw, ctx) => parseDesignArena(raw, category, ctx.now),
  };
}

export const designArenaImage = designArena('image');
export const designArenaVideo = designArena('video');
export const designArenaTts = designArena('tts');
export const designArenaMusic = designArena('music');
