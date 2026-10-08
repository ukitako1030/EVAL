import type { Observation } from '../core/types';
import type { StrengthModule } from './types';
import { isoDate } from './lib/values';

/** The only error `fetch` ever throws; the data comes from raw/arena-legacy/<date>.json, written by the import script. */
export const STATIC_FETCH_ERROR = 'static source: run scripts/import_arena_legacy.py';

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/** A well-formed legacy Observation, or null (the item is dropped). */
function validate(item: unknown): Observation | null {
  if (item === null || typeof item !== 'object') return null;
  const r = item as Record<string, unknown>;
  if (!nonEmptyString(r.series) || !nonEmptyString(r.model)) return null;
  if (r.kind !== 'elo' || r.dateKind !== 'snapshot') return null;
  if (typeof r.value !== 'number' || !Number.isFinite(r.value)) return null;
  if (typeof r.date !== 'string' || isoDate(r.date) !== r.date) return null;
  const o: Observation = { series: r.series, kind: 'elo', model: r.model, date: r.date, dateKind: 'snapshot', value: r.value };
  if (nonEmptyString(r.org)) o.org = r.org;
  return o;
}

/**
 * Chatbot Arena overall-text ratings, month-end snapshots 2023-05 … 2025-08, including the models the current
 * leaderboard-dataset no longer lists (claude-1/2, bard, gpt-3.5-turbo-0314, gemini-exp-*, …): the survivorship fix.
 * Imported once by scripts/import_arena_legacy.py (the Space is frozen), so `runFetch` skips it (`static`).
 * Highest priority in its group (3 vs arena-text-style 2 / arena-text 1; compute/strength.ts lets the highest priority
 * with measured data win): in 2023-05 … 2025-08 these snapshots take precedence over the current dataset, which only
 * back-fills models still in Arena's registry. Later months have no legacy data, so arena-text-style / arena-text apply.
 */
export const arenaLegacy: StrengthModule = {
  id: 'arena-legacy',
  role: 'strength',
  group: 'arena-text',
  priority: 3,
  history: 'full',
  static: true,
  meta: {
    name: 'Arena (legacy text snapshots)',
    url: 'https://huggingface.co/spaces/lmarena-ai/arena-leaderboard',
    license: 'Apache-2.0',
    credit: 'Historical ratings: LMSYS / LMArena Chatbot Arena leaderboard snapshots (HF Space lmarena-ai/arena-leaderboard), Apache-2.0',
  },
  async fetch() {
    throw new Error(STATIC_FETCH_ERROR);
  },
  /** `raw` is the committed `items` array (a whole `{ items: [...] }` snapshot file is accepted too). */
  parse(raw): Observation[] {
    const items = Array.isArray(raw)
      ? raw
      : raw !== null && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)
        ? (raw as { items: unknown[] }).items
        : null;
    if (!items) return [];
    const out: Observation[] = [];
    for (const item of items) {
      const o = validate(item);
      if (o) out.push(o);
    }
    return out;
  },
};
