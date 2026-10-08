import type { Observation } from '../core/types';
import { isoDate, toNumber } from './lib/values';
import type { StrengthModule } from './types';

const LEADERBOARDS_URL = 'https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json';
const BOARD = 'Verified';

/** The few entry fields the parser reads; `per_instance_details` (500 instances per row) makes up most of the 4 MB file. */
const KEEP = ['name', 'agent', 'model_display', 'model_org', 'model_release_date', 'date', 'resolved', 'tags', 'mini-swe-agent_version', 'folder'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function tagList(entry: Record<string, unknown>): string[] {
  return Array.isArray(entry.tags) ? entry.tags.filter((t): t is string => typeof t === 'string') : [];
}

/** A mini-SWE-agent (bash-only) run: the agent name, a `Mini: <version>` tag, or the version key. Any one of them is enough. */
function isMiniRun(entry: Record<string, unknown>): boolean {
  return entry.agent === 'mini-SWE-agent' || tagList(entry).some((t) => t.startsWith('Mini: ')) || 'mini-swe-agent_version' in entry;
}

function boardResults(raw: unknown, name: string): Record<string, unknown>[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.leaderboards)) return null;
  const board = raw.leaderboards.find((b) => isRecord(b) && b.name === name);
  if (!isRecord(board) || !Array.isArray(board.results)) return null;
  return board.results.filter(isRecord);
}

/**
 * SWE-bench Verified, restricted to the mini-SWE-agent runs: one fixed bash-only scaffold, so scores compare models,
 * not agent engineering. `date` is the model's release date (the run's submission date when the file has none).
 * Data is CC BY-NC 4.0 (attribution, non-commercial).
 */
export const swebench: StrengthModule = {
  id: 'swebench',
  role: 'strength',
  group: 'swebench',
  history: 'full',
  meta: {
    name: 'SWE-bench Verified (mini-SWE-agent)',
    url: 'https://www.swebench.com',
    license: 'CC BY-NC 4.0',
    credit: 'SWE-bench leaderboards (swebench.com), mini-SWE-agent runs on SWE-bench Verified, CC BY-NC 4.0',
  },
  async fetch(ctx) {
    const raw = await ctx.fetchJson<unknown>(LEADERBOARDS_URL);
    const results = boardResults(raw, BOARD);
    if (!results) throw new Error(`board "${BOARD}" not found in ${LEADERBOARDS_URL}`);
    return {
      leaderboards: [{ name: BOARD, results: results.map((r) => Object.fromEntries(KEEP.filter((k) => k in r).map((k) => [k, r[k]]))) }],
    };
  },
  parse(raw) {
    const results = boardResults(raw, BOARD);
    if (!results) return [];
    const out: Observation[] = [];
    for (const r of results) {
      if (!isMiniRun(r)) continue;
      const modelTag = tagList(r)
        .find((t) => t.startsWith('Model: '))
        ?.slice('Model: '.length)
        .trim();
      const model = text(r.model_display) ?? text(modelTag) ?? text(r.name);
      const date = isoDate(r.model_release_date) ?? isoDate(r.date);
      const value = toNumber(r.resolved);
      if (!model || date === null || value === null) continue;
      const obs: Observation = { series: 'swebench', kind: 'percent', model, date, dateKind: 'release', value };
      const org = text(r.model_org);
      if (org) obs.org = org;
      out.push(obs);
    }
    return out;
  },
};
