# AI WAR Stage 3 (Automation & Publishing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Weekly unattended data refresh that opens a reviewable "今週の戦況更新" pull request, CI for every PR, and automatic GitHub Pages deployment of `site/` when `main` changes — plus a Japanese README for the owner.

**Architecture:** GitHub Actions only (no servers). `weekly-update.yml` runs `pipeline` fetch → compute → tests → site build → a Markdown summary diffing the previous and new `world.json` → `peter-evans/create-pull-request` (one rolling branch). `ci.yml` runs both packages' tests on PRs. `deploy.yml` builds `site/` and deploys with `actions/deploy-pages`. Secrets (OPENROUTER_API_KEY, CLOUDFLARE_API_TOKEN, DESIGNARENA_API_KEY) live in GitHub Secrets and are optional (modules skip without them).

**Tech Stack:** GitHub Actions (ubuntu-latest, Node 24), actions/checkout v5, actions/setup-node v5, peter-evans/create-pull-request v7, actions/upload-pages-artifact v4, actions/deploy-pages v4 (use the newest major available when implementing).

**Publishing is the owner's decision.** Tasks 1–4 are local and safe. Task 5 (creating the public GitHub repository, pushing, enabling Pages, adding secrets) must not run until the owner explicitly says to publish.

---

### Task 1: PR summary generator

**Files:** Create `pipeline/src/report/prSummary.ts`, `pipeline/src/cli/summary.ts`; Test `pipeline/test/report/prSummary.test.ts`; Modify `pipeline/package.json` (script `"summary": "tsx src/cli/summary.ts"`).

`renderPrSummary({ before: World | null, after: World, status: FetchStatus[], warnings: string[] }): string` — Markdown in Japanese (headings in Japanese, model/unit names verbatim):
1. `## 今週の戦況更新（{after.generatedAt の日付}）` + one-line totals (sources ok / skipped / failed; events added).
2. `### 首位` — table per front: strength leader and scale leader of the latest month, before → after, with ⚠ when changed.
3. `### 大きな変動` — units whose latest-month `s` moved ≥ 3 or `c` moved ≥ 2 points vs `before` (same month index if present, otherwise previous latest), sorted by |Δ|, max 15 rows.
4. `### 新しい戦況速報` — events present in `after` but not in `before` (key = month|front|unit|type), major first, max 20, showing `text.ja`.
5. `### 新部隊` — units new in `after.units`.
6. `### データ源` — failed and skipped sources (id, message); a collapsed `<details>` table of all sources with `dataThrough`.
7. `### 警告` — compute warnings (deduplicated) if any.
8. Footer: "承認（マージ）するとサイトに反映されます。" and "数字がおかしい場合は、この PR にコメントするか、該当行を curated/*.yaml で修正してください。"
Escape `|` and newlines in table cells; never include secrets.
`cli/summary.ts`: `--before <path|none> --after <path> --status <raw/_status/latest> --warnings <path?> --out <file>`; reads files, writes Markdown.
Tests: leader change flagged; movers threshold; new-event detection; failed/skipped listed; table-cell escaping; `before: null` (first run) renders without diffs.

Commit: `feat(pipeline): PR summary generator for weekly updates`.

### Task 2: Machine-readable compute warnings and fetch exit semantics

