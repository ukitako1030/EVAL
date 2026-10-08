# Data-source recon: GitHub-hosted leaderboards (swebench / aider / tau2)

Recon date: 2026-10-08. All fetches done with curl (raw.githubusercontent.com) plus authenticated `gh api`
(account was logged in, so 5000 req/h; used about 90 API calls in total). Raw downloads and
intermediate files are in `scratchpad/recon-llm/gh/`.

---

## swebench

### URLs
- Works: `https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json`
  (HTTP 200, 4,091,442 bytes, `Cache-Control: max-age=300`, strong `ETag` so conditional GET works).
- 404: the same path on `main`, and `https://www.swebench.com/data/leaderboards.json` (the site is built
  from Jinja templates, so the JSON is not served from the site).
- Default branch is `master`. Repo: `SWE-bench/swe-bench.github.io`, last push 2026-09-01.
- Other files in the same directory: `data/info_for_leaderboard.json` (175 KB). It holds per-instance
  results for 4 blog-post models (`gpt-5`, `gpt-5-mini`, `sonnet-4`, `sonnet-4-5`) and is not needed.
  `js/modelReleaseDates.js` maps `Model:` tag ids to release dates (YYYYMMDD ints), with source URLs in comments.

### Format and top-level structure
```
{ "leaderboards": [ { "name": <str>, "results": [ <entry>, ... ] }, ... ] }
```
The file is pretty-printed JSON with 2-space indent. There are 5 boards, in this order:

| board | entries | mini-SWE-agent rows | max `date` |
|---|---|---|---|
| Multilingual | 13 | 13 (all) | 2026-02-20 |
| Test | 24 | 0 | 2025-12-19 |
| Verified | 180 | 47 | 2026-02-26 |
| Lite | 84 | 0 | 2025-09-11 |
| Multimodal | 22 | 0 | 2025-11-17 |

Within each board, results are sorted by `resolved` descending (checked on Verified).

### Fields per entry (Verified; types as observed)
| field | type | notes |
|---|---|---|
| `name` | str | Display name. Mini rows: `"<Model display> (<date or version>) (<effort>)"`, e.g. `"GPT 5.2 (2025-12-11) (high)"`, `"Claude 4.5 Opus (high)"`. Other rows: `"<agent> + <model>"` free text. |
| `agent` | str | Scaffold. **`"mini-SWE-agent"` identifies Mini rows** (47 on Verified). |
| `agent_org` | str/null | `"SWE-agent"` for every Mini row. |
| `model_display` | str | Clean model name, e.g. `"Claude 4.5 Opus"`, `"GPT 5 mini"`, `"Gemini 3 Pro Preview"`. Can be `"Multiple"` or `"Undisclosed"` on other rows. |
| `model_org` | str/null | Model vendor, e.g. `Anthropic`, `OpenAI`, `Google DeepMind`, `Qwen`, `Meta`, `Moonshot AI`. Null on 31 non-Mini rows. Inconsistent casing and spelling: `Z.ai`/`Z-AI`, `DeepSeek`/`deepseek`, `Mistral`/`mistral`, `Minimax`. |
| `resolved` | float | **Score: % of instances resolved, on a 0-100 scale** (range 0.4 to 79.2). For Mini rows it equals 100 × resolved/500 from `per_instance_details`. |
| `date` | str `YYYY-MM-DD` | Submission/run date. Always equals the `folder` prefix (YYYYMMDD). This is not the model release date. |
| `model_release_date` | int YYYYMMDD / null | Model release date, e.g. `20251124`. **Present (non-null) only on Mini rows** (47/47) and on Multilingual. |
| `folder` | str | e.g. `20260217_mini-v2.0.0_claude-4-5-opus-high`. On every board, `^\d{8}_mini-v` matches exactly the Mini rows. Do not parse further: 4 early v0.0.0 rows use `-` instead of `_` after the version, and Multilingual uses `mini-v2.0.0a0_...`. |
| `mini-swe-agent_version` | str | Present only on Mini rows (47). Values: `0.0.0`, `1.0.0`, `1.7.0`, `1.9.1`, `1.13.3`, `1.15.0`, `1.16.0`, `1.17.0-1.17.2`, `2.0.0`. The site warns that 1.x and 2.x results are not comparable (2.x uses tool calling). |
| `tags` | list[str] | Prefixes: `Model: <api id>` (196, so some rows have several), `Org: <org>` (134), `System: Attempts - 1|2|2+` (180), `Mini: <version>` (47, exactly the Mini rows), `Model_size: ...` (1). |
| `reasoning_effort` | str/null | `high` (11), `medium` (7), null. |
| `os_model` | bool | Open-weights model flag. |
| `os_system` | bool | Open scaffold flag (true for all Mini rows). |
| `checked` | bool / null / str | Mixed: True 60, False 97, None 17, and 6 rows with the string `"false (See README.md for info on how to get your results verified)"`. **Coerce carefully.** |
| `cost` | float/int/null | Total USD (Mini rows only). |
| `instance_cost`, `instance_calls` | float/null | Per-instance averages (Mini rows). |
| `per_instance_details` | dict | Present on 40 of 47 Verified Mini rows. `{instance_id: {resolved: bool, cost: float, api_calls: int}}`, 500 keys, about 44 KB per row. This field is most of the 4 MB. |
| `logs`, `trajs` | str/null | `s3://swe-bench-submissions/...` paths. |
| `trajs_docent` | str/bool | URL string or `false`. |
| `site` | str / list[str] / null | One row has a list. |
| `logo` | list[str]/null | |
| `warning` | null | Always null. |

The other boards (Test, Lite, Multimodal) have the same keys, but `cost`, `instance_*` and
`model_release_date` are always null there, and `logs`/`trajs` are sometimes bool.

### Identifying "Mini" rows (bash-only / mini-SWE-agent)
Any of these works on the current file. All give the same 47 rows on Verified:
1. `agent == "mini-SWE-agent"` (this is what the site JS uses: `MINI_SWE_AGENT` in `js/mainResults.js`).
2. Any tag starting with `"Mini: "`.
3. The `mini-swe-agent_version` key is present.

There is **no `Mini:` name prefix** in the current file. History matters if you ever read old commits:
- Until 2026-09-01 there was a separate board, `"bash-only"`, holding the same 47 Mini rows. Commit
  `193160a` ("Drop bash-only board; show mini icon alongside model logo") removed it.
- Mini rows have been cross-listed on Verified since 2025-07-31. In commits before about 2026-08 they had **no
  `agent`/`model_display`/`model_org` fields, no `Mini:` tag, and the name was prefixed `"mini-SWE-agent + "`**
  (e.g. `"mini-SWE-agent + Claude 4.5 Opus medium (20251101)"`, with tags including `Org: SWE-agent`).
  The folder regex `^\d{8}_mini-v` is the only identifier that works across all versions.
- The file has had 75 commits since 2025-05-07.

