# Arena (lmarena-ai/leaderboard-dataset) recon notes

Recon date: 2026-10-08. Dataset HEAD commit `ff77a170d5ec578fe4eb8c91e0084a6b1a20beac`, `lastModified` 2026-10-08T03:02:49Z.
Local downloads: `scratchpad/recon-llm/arena/<subset>/{full,latest}-00000-of-00001.parquet`.

## Shared facts (apply to all four source IDs)

### URLs that work (all tested anonymously with curl, HTTP 200)
- Tree (recursive): `https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset/tree/main?recursive=true` (dirs + files with `size`, `lfs.oid`, `xetHash`; usable for change detection).
- Per-subset tree: `https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset/tree/main/<subset>` (no nesting: each subset folder holds exactly 2 files).
- Dataset card: `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/raw/main/README.md` (21,766 B).
- Dataset info: `https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset` (`"gated": false`, `"private": false`, tags include `license:cc-by-4.0`).
- Commits: `https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset/commits/main` (paged with `?p=N`, 50 per page).
- Files: `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/<subset>/full-00000-of-00001.parquet` and `.../latest-00000-of-00001.parquet`. `resolve` answers **302** to a signed `us.aws.cdn.hf.co/xet-bridge-us/...` URL, so `curl -L` (or fetch with redirect follow) is required. Pinned revisions also work: `.../resolve/<commit-sha>/<path>` (tested).

### Auth / rate limits
- No token needed, not gated. Anonymous responses carry `X-HF-Warning: unauthenticated` and `RateLimit-Policy: "fixed window";"resolvers";q=3000;w=300` (3000 resolve calls per 5 min, anonymous). Irrelevant at our volume (8 files).
- Each `full` parquet is rewritten in full on every update (text full = 58 MB), so poll the tree API (`oid` / `xetHash` / `size`) or the commit list before re-downloading.

### Update cadence and immutability
- Automated bot (`cthorrez-arena`) commits roughly daily at ~03:00 UTC: one commit per subset, titled `Update <subset> for <YYYY-MM-DD>`, where the date equals the new `leaderboard_publish_date` (data appears on HF the day after publication).
- History looked append-only: comparing `webdev` and `agent` `full` at commit `eeedf9209373a7f9b324bfb839e7b02fedacd1e5` (2026-08-15) with HEAD showed identical rows for every overlapping date (0 rating diffs, 0 org/license diffs, no rows added or removed). Old rows keep the metadata they had when published (org strings are not backfilled; see empty-org quirk).

### Splits
- `full` = all historical snapshots; `latest` = for each `category`, the rows of its most recent `leaderboard_publish_date` (so `latest` can contain more than one date, see webdev).

### Licence
- Card YAML line, quoted exactly: `license: cc-by-4.0`. HF tag `license:cc-by-4.0`. Verdict: **OK to ingest, store and republish derived metrics with attribution** (e.g. "Source: Arena leaderboard dataset, lmarena-ai/leaderboard-dataset on Hugging Face, CC BY 4.0"). The `license` column describes each model's licence, not the data licence.

### Column documentation from the card (Bradley-Terry arenas)
| Column | Card type | Card description |
|---|---|---|
| model_name | string | Model identifier |
| organization | string | Model creator/organization |
| license | string | Model license |
| rating | float | Arena Score |
| rating_lower | float | Lower confidence bound |
| rating_upper | float | Upper confidence bound |
| variance | float | Rating variance |
| vote_count | int | Number of battles for this model |
| rank | int | Rank within this leaderboard |
| category | string | Leaderboard category (e.g., overall, coding, math) |
| leaderboard_publish_date | string | Date that this score was published (`YYYY-MM-DD`) |

Agent Arena subsets (card): `model_name`, `organization`, `license` (string); `score` (float, IPS score, tau-hat); `score_ci_lower` / `score_ci_upper` (float, lower/upper 95% confidence bound); `observation_count` (int, signal observations for the model); `session_count` (int, distinct sessions, aggregate subset only); `rank` (int); `category` (string); `leaderboard_publish_date` (string `YYYY-MM-DD`). Actual parquet dtypes differ in places (see each section).

### Methodology notes in the card (paraphrased)
- 2024-01-09: rating system changed from Elo to Bradley-Terry.
- 2025-05-16: style control became the default for the text and vision arenas, and the style-control leaderboard's offset was adjusted onto the same scale as non-style-control.
- 2025-07-23: frequency-based re-weighting introduced.
- Search data starts 2025-08-07, Webdev (Code Arena) data starts 2025-11-12; Agent Arena data starts 2026-06-04.
- Points to the changelog `https://arena.ai/blog/leaderboard-changelog/` and the agent methodology post `https://arena.ai/blog/agent-arena-methodology/`.

### All subsets at the root (names + sizes in bytes; only the 4 in scope were downloaded)
| subset | full | latest |
|---|---|---|
| agent | 74,047 | 8,052 |
| agent_bash_recovery_steps | 64,304 | 7,614 |
| agent_praise_complaint | 63,434 | 7,598 |
| agent_steerability | 64,386 | 7,626 |
| agent_task_outcome_explicit | 64,073 | 7,612 |
| agent_tool_hallucination | 64,499 | 7,663 |
| document | 24,646 | 7,503 |
| document_style_control | 24,621 | 7,490 |
| image_edit | 127,527 | 10,685 |
| image_to_video | 67,233 | 7,877 |
| search | 37,233 | 6,921 |
| search_factuality | 9,395 | 6,704 |
| search_style_control | 37,238 | 6,919 |
| text | 58,262,115 | 605,667 |
| text_factuality | 3,388,157 | 195,776 |
| text_style_control | 51,709,201 | 606,130 |
| text_to_image | 954,800 | 37,561 |
| text_to_video | 63,525 | 7,889 |
| video_edit | 7,542 | 5,583 |
| vision | 2,065,304 | 59,362 |
| vision_style_control | 1,892,480 | 59,380 |
| webdev | 1,185,756 | 28,440 |

Root also has `.gitattributes` (2,504) and `README.md` (21,766). Every file is `<subset>/{full,latest}-00000-of-00001.parquet`; no deeper nesting.

### Cross-cutting surprises
1. **Survivorship / missing historical models.** Historical snapshots only contain models still in Arena's current model registry; deprecated or experimental entries are absent from *all* snapshots. In `text` there is no Claude at all before 2024-03-07 (no claude-1, claude-2.0/2.1, claude-instant-1), no gpt-3.5-turbo-0314/0613, gpt-4-1106-preview only from 2024-02-02, no bard, no Gemini experimental names (gemini-exp-1114/1121/1206, gemini-2.0-flash-exp, gemini-2.5-pro-exp-03-25, gemini-2.5-pro-preview-*), and `gemini-2.5-pro` only from 2025-06-24. Effect: the 2025-04-23 top of `text` overall is o3 (1418) with no Gemini near the top, although Gemini 2.5 Pro (exp) led the live board then. Family-maximum series for Google (2024-2025) and Anthropic (2023) will be biased low; flag this in the methodology or blend with another source.
2. `rank` is a plain ordinal by rating within (date, category): 1..N with no gaps; ties only where ratings are exactly equal (text, 2023-2024). It is NOT the website's "Rank (UB)". Recompute rank-UB from the CIs if needed.
3. Renames create series breaks inside a family: on 2026-08-12 the Anthropic `*-thinking` / `*-thinking-16k` / `*-thinking-32k` names were renamed to `*-high` / `*-high-32k` (e.g. `claude-opus-4-6-thinking` last seen 2026-08-11 at 1504.71 -> `claude-opus-4-6-high` first seen 2026-08-12 at 1504.71 with the same vote count, style-control subset). Similarly `gemini-3.6-flash` -> `gemini-3.6-flash-high` (2026-08-12), `deepseek-v4-pro-thinking` -> `deepseek-v4-pro-high-preview` (2026-08-02), `claude-fable-5` -> `claude-fable-5-high` (2026-09-25). Same model, new key.
4. Empty-string metadata from 2026-04-02: 63 legacy models get `organization == ''` from 2026-04-02 onward (some get re-assigned on 2026-04-30 to `zai` / `allenai` / `bytedance`, keeping `''` rows until 2026-05-07); `gpt-5.4` / `gpt-5.4-high` have `license == ''` for 2026-04-02..2026-04-20 (363 rows). None of the 8 target families is affected on `organization`.
5. Some consecutive snapshots are identical re-publications (text overall: 2025-01-21 = 2025-01-22, 2025-04-05 = 2025-04-08, 2026-02-21 = 2026-02-22).
6. No model release-date column in any subset. Best proxy: first `leaderboard_publish_date` a name appears (typically days to a few weeks after public release; biased by item 1).

## arena-text

- Subset `text` (raw, non-style-controlled Bradley-Terry ratings).
- URLs: `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/text/full-00000-of-00001.parquet` (**58,262,115 B, 1,168,522 rows**, 1,169 row groups), `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/text/latest-00000-of-00001.parquet` (605,667 B, 10,923 rows, all `2026-10-02`). Format: Parquet written by HF `datasets` (schema metadata key `huggingface`).
- Card `dataset_info` agrees: full 1,168,522 examples, latest 10,923.

### Schema (pyarrow, exact)
`model_name: string`, `organization: string`, `license: string`, `rating: double`, `rating_lower: double`, `rating_upper: double`, `variance: double`, `vote_count: double`, `rank: double`, `category: string`, `leaderboard_publish_date: string`.
- `vote_count` and `rank` are float64 here (int in the card; values are whole numbers). `rating` and `rank` are NaN on 26 rows (all `falcon-180b-chat`, category `korean`, vote_count 5, 2024-06-17..2024-10-15).
- `rating_lower` / `rating_upper` / `variance` are null on 333 rows and `vote_count` on 307: every row from 2023-05-08 to 2023-12-20 (Elo era) plus the falcon rows.
- `leaderboard_publish_date` is a string `YYYY-MM-DD` (not a timestamp type).
- Distinct model names: 434. Duplicate (model_name, category, date) keys: 0.

### Example row (latest snapshot, category overall, rank 1)
```json
{"model_name": "gemini-4-argon-high", "organization": "google", "license": "Proprietary", "rating": 1533.4609832971757, "rating_lower": 1524.6678224950515, "rating_upper": 1542.2541440993, "variance": 20.127685991449013, "vote_count": 4932.0, "rank": 1.0, "category": "overall", "leaderboard_publish_date": "2026-10-02"}
```

### Categories (column `category`; default = `overall`)
| category | rows | first date | #snapshots |
|---|---|---|---|
| `overall` | 53804 | 2023-05-08 | 247 |
| `english` | 52858 | 2024-03-27 | 224 |
| `exclude_ties` | 52566 | 2024-04-11 | 222 |
| `coding` | 52322 | 2024-04-03 | 223 |
| `hard_prompts_english` | 51896 | 2024-05-16 | 213 |
| `multi_turn` | 50839 | 2024-06-29 | 202 |
| `instruction_following` | 50823 | 2024-07-08 | 200 |
| `longer_query` | 50572 | 2024-03-27 | 224 |
| `chinese` | 49784 | 2024-03-27 | 224 |
| `math` | 49709 | 2024-07-08 | 200 |
| `hard_prompts` | 49096 | 2024-05-16 | 213 |
| `creative_writing` | 48064 | 2024-10-23 | 180 |
| `russian` | 47655 | 2024-05-15 | 210 |
| `german` | 41846 | 2024-05-15 | 210 |
| `french` | 39809 | 2024-04-11 | 222 |
| `spanish` | 39177 | 2024-06-02 | 209 |
| `japanese` | 37854 | 2024-06-02 | 209 |
| `korean` | 36716 | 2024-06-17 | 206 |
| `industry_software_and_it_services` | 33729 | 2025-11-05 | 100 |
| `industry_life_and_physical_and_social_science` | 33549 | 2025-11-05 | 100 |
| `industry_writing_and_literature_and_language` | 33391 | 2025-11-05 | 100 |
| `industry_entertainment_and_sports_and_media` | 33236 | 2025-11-05 | 100 |
| `industry_business_and_management_and_financial_operations` | 32787 | 2025-11-05 | 100 |
| `industry_mathematical` | 32055 | 2025-11-05 | 100 |
| `industry_legal_and_government` | 31076 | 2025-11-05 | 100 |
| `industry_medicine_and_healthcare` | 30744 | 2025-11-05 | 100 |
| `expert` | 28683 | 2025-11-05 | 100 |
| `non_english` | 15504 | 2026-04-30 | 41 |
| `polish` | 8378 | 2026-04-30 | 41 |

