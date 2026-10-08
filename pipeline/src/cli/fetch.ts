import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { SOURCES } from '../sources/index';
import { licenseIndex } from '../raw/licenses';
import { makeFetchCtx } from '../sources/http';
import { runFetch } from '../sources/run';
import { parseUnits } from '../config/load';
import { loadDotEnv } from './dotenv';
import { fetchExitCode, writeStatusLatest } from './outputs';
import { todayISO } from '../core/months';
import { FRONT_IDS, type SignalId } from '../core/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
const now = new Date();
const ctx = makeFetchCtx(now, env, (m) => console.log(m), { backfill, keys });
const status = await runFetch(SOURCES, ctx, join(root, 'raw'), only.length ? only : undefined);
writeFileSync(join(root, 'raw', 'LICENSES.md'), licenseIndex(SOURCES));
const failed = status.filter((s) => s.status === 'failed').length;
console.log(`done: ${status.filter((s) => s.status === 'ok').length} ok, ${status.filter((s) => s.status === 'skipped').length} skipped, ${failed} failed`);
// the run's status for the pull request summary (pipeline/out is git-ignored)
writeStatusLatest(join(root, 'out'), join(root, 'raw'), todayISO(now), status);
// Some sources failing is reported in the pull request. Every attempted source failing (a network outage)
// is a failed run, so that the weekly workflow stops instead of opening a pull request without new data.
if (fetchExitCode(status) === 1) {
  console.error('every source that was attempted failed; treating this run as failed');
  process.exitCode = 1;
}
