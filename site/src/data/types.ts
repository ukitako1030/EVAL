export const FRONT_IDS = ['general', 'code', 'agent', 'image', 'video', 'speech', 'music'] as const;
export type FrontId = (typeof FRONT_IDS)[number];
export type Confidence = 'high' | 'medium' | 'reconstructed' | 'estimated';
export type Lang = 'ja' | 'en';
export interface Localized { ja: string; en: string }
/** `q` is the overall confidence; `qs` / `qc` are the confidence of the strength (`s`) and scale (`c`) values on their own. */
export interface UnitMonth { s: number; c: number; q: Confidence; qs: Confidence; qc: Confidence }
export type EventType = 'new_unit' | 'new_model' | 'lead_change' | 'scale_lead_change' | 'surge' | 'custom';
/** `major` events are the ones the galaxy view announces; focused views show every event of their front. */
export interface WorldEvent { month: string; front: FrontId; unit: string; type: EventType; major: boolean; text: Localized; model?: string; from?: string }
/** One row of a strength breakdown; `share` (0..1) is this row's share of the month's blended strength. */
export interface BreakdownItem { source: string; model: string; value: number; weight: number; share: number; kind: 'measured' | 'reconstructed' }
/** One component of a scale (usage) value: its `share` (0..1) of the month's blend and the signal ids behind it. */
export interface ScaleBreakdownItem { component: string; share: number; signals: string[] }
/**
 * `group` is the id that `BreakdownItem.source` refers to (may be `'curated'`); `dataThrough` is the last date the source
 * covers, null when unknown; `url` is null for credits without a single link (e.g. curated company announcements, whose
 * links sit on each figure) — render those as text.
 */
export interface SourceInfo { id: string; group: string; name: string; url: string | null; license: string; credit: string; asOf: string | null; dataThrough: string | null }
export interface AnnouncementPoint { date: string; value: number; url: string }
export interface Announcement { metric: 'MAU' | 'WAU' | 'DAU'; points: AnnouncementPoint[] }
export interface World {
  schemaVersion: number;
  generatedAt: string;
  months: string[];
  partialMonth: string;
  orgs: Record<string, { name: string; color: string }>;
  fronts: { id: FrontId; name: Localized }[];
  /** `since` = first month (YYYY-MM) the unit has data; `announcements` = key into `World.announcements` */
  units: Record<FrontId, Record<string, { org: string; name: string; since: string; announcements?: string }>>;
  series: Record<FrontId, Record<string, (UnitMonth | null)[]>>;
  breakdown: Record<FrontId, Record<string, Record<string, BreakdownItem[]>>>;
  /** front → unit → month → scale components */
  scaleBreakdown: Record<FrontId, Record<string, Record<string, ScaleBreakdownItem[]>>>;
  announcements: Record<string, Announcement>;
  events: WorldEvent[];
  sources: SourceInfo[];
  dataLicense: string;
  dataLicenseJa: string;
}
