import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SOURCES } from '../sources/index';
import { computeWorld } from '../compute/index';
import { runDate } from './runDate';
import { writeWarnings } from './outputs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const warnings: string[] = [];
const rawDir = join(root, 'raw');
// noon UTC of the latest fetch (raw/_status), so that rerunning compute on the same raw data is deterministic
const now = runDate(rawDir);
const world = computeWorld({
  rawDir,
  curatedDir: join(root, 'curated'),
  methodPath: join(root, 'config', 'method.yaml'),
  modules: SOURCES,
  now,
  onWarn: (msg) => warnings.push(msg),
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
console.log(`events: ${world.events.length}; generatedAt ${world.generatedAt}; wrote site/public/data/world.json`);
// machine-readable copy for the weekly pull request summary (pipeline/out/warnings.json; [] when there are none)
const unique = writeWarnings(join(root, 'out'), warnings);
if (unique.length) {
  console.log('');
  console.log(`warnings (${unique.length}):`);
  for (const w of unique) console.log(`  - ${w}`);
}
