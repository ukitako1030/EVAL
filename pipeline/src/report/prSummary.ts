import type { World } from '../compute/world';
import type { FetchStatus } from '../sources/run';

export interface PrSummaryInput {
  /** the previously published world.json; null on the very first run (or when it cannot be read) */
  before: World | null;
  after: World;
  status: FetchStatus[];
  /** compute warnings (deduplicated here) */
  warnings: string[];
  /** exact secret values to mask if they ever show up in an error message (values shorter than 8 characters are ignored) */
  secrets?: string[];
}

/** A unit's latest-month strength s moving by at least this many points is listed under 大きな変動. */
export const MOVER_STRENGTH = 3;
/** A unit's latest-month scale c moving by at least this many points is listed under 大きな変動. */
export const MOVER_SCALE = 2;
export const MAX_MOVERS = 15;
export const MAX_EVENTS = 20;

type Cell = NonNullable<World['series'][string][string][number]>;

/** Masks things that look like credentials in free text taken from error messages (never trust upstream text). */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) if (s.length >= 8) out = out.split(s).join('***');
  return out
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***')
    .replace(/([?&;\s]|^)((?:[a-z_-]*(?:key|token|secret|password|passwd|auth|signature|sig|credential)[a-z_-]*)=)[^&\s"'<>]+/gi, '$1$2***')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '***')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '***')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '***');
}

/**
 * Makes text safe for one Markdown table cell or list item: single line, no raw pipes, no HTML, and no @mentions
 * (a model or series name such as "@cf/meta/llama" must not ping a GitHub user from the PR body).
 */
export function cell(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(?=[A-Za-z0-9_])/g, '@​')
    .trim();
}

const fmt = (n: number): string => n.toFixed(1);
const signed = (n: number): string => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(1);
/** Differences of values rounded to 0.1, kept at that precision so that threshold checks do not depend on float noise. */
const delta = (a: number, b: number): number => Math.round((a - b) * 10) / 10;

interface Leader {
  id: string;
  name: string;
  value: number;
}

/** The unit with the highest `key` in the world's latest month (ties: the first by unit id). */
function leaderOf(w: World, front: string, key: 's' | 'c'): Leader | null {
  const last = w.months.length - 1;
  let best: Leader | null = null;
  for (const id of Object.keys(w.series[front] ?? {}).sort()) {
    const c = w.series[front][id][last];
    if (!c) continue;
    if (best === null || c[key] > best.value) best = { id, name: w.units[front]?.[id]?.name ?? id, value: c[key] };
  }
  return best;
}

function leaderCell(before: Leader | null | undefined, after: Leader | null): string {
  if (!after) return before ? `${cell(before.name)}（${fmt(before.value)}）→ — ⚠` : '—';
  const a = `${cell(after.name)}（${fmt(after.value)}）`;
  if (before === undefined) return a; // no comparison
  if (before === null) return `— → ${a} ⚠`;
  if (before.id !== after.id) return `${cell(before.name)}（${fmt(before.value)}）→ ${a} ⚠`;
  if (before.value !== after.value) return `${cell(after.name)}（${fmt(before.value)} → ${fmt(after.value)}）`;
  return a;
}

