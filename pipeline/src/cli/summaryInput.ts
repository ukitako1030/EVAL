import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateWorld, type World } from '../compute/world';
import type { FetchStatus } from '../sources/run';
import type { PrSummaryInput } from '../report/prSummary';

export interface SummaryArgs {
  /** path of the previous world.json; null for `--before none` (first run) */
  before: string | null;
  after: string;
  /** a status JSON file, a directory of raw/_status/<date>.json files, or `latest` */
  status: string;
  warnings: string | null;
  /** output file; null writes to stdout */
  out: string | null;
}

const FLAGS = ['before', 'after', 'status', 'warnings', 'out'] as const;

/** Parses `--flag value` / `--flag=value` arguments; throws a readable error for unknown or missing ones. */
export function parseSummaryArgs(argv: string[]): SummaryArgs {
  const got: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(argv[i]);
    const flag = m?.[1];
    if (!m || !flag || !(FLAGS as readonly string[]).includes(flag)) throw new Error(`unknown argument "${argv[i]}" (expected ${FLAGS.map((f) => `--${f}`).join(' ')})`);
    const value = m[2] ?? argv[++i];
    if (value === undefined || value === '' || (m[2] === undefined && value.startsWith('--'))) throw new Error(`--${flag} needs a value`);
    got[flag] = value;
  }
  for (const f of ['before', 'after', 'status'] as const) if (!got[f]) throw new Error(`--${f} is required`);
  return {
    before: got.before === 'none' ? null : got.before,
    after: got.after,
    status: got.status,
    warnings: got.warnings ?? null,
    out: got.out ?? null,
  };
}

const STATUS_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;

/** `latest` means the newest file of `rawStatusDir`; a directory means its newest <date>.json; anything else is a file path. */
export function resolveStatusFile(arg: string, rawStatusDir: string, cwd: string): string {
  const target = arg === 'latest' ? rawStatusDir : resolve(cwd, arg);
  const isDir = existsSync(target) && statSync(target).isDirectory();
  if (!isDir && arg !== 'latest') return target; // a file: reading it reports a missing or broken one
  const files = isDir ? readdirSync(target).filter((f) => STATUS_FILE.test(f)).sort() : [];
  if (!files.length) throw new Error(`no status file (<date>.json) in ${target}`);
  return join(target, files[files.length - 1]);
}

function readJson(path: string, what: string): unknown {
  if (!existsSync(path)) throw new Error(`${what} not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${what} is not valid JSON (${path}): ${(e as Error).message}`);
  }
}

function parseStatus(raw: unknown, path: string): FetchStatus[] {
  const ok =
    Array.isArray(raw) &&
    raw.every((s) => s && typeof s.id === 'string' && (s.status === 'ok' || s.status === 'skipped' || s.status === 'failed') && (s.error === undefined || typeof s.error === 'string'));
  if (!ok) throw new Error(`status file is not a list of fetch statuses: ${path}`);
  return raw as FetchStatus[];
}

/** Environment variables whose values must never reach the PR body. */
export const SECRET_ENV = ['OPENROUTER_API_KEY', 'CLOUDFLARE_API_TOKEN', 'DESIGNARENA_API_KEY', 'GITHUB_TOKEN'] as const;

/**
 * Reads the files named by the arguments. `after` must be a valid world.json; a `before` that is missing or unreadable as
 * a current-schema world (for example after a schema bump) is reported through `note` and treated as "no comparison".
 */
export function loadSummaryInput(
  args: SummaryArgs,
  opts: { cwd: string; rawStatusDir: string; env: Record<string, string | undefined>; note?: (msg: string) => void },
): PrSummaryInput {
  const { cwd, env } = opts;
  const note = opts.note ?? (() => {});
  const after: World = validateWorld(readJson(resolve(cwd, args.after), '--after world.json'));

  let before: World | null = null;
  if (args.before !== null) {
    const raw = readJson(resolve(cwd, args.before), '--before world.json');
    try {
      before = validateWorld(raw);
    } catch (e) {
      note(`--before is not a readable world.json of the current schema, so no comparison is made: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  const statusPath = resolveStatusFile(args.status, opts.rawStatusDir, cwd);
  const status = parseStatus(readJson(statusPath, 'status file'), statusPath);

  let warnings: string[] = [];
  if (args.warnings !== null) {
    const p = resolve(cwd, args.warnings);
    if (existsSync(p)) {
      const raw = readJson(p, 'warnings file');
      if (!Array.isArray(raw) || !raw.every((w) => typeof w === 'string')) throw new Error(`warnings file is not a list of strings: ${p}`);
      warnings = raw;
    } else note(`warnings file not found (${p}); continuing without warnings`);
  }

  const secrets = SECRET_ENV.map((k) => env[k]).filter((v): v is string => typeof v === 'string' && v.length > 0);
  return { before, after, status, warnings, secrets };
}
