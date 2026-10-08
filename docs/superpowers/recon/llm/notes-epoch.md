# Epoch AI data sources: recon notes

Retrieved 2026-10-08 (zip entries are stamped 2026-10-08 11:17 UTC; the ECI page says "Updated Oct. 8, 2026").
Raw downloads are in `scratchpad/recon-llm/epoch/`, and the extracted zip is in `scratchpad/recon-llm/epoch/zip/`.
Analysis scripts are in `scratchpad/recon-llm/epoch/scripts/` (`profile.py`, `families.py`, `make_fixtures.py`).

## Short answers

- Every benchmark CSV already has `Release date` (the model release date) and `Organization` on each row. No join is needed to get a month or an org.
- To get a stable model identity, join on `Model version` = `model_metadata.csv:model_version` (100% coverage for all 7 target files). That gives `model_group`, which is exactly the ECI `Model` key (274/274). Several effort variants (`_high`, `_max`, `_unknown`, `_16K` ...) collapse into one group.
- All Epoch files are single current snapshots. They have no history columns and no versioned URLs. History exists only through the Wayback Machine (details below).
- Licence: Epoch's own data is under CC BY 4.0. Rows in `*_external.csv` files came from third-party leaderboards. Epoch says that data "retains its original licensing".
- Staleness: in today's zip, Terminal-Bench (newest model 2026-04-23), METR (2026-04-07), SWE-bench Verified (2026-06-16) and OSWorld v1 (2026-02-17) are stale. ECI, APEX-Agents and Vending-Bench 2 are current (2026-09-29 / 09-30).

---

## epoch-eci