Category set growth: `overall` only until 2024-03-26; 4-5 categories on 2024-03-27/04-03; 7 from 2024-04-11; 9 from 2024-05-15; 13 on 2024-06-02; 17 on 2024-07-08; 18 on 2024-10-23; 27 on 2025-11-05 (`expert` + 8 `industry_*`); 29 on 2026-04-30 (`non_english`, `polish`). Some dates (2024-04-09/10) carry only `overall`.

### Snapshots
- Identified by `leaderboard_publish_date` (string `YYYY-MM-DD`; the publication date of that leaderboard, NOT a model release date). Every snapshot date contains `overall`.
- 247 distinct dates, first 2023-05-08, last 2026-10-02. Gaps: min 1 day, median 4, max 37 (every gap > 20 days is in 2023). Snapshots per month: 2023-05:2, 2023-06:1, 2023-07:1, 2023-08:1, 2023-09:1, 2023-10:1, 2023-11:2, 2023-12:3, 2024-01:3, 2024-02:2, 2024-03:5, 2024-04:9, 2024-05:7, 2024-06:8, 2024-07:7, 2024-08:8, 2024-09:4, 2024-10:4, 2024-11:6, 2024-12:7, 2025-01:7, 2025-02:9, 2025-03:8, 2025-04:5, 2025-05:6, 2025-06:7, 2025-07:6, 2025-08:8, 2025-09:4, 2025-10:5, 2025-11:8, 2025-12:12, 2026-01:3, 2026-02:13, 2026-03:11, 2026-04:13, 2026-05:8, 2026-06:6, 2026-07:10, 2026-08:9, 2026-09:6, 2026-10:1.
- All dates: 2023-05-08, 2023-05-22, 2023-06-19, 2023-07-17, 2023-08-02, 2023-09-05, 2023-10-02, 2023-11-08, 2023-11-16, 2023-12-06, 2023-12-15, 2023-12-20, 2024-01-09, 2024-01-18, 2024-01-25, 2024-02-02, 2024-02-15, 2024-03-05, 2024-03-07, 2024-03-13, 2024-03-26, 2024-03-27, 2024-04-03, 2024-04-09, 2024-04-10, 2024-04-11, 2024-04-13, 2024-04-18, 2024-04-19, 2024-04-22, 2024-04-26, 2024-05-01, 2024-05-08, 2024-05-15, 2024-05-16, 2024-05-19, 2024-05-20, 2024-05-27, 2024-06-02, 2024-06-06, 2024-06-11, 2024-06-17, 2024-06-21, 2024-06-23, 2024-06-26, 2024-06-29, 2024-07-06, 2024-07-08, 2024-07-16, 2024-07-22, 2024-07-25, 2024-07-30, 2024-07-31, 2024-08-01, 2024-08-05, 2024-08-06, 2024-08-13, 2024-08-22, 2024-08-23, 2024-08-27, 2024-08-28, 2024-09-04, 2024-09-15, 2024-09-17, 2024-09-27, 2024-10-07, 2024-10-15, 2024-10-23, 2024-10-28, 2024-11-04, 2024-11-12, 2024-11-13, 2024-11-20, 2024-11-21, 2024-11-22, 2024-12-01, 2024-12-05, 2024-12-10, 2024-12-15, 2024-12-18, 2024-12-22, 2024-12-30, 2025-01-05, 2025-01-15, 2025-01-19, 2025-01-21, 2025-01-22, 2025-01-24, 2025-01-28, 2025-02-03, 2025-02-05, 2025-02-06, 2025-02-09, 2025-02-11, 2025-02-14, 2025-02-17, 2025-02-21, 2025-02-27, 2025-03-03, 2025-03-11, 2025-03-15, 2025-03-17, 2025-03-20, 2025-03-25, 2025-03-26, 2025-03-30, 2025-04-05, 2025-04-08, 2025-04-09, 2025-04-16, 2025-04-23, 2025-05-05, 2025-05-06, 2025-05-11, 2025-05-19, 2025-05-20, 2025-05-22, 2025-06-01, 2025-06-03, 2025-06-05, 2025-06-11, 2025-06-17, 2025-06-18, 2025-06-24, 2025-07-01, 2025-07-07, 2025-07-15, 2025-07-17, 2025-07-25, 2025-07-28, 2025-08-01, 2025-08-04, 2025-08-07, 2025-08-14, 2025-08-18, 2025-08-21, 2025-08-27, 2025-08-28, 2025-09-08, 2025-09-17, 2025-09-18, 2025-09-30, 2025-10-01, 2025-10-03, 2025-10-07, 2025-10-16, 2025-10-17, 2025-11-05, 2025-11-06, 2025-11-09, 2025-11-16, 2025-11-17, 2025-11-18, 2025-11-20, 2025-11-26, 2025-12-01, 2025-12-04, 2025-12-05, 2025-12-08, 2025-12-11, 2025-12-15, 2025-12-16, 2025-12-18, 2025-12-19, 2025-12-21, 2025-12-23, 2025-12-30, 2026-01-09, 2026-01-27, 2026-01-29, 2026-02-06, 2026-02-09, 2026-02-10, 2026-02-11, 2026-02-16, 2026-02-17, 2026-02-19, 2026-02-20, 2026-02-21, 2026-02-22, 2026-02-24, 2026-02-25, 2026-02-26, 2026-03-03, 2026-03-04, 2026-03-05, 2026-03-06, 2026-03-11, 2026-03-16, 2026-03-18, 2026-03-19, 2026-03-20, 2026-03-26, 2026-03-31, 2026-04-02, 2026-04-07, 2026-04-09, 2026-04-10, 2026-04-14, 2026-04-17, 2026-04-20, 2026-04-22, 2026-04-23, 2026-04-27, 2026-04-28, 2026-04-29, 2026-04-30, 2026-05-01, 2026-05-06, 2026-05-07, 2026-05-12, 2026-05-14, 2026-05-18, 2026-05-19, 2026-05-27, 2026-06-03, 2026-06-04, 2026-06-05, 2026-06-10, 2026-06-16, 2026-06-25, 2026-07-02, 2026-07-10, 2026-07-12, 2026-07-14, 2026-07-16, 2026-07-20, 2026-07-21, 2026-07-26, 2026-07-27, 2026-07-30, 2026-08-02, 2026-08-03, 2026-08-06, 2026-08-10, 2026-08-11, 2026-08-12, 2026-08-19, 2026-08-21, 2026-08-27, 2026-09-01, 2026-09-02, 2026-09-11, 2026-09-13, 2026-09-25, 2026-09-30, 2026-10-02

### Rating columns and scale
- `rating` = Bradley-Terry Arena score (Elo-like; overall ~789-1533; 2023-05..2023-11 values are integer Elo). `rating_lower` / `rating_upper` = CI bounds (extreme for tiny categories: lower min -18, upper max 1808), `variance`, `vote_count` (battles; max 202,735), `rank` (ordinal, see shared surprise 2).
- Overall max over time: 1094 (2023-05) -> 1190 (2024-01) -> 1289 (2024-05) -> 1359 (2024-12) -> 1412 (2025-03) -> 1477 (2025-06) -> 1497 (2025-11) -> 1504 (2026-02) -> 1533 (2026-10). The overall median drifts up as the pool grows (918 -> 1343).

### Discontinuities
- 2024-01-09 Elo -> Bradley-Terry: same-model shift on overall (42 common models, 2023-12-20 -> 2024-01-09) mean +32.8, median +37.4, range -50..+94; overall median 989.9 -> 1040.7, max 1128.6 -> 1190.5. Ratings before 2023-12-06 are integers; CIs and votes absent before 2024-01-09. Treat pre-2024 as a separate regime (or use rank-based metrics only).
- **2025-05-16: no discontinuity in `text`.** 2025-05-11 -> 2025-05-19 overall: median 1185.7 -> 1184.9, max 1413.1 -> 1409.1; 192 common models shift by mean -3.1 (range -5.4..+1.3). Columns and category set (18) unchanged. (`text` stays the raw leaderboard; the website default switched to style control, see arena-text-style.)
- 2025-07-23 re-weighting: 2025-07-17 -> 2025-07-25 mean shift +5.0 (median +3.1, max +32); min rating 814 -> 841. Small.
- Category set jumps (2025-11-05, 2026-04-30) do not affect `overall`.

### Organizations (`organization`; m = distinct models, r = rows)
`''` (empty string) (63m/62660r), `openai` (49m/133846r), `google` (45m/122342r), `alibaba` (42m/122069r), `anthropic` (40m/80367r), `deepseek` (24m/56611r), `meta` (23m/71869r), `xai` (18m/42482r), `mistral` (17m/63034r), `zai` (17m/25437r), `nvidia` (11m/27485r), `tencent` (11m/26276r), `amazon` (10m/25329r), `ibm` (9m/16758r), `microsoft` (8m/34909r), `moonshot` (8m/14755r), `Ai2` (8m/10633r), `xiaomi` (8m/9449r), `allenai` (8m/6366r), `cohere` (7m/28766r), `minimax` (6m/12323r), `stepfun` (5m/10839r), `baidu` (5m/7601r), `LMSYS` (4m/12026r), `Reka AI` (4m/11134r), `HuggingFace` (4m/10318r), `01 AI` (3m/9134r), `Tsinghua` (3m/8220r), `OpenChat` (2m/6071r), `Databricks` (2m/5960r), `UC Berkeley` (2m/5900r), `Zhipu AI` (2m/5633r), `NexusFlow` (2m/5525r), `NousResearch` (2m/5525r), `AI21 Labs` (2m/5367r), `MosaicML` (2m/5322r), `ant-group` (2m/5018r), `meituan` (2m/4382r), `inception-ai` (2m/2589r), `thinky` (2m/886r), `Snowflake` (1m/3209r), `Nexusflow` (1m/3145r), `AllenAI/UW` (1m/2856r), `Together AI` (1m/2851r), `OpenAssistant` (1m/2803r), `RWKV` (1m/2803r), `Stanford` (1m/2803r), `Upstage AI` (1m/2771r), `Stability AI` (1m/2650r), `UW` (1m/2639r), `Princeton` (1m/2616r), `InternLM` (1m/2505r), `Cognitive Computations` (1m/2357r), `Nomic AI` (1m/2251r), `TII` (1m/2116r), `Zhipu` (1m/2102r), `microsoft-ai` (1m/1959r), `bytedance` (1m/1081r), `Prime Intellect` (1m/752r), `Bytedance` (1m/466r), `Arcee AI` (1m/313r), `upstage` (1m/258r)

Org naming quirks: all major labs use lowercase slugs that never vary: `openai`, `anthropic`, `google` (never "Google DeepMind"), `xai`, `deepseek`, `alibaba` (Qwen lives under `alibaba`, never "Qwen"), `meta`, `mistral`. Legacy/minor orgs use display names and have duplicates: `Zhipu AI` / `Zhipu` / `zai`; `Ai2` / `allenai` / `AllenAI/UW`; `NexusFlow` / `Nexusflow`; `Bytedance` / `bytedance`; `Upstage AI` / `upstage`; `microsoft` / `microsoft-ai`; plus `''` (shared surprise 4).
License values (distinct per model; count of models): `Proprietary` (206), `Apache 2.0` (61), `MIT` (54), `Apache-2.0` (13), `Llama 2 Community` (10), `CC-BY-NC-4.0` (10), `Modified MIT` (9), `Qianwen LICENSE` (8), `Non-commercial` (7), `Gemma license` (7), `Llama 3.1 Community` (5), `Llama 3.1` (4), `Gemma` (4), `DeepSeek` (3), `CC-BY-NC-SA-4.0` (3), `NVIDIA Open Model` (3), `OpenMDW-1.1` (2), `DeepSeek License` (2), `Llama 3.2` (2), `''` (empty string) (2), `MRL` (2), `Qwen` (2), `Jamba Open` (2), `Llama 3 Community` (2), `Yi License` (1), `Other` (1), `Falcon-180B TII License` (1), `DBRX LICENSE` (1), `AI2 ImpACT Low-risk` (1), `Mistral Research` (1), `Llama-3.3` (1), `NexusFlow` (1), `Nvidia Open Model` (1), `Llama 4` (1), `Nvidia` (1), `Llama` (1), `Nvidia Open` (1), `tencent-hunyuan-community` (1), `MiniMax Community License` (1), `Kimi K3 license` (1). Free text (`Apache 2.0` vs `Apache-2.0`, `Gemma` vs `Gemma license`, `Llama 3.1` vs `Llama 3.1 Community`).