function leadersSection(before: World | null, after: World): string[] {
  const rows = after.fronts.map((f) => {
    const hasBefore = before !== null;
    const bs = hasBefore ? leaderOf(before, f.id, 's') : undefined;
    const bc = hasBefore ? leaderOf(before, f.id, 'c') : undefined;
    return `| ${cell(f.name.ja)} | ${leaderCell(bs, leaderOf(after, f.id, 's'))} | ${leaderCell(bc, leaderOf(after, f.id, 'c'))} |`;
  });
  return [
    `### 首位（${after.months[after.months.length - 1]}）`,
    '',
    '| 戦線 | 強さの首位 | 規模の首位 |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ];
}

interface Mover {
  front: string;
  unit: string;
  ds: number;
  dc: number;
  from: Cell;
  to: Cell;
}

/** Units whose latest-month s / c moved noticeably since `before` (the same month if `before` has it, otherwise its latest month). */
export function findMovers(before: World, after: World): Mover[] {
  const month = after.months[after.months.length - 1];
  const bi = before.months.includes(month) ? before.months.indexOf(month) : before.months.length - 1;
  const ai = after.months.length - 1;
  const out: Mover[] = [];
  for (const f of after.fronts) {
    for (const unit of Object.keys(after.series[f.id] ?? {})) {
      const to = after.series[f.id][unit][ai];
      const from = before.series[f.id]?.[unit]?.[bi];
      if (!to || !from) continue; // new unit, or no value on either side: nothing to compare
      const ds = delta(to.s, from.s);
      const dc = delta(to.c, from.c);
      if (Math.abs(ds) >= MOVER_STRENGTH || Math.abs(dc) >= MOVER_SCALE) out.push({ front: f.id, unit, ds, dc, from, to });
    }
  }
  const size = (m: Mover) => Math.max(Math.abs(m.ds), Math.abs(m.dc));
  return out.sort((a, b) => size(b) - size(a) || a.front.localeCompare(b.front) || a.unit.localeCompare(b.unit));
}

function moversSection(before: World, after: World): string[] {
  const movers = findMovers(before, after);
  const out = ['### 大きな変動', '', `強さが ${MOVER_STRENGTH} 以上、または規模が ${MOVER_SCALE} 以上動いた部隊（${after.months[after.months.length - 1]}、前回比）。`, ''];
  if (!movers.length) return [...out, '該当なし。', ''];
  const frontName = new Map<string, string>(after.fronts.map((f) => [f.id, f.name.ja]));
  out.push('| 戦線 | 部隊 | 強さ | 規模 |', '| --- | --- | --- | --- |');
  for (const m of movers.slice(0, MAX_MOVERS)) {
    const name = after.units[m.front]?.[m.unit]?.name ?? m.unit;
    // the figure that crossed its threshold is bold
    const s = `${fmt(m.from.s)} → ${fmt(m.to.s)}（${signed(m.ds)}）`;
    const c = `${fmt(m.from.c)} → ${fmt(m.to.c)}（${signed(m.dc)}）`;
    out.push(`| ${cell(frontName.get(m.front) ?? m.front)} | ${cell(name)} | ${Math.abs(m.ds) >= MOVER_STRENGTH ? `**${s}**` : s} | ${Math.abs(m.dc) >= MOVER_SCALE ? `**${c}**` : c} |`);
  }
  if (movers.length > MAX_MOVERS) out.push('', `ほか ${movers.length - MAX_MOVERS} 件。`);
  return [...out, ''];
}

const eventKey = (e: World['events'][number]): string => `${e.month}|${e.front}|${e.unit}|${e.type}`;

/** Events present in `after` but not in `before` (multiset difference on month|front|unit|type), major first, then newest month first. */
export function newEvents(before: World, after: World): World['events'] {
  const seen = new Map<string, number>();
  for (const e of before.events) seen.set(eventKey(e), (seen.get(eventKey(e)) ?? 0) + 1);
  const fresh: World['events'] = [];
  for (const e of after.events) {
    const left = seen.get(eventKey(e)) ?? 0;
    if (left > 0) seen.set(eventKey(e), left - 1);
    else fresh.push(e);
  }
  return fresh
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Number(b.e.major) - Number(a.e.major) || b.e.month.localeCompare(a.e.month) || a.i - b.i)
    .map((x) => x.e);
}

function eventsSection(events: World['events'], after: World): string[] {
  const out = ['### 新しい戦況速報', ''];
  if (!events.length) return [...out, '新しい速報はありません。', ''];
  const frontName = new Map<string, string>(after.fronts.map((f) => [f.id, f.name.ja]));
  for (const e of events.slice(0, MAX_EVENTS)) {
    out.push(`- ${e.major ? '★ ' : ''}${e.month} ${cell(frontName.get(e.front) ?? e.front)}：${cell(e.text.ja)}`);
  }
  if (events.length > MAX_EVENTS) out.push(`- ほか ${events.length - MAX_EVENTS} 件`);
  return [...out, ''];
}

