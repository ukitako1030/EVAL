import { FRONT_IDS, type Announcement, type BreakdownItem, type Confidence, type EventType, type FrontId, type Localized, type ScaleBreakdownItem, type SourceInfo, type UnitMonth, type World, type WorldEvent } from './types';

/** The world.json contract this build understands (pipeline/src/compute/world.ts `schemaVersion`). */
export const SUPPORTED_SCHEMA_VERSION = 2;

type Obj = Record<string, unknown>;

const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'reconstructed', 'estimated'];
const EVENT_TYPES: readonly EventType[] = ['new_unit', 'new_model', 'lead_change', 'scale_lead_change', 'surge', 'custom'];
const ORG_GREY = '#888888';

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isFront = (v: unknown): v is FrontId => (FRONT_IDS as readonly unknown[]).includes(v);
/** an unknown confidence is shown as the least certain one (fog), never as solid data */
const conf = (v: unknown, missing: Confidence): Confidence => (v === undefined ? missing : (CONFIDENCES as readonly unknown[]).includes(v) ? (v as Confidence) : 'estimated');

function localized(v: unknown, fallback: string): Localized {
  const o = isObj(v) ? v : {};
  const ja = str(o.ja);
  const en = str(o.en);
  return { ja: ja || en || fallback, en: en || ja || fallback };
}

/** a month of a unit's series: a non-object is "no data"; numbers default to 0, confidences to safe values (in place) */
function cell(v: unknown): UnitMonth | null {
  if (!isObj(v)) return null;
  const m = v as unknown as UnitMonth;
  m.s = num(v.s);
  m.c = num(v.c);
  m.q = conf(v.q, 'estimated');
  m.qs = conf(v.qs, m.q);
  m.qc = conf(v.qc, m.q);
  return m;
}

function fronts(v: unknown): World['fronts'] {
  const out: World['fronts'] = [];
  for (const f of Array.isArray(v) ? v : []) {
    if (!isObj(f) || !isFront(f.id) || out.some((x) => x.id === f.id)) continue;
    out.push({ id: f.id, name: localized(f.name, f.id) });
  }
  return out.length ? out : FRONT_IDS.map((id) => ({ id, name: { ja: id, en: id } }));
}

function orgs(v: unknown): World['orgs'] {
  const out: World['orgs'] = {};
  if (!isObj(v)) return out;
  for (const [id, o] of Object.entries(v)) {
    const r = isObj(o) ? o : {};
    const color = str(r.color);
    out[id] = { name: str(r.name) || id, color: /^#[0-9a-f]{6}$/i.test(color) ? color : ORG_GREY };
  }
  return out;
}

function events(v: unknown): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (const e of Array.isArray(v) ? v : []) {
    if (!isObj(e) || typeof e.month !== 'string' || !isFront(e.front) || typeof e.unit !== 'string') continue;
    const ev: WorldEvent = {
      month: e.month,
      front: e.front,
      unit: e.unit,
      type: (EVENT_TYPES as readonly unknown[]).includes(e.type) ? (e.type as EventType) : 'custom',
      major: e.major === true,
      text: localized(e.text, ''),
    };
    if (typeof e.model === 'string') ev.model = e.model;
    if (typeof e.from === 'string') ev.from = e.from;
    out.push(ev);
  }
  return out;
}

/** front → unit → month → rows, keeping only well-formed levels and repairing each row with `row` */
function nested<T>(v: unknown, row: (r: Obj) => T): Record<string, Record<string, Record<string, T[]>>> {
  const out: Record<string, Record<string, Record<string, T[]>>> = {};
  if (!isObj(v)) return out;
  for (const [front, units] of Object.entries(v)) {
    if (!isObj(units)) continue;
    const fu: Record<string, Record<string, T[]>> = (out[front] = {});
    for (const [unit, months] of Object.entries(units)) {
      if (!isObj(months)) continue;
      const um: Record<string, T[]> = (fu[unit] = {});
      for (const [month, rows] of Object.entries(months)) um[month] = (Array.isArray(rows) ? rows : []).filter(isObj).map(row);
    }
  }
  return out;
}