### xAI / Grok
Present: 18 Grok names under org `xai`, first `grok-2-2024-08-13` on 2024-08-23.

### Family model names (org-filtered, in first-seen order; `[first-seen]`, or `[first..last]` when no longer listed)
- **GPT/OpenAI** (org `openai`, 49 names): gpt-3.5-turbo-1106 [2023-12-06], gpt-4-0314 [2023-12-06], gpt-4-0613 [2023-12-06], gpt-4-0125-preview [2024-02-02], gpt-4-1106-preview [2024-02-02], gpt-3.5-turbo-0125 [2024-02-15], gpt-4-turbo-2024-04-09 [2024-04-11], gpt-4o-2024-05-13 [2024-05-15], gpt-4o-mini-2024-07-18 [2024-07-22], chatgpt-4o-latest [2024-08-22..2024-09-04], gpt-4o-2024-08-06 [2024-08-22], o1-mini [2024-09-17], o1-preview [2024-09-17], o1-2024-12-17 [2024-12-30], o3-mini [2025-02-06], o3-mini-high [2025-02-21], gpt-4.5-preview-2025-02-27 [2025-03-03], chatgpt-4o-latest-20250326 [2025-03-26], o3-2025-04-16 [2025-04-23], o4-mini-2025-04-16 [2025-04-23], gpt-4.1-2025-04-14 [2025-04-23], gpt-4.1-mini-2025-04-14 [2025-04-23], gpt-4.1-nano-2025-04-14 [2025-04-23], gpt-5-high [2025-08-07], gpt-oss-20b [2025-08-07], gpt-oss-120b [2025-08-07], gpt-5-mini-high [2025-08-14], gpt-5-chat [2025-08-14], gpt-5-nano-high [2025-08-14], gpt-5.1 [2025-11-16], gpt-5.1-high [2025-11-18], gpt-5.2-high [2025-12-16], gpt-5.2 [2025-12-18], gpt-5.2-chat-latest-20260210 [2026-02-16], gpt-5.3-chat-latest [2026-03-04], gpt-5.4 [2026-03-11], gpt-5.4-high [2026-03-11], gpt-5.4-nano-high [2026-03-18], gpt-5.4-mini-high [2026-03-18], gpt-5.5 [2026-04-27], gpt-5.5-high [2026-04-27], gpt-5.5-instant [2026-05-06], gpt-5.6-sol-xhigh [2026-07-10], gpt-5.6-terra-xhigh [2026-07-30], gpt-5.6-luna-xhigh [2026-07-30], gpt-6-astra-max [2026-09-11], gpt-6-sol-max [2026-09-25], gpt-6-luna-max [2026-09-25], gpt-6.1-sol-max [2026-10-02]
- **Claude** (org `anthropic`, 40 names): claude-3-opus-20240229 [2024-03-07], claude-3-sonnet-20240229 [2024-03-07], claude-3-haiku-20240307 [2024-03-26], claude-3-5-sonnet-20240620 [2024-06-23], claude-3-5-sonnet-20241022 [2024-10-28], claude-3-5-haiku-20241022 [2024-12-10], claude-3-7-sonnet-20250219 [2025-02-27], claude-3-7-sonnet-20250219-thinking-32k [2025-03-20], claude-sonnet-4-20250514 [2025-06-01], claude-opus-4-20250514 [2025-06-01], claude-opus-4-20250514-thinking-16k [2025-07-15], claude-sonnet-4-20250514-thinking-32k [2025-07-15], claude-opus-4-1-20250805 [2025-08-07], claude-opus-4-1-20250805-thinking-16k [2025-08-14], claude-sonnet-4-5-20250929 [2025-10-01], claude-sonnet-4-5-20250929-thinking-32k [2025-10-03..2026-08-11], claude-haiku-4-5-20251001 [2025-10-16], claude-opus-4-5-20251101-thinking-32k [2025-11-26..2026-08-11], claude-opus-4-5-20251101 [2025-11-26], claude-opus-4-6-thinking [2026-02-06..2026-08-11], claude-opus-4-6 [2026-02-06], claude-sonnet-4-6 [2026-02-19], claude-opus-4-7 [2026-04-17], claude-opus-4-7-thinking [2026-04-17..2026-08-11], claude-opus-4-8 [2026-06-03], claude-opus-4-8-thinking [2026-06-03..2026-08-11], claude-fable-5 [2026-06-10..2026-09-13], claude-sonnet-5-thinking [2026-07-02..2026-07-02], claude-sonnet-5-high [2026-07-02], claude-opus-5-high [2026-07-26], claude-opus-5-max [2026-07-27], claude-opus-4-7-high [2026-08-12], claude-opus-4-8-high [2026-08-12], claude-opus-4-6-high [2026-08-12], claude-opus-4-5-20251101-high-32k [2026-08-12], claude-sonnet-4-5-20250929-high-32k [2026-08-12], claude-fable-5.1-max [2026-09-02], claude-opus-5.5-high [2026-09-25], claude-fable-5-high [2026-09-25], claude-sonnet-5.5-xhigh [2026-10-02]
- **Gemini** (org `google`, 31 names): gemini-pro [2023-12-15], gemini-pro-dev-api [2024-01-09], gemini-1.5-flash-api-0514 [2024-05-27..2024-10-15], gemini-advanced-0514 [2024-05-27], gemini-1.5-pro-api-0514 [2024-05-27..2024-10-15], gemini-1.5-flash-002 [2024-10-07], gemini-1.5-flash-8b-001 [2024-10-07], gemini-1.5-pro-002 [2024-10-07], gemini-1.5-flash-001 [2024-10-23], gemini-1.5-pro-001 [2024-10-23], gemini-2.0-flash-001 [2025-02-05], gemini-2.0-flash-lite-preview-02-05 [2025-02-09], gemini-2.5-flash-lite-preview-06-17-thinking [2025-06-18], gemini-2.5-flash [2025-06-24], gemini-2.5-pro [2025-06-24], gemini-2.5-flash-preview-09-2025 [2025-09-30], gemini-2.5-flash-lite-preview-09-2025-no-thinking [2025-10-07], gemini-3-pro [2025-11-16], gemini-3-flash [2025-12-16], gemini-3-flash (thinking-minimal) [2026-01-27], gemini-3.1-pro-preview [2026-02-06], gemini-3.1-flash-lite-preview [2026-03-03], gemini-3.5-flash [2026-05-19..2026-07-02], gemini-3.5-flash-high [2026-07-10], gemini-3.5-flash-medium [2026-07-10], gemini-3.5-flash-lite [2026-07-21], gemini-3.6-flash [2026-07-21..2026-08-11], gemini-3.6-flash-high [2026-08-12], gemini-3.7-flash-high [2026-08-19], gemini-3.8-flash-high [2026-09-02], gemini-4-argon-high [2026-09-30]
- **Gemma** (org `google`, 13 names): gemma-2b-it [2024-03-05], gemma-7b-it [2024-03-05], gemma-1.1-7b-it [2024-04-09], gemma-1.1-2b-it [2024-04-18], gemma-2-27b-it [2024-06-29], gemma-2-9b-it [2024-06-29], gemma-2-2b-it [2024-07-31], gemma-3-27b-it [2025-03-11], gemma-3-12b-it [2025-05-05], gemma-3-4b-it [2025-05-05], gemma-3n-e4b-it [2025-05-20], gemma-4-26b-a4b [2026-03-31], gemma-4-31b [2026-03-31]
- **Grok** (org `xai`, 18 names): grok-2-2024-08-13 [2024-08-23], grok-2-mini-2024-08-13 [2024-08-23], grok-3-preview-02-24 [2025-03-03], grok-3-mini-beta [2025-06-01], grok-3-mini-high [2025-07-15], grok-4-0709 [2025-07-15], grok-4-fast-chat [2025-09-30], grok-4-fast-reasoning [2025-09-30], grok-4.1 [2025-11-16], grok-4.1-thinking [2025-11-16], grok-4-1-fast-reasoning [2025-11-26], grok-4.20-beta1 [2026-02-19], grok-4.20-beta-0309-reasoning [2026-03-16], grok-4.20-multi-agent-beta-0309 [2026-03-16], grok-4.3 [2026-05-01], grok-4.5 [2026-07-10], grok-4.6-high [2026-08-12], grok-4.7-xhigh [2026-09-25]
- **DeepSeek** (org `deepseek`, 24 names): deepseek-llm-67b-chat [2024-02-02], deepseek-coder-v2 [2024-06-21], deepseek-v2.5 [2024-09-15], deepseek-v2.5-1210 [2024-12-22], deepseek-v3 [2024-12-30], deepseek-r1 [2025-01-24], deepseek-v3-0324 [2025-03-30], deepseek-r1-0528 [2025-06-17], deepseek-v3.1-thinking [2025-08-27], deepseek-v3.1 [2025-08-27], deepseek-v3.1-terminus [2025-09-30], deepseek-v3.1-terminus-thinking [2025-09-30], deepseek-v3.2-exp [2025-10-03], deepseek-v3.2-exp-thinking [2025-10-07], deepseek-v3.2 [2025-12-04], deepseek-v3.2-thinking [2025-12-04], deepseek-v4-pro-thinking [2026-04-23..2026-07-30], deepseek-v4-flash [2026-04-23], deepseek-v4-flash-thinking [2026-04-23..2026-07-30], deepseek-v4-pro [2026-04-23], deepseek-v4-flash-high-preview [2026-08-02], deepseek-v4-pro-high-preview [2026-08-02], deepseek-v4-pro-high-20260813 [2026-08-19], deepseek-v4.1-flash-max [2026-09-25]
- **Qwen** (org `alibaba`, 42 names): qwen-14b-chat [2023-11-08], qwen1.5-4b-chat [2024-02-15], qwen1.5-72b-chat [2024-02-15], qwen1.5-7b-chat [2024-02-15], qwen1.5-14b-chat [2024-04-03], qwen1.5-32b-chat [2024-04-03], qwen1.5-110b-chat [2024-05-08], qwen2-72b-instruct [2024-06-06], qwen2.5-72b-instruct [2024-09-27], qwen-max-0919 [2024-10-15], qwen2.5-coder-32b-instruct [2024-11-20], qwq-32b-preview [2024-12-01], qwen2.5-plus-1127 [2024-12-22], qwen2.5-max [2025-02-03], qwen-plus-0125 [2025-02-14], qwq-32b [2025-03-15], qwen3-235b-a22b [2025-05-05], qwen3-30b-a3b [2025-05-19], qwen3-32b [2025-05-19], qwen3-235b-a22b-no-thinking [2025-06-17], qwen3-coder-480b-a35b-instruct [2025-07-28], qwen3-235b-a22b-thinking-2507 [2025-08-01], qwen3-235b-a22b-instruct-2507 [2025-08-01], qwen3-30b-a3b-instruct-2507 [2025-08-04], qwen3-max-preview [2025-09-08], qwen3-next-80b-a3b-instruct [2025-09-17], qwen3-next-80b-a3b-thinking [2025-09-17], qwen3-vl-235b-a22b-instruct [2025-09-30], qwen3-max-2025-09-23 [2025-09-30], qwen3-vl-235b-a22b-thinking [2025-09-30], qwen3.5-397b-a17b [2026-02-19], qwen3.5-122b-a10b [2026-02-26], qwen3.5-27b [2026-02-26], qwen3.5-35b-a3b [2026-02-26], qwen3.5-flash [2026-03-03], qwen3.5-max-preview [2026-03-16], qwen3.6-plus [2026-04-20], qwen3.6-max-preview [2026-04-30], qwen3.7-max-preview [2026-05-12], qwen3.7-plus [2026-06-03], qwen3.8-max [2026-08-02], qwen3.8-27b [2026-08-21]
- **Llama/Meta** (org `meta`, 23 names): llama-13b [2023-05-08], llama-2-13b-chat [2023-08-02], llama-2-7b-chat [2023-08-02], codellama-34b-instruct [2023-09-05], llama-2-70b-chat [2023-09-05], codellama-70b-instruct [2024-03-07], llama-3-70b-instruct [2024-04-18], llama-3-8b-instruct [2024-04-18], llama-3.1-8b-instruct [2024-07-30], llama-3.1-70b-instruct [2024-07-30], llama-3.1-405b-instruct [2024-07-30..2024-09-04], llama-3.1-405b-instruct-fp8 [2024-09-15], llama-3.1-405b-instruct-bf16 [2024-09-15], llama-3.2-1b-instruct [2024-09-27], llama-3.2-3b-instruct [2024-09-27], llama-3.3-70b-instruct [2024-12-15], llama-4-maverick-17b-128e-instruct [2025-04-09], llama-4-scout-17b-16e-instruct [2025-05-22], muse-spark [2026-04-09], muse-spark-1.1 [2026-07-10], muse-spark-1.2 (xHigh) [2026-08-06], muse-glimmer [2026-08-10], muse-spark-1.3-max [2026-09-13]
- **Mistral** (org `mistral`, 17 names): mistral-7b-instruct [2023-10-02], mixtral-8x7b-instruct-v0.1 [2023-12-15], mistral-medium [2024-01-09], mistral-7b-instruct-v0.2 [2024-03-05], mistral-large-2402 [2024-03-05], mixtral-8x22b-instruct-v0.1 [2024-04-18], mistral-large-2407 [2024-08-05], ministral-8b-2410 [2024-11-12], mistral-large-2411 [2024-12-01], mistral-small-24b-instruct-2501 [2025-02-11], mistral-medium-2505 [2025-05-19], mistral-small-3.1-24b-instruct-2503 [2025-05-19], magistral-medium-2506 [2025-06-24], mistral-small-2506 [2025-07-07], mistral-medium-2508 [2025-08-21], mistral-large-3 [2025-12-01], mistral-medium-3.5 [2026-06-03]

