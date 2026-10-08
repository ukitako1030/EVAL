import { join } from 'node:path';
import { FRONT_IDS, SIGNAL_IDS, minConfidence, type FrontId, type Observation, type SignalObs } from '../core/types';
import { monthRange, toMonth, type Month } from '../core/months';
import { round1, round3 } from '../core/math';
import { parseAnnouncements, parseEvents, parseMethod, parseReleases, parseUnits, readText } from '../config/load';
import type { AnnSeries } from '../config/schemas';
import { latestSnapshotDate, loadSource } from '../raw/store';
import type { SourceModule, StrengthModule } from '../sources/types';
import { assignSeries, bySeries, unitExists, type SeriesTable } from './assign';
import { computeStrength, fillEstimatedStrength } from './strength';
import { announcementMonthly } from './announcements';
import { buildSignalTable } from './signals';
import { computeScale } from './scale';
import { scaleConfidence, strengthConfidence } from './confidence';
import { detectEvents, type FrontCells, type WorldEvent } from './events';
import { SCHEMA_VERSION, validateWorld, type World } from './world';

export interface ComputeOpts {
  rawDir: string;
  curatedDir: string;
  methodPath: string;
  modules: SourceModule[];
  now: Date;
  /** Receives one message per skipped source/series (a broken source must not crash the run). Default: console.warn. */
  onWarn?: (msg: string) => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const VALUE_KINDS: ReadonlySet<unknown> = new Set(['elo', 'percent', 'minutes', 'eci']);
const DATE_KINDS: ReadonlySet<unknown> = new Set(['snapshot', 'release']);
const SIGNAL_SET: ReadonlySet<unknown> = new Set(SIGNAL_IDS);
const MONTH_RE = /^\d{4}-\d{2}$/;
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** Raw files are untrusted JSON: a strength item must look like an Observation. */
function isObservation(x: unknown): x is Observation {
  return (
    isRecord(x) &&
    typeof x.series === 'string' &&
    typeof x.model === 'string' &&
    typeof x.date === 'string' &&
    VALUE_KINDS.has(x.kind) &&
    DATE_KINDS.has(x.dateKind) &&
    typeof x.value === 'number' &&
    Number.isFinite(x.value)
  );
}

/** ...and a scale item must look like a SignalObs (positive values only: 0 / negatives carry no information). */
function isSignalObs(x: unknown): x is SignalObs {
  return (
    isRecord(x) &&
    SIGNAL_SET.has(x.signal) &&
    typeof x.key === 'string' &&
    typeof x.month === 'string' &&
    MONTH_RE.test(x.month) &&
    typeof x.value === 'number' &&
    Number.isFinite(x.value) &&
    x.value > 0
  );
}

/** Keeps the last occurrence of each (signal, key, month): accumulate sources append dated files in ascending order, so the latest fetch wins. */
function latestWins(obs: SignalObs[]): SignalObs[] {
  const last = new Map<string, SignalObs>();
  for (const o of obs) last.set(`${o.signal}\u0000${o.key}\u0000${o.month}`, o);
  return [...last.values()];
}

/** The public part of a curated announcements series: points sorted by date, notes left out. */
function exportAnnouncements(s: AnnSeries): World['announcements'][string] {
  return {
    metric: s.metric,
    points: [...s.points]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => ({ date: p.date, value: p.value, url: p.url, ...(p.metric && p.metric !== s.metric ? { metric: p.metric } : {}) })),
  };
}