const breakdownRow = (r: Obj): BreakdownItem => ({
  source: str(r.source),
  model: str(r.model),
  value: num(r.value),
  weight: num(r.weight),
  share: num(r.share),
  // an unknown kind never claims to be measured
  kind: r.kind === 'measured' ? 'measured' : 'reconstructed',
});

const scaleRow = (r: Obj): ScaleBreakdownItem => ({
  component: str(r.component),
  share: num(r.share),
  signals: Array.isArray(r.signals) ? r.signals.filter((s): s is string => typeof s === 'string') : [],
});

function sources(v: unknown): SourceInfo[] {
  const out: SourceInfo[] = [];
  for (const s of Array.isArray(v) ? v : []) {
    if (!isObj(s)) continue;
    const id = str(s.id);
    out.push({
      id,
      group: str(s.group, id),
      name: str(s.name, id),
      url: strOrNull(s.url),
      license: str(s.license),
      credit: str(s.credit),
      asOf: strOrNull(s.asOf),
      dataThrough: strOrNull(s.dataThrough),
    });
  }
  return out;
}

function announcements(v: unknown): Record<string, Announcement> {
  const out: Record<string, Announcement> = {};
  if (!isObj(v)) return out;
  for (const [key, a] of Object.entries(v)) {
    if (!isObj(a)) continue;
    const metric = a.metric === 'WAU' || a.metric === 'DAU' ? a.metric : 'MAU';
    const points = (Array.isArray(a.points) ? a.points : []).filter(isObj).map((p) => ({ date: str(p.date), value: num(p.value), url: str(p.url) }));
    out[key] = { metric, points };
  }
  return out;
}

/**
 * Validates world.json and repairs what can be repaired, so a weakly-formed file degrades instead of crashing a view:
 * the structural core (months, schema version, units ↔ series per front) must be right or this throws; every other
 * block defaults to empty, unknown enum values map to safe ones (confidence → estimated, breakdown kind →
 * reconstructed, event type → custom) and non-numeric values to 0. Repairs happen in place; returns the same object.
 */
export function parseWorld(json: unknown): World {
  if (!isObj(json) || !Array.isArray(json.months) || !json.months.length) throw new Error('world.json: no months');
  const w = json as unknown as World;
  if (w.schemaVersion !== SUPPORTED_SCHEMA_VERSION) throw new Error(`world.json: unsupported schema version ${w.schemaVersion}`);
  const months = w.months.length;
  for (const f of FRONT_IDS) {
    if (!isObj(w.series?.[f]) || !isObj(w.units?.[f])) throw new Error(`world.json: missing front ${f}`);
    const units = w.units[f] as Obj;
    const series = w.series[f] as Record<string, unknown>;
    for (const u of Object.keys(units)) {
      if (!Object.hasOwn(series, u)) throw new Error(`world.json: units/series mismatch for ${f}.${u}`);
      const meta = isObj(units[u]) ? units[u] : {};
      units[u] = { ...meta, org: str(meta.org), name: str(meta.name) || u, since: str(meta.since) };
    }
    for (const [u, arr] of Object.entries(series)) {
      if (!Object.hasOwn(units, u)) throw new Error(`world.json: units/series mismatch for ${f}.${u}`);
      if (!Array.isArray(arr) || arr.length !== months) throw new Error(`world.json: months/series length mismatch for ${f}.${u}`);
      for (let i = 0; i < arr.length; i++) arr[i] = cell(arr[i]);
    }
  }
  w.fronts = fronts(json.fronts);
  w.orgs = orgs(json.orgs);
  w.events = events(json.events);
  w.breakdown = nested(json.breakdown, breakdownRow) as World['breakdown'];
  w.scaleBreakdown = nested(json.scaleBreakdown, scaleRow) as World['scaleBreakdown'];
  w.sources = sources(json.sources);
  w.announcements = announcements(json.announcements);
  w.generatedAt = str(json.generatedAt);
  w.partialMonth = str(json.partialMonth);
  w.dataLicense = str(json.dataLicense);
  w.dataLicenseJa = str(json.dataLicenseJa);
  return w;
}

export async function loadWorld(url = './data/world.json'): Promise<World> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`world.json: HTTP ${res.status}`);
  return parseWorld(await res.json());
}
