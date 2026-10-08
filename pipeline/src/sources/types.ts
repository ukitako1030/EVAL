import type { Observation, SignalId, SignalObs } from '../core/types';
import type { HistoryMode } from '../raw/store';

export interface FetchCtx {
  env: Record<string, string | undefined>;
  now: Date;
  /** true with `npm run fetch -- --backfill`: accumulate-history sources fetch their whole past, not just recent months */
  backfill: boolean;
  /** identifiers configured in curated/units.yaml for a scale signal (hostnames, article titles, app ids…), de-duplicated */
  keys(signal: SignalId): string[];
  fetchText(url: string, init?: RequestInit): Promise<string>;
  fetchBytes(url: string, init?: RequestInit): Promise<Uint8Array>;
  fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T>;
  log(msg: string): void;
}

export interface SourceMeta {
  name: string;
  url: string;
  license: string;
  credit: string;
}

interface BaseModule {
  id: string;
  history: HistoryMode;
  needsEnv?: string[];
  /** Data imported once by a script (e.g. scripts/import_arena_legacy.py); runFetch never fetches it. */
  static?: boolean;
  meta: SourceMeta;
  fetch(ctx: FetchCtx): Promise<unknown>;
}

export interface StrengthModule extends BaseModule {
  role: 'strength';
  /** weight key in method.yaml strength.weights[front] */
  group: string;
  /** higher wins inside a group when several series have data in a month (default 1) */
  priority?: number;
  parse(raw: unknown, ctx: { now: Date }): Observation[];
}

export interface ScaleModule extends BaseModule {
  role: 'scale';
  parse(raw: unknown, ctx: { now: Date }): SignalObs[];
}

export type SourceModule = StrengthModule | ScaleModule;
