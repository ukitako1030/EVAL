import { FRONT_IDS, type World } from './types';

export function parseWorld(json: unknown): World {
  const w = json as World;
  if (!w || !Array.isArray(w.months) || !w.months.length) throw new Error('world.json: no months');
  for (const f of FRONT_IDS) {
    if (!w.series?.[f] || !w.units?.[f]) throw new Error(`world.json: missing front ${f}`);
    for (const [u, arr] of Object.entries(w.series[f])) {
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