### Distinct models among Verified Mini rows (47 rows, 42 distinct `model_display`)
`model_display` (with `Model:` tag in parentheses):
- OpenAI: GPT 4o (gpt-4o-20241120), GPT 4.1 (gpt-4.1-20250414), GPT 4.1 mini (gpt-4.1-mini-20250414), o3 (o3-20250416),
  o4-mini (o4-mini-20250416), GPT 5 (gpt-5-2025-08-07), GPT 5 mini x2 (gpt-5-mini-2025-08-07), GPT 5 nano
  (gpt-5-nano-2025-08-07), gpt-oss-120b (gpt-oss-120b), GPT 5.1 (gpt-5.1-2025-11-13), GPT 5.1 Codex (gpt-5.1-codex),
  GPT 5.2 x3 (gpt-5.2-2025-12-11, gpt-5-2), GPT 5.2 Codex (gpt-5-2-codex)
- Anthropic: Claude 3.7 Sonnet (claude-3-7-sonnet-20250219), Claude 4 Sonnet (claude-4-sonnet-20250514),
  Claude 4 Opus (claude-4-opus-20250514), Claude 4.5 Sonnet x2 (claude-sonnet-4-5-20250929), Claude 4.5 Opus x2
  (claude-opus-4-5-20251101, claude-4-5-opus), Claude 4.5 Haiku (claude-haiku-4-5-20251001), Claude 4.6 Opus (claude-opus-4-6)
- Google DeepMind: Gemini 2.0 Flash, Gemini 2.5 Flash, Gemini 2.5 Pro, Gemini 3 Pro Preview (gemini-3-pro-preview),
  Gemini 3 Pro (also tagged gemini-3-pro-preview), Gemini 3 Flash (gemini-3-flash-preview)
- Meta: Llama 4 Maverick Instruct, Llama 4 Scout Instruct
- Qwen: Qwen2.5-Coder 32B Instruct, Qwen3-Coder 480B/A35B Instruct
- DeepSeek: DeepSeek V3.2 Reasoner (deepseek-v3.2-reasoner), DeepSeek V3.2 (deepseek-v3.2)
- Mistral: Devstral (2512), Devstral Small (2512)
- Others: Kimi K2 Instruct, Kimi K2 Thinking, Kimi K2.5 (Moonshot AI); GLM 4.5, GLM 4.6, GLM 5 (Z.ai / Z-AI);
  MiniMax M2, MiniMax M2.5 (Minimax)
- **No Grok on SWE-bench**, on any board.
- Duplicate `model_display` among Mini rows (different effort or harness version): GPT 5.2 (3), Claude 4.5 Opus (2),
  Claude 4.5 Sonnet (2), GPT 5 mini (2). The pipeline must pick one per model (max or latest).
- The full set of `Model:` tags across Verified is 102 values. Some are messy, e.g. `https://huggingface.co/Qwen/...`,
  `openai/gpt-5-2025-08-07`, `moonshot/kimi-k2-0711-preview`, `Qwen 2.5`, `Llama 3.1`.
  The full list is in `gh/family-names.json`.

### Example Mini row (Verified; `per_instance_details` cut to 2 keys)
```json
{
  "agent": "mini-SWE-agent", "agent_org": "SWE-agent", "checked": null,
  "cost": 376.9539985, "date": "2026-02-17",
  "folder": "20260217_mini-v2.0.0_claude-4-5-opus-high",
  "instance_calls": 32.896, "instance_cost": 0.753907997,
  "logo": ["img/logos/20260217_mini-v2.0.0_claude-4-5-opus-high.jpg", "img/mini-icon.svg"],
  "logs": null, "mini-swe-agent_version": "2.0.0",
  "model_display": "Claude 4.5 Opus", "model_org": "Anthropic", "model_release_date": 20251124,
  "name": "Claude 4.5 Opus (high)", "os_model": false, "os_system": true,
  "per_instance_details": {"astropy__astropy-12907": {"api_calls": 32, "cost": 0.7220905000000003, "resolved": true},
                           "astropy__astropy-13033": {"api_calls": 56, "cost": 0.9606260000000003, "resolved": true}},
  "reasoning_effort": "high", "resolved": 76.8, "site": "https://www.anthropic.com/claude",
  "tags": ["Model: claude-4-5-opus", "Org: Anthropic", "System: Attempts - 1", "Mini: 2.0.0"],
  "trajs": "s3://swe-bench-submissions/bash-only/20260217_mini-v2.0.0_claude-4-5-opus-high/trajs",
  "trajs_docent": "https://docent.transluce.org/dashboard/b038912e-0133-4594-b093-92806f8ffb17",
  "warning": null
}
```

### Date semantics
- `date` is the submission/run date (it matches the folder prefix). Use it to assign a row to a month.
- `model_release_date` is the model release date (Mini rows only). It is useful for "best model released by month X".
- The file is a cumulative snapshot. Rows are only ever added or renamed; there is no per-month history inside it.
  Git history (75 commits) can rebuild past snapshots, but the schema changed over time (see above).

### Rate limits / auth
None needed: one 4 MB raw GET per run. Use `If-None-Match` with the ETag. raw.githubusercontent.com is
subject to GitHub's unauthenticated limits but is fine at this volume.

### Licence verdict
`LICENSE` in the repo is the full **Creative Commons Attribution-NonCommercial 4.0 International** legal code
(first line: "Attribution-NonCommercial 4.0 International"). GitHub's API reports it as `other/NOASSERTION`
because it is not an OSI licence. The site footer and README do not mention a licence. **This confirms CC BY-NC 4.0:**
attribution is required and commercial use is not allowed. (The SWE-bench dataset itself is a separate repo and is not covered here.)

### Surprises
- **The data is stale: the newest row on any board is dated 2026-02-26.** The 2026-08/09 commits only restyled and
  restructured the file; no new results were added after Feb 2026. Expect no SWE-bench signal for Mar-Oct 2026.
- The `bash-only` board was removed on 2026-09-01, so code that looks for it will break. Use Verified plus `agent`.
- `checked` has mixed types (bool, null and a long string).
- `per_instance_details` makes the file 4 MB. Strip it on ingest.
- The `trajs` path still says `bash-only`.

### Fixture
`pipeline/test/fixtures/swebench/sample.json` (95 KB): same top-level `{"leaderboards":[...]}` and the same
board order. **Verified keeps all 47 Mini rows plus 7 non-Mini rows** (top score, oldest, newest, median date,
`model_org` null, string `checked`, list `site`, multi-`Model:` tags), 54 rows in original order.
`per_instance_details` is kept on one Mini row (`20260217_mini-v2.0.0_claude-4-5-opus-high`) but **cut to its
first 100 of 500 instances**. It was removed from all other rows. Multilingual, Test, Lite and Multimodal are
**cut to their first 2 entries each** (Multilingual entries had `per_instance_details` removed).

---

## aider-edit

### URL
- Works: `https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/edit_leaderboard.yml`
  (HTTP 200, 56,178 bytes). Repo default branch is `main`.
- Rendered at aider.chat/docs/leaderboards/edit.html. The table is sorted by `pass_rate_2` descending.

### Format
YAML with a top-level list of 98 mappings. Each entry starts with `- dirname:` at column 0, and entries are separated by a blank line.
**Mixed line endings:** one entry (`ollama/granite3-dense:8b`, 14 lines) uses CRLF; the rest use LF. The file has no trailing newline.

