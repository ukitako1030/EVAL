# Recon: arena-legacy (old Chatbot Arena HF Space pickles)

Recon date: 2026-10-08. Goal: monthly overall text-arena ratings for 2023-05 to 2025-08 that include the models that were on the board at the time. The current dataset `lmarena-ai/leaderboard-dataset` drops these models (survivorship bias).

**Verdict: usable.** It fixes the survivorship gap for 2023-05 to 2025-07. Converter: `pipeline/scripts/import_arena_legacy.py`. Output: `pipeline/raw/arena-legacy/2026-10-08.json` (28 months, 3,503 rows, 297 distinct models, 483 KiB).

## 1. Location and files

- Both `lmsys/chatbot-arena-leaderboard` and `lmarena-ai/chatbot-arena-leaderboard` return **307** and redirect to **`lmarena-ai/arena-leaderboard`**.
- The Space is now `sdk: static`. Its `index.html` is just an iframe to `https://lmarena.ai/leaderboard`, so `app.py` no longer runs. The data files are still in the repo.
  - Created 2023-05-20.
  - Last data commit: 2025-09-03, "add data for August 2025 (#82)".
  - HEAD `6f2eeeba09bf42144dbc118fe1a8e12e4c533f9d`, last modified 2026-02-21 (README edit).
  - The converter pins this sha.
- File list: `GET https://huggingface.co/api/spaces/lmarena-ai/arena-leaderboard/tree/main?recursive=true` returns 273 files, all at the repo root, in one page (no `Link` header). Download URL: `https://huggingface.co/spaces/lmarena-ai/arena-leaderboard/resolve/<rev>/<file>`.
- **136 `elo_results_YYYYMMDD.pkl`** files, 2023-05-08 to 2025-08-29, 459.5 MB in total. Size per file:

  | Period | Size per file |
  |---|---|
  | 2023 | 26–44 KB |
  | 2024 | 0.1–5 MB |
  | 2025-01 to 2025-05 | 6–10 MB |
  | 2025-06 onward | about 2 MB |

  Files per month:

  | Year | Months (files) |
  |---|---|
  | 2023 | 05:2, 06:1, 07:1, 08:1, 09:1, 10:1, 11:2, 12:3 |
  | 2024 | 01:3, 02:2, 03:5, 04:9, 05:7, 06:8, 07:7, 08:8, 09:4, 10:4, 11:6, 12:7 |
  | 2025 | 01:7, 02:9, 03:8, 04:5, 05:6, 06:7, 07:6, 08:6 |

  Every month from 2023-05 to 2025-08 has at least one file.
- **129 `leaderboard_table_YYYYMMDD.csv`** files, 2023-06-19 to 2025-08-04, 3.0 MB in total. Mostly one per pickle date. 2025-08 has only 0801 and 0804.
- Other files: `README.md`, `app.py`, `requirements.txt` (pins `plotly<=5.24.1` and FastChat), `arena_hard_auto_leaderboard_v0.1.csv`, `theme.json`, `style.css`, `index.html`.

## 2. Pickle structure

- Each pickle is a plain `dict`.
- The plotly `Figure` and `SubplotRef` objects inside are only charts. **plotly is not needed**: the converter's restricted unpickler replaces them with inert stubs.
- pandas 2.2.3 and numpy 2.2.3 (system Python 3.13) load every pickle. The `numpy.core` paths only produce deprecation warnings.

| Period (month-end files) | Layout | Overall board used by the converter |
|---|---|---|
| 2023-05-08 to 2023-11-16 | flat: `elo_rating_online` (dict), `elo_rating_median` (dict of int), `leaderboard_table` (markdown string), 4 Figures, `last_updated_datetime` | `elo_rating_median` (bootstrap median, integers) |
| 2023-12-20 | flat + `rating_system='bt'`, `elo_rating_final` (Bradley-Terry) | `elo_rating_final` |
| 2024-01-25 to 2024-02-15 | flat + `bootstrap_df`, `leaderboard_table_df` | `leaderboard_table_df.rating` |
| 2024-03-27 to 2024-05-27 | categories at top level: `full`, `english`, `chinese`, `coding`, … (2024-05/06 also `full_old`) | `full.leaderboard_table_df.rating` |
| 2024-06-29 to 2025-08-29 | `{'text': {...}, 'vision': …, 'image': …}`; 2025-08 adds `image-edit` and `webdev` | `text.full.leaderboard_table_df.rating` |