function newUnitsSection(before: World, after: World): string[] {
  const out = ['### 新部隊', ''];
  const rows: string[] = [];
  for (const f of after.fronts) {
    for (const [id, u] of Object.entries(after.units[f.id] ?? {})) {
      if (Object.hasOwn(before.units[f.id] ?? {}, id)) continue;
      rows.push(`- ${cell(f.name.ja)}：**${cell(u.name)}**（${cell(after.orgs[u.org]?.name ?? u.org)}、${u.since} から）`);
    }
  }
  return [...out, ...(rows.length ? rows : ['新しい部隊はありません。']), ''];
}

function sourcesSection(after: World, status: FetchStatus[], secrets: readonly string[]): string[] {
  const out = ['### データ源', ''];
  const failed = status.filter((s) => s.status === 'failed');
  const skipped = status.filter((s) => s.status === 'skipped');
  const msg = (s: FetchStatus) => cell(redactSecrets(s.error ?? '', secrets));
  if (failed.length) out.push('**取得に失敗**（前回のデータをそのまま使っています）', '', '| データ源 | メッセージ |', '| --- | --- |', ...failed.map((s) => `| ${cell(s.id)} | ${msg(s)} |`), '');
  else out.push('取得に失敗したデータ源はありません。', '');
  if (skipped.length) out.push('**スキップ**', '', '| データ源 | 理由 |', '| --- | --- |', ...skipped.map((s) => `| ${cell(s.id)} | ${msg(s)} |`), '');

  const byId = new Map(status.map((s) => [s.id, s]));
  const label = (s: FetchStatus | undefined) => (s ? { ok: '成功', failed: '失敗', skipped: 'スキップ' }[s.status] : '—');
  const rows = after.sources.map((src) => `| ${cell(src.id)} | ${label(byId.get(src.id))} | ${src.dataThrough ?? '—'} | ${src.asOf ?? '—'} |`);
  const known = new Set(after.sources.map((s) => s.id));
  for (const s of status) if (!known.has(s.id)) rows.push(`| ${cell(s.id)} | ${label(s)} | — | — |`);
  out.push(`<details><summary>すべてのデータ源（${rows.length}）</summary>`, '', '| データ源 | 今回 | データの最新日 | 取得日 |', '| --- | --- | --- | --- |', ...rows, '', '</details>', '');
  return out;
}

function warningsSection(warnings: string[], secrets: readonly string[]): string[] {
  const unique = [...new Set(warnings.map((w) => cell(redactSecrets(w, secrets))))].filter((w) => w !== '');
  if (!unique.length) return [];
  return ['### 警告', '', ...unique.map((w) => `- ${w}`), ''];
}

/** The Markdown body of the weekly "今週の戦況更新" pull request. */
export function renderPrSummary({ before, after, status, warnings, secrets = [] }: PrSummaryInput): string {
  const ok = status.filter((s) => s.status === 'ok').length;
  const skipped = status.filter((s) => s.status === 'skipped').length;
  const failed = status.filter((s) => s.status === 'failed').length;
  const added = before ? newEvents(before, after) : [];

  const lines = [
    `## 今週の戦況更新（${after.generatedAt.slice(0, 10)}）`,
    '',
    `データ源：成功 ${ok} ／ スキップ ${skipped} ／ 失敗 ${failed}　｜　` + (before ? `追加された速報：${added.length} 件` : '前回のデータがないため、前回との比較はありません'),
    '',
    ...leadersSection(before, after),
  ];
  if (before) lines.push(...moversSection(before, after), ...eventsSection(added, after), ...newUnitsSection(before, after));
  lines.push(...sourcesSection(after, status, secrets), ...warningsSection(warnings, secrets));
  lines.push('---', '', '承認（マージ）するとサイトに反映されます。', '数字がおかしい場合は、この PR にコメントするか、該当行を curated/*.yaml で修正してください。', '');
  return lines.join('\n');
}