### Fields (count of 98, type after `yaml.safe_load`)
| field | n | type | notes |
|---|---|---|---|
| `dirname` | 98 | str | `YYYY-MM-DD-HH-MM-SS--<slug>`. The date prefix always equals `date`. |
| `test_cases` | 98 | int | 133 normally. Partial runs: 132 (x2), 36 (`o1-mini`), 33 (`gpt-4-turbo-2024-04-09 (diff)`), 225 (x1). |
| `model` | 98 | str | Free text label (see naming). |
| `edit_format` | 98 | str | whole 63, diff 29, diff-fenced 3, udiff 3 |
| `commit_hash` | 98 | str (96) / **int (2)** | Hex short SHAs. `5318380` and similar parse as int, and something like `1234e56` could parse as a float. Read as string. |
| `pass_rate_1` | 98 | float | % passing on first attempt (0-100). |
| `pass_rate_2` | 98 | float | **Headline score**: % passing after one retry with test feedback (0-100). Used by the site for sort and bars. Range 14.3-84.2. |
| `percent_cases_well_formed` | 98 | float | |
| `error_outputs`, `num_malformed_responses`, `num_with_malformed_responses`, `user_asks`, `lazy_comments`, `syntax_errors`, `indentation_errors`, `exhausted_context_windows`, `test_timeouts` | 75-98 | int | Optional diagnostics. |
| `command` | 98 | str | e.g. `aider --model openrouter/x-ai/grok-2`. Carries a provider-prefixed model id, which is useful for family mapping. Can be prose: `(via glhf.chat)`, `(not currently supported)`. |
| `date` | 98 | **YAML date** (`datetime.date`) | Benchmark run date. Unquoted `YYYY-MM-DD`, so loaders return a date object (js-yaml returns a `Date`). |
| `versions` | 98 | str | aider version, e.g. `0.59.2.dev`. |
| `seconds_per_case` | 98 | float | |
| `total_cost` | 97 | float | Often `0.0000` (unknown). |
| `released` | 30 | YAML date | **Model release date** (when present). |
| `_released` | 10 | YAML date | Same as `released` but underscore-prefixed (disabled). Treat it as a release date if wanted. |
| `pass_num_1`, `pass_num_2`, `total_tests` | 1 | int | Only on one entry. |

### Example entry (verbatim text)
```yaml
- dirname: 2024-10-22-17-45-28--sonnet-1022-diff-fixed-model-settings
  test_cases: 133
  model: claude-3-5-sonnet-20241022
  released: 2024-10-22
  edit_format: diff
  commit_hash: 3b14eb9
  pass_rate_1: 69.2
  pass_rate_2: 84.2
  percent_cases_well_formed: 99.2
  error_outputs: 1
  num_malformed_responses: 1
  num_with_malformed_responses: 1
  user_asks: 0
  lazy_comments: 1
  syntax_errors: 0
  indentation_errors: 0
  exhausted_context_windows: 0
  test_timeouts: 0
  command: aider --model anthropic/claude-3-5-sonnet-20241022
  date: 2024-10-22
  versions: 0.59.2.dev
  seconds_per_case: 18.6
  total_cost: 0.0000
```

### Date range and freshness
- `date` runs from 2023-11-06 to 2024-12-21. File order is not chronological (the first entry is 2024-05-01).
- **Last commit to the file: 2024-12-22** ("copy", Paul Gauthier). **The leaderboard has been frozen since Dec 2024**
  and was superseded by polyglot. The aider repo itself was last pushed 2026-05-22.

### Model naming
Free text that mixes conventions:
- API ids: `claude-3-5-sonnet-20241022`, `gpt-4o-2024-08-06`, `gemini-1.5-pro-002`
- Pretty names: `DeepSeek Coder V2 0724`, `Mistral Large 2 (2407)`, `Qwen2 72B Instruct`, `Grok-2`, `Nova Pro`
- Ollama/OpenRouter prefixes: `ollama/qwen2.5-coder:32b`, `openrouter/qwen/qwen-2.5-coder-32b-instruct`, `openai/chatgpt-4o-latest`
- Suffixes for the edit format: `(diff)`, `(whole)`, `(udiff)`, `(bf16)`
- Local quantised variants: `codestral:22b-v0.1-q8_0`, `Codestral-22B-v0.1-Q4_K_M`

Distinct `model` values per family (98 total):
- GPT/OpenAI (20): gpt-3.5-turbo-0301/0613/1106/0125, gpt-4-0314, gpt-4-0613, gpt-4-1106-preview, gpt-4-0125-preview,
  gpt-4-turbo-2024-04-09 (diff|udiff), gpt-4o-2024-05-13/08-06/11-20, gpt-4o-mini, openai/chatgpt-4o-latest, o1-preview,
  o1-mini, o1-mini (whole), o1-mini-2024-09-12, o1
- Claude (6): claude-3-opus-20240229, claude-3-sonnet-20240229, claude-3-haiku-20240307, claude-3.5-sonnet-20240620,
  claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022
- Gemini (13): gemini-1.5-pro-001/002, gemini-1.5-pro-exp-0827, gemini-1.5-flash-latest, gemini-1.5-flash-exp-0827,
  gemini-1.5-flash-002 (0924), gemini-1.5-flash-8b-exp-0827/0924, gemini-exp-1114/1121, gemini-exp-1206 (diff|whole), gemini-2.0-flash-exp
- Grok (2): Grok-2, Grok-2-mini
- DeepSeek (4): DeepSeek Chat V2 0628, DeepSeek Coder V2 0724, DeepSeek V2.5, DeepSeek-V2.5-1210
- Qwen (18): qwen1.5-110b-chat, Qwen2 72B Instruct, qwen2:72b-instruct-q8_0, codeqwen:7b-chat-v1.5-q8_0,
  qwen-2.5-72b-instruct (bf16), ollama/qwen2.5:32b, ollama/qwen2.5:32b-instruct-q8_0, Qwen2.5-Coder-{0.5B,1.5B,3B,7B,14B,32B}-Instruct,
  qwen2.5-coder:7b-instruct-q8_0, ollama/qwen2.5-coder:14b, ollama/qwen2.5-coder:32b, ollama/Qwen2.5.1-Coder-7B-Instruct-GGUF:Q8_0-32k,
  openrouter/qwen/qwen-2.5-coder-32b-instruct
- Llama (7 direct): llama3-70b-8192, llama-3.1-405b-instruct (diff|whole), llama-3.1-70b-instruct, llama-3.1-8b-instruct,
  llama-3.3-70b-instruct, ollama/llama3.2:3b-instruct-fp16. Fine-tunes that contain "llama" but are not Meta:
  nousresearch/hermes-3-llama-3.1-405b, ollama/hermes3:8b-llama3.1-fp16, Llama-3.1-Nemotron-70B-Instruct-HF.
  `Reflection-70B` is also a Llama fine-tune.
- Mistral (8): codestral-2405, codestral:22b-v0.1-q8_0, Codestral-22B-v0.1-Q4_K_M, ollama/codestral, Mistral Large 2 (2407),
  Mistral Large (2411), ollama/mistral-nemo:12b-instruct-2407-q4_K_M, ollama/mistral-small. (`WizardLM-2 8x22B` is a Mixtral fine-tune.)
- Other: command-r-plus, Command R(+) (08-24), Yi Coder 9B Chat, yi-coder (2), yi-lightning, gemma2:27b, codegeex4,
  granite3-dense, tulu3, hermes3, opencodeinterpreter, Dracarys2-72B-Instruct (Qwen fine-tune), Nova Pro, Reflection-70B, WizardLM-2 8x22B

