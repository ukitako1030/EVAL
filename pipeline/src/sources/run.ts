import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSource, saveSnapshot } from '../raw/store';
import { todayISO } from '../core/months';
import type { FetchCtx, SourceModule } from './types';

export interface FetchStatus {
  id: string;
  status: 'ok' | 'skipped' | 'failed';
  count: number;
  error?: string;
  ms: number;
}

/** A `full` source may not shrink below this share of its current snapshot (a smaller parse is more likely a format change than real data loss). */
const MIN_FULL_SHARE = 0.9;

/** Items in the source's current snapshot; 0 when there is none or it cannot be read (an unreadable snapshot may be replaced). */
function existingItemCount(rawDir: string, id: string): number {
  try {
    return loadSource<unknown>(rawDir, id, 'full').length;
  } catch {
    return 0;
  }
}

/** Statuses already recorded for the day (empty when the file is missing or not a list of statuses). */
function readStatus(path: string): FetchStatus[] {
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((s): s is FetchStatus => typeof s?.id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Fetches every module (or only the `only` ids) and records the outcome in raw/_status/<date>.json.
 * A full run overwrites the day's file; a run restricted to `only` ids merges into it (entries with the same id are
 * replaced in place, the others are kept, new ids are appended), so re-running one failed source does not erase the rest.
 * A `full` source whose new parse has fewer than 90% of the items of its saved snapshot is not saved but recorded as failed.
 * Returns the statuses of THIS run.
 */
export async function runFetch(modules: SourceModule[], ctx: FetchCtx, rawDir: string, only?: string[]): Promise<FetchStatus[]> {
  const date = todayISO(ctx.now);
  const out: FetchStatus[] = [];
  for (const mod of modules) {
    if (only && !only.includes(mod.id)) continue;
    const t0 = Date.now();
    if (mod.static) {
      out.push({ id: mod.id, status: 'skipped', count: 0, error: 'static source (imported by script)', ms: 0 });
      continue;
    }
    const missing = (mod.needsEnv ?? []).filter((k) => !ctx.env[k]);
    if (missing.length) {
      out.push({ id: mod.id, status: 'skipped', count: 0, error: `missing env: ${missing.join(', ')}`, ms: 0 });
      ctx.log(`- ${mod.id}: skipped (missing ${missing.join(', ')})`);
      continue;
    }
    try {
      const raw = await mod.fetch(ctx);
      const items = mod.parse(raw, { now: ctx.now });
      if (!items.length) throw new Error('parse returned 0 items (format change?)');
      if (mod.history === 'full') {
        const before = existingItemCount(rawDir, mod.id);
        if (items.length < before * MIN_FULL_SHARE) throw new Error(`refusing to replace ${before} items with ${items.length} (format change?)`);
      }
      saveSnapshot(rawDir, mod.id, date, items as unknown[], mod.history);
      out.push({ id: mod.id, status: 'ok', count: items.length, ms: Date.now() - t0 });
      ctx.log(`✓ ${mod.id}: ${items.length} items`);
    } catch (e) {
      out.push({ id: mod.id, status: 'failed', count: 0, error: (e as Error).message, ms: Date.now() - t0 });
      ctx.log(`✗ ${mod.id}: ${(e as Error).message}`);
    }
  }
  const statusPath = join(rawDir, '_status', `${date}.json`);
  let recorded = out;
  if (only) {
    const fresh = new Map(out.map((s) => [s.id, s]));
    const merged = readStatus(statusPath).map((s) => fresh.get(s.id) ?? s);
    const known = new Set(merged.map((s) => s.id));
    recorded = [...merged, ...out.filter((s) => !known.has(s.id))];
  }
  mkdirSync(join(rawDir, '_status'), { recursive: true });
  writeFileSync(statusPath, JSON.stringify(recorded, null, 2) + '\n');
  return out;
}