Naming quirks: date suffixes in several formats (`-20240229`, `-2024-04-09`, `-0514`, `-02-24`, `-2507`, `-1210`), `-preview`, `-exp`, `-latest` (`chatgpt-4o-latest` only 2024-08-22..2024-09-04, later `chatgpt-4o-latest-20250326`; `gpt-5.2-chat-latest-20260210`, `gpt-5.3-chat-latest`), reasoning/effort variants as suffixes (`-thinking`, `-thinking-16k/-32k`, `-no-thinking`, `-high`, `-high-32k`, `-xhigh`, `-max`, `-medium`, `-instant`) and sometimes in parentheses (`gemini-3-flash (thinking-minimal)`, `muse-spark-1.2 (xHigh)`, `glm-5.2 (max)`), precision variants (`llama-3.1-405b-instruct-bf16` / `-fp8`), mixed version separators (`claude-opus-4-1` vs `gpt-4.1`; `grok-4-1-fast-reasoning` vs `grok-4.1`). `palm-2` is Google but not Gemini. Meta's post-Llama proprietary models are `muse-spark*` / `muse-glimmer` (no "llama" token). `gpt-oss-20b/120b` are OpenAI open weights (`Apache 2.0`).
Fine-tunes containing family tokens but owned by other orgs (exclude by org): `gemma-2-9b-it-simpo` (Princeton / ''), `llama-3.1-tulu-3-*` (Ai2 / allenai / ''), `llama-3.1-nemotron-*`, `llama-3.3-nemotron-*`, `llama2-70b-steerlm-chat`, `nvidia-llama-3.3-nemotron-super-49b-v1.5` (nvidia), `dolphin-2.2.1-mistral-7b`, `openhermes-2.5-mistral-7b`, `nous-hermes-2-mixtral-8x7b-dpo`, `gpt4all-13b-snoozy`.

### Release date
No release-date column. Use first-seen `leaderboard_publish_date` as proxy (shared surprise 6).

### Fixture
`pipeline/test/fixtures/arena-text/sample.rows.json`: 206 rows, 65,779 B. Overall rows (top 8 + best 2 per family) for 11 dates: 2023-05-08 (integer Elo, null CIs), 2023-12-06, 2024-01-09 (BT switch), 2024-06-02, 2025-01-05, 2025-05-11 (before), 2025-05-19 (after), 2025-11-05, 2026-04-02 (+1 empty-org row), 2026-08-12 (rename day), 2026-10-02; plus top-5 `coding` for 2025-05-11 and 2025-05-19.

## arena-text-style

- Subset `text_style_control` (style-controlled BT ratings; website default since 2025-05-16).
- URLs: `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/text_style_control/full-00000-of-00001.parquet` (**51,709,201 B, 1,026,932 rows**, 1,027 row groups), `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/text_style_control/latest-00000-of-00001.parquet` (606,130 B, 10,923 rows, all `2026-10-02`). Parquet.

### Schema (pyarrow, exact)
`model_name: string`, `organization: string`, `license: string`, `rating: double`, `rating_lower: double`, `rating_upper: double`, `variance: double`, `vote_count: double`, `rank: int64`, `category: string`, `leaderboard_publish_date: string`.
- `rank` is int64 here but float64 in `text`; `vote_count` is float64 in both. No nulls anywhere. Distinct model names: 434. Duplicate keys: 0.
- `vote_count` equals `text`'s for the same (model, category, date): same battles, different model.

### Example row (latest snapshot, overall, rank 1)
```json
{"model_name": "gemini-4-argon-high", "organization": "google", "license": "Proprietary", "rating": 1525.2150000155266, "rating_lower": 1516.3851952929315, "rating_upper": 1534.0448047381217, "variance": 20.295792582536265, "vote_count": 4932.0, "rank": 1, "category": "overall", "leaderboard_publish_date": "2026-10-02"}
```

### Categories (default = `overall`)
| category | rows | first date | #snapshots |
|---|---|---|---|
| `overall` | 49492 | 2024-08-28 | 187 |
| `hard_prompts` | 49324 | 2024-08-28 | 187 |
| `coding` | 48745 | 2024-09-15 | 185 |
| `creative_writing` | 48076 | 2024-10-23 | 180 |
| `instruction_following` | 46565 | 2025-01-05 | 165 |
| `multi_turn` | 46386 | 2025-01-05 | 165 |
| `math` | 45451 | 2025-01-05 | 165 |
| `longer_query` | 44820 | 2025-01-05 | 165 |
| `english` | 41086 | 2025-05-19 | 133 |
| `hard_prompts_english` | 40965 | 2025-05-19 | 133 |
| `chinese` | 38012 | 2025-05-19 | 133 |
| `exclude_ties` | 37593 | 2025-05-19 | 132 |
| `russian` | 37046 | 2025-05-19 | 133 |
| `industry_software_and_it_services` | 33729 | 2025-11-05 | 100 |
| `industry_life_and_physical_and_social_science` | 33549 | 2025-11-05 | 100 |
| `industry_writing_and_literature_and_language` | 33454 | 2025-11-05 | 100 |
| `industry_business_and_management_and_financial_operations` | 32556 | 2025-11-05 | 100 |
| `industry_mathematical` | 32055 | 2025-11-05 | 100 |
| `industry_entertainment_and_sports_and_media` | 31440 | 2025-11-05 | 100 |
| `german` | 31204 | 2025-05-19 | 133 |
| `industry_legal_and_government` | 31076 | 2025-11-05 | 100 |
| `industry_medicine_and_healthcare` | 30665 | 2025-11-05 | 100 |
| `spanish` | 28716 | 2025-05-19 | 133 |
| `expert` | 28683 | 2025-11-05 | 100 |
| `french` | 27763 | 2025-06-01 | 130 |
| `japanese` | 27304 | 2025-05-19 | 133 |
| `korean` | 27295 | 2025-05-19 | 133 |
| `non_english` | 15504 | 2026-04-30 | 41 |
| `polish` | 8378 | 2026-04-30 | 41 |

Category set growth: 2 (`overall`, `hard_prompts`) on 2024-08-28; +`coding` 2024-09-15; +`creative_writing` 2024-10-23; 8 on 2025-01-05; **17 on 2025-05-19** (languages, `english`, `exclude_ties`, `hard_prompts_english` added); +`french` 2025-06-01; 27 on 2025-11-05; `exclude_ties` missing on 2026-03-19 only; 29 on 2026-04-30.

### Snapshots
- 187 dates, 2024-08-28 .. 2026-10-02; the date set equals the `text` date set from 2024-08-28 on (same publication runs). Gaps: min 1, median 3, max 19 days. Per month: 2024-08:1, 2024-09:4, 2024-10:4, 2024-11:6, 2024-12:7, 2025-01:7, 2025-02:9, 2025-03:8, 2025-04:5, 2025-05:6, 2025-06:7, 2025-07:6, 2025-08:8, 2025-09:4, 2025-10:5, 2025-11:8, 2025-12:12, 2026-01:3, 2026-02:13, 2026-03:11, 2026-04:13, 2026-05:8, 2026-06:6, 2026-07:10, 2026-08:9, 2026-09:6, 2026-10:1.
- All dates: 2024-08-28, 2024-09-04, 2024-09-15, 2024-09-17, 2024-09-27, 2024-10-07, 2024-10-15, 2024-10-23, 2024-10-28, 2024-11-04, 2024-11-12, 2024-11-13, 2024-11-20, 2024-11-21, 2024-11-22, 2024-12-01, 2024-12-05, 2024-12-10, 2024-12-15, 2024-12-18, 2024-12-22, 2024-12-30, 2025-01-05, 2025-01-15, 2025-01-19, 2025-01-21, 2025-01-22, 2025-01-24, 2025-01-28, 2025-02-03, 2025-02-05, 2025-02-06, 2025-02-09, 2025-02-11, 2025-02-14, 2025-02-17, 2025-02-21, 2025-02-27, 2025-03-03, 2025-03-11, 2025-03-15, 2025-03-17, 2025-03-20, 2025-03-25, 2025-03-26, 2025-03-30, 2025-04-05, 2025-04-08, 2025-04-09, 2025-04-16, 2025-04-23, 2025-05-05, 2025-05-06, 2025-05-11, 2025-05-19, 2025-05-20, 2025-05-22, 2025-06-01, 2025-06-03, 2025-06-05, 2025-06-11, 2025-06-17, 2025-06-18, 2025-06-24, 2025-07-01, 2025-07-07, 2025-07-15, 2025-07-17, 2025-07-25, 2025-07-28, 2025-08-01, 2025-08-04, 2025-08-07, 2025-08-14, 2025-08-18, 2025-08-21, 2025-08-27, 2025-08-28, 2025-09-08, 2025-09-17, 2025-09-18, 2025-09-30, 2025-10-01, 2025-10-03, 2025-10-07, 2025-10-16, 2025-10-17, 2025-11-05, 2025-11-06, 2025-11-09, 2025-11-16, 2025-11-17, 2025-11-18, 2025-11-20, 2025-11-26, 2025-12-01, 2025-12-04, 2025-12-05, 2025-12-08, 2025-12-11, 2025-12-15, 2025-12-16, 2025-12-18, 2025-12-19, 2025-12-21, 2025-12-23, 2025-12-30, 2026-01-09, 2026-01-27, 2026-01-29, 2026-02-06, 2026-02-09, 2026-02-10, 2026-02-11, 2026-02-16, 2026-02-17, 2026-02-19, 2026-02-20, 2026-02-21, 2026-02-22, 2026-02-24, 2026-02-25, 2026-02-26, 2026-03-03, 2026-03-04, 2026-03-05, 2026-03-06, 2026-03-11, 2026-03-16, 2026-03-18, 2026-03-19, 2026-03-20, 2026-03-26, 2026-03-31, 2026-04-02, 2026-04-07, 2026-04-09, 2026-04-10, 2026-04-14, 2026-04-17, 2026-04-20, 2026-04-22, 2026-04-23, 2026-04-27, 2026-04-28, 2026-04-29, 2026-04-30, 2026-05-01, 2026-05-06, 2026-05-07, 2026-05-12, 2026-05-14, 2026-05-18, 2026-05-19, 2026-05-27, 2026-06-03, 2026-06-04, 2026-06-05, 2026-06-10, 2026-06-16, 2026-06-25, 2026-07-02, 2026-07-10, 2026-07-12, 2026-07-14, 2026-07-16, 2026-07-20, 2026-07-21, 2026-07-26, 2026-07-27, 2026-07-30, 2026-08-02, 2026-08-03, 2026-08-06, 2026-08-10, 2026-08-11, 2026-08-12, 2026-08-19, 2026-08-21, 2026-08-27, 2026-09-01, 2026-09-02, 2026-09-11, 2026-09-13, 2026-09-25, 2026-09-30, 2026-10-02

### Rating columns and scale
Same columns and semantics as arena-text. Overall range 858-1525. Since 2025-05-19 style-controlled and raw ratings differ per model (median abs diff 28-50 points depending on date) but sit on a comparable scale.