### Rate limits / auth
None: one raw GET.

### Licence verdict
The repo `LICENSE.txt` is **Apache License 2.0** (GitHub API: `apache-2.0`). The data file lives in the repo, so Apache-2.0
applies. Attribution and NOTICE rules apply; commercial use is fine.

### Surprises
- The leaderboard has been frozen since 2024-12-22, so it only gives history (Nov 2023 to Dec 2024).
- There are duplicate or near-duplicate models (several edit formats per model). Pick the max `pass_rate_2` per model.
- `released` exists only for 30 rows (plus 10 `_released`).
- Partial runs (`test_cases` < 133) should probably be dropped.
- Mixed CRLF/LF line endings.

### Fixture
`pipeline/test/fixtures/aider-edit/sample.yml` (15 KB, 27 entries). The entry blocks are copied byte-for-byte from
the original, in original order, including the CRLF granite3 entry, both int `commit_hash` entries, both partial runs
(`o1-mini` 36 cases, `gpt-4-turbo... (diff)` 33 cases), and the original's missing final newline. Dates span
2023-11-06 to 2024-12-21. Families covered: GPT, o1, Claude, Gemini, Grok, DeepSeek, Qwen, Llama, Mistral, Cohere, Nova, granite.

---

## aider-polyglot

### URL
- Works: `https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml`
  (HTTP 200, 45,725 bytes). This is the main aider leaderboard (aider.chat/docs/leaderboards/), sorted by `pass_rate_2` desc.

### Format
YAML list of 69 mappings in the same block style as edit. LF only, with a trailing newline.

### Fields (count of 69)
| field | n | type | notes |
|---|---|---|---|
| `dirname` | 69 | str | `YYYY-MM-DD-HH-MM-SS--slug`. The prefix equals `date`. |
| `test_cases` | 69 | int | 225 (63), 224 (5), 223 (1) |
| `model` | 69 | str | Free text (see below) |
| `edit_format` | 69 | str | diff 47, whole 15, diff-fenced 4, architect 3 |
| `editor_model`, `editor_edit_format` | 3 | str | Only for `architect` runs (two-model combos) |
| `commit_hash` | 69 | str (68) / int (1) | Same int-coercion quirk as edit |
| `pass_rate_1`, `pass_rate_2` | 69 | float | **`pass_rate_2` is the headline "Percent correct"** (0-100). Range 3.6-88.0. |
| `pass_num_1`, `pass_num_2`, `total_tests` | 69 | int | Raw counts (pass_rate_2 = 100 × pass_num_2 / 225) |
| `percent_cases_well_formed` | 69 | float | |
| `error_outputs`, `num_malformed_responses`, `num_with_malformed_responses`, `user_asks`, `lazy_comments`, `syntax_errors`, `indentation_errors`, `exhausted_context_windows`, `test_timeouts` | 69 | int | |
| `prompt_tokens`, `completion_tokens` | 23 | int | |
| `thinking_tokens` | 5 | int | |
| `reasoning_effort` | 7 | str | high/medium/low. Effort is usually encoded in `model` instead, e.g. `(high)` or `(32k thinking)`. |
| `command` | 69 | str | e.g. `aider --model openrouter/x-ai/grok-4`. Sometimes it has an env prefix (`OPENAI_API_BASE=... aider ...`), shell comments (`# via hyperbolic`) or aliases (`--model sonnet`, `--model r1`). |
| `date` | 69 | YAML date | Benchmark run date |
| `versions` | 69 | str | |
| `seconds_per_case` | 69 | float | |
| `total_cost` | 68 | float (66) / int (2) | |
| (no `released`) | | | **There is no model release date in polyglot.** |

### Example entry (verbatim)
```yaml
- dirname: 2025-08-23-15-47-21--gpt-5-high
  test_cases: 225
  model: gpt-5 (high)
  edit_format: diff
  commit_hash: 32faf82
  reasoning_effort: high
  pass_rate_1: 52.0
  pass_rate_2: 88.0
  pass_num_1: 117
  pass_num_2: 198
  percent_cases_well_formed: 91.6
  error_outputs: 23
  num_malformed_responses: 22
  num_with_malformed_responses: 19
  user_asks: 96
  lazy_comments: 3
  syntax_errors: 0
  indentation_errors: 0
  exhausted_context_windows: 0
  prompt_tokens: 2675561
  completion_tokens: 2623429
  test_timeouts: 3
  total_tests: 225
  command: aider --model openai/gpt-5
  date: 2025-08-23
  versions: 0.86.2.dev
  seconds_per_case: 194.0
  total_cost: 29.0829
```

### Date range and freshness
- `date` runs from 2024-12-21 to 2025-10-03. The file is not in chronological order (the first entry is 2025-02-25).
- **Last commit to the file: 2025-10-04** ("chore: update deepseek model names and metadata", a contributor). Before that, the
  last maintainer commit was 2025-09-02. **There have been no updates for a year.** Treat it as historical
  (Dec 2024 to Oct 2025) with no 2026 signal. The leaderboard page computes "last updated" from git log of this file.

### Model naming
Free text, inconsistent between entries:
- API ids with notes: `claude-sonnet-4-20250514 (32k thinking)`, `o1-2024-12-17 (high)`, `gpt-4o-2024-11-20`
- Pretty names: `Gemini 2.5 Pro Preview 05-06`, `Grok 3 Mini Beta (high)`, `DeepSeek R1 (0528)`, `Qwen3 235B A22B diff, no think, Alibaba API`
- **Architect combos naming two models**: `DeepSeek R1 + claude-3-5-sonnet-20241022`, `QwQ-32B + Qwen 2.5 Coder Instruct`,
  `o3 (high) + gpt-4.1`. Use `editor_model` or exclude these.
- **Stealth models**: `Quasar Alpha`, `Optimus Alpha` (OpenRouter pre-release models, later revealed as OpenAI GPT-4.1 variants).
  No family string, so map them by hand or exclude.
- Duplicate `model` value: `Qwen2.5-Coder-32B-Instruct` (2 runs, different providers).

Distinct `model` values per family (69 total):
- GPT/OpenAI (22): gpt-4o-mini-2024-07-18, gpt-4o-2024-08-06, gpt-4o-2024-11-20, chatgpt-4o-latest (2025-02-15|2025-03-29),
  o1-2024-12-17 (high), o1-mini-2024-09-12, o3-mini (medium|high), gpt-4.5-preview, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano,
  o4-mini (high), o3, o3 (high), o3 (high) + gpt-4.1, o3-pro (high), gpt-oss-120b (high), gpt-5 (high|medium|low)
- Claude (8 + 1 combo): claude-3-5-haiku-20241022, claude-3-5-sonnet-20241022, claude-3-7-sonnet-20250219 (no thinking|32k thinking tokens),
  claude-sonnet-4-20250514 (no thinking|32k thinking), claude-opus-4-20250514 (no think|32k thinking)
- Gemini (11): gemini-exp-1206, gemini-2.0-flash-exp, gemini-2.0-flash-thinking-exp-01-21, Gemini 2.0 Pro exp-02-05,
  Gemini 2.5 Pro Preview 03-25, gemini-2.5-flash-preview-04-17 (default), Gemini 2.5 Pro Preview 05-06,
  gemini-2.5-flash-preview-05-20 (24k think|no think), gemini-2.5-pro-preview-06-05 (default think|32k think).
  (`gemma-3-27b-it` is Google but not Gemini.)
