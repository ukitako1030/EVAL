import type { Observation } from '../core/types';
import type { FetchCtx, StrengthModule } from './types';
import { memoBytes } from './lib/memo';
import { readParquetRows } from './lib/parquet';
import { isoDate, lastPerMonth, toNumber } from './lib/values';

const DATASET_URL = 'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset';
/** The only columns the module needs; the others (CIs, votes, rank, licence…) are never decoded. */
const COLUMNS = ['model_name', 'organization', 'rating', 'category', 'leaderboard_publish_date'];

export interface ArenaConfig {
  /** series / source id, e.g. 'arena-text' */
  id: string;
  /** HF dataset folder holding `full-00000-of-00001.parquet`, e.g. 'text_style_control' */
  subset: string;
  /** weight key in method.yaml strength.weights[front] */
  group: string;
  priority?: number;
  /** leaderboard category to keep (default 'overall') */
  category?: string;
  /** shown in meta.name as `Arena (${name})` */
  name: string;
}

interface Row {
  model: string;
  org: string | undefined;
  date: string;
  value: number;
}

/**
 * One Arena leaderboard (HF dataset `lmarena-ai/leaderboard-dataset`) as a strength series.
 *
 * Snapshots are irregular (1–9 per month), so only the last snapshot of each calendar month is kept.
 * The month is decided after the category and rating filters: a date that has no usable row in the wanted
 * category (e.g. image_edit dates that only carry `multi_image_edit`) never claims its month.
 */
export function arenaModule(cfg: ArenaConfig): StrengthModule {
  const category = cfg.category ?? 'overall';
  const url = `${DATASET_URL}/resolve/main/${cfg.subset}/full-00000-of-00001.parquet`;
  return {
    id: cfg.id,
    role: 'strength',
    group: cfg.group,
    priority: cfg.priority,
    history: 'full',
    meta: {
      name: `Arena (${cfg.name})`,
      url: DATASET_URL,
      license: 'CC BY 4.0',
      credit: 'Arena leaderboard dataset (lmarena-ai/leaderboard-dataset), CC BY 4.0',
    },
    async fetch(ctx: FetchCtx) {
      // `resolve` answers 302 to the CDN; fetch follows it. Modules on the same subset share one download.
      const bytes = await memoBytes(url, () => ctx.fetchBytes(url));
      return readParquetRows(bytes, { columns: COLUMNS, filter: (r) => r.category === category });
    },
    parse(raw): Observation[] {
      if (!Array.isArray(raw)) return [];
      const rows: Row[] = [];
      for (const item of raw) {
        if (item === null || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        if (r.category !== category) continue;
        const value = toNumber(r.rating);
        const date = isoDate(r.leaderboard_publish_date);
        const model = typeof r.model_name === 'string' ? r.model_name.trim() : '';
        if (value === null || date === null || !model) continue;
        const org = typeof r.organization === 'string' ? r.organization.trim() : '';
        rows.push({ model, org: org || undefined, date, value });
      }
      return lastPerMonth(rows, (r) => r.date)
        .sort((a, b) => a.date.localeCompare(b.date) || b.value - a.value || a.model.localeCompare(b.model))
        .map(
          (r): Observation => ({
            series: cfg.id,
            kind: 'elo',
            model: r.model,
            ...(r.org ? { org: r.org } : {}),
            date: r.date,
            dateKind: 'snapshot',
            value: r.value,
          }),
        );
    },
  };
}

export const arenaText = arenaModule({ id: 'arena-text', subset: 'text', group: 'arena-text', priority: 1, name: 'Text' });
export const arenaTextStyle = arenaModule({
  id: 'arena-text-style',
  subset: 'text_style_control',
  group: 'arena-text',
  priority: 2,
  name: 'Text, style control',
});
/** Coding board: the code front gets a 2024-04+ history from it. */
export const arenaCoding = arenaModule({
  id: 'arena-coding',
  subset: 'text_style_control',
  category: 'coding',
  group: 'arena-coding',
  priority: 2,
  name: 'Coding, style control',
});
export const arenaCodingRaw = arenaModule({
  id: 'arena-coding-raw',
  subset: 'text',
  category: 'coding',
  group: 'arena-coding',
  priority: 1,
  name: 'Coding',
});
export const arenaWebdev = arenaModule({ id: 'arena-webdev', subset: 'webdev', group: 'arena-webdev', priority: 1, name: 'WebDev' });
/** t2i and image edit share a group, so their scores are averaged. */
export const arenaT2i = arenaModule({ id: 'arena-t2i', subset: 'text_to_image', group: 'arena-image', priority: 1, name: 'Text-to-image' });
export const arenaImageEdit = arenaModule({ id: 'arena-image-edit', subset: 'image_edit', group: 'arena-image', priority: 1, name: 'Image edit' });
/** t2v and i2v share a group, so their scores are averaged. */
export const arenaT2v = arenaModule({ id: 'arena-t2v', subset: 'text_to_video', group: 'arena-video', priority: 1, name: 'Text-to-video' });
export const arenaI2v = arenaModule({ id: 'arena-i2v', subset: 'image_to_video', group: 'arena-video', priority: 1, name: 'Image-to-video' });
