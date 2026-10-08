import type { Month } from './months';

export const FRONT_IDS = ['general', 'code', 'agent', 'image', 'video', 'speech', 'music'] as const;
export type FrontId = (typeof FRONT_IDS)[number];

/** How a strength value is compared with the month's leader (spec §6.1-2). */
export type ValueKind = 'elo' | 'percent' | 'minutes' | 'eci';

/** One model-level strength measurement from a source. Higher value = better. */
export interface Observation {
  /** Series id. Defaults to the source id; version-split sources use e.g. 'epoch-terminalbench@2.0'. */
  series: string;
  kind: ValueKind;
  model: string;
  org?: string;
  /** 'YYYY-MM-DD'. Snapshot date for 'snapshot', model release (or submission) date for 'release'. */
  date: string;
  dateKind: 'snapshot' | 'release';
  /** elo rating | percent 0–100 | minutes | ECI points */
  value: number;
}

export const SIGNAL_IDS = [
  'announcements',
  'crux',
  'tranco',
  'cloudflare',
  'statcounter',
  'ramp',
  'openrouter',
  'wikipedia',
  'itunes',
] as const;
export type SignalId = (typeof SIGNAL_IDS)[number];

/** Signals whose raw value is a rank (lower = bigger). Converted to 1/rank before use. */
export const RANK_SIGNALS: ReadonlySet<SignalId> = new Set<SignalId>(['crux', 'tranco', 'cloudflare']);

/** One scale measurement for an identifier (hostname, article, app id, vendor, slug…) in a month. */
export interface SignalObs {
  signal: SignalId;
  key: string;
  month: Month;
  value: number;
}

export type Confidence = 'high' | 'medium' | 'reconstructed' | 'estimated';
const CONF_ORDER: Confidence[] = ['estimated', 'reconstructed', 'medium', 'high'];

export function minConfidence(a: Confidence, b: Confidence): Confidence {
  return CONF_ORDER.indexOf(a) <= CONF_ORDER.indexOf(b) ? a : b;
}

export interface Localized {
  ja: string;
  en: string;
}