- Grok (4): Grok 3 Beta, Grok 3 Mini Beta (low|high), grok-4 (high)
- DeepSeek (7 + combo): DeepSeek Chat V2.5, DeepSeek Chat V3 (prev), DeepSeek R1, DeepSeek V3 (0324), DeepSeek R1 (0528),
  DeepSeek-V3.2-Exp (Chat|Reasoner)
- Qwen (5 + combo): Qwen2.5-Coder-32B-Instruct (x2), qwen-max-2025-01-25, QwQ-32B, Qwen3 32B, Qwen3 235B A22B diff, no think, Alibaba API.
  (`openhands-lm-32b-v0.1` is a Qwen fine-tune by All Hands.)
- Llama (1): Llama 4 Maverick
- Mistral (1): Codestral 25.01
- Other: Kimi K2, yi-lightning, command-a-03-2025-quality, gemma-3-27b-it, openhands-lm-32b-v0.1, Quasar Alpha, Optimus Alpha

### Rate limits / auth
None.

### Licence verdict
Same repo: **Apache-2.0** (confirmed).

### Surprises
- The file has been stale since 2025-10-04.
- There is no release date field.
- Effort and thinking settings are embedded in the `model` string.
- Architect combos and stealth names need special handling.

### Fixture
`pipeline/test/fixtures/aider-polyglot/sample.yml` (17 KB, 26 entries). Blocks are copied byte-for-byte in original
order. Dates span 2024-12-21 to 2025-10-03. It includes the architect combo (`DeepSeek R1 + claude...`), stealth `Quasar Alpha`,
an int `commit_hash` entry, entries with `reasoning_effort`, and the families GPT/o-series, Claude, Gemini, Grok, DeepSeek, Qwen/QwQ,
Llama 4, Codestral, Kimi and Cohere.

---

## tau2

### URLs
- Repo `sierra-research/tau2-bench`, default branch `main`, last push 2026-10-07 (active).
- Listing: `gh api repos/sierra-research/tau2-bench/git/trees/main?recursive=1` (one call, 1782 entries, not truncated).
- **Manifest (index file exists):** `https://raw.githubusercontent.com/sierra-research/tau2-bench/main/web/leaderboard/public/submissions/manifest.json`
  (2.9 KB): `{"submissions": [29 dirs], "voice_submissions": [22], "legacy_submissions": [16]}`.
- Per submission: `.../web/leaderboard/public/submissions/<dir>/submission.json` (1.3-7.9 KB each, about 236 KB for all 70).
- `.../submissions/schema.json` is a JSON Schema generated from Pydantic (`src/tau2/scripts/leaderboard/submission.py`). There is also `README.md`.
- **Production mirror (no GitHub limits):** `https://sierra-tau-bench-public.s3.us-west-2.amazonaws.com/submissions/manifest.json`
  and `.../submissions/<dir>/submission.json`. Both returned 200. taubench.com reads from here (`VITE_SUBMISSIONS_BASE_URL`;
  synced on merge by the `sync-submissions-s3.yml` workflow).

### Submissions (70 dirs = 67 in manifest + 2 `A_EXAMPLE_*` + 1 orphan)
- `A_EXAMPLE_new-model_example-org_2025-01-15` and `A_EXAMPLE_voice-model_example-org_2026-03-11` are templates. Exclude them.
- **The orphan `qwen3-max_qwen_2025-10-30`** (Qwen3-Max-Thinking-Preview) is not in the manifest and is not shown on the site.
- Use the manifest as the source of truth. The website loads only manifest dirs, and the manifest list decides the
  track (text vs voice, legacy flag), not the `modality` field.

All dirs:
```
A_EXAMPLE_new-model_example-org_2025-01-15, A_EXAMPLE_voice-model_example-org_2026-03-11,
claude-3-7-sonnet_anthropic_2024-06-20, claude-fable-5_sierra_2026-08-04, claude-opus-4-1_anthropic_2025-01-15,
claude-opus-4-5_sierra_2026-02-26, claude-opus-4-6_sierra_2026-05-05, claude-opus-4-7_sierra_2026-05-05,
claude-opus-4-8_sierra_2026-08-04, claude-opus-4_anthropic_2025-05-22, claude-opus-5_sierra_2026-08-04,
claude-sonnet-4-5_anthropic_2025-10-02, claude-sonnet-4-5_sierra_2026-02-26, claude-sonnet-4_anthropic_2025-05-22,
deepseek-v3.2_deepseek_2025-12-01, distyl-buttonagent_distyl_2026-03-25, gemini-2-5-pro_sierra_2026-05-05,
gemini-3-1-flash-live-preview-thinking-high-banking_google_2026-07-13, gemini-3-1-flash-live-preview-thinking-high_google_2026-04-02,
gemini-3-1-flash-live-preview-thinking-minimal_google_2026-04-13, gemini-3-1-pro-preview_sierra_2026-05-05,
gemini-3-flash_sierra_2026-03-02, gemini-3-pro_google_2025-11-18, gemini-3-pro_sierra_2026-03-02,
gemini-live-2.5-flash_sierra_2026-03-03, glm-5-2_sierra_2026-08-04, glm-5-think_sierra_2026-03-02,
gpt-4-1-mini_openai_2024-06-20, gpt-4-1_openai_2024-06-20, gpt-5-2-none_sierra_2026-02-26, gpt-5-2_sierra_2026-02-26,
gpt-5-4_sierra_2026-03-25, gpt-5-5_sierra_2026-05-05, gpt-5-6-sol_sierra_2026-08-04, gpt-5_sierra_2025-08-09,
gpt-live-1-astra-high-banking_openai_2026-09-16, gpt-live-1-diamond-alpha-user-sim-gpt-5-5_openai_2026-09-09,
gpt-live-1-diamond-alpha_openai_2026-09-09, gpt-realtime-1-0_openai_2026-04-13, gpt-realtime-1.5_sierra_2026-03-03,
gpt-realtime-2-banking_openai_2026-07-12, gpt-realtime-2-minimal_openai_2026-07-01, gpt-realtime-2_openai_2026-06-24,
gpt-realtime-2_openai_2026-06-29, grok-4-1-fast_sierra_2026-05-05, grok-4-2_sierra_2026-05-05, grok-4-5_sierra_2026-08-04,
grok-4-fast_sierra_2026-05-05, grok-voice-think-fast-1-0-tool-mentor_pickle_2026-07-07, grok-voice-think-fast-1-0_xai_2026-04-21,
grok-voice-think-fast-2-0_xai_2026-08-06, inkling_sierra_2026-08-04, kimi-k2_moonshot-ai_2025-07-11, kimi-k3_sierra_2026-08-04,
livekit-cascaded_livekit_2026-05-19, muse-spark-1-1_sierra_2026-08-04, o3_openai_2025-01-15, o4-mini_openai_2024-06-20,
pine-voice-preview-user-sim-gpt-5-5_pineai_2026-08-17, pine-voice-preview-user-sim-v1-0_pineai_2026-08-17,
qwen3-5-omni-plus-realtime_qwen_2026-08-06, qwen3-8-max_sierra_2026-08-04, qwen3-max_qwen_2024_09_23,
qwen3-max_qwen_2025-10-30, qwen3-max_qwen_2026-01-23, qwen3.5-397b-a17b-think_sierra_2026-03-02,
raft-30b-a3b_neu_2026-04-29, toolorchestra_nvidia_2025-12-02, xai-realtime-banking_xai_2026-07-13, xai-realtime_sierra_2026-03-03
```
Do **not** parse dates from dir names. The suffix is often not the submission date (e.g. `claude-3-7-sonnet_anthropic_2024-06-20`
has submission_date 2025-06-09), and one dir uses underscores (`qwen3-max_qwen_2024_09_23`).

