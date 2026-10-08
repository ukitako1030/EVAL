# Recon notes: livebench + osworld (2026-10-08)

Raw downloads, scripts and intermediate files are in `scratchpad/recon-llm/lbos/`. That includes all 11 `table_*.csv`, all `categories_*.json`, `cost_2026_06_25.csv`, `lb_main.js`, `lb_model_info.json` / `lb_model_info_flat.json` (the model metadata pulled from the site JS), both OSWorld xlsx files and the commit-history JSON.

---

## livebench

### Working URLs (all checked 2026-10-08)
| URL pattern | Status |
|---|---|
| `https://livebench.ai/table_YYYY_MM_DD.csv` | 200 for all 11 release dates (text/csv) |
| `https://livebench.ai/categories_YYYY_MM_DD.json` | 200 for all 11 release dates |
| `https://livebench.ai/cost_YYYY_MM_DD.csv` | 200 **only for 2026_06_25** (30 KB). Other dates return 404 (GitHub Pages HTML) |
| `https://livebench.ai/` + `./static/js/main.<hash>.js` | 200. The hash changes on each deploy (it was `main.f39710c8.js`) |
| `https://raw.githubusercontent.com/LiveBench/new-livebench/<sha-or-main>/public/table_2026_06_25.csv` | 200. This is the deploy source, and it is not rate-limited |

The site loads its files with a cache-buster: `fetch("./table_${t}.csv?v=1791404103")`. The `v` value is the deploy unix time (2026-10-07 20:15 UTC). The app also fetches `categories_${t}.json` (required) and `cost_${t}.csv` (optional). In the URLs the date separator is `_`. The JS release list uses `-` and swaps it with `replaceAll("-","_")`.

### Full release list (11 releases), and how I found it
`2024-06-24, 2024-07-26, 2024-08-31, 2024-11-25, 2025-04-02, 2025-04-25, 2025-05-30, 2025-11-25, 2025-12-23, 2026-01-08, 2026-06-25`

Two sources agree on this list:
1. The site bundle `main.f39710c8.js` has `const pe=["2024-06-24","2024-07-26",...,"2026-06-25"]`. The default release is the last element (`pn=pe[pe.length-1]`).
2. The GitHub repo `LiveBench/LiveBench`, `livebench/common.py` line 79, has `LIVE_BENCH_RELEASES = {"2024-07-26", "2024-06-24", ... "2026-01-08", "2026-06-25"}`. It holds the same 11 dates.

To discover new releases: re-fetch `/`, read the `main.*.js` name, then regex `\["20\d\d-\d\d-\d\d"(,"20\d\d-\d\d-\d\d")*\]`. You can also parse `LIVE_BENCH_RELEASES` from common.py.

### Hosting, auth, rate limits
- The site is GitHub Pages (`Server: GitHub.com`, Fastly/varnish). There is no Cloudflare, auth or UA requirement: plain `curl` with no UA returns 200. `robots.txt` contains `Disallow:` (empty). `Cache-Control: max-age=600`.
- `Last-Modified` is the same deploy time on every file (2026-10-07 20:15:35 GMT). It tells you nothing about individual releases.
- **Deploy source is the repo `LiveBench/new-livebench`** (public, pushed 2026-10-07T20:15:12Z, which matches Last-Modified). Its description reads "Redesigned LiveBench leaderboard (private preview) — deploys to new-livebench.ai", but livebench.ai is in fact serving it. The old repo `LiveBench/livebench.github.io` (gh-pages last pushed 2026-07-09) has no `table_2026_06_25.csv` on gh-pages and is stale.
- GitHub REST API without a token allows 60 req/h (I used about 30). raw.githubusercontent.com has no such limit.

### Format
CSV with UTF-8, LF line endings, no BOM and no quoting. Some files have no trailing newline (2024_11_25, 2025_04_02, 2025_04_25, 2025_05_30, 2025_11_25). There is one row per model and no duplicate models within a release. Rows are not sorted, except in 2024_06_24.
- First column: **`model`**. It is the raw model key (lowercase API-ish id with effort suffixes), not a display name.
- All other columns are **per-task scores as float, on a 0-100 scale** (observed min 0.0, max 100.0, up to 3 decimals).
- Missing values are empty cells:
  - 2024_11_25 `phi-3-small-8k-instruct`: `connections` is empty.
  - 2026_01_08 `nemotron-3-super-120b-a12b`: the row is short by 3 fields (`typescript`, `typos`, `zebra_puzzle`).
- **There is no date, organization, or category/overall column in the CSV.** Overall and category scores are computed client-side. Organization comes from a dict hardcoded in the JS (see below).

Sizes and row counts:

| release | rows | cols (incl. model) | bytes |
|---|---|---|---|
| 2024_06_24 | 73 | 18 | 8,879 |
| 2024_07_26 | 73 | 19 | 9,261 |
| 2024_08_31 | 59 | 19 | 7,694 |
| 2024_11_25 | 65 | 19 | 8,508 |
| 2025_04_02 | 63 | 19 | 8,441 |
| 2025_04_25 | 57 | 18 | 7,690 |
| 2025_05_30 | 70 | 21 | 10,515 |
| 2025_11_25 | 65 | 21 | 9,893 |
| 2025_12_23 | 65 | 22 | 10,228 |
| 2026_01_08 | 121 | 24 | 19,961 |
| 2026_06_25 | 69 | 24 | 11,574 |