### Discontinuity at 2025-05-16 (YES, large)
- 2025-05-11 -> 2025-05-19 overall: median 1176.8 -> 1238.5, max 1375.2 -> 1434.4, min 859.4 -> 918.4. Over 192 common models the shift is a near-constant **+59.9** (min +57.8, max +64.4); the next step 2025-05-19 -> 2025-05-20 is 0.0. This is the documented offset re-alignment: before 2025-05-19 the style-control ratings sit ~60 points below the raw scale.
- Category set 8 -> 17 on the same date.
- Stitching options: add ~+60 to pre-2025-05-19 ratings; or use within-snapshot normalisation (rank / percentile / z-score); or use arena-text before 2025-05 and arena-text-style after.
- 2025-07-23 re-weighting: 2025-07-17 -> 2025-07-25 mean shift +2.7 (median +1.4). Small.

### Organizations
`''` (empty string) (63m/62660r), `openai` (49m/121117r), `google` (45m/106629r), `alibaba` (42m/110357r), `anthropic` (40m/74973r), `deepseek` (24m/52917r), `meta` (23m/58563r), `xai` (18m/40970r), `mistral` (17m/54491r), `zai` (17m/25422r), `tencent` (11m/25151r), `nvidia` (11m/24235r), `amazon` (10m/24120r), `ibm` (9m/15153r), `microsoft` (8m/27371r), `moonshot` (8m/14763r), `xiaomi` (8m/9442r), `Ai2` (8m/8838r), `allenai` (8m/6366r), `cohere` (7m/24344r), `minimax` (6m/12313r), `stepfun` (5m/10510r), `baidu` (5m/7602r), `Reka AI` (4m/8088r), `LMSYS` (4m/7575r), `HuggingFace` (4m/6711r), `01 AI` (3m/6476r), `Tsinghua` (3m/4936r), `ant-group` (2m/5000r), `meituan` (2m/4379r), `NexusFlow` (2m/4293r), `Zhipu AI` (2m/4150r), `AI21 Labs` (2m/3982r), `OpenChat` (2m/3840r), `Databricks` (2m/3766r), `UC Berkeley` (2m/3680r), `NousResearch` (2m/3356r), `MosaicML` (2m/3163r), `inception-ai` (2m/2577r), `thinky` (2m/886r), `Snowflake` (1m/2156r), `Nexusflow` (1m/2035r), `Princeton` (1m/1994r), `microsoft-ai` (1m/1959r), `InternLM` (1m/1914r), `Zhipu` (1m/1848r), `AllenAI/UW` (1m/1752r), `Together AI` (1m/1747r), `OpenAssistant` (1m/1703r), `RWKV` (1m/1703r), `Stanford` (1m/1703r), `Upstage AI` (1m/1664r), `UW` (1m/1553r), `Stability AI` (1m/1550r), `Cognitive Computations` (1m/1288r), `Nomic AI` (1m/1220r), `TII` (1m/1113r), `bytedance` (1m/1081r), `Prime Intellect` (1m/748r), `Bytedance` (1m/464r), `Arcee AI` (1m/314r), `upstage` (1m/258r)

Same quirks as arena-text (identical org mapping per model and date). License values: `Proprietary` (206), `Apache 2.0` (61), `MIT` (54), `Apache-2.0` (13), `Llama 2 Community` (10), `CC-BY-NC-4.0` (10), `Modified MIT` (9), `Qianwen LICENSE` (8), `Gemma license` (7), `Non-commercial` (7), `Llama 3.1 Community` (5), `Gemma` (4), `Llama 3.1` (4), `CC-BY-NC-SA-4.0` (3), `DeepSeek` (3), `NVIDIA Open Model` (3), `Llama 3.2` (2), `OpenMDW-1.1` (2), `Jamba Open` (2), `''` (empty string) (2), `Llama 3 Community` (2), `DeepSeek License` (2), `MRL` (2), `Qwen` (2), `Llama 4` (1), `NexusFlow` (1), `Yi License` (1), `Mistral Research` (1), `Nvidia` (1), `Other` (1), `Llama-3.3` (1), `DBRX LICENSE` (1), `Nvidia Open Model` (1), `AI2 ImpACT Low-risk` (1), `Falcon-180B TII License` (1), `Llama` (1), `Nvidia Open` (1), `tencent-hunyuan-community` (1), `MiniMax Community License` (1), `Kimi K3 license` (1).

### xAI / Grok
Present (same 18 Grok names as text; the earliest rows are 2024-08-28 because the subset starts then).

### Family model names (org-filtered; `[first-seen]` / `[first..last]`)
- **GPT/OpenAI** (org `openai`, 49 names): chatgpt-4o-latest [2024-08-28..2024-09-04], gpt-3.5-turbo-0125 [2024-08-28], gpt-3.5-turbo-1106 [2024-08-28], gpt-4-0125-preview [2024-08-28], gpt-4-0314 [2024-08-28], gpt-4-0613 [2024-08-28], gpt-4-1106-preview [2024-08-28], gpt-4-turbo-2024-04-09 [2024-08-28], gpt-4o-mini-2024-07-18 [2024-08-28], gpt-4o-2024-08-06 [2024-08-28], gpt-4o-2024-05-13 [2024-08-28], o1-mini [2024-09-17], o1-preview [2024-09-17], o1-2024-12-17 [2024-12-30], o3-mini [2025-02-06], o3-mini-high [2025-02-21], gpt-4.5-preview-2025-02-27 [2025-03-03], chatgpt-4o-latest-20250326 [2025-03-26], o3-2025-04-16 [2025-04-23], o4-mini-2025-04-16 [2025-04-23], gpt-4.1-2025-04-14 [2025-04-23], gpt-4.1-mini-2025-04-14 [2025-04-23], gpt-4.1-nano-2025-04-14 [2025-04-23], gpt-5-high [2025-08-07], gpt-oss-20b [2025-08-07], gpt-oss-120b [2025-08-07], gpt-5-mini-high [2025-08-14], gpt-5-chat [2025-08-14], gpt-5-nano-high [2025-08-14], gpt-5.1 [2025-11-16], gpt-5.1-high [2025-11-18], gpt-5.2-high [2025-12-16], gpt-5.2 [2025-12-18], gpt-5.2-chat-latest-20260210 [2026-02-16], gpt-5.3-chat-latest [2026-03-04], gpt-5.4 [2026-03-11], gpt-5.4-high [2026-03-11], gpt-5.4-nano-high [2026-03-18], gpt-5.4-mini-high [2026-03-18], gpt-5.5 [2026-04-27], gpt-5.5-high [2026-04-27], gpt-5.5-instant [2026-05-06], gpt-5.6-sol-xhigh [2026-07-10], gpt-5.6-terra-xhigh [2026-07-30], gpt-5.6-luna-xhigh [2026-07-30], gpt-6-astra-max [2026-09-11], gpt-6-sol-max [2026-09-25], gpt-6-luna-max [2026-09-25], gpt-6.1-sol-max [2026-10-02]
- **Claude** (org `anthropic`, 40 names): claude-3-5-sonnet-20240620 [2024-08-28], claude-3-haiku-20240307 [2024-08-28], claude-3-opus-20240229 [2024-08-28], claude-3-sonnet-20240229 [2024-08-28], claude-3-5-sonnet-20241022 [2024-10-28], claude-3-5-haiku-20241022 [2024-12-10], claude-3-7-sonnet-20250219 [2025-02-27], claude-3-7-sonnet-20250219-thinking-32k [2025-03-20], claude-sonnet-4-20250514 [2025-06-01], claude-opus-4-20250514 [2025-06-01], claude-opus-4-20250514-thinking-16k [2025-07-15], claude-sonnet-4-20250514-thinking-32k [2025-07-15], claude-opus-4-1-20250805 [2025-08-07], claude-opus-4-1-20250805-thinking-16k [2025-08-14], claude-sonnet-4-5-20250929 [2025-10-01], claude-sonnet-4-5-20250929-thinking-32k [2025-10-03..2026-08-11], claude-haiku-4-5-20251001 [2025-10-16], claude-opus-4-5-20251101-thinking-32k [2025-11-26..2026-08-11], claude-opus-4-5-20251101 [2025-11-26], claude-opus-4-6-thinking [2026-02-06..2026-08-11], claude-opus-4-6 [2026-02-06], claude-sonnet-4-6 [2026-02-19], claude-opus-4-7 [2026-04-17], claude-opus-4-7-thinking [2026-04-17..2026-08-11], claude-opus-4-8 [2026-06-03], claude-opus-4-8-thinking [2026-06-03..2026-08-11], claude-fable-5 [2026-06-10..2026-09-13], claude-sonnet-5-thinking [2026-07-02..2026-07-02], claude-sonnet-5-high [2026-07-02], claude-opus-5-high [2026-07-26], claude-opus-5-max [2026-07-27], claude-opus-4-7-high [2026-08-12], claude-opus-4-8-high [2026-08-12], claude-opus-4-6-high [2026-08-12], claude-opus-4-5-20251101-high-32k [2026-08-12], claude-sonnet-4-5-20250929-high-32k [2026-08-12], claude-fable-5.1-max [2026-09-02], claude-opus-5.5-high [2026-09-25], claude-fable-5-high [2026-09-25], claude-sonnet-5.5-xhigh [2026-10-02]
- **Gemini** (org `google`, 31 names): gemini-pro-dev-api [2024-08-28], gemini-1.5-flash-api-0514 [2024-08-28..2024-10-15], gemini-advanced-0514 [2024-08-28], gemini-1.5-pro-api-0514 [2024-08-28..2024-10-15], gemini-pro [2024-08-28], gemini-1.5-flash-002 [2024-10-07], gemini-1.5-flash-8b-001 [2024-10-07], gemini-1.5-pro-002 [2024-10-07], gemini-1.5-flash-001 [2024-10-23], gemini-1.5-pro-001 [2024-10-23], gemini-2.0-flash-001 [2025-02-05], gemini-2.0-flash-lite-preview-02-05 [2025-02-09], gemini-2.5-flash-lite-preview-06-17-thinking [2025-06-18], gemini-2.5-flash [2025-06-24], gemini-2.5-pro [2025-06-24], gemini-2.5-flash-preview-09-2025 [2025-09-30], gemini-2.5-flash-lite-preview-09-2025-no-thinking [2025-10-07], gemini-3-pro [2025-11-16], gemini-3-flash [2025-12-16], gemini-3-flash (thinking-minimal) [2026-01-27], gemini-3.1-pro-preview [2026-02-06], gemini-3.1-flash-lite-preview [2026-03-03], gemini-3.5-flash [2026-05-19..2026-07-02], gemini-3.5-flash-high [2026-07-10], gemini-3.5-flash-medium [2026-07-10], gemini-3.5-flash-lite [2026-07-21], gemini-3.6-flash [2026-07-21..2026-08-11], gemini-3.6-flash-high [2026-08-12], gemini-3.7-flash-high [2026-08-19], gemini-3.8-flash-high [2026-09-02], gemini-4-argon-high [2026-09-30]
- **Gemma** (org `google`, 13 names): gemma-1.1-2b-it [2024-08-28], gemma-1.1-7b-it [2024-08-28], gemma-2-27b-it [2024-08-28], gemma-2-2b-it [2024-08-28], gemma-2-9b-it [2024-08-28], gemma-2b-it [2024-08-28], gemma-7b-it [2024-08-28], gemma-3-27b-it [2025-03-11], gemma-3-12b-it [2025-05-05], gemma-3-4b-it [2025-05-05], gemma-3n-e4b-it [2025-05-20], gemma-4-26b-a4b [2026-03-31], gemma-4-31b [2026-03-31]
- **Grok** (org `xai`, 18 names): grok-2-2024-08-13 [2024-08-28], grok-2-mini-2024-08-13 [2024-08-28], grok-3-preview-02-24 [2025-03-03], grok-3-mini-beta [2025-06-01], grok-3-mini-high [2025-07-15], grok-4-0709 [2025-07-15], grok-4-fast-chat [2025-09-30], grok-4-fast-reasoning [2025-09-30], grok-4.1 [2025-11-16], grok-4.1-thinking [2025-11-16], grok-4-1-fast-reasoning [2025-11-26], grok-4.20-beta1 [2026-02-19], grok-4.20-beta-0309-reasoning [2026-03-16], grok-4.20-multi-agent-beta-0309 [2026-03-16], grok-4.3 [2026-05-01], grok-4.5 [2026-07-10], grok-4.6-high [2026-08-12], grok-4.7-xhigh [2026-09-25]
- **DeepSeek** (org `deepseek`, 24 names): deepseek-coder-v2 [2024-08-28], deepseek-llm-67b-chat [2024-08-28], deepseek-v2.5 [2024-09-15], deepseek-v2.5-1210 [2024-12-22], deepseek-v3 [2024-12-30], deepseek-r1 [2025-01-24], deepseek-v3-0324 [2025-03-30], deepseek-r1-0528 [2025-06-17], deepseek-v3.1-thinking [2025-08-27], deepseek-v3.1 [2025-08-27], deepseek-v3.1-terminus [2025-09-30], deepseek-v3.1-terminus-thinking [2025-09-30], deepseek-v3.2-exp [2025-10-03], deepseek-v3.2-exp-thinking [2025-10-07], deepseek-v3.2 [2025-12-04], deepseek-v3.2-thinking [2025-12-04], deepseek-v4-pro-thinking [2026-04-23..2026-07-30], deepseek-v4-flash [2026-04-23], deepseek-v4-flash-thinking [2026-04-23..2026-07-30], deepseek-v4-pro [2026-04-23], deepseek-v4-flash-high-preview [2026-08-02], deepseek-v4-pro-high-preview [2026-08-02], deepseek-v4-pro-high-20260813 [2026-08-19], deepseek-v4.1-flash-max [2026-09-25]
- **Qwen** (org `alibaba`, 42 names): qwen-14b-chat [2024-08-28], qwen1.5-110b-chat [2024-08-28], qwen1.5-14b-chat [2024-08-28], qwen1.5-32b-chat [2024-08-28], qwen1.5-4b-chat [2024-08-28], qwen1.5-72b-chat [2024-08-28], qwen1.5-7b-chat [2024-08-28], qwen2-72b-instruct [2024-08-28], qwen2.5-72b-instruct [2024-09-27], qwen-max-0919 [2024-10-15], qwen2.5-coder-32b-instruct [2024-11-20], qwq-32b-preview [2024-12-01], qwen2.5-plus-1127 [2024-12-22], qwen2.5-max [2025-02-03], qwen-plus-0125 [2025-02-14], qwq-32b [2025-03-15], qwen3-235b-a22b [2025-05-05], qwen3-30b-a3b [2025-05-19], qwen3-32b [2025-05-19], qwen3-235b-a22b-no-thinking [2025-06-17], qwen3-coder-480b-a35b-instruct [2025-07-28], qwen3-235b-a22b-thinking-2507 [2025-08-01], qwen3-235b-a22b-instruct-2507 [2025-08-01], qwen3-30b-a3b-instruct-2507 [2025-08-04], qwen3-max-preview [2025-09-08], qwen3-next-80b-a3b-instruct [2025-09-17], qwen3-next-80b-a3b-thinking [2025-09-17], qwen3-vl-235b-a22b-instruct [2025-09-30], qwen3-max-2025-09-23 [2025-09-30], qwen3-vl-235b-a22b-thinking [2025-09-30], qwen3.5-397b-a17b [2026-02-19], qwen3.5-122b-a10b [2026-02-26], qwen3.5-27b [2026-02-26], qwen3.5-35b-a3b [2026-02-26], qwen3.5-flash [2026-03-03], qwen3.5-max-preview [2026-03-16], qwen3.6-plus [2026-04-20], qwen3.6-max-preview [2026-04-30], qwen3.7-max-preview [2026-05-12], qwen3.7-plus [2026-06-03], qwen3.8-max [2026-08-02], qwen3.8-27b [2026-08-21]
- **Llama/Meta** (org `meta`, 23 names): codellama-34b-instruct [2024-08-28], llama-3.1-8b-instruct [2024-08-28], llama-3.1-405b-instruct [2024-08-28..2024-09-04], llama-3-8b-instruct [2024-08-28], llama-3-70b-instruct [2024-08-28], llama-3.1-70b-instruct [2024-08-28], llama-2-70b-chat [2024-08-28], llama-2-13b-chat [2024-08-28], llama-13b [2024-08-28], llama-2-7b-chat [2024-08-28], codellama-70b-instruct [2024-08-28], llama-3.1-405b-instruct-bf16 [2024-09-15], llama-3.1-405b-instruct-fp8 [2024-09-15], llama-3.2-3b-instruct [2024-09-27], llama-3.2-1b-instruct [2024-09-27], llama-3.3-70b-instruct [2024-12-15], llama-4-maverick-17b-128e-instruct [2025-04-09], llama-4-scout-17b-16e-instruct [2025-05-22], muse-spark [2026-04-09], muse-spark-1.1 [2026-07-10], muse-spark-1.2 (xHigh) [2026-08-06], muse-glimmer [2026-08-10], muse-spark-1.3-max [2026-09-13]
- **Mistral** (org `mistral`, 17 names): mistral-medium [2024-08-28], mixtral-8x22b-instruct-v0.1 [2024-08-28], mistral-large-2407 [2024-08-28], mistral-large-2402 [2024-08-28], mixtral-8x7b-instruct-v0.1 [2024-08-28], mistral-7b-instruct [2024-08-28], mistral-7b-instruct-v0.2 [2024-08-28], ministral-8b-2410 [2024-11-12], mistral-large-2411 [2024-12-01], mistral-small-24b-instruct-2501 [2025-02-11], mistral-medium-2505 [2025-05-19], mistral-small-3.1-24b-instruct-2503 [2025-05-19], magistral-medium-2506 [2025-06-24], mistral-small-2506 [2025-07-07], mistral-medium-2508 [2025-08-21], mistral-large-3 [2025-12-01], mistral-medium-3.5 [2026-06-03]