**URL (works):** `https://epoch.ai/data/eci_scores.csv`. HTTP 200, `text/csv`, 33,807 bytes, served through Cloudflare.
The file is byte-identical to `benchmark_data.zip:epoch_capabilities_index/eci_scores.csv` (checked with `cmp`).
Sibling files from the ECI page (https://epoch.ai/eci, the redirect target of /benchmarks/eci):
- `https://epoch.ai/data/eci_benchmarks.csv`: 367,502 bytes, identical to the zip's `processed_data_for_eci.csv`.
- `https://epoch.ai/data/edi_scores.csv`: 4,192 bytes, identical to the zip's `edi_scores.csv`.

**Format:** CSV, UTF-8, no BOM, LF line endings, minimal quoting (only multi-org values are quoted). 274 data rows, 11 columns, one row per model group. Sorted by `eci` descending.

| Column | Type | Notes |
|---|---|---|
| `Model` | str | Model group name (display style, e.g. `GPT-4o (Nov 2024)`, `Claude Opus 5.5`). Unique. Equals `model_metadata.model_group`. |
| `Display name` | str | Equal to `Model` in all 274 rows today (an older snapshot had `GPT-5.4 Pro (web)` vs `GPT-5.4 Pro`). |
| `eci` | float | ECI score. Range 55.75 (stablelm-tuned-alpha-7b) to 167.33 (Claude Opus 5.5). Scale is anchored at Claude 3.5 Sonnet = 130 and GPT-5 = 150 and is unbounded. |
| `eci_ci_low`, `eci_ci_high` | float | 90% bootstrap CI (`eci_bootstraps.json`: `ci_level: 0.9`, 500 samples). Empty for the 2 anchor rows (GPT-5 = 150.0, Claude 3.5 Sonnet = 130.0). |
| `date` | str `YYYY-MM-DD` | Model release date, resolved per group: always one of the `model_metadata.date` values for that group (274/274). Range 2023-02-24 to 2026-09-29. Not the evaluation date. |
| `Organization` | str | 30 distinct values, 17 blank. Can hold several comma-separated orgs. |
| `Country (of organization)` | str | 6 values (USA 159, China 76, France 16, UAE 4, Canada 1, UK 1). 17 blank. |
| `Model accessibility` | str | API access 121, Open weights (unrestricted) 72, Open weights (restricted use) 44, Unknown 22, Open weights (non-commercial) 11, Hosted access (no API) 2, Unreleased 2. |
| `Accessibility group` | str | Open weights 127, Closed weights 125, Other 22. |
| `model_versions` | (empty) | Empty in all 274 rows. Pandas reads it as float NaN. |

There is no "is frontier" column and no version column. (The web UI has a "Frontier trend only" toggle, but the CSV has no matching flag.)

**Example row:** `Claude Opus 5.5,Claude Opus 5.5,167.33,164.06,171.68,2026-09-22,Anthropic,United States of America,API access,Closed weights,`

**Organizations (count):** OpenAI 46, Alibaba 37, Google DeepMind 31, Anthropic 26, Meta AI 22, *blank* 17, DeepSeek 16, Mistral AI 16, xAI 10, Moonshot 6, Z.ai (Zhipu AI) 6, Microsoft 5, Technology Innovation Institute 4, MiniMax 3, `Google DeepMind,Google` 3, Baichuan 3, `DeepSeek,Peking University` 3, `Hugging Face,ServiceNow,Nvidia,BigCode` 3, Thinking Machines 2, MosaicML 2, Nvidia 2, 01.AI 2, Google 1, Stability AI 1, `Cohere,Cohere Labs (formerly Cohere for AI)` 1, Microsoft Research 1, Amazon 1, `Prime Intellect,Hugging Face,Arcee AI` 1, Salesforce 1, Databricks 1, Cerebras Systems 1.
- Multi-org values are a single quoted CSV field, for example `"Google DeepMind,Google"`. Split on `,` and match any part.
- Google appears as `Google DeepMind` (31), `Google` (1: Gemini 3.1 Flash-Lite) and `Google DeepMind,Google` (3: Gemini 2.0 Flash variants).
- The 17 blank-org rows are mostly old open models: Qwen2.5-Coder 0.5B/3B/14B, CodeQwen1.5-7B, Qwen-1_8B, DeepSeek-Coder-V2-Lite-Base, PaLM 2-S/M/L, Yi-9B, internlm, chatglm2, vicuna, open_llama, RedPajama, stablelm. **Use name-regex fallback for Qwen/DeepSeek.**

**Date semantics:** `date` is the model (group) release date. One row per model. The data has no time series of ECI values. To build a monthly series, take for each month the max ECI among models released up to that month (cumulative frontier), or aggregate by release month.

**Snapshot or history:** It is a single current snapshot. Each update re-fits **every** model's ECI, so past values drift. Example: GPT-5.4 Pro was 158.24 in the 2026-03-20 snapshot and is 158.93 now. The `Model accessibility` value and the model set also change. No archived or versioned URL exists on epoch.ai: `/data/eci_scores.csv.sha256` and similar return 404, and the files have no date in their names. Wayback Machine has 28 distinct captures (by digest) of eci_scores.csv between 2026-03-20 and 2026-10-08, for example `http://web.archive.org/web/20260320171651id_/https://epoch.ai/data/eci_scores.csv`, which returns the raw CSV (160 rows, same 11-column header). The CDX API answered fine, but `archive.org/wayback/available` returned HTTP 429 once.

**Rate limits/auth:** None observed. No auth, served by Cloudflare. `Cache-Control: public, max-age=0, must-revalidate` and a strong `ETag`. A conditional GET with `If-None-Match` returns **304** (tested), so cheap change polling works. There is no `Last-Modified` header. robots.txt allows /data/.

**Licence verdict:** **CC BY 4.0.** The page states "Epoch AI's data is free to use, distribute, and reproduce provided the source and authors are credited under the Creative Commons Attribution license", and the link target is https://creativecommons.org/licenses/by/4.0/. Required citation: "Epoch AI, 'Epoch Capabilities Index'. Published online at epoch.ai. Retrieved from 'https://epoch.ai/eci'". The fitting code (github.com/epoch-research/eci-public) is under the MIT licence.

**Surprises:**
- The two anchor rows have empty CIs by construction.
- `model_versions` is always empty.
- The fit only includes models with at least 4 benchmarks and dated 2023-01-01 or later (`eci-public/src/eci/dataloader.py`), so a newly released model may be missing for a while.
- New 2026 lines appear in the data. Meta's frontier line is "Muse Spark" (Llama no longer). OpenAI has "GPT-6 Astra/Sol/Luna". Anthropic has "Claude Fable" and "Claude Mythos Preview" (Mythos is in model_metadata, not in ECI).

---

## Epoch zip: file inventory

**URL (works):** `https://epoch.ai/data/benchmark_data.zip`. HTTP 200, `application/zip`, **2,378,109 bytes**, ETag `"2b3b996f5335d96bd8d94e642e589d86"`, cache headers as above.
It holds 89 entries: a README, 82 per-benchmark CSVs, 2 metadata CSVs, and 4 ECI files under `epoch_capabilities_index/`. All entries are stamped 2026-10-08 11:17.
Wayback has 23 distinct captures of this zip from 2025-03-05 onward. The size dropped to about 270 KB in Nov 2025 and grew back to 2.3 MB in Sep 2026, when `eci_bootstraps.json` was added.

Benchmark CSVs come in two kinds:
- Epoch-run files (no `_external` suffix): 15 files that share an identical 13-column layout.
- External files (`*_external.csv`): 67 files scraped from third-party leaderboards.

The `benchmark_metadata.csv` columns (score_column, scale) are listed alongside each file. scale `0.01` means the score column is in percent.

| # | File in zip | Bytes | Data rows | Cols | Benchmark (benchmark_metadata) | in_eci | score_column | scale |
|---|---|---:|---:|---:|---|---|---|---|
| 1 | `README.md` | 582 | - | - |  |  |  |  |
| 2 | `gpqa_diamond.csv` | 156,351 | 319 | 13 | GPQA diamond | True | Best score (across scorers) | 1.0 |
| 3 | `math_level_5.csv` | 49,349 | 108 | 13 | MATH level 5 | True | Best score (across scorers) | 1.0 |
| 4 | `swe_bench_verified.csv` | 16,671 | 35 | 13 | SWE-Bench verified | True | Best score (across scorers) | 1.0 |
| 5 | `otis_mock_aime_2024_2025.csv` | 141,971 | 297 | 13 | OTIS Mock AIME 2024-2025 | True | Best score (across scorers) | 1.0 |
| 6 | `frontiermath.csv` | 36,580 | 101 | 13 | FrontierMath-2025-02-28-Private | True | Best score (across scorers) | 1.0 |
| 7 | `frontiermath_tier_4.csv` | 21,777 | 72 | 13 | FrontierMath-Tier-4-2025-07-01-Private | True | Best score (across scorers) | 1.0 |
| 8 | `frontiermath_tiers_1_3_v2.csv` | 47,713 | 114 | 13 | FrontierMath-Tiers-1-3-v2-Private | True | Best score (across scorers) | 1.0 |
| 9 | `frontiermath_tier_4_v2.csv` | 27,781 | 70 | 13 | FrontierMath-Tier-4-v2-Private | True | Best score (across scorers) | 1.0 |
| 10 | `ebr_bench.csv` | 4,686 | 24 | 13 | EBR-bench | True | Best score (across scorers) | 1.0 |
| 11 | `simpleqa_verified.csv` | 33,993 | 86 | 13 | SimpleQA Verified | True | Best score (across scorers) | 1.0 |
| 12 | `chess_puzzles.csv` | 94,258 | 227 | 13 | Chess Puzzles | True | Best score (across scorers) | 1.0 |
| 13 | `mystery_game_puzzles.csv` | 35,239 | 135 | 13 | Mystery Game Puzzles | True | Best score (across scorers) | 1.0 |
| 14 | `mirrorcode.csv` | 2,085 | 9 | 13 | MirrorCode | True | Best score (across scorers) | 1.0 |
| 15 | `frontiermath_erdos.csv` | 1,325 | 5 | 13 |  |  |  |  |
| 16 | `furniture_assembly.csv` | 6,012 | 29 | 13 | Furniture Assembly | True | Best score (across scorers) | 1.0 |
| 17 | `aider_polyglot_external.csv` | 27,984 | 77 | 16 | Aider polyglot | True | Percent correct | 0.01 |
| 18 | `balrog_external.csv` | 18,768 | 41 | 26 | Balrog | True | Average progress | 1.0 |
| 19 | `weirdml_external.csv` | 51,786 | 174 | 14 | WeirdML | True | Accuracy | 1.0 |
| 20 | `weirdml_v3_external.csv` | 6,603 | 17 | 20 |  |  |  |  |
| 21 | `vpct_external.csv` | 9,136 | 38 | 11 | VPCT | True | Correct | 1.0 |
| 22 | `fictionlivebench_external.csv` | 26,313 | 62 | 21 | Fiction.LiveBench | True | 16k token score | 1.0 |
| 23 | `geobench_external.csv` | 11,353 | 32 | 36 | GeoBench | True | ACW Country % | 1.0 |
| 24 | `simplebench_external.csv` | 26,478 | 104 | 11 | SimpleBench | True | Score (AVG@5) | 1.0 |
| 25 | `gdpval_external.csv` | 2,806 | 11 | 10 | GDPval | True | Win Rate (%) | 1.0 |
| 26 | `gdp_pdf_external.csv` | 12,857 | 55 | 14 |  |  |  |  |
| 27 | `metr_time_horizons_external.csv` | 18,950 | 49 | 16 | METR Time Horizons | True | average_score | 1.0 |
| 28 | `deepresearchbench_external.csv` | 9,048 | 41 | 12 | DeepResearch Bench | True | Average score | 1.0 |
| 29 | `terminalbench_external.csv` | 65,736 | 204 | 18 | Terminal Bench | True | Accuracy mean | 1.0 |
| 30 | `frontierswe_external.csv` | 5,858 | 19 | 23 | FrontierSWE | True | Score | 1.0 |
| 31 | `frontiercode_external.csv` | 9,177 | 47 | 13 | FrontierCode | True | Main score | 1.0 |
| 32 | `cursorbench_external.csv` | 10,785 | 63 | 15 |  |  |  |  |
| 33 | `scicode_external.csv` | 53,707 | 218 | 12 |  |  |  |  |
| 34 | `osworld_2_external.csv` | 2,870 | 16 | 16 | OSWorld 2.0 | True | Binary accuracy | 1.0 |
| 35 | `gbaeval_external.csv` | 8,693 | 23 | 25 |  |  |  |  |
| 36 | `posttrainbench_external.csv` | 2,259 | 12 | 11 | PostTrainBench | True | Average (%) | 1.0 |
| 37 | `gso_external.csv` | 10,084 | 42 | 16 | GSO-Bench | True | Score OPT@1 | 1.0 |
| 38 | `webdev_arena_external.csv` | 31,263 | 141 | 16 |  |  |  |  |
| 39 | `video_mme_external.csv` | 12,901 | 50 | 20 |  |  |  |  |
| 40 | `adversarial_nli_external.csv` | 7,856 | 19 | 16 | ANLI | True | Score | 1.0 |
| 41 | `arc_agi_external.csv` | 61,795 | 279 | 13 | ARC-AGI | True | Score | 1.0 |
| 42 | `arc_ai2_external.csv` | 47,496 | 145 | 14 | ARC AI2 | True | Challenge score | 1.0 |
| 43 | `bbh_external.csv` | 27,620 | 92 | 13 | BBH | True | Average | 1.0 |
| 44 | `bool_q_external.csv` | 57,081 | 206 | 13 |  |  |  |  |
| 45 | `cad_eval_external.csv` | 5,518 | 15 | 25 | CadEval | True | Overall pass (%) | 1.0 |
| 46 | `common_sense_qa_2_external.csv` | 3,537 | 10 | 13 |  |  |  |  |
| 47 | `cybench_external.csv` | 10,969 | 22 | 15 | Cybench | True | Unguided % Solved | 1.0 |
| 48 | `gsm8k_external.csv` | 61,569 | 235 | 13 | GSM8K | True | EM | 1.0 |
| 49 | `hella_swag_external.csv` | 43,332 | 135 | 13 | HellaSwag | True | Overall accuracy | 1.0 |
| 50 | `lambada_external.csv` | 20,880 | 80 | 13 | LAMBADA | True | Score | 1.0 |
| 51 | `lech_mazur_writing_external.csv` | 27,528 | 49 | 11 | Lech Mazur Writing | True | Mean score | 0.1 |
| 52 | `live_bench_external.csv` | 20,888 | 64 | 19 |  |  |  |  |
| 53 | `mmlu_external.csv` | 79,823 | 249 | 13 | MMLU | True | EM | 1.0 |
| 54 | `open_book_qa_external.csv` | 27,871 | 71 | 13 | OpenBookQA | True | Accuracy | 1.0 |
| 55 | `os_world_external.csv` | 9,434 | 58 | 13 | OSWorld | True | Score | 0.01 |
| 56 | `piqa_external.csv` | 44,827 | 140 | 13 | PIQA | True | Score | 1.0 |
| 57 | `science_qa_external.csv` | 16,537 | 104 | 13 | ScienceQA | True | Score | 1.0 |
| 58 | `superglue_external.csv` | 3,281 | 11 | 12 | SuperGLUE | True | Score | 1.0 |
| 59 | `the_agent_company_external.csv` | 9,425 | 16 | 18 | The Agent Company | True | % Resolved | 1.0 |
| 60 | `trivia_qa_external.csv` | 42,584 | 115 | 13 | TriviaQA | True | EM | 1.0 |
| 61 | `wino_grande_external.csv` | 53,104 | 145 | 13 | Winogrande | True | Accuracy | 1.0 |
| 62 | `apex_agents_external.csv` | 8,941 | 52 | 13 | APEX-Agents | True | Pass@1 score | 1.0 |
| 63 | `arc_agi_2_external.csv` | 50,611 | 259 | 11 | ARC-AGI-2 | True | Score | 1.0 |
| 64 | `hle_external.csv` | 13,767 | 54 | 12 | HLE | True | Accuracy | 1.0 |
| 65 | `exploitbench_external.csv` | 3,123 | 20 | 20 | ExploitBench | True | Mean capability | 1.0 |
| 66 | `cl_bench_external.csv` | 6,892 | 23 | 18 | CL-bench | True | Overall | 1.0 |
| 67 | `cl_bench_life_external.csv` | 4,875 | 17 | 16 | CL-bench Life | True | Overall | 1.0 |
| 68 | `rli_external.csv` | 2,911 | 16 | 10 | Remote Labor Index | True | Score | 1.0 |
| 69 | `algotune_external.csv` | 3,492 | 18 | 10 |  |  |  |  |
| 70 | `ale_bench_external.csv` | 25,569 | 121 | 15 |  |  |  |  |
| 71 | `forecastbench_external.csv` | 28,174 | 82 | 26 |  |  |  |  |
| 72 | `critpt_external.csv` | 42,339 | 225 | 10 |  |  |  |  |
| 73 | `vending_bench_2_external.csv` | 10,623 | 66 | 9 |  |  |  |  |
| 74 | `surface_evolver_bench_external.csv` | 7,177 | 28 | 14 | Surface Evolver Bench | True | Mean score | 1.0 |
| 75 | `deepswe_external.csv` | 20,647 | 69 | 18 | DeepSWE | True | Pass@1 | 1.0 |
| 76 | `blueprint_bench_2_external.csv` | 6,200 | 31 | 12 |  |  |  |  |
| 77 | `mindcube_external.csv` | 1,124 | 5 | 14 |  |  |  |  |
| 78 | `spatialviz_bench_external.csv` | 3,740 | 8 | 15 |  |  |  |  |
| 79 | `proofbench_external.csv` | 26,699 | 79 | 15 | ProofBench | True | Accuracy | 1.0 |
| 80 | `btf3_external.csv` | 3,544 | 15 | 15 |  |  |  |  |
| 81 | `enigma_eval_external.csv` | 15,403 | 46 | 15 |  |  |  |  |
| 82 | `lmca_external.csv` | 35,522 | 176 | 11 | LMCA | True | Score | 0.01 |
| 83 | `dtbench_external.csv` | 50,859 | 214 | 13 | DTBench | True | Accuracy | 1.0 |
| 84 | `epoch_capabilities_index/eci_scores.csv` | 33,807 | 274 | 11 |  |  |  |  |
| 85 | `epoch_capabilities_index/edi_scores.csv` | 4,192 | 60 | 5 |  |  |  |  |
| 86 | `epoch_capabilities_index/processed_data_for_eci.csv` | 367,502 | 2898 | 10 |  |  |  |  |
| 87 | `epoch_capabilities_index/eci_bootstraps.json` | 3,926,251 | - | - |  |  |  |  |
| 88 | `benchmark_metadata.csv` | 6,271 | 88 | 9 |  |  |  |  |
| 89 | `model_metadata.csv` | 118,428 | 1139 | 8 |  |  |  |  |

"Data rows" are logical CSV records. Several files have multi-line quoted fields (in `Training compute notes`), so physical line counts are higher.

Mapping of requested source IDs to files:
- `epoch-terminalbench` -> `terminalbench_external.csv` (exact name).
- `epoch-metr` -> `metr_time_horizons_external.csv` (exact).
- `epoch-vending` -> `vending_bench_2_external.csv` (exact).
- `epoch-apex` -> `apex_agents_external.csv` (exact).
- `epoch-swebench` -> `swe_bench_verified.csv` (exact; this is an Epoch-run file, not external).
- `epoch-osworld` -> **two files exist**: `os_world_external.csv` (original OSWorld; percent) and `osworld_2_external.csv` (OSWorld 2.0; fraction). I mapped `epoch-osworld` to `os_world_external.csv` and added a separate fixture `epoch-osworld2` for v2. These are different benchmarks with different scales. Don't merge them.

Other zip contents:
- **README.md:** licensing, citation and BibTeX only (quoted in the Licence section). There is no data dictionary.
- **`benchmark_metadata.csv`** (88 rows) is the closest thing to a data dictionary. Columns: `benchmark,in_eci,source_file,score_column,scale,random_baseline,score_ceiling,release_date,superseded_by`. It tells you which column is the headline score of each file and the multiplier that turns it into a 0-1 fraction (`scale`). 27 benchmarks have no `source_file` (display-only), including **Vending-Bench 2**, so Vending's unit is not declared anywhere.
- **`model_metadata.csv`** (1139 rows) is the model join table. See "Join" below.
- **`processed_data_for_eci.csv`** is the only "combined runs" file. It is long format with one row per (model group x benchmark): `model_id,benchmark_id,performance,benchmark,benchmark_release_date,model,model_version,Model,date,source`. 2898 rows, 274 groups, 60 benchmarks. `performance` is already normalized to 0-1 (random baseline -> 0, ceiling -> 1), max-aggregated per group and clipped. METR here uses `average_score`, not the time horizon. Vending is absent.
- **`edi_scores.csv`**: `benchmark_name,is_anchor,benchmark_release_date,edi,estimated_slope_scaled` (60 rows; benchmark difficulty on the ECI scale).
- **`eci_bootstraps.json`**: 3.9 MB. Keys `num_samples` (500), `eci_scaled`, `ci_level` (0.9), `anchors` ({Claude 3.5 Sonnet: 130, GPT-5: 150}), `scaling`, `model`, `benchmark` (per-draw values keyed by `m*`/`b*` ids).

Other access path: the `epochai` Python client (https://github.com/epoch-research/epochai-python) reads Epoch's Airtable base. It needs **your own copy of the base plus an Airtable personal access token**, because Airtable has no public API. Not worth it; the zip is enough.

---

## Epoch common CSV layout

All 82 per-benchmark CSVs share this rule: `Model version` is always column 0, and these 5 columns always appear **contiguously and in this order**:

```
Release date, Organization, Country, Training compute (FLOP), Training compute notes
```

The block starts at column index 2 in 45 files, 3 in 23, 4 in 5, 5 in 4, 6 in 3, and 8 and 11 in one file each. **Match columns by name, not position.**

| Common column | Type | Meaning |
|---|---|---|
| `Model version` | str | Epoch model-version slug, e.g. `claude-opus-4-7_max`, `gpt-5-2025-08-07_medium`, `gemini-3-pro-preview`, `Qwen3-Coder-480B-A35B-Instruct`. Can be blank for unlinked rows. Join key to `model_metadata.model_version`. |
| `Release date` | str `YYYY-MM-DD` | **Model** release date, denormalized from model metadata (not the eval date). |
| `Organization` | str | Developer org. Can be multi-valued (`Z.ai (Zhipu AI),Tsinghua University`). Can be blank. |
| `Country` | str | Org country. |
| `Training compute (FLOP)` | float (e-notation, e.g. `1.0001e+27`) | Mostly blank. |
| `Training compute notes` | str | Free text with embedded newlines and doubled quotes. **Use a real CSV parser** (pandas or `csv`), never split on lines. |

Columns on most files: `id` (63 files; Airtable record id `rec...` or Inspect log id), `Notes` (59), `Source` (53), `Name` (52; display name), `Source link` (32).

**Epoch-run files** (15, identical 13-column layout; includes `swe_bench_verified.csv`):
`Model version, mean_score, Best score (across scorers), Release date, Organization, Country, Training compute (FLOP), Training compute notes, stderr, Log viewer, Logs, Started at, id`
Notes on these columns:
- `Started at` is the eval run timestamp (ISO 8601 with Z).
- `id` is the Inspect log id.

**External files:** `Model version`, then 1 or more score columns, then the common block, then file-specific extras. The extras for the target files:

| File | Score col(s) | Extras after the common block |
|---|---|---|
| terminalbench_external | `Agent`, `Accuracy mean` (before block) | `Accuracy SE, Agent Org, Model Org, Run date, Notes, Source, Source Link, Created, Name, id` |
| metr_time_horizons_external | `Time horizon`, `average_score` | `CI_high, CI_low, Source, Source link, Notes, Time Horizon (80%), METR version, id` |
| vending_bench_2_external | `Score` | `Name, id` |
| apex_agents_external | `Pass@1 score` | `Name, Pass@1 Standard Error, Mean score, Mean Standard Error, Notes, id` |
| swe_bench_verified | `mean_score`, `Best score (across scorers)` | `stderr, Log viewer, Logs, Started at, id` |
| os_world_external | `Score` | `Agent, Source, Source link, Notes (details), Date added, Trajectories` |
| osworld_2_external | `Binary accuracy, Partial score, Reasoning, Tool setting, Step budget` | `Name, Model family, Estimated cost (USD), Source, Notes` |

Notes on the column names:
- Capitalization is inconsistent: `Source Link` vs `Source link`, and `CI_high` vs `95% CI High`.
- Some files have an `Agent`/`Scaffold`/`Harness` column, which is where duplicates per model come from.

### Join: model metadata (`epoch-models`)

You don't need a join for release date or org; both are already on every row. **Use the join to normalize identity:**

```
benchmark_csv."Model version"  ==  model_metadata.model_version   ->  model_group, date, organization, display_name, accessibility
model_metadata.model_group     ==  eci_scores.Model               (274/274 ECI rows match)
```

Coverage measured on today's files:

| File | Rows with Model version | Found in model_metadata | Release date agrees | Org agrees | Distinct versions -> groups |
|---|---|---|---|---|---|
| terminalbench | 202/204 | 202 | 194 (8 disagree: `gemini-2.5-pro` 2025-06-17 vs 2025-06-05) | 202 | 59 -> 45 |
| metr | 49/49 | 49 | 48 (`davinci-002` blank in CSV, 2020-05-28 in metadata) | 49 | 46 -> 39 |
| vending | 66/66 | 66 | 65 (gemini-2.5-pro) | 66 | 66 -> 60 |
| apex | 52/52 | 52 | 52 | 52 | 52 -> 49 |
| swebench | 35/35 | 35 | 34 (gemini-2.5-pro) | 35 | 33 -> 32 |
| os_world (v1) | 21/58 | 21 | 21 | 21 | 9 -> 9 |
| osworld_2 | 16/16 | 16 | 16 | 16 | 14 -> 9 |

`model_metadata.csv` columns: `model_version (str), model_group (str), date (YYYY-MM-DD, group-resolved release date), display_name (str, often blank), organization (str), country (str), accessibility (str), training_compute_flop (float)`.
Example: `claude-opus-4-7_max,Claude Opus 4.7,2026-04-16,Claude Opus 4.7 (max),Anthropic,United States of America,API access,`

Quirks in model_metadata:
- 11 all-empty rows (`,,,,,,,`).
- 3 rows have a group but no version.
- 1 duplicated `model_version` (`deepseek-r1-0528-qwen3-8b`, dated 2025-05-28 and 2025-05-29).
- Trailing spaces in `Llama-2-70b-hf ` and `Chat-UniVi-7B-v1.5 `.
- Provider-prefixed versions: `chutes/…`, `deepinfra/…`, `fireworks/…`, `qwen/…`, `deepseek/…`, `/HFEndpoint/…`.
- OpenAI codenames: `alpine-alpha*`, `galapagos-*alpha*` and `robin-alpha-*` map to group `ChatGPT Latest`.

Epoch's own loader (`eci-public/src/eci/dataloader.py`) works like this: it multiplies the score by `scale`, normalizes with `(x - random_baseline)/(score_ceiling - random_baseline)`, clips to [0,1], maps versions to groups, drops dates before 2023-01-01, and takes the **max per (group, benchmark)**. That is a sensible default for the "per model" step.

---

## epoch-terminalbench

**URL:** inside `https://epoch.ai/data/benchmark_data.zip` -> `terminalbench_external.csv` (65,736 bytes; 204 records, 298 physical lines). There is no standalone URL; you have to download the whole zip (2.4 MB).

**Fields:**

| Column | Type | Notes |
|---|---|---|
| `Model version` | str | 59 distinct, 2 blank. |
| `Agent` | str | Scaffold or agent name (Terminus 2, Codex CLI, Claude Code, Droid, ForgeCode ...). **This distinguishes rows for the same model.** |
| `Accuracy mean` | float | **Fraction 0-1.** Min 0.0307, max 0.8472. |
| `Release date` | date | Model release date. 2025-06-17 to 2026-04-23. |
| `Organization`, `Country` | str | 6 blank (2 unlinked rows plus 4 `grok-code-fast-1` rows). |
| `Training compute (FLOP)`, `Training compute notes` | float, str |  |
| `Accuracy SE` | float | Fraction. 9 blank. |
| `Agent Org` | str | Developer of the agent. |
| `Model Org` | str | Leaderboard-supplied org with inconsistent spelling: `OpenAI`, `Google`, `Moonshot AI`, `Kimi`, `Z-AI`, `Z.ai`, `Minimax`, `minimax`, `Qwen`, `Multiple`. Don't use it; use `Organization`. |
| `Run date` | date | Leaderboard submission date. Equals `Release date` in 122/204 rows, so it is a placeholder when unknown. |
| `Notes` | str | 3 rows filled (effort assumptions). |
| `Source` | str | A URL `https://www.tbench.ai/leaderboard/terminal-bench/2.0` (135 rows) or the text `Terminal-Bench v2 Leaderboard` (64). |
| `Source Link` | str | Mostly blank. |
| `Created` | ISO timestamp | Airtable creation time. 2025-11-18 to 2026-06-22. |
| `Name` | str | Display name. 64 blank. |
| `id` | str | Airtable `rec…` id. |

**Example row:** `claude-opus-4-7_unknown,WOZCODE,0.8022471910110001,2026-04-16,Anthropic,United States of America,,,0.021123213002000003,WOZCODE,Anthropic,2026-04-16,,https://www.tbench.ai/leaderboard/terminal-bench/2.0,,2026-05-28T16:41:48.000Z,Claude Opus 4.7,rec1OgwoZk8uGh0cf`

**Max score row:** `gpt-5.5_unknown` with agent **NexAU-AHE** (Agent Org `china-qijizhifeng`): 0.8472, released 2026-04-23. Other top models (best agent each): gpt-5.4 0.818, claude-opus-4-7 0.802, gemini-3.1-pro-preview 0.802, claude-opus-4-6 0.798, gpt-5.3-codex 0.784.

**Orgs:** OpenAI 76, Anthropic 54, Google DeepMind 33, xAI 8, MiniMax 7, Alibaba 7, Moonshot 7, blank 6, Z.ai (Zhipu AI) 3, `Z.ai (Zhipu AI),Tsinghua University` 2, DeepSeek 1.

**Versioning:** All rows are **Terminal-Bench 2.0**. Every non-blank `Source` points at the 2.0 leaderboard or says "v2". There is no version column, no 1.0 rows and nothing called "4.0". benchmark_metadata calls it just "Terminal Bench" (release_date 2025-05-19, which is TB 1.0's date, even though the data is 2.0).

**Duplicates per model:** 43 of 59 versions have more than 1 row. The worst is `claude-opus-4-6_unknown` with 11 agents. `Agent` is what distinguishes them, but:
- **There are two import batches.** 55 rows have whitespace-padded values (`" Mini-SWE-Agent "`, `" Princeton "`, `" xAI         "`) and 3-decimal scores (`0.258`), with `Source = "Terminal-Bench v2 Leaderboard"` and `Name` blank. The other rows have full-precision scores and a URL `Source`. Several (model, agent) pairs appear in **both** batches (e.g. `grok-code-fast-1` + Mini-SWE-Agent: 0.258427 and 0.258), so **after `.strip()` there are 21 duplicated (model, agent) pairs.**
- Agent spellings also vary: `Forge Code` vs `ForgeCode`.
- The same model can appear under different slugs: `claude-opus-4-6` vs `claude-opus-4-6_unknown`, and `gpt-5-2025-08-07_medium` vs `_unknown`. They all join to the same `model_group`.
- Recommendation: strip whitespace, join to `model_group`, take max (or the best agent) per group, the same rule Epoch uses.

**Date semantics:** Use `Release date` (the model) for the monthly series. `Run date` and `Created` are unreliable as eval dates.

**Staleness:** The newest model is 2026-04-23 (GPT-5.5) and the last `Created` is 2026-06-22. Nothing from the May-Sep 2026 model releases is here.

**Rate limit/auth:** Same as the zip: none, Cloudflare, ETag/304. **Licence:** the rows are scraped from the Terminal-Bench leaderboard (tbench.ai), so they fall under Epoch's "external data retains its original licensing" clause. Epoch's compilation is CC BY 4.0. Credit both.

---

## epoch-metr

**URL:** zip -> `metr_time_horizons_external.csv` (18,950 bytes; 49 records).

| Column | Type | Notes |
|---|---|---|
| `Model version` | str | 46 distinct, none blank. |
| `Time horizon` | float | **50% time horizon in MINUTES.** gpt2-xl 0.054 min, GPT-4-0314 5.4 min, Mythos 1044.8 min (about 17.4 h). |
| `average_score` | float | Fraction 0-1 (average task success). **This is the column ECI uses** (benchmark_metadata score_column). |
| `Release date` | date | Model release date. 2019-11-05 to 2026-04-07. 1 blank (`davinci-002`). |
| `Organization`, `Country`, compute cols | | |
| `CI_high`, `CI_low` | float | CI bounds of `Time horizon`, in minutes (very wide: Opus 4.6 is 319-3950). |
| `Source`, `Source link` | str | Either the METR blog URL or the text "METR - Measuring AI Ability to Complete Long Tasks". |
| `Notes` | (empty) | All blank. |
| `Time Horizon (80%)` | float | 80% horizon in minutes. Only for v1.0/v1.1 rows (23 blank). |
| `METR version` | str | `METR-Horizon-v1.1` (23), `METR-Horizon-v1.0` (3), **blank (23, the legacy/original-paper rows)**. |
| `id` | str | Airtable id. |

**Example row:** `gpt-5.3-codex,349.530732,0.745439,2026-02-05,OpenAI,United States of America,,,858.325814,192.048863,,,,54.739407,METR-Horizon-v1.1,recLuqsMcBzVzYHTQ`

**Max row:** `claude-mythos-preview-early` (group Claude Mythos Preview, Anthropic, 2026-04-07). Time horizon 1044.78 min, CI [508.9, 3304.3], 80% horizon 185.9 min, v1.1.

**Orgs:** OpenAI 23, Anthropic 15, DeepSeek 4, Google DeepMind 3, Alibaba 2, Moonshot 1, xAI 1.

**Duplicates:** 3 versions (gpt-4-0314, gpt-4o-2024-05-13, gpt-4-turbo-2024-04-09) appear twice: once as a legacy row (blank `METR version`) and once as **v1.1**, with different values (e.g. GPT-4-0314: 5.36 legacy vs 3.99 v1.1). There are also near-duplicates through slugs: `claude-opus-4-1-20250805` (v1.1, 100.5 min) vs `claude-opus-4-1-20250805_16K` (legacy, 113.7 min); `o3-…_unknown` (v1.1) vs `o3-…_medium` (legacy).
- **Don't mix METR versions in one series.** Prefer v1.1 where it exists, and fall back to the legacy value only for models v1.1 doesn't cover.

**Date semantics:** `Release date` is the model release date. The data has no measurement date.

**Staleness:** The newest model is 2026-04-07 (Mythos Preview). Nothing from METR after about April 2026 is here.

**Licence:** METR's published results under Epoch's external-data clause. Credit METR and Epoch.

---

## epoch-vending

**URL:** zip -> `vending_bench_2_external.csv` (10,623 bytes; 66 records; 9 columns, the smallest layout).

| Column | Type | Notes |
|---|---|---|
| `Model version` | str | 66 distinct, one row per version. |
| `Score` | float | **Final money balance in USD** (Vending-Bench 2 by Andon Labs; agents start with $500). Range **-31.18 to 15,514.70**. Can be **negative**. It is not a fraction. benchmark_metadata has no score_column or scale for it (`in_eci = False`), so the unit is inferred from the benchmark's definition and the value range. |
| `Release date` | date | 2025-06-17 to 2026-09-30. |
| `Organization`, `Country`, compute cols | | |
| `Name` | str | Display name, sometimes with effort: `Claude Fable 5 - High`, `Claude Opus 4.8 - Max`, `Kimi K3 (Moonshot)`. |
| `id` | str | Airtable id. |

**Example row:** `claude-opus-5-5_unknown,9235.248333333331,2026-09-22,Anthropic,United States of America,,,Claude Opus 5.5,recBWEIN3JLagof2u`

**Max row:** `gpt-6-astra_unknown` (GPT-6 Astra, OpenAI, 2026-09-03): $15,514.70. Next: gpt-6-sol 14,427.85; gemini-4-argon 13,718.16; claude-opus-5 11,181.87; claude-opus-4-7 10,936.76; grok-4.7 10,536.83.

**Orgs:** Anthropic 17, OpenAI 12, Google DeepMind 9, Alibaba 7, xAI 6, Z.ai 5, Moonshot 4, MiniMax 3, DeepSeek 2, Meta AI 1 (muse-spark-1.1).

**Duplicates:** None per version, but **several per group**:
- `claude-fable-5` appears with 5 effort variants (none/low/medium/high/max: 4,530 / 5,019 / 4,340 / 5,680 / 4,967).
- `claude-opus-4-8_max` 2,992 vs `_unknown` ("High") 5,787. Higher effort is not always better.
- `gemini-3.1-pro-preview` 911 vs `gemini-3.1-pro-preview-customtools` 3,774.

**Surprise:** It is very noisy. Several models score below 0 (gpt-5-mini -31, MiniMax-M2.5 -23, gpt-oss-120b -22, Qwen3-235B-Thinking -11). Max per group is reasonable. For a "strength" score, consider a log transform or rank, not the raw dollars.

**Licence:** Andon Labs results under the external-data clause. Credit Andon Labs and Epoch.

---

## epoch-apex

**URL:** zip -> `apex_agents_external.csv` (8,941 bytes; 52 records).

| Column | Type | Notes |
|---|---|---|
| `Model version` | str | 52 distinct, one row each. |
| `Pass@1 score` | float | **Fraction 0-1.** 0.044 to 0.822. This is the ECI score column. |
| `Release date` | date | 2025-08-05 to 2026-09-30. |
| `Organization`, `Country`, compute cols | | |
| `Name` | str | Display name. **Inconsistent**: `Opus 5.5 [claude-opus-5-5]`, `Opus 5.5 [opus-5.5]`, `Sonnet 5.5 (Medium)`, `Fable 5.1 (High)`, and Claude names often lack the word "Claude". |
| `Pass@1 Standard Error` | float | **PERCENTAGE POINTS** (e.g. 4.4), while the score is a fraction. Watch the unit mismatch. |
| `Mean score` | float | Fraction 0-1 (partial credit). |
| `Mean Standard Error` | float | Percentage points. |
| `Notes` | (empty) | All blank. |
| `id` | str | Airtable id. |

**Example row:** `claude-opus-5-5_max,0.735,2026-09-22,Anthropic,United States of America,,,Opus 5.5 [claude-opus-5-5],4.9,0.813,4.0,,rec6TErVzXnuNRUoV`

**Max row:** `gemini-4-argon_unknown` (Gemini 4 Argon, Google DeepMind, **2026-09-30**): 0.822. Next: claude-sonnet-5-5_max 0.755 and claude-opus-5-5_max 0.735.

**Orgs:** Anthropic 13, OpenAI 10, Google DeepMind 7, Z.ai 4, xAI 3, Alibaba 3, Meta AI 3 (Muse Spark), DeepSeek 3, Moonshot 2, Xiaomi Corp 1, MiniMax 1, Thinking Machines 1, Nvidia 1.

**Duplicates:** One row per version, but some groups have several efforts: Claude Opus 5.5 `_max` 0.735 vs `_medium` 0.525, Sonnet 5.5 `_max` 0.755 vs `_medium` 0.446, Fable 5.1 `_unknown` 0.686 vs `_high` 0.597. Odd slug suffix: `gpt-5.6-sol_promax`.

**Licence:** Mercor's APEX-Agents leaderboard under the external-data clause.

---

## epoch-swebench

**URL:** zip -> `swe_bench_verified.csv` (16,671 bytes; 35 records). This is an **Epoch-run** eval (Inspect logs), not scraped from swebench.com.

| Column | Type | Notes |
|---|---|---|
| `Model version` | str | 33 distinct. |
| `mean_score` | float | Fraction 0-1. |
| `Best score (across scorers)` | float | Fraction 0-1. Identical to `mean_score` in all 35 rows. This is the ECI score column. |
| `Release date` | date | Model release date. 2024-11-20 to 2026-06-16. |
| `Organization`, `Country`, compute cols | | |
| `stderr` | float | Fraction. |
| `Log viewer`, `Logs` | URL | logs.epoch.ai inspect viewer and S3 `.eval` file. 1 blank each. |
| `Started at` | ISO timestamp | **Eval run time.** 2026-02-01 to 2026-06-25. |
| `id` | str | Inspect log id. |

**Example row:** `claude-opus-4-7_max,0.8347107438016529,0.8347107438016529,2026-04-16,Anthropic,United States of America,,,0.016901169179529604,https://logs.epoch.ai/inspect-viewer/36231d6d/viewer.html?log_file=https%3A%2F%2Flogs.epoch.ai%2Finspect_ai_logs%2FnCmGWWMBip2s9AVEZNYXDX.eval,https://epoch-benchmarks-staging-public.s3.us-east-2.amazonaws.com/inspect_ai_logs/nCmGWWMBip2s9AVEZNYXDX.eval,2026-04-20T13:16:09.316Z,nCmGWWMBip2s9AVEZNYXDX`

**Max row:** `claude-opus-4-7_max` (Anthropic, 2026-04-16): 0.8347. Next: gpt-5.5-pre-release_xhigh 0.806, gemini-3.5-flash_high 0.793, glm-5.2_max 0.787, claude-opus-4-6 0.787.

**Orgs:** OpenAI 12, Anthropic 9, Google DeepMind 5, Z.ai 3, Alibaba 3, Moonshot 2, DeepSeek 1.

**Duplicates:** `gpt-5.1-2025-11-13_high` (0.680 and 0.659) and `claude-opus-4-6` (0.756 and 0.787) were each run twice. `Started at` distinguishes the runs. There are also effort variants per group (gpt-5 `_medium` 0.715 vs `_high` 0.736).

**Surprise:** It is small (35 rows) and every `Started at` is 2026-02 or later. Epoch appears to have re-run SWE-bench Verified with a new harness and dropped older history: the oldest model is GPT-4o (Nov 2024) and there is no Claude 3.5 or o1. The newest model is 2026-06-16, so it is stale for Jul-Sep 2026. Don't expect long time coverage from this source.

**Licence:** Epoch-run data: CC BY 4.0 (credit Epoch AI). The benchmark itself is SWE-bench Verified (OpenAI/Princeton).

---

## epoch-osworld

**URL:** zip -> `os_world_external.csv` (9,434 bytes; 58 records). This is the original OSWorld.

| Column | Type | Notes |
|---|---|---|
| `Model version` | str | **37 of 58 blank.** Agent-only rows that Epoch did not link to a model (UI-TARS, OpenCUA, Doubao, agi-0 ...). Only 9 distinct versions. |
| `Score` | float | **PERCENT 0-100** (benchmark_metadata scale 0.01). 3.0 to 72.1. 1 blank (kimi-k2.5 100-step row). |
| `Release date` | date | 2024-09-19 to 2026-02-17 (only for linked rows). |
| `Organization`, `Country` | str | 40 blank (including `computer-use-preview-2025-03-11`, which is blank even in model_metadata). |
| compute cols | | |
| `Agent` | str | Leaderboard entry name, which **embeds the step budget**: `claude-sonnet-4-5-20250929 (100 steps)`, `(50 steps)`, `(15 steps)`. |
| `Source` | str | `OS World Website` (57) or `Anthropic annoucement` [sic] (1). |
| `Source link` | URL | https://os-world.github.io/ |
| `Notes (details)`, `Trajectories` | (empty) | All blank. |
| `Date added` | date | Airtable add date. 2025-07-27 to 2026-02-03. |

**Example row:** `claude-sonnet-4-5-20250929,62.9,2025-09-29,Anthropic,United States of America,,,claude-sonnet-4-5-20250929 (100 steps),OS World Website,https://os-world.github.io/,,2025-10-30,`
**Unlinked example:** `,53.9,,,,,,DeepMiner-Mano-72B (100 steps),OS World Website,https://os-world.github.io/,,2025-10-30,`

**Max row:** `claude-sonnet-4-6` with 100 steps: 72.1 (Anthropic, 2026-02-17).

**Duplicates:** Mostly 3 rows per model (15/50/100-step budgets), which you can tell apart only by parsing `Agent`. Use the max step budget or the max score.

**Staleness:** The newest model is 2026-02-17. **The successor is OSWorld 2.0:**

### epoch-osworld2 (extra; `osworld_2_external.csv`, 2,870 bytes, 16 rows)

Columns:
`Model version, Binary accuracy (fraction 0-1; ECI score col), Partial score (fraction), Reasoning (effort: max/xhigh/high/medium/low/enabled/thinking), Tool setting ("batch tool" / "batched tool" / "standard"; two spellings of the same thing), Step budget (int, all 500), Release date, Organization, Country, Training compute (FLOP), Training compute notes, Name, Model family (Claude/GPT/MiniMax/Kimi/Qwen), Estimated cost (USD), Source (https://osworld-v2.xlang.ai/), Notes`

Example:
`gpt-5.6-sol_max,0.27340000000000003,0.6272,max,batch tool,500,2026-07-09,OpenAI,United States of America,,,GPT-5.6 Sol (max),GPT,,https://osworld-v2.xlang.ai/,`

Contents:
- Max: `claude-opus-5_max` 0.3143 (2026-07-24).
- Model release dates range from 2026-02-17 to 2026-07-24.
- Orgs: Anthropic 11, OpenAI 2, MiniMax/Moonshot/Alibaba 1 each.
- Duplicates: `claude-opus-4-8_max` and `claude-opus-4-7_max` each appear twice ("batched tool" vs "standard").
- No Gemini, Grok, DeepSeek or Llama rows.
- This is the only file with a `Model family` column.

**Licence (both):** the OSWorld leaderboards (xlang.ai) under the external-data clause.

---

## Licence (all Epoch sources)

- epoch.ai/benchmarks, the "How is the data licensed?" FAQ, and /benchmarks/use-this-data#licensing all say: "Epoch AI's data is free to use, distribute, and reproduce provided the source and authors are credited under the Creative Commons Attribution license." The link is https://creativecommons.org/licenses/by/4.0/ (**CC BY 4.0**). The same page continues: "Benchmark questions and answers are the property of their respective creators. This hub also includes data sourced from external projects, which retains its original licensing. Users are responsible for complying with the license terms of the specific data they use, and should credit the original sources as indicated."
- The zip's `README.md` has the same CC-BY sentence plus the citation "Epoch AI, 'Capabilities & benchmarking'. Published online at epoch.ai. Retrieved from 'https://epoch.ai/benchmarks' [online resource]." and a BibTeX key `EpochLLMBenchmarkingHub2024`.
- Verdict:
  - `epoch-eci` and `epoch-swebench` (Epoch-run): CC BY 4.0, attribute Epoch AI.
  - `*_external` sources (terminalbench, metr, vending, apex, osworld): redistribution through Epoch is allowed and Epoch's compilation is CC BY, but credit the original leaderboard as well (Terminal-Bench, METR, Andon Labs, Mercor APEX, OSWorld/xlang). Their own terms nominally apply.
  - The fixtures are small excerpts with attribution, so they are low risk.
- Rate limits/auth for all: none observed. Cloudflare-fronted, no auth. Use ETag `If-None-Match` (304 confirmed) to poll for changes daily. **Download the zip once per run and extract all 6 benchmark CSVs from it.**

---

## Fixtures written

All fixtures are written with raw-record slicing: the original header and the selected original records are copied byte-for-byte, so quoting, float repr, embedded newlines and LF endings are unchanged. For each fixture, the script checked that pandas parses it to exactly the same values (string and typed) as the same rows in the source.

| Fixture | Source file | Rows kept / total | Bytes | Families covered | Release-date span |
|---|---|---|---:|---|---|
| `epoch-eci/sample.csv` | eci_scores.csv | 57 / 274 | 7,384 | Gemini 9, GPT 7, Claude 6, Llama 5, Qwen 5, DeepSeek 5, Grok 4, Mistral 3, Other 13 | 2023-02-24 .. 2026-09-29 |
| `epoch-terminalbench/sample.csv` | terminalbench_external.csv | 46 / 204 | 15,321 | Gemini 11, Claude 10, Grok 7, GPT 5, Qwen 5, DeepSeek 1, Other 7 | 2025-06-17 .. 2026-04-23 |
| `epoch-metr/sample.csv` | metr_time_horizons_external.csv | 27 / 49 | 11,556 | GPT 11, Claude 5, DeepSeek 4, Gemini 3, Qwen 2, Grok 1, Other 1 | 2019-11-05 .. 2026-04-07 |
| `epoch-vending/sample.csv` | vending_bench_2_external.csv | 32 / 66 | 5,556 | Claude 8, GPT 5, Gemini 4, Grok 4, Qwen 4, DeepSeek 2, Meta (Muse) 1, Other 4 | 2025-06-17 .. 2026-09-30 |
| `epoch-apex/sample.csv` | apex_agents_external.csv | 35 / 52 | 6,921 | Claude 8, GPT 5, Gemini 3, Grok 3, Qwen 3, Meta (Muse) 3, DeepSeek 3, Other 7 | 2025-08-05 .. 2026-09-30 |
| `epoch-swebench/sample.csv` | swe_bench_verified.csv | 23 / 35 | 11,279 | GPT 6, Claude 5, Gemini 4, Qwen 3, DeepSeek 1, Other 4 | 2024-11-20 .. 2026-06-16 |
| `epoch-osworld/sample.csv` | os_world_external.csv | 19 / 58 | 4,783 | Claude 7, GPT 3, Qwen 2, Other/unlinked 7 | 2024-09-19 .. 2026-02-17 |
| `epoch-osworld2/sample.csv` (extra) | osworld_2_external.csv | 16 / 16 (whole file) | 2,870 | Claude 11, GPT 2, Qwen 1, Other 2 | 2026-02-17 .. 2026-07-24 |
| `epoch-models/sample.csv` (join table) | model_metadata.csv | 170 / 1139 | 18,550 | every `Model version` in the fixtures above, plus one version for each remaining ECI group in the eci sample, plus quirk rows | - |
| `epoch-models/benchmark_metadata.csv` | benchmark_metadata.csv | 88 / 88 (verbatim copy) | 6,271 | score_column / scale / baselines for every benchmark | - |

(Root: `C:\Users\dahli\Documents\GitHub\EVAL\pipeline\test\fixtures\`.)

Edge cases deliberately included:
- ECI: both anchors with empty CIs, blank-org rows, multi-org quoted values, a DeepSeek R1 distill, Gemma, Muse Spark, gpt-oss, o3.
- TB: the 2 unlinked rows, the full `gemini-2.5-pro` and `grok-code-fast-1` duplicate groups including whitespace-padded batch rows, the `_128K` slug, `deepseek/` prefix.
- METR: legacy vs v1.1 duplicate pairs, v1.0 rows, the blank-date `davinci-002`, Mythos.
- Vending: negative scores, the 5 Fable-5 effort variants, a multi-line quoted notes field.
- SWE: repeated runs.
- OSWorld: step-budget triplet, blank score, unlinked agents.
- models: the all-empty row, the duplicated version, a trailing-space version, provider prefixes, OpenAI codenames.

In the family counts above, "Meta (Muse)" means rows classified as Meta by org fallback. They are Muse Spark, not Llama.

---

## Family patterns (epoch)

**Recommended algorithm:**
1. Join `Model version` to `model_metadata.model_group` and classify the **group name**. Fall back to the slug if the join fails.
2. Strip provider prefixes `^(?:/?[A-Za-z0-9_.-]+/)+` (handles `chutes/`, `deepinfra/`, `fireworks/`, `accounts/fireworks/models/`, `qwen/`, `Qwen/`, `deepseek/`, `/HFEndpoint/`).
3. Strip the effort/budget suffix `_(?:unknown|none|minimal|low|medium|high|xhigh|max|pro(?:max|xhigh|unknown)|thinking|enabled|\d+[kK])$`.
4. Apply an exclusion regex first, then the family regexes in order Claude, Gemini, Grok, DeepSeek, Qwen, Llama, Mistral, GPT (GPT is last because its o-series pattern is the loosest).
5. Use `Organization` (split on `,`) only as a fallback when the name matches nothing.

I tested this on all names in ECI, model_metadata (versions and groups), and the 7 target files. **No name regex hit contradicted the org.** Every mismatch was one of two kinds:
- Name unmatched but org set: Gemma, Muse Spark, OPT, codenames, distills.
- Name matched but org blank: old Qwen/DeepSeek rows, grok-code-fast-1, computer-use-preview.

```python
EXCLUDE = r'(?i)(?:distill|cerebras-gpt|gpt-j|gpt-neo|sharegpt|llava|videollama|videochat|vilamp|nemotron|hermes|tulu|dracarys|slime|open_llama|phi-)'
FAMILY = {
 'Claude':   r'(?i)\bclaude\b',            # + for display names lacking "Claude" (APEX Name): r'(?i)^(?:opus|sonnet|haiku|fable|mythos)\b'
 'Gemini':   r'(?i)\bgemini\b',            # Gemma is separate: r'(?i)\bgemma\b' (org Google DeepMind)
 'Grok':     r'(?i)\bgrok\b',
 'DeepSeek': r'(?i)\bdeepseek',
 'Qwen':     r'(?i)(?:\bqwen|\bqwq\b|\bqvq\b|codeqwen)',
 'Llama':    r'(?i)\bllama(?![a-z])',
 'Mistral':  r'(?i)\b(?:mistral|mixtral|magistral|ministral|devstral|codestral|pixtral)\b',
 'GPT':      r'(?i)(?<![a-z0-9])(?:(?:chat)?gpt-?(?:[1-9]|oss)|o[1-4](?![0-9a-z.])|(?:text-|code-)?davinci|computer-use-preview|instructgpt)',
}
```
(The tested implementation is `scratchpad/recon-llm/epoch/scripts/families.py`.)

| Family | Org values seen | Model-name patterns seen (slug `Model version` / group or display name) | Gotchas |
|---|---|---|---|
| **GPT** | `OpenAI` (ECI 46; TB 76). ECI blank for none. | Slugs: `gpt-4-0314`, `gpt-4o-2024-05-13`, `gpt-4.1-2025-04-14`, `gpt-5-2025-08-07_medium`, `gpt-5.1-2025-11-13_high`, `gpt-5.4-2026-03-05_xhigh`, `gpt-5.5_unknown`, `gpt-5.5-pre-release_xhigh`, `gpt-5.6-sol_promax`, `gpt-6-astra_unknown`, `gpt-6.1-sol_max`, `gpt-5.3-codex`, `gpt-5.1-codex-max`, `gpt-oss-120b`, `o1-2024-12-17_high`, `o3-2025-04-16_medium`, `o4-mini-2025-04-16_medium`, `davinci-002`, `gpt2-xl`, `computer-use-preview-2025-03-11`. Groups: `GPT-4o (Nov 2024)`, `GPT-5`, `GPT-5.4 Pro`, `GPT-5.6 Sol/Terra/Luna`, `GPT-6 Astra/Sol/Luna`, `GPT-6.1 Sol`, `o3`, `o3-pro`, `gpt-oss-120b`, `ChatGPT Latest`. | Codename slugs (`alpine-alpha*`, `galapagos-*`, `robin-alpha-*`) need the org fallback. Non-GPT OpenAI items: `text-embedding-3-*`, `CUA`, `Codex` (`code-cushman-002`). Non-OpenAI "GPT" names: Cerebras-GPT, GPT-J, GPT-Neo(X) (EleutherAI). `computer-use-preview` has a blank org. Decide whether the `gpt-oss` (open weights) and o-series lines count as GPT. |
| **Claude** | `Anthropic` only | Slugs: `claude-3-5-sonnet-20241022`, `claude-3-7-sonnet-20250219_16K`, `claude-opus-4-1-20250805_unknown`, `claude-opus-4-5-20251101_128K`, `claude-opus-4-6`, `claude-opus-4-7_max`, `claude-fable-5-1_high`, `claude-sonnet-5-5_max`, `claude-mythos-preview-early`. Groups: `Claude 3.5 Sonnet (October 2024)`, `Claude Opus 4.6`, `Claude Fable 5.1`, `Claude Mythos Preview`. | APEX `Name` drops "Claude" (`Opus 5.5 [claude-opus-5-5]`, `Fable 5`), so classify on the slug. Older slug style is `claude-3-5-…`; newer is `claude-opus-4-6` (no date), with `-` instead of `.` in versions (`claude-fable-5-1` = Fable 5.1). Internal codenames `claude-strudel-v*-p` exist in model_metadata. |
| **Gemini** | `Google DeepMind` (main), `Google` (Gemini 3.1 Flash-Lite), `Google DeepMind,Google` (Gemini 2.0 Flash rows), `DeepMind`/`Google` for pre-Gemini models (Chinchilla, Gopher, PaLM, T5, GLaM) | Slugs: `gemini-2.5-pro`, `gemini-2.5-pro-preview-06-05`, `gemini-3-pro-preview`, `gemini-3.1-pro-preview-customtools`, `gemini-3.5-flash_high`, `gemini-3.8-flash_unknown`, `gemini-4-argon_unknown`. Groups: `Gemini 2.5 Pro (Jun 2025)`, `Gemini 3 Pro`, `Gemini 3.5 Flash-Lite`, `Gemini 4 Argon`. | Gemma (`gemma-3-27b-it`, `Gemma 4 31B IT`) has the same org; keep it separate unless you want it in Gemini. Also `Gemini Robotics-ER` and `AI Co-Mathematician`. Use the org-agnostic regex. |
| **Grok** | `xAI` (blank for `grok-code-fast-1` in TB) | Slugs: `grok-4-0709`, `grok-4-20`, `grok-4.20-0309-reasoning`, `grok-4-1-fast-reasoning`, `grok-4.3_unknown`, `grok-4.6_unknown`, `grok-4.7_unknown`, `grok-code-fast-1`, `grok-build-0.1`. Groups: `Grok-2 (Dec 2024)`, `Grok-3 mini`, `Grok 4.20`, `Grok 4.3 Beta`, `Grok 4.7`. | Both `-` and `.` are used as the version separator (`grok-4-20` vs `grok-4.20-…`). |
| **DeepSeek** | `DeepSeek`, `DeepSeek,Peking University`, `DeepSeek,Tsinghua University,Peking University`. Blank for some old coder models. | Slugs: `DeepSeek-V3`, `DeepSeek-V3-0324`, `DeepSeek-R1`, `DeepSeek-R1-0528`, `DeepSeek-V3.2-Exp_unknown`, `deepseek/deepseek-v3.2`, `deepseek-v4-pro_max`, `deepseek-v4-pro-0813_unknown`, `deepseek-v4.1-flash_unknown`. Groups: `DeepSeek-R1 (May 2025)`, `DeepSeek-V4-Pro`, `DeepSeek V4 Pro 0813`, `DeepSeek V4.1 Flash`. | `DeepSeek-R1-Distill-Qwen-*` and `-Distill-Llama-*` have org DeepSeek but Qwen/Llama in the name. Exclude them or assign by org (the regex above excludes them). Both CamelCase and lowercase slugs occur. |
| **Qwen** | `Alibaba`. **Blank** for several old Qwen rows in ECI (Qwen2.5-Coder 0.5B/3B/14B, CodeQwen1.5-7B, Qwen-1_8B). | Slugs: `qwen2-72b-instruct`, `qwen2.5-72b-instruct`, `Qwen3-235B-A22B-Thinking-2507`, `Qwen3-Coder-480B-A35B-Instruct`, `qwen3-max-2025-09-23`, `qwen3.5-plus`, `qwen3.5-397b-a17b`, `qwen3.6-max-preview`, `qwen3.7-max`, `qwen3.8-max_unknown`, `qwen3.8-27b`, `qwen3.6-35b-a3b`. Groups: `Qwen3.7-Max`, `Qwen 3.8 Max`, `Qwen3.8 Max (0902)`, `Qwen 3.5 Plus (hosted 397B-A17B)`, `QwQ-32B`. | Spacing is inconsistent (`Qwen 3.8 Max` vs `Qwen3.7-Max`). QwQ and QVQ are Qwen. OSWorld agent rows like `opencua-qwen2-7b` are fine-tunes by others and have no org, so drop unlinked rows. |
| **Llama** | `Meta AI` (plus `Nvidia,Meta AI` for Nemotron fine-tunes) | Slugs: `Llama-3.1-405B-Instruct`, `Meta-Llama-3-70B`, `Llama-4-Maverick-17B-128E-Instruct`, `llama3.1:8b-instruct-q8_0`. Groups: `LLaMA-65B`, `Llama 2-70B`, `Llama 3.1-405B`, `Llama 3.3 70B`, `Llama 4 Maverick`, `Llama 4 Scout`. | **No Llama in any of the 6 benchmark files.** Meta's 2026 entries are `muse-spark`, `muse-spark-1.1/1.2/1.3`, `muse-glimmer` (org Meta AI) in ECI, Vending and APEX. Decide whether the family is "Llama" or "Meta" (`Llama|Muse`). The newest Llama in ECI is Llama 4 Maverick (2025-04-06). Exclude Llama fine-tunes by others (Nemotron, Hermes, Tulu, DeepSeek-R1-Distill-Llama). |
| **Mistral** | `Mistral AI` (`Mistral AI,All Hands AI` for Devstral). Blank for `mistral-small-2402`. | Slugs: `Mistral-7B-v0.1`, `Mixtral-8x22B-v0.1`, `mistral-large-2411`, `mistral-medium-2505`, `mistral-medium-2604`, `magistral-small-2509`, `devstral-small-2512`, `codestral-2508`. Groups: `Mistral 7B v0.1`, `Mixtral 8x7B`, `Mistral Large 2 (Nov 2024)`, `Mistral Medium 3.5`, `Magistral Small 1.2`. | **No Mistral rows in any of the 6 benchmark files.** Only ECI has them (16 models; newest Mistral Medium 3.5, 2026-04-28). Slugs use date codes (`-2505` = May 2025). Exclude `llava-v1.6-mistral-7b` and `video_chat2_mistral`. |

Per-family coverage of the target benchmark files (rows): `-` means no rows, and `+` marks blank-org rows that the name regex picks up.

| Family | ECI | TB | METR | Vending | APEX | SWE | OSW v1 | OSW 2 |
|---|---|---|---|---|---|---|---|---|
| GPT | 46 | 76 | 23 | 12 | 10 | 12 | 3 (+3 computer-use-preview) | 2 |
| Claude | 26 | 54 | 15 | 17 | 13 | 9 | 11 | 11 |
| Gemini | 31 Gemini/Gemma + 4 Google | 33 | 3 | 9 | 7 | 5 | - | - |
| Grok | 10 | 8 (+4 grok-code-fast-1) | 1 | 6 | 3 | - | - | - |
| DeepSeek | 16 (+3 `DeepSeek,Peking University`, +1 blank) | 1 | 4 | 2 | 3 | 1 | - | - |
| Qwen | 37 (+5 blank) | 7 | 2 | 7 | 3 | 3 | 2 | 1 |
| Llama (Meta) | 22 (18 Llama + 4 Muse) | - | - | 1 Muse | 3 Muse | - | - | - |
| Mistral | 16 | - | - | - | - | - | - | - |

(Counts are by `Organization`, except the `+` items.)