### Column drift (diff vs previous release)
- **2024_06_24** (base): `model, AMPS_Hard, LCB_generation, coding_completion, connections, cta, math_comp, olympiad, paraphrase, plot_unscrambling, simplify, story_generation, summarize, tablejoin, tablereformat, typos, web_of_lies_v2, zebra_puzzle`
- 2024_07_26: + `spatial`
- 2024_08_31: no change
- 2024_11_25: no change
- 2025_04_02: + `web_of_lies_v3`, − `web_of_lies_v2`
- **2025_04_25**: + `code_completion`, `code_generation`; − `LCB_generation`, `coding_completion`, `cta`. The coding tasks were renamed or replaced here.
- **2025_05_30**: + `javascript`, `python`, `typescript`. These are the new **Agentic Coding** category.
- 2025_11_25: + `theory_of_mind`, − `web_of_lies_v3`
- 2025_12_23: + `logic_with_navigation`
- 2026_01_08: + `consecutive_events`, `integrals_with_game`
- 2026_06_25: column set unchanged. The commit history calls this release "agentic v2": the agentic columns were re-scored with the v2 harness.

Latest header (2026_06_25):
`model,AMPS_Hard,code_completion,code_generation,connections,consecutive_events,integrals_with_game,javascript,logic_with_navigation,math_comp,olympiad,paraphrase,plot_unscrambling,python,simplify,spatial,story_generation,summarize,tablejoin,tablereformat,theory_of_mind,typescript,typos,zebra_puzzle`

### Categories mapping (`categories_<date>.json`)
This file exists for every release. It is a JSON object of `{category: [task columns]}`, and every CSV column appears in it. 2026_06_25:
```
Reasoning:      theory_of_mind, zebra_puzzle, spatial, logic_with_navigation
Coding:         code_generation, code_completion
Agentic Coding: javascript, typescript, python
Mathematics:    AMPS_Hard, integrals_with_game, math_comp, olympiad
Data Analysis:  consecutive_events, tablejoin, tablereformat
Language:       connections, plot_unscrambling, typos
IF:             paraphrase, simplify, story_generation, summarize
```
- Coding columns: `LCB_generation` + `coding_completion` (releases 2024_06_24 through 2025_04_02), then `code_generation` + `code_completion` (2025_04_25 onwards).
- Agentic Coding columns: `javascript`, `typescript`, `python` (2025_05_30 onwards). These are LiveBench's agentic coding tasks, not language-specific coding columns.
- Before 2025_05_30 there are 6 categories (Reasoning, Coding, Mathematics, Data Analysis, Language, IF). From 2025_05_30 there are 7.
- How the site computes scores (from the JS functions `Se`/`Pe`):
  - Category score = arithmetic mean of that category's task columns, ignoring NaN.
  - Overall = arithmetic mean of the category scores.
  - Two names are hard-coded overrides: `"grok-3-thinking"` → 72 and `"grok-3"` → 58. Neither name appears in any current CSV.
  - I checked the formula against figures in commit messages: gpt-6.1-sol-max computes to 81.62 (commit says "81.6"), and mistral-large-4-high computes to 71.84 (commit says "71.8").

### Model metadata (organization, display name, version date) lives in the JS bundle
`main.*.js` contains `je={...}`, a dict keyed by the CSV `model` value. It has 289 base entries, or 357 including `variants[].rawName`. Fields and how many entries have them: `organization` (289), `displayName` (289), `url`, `version` (157), `openweight` (102), `reasoner` (161), `huggingface`, `variants`, `finetune` (3), `highUnseenBias` (1).
- **The site drops any CSV row whose model is not in this dict** (`const t=Te(n.model); if(!t) return null`). Examples of hidden rows:
  - 2026_06_25: `deepseek-v4-flash` and `deepseek-v4-pro`.
  - 2026_01_08: `claude-opus-4-8-*` (4 rows) and `deepseek-v4-*`.
  - 2024_06_24: 30 old open models.
- Organization values seen: OpenAI, Anthropic, Google, xAI, DeepSeek, Alibaba, Meta, `Mistral AI` **and** `Mistral` (devstral-2512), `AbacusAI` **and** `Abacus.AI`, Moonshot AI, Z.AI, NVIDIA, Microsoft, Cohere, Amazon, Minimax, Xiaomi, StepFun, Tencent, Perplexity, AllenAI, SoundAI, Arcee, Stealth, OpenRouter, Thinking Machines.
- `version` is usually the model snapshot or release date (`"2026-07-22"` for Claude Opus 5, `"2024-05-13"` for gpt-4o-2024-05-13). It is sometimes a non-date (`"001"`, `"002"` for Gemini). It is missing for 52 of 69 rows in the latest release.
- The `finetune` field marks Abacus.AI finetunes:
  - `smaug-agentic`: base kimi-k3
  - `smaug-flash`: base deepseek-v4-flash-0731
  - `smaug-mini`: base qwen3.8-27b