Same naming quirks and fine-tune exclusions as arena-text.

### Release date
None (first-seen proxy only; the subset starts 2024-08-28, so first-seen for older models is just the subset start).

### Fixture
`pipeline/test/fixtures/arena-text-style/sample.rows.json`: 178 rows, 57,584 B. Overall rows (top 8 + 2 per family) for 2024-08-28, 2025-01-05, 2025-05-11, 2025-05-19, 2025-11-05, 2026-04-02, 2026-08-12, 2026-10-02; plus top-5 `hard_prompts` for 2025-05-11 and 2025-05-19 (shows the +60 offset).

## arena-webdev

- Subset `webdev` (Code Arena, launched 2025-11-12; the older WebDev Arena history from 2024-2025 is NOT in this dataset).
- URLs: `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/webdev/full-00000-of-00001.parquet` (**1,185,756 B, 26,307 rows**, 27 row groups), `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/webdev/latest-00000-of-00001.parquet` (28,440 B, 595 rows: 539 rows dated 2026-10-06 for overall / webdev / webdev-html / webdev-react, plus 56 rows dated 2026-10-07 for image_to_webdev). Parquet.

### Schema (pyarrow, exact)
`model_name: string`, `organization: string`, `license: string`, `rating: double`, `rating_lower: double`, `rating_upper: double`, `variance: double`, `vote_count: int64`, `rank: int64`, `category: string`, `leaderboard_publish_date: string`.
No nulls. Distinct model names: 153.

### Example row (latest overall, 2026-10-06, rank 1)
```json
{"model_name": "claude-opus-5.5-max", "organization": "anthropic", "license": "Proprietary", "rating": 1813.6003351106383, "rating_lower": 1798.078141177708, "rating_upper": 1829.1225290435686, "variance": 62.72057458836915, "vote_count": 2229, "rank": 1, "category": "overall", "leaderboard_publish_date": "2026-10-06"}
```

### Categories (default = `overall`)
| category | rows | first date | #snapshots |
|---|---|---|---|
| `overall` | 7263 | 2025-11-12 | 94 |
| `webdev-html` | 6583 | 2026-02-26 | 71 |
| `webdev` | 6536 | 2026-02-26 | 70 |
| `webdev-react` | 5509 | 2026-02-26 | 71 |
| `image_to_webdev` | 416 | 2026-04-14 | 12 |

- `overall` only until 2026-02-24; `webdev`, `webdev-html`, `webdev-react` from 2026-02-26; `image_to_webdev` from 2026-04-14 (12 dates).
- Categories are sometimes published on their own dates: 6 dates have **no `overall`** (2026-07-17, 2026-08-24, 2026-08-25, 2026-09-13, 2026-10-07 = image_to_webdev only; 2026-08-04 = image_to_webdev + webdev-html + webdev-react). Filter on category before picking "the latest snapshot".

### Snapshots
- 100 dates, 2025-11-12 .. 2026-10-07 (94 with `overall`; last overall 2026-10-06). Gaps: min 1, median 3, max 15 days. Per month: 2025-11:6, 2025-12:7, 2026-01:3, 2026-02:9, 2026-03:7, 2026-04:10, 2026-05:8, 2026-06:7, 2026-07:14, 2026-08:13, 2026-09:13, 2026-10:3.
- All dates: 2025-11-12, 2025-11-16, 2025-11-17, 2025-11-21, 2025-11-25, 2025-11-26, 2025-12-01, 2025-12-04, 2025-12-11, 2025-12-16, 2025-12-22, 2025-12-23, 2025-12-29, 2026-01-09, 2026-01-24, 2026-01-29, 2026-02-01, 2026-02-06, 2026-02-09, 2026-02-12, 2026-02-17, 2026-02-19, 2026-02-20, 2026-02-24, 2026-02-26, 2026-03-03, 2026-03-04, 2026-03-12, 2026-03-16, 2026-03-18, 2026-03-20, 2026-03-26, 2026-04-02, 2026-04-09, 2026-04-14, 2026-04-17, 2026-04-20, 2026-04-21, 2026-04-22, 2026-04-23, 2026-04-27, 2026-04-28, 2026-05-01, 2026-05-04, 2026-05-05, 2026-05-07, 2026-05-12, 2026-05-14, 2026-05-19, 2026-05-25, 2026-06-03, 2026-06-05, 2026-06-10, 2026-06-15, 2026-06-16, 2026-06-18, 2026-06-21, 2026-07-02, 2026-07-09, 2026-07-10, 2026-07-12, 2026-07-16, 2026-07-17, 2026-07-20, 2026-07-21, 2026-07-24, 2026-07-26, 2026-07-27, 2026-07-28, 2026-07-30, 2026-07-31, 2026-08-01, 2026-08-02, 2026-08-04, 2026-08-06, 2026-08-10, 2026-08-11, 2026-08-12, 2026-08-14, 2026-08-19, 2026-08-21, 2026-08-24, 2026-08-25, 2026-08-30, 2026-09-01, 2026-09-02, 2026-09-04, 2026-09-05, 2026-09-08, 2026-09-11, 2026-09-13, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-29, 2026-09-30, 2026-10-01, 2026-10-06, 2026-10-07

### Rating columns and scale
BT rating; overall range 1075-1827; separate scale from text (not comparable). Strong upward drift of the top: max 1403 (2025-11-12) -> 1576 (2026-02-06) -> 1665 (2026-06-10) -> 1827 (2026-09-25); median 1314 -> 1444. vote_count 94..29,211. `rank` ordinal.

### Discontinuity around 2025-05-16
Not applicable (data starts 2025-11-12). No column changes within the subset.

### Organizations
`anthropic` (28m/4176r), `openai` (23m/4395r), `google` (17m/2826r), `alibaba` (14m/2633r), `deepseek` (10m/1510r), `xai` (9m/1739r), `zai` (9m/1507r), `moonshot` (7m/1458r), `xiaomi` (7m/1303r), `meta` (6m/470r), `minimax` (5m/1263r), `mistral` (4m/934r), `tencent` (3m/388r), `''` (empty string) (2m/397r), `poolside` (2m/332r), `thinky` (2m/206r), `inception-ai` (1m/266r), `ibm` (1m/194r), `bytedance` (1m/168r), `upstage` (1m/80r), `KwaiKAT` (1m/42r), `stepfun` (1m/20r)

Quirks: `''` for `KAT-Coder-Pro-V1` (was `KwaiKAT` until 2026-03-26) and `trinity-large-thinking`. Lowercase slugs for the big labs as in text. License values: `Proprietary` (99), `MIT` (26), `Apache 2.0` (18), `Modified MIT` (9), `MiniMax Community License` (1), `Kimi K3 license` (1), `tencent-hunyuan-community` (1), `Apache-2.0` (1), `qwen-community-1.0` (1).

### xAI / Grok
Present: 9 names including `grok-code-fast-1`.

