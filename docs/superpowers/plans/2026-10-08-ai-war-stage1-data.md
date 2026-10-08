# AI WAR Stage 1 (Data Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `pipeline/` package that fetches public AI leaderboard/usage data, computes monthly strength (s), scale (c) and confidence (q) for every unit on 7 fronts from 2022-11 to now, detects battle events, and writes `site/public/data/world.json` plus a human-readable `pipeline/out/report.html`.

**Architecture:** Each data source is a small module (`fetch()` → raw payload, `parse()` → normalized observations) whose output is stored as dated JSON snapshots under `pipeline/raw/`. A pure, fully-tested compute layer reads snapshots + curated YAML (`units.yaml`, `announcements.yaml`, `events.yaml`, `releases.yaml`) + `config/method.yaml`, and produces `world.json` validated by a zod schema. Network code is thin; all logic lives in pure functions tested with real fixtures captured during recon (`pipeline/test/fixtures/<sourceId>/`).

**Tech Stack:** Node 24, TypeScript (run via `tsx`, `moduleResolution: Bundler`, extensionless imports), vitest, zod, yaml, csv-parse, hyparquet (+ hyparquet-compressors), fflate, xlsx.

**Spec:** `docs/superpowers/specs/2026-10-08-ai-war-design.md` (§4–§6 are the source of truth for behaviour).
**Recon notes (source schemas):** `docs/superpowers/recon/sources-llm.md`, `sources-media.md`, `sources-scale.md`.

---

## File Structure

```
pipeline/
├─ package.json, tsconfig.json, vitest.config.ts
├─ config/method.yaml                 weights & parameters (spec §6)
├─ curated/
│   ├─ units.yaml                     orgs, fronts, units, model-name regexes, scale identifiers
│   ├─ announcements.yaml             official user counts (url required)
│   ├─ events.yaml                    event text overrides / hides / custom events
│   └─ releases.yaml                  model → release month (+ display name) for reconstruction & event text
├─ src/
│   ├─ core/months.ts                 'YYYY-MM' month arithmetic
│   ├─ core/math.ts                   sigmoid/logit/means/interp
│   ├─ core/types.ts                  shared types (Observation, SignalObs, Confidence, World…)
│   ├─ config/schemas.ts              zod schemas for all YAML files
│   ├─ config/load.ts                 read + validate + compile YAML
│   ├─ raw/store.ts                   dated raw snapshot files
│   ├─ compute/assign.ts              observations → unit × month values per series
│   ├─ compute/strength.ts            per-month normalisation, group combine, estimation
│   ├─ compute/announcements.ts       announcement points → monthly users
│   ├─ compute/signals.ts             scale SignalObs → signal tables per unit
│   ├─ compute/scale.ts               component shares → scale share + smoothing
│   ├─ compute/confidence.ts          confidence rules
│   ├─ compute/events.ts              event detection + overrides + text
│   ├─ compute/world.ts               World zod schema + assembly
│   ├─ compute/index.ts               computeWorld() orchestrator
│   ├─ sources/types.ts               SourceModule / FetchCtx interfaces
│   ├─ sources/http.ts                fetch with retry/timeout/UA
│   ├─ sources/run.ts                 runFetch() (status, env skipping)
│   ├─ sources/index.ts               registry of all modules
│   ├─ sources/<sourceId>.ts          one file per source (Part B tasks)
│   ├─ report/html.ts                 world.json → report.html
│   └─ cli/{fetch,compute,report}.ts  entry points
├─ raw/<sourceId>/<YYYY-MM-DD>.json   committed snapshots; raw/_status/<date>.json
├─ out/                               gitignored (report.html)
└─ test/                              mirrors src/; fixtures/<sourceId>/ from recon
```

Conventions used everywhere:
- Months are strings `'YYYY-MM'`; dates are `'YYYY-MM-DD'`. Lexicographic comparison is valid for both.
- All strength values are "higher is better". Percent values are always on a 0–100 scale (parsers convert fractions).
- Imports are extensionless (`from '../core/months'`).
- Run all commands from `pipeline/` unless stated.

---

# Part A — Core

### Task 1: Scaffold the pipeline package

**Files:**
- Create: `pipeline/package.json`, `pipeline/tsconfig.json`, `pipeline/vitest.config.ts`, `pipeline/test/smoke.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "ai-war-pipeline",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "fetch": "tsx src/cli/fetch.ts",
    "compute": "tsx src/cli/compute.ts",
    "report": "tsx src/cli/report.ts"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run (in `pipeline/`):
```bash
npm install zod yaml csv-parse hyparquet hyparquet-compressors fflate xlsx
npm install -D typescript tsx vitest @types/node
```
Expected: `added N packages`, no errors.

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 5: Write smoke test**

`pipeline/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: `1 passed`, typecheck prints nothing.

- [ ] **Step 7: Ignore build output**

Append to repo-root `.gitignore`:
```
pipeline/out/
```

- [ ] **Step 8: Commit**

```bash
git add .gitignore pipeline/package.json pipeline/package-lock.json pipeline/tsconfig.json pipeline/vitest.config.ts pipeline/test/smoke.test.ts
git commit -m "chore(pipeline): scaffold TypeScript package with vitest"
```

---

### Task 2: Month arithmetic

**Files:**
- Create: `pipeline/src/core/months.ts`
- Test: `pipeline/test/core/months.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { toMonth, addMonths, monthRange, monthEnd, daysBetween, monthDiff } from '../../src/core/months';

describe('months', () => {
  it('toMonth parses dates, months and Date objects', () => {
    expect(toMonth('2025-03-15')).toBe('2025-03');
    expect(toMonth('2025-03')).toBe('2025-03');
    expect(toMonth('2025-03-15T10:00:00Z')).toBe('2025-03');
    expect(toMonth(new Date(Date.UTC(2024, 11, 31)))).toBe('2024-12');
  });
  it('toMonth rejects garbage', () => {
    expect(() => toMonth('March 2025')).toThrow();
  });
  it('addMonths crosses years both ways', () => {
    expect(addMonths('2022-11', 2)).toBe('2023-01');
    expect(addMonths('2023-01', -1)).toBe('2022-12');
    expect(addMonths('2024-06', 0)).toBe('2024-06');
  });
  it('monthRange is inclusive', () => {
    expect(monthRange('2022-11', '2023-02')).toEqual(['2022-11', '2022-12', '2023-01', '2023-02']);
    expect(monthRange('2023-02', '2023-01')).toEqual([]);
  });
  it('monthEnd handles leap years', () => {
    expect(monthEnd('2024-02')).toBe('2024-02-29');
    expect(monthEnd('2023-02')).toBe('2023-02-28');
    expect(monthEnd('2023-12')).toBe('2023-12-31');
  });
  it('daysBetween and monthDiff', () => {
    expect(daysBetween('2025-01-01', '2025-03-01')).toBe(59);
    expect(daysBetween('2025-03-01', '2025-01-01')).toBe(-59);
    expect(monthDiff('2024-11', '2025-02')).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/core/months.test.ts`
Expected: FAIL — cannot resolve `../../src/core/months`.

- [ ] **Step 3: Implement**

`pipeline/src/core/months.ts`:
```ts
export type Month = string; // 'YYYY-MM'

export function toMonth(date: string | Date): Month {
  if (typeof date === 'string') {
    const m = /^(\d{4})-(\d{2})/.exec(date);
    if (!m) throw new Error(`toMonth: unparseable date "${date}"`);
    return `${m[1]}-${m[2]}`;
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function addMonths(m: Month, n: number): Month {
  const [y, mo] = m.split('-').map(Number);
  const idx = y * 12 + (mo - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function monthRange(start: Month, end: Month): Month[] {
  const out: Month[] = [];
  for (let m = start; m <= end; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Last calendar day of the month as 'YYYY-MM-DD'. */
export function monthEnd(m: Month): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}

/** b − a in whole days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

/** b − a in months. */
export function monthDiff(a: Month, b: Month): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function todayISO(now: Date): string {
  return now.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/core/months.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/core/months.ts pipeline/test/core/months.test.ts
git commit -m "feat(pipeline): month arithmetic helpers"
```

---

### Task 3: Math helpers

**Files:**
- Create: `pipeline/src/core/math.ts`
- Test: `pipeline/test/core/math.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { clamp, sigmoid, logit, weightedMean, mean, sum, trailingMean, logInterp, round1 } from '../../src/core/math';

describe('math', () => {
  it('clamp/sigmoid/logit', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(sigmoid(0)).toBe(0.5);
    expect(logit(0.5)).toBe(0);
    expect(sigmoid(logit(0.8))).toBeCloseTo(0.8, 10);
  });
  it('weightedMean ignores non-positive weights and returns null when empty', () => {
    expect(weightedMean([{ value: 10, weight: 1 }, { value: 20, weight: 3 }])).toBe(17.5);
    expect(weightedMean([{ value: 10, weight: 0 }])).toBeNull();
    expect(weightedMean([])).toBeNull();
  });
  it('mean/sum', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBeNull();
    expect(sum([1, 2, 3])).toBe(6);
  });
  it('trailingMean skips nulls and keeps null where the current value is null', () => {
    expect(trailingMean([1, 3, null, 5, 7], 3)).toEqual([1, 2, null, 4, 6]);
  });
  it('logInterp interpolates geometrically', () => {
    expect(logInterp(0, 100, 10, 10000, 5)).toBeCloseTo(1000, 6);
    expect(logInterp(3, 50, 3, 80, 3)).toBe(50);
  });
  it('round1', () => {
    expect(round1(12.345)).toBe(12.3);
    expect(round1(12.35)).toBe(12.4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/core/math.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`pipeline/src/core/math.ts`:
```ts
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
export const logit = (p: number): number => Math.log(p / (1 - p));

export function sum(xs: Iterable<number>): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs: number[]): number | null {
  return xs.length ? sum(xs) / xs.length : null;
}

export function weightedMean(items: { value: number; weight: number }[]): number | null {
  let sw = 0;
  let s = 0;
  for (const it of items) {
    if (it.weight > 0 && Number.isFinite(it.value)) {
      sw += it.weight;
      s += it.weight * it.value;
    }
  }
  return sw > 0 ? s / sw : null;
}

/** Mean of the last `window` non-null values ending at i; null where series[i] is null. */
export function trailingMean(series: (number | null)[], window: number): (number | null)[] {
  return series.map((cur, i) => {
    if (cur === null) return null;
    const vals = series.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v !== null);
    return sum(vals) / vals.length;
  });
}