- Extraction: slice from `je={"glm-5.3"` to `,Ce={},Ee={}` and eval with node. My script is `lbos/extract_je.js`. The anchors are minifier names, so they are **fragile**. A robust alternative is to regex each `"key":{...organization:"X",displayName:"Y"...}` entry. The dict source is `src/Table/modelLinks.js` in `LiveBench/new-livebench`, which is the easier file to parse.

### Date semantics (important)
- The CSV has no dates. The release date is the **question-set version**, not a snapshot date.
- **Each release table keeps getting new models after its release date, until the next release replaces it.** Examples:
  - 2026_01_08 contains gpt-5.5 (2026-04-23) and gemini-3.5-flash (2026-05-19).
  - 2026_06_25 contains claude-opus-5 (2026-07-22) and deepseek-v4.1-flash-max (2026-09-10).
  - 2025_05_30 contains models up to grok-4-1-fast (2025-11-20).
- **Older tables are not frozen.** Rows are added or removed (`union-alpha` was added and later removed), and scores are revised after reruns (grok-4.7 typescript; mistral-large-4 "after resample rounds"; opus-4.8 agentic v2).
- Between releases the model sets overlap only partly (for example 21 of 69 models in 2026_06_25 are also in 2026_01_08). Older models are re-run on the new question set.
- **Each release is a separate scoring version.** Raw values must not be chained across releases: the question sets, task lists and category counts all differ. For example, Claude Opus 4.5 thinking-64k-high scores differently in 2026_01_08 and 2026_06_25. Normalize within a release (rank, z-score, or ratio to the top score) before building time series.
- Ways to date a row:
  - (a) The JS `version` field (model release date; sparse).
  - (b) **Git history of `public/table_<release>.csv` in `LiveBench/new-livebench`.** It has 54 commits from 2026-06-24 to 2026-10-07, with messages like `Board: add gpt-6.1-sol-max (81.6, rank 6/65) (#63)`. The diff gives each model's first-seen date. Past versions are fetchable at `raw.githubusercontent.com/LiveBench/new-livebench/<sha>/public/table_2026_06_25.csv` (checked: the first commit `553e0cf9ca` returns a 2,125-byte table). Earlier releases have their history in `LiveBench/livebench.github.io` (main/gh-pages).
  - (c) Snapshot the CSV ourselves on every run.

### Example row (2026_06_25)
```
claude-opus-4-5-20251101-thinking-64k-high-effort,99.0,80.435,78.873,99.333,79.363,78.0,59.091,68.0,95.098,89.458,65.667,66.45,40.0,54.95,96.0,65.85,63.717,45.923,98.039,78.846,20.0,78.0,77.5
```
Computed (site formula) for a few latest-release models. Columns are Coding / Agentic Coding / Overall:
- claude-opus-5-max-effort: 81.45 / 65.20 / 80.09
- gpt-6.1-sol-max: 80.36 / 54.55 / 81.62
- deepseek-v4.1-flash-max: 80.04 / 77.27 / 81.11
- grok-4.7-xhigh: 77.16 / 53.99 / 77.40
- gemini-3.8-flash-high: 72.49 / 54.24 / 75.83
- qwen3.8-max: 72.87 / 64.65 / 78.46
- mistral-large-4-high: 77.16 / 57.17 / 71.84
- muse-spark-1.3-xhigh (Meta): 81.06 / 64.09 / 81.59

### Model names by family, latest release (2026_06_25, 69 rows)
- **OpenAI/GPT:**
  - `gpt-5.2-2025-12-11-high`, `gpt-5.2-codex`
  - `gpt-5.4-mini-xhigh`, `gpt-5.4-nano-xhigh`, `gpt-5.4-xhigh`, `gpt-5.5-xhigh`
  - `gpt-5.6-luna-max`, `gpt-5.6-sol-max`, `gpt-5.6-terra-max`
  - `gpt-6-astra-max`, `gpt-6-luna-max`, `gpt-6-sol-max`
  - `gpt-6.1-sol-max`, `gpt-6.1-sol-xhigh`
- **Claude:**
  - `claude-fable-5-max-effort`, `claude-fable-5-1-max-effort`
  - `claude-haiku-5-5-max-effort`, `claude-haiku-5-5-xhigh-effort`
  - `claude-opus-4-5-20251101-thinking-64k-high-effort`, `claude-opus-4-6-thinking-auto-high-effort`, `claude-opus-4-7-xhigh-effort`, `claude-opus-4-8-max-effort`
  - `claude-opus-5-max-effort`, `claude-opus-5-5-max-effort`, `claude-opus-5-5-xhigh-effort`
  - `claude-sonnet-4-6-thinking-auto-medium-effort`, `claude-sonnet-5-xhigh-effort`, `claude-sonnet-5-5-max-effort`, `claude-sonnet-5-5-xhigh-effort`
