import type { Observation } from '../core/types';
import { todayISO } from '../core/months';
import { toNumber } from './lib/values';
import type { FetchCtx, StrengthModule } from './types';

const URL = 'https://tts-agi-tts-arena-v2.hf.space/api/leaderboard';

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Pure parser for `{ rows: [...] }` (object or JSON text). The API has no as-of date, so every row is stamped with the
 * fetch day. Suspended rows (rank 0, e.g. for vote manipulation) are left out; retired and preliminary rows keep their rating.
 */
export function parseTtsArena(raw: unknown, now: Date): Observation[] {
  let body = raw;
  if (typeof raw === 'string') {
    try {
      body = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const rows = isObject(body) ? body['rows'] : undefined;
  if (!Array.isArray(rows)) return [];
  const date = todayISO(now);
  const out: Observation[] = [];
  for (const row of rows as unknown[]) {
    if (!isObject(row) || row['suspended'] === true) continue;
    const model = typeof row['name'] === 'string' ? row['name'].trim() : '';
    const value = toNumber(row['elo']);
    if (!model || value === null) continue;
    out.push({ series: 'tts-arena', kind: 'elo', model, date, dateKind: 'snapshot', value });
  }
  return out;
}

export const ttsArena: StrengthModule = {
  id: 'tts-arena',
  role: 'strength',
  group: 'tts-arena',
  history: 'accumulate',
  meta: {
    name: 'TTS Arena',
    url: 'https://huggingface.co/spaces/TTS-AGI/TTS-Arena-V2',
    license: 'No explicit data licence (leaderboard published openly; code: Apache-2.0)',
    credit: 'TTS Arena (TTS-AGI), https://huggingface.co/spaces/TTS-AGI/TTS-Arena-V2',
  },
  fetch: (ctx: FetchCtx) => ctx.fetchJson<unknown>(URL),
  parse: (raw, ctx) => parseTtsArena(raw, ctx.now),
};