**Files:** Modify `pipeline/src/cli/compute.ts`, `pipeline/src/cli/fetch.ts`; tests where logic is factored out.
- `compute.ts` also writes `pipeline/out/warnings.json` (array of strings, deduplicated).
- `fetch.ts` keeps exit code 0 when some sources fail (the PR reports them), but exits 1 when **every** non-skipped source failed (network outage) so the workflow stops without opening a PR.
- Also write `pipeline/out/status-latest.json` (copy of the run's status) for the summary step.

Commit: `feat(pipeline): machine-readable warnings and fetch exit semantics`.

### Task 3: Workflows

**Files:** Create `.github/workflows/ci.yml`, `.github/workflows/weekly-update.yml`, `.github/workflows/deploy.yml`, `.github/dependabot.yml`.

`ci.yml` (on pull_request and push to main): two jobs — `pipeline` (`npm ci && npm test && npm run typecheck`) and `site` (`npm ci && npm test && npm run build`), Node 24, npm cache keyed on each lockfile.

`weekly-update.yml`:
```yaml
name: weekly-update
on:
  schedule:
    - cron: '0 0 * * 1'   # Monday 00:00 UTC = 09:00 JST
  workflow_dispatch: {}
permissions:
  contents: write
  pull-requests: write
concurrency: { group: weekly-update, cancel-in-progress: false }
jobs:
  update:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 24, cache: npm, cache-dependency-path: |
            pipeline/package-lock.json
            site/package-lock.json }
      - run: cp site/public/data/world.json /tmp/world.before.json
      - working-directory: pipeline
        run: npm ci
      - working-directory: pipeline
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          DESIGNARENA_API_KEY: ${{ secrets.DESIGNARENA_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run fetch
      - working-directory: pipeline
        run: npm run compute && npm test
      - working-directory: site
        run: npm ci && npm test && npm run build
      - working-directory: pipeline
        run: npm run summary -- --before /tmp/world.before.json --after ../site/public/data/world.json --status out/status-latest.json --warnings out/warnings.json --out /tmp/pr-body.md
      - id: date
        run: echo "today=$(date -u +%Y-%m-%d)" >> "$GITHUB_OUTPUT"
      - uses: peter-evans/create-pull-request@v7
        with:
          branch: data/weekly-update
          delete-branch: true
          title: "今週の戦況更新（${{ steps.date.outputs.today }}）"
          body-path: /tmp/pr-body.md
          commit-message: "data: weekly update ${{ steps.date.outputs.today }}"
          add-paths: |
            pipeline/raw/**
            site/public/data/world.json
          labels: data-update
```
(Adjust action majors to the newest available; keep the structure.)

`deploy.yml` (on push to main affecting `site/**` or `.github/workflows/deploy.yml`, plus workflow_dispatch): build `site/` (`npm ci && npm run build`), `actions/configure-pages`, `actions/upload-pages-artifact` with `path: site/dist`, `actions/deploy-pages`; permissions `pages: write`, `id-token: write`; environment `github-pages`.

`dependabot.yml`: weekly npm updates for `/pipeline` and `/site`, monthly for github-actions; group minor/patch.

Validation: run `actionlint` if available (`npx actionlint` or the Go binary); otherwise lint YAML with a parser and review by hand. Commit: `ci: weekly data update PR, CI and Pages deployment`.

### Task 4: README for the owner (Japanese)

**Files:** Create `README.md` (repo root).

Sections: what AI WAR is (one paragraph + screenshot from `mockups/shots/`); how the data works (strength / scale / fog, link to the site's データと方法 page and `docs/superpowers/specs/...`); weekly flow (PR every Monday 09:00 JST → read the summary → merge to publish; what to do when something looks wrong); adding API keys as GitHub Secrets (OpenRouter, Cloudflare Radar token with "Account › Radar › Read", Design Arena) with exact navigation (Settings → Secrets and variables → Actions → New repository secret); local commands (`cd pipeline && npm run fetch / compute / report`; `cd site && npm run dev`); swapping art (`art-inbox/` → `site/public/art/`); credits and licences (non-commercial; see `pipeline/raw/LICENSES.md`); unofficial disclaimer.

Commit: `docs: README for running and updating AI WAR`.

### Task 5: Publish (ONLY after the owner says so)

- [ ] Ask the owner for: repository name (default `ai-war`), and confirmation that it may be **public** (GitHub Pages on the free plan requires a public repo).
- [ ] With confirmation: merge the working branch into `main`; `gh repo create <owner>/<name> --public --source . --push` (or add the remote and push `main`); enable Pages with source "GitHub Actions" (`gh api -X POST repos/<owner>/<name>/pages -f build_type=workflow`); run `deploy.yml` (`gh workflow run deploy.yml`); wait for it and open the Pages URL in the browser pane to verify.
- [ ] Tell the owner how to add the three secrets (they paste the keys themselves; never in chat), then trigger `weekly-update.yml` once via `gh workflow run weekly-update.yml` and check that a PR appears.