- **Gemini:** `gemini-3.1-pro-preview-high` (flag `highUnseenBias`), `gemini-3.5-flash-high`, `gemini-3.5-flash-lite-high`, `gemini-3.6-flash-high`, `gemini-3.7-flash-high`, `gemini-3.8-flash-high`
- **Grok:** `grok-4.3`, `grok-4.5`, `grok-4.6`, `grok-4.7-xhigh`, `grok-build-0.1`
- **DeepSeek:** `deepseek-v4-flash`, `deepseek-v4-pro` (both missing from the metadata dict, so hidden on the site), `deepseek-v4-flash-0731`, `deepseek-v4-pro-0813`, `deepseek-v4-flash-vision-exp`, `deepseek-v4.1-flash-max`. Also `smaug-flash`, an Abacus finetune of DeepSeek.
- **Qwen:** `qwen3.6-27b`, `qwen3.6-plus`, `qwen3.7-max`, `qwen3.8-27b`, `qwen3.8-flash-next`, `qwen3.8-max`. Also `smaug-mini`, an Abacus finetune of Qwen.
- **Llama:** none in the latest release. Meta's entries are `muse-spark-1.1-xhigh`, `muse-spark-1.2-xhigh` and `muse-spark-1.3-xhigh` (org Meta, closed weights).
- **Mistral:** `mistral-large-4-high` only (added 2026-10-07).
- Others: `glm-5.2`, `glm-5.3`, `glm-5.3-flash`, `kimi-k2.6-thinking`, `kimi-k2.7-code`, `kimi-k3`, `minimax-m3`, `nemotron-3-ultra-550b-a55b`, `inkling-xhigh` (Thinking Machines), `ox-alpha-max` (Stealth), `smaug-agentic`.

Older naming samples:
- 2024_06_24: `gpt-4o-2024-05-13`, `chatgpt-4o-latest`, `claude-3-5-sonnet-20240620`, `gemini-1.5-pro-exp-0827`, `meta-llama-3.1-405b-instruct-turbo`, `mistral-large-2407`, `mixtral-8x22b-instruct-v0.1`, `open-mistral-nemo`, `qwen2-72b-instruct`, `deepseek-coder-v2`.
- 2025_04_02: `o3-2025-04-16-high`, `o4-mini-2025-04-16-medium`, `claude-3-7-sonnet-20250219-thinking-64k`, `gemini-2.5-pro-exp-03-25`, `grok-3-mini-beta-high`, `llama-4-maverick-17b-128e-instruct`, `deepseek-r1-distill-llama-70b`, `qwq-32b`, `qwen2.5-max`, `amazon.nova-pro-v1:0`.
- The same model often appears several times within a release with **effort or thinking suffixes**: `-high`, `-low`, `-medium`, `-xhigh`, `-max`, `-max-effort`, `-thinking-64k`, `-base`, `-nothinking`, `-minimal`, `-highthinking`, `-thinking-auto-high-effort`. The pipeline needs a rule for these, for example the best variant per base model per release.

### Licence

| Source | Exact wording (short quote) | Notes |
|---|---|---|
| Website footer (in `main.*.js`) | "This website is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License." | Footer boilerplate from the Nerfies template |
| GitHub `LiveBench/LiveBench` LICENSE | starts "The original LICENSE from https://github.com/lm-sys/FastChat is copied below." | Apache License 2.0 text follows. The GitHub API reports `spdx_id: NOASSERTION`. pyproject declares "License :: OSI Approved :: Apache Software License" |
| `docs/DATASHEET.md` | "The benchmark suite is public as of June 12, 2024, distributed under the Apache License 2.0." / "There are no copyrights on the data." | |
| `docs/AUTHOR_RESPONSIBILITY.md` | "The license of our repository is the Apache License 2.0." | |
| HF datasets | 10 datasets under author `livebench`: language, coding, reasoning, math, instruction_following, data_analysis, model_answer, model_judgment, liveswebench, liveswebench-patches | **No `license:` frontmatter and no license tag on any of them** except `liveswebench-patches` (`license:mit`). model_judgment's card says it "contains all model judgments (scores) currently used to create the leaderboard". Last modified 2025-04-07, so it is stale |
| `LiveBench/new-livebench` and `LiveBench/livebench.github.io` (where the CSVs actually live) | | Both have `license: null` |
| README | | Asks for a BibTeX citation (ICLR 2025 paper) |

**Verdict: OK to redisplay derived scores with credit, if you follow CC BY-SA 4.0 (the website licence) to be safe.** Reasoning:
- The scores are factual numbers.
- The authors state that the benchmark is Apache-2.0 and that "there are no copyrights on the data".
- The website that serves the CSVs is CC BY-SA 4.0.
- The CSV files themselves carry no explicit licence; their repos have `license: null`.

So: attribute "LiveBench (livebench.ai), White et al., ICLR 2025", with a link. If we redistribute the raw CSVs or near-verbatim tables, keep them under CC BY-SA 4.0 (share-alike). Derived monthly family scores are low-risk.

### Surprises / gotchas
- The latest release has **fewer rows than the previous one** (69 vs 121), because re-evaluation on new question sets is selective.
- Rows not in the JS metadata dict are hidden on the site but still present in the CSV.
- The `model` keys mix conventions: `claude-4-sonnet-...` vs `claude-sonnet-4-5-...`, and `gemini-...-highthinking` vs `gemini-...-high`.
- `cost_<date>.csv` exists only for the latest release. It has columns `nq_<task>`, `out_<task>`, `avg_input_tokens`, `avg_output_tokens`, `input_price_per_million`, `output_price_per_million`, `cost_per_question`, `cost_per_successful_task`.
- Org naming in the metadata is inconsistent (`Mistral` vs `Mistral AI`, `AbacusAI` vs `Abacus.AI`).
- The repo description calls new-livebench a "private preview" for new-livebench.ai, yet livebench.ai serves it. The deploy path may change again, so discover the bundle from `/` instead of hardcoding it.

