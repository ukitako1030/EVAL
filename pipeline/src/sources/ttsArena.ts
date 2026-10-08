import type { Observation } from '../core/types';
import { todayISO } from '../core/months';
import { isObject } from './lib/privacy';
import { toNumber } from './lib/values';
import type { FetchCtx, StrengthModule } from './types';

const URL = 'https://tts-agi-tts-arena-v2.hf.space/api/leaderboard';

const trimmed = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Pure parser for `{ rows: [...] }` (object or JSON text). The API has no as-of date, so every row is stamped with the
 * fetch day. Suspended rows (rank 0, e.g. for vote manipulation) are left out; retired and preliminary rows keep their rating.
 *
 * The model key is the row's stable `id` (e.g. `minimax-speech-02-hd`), because display names drift between app versions
 * ("MiniMax Speech-02-HD" became "MiniMax Speech 02 HD") and some are pseudonyms ("Aurora" is `luck-dolphin`). Only when a row
 * has no usable `id` (missing, not a string or blank) does the trimmed `name` stand in. The id carries the product family, so
 * curated patterns match it (`/^eleven-/`, `/^minimax-speech-/`), not the brand, which it often lacks (`async-1` is CastleFlow).
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
    const model = trimmed(row['id']) || trimmed(row['name']);
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