### Leaderboard tracks (from `web/leaderboard/src/components/Leaderboard.jsx`)
| track (site label) | manifest list | domains used | score |
|---|---|---|---|
| τ³-Banking ("knowledge", published as τ-knowledge) | `submissions` (text) | `banking_knowledge` | pass^k of banking_knowledge |
| τ³-Voice | `voice_submissions` | retail, airline, telecom (banking shown separately) | overall = mean of available core domains |
| τ²-bench ("core") | `submissions` + `legacy_submissions` (legacy hidden by default, "v1" badge) | retail, airline, telecom | **overall = unweighted mean of pass_k over the 3 core domains, only when all 3 have `pass_1`** |
- By default the site shows only `submission_type == "standard"` rows (a missing type counts as standard). Custom rows are behind a toggle.
- Coverage now: `submissions` 29 = 8 with all 3 core domains, 28 with banking. `voice_submissions` 22 = 18 core3, 5 banking.
  `legacy_submissions` 16 = 12 core3, 0 banking.
- **Since about May 2026, Sierra evaluates new text models on `banking_knowledge` only** (airline/retail/telecom are `null`).
  The τ²-bench "core" overall is frozen, with the latest core3 text rows from Feb-Mar 2026. New frontier models
  (Claude Opus 5, GPT-5.6-sol, Grok 4.5, Kimi K3, Qwen 3.8 Max, ...) appear only in banking_knowledge.

### Fields (70 files; types as observed; required per schema: model_name, model_organization, submitting_organization, submission_date, contact_info, results)
| field | n | type | notes |
|---|---|---|---|
| `model_name` | 70 | str | Display name, e.g. `GPT-5.2`, `Claude Opus 5`, `Gemini 3.0 Pro`, `Grok 4.1 fast`, `gpt-realtime-2`. Several rows can share a model (effort variants, legacy + new). |
| `model_organization` | 70 | str | Model vendor: OpenAI 19, Anthropic 12, Google 9, xAI 8, Qwen 5, Moonshot AI 2, Pine AI 2, DeepSeek 1, Distyl AI 1, Z.ai 1, **Zhipu AI 1** (same vendor as Z.ai), Pickle 1, Thinking Machines Lab 1, Multiple providers 1, Meta 1, **Alibaba Cloud 1** (Qwen3.5), Northeastern University HAI Lab 1, NVIDIA 1, Example Organization 2 |
| `submitting_organization` | 70 | str | Sierra 51, Anthropic 4, OpenAI 2, Qwen 2, Pine AI 2, ... (who ran the eval) |
| `submission_date` | 70 | str `YYYY-MM-DD` (schema format=date) | "Date of submission" |
| `submission_type` | 56 | str enum `standard`/`custom` | standard 45, custom 11, **missing 14** (legacy; counts as standard) |
| `modality` | 36 | str enum `text`/`voice` | missing on 34 (the manifest list decides the track) |
| `reasoning_effort` | 44 | str | Free text: high 14, xhigh 9, enabled 8, max 7, minimal 2, none 1, `Backend: GPT-6 Astra (medium)` x2, `Backend: GPT-6 Astra (high)` |
| `results` | 70 | object | Keys `retail`, `airline`, `telecom`, `banking_knowledge`. Each is null or a DomainResults object. |
| `results.<domain>.pass_1..pass_4` | | float/null (int 1x) | **pass^k success rate in percent, 0-100** (range 1.03-98.25). Voice rows have only `pass_1`. Many values are unrounded (e.g. 95.83333333333334). |
| `results.<domain>.cost` | | float/null | Average USD per trajectory |
| `results.banking_knowledge.retrieval_config` | 34 | str | alltools 26, terminal 4, text-emb-3-large 2, mixedbread 1, qwen_embeddings 1 |
| `is_new` | 70 | bool | UI highlight |
| `trajectories_available` | 70 | bool | |
| `trajectory_files` | 53 | dict domain to filename | |
| `references` | 55 | list of {title, url, type} | |
| `contact_info` | 70 | {email, name, github?} | **Contains submitter emails. Do not ingest.** |
| `methodology.evaluation_date` | 70 | str YYYY-MM-DD | When the eval was run. **It can be later than `submission_date`** after re-runs (e.g. GPT-5.2 submitted 2026-02-26, evaluated 2026-05-05). |
| `methodology.tau2_bench_version` | 69 | str | 1.0.1 (37), 1.0.0 (12), 0.1.3 / v0.1.3 (14), "original tau-bench" (3), v2.0 (2), 0.2.1-dev |
| `methodology.user_simulator` | 70 | str/null | gpt-5.2, gpt-4.1-2025-04-14, v1.0 (voice), gpt-5.5-2026-04-23 (xhigh), ... |
| `methodology.notes` | 65 | str | |
| `methodology.verification` | 70 | {modified_prompts: bool/null, omitted_questions: bool/null, details?: str} | The site uses `modified_prompts === false` (or custom) to mark a row as verified. |
| `model_release.release_date` | 65 | str YYYY-MM-DD | **Model public release date** (distinct from submission_date per the schema) |
| `model_release.announcement_url` / `announcement_title` | 64/63 | str/null | |
| `voice_config` | 23 | {provider, model, tick_duration_seconds, max_steps_seconds, user_tts_provider, pipeline?{asr,llm,tts}} | voice only |
| `interaction_metrics` | 23 | {version, config, domains{...}, overall{...}} | voice latency/yield metrics |
| `notes` | 1 | str | top level, once |

### Example (`gpt-5-2_sierra_2026-02-26/submission.json`, contact emails redacted here; the fixture is verbatim)
```json
{
  "model_name": "GPT-5.2", "model_organization": "OpenAI", "submitting_organization": "Sierra",
  "submission_date": "2026-02-26",
  "contact_info": {"email": "<redacted>", "name": "Sierra Research Team"},
  "is_new": false, "submission_type": "standard", "trajectories_available": true,
  "trajectory_files": {"airline": "gpt-5.2_high_airline_gpt-5.2_4trials.json", "...": "..."},
  "references": [],
  "results": {
    "airline": {"pass_1": 83.0, "pass_2": 78.33, "pass_3": 75.0, "pass_4": 72.0, "cost": 0.11379},
    "retail":  {"pass_1": 81.58, "pass_2": 69.59, "pass_3": 59.87, "pass_4": 51.75, "cost": 0.07156},
    "telecom": {"pass_1": 89.69, "pass_2": 82.46, "pass_3": 76.75, "pass_4": 71.93, "cost": 0.09312},
    "banking_knowledge": {"pass_1": 32.22, "pass_2": 23.88, "pass_3": 20.62, "pass_4": 18.56, "cost": null, "retrieval_config": "alltools"}
  },
  "reasoning_effort": "high",
  "methodology": {"evaluation_date": "2026-05-05", "tau2_bench_version": "1.0.1", "user_simulator": "gpt-5.2",
                  "notes": "... banking_knowledge re-graded under tau2-bench v1.0.1 grading fixes on 2026-07-15 ...; scores prior to v1.0.1 are not comparable.",
                  "verification": {"modified_prompts": false, "omitted_questions": false, "details": "..."}},
  "model_release": {"release_date": "2025-12-11", "announcement_url": "https://openai.com/index/introducing-gpt-5-2/", "announcement_title": "Introducing GPT-5.2"}
}
```