---

## osworld

### Working URLs
- `https://os-world.github.io/static/data/osworld_verified_results.xlsx` returns **301** to `http://osworld-v1.xlang.ai/static/data/osworld_verified_results.xlsx`, which returns 200 (113,066 bytes, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`). curl needs `-L`.
- `https://osworld-v1.xlang.ai/static/data/osworld_verified_results.xlsx` (https) returns 200 directly.
- `https://raw.githubusercontent.com/OS-World/OS-World.github.io/main/static/data/osworld_verified_results.xlsx` returns 200 with identical bytes. This is the source repo.
- `https://os-world.github.io/` returns 301 to `osworld-v1.xlang.ai`. `https://osworld.xlang.ai/` also returns 301 to `https://osworld-v1.xlang.ai/`. Possibly a v2 site is coming; watch for this.
- Other data files the site references:
  - `static/data/self_reported_results.xlsx` (24 KB, 200). Its sheets are `Screenshot`, `A11y_tree`, `Screenshot_A11y_tree` and `Set-of-Mark`, with columns `Model, Institution, PaperLink, PaperAuthors, Details, TrajectoryLink, Score, Date`. Date is a string such as `"Nov 5, 2025"`. These are non-verified, self-reported results.
  - The repo's `static/data/` also has `test_small_*.json` and `transform.py`, which are task demos and not results.
  - The site loads both xlsx files with SheetJS 0.18.5 and reads only the **first sheet** of the verified file.
- Hosting is GitHub Pages (`Server: GitHub.com`, Fastly). There is no auth, Cloudflare or UA requirement, and `Cache-Control: max-age=600`.
- Last-Modified is 2026-08-07 16:28:57 GMT. Commit history of the xlsx in `OS-World/OS-World.github.io`: 86 commits from 2025-07-31 to 2026-08-07, roughly monthly, with messages like "Update muse spark 1.1 result".

### Format
- One sheet, `Eval Results`. Dimensions are `A1:AC1077`, but only **149 non-empty data rows** exist. Columns W to AC are empty with `None` headers; drop them. Rows are roughly append-ordered and unsorted.
- Exact headers and types (openpyxl):

| Column | Type |
|---|---|
| `Model` | str |
| `Institution` | str |
| `PaperLink` | str (URL) |
| `PaperAuthors` | str, e.g. "Anthropic, '26" |
| `Approach type` | str |
| `Max steps` | int (15/30/50/100/150), None ×2 |
| `Additional a11y tree used` | "Yes"/"No" |
| `Additional coding-based action` | "Yes"/"No" |
| `Multiple rollout` | "Yes"/"No" |
| `Date` | **mixed**: see below |
| `Success rate` | float/int percent 0-100, or the strings `"🚧"` ×4 and `"-"` ×1 |
| `Success/Total` | str like `"256.71/356"` or `"264 / 360"` (spacing varies; fractional successes), None ×5 |
| `chrome`, `gimp`, `libreoffice_calc`, `libreoffice_impress`, `libreoffice_writer`, `multi_apps`, `os`, `thunderbird`, `vlc`, `vs_code` | str `"succ/total"` per app domain, None ×5 |

- **`Date` column is mixed:**
  - 80 cells are real Excel dates (openpyxl `datetime`, number format `d-mmm-yy`).
  - **64 cells are raw Excel serial integers** with format `General` (e.g. `45887` = 2025-08-17). Convert with `1899-12-30 + n days`.
  - 5 cells are None (the 🚧/"-" rows).
  - The site JS has a fallback for serials (`(v-25569)*86400000`).
  - Range: **2025-07-28 to 2026-08-01**. 69 rows are dated 2025-07-28, the OSWorld-Verified launch, when everything was re-run.
- **Date semantics:** this is the date of the verified run or report on the leaderboard. It is not the model release date. Example: claude-opus-5[1m] is dated 2026-08-01, while LiveBench metadata gives Claude Opus 5's version as 2026-07-22.
- **Success rate is a percentage (0-100).** There are no separate 15/50/100-step columns. **`Max steps` is a row attribute**, so one model has up to three rows (15/50/100), and there are also **repeated runs** (same Model + Max steps, several rows, e.g. opencua-7b ×3 per step budget, agent s3 bBoN N=1 ×10).
  - The site groups rows by `Model + Max steps`, shows the mean Success rate, and uses the latest Date.
  - Suggested pipeline rule: filter `Approach type == "General model"`, take the 100-step rows (or the max over step budgets), and average repeated runs.
- Denominators vary (356–361; 369 for Agent S2 rows), because some tasks are excluded per run. `Success rate` disagrees with `Success/Total` by more than 0.1 pp in 10 rows. Most were computed against 361. Use `Success rate` as-is.
- **Excel auto-format corruption:** the `Kimi K2.6` row's `thunderbird` cell is a datetime (`2026-12-15`, format `d-mmm`). The original was probably `"12/15"`. Per-app columns cannot be trusted as typed. Read them as text, and handle datetime cells as corrupted.

### `Approach type` distinct values (exact strings, counts)
| value | rows |
|---|---|
| `Specialized model` | 58 |
| `Agentic framework` | 52 |
| `General model` | 37 |
| `Unknown` | 2 (`o3 CUA`, `ChatGPT Agent`, both Success rate `"🚧"` with no date) |

The `General model` rows (37) cover 21 distinct models:
- o3 (15/50/100)
- claude-3-7-sonnet-20250219, claude-4-sonnet-20250514, claude-sonnet-4-5-20250929 (15/50/100 each)
- claude-sonnet-4-6, claude-fable-5[1m], claude-opus-5[1m]
- doubao-1-5-thinking-vision-pro-250428/-250717, UI-TARS-250705, Seed-1.8
- qwen2.5-vl-32b-instruct, qwen2.5-vl-72b-instruct, qwen3-vl-flash-2025-10-25, Qwen 3.7 Plus
- kimi-vl-a3b, Kimi K2.5, Kimi K2.6
- EvoCUA, EvoCUA-20260105, EvoCUA-8B-20260105
- MiniMax M3, Coasty CUA v1 (`Additional coding-based action = Yes`), Muse Spark 1.1

The latest General-model row is `claude-fable-5[1m]` at 85.96 (2026-08-01).

### Example row (`General model`; Date converted to ISO)
```json
{"Model": "claude-sonnet-4-6", "Institution": "Anthropic", "PaperLink": "https://www.anthropic.com/news/claude-sonnet-4-6", "PaperAuthors": "Anthropic, '26", "Approach type": "General model", "Max steps": 100, "Additional a11y tree used": "No", "Additional coding-based action": "No", "Multiple rollout": "No", "Date": "2026-03-08", "Success rate": 72.11, "Success/Total": "256.71/356", "chrome": "32.96/42", "gimp": "18.00/26", "libreoffice_calc": "35.00/47", "libreoffice_impress": "33.00/47", "libreoffice_writer": "19.97/23", "multi_apps": "55.95/93", "os": "22.00/24", "thunderbird": "10.00/15", "vlc": "13.84/17", "vs_code": "16.00/22"}
```

### Org / model naming quirks
- `Model` is free text with mixed casing and spacing:
  - API ids: `claude-4-sonnet-20250514`, `qwen3-vl-flash-2025-10-25`.
  - Display names: `Kimi K2.6`, `Qwen 3.7 Plus`, `MiniMax M3`, `Muse Spark 1.1`.
  - Context-window suffixes: `claude-opus-5[1m]`.
- Agentic framework rows embed the backbone: `agent s3 w/ Opus 4.5 + GPT-5 bBoN (N=10)`, `GTA1 w/ o3`, `OpenAPA w/ gemini-3.1-pro`, `Pointer Agent w/ Opus 4.7`. Excluding these by `Approach type` avoids false family hits.
- The OpenAI CUA model `computer-use-preview` is classed `Specialized model`, not General.
- `Institution` is free text with joint labs: `Qwen Team, Alibaba Group` vs `Alibaba Cloud, Qwen Team`; `Simular` vs `Simular Research`; `Meta Superintelligence Labs`. It is usable for org mapping only after normalization.
- **Gemini, Grok, DeepSeek, Llama and Mistral have no General-model rows.** Gemini appears only inside agentic frameworks (`agent s2 w/ gemini-2.5-pro`, `OpenAPA w/ gemini-3.1-pro`). GPT appears only as `o3` among General models, though `GPT-5` appears in frameworks. Coverage for strength-by-family is therefore sparse: mostly Claude, Qwen, Kimi and ByteDance.

### Licence

| Source | Exact wording / status |
|---|---|
| Site footer (`osworld-v1.xlang.ai` index.html) | "This website is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License." It continues: "This means you are free to borrow the source code of this website, we just ask that you link back to this page in the footer." (Nerfies template boilerplate, aimed at the site code) |
| Code repo `xlang-ai/OSWorld` | Apache-2.0 (`spdx_id: Apache-2.0`; README badge "License-Apache 2.0") |
| Site repo `OS-World/OS-World.github.io` (where the xlsx lives) | a fork of nerfies, `license: null` |
| HF `xlangai/ubuntu_osworld_verified_trajs` (verified trajectories) | `license: mit` |

**Verdict: OK to redisplay derived scores with credit.** The CC BY-SA 4.0 site licence is the governing statement for leaderboard content. Attribute "OSWorld-Verified (xlang.ai / os-world.github.io)" with a link, and apply share-alike if we republish the table itself or a near-verbatim copy of it. The scores are facts, the trajectories are MIT, and the code is Apache-2.0. The data file has no stricter terms anywhere.

### Surprises
- The 301 from os-world.github.io points to **http** (not https) `osworld-v1.xlang.ai`. The "v1" suggests a v2 site or URL may come. The `https://osworld-v1.xlang.ai/...` URL works directly.
- Excel serial integers are mixed with real dates in one column. There is an Excel date-corruption cell, emoji placeholders (`🚧`) in the numeric column, and inconsistent `" / "` spacing.
- The xlsx `dimensions` claim 1077 rows and 29 columns, but only 149×22 are real.

---

## Family patterns (livebench/osworld)

Recommendation:
- **LiveBench:** prefer the JS metadata `organization` field (normalize `Mistral`→`Mistral AI` and `AbacusAI`→`Abacus.AI`). Use regex as a fallback for rows missing from the dict.
- **Regex order matters.** Match the exclusions and `deepseek-` first, because of `deepseek-r1-distill-llama/qwen`, `dracarys-llama`, `hermes-3-llama`, `llama-3.1-nemotron` (NVIDIA), `smaug-qwen2`, `openhermes-2.5-mistral` and `opencua-qwen2`.
- **OSWorld:** match case-insensitively on `Model`, restricted to `Approach type == "General model"`. Strip a `\[\d+[km]\]$` suffix first (`claude-opus-5[1m]`).

| Family | LiveBench names seen | OSWorld names seen (General model unless noted) | Suggested regex (case-insensitive, applied in this order) |
|---|---|---|---|
| **DeepSeek** (check first) | `deepseek-coder-v2`, `deepseek-v2.5`, `deepseek-v3-0324`, `deepseek-r1`, `deepseek-r1-0528`, `deepseek-r1-distill-llama-70b`, `deepseek-r1-distill-qwen-32b`, `deepseek-v3.1-terminus(-thinking)`, `deepseek-v3.2(-exp)(-thinking)`, `deepseek-v3.2-speciale`, `deepseek-v4-flash(-0731)`, `deepseek-v4-pro(-0813)`, `deepseek-v4-flash-vision-exp`, `deepseek-v4.1-flash-max` | none | `^deepseek[-\s]` (the distills count as DeepSeek per the LiveBench metadata; drop `-distill-` if you want first-party flagship only). Exclude `^smaug-` (Abacus finetunes) |
| **GPT / OpenAI** | `gpt-3.5-turbo-0125`, `gpt-4-0613`, `gpt-4-turbo-2024-04-09`, `gpt-4o-2024-05-13`, `gpt-4o-mini-...`, `chatgpt-4o-latest(-2025-03-27)`, `gpt-4.1(-mini/-nano)-2025-04-14`, `gpt-4.5-preview...`, `o1-2024-12-17-high`, `o1-mini-...`, `o1-preview-...`, `o3-2025-04-16-high`, `o3-mini-2025-01-31-low`, `o4-mini-2025-04-16-medium`, `gpt-5(-mini/-nano/-pro/-codex/-chat)(-high/-low/-minimal)`, `gpt-5.1-2025-11-13-high`, `gpt-5.1-codex-max-xhigh`, `gpt-5.2-codex`, `gpt-5.3-instant`, `gpt-5.4-xhigh`, `gpt-5.5-xhigh`, `gpt-5.6-{sol,terra,luna}-max`, `gpt-6-{sol,luna,astra}-max`, `gpt-6.1-sol-{max,xhigh}`, `gpt-oss-120b` | `o3` (General). `computer-use-preview` (Specialized). `o3 CUA` and `ChatGPT Agent` (Unknown, no score) | `^(?:chatgpt-\|gpt-\d\|gpt-oss\|o\d(?:-mini\|-preview\|-pro)?(?:-\|$))`. Decide whether `gpt-oss` (open-weight) belongs to the GPT family. OSWorld: `^(?:o\d\b\|gpt-\|chatgpt)` |
| **Claude** | `claude-3-opus-20240229`, `claude-3-5-sonnet-20240620`, `claude-3-5-haiku-20241022`, `claude-3-7-sonnet-20250219-thinking-64k`/`-base`, `claude-4-sonnet-20250514-...`, `claude-4-opus-...`, `claude-4-1-opus-20250805-thinking-32k`, `claude-sonnet-4-5-20250929(-thinking-64k)`, `claude-haiku-4-5-20251001`, `claude-opus-4-5-20251101-thinking-64k-high-effort`, `claude-opus-4-6-thinking-auto-high-effort`, `claude-opus-4-7-xhigh-effort`, `claude-opus-4-8-max-effort`, `claude-opus-5-max-effort`, `claude-opus-5-5-{max,xhigh}-effort`, `claude-sonnet-5-xhigh-effort`, `claude-sonnet-5-5-...`, `claude-haiku-5-5-...`, `claude-fable-5-max-effort`, `claude-fable-5-1-max-effort` | `claude-3-7-sonnet-20250219`, `claude-4-sonnet-20250514`, `claude-sonnet-4-5-20250929`, `claude-sonnet-4-6`, `claude-fable-5[1m]`, `claude-opus-5[1m]` | `^claude[-\s]`. Tier/version order varies (`claude-4-sonnet` vs `claude-sonnet-4-5`), so parse the tier with `(opus\|sonnet\|haiku\|fable)` anywhere in the name |
| **Gemini** | `gemini-1.5-pro-api-0514`, `gemini-1.5-pro-exp-0827`, `gemini-1.5-flash-002`, `gemini-exp-1114/1121/1206`, `gemini-2.0-flash(-001)(-lite)`, `gemini-2.0-flash-thinking-exp-01-21`, `gemini-2.5-pro-exp-03-25`, `gemini-2.5-pro-06-05-highthinking`, `gemini-2.5-flash-preview-09-2025-highthinking`, `gemini-3-pro-preview-11-2025-high`, `gemini-3-flash-preview-minimal`, `gemini-3.1-pro-preview-high`, `gemini-3.5-flash(-lite)-high`, `gemini-3.6/3.7/3.8-flash-high` | none in General. Backbone only in frameworks (`agent s2 w/ gemini-2.5-pro`, `OpenAPA w/ gemini-3.1-pro`) | `^gemini-`. Exclude `^gemma-` (open-weight Gemma 1/2/3/4) and `^learnlm-` unless the family is meant to cover all of Google |
| **Grok** | `grok-beta`, `grok-2(-mini)`, `grok-2-1212`, `grok-3-beta`, `grok-3-mini-beta-high`, `grok-4-0709`, `grok-4-fast-(non-)reasoning-2511`, `grok-4-1-fast-(non-)reasoning`, `grok-4.20-beta-0309-(non-)reasoning`, `grok-code-fast-1-0825`, `grok-4.3`, `grok-4.5`, `grok-4.6`, `grok-4.7-xhigh`, `grok-build-0.1` | none | `^grok-`. Decide whether `grok-code-fast` and `grok-build` (coding-specialised) count |
| **Qwen** | `qwen1.5-110b-chat`, `qwen2-72b-instruct`, `qwen2.5-72b-instruct(-turbo)`, `qwen2.5-coder-32b-instruct`, `qwen2.5-max`, `qwq-32b(-preview)`, `qwen3-235b-a22b-thinking-2507`, `qwen3-30b-a3b-thinking`, `qwen3-coder-480b-a35b-instruct`, `qwen3-max-2025-09-23`, `qwen3-next-80b-a3b-thinking`, `qwen3.6-27b/-flash/-plus`, `qwen3.7-max`, `qwen3.8-27b/-flash-next/-max` | `qwen2.5-vl-32b-instruct`, `qwen2.5-vl-72b-instruct`, `qwen3-vl-flash-2025-10-25`, `Qwen 3.7 Plus`. Specialized: `gui-owl-7b`, `GUI-Owl-1.5 32B` (Alibaba Tongyi, not Qwen-branded) | `^(?:qwen[\s\d.-]\|qwq-)`. Exclude `smaug-qwen2-...`, `deepseek-r1-distill-qwen-...`, `opencua-qwen2-7b` and `dracarys-72b-instruct` (an Abacus Qwen2 finetune). These are excluded automatically by the `^` anchor and by checking DeepSeek first |
| **Llama (Meta)** | `llama-2-7b-chat-hf`, `meta-llama-3-70b-instruct`, `meta-llama-3.1-405b-instruct-turbo`, `llama-3.3-70b-instruct-turbo`, `llama-4-maverick-17b-128e-instruct`, `llama4-maverick-instruct-basic`. **None in 2026_06_25.** Meta's current entries are `muse-spark-1.1/1.2/1.3-xhigh` (org Meta) | none. `Muse Spark 1.1` (Meta Superintelligence Labs, General model, 80.67) | `^(?:meta-)?llama-?\d` with explicit excludes `llama-3\.1-nemotron` (NVIDIA), `hermes-3-llama`, `dracarys2?-llama`, `deepseek-r1-distill-llama`. Decide whether Meta's `^muse-spark` is part of this family (it is the successor flagship) |
| **Mistral** | `mistral-7b-instruct-v0.2/0.3`, `mistral-large-2402/2407/2411`, `mistral-small-2402/2501/2503`, `mistral-medium-2505`, `mixtral-8x7b/8x22b-instruct-v0.1`, `open-mistral-nemo`, `mathstral-7b-v0.1`, `devstral-2512` (org "Mistral"), `mistral-large-4-high` (latest) | none | `^(?:mistral-\|mixtral-\|open-mistral\|(?:ma(?:gi\|th)\|code\|dev\|mini\|pix)stral-)`. Exclude `openhermes-2.5-mistral-7b` (Teknium finetune). It is excluded automatically by the `^` anchor |

Validation: I ran these regexes, in table order with the `nemotron` exclusion added for Llama, against the union of all `model` values in the 11 LiveBench releases plus the OSWorld General-model names. Results:
- Matched: DeepSeek 23, GPT 83, Claude 57, Gemini 41, Grok 19, Qwen 38, Llama 9, Mistral 15.
- No false positives. Everything else (gemma, phi, glm, kimi, smaug, dracarys, hermes, nemotron, muse-spark, ...) fell to "other" as intended.
- `|` is escaped as `\|` inside the table cells above. Unescape it when copying.

Coverage summary for 2026-10: LiveBench's latest release covers GPT, Claude, Gemini, Grok, DeepSeek, Qwen and Mistral (1 model), with no Llama (Meta appears as Muse Spark). OSWorld General-model rows cover only Claude, Qwen, GPT (o3 only, 2025-07) and Meta (Muse Spark); there is nothing for Gemini, Grok, DeepSeek, Llama or Mistral.
