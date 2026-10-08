import type { Observation } from '../core/types';
import { isoDate, toNumber } from './lib/values';
import type { FetchCtx, StrengthModule } from './types';

const REPO_PATH = 'components/frontend/ma_frontend/leaderboard';
const API_DIR = `https://api.github.com/repos/gclef-cmu/music-arena/contents/${REPO_PATH}`;
const RAW_DIR = `https://raw.githubusercontent.com/gclef-cmu/music-arena/main/${REPO_PATH}`;
const BOARDS = ['vocal', 'instrumental'] as const;
type Board = (typeof BOARDS)[number];

/** One cumulative leaderboard file: `date` is the snapshot folder (YYYY-MM-DD), `text` the TSV as published. */
export interface MusicArenaFile {
  date: string;
  board: Board;
  text: string;
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const SAFE_FILE = /^[A-Za-z0-9_.-]+\.tsv$/;

async function fetchMusicArena(ctx: FetchCtx): Promise<MusicArenaFile[]> {
  const listing = await ctx.fetchJson<unknown>(API_DIR);
  const folders = (Array.isArray(listing) ? listing : [])
    .filter((e): e is Json => isObject(e) && e['type'] === 'dir' && typeof e['name'] === 'string' && /^\d{8}$/.test(e['name']))
    .map((e) => e['name'] as string)
    .sort();
  if (!folders.length) throw new Error('music-arena: no YYYYMMDD snapshot folders found (format change?)');

  const out: MusicArenaFile[] = [];
  // 'full' history replaces the previous snapshot, so any failed download fails the whole source
  for (const folder of folders) {
    const date = isoDate(folder);
    if (!date) continue;
    const files = await ctx.fetchJson<unknown>(`${API_DIR}/${folder}`);
    const names = (Array.isArray(files) ? files : [])
      .filter((e): e is Json => isObject(e) && e['type'] === 'file' && typeof e['name'] === 'string')
      .map((e) => e['name'] as string);
    const got = await Promise.all(
      BOARDS.map(async (board) => {
        const name = names.find((n) => n.startsWith(`${board}_`) && SAFE_FILE.test(n));
        if (!name) return null;
        return { date, board, text: await ctx.fetchText(`${RAW_DIR}/${folder}/${name}`) } satisfies MusicArenaFile;
      }),
    );
    for (const g of got) if (g) out.push(g);
  }
  if (!out.length) throw new Error('music-arena: no leaderboard TSV files found (format change?)');
  return out;
}

/** Splits a TSV (LF or CRLF, optional BOM) into records keyed by its header row. Rows with the wrong width are padded/truncated. */
export function parseTsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = lines[0].split('\t').map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

/**
 * Pure parser for `MusicArenaFile[]`. Both TSV generations parse the same way: the early files (20250831, 20250930) use system
 * keys as `Model` and "+x / -y" CIs, later ones display names and "±x"; only `Model`, `Arena Score` and, when it names one,
 * `organization` are used ("Hidden" marks an undisclosed preview model in the early files and is not an organisation).
 */
export function parseMusicArena(raw: unknown): Observation[] {
  if (!Array.isArray(raw)) return [];
  const out: Observation[] = [];
  for (const file of raw as unknown[]) {
    if (!isObject(file) || typeof file['text'] !== 'string') continue;
    const board = file['board'];
    const date = isoDate(file['date']);
    if ((board !== 'vocal' && board !== 'instrumental') || !date) continue;
    for (const row of parseTsv(file['text'])) {
      const model = row['Model'];
      const value = toNumber(row['Arena Score']);
      if (!model || value === null) continue;
      const org = row['organization'] ?? '';
      out.push({
        series: `music-arena@${board}`,
        kind: 'elo',
        model,
        ...(org && org.toLowerCase() !== 'hidden' ? { org } : {}),
        date,
        dateKind: 'snapshot',
        value,
      });
    }
  }
  return out;
}

export const musicArena: StrengthModule = {
  id: 'music-arena',
  role: 'strength',
  group: 'music-arena',
  history: 'full',
  meta: {
    name: 'Music Arena',
    url: 'https://music-arena.org/',
    license: 'CC BY 4.0',
    credit: 'Music Arena (gclef-cmu/music-arena; Kim et al., NeurIPS 2025 Creative AI track), music-arena/music-arena-dataset, CC BY 4.0',
  },
  fetch: fetchMusicArena,
  parse: (raw) => parseMusicArena(raw),
};
