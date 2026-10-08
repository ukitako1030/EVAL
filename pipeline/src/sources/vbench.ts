import type { Observation } from '../core/types';
import { isoDate, toNumber } from './lib/values';
import type { FetchCtx, StrengthModule } from './types';

const CONFIG_URL = 'https://vchitect-vbench-leaderboard.hf.space/config';
const MAIN_TABLE_ID = 20; // "VBench 1.0" text-to-video table at the time of writing; only a hint, see findMainTable

type Json = Record<string, unknown>;
interface Table {
  headers: string[];
  data: unknown[][];
}

function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** `[Veo 3](https://…)` → `Veo 3`; `[name]` → `name`; plain text is returned trimmed. */
export function stripMarkdownLink(s: string): string {
  const m = /^\s*\[(.+?)\](?:\((?:[^()]|\([^()]*\))*\))?\s*$/s.exec(s);
  return (m ? m[1] : s).trim();
}

function tableOf(c: unknown): Table | null {
  if (!isObject(c) || c['type'] !== 'dataframe' || !isObject(c['props'])) return null;
  const value = c['props']['value'];
  if (!isObject(value) || !Array.isArray(value['headers']) || !Array.isArray(value['data'])) return null;
  return { headers: (value['headers'] as unknown[]).map((h) => String(h ?? '')), data: value['data'] as unknown[][] };
}

const norm = (h: string) => h.trim().toLowerCase();
/** The main T2V table has both a total and a semantic score column (VBench 2.0 and I2V have a Total Score but no Semantic Score). */
const isMainHeader = (headers: string[]) => headers.some((h) => norm(h) === 'total score') && headers.some((h) => norm(h) === 'semantic score');

/** Component ids below the tabitem whose label contains "VBench 1.0", read from the Gradio layout tree. */
function idsUnderMainTab(cfg: Json, byId: Map<number, Json>): Set<number> {
  const ids = new Set<number>();
  const walk = (node: unknown, inside: boolean) => {
    if (!isObject(node) || typeof node['id'] !== 'number') return;
    const comp = byId.get(node['id']);
    const label = comp && isObject(comp['props']) ? comp['props']['label'] : undefined;
    const here = inside || (comp?.['type'] === 'tabitem' && typeof label === 'string' && /vbench\s*1\.0/i.test(label));
    if (here) ids.add(node['id']);
    if (Array.isArray(node['children'])) for (const ch of node['children']) walk(ch, here);
  };
  walk(cfg['layout'], false);
  return ids;
}

/**
 * Finds the main T2V table without trusting component numbering: among the dataframes whose headers contain both
 * "Total Score" and "Semantic Score" it prefers the one under the "VBench 1.0" tab, then component id 20, then the first.
 */
export function findMainTable(cfg: unknown): Table | null {
  if (!isObject(cfg) || !Array.isArray(cfg['components'])) return null;
  const byId = new Map<number, Json>();
  for (const c of cfg['components'] as unknown[]) if (isObject(c) && typeof c['id'] === 'number') byId.set(c['id'], c);
  const candidates = [...byId.values()].filter((c) => {
    const t = tableOf(c);
    return t !== null && isMainHeader(t.headers);
  });
  if (!candidates.length) return null;
  const underTab = idsUnderMainTab(cfg, byId);
  const pick = candidates.find((c) => underTab.has(c['id'] as number)) ?? candidates.find((c) => c['id'] === MAIN_TABLE_ID) ?? candidates[0];
  return tableOf(pick);
}

/** Pure parser for the Gradio `/config` document (object or its JSON text). */
export function parseVbench(raw: unknown): Observation[] {
  let cfg = raw;
  if (typeof raw === 'string') {
    try {
      cfg = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const table = findMainTable(cfg);
  if (!table) return [];
  const col = (re: RegExp) => table.headers.findIndex((h) => re.test(norm(h)));
  const nameIdx = col(/^model/);
  const dateIdx = col(/^date$/);
  const totalIdx = col(/^total score$/);
  if (nameIdx < 0 || dateIdx < 0 || totalIdx < 0) return [];
  const out: Observation[] = [];
  for (const row of table.data) {
    if (!Array.isArray(row)) continue;
    const name = typeof row[nameIdx] === 'string' ? stripMarkdownLink(row[nameIdx] as string) : '';
    const value = toNumber(row[totalIdx]);
    const date = isoDate(row[dateIdx]);
    if (!name || value === null || value < 0 || value > 100 || !date) continue;
    out.push({ series: 'vbench', kind: 'percent', model: name, date, dateKind: 'release', value });
  }
  return out;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function redactEmails(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(EMAIL, '<redacted>');
  if (Array.isArray(v)) return v.map(redactEmails);
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactEmails(x)]));
  return v;
}

/**
 * Keeps only what `parseVbench` reads (the dataframes' tables, the tab labels and the layout tree) and scrubs any e-mail address.
 * The page prose in `/config` includes the VBench team's contact address, which has no place in our data.
 */
export function slimConfig(cfg: unknown): unknown {
  if (!isObject(cfg) || !Array.isArray(cfg['components'])) return cfg;
  const components = (cfg['components'] as unknown[]).flatMap((c): Json[] => {
    if (!isObject(c) || typeof c['id'] !== 'number') return [];
    const props = isObject(c['props']) ? c['props'] : {};
    if (c['type'] === 'dataframe') return [{ id: c['id'], type: 'dataframe', props: { value: props['value'] } }];
    if (c['type'] === 'tabitem') return [{ id: c['id'], type: 'tabitem', props: { label: props['label'] } }];
    return [];
  });
  return redactEmails({ components, layout: cfg['layout'] });
}

export const vbench: StrengthModule = {
  id: 'vbench',
  role: 'strength',
  group: 'vbench',
  history: 'full',
  meta: {
    name: 'VBench',
    url: 'https://huggingface.co/spaces/Vchitect/VBench_Leaderboard',
    license: 'No explicit data licence (leaderboard Space: MIT, VBench code: Apache-2.0)',
    credit: 'VBench leaderboard (Vchitect), cited; no explicit data licence',
  },
  fetch: async (ctx: FetchCtx) => slimConfig(await ctx.fetchJson<unknown>(CONFIG_URL)),
  parse: (raw) => parseVbench(raw),
};
