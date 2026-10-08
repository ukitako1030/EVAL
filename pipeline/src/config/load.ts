import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { FRONT_IDS, SIGNAL_IDS, type FrontId, type Localized } from '../core/types';
import type { Month } from '../core/months';
import {
  UnitsFileSchema,
  MethodSchema,
  AnnouncementsSchema,
  EventsFileSchema,
  ReleasesFileSchema,
  type Method,
  type Announcements,
  type EventsFile,
} from './schemas';

export interface CompiledUnit {
  id: string;
  front: FrontId;
  org: string;
  name: string;
  since: Month;
  until?: Month;
  regexes: RegExp[];
  orgRegex?: RegExp;
  scale: z.infer<typeof UnitsFileSchema>['fronts'][string]['units'][string]['scale'];
}

export interface UnitsConfig {
  /** A model matching any of these is assigned to no unit (see matchUnit). */
  exclude: RegExp[];
  orgs: Record<string, { name: string; color: string }>;
  fronts: Record<FrontId, { name: Localized }>;
  units: Record<FrontId, CompiledUnit[]>;
}

export interface CompiledRelease {
  regex: RegExp;
  release: Month;
  display?: string;
}

function validate<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`${label}: ${msg}`);
  }
  return r.data;
}

function compileRegex(src: string, where: string): RegExp {
  try {
    return new RegExp(src, 'i');
  } catch (e) {
    throw new Error(`${where}: invalid regex "${src}": ${(e as Error).message}`);
  }
}

/** A key (hostname, article, app id, slug prefix, announcement series…) counted for two units of one front would be double-counted. */
function rejectSharedScaleKeys(front: FrontId, units: CompiledUnit[]): void {
  for (const signal of SIGNAL_IDS) {
    const owner = new Map<string, string>();
    for (const u of units) {
      const v: string | string[] | undefined = u.scale[signal];
      for (const key of new Set(Array.isArray(v) ? v : v ? [v] : [])) {
        const other = owner.get(key);
        if (other !== undefined) {
          throw new Error(`units.yaml: ${front}: ${signal} key "${key}" is configured for both "${other}" and "${u.id}"`);
        }
        owner.set(key, u.id);
      }
    }
  }
}

export function parseUnits(text: string): UnitsConfig {
  const raw = validate(UnitsFileSchema, parseYaml(text), 'units.yaml');
  for (const f of FRONT_IDS) if (!raw.fronts[f]) throw new Error(`units.yaml: missing front "${f}"`);
  for (const k of Object.keys(raw.fronts)) {
    if (!(FRONT_IDS as readonly string[]).includes(k)) throw new Error(`units.yaml: unknown front "${k}"`);
  }
  const fronts = {} as UnitsConfig['fronts'];
  const units = {} as UnitsConfig['units'];
  for (const f of FRONT_IDS) {
    fronts[f] = { name: raw.fronts[f].name };
    units[f] = Object.entries(raw.fronts[f].units).map(([id, u]) => {
      if (!Object.hasOwn(raw.orgs, u.org)) throw new Error(`units.yaml: ${f}.${id}: unknown org "${u.org}"`);
      return {
        id,
        front: f,
        org: u.org,
        name: u.name,
        since: u.since,
        until: u.until,
        regexes: u.match.map((m) => compileRegex(m, `units.yaml: ${f}.${id}`)),
        orgRegex: u.orgMatch ? compileRegex(u.orgMatch, `units.yaml: ${f}.${id}`) : undefined,
        scale: u.scale,
      };
    });
    rejectSharedScaleKeys(f, units[f]);
  }
  return { exclude: raw.exclude.map((m) => compileRegex(m, 'units.yaml: exclude')), orgs: raw.orgs, fronts, units };
}

export function parseMethod(text: string): Method {
  const m = validate(MethodSchema, parseYaml(text), 'method.yaml');
  for (const f of Object.keys(m.strength.weights)) {
    if (!(FRONT_IDS as readonly string[]).includes(f)) throw new Error(`method.yaml: unknown front "${f}" in weights`);
  }
  for (const b of m.scale.base) {
    if (!Object.hasOwn(m.scale.components, b)) throw new Error(`method.yaml: base component "${b}" is not defined`);
  }
  return m;
}

export function parseAnnouncements(text: string): Announcements {
  return validate(AnnouncementsSchema, parseYaml(text) ?? { series: {} }, 'announcements.yaml');
}

export function parseEvents(text: string): EventsFile {
  return validate(EventsFileSchema, parseYaml(text) ?? {}, 'events.yaml');
}

export function parseReleases(text: string): CompiledRelease[] {
  const r = validate(ReleasesFileSchema, parseYaml(text) ?? {}, 'releases.yaml');
  return r.models.map((m) => ({ regex: compileRegex(m.match, 'releases.yaml'), release: m.release, display: m.display }));
}

export const readText = (path: string): string => readFileSync(path, 'utf8');
