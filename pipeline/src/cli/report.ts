import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { renderReport } from '../report/html';
import { validateWorld } from '../compute/world';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const world = validateWorld(JSON.parse(readFileSync(join(root, '..', 'site', 'public', 'data', 'world.json'), 'utf8')));
mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out', 'report.html'), renderReport(world));
console.log('wrote pipeline/out/report.html');