### Date semantics
- `submission_date`: when the result was submitted. Use it for month bucketing. It is close to the first git commit date
  (usually within 0-15 days).
- `methodology.evaluation_date`: when the numbers were (re)computed. Re-runs make it later than submission_date.
- `model_release.release_date`: model launch date (65/70 present).
- **Values are edited in place**: many files have 2-6 commits. For example, all Feb-Mar 2026 text rows were last modified on 2026-07-16,
  when banking_knowledge was re-graded under v1.0.1. A snapshot taken on day X may differ from today's file. Store
  `fetched_at` and do not assume immutability. First and last commit dates per file are in `gh/tau2-commits/*.json`.
- Quirks:
  - `qwen3-max_qwen_2024_09_23` has submission_date **2024-09-23** but release_date 2025-09-23 and first commit 2025-10-11.
    The submission_date is a typo for 2025.
  - `gpt-live-1` release_date 2026-09-10 is after its submission_date 2026-09-09 (pre-release eval). Same for grok-voice-think-fast-1.0.
  - "Cascaded baseline" uses its own submission date as the release_date.

### Rate limits / auth
- GitHub path: 1 tree call (or the manifest raw GET) plus about 67 raw GETs per full refresh. Use ETag/If-None-Match, or
  diff the tree SHAs and fetch only changed blobs.
- The S3 mirror has no GitHub limits and is what the production site uses. It is the preferred runtime source; GitHub
  raw is the fallback and the source for history.

### Licence verdict
Root `LICENSE`: **MIT License, "Copyright (c) 2025 Sierra Research"** (GitHub API: `mit`). Confirmed. Submissions are
in the repo, so MIT applies. Keep the copyright notice.

### Surprises
- There are 3 tracks (τ²-bench core, τ³-Banking, τ³-Voice) in one directory, and new text models only report banking.
- There are voice and custom submissions; the default view excludes custom.
- Orphan dir not in the manifest; example dirs exist.
- In-place re-grading.
- Org naming: `Z.ai` vs `Zhipu AI`, `Qwen` vs `Alibaba Cloud`, `Google` (not Google DeepMind).
- New model names appear that are not in the usual families: `Claude Fable 5` (Anthropic), `GPT-5.6-sol`, `Muse Spark 1.1` (Meta, not Llama),
  `Inkling` (Thinking Machines Lab), `xai-realtime` (xAI voice), `Cascaded baseline` (Multiple providers).
- There is no Llama and no Mistral on tau2.

### Fixtures
- `pipeline/test/fixtures/tau2/sample.json` (35 KB): a JSON array of 12 `{"path": "web/leaderboard/public/submissions/<dir>/submission.json", "submission": {...}}`
  objects with real content: gpt-5-2_sierra_2026-02-26 (OpenAI, standard, 4 domains), claude-opus-5_sierra_2026-08-04 (Anthropic, banking only),
  gemini-3-pro_google_2025-11-18 (legacy, no submission_type), grok-4-5_sierra_2026-08-04 (xAI), deepseek-v3.2_deepseek_2025-12-01 (legacy),
  qwen3.5-397b-a17b-think_sierra_2026-03-02 (org "Alibaba Cloud"), qwen3-max_qwen_2024_09_23 (date typo), muse-spark-1-1_sierra_2026-08-04 (Meta),
  distyl-buttonagent_distyl_2026-03-25 (custom, no model_release), toolorchestra_nvidia_2025-12-02 (custom legacy),
  gpt-realtime-2_openai_2026-06-24 (voice standard), grok-voice-think-fast-1-0-tool-mentor_pickle_2026-07-07 (voice custom, largest file).
- Verbatim copies (byte-identical): `submission-gpt-5-2_sierra_2026-02-26.json` (OpenAI, standard),
  `submission-claude-opus-5_sierra_2026-08-04.json` (Anthropic, standard, banking only),
  `submission-distyl-buttonagent_distyl_2026-03-25.json` (Distyl AI, custom).
- Note: the fixtures keep the submitters' `contact_info` emails verbatim (public repo data). Redact them if the fixtures will be published elsewhere.
- Scratch: all 70 merged at `scratchpad/recon-llm/gh/tau2-all-submissions.json` (`[{path, manifest_list, submission}]`),
  and raw copies at `gh/tau2-subs/*.json`, plus `tau2-manifest.json`, `tau2-schema.json` and `tau2-Leaderboard.jsx`.

---

## Family patterns (swebench/aider/tau2)

Recommended normalisation before matching: lowercase, replace `_` with `-`, and strip provider prefixes
(`openrouter/`, `ollama/`, `openai/`, `meta-llama/`, `https://huggingface.co/<org>/`).
For aider, the `command` field's `--model` value is a second signal. All regexes below were checked against every
name in the three sources (`gh/family-names.json`) with the results shown. Use them case-insensitively.