`leaderboard_table_df`:
- It is indexed by **model key**, for example `claude-2.0`, `gemini-2.5-pro-exp-03-25`, `bard-jan-24-gemini-pro`.
- Columns: `rating, variance, rating_q975, rating_q025, num_battles, final_ranking`. From 2025-06, `rating_q*` becomes `rating_upper` / `rating_lower`.
- `elo_rating_final` duplicates `rating` until about 2025-05 and is absent afterwards.

Style control:
- `full_style_control` (and `<cat>_style_control`) exists under `text` from 2024-08-28.
- Number of style-controlled boards among the text categories:

  | File | Style-controlled / all |
  |---|---|
  | 2024-08 | 2 / 21 |
  | 2025-04 | 8 / 28 |
  | 2025-06 onward | 20 / 40 (every category has a twin) |

- Before 2024-08 only the non-style-controlled board exists, so the converter always uses `full`.

The old UI (FastChat `monitor.py`) showed `full` as "Overall". It filtered `num_battles > 300` and by default hid a hard-coded `deprecated_model_name` list. The converter applies the same >300-vote filter. It removed nothing in any month-end file. It keeps deprecated models: the current deprecated list (claude-1/2.x, bard-jan-24, …) would wrongly remove them from the months when they were live.

### Validation against what the UI showed and against the current HF dataset

- **2023 files:** the converter's value matches the `leaderboard_table` markdown that was displayed, for every model, from 2023-06 to 2023-12.
  - Exception: **2023-05-08 and 2023-05-22 displayed `elo_rating_online`**. The converter still uses `elo_rating_median` there, for consistency with June–Nov and with the HF dataset.
- **Against `lmarena-ai/leaderboard-dataset` `text/full`, category `overall`, on the same publish dates:**
  - 0 models are in HF but not in legacy, so HF is a strict subset.
  - Shared models match within 0.05 (rounding) on every month-end date except two:
    - **2023-12-20:** HF used `elo_rating_online` (max difference 88). Legacy uses `elo_rating_final` (BT), which matches the displayed board (gpt-4-turbo 1243).
    - **2024-05-27:** HF used `full_old` (max difference 16.5). Legacy uses `full`, which is what the UI labelled "Overall".
  - HF has no 2025-08-29 date at all.

## 3. `leaderboard_table_*.csv` (model metadata)

| Period | Columns |
|---|---|
| 2023-06-19 to 2023-12-20 | `Model,MT-bench (score),Arena Elo rating,MMLU,License,Link`; display names such as `Claude-2`; **no key and no Organization** |
| 2024-01-09 | `key,Model,MT-bench (score),MMLU,License,Organization,Link` |
| 2024-01-25 onward | `key,Model,MT-bench (score),MMLU,Knowledge cutoff date,License,Organization,Link` |

- `key` = the pickle model key. `Model` = display name, for example `Gemini App (2024-01-24)` or `Claude 3.5 Sonnet (20241022)`. `Knowledge cutoff date` is often `-`.
- The 2025-08-04 CSV has 341 rows.
- Organization strings are free text and need normalising downstream: `DeepSeek` / `DeepSeek AI`, `Zhipu AI` / `Zhipu` / `Z.ai`, `AI2` / `Ai2` / `Allen AI`, the typo `Aliaba`, `Nexusflow` / `NexusFlow`.

**Org join in the converter:**
1. The CSV of the same date, or failing that the nearest earlier CSV.
2. Otherwise any downloaded CSV that has the key (newer CSVs win).
3. Otherwise `FALLBACK_ORG`, 25 hand-set keys:
   - 2023 names that were later renamed;
   - models added after 2025-08-04 (gpt-5-*, gpt-oss-*, claude-opus-4-1, deepseek-v3.1, …).

Result: 0 rows without `org`.

## 4. Survivorship fix: evidence

Number of models per month-end file:

