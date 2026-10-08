import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SOURCES } from '../sources/index';
import { computeWorld } from '../compute/index';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const world = computeWorld({
  rawDir: join(root, 'raw'),
  curatedDir: join(root, 'curated'),
  methodPath: join(root, 'config', 'method.yaml'),
  modules: SOURCES,
  now: new Date(),
});
const outDir = join(root, '..', 'site', 'public', 'data');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'world.json'), JSON.stringify(world));
const last = world.months.length - 1;
for (const f of world.fronts) {
  const top = Object.entries(world.series[f.id])
    .filter(([, arr]) => arr[last])
    .sort((a, b) => b[1][last]!.s - a[1][last]!.s)[0];
  console.log(`${f.name.ja}: ${Object.keys(world.units[f.id]).length} units, leader ${top ? world.units[f.id][top[0]].name : '—'}`);
}
console.log(`events: ${world.events.length}; wrote site/public/data/world.json`);