| family | swebench (model_display / Model: tag) | aider-edit / polyglot (`model`) | tau2 (`model_name`) |
|---|---|---|---|
| GPT (OpenAI) | `GPT 5.2`, `GPT 5 mini`, `GPT 5.1 Codex`, `GPT 4o`, `o3`, `o4-mini`, `O3 Mini`, `gpt-oss-120b`; tags `gpt-5.2-2025-12-11`, `gpt-5-2`, `gpt-5-2-codex`, `o3-20250416`, `openai/gpt-5-2025-08-07`, `gpt-5-0807-global` | `gpt-4o-2024-08-06`, `gpt-3.5-turbo-0613`, `openai/chatgpt-4o-latest`, `chatgpt-4o-latest (2025-03-29)`, `o1-preview`, `o3-mini (high)`, `o3-pro (high)`, `gpt-4.1-nano`, `gpt-5 (high)`, `gpt-oss-120b (high)`; stealth `Quasar Alpha`/`Optimus Alpha` | `GPT-5.2`, `GPT-5.6-sol`, `GPT-4.1-mini`, `o3`, `o4-mini`, voice `gpt-realtime-1.5`, `gpt-realtime-2`, `gpt-live-1` |
| Claude (Anthropic) | `Claude 4.5 Opus` (**SWE-bench puts the version before the tier**), `Claude 3.7 Sonnet`, `Claude Sonnet 4`, `Claude 3.5-Sonnet-20241022`; tags `claude-opus-4-5-20251101`, `claude-4-5-opus`, `claude-4-sonnet-20250514`, `claude-sonnet-4.5`, `claude-2` | `claude-3-5-sonnet-20241022`, `claude-3.5-sonnet-20240620`, `claude-sonnet-4-20250514 (32k thinking)`, `claude-opus-4-20250514 (no think)` | `Claude Opus 4.5`, `Claude Opus 5`, `Claude Fable 5`, `Claude-Sonnet-4.5`, `Claude-3.7-Sonnet` |
| Gemini (Google) | `Gemini 3 Pro Preview`, `Gemini 3 Flash`, `Gemini 2.0 Flash (v20241212-experimental)`; tags `gemini-3-flash-preview`, `gemini-2.5-pro-06-17` | `gemini-exp-1206 (whole)`, `gemini-1.5-pro-002`, `Gemini 2.5 Pro Preview 05-06`, `gemini-2.5-pro-preview-06-05 (32k think)`; not `gemma*` | `Gemini 3.0 Pro`, `Gemini 3.1 Pro Preview`, voice `gemini-live-2.5-flash-native-audio`, `gemini-3.1-flash-live-preview-thinking-high` |
| Grok (xAI) | (none) | `Grok-2`, `Grok-2-mini`, `Grok 3 Beta`, `Grok 3 Mini Beta (high)`, `grok-4 (high)`; command `openrouter/x-ai/grok-*`, `xai/grok-*` | `Grok 4.5`, `Grok 4.1 fast`, `Grok 4 fast`, `Grok 4.2`, voice `grok-voice-think-fast-2.0`, `xai-realtime` |
| DeepSeek | `DeepSeek V3.2`, `DeepSeek V3.2 Reasoner`, `Deepseek V3`, `DeepSeek V3 0324`; tags `deepseek-v3.2-reasoner`, `deepseek-chat`, `deepseek-reasoner` (`DeepSWE-Preview` is **not** DeepSeek) | `DeepSeek Coder V2 0724`, `DeepSeek V2.5`, `DeepSeek-V2.5-1210`, `DeepSeek R1 (0528)`, `DeepSeek-V3.2-Exp (Reasoner)` | `DeepSeek-V3.2` |
| Qwen (Alibaba) | `Qwen3-Coder 480B/A35B Instruct`, `Qwen2.5-Coder 32B Instruct`, `Qwen2.5 (7B + 72B)`; tags `Qwen/Qwen2.5-72B-Instruct`, `Qwen 2.5`, HF URLs | `qwen-2.5-72b-instruct (bf16)`, `ollama/qwen2.5-coder:32b`, `codeqwen:7b-chat-v1.5-q8_0`, `qwen1.5-110b-chat`, `QwQ-32B`, `qwen-max-2025-01-25`, `Qwen3 235B A22B ...` | `Qwen3-Max`, `Qwen3-Max-Thinking`, `Qwen3.5-397B-A17B`, `Qwen 3.8 Max`, voice `qwen3.5-omni-plus-realtime` |
| Llama (Meta) | `Llama 4 Maverick Instruct`, `Llama 4 Scout Instruct`; tags `meta-llama/Llama-3.1-405B-Instruct`, `Llama 3.1`; fine-tunes `Llama3-SWE-RL-70B` (Meta RL), `SWE-Llama 7B/13B` (Princeton CodeLlama FT) | `llama-3.1-405b-instruct (diff)`, `llama3-70b-8192`, `ollama/llama3.2:3b-instruct-fp16`, `llama-3.3-70b-instruct`, `Llama 4 Maverick`; fine-tunes `hermes-3-llama-3.1-405b`, `Llama-3.1-Nemotron-70B-Instruct-HF` | (none; Meta's tau2 entry is `Muse Spark 1.1`, a different line) |
| Mistral | `Devstral (2512)`, `Devstral Small (2512)`, `DevStral Small 2505/2507`; tags `mistralai/Devstral-Small-2505`, `devstral-small-2507` | `Mistral Large 2 (2407)`, `Mistral Large (2411)`, `codestral-2405`, `Codestral 25.01`, `ollama/mistral-small`, `ollama/mistral-nemo:12b-...`; `WizardLM-2 8x22B` is a Mixtral FT | (none) |

### Suggested regexes (Python `re`, IGNORECASE, applied to the normalised string)
```python
FAMILY_PATTERNS = {
    "gpt":      r"(?<![a-z0-9])(?:chat)?gpt(?![a-z])|(?<![a-z0-9])o[1-9](?:-(?:mini|pro|preview))?(?![a-z0-9])",
    "claude":   r"(?<![a-z0-9])claude(?![a-z])|^(?:opus|sonnet|haiku)\b",
    "gemini":   r"(?<![a-z0-9])gemini(?![a-z])",            # deliberately excludes gemma
    "grok":     r"(?<![a-z0-9])grok(?![a-z])|^xai-realtime",
    "deepseek": r"deepseek",                                  # does NOT match DeepSWE
    "qwen":     r"(?<![a-z0-9])(?:code)?qwen|(?<![a-z0-9])qwq(?![a-z])",
    "llama":    r"(?<![a-z0-9])llama(?![a-z])|(?<![a-z0-9])llama[-\s]?\d",
    "mistral":  r"mistral|codestral|devstral|magistral|mixtral|ministral|pixtral",
}
# Check exclusions first (third-party fine-tunes / look-alikes); these matched a family regex in the data:
EXCLUDE = r"swe-gpt|swe-llama|hermes|nemotron|dracarys|deepswe|skywork|openhands-lm|swe-agent-lm|frog(?:boss|mini)|raft-|reflection-70b|wizardlm"
```
Validation results over all names in the three sources:
- Every frontier-family name above is matched.
- False positives are caught only by EXCLUDE: `Lingma SWE-GPT 72b` (GPT), `SWE-Llama 7B/13B`, `hermes-3-llama-3.1-405b`,
  `ollama/hermes3:8b-llama3.1-fp16`, `Llama-3.1-Nemotron-70B-Instruct-HF` (Llama).
- Multi-family strings need a rule (first model wins, or skip): `DeepSeek R1 + claude-3-5-sonnet-20241022` (DeepSeek+Claude),
  `GPT-4o & Claude 3 Opus` (SWE-bench Test/Lite), `o3 (high) + gpt-4.1`, `QwQ-32B + Qwen 2.5 Coder Instruct`.
- Matched by no family (expected): GLM, Kimi, MiniMax, Doubao, Nova, Command R/A, Yi, gemma, granite, tulu, `Quasar Alpha`/`Optimus Alpha`
  (OpenAI stealth; map by hand if wanted), `Inkling`, `Muse Spark`, `Pine Voice Preview`, `Cascaded baseline`, `Undisclosed`, `Multiple`.
- Policy decisions for the pipeline (not settled by the data):
  - Does `gpt-oss-*` (OpenAI open-weights) count as GPT?
  - Do o-series models count as GPT? (The regex says yes.)
  - Does `Llama3-SWE-RL-70B` (Meta's own RL fine-tune) count as Llama?
  - Do voice models (`gpt-realtime`, `gemini-live`, `grok-voice`, `xai-realtime`) count? Recommendation: exclude tau2 voice rows by manifest list.
- On tau2 and SWE-bench Mini rows, the vendor fields (`model_organization` / `model_org`) are a reliable cross-check for the family.
  Aider has no org field; use the provider prefix in `command` (`anthropic/`, `gemini/`, `deepseek/`, `xai/`, `x-ai/`, `mistral/`, `openai/`, `meta-llama/`, `qwen/`).
