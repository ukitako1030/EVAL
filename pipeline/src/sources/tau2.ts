import type { Observation } from '../core/types';
import { isObject, redactEmails, type Json } from './lib/privacy';
import { isoDate, toNumber } from './lib/values';
import type { FetchCtx, StrengthModule } from './types';

const BASE = 'https://sierra-tau-bench-public.s3.us-west-2.amazonaws.com/submissions';
const DOMAINS = ['airline', 'retail', 'telecom', 'banking_knowledge'] as const;
const FETCH_CONCURRENCY = 6;

/** Removes the submitters' personal data from one submission object: drops `contact_info` and scrubs any stray e-mail address (defence in depth). */
export function stripPersonalData(submission: Json): Json {
  const { contact_info: _dropped, ...rest } = submission;
  return redactEmails(rest) as Json;
}

function dirList(manifest: unknown, key: string): string[] {
  const list = isObject(manifest) ? manifest[key] : undefined;
  return Array.isArray(list) ? list.filter((d): d is string => typeof d === 'string' && d.length > 0) : [];
}

async function fetchTau2(ctx: FetchCtx): Promise<Json[]> {
  const manifest = await ctx.fetchJson<unknown>(`${BASE}/manifest.json`);
  // text tracks only: `voice_submissions` (a different benchmark track) is never fetched
  const dirs = [...new Set([...dirList(manifest, 'submissions'), ...dirList(manifest, 'legacy_submissions')])];
  if (!dirs.length) throw new Error('tau2 manifest lists no submissions (format change?)');

  // 'full' history replaces the previous snapshot, so a partial download must fail the source rather than shrink the data
  const out: Json[] = new Array(dirs.length);
  let next = 0;
  let error: Error | undefined;
  const worker = async () => {
    while (!error && next < dirs.length) {
      const i = next++;
      try {
        const sub = await ctx.fetchJson<unknown>(`${BASE}/${encodeURIComponent(dirs[i])}/submission.json`);
        if (!isObject(sub)) throw new Error('not a JSON object');
        out[i] = stripPersonalData(sub);
      } catch (e) {
        error ??= new Error(`tau2: ${dirs[i]}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, dirs.length) }, worker));
  if (error) throw error;
  return out;
}

/** Pure parser: an array of submission.json objects → one observation per scored domain of each standard submission. */
export function parseTau2(raw: unknown): Observation[] {
  if (!Array.isArray(raw)) return [];
  const out: Observation[] = [];
  for (const sub of raw as unknown[]) {
    if (!isObject(sub)) continue;
    const type = sub['submission_type'];
    if (type !== undefined && type !== null && type !== 'standard') continue; // custom scaffolds are not comparable
    if (sub['modality'] === 'voice') continue; // the voice track is a different benchmark
    const model = typeof sub['model_name'] === 'string' ? sub['model_name'].trim() : '';
    if (!model) continue;
    const release = isObject(sub['model_release']) ? isoDate(sub['model_release']['release_date']) : null;
    const date = release ?? isoDate(sub['submission_date']);
    if (!date) continue;
    const orgRaw = sub['model_organization'];
    const org = typeof orgRaw === 'string' ? orgRaw.trim() : '';
    const results = isObject(sub['results']) ? sub['results'] : {};
    for (const domain of DOMAINS) {
      const res = results[domain];
      const value = isObject(res) ? toNumber(res['pass_1']) : null;
      if (value === null || value < 0 || value > 100) continue; // not a percentage: drop, like osworld/vbench
      out.push({
        series: `tau2@${domain}`,
        kind: 'percent',
        model,
        ...(org ? { org } : {}),
        date,
        dateKind: 'release',
        value,
      });
    }
  }
  return out;
}

export const tau2: StrengthModule = {
  id: 'tau2',
  role: 'strength',
  group: 'tau2',
  history: 'full',
  meta: {
    name: 'tau2-bench',
    url: 'https://taubench.com/',
    license: 'MIT',
    credit: 'tau2-bench leaderboard (Sierra Research, sierra-research/tau2-bench), MIT License, Copyright (c) 2025 Sierra Research',
  },
  fetch: fetchTau2,
  parse: (raw) => parseTau2(raw),
};
