import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveSnapshot } from '../raw/store';
import { todayISO } from '../core/months';
import type { FetchCtx, SourceModule } from './types';

export interface FetchStatus {
  id: string;
  status: 'ok' | 'skipped' | 'failed';
  count: number;
  error?: string;
  ms: number;
}

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
      saveSnapshot(rawDir, mod.id, date, items as unknown[], mod.history);
      out.push({ id: mod.id, status: 'ok', count: items.length, ms: Date.now() - t0 });
      ctx.log(`✓ ${mod.id}: ${items.length} items`);
    } catch (e) {
      out.push({ id: mod.id, status: 'failed', count: 0, error: (e as Error).message, ms: Date.now() - t0 });
      ctx.log(`✗ ${mod.id}: ${(e as Error).message}`);
    }
  }
  mkdirSync(join(rawDir, '_status'), { recursive: true });
  writeFileSync(join(rawDir, '_status', `${date}.json`), JSON.stringify(out, null, 2) + '\n');
  return out;
}
