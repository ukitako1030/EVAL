import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderPrSummary } from '../report/prSummary';
import { loadSummaryInput, parseSummaryArgs } from './summaryInput';
import { loadDotEnv } from './dotenv';

// Usage: npm run summary -- --before <path|none> --after <world.json> --status <file|dir|latest> [--warnings <file>] [--out <file>]
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

try {
  const args = parseSummaryArgs(process.argv.slice(2));
  const env = { ...loadDotEnv(join(root, '..', '.env')), ...process.env };
  const input = loadSummaryInput(args, {
    cwd: process.cwd(),
    rawStatusDir: join(root, 'raw', '_status'),
    env,
    note: (m) => console.warn(`summary: ${m}`),
  });
  const md = renderPrSummary(input);
  if (args.out) {
    const out = resolve(process.cwd(), args.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, md);
    console.log(`wrote ${args.out} (${md.length} chars)`);
  } else process.stdout.write(md);
} catch (e) {
  console.error(`summary: ${(e as Error).message}`);
  process.exitCode = 1;
}