/** Geometric interpolation between (x0,y0) and (x1,y1); y values must be > 0. */
export function logInterp(x0: number, y0: number, x1: number, y1: number, x: number): number {
  if (x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return Math.exp(Math.log(y0) + (Math.log(y1) - Math.log(y0)) * t);
}

export const round1 = (x: number): number => Math.round(x * 10 + Number.EPSILON) / 10;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/core/math.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/core/math.ts pipeline/test/core/math.test.ts
git commit -m "feat(pipeline): math helpers"
```

---

### Task 4: Shared types

**Files:**
- Create: `pipeline/src/core/types.ts`
- Test: `pipeline/test/core/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { minConfidence, FRONT_IDS, SIGNAL_IDS, RANK_SIGNALS } from '../../src/core/types';

describe('types', () => {
  it('minConfidence picks the weaker level', () => {
    expect(minConfidence('high', 'medium')).toBe('medium');
    expect(minConfidence('reconstructed', 'high')).toBe('reconstructed');
    expect(minConfidence('estimated', 'reconstructed')).toBe('estimated');
    expect(minConfidence('high', 'high')).toBe('high');
  });
  it('declares 7 fronts and rank-type signals', () => {
    expect(FRONT_IDS).toEqual(['general', 'code', 'agent', 'image', 'video', 'speech', 'music']);
    expect(SIGNAL_IDS).toContain('announcements');
    expect([...RANK_SIGNALS].sort()).toEqual(['cloudflare', 'crux', 'tranco']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/core/types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`pipeline/src/core/types.ts`:
```ts
import type { Month } from './months';

export const FRONT_IDS = ['general', 'code', 'agent', 'image', 'video', 'speech', 'music'] as const;
export type FrontId = (typeof FRONT_IDS)[number];

/** How a strength value is compared with the month's leader (spec §6.1-2). */
export type ValueKind = 'elo' | 'percent' | 'minutes' | 'eci';

/** One model-level strength measurement from a source. Higher value = better. */
export interface Observation {
  /** Series id. Defaults to the source id; version-split sources use e.g. 'epoch-terminalbench@2.0'. */
  series: string;
  kind: ValueKind;
  model: string;
  org?: string;
  /** 'YYYY-MM-DD'. Snapshot date for 'snapshot', model release (or submission) date for 'release'. */
  date: string;
  dateKind: 'snapshot' | 'release';
  /** elo rating | percent 0–100 | minutes | ECI points */
  value: number;
}

export const SIGNAL_IDS = [
  'announcements',
  'crux',
  'tranco',
  'cloudflare',
  'statcounter',
  'ramp',
  'openrouter',
  'wikipedia',
  'itunes',
] as const;
export type SignalId = (typeof SIGNAL_IDS)[number];

/** Signals whose raw value is a rank (lower = bigger). Converted to 1/rank before use. */
export const RANK_SIGNALS: ReadonlySet<SignalId> = new Set<SignalId>(['crux', 'tranco', 'cloudflare']);

/** One scale measurement for an identifier (hostname, article, app id, vendor, slug…) in a month. */
export interface SignalObs {
  signal: SignalId;
  key: string;
  month: Month;
  value: number;
}

export type Confidence = 'high' | 'medium' | 'reconstructed' | 'estimated';
const CONF_ORDER: Confidence[] = ['estimated', 'reconstructed', 'medium', 'high'];

export function minConfidence(a: Confidence, b: Confidence): Confidence {
  return CONF_ORDER.indexOf(a) <= CONF_ORDER.indexOf(b) ? a : b;
}

export interface Localized {
  ja: string;
  en: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/core/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/core/types.ts pipeline/test/core/types.test.ts
git commit -m "feat(pipeline): shared core types"
```

---

### Task 5: Config schemas and loaders

**Files:**
- Create: `pipeline/src/config/schemas.ts`, `pipeline/src/config/load.ts`
- Test: `pipeline/test/config/load.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseUnits, parseMethod, parseAnnouncements, parseEvents, parseReleases } from '../../src/config/load';

const FRONTS = ['general', 'code', 'agent', 'image', 'video', 'speech', 'music'];
const frontsYaml = (extra = '') =>
  FRONTS.map((f) => `  ${f}:\n    name: { ja: ${f}JA, en: ${f}EN }\n    units: {}`).join('\n') + extra;

const UNITS = `
orgs:
  openai: { name: OpenAI, color: '#19c37d' }
fronts:
${frontsYaml().replace(
  '  general:\n    name: { ja: generalJA, en: generalEN }\n    units: {}',
  `  general:
    name: { ja: 総合戦線, en: General Front }
    units:
      gpt:
        org: openai
        name: GPT
        since: 2022-11
        match: ['^gpt', '^o[134]']
        scale: { crux: [chatgpt.com], wikipedia: [ChatGPT] }`,
)}
`;

const METHOD = `
start: 2022-11
strength:
  minUnits: 2
  snapshotMaxAgeDays: 92
  releaseActiveMonths: 3
  kinds: { elo: { scale: 400 }, percent: { clampLo: 0.5, clampHi: 99.5 }, minutes: { kappa: 1 }, eci: { tau: 8 } }
  estimate: { floor: 60, step: 6 }
  weights:
    general: { arena-text: 0.5, epoch-eci: 0.5 }
scale:
  smoothingMonths: 3
  announcementStaleMonths: 6
  metricFactors: { MAU: 1, WAU: 1.4, DAU: 2.5 }
  floorFactor: 0.5
  components:
    users: { weight: 0.45, signals: [announcements] }
    attention: { weight: 0.1, signals: [wikipedia] }
  base: [attention]
events: { newModelMinDelta: 3, surgeStrength: 5, surgeScale: 5, leadHysteresis: 1, maxPerFrontMonth: 3 }
`;

describe('config loaders', () => {
  it('parses and compiles units', () => {
    const u = parseUnits(UNITS);
    expect(u.orgs.openai.color).toBe('#19c37d');
    expect(u.fronts.general.name.en).toBe('General Front');
    const gpt = u.units.general[0];
    expect(gpt.id).toBe('gpt');
    expect(gpt.since).toBe('2022-11');
    expect(gpt.regexes[0].test('GPT-4o')).toBe(true); // case-insensitive
    expect(gpt.regexes[1].test('o3-pro')).toBe(true);
    expect(gpt.scale.crux).toEqual(['chatgpt.com']);
    expect(u.units.code).toEqual([]);
  });
  it('rejects units with unknown org', () => {
    expect(() => parseUnits(UNITS.replace('org: openai', 'org: nobody'))).toThrow(/unknown org "nobody"/);
  });
  it('rejects a missing front', () => {
    expect(() => parseUnits(UNITS.replace(/  music:[\s\S]*$/, ''))).toThrow(/music/);
  });
  it('parses method and rejects unknown base component', () => {
    const m = parseMethod(METHOD);
    expect(m.strength.weights.general['arena-text']).toBe(0.5);
    expect(() => parseMethod(METHOD.replace('base: [attention]', 'base: [nope]'))).toThrow(/base component "nope"/);
  });
  it('parses announcements, requiring a url on every point', () => {
    const a = parseAnnouncements(`
series:
  chatgpt:
    metric: WAU
    points:
      - { date: 2023-11-06, value: 100000000, url: https://example.com/a }
`);
    expect(a.series.chatgpt.points[0].value).toBe(100000000);
    expect(() =>
      parseAnnouncements(`
series:
  chatgpt: { metric: WAU, points: [ { date: 2023-11-06, value: 1 } ] }
`),
    ).toThrow();
  });
  it('parses events and releases', () => {
    const e = parseEvents(`
overrides:
  - { month: 2025-03, front: general, unit: gemini, type: new_model, text: { ja: あ, en: a } }
  - { month: 2025-04, front: general, unit: gpt, type: surge, hide: true }
custom:
  - { month: 2022-11, front: general, unit: gpt, text: { ja: 開戦, en: War begins } }
`);
    expect(e.overrides).toHaveLength(2);
    expect(e.custom[0].text.ja).toBe('開戦');
    const r = parseReleases(`
models:
  - { match: '^dall-e-3', release: 2023-10, display: DALL·E 3 }
`);
    expect(r[0].regex.test('DALL-E-3')).toBe(true);
    expect(r[0].release).toBe('2023-10');
    expect(r[0].display).toBe('DALL·E 3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config/load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement schemas**

`pipeline/src/config/schemas.ts`:
```ts
import { z } from 'zod';
import { FRONT_IDS, SIGNAL_IDS } from '../core/types';

export const MonthStr = z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM');
export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const FrontIdSchema = z.enum(FRONT_IDS);
export const SignalIdSchema = z.enum(SIGNAL_IDS);
export const LocalizedSchema = z.object({ ja: z.string().min(1), en: z.string().min(1) });

export const UnitScaleSchema = z
  .object({
    announcements: z.string().optional(),
    crux: z.array(z.string()).optional(),
    tranco: z.array(z.string()).optional(),
    cloudflare: z.array(z.string()).optional(),
    statcounter: z.array(z.string()).optional(),
    ramp: z.array(z.string()).optional(),
    openrouter: z.array(z.string()).optional(), // slug prefixes
    wikipedia: z.array(z.string()).optional(),
    itunes: z.array(z.string()).optional(),
  })
  .strict();

export const UnitSchema = z
  .object({
    org: z.string(),
    name: z.string().min(1),
    since: MonthStr,
    until: MonthStr.optional(),
    match: z.array(z.string()).default([]),
    orgMatch: z.string().optional(),
    scale: UnitScaleSchema.default({}),
  })
  .strict();

export const UnitsFileSchema = z.object({
  orgs: z.record(z.string(), z.object({ name: z.string(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })),
  fronts: z.record(z.string(), z.object({ name: LocalizedSchema, units: z.record(z.string(), UnitSchema).default({}) })),
});

export const MethodSchema = z.object({
  start: MonthStr,
  strength: z.object({
    minUnits: z.number().int().min(1),
    snapshotMaxAgeDays: z.number().int().positive(),
    releaseActiveMonths: z.number().int().min(0),
    kinds: z.object({
      elo: z.object({ scale: z.number().positive() }),
      percent: z.object({ clampLo: z.number(), clampHi: z.number() }),
      minutes: z.object({ kappa: z.number().positive() }),
      eci: z.object({ tau: z.number().positive() }),
    }),
    estimate: z.object({ floor: z.number(), step: z.number() }),
    weights: z.record(z.string(), z.record(z.string(), z.number().positive())),
  }),
  scale: z.object({
    smoothingMonths: z.number().int().min(1),
    announcementStaleMonths: z.number().int().min(0),
    metricFactors: z.object({ MAU: z.number().positive(), WAU: z.number().positive(), DAU: z.number().positive() }),
    floorFactor: z.number().positive(),
    components: z.record(z.string(), z.object({ weight: z.number().positive(), signals: z.array(SignalIdSchema).min(1) })),
    base: z.array(z.string()).min(1),
  }),
  events: z.object({
    newModelMinDelta: z.number(),
    surgeStrength: z.number(),
    surgeScale: z.number(),
    leadHysteresis: z.number(),
    maxPerFrontMonth: z.number().int().positive(),
  }),
});
export type Method = z.infer<typeof MethodSchema>;
export type KindParams = Method['strength']['kinds'];

export const MetricSchema = z.enum(['MAU', 'WAU', 'DAU']);
export const AnnouncementsSchema = z.object({
  series: z.record(
    z.string(),
    z.object({
      metric: MetricSchema,
      points: z.array(
        z.object({
          date: DateStr,
          value: z.number().positive(),
          metric: MetricSchema.optional(),
          url: z.string().url(),
          note: z.string().optional(),
        }),
      ),
    }),
  ),
});
export type Announcements = z.infer<typeof AnnouncementsSchema>;
export type AnnSeries = Announcements['series'][string];

export const EVENT_TYPES = ['new_unit', 'new_model', 'lead_change', 'scale_lead_change', 'surge', 'custom'] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export const EventsFileSchema = z.object({
  overrides: z
    .array(
      z.object({
        month: MonthStr,
        front: FrontIdSchema,
        unit: z.string(),
        type: EventTypeSchema,
        text: LocalizedSchema.optional(),
        hide: z.boolean().optional(),
      }),
    )
    .default([]),
  custom: z
    .array(z.object({ month: MonthStr, front: FrontIdSchema, unit: z.string(), text: LocalizedSchema }))
    .default([]),
});
export type EventsFile = z.infer<typeof EventsFileSchema>;

export const ReleasesFileSchema = z.object({
  models: z.array(z.object({ match: z.string(), release: MonthStr, display: z.string().optional() })).default([]),
});
```

- [ ] **Step 4: Implement loaders**

`pipeline/src/config/load.ts`:
```ts
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { FRONT_IDS, type FrontId, type Localized } from '../core/types';
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
      if (!raw.orgs[u.org]) throw new Error(`units.yaml: ${f}.${id}: unknown org "${u.org}"`);
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
  }
  return { orgs: raw.orgs, fronts, units };
}

export function parseMethod(text: string): Method {
  const m = validate(MethodSchema, parseYaml(text), 'method.yaml');
  for (const f of Object.keys(m.strength.weights)) {
    if (!(FRONT_IDS as readonly string[]).includes(f)) throw new Error(`method.yaml: unknown front "${f}" in weights`);
  }
  for (const b of m.scale.base) {
    if (!m.scale.components[b]) throw new Error(`method.yaml: base component "${b}" is not defined`);
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/config/load.test.ts`
Expected: PASS (6 tests). If the YAML library parses `2022-11` as a non-string, confirm `yaml` is v2 (YAML 1.2 core schema keeps it a string).

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/config pipeline/test/config
git commit -m "feat(pipeline): zod schemas and loaders for curated YAML"
```

---

### Task 6: Raw snapshot store

**Files:**
- Create: `pipeline/src/raw/store.ts`
- Test: `pipeline/test/raw/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSnapshot, listSnapshotDates, loadSource, latestSnapshotDate } from '../../src/raw/store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'raw-'));
});

describe('raw store', () => {
  it('saves one item per line and lists dates ascending', () => {
    saveSnapshot(dir, 'src-a', '2026-10-05', [{ a: 1 }, { a: 2 }], 'full');
    saveSnapshot(dir, 'src-a', '2026-09-28', [{ a: 0 }], 'accumulate');
    const text = readFileSync(join(dir, 'src-a', '2026-10-05.json'), 'utf8');
    expect(text.split('\n').filter((l) => l.startsWith('{"a"'))).toHaveLength(2);
    expect(listSnapshotDates(dir, 'src-a')).toEqual(['2026-09-28', '2026-10-05']);
    expect(latestSnapshotDate(dir, 'src-a')).toBe('2026-10-05');
    expect(listSnapshotDates(dir, 'missing')).toEqual([]);
  });
  it('full history keeps only the newest file and loads it', () => {
    saveSnapshot(dir, 'full-src', '2026-09-28', [{ v: 1 }], 'full');
    saveSnapshot(dir, 'full-src', '2026-10-05', [{ v: 2 }], 'full');
    expect(readdirSync(join(dir, 'full-src'))).toEqual(['2026-10-05.json']);
    expect(loadSource(dir, 'full-src', 'full')).toEqual([{ v: 2 }]);
  });
  it('accumulate merges all files and de-duplicates identical items', () => {
    saveSnapshot(dir, 'acc', '2026-09-28', [{ k: 'x', m: '2026-09' }], 'accumulate');
    saveSnapshot(dir, 'acc', '2026-10-05', [{ k: 'x', m: '2026-09' }, { k: 'x', m: '2026-10' }], 'accumulate');
    expect(loadSource(dir, 'acc', 'accumulate')).toEqual([
      { k: 'x', m: '2026-09' },
      { k: 'x', m: '2026-10' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/raw/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`pipeline/src/raw/store.ts`:
```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type HistoryMode = 'full' | 'accumulate';

interface SnapshotFile<T> {
  sourceId: string;
  date: string;
  items: T[];
}

/**
 * Writes raw/<sourceId>/<date>.json with one item per line (git-friendly diffs).
 * 'full' sources contain their whole history in every fetch, so older files are deleted.
 */
export function saveSnapshot<T>(rawDir: string, sourceId: string, date: string, items: T[], mode: HistoryMode): string {
  const dir = join(rawDir, sourceId);
  mkdirSync(dir, { recursive: true });
  if (mode === 'full') {
    for (const f of readdirSync(dir)) if (f.endsWith('.json') && f !== `${date}.json`) rmSync(join(dir, f));
  }
  const body = items.map((it) => JSON.stringify(it)).join(',\n');
  const text = `{"sourceId":${JSON.stringify(sourceId)},"date":${JSON.stringify(date)},"items":[\n${body}\n]}\n`;
  const path = join(dir, `${date}.json`);
  writeFileSync(path, text);
  return path;
}

export function listSnapshotDates(rawDir: string, sourceId: string): string[] {
  const dir = join(rawDir, sourceId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort();
}

export function latestSnapshotDate(rawDir: string, sourceId: string): string | null {
  const d = listSnapshotDates(rawDir, sourceId);
  return d.length ? d[d.length - 1] : null;
}

function readItems<T>(rawDir: string, sourceId: string, date: string): T[] {
  const file = JSON.parse(readFileSync(join(rawDir, sourceId, `${date}.json`), 'utf8')) as SnapshotFile<T>;
  return file.items;
}

export function loadSource<T>(rawDir: string, sourceId: string, mode: HistoryMode): T[] {
  const dates = listSnapshotDates(rawDir, sourceId);
  if (!dates.length) return [];
  if (mode === 'full') return readItems<T>(rawDir, sourceId, dates[dates.length - 1]);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const d of dates) {
    for (const it of readItems<T>(rawDir, sourceId, d)) {
      const key = JSON.stringify(it);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(it);
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/raw/store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/raw pipeline/test/raw
git commit -m "feat(pipeline): dated raw snapshot store"
```

---

### Task 7: Assign observations to units (series tables)

Implements spec §6.1-1, -3, -6: per series, a unit's value in month m is (release-type) the best value released by month end, within the series' active window, or (snapshot-type) its best model in the latest snapshot ≤ month end that is ≤ `snapshotMaxAgeDays` old; months before a snapshot series' first snapshot are reconstructed from the first snapshot using `releases.yaml`.

**Files:**
- Create: `pipeline/src/compute/assign.ts`
- Test: `pipeline/test/compute/assign.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { assignSeries, matchUnit } from '../../src/compute/assign';
import type { CompiledUnit, CompiledRelease } from '../../src/config/load';
import type { Observation } from '../../src/core/types';
import { monthRange } from '../../src/core/months';

const unit = (id: string, since: string, match: string[], extra: Partial<CompiledUnit> = {}): CompiledUnit => ({
  id,
  front: 'general',
  org: id,
  name: id,
  since,
  regexes: match.map((m) => new RegExp(m, 'i')),
  scale: {},
  ...extra,
});
const UNITS = [unit('gpt', '2022-11', ['^gpt']), unit('claude', '2023-03', ['^claude'])];
const params = { snapshotMaxAgeDays: 92, releaseActiveMonths: 3 };
const ob = (o: Partial<Observation>): Observation => ({
  series: 's',
  kind: 'elo',
  model: 'gpt-4',
  date: '2023-05-10',
  dateKind: 'snapshot',
  value: 1000,
  ...o,
});

describe('matchUnit', () => {
  it('matches first unit whose regex hits; respects orgRegex', () => {
    expect(matchUnit(UNITS, { model: 'Claude-3-Opus' })?.id).toBe('claude');
    expect(matchUnit(UNITS, { model: 'llama-3' })).toBeNull();
    const withOrg = [unit('x', '2022-11', ['.*'], { orgRegex: /^acme$/i })];
    expect(matchUnit(withOrg, { model: 'm', org: 'Other' })).toBeNull();
    expect(matchUnit(withOrg, { model: 'm', org: 'ACME' })?.id).toBe('x');
    expect(matchUnit(withOrg, { model: 'm' })?.id).toBe('x'); // source without org info → model regex only
    expect(matchUnit(withOrg, { model: 'm', org: '' })?.id).toBe('x'); // empty org string counts as unknown
  });
});

describe('assignSeries — release type', () => {
  const obs = [
    ob({ model: 'gpt-4', date: '2023-03-14', value: 60, kind: 'percent', dateKind: 'release' }),
    ob({ model: 'gpt-4o', date: '2024-05-13', value: 70, kind: 'percent', dateKind: 'release' }),
    ob({ model: 'claude-3', date: '2024-03-04', value: 65, kind: 'percent', dateKind: 'release' }),
  ];
  const t = assignSeries({
    front: 'general',
    group: 'g',
    priority: 1,
    observations: obs,
    units: UNITS,
    months: monthRange('2023-01', '2024-10'),
    releases: [],
    params,
  });
  it('carries the best released value forward', () => {
    expect(t.points.get('gpt')?.get('2023-02')).toBeUndefined(); // before series start
    expect(t.points.get('gpt')?.get('2023-03')?.value).toBe(60);
    expect(t.points.get('gpt')?.get('2024-04')?.value).toBe(60);
    expect(t.points.get('gpt')?.get('2024-05')).toEqual({ value: 70, model: 'gpt-4o', reconstructed: false });
    expect(t.points.get('claude')?.get('2024-03')?.value).toBe(65);
  });
  it('stops after the active window (last obs month + 3)', () => {
    expect(t.points.get('gpt')?.get('2024-08')?.value).toBe(70);
    expect(t.points.get('gpt')?.get('2024-09')).toBeUndefined();
  });
  it('records kind and series', () => {
    expect(t.kind).toBe('percent');
    expect(t.series).toBe('s');
  });
});

describe('assignSeries — snapshot type', () => {
  const obs = [
    ob({ model: 'gpt-4', date: '2025-01-05', value: 1200 }),
    ob({ model: 'gpt-4o', date: '2025-01-05', value: 1250 }),
    ob({ model: 'claude-3', date: '2025-01-05', value: 1240 }),
    ob({ model: 'gpt-4o', date: '2025-06-20', value: 1260 }),
    ob({ model: 'claude-3', date: '2025-06-20', value: 1270 }),
  ];
  const releases: CompiledRelease[] = [
    { regex: /^gpt-4$/i, release: '2023-03' },
    { regex: /^gpt-4o/i, release: '2024-05' },
    { regex: /^claude-3/i, release: '2024-03' },
  ];
  const t = assignSeries({
    front: 'general',
    group: 'g',
    priority: 1,
    observations: obs,
    units: UNITS,
    months: monthRange('2023-01', '2025-12'),
    releases,
    params,
  });
  it('uses best model of the latest snapshot ≤ month end', () => {
    expect(t.points.get('gpt')?.get('2025-01')).toEqual({ value: 1250, model: 'gpt-4o', reconstructed: false });
    expect(t.points.get('claude')?.get('2025-03')?.value).toBe(1240);
    expect(t.points.get('claude')?.get('2025-06')?.value).toBe(1270);
  });
  it('drops stale snapshots (> 92 days old)', () => {
    expect(t.points.get('gpt')?.get('2025-05')).toBeUndefined(); // 2025-01-05 → 2025-05-31 is 146 days
    expect(t.points.get('gpt')?.get('2025-08')?.value).toBe(1260); // 2025-06-20 → 2025-08-31 is 72 days
    expect(t.points.get('gpt')?.get('2025-09')).toBeUndefined(); // 2025-06-20 → 2025-09-30 is 102 days
  });
  it('reconstructs months before the first snapshot using release months', () => {
    expect(t.points.get('gpt')?.get('2023-02')).toBeUndefined(); // no model released yet
    expect(t.points.get('gpt')?.get('2023-06')).toEqual({ value: 1200, model: 'gpt-4', reconstructed: true });
    expect(t.points.get('gpt')?.get('2024-06')).toEqual({ value: 1250, model: 'gpt-4o', reconstructed: true });
    expect(t.points.get('claude')?.get('2024-02')).toBeUndefined();
    expect(t.points.get('claude')?.get('2024-03')?.reconstructed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/compute/assign.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`pipeline/src/compute/assign.ts`:
```ts
import type { FrontId, Observation, ValueKind } from '../core/types';
import { addMonths, daysBetween, monthEnd, toMonth, type Month } from '../core/months';
import type { CompiledRelease, CompiledUnit } from '../config/load';

export interface AssignedPoint {
  value: number;
  model: string;
  reconstructed: boolean;
}

export interface SeriesTable {
  front: FrontId;
  group: string;
  series: string;
  priority: number;
  kind: ValueKind;
  /** unitId → month → point */
  points: Map<string, Map<Month, AssignedPoint>>;
}

export interface AssignParams {
  snapshotMaxAgeDays: number;
  releaseActiveMonths: number;
}

export function matchUnit(units: CompiledUnit[], obs: { model: string; org?: string }): CompiledUnit | null {
  for (const u of units) {
    // orgMatch only applies when the source tells us the org (several sources don't; Arena has '' for legacy rows)
    if (u.orgRegex && obs.org && !u.orgRegex.test(obs.org)) continue;
    if (u.regexes.some((r) => r.test(obs.model))) return u;
  }
  return null;
}

export function unitExists(u: Pick<CompiledUnit, 'since' | 'until'>, m: Month): boolean {
  return m >= u.since && (!u.until || m <= u.until);
}

export function releaseOf(releases: CompiledRelease[], model: string): CompiledRelease | null {
  for (const r of releases) if (r.regex.test(model)) return r;
  return null;
}

/** All observations must belong to ONE series (same series id, kind, dateKind). */
export function assignSeries(args: {
  front: FrontId;
  group: string;
  priority: number;
  observations: Observation[];
  units: CompiledUnit[];
  months: Month[];
  releases: CompiledRelease[];
  params: AssignParams;
}): SeriesTable {
  const obs = args.observations;
  if (!obs.length) throw new Error('assignSeries: empty observations');
  const first = obs[0];
  const table: SeriesTable = {
    front: args.front,
    group: args.group,
    series: first.series,
    priority: args.priority,
    kind: first.kind,
    points: new Map(),
  };
  const unitById = new Map(args.units.map((u) => [u.id, u]));
  const byUnit = new Map<string, Observation[]>();
  for (const o of obs) {
    const u = matchUnit(args.units, o);
    if (!u) continue;
    if (!byUnit.has(u.id)) byUnit.set(u.id, []);
    byUnit.get(u.id)!.push(o);
  }
  const put = (unitId: string, m: Month, p: AssignedPoint) => {
    if (!table.points.has(unitId)) table.points.set(unitId, new Map());
    table.points.get(unitId)!.set(m, p);
  };

  if (first.dateKind === 'release') {
    const dates = obs.map((o) => o.date).sort();
    const firstMonth = toMonth(dates[0]);
    const lastActive = addMonths(toMonth(dates[dates.length - 1]), args.params.releaseActiveMonths);
    for (const [unitId, list] of byUnit) {
      const u = unitById.get(unitId)!;
      const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
      for (const m of args.months) {
        if (m < firstMonth || m > lastActive || !unitExists(u, m)) continue;
        const end = monthEnd(m);
        let best: Observation | null = null;
        for (const o of sorted) {
          if (o.date > end) break;
          if (!best || o.value > best.value) best = o;
        }
        if (best) put(unitId, m, { value: best.value, model: best.model, reconstructed: false });
      }
    }
    return table;
  }

  // snapshot type
  const snapDates = [...new Set(obs.map((o) => o.date))].sort();
  const bestAt = new Map<string, Map<string, Observation>>(); // date → unitId → best obs
  for (const [unitId, list] of byUnit) {
    for (const o of list) {
      if (!bestAt.has(o.date)) bestAt.set(o.date, new Map());
      const cur = bestAt.get(o.date)!.get(unitId);
      if (!cur || o.value > cur.value) bestAt.get(o.date)!.set(unitId, o);
    }
  }
  const firstSnap = snapDates[0];
  for (const m of args.months) {
    const end = monthEnd(m);
    let snap: string | null = null;
    for (const d of snapDates) {
      if (d <= end) snap = d;
      else break;
    }
    if (snap) {
      if (daysBetween(snap, end) > args.params.snapshotMaxAgeDays) continue;
      for (const [unitId, o] of bestAt.get(snap) ?? new Map<string, Observation>()) {
        if (unitExists(unitById.get(unitId)!, m)) put(unitId, m, { value: o.value, model: o.model, reconstructed: false });
      }
      continue;
    }
    // m is before the first snapshot → reconstruct from the first snapshot using release months
    for (const [unitId, list] of byUnit) {
      const u = unitById.get(unitId)!;
      if (!unitExists(u, m)) continue;
      let best: Observation | null = null;
      for (const o of list) {
        if (o.date !== firstSnap) continue;
        const rel = releaseOf(args.releases, o.model);
        if (!rel || rel.release > m) continue;
        if (!best || o.value > best.value) best = o;
      }
      if (best) put(unitId, m, { value: best.value, model: best.model, reconstructed: true });
    }
  }
  return table;
}

/** Splits a source's observations by series id. */
export function bySeries(obs: Observation[]): Map<string, Observation[]> {
  const out = new Map<string, Observation[]>();
  for (const o of obs) {
    if (!out.has(o.series)) out.set(o.series, []);
    out.get(o.series)!.push(o);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/compute/assign.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/compute/assign.ts pipeline/test/compute/assign.test.ts
git commit -m "feat(pipeline): assign observations to units per series and month"
```

---

### Task 8: Strength — normalisation, group combine, estimation

Implements spec §6.1-2, -4, -5, -7.

**Files:**
- Create: `pipeline/src/compute/strength.ts`
- Test: `pipeline/test/compute/strength.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { winProb, computeStrength, fillEstimatedStrength, type StrengthCell } from '../../src/compute/strength';
import type { SeriesTable, AssignedPoint } from '../../src/compute/assign';
import type { KindParams } from '../../src/config/schemas';

const K: KindParams = { elo: { scale: 400 }, percent: { clampLo: 0.5, clampHi: 99.5 }, minutes: { kappa: 1 }, eci: { tau: 8 } };

const table = (
  group: string,
  series: string,
  priority: number,
  kind: SeriesTable['kind'],
  pts: Record<string, Record<string, number | [number, boolean]>>,
): SeriesTable => ({
  front: 'general',
  group,
  series,
  priority,
  kind,
  points: new Map(
    Object.entries(pts).map(([u, byM]) => [
      u,
      new Map(
        Object.entries(byM).map(([m, v]): [string, AssignedPoint] => {
          const [value, reconstructed] = Array.isArray(v) ? v : [v, false];
          return [m, { value, model: `${u}-model`, reconstructed }];
        }),
      ),
    ]),
  ),
});

describe('winProb', () => {
  it('is 0.5 for the leader itself and decreases with the gap', () => {
    expect(winProb('elo', 1300, 1300, K)).toBe(0.5);
    expect(winProb('elo', 1200, 1300, K)).toBeCloseTo(1 / (1 + 10 ** 0.25), 10);
    expect(winProb('percent', 50, 75, K)).toBeCloseTo(0.25, 10); // odds 1 vs 3
    expect(winProb('minutes', 30, 60, K)).toBeCloseTo(1 / (1 + Math.E), 10); // log2 gap −1
    expect(winProb('eci', 142, 150, K)).toBeCloseTo(1 / (1 + Math.E), 10);
  });
  it('clamps percent at the edges', () => {
    expect(Number.isFinite(winProb('percent', 0, 100, K))).toBe(true);
  });
});

describe('computeStrength', () => {
  it('normalises each series to its monthly leader (=100) and weight-averages groups', () => {
    const tables = [
      table('arena', 'arena', 1, 'elo', { a: { '2025-01': 1300 }, b: { '2025-01': 1200 } }),
      table('eci', 'eci', 1, 'eci', { a: { '2025-01': 142 }, b: { '2025-01': 150 } }),
    ];
    const cells = computeStrength({ tables, unitIds: ['a', 'b'], months: ['2025-01'], weights: { arena: 0.5, eci: 0.5 }, kinds: K, minUnits: 2 });
    const a = cells.get('a')!.get('2025-01')!;
    const b = cells.get('b')!.get('2025-01')!;
    const bArena = 200 / (1 + 10 ** 0.25);
    const aEci = 200 / (1 + Math.E);
    expect(a.s).toBeCloseTo((100 + aEci) / 2, 6);
    expect(b.s).toBeCloseTo((bArena + 100) / 2, 6);
    expect(a.measured).toBe(2);
    expect(a.breakdown.map((g) => g.group).sort()).toEqual(['arena', 'eci']);
  });
  it('skips series-months with fewer than minUnits units', () => {
    const tables = [table('arena', 'arena', 1, 'elo', { a: { '2025-01': 1300 } })];
    const cells = computeStrength({ tables, unitIds: ['a'], months: ['2025-01'], weights: { arena: 1 }, kinds: K, minUnits: 2 });
    expect(cells.get('a')!.get('2025-01')!.s).toBeNull();
  });
  it('uses only the highest-priority series of a group, averaging ties', () => {
    const tables = [
      table('arena', 'plain', 1, 'elo', { a: { '2025-01': 1000 }, b: { '2025-01': 1400 } }),
      table('arena', 'style', 2, 'elo', { a: { '2025-01': 1300 }, b: { '2025-01': 1300 } }),
    ];
    const cells = computeStrength({ tables, unitIds: ['a', 'b'], months: ['2025-01'], weights: { arena: 1 }, kinds: K, minUnits: 2 });
    expect(cells.get('a')!.get('2025-01')!.s).toBe(100);
    expect(cells.get('b')!.get('2025-01')!.s).toBe(100);
  });
  it('flags reconstructed groups and ignores groups without weight', () => {
    const tables = [
      table('arena', 'arena', 1, 'elo', { a: { '2024-01': [1300, true] }, b: { '2024-01': [1300, true] } }),
      table('unweighted', 'u', 1, 'elo', { a: { '2024-01': 1 }, b: { '2024-01': 2 } }),
    ];
    const cells = computeStrength({ tables, unitIds: ['a', 'b'], months: ['2024-01'], weights: { arena: 1 }, kinds: K, minUnits: 2 });
    const a = cells.get('a')!.get('2024-01')!;
    expect(a.measured).toBe(0);
    expect(a.reconstructed).toBe(1);
    expect(a.breakdown).toHaveLength(1);
  });
});

describe('fillEstimatedStrength', () => {
  const empty = (): StrengthCell => ({ s: null, measured: 0, reconstructed: 0, estimated: false, breakdown: [], bestModel: null });
  it('copies the strength of the unit with the closest scale share', () => {
    const cells = new Map([
      ['a', new Map([['2025-01', { ...empty(), s: 100, measured: 1 }]])],
      ['b', new Map([['2025-01', { ...empty(), s: 80, measured: 1 }]])],
      ['x', new Map([['2025-01', empty()]])],
    ]);
    const shares = new Map([
      ['a', new Map([['2025-01', 50]])],
      ['b', new Map([['2025-01', 10]])],
      ['x', new Map([['2025-01', 12]])],
    ]);
    fillEstimatedStrength({ cells, shares, months: ['2025-01'], exists: () => true, floor: 60, step: 6 });
    const x = cells.get('x')!.get('2025-01')!;
    expect(x.s).toBe(80);
    expect(x.estimated).toBe(true);
  });
  it('ranks by scale when nothing is measured', () => {
    const cells = new Map([
      ['a', new Map([['2023-01', empty()]])],
      ['b', new Map([['2023-01', empty()]])],
    ]);
    const shares = new Map([
      ['a', new Map([['2023-01', 30]])],
      ['b', new Map([['2023-01', 70]])],
    ]);
    fillEstimatedStrength({ cells, shares, months: ['2023-01'], exists: () => true, floor: 60, step: 6 });
    expect(cells.get('b')!.get('2023-01')!.s).toBe(100);
    expect(cells.get('a')!.get('2023-01')!.s).toBe(94);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/compute/strength.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`pipeline/src/compute/strength.ts`:
```ts
import type { ValueKind } from '../core/types';
import type { Month } from '../core/months';
import { clamp, logit, sigmoid, weightedMean } from '../core/math';
import type { KindParams } from '../config/schemas';
import type { SeriesTable } from './assign';

export interface GroupScore {
  group: string;
  score: number;
  weight: number;
  reconstructed: boolean;
  model: string;
}

export interface StrengthCell {
  s: number | null;
  /** number of groups contributing measured (non-reconstructed) data */
  measured: number;
  /** number of groups contributing reconstructed data */
  reconstructed: number;
  /** true when s was filled by fillEstimatedStrength */
  estimated: boolean;
  /** sorted by weight desc */
  breakdown: GroupScore[];
  /** model of the highest-weight group (used for new_model events) */
  bestModel: string | null;
}

/** Expected win probability of x against the month's leader (spec §6.1-2). */
export function winProb(kind: ValueKind, x: number, lead: number, k: KindParams): number {
  switch (kind) {
    case 'elo':
      return 1 / (1 + 10 ** ((lead - x) / k.elo.scale));
    case 'percent': {
      const c = (v: number) => clamp(v, k.percent.clampLo, k.percent.clampHi) / 100;
      return sigmoid(logit(c(x)) - logit(c(lead)));
    }
    case 'minutes':
      return sigmoid(k.minutes.kappa * (Math.log2(Math.max(x, 1e-6)) - Math.log2(Math.max(lead, 1e-6))));
    case 'eci':
      return sigmoid((x - lead) / k.eci.tau);
  }
}

interface UnitSeriesScore {
  score: number;
  reconstructed: boolean;
  model: string;
}

export function computeStrength(args: {
  tables: SeriesTable[];
  unitIds: string[];
  months: Month[];
  weights: Record<string, number>;
  kinds: KindParams;
  minUnits: number;
}): Map<string, Map<Month, StrengthCell>> {
  const out = new Map<string, Map<Month, StrengthCell>>(args.unitIds.map((id) => [id, new Map()]));
  for (const m of args.months) {
    // 1) per-series scores relative to the series leader
    const perSeries: { table: SeriesTable; scores: Map<string, UnitSeriesScore> }[] = [];
    for (const t of args.tables) {
      const present: [string, { value: number; model: string; reconstructed: boolean }][] = [];
      for (const [uid, byMonth] of t.points) {
        const p = byMonth.get(m);
        if (p) present.push([uid, p]);
      }
      if (present.length < args.minUnits) continue;
      const lead = Math.max(...present.map(([, p]) => p.value));
      const scores = new Map<string, UnitSeriesScore>();
      for (const [uid, p] of present) {
        scores.set(uid, { score: 200 * winProb(t.kind, p.value, lead, args.kinds), reconstructed: p.reconstructed, model: p.model });
      }
      perSeries.push({ table: t, scores });
    }
    // 2) per group: highest-priority series with data, ties averaged
    const groups = new Map<string, typeof perSeries>();
    for (const s of perSeries) {
      if (!groups.has(s.table.group)) groups.set(s.table.group, []);
      groups.get(s.table.group)!.push(s);
    }
    const unitGroups = new Map<string, GroupScore[]>();
    for (const [group, list] of groups) {
      const weight = args.weights[group] ?? 0;
      if (weight <= 0) continue;
      const maxP = Math.max(...list.map((s) => s.table.priority));
      const top = list.filter((s) => s.table.priority === maxP);
      const ids = new Set(top.flatMap((s) => [...s.scores.keys()]));
      for (const uid of ids) {
        const hits = top.map((s) => s.scores.get(uid)).filter((h): h is UnitSeriesScore => h !== undefined);
        const score = hits.reduce((a, h) => a + h.score, 0) / hits.length;
        if (!unitGroups.has(uid)) unitGroups.set(uid, []);
        unitGroups.get(uid)!.push({ group, score, weight, reconstructed: hits.every((h) => h.reconstructed), model: hits[0].model });
      }
    }
    // 3) weighted combination
    for (const uid of args.unitIds) {
      const gs = (unitGroups.get(uid) ?? []).sort((a, b) => b.weight - a.weight || a.group.localeCompare(b.group));
      out.get(uid)!.set(m, {
        s: weightedMean(gs.map((g) => ({ value: g.score, weight: g.weight }))),
        measured: gs.filter((g) => !g.reconstructed).length,
        reconstructed: gs.filter((g) => g.reconstructed).length,
        estimated: false,
        breakdown: gs,
        bestModel: gs[0]?.model ?? null,
      });
    }
  }
  return out;
}

/** Spec §6.1-7: fill s for existing units that have no strength data. Mutates `cells`. */
export function fillEstimatedStrength(args: {
  cells: Map<string, Map<Month, StrengthCell>>;
  /** unitId → month → scale share (0–100) */
  shares: Map<string, Map<Month, number | null>>;
  months: Month[];
  exists: (unitId: string, m: Month) => boolean;
  floor: number;
  step: number;
}): void {
  const ids = [...args.cells.keys()];
  const share = (u: string, m: Month) => args.shares.get(u)?.get(m) ?? 0;
  for (const m of args.months) {
    const present = ids.filter((u) => args.exists(u, m));
    const cell = (u: string) => args.cells.get(u)!.get(m);
    const measured = present.filter((u) => cell(u)?.s != null);
    const missing = present.filter((u) => cell(u)?.s == null);
    if (!missing.length) continue;
    const estimates = new Map<string, number>();
    if (measured.length) {
      for (const u of missing) {
        let best = measured[0];
        for (const v of measured) if (Math.abs(share(u, m) - share(v, m)) < Math.abs(share(u, m) - share(best, m))) best = v;
        estimates.set(u, cell(best)!.s!);
      }
    } else {
      const ranked = [...missing].sort((a, b) => share(b, m) - share(a, m));
      ranked.forEach((u, i) => estimates.set(u, Math.max(args.floor, 100 - args.step * i)));
    }
    for (const [u, s] of estimates) {
      args.cells.get(u)!.set(m, { s, measured: 0, reconstructed: 0, estimated: true, breakdown: [], bestModel: null });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/compute/strength.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/compute/strength.ts pipeline/test/compute/strength.test.ts
git commit -m "feat(pipeline): strength normalisation, group combine and estimation"
```

---

### Task 9: Announcements → monthly users

**Files:**
- Create: `pipeline/src/compute/announcements.ts`
- Test: `pipeline/test/compute/announcements.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { announcementMonthly } from '../../src/compute/announcements';
import { monthRange } from '../../src/core/months';

const factors = { MAU: 1, WAU: 1.4, DAU: 2.5 };

describe('announcementMonthly', () => {
  const series = {
    metric: 'MAU' as const,
    points: [
      { date: '2024-01-31', value: 100, url: 'https://x' },
      { date: '2024-03-31', value: 400, url: 'https://x' },
    ],
  };
  const out = announcementMonthly(series, monthRange('2023-12', '2024-12'), factors, 6);
  it('is empty before the first point', () => {
    expect(out.has('2023-12')).toBe(false);
  });
  it('hits points exactly and interpolates geometrically between them', () => {
    expect(out.get('2024-01')).toBeCloseTo(100, 6);
    expect(out.get('2024-02')).toBeCloseTo(195.5, 0); // 100·4^(29/60): Feb 29 is day 29 of 60
    expect(out.get('2024-03')).toBeCloseTo(400, 6);
  });
  it('carries the last value for staleMonths, then stops', () => {
    expect(out.get('2024-09')).toBeCloseTo(400, 6);
    expect(out.has('2024-10')).toBe(false);
  });
  it('converts WAU/DAU to MAU-equivalent, honouring per-point metric', () => {
    const w = announcementMonthly(
      { metric: 'WAU', points: [{ date: '2024-01-15', value: 10, url: 'https://x' }, { date: '2024-02-15', value: 10, metric: 'DAU', url: 'https://x' }] },
      ['2024-01', '2024-02'],
      factors,
      6,
    );
    expect(w.get('2024-01')).toBeCloseTo(14, 6);
    expect(w.get('2024-02')).toBeCloseTo(25, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/compute/announcements.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`pipeline/src/compute/announcements.ts`:
```ts
import { daysBetween, monthDiff, monthEnd, toMonth, type Month } from '../core/months';
import { logInterp } from '../core/math';
import type { AnnSeries } from '../config/schemas';

/**
 * MAU-equivalent users per month (spec §6.2-2):
 * - nothing before the first announcement,
 * - geometric interpolation (by day) between announcements,
 * - the last value is carried for `staleMonths` months, then dropped.
 * A month's value is evaluated at the month's last day; a point dated inside the month counts as "≤ month end".
 */
export function announcementMonthly(
  series: AnnSeries,
  months: Month[],
  factors: { MAU: number; WAU: number; DAU: number },
  staleMonths: number,
): Map<Month, number> {
  const pts = [...series.points]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ date: p.date, v: p.value * factors[p.metric ?? series.metric] }));
  const out = new Map<Month, number>();
  if (!pts.length) return out;
  const origin = pts[0].date;
  const day = (d: string) => daysBetween(origin, d);
  for (const m of months) {
    const end = monthEnd(m);
    let prev: (typeof pts)[number] | null = null;
    let next: (typeof pts)[number] | null = null;
    for (const p of pts) {
      if (p.date <= end) prev = p;
      else {
        next = p;
        break;
      }
    }
    if (!prev) continue;
    if (toMonth(prev.date) === m) {
      out.set(m, prev.v);
    } else if (next) {
      out.set(m, logInterp(day(prev.date), prev.v, day(next.date), next.v, day(end)));
    } else if (monthDiff(toMonth(prev.date), m) <= staleMonths) {
      out.set(m, prev.v);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/compute/announcements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/compute/announcements.ts pipeline/test/compute/announcements.test.ts
git commit -m "feat(pipeline): announcement points to monthly users"
```

---

### Task 10: Signal tables

Turns `SignalObs[]` into `signal → unitId → month → value`, using each unit's identifiers from `units.yaml` (`scale.*`). Rank signals become `1/rank`; several observations for the same key+month keep the max (latest cumulative count / best rank); several keys of one unit are summed; `openrouter` matches by slug prefix.

**Files:**
- Create: `pipeline/src/compute/signals.ts`
- Test: `pipeline/test/compute/signals.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildSignalTable } from '../../src/compute/signals';
import type { CompiledUnit } from '../../src/config/load';
import type { SignalObs } from '../../src/core/types';

const u = (id: string, scale: CompiledUnit['scale']): CompiledUnit => ({ id, front: 'general', org: id, name: id, since: '2022-11', regexes: [], scale });

describe('buildSignalTable', () => {
  const units = [
    u('gpt', { crux: ['chatgpt.com', 'chat.openai.com'], openrouter: ['openai/'], itunes: ['111'] }),
    u('claude', { crux: ['claude.ai'], openrouter: ['anthropic/'] }),
  ];
  const obs: SignalObs[] = [
    { signal: 'crux', key: 'chatgpt.com', month: '2025-01', value: 1000 },
    { signal: 'crux', key: 'chat.openai.com', month: '2025-01', value: 5000 },
    { signal: 'crux', key: 'claude.ai', month: '2025-01', value: 10000 },
    { signal: 'openrouter', key: 'openai/gpt-5', month: '2025-01', value: 0.2 },
    { signal: 'openrouter', key: 'openai/gpt-4o', month: '2025-01', value: 0.1 },
    { signal: 'openrouter', key: 'anthropic/claude-4', month: '2025-01', value: 0.3 },
    { signal: 'itunes', key: '111', month: '2025-01', value: 900 },
    { signal: 'itunes', key: '111', month: '2025-01', value: 1000 },
    { signal: 'wikipedia', key: 'Unmapped', month: '2025-01', value: 5 },
  ];
  const t = buildSignalTable(units, obs);
  it('converts ranks to 1/rank and sums keys of a unit', () => {
    expect(t.get('crux')!.get('gpt')!.get('2025-01')).toBeCloseTo(1 / 1000 + 1 / 5000, 12);
    expect(t.get('crux')!.get('claude')!.get('2025-01')).toBeCloseTo(1 / 10000, 12);
  });
  it('matches openrouter by slug prefix', () => {
    expect(t.get('openrouter')!.get('gpt')!.get('2025-01')).toBeCloseTo(0.3, 12);
    expect(t.get('openrouter')!.get('claude')!.get('2025-01')).toBeCloseTo(0.3, 12);
  });
  it('keeps the max for duplicate key+month observations', () => {
    expect(t.get('itunes')!.get('gpt')!.get('2025-01')).toBe(1000);
  });
  it('ignores unmapped keys', () => {
    expect(t.get('wikipedia')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/compute/signals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`pipeline/src/compute/signals.ts`:
```ts
import { RANK_SIGNALS, type SignalId, type SignalObs } from '../core/types';
import type { Month } from '../core/months';
import type { CompiledUnit } from '../config/load';

export type SignalTable = Map<SignalId, Map<string, Map<Month, number>>>;

type KeyedSignal = Exclude<SignalId, 'announcements'>;

function unitKeys(u: CompiledUnit, sig: KeyedSignal): string[] {
  return (u.scale[sig] as string[] | undefined) ?? [];
}

export function buildSignalTable(units: CompiledUnit[], obs: SignalObs[]): SignalTable {
  // 1) dedupe per (signal,key,month), keeping the max transformed value
  const dedup = new Map<string, SignalObs & { t: number }>();
  for (const o of obs) {
    if (o.signal === 'announcements') continue;
    const t = RANK_SIGNALS.has(o.signal) ? (o.value > 0 ? 1 / o.value : 0) : o.value;
    const k = `${o.signal}\u0000${o.key}\u0000${o.month}`;
    const cur = dedup.get(k);
    if (!cur || t > cur.t) dedup.set(k, { ...o, t });
  }
  // 2) map keys to units and sum per unit+month
  const table: SignalTable = new Map();
  for (const o of dedup.values()) {
    const sig = o.signal as KeyedSignal;
    for (const u of units) {
      const keys = unitKeys(u, sig);
      const hit = sig === 'openrouter' ? keys.some((p) => o.key.startsWith(p)) : keys.includes(o.key);
      if (!hit) continue;
      if (!table.has(sig)) table.set(sig, new Map());
      const byUnit = table.get(sig)!;
      if (!byUnit.has(u.id)) byUnit.set(u.id, new Map());
      const byMonth = byUnit.get(u.id)!;
      byMonth.set(o.month, (byMonth.get(o.month) ?? 0) + o.t);
    }
  }
  return table;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/compute/signals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/compute/signals.ts pipeline/test/compute/signals.test.ts
git commit -m "feat(pipeline): build per-unit scale signal tables"
```

---

### Task 11: Scale shares

Implements spec §6.2 with the "redistribute within the units that have a component" rule so that a component known only for some units never inflates them against the rest:

1. signal share among units having that signal; component share = mean of its signal shares, renormalised within the units having the component (S_c);
2. base share b = mean of the `base` components' shares; units without base get `floorFactor × min(b)`; all renormalised (uniform if nobody has base);
3. implied_c(u) = (Σ_{S_c} b) · share_c(u) for u ∈ S_c, else b(u);
4. combined = Σ w_c · implied_c, normalised;
5. trailing mean over `smoothingMonths`, renormalised per month, ×100.

**Files:**
- Create: `pipeline/src/compute/scale.ts`
- Test: `pipeline/test/compute/scale.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { scaleMonth, computeScale } from '../../src/compute/scale';
import type { SignalTable } from '../../src/compute/signals';

const method = {
  smoothingMonths: 1,
  announcementStaleMonths: 6,
  metricFactors: { MAU: 1, WAU: 1.4, DAU: 2.5 },
  floorFactor: 0.5,
  components: {
    users: { weight: 0.5, signals: ['announcements' as const] },
    attention: { weight: 0.5, signals: ['wikipedia' as const] },
  },
  base: ['attention'],
};

const tbl = (data: Record<string, Record<string, Record<string, number>>>): SignalTable =>
  new Map(
    Object.entries(data).map(([sig, byUnit]) => [
      sig as never,
      new Map(Object.entries(byUnit).map(([u, byM]) => [u, new Map(Object.entries(byM))])),
    ]),
  );

describe('scaleMonth', () => {
  it('uses base shares when only base data exists', () => {
    const r = scaleMonth(['a', 'b'], '2025-01', tbl({ wikipedia: { a: { '2025-01': 300 }, b: { '2025-01': 100 } } }), method);
    expect(r.get('a')!.share).toBeCloseTo(0.75, 10);
    expect(r.get('b')!.share).toBeCloseTo(0.25, 10);
    expect(r.get('a')!.components).toBe(1);
  });
  it('redistributes a partial component only among the units that have it', () => {
    // base: a .5, b .25, c .25 ; users known for a and b only (a:b = 1:3)
    const r = scaleMonth(
      ['a', 'b', 'c'],
      '2025-01',
      tbl({
        wikipedia: { a: { '2025-01': 2 }, b: { '2025-01': 1 }, c: { '2025-01': 1 } },
        announcements: { a: { '2025-01': 10 }, b: { '2025-01': 30 } },
      }),
      method,
    );
    // users implied: a = .75*.25, b = .75*.75, c = base .25
    expect(r.get('a')!.share).toBeCloseTo(0.5 * 0.5 + 0.5 * 0.1875, 10);
    expect(r.get('b')!.share).toBeCloseTo(0.5 * 0.25 + 0.5 * 0.5625, 10);
    expect(r.get('c')!.share).toBeCloseTo(0.25, 10);
    expect(r.get('c')!.components).toBe(1);
  });
  it('carries a signal value forward up to 2 months (current month often has no data yet)', () => {
    const r = scaleMonth(['a', 'b'], '2025-03', tbl({ wikipedia: { a: { '2025-01': 3 }, b: { '2025-03': 1 } } }), method);
    expect(r.get('a')!.share).toBeCloseTo(0.75, 10);
    const r2 = scaleMonth(['a', 'b'], '2025-04', tbl({ wikipedia: { a: { '2025-01': 3 }, b: { '2025-04': 1 } } }), method);
    expect(r2.get('a')!.components).toBe(0);
  });
  it('gives units without any base signal a floor and uniform shares when no data at all', () => {
    const r = scaleMonth(['a', 'b'], '2025-01', tbl({ wikipedia: { a: { '2025-01': 1 } } }), method);
    expect(r.get('b')!.share).toBeCloseTo(1 / 3, 10); // floor 0.5 of a's 1.0 → 1 : 0.5
    expect(r.get('b')!.components).toBe(0);
    const u = scaleMonth(['a', 'b'], '2025-01', tbl({}), method);
    expect(u.get('a')!.share).toBe(0.5);
  });
});

describe('computeScale', () => {
  it('smooths over the window, renormalises and returns 0–100; null when the unit does not exist', () => {
    const signals = tbl({
      wikipedia: {
        a: { '2025-01': 1, '2025-02': 3 },
        b: { '2025-01': 1, '2025-02': 1 },
      },
    });
    const out = computeScale({
      unitIds: ['a', 'b'],
      months: ['2025-01', '2025-02'],
      exists: () => true,
      signals,
      method: { ...method, smoothingMonths: 2 },
    });
    expect(out.get('a')!.get('2025-01')!.c).toBeCloseTo(50, 10);
    // raw Feb: a .75 b .25 ; smoothed a (.5+.75)/2=.625, b (.5+.25)/2=.375 → sum 1
    expect(out.get('a')!.get('2025-02')!.c).toBeCloseTo(62.5, 10);
    const gone = computeScale({ unitIds: ['a', 'b'], months: ['2025-01'], exists: (u) => u === 'a', signals, method });
    expect(gone.get('b')!.get('2025-01')).toBeNull();
    expect(gone.get('a')!.get('2025-01')!.c).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/compute/scale.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`pipeline/src/compute/scale.ts`:
```ts
import { addMonths, type Month } from '../core/months';
import { sum, trailingMean } from '../core/math';
import type { Method } from '../config/schemas';
import type { SignalTable } from './signals';

export type ScaleMethod = Method['scale'];

/** A missing signal value is taken from up to this many previous months (monthly sources lag the current month). */
const CARRY_MONTHS = 2;

function valueAt(byMonth: Map<Month, number> | undefined, m: Month): number | undefined {
  if (!byMonth) return undefined;
  for (let k = 0; k <= CARRY_MONTHS; k++) {
    const v = byMonth.get(addMonths(m, -k));
    if (v != null) return v;
  }
  return undefined;
}

export interface ScaleCell {
  /** share 0–100 within the front */
  c: number;
  /** number of components with data for this unit this month */
  components: number;
}

function normalise(m: Map<string, number>): Map<string, number> {
  const tot = sum(m.values());
  return new Map([...m].map(([k, v]) => [k, tot > 0 ? v / tot : 0]));
}

/** Unsmoothed shares (0–1) for one month. */
export function scaleMonth(
  present: string[],
  m: Month,
  signals: SignalTable,
  method: ScaleMethod,
): Map<string, { share: number; components: number }> {
  // signal shares among units having the signal
  const sigShare = new Map<string, Map<string, number>>();
  for (const [sig, byUnit] of signals) {
    const vals = new Map<string, number>();
    for (const u of present) {
      const v = valueAt(byUnit.get(u), m);
      if (v != null && v > 0) vals.set(u, v);
    }
    if (vals.size) sigShare.set(sig, normalise(vals));
  }
  // component shares, normalised within S_c
  const comp = new Map<string, Map<string, number>>();
  for (const [cid, c] of Object.entries(method.components)) {
    const acc = new Map<string, number[]>();
    for (const sig of c.signals) {
      for (const [u, v] of sigShare.get(sig) ?? []) {
        if (!acc.has(u)) acc.set(u, []);
        acc.get(u)!.push(v);
      }
    }
    if (acc.size) comp.set(cid, normalise(new Map([...acc].map(([u, vs]) => [u, sum(vs) / vs.length]))));
  }
  // base
  const baseRaw = new Map<string, number>();
  for (const u of present) {
    const vs = method.base.map((b) => comp.get(b)?.get(u)).filter((v): v is number => v != null);
    if (vs.length) baseRaw.set(u, sum(vs) / vs.length);
  }
  let base: Map<string, number>;
  if (!baseRaw.size) {
    base = new Map(present.map((u) => [u, 1 / present.length]));
  } else {
    const nb = normalise(baseRaw);
    const floor = Math.min(...nb.values()) * method.floorFactor;
    for (const u of present) if (!nb.has(u)) nb.set(u, floor);
    base = normalise(nb);
  }
  // implied per component, combined
  const combined = new Map(present.map((u) => [u, 0]));
  for (const [cid, c] of Object.entries(method.components)) {
    const sh = comp.get(cid);
    const mass = sh ? sum([...sh.keys()].map((u) => base.get(u) ?? 0)) : 0;
    for (const u of present) {
      const implied = sh?.has(u) ? mass * sh.get(u)! : base.get(u)!;
      combined.set(u, combined.get(u)! + c.weight * implied);
    }
  }
  const shares = normalise(combined);
  const out = new Map<string, { share: number; components: number }>();
  for (const u of present) {
    const components = Object.keys(method.components).filter((cid) => comp.get(cid)?.has(u)).length;
    out.set(u, { share: shares.get(u)!, components });
  }
  return out;
}

export function computeScale(args: {
  unitIds: string[];
  months: Month[];
  exists: (unitId: string, m: Month) => boolean;
  signals: SignalTable;
  method: ScaleMethod;
}): Map<string, Map<Month, ScaleCell | null>> {
  const raw = args.months.map((m) => {
    const present = args.unitIds.filter((u) => args.exists(u, m));
    return present.length ? scaleMonth(present, m, args.signals, args.method) : new Map<string, { share: number; components: number }>();
  });
  const smoothed = new Map<string, (number | null)[]>();
  for (const u of args.unitIds) {
    smoothed.set(u, trailingMean(raw.map((r) => r.get(u)?.share ?? null), args.method.smoothingMonths));
  }
  const out = new Map<string, Map<Month, ScaleCell | null>>(args.unitIds.map((u) => [u, new Map()]));
  args.months.forEach((m, i) => {
    const tot = sum(args.unitIds.map((u) => smoothed.get(u)![i] ?? 0));
    for (const u of args.unitIds) {
      const v = smoothed.get(u)![i];
      out.get(u)!.set(m, v == null ? null : { c: tot > 0 ? (100 * v) / tot : 0, components: raw[i].get(u)!.components });
    }
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/compute/scale.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/compute/scale.ts pipeline/test/compute/scale.test.ts
git commit -m "feat(pipeline): scale shares with partial-component redistribution"
```

---

### Task 12: Confidence rules

**Files:**
- Create: `pipeline/src/compute/confidence.ts`
- Test: `pipeline/test/compute/confidence.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { strengthConfidence, scaleConfidence, unitConfidence } from '../../src/compute/confidence';

describe('confidence', () => {
  it('strength', () => {
    expect(strengthConfidence({ measured: 2, reconstructed: 0, estimated: false })).toBe('high');
    expect(strengthConfidence({ measured: 1, reconstructed: 1, estimated: false })).toBe('medium');
    expect(strengthConfidence({ measured: 0, reconstructed: 1, estimated: false })).toBe('reconstructed');
    expect(strengthConfidence({ measured: 0, reconstructed: 0, estimated: true })).toBe('estimated');
  });
  it('scale', () => {
    expect(scaleConfidence(3)).toBe('high');
    expect(scaleConfidence(2)).toBe('high');
    expect(scaleConfidence(1)).toBe('medium');
    expect(scaleConfidence(0)).toBe('estimated');
  });
  it('unit = weaker of the two', () => {
    expect(unitConfidence({ measured: 2, reconstructed: 0, estimated: false }, 1)).toBe('medium');
    expect(unitConfidence({ measured: 0, reconstructed: 2, estimated: false }, 3)).toBe('reconstructed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/compute/confidence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`pipeline/src/compute/confidence.ts`:
```ts
import { minConfidence, type Confidence } from '../core/types';

export function strengthConfidence(c: { measured: number; reconstructed: number; estimated: boolean }): Confidence {
  if (c.estimated) return 'estimated';
  if (c.measured >= 2) return 'high';
  if (c.measured === 1) return 'medium';
  if (c.reconstructed > 0) return 'reconstructed';
  return 'estimated';
}

export function scaleConfidence(components: number): Confidence {
  if (components >= 2) return 'high';
  if (components === 1) return 'medium';
  return 'estimated';
}

export function unitConfidence(s: { measured: number; reconstructed: number; estimated: boolean }, scaleComponents: number): Confidence {
  return minConfidence(strengthConfidence(s), scaleConfidence(scaleComponents));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/compute/confidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/compute/confidence.ts pipeline/test/compute/confidence.test.ts
git commit -m "feat(pipeline): confidence rules"
```

---

### Task 13: Event detection

Implements spec §6.4: `new_unit`, `new_model`, `lead_change` (strength, with hysteresis), `scale_lead_change`, `surge`; priority order lead_change > new_unit > new_model > scale_lead_change > surge; at most `maxPerFrontMonth` per front-month; then overrides (`text` replace or `hide`) and custom events.

**Files:**
- Create: `pipeline/src/compute/events.ts`
- Test: `pipeline/test/compute/events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { detectEvents, prettyModel, type FrontCells } from '../../src/compute/events';

const params = { newModelMinDelta: 3, surgeStrength: 5, surgeScale: 5, leadHysteresis: 1, maxPerFrontMonth: 3 };
const front = { id: 'general' as const, name: { ja: '総合戦線', en: 'General Front' } };

const cells = (data: Record<string, (null | [number, number, string | null] | [number, number, string | null, string])[]>): FrontCells =>
  new Map(
    Object.entries(data).map(([u, arr]) => [
      u,
      arr.map((v) => (v ? { s: v[0], c: v[1], bestModel: v[2], q: (v[3] ?? 'high') as 'high' | 'estimated' } : null)),
    ]),
  );

describe('prettyModel', () => {
  it('uses release display names, else strips dates and title-cases', () => {
    expect(prettyModel('dall-e-3', [{ regex: /^dall-e-3/i, release: '2023-10', display: 'DALL·E 3' }])).toBe('DALL·E 3');
    expect(prettyModel('claude-3-opus-20240229', [])).toBe('Claude 3 Opus');
    expect(prettyModel('gemini-2.5-pro', [])).toBe('Gemini 2.5 Pro');
  });
});

describe('detectEvents', () => {
  const months = ['2024-01', '2024-02', '2024-03', '2024-04'];
  const names = { gpt: 'GPT', claude: 'Claude' };
  // 2024-03: claude overtakes on strength (+10, new model), gpt drops 6 (surge down).
  // 2024-04: claude overtakes on scale (42 vs 35) without a +5 scale jump of its own.
  const c = cells({
    gpt: [[100, 80, 'gpt-4'], [100, 78, 'gpt-4'], [94, 60, 'gpt-4'], [94, 35, 'gpt-4']],
    claude: [null, [90, 22, 'claude-2'], [100, 40, 'claude-3-opus-20240229'], [100, 42, 'claude-3-opus-20240229']],
  });
  const ev = detectEvents({ front, months, cells: c, unitNames: names, params, releases: [], overrides: [], custom: [] });
  const types = (m: string) => ev.filter((e) => e.month === m).map((e) => `${e.type}:${e.unit}`);

  it('detects arrivals, model jumps, lead and scale-lead changes', () => {
    expect(types('2024-01')).toEqual([]); // first month: initial leaders, no events; gpt existing from start is not "new"
    expect(types('2024-02')).toEqual(['new_unit:claude']);
    expect(types('2024-03')).toEqual(['lead_change:claude', 'new_model:claude', 'surge:gpt']);
    expect(types('2024-04')).toEqual(['scale_lead_change:claude']);
  });
  it('writes localized text', () => {
    const lead = ev.find((e) => e.type === 'lead_change')!;
    expect(lead.text.ja).toBe('総合戦線で首位交代：GPT → Claude');
    expect(lead.text.en).toBe('Lead change on the General Front: GPT → Claude');
    const nm = ev.find((e) => e.type === 'new_model')!;
    expect(nm.text.ja).toBe('Claude 3 Opus 投入 — 総合戦線');
  });
  it('applies overrides and custom events', () => {
    const ev2 = detectEvents({
      front,
      months,
      cells: c,
      unitNames: names,
      params,
      releases: [],
      overrides: [
        { month: '2024-03', front: 'general', unit: 'gpt', type: 'surge', hide: true },
        { month: '2024-02', front: 'general', unit: 'claude', type: 'new_unit', text: { ja: 'Claude 2 参戦', en: 'Claude 2 joins' } },
      ],
      custom: [{ month: '2024-01', front: 'general', unit: 'gpt', text: { ja: '開戦', en: 'War begins' } }],
    });
    expect(ev2.some((e) => e.type === 'surge')).toBe(false);
    expect(ev2.find((e) => e.type === 'new_unit')!.text.ja).toBe('Claude 2 参戦');
    expect(ev2.find((e) => e.type === 'custom')!.month).toBe('2024-01');
  });
  it('ignores estimated cells for lead changes, model jumps and surges', () => {
    const est = cells({
      a: [[100, 50, 'a-1'], [100, 50, 'a-1'], [100, 50, 'a-1']],
      b: [[94, 50, null, 'estimated'], [100, 70, null, 'estimated'], [80, 70, 'b-1']],
    });
    const ev4 = detectEvents({ front, months: ['2024-01', '2024-02', '2024-03'], cells: est, unitNames: { a: 'A', b: 'B' }, params, releases: [], overrides: [], custom: [] });
    // 2024-02: b is estimated → no surge/lead events; 2024-03: b measured but previous month estimated → no surge
    expect(ev4.filter((e) => e.unit === 'b' && e.type !== 'new_unit')).toEqual([]);
  });
  it('caps events per front-month', () => {
    const ev3 = detectEvents({ front, months, cells: c, unitNames: names, params: { ...params, maxPerFrontMonth: 1 }, releases: [], overrides: [], custom: [] });
    expect(ev3.filter((e) => e.month === '2024-03').map((e) => e.type)).toEqual(['lead_change']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/compute/events.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`pipeline/src/compute/events.ts`:
```ts
import type { Confidence, FrontId, Localized } from '../core/types';
import type { Month } from '../core/months';
import type { CompiledRelease } from '../config/load';
import type { EventsFile, Method } from '../config/schemas';
import { releaseOf } from './assign';

export type EventType = 'new_unit' | 'new_model' | 'lead_change' | 'scale_lead_change' | 'surge' | 'custom';

export interface WorldEvent {
  month: Month;
  front: FrontId;
  unit: string;
  type: EventType;
  text: Localized;
  model?: string;
  from?: string;
}

/** unitId → per-month cell aligned with `months` (null = not present). `bestModel` comes from the front's event group. */
export type FrontCells = Map<string, ({ s: number; c: number; bestModel: string | null; q: Confidence } | null)[]>;

const PRIORITY: Record<EventType, number> = { lead_change: 0, new_unit: 1, new_model: 2, scale_lead_change: 3, surge: 4, custom: 5 };

export function prettyModel(model: string, releases: CompiledRelease[]): string {
  const r = releaseOf(releases, model);
  if (r?.display) return r.display;
  return model
    .replace(/[-_](\d{8}|\d{4}-\d{2}-\d{2}|\d{4})$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b([a-z])/g, (ch) => ch.toUpperCase());
}

function text(type: EventType, front: { name: Localized }, unit: string, extra: { model?: string; from?: string; down?: boolean }): Localized {
  const f = front.name;
  switch (type) {
    case 'new_unit':
      return { ja: `${unit} 参戦 — ${f.ja}`, en: `${unit} enters the ${f.en}` };
    case 'new_model':
      return { ja: `${extra.model} 投入 — ${f.ja}`, en: `${extra.model} deployed — ${f.en}` };
    case 'lead_change':
      return { ja: `${f.ja}で首位交代：${extra.from} → ${unit}`, en: `Lead change on the ${f.en}: ${extra.from} → ${unit}` };
    case 'scale_lead_change':
      return { ja: `${f.ja}で最大勢力が交代：${extra.from} → ${unit}`, en: `Largest force on the ${f.en}: ${extra.from} → ${unit}` };
    case 'surge':
      return extra.down
        ? { ja: `${unit} 後退 — ${f.ja}`, en: `${unit} falls back — ${f.en}` }
        : { ja: `${unit} 急伸 — ${f.ja}`, en: `${unit} surges — ${f.en}` };
    case 'custom':
      return { ja: '', en: '' };
  }
}

function argmax(ids: string[], v: (id: string) => number): string | null {
  let best: string | null = null;
  for (const id of ids) if (best === null || v(id) > v(best)) best = id;
  return best;
}

export function detectEvents(args: {
  front: { id: FrontId; name: Localized };
  months: Month[];
  cells: FrontCells;
  unitNames: Record<string, string>;
  params: Method['events'];
  releases: CompiledRelease[];
  overrides: EventsFile['overrides'];
  custom: EventsFile['custom'];
}): WorldEvent[] {
  const { front, months, cells, params } = args;
  const ids = [...cells.keys()];
  const name = (u: string) => args.unitNames[u] ?? u;
  const raw: WorldEvent[] = [];
  let leadS: string | null = null;
  let leadC: string | null = null;

  months.forEach((m, i) => {
    const at = (u: string, k: number) => cells.get(u)![k];
    const present = ids.filter((u) => at(u, i));
    // estimated values are placeholders, not measurements: they never lead and never move
    const measured = present.filter((u) => at(u, i)!.q !== 'estimated');
    const push = (type: EventType, unit: string, extra: { model?: string; from?: string; down?: boolean } = {}) =>
      raw.push({ month: m, front: front.id, unit, type, text: text(type, front, name(unit), extra), ...(extra.model ? { model: extra.model } : {}), ...(extra.from ? { from: extra.from } : {}) });

    // leaders with hysteresis
    const candS = argmax(measured, (u) => at(u, i)!.s);
    if (candS && candS !== leadS) {
      const curS = leadS && at(leadS, i) && at(leadS, i)!.q !== 'estimated' ? at(leadS, i)!.s : null;
      if (curS === null || at(candS, i)!.s >= curS + params.leadHysteresis) {
        if (i > 0 && leadS) push('lead_change', candS, { from: name(leadS) });
        leadS = candS;
      }
    }
    const candC = argmax(present, (u) => at(u, i)!.c);
    if (candC && candC !== leadC) {
      const curC = leadC && at(leadC, i) ? at(leadC, i)!.c : null;
      if (curC === null || at(candC, i)!.c >= curC + params.leadHysteresis) {
        if (i > 0 && leadC) push('scale_lead_change', candC, { from: name(leadC) });
        leadC = candC;
      }
    }
    if (i === 0) return;
    for (const u of present) {
      const cur = at(u, i)!;
      const prev = at(u, i - 1);
      if (!prev) {
        push('new_unit', u);
        continue;
      }
      if (cur.q === 'estimated' || prev.q === 'estimated') continue;
      const ds = cur.s - prev.s;
      const newModel = cur.bestModel && prev.bestModel && cur.bestModel !== prev.bestModel && ds >= params.newModelMinDelta;
      if (newModel) push('new_model', u, { model: prettyModel(cur.bestModel!, args.releases) });
      else if (Math.abs(ds) >= params.surgeStrength || cur.c - prev.c >= params.surgeScale) push('surge', u, { down: ds <= -params.surgeStrength });
    }
  });

  // cap per month by priority (stable within a priority)
  const byMonth = new Map<Month, WorldEvent[]>();
  for (const e of raw) {
    if (!byMonth.has(e.month)) byMonth.set(e.month, []);
    byMonth.get(e.month)!.push(e);
  }
  let out: WorldEvent[] = [];
  for (const m of months) {
    const list = (byMonth.get(m) ?? []).map((e, k) => ({ e, k }));
    list.sort((a, b) => PRIORITY[a.e.type] - PRIORITY[b.e.type] || a.k - b.k);
    out.push(...list.slice(0, params.maxPerFrontMonth).map((x) => x.e));
  }

  // overrides
  out = out.flatMap((e) => {
    const o = args.overrides.find((x) => x.month === e.month && x.front === e.front && x.unit === e.unit && x.type === e.type);
    if (!o) return [e];
    if (o.hide) return [];
    return [o.text ? { ...e, text: o.text } : e];
  });
  for (const c of args.custom.filter((c) => c.front === front.id)) {
    out.push({ month: c.month, front: c.front, unit: c.unit, type: 'custom', text: c.text });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month) || PRIORITY[a.type] - PRIORITY[b.type]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/compute/events.test.ts`
Expected: PASS. Walk-through: 2024-03 claude 100 ≥ gpt 94 + 1 → lead_change; claude Δs +10 with a new model → new_model; gpt Δs −6 → surge (down). 2024-04 claude c 42 ≥ gpt 35 + 1 → scale_lead_change; claude's own c only +2 → no surge.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/compute/events.ts pipeline/test/compute/events.test.ts
git commit -m "feat(pipeline): battle event detection with overrides"
```

---

### Task 14: World schema and assembly

**Files:**
- Create: `pipeline/src/compute/world.ts`
- Test: `pipeline/test/compute/world.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { WorldSchema, type World } from '../../src/compute/world';

const minimal: World = {
  generatedAt: '2026-10-12T00:00:00.000Z',
  months: ['2026-09', '2026-10'],
  partialMonth: '2026-10',
  orgs: { openai: { name: 'OpenAI', color: '#19c37d' } },
  fronts: [{ id: 'general', name: { ja: '総合戦線', en: 'General Front' } }],
  units: { general: { gpt: { org: 'openai', name: 'GPT' } } },
  series: { general: { gpt: [null, { s: 100, c: 100, q: 'medium' }] } },
  breakdown: { general: { gpt: { '2026-10': [{ source: 'arena-text', value: 100, weight: 0.5, kind: 'measured' }] } } },
  events: [{ month: '2026-10', front: 'general', unit: 'gpt', type: 'new_unit', text: { ja: 'a', en: 'a' } }],
  sources: [{ id: 'arena-text', group: 'arena-text', name: 'Arena', url: 'https://arena.ai', license: 'CC BY 4.0', credit: 'Arena', asOf: '2026-10-07' }],
};

describe('WorldSchema', () => {
  it('accepts a minimal world', () => {
    expect(WorldSchema.safeParse(minimal).success).toBe(true);
  });
  it('rejects series whose length differs from months', () => {
    const bad = structuredClone(minimal);
    bad.series.general.gpt = [null];
    expect(WorldSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects out-of-range values', () => {
    const bad = structuredClone(minimal);
    bad.series.general.gpt = [null, { s: 120, c: 100, q: 'high' }];
    expect(WorldSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/compute/world.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`pipeline/src/compute/world.ts`:
```ts
import { z } from 'zod';
import { FrontIdSchema, LocalizedSchema, MonthStr, EventTypeSchema } from '../config/schemas';

export const UnitMonthSchema = z.object({
  s: z.number().min(0).max(100),
  c: z.number().min(0).max(100),
  q: z.enum(['high', 'medium', 'reconstructed', 'estimated']),
});

export const WorldSchema = z
  .object({
    generatedAt: z.string(),
    months: z.array(MonthStr).min(1),
    partialMonth: MonthStr,
    orgs: z.record(z.string(), z.object({ name: z.string(), color: z.string() })),
    fronts: z.array(z.object({ id: FrontIdSchema, name: LocalizedSchema })),
    units: z.record(z.string(), z.record(z.string(), z.object({ org: z.string(), name: z.string() }))),
    series: z.record(z.string(), z.record(z.string(), z.array(UnitMonthSchema.nullable()))),
    breakdown: z.record(
      z.string(),
      z.record(
        z.string(),
        z.record(
          z.string(),
          z.array(z.object({ source: z.string(), value: z.number(), weight: z.number(), kind: z.enum(['measured', 'reconstructed']) })),
        ),
      ),
    ),
    events: z.array(
      z.object({
        month: MonthStr,
        front: FrontIdSchema,
        unit: z.string(),
        type: EventTypeSchema,
        text: LocalizedSchema,
        model: z.string().optional(),
        from: z.string().optional(),
      }),
    ),
    sources: z.array(
      z.object({ id: z.string(), group: z.string(), name: z.string(), url: z.string(), license: z.string(), credit: z.string(), asOf: z.string().nullable() }),
    ),
  })
  .superRefine((w, ctx) => {
    for (const [f, units] of Object.entries(w.series)) {
      for (const [u, arr] of Object.entries(units)) {
        if (arr.length !== w.months.length) {
          ctx.addIssue({ code: 'custom', message: `series.${f}.${u} has ${arr.length} entries, expected ${w.months.length}` });
        }
        if (!w.units[f]?.[u]) ctx.addIssue({ code: 'custom', message: `series.${f}.${u} has no unit definition` });
      }
    }
  });

export type World = z.infer<typeof WorldSchema>;

export function validateWorld(w: unknown): World {
  const r = WorldSchema.safeParse(w);
  if (!r.success) throw new Error(`world.json invalid: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/compute/world.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/compute/world.ts pipeline/test/compute/world.test.ts
git commit -m "feat(pipeline): world.json zod schema"
```

---

### Task 15: Source module contract, HTTP helper and fetch runner

**Files:**
- Create: `pipeline/src/sources/types.ts`, `pipeline/src/sources/http.ts`, `pipeline/src/sources/run.ts`
- Test: `pipeline/test/sources/run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFetch } from '../../src/sources/run';
import type { SourceModule, FetchCtx } from '../../src/sources/types';
import { loadSource } from '../../src/raw/store';

const meta = { name: 'X', url: 'https://x', license: 'CC BY 4.0', credit: 'X' };
const ok: SourceModule = {
  id: 'ok-src',
  role: 'strength',
  group: 'g',
  history: 'full',
  meta,
  fetch: async () => '1,2',
  parse: (raw) =>
    String(raw)
      .split(',')
      .map((v) => ({ series: 'ok-src', kind: 'elo', model: 'm', date: '2026-10-01', dateKind: 'snapshot', value: Number(v) })),
};
const broken: SourceModule = { ...ok, id: 'broken', fetch: async () => { throw new Error('HTTP 503'); } };
const keyed: SourceModule = { ...ok, id: 'keyed', needsEnv: ['SOME_KEY'] };
const empty: SourceModule = { ...ok, id: 'empty', parse: () => [] };
const stat: SourceModule = { ...ok, id: 'static-src', static: true };

const ctx = (): FetchCtx => ({
  env: {},
  now: new Date('2026-10-12T06:00:00Z'),
  backfill: false,
  keys: () => [],
  fetchText: async () => '',
  fetchBytes: async () => new Uint8Array(),
  fetchJson: async () => ({}),
  log: () => {},
});

describe('runFetch', () => {
  it('saves ok sources, isolates failures, skips missing keys, treats empty parse as failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raw-'));
    const status = await runFetch([ok, broken, keyed, empty, stat], ctx(), dir);
    expect(status.map((s) => [s.id, s.status])).toEqual([
      ['ok-src', 'ok'],
      ['broken', 'failed'],
      ['keyed', 'skipped'],
      ['empty', 'failed'],
      ['static-src', 'skipped'],
    ]);
    expect(status[1].error).toContain('HTTP 503');
    expect(status[2].error).toContain('SOME_KEY');
    expect(status[4].error).toContain('static');
    expect(loadSource<{ value: number }>(dir, 'ok-src', 'full').map((o) => o.value)).toEqual([1, 2]);
    const saved = JSON.parse(readFileSync(join(dir, '_status', '2026-10-12.json'), 'utf8'));
    expect(saved).toHaveLength(5);
  });
  it('runs only selected ids', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raw-'));
    const status = await runFetch([ok, broken], ctx(), dir, ['ok-src']);
    expect(status.map((s) => s.id)).toEqual(['ok-src']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sources/run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the contract**

`pipeline/src/sources/types.ts`:
```ts
import type { Observation, SignalId, SignalObs } from '../core/types';
import type { HistoryMode } from '../raw/store';

export interface FetchCtx {
  env: Record<string, string | undefined>;
  now: Date;
  /** true with `npm run fetch -- --backfill`: accumulate-history sources fetch their whole past, not just recent months */
  backfill: boolean;
  /** identifiers configured in curated/units.yaml for a scale signal (hostnames, article titles, app ids…), de-duplicated */
  keys(signal: SignalId): string[];
  fetchText(url: string, init?: RequestInit): Promise<string>;
  fetchBytes(url: string, init?: RequestInit): Promise<Uint8Array>;
  fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T>;
  log(msg: string): void;
}

export interface SourceMeta {
  name: string;
  url: string;
  license: string;
  credit: string;
}

interface BaseModule {
  id: string;
  history: HistoryMode;
  needsEnv?: string[];
  /** Data imported once by a script (e.g. scripts/import_arena_legacy.py); runFetch never fetches it. */
  static?: boolean;
  meta: SourceMeta;
  fetch(ctx: FetchCtx): Promise<unknown>;
}

export interface StrengthModule extends BaseModule {
  role: 'strength';
  /** weight key in method.yaml strength.weights[front] */
  group: string;
  /** higher wins inside a group when several series have data in a month (default 1) */
  priority?: number;
  parse(raw: unknown, ctx: { now: Date }): Observation[];
}

export interface ScaleModule extends BaseModule {
  role: 'scale';
  parse(raw: unknown, ctx: { now: Date }): SignalObs[];
}

export type SourceModule = StrengthModule | ScaleModule;
```

- [ ] **Step 4: Implement HTTP helper**

`pipeline/src/sources/http.ts`:
```ts
import type { FetchCtx } from './types';

export const USER_AGENT = 'AI-WAR-data-pipeline/0.1 (non-commercial research visualisation; https://github.com/ukitako1030)';

async function fetchWithRetry(url: string, init: RequestInit = {}, attempts = 3, timeoutMs = 60_000): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { 'User-Agent': USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
      });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function makeFetchCtx(
  now: Date,
  env: Record<string, string | undefined>,
  log: (m: string) => void,
  opts: { backfill: boolean; keys: FetchCtx['keys'] },
): FetchCtx {
  return {
    env,
    now,
    log,
    backfill: opts.backfill,
    keys: opts.keys,
    fetchText: async (url, init) => (await fetchWithRetry(url, init)).text(),
    fetchBytes: async (url, init) => new Uint8Array(await (await fetchWithRetry(url, init)).arrayBuffer()),
    fetchJson: async <T>(url: string, init?: RequestInit) => (await (await fetchWithRetry(url, init)).json()) as T,
  };
}

/** Sleep helper for polite APIs (e.g. Tranco 1 req/s). */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

- [ ] **Step 5: Implement runner**

`pipeline/src/sources/run.ts`:
```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveSnapshot } from '../raw/store';
import { todayISO } from '../core/months';
import type { FetchCtx, SourceModule } from './types';

export interface FetchStatus {
  id: string;
  status: 'ok' | 'skipped' | 'failed';
  count: number;
  error?: string;
  ms: number;
}

export async function runFetch(modules: SourceModule[], ctx: FetchCtx, rawDir: string, only?: string[]): Promise<FetchStatus[]> {
  const date = todayISO(ctx.now);
  const out: FetchStatus[] = [];
  for (const mod of modules) {
    if (only && !only.includes(mod.id)) continue;
    const t0 = Date.now();
    if (mod.static) {
      out.push({ id: mod.id, status: 'skipped', count: 0, error: 'static source (imported by script)', ms: 0 });
      continue;
    }
    const missing = (mod.needsEnv ?? []).filter((k) => !ctx.env[k]);
    if (missing.length) {
      out.push({ id: mod.id, status: 'skipped', count: 0, error: `missing env: ${missing.join(', ')}`, ms: 0 });
      ctx.log(`- ${mod.id}: skipped (missing ${missing.join(', ')})`);
      continue;
    }
    try {
      const raw = await mod.fetch(ctx);
      const items = mod.parse(raw, { now: ctx.now });
      if (!items.length) throw new Error('parse returned 0 items (format change?)');
      saveSnapshot(rawDir, mod.id, date, items as unknown[], mod.history);
      out.push({ id: mod.id, status: 'ok', count: items.length, ms: Date.now() - t0 });
      ctx.log(`✓ ${mod.id}: ${items.length} items`);
    } catch (e) {
      out.push({ id: mod.id, status: 'failed', count: 0, error: (e as Error).message, ms: Date.now() - t0 });
      ctx.log(`✗ ${mod.id}: ${(e as Error).message}`);
    }
  }
  mkdirSync(join(rawDir, '_status'), { recursive: true });
  writeFileSync(join(rawDir, '_status', `${date}.json`), JSON.stringify(out, null, 2) + '\n');
  return out;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/sources/run.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add pipeline/src/sources/types.ts pipeline/src/sources/http.ts pipeline/src/sources/run.ts pipeline/test/sources/run.test.ts
git commit -m "feat(pipeline): source contract, http helper and fetch runner"
```

---

### Task 16: computeWorld orchestrator + integration test

**Files:**
- Create: `pipeline/src/compute/index.ts`
- Test: `pipeline/test/compute/index.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeWorld } from '../../src/compute/index';
import { saveSnapshot } from '../../src/raw/store';
import type { SourceModule } from '../../src/sources/types';
import type { Observation, SignalObs } from '../../src/core/types';

const FRONTS = ['general', 'code', 'agent', 'image', 'video', 'speech', 'music'];
const meta = { name: 'Fake', url: 'https://fake', license: 'CC BY 4.0', credit: 'Fake' };
const arena: SourceModule = { id: 'fake-arena', role: 'strength', group: 'arena-text', history: 'full', meta, fetch: async () => null, parse: () => [] };
const wiki: SourceModule = { id: 'fake-wiki', role: 'scale', history: 'full', meta, fetch: async () => null, parse: () => [] };

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'world-'));
  mkdirSync(join(dir, 'curated'));
  mkdirSync(join(dir, 'config'));
  const fronts = FRONTS.map((f) =>
    f === 'general'
      ? `  general:
    name: { ja: 総合戦線, en: General Front }
    units:
      gpt: { org: openai, name: GPT, since: 2022-11, match: ['^gpt'], scale: { wikipedia: [ChatGPT] } }
      claude: { org: anthropic, name: Claude, since: 2023-03, match: ['^claude'], scale: { wikipedia: [Claude] } }`
      : `  ${f}:\n    name: { ja: ${f}, en: ${f} }\n    units: {}`,
  ).join('\n');
  writeFileSync(
    join(dir, 'curated', 'units.yaml'),
    `orgs:\n  openai: { name: OpenAI, color: '#19c37d' }\n  anthropic: { name: Anthropic, color: '#ff8a4c' }\nfronts:\n${fronts}\n`,
  );
  writeFileSync(join(dir, 'curated', 'announcements.yaml'), 'series: {}\n');
  writeFileSync(join(dir, 'curated', 'events.yaml'), 'custom:\n  - { month: 2022-11, front: general, unit: gpt, text: { ja: 開戦, en: War begins } }\n');
  writeFileSync(join(dir, 'curated', 'releases.yaml'), 'models: []\n');
  writeFileSync(
    join(dir, 'config', 'method.yaml'),
    `start: 2022-11
strength:
  minUnits: 2
  snapshotMaxAgeDays: 92
  releaseActiveMonths: 3
  kinds: { elo: { scale: 400 }, percent: { clampLo: 0.5, clampHi: 99.5 }, minutes: { kappa: 1 }, eci: { tau: 8 } }
  estimate: { floor: 60, step: 6 }
  weights:
    general: { arena-text: 1 }
scale:
  smoothingMonths: 1
  announcementStaleMonths: 6
  metricFactors: { MAU: 1, WAU: 1.4, DAU: 2.5 }
  floorFactor: 0.5
  components:
    users: { weight: 0.45, signals: [announcements] }
    attention: { weight: 0.1, signals: [wikipedia] }
  base: [attention]
events: { newModelMinDelta: 3, surgeStrength: 5, surgeScale: 5, leadHysteresis: 1, maxPerFrontMonth: 3 }
`,
  );
  const obs: Observation[] = [
    { series: 'fake-arena', kind: 'elo', model: 'gpt-4', date: '2023-05-31', dateKind: 'snapshot', value: 1250 },
    { series: 'fake-arena', kind: 'elo', model: 'claude-1', date: '2023-05-31', dateKind: 'snapshot', value: 1150 },
  ];
  saveSnapshot(join(dir, 'raw'), 'fake-arena', '2026-10-05', obs, 'full');
  const sig: SignalObs[] = [
    { signal: 'wikipedia', key: 'ChatGPT', month: '2023-05', value: 900 },
    { signal: 'wikipedia', key: 'Claude', month: '2023-05', value: 100 },
  ];
  saveSnapshot(join(dir, 'raw'), 'fake-wiki', '2026-10-05', sig, 'full');
});

describe('computeWorld', () => {
  it('builds a valid world from raw + curated', () => {
    const w = computeWorld({
      rawDir: join(dir, 'raw'),
      curatedDir: join(dir, 'curated'),
      methodPath: join(dir, 'config', 'method.yaml'),
      modules: [arena, wiki],
      now: new Date('2023-06-15T00:00:00Z'),
    });
    expect(w.months).toEqual(['2022-11', '2022-12', '2023-01', '2023-02', '2023-03', '2023-04', '2023-05', '2023-06']);
    expect(w.partialMonth).toBe('2023-06');
    const gpt = w.series.general.gpt;
    const claude = w.series.general.claude;
    expect(gpt[0]).toEqual({ s: 100, c: 100, q: 'estimated' }); // alone, no data
    expect(claude[3]).toBeNull(); // 2023-02: not yet
    expect(gpt[6]!.s).toBe(100);
    expect(claude[6]!.s).toBeCloseTo(200 / (1 + 10 ** 0.25), 1);
    expect(gpt[6]!.c).toBeCloseTo(90, 1);
    expect(gpt[6]!.q).toBe('medium');
    expect(w.breakdown.general.gpt['2023-05'][0]).toMatchObject({ source: 'arena-text', weight: 1, kind: 'measured' });
    expect(w.events.find((e) => e.type === 'new_unit' && e.unit === 'claude')?.month).toBe('2023-03');
    expect(w.events.find((e) => e.type === 'custom')?.text.ja).toBe('開戦');
    expect(w.sources.map((s) => s.id)).toEqual(['fake-arena', 'fake-wiki']);
    expect(w.sources[0].asOf).toBe('2026-10-05');
    expect(w.fronts).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/compute/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`pipeline/src/compute/index.ts`:
```ts
import { join } from 'node:path';
import { FRONT_IDS, type FrontId, type Observation, type SignalObs } from '../core/types';
import { monthRange, toMonth, type Month } from '../core/months';
import { round1 } from '../core/math';
import { parseAnnouncements, parseEvents, parseMethod, parseReleases, parseUnits, readText } from '../config/load';
import { latestSnapshotDate, loadSource } from '../raw/store';
import type { SourceModule, StrengthModule } from '../sources/types';
import { assignSeries, bySeries, unitExists, type SeriesTable } from './assign';
import { computeStrength, fillEstimatedStrength } from './strength';
import { announcementMonthly } from './announcements';
import { buildSignalTable } from './signals';
import { computeScale } from './scale';
import { unitConfidence } from './confidence';
import { detectEvents, type FrontCells, type WorldEvent } from './events';
import { validateWorld, type World } from './world';

export interface ComputeOpts {
  rawDir: string;
  curatedDir: string;
  methodPath: string;
  modules: SourceModule[];
  now: Date;
}

export function computeWorld(opts: ComputeOpts): World {
  const method = parseMethod(readText(opts.methodPath));
  const units = parseUnits(readText(join(opts.curatedDir, 'units.yaml')));
  const announcements = parseAnnouncements(readText(join(opts.curatedDir, 'announcements.yaml')));
  const eventsFile = parseEvents(readText(join(opts.curatedDir, 'events.yaml')));
  const releases = parseReleases(readText(join(opts.curatedDir, 'releases.yaml')));
  const months = monthRange(method.start, toMonth(opts.now));

  const strengthObs = new Map<string, Observation[]>();
  const signalObs: SignalObs[] = [];
  for (const mod of opts.modules) {
    const items = loadSource<Observation | SignalObs>(opts.rawDir, mod.id, mod.history);
    if (mod.role === 'strength') strengthObs.set(mod.id, items as Observation[]);
    else signalObs.push(...(items as SignalObs[]));
  }

  const world: World = {
    generatedAt: opts.now.toISOString(),
    months,
    partialMonth: months[months.length - 1],
    orgs: units.orgs,
    fronts: FRONT_IDS.map((id) => ({ id, name: units.fronts[id].name })),
    units: {},
    series: {},
    breakdown: {},
    events: [],
    sources: opts.modules.map((m) => ({
      id: m.id,
      group: m.role === 'strength' ? m.group : m.id,
      name: m.meta.name,
      url: m.meta.url,
      license: m.meta.license,
      credit: m.meta.credit,
      asOf: latestSnapshotDate(opts.rawDir, m.id),
    })),
  };

  for (const front of FRONT_IDS) {
    const fUnits = units.units[front];
    const ids = fUnits.map((u) => u.id);
    const byId = new Map(fUnits.map((u) => [u.id, u]));
    const exists = (id: string, m: Month) => unitExists(byId.get(id)!, m);
    world.units[front] = Object.fromEntries(fUnits.map((u) => [u.id, { org: u.org, name: u.name }]));

    // strength
    const weights = method.strength.weights[front] ?? {};
    const tables: SeriesTable[] = [];
    for (const mod of opts.modules) {
      if (mod.role !== 'strength' || !(mod.group in weights)) continue;
      for (const list of bySeries(strengthObs.get(mod.id) ?? []).values()) {
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
          }),
        );
      }
    }
    const strength = computeStrength({ tables, unitIds: ids, months, weights, kinds: method.strength.kinds, minUnits: method.strength.minUnits });
    // new_model events compare model names within ONE group so that a source going stale doesn't look like a new model
    const eventGroup = Object.entries(weights).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];

    // scale
    const signals = buildSignalTable(fUnits, signalObs);
    const ann = new Map<string, Map<Month, number>>();
    for (const u of fUnits) {
      const key = u.scale.announcements;
      if (key && announcements.series[key]) {
        ann.set(u.id, announcementMonthly(announcements.series[key], months, method.scale.metricFactors, method.scale.announcementStaleMonths));
      }
    }
    if (ann.size) signals.set('announcements', ann);
    const scale = computeScale({ unitIds: ids, months, exists, signals, method: method.scale });
    const shares = new Map(ids.map((u) => [u, new Map(months.map((m) => [m, scale.get(u)!.get(m)?.c ?? null]))]));
    fillEstimatedStrength({ cells: strength, shares, months, exists, floor: method.strength.estimate.floor, step: method.strength.estimate.step });

    // assemble series + breakdown
    world.series[front] = {};
    world.breakdown[front] = {};
    const cells: FrontCells = new Map();
    for (const u of ids) {
      const arr = months.map((m) => {
        if (!exists(u, m)) return null;
        const st = strength.get(u)!.get(m)!;
        const sc = scale.get(u)!.get(m)!;
        return { s: round1(st.s!), c: round1(sc.c), q: unitConfidence(st, sc.components) };
      });
      world.series[front][u] = arr;
      cells.set(
        u,
        months.map((m, i) =>
          arr[i]
            ? {
                s: arr[i]!.s,
                c: arr[i]!.c,
                q: arr[i]!.q,
                bestModel: strength.get(u)!.get(m)!.breakdown.find((g) => g.group === eventGroup)?.model ?? null,
              }
            : null,
        ),
      );
      const bd: World['breakdown'][string][string] = {};
      for (const m of months) {
        const st = strength.get(u)!.get(m);
        if (st && st.breakdown.length) {
          bd[m] = st.breakdown.map((g) => ({ source: g.group, value: round1(g.score), weight: g.weight, kind: g.reconstructed ? 'reconstructed' : 'measured' }));
        }
      }
      world.breakdown[front][u] = bd;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/compute/index.test.ts`
Expected: PASS. Check of expectations: 2022-11..2023-04 gpt has no strength data → estimated alone → 100; c with no signals → uniform → 100 (alone). In 2023-03/04 both exist, no data → ranked by uniform shares 50/50 → gpt 100, claude 94 (estimated). 2023-05: arena snapshot 2023-05-31 → gpt 100, claude 200/(1+10^0.25) ≈ 72.0; wiki 900/100 → c 90/10, q medium (1 strength group, 1 component). 2023-06: snapshot 2023-05-31 is 30 days old → still used.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/compute/index.ts pipeline/test/compute/index.test.ts
git commit -m "feat(pipeline): computeWorld orchestrator with integration test"
```

---

### Task 17: CLIs and HTML report

**Files:**
- Create: `pipeline/src/sources/index.ts` (empty registry for now), `pipeline/src/cli/fetch.ts`, `pipeline/src/cli/compute.ts`, `pipeline/src/report/html.ts`, `pipeline/src/cli/report.ts`
- Test: `pipeline/test/report/html.test.ts`

- [ ] **Step 1: Write the failing report test**

```ts
import { describe, it, expect } from 'vitest';
import { renderReport } from '../../src/report/html';
import type { World } from '../../src/compute/world';

const w: World = {
  generatedAt: '2026-10-12T00:00:00.000Z',
  months: ['2026-09', '2026-10'],
  partialMonth: '2026-10',
  orgs: { openai: { name: 'OpenAI', color: '#19c37d' } },
  fronts: [{ id: 'general', name: { ja: '総合戦線', en: 'General Front' } }],
  units: { general: { gpt: { org: 'openai', name: 'GPT' } } },
  series: { general: { gpt: [{ s: 90, c: 100, q: 'high' }, { s: 100, c: 100, q: 'medium' }] } },
  breakdown: { general: { gpt: {} } },
  events: [{ month: '2026-10', front: 'general', unit: 'gpt', type: 'lead_change', text: { ja: '首位交代', en: 'Lead' } }],
  sources: [],
};

describe('renderReport', () => {
  it('renders fronts, latest values, sparklines and events', () => {
    const html = renderReport(w);
    expect(html).toContain('<title>AI WAR データ確認レポート</title>');
    expect(html).toContain('総合戦線');
    expect(html).toContain('GPT');
    expect(html).toContain('<svg');
    expect(html).toContain('首位交代');
    expect(html).toContain('medium');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/report/html.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the report**

`pipeline/src/report/html.ts`:
```ts
import type { World } from '../compute/world';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function spark(values: (number | null)[], color: string, w = 260, h = 40): string {
  const pts: string[] = [];
  values.forEach((v, i) => {
    if (v == null) return;
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = h - (v / 100) * h;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts.join(' ')}"/></svg>`;
}

export function renderReport(w: World): string {
  const last = w.months.length - 1;
  const sections = w.fronts
    .map((f) => {
      const units = Object.entries(w.units[f.id] ?? {});
      const rows = units
        .map(([id, u]) => ({ id, u, cell: w.series[f.id][id][last], series: w.series[f.id][id] }))
        .sort((a, b) => (b.cell?.s ?? -1) - (a.cell?.s ?? -1))
        .map(({ u, cell, series }) => {
          const color = w.orgs[u.org]?.color ?? '#888';
          return `<tr><td><span class="chip" style="background:${color}"></span>${esc(u.name)}</td><td>${esc(w.orgs[u.org]?.name ?? u.org)}</td>
<td class="num">${cell ? cell.s.toFixed(1) : '—'}</td><td class="num">${cell ? cell.c.toFixed(1) : '—'}</td><td>${cell?.q ?? '—'}</td>
<td>${spark(series.map((c) => c?.s ?? null), color)}</td><td>${spark(series.map((c) => c?.c ?? null), color)}</td></tr>`;
        })
        .join('\n');
      const events = w.events
        .filter((e) => e.front === f.id)
        .map((e) => `<li><b>${e.month}</b> [${e.type}] ${esc(e.text.ja)}</li>`)
        .join('\n');
      return `<section><h2>${esc(f.name.ja)} <small>${esc(f.name.en)}</small></h2>
<table><thead><tr><th>部隊</th><th>軍</th><th>強さ</th><th>規模%</th><th>確度</th><th>強さ推移 (${w.months[0]}→${w.months[last]})</th><th>規模推移</th></tr></thead>
<tbody>${rows}</tbody></table>
<details><summary>戦況速報 (${w.events.filter((e) => e.front === f.id).length})</summary><ul>${events}</ul></details></section>`;
    })
    .join('\n');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI WAR データ確認レポート</title>
<style>
body{font-family:system-ui,'Noto Sans JP',sans-serif;background:#0b1020;color:#dfe6ff;margin:0;padding:24px}
h1{margin:0 0 4px}h2{margin:32px 0 8px}small{color:#7f8db3;font-weight:normal}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:6px 8px;border-bottom:1px solid #1c2747;text-align:left}
.num{text-align:right;font-variant-numeric:tabular-nums}.chip{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
details{margin-top:8px;color:#aab6da}
</style></head><body>
<h1>AI WAR データ確認レポート</h1>
<div>生成: ${esc(w.generatedAt)} ／ 期間: ${w.months[0]} 〜 ${w.months[last]}（${w.partialMonth} は速報値）</div>
${sections}
</body></html>
`;
}
```

- [ ] **Step 4: Run report test**

Run: `npx vitest run test/report/html.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the (empty) registry and CLIs**

`pipeline/src/sources/index.ts`:
```ts
import type { SourceModule } from './types';

/** Every source module, in fetch order. Part B tasks append to this list. */
export const SOURCES: SourceModule[] = [];
```

`pipeline/src/cli/fetch.ts`:
```ts
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { SOURCES } from '../sources/index';
import { makeFetchCtx } from '../sources/http';
import { runFetch } from '../sources/run';
import { parseUnits } from '../config/load';
import { FRONT_IDS, type SignalId } from '../core/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Minimal .env loader (repo-root .env, KEY=VALUE lines). Never prints values. */
function loadDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('-'));
const backfill = args.includes('--backfill');
const env = { ...loadDotEnv(join(root, '..', '.env')), ...process.env };
const units = parseUnits(readFileSync(join(root, 'curated', 'units.yaml'), 'utf8'));
const keys = (signal: SignalId): string[] => {
  const out = new Set<string>();
  for (const f of FRONT_IDS) {
    for (const u of units.units[f]) {
      const v = (u.scale as Record<string, string | string[] | undefined>)[signal];
      for (const k of Array.isArray(v) ? v : v ? [v] : []) out.add(k);
    }
  }
  return [...out];
};
const ctx = makeFetchCtx(new Date(), env, (m) => console.log(m), { backfill, keys });
const status = await runFetch(SOURCES, ctx, join(root, 'raw'), only.length ? only : undefined);
const failed = status.filter((s) => s.status === 'failed').length;
console.log(`done: ${status.filter((s) => s.status === 'ok').length} ok, ${status.filter((s) => s.status === 'skipped').length} skipped, ${failed} failed`);
```

`pipeline/src/cli/compute.ts`:
```ts
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
```

`pipeline/src/cli/report.ts`:
```ts
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
```

- [ ] **Step 6: Typecheck and full test run**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add pipeline/src/sources/index.ts pipeline/src/cli pipeline/src/report pipeline/test/report
git commit -m "feat(pipeline): fetch/compute/report CLIs and HTML report"
```

---

# Part B — Sources, configuration and the first real run

Part B tasks are **contract-style**: each gives the exact module interface, the URL(s), the field mapping and the tests that must exist. The parsing details (column names, quirks) come from the recon notes and the real fixtures already captured in `pipeline/test/fixtures/<sourceId>/`; read the referenced note section before coding. Parsers are pure functions tested against those fixtures; `fetch()` is thin and is exercised only in Task 33's real run.

Recon notes:
- LLM/code/agent: `docs/superpowers/recon/sources-llm.md` (if missing, the per-source drafts are in the session scratchpad `recon-llm/notes-{arena,epoch,gh,lbos}.md`)
- Media: `docs/superpowers/recon/sources-media.md`
- Scale: `docs/superpowers/recon/sources-scale.md`
- Arena legacy pickles: `docs/superpowers/recon/sources-arena-legacy.md`

Rules for every source module:
- File `pipeline/src/sources/<name>.ts`; export `SourceModule` constants (or a small factory + constants).
- `meta.credit` is the attribution string the site will display (e.g. `"Arena leaderboard dataset (lmarena-ai/leaderboard-dataset), CC BY 4.0"`).
- `fetch()` returns JSON-serialisable data (string, rows array or object). It must strip personal data (e.g. emails) before returning.
- `parse()` is pure and deterministic; it must never throw on a single bad row (skip it), but return `[]` only if the whole payload is unusable.
- Percent values are 0–100. Dates are `YYYY-MM-DD`; months `YYYY-MM`.
- Tests live in `pipeline/test/sources/<name>.test.ts`, load fixtures with `readFileSync(new URL('../fixtures/<id>/<file>', import.meta.url))`, and assert concrete values taken from the fixture (pick 2–3 specific rows and assert their mapped fields exactly).
- Commit the fixtures a task uses together with the task (`git add pipeline/test/fixtures/<id>`), after removing any personal data.
- Do not call any endpoint that a source's robots.txt or terms disallow (notably Design Arena's internal `/api/` website routes, arena.ai and openrouter.ai website pages). Only the URLs named in the task.

### Task 18: Source helper library

**Files:** Create `pipeline/src/sources/lib/{csv,parquet,archive,values,memo}.ts`; Test `pipeline/test/sources/lib.test.ts`.

- `csv.ts`: `parseCsv(text: string): Record<string, string>[]` using `csv-parse/sync` with `{ columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }`. Accepts CRLF and quoted multi-line fields.
- `parquet.ts`: `readParquetRows(bytes: Uint8Array, opts: { columns: string[]; filter?: (row: Record<string, unknown>) => boolean; chunkRows?: number }): Promise<Record<string, unknown>[]>` using `hyparquet` (`parquetMetadata`, `parquetReadObjects`) with `compressors` from `hyparquet-compressors`; reads in chunks of `chunkRows` (default 50 000) rows so a 58 MB / 1.2 M-row file never materialises all rows at once; applies `filter` per chunk; converts every `bigint` value to `number`.
- `archive.ts`: `unzipTexts(bytes: Uint8Array, name: RegExp): Record<string, string>` via `fflate.unzipSync` with a filter; `gunzipText(bytes: Uint8Array): string` via `node:zlib` `gunzipSync`.
- `values.ts`: `toNumber(v: unknown): number | null` (handles number, bigint, numeric strings, `"85.06%"`, `""`/`"-"`/`"🚧"`/null → null, NaN → null); `isoDate(v: unknown): string | null` (accepts `YYYY-MM-DD`, `YYYYMMDD`, ISO datetimes, JS `Date`, Excel serial numbers 20000–80000 → `YYYY-MM-DD`); `lastPerMonth<T>(rows: T[], dateOf: (r: T) => string): T[]` — keeps only rows whose date equals the latest date present in that calendar month.
- `memo.ts`: `memoBytes(key: string, load: () => Promise<Uint8Array>): Promise<Uint8Array>` — process-level cache so two modules sharing a file (e.g. Arena text_style_control) download it once.

Tests (required): CSV with a quoted multi-line field and CRLF; `toNumber` table of the cases above; `isoDate` for `'20250514'`, `45870` (→ `'2025-08-01'`), `'2025-07-28T09:28:54-04:00'` (→ `'2025-07-28'`); `lastPerMonth` keeps `2025-05-19` and drops `2025-05-11`; gzip round-trip; zip round-trip using `fflate.zipSync` in the test; parquet: write a 3-column, 5-row file with `hyparquet-writer` (add as devDependency; see its README for `parquetWriteBuffer`) including an INT64 column, read it back with `columns` + `filter` + `chunkRows: 2`, assert bigint → number and filtering.

Commit: `feat(pipeline): source helper library (csv, parquet, archive, values)`.

### Task 19: Arena leaderboard modules

**Files:** Create `pipeline/src/sources/arena.ts`; Test `pipeline/test/sources/arena.test.ts`; fixtures `arena-text`, `arena-text-style`, `arena-webdev`, `arena-t2i`, `arena-image-edit`, `arena-t2v`, `arena-i2v`.
**Notes:** sources-llm.md (Arena sections) / scratchpad `recon-llm/notes-arena.md`; sources-media.md "arena-t2i / …".

Factory `arenaModule(cfg: { id: string; subset: string; group: string; priority?: number; category?: string; name: string })` → `StrengthModule` with `history: 'full'`:
- `fetch`: `memoBytes(url, …)` of `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/${subset}/full-00000-of-00001.parquet` (fetch follows the 302), then `readParquetRows(bytes, { columns: ['model_name','organization','rating','category','leaderboard_publish_date'], filter: r => r.category === (cfg.category ?? 'overall') })`.
- `parse(rows)`: filter again by category; drop rows whose `rating` is not finite; `lastPerMonth` by `leaderboard_publish_date`; emit `{ series: cfg.id, kind: 'elo', model: model_name, org: organization || undefined, date: leaderboard_publish_date, dateKind: 'snapshot', value: rating }`.
- `meta`: name `Arena (${cfg.name})`, url `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset`, license `CC BY 4.0`, credit `Arena leaderboard dataset (lmarena-ai/leaderboard-dataset), CC BY 4.0`.

Exported constants:

| const | id | subset | category | group | priority |
|---|---|---|---|---|---|
| `arenaText` | arena-text | text | overall | arena-text | 1 |
| `arenaTextStyle` | arena-text-style | text_style_control | overall | arena-text | 2 |
| `arenaCoding` | arena-coding | text_style_control | coding | arena-coding | 2 |
| `arenaCodingRaw` | arena-coding-raw | text | coding | arena-coding | 1 |
| `arenaWebdev` | arena-webdev | webdev | overall | arena-webdev | 1 |
| `arenaT2i` | arena-t2i | text_to_image | overall | arena-image | 1 |
| `arenaImageEdit` | arena-image-edit | image_edit | overall | arena-image | 1 |
| `arenaT2v` | arena-t2v | text_to_video | overall | arena-video | 1 |
| `arenaI2v` | arena-i2v | image_to_video | overall | arena-video | 1 |

(`arena-coding*` give the code front a 2024-04+ history; t2i/edit and t2v/i2v share a group so their scores are averaged.)

Tests (required): for `arena-text` fixture — rows of category `coding` are ignored; of the two May-2025 dates only `2025-05-19` survives; an empty-string organization becomes `undefined`; one specific row's mapped observation equals the expected object. For `arena-image-edit` — dates that only had `multi_image_edit` rows produce nothing. For each of the 7 fixtures, `parse` returns > 0 observations, all with finite values and `kind: 'elo'`.

Commit: `feat(pipeline): Arena leaderboard dataset modules`.

### Task 20: Arena legacy (static, survivorship fix)

**Files:** Create `pipeline/src/sources/arenaLegacy.ts`; Test `pipeline/test/sources/arenaLegacy.test.ts`; `pipeline/scripts/import_arena_legacy.py` (already written by recon — review it, keep it); output `pipeline/raw/arena-legacy/<date>.json`.
**Notes:** `docs/superpowers/recon/sources-arena-legacy.md`.

- Module `arenaLegacy`: `id 'arena-legacy'`, `role 'strength'`, `group 'arena-text'`, `priority 3`, `history 'full'`, `static: true`, `fetch` throws `Error('static source: run scripts/import_arena_legacy.py')`, `parse(raw)` validates that every item is an `Observation` with `kind 'elo'`, `dateKind 'snapshot'` and returns them (drops invalid ones). Meta credit per the recon licence verdict.
- Run the script once (documented Python deps in its header), check the output (months covered, a pre-2024 Claude row exists), and commit the raw file.
- Tests: parse keeps valid items, drops an item with a non-finite value; `runFetch` reports it as skipped (static).

Commit: `feat(pipeline): static Arena legacy snapshots (pre-2025-09, incl. retired models)`.

### Task 21: Epoch modules (ECI + benchmark hub)

**Files:** Create `pipeline/src/sources/epoch.ts`; Test `pipeline/test/sources/epoch.test.ts`; fixtures `epoch-eci`, `epoch-terminalbench`, `epoch-metr`, `epoch-vending`, `epoch-apex`, `epoch-swebench`, `epoch-osworld`, `epoch-osworld2`.
**Notes:** scratchpad `recon-llm/notes-epoch.md` (zip inventory gives exact file names and score columns).

- `epochEci`: fetch `https://epoch.ai/data/eci_scores.csv`; parse → `{ series 'epoch-eci', kind 'eci', model: Model, org: Organization, date: date, dateKind 'release', value: eci }`; group `epoch-eci`.
- Factory `epochBenchmark(cfg: { id; file; scoreCol; kind; scale; group; name })`: fetch `memoBytes('https://epoch.ai/data/benchmark_data.zip')`, `unzipTexts` the one file; parse CSV → `{ series: id, kind, model: row['Model version'] || row['Name'], org: row['Organization'], date: isoDate(row['Release date']), dateKind 'release', value: toNumber(row[scoreCol]) * scale }`, skipping rows without model/date/value.

| const | id | score column | kind | scale | group |
|---|---|---|---|---|---|
| `epochTerminalBench` | epoch-terminalbench | Accuracy mean | percent | 100 | terminalbench |
| `epochSwebench` | epoch-swebench | mean_score | percent | 100 | swebench |
| `epochMetr` | epoch-metr | Time horizon (minutes) | minutes | 1 | metr |
| `epochVending` | epoch-vending | Score (USD) | eci | 0.001 | vending |
| `epochApex` | epoch-apex | Pass@1 score | percent | 100 | apex |
| `epochOsworld` | epoch-osworld | Score (already %) | percent | 1 | osworld |
| `epochOsworld2` | epoch-osworld2 | Binary accuracy | percent | 100 | osworld |

(Vending-Bench dollars become thousands of dollars compared linearly with τ = 8, so a $8k gap ≈ a 1/(1+e) win probability. Note it in the methods page later.)

Meta: name `Epoch AI Benchmarking Hub` / `Epoch Capabilities Index`, url `https://epoch.ai/data`, license `CC BY 4.0`, credit `Epoch AI, "Data on AI Benchmarking" / "Epoch Capabilities Index", CC BY 4.0`.

Tests (required): one concrete row per fixture mapped exactly (e.g. ECI `Claude Opus 5.5` → value 167.33, date 2026-09-22); fraction → percent scaling; rows with empty `Release date` skipped (the OSWorld fixture has one); the zip path tested by zipping a fixture CSV in-test and running `fetch` with a stubbed `ctx.fetchBytes`.

Commit: `feat(pipeline): Epoch ECI and benchmark-hub modules`.

### Task 22: SWE-bench and Aider

**Files:** `pipeline/src/sources/swebench.ts`, `pipeline/src/sources/aider.ts`; tests; fixtures `swebench`, `aider-edit`, `aider-polyglot`.
**Notes:** scratchpad `recon-llm/notes-gh.md` (swebench, aider sections).

- `swebench` (id `swebench`, group `swebench`, history full, license `CC BY-NC 4.0`): fetch `https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json`; parse board `Verified`, rows that are mini-SWE-agent runs (`agent === 'mini-SWE-agent'` OR a tag starting `Mini: ` OR key `mini-swe-agent_version`); `model` = `model_display` ?? the `Model: …` tag ?? `name`; `org` = `model_org`; `date` = `isoDate(model_release_date)` ?? `isoDate(date)`; `value` = `resolved`; kind percent; dateKind release.
- `aiderEdit` / `aiderPolyglot` (group `aider`, priority 1 / 2, license `Apache-2.0`): fetch the YAML from `https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/{edit,polyglot}_leaderboard.yml`, parse with `yaml` (core schema: dates stay strings; normalise CRLF); `model` = `model`; `value` = `pass_rate_2`; `date` = `isoDate(released ?? _released ?? date)`; kind percent; dateKind release.
- Tests: number of Verified Mini rows in the fixture equals what the fixture contains (count it in the test from the raw JSON with the same predicate); one concrete mapped row each; the CRLF entry in aider-edit parses.

Commit: `feat(pipeline): SWE-bench (mini-SWE-agent) and Aider modules`.

### Task 23: LiveBench (current release, accumulating)

**Files:** `pipeline/src/sources/livebench.ts`; test; fixture `livebench`.
**Notes:** scratchpad `recon-llm/notes-lbos.md` (livebench). Historical release tables keep growing after their release date, so they cannot be dated; we snapshot the **current** release on every run and build our own history.

- id `livebench-coding`, group `livebench-coding`, history `accumulate`.
- fetch: read `LIVE_BENCH_RELEASES` from `https://raw.githubusercontent.com/LiveBench/LiveBench/main/livebench/common.py` (regex all `"\d{4}-\d{2}-\d{2}"` inside it), take the max date `R`, then fetch `https://livebench.ai/table_${R_}.csv` and `https://livebench.ai/categories_${R_}.json` (`R_` = R with `-`→`_`). Return `{ release: R, table, categories }`.
- parse(raw, { now }): Coding score per model = mean of the `categories.Coding` columns ignoring empty/NaN; emit `{ series 'livebench-coding', kind 'percent', model, date: todayISO(now), dateKind 'snapshot', value }`.
- License: credit `LiveBench (livebench.ai), Apache-2.0 / CC BY-SA 4.0`.
- Tests: with `sample.csv` + `categories_2026_06_25.json`, one model's coding mean computed by hand in the test; rows with all-empty coding columns skipped; date equals the injected `now`.

Commit: `feat(pipeline): LiveBench coding snapshots`.

### Task 24: OSWorld-Verified and tau2-bench

**Files:** `pipeline/src/sources/osworld.ts`, `pipeline/src/sources/tau2.ts`; tests; fixtures `osworld`, `tau2`.
**Notes:** scratchpad `recon-llm/notes-lbos.md` (osworld), `recon-llm/notes-gh.md` (tau2).

- First replace the vulnerable npm `xlsx` with SheetJS's own build: `npm rm xlsx && npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (use the newest version listed at https://cdn.sheetjs.com/ if newer). Confirm `npm audit` no longer flags it.
- `osworld` (group `osworld`, license `CC BY-SA 4.0`, history full): fetch the xlsx bytes from `https://os-world.github.io/static/data/osworld_verified_results.xlsx`, `XLSX.read` → first sheet → `sheet_to_json` rows (`raw: true`), convert the Date column with `isoDate`; parse keeps `Approach type === 'General model'`, numeric score (see notes for the column), emits kind percent, dateKind release, series `osworld-verified`.
- `tau2` (group `tau2`, license `MIT`, history full): fetch `https://sierra-tau-bench-public.s3.us-west-2.amazonaws.com/submissions/manifest.json`, then each `submission.json` in `submissions` + `legacy_submissions` (never `voice_submissions`); **delete `contact_info` from every object in fetch**. parse: keep `submission_type` missing or `'standard'`; for each domain in `airline`, `retail`, `telecom`, `banking_knowledge` with a numeric `pass_1` emit `{ series: 'tau2@'+domain, kind 'percent', model: model_name, org: model_organization, date: model_release.release_date ?? submission_date, dateKind 'release', value: pass_1 }`.
- Before committing the tau2 fixtures, replace every email address in them with `"<redacted>"` (e.g. a small node script with the regex `/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g`), and assert in a test that no fixture file under `test/fixtures/tau2/` contains an email address.
- Tests: OSWorld excludes `Agentic framework` rows and placeholder scores (`🚧`, `-`); one concrete row; tau2 one submission → 4 observations with exact values; custom submissions skipped.

Commit: `feat(pipeline): OSWorld-Verified and tau2-bench modules`.

### Task 25: VBench, TTS Arena, Music Arena

**Files:** `pipeline/src/sources/{vbench,ttsArena,musicArena}.ts`; tests; fixtures `vbench`, `tts-arena`, `music-arena`.
**Notes:** sources-media.md (vbench, tts-arena, music-arena).

- `vbench` (group `vbench`, history full, credit "VBench leaderboard (Vchitect), cited; no explicit data licence"): fetch `https://vchitect-vbench-leaderboard.hf.space/config`; parse the main T2V table component (notes: component id 20; locate it by id **or** by its header containing the total-score column so a renumbering doesn't break it); model = markdown link text; value = `toNumber("85.06%")`; date = row Date; kind percent; dateKind release; series `vbench`.
- `ttsArena` (id `tts-arena`, group `tts-arena`, history `accumulate`): fetch `https://tts-agi-tts-arena-v2.hf.space/api/leaderboard`; parse → kind elo (`elo` field), date = `todayISO(now)`, dateKind snapshot.
- `musicArena` (id `music-arena`, group `music-arena`, history full, CC BY 4.0): **use the official precomputed cumulative TSVs** (no BT needed). fetch: list folders via `https://api.github.com/repos/gclef-cmu/music-arena/contents/components/frontend/ma_frontend/leaderboard` (dirs named `YYYYMMDD`), then for each folder fetch its `vocal_…tsv` and `instrumental_…tsv` (names from the folder listing). Return `[{ date, board, text }]`. parse: TSV (tab-separated, header row; early files use system keys and `+x / -y` CIs) → `{ series: 'music-arena@'+board, kind 'elo', model: Model, date: YYYY-MM-DD of folder, dateKind 'snapshot', value: Arena Score }`.
- Tests: concrete rows from each fixture; VBench percent parsing and markdown stripping; music early-format and late-format TSV both parse.

Commit: `feat(pipeline): VBench, TTS Arena and Music Arena modules`.

### Task 26: Design Arena (keyed, accumulating)

**Files:** `pipeline/src/sources/designArena.ts`; test; fixture `designarena` (docs example).
**Notes:** sources-media.md "designarena-*" (endpoint, auth header, response schema, category names). **Use only the documented keyed public API.**

- Factory for categories `image`, `video`, `tts`, `music` → ids `designarena-image|video|tts|music`, groups the same, `needsEnv: ['DESIGNARENA_API_KEY']`, history `accumulate`, credit `Design Arena (designarena.ai)` with the link required by their terms.
- fetch: `GET https://www.designarena.ai/api/v1/leaderboard/models/{category}` with `Authorization: Bearer ${env.DESIGNARENA_API_KEY}`. parse → kind elo, model per schema, date `todayISO(now)`, dateKind snapshot. An empty board (music today) returns `[]`, which runFetch records as failed with a clear message; that is expected.
- Tests: the docs-example fixture parses; missing key → skipped by `runFetch`.

Commit: `feat(pipeline): Design Arena modules (requires API key)`.

### Task 27: Scale — CrUX and Tranco

**Files:** `pipeline/src/sources/{crux,tranco}.ts`; tests; fixtures `crux`, `tranco`.
**Notes:** sources-scale.md (crux, tranco).

- `crux` (role scale, history accumulate, credit "Chrome UX Report (Google), CC BY 4.0, via zakird/crux-top-lists"): fetch the month list from `https://api.github.com/repos/zakird/crux-top-lists/contents/data/global`; months = `ctx.backfill` ? all ≥ `202211` : the last 2 available; for each, download `https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/global/YYYYMM.csv.gz`, `gunzipText`, keep rows whose origin is `https://${h}` or `https://www.${h}` for `h` in `ctx.keys('crux')`. Return `[{ month: 'YYYY-MM', rows: [{ host: h, bucket }] }]` (best bucket per host). parse → `{ signal 'crux', key: host, month, value: REP[bucket] }` with `REP = {1000: 316, 5000: 2236, 10000: 7071, 50000: 22361, 100000: 70711, 500000: 223607, 1000000: 707107}` (representative rank; `signals.ts` turns it into 1/rank).
- `tranco` (role scale, history accumulate, credit "Tranco list (Le Pochat et al., NDSS 2019), list IDs per month; non-commercial"): months = `ctx.backfill` ? 2022-11 … last complete month : last 2 complete months; per month `GET https://tranco-list.eu/api/lists/date/{last day}?subdomains=true` (on 404 retry −1, −2, −3 days), sleep 1100 ms between API calls, download the daily zip (`https://tranco-list.eu/download_daily/{list_id}`), unzip `top-1m.csv` (CRLF or LF, no header, `rank,domain`), keep `ctx.keys('tranco')`. Return `[{ month, listId, ranks: Record<host, number> }]`; parse → `{ signal 'tranco', key: host, month, value: rank }`.
- Tests: CrUX fixtures (`sample-202402.csv` etc. and the `.gz`) → bucket mapping incl. the `www.` variant; Tranco `sample-list.csv` scanning and the 404 fallback logic (unit-test a pure `candidateDates(month)` helper).

Commit: `feat(pipeline): CrUX and Tranco scale signals`.

### Task 28: Scale — StatCounter, Wikipedia pageviews, App Store

**Files:** `pipeline/src/sources/{statcounter,wikipedia,itunes}.ts`; tests; fixtures `statcounter`, `wikipedia`, `itunes`.
**Notes:** sources-scale.md.

- `statcounter` (history full, CC BY-SA 3.0, credit with link https://gs.statcounter.com): fetch the CSV range from 202301 to the **previous** month (URL in notes); parse: sort by Date, drop all-zero rows (missing, not 0%), emit `{ signal 'statcounter', key: <column label>, month: Date, value: share }` for every label except `Date`/`Other`.
- `wikipedia` (history full, CC0, UA = `USER_AGENT` from http.ts): for each title in `ctx.keys('wikipedia')`, GET `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g,'_'))}/monthly/20221101/${lastCompleteMonth}0100`; a 404 for one title is logged and skipped. parse → `{ signal 'wikipedia', key: title, month, value: views }`.
- `itunes` (history accumulate; credit "Apple App Store (iTunes Lookup API)"): GET `https://itunes.apple.com/lookup?id=${ids.join(',')}&country=us` for `ctx.keys('itunes')`; parse → `{ signal 'itunes', key: String(trackId), month: toMonth(now), value: userRatingCount }`.
- Tests: StatCounter zero-row handling and label mapping; Wikipedia timestamp `2023010100` → `2023-01`; iTunes concrete app.

Commit: `feat(pipeline): StatCounter, Wikipedia and App Store scale signals`.

### Task 29: Scale — OpenRouter, Ramp, Cloudflare Radar

**Files:** `pipeline/src/sources/{openrouter,ramp,cloudflare}.ts`; tests; fixtures `openrouter`, `ramp`, `cloudflare`.
**Notes:** sources-scale.md (openrouter, ramp, cloudflare).

- `openrouter` (history accumulate, CC BY 4.0, credit `Source: OpenRouter (openrouter.ai/rankings), as of <date>`): without a key fetch the keyless `https://openrouter.ai/api/v1/datasets/exports/rankings-daily/latest.csv` (rolling 30 days); with `OPENROUTER_API_KEY` and `ctx.backfill`, use the documented keyed `/api/v1/datasets/rankings-daily` from 2025-01-01 in ≤366-day windows. parse: aggregate per (`model_permaslug`, month) the mean of `share_of_daily_tokens` over the days present → `{ signal 'openrouter', key: slug, month, value }`.
- `ramp`: implement **only if** sources-scale.md's licence verdict is "OK with credit"; otherwise create no module and say so in the commit message. If OK: parse the vendor adoption series per notes → `{ signal 'ramp', key: vendor, month, value: percent }`.
- `cloudflare` (needsEnv `CLOUDFLARE_API_TOKEN`, CC BY-NC 4.0): generative-AI service ranking time series per notes → `{ signal 'cloudflare', key: service, month, value: rank }` (monthly = best rank in month).
- Tests: OpenRouter monthly mean from the fixture; Ramp concrete month (if implemented); Cloudflare parse of the documented example.

Commit: `feat(pipeline): OpenRouter, Ramp and Cloudflare Radar scale signals`.

### Task 30: Unit exclusion rule (schema + matching)

**Files:** Modify `pipeline/src/config/schemas.ts`, `pipeline/src/config/load.ts`, `pipeline/src/compute/assign.ts`, `pipeline/src/compute/index.ts`; tests in `test/config/load.test.ts`, `test/compute/assign.test.ts`.

Third-party fine-tunes contain family tokens (`llama-3.1-nemotron`, `hermes-3-llama`, `SWE-Llama`, `Lingma SWE-GPT`, `DeepSWE`…) and some rows combine two models (`DeepSeek R1 + claude-3-5-sonnet`). Add a top-level `exclude: string[]` (regexes, case-insensitive, default `[]`) to `units.yaml`; `parseUnits` returns `exclude: RegExp[]`; `matchUnit(units, obs, exclude: RegExp[] = [])` returns `null` when any exclude regex matches `obs.model`; `assignSeries` gets an `exclude` arg (default `[]`) and passes it; `computeWorld` passes `units.exclude`.
- Tests: an excluded fine-tune is not assigned; existing tests still pass.

Commit: `feat(pipeline): exclude third-party fine-tunes and multi-model rows from unit matching`.

### Task 31: Registry and method.yaml

**Files:** Modify `pipeline/src/sources/index.ts`; Create `pipeline/config/method.yaml`; Test `pipeline/test/sources/registry.test.ts`.

- `SOURCES` lists every module from Tasks 19–29 (strength first, then scale).
- `config/method.yaml`:
```yaml
start: 2022-11
strength:
  minUnits: 2
  snapshotMaxAgeDays: 92
  releaseActiveMonths: 3
  kinds:
    elo: { scale: 400 }
    percent: { clampLo: 0.5, clampHi: 99.5 }
    minutes: { kappa: 1.0 }
    eci: { tau: 8 }
  estimate: { floor: 60, step: 6 }
  weights:
    general: { arena-text: 0.5, epoch-eci: 0.5 }
    code: { arena-coding: 0.25, swebench: 0.25, terminalbench: 0.2, arena-webdev: 0.15, aider: 0.15, livebench-coding: 0.1 }
    agent: { metr: 0.35, osworld: 0.25, tau2: 0.2, vending: 0.1, apex: 0.1 }
    image: { arena-image: 0.7, designarena-image: 0.3 }
    video: { arena-video: 0.6, designarena-video: 0.25, vbench: 0.15 }
    speech: { tts-arena: 0.5, designarena-tts: 0.5 }
    music: { music-arena: 0.7, designarena-music: 0.3 }
scale:
  smoothingMonths: 3
  announcementStaleMonths: 6
  metricFactors: { MAU: 1, WAU: 1.4, DAU: 2.5 }
  floorFactor: 0.5
  components:
    users: { weight: 0.45, signals: [announcements] }
    consumer: { weight: 0.25, signals: [crux, tranco, statcounter, cloudflare] }
    business: { weight: 0.20, signals: [ramp, openrouter] }
    attention: { weight: 0.10, signals: [wikipedia, itunes] }
  base: [consumer, attention]
events: { newModelMinDelta: 3, surgeStrength: 5, surgeScale: 5, leadHysteresis: 1, maxPerFrontMonth: 3 }
```
(The code-front weights add Arena's `coding` category to spec §6.1-5's list to give 2024–25 history; spec allows tuning in this file.)
- Tests: every module id is unique; every strength module's `group` appears in at least one front's weights; every weights key is a group provided by at least one module; `parseMethod` accepts the file.

Commit: `feat(pipeline): source registry and method configuration`.

### Task 32: Curated data — units, announcements, releases, events

**Files:** Create `pipeline/curated/{units,announcements,releases,events}.yaml`; Test `pipeline/test/curated.test.ts`.

- `units.yaml`: orgs (colours from `mockups/data.js`, plus any new orgs; keep colours distinguishable within each front) and all 7 fronts with the unit rosters of spec §3, `since` = public launch month, model regexes from the recon "family → patterns" tables (use look-around patterns rather than `^` anchors so provider prefixes like `openrouter/` still match; Gemini must not match Gemma; Google video includes `gemini-omni`; Meta's general unit covers `llama` and `muse-spark`/`muse-glimmer`), `orgMatch` where org strings are reliable, the `exclude` list (from recon: `swe-gpt|swe-llama|hermes|nemotron|dracarys|deepswe|skywork|openhands-lm|swe-agent-lm|frog(?:boss|mini)|raft-|reflection-70b|wizardlm|tulu|simpo`, and multi-model strings ` \+ |&`), and scale identifiers from sources-scale.md's product → identifier table (CrUX/Tranco hosts incl. historical hosts like `chat.openai.com`, `bard.google.com`, `grok.x.ai`, `chat.qwenlm.ai`, `www.suno.ai`, `sora.com`, `kling.ai`; StatCounter labels; OpenRouter slug prefixes; Wikipedia titles; iTunes ids; Ramp vendor keys on general-front units only).
- `announcements.yaml`: one series per product with a consistent metric, seeded from Epoch `ai_companies_usage_reports.csv` (only `Company disclosure`/`Media report` rows with `Confidence` Confident/Likely, excluding `Exclude from graph view`) plus company figures with URLs from the design research (e.g. Gemini app 1B+ monthly users 2026-08-11 https://blog.google/innovation-and-ai/products/gemini-app/one-billion-monthly-users/). Every point needs a URL.
- `releases.yaml`: release month + display name for every model name that appears in the **first snapshot** of each snapshot-type source (needed for reconstruction) and for headline models used in event text (GPT-4, Claude 3.5 Sonnet, Gemini 2.5 Pro, Nano Banana, Veo 3, Sora 2, Suno v5…). Source each date from the vendor announcement; if unsure, omit the entry.
- `events.yaml`: `custom: [{ month: 2022-11, front: general, unit: gpt, text: { ja: 'ChatGPT 公開 — 開戦', en: 'ChatGPT launches — the war begins' } }]`.
- Test (`curated.test.ts`): all four files parse with the real loaders; every unit regex matches at least one model name present in the committed fixtures **or** is listed in an allow-list in the test with a reason; no two units in one front match the same fixture model name.

Commit: `feat(pipeline): curated units, announcements, releases and events`.

### Task 33: First real run, calibration and sanity review

**Files:** `pipeline/raw/**` (generated), `site/public/data/world.json` (generated), `pipeline/config/method.yaml` (calibrated), `docs/superpowers/recon/first-run.md` (new: findings).

- [ ] Run `npm run fetch -- --backfill` (from `pipeline/`); read the summary and `raw/_status/<date>.json`. Fix any module that fails for a reason other than a missing key (add a regression test with the real payload shape when you do).
- [ ] Run `python scripts/import_arena_legacy.py` if Task 20's output is not committed yet.
- [ ] Run `npm run compute && npm run report`; open `pipeline/out/report.html` and screenshot each front.
- [ ] Sanity checks against well-known history (write results into `first-run.md`): general-front strength leader should be GPT through most of 2023–2024, with Claude 3.5 Sonnet / Gemini 2.5 Pro / later leaders appearing at the right months; code front shows Claude strong from 2024-06; image front shows the nano-banana / gpt-image lead changes listed in sources-media.md; Suno is the music scale leader; Google's unit exists on every front. Investigate every surprise (usually a regex or a stale snapshot) before accepting it.
- [ ] Calibrate `eci.tau` and `minutes.kappa` so that the ECI and METR score spreads among the top 5 units in 2025–2026 are comparable to the Arena spread (report the before/after spreads in `first-run.md`); re-run compute.
- [ ] `npm test && npm run typecheck`.
- [ ] Commit raw snapshots, `world.json`, calibrated `method.yaml` and `first-run.md`: `feat(data): first full data run (2022-11 → now)`.