export function computeWorld(opts: ComputeOpts): World {
  const method = parseMethod(readText(opts.methodPath));
  const units = parseUnits(readText(join(opts.curatedDir, 'units.yaml')));
  const announcements = parseAnnouncements(readText(join(opts.curatedDir, 'announcements.yaml')));
  const eventsFile = parseEvents(readText(join(opts.curatedDir, 'events.yaml')));
  const releases = parseReleases(readText(join(opts.curatedDir, 'releases.yaml')));
  const months = monthRange(method.start, toMonth(opts.now));
  const warn = opts.onWarn ?? ((msg: string) => console.warn(msg));

  const strengthObs = new Map<string, Observation[]>();
  const signalObs: SignalObs[] = [];
  /** source id → latest observation date (strength) or signal month (scale) among its valid raw items */
  const dataThrough = new Map<string, string>();
  for (const mod of opts.modules) {
    let items: unknown[];
    try {
      items = loadSource<unknown>(opts.rawDir, mod.id, mod.history);
      if (!Array.isArray(items)) throw new Error('snapshot has no items array');
    } catch (e) {
      warn(`source "${mod.id}": cannot read raw data (${errMsg(e)}); skipped`);
      continue;
    }
    const valid = mod.role === 'strength' ? items.filter(isObservation) : items.filter(isSignalObs);
    if (valid.length < items.length) warn(`source "${mod.id}": dropped ${items.length - valid.length} of ${items.length} raw items that are not valid ${mod.role === 'strength' ? 'observations' : 'signal observations'}`);
    let latest = '';
    if (mod.role === 'strength') {
      strengthObs.set(mod.id, valid as Observation[]);
      for (const o of valid as Observation[]) if (o.date.slice(0, 10) > latest) latest = o.date.slice(0, 10);
    } else {
      for (const o of valid as SignalObs[]) {
        signalObs.push(o); // not push(...valid): scale sources can hold 100k+ rows
        if (o.month > latest) latest = o.month;
      }
    }
    if (latest) dataThrough.set(mod.id, latest);
  }
  const scaleObs = latestWins(signalObs);

  const world: World = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: opts.now.toISOString(),
    months,
    partialMonth: months[months.length - 1],
    orgs: units.orgs,
    fronts: FRONT_IDS.map((id) => ({ id, name: units.fronts[id].name })),
    units: {},
    announcements: {},
    series: {},
    breakdown: {},
    scaleBreakdown: {},
    events: [],
    // only sources whose raw data was actually loaded are credited
    sources: opts.modules
      .filter((m) => dataThrough.has(m.id))
      .map((m) => {
        const asOf = latestSnapshotDate(opts.rawDir, m.id);
        return {
          id: m.id,
          group: m.role === 'strength' ? m.group : m.id,
          name: m.meta.name,
          url: m.meta.url,
          license: m.meta.license,
          credit: m.meta.credit.replaceAll('<date>', asOf ?? ''),
          asOf,
          dataThrough: dataThrough.get(m.id)!,
        };
      }),
  };

  for (const front of FRONT_IDS) {
    const fUnits = units.units[front];
    const ids = fUnits.map((u) => u.id);
    const byId = new Map(fUnits.map((u) => [u.id, u]));
    const exists = (id: string, m: Month) => unitExists(byId.get(id)!, m);
    world.units[front] = Object.fromEntries(
      fUnits.map((u) => [u.id, { org: u.org, name: u.name, since: u.since, ...(u.scale.announcements ? { announcements: u.scale.announcements } : {}) }]),
    );

    // strength
    const weights = method.strength.weights[front] ?? {};
    const tables: SeriesTable[] = [];
    for (const mod of opts.modules) {
      if (mod.role !== 'strength' || !(mod.group in weights)) continue;
      let groups: Map<string, Observation[]>;
      try {
        groups = bySeries(strengthObs.get(mod.id) ?? []);
      } catch (e) {
        warn(`source "${mod.id}" (${front}): malformed observations (${errMsg(e)}); skipped`);
        continue;
      }
      for (const [seriesId, list] of groups) {
        try {
          tables.push(
            assignSeries({
              front,
              group: mod.group,
              priority: (mod as StrengthModule).priority ?? 1,
              observations: list,
              units: fUnits,
              months,
              releases,
              params: method.strength,
              exclude: units.exclude,
            }),
          );
        } catch (e) {
          warn(`source "${mod.id}" series "${seriesId}" (${front}): ${errMsg(e)}; skipped`);
        }
      }
    }
    const strength = computeStrength({ tables, unitIds: ids, months, weights, kinds: method.strength.kinds, minUnits: method.strength.minUnits });
    // new_model events compare model names within ONE group so that a source going stale doesn't look like a new model
    const eventGroup = Object.entries(weights).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];

    // scale
    const signals = buildSignalTable(fUnits, scaleObs);
    const ann = new Map<string, Map<Month, number>>();
    for (const u of fUnits) {
      const key = u.scale.announcements;
      if (key && announcements.series[key]) {
        ann.set(u.id, announcementMonthly(announcements.series[key], months, method.scale.metricFactors, method.scale.announcementStaleMonths));
        world.announcements[key] = exportAnnouncements(announcements.series[key]);
      }
    }
    if (ann.size) signals.set('announcements', ann);
    const scale = computeScale({ unitIds: ids, months, exists, signals, method: method.scale });
    const shares = new Map(ids.map((u) => [u, new Map(months.map((m) => [m, scale.get(u)!.get(m)?.c ?? null]))]));
    fillEstimatedStrength({ cells: strength, shares, months, exists, floor: method.strength.estimate.floor, step: method.strength.estimate.step });

    // assemble series + breakdown
    world.series[front] = {};
    world.breakdown[front] = {};
    world.scaleBreakdown[front] = {};
    const cells: FrontCells = new Map();
    for (const u of ids) {
      const arr = months.map((m) => {
        if (!exists(u, m)) return null;
        const st = strength.get(u)!.get(m)!;
        const sc = scale.get(u)!.get(m)!;
        const qs = strengthConfidence(st);
        const qc = scaleConfidence(sc.components);
        return { s: round1(st.s!), c: round1(sc.c), q: minConfidence(qs, qc), qs, qc };
      });
      world.series[front][u] = arr;
      cells.set(
        u,
        months.map((m, i) => {
          if (!arr[i]) return null;
          const breakdown = strength.get(u)!.get(m)!.breakdown;
          return {
            s: arr[i]!.s,
            c: arr[i]!.c,
            q: arr[i]!.q,
            bestModel: breakdown.find((g) => g.group === eventGroup)?.model ?? null,
            groups: breakdown.map((g) => g.group),
            parts: Object.fromEntries(breakdown.map((g) => [g.group, { value: g.score, weight: g.weight }])),
          };
        }),
      );
      const bd: World['breakdown'][string][string] = {};
      for (const m of months) {
        const st = strength.get(u)!.get(m);
        if (st && st.breakdown.length) {
          const total = st.breakdown.reduce((a, g) => a + g.weight, 0);
          bd[m] = st.breakdown.map((g) => ({
            source: g.group,
            value: round1(g.score),
            weight: round3(g.weight),
            kind: g.reconstructed ? 'reconstructed' : 'measured',
            model: g.model,
            share: round3(g.weight / total),
          }));
        }
      }
      world.breakdown[front][u] = bd;
      const sbd: World['scaleBreakdown'][string][string] = {};
      for (const m of months) {
        const sc = scale.get(u)!.get(m);
        if (sc) sbd[m] = sc.byComponent.map((p) => ({ component: p.component, share: round1(p.share), signals: p.signals }));
      }
      world.scaleBreakdown[front][u] = sbd;
    }

    const ev: WorldEvent[] = detectEvents({
      front: { id: front as FrontId, name: units.fronts[front].name },
      months,
      cells,
      unitNames: Object.fromEntries(fUnits.map((u) => [u.id, u.name])),
      params: method.events,
      releases,
      overrides: eventsFile.overrides.filter((o) => o.front === front),
      custom: eventsFile.custom,
    });
    world.events.push(...ev);
  }
  world.events.sort((a, b) => a.month.localeCompare(b.month) || FRONT_IDS.indexOf(a.front) - FRONT_IDS.indexOf(b.front));
  return validateWorld(world);
}
