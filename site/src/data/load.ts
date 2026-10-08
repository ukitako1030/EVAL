import { FRONT_IDS, type World } from './types';

/** The world.json contract this build understands (pipeline/src/compute/world.ts `schemaVersion`). */
export const SUPPORTED_SCHEMA_VERSION = 2;

export function parseWorld(json: unknown): World {
  const w = json as World;
  if (!w || !Array.isArray(w.months) || !w.months.length) throw new Error('world.json: no months');
  if (w.schemaVersion !== SUPPORTED_SCHEMA_VERSION) throw new Error(`world.json: unsupported schema version ${w.schemaVersion}`);
  for (const f of FRONT_IDS) {
    if (!w.series?.[f] || !w.units?.[f]) throw new Error(`world.json: missing front ${f}`);
    for (const u of Object.keys(w.units[f])) {
      if (!Object.hasOwn(w.series[f], u)) throw new Error(`world.json: units/series mismatch for ${f}.${u}`);
    }
    for (const [u, arr] of Object.entries(w.series[f])) {
      if (!Object.hasOwn(w.units[f], u)) throw new Error(`world.json: units/series mismatch for ${f}.${u}`);
      if (arr.length !== w.months.length) throw new Error(`world.json: months/series length mismatch for ${f}.${u}`);
    }
  }
  return w;
}

export async function loadWorld(url = './data/world.json'): Promise<World> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`world.json: HTTP ${res.status}`);
  return parseWorld(await res.json());
}
