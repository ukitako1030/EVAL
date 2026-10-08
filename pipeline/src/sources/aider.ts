import { parse as parseYaml } from 'yaml';
import type { Observation } from '../core/types';
import { isoDate, toNumber } from './lib/values';
import type { StrengthModule } from './types';

const BASE = 'https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data';

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

interface AiderBoardCfg {
  id: string;
  file: string;
  priority: number;
  name: string;
  /** public page of the leaderboard */
  url: string;
}

/** A run counts as partial below this share of the file's usual exercise count (224 of 225 is fine, 33 of 133 is not). */
const PARTIAL_RUN_SHARE = 0.95;

/** Most common `test_cases` value in the file (the larger one on a tie); null when no entry has a usable count. */
function usualTestCases(entries: unknown[]): number | null {
  const counts = new Map<number, number>();
  for (const e of entries) {
    if (typeof e !== 'object' || e === null) continue;
    const n = toNumber((e as Record<string, unknown>).test_cases);
    if (n !== null && n > 0) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const [n, c] of counts) if (best === null || c > counts.get(best)! || (c === counts.get(best)! && n > best)) best = n;
  return best;
}

/** Two-model runs (an architect model plus an editor model) measure a pairing, not one model. */
function isArchitectRun(entry: Record<string, unknown>, model: string): boolean {
  return entry.editor_model != null || entry.edit_format === 'architect' || model.includes(' + ');
}

/**
 * One Aider leaderboard YAML (a list of benchmark runs). `pass_rate_2` is the headline score: percent of exercises
 * passing after one retry with test feedback. Several runs per model are all emitted, except two-model "architect"
 * runs and partial runs (fewer than 95% of the file's usual `test_cases`).
 */
function aiderBoard(cfg: AiderBoardCfg): StrengthModule {
  return {
    id: cfg.id,
    role: 'strength',
    group: 'aider',
    priority: cfg.priority,
    history: 'full',
    meta: {
      name: cfg.name,
      url: cfg.url,
      license: 'Apache-2.0',
      credit: `${cfg.name} (Aider-AI/aider), Apache-2.0`,
    },
    fetch: (ctx) => ctx.fetchText(`${BASE}/${cfg.file}`),
    parse(raw) {
      if (typeof raw !== 'string') return [];
      let entries: unknown;
      try {
        // the core schema leaves `2024-10-22` a string (no timestamp type) and `5318380` a number; a few entries use CRLF
        entries = parseYaml(raw.replace(/\r\n?/g, '\n'), { schema: 'core' });
      } catch {
        return [];
      }
      if (!Array.isArray(entries)) return [];
      const out: Observation[] = [];
      const usual = usualTestCases(entries);
      for (const e of entries) {
        if (typeof e !== 'object' || e === null) continue;
        const entry = e as Record<string, unknown>;
        const model = text(entry.model);
        // model release date when the entry has one, otherwise the benchmark run date
        const date = isoDate(entry.released) ?? isoDate(entry._released) ?? isoDate(entry.date);
        const value = toNumber(entry.pass_rate_2);
        if (!model || date === null || value === null) continue;
        if (isArchitectRun(entry, model)) continue;
        const cases = toNumber(entry.test_cases);
        if (usual !== null && cases !== null && cases < PARTIAL_RUN_SHARE * usual) continue;
        out.push({ series: cfg.id, kind: 'percent', model, date, dateKind: 'release', value });
      }
      return out;
    },
  };
}

/** Code editing benchmark (133 exercises). Frozen since Dec 2024. */
export const aiderEdit = aiderBoard({
  id: 'aider-edit',
  file: 'edit_leaderboard.yml',
  priority: 1,
  name: 'Aider code-editing leaderboard',
  url: 'https://aider.chat/docs/leaderboards/edit.html',
});

/** Polyglot benchmark (225 exercises in 6 languages), the main Aider leaderboard. */
export const aiderPolyglot = aiderBoard({
  id: 'aider-polyglot',
  file: 'polyglot_leaderboard.yml',
  priority: 2,
  name: 'Aider polyglot leaderboard',
  url: 'https://aider.chat/docs/leaderboards/',
});