### Family model names (org-filtered; `[first-seen]` / `[first..last]`)
- **GPT/OpenAI** (org `openai`, 23 names): gpt-5-medium [2025-11-16], gpt-5.1 [2025-11-16], gpt-5.1-codex [2025-11-21], gpt-5.1-codex-mini [2025-11-21], gpt-5.1-medium [2025-11-21], gpt-5.2 [2025-12-11], gpt-5.2-codex [2026-01-24], gpt-5.3-codex (codex-harness) [2026-03-03], gpt-5.4-high (codex-harness) [2026-03-12], gpt-5.4-medium (codex-harness) [2026-03-12], gpt-5.4-mini-high [2026-04-02], gpt-5.1-high [2026-04-14], gpt-5.5 (codex-harness) [2026-04-27], gpt-5.5-high (codex-harness) [2026-04-27], gpt-5.4 [2026-05-05], gpt-5.5-xhigh (codex-harness) [2026-05-14], gpt-5.6-sol-xhigh (codex-harness) [2026-07-10], gpt-5.6-luna-xhigh (codex-harness) [2026-07-30], gpt-5.6-terra-xhigh (codex-harness) [2026-07-30], gpt-6-astra-max [2026-09-05], gpt-6-sol-max [2026-09-23], gpt-6-luna-max [2026-09-24], gpt-6.1-sol-max [2026-09-30]
- **Claude** (org `anthropic`, 28 names): claude-sonnet-4-5-20250929-thinking-32k [2025-11-12..2026-08-11], claude-haiku-4-5-20251001 [2025-11-12], claude-opus-4-1-20250805 [2025-11-12], claude-sonnet-4-5-20250929 [2025-11-12], claude-opus-4-5-20251101 [2025-11-26], claude-opus-4-5-20251101-thinking-32k [2025-11-26..2026-08-11], claude-opus-4-6 [2026-02-06], claude-opus-4-6-thinking [2026-02-09..2026-08-11], claude-sonnet-4-6 [2026-02-19], claude-opus-4-7 [2026-04-17], claude-opus-4-7-thinking [2026-04-20..2026-08-11], claude-opus-4-8-thinking [2026-06-03..2026-08-11], claude-opus-4-8 [2026-06-03], claude-fable-5 [2026-06-10..2026-09-13], claude-sonnet-5-thinking [2026-07-02..2026-07-02], claude-sonnet-5-high [2026-07-09], claude-opus-5-high [2026-07-26], claude-opus-5-max [2026-07-27], claude-opus-4-7-high [2026-08-12], claude-opus-4-8-high [2026-08-12], claude-opus-4-6-high [2026-08-12], claude-opus-4-5-20251101-high-32k [2026-08-12], claude-sonnet-4-5-20250929-high-32k [2026-08-12], claude-fable-5.1-max [2026-09-02], claude-fable-5-high [2026-09-22], claude-opus-5.5-max [2026-09-23], claude-sonnet-5.5-high [2026-09-29], claude-sonnet-5.5-xhigh [2026-10-01]
- **Gemini** (org `google`, 15 names): gemini-2.5-pro [2025-11-12], gemini-3-pro [2025-11-16], gemini-3-flash [2025-12-16], gemini-3-flash (thinking-minimal) [2026-01-24], gemini-3.1-pro-preview [2026-02-09], gemini-3.1-flash-lite-preview [2026-03-03], gemini-3.5-flash [2026-05-19..2026-07-02], gemini-3.5-flash-medium [2026-07-09], gemini-3.6-flash [2026-07-21..2026-08-11], gemini-3.5-flash-lite [2026-07-26], gemini-3.5-flash-high [2026-08-04], gemini-3.6-flash-high [2026-08-12], gemini-3.7-flash-high [2026-08-14], gemini-3.8-flash-high [2026-09-02], gemini-4-argon-high [2026-09-30]
- **Gemma** (org `google`, 2 names): gemma-4-26b-a4b [2026-05-05], gemma-4-31b [2026-05-05]
- **Grok** (org `xai`, 9 names): grok-code-fast-1 [2025-11-12], grok-4-1-fast-reasoning [2025-11-25], grok-4.1-thinking [2025-11-25], grok-4-fast-reasoning [2025-12-01], grok-4.20-beta-0309-reasoning [2026-03-16], grok-4.3 [2026-05-01], grok-4.5 [2026-07-09], grok-4.6-high [2026-08-12], grok-4.7-xhigh [2026-09-22]
- **DeepSeek** (org `deepseek`, 10 names): deepseek-v3.2-exp [2025-11-16], deepseek-v3.2 [2025-12-16], deepseek-v3.2-thinking [2025-12-16], deepseek-v4-pro-thinking [2026-04-23..2026-07-30], deepseek-v4-pro [2026-07-02], deepseek-v4-flash-high [2026-07-31], deepseek-v4-flash-high-preview [2026-07-31], deepseek-v4-pro-high-preview [2026-07-31], deepseek-v4-pro-high-20260813 [2026-08-14], deepseek-v4.1-flash-max [2026-09-11]
- **Qwen** (org `alibaba`, 14 names): qwen3-coder-480b-a35b-instruct [2025-11-16], qwen3.5-397b-a17b [2026-02-24], qwen3.5-122b-a10b [2026-03-03], qwen3.5-27b [2026-03-03], qwen3.5-35b-a3b [2026-03-03], qwen3.5-flash [2026-03-03], qwen3.6-plus-preview [2026-04-02..2026-04-20], qwen3.6-plus [2026-04-20], qwen3.6-max-preview [2026-05-05], qwen3.7-max-20260517 [2026-05-25], qwen3.8-max [2026-08-02], qwen3.8-27b [2026-08-21], qwen3.8-flash-next [2026-08-30], qwen3.8-max-0902 [2026-09-01]
- **Llama/Meta** (org `meta`, 6 names): muse-spark [2026-04-22..2026-06-10], muse-spark-1.1 [2026-07-10], muse-spark-1.2 (xHigh) [2026-08-06], muse-glimmer [2026-08-10], muse-spark-1.3 (xHigh) [2026-09-04], muse-spark-1.3-max [2026-09-08]
- **Mistral** (org `mistral`, 4 names): devstral-medium-2507 [2025-11-16], mistral-large-3 [2025-12-11], devstral-2 [2026-01-29], mistral-medium-3.5 [2026-06-03]

- No Llama and no Gemma before Gemma 4; no Qwen below 3; Meta only via `muse-*`; Mistral via `devstral-*`, `mistral-large-3`, `mistral-medium-3.5`.
- OpenAI names may carry a harness tag in parentheses: `gpt-5.3-codex (codex-harness)`, `gpt-5.4-high (codex-harness)`, etc.

### Surprises
- **Duplicate keys**: `gpt-5.3-codex (codex-harness)` appears twice per (date, category) in every snapshot since 2026-05-05 (101 pairs, 202 rows) with different rating / votes / rank (e.g. 2026-05-05 overall: 1406.4 with 2,962 votes at rank 29, and 1372.8 with 3,540 votes at rank 45). Two distinct entries share one display name; the pipeline must dedupe (e.g. keep max rating) or key on (name, rank).
- `latest` spans two dates (per-category latest).

### Release date
None.

### Fixture
`pipeline/test/fixtures/arena-webdev/sample.rows.json`: 121 rows, 38,651 B. Overall (top 8 + 2 per family) for 2025-11-12, 2026-01-09, 2026-02-26, 2026-05-05 (+ both duplicate codex rows), 2026-08-12, 2026-10-06; top-5 `webdev-html` on 2026-10-06; top-4 `image_to_webdev` for the overall-less dates 2026-07-17 and 2026-10-07.

## arena-agent

- Subset `agent` exists (Agent Arena aggregate, launched 2026-06-04). Related per-signal subsets: `agent_bash_recovery_steps`, `agent_praise_complaint`, `agent_steerability`, `agent_task_outcome_explicit`, `agent_tool_hallucination` (same columns; `session_count` documented as aggregate-only).
- URLs: `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/agent/full-00000-of-00001.parquet` (**74,047 B, 1,530 rows**, 2 row groups), `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/agent/latest-00000-of-00001.parquet` (8,052 B, 50 rows, `2026-10-02`). Parquet.

### Schema (pyarrow, exact; different from the BT subsets)
`model_name: string`, `organization: string`, `license: string`, `score: double`, `score_ci_lower: double`, `score_ci_upper: double`, `observation_count: double`, `session_count: double`, `rank: int64`, `category: string`, `leaderboard_publish_date: string`.
- `observation_count` / `session_count` are float64 (int in the card).
- Nulls: `score_ci_lower`, `score_ci_upper`, `observation_count` null on all 18 rows of 2026-06-04; `session_count` null on 70 rows (2026-06-04, 06-12, 06-16).
- Distinct model names: 85. Duplicate keys: 0.

### Example row (latest, overall, rank 1)
```json
{"model_name": "Claude Fable 5.1 (Max)", "organization": "anthropic", "license": "Proprietary", "score": 0.14310371476177605, "score_ci_lower": 0.12415154304102166, "score_ci_upper": 0.16205588648253044, "observation_count": 1683381.0, "session_count": 15130.0, "rank": 1, "category": "overall", "leaderboard_publish_date": "2026-10-02"}
```

### Categories
Only `overall` (1,530 rows).

### Snapshots
- 36 dates, 2026-06-04 .. 2026-10-02. Gaps: min 1, median 3, max 11 days. Per month: 2026-06:5, 2026-07:8, 2026-08:11, 2026-09:11, 2026-10:1.
- All dates: 2026-06-04, 2026-06-12, 2026-06-16, 2026-06-18, 2026-06-29, 2026-07-06, 2026-07-07, 2026-07-08, 2026-07-13, 2026-07-20, 2026-07-21, 2026-07-27, 2026-07-28, 2026-08-03, 2026-08-06, 2026-08-11, 2026-08-12, 2026-08-13, 2026-08-18, 2026-08-19, 2026-08-24, 2026-08-27, 2026-08-30, 2026-08-31, 2026-09-01, 2026-09-05, 2026-09-08, 2026-09-10, 2026-09-14, 2026-09-15, 2026-09-24, 2026-09-25, 2026-09-27, 2026-09-28, 2026-09-30, 2026-10-02
- Rows per snapshot grow 18 -> 59 (2026-09-05), then drop to 43 on 2026-09-08 (16 models last seen 2026-09-05: list pruning), 50 at latest.

### Score columns and scale
`score` = IPS estimate (tau-hat), centred near 0: overall range -0.2514 .. 0.1587, median about 0.01; higher is better. CIs are 95%. Not comparable with BT ratings. `rank` ordinal by score. 2026-06-04 scores are rounded to 4 decimals.

### Discontinuity around 2025-05-16
Not applicable (starts 2026-06-04).

### Organizations
`anthropic` (15m/298r), `google` (15m/206r), `openai` (11m/230r), `xai` (6m/125r), `alibaba` (6m/112r), `moonshot` (6m/78r), `deepseek` (5m/94r), `zai` (4m/90r), `minimax` (4m/66r), `meta` (3m/52r), `thinky` (2m/45r), `tencent` (2m/37r), `xiaomi` (2m/30r), `nvidia` (1m/25r), `mistral` (1m/22r), `upstage` (1m/19r), `stepfun` (1m/1r)

All lowercase slugs; no `''`. License values: `Proprietary` (56), `MIT` (11), `Modified MIT` (7), `Apache 2.0` (6), `MiniMax Community License` (2), `OpenMDW-1.1` (1), `Kimi K3 license` (1), `qwen-community-1.0` (1).

### xAI / Grok
Present: `Grok 4.3`, `Grok 4.3 (High)`, `Grok Build 0.1`, `Grok 4.5`, `Grok 4.6 (xHigh)`, `Grok 4.7 (xHigh)`.

