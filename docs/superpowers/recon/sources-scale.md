# Recon: "scale" (規模) data sources — AI WAR

Checked on 2026-10-08 against the live sources. This file supports spec §5.2 and §6.2 (`docs/superpowers/specs/2026-10-08-ai-war-design.md`).
Fixtures are in `pipeline/test/fixtures/<sourceId>/`. They are trimmed originals in the source's own text format (byte-for-byte rows, nothing reformatted).

Contents: `epoch-usage` · `crux` · `tranco` · `statcounter` · `ramp` · `openrouter` · `wikipedia` · `itunes` · `cloudflare` · product → identifier table (at the end).

---

## epoch-usage — Epoch AI "AI Companies" usage reports

**URLs (no key, plain GET):**
- `https://epoch.ai/data/ai_companies_usage_reports.csv` (23.5 KB, 51 records)
- Sibling files: `ai_companies_revenue_reports.csv` (72 records, 2022-07-01 → 2026-09-29), `ai_companies.csv`, `ai_companies.zip`, `ai_companies_compute_spend.csv`, `ai_companies_funding_rounds.csv`, `ai_companies_staff_reports.csv` (all linked from https://epoch.ai/data/ai-companies)

**Format:** RFC-4180 CSV, UTF-8 without BOM, LF line endings, header row. **Quoted fields contain embedded newlines and doubled quotes** (the `Notes` column). 128 physical lines hold 51 records, so use a real CSV parser (for example `csv-parse`) and never split on `\n`.

**Columns (exact header, in order):**
```
Id,Company,Active users,Active users time period,Daily tokens,Daily messages,Date,Report date,Source 1,Source 2,Graph note,Notes,Source type,Product,Confidence,Exclude from graph view
```
| column | type | notes |
|---|---|---|
| `Id` | string | Human label such as "ChatGPT 800M WAU". **Not unique**: "Meta AI 1B MAU" and "ChatGPT 700M WAU" each appear twice. One "ChatGPT 700M WAU" row actually has the value 770000000, so never parse numbers from `Id`. |
| `Company` | string | `OpenAI`, `Google`, `Meta`, `Z.ai (Zhipu)`, `DeepSeek`, `xAI`, `Anthropic` |
| `Active users` | float string (`"50000000.0"`) or empty | absolute user count |
| `Active users time period` | `Daily` / `Weekly` / `Monthly` / empty | DAU / WAU / MAU. Empty when the row is a tokens or messages row. |
| `Daily tokens` | float or empty | Tokens per day. Epoch already converted monthly and per-minute figures to daily (for example "Google 9.7T monthly tokens" → `323000000000.0`). |
| `Daily messages` | float or empty | |
| `Date` | `YYYY-MM-DD` | The date the metric refers to (the "as of" date) |
| `Report date` | `YYYY-MM-DD` | The date it was published or reported. It can be much later than `Date` (OpenAI's 2023 WAU figures were reported 2025-09-14). |
| `Source 1`, `Source 2` | URL or empty | |
| `Graph note` | string or empty | Short caveat such as "All products" or "API only" |
| `Notes` | long free text (multi-line) | |
| `Source type` | `Company disclosure` / `Media report` / `Other` | `Other` covers the Google antitrust-trial exhibit rows ("… Google trial", 2025-03-28, Daily) |
| `Product` | string | `ChatGPT`, `Gemini`, `Meta AI assistant`, `Meta AI App`, `Grok`, `DeepSeek`, `Claude API`, `Gemini API`, `API`, `GPT-5-Codex`, `AI Overviews`, `Google (all AI products)`, `All products`, `Full company`, `Chat and API for V3 and R1` |
| `Confidence` | `Confident` / `Likely` / `Uncertain` | |
| `Exclude from graph view` | `True` or empty | 6 rows are `True` (for example AI Overviews 1.5B MAU, ChatGPT 40M paying WAU, Anthropic 32% enterprise share) |

**Example row:**
```
ChatGPT 50M WAU,OpenAI,50000000.0,Weekly,,,2023-03-25,2025-09-14,https://cdn.openai.com/pdf/…/economic-research-chatgpt-usage-paper.pdf,https://www.nber.org/papers/w34255,,"From Figure 3, weekly active ChatGPT users on consumer plans (Free, Plus, Pro). …",Company disclosure,ChatGPT,Likely,
```

**Coverage of active-user rows (34 rows with `Active users`):**

| Company / Product | rows | first | last |
|---|---|---|---|
| OpenAI / ChatGPT | 15 | 2023-03-25 Weekly 50M | 2026-09-29 Weekly 1.2B |
| OpenAI / All products | 2 | 2024-03-30 Monthly 100M | 2024-06-30 Monthly 350M |
| Google / Gemini | 5 | 2025-03-15 Monthly 350M | 2025-10-29 Monthly 650M |
| Meta / Meta AI assistant | 8 | 2024-09-25 Monthly 400M | 2025-10-29 Monthly 1B |
| xAI / Grok | 2 | 2025-03-28 Daily 15M | 2025-09-17 Monthly 64M |
| DeepSeek / DeepSeek | 1 | 2025-03-28 Daily 10M | — |
| Google / AI Overviews | 1 (excluded) | 2025-05-20 Monthly 1.5B | — |

**There are no Anthropic/Claude user counts.** The only Anthropic row is "32% enterprise API share", which is excluded. There are no Mistral, Qwen or Perplexity rows, and no image, video, audio or music products. This file is only useful as a seed for `curated/announcements.yaml`, as §5.2 intends.

**Semantics and quirks:**
- DAU, WAU and MAU are mixed even within one product (ChatGPT has Weekly and Daily rows; Grok has Daily and Monthly rows). Pick a target period, for example WAU, before log-interpolating, or keep one series per period type.
- The "Google trial" rows (Source type `Other`, Date 2025-03-28) are DAU figures from the court exhibit. They are a useful cross-company snapshot (ChatGPT 160M, Meta 100M, Gemini 35M, Grok 15M, DeepSeek 10M DAU).
- Numbers are floats with `.0`, so parse them with `Number()`.
- Treat an empty string as null, not 0.

**Auth / rate limit:** none. This is a static file and is updated irregularly.

**Licence:** CC BY 4.0. The FAQ "How is the data licensed?" on https://epoch.ai/data/ai-companies says the data is "free to use, distribute, and reproduce provided the source and authors are credited", and links to creativecommons.org/licenses/by/4.0. **Verdict: OK with credit.**

**Fixture:** `pipeline/test/fixtures/epoch-usage/sample.csv` is the full file, untouched (23,495 B).

---

## crux — Chrome UX Report top-1M origins (cached by zakird/crux-top-lists)

**URL:** `https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/global/YYYYMM.csv.gz`
- Available months: `202102` → `202608` (67 monthly files, none missing), plus `current.csv.gz`.
- `202609` returns 404 today. The README says releases come monthly, usually on the second Tuesday, so September 2026 data should land around 2026-10-13.
- File list: `https://api.github.com/repos/zakird/crux-top-lists/contents/data/global` (JSON array, `name` such as `202608.csv.gz`).
- There are also per-country lists under `data/country/` (not examined).

**Format:** gzip-compressed CSV of about 9 MB (about 25 MB uncompressed), UTF-8, LF line endings, header `origin,rank`, then exactly 1,000,000 rows.
```
origin,rank
https://www.chess.com,1000
https://sellercentral.amazon.com,1000
```
- `origin` is a full origin with scheme. 2026-08 has 8,088 `http://` origins and 1,861 origins with a port (`https://host:8443`). It never has a path or trailing slash.
- `rank` is a **bucket upper bound, not a rank**. Values are `1000, 5000, 10000, 50000, 100000, 500000, 1000000` (log10 half-steps). The bucket sizes (rows per bucket) are 1000 / 4000 / 5000 / 40000 / 50000 / 400000 / 500000. The rows are sorted by bucket, and **within a bucket the order is random** (README).
- Older files (for example 202102) had only the buckets 1k / 10k / 100k / 1M. Half-steps are already present in 202211, so everything we use (2022-11 onward) has the same seven buckets.
- Google's docs (https://developer.chrome.com/docs/crux/methodology/metrics, "Popularity") say: popularity is measured by total navigations to the origin; ranks are on a log10 scale with half steps; each bucket excludes the ones above it (the "top 5k" bucket holds 4k origins).

**Date semantics:** `YYYYMM` is the calendar month the Chrome traffic was collected. A file appears about 6 weeks later, so the latest month available on day D is usually month(D) − 2, or month(D) − 1 after the second Tuesday.

**Converting to traffic:** with a bucket value B and previous bucket B₋, the true rank lies in (B₋, B]. For "traffic ∝ rank⁻¹" (spec §6.2), use a representative rank such as the geometric mean √(B₋·B): 5k → 2236, 10k → 7071, 50k → 22361, 100k → 70711, 500k → 223607, 1M → 707107. The top bucket has no lower bound, so it needs a configured value (for example 100 or 316). Write the choice into the methods page. Every top-1k origin gets the same value, so **ChatGPT, Gemini and Claude are indistinguishable in CrUX from 2026-07 onward**. CrUX is a coarse signal for the leaders.

**Host lookup results (bucket per month, 2022-11 → 2026-08).** Legend: `1`=1k `5`=5k `T`=10k `F`=50k `H`=100k `Q`=500k `M`=1M `.`=absent. Columns are months from 2022-11 to 2026-08, and the digit row marks each January.
```
                                          3           4           5           6
https://chat.openai.com                 .511111111111111115QMMM.......................
https://chatgpt.com                     ...QHHHHQQQ......Q1111111111111111111111111111
https://bard.google.com                 ...MFF5555511115..............................
https://gemini.google.com               ...............1111111111111111111111111111111
https://gemini.google                   .....................MQFT5FFFFT555155555555555
https://claude.ai                       ........FFFFFFFFTTTT55555TTT555555555555151111
https://grok.x.ai                       ............FQQQQQQ...........................
https://grok.com                        ..........................QF555555555511155555
https://chat.deepseek.com               ..................MQQQQQQH55555555555555555555
https://chat.qwenlm.ai                  ..........................FTHM................
https://chat.qwen.ai                    ...........................QFTTFFFFFFF55TTTTFT
https://www.meta.ai                     .................FHHFFFFFFFFFFFFFFFTT55TT555TT
https://meta.ai                         .......................................HHHHHHH
https://chat.mistral.ai                 ...............QQQQQQQQQHHHFFFFFHHFFFFFFFFFFHH
https://www.perplexity.ai               .QHFFFFFFFT55TTT5555T555555.555555515555555555
https://copilot.microsoft.com           ............QFFTTT5TTT555555555555555555555555
https://www.suno.ai                     ..........M.QHFFFF............................
https://app.suno.ai                     ............QFFFFF............................
https://suno.com                        .................55555555555555555555555555555
https://www.udio.com                    .................FFFFFFFFFFFFFFFHHHHHHHHHHFFHH
https://www.midjourney.com              FFFF55TTTFFFFFFFFFFFFFFFFFFFFF5TTTFFFFFFFFFFFF
https://alpha.midjourney.com            .MMMMMMMM....QQQQQQQQQQQQQQQQQQQQQMMMMM.QQQQQ.
https://labs.google                     .........QQQQQQQQQHQQQQQQFFFFFT55T555511111111
https://sora.com                        .........................FHHFFF...............
https://sora.chatgpt.com                .............................FF55TT5555TFFQQQQ
https://klingai.com                     ....................HFFFFFTFFFFFHHQHHFFFFHQQQQ
https://www.klingai.com                 .....................FFHHHFFFHHHQQQMMQMM..M...
https://app.klingai.com                 ............................HTTTTFFFFTFFF.....
https://kling.ai                        .....................M...MMM............HFFFFT
https://runwayml.com                    QQQHHHHHFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF.
https://app.runwayml.com                QQQQHHHFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
https://runway.com                      .........M..................................HF
https://hailuoai.video                  ......................QFT5555TTT5TFTTTFFFHFFFF
https://lumalabs.ai                     MMMMQQHHHHHHFHFHHHH555TTFFFFFHHHHHHHHHHHFFFHHH
https://dream-machine.lumalabs.ai       ........................QHHHHHQQQQQQQQQHQQQQQQ
https://elevenlabs.io                   ........FTTTTT555T555TTTT555555555555555555555
https://ideogram.ai                     .........QT5TTFFFFTTTTTTTTFFFFFFFFFFFFFFFFHFFF
https://www.recraft.ai                  .......MQMMMMMMQQQQQQQQHFFFFFFFFHHFHHHHHHHHHHH
https://bfl.ai                          ..............................MQQQQMMQQMMMMMQQ
https://aistudio.google.com             ...............QHHFHHFFFFTTT555555111115555555
https://character.ai                    .MQ..QQMQ..MM..F111111111111111111111111111111
https://higgsfield.ai                   .................M...........QFF5FFFFT55T.TT55
```
The www/bare variants of the brief's hosts never appear in the top 1M (2022-11..2026-08): `www.chatgpt.com`, `www.claude.ai`, `www.gemini.google.com`, `www.grok.com`, `perplexity.ai` (bare), `www.suno.com`, `udio.com` (bare), `www.labs.google`, `www.sora.com`, `www.lumalabs.ai`, `www.ideogram.ai`, `recraft.ai` (bare). Exceptions: bare `midjourney.com` appears only 2022-11 → 2023-05, and `www.elevenlabs.io` appears in 2025-07/08. No `http://` variants appear for any product host. A parser should still try `https://{host}` and `https://www.{host}` and take the best bucket.

**Naming quirks and host migrations (important for `units.yaml`):**
- ChatGPT moved from `chat.openai.com` to `chatgpt.com` in **2024-05** (chatgpt.com reaches 1k in 202405; chat.openai.com drops to 5k, then 500k, then disappears after 202409). chatgpt.com also shows small buckets in 2023 from the redirect domain. Take the **best bucket across all of a product's origins per month**, or sum the inverse-rank traffic over its origins.
- Bard → Gemini: `bard.google.com` was last seen in 202402 (5k), and `gemini.google.com` was first seen in 202402 (1k). The short domain `gemini.google` exists from 202408.
- Grok: `grok.x.ai` (2023-11 → 2024-05), then `grok.com` from 202501. Grok inside x.com is invisible here.
- Qwen: `chat.qwenlm.ai` (2025-01 → 04), then `chat.qwen.ai` from 202502.
- Suno: `www.suno.ai` and `app.suno.ai` until 202404, then `suno.com` from 202404.
- Sora: `sora.com` (2024-12 → 2025-05), then `sora.chatgpt.com` from 202504. The requested host `sora.chatgpt.com` is the right one now.
- Kling: `klingai.com`, `www.klingai.com` and `app.klingai.com` until about 2026-03, then **`kling.ai`** (10k bucket in 202608) while klingai.com fades to 500k. The brief's `klingai.com` alone would understate Kling in 2026.
- Runway: `runwayml.com` was last seen in 202607, and `runway.com` appears from 202607 (likely a rebrand). The app host `app.runwayml.com` is still present.
- Meta AI: `www.meta.ai` is primary, and bare `meta.ai` appears from 2026-02.
- Perplexity: `www.perplexity.ai` is **missing in 202502** only, a one-month gap. Handle a gap with the "missing" rule, not as zero.
- `labs.google` hosts Flow, Whisk and ImageFX (Veo and Imagen front-ends), not only video. It reached 1k in 2026. `labs.google.com` is a different, older host.
- `luma.com` is likely the **events platform Luma (lu.ma)**, not Luma AI. Do not map it to Luma AI; use `lumalabs.ai` and `dream-machine.lumalabs.ai`.
- `elevenlabs.io` also had `www.elevenlabs.io` for 2 months (2025-07/08).
- Claude also has `claude.com` (from 2025-09, 10k bucket in 2026-08), plus `platform.claude.com` and `code.claude.com`.

**Auth / rate limit:** none (raw.githubusercontent.com, about 9 MB per month). Cache downloads; only the newest month changes.

**Licence:** CC BY 4.0. The "License" section of https://developer.chrome.com/docs/crux/methodology says Google licenses the CrUX datasets under CC BY 4.0 International. The zakird repo has no LICENSE file; its README says it only caches Google's public BigQuery data. Credit "Chrome UX Report (Google), CC BY 4.0" and link the repo. Tranco's homepage calls CrUX "CC BY-SA 4.0", which conflicts with Google's page; follow Google. **Verdict: OK with credit.**

**Fixtures:** `pipeline/test/fixtures/crux/` holds `sample-202301.csv` (6 rows), `sample-202402.csv` (13), `sample-202501.csv` (21) and `sample-202608.csv` (22). `sample-202608.csv.gz` is the same file gzipped, for testing the gunzip path. Each file is the original header and rows in original order, filtered to the 24 requested hosts with and without `www.`.

---

## tranco — Tranco research top list (with subdomains)

**API docs:** https://tranco-list.eu/api_documentation (marked "Alpha"). Base `https://tranco-list.eu/api/`. No auth is needed for GETs.

**Endpoints used (all GET, JSON):**

1. `GET /api/lists/date/{date}[?subdomains=true]` gets the metadata of the daily list for a date. `{date}` accepts `YYYY-MM-DD`, `YYYYMMDD` or `latest`.
   ```json
   {"list_id": "V348N", "available": true, "failed": false,
    "download": "https://tranco-list.eu/download/V348N/1000000",
    "created_on": "2026-10-07T22:00:02.014599",
    "configuration": {"startDate": "2026-09-08", "providers": ["crux","farsight","majestic","radar","umbrella"],
      "endDate": "2026-10-07", "combinationMethod": "dowdall", "filterTLD": "false", "listPrefix": "1000000"}}
   ```
   - Without `subdomains` (the default PLD list), `configuration` also has `"isDailyList": true, "filterPLD": "on"`.
   - Not found: **HTTP 404**, body `{"available": false}`. Seen for `2023-01-01?subdomains=true`, while 2022-12-01, 2023-01-02 and the rest of January exist. **Occasional days are missing**, so fall back to ±1–3 days.
   - Each list is a **30-day Dowdall aggregate** (`startDate` = `endDate` − 29). For a monthly value, use the list whose `endDate` is the last day of the month; it covers almost exactly that month.
   - Providers changed over time. Before 2023-08-01 the providers were `alexa, umbrella, majestic, farsight` (`listPrefix: "full"`). The homepage says CrUX and Cloudflare Radar were added to the default list starting with the daily list of 2023-08-01. **Expect a level shift at 2023-08**, and note that Tranco from 2023-08 onward partly *contains* CrUX and Radar, so it is not independent of them.
2. `GET /api/lists/id/{list_id}` returns the same object as above.
3. `GET /api/ranks/domain/{domain}` returns `{"ranks": [{"date": "2026-10-07", "rank": 87}, …], "domain": "chatgpt.com"}`, newest first.
   - It only covers **about the last 38 days** (today it returned 2026-08-31 → 2026-10-07; the docs say "at least the past 30 days").
   - It is only for the **default PLD list**: `gemini.google.com` returns `{"ranks": [], "domain": "gemini.google.com"}`, and an unknown domain returns the same empty shape with HTTP 200.
   - **It cannot be used for history or for subdomains.**
4. Downloads (not JSON):
   - `https://tranco-list.eu/download/{list_id}/1000000` returns `text/csv`, about 25 MB, **no header**, rows `rank,domain`, LF line endings.
   - `https://tranco-list.eu/download_daily/{list_id}` returns a 307 redirect to `/download/daily/tranco_{id}-1m.csv.zip` (about 10.6 MB zip containing `top-1m.csv`, **CRLF** line endings in the 2023–2025 files).
   - A parser must accept both CRLF and LF.

**How to get a domain's rank for month M (recommended):**
1. Call `lists/date/{last day of M}?subdomains=true` (1 request).
2. Download the zip for that `list_id` and scan for the hosts (exact match on the host without scheme).
3. Cache the result. About 45 months means about 45 zips of 10 MB each; do it once and then add one per month.

The subdomain list contains both registrable domains and subdomains (for example `chatgpt.com` 105 and `chat.openai.com` 6014 in the same list). Ranks are exact integers 1..1,000,000, not buckets.

**Sample ranks from subdomain lists:**

| host | 2023-01-15 | 2024-06-01 | 2025-06-01 | 2026-10-07 |
|---|---|---|---|---|
| chatgpt.com | 165771 | 1608 | 286 | 105 |
| chat.openai.com | 53336 | 1592 | 23272 | 6014 |
| gemini.google.com | – | 1997 | 1895 | 1514 |
| bard.google.com | – | 453843 | – | – |
| claude.ai | – | 15539 | 5458 | 543 |
| grok.com | – | – | 6269 | 4132 |
| chat.deepseek.com | – | – | 10182 | 10222 |
| chat.qwen.ai | – | – | 41220 | 30390 |
| www.meta.ai / meta.ai | – | 170967 / 66278 | 95164 / 38722 | 30325 / 11929 |
| chat.mistral.ai | – | 818595 | 108646 | 254036 |
| www.perplexity.ai / perplexity.ai | – / 84731 | 11205 / 7033 | 10331 / 4855 | 9901 / 864 |
| suno.com | – | 11263 | 5278 | 4000 |
| www.udio.com / udio.com | – | 180848 / 73517 | 120714 / 52690 | 336509 / 54456 |
| www.midjourney.com / midjourney.com | 697903 / 4699 | 101962 / 10216 | 97782 / 7882 | 108931 / 6762 |
| labs.google | – | 123939 | 35434 | 1684 |
| sora.chatgpt.com / sora.com | – | – | 120812 / 53987 | 850037 / 156481 |
| klingai.com / kling.ai | – | – | 15293 / – | 16617 / 18680 |
| app.runwayml.com / runwayml.com | – / 48210 | 117176 / 26011 | 116445 / 16359 | 112700 / 8628 |
| hailuoai.video | – | – | 16434 | 37195 |
| lumalabs.ai | 494549 | 173491 | 47731 | 36188 |
| elevenlabs.io | – | 15588 | 6811 | 5125 |
| ideogram.ai | – | 41011 | 35386 | 38274 |
| www.recraft.ai / recraft.ai | – | – / 170705 | 116007 / 37370 | 288834 / 48572 |

Quirk: in Tranco the **bare domain usually outranks the `www.`/app host** (DNS-based providers such as Umbrella and Farsight count all lookups). For example `perplexity.ai` is 864 while `www.perplexity.ai` is 9901. Decide per product whether to use the PLD or the app host, and keep the choice stable.

**Rate limit:** the API docs list HTTP 429 for more than 1 query per second. Sleep at least 1.1 s between API calls. Downloads are on Cloudflare (`Cache-Control: public, max-age=86400`); be polite and download serially.

**Licence / citation:** Tranco has no licence of its own. Each list page (`https://tranco-list.eu/list/{id}/1000000`, "Referencing the list") asks users to "cite our publication". The paper is Le Pochat, Van Goethem, Tajalizadehkhoob, Korczyński and Joosen, "Tranco: A Research-Oriented Top Sites Ranking Hardened Against Manipulation", NDSS 2019, https://doi.org/10.14722/ndss.2019.23386. The homepage "Attribution" section lists the upstream licences: Majestic CC BY 3.0, CrUX CC BY-SA 4.0 (as Tranco states it), Cloudflare Radar CC BY-NC 4.0, and Umbrella free of charge. Radar has been included since 2023-08, so the derived list is effectively **non-commercial**. That is fine for our site. The methodology page also recommends giving the list date. **Verdict: OK for a non-commercial site with the paper citation, a link, and the list ID and date.**

**Fixtures (`pipeline/test/fixtures/tranco/`):**
- `sample-list-date.json`: `lists/date/2023-01-01`, default list
- `sample-list-date-subdomains.json`: `lists/date/latest?subdomains=true`
- `sample-list-date-404.json`: body of a 404 response
- `sample-ranks-domain.json`: `ranks/domain/chatgpt.com`
- `sample-ranks-domain-empty.json`: `ranks/domain/gemini.google.com` (empty)
- `sample-list.csv`: the first 5 rows of the 2026-10-07 subdomain list plus all rows for the requested hosts, in the original `rank,domain` format with no header

---

## statcounter — StatCounter Global Stats "AI Chatbot Market Share"

**URL (no key):**
```
https://gs.statcounter.com/chart.php?device=Desktop%20%26%20Mobile%20%26%20Tablet%20%26%20Console&device_hidden=desktop%2Bmobile%2Btablet%2Bconsole&multi-device=true&statType_hidden=ai_chatbot&region_hidden=ww&granularity=monthly&statType=AI%20Chatbot&region=Worldwide&fromInt=202301&toInt=202609&fromMonthYear=2023-01&toMonthYear=2026-09&csv=1
```
- Region: `region_hidden=US` (with `region=United States Of America`) works. Device: `device_hidden=desktop` works.
- The response is `application/octet-stream` (CSV text), about 1.4 KB. No browser UA was required, but one was sent.
- Human page: https://gs.statcounter.com/ai-chatbot-market-share

**Format (range query = "line graph" CSV):** UTF-8, LF line endings, trailing newline. All header cells are double-quoted; data cells are not quoted.
```
"Date","ChatGPT","Perplexity","Google Gemini","Microsoft Copilot","Claude","Deepseek","Other"
2025-04,84.21,12.07,2.31,0.23,0.3,0.88,0
...
2026-09,80.47,5.84,10.94,1.78,0.95,0.02,0
2023-01,0,0,0,0,0,0,0
...
2025-03,0,0,0,0,0,0,0
```
- `Date` is `YYYY-MM`. Values are % share (0–100, up to 2 decimals), and each row sums to about 100.
- **Real data starts 2025-04** (matches spec §5.2). Months before coverage are **appended after the real rows as all-zero rows**, so the file is out of order. Sort by `Date` and treat all-zero rows as *missing*, not 0%.
- **Column order changes with the query** (sorted by share over the selected range: the 2025-04..06 query returns `ChatGPT, Perplexity, Microsoft Copilot, Google Gemini, Deepseek, Claude, Other`). Map columns by header name.
- **Labels (the whole universe):** `ChatGPT`, `Perplexity`, `Google Gemini`, `Microsoft Copilot`, `Claude`, `Deepseek` (lowercase s), `Other`. **Grok, Meta AI, Mistral and Qwen are not tracked.** `Other` is about 0.
- A single-month range (`fromInt=toInt`) returns a **different "bar" format**:
  ```
  "AI Chatbot","Market Share Perc. (Sept 2026)"
  "ChatGPT",80.47
  ```
  Always request a range of at least 2 months to get the line format.
- The HTML page shows slightly different values (80.48% vs 80.47% in the CSV). The FAQ says line and bar graphs are computed differently and shouldn't be compared point by point.

**Date semantics / revisions:** monthly totals. The FAQ says stats are published daily at about 13:00 GMT for the previous day, can be revised for 45 days after first publication, and are frozen after that. **Re-fetch the last 2 months on every run.** The partial current month appears if `toInt` includes it, so request up to the previous month only.

**What it measures:** the FAQ has no AI-chatbot-specific methodology. It is presumably the share of referral page views from AI chatbots to the more than 1M StatCounter-tagged sites (an assumption, not confirmed). It is biased toward chatbots that link out (Perplexity is over-weighted). Mention this on the methods page.

**Auth / rate limit:** none documented. Be gentle: one request per run is enough.

**Licence:** CC BY-SA 3.0 Unported. The FAQ "Can I use Statcounter Global Stats data for my blog/website/paper/project/book?" at https://gs.statcounter.com/faq answers "Please do!" and asks users to "please ensure to credit us (with a link)". **Verdict: OK with credit and a link.** ShareAlike applies to the derived StatCounter data we republish.

**Fixtures:** `pipeline/test/fixtures/statcounter/sample.csv` is the full WW monthly 2023-01..2026-09 response, untouched. `sample-bar.csv` is the single-month (bar) format.

---


## ramp — Ramp AI Index (business adoption by vendor)

**URLs:**
- `GET https://ramp.com/data/ai-index` with a browser-like User-Agent and no auth. The response is about 10.3 MB of HTML (about 0.7 MB gzipped), with `Cache-Control: private, no-cache, no-store`.
- The **same URL with request header `RSC: 1`** returns the raw Next.js flight payload (`text/x-component`, about 9.1 MB). This skips the `<script>` unwrapping step.
- The official REST API is `https://api.ramp.com/v1/public/ai-index/adoption?months=N` (plus `/adoption/sectors` and `/adoption/sizes`). It needs a **Ramp Data Partner key**; without one it returns 401 with error code `RAMP_DATA_7001`. Docs: https://docs.ramp.com/llms-guides/ai-index.txt. Not usable for us.
- There is no CSV or JSON download link on the page. `robots.txt` does not block `/data/ai-index`.

**Where the JSON is (Next.js App Router flight data, no `__NEXT_DATA__`):**
1. Collect every `<script>self.__next_f.push([1,"…"])</script>`, using the regex `/<script>self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g`.
2. `JSON.parse` the captured array, keep entries with `a[0] === 1`, and **concatenate** `a[1]` across all chunks (there are 5 today).
3. The result is a stream of rows shaped `<hexid>:<payload>`. The data is the **props object of the client component `AIIndexDashboard`**. Today the element is `["$","$L141",null,{…props}]` in row `132:`, and the client reference is row `141:I[691947,[…],"AIIndexDashboard"]`.
4. **The row ids (132, 141) change every build.** Find the object that has an `adoptionVendor` key: search for `"adoptionVendor":[`, then walk the parsed tree or bracket-match. Alternatively, resolve the `I[` row whose export name is `"AIIndexDashboard"`.
5. The HTML has escapes such as `<`; `JSON.parse` handles them. Some fields contain the literal string `"$undefined"` (React's marker for a missing value), which should be treated as null.

**Props keys (JSON path = props.<key>):**

| key | rows | record shape / notes |
|---|---|---|
| `adoptionOverall` | 44 | `{date_month:"2023-01-01", adoption_rate_pct:7.46, mom_change_pp:0, yoy_change_pp:null}` |
| **`adoptionVendor`** | 264 = 6 vendors × 44 months | `{date_month:string, vendor:string, adoption_rate_pct:number, mom_change_pp:number}`, sorted by month, then vendor |
| `adoptionIndustry` | 308 | adds `naics_sector` (7 sectors) |
| `adoptionSize` | 132 | adds `business_size` (Small / Medium-sized / Large businesses) |
| `adoptionState` | 2194 | `{date_month, state_code, adoption_rate_pct, n_firms, ai_firms}` |
| `adoptionUsEstimate` | 36 | Census BTOS comparison (some nulls) |
| `modelBreakdown`, `modelShareCurated` | 434 / 7535 | API spend share by model, `ai_provider` ∈ OpenAI, Anthropic, Cursor, xAI, Open Source, from 2025-01 |
| `tokenPrices`, `tokenVolumes` | 3822 / 18064 | daily and weekly token data by `model_maker` |
| `spendPerEmployee*`, `spendShareData` | — | spend metrics |
| scalars | — | `filterModeBundleVersion`, `sanityDataset`, `hasModelBreakdownFilterMode`, `hasSpendPerEmployeeFilterMode` |

**Vendor keys (exact):** `Anthropic`, `DeepSeek`, `Google`, `Mistral AI`, `OpenAI`, `xAI`.
- All six have all 44 months (2023-01 → 2026-08).
- There is no Meta, Qwen, Microsoft or Perplexity series.
- The page's colour map also knows `Microsoft` and `X` (not in the data now), so the set has changed before. Don't hard-code it; warn on unknown vendors.

**Example:** `{"date_month":"2026-08-01","vendor":"Anthropic","adoption_rate_pct":43.78,"mom_change_pp":0.33}`. The 2026-08 values are Overall 56.13, Anthropic 43.78, OpenAI 39.76, Google 6.15, xAI 4.63, DeepSeek 0.34 and Mistral AI 0.20.

**Semantics:**
- `adoption_rate_pct` is the % of businesses in Ramp's US sample (70k+ firms per the page; older docs say 30k–50k) that had a **paid** transaction (card or bill pay) with that vendor's AI products in that month. Free use is not counted.
- **Vendor rates overlap** (they sum to about 95 vs an overall 56), so normalise the vendor rates yourself to get a within-front share.
- `date_month` is `YYYY-MM-01`. The data lags about 5–6 weeks (on 2026-10-08 the latest is 2026-08). The first month's `mom_change_pp` is 0, not null.
- These are **vendor-level, not product-level** figures, based on merchant classification. xAI is already 0.84% in 2023-01, before Grok existed, so it probably includes X Corp spend. Google likely includes Workspace/Cloud AI. Treat early values with care.

**Licence:**
- Ramp's blog post https://ramp.com/blog/ramps-economic-data-is-now-accessible-via-claude-chatgpt-bloomberg-and-more has a footnote that says **"Ramp does not license this data."** It goes on to describe the aggregated data as provided to the public, and the post calls the indices free and public.
- There are no website terms of use for visitors. The footer's "Terms of Service" link goes to the customer Platform Agreement, which treats de-identified "Ramp Data" as Ramp property but binds customers only.
- Syndication in a "product, report, newsletter, or marketplace" is routed to the Data Partner Program (https://ramp.com/data-partnerships).
- Nothing on the AI Index page itself mentions a licence or citation.

**Verdict: unclear, low risk.** Showing derived shares with credit ("Source: Ramp AI Index" linked to the page) on a non-commercial site seems acceptable. Do not bulk-republish the raw series, and fetch at most monthly. For certainty, ask press@ramp.com for a written OK. Spec §5.2 already marks this as "要確認" (to be confirmed), and this result keeps it there.

**Fixtures:**
- `pipeline/test/fixtures/ramp/sample.json` (117 KB) is the real `AIIndexDashboard` props with keys in their original order. `adoptionOverall`, `adoptionVendor`, `adoptionSize`, `adoptionUsEstimate`, `spendPerEmployee` and `spendShareData.overall` are complete. The other arrays are trimmed.
- `sample.html` (109 KB) is the real embedding format: a `push([0])` bootstrap, then one `self.__next_f.push([1,"…"])` holding the real rows `141:` and `132:`, with props trimmed to match sample.json. Parsing it with the recipe above yields exactly sample.json.

---

## openrouter — OpenRouter token rankings

**Keyless exports (verified):**

| URL | notes |
|---|---|
| `https://openrouter.ai/api/v1/datasets/exports/index.json` | Catalogue of 4 datasets: `benchmark-runs`, `benchmark-leaderboard`, `search-benchmark-lanes`, `rankings-daily` |
| `https://openrouter.ai/api/v1/datasets/exports/rankings-daily/latest.csv` | 123 KB, `text/csv; charset=utf-8` (also `latest.json`, `latest.manifest.json`) |
| `https://openrouter.ai/api/v1/datasets/exports/rankings-daily/<YYYY-MM-DD>.{csv,json,manifest.json}` | Dated, immutable snapshots. **The oldest is 2026-09-19**; 2026-09-18 and everything earlier back to 2025-10-01 return 404 `{"error":{"message":"Export not found","code":404}}` |
| `.../exports/README.md`, `.../exports/LICENSE` | Methodology and licence |

- Snapshots are published at about 01:46 UTC daily.
- Headers: `Cache-Control: public, max-age=300`, an ETag, and CORS `*`.

**index.json:** `{schema_version:"v1", updated_at, update_cadence:"daily", license:{name,url}, attribution, readme_url, license_url, datasets:[{id, title, latest_snapshot_date, latest_manifest_url}]}`.
- **It does not list dated files.** Build the dated URLs yourself.
- A manifest is `{dataset, schema_version, snapshot_date, retrieved_at, row_count, update_cadence, license, attribution, readme_url, files:{csv:{url,encoding_format,bytes,sha256}, json:{…}}, latest:{…}}`.
- The README recommends reading the manifest, downloading the dated file and verifying its sha256, because the `latest.*` aliases can briefly mix snapshot dates after a publish.

**CSV:** ASCII, **CRLF** line endings, no quoting.
```
date,model_permaslug,rank,total_tokens,share_of_daily_tokens
2026-09-30,stealth/space-bunny-alpha,1,5331621827040,0.21870872876777964
2026-09-08,other,,1114824363473,0.05853241362259723
```

| column | type | notes |
|---|---|---|
| `date` | `YYYY-MM-DD` | UTC day |
| `model_permaslug` | string | model variant, or the literal `other` |
| `rank` | int, **empty on the `other` row** | 1..50 by tokens within the day |
| `total_tokens` | int | prompt + completion tokens. Values reach about 7.5e12 per row; daily totals are 1.7–2.6e13, which is safe in a JS Number but large when summed over months. **No request counts.** |
| `share_of_daily_tokens` | float 0–1 | Shares within a day sum to 1, including `other` |

- **Each snapshot is a trailing 30-day window, not one day:** top 50 + `other` per day, so 30 × 51 = 1,530 rows. `other` is always the last row of its day and holds 5–8% of daily tokens.
- Successive snapshots revise the last 2–3 days slightly (≤ 0.04%), so **take each date from the newest snapshot containing it**.
- Stitching all snapshots gives continuous keyless data from **2026-08-20** onward.
- A 31-day month needs 2 snapshots.
- Models with zero text tokens and private models are excluded.
- The JSON twin has the same rows, plus `columns[]` metadata, `row_count`, `methodology` and `source_pages`.

**`model_permaslug` naming:** `<author>/<model>[-YYYYMMDD][:variant]`.
- 22 author prefixes appeared in the last 30 days: `anthropic`, `deepseek`, `dots-studio`, `google`, `inclusionai`, `meta` (**not `meta-llama`**), `minimax`, `mistralai`, `moonshotai`, `nex-agi`, `nvidia`, `openai`, `poolside`, `qwen`, `stealth`, `tencent`, `thinkingmachines`, `typesafe`, `upstage`, `x-ai`, `xiaomi`, `z-ai`, plus `other`.
- The date suffix is `-YYYYMMDD` with no dashes inside the date, e.g. `openai/gpt-6-luna-20260922`, `anthropic/claude-opus-5.5-20260921`, `x-ai/grok-4.7-20260916`. Some slugs have no date (`google/gemini-2.5-flash`, `openai/gpt-oss-120b`). The suffix is not a reliable release date; `nvidia/...-20230311:free` exists.
- Only the `:free` variant appeared in this window. The docs say each non-default variant gets its own slug and rank.
- Anonymous `stealth/*` models can be huge. `stealth/space-bunny-alpha` was #1 on 2026-09-30 at 22%, then vanished. Map unknowns to an "unattributed" bucket or a manual override.
- Token share by prefix on 2026-10-07: deepseek 35.8%, z-ai 10.3%, openai 9.4%, xiaomi 7.8%, other 7.1%, tencent 6.6%, anthropic 5.9%, nvidia 4.7%, google 3.5%, … qwen 0.6%, x-ai 0.45%. **This is a developer/API signal that heavily favours cheap open models.**
- The author prefix tells you the vendor, not the unit: `google/` covers both Gemini and Gemma, and `meta/` covers Llama.

**Keyed endpoint (from docs; not called with a key):** `GET https://openrouter.ai/api/v1/datasets/rankings-daily` with header `Authorization: Bearer <OPENROUTER_API_KEY>` (any normal key).
- Params:
  - `start_date` and `end_date` (YYYY-MM-DD UTC, inclusive). The default is the last 30 days and the maximum window is **366 days**.
  - **The dataset begins 2025-01-01.** An earlier start is clamped; an earlier end returns 400.
  - From the OpenAPI spec at https://openrouter.ai/openapi.json: `period=day|week|month`, `modality=text|image|image_output|audio|tool_calling`, `context_bucket`, `category`, `language_type`.
  - There is no paging.
- Response: `{"data":[{"date":"2026-05-11","model_permaslug":"openai/gpt-4o-2024-05-13","total_tokens":"12345678"}],"meta":{"as_of","version":"v1","start_date","end_date"}}`. **`total_tokens` is a string. There are no rank or share fields.** It is sorted by date, then tokens descending, with `other` last. The current day is live and incomplete.
- Errors: 400, 401, 429 and 500, shaped `{error:{code,message}}`.
- **Rate limit:** 30 requests/min per key and 500 requests/day per account.
- Docs: https://openrouter.ai/docs/cookbook/administration/data-api and https://openrouter.ai/docs/api/api-reference/datasets/daily-token-totals-for-top-50-models.
- **To backfill 2025-01 → 2026-08 we need a (free) key**: about 2 calls with `period=month`.

**Licence:** CC BY 4.0, including commercial use. The exports LICENSE (https://openrouter.ai/api/v1/datasets/exports/LICENSE) covers every file under `/exports/`.
- Required credit: credit OpenRouter, link the licence and indicate changes.
- The ready-made credit line is the `attribution` field of `index.json` (see the fixture). The Data API guide also asks for an "as of `<meta.as_of>`" citation.
- The guide says not to re-serve the data as a competing free API.

**Verdict: OK with credit.**

**Fixtures (`pipeline/test/fixtures/openrouter/`):**
- `sample.csv` (12 KB): the header plus the 153 rows of 2026-09-30, 2026-10-01 and 2026-10-07, original CRLF. It crosses a month boundary and includes `other` rows.
- `sample-index.json`: verbatim.
- `sample-manifest.json`: the 2026-10-08 manifest, verbatim.

---

## wikipedia — Wikimedia pageviews (attention)

**URL template (base unchanged, still live):**
```
https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/{project}/{access}/{agent}/{article}/{granularity}/{start}/{end}
e.g. …/per-article/en.wikipedia/all-access/user/ChatGPT/monthly/20221101/20260930
```
- OpenAPI spec: `https://wikimedia.org/api/rest_v1/metrics/pageviews/api-spec.json`. Reference docs: https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html.
- The api.wikimedia.org portal is being retired (2026), but pageviews were never served there. Data starts 2015-07-01.
- `project` is `en.wikipedia`.
- `access` is `all-access | desktop | mobile-web | mobile-app`; the parts add up exactly to all-access.
- `agent` is `all-agents | user | spider | automated`. **Use `user`.** `user + automated + spider = all-agents` exactly.
- `granularity` is `daily | monthly`.
- `start` and `end` are `YYYYMMDD` (or `YYYYMMDDHH`, where the hour is ignored), inclusive.
- A monthly value is the sum of the daily values *inside the range*, so a partial edge month comes back as a partial sum. A range with no whole calendar month gives **400 "no full months between dates"**.
- **The current month is returned as a partial value.** `end=20261031` gave ChatGPT 2026-10 = Oct 1–7 only. **Always set `end` to the last day of the previous complete month.** Data runs about 1 day behind.

**Response** (`application/json`, `s-maxage=14400`):
```json
{"items":[{"project":"en.wikipedia","article":"ChatGPT","granularity":"monthly","timestamp":"2022120100","access":"all-access","agent":"user","views":1882964}, …]}
```
- `timestamp` is `YYYYMM0100` for monthly data. `article` echoes the title with underscores.
- Months before the first view are **omitted** (asking from 20221101 starts at 2022-12). Zero months are sometimes omitted and sometimes explicit `"views":0`, so fill gaps with 0 yourself, but only after the article start date.
- Errors:
  - **404** `application/problem+json` (`{"detail":…,"method":"get","status":404,"title":"Not Found","type":"about:blank","uri":…}`) for an unknown title, a range before the article existed, or an all-zero range. These cases look the same.
  - **429** is `text/plain` with a `retry-after` header.
  - **403** (empty or banned UA) is `text/plain`.

**Title encoding:**
- Spaces become `_`. Parentheses are fine raw or %-encoded, so `encodeURIComponent` is fine. `/` must be `%2F`.
- **Titles are case-sensitive, including the first letter.**
- **Redirects are NOT followed.** A visit through a redirect URL is logged under the redirect's own title (https://wikitech.wikimedia.org/wiki/Data_Platform/Data_Lake/Traffic/Pageviews/Redirects).

**User-Agent policy:** https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy (the meta page now points there).
- Send a descriptive UA with contact info, e.g. `AIWAR-pipeline/1.0 (https://github.com/<owner>/<repo>; <contact>) node-fetch/x`.
- Observed: generic UAs such as `python-requests` and `axios`, and an empty UA, got **403**. Node's built-in `fetch` default UA passes but is treated as unidentified.

**Rate limits** (https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits, enforced since 2026):
- About **200 requests/min** for an unauthenticated client with a compliant UA.
- **10/min** without one.
- Keep concurrency at 3 or fewer and honour `Retry-After` (wait at least 5 s if it's missing).
- The recon still hit 429s at about 1 request/s, probably because parallel agents shared one IP. Go serial and add retry.

**Licence:** CC0 1.0. The Analytics API access-policy page (https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html) and the API spec both say so. **Verdict: OK (no attribution required; credit anyway).**

**Titles (en.wikipedia; all verified via MediaWiki `action=query&redirects=1` on 2026-10-08).** Store a **pageid** per product and resolve the current title on each run (`action=query&pageids=…`).

| product | current title (URL form) | pageid | former titles → move date | article starts | 2026-09 user views (current → +former titles) |
|---|---|---|---|---|---|
| ChatGPT | `ChatGPT` | 72417803 | — | 2022-12 | 1,811,003 |
| Claude | `Claude_(AI)` | 75879512 | `Claude_(language_model)` → 2026-06-20 | 2024-01 | 161,884 → 187,756 |
| Gemini (app) / Bard | `Google_Gemini` | 73363598 | `Bard_(chatbot)` → `Gemini_(chatbot)` 2024-02-08 → `Google_Gemini` 2025-10-03. (`Google_Bard` was only ever a redirect.) | 2023-03 | 89,234 → 94,988 |
| Gemini (model) | `Gemini_(language_model)` | 74637995 | — | 2023-12 | 26,897 |
| Nano Banana | (no article; `Nano_Banana` redirects to `Gemini_(language_model)#Nano_Banana` since 2026-01-21) | — | standalone article 2025-09 → 2026-01 | 2025-09 → 2026-01 | 2,121 (redirect hits) |
| Grok | `Grok_(chatbot)` | 75223933 | — | 2023-11 | 58,836 |
| DeepSeek (company) | `DeepSeek` | 78452842 | — | 2024-12 | 86,069 |
| DeepSeek (chatbot) | `DeepSeek_(AI)` | 79122294 | `DeepSeek_(chatbot)` → 2026-09-21 | 2025-02 | 1,912 → 10,608 |
| Qwen | `Qwen` | 78475283 | — | 2024-11 | 41,703 |
| Llama | `Llama_(language_model)` | 73306787 | `LLaMA` → 2024-05-15 | 2023-03 | 15,662 → 16,518 |
| Mistral AI | `Mistral_AI` | 75544367 | — | 2023-12 | 37,802 |
| Le Chat | `Mistral_Vibe` | 82525243 | `Le_Chat_(AI)` 2026-02-27 → `Le_Chat_(chatbot)` 2026-05-27 → `Mistral_Vibe` 2026-05-31. Plain `Le_Chat` is a comics character. | 2026-02 | 3,917 → 4,259 |
| Midjourney | `Midjourney` | 71151961 | — | 2022-06 | 16,480 |
| Suno | `Suno` | 75720229 | `Suno_AI` → `Suno_(platform)` 2025-10-20 → `Suno` 2026-08-14. **Plain `Suno` was a disambiguation page before 2026-08**, so only count it from 2026-08. | 2024-01 | 18,861 → 26,177 |
| Udio | `Udio` | 76615493 | — | 2024-04 | 2,617 |
| Sora | `Sora_(text-to-video_model)` | 76106601 | — (the app shut down 2026-04 per the article) | 2024-02 | 19,745 |
| Veo | `Veo_(text-to-video_model)` | 80037495 | — | 2025-05 | 6,096 |
| Kling | `Kling_AI` | 81136786 | `Kling_AI_(company)` → 2025-10-27 | 2025-09 | 5,419 → 5,600 |
| Runway | `Runway_(company)` | 74826000 | — | 2023-11 | 5,721 |
| ElevenLabs | `ElevenLabs` | 72925204 | — | 2023-02 | 28,085 |
| Flux | `Flux_(text-to-image_model)` | 78378498 | `FLUX.1` → 2024-11-18 | 2024-11 | 3,744 |
| Ideogram | `Ideogram_(text-to-image_model)` | 76462437 | `Ideogram_(generative_AI_site)` → 2024-09-19. Plain `Ideogram` is the writing-symbol article. | 2024-03 | 1,375 |
| Perplexity | `Perplexity_AI` | 75743156 | `Perplexity.ai` → `Perplexity_(company)` → `Perplexity_AI` 2024-09-20 | 2024-01 | 72,897 → 73,150 |
| Microsoft Copilot | `Microsoft_Copilot` | 73312151 | `Microsoft_365_Copilot` → 2023-11-15 | 2023-03 | 38,318 |
| Meta AI | none for the assistant. `Meta_AI` is the research lab; `Meta_AI_(chatbot)` redirects to a section. The new agent article is `Muse_(AI_agent)` (2026-09-29). | — | — | — | — |

**Stitching:**
- After a move, the old title keeps about 10–15% of the traffic as redirect hits for months. The cut-over itself is gradual over a few days.
- Monthly attention = the current title + every **former title of the same page** (a curated alias list per product, or auto-detected from the page history's "moved page [[A]] to [[B]]" revision comments), summed per month.
- Count a reused title only for the period it belonged to the page (see Suno).
- **Do not sum all incoming redirects.** Some used to be articles about other things: `Black_Forest_Labs` adds +13% to Flux, and `Aravind_Srinivas` adds +10% to Perplexity.
- Treat months before the article start date as **"no article" (missing), not 0**. Before then, products were covered inside other articles (Bard in LaMDA, Claude in Anthropic).
- Watch for bot spikes counted as users. ChatGPT 2025-06 had days at 4–10× the median. Consider fetching daily data and clipping outlier days.

**Other quirks:**
- Generic titles like `Ideogram`, `Le_Chat`, `Meta_AI` and pre-2026-08 `Suno` are other topics.
- A local cache keyed by title breaks on Windows: NTFS is case-insensitive and `:` is illegal in filenames. Hash the cache filenames.
- Scale (2026-09): ChatGPT at about 1.8M is about 10–20× everything else, so share charts will be dominated by it.

**Fixtures (`pipeline/test/fixtures/wikipedia/`, raw API bodies):**
- `sample-chatgpt.json`: 46 items, 2022-12..2026-09.
- `sample-bard.json`: `Bard_(chatbot)`, which drops after the Feb 2024 move.
- `sample-gemini.json`: `Gemini_(chatbot)`.
- `sample-google-gemini.json`: the current title.
- `sample-google-bard-redirect.json`: redirect-only hits.
- `sample-404.json`, `sample-400-no-full-months.json`, `sample-429.txt`, `sample-403-no-useragent.txt`: error bodies.

---

## itunes — App Store rating counts via iTunes Lookup API

**URLs (no auth):**
- `https://itunes.apple.com/lookup?id=<id1>,<id2>,…&country=us`
  - Comma-separated multi-id works (22 ids were tested in one call).
  - Results come back in request order.
  - **Unknown or removed ids are silently dropped**, with no error and a smaller `resultCount`.
  - With no `country`, it defaults to US.
  - `lookup?bundleId=a,b` also works.
- `https://itunes.apple.com/search?term=…&entity=software&country=us&limit=N` (1–200) is for finding ids.

**Format:**
- JSON served as `Content-Type: text/javascript`. The body **starts with 3 newlines**; `JSON.parse` copes.
- Akamai caches responses for about 22 h, keyed by the exact query string. Two different queries in the same minute returned different counts for ElevenLabs (21,848 vs 21,760), so **use one stable, sorted-id URL per run**.

**Fields:** `{resultCount:number, results:[…]}`. Per result:
- Numbers: `trackId`, `artistId`, `userRatingCount`, `averageUserRating` (5 decimals), `userRatingCountForCurrentVersion`, `averageUserRatingForCurrentVersion`, `price`, `primaryGenreId`.
- Strings: `trackName`, `trackCensoredName`, `sellerName`, `artistName`, `bundleId`, `version`, `primaryGenreName`, `kind` (`software` or `mac-software`), `wrapperType`, `currency`, `formattedPrice`, `contentAdvisoryRating`, `minimumOsVersion`.
- `fileSizeBytes` is a **string**.
- `releaseDate` and `currentVersionReleaseDate` are ISO-8601 UTC (`2023-05-18T07:00:00Z`).
- URLs: `trackViewUrl`, `artworkUrl60/100/512`, `sellerUrl` (sometimes missing).
- Text: `description`, `releaseNotes`.
- Arrays: `genres`, `genreIds`, `screenshotUrls`, `ipadScreenshotUrls`, `supportedDevices`, `advisories`, `features`, `languageCodesISO2A`.
- Booleans: `isGameCenterEnabled`, `isVppDeviceBasedLicensingEnabled`.
- Mac apps lack several iOS-only fields.

**Example (trimmed):** `{"trackId":6448311069,"trackName":"ChatGPT","sellerName":"OpenAI OpCo, LLC","bundleId":"com.openai.chat","userRatingCount":11079400,"averageUserRating":4.826…,"version":"…","currentVersionReleaseDate":"…"}`

**Date semantics:**
- `userRatingCount` is the **lifetime count for that storefront at fetch time**. There is no history and no as-of field, so record the fetch time.
- A monthly series has to be built by snapshotting from now on (spec: "現在値のみ（今後自分で蓄積）", i.e. current values only, accumulated by us from now). Guard against drops: developers can reset ratings.
- `…ForCurrentVersion` equals the lifetime values for all apps tested; Apple no longer splits by version.
- Counts are **per country**: JP ChatGPT has 2.57M vs US 11.08M, and `trackName` is localised in JP. Fix one storefront (US).

**App id table (US, 2026-10-08):**

| product | id | trackName | sellerName | US userRatingCount |
|---|---|---|---|---|
| ChatGPT | 6448311069 | ChatGPT | OpenAI OpCo, LLC | 11,079,400 |
| Gemini | 6477489729 | Google Gemini | Google LLC | 2,321,604 |
| Claude | 6473753684 | Claude by Anthropic | Anthropic PBC | 275,581 |
| Grok | 6670324846 | Grok AI | **X Corp.** | 1,487,413 |
| DeepSeek | 6737597349 | DeepSeek - AI Assistant | Hangzhou DeepSeek Artificial Intelligence Co., Ltd | 12,164 (CN store: 89,956) |
| Perplexity | 1668000334 | Perplexity - AI Search & Chat | Perplexity AI Inc. | 512,913 |
| Meta AI ⚠ | 1558240027 | Meta AI | Meta Platforms, Inc. | 268,932. **This is the renamed Meta View (Ray-Ban glasses) app, released 2021**, so its ratings predate Meta AI |
| Mistral ⚠ | 6740410176 | **Vibe by Mistral (ex-Le Chat)** | MISTRAL AI | 1,302 |
| Suno | 6480136315 | Suno - AI Songs, Music, Lyrics | Suno Inc. | 366,778 |
| ElevenLabs | 6743162587 | ElevenLabs: AI Voice Generator | Eleven Labs Inc. | 21,848 |
| ElevenReader | 6479373050 | ElevenReader: Read Books Aloud | Eleven Labs Inc. | 10,616 |
| ElevenMusic | 6755965224 | ElevenMusic: Create AI Songs | Eleven Labs Inc. | 483 |
| Kling | 6738049229 | Kling AI: AI Image&Video Maker | KLING AI PTE. LTD. | 31,572 |
| Runway | 1665024375 | Runway: AI Image & Video | Runway AI, Inc. | 16,872 (bundle id `com.runwayml.mobiletest`) |
| Udio | 6511211165 | Udio: AI Music Maker & Studio | Uncharted Labs Inc. | 3,569 |
| Copilot ⚠ | 541164041 | Microsoft Copilot | Microsoft Corporation | 1,347,244. This is the former Office/M365 app from 2013, a poor stand-in. The consumer Copilot app 6472538445 is gone (lookup returns 0) |
| Qwen ⚠ | 6466733523 (CN), 6743778442 / 6757738627 (intl) | 千问 / Qwen Studio / Qwen - Alibaba AI Assistant | various Alibaba entities | **not in the US store** |
| Sora ✗ | 6744034028 | — | — | **gone**: lookup returns 0 in US/CA/JP |
| Midjourney ✗ | — | — | — | no official app |

**Rate limit:** Apple documents about 20 calls/min and recommends caching. One batched call per run is enough.

**Licence:**
- The Search API page (https://performance-partners.apple.com/search-api) presents the API as a way for affiliates and partners to promote store content.
- Its promo-asset rules (artwork, previews, icons) require pairing with an official store badge and forbid using them for their own entertainment value.
- It now lists only the iTunes Store and Apple Books. The 2017 developer archive (https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html) still covers apps, and apps left the affiliate programme in 2018.
- Apple's general website Terms of Use (https://www.apple.com/legal/internet-services/terms/site.html) restrict republishing site content and limit automated access to the means Apple provides.
- No clause addresses displaying rating counts for analysis.

**Verdict: unclear, practically low risk.** Rating counts are facts, the endpoint is public and unauthenticated, and the site is non-commercial. Show counts or derived shares with "Source: Apple App Store (US), via iTunes Search API". **Do not show icons, artwork or screenshots** unless they sit next to an App Store badge link. Keep the "要確認" (to be confirmed) mark and use the signal only for the product fronts (§6.2-3).

**Fixture:** `pipeline/test/fixtures/itunes/sample.json` (95 KB) is the untouched 9-id US lookup response, byte-for-byte, including the leading newlines. There is no missing-id case in it; build one by hand for that test.

---

## cloudflare — Cloudflare Radar API (docs only; no token)

No calls were made to `api.cloudflare.com`. Sources: the OpenAPI spec (https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json), the API reference under https://developers.cloudflare.com/api/resources/radar/subresources/ranking/, the Radar docs (glossary, release notes, error codes) and blog posts.

**Auth:** header `Authorization: Bearer <token>`. The guide (https://developers.cloudflare.com/radar/get-started/first-request/) says to create a custom token with **Account › Radar › Read**. The API reference pages list "User Details Read/Write" instead; test the guide's version first. Radar is free on all plans.

**(a) Generative-AI service ranking over time:** `GET https://api.cloudflare.com/client/v4/radar/ranking/internet_services/timeseries_groups`
- Params:
  - `serviceCategory[]`: exact value **`Generative AI`**. Other categories: E-commerce, Cryptocurrency Services, Email, Fast Fashion, Financial Services, News, Social Media, Weather, Jobs, Low cost E-commerce, Messaging, Metaverse & Gaming.
  - `limit` (default 5, top-N services) and `name[]`.
  - `dateRange[]` (`<n>d` ≤ 364d or `<n>w` ≤ 52w) **or** `dateStart[]`/`dateEnd[]` (ISO date-time).
  - `format=JSON|CSV`.
  - **There is no location parameter; the ranking is global only.**
- Response:
  ```json
  {"success":true,"result":{
    "meta":{"aggInterval":"…","confidenceInfo":{"level":0,"annotations":[]},"dateRange":[{"startTime":"…","endTime":"…"}],
            "lastUpdated":"…","normalization":"…","units":[{"name":"*","value":"…"}]},
    "serie_0":{"timestamps":["2025-01-26T00:00:00Z", …], "<ServiceName>":[1, …], …}}}
  ```
  The spec allows values to be numbers or numeric strings, so parse with `Number()`.
- **Values are ranks (1 = most popular), not traffic shares.** The glossary describes popularity as estimated unique users of the service's domains. The Year in Review says rankings show relative popularity, not absolute traffic. A share requires our own rank→share model, the same idea as CrUX.
- Siblings:
  - `GET /radar/ranking/internet_services/top`: params `serviceCategory[]`, `limit`, `date[]`. Returns `result.top_0:[{rank, service}]` and `meta.top_0:{date, serviceCategory}`.
  - `GET /radar/ranking/internet_services/categories` returns `result.categories_0:[{name}]`.
- **History:**
  - A changelog entry dated 2025-02-04 (https://developers.cloudflare.com/changelog/, "radar-ai-insights") says these service rankings, previously only in the annual Year in Review, became available daily via the API from then on.
  - The launch blog (https://blog.cloudflare.com/expanded-ai-insights-on-cloudflare-radar/) shows daily data from 2025-01-26.
  - **No API floor date is documented.** The spec's "2025-02〜" (from 2025-02) is the safe assumption; test an earlier `dateStart` with a real token.
- **Service names are not documented.** Year-in-Review posts use `ChatGPT / OpenAI`, `Claude / Anthropic`, `Google Gemini`, `Perplexity`, `Character.AI`, `GitHub Copilot`, `Grok / xAI`, `DeepSeek`, `Windsurf AI`, `QuillBot`. Older years use `OpenAI`, `Bard`, `Codeium` and similar. Names get renamed, so record the exact strings from the first real call into `units.yaml`.

**(b) Domain rank and buckets:**
- `GET /radar/ranking/domain/{domain}`
  - Params: `rankingType=POPULAR|TRENDING_RISE|TRENDING_STEADY`, `includeTopLocations`, `date[]`, `limit`, `format`.
  - Returns `result.details_0:{rank?, bucket?, categories:[{id,name,superCategoryId}], top_locations?:[{locationCode,locationName,rank}]}`.
  - `bucket` is a string such as `"2000"` and is only given for the most recent POPULAR ranking.
- `GET /radar/ranking/timeseries_groups` with `domains[]`, `location[]`, `dateRange[]`/`dateStart[]`/`dateEnd[]`, `rankingType` and `limit`. Returns `serie_0:{timestamps, "<domain>":[rank…]}`.
- `GET /radar/ranking/top` returns `top_0:[{rank, domain, categories, pctRankChange?}]`.
- **Semantics:**
  - An exact rank is given only for the top 100 (global and per country), from the last 24 h, updated daily.
  - Beyond that there are unordered buckets of 200, 500, 1K, 2K, 5K, 10K, 20K, 50K, 100K, 200K, 500K and 1M, from 7 days, updated weekly.
  - Bucket datasets are available via `/radar/datasets` (`datasetType=RANKING_BUCKET`), generated since 2023-01-08.

**Rate limits and errors:**
- 1,200 requests per 5 min per user (shared with dashboard use) and 200 requests per second per IP. Exceeding the limit blocks calls for 5 minutes.
- Radar errors: 2001/400 validation, **2002/422 "Query is above max cost"**, 1015/429, 7003/404.

**Licence:** https://developers.cloudflare.com/radar/ says API data is **"made available under the CC BY-NC 4.0 license"**. https://radar.cloudflare.com/about adds that embeddable charts and images are CC BY 4.0, and that exceptions can be requested via radar@cloudflare.com. **Verdict: OK for a non-commercial site with credit. Reconsider if the site ever becomes commercial.**

**Public keyless data:** none usable. radar.cloudflare.com pages (`/ai-insights`, `/explorer`) return a bot challenge to scripts, and chart downloads are browser-only. A token is required.

**Fixtures (from the docs, not live data):**
- `pipeline/test/fixtures/cloudflare/sample.json` is the docs' 200 example for `internet_services/timeseries_groups`. **It has no per-service arrays** (only `serie_0.timestamps`) and generic placeholder meta (`aggInterval: FIFTEEN_MINUTES`, `normalization: PERCENTAGE`). Tests will need a hand-made variant with entries like `"ChatGPT":[1,1]`, following the spec's `{"Google":[2],"timestamps":[…]}` example.
- `sample-domain.json` is the docs' example for `ranking/domain/{domain}`.

---

## Cross-source summary

| source | access | history actually obtainable | granularity / unit | licence verdict |
|---|---|---|---|---|
| epoch-usage | keyless CSV | 2023-03 → 2026-09, sparse (51 rows) | point-in-time DAU/WAU/MAU, tokens, messages | CC BY 4.0, OK |
| crux | keyless gz CSV | 2021-02 → 2026-08, monthly | rank **bucket** (7 levels) per origin | CC BY 4.0, OK |
| tranco | keyless API + downloads | default daily lists for years; subdomain lists confirmed back to 2022-12-01 (occasional missing days, e.g. 2023-01-01) | exact rank 1..1M, 30-day average | cite the paper; includes Radar (NC) → OK for non-commercial use |
| statcounter | keyless CSV | **2025-04** → 2026-09, monthly | % share among 6 chatbots | CC BY-SA 3.0, OK with link |
| ramp | HTML-embedded JSON | 2023-01 → 2026-08, monthly | % of US businesses paying the vendor | **unclear, low risk** |
| openrouter | keyless exports from **2026-08-20**; keyed API from 2025-01 | daily | tokens (prompt + completion), top 50 + other | CC BY 4.0, OK |
| wikipedia | keyless REST (descriptive UA) | 2015-07 →, monthly | user pageviews per title | CC0, OK |
| itunes | keyless lookup | **current value only** (snapshot from now on) | lifetime rating count per storefront | **unclear, low risk** (facts only, no artwork) |
| cloudflare | **token required** | API daily since about 2025-01/02 (floor not documented) | **rank** within the "Generative AI" category | CC BY-NC 4.0, OK for non-commercial use |

Cross-cutting notes for the plan author:
- **StatCounter, Ramp, OpenRouter and Radar include non-units or vendor aggregates.** StatCounter covers Perplexity and Copilot, which are not units in v1 (§3). Ramp and OpenRouter are vendor-level: `google` mixes Gemini and Gemma, and Ramp's `xAI` predates Grok. Drop the non-unit categories and renormalise among units, or keep an "other" bucket explicitly. Write the choice on the methods page.
- **Missing ≠ 0 everywhere:**
  - CrUX: absent origin, plus a one-month Perplexity gap.
  - Tranco: missing list days.
  - StatCounter: all-zero rows before 2025-04.
  - Wikipedia: omitted months and months before the article existed.
  - Epoch: empty strings.
- **Host and title renames are frequent.** Model identifiers as **sets with validity windows** in `units.yaml`: CrUX origins, Tranco hosts, Wikipedia pageid plus former titles.
- **Line endings vary:** CrUX LF; Tranco zip CRLF vs direct-download LF; OpenRouter CRLF; StatCounter LF; Epoch LF with multi-line quoted fields.
- **Partial current month:** Wikipedia returns it, and StatCounter does if you ask for it. Always cap requests at the last complete month.
- **Revisions:** re-fetch the last 2 months for StatCounter (45-day revision window) and the last few days for OpenRouter.

---

## Product → identifiers per source

Legend: "—" means the source does not track the product; "n/c" means not checked in this recon.
- CrUX values are full origins; Tranco values are hosts (use the subdomain list).
- Date windows are when each identifier is present in that source.
- The Radar column is **unverified**: it uses names as written in Cloudflare's Year-in-Review posts, and the exact API strings must be confirmed with a token.

| unit (front) | CrUX origin(s) | Tranco host(s) | StatCounter label | Ramp vendor key | OpenRouter slug prefix | Wikipedia article (pageid) | iTunes app id (US) | Radar service (unverified) |
|---|---|---|---|---|---|---|---|---|
| GPT / ChatGPT (総合 general, コード code, エージェント agents) | `https://chatgpt.com` (1k from 2024-05); `https://chat.openai.com` (2022-12 → 2024-09) | `chatgpt.com`, `chat.openai.com` | `ChatGPT` | `OpenAI` | `openai/` (exclude `gpt-oss` if open models count separately) | `ChatGPT` (72417803) | 6448311069 | `ChatGPT / OpenAI` |
| Claude | `https://claude.ai` (2023-07 →); `https://claude.com` (2025-09 →) | `claude.ai` (`claude.com` n/c) | `Claude` | `Anthropic` | `anthropic/` | `Claude_(AI)` (75879512) + former `Claude_(language_model)` | 6473753684 | `Claude / Anthropic` |
| Gemini | `https://gemini.google.com` (2024-02 →); `https://bard.google.com` (2023-02 → 2024-02); `https://gemini.google` (2024-08 →) | `gemini.google.com`, `bard.google.com`, `gemini.google` | `Google Gemini` | `Google` | `google/gemini-*` (not `google/gemma-*`) | `Google_Gemini` (73363598) + former `Gemini_(chatbot)`, `Bard_(chatbot)` | 6477489729 | `Google Gemini` (2023: `Bard`) |
| Grok | `https://grok.com` (2025-01 →); `https://grok.x.ai` (2023-11 → 2024-05) | `grok.com` | — | `xAI` | `x-ai/` | `Grok_(chatbot)` (75223933) | 6670324846 (seller X Corp.) | `Grok / xAI` |
| DeepSeek | `https://chat.deepseek.com` (2024-05 →) | `chat.deepseek.com` | `Deepseek` | `DeepSeek` | `deepseek/` | `DeepSeek_(AI)` (79122294) + former `DeepSeek_(chatbot)`; company `DeepSeek` (78452842) | 6737597349 | `DeepSeek` |
| Qwen | `https://chat.qwen.ai` (2025-02 →); `https://chat.qwenlm.ai` (2025-01 → 04) | `chat.qwen.ai`, `qwen.ai` | — | — | `qwen/` | `Qwen` (78475283) | — in US (CN 6466733523; intl 6743778442) | n/c |
| Llama / Meta AI | `https://www.meta.ai` (2024-04 →); `https://meta.ai` (2026-02 →) | `meta.ai`, `www.meta.ai` | — | — | `meta/` (not `meta-llama`) | `Llama_(language_model)` (73306787) + former `LLaMA` | 1558240027 ⚠ (ex-Meta View app) | n/c |
| Mistral / Le Chat | `https://chat.mistral.ai` (2024-02 →) | `chat.mistral.ai` | — | `Mistral AI` | `mistralai/` | `Mistral_AI` (75544367); app `Mistral_Vibe` (82525243) | 6740410176 ("Vibe by Mistral") | n/c |
| Midjourney (画像 image) | `https://www.midjourney.com`; `https://alpha.midjourney.com`; `https://midjourney.com` (≤ 2023-05) | `midjourney.com`, `www.midjourney.com` | — | — | — | `Midjourney` (71151961) | — (no official app) | n/c |
| GPT Image (image) | no separate host (inside chatgpt.com) | — | — | (`OpenAI`) | — | n/c | — | — |
| Nano Banana / Imagen (image), Veo (動画 video) | `https://labs.google` (Flow/Whisk/ImageFX, shared; 1k in 2026); `https://aistudio.google.com` (shared) | `labs.google` | — | (`Google`) | — | Veo: `Veo_(text-to-video_model)` (80037495). Nano Banana: no article since 2026-01 (redirect into `Gemini_(language_model)` 74637995) | — (inside the Gemini app) | n/c |
| FLUX (image) | `https://bfl.ai` (500k–1M) | `bfl.ai` (n/c) | — | — | — | `Flux_(text-to-image_model)` (78378498) | n/c | — |
| Ideogram (image) | `https://ideogram.ai` | `ideogram.ai` | — | — | — | `Ideogram_(text-to-image_model)` (76462437) | n/c | — |
| Recraft (image) | `https://www.recraft.ai` | `recraft.ai`, `www.recraft.ai` | — | — | — | n/c | n/c | — |
| Sora (video) | `https://sora.chatgpt.com` (2025-04 →); `https://sora.com` (2024-12 → 2025-05) | `sora.chatgpt.com`, `sora.com` | — | (`OpenAI`) | — | `Sora_(text-to-video_model)` (76106601) | 6744034028 (**removed**; app shut down 2026-04) | — |
| Kling (video) | `https://kling.ai` (2026-03 →); `https://klingai.com`, `https://www.klingai.com`, `https://app.klingai.com` (2024-07 → 2026) | `klingai.com`, `kling.ai` | — | — | — | `Kling_AI` (81136786) | 6738049229 | — |
| Runway (video) | `https://app.runwayml.com`; `https://runwayml.com` (→ 2026-07); `https://runway.com` (2026-07 →) | `runwayml.com`, `app.runwayml.com`, `runway.com` | — | — | — | `Runway_(company)` (74826000) | 1665024375 | — |
| Hailuo / MiniMax (video, 音声 voice) | `https://hailuoai.video` (2024-09 →); `https://hailuoai.com`; `https://www.hailuo.ai`; `https://www.minimax.io` | `hailuoai.video` | — | — | `minimax/` (text models only) | n/c | n/c | — |
| Luma (video) | `https://lumalabs.ai`; `https://dream-machine.lumalabs.ai` (**not** `luma.com`, which is the events app) | `lumalabs.ai` | — | — | — | n/c | n/c | — |
| ElevenLabs (voice; Eleven Music) | `https://elevenlabs.io` | `elevenlabs.io` | — | — | — | `ElevenLabs` (72925204) | 6743162587 (+ ElevenReader 6479373050, ElevenMusic 6755965224) | — |
| Suno (音楽 music) | `https://suno.com` (2024-04 →); `https://www.suno.ai`, `https://app.suno.ai` (→ 2024-04) | `suno.com`, `suno.ai` | — | — | — | `Suno` (75720229; count only from 2026-08) + former `Suno_AI`, `Suno_(platform)` | 6480136315 | — |
| Udio (music) | `https://www.udio.com` (2024-04 →) | `udio.com`, `www.udio.com` | — | — | — | `Udio` (76615493) | 6511211165 | — |
| *(ref, not a unit)* Perplexity | `https://www.perplexity.ai` | `perplexity.ai`, `www.perplexity.ai` | `Perplexity` | — | — | `Perplexity_AI` (75743156) | 1668000334 | `Perplexity` |
| *(ref, not a unit)* Microsoft Copilot | `https://copilot.microsoft.com` | `copilot.microsoft.com` | `Microsoft Copilot` | — | — | `Microsoft_Copilot` (73312151) | 541164041 ⚠ (ex-Office app) | n/c |

Units from §3 with no identifiers found in any scale source (strength-only, or announcements only): Seedream and Seedance (ByteDance), Wan (Alibaba), OpenAI TTS, Gemini TTS, Cartesia, Hume, Lyria and Stable Audio. These were n/c in this recon. Likely candidate hosts would be `seed.bytedance.com`/`dreamina.capcut.com`, `cartesia.ai`, `hume.ai` and `stableaudio.com`.