| Date | Legacy | HF dataset | Examples present only in legacy (with ratings) |
|---|---|---|---|
| 2023-05-22 | 17 | 13 | gpt-4 1251, claude-v1 1197, claude-instant-v1 1153, gpt-3.5-turbo |
| 2023-08-02 | 25 | 20 | gpt-4, claude-1 1166, claude-instant-1, **claude-2 1135**, gpt-3.5-turbo |
| 2024-01-25 | 56 | 46 | **bard-jan-24-gemini-pro 1214.9**, claude-1 1149.5, **claude-2.0 1131.1**, claude-2.1, gpt-3.5-turbo-0613 (gemini-pro 1113.9 and gpt-3.5-turbo-0314 1104.5 are in both) |
| 2024-06-29 | 114 | 97 | gemini-1.5-pro-api-0409-preview, yi-large(-preview), reka-core-20240501, glm-4-0116 |
| 2024-12-30 | 187 | 152 | gemini-exp-1206, gemini-2.0-flash-thinking-exp-1219, chatgpt-4o-latest-20241120, gemini-exp-1114/1121 |
| 2025-04-23 | 229 | 187 | **gemini-2.5-pro-exp-03-25 1438.7 (#1)**, early-grok-3, llama-4-maverick-03-26-experimental, gemini-2.5-flash-preview-04-17 |
| 2025-07-28 | 259 | 216 | gemini-2.5-pro-preview-05-06, early-grok-3, … |
| 2025-08-29 | 242 | — | (HF has no row for this date) |

Without the legacy data, the monthly #1 is wrong for several months, for example 2024-11 (gemini-exp-1121), 2024-12 (gemini-exp-1206), 2025-01 (gemini-2.0-flash-thinking-exp-01-21), 2025-02 (early-grok-3), 2025-03/04 (gemini-2.5-pro-exp-03-25) and 2025-05 (gemini-2.5-pro-preview-05-06). In each of these months, the legacy #1 is missing from the HF dataset.

## 5. Caveats for the compute layer

- **Scale change in Dec 2023.** The rating was an online/bootstrap Elo median until 2023-11 and Bradley-Terry from 2023-12-20.
  - Values are comparable within one snapshot. Across that boundary, use only relative measures (gap to the month's leader).
  - The BT anchor also moves between snapshots: old models drift by a few points.
- **Legacy snapshots are not purely "live" models either.** Every model ever rated stays on the board with frozen votes.
  - In 2025-04, 195 of 229 rows had no meaningful vote growth since the previous month.
  - If "live at the time" matters, filter on `num_battles` growth. The converter does not emit vote counts; add them if needed.
- **The legacy data also starts pruning in its last file.** 2025-08-29 dropped 42 models compared with 2025-07-28, including bard-jan-24, claude-1/2.0/2.1/instant-1, early-grok-3 and the chatgpt-4o-latest-2024* snapshots.
  - So 2025-08 is the first legacy month with survivorship bias.
  - 2025-06 already merged `gemini-2.5-pro-exp-03-25` into `gemini-2.5-pro`.
- **Model keys change over time, so the next stage needs an alias map:**
  - `claude-v1` → `claude-1`; `claude-instant-v1` → `claude-instant-1`; `claude-2` → `claude-2.0`
  - `gpt-4` → `gpt-4-0314` (and early `gpt-3.5-turbo` is probably 0314/0301)
  - `gpt-4-turbo` (2023-11/2024-01) → `gpt-4-1106-preview`
  - `chatgpt-4o-latest` → `chatgpt-4o-latest-20240808`
  - `dbrx-instruct` → `dbrx-instruct-preview`
- The date is the pickle date: the last file of each month, for example 2023-05-22, 2024-03-27, 2025-08-29.

## 6. Converter

`pipeline/scripts/import_arena_legacy.py`

- **Requirements:** `pip install "pandas>=2.0" "numpy>=1.24"`. No plotly, no huggingface_hub; it uses only the standard library `urllib`.
- **Run:** `python pipeline/scripts/import_arena_legacy.py --date 2026-10-08`
- **Options:** `--from/--to YYYY-MM`, `--cache DIR` (default `%TEMP%/ai-war-arena-legacy-cache`, about 72 MB for 28 pickles and 23 CSVs), `--revision <sha>|main`, `--min-votes 300`, `--out-root`.
- **Idempotent:**
  - Downloads are cached and size-checked; files are written atomically.
  - Output is sorted by date, then rating descending, then model.
  - Two runs, including one from an empty cache, gave the same SHA-1 (`a956a65b…`). A fresh run takes about 1 minute.
- **Safety:** the restricted unpickler resolves only pandas/numpy/datetime/builtins container classes. Everything else becomes an inert stub, so no code from the pickle runs. The only stubbed classes seen were the two plotly ones.
- **Output format:** the `saveSnapshot` layout (one item per line, trailing newline). `value` is the rating rounded to 0.1, written as an integer when whole.

Sample output:
```
{"sourceId":"arena-legacy","date":"2026-10-08","items":[
{"series":"arena-legacy","kind":"elo","model":"gpt-4","org":"OpenAI","date":"2023-05-22","dateKind":"snapshot","value":1251},
{"series":"arena-legacy","kind":"elo","model":"claude-2","org":"Anthropic","date":"2023-08-02","dateKind":"snapshot","value":1135},
{"series":"arena-legacy","kind":"elo","model":"bard-jan-24-gemini-pro","org":"Google","date":"2024-01-25","dateKind":"snapshot","value":1214.9},
{"series":"arena-legacy","kind":"elo","model":"gpt-3.5-turbo-0314","org":"OpenAI","date":"2024-01-25","dateKind":"snapshot","value":1104.5},
{"series":"arena-legacy","kind":"elo","model":"gemini-2.5-pro-exp-03-25","org":"Google","date":"2025-04-23","dateKind":"snapshot","value":1438.7},
{"series":"arena-legacy","kind":"elo","model":"llama-13b","org":"Meta","date":"2025-08-29","dateKind":"snapshot","value":841.3}
]}
```

Month-end leaders:

| Month | Leader |
|---|---|
| 2023-05 … 2023-10 | gpt-4 |
| 2023-11 … 2024-01 | gpt-4-turbo |
| 2024-02 | gpt-4-1106-preview |
| 2024-03 | claude-3-opus-20240229 |
| 2024-04 | gpt-4-turbo-2024-04-09 |
| 2024-05 … 2024-07 | gpt-4o-2024-05-13 |
| 2024-08 | chatgpt-4o-latest |
| 2024-09 | o1-preview |
| 2024-10 | chatgpt-4o-latest-20240903 |
| 2024-11 | gemini-exp-1121 |
| 2024-12 | gemini-exp-1206 |
| 2025-01 | gemini-2.0-flash-thinking-exp-01-21 |
| 2025-02 | early-grok-3 |
| 2025-03 … 2025-04 | gemini-2.5-pro-exp-03-25 |
| 2025-05 | gemini-2.5-pro-preview-05-06 |
| 2025-06 … 2025-08 | gemini-2.5-pro |

Because the HF Space is frozen, the converter is a one-shot backfill. In the pipeline, treat it as a `full`-mode source and do not schedule it weekly.

## 7. Licence

- The Space card YAML says `license: apache-2.0`. It is the only licence statement in the repo, and the Space is public and not gated.
- FastChat, which produced these files, is also Apache-2.0.
- The current dataset `lmarena-ai/leaderboard-dataset` is CC BY 4.0 and contains the same numbers for overlapping rows.
- LMArena's website Terms of Use forbid scraping or extracting data from lmarena.ai web pages. That covers the site, not this Hugging Face repo, which we download through the Hub API.

**Verdict: OK** to store derived monthly ratings and show them on a non-commercial site, with credit. Suggested credit: "Historical ratings: LMSYS / LMArena Chatbot Arena leaderboard snapshots (HF Space lmarena-ai/arena-leaderboard, Apache-2.0); current: lmarena-ai/leaderboard-dataset (CC BY 4.0)". Apache-2.0 requires keeping the attribution/licence notice. It does not restrict commercial use either.

Residual risk: low. The Space could be deleted. The pinned sha only helps while the repo exists, so keep the committed raw JSON as the record.