### Family model names (org-filtered; `[first-seen]` / `[first..last]`)
- **GPT/OpenAI** (org `openai`, 11 names): GPT 5.4 (High) [2026-06-04], GPT 5.5 [2026-06-04], GPT 5.5 (High) [2026-06-04..2026-09-05], GPT 5.5 (xHigh) [2026-06-12], GPT 5.6 Sol (xHigh) [2026-07-13], GPT 5.6 Luna (xHigh) [2026-07-27], GPT 5.6 Terra (xHigh) [2026-07-27], GPT 6 Astra (Max) [2026-09-08], GPT 6 Sol (Max) [2026-09-25], GPT 6 Luna (Max) [2026-09-28], GPT 6.1 Sol (Max) [2026-10-02]
- **Claude** (org `anthropic`, 15 names): Claude Opus 4.6 [2026-06-04..2026-09-05], Claude Opus 4.7 [2026-06-04..2026-09-05], Claude Opus 4.7 (Thinking) [2026-06-04..2026-08-11], Claude Sonnet 4.6 [2026-06-04..2026-09-15], Claude Fable 5 (High) [2026-06-12], Claude Opus 4.8 [2026-06-12..2026-09-05], Claude Opus 4.8 (Thinking) [2026-06-12..2026-08-11], Claude Sonnet 5 (High) [2026-07-06], Claude Opus 5 (High) [2026-07-28], Claude Opus 5 (Max) [2026-07-28], Claude Opus 4.7 (High) [2026-08-12..2026-09-05], Claude Opus 4.8 (High) [2026-08-12], Claude Fable 5.1 (Max) [2026-09-05], Claude Opus 5.5 (High) [2026-09-27], Claude Sonnet 5.5 (Max) [2026-10-02]
- **Gemini** (org `google`, 14 names): Gemini 3 Flash [2026-06-04..2026-09-05], Gemini 3.1 Pro Preview [2026-06-04], Gemini 3.5 Flash [2026-06-04..2026-06-29], gemini-3.5-flash [2026-07-06..2026-07-07], Gemini 3.5 Flash (High) [2026-07-08..2026-09-05], Gemini 3.5 Flash (Medium) [2026-07-08..2026-09-05], gemini-3.5-flash-lite [2026-07-27..2026-08-12], gemini-3.6-flash [2026-07-27..2026-08-11], gemini-3.6-flash-high [2026-08-12..2026-08-12], Gemini 3.5 Flash Lite [2026-08-13..2026-09-15], Gemini 3.6 Flash (High) [2026-08-13], Gemini 3.7 Flash (High) [2026-08-13], Gemini 3.8 Flash (High) [2026-09-01], Gemini 4 Argon (High) [2026-09-30]
- **Gemma** (org `google`, 1 names): Gemma 4 31B [2026-06-04..2026-09-05]
- **Grok** (org `xai`, 6 names): Grok 4.3 [2026-06-04..2026-09-05], Grok 4.3 (High) [2026-06-12..2026-09-05], Grok Build 0.1 [2026-06-12..2026-09-05], Grok 4.5 [2026-07-13], Grok 4.6 (xHigh) [2026-08-27], Grok 4.7 (xHigh) [2026-09-24]
- **DeepSeek** (org `deepseek`, 5 names): DeepSeek V4 Flash [2026-06-04..2026-08-13], DeepSeek V4 Pro [2026-06-04..2026-09-28], Deepseek V4 Flash (High) (20260731) [2026-08-03..2026-09-15], DeepSeek V4 Pro (High) (0813) [2026-08-19], Deepseek V4.1 Flash (Max) [2026-09-14]
- **Qwen** (org `alibaba`, 6 names): Qwen 3.6 Plus [2026-06-04..2026-07-07], Qwen3.7 Max [2026-07-08], Qwen3.7 Plus [2026-07-08], Qwen3.8 Max [2026-08-13], Qwen 3.8 27B [2026-08-27], Qwen3.8 Flash Next [2026-08-31]
- **Llama/Meta** (org `meta`, 3 names): Muse Spark 1.1 [2026-07-20], Muse Spark 1.2 (xHigh) [2026-08-24], Muse Spark 1.3 (Max) [2026-09-10]
- **Mistral** (org `mistral`, 1 names): Mistral Medium 3.5 [2026-08-06]

### Naming quirks (important)
- `model_name` uses **display names**, not slugs: Title Case with spaces and the effort level in parentheses (`Claude Opus 4.7 (Thinking)`, `GPT 5.6 Sol (xHigh)`, `Kimi K3 (Max)`), sometimes a date/build in a second parenthesis (`Deepseek V4 Flash (High) (20260731)`, `DeepSeek V4 Pro (High) (0813)`). These do not match the text/webdev slugs (`gpt-5.5-high` vs `GPT 5.5 (High)`); cross-source joins need a normaliser (lowercase; spaces and parentheses -> `-`).
- Inconsistent casing: `DeepSeek` vs `Deepseek`, `Mimo V2.5 Pro` vs `MiMo V2.6 Flash`, `Minimax M3`, `Qwen 3.6 Plus` vs `Qwen3.7 Max`.
- On some dates slugs leak in: `kimi-k2.6`, `kimi-k2.7-code`, `minimax-m2.7`, `minimax-m3` (2026-07-06 only), `gemini-3.5-flash` (07-06..07-07), `gemini-3.5-flash-lite` (07-27..08-12), `gemini-3.6-flash` (07-27..08-11), `gemini-3.6-flash-high` (08-12); the same models appear under display names on other dates.
- Meta only as `Muse Spark *`; Mistral only `Mistral Medium 3.5`; Gemma as `Gemma 4 31B`.

### Release date
None.

### Fixture
`pipeline/test/fixtures/arena-agent/sample.rows.json`: 108 rows, 35,179 B. Overall (top 8 + 2 per family) for 2026-06-04 (null CIs), 2026-06-16 (null session_count), 2026-07-06 (+ all slug-named rows), 2026-08-12, 2026-09-08 (post-pruning), 2026-10-02.

## Family patterns (arena)

Use org AND name together: name-only regexes catch third-party fine-tunes (`llama-3.1-tulu-3-*`, `*-nemotron-*`, `gemma-2-9b-it-simpo`, `*-mistral-7b` fine-tunes), while org values for the 8 families are clean lowercase slugs in all 4 subsets and never empty. Regexes below are case-insensitive and anchored; they handle both slug (`gpt-5.5-high`) and agent display (`GPT 5.5 (High)`) forms.

| Family | organization value(s) | name patterns seen | suggested regex (on `model_name`, flag i) |
|---|---|---|---|
| GPT / OpenAI | `openai` | `gpt-3.5-turbo-*`, `gpt-4-*`, `gpt-4-turbo-*`, `gpt-4o-*`, `gpt-4.1*`, `gpt-4.5-preview-*`, `chatgpt-4o-latest[-YYYYMMDD]`, `o1-*`, `o1-mini`, `o1-preview`, `o3-*`, `o3-mini[-high]`, `o4-mini-*`, `gpt-5*` (`-high`, `-chat`, `-mini-high`, `-nano-high`, `-codex`, `(codex-harness)`, `-chat-latest`), `gpt-5.6-{sol,luna,terra}-xhigh`, `gpt-6[.1]-{astra,sol,luna}-max`, `gpt-oss-20b/120b`; agent: `GPT 5.5 (High)`, `GPT 6 Astra (Max)` | `^(gpt[- ](?!4all)\|chatgpt-\|o[134](-\|$\| ))` + org `openai`; optionally exclude open weights `^gpt-oss-` |
| Claude | `anthropic` | `claude-3-{opus,sonnet,haiku}-YYYYMMDD`, `claude-3-5-*`, `claude-3-7-sonnet-*[-thinking-32k]`, `claude-{opus,sonnet,haiku}-4[-N]-YYYYMMDD[-thinking-16k/-32k\|-high-32k]`, `claude-opus-4-6..4-8[-thinking\|-high]`, `claude-{opus,sonnet}-5[.5]-{high,max,xhigh,thinking}`, `claude-fable-5[-high]`, `claude-fable-5.1-max`; agent: `Claude Opus 4.7 (Thinking)`, `Claude Fable 5.1 (Max)` | `^claude[- ]` + org `anthropic` |
| Gemini | `google` | `gemini-pro`, `gemini-pro-dev-api`, `gemini-advanced-0514`, `gemini-1.5-{pro,flash}-{api-0514,001,002}`, `gemini-1.5-flash-8b-001`, `gemini-2.0-flash-001`, `gemini-2.0-flash-lite-preview-02-05`, `gemini-2.5-{pro,flash}`, `gemini-2.5-flash[-lite]-preview-*`, `gemini-3-{pro,flash}`, `gemini-3-flash (thinking-minimal)`, `gemini-3.1-*-preview`, `gemini-3.5..3.8-flash[-high/-medium/-lite]`, `gemini-4-argon-high`; agent: `Gemini 3.1 Pro Preview`, `Gemini 4 Argon (High)` | `^gemini[- ]` + org `google` (keep `palm-2` out, or map it to a "Google pre-Gemini" bucket) |
| Gemma (separate) | `google` | `gemma-{2b,7b}-it`, `gemma-1.1-*-it`, `gemma-2-{2b,9b,27b}-it`, `gemma-3-{4b,12b,27b}-it`, `gemma-3n-e4b-it`, `gemma-4-26b-a4b`, `gemma-4-31b`; agent: `Gemma 4 31B` | `^gemma[- ]` + org `google` (excludes `gemma-2-9b-it-simpo`) |
| Grok | `xai` | `grok-2[-mini]-2024-08-13`, `grok-3-preview-02-24`, `grok-3-mini-{beta,high}`, `grok-4-0709`, `grok-4-fast-{chat,reasoning}`, `grok-4-1-fast-reasoning`, `grok-4.1[-thinking]`, `grok-4.20-*`, `grok-4.3`, `grok-4.5`, `grok-4.6-high`, `grok-4.7-xhigh`, `grok-code-fast-1`; agent: `Grok 4.3 (High)`, `Grok Build 0.1` | `^grok[- ]` + org `xai` |
| DeepSeek | `deepseek` | `deepseek-llm-67b-chat`, `deepseek-coder-v2`, `deepseek-v2.5[-1210]`, `deepseek-v3[-0324]`, `deepseek-r1[-0528]`, `deepseek-v3.1[-terminus][-thinking]`, `deepseek-v3.2[-exp][-thinking]`, `deepseek-v4-{pro,flash}[-thinking\|-high\|-high-preview\|-high-20260813]`, `deepseek-v4.1-flash-max`; agent: `DeepSeek V4 Pro`, `Deepseek V4.1 Flash (Max)` | `^deepseek[- ]` + org `deepseek` |
| Qwen | `alibaba` | `qwen-14b-chat`, `qwen1.5-*-chat`, `qwen2-72b-instruct`, `qwen2.5-*`, `qwen-max-0919`, `qwen-plus-0125`, `qwq-32b[-preview]`, `qwen3-*` (`-235b-a22b`, `-instruct-2507`, `-thinking-2507`, `-no-thinking`, `-coder-*`, `-next-*`, `-vl-*`, `-max-preview`, `-max-2025-09-23`), `qwen3.5..3.8-*` (`-max-preview`, `-plus`, `-flash`, `-max-0902`, `-max-20260517`); agent: `Qwen 3.6 Plus`, `Qwen3.8 Max` | `^(qwen\|qwq)` + org `alibaba` |
| Llama / Meta | `meta` | `llama-13b`, `llama-2-{7b,13b,70b}-chat`, `codellama-{34b,70b}-instruct`, `llama-3-{8b,70b}-instruct`, `llama-3.1-{8b,70b,405b}-instruct[-bf16\|-fp8]`, `llama-3.2-{1b,3b}-instruct`, `llama-3.3-70b-instruct`, `llama-4-{maverick,scout}-*`, then proprietary `muse-spark[-1.1\|-1.2 (xHigh)\|-1.3 (xHigh)\|-1.3-max]`, `muse-glimmer`; agent: `Muse Spark 1.3 (Max)` | `^(llama\|codellama\|muse[- ])` + org `meta` (excludes nvidia nemotron / Ai2 tulu Llama fine-tunes); split Llama vs Muse with `^muse` if needed |
| Mistral | `mistral` | `mistral-7b-instruct[-v0.2]`, `mixtral-8x7b/8x22b-instruct-v0.1`, `mistral-medium[-2505\|-2508\|-3.5]`, `mistral-large-{2402,2407,2411,3}`, `mistral-small-*`, `ministral-8b-2410`, `magistral-medium-2506`, `devstral-medium-2507`, `devstral-2`; agent: `Mistral Medium 3.5` | `^(mistral\|mixtral\|magistral\|ministral\|codestral\|devstral\|pixtral)` + org `mistral` |

(In the table, `\|` is a markdown-escaped `|`; the actual regexes use plain `|`.)

Normalisation tip for cross-source joins: lowercase; replace ` (`, `)` and spaces with `-`; collapse repeated `-`; strip a trailing `-`; alias `-thinking` and `-high` (2026-08-12 rename); for family-level grouping only, strip date suffixes matching `-(\d{8}|\d{4}-\d{2}-\d{2}|\d{4}|\d{2}-\d{2})$`.
