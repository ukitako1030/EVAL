export const FRONT_IDS = ['general', 'code', 'agent', 'image', 'video', 'speech', 'music'] as const;
export type FrontId = (typeof FRONT_IDS)[number];
export type Confidence = 'high' | 'medium' | 'reconstructed' | 'estimated';
export type Lang = 'ja' | 'en';
export interface Localized { ja: string; en: string }
export interface UnitMonth { s: number; c: number; q: Confidence }
export type EventType = 'new_unit' | 'new_model' | 'lead_change' | 'scale_lead_change' | 'surge' | 'custom';
export interface WorldEvent { month: string; front: FrontId; unit: string; type: EventType; text: Localized; model?: string; from?: string }
export interface BreakdownItem { source: string; value: number; weight: number; kind: 'measured' | 'reconstructed' }
export interface SourceInfo { id: string; group: string; name: string; url: string; license: string; credit: string; asOf: string | null }
export interface World {
  generatedAt: string;
  months: string[];
  partialMonth: string;
  orgs: Record<string, { name: string; color: string }>;
  fronts: { id: FrontId; name: Localized }[];
  units: Record<FrontId, Record<string, { org: string; name: string }>>;
  series: Record<FrontId, Record<string, (UnitMonth | null)[]>>;
  breakdown: Record<FrontId, Record<string, Record<string, BreakdownItem[]>>>;
  events: WorldEvent[];
  sources: SourceInfo[];
}
