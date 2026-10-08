import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { SOURCES } from '../sources/index';
import { makeFetchCtx } from '../sources/http';
import { runFetch } from '../sources/run';
import { parseUnits } from '../config/load';
import { FRONT_IDS, type SignalId } from '../core/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Minimal .env loader (repo-root .env, KEY=VALUE lines). Never prints values. */
function loadDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('-'));
const backfill = args.includes('--backfill');
const env = { ...loadDotEnv(join(root, '..', '.env')), ...process.env };
const units = parseUnits(readFileSync(join(root, 'curated', 'units.yaml'), 'utf8'));
const keys = (signal: SignalId): string[] => {
  const out = new Set<string>();
  for (const f of FRONT_IDS) {
    for (const u of units.units[f]) {
      const v = (u.scale as Record<string, string | string[] | undefined>)[signal];
      for (const k of Array.isArray(v) ? v : v ? [v] : []) out.add(k);
    }
  }
  return [...out];
};
const ctx = makeFetchCtx(new Date(), env, (m) => console.log(m), { backfill, keys });
const status = await runFetch(SOURCES, ctx, join(root, 'raw'), only.length ? only : undefined);
const failed = status.filter((s) => s.status === 'failed').length;
console.log(`done: ${status.filter((s) => s.status === 'ok').length} ok, ${status.filter((s) => s.status === 'skipped').length} skipped, ${failed} failed`);
