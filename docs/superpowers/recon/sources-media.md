# Recon: media-front "strength" data sources (image / video / speech / music): AI WAR

Checked on 2026-10-08 against the live sources. This file supports spec §5.1 (the image, video, speech and music rows) and §6.1 (`docs/superpowers/specs/2026-10-08-ai-war-design.md`).

**Fixtures** are in `pipeline/test/fixtures/<sourceId>/`:
- Text sources are trimmed originals in the source's own format, named `sample.*`.
- Parquet sources are converted to `sample.rows.json`: a JSON array of row objects with the original column names. int64 values are written as plain JSON numbers.

Raw downloads are in the session scratchpad `recon-media/` (not committed).

Contents:
- `arena-t2i` / `arena-image-edit` / `arena-t2v` / `arena-i2v`
- `vbench`
- `tts-arena`
- `music-arena`
- `genai-arena`
- `designarena-*`
- product family → model-name patterns table (at the end)

---

## Summary: what each source can and cannot do

| sourceId | Working URL (primary) | Format | History available? | Licence verdict | Main caveat |
|---|---|---|---|---|---|
| arena-t2i | HF `lmarena-ai/leaderboard-dataset` `text_to_image/full-00000-of-00001.parquet` | parquet | **Yes**: 117 snapshots, 2025-01-05 → 2026-10-07 | **CC BY 4.0, OK** | Filter `category=='overall'`. int64 values arrive as BigInt in Node. `organization` is unreliable |
| arena-image-edit | same, `image_edit/…` | parquet | Yes: 73 overall snapshots, 2025-06-24 → 2026-10-06 | CC BY 4.0, OK | 2 dates have only `multi_image_edit` rows |
| arena-t2v | same, `text_to_video/…` | parquet | Yes: 47 snapshots, 2025-08-07 → 2026-09-22 | CC BY 4.0, OK | Top Google entries are `gemini-omni-*`, not `veo-*` |
| arena-i2v | same, `image_to_video/…` | parquet | Yes: 49 snapshots, 2025-08-07 → 2026-09-22 | CC BY 4.0, OK | — |
| vbench | `https://vchitect-vbench-leaderboard.hf.space/config` | Gradio config JSON | Per-row `Date` (entry date). Not a time series | **No explicit data licence** (Space MIT, code Apache-2.0). Attribute and cite: low risk | Scores are `"85.06%"` strings, names are markdown links. No closed model newer than Veo 3 (2025-08). No Grok, no Seedance in the T2V table |
| tts-arena | `https://tts-agi-tts-arena-v2.hf.space/api/leaderboard` | JSON | **No**: current only. Wayback has 0 JSON captures and only old-app HTML (Jan–May 2026, a different Elo) | **No explicit data licence** (code Apache-2.0). Docs call the leaderboard "open". Attribute: low risk | **No OpenAI or Google TTS on the board.** Ranked by CI lower bound, not by `elo`. Vote counts reset at the June 2026 rewrite |
| music-arena | HF `music-arena/music-arena-dataset`, through datasets-server `/parquet` | **Battles** (parquet/JSON) | Yes: 8,117 votes, 2025-07-28 → 2026-07-31 (Aug and Sep 2026 not released yet) | **CC BY 4.0, OK** | **We must compute BT ourselves. No Suno, Udio or MiniMax Music.** Months are US-Eastern |
| genai-arena | HF Space `TIGER-Lab/GenAI-Arena` `arena_elo/results/{YYYYMMDD}/…_leaderboard.csv` | CSV | Yes: 2024-02-20 → **2025-03-24 (frozen)** | **MIT, OK** | Open models only (no DALL·E, Imagen, Midjourney, Sora, Kling …). Useful only for 2024 backfill of FLUX, SD and Playground |
| designarena-image/-video/-tts/-music | `https://www.designarena.ai/api/v1/leaderboard/models/{image,video,tts,music}` | JSON (needs key) | **No**: current only, and Wayback holds no data | **Free incl. commercial; credit "Design Arena" + visible link required.** Scraping the site is forbidden | No key yet. **Music board has no ranked data** (3 registered models: Stable Audio 2.5, Lyria-002, ElevenLabs Music v1; no Suno or Udio). No battle counts or CIs in the API |

### Implications for the spec (for the plan author)
1. **The image and video fronts are well covered.** Arena has history back to 2025-01 (image) and 2025-08 (video). Design Arena adds a second, current-only source. VBench is weak for 2025–26 commercial models.
2. **Speech front.** TTS Arena V2 has no history and lacks OpenAI and Google. Design Arena TTS has both, with Google #1, but is current-only. Before 2026-10 the speech front has **no measured history** except the Wayback HTML of the old TTS Arena (Jan–May 2026, a different scale). Monthly snapshots must start now. Earlier months are "reconstructed" or "estimated" (§6.1-6/7).
3. **Music front.**
   - Music Arena is the only measured source, and it holds votes: compute BT per month (or over a rolling window, since months have 256–1,364 votes).
   - It covers ElevenLabs Music, Lyria 3, Riffusion/Producer, Sonauto, Stable Audio, MusicGen, ACE-Step and Magenta RT.
   - **Suno and Udio are not on any measured source**, which confirms §6.1-7 ("estimated").
   - `designarena-music` should be marked *dormant* until it has data.
4. Spec §5.1 says the TTS Arena range is "2025〜 (Wayback 2025-08〜)". In reality there are no JSON captures. The 2025-08-10 capture is a 302 redirect, and the only HTML captures are from 2026-01-20 → 2026-06-08 (old app, old Elo).
5. Spec §5.1 lists GenAI-Arena as "2024-02〜2025-03 MIT". That is confirmed, and it is frozen. Its value is limited to open-model reconstruction of 2024.
6. Spec §5.1 marks the VBench and TTS Arena licences as **要確認** (to be confirmed). Result: neither has an explicit data licence; only the code is licensed. Decide whether "attribute + no explicit licence" is acceptable, or drop them. They are minor weight anyway.

### Disclosure: one ToS-relevant slip during this recon
While researching Design Arena's music board, a helper agent called designarena.ai's **internal** website endpoints directly with curl: about 1 × `GET /api/registry` and about 8 × `POST /api/leaderboard`, plus a few JS chunk downloads. robots.txt disallows `/api/`, and the ToS §8 forbids crawlers and data-mining.
- The calls were a one-off. Their output is only in the scratchpad (`recon-media/designarena/websearch/`).
- Facts derived from them are marked in the Design Arena section: the 3 registered music models and the empty music data.
- **The pipeline must not use those endpoints.** Use the keyed public API only.
- The scratch files can be deleted.

---

## arena-t2i / arena-image-edit / arena-t2v / arena-i2v (Arena leaderboard dataset)

All four come from one HF dataset with an identical schema, so they share one section.

### Working URLs (checked 2026-10-08, anonymous, no token)
- Dataset API (metadata, licence, file list): `https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset`
- Subset tree: `https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset/tree/main/<subset>`. Each subset has exactly two files:
  - `<subset>/full-00000-of-00001.parquet`: every published snapshot (history)
  - `<subset>/latest-00000-of-00001.parquet`: latest snapshot **per category** (see the surprises below)
- Download: `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/<subset>/full-00000-of-00001.parquet`. This returns a 302 redirect to the Xet/CDN host, so follow redirects (`curl -L`; Node `fetch` follows them by default).
- Pinning: `https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset/revision/main` returns `sha` (`ff77a170d5ec578fe4eb8c91e0084a6b1a20beac` on 2026-10-08). You can then use `/resolve/<sha>/...` for reproducible fetches.
- Commit cadence: `.../commits/main`. A bot commits `Update <subset> for <YYYY-MM-DD>` at about 03:02 UTC on the day after the publish date. Only subsets that changed get committed.

| sourceId | subset | full file size | full rows | latest rows | snapshots (distinct `leaderboard_publish_date`) | date range |
|---|---|---|---|---|---|---|
| arena-t2i | `text_to_image` | 954,800 B | 20,387 | 680 | 117 (all have `overall`) | 2025-01-05 → 2026-10-07 |
| arena-image-edit | `image_edit` | 127,527 B | 2,681 | 103 | 75 (73 have `overall`) | 2025-06-24 → 2026-10-06 |
| arena-t2v | `text_to_video` | 63,525 B | 1,311 | 48 | 47 | 2025-08-07 → 2026-09-22 |
| arena-i2v | `image_to_video` | 67,233 B | 1,436 | 48 | 49 | 2025-08-07 → 2026-09-22 |
| (not requested) | `video_edit` | 7,542 B | 63 | 10 | 9 | 2026-03-17 → 2026-08-27 |

`video_edit` is a new subset that is not in the spec. It holds 10 models: kling-o1/o3-pro, grok-imagine-video, runway-gen4-aleph, dreamina-seedance-2.x, happyhorse-1.0, gemini-omni-flash, minimax-h3 and wan3.0. It could feed the video front later.

### Format
- Parquet: one row group per about 1k rows, SNAPPY compression, written by `parquet-cpp-arrow 19.0.1`, format 2.6.
- **Node:** `hyparquet@1.31.3` reads the files without extra codecs: `parquetReadObjects({ file: await asyncBufferFromFile(path) })`. **int64 columns (`vote_count`, `rank`) come back as `BigInt`** (`1446n`), so convert them with `Number()`. Float and string columns come back as JS `number` and `string`.
- No nulls in any column of these 4 subsets. However, `organization` can be the empty string `''` (see the quirks below).

### Fields (identical for all 4 subsets; the README "Schema" table matches)
| column | parquet type | JS type (hyparquet) | meaning / notes |
|---|---|---|---|
| `model_name` | string | string | Model identifier as shown on arena.ai. May contain spaces, `(…)` and `[…]` suffixes |
| `organization` | string | string | Lower-case slug (`google`, `openai`, `bfl`, `bytedance`, `luma-ai`, `microsoft-ai`, …), but a few use other cases (`Stability AI`, `Pruna`, `Pixverse`), and some are `''` |
| `license` | string | string | **Model** licence (`Proprietary`, `Apache 2.0`, `flux-non-commercial-license`, …). This is not the data licence |
| `rating` | double | number | Arena score (Bradley–Terry, Elo-like scale) |
| `rating_lower` | double | number | Lower CI bound. Image subsets use asymmetric bootstrap CIs. Video subsets use exactly `rating ± 1.96·sqrt(variance)` |
| `rating_upper` | double | number | Upper CI bound |
| `variance` | double | number | Rating variance (not SD) |
| `vote_count` | int64 | **bigint** | Number of battles. **Not monotonic**: it drops between consecutive snapshots 250–700 times per subset because of re-filtering |
| `rank` | int64 | **bigint** | Rank within (date, category). It is a dense 1..N ordering by `rating`, with no ties and no CI-based shared ranks (verified for every snapshot) |
| `category` | string | string | `overall` plus sub-boards. **Filter on `category == 'overall'`** |
| `leaderboard_publish_date` | string | string | `YYYY-MM-DD`, the date the leaderboard was published. Snapshots are identified by this value |

Example row (`text_to_video`, verbatim, int64s shown as numbers):
```json
{"model_name": "veo-3-fast-audio", "organization": "google", "license": "Proprietary", "rating": 1415.484842722875, "rating_lower": 1395.734401632479, "rating_upper": 1435.2352838132713, "variance": 101.54473638083256, "vote_count": 1446, "rank": 1, "category": "overall", "leaderboard_publish_date": "2025-08-07"}
```

### Categories
- `text_to_image`:
  - `overall`: 117 dates.
  - `3d_modeling`, `art`, `cartoon`, `commercial_design`, `photorealistic`, `portraits`, `text_rendering`: 38 dates from 2026-01-29.
  - `english`: 7 dates from 2025-01-24 to 2025-02-11, then discontinued.
  - `chinese`, `russian`: 1 date (2025-01-24) each.
- `image_edit`: `overall` (73 dates), `multi_image_edit` (16 dates from 2026-01-23).
- `text_to_video` and `image_to_video`: `overall` only.

### Date semantics
- A snapshot is the full set of rows with the same `leaderboard_publish_date` and `category`. Snapshots are irregular, with 1–9 per month. No calendar month is missing in any of the 4 subsets between its first and last snapshot (`overall`). For the §6.1 rule ("closest to month end, missing if none within 3 months"), group by date and pick the max date ≤ month end. For the current, partial month (2026-10), that is the latest date available.
- In `image_edit`, the dates `2026-01-23` and `2026-03-02` have **only** `multi_image_edit` rows and no `overall` rows. Select snapshot dates **after** filtering to `overall`.
- Rows in `full` are **not** sorted by date for the image subsets: file order starts with 2026-01-29 (t2i) or 2026-01-23 (edit). The video subsets happen to be sorted. Always sort or group explicitly.
- The leaderboard grows over time (t2i `overall`: 7 models on 2025-01-05, 82 on 2026-10-07). Old models stay listed, so "reconstruction" (§6.1-6) has data to work with.
- Scale drift: the top score in t2i went from 1040 to 1425, and the minimum is about 898. Arena pins an anchor model to a fixed integer score for long stretches. Examples: t2i `dall-e-3` = exactly `978` from 2025-01-22 to 2026-01-09 (about 967.6 later); t2v `seedance-v1-pro`; i2v `veo-3-fast`; image_edit `reve-v1.1`. Because §6.1 uses within-snapshot Δ to the leader, the anchor does not matter, but never compare raw ratings across dates.
- README methodology notes: Elo was replaced by BT on 2024-01-09; style control became the default on 2025-05-16 (text/vision only); frequency re-weighting started on 2025-07-23 (applies to all arenas). The t2i/edit history spans the 2025-07-23 change. Treat it as a possible break only if a visible jump appears. Changelog: https://arena.ai/blog/leaderboard-changelog/

### Naming quirks
- Suffixes inside the name:
  - Parenthetical nickname or variant: `gemini-2.5-flash-image-preview (nano-banana)`, `gpt-image-2 (medium)`, `grok-imagine-image-2.0 (canvas)`, `grok-imagine-image-2.0 (low)`
  - Dated build: `grok-imagine-image (20260207)`, `chatgpt-image-latest-high-fidelity (20251216)`
  - Feature tag: `gemini-3.1-flash-image (nano-banana-2) [web-search]`

  Match with prefix or regex, not exact strings.
- Renames across time (the same model gets a new name):
  - `gemini-3-pro-image-preview-2k (nano-banana-pro)` (last seen 2026-07-07) → `gemini-3-pro-image-2k (nano-banana-pro)` (from 2026-07-09)
  - `gemini-3.1-flash-image-preview (nano-banana-2) [web-search]` → `gemini-3.1-flash-image (nano-banana-2) [web-search]`
  - `grok-imagine-video-1.5-preview-720p` → `grok-imagine-video-1.5-720p`
- **`organization` is unreliable for mapping**:
  - `Stability AI`→`''` (stable-diffusion-v35-large from 2026-04-10)
  - `Pruna`→`''` (p-image, p-video, p-image-edit)
  - `lightricks`→`''` (ltx-2-19b)
  - `Pixverse`→`''` (pixverse-v5.6)
  - `alibaba`→`wan` for `wan2.7-t2v`/`wan2.7-i2v` (rows from 2026-07-07 / 2026-06-23 have org `wan`)

  **Map product families by `model_name` pattern.**
- The same model name appears in several subsets (`flux-2-pro` in t2i and edit, `wan3.0` in t2v, i2v and video_edit), so always key by `(subset, model_name)`.
- Cross-modal names: `runway-gen4` appears in **text_to_image** (Runway image model). `flux-3-video` and `flux-3-video-20260811` (BFL) appear in the video subsets. `kling-image-o1` appears in image_edit. `uni-1.1`/`uni-1.1-max` (luma-ai) and `photon` (luma-ai) are Luma image models.
- Google video includes the non-Veo-branded `gemini-omni-flash` and `gemini-omni-1.1-flash`, which are the **top Google video entries since 2026-06**. The units config must decide whether they count toward the Veo/Google video unit.
- The `bytedance` organization covers `seedream-*` and `seededit-3.0` (image), `seedance-*` and `dreamina-seedance-*` (video), and `bagel` (an open research model, probably not the Seedream unit).

### Distinct organizations (all rows, all categories)
- **t2i**: bfl, google, alibaba, bytedance, openai, recraft, ideogram, luma-ai, microsoft-ai, xai, reve, `''`, krea, leonardo-ai, tencent, zai, nvidia, runway, Stability AI, hidream, Pruna, meta.
- **edit**: bfl, bytedance, google, alibaba, openai, reve, xai, stepfun, luma-ai, `''`, kling, tencent, microsoft-ai, meta, Pruna, ideogram.
- **t2v**: google, bytedance, minimax, kling, openai, alibaba, luma-ai, kandinsky, pika, genmo, `''`, tencent, xai, runway, aorizon, lightricks, meta, wan, bfl, Pruna, Pixverse.
- **i2v**: google, minimax, kling, bytedance, alibaba, shengshu, luma-ai, xai, pika, runway, `''`, tencent, aorizon, wan, lightricks, bfl, Pruna, hidream, Pixverse.

### Model names of interest (`overall`, first..last snapshot)
- **OpenAI image**:
  - t2i: `dall-e-3` (2025-01-05..), `gpt-image-1` (2025-06-03..), `gpt-image-1-mini` (2025-10-16..), `gpt-image-1.5-high-fidelity` (2025-12-16..), `gpt-image-2 (medium)` (2026-04-21..; peak 1512, t2i month-end leader in mid-2026), `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst` (2026-09-08..)
  - edit: the same plus `chatgpt-image-latest-high-fidelity (20251216)` (no dall-e-3 in edit)
- **Google image**:
  - `imagen-3.0-generate-002` (2025-01-22..), `imagen-4.0-generate-001`, `imagen-ultra-4.0-generate-001`
  - `gemini-2.0-flash-preview-image-generation`
  - `gemini-2.5-flash-image-preview (nano-banana)` (2025-08-14..)
  - `gemini-3-pro-image-preview (nano-banana-pro)` (2025-11-21..), `gemini-3-pro-image-preview-2k (nano-banana-pro)`, `gemini-3-pro-image-2k (nano-banana-pro)`
  - `gemini-3.1-flash-image-preview (nano-banana-2) [web-search]`, `gemini-3.1-flash-image (nano-banana-2) [web-search]`
  - `gemini-3.1-flash-lite-image (nano-banana-2-lite)`
  - `gemini-nano-banana-2.1` (2026-10-06..)
- **FLUX (bfl)**:
  - `flux-1-dev-fp8`, `flux-1.1-pro` (2025-01-05..)
  - `flux-1-kontext-{pro,max,dev}` (2025-07..)
  - `flux-2-{pro,flex,dev,max}` (2025-12..)
  - `flux-2-klein-{4b,9b}`
  - video: `flux-3-video` (t2v), `flux-3-video-20260811` (i2v)
- **ByteDance**:
  - image: `seedream-3`, `seedream-4-fal`, `seedream-4-2k`, `seedream-4-high-res-fal`, `seedream-4.5`, `seedream-5.0-lite`, `seedream-5.0-pro`, `seededit-3.0` (edit), `bagel`
  - video: `seedance-v1-lite`, `seedance-v1-pro`, `seedance-v1.5-pro`, `dreamina-seedance-2.0-720p`, `dreamina-seedance-2.5-720p`
- **Ideogram**: `ideogram-v2`, `ideogram-v3-quality`, `ideogram-4.0-quality` (t2i); `ideogram-4.5` (edit only, 2026-09-30..)
- **Recraft**: `recraft-v3`, `recraft-v4`, `recraft-v4.1-pro`, `recraft-v4.1-utility-pro`, `recraft-v4.1-flash` (t2i only)
- **Midjourney**: **absent** from all subsets, including history (no `midjourney`/`mj-` strings).
- **Veo**: `veo-2`, `veo-3`, `veo-3-fast`, `veo-3-audio`, `veo-3-fast-audio`, `veo-3.1-audio`, `veo-3.1-fast-audio`, `veo-3.1-audio-1080p`, `veo-3.1-fast-audio-1080p`. Related Google entries: `gemini-omni-flash`, `gemini-omni-1.1-flash`.
- **Sora**: `sora` (from 2025-08-14), `sora-2`, `sora-2-pro` (from 2025-10-16). They appear in t2v only, not in i2v.
- **Kling**:
  - t2v: `kling-v2.1-master`, `kling-2.5-turbo-1080p`, `kling-2.6-pro`, `kling-o1-pro`
  - i2v: adds `kling-v2.1-standard`, `kling-v3-pro`
  - edit: `kling-image-o1`
  - video_edit: `kling-o3-pro`
- **Runway**: `runway-gen-4.5` (t2v, 2026-02-26..), `runway-gen4-turbo` (i2v, 2025-08-14..), `runway-gen4` (t2i!), `runway-gen4-aleph` (video_edit)
- **Hailuo/MiniMax**: `hailuo-02-standard`, `hailuo-02-pro`, `hailuo-02-fast` (i2v), `hailuo-2.3`, `minimax-h3` (2026-08-03..)
- **Luma**: video `ray2`, `ray-3`; image `photon`, `uni-1.1`, `uni-1.1-max`
- **Wan (Alibaba)**:
  - video: `wan-v2.2-a14b`, `wan2.5-t2v-preview`, `wan2.5-i2v-preview`, `wan2.6-t2v`, `wan2.6-i2v`, `wan2.7-t2v`, `wan2.7-i2v`, `wan3.0`
  - image: `wan2.5-t2i-preview`, `wan2.6-t2i`, `wan2.7-image`, `wan2.7-image-pro`, `wan2.5-i2i-preview`, `wan2.6-image`
  - (Alibaba also has `qwen-image*`, `z-image-turbo`, a different family)
- **Grok Imagine (xAI)**:
  - image: `grok-imagine-image`, `grok-imagine-image-pro`, `grok-imagine-image-quality`, `grok-imagine-image-2.0 (low|canvas|20260801)`, plus dated `(20260207)`/`(20260519)` variants in edit
  - video: `grok-imagine-video-720p`, `grok-imagine-video-480p`, `grok-imagine-video-1.5-preview-720p`, `grok-imagine-video-1.5-720p`, `grok-imagine-video-1.5-agent`, `grok-imagine-video` (video_edit)
- **Others worth a unit**:
  - Microsoft `mai-image-1/2/2.5/2.6` (`mai-image-2.6` is top-5 in t2i and edit)
  - Reve `reve-*`
  - Meta `muse-image`, `muse-video`
  - Tencent `hunyuan-*`
  - `happyhorse-1.0` (org `aorizon`, top-5 video)
  - Shengshu `vidu-q2-pro`, `vidu-q2-turbo`, `vidu-q3-pro` (i2v)
  - Pika `pika-v2.2`

### Auth / rate limits
- Public, not gated (`gated: false`), and no token is needed. The HF Hub applies per-IP rate limits to anonymous `/api` and `/resolve` calls. The pipeline makes a handful of calls per week, so this is a non-issue. Set `HF_TOKEN` (header `Authorization: Bearer …`) if limits ever appear.

### Licence verdict
- The dataset card has `license: cc-by-4.0` (`cardData.license`). **OK to use with attribution.** Credit "Arena (arena.ai) leaderboard dataset, CC BY 4.0" and link https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset.
- The `license` column describes model licences only.
- As the spec says, do not scrape arena.ai itself.

### Surprises
1. **`latest` is "latest per category", not a single date.** t2i `latest` contains dates `2026-10-07`, `2025-01-24` and `2025-02-11`, because the stale `english`/`chinese`/`russian` boards are kept. Prefer `full` and select dates yourself.
2. Image subsets update almost daily; video subsets less often (the last t2v/i2v snapshot is 2026-09-22).
3. Int64 values arrive as BigInt in Node (hyparquet).
4. `vote_count` decreases over time for many models, so do not use it as a monotonic counter.
5. **Leaders, latest snapshot:**
   - t2i (2026-10-07): `gpt-image-2.5-sunburst` 1425 > `gpt-image-2.5-flare` 1398 > `gpt-image-2 (medium)` 1383 > `grok-imagine-image-2.0 (canvas)` 1334 > `mai-image-2.6` 1332 > `gemini-nano-banana-2.1` 1328.
   - t2v (2026-09-22): `gemini-omni-1.1-flash` 1516 > `gemini-omni-flash` 1513 > `flux-3-video` 1493.
   - i2v (2026-09-22): `minimax-h3` 1495 > `gemini-omni-1.1-flash` 1488 > `wan3.0` 1480.
   - The t2i month-end leader changed: imagen-3 (2025-01..05) → gpt-image-1 → nano-banana → nano-banana-pro → gpt-image-1.5 → nano-banana-2 → gpt-image-2 → gpt-image-2.5. That gives plenty of `lead_change` events.
   - Individual scores move a lot between snapshots: `gpt-image-2 (medium)` peaked at 1512 and is now 1383, because the scale re-centres as models are added.

### Fixtures
`pipeline/test/fixtures/arena-*/sample.rows.json`: parquet converted to a JSON array of row objects with the original column names. File order is preserved. int64 values are written as JSON numbers (not BigInt).
- **arena-t2i** (227 rows, 73 KB):
  - `overall` for 2025-01-05, 2025-06-24, 2025-09-30, 2025-10-01 (a month-boundary pair), 2026-01-29 and 2026-10-07 (82 rows)
  - a few non-overall rows (`english`/`chinese` 2025-01-24; `photorealistic`/`text_rendering` 2026-10-07, top 8) to test category filtering
- **arena-image-edit** (128 rows, 42 KB):
  - `overall` for 2025-06-24, 2025-10-01, 2026-01-26 and 2026-10-06
  - `multi_image_edit` for 2026-01-23 (a date with **no** overall rows) and 2026-10-06 (top 10)
- **arena-t2v** (149 rows, 47 KB): `overall` for 2025-08-07, 2025-10-16, 2026-01-29, 2026-04-07 (includes `organization: ''` rows) and 2026-09-22.
- **arena-i2v** (160 rows, 51 KB): `overall` for 2025-08-07, 2025-11-05, 2026-02-27, 2026-07-29 and 2026-09-22.

---

## vbench

Recon date: 2026-10-08. Everything below was observed live unless marked *(unverified)*.

### Working URL(s)
- **Primary: `GET https://vchitect-vbench-leaderboard.hf.space/config`**. Returns HTTP 200, `application/json`, 224,447 bytes, one line. Gradio `version` is `"4.36.1"`, `mode` is `"blocks"`, `space_id` is `"Vchitect/VBench_Leaderboard"`, `protocol` is `"sse_v3"`. The canonical Space is `Vchitect/VBench_Leaderboard`, confirmed via `https://huggingface.co/api/spaces?search=vbench` and the `link: <https://huggingface.co/spaces/Vchitect/VBench_Leaderboard>;rel="canonical"` response header. Other Spaces exist: `Vchitect/VBench_Leaderboard_backup` (code only), `Vchitect/VBench`, and `*_Video_Arena`.
- **Fresher alternative (Gradio REST, no auth):**
  - `POST https://vchitect-vbench-leaderboard.hf.space/call/get_baseline_df` with body `{"data":[]}` returns `{"event_id":"…"}`.
  - Then `GET …/call/get_baseline_df/<event_id>` returns SSE text: `event: complete\ndata: [ {headers,data,metadata} ]`.
  - The payload is the same table as `/config`. Today the default output was byte-for-byte equal to the `/config` data (73 rows).
  - `get_baseline_df` is the page-load (`load`) dependency. It runs `snapshot_download` of the private dataset on every call. `/config` holds the value computed at app build or startup. *(Unverified whether `/config` can lag the dataset. It matched today.)*
- **Unfiltered "all submissions" table:** `POST /call/on_filter_model_size_method_change_5` with `{"data":[<16 dimension names>, false, false, false]}`. The arguments are `selected_columns`, `vbench_team_sample`, `vbench_team_eval`, `show_platinum_only`. It returns 105 rows instead of 73.
  - The output shape is a Gradio update: `[{"headers":[…],"type":"pandas","datatype":[…],"interactive":false,"visible":true,"value":{"headers","data","metadata"},"__type__":"update"}]`.
  - **It contains bare `NaN` literals (24 occurrences) and `JSON.parse` fails on it.** These sit in the `Accessibility` and `Evaluated by` columns.
  - Endpoint list: `GET https://vchitect-vbench-leaderboard.hf.space/info`.
- **No CSV/JSON data file is reachable without auth.**
  - The Space repo tree (`https://huggingface.co/api/spaces/Vchitect/VBench_Leaderboard/tree/main`) has only `.gitattributes`, `README.md`, `app.py`, `constants.py` and `requirements.txt`.
  - `constants.py` shows the data lives in the HF dataset `Vchitect/vbench_leaderboard_submission`. Its files are `results.csv` (T2V), `results2_0.csv`, `i2v_results.csv`, `long_debug.csv`, `quality.csv`, `trust_worthiness_results.csv` and `model_info.csv`.
  - `https://huggingface.co/api/datasets/Vchitect/vbench_leaderboard_submission` returns **401** (private), so there is no `sample.csv`.
  - The GitHub repo `Vchitect/VBench` (4,079-entry tree) has no leaderboard CSV/JSON.

### Format & size
- `/config` top-level keys: `version, mode, app_id, dev_mode, analytics_enabled, components, css, connect_heartbeat, js, head, title, space_id, enable_queue, show_error, show_api, is_colab, max_file_size, stylesheets, theme, protocol, body_css, fill_height, theme_hash, layout, dependencies, root`.
- `components` has 257 entries. Of these, 6 have `type == "dataframe"`. Each one's table is at `components[i].props.value` = `{ "headers": string[], "data": string[][], "metadata": null }`.
- `props.datatype` holds Gradio display types (`"markdown"`/`"number"`). These do **not** match the actual values, which are all strings. `props.headers` duplicates `value.headers`.

| comp id (array idx) | Parent tabitem label (`layout`) | Headers (abridged) | Rows | Date range |
|---|---|---|---|---|
| **20 (19)** | `📊 VBench 1.0`, **main T2V** | Model Name (clickable), Certification, Sampled by, Evaluated by, Accessibility, Date, Total Score, Quality Score, Semantic Score, Selected Score + 16 dims (26 cols) | **73** | 2023-11-23 → 2026-08-07 |
| 41 (40) | `⭐ VBench 2.0` | Model (alphabetical order), Certification, Sampled by, Evaluated by, Accessibility, Date, Total Score, Creativity/Commonsense/Controllability/Human Fidelity/Physics Score + 18 dims (30 cols) | 12 | 2025-03-28 → 2026-04-01 |
| 55 (54) | `Video Quality` | Model Name (clickable), Quality Score, Selected Score + 6 dims (9 cols; `datatype` has 26 entries, a mismatch). No Date. | 10 | n/a |
| 69 (68) | `VBench-I2V` | Model Name (clickable), Certification, Sampled by, Evaluated by, Accessibility, Date, Total Score, I2V Score, Quality Score, Selected Score + 9 dims (19 cols) | 35 | 2024-07-22 → 2026-05-20 |
| 90 (89) | `📊 VBench-Long` | **Identical header list to id 20** (26 cols) | 48 | (46/48 rows have score cells identical to T2V) |
| 105 (104) | `VBench Trust-Worthiness` | Model Name, Certification, Sampled by, Evaluated by, Accessibility, Date, Culture Fairness, Skin Bias, Gender Bias, Safety | 6 | Date format `7/24/24` (M/D/YY) |

- **How to select the main T2V table robustly.** Do not rely on the array index or the numeric id. Walk `layout` (a tree of `{id, children}`) to the `tabitem` whose `props.label` contains `VBench 1.0`, then take its `dataframe` descendant. Today that is id 20. Matching on headers alone is ambiguous, because VBench-Long (id 90) has exactly the same headers. A fallback is the first dataframe in `components` whose `headers` include `"Semantic Score"`.
- **Default filter.** The T2V table in `/config` and `get_baseline_df` is **pre-filtered to `Evaluated by == 'VBench Team'`**. The code is `df = df[df['Evaluated by'] == 'VBench Team']`. Checkbox id 16 (`Evaluated by VBench Team…`) defaults to `true`, and checkbox id 15 (`Sampled by VBench Team…`) defaults to `false`.
- Exact JSON path for the main table:
  - `components[19].props.value.headers`
  - `components[19].props.value.data` (today; `id == 20`)

### Fields (main T2V, comp id 20)
| Column | Type in JSON | Format / notes |
|---|---|---|
| `Model Name (clickable)` | string | Markdown link `[Name](url)` in all 73 default rows. Strip it with `^\s*\[([^\]]*)\](\([^)]*\))?\s*$` and take group 1. In other tables, names can be bare (I2V `ToMoviee-2.0`, `DynamiCrafter-1024`, …), have no URL (`[modiv1.2]` in unfiltered T2V), or contain `×`, full-width parentheses `（…，…）`, or Chinese text. |
| `Certification` | string | `"🥇 Gold"`, or `"🥈 Silver "` **with a trailing space**. It is `""` in unfiltered and VBench-2.0 rows. It is derived: Gold means Sampled **and** Evaluated by VBench Team; Silver means one of the two. |
| `Sampled by` | string | Plain text (`"VBench Team"`) or a markdown link `[Team](drive-url)` |
| `Evaluated by` | string | `"VBench Team"` in all default rows. In unfiltered rows it can be another team or `NaN` |
| `Accessibility` | string | Markdown link, often with a **leading space**: `" [API](url)"`, `"[Open Source](url)"`, `"[Close Source](url)"`, and even an empty label `"[](url)"`. Unfiltered rows contain `NaN`, a date (`"2025-02-07"`, `"2025.11"`) or `"2024"`. In I2V (id 69), Accessibility is plain text (`"Open Source"`, `" Close Source"`, `"API"`) or JSON `null` (DreamX row). |
| `Date` | string | `YYYY-MM-DD` in all 73 default rows. Other tables have a **leading space** (`" 2025-09-18"`), and Trust uses `M/D/YY`. |
| `Total Score`, `Quality Score`, `Semantic Score`, `Selected Score` | string | **Percent strings** `"85.06%"` (format `f"{x*100:05.2f}%"`). Total, Quality and Semantic are app-computed from the 16 raw dims, normalised by min/max (`NORMALIZE_DIC`) and weighted (quality ×4, semantic ×1). `Selected Score == Total Score` under the default dimension selection (true for all 73 rows). Unfiltered rows include `"-57.17%"` (negative) and `"32.43%"`. In I2V, missing values are the string `"nan"`. |
| 16 dims (`subject consistency` … `overall consistency`) | string | Raw dimension score ×100 as `"97.36%"` |

Verbatim example row (`data[8]`, Veo 3):
```json
["[Veo 3](https://cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-0-generate-001?hl=zh-cn)", "🥇 Gold", "[VBench Team](https://drive.google.com/drive/folders/16EWQAHzQtozM9tezyBGQrzMsWZCS-LkM)", "VBench Team", "[API](https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos#text-video-gen)", "2025-08-06", "85.06%", "85.70%", "82.49%", "85.06%", "97.36%", "96.89%", "99.30%", "99.16%", "72.43%", "63.81%", "68.23%", "93.89%", "82.20%", "99.40%", "82.48%", "84.26%", "57.43%", "23.55%", "25.97%", "27.88%"]
```

### Date semantics
- `Date` is the leaderboard entry or update date, not the model release date.
  - For user submissions, `add_new_eval()` in `app.py` writes `datetime.datetime.now().strftime("%Y-%m-%d")`. The submitted "release time" field is not stored in `Date`.
  - For VBench-Team rows the date is set by hand and looks like the evaluation date. For example, `Veo 3` is dated 2025-08-06 and `Gen-2 (2023-12)` is dated 2024-01-19.
- Model names often embed a version or snapshot date: `Vidu Q1 (2025-04-17)`, `Gen-3 (2024-07)`, `Kling (2024-07 high-performance mode)`, `Pika Beta (2023-12)`, `Hunyuan Video (2025-05-22)`.
- This is **not a time series.** Each row is one static evaluation of one model version. The same family appears as several rows over time, for example Wan2.1 at 2025-01-08, 2025-02-24, 2025-03-13, 2025-05-03 and 2025-07-25. Monthly strength therefore means "best row with `Date <= month end`".
- Default T2V rows per month vary, with gaps (none in 2025-09 → 2026-01, 2026-03 → 2026-07): `2023-11:4, 2024-01:4, 2024-02:1, 2024-04:2, 2024-06:5, 2024-07:6, 2024-08:3, 2024-09:4, 2024-10:2, 2024-11:5, 2024-12:4, 2025-01:7, 2025-02:2, 2025-03:7, 2025-04:3, 2025-05:3, 2025-06:1, 2025-07:2, 2025-08:4, 2026-02:3, 2026-08:1`.

### Naming quirks
- **"Sora" collides with Open-Sora.** The T2V default table contains `Open-Sora-2.0 (2025-03-18)`, `Open-Sora-2.0`, `OpenSora V1.2 (8s)`, `OpenSora V1.1`, `Open-Sora`, and `OpenSoraPlan V1.1/V1.2/V1.3`. These are hpcaitech and PKU projects, not OpenAI. Match OpenAI Sora with `^Sora\b`.
- The same model appears under different spellings across tabs: `Wan2.1 (2025-02-24)` (T2V) vs `Wan2.1(2025-02-24)` (Long), and `Hunyuan Video (2025-05-22)` vs `HunyuanVideo (Open-Source Version)` vs `HunyuanVideo`.
- Variant suffixes: `(Qwen prompt-optimized)`, `(w/o prompt-optimized)`, `(Diffusers)`, `(SAT prompt-optimized)`, `(5s 768×512)`, `(8s)`.
- The unfiltered table has exact duplicate rows (`Open-Sora Plan v1.5.0` ×2) and junk entries (`pkq` at -57.17%, `vgen` with URL `www.vgen.com`).

### Auth / rate limits
- No auth is needed for `/config`, `/info` or `/call/*`. No rate-limit or `Retry-After` headers were seen. Response headers: `server: uvicorn`, `x-proxied-*`, `x-request-id`; there is no Cache-Control.
- Timing: the first `/config` took 14.1 s (probably warm-up). Repeats took about 1.35 s total and 0.6 s TTFB. `/call/get_baseline_df` took about 0.8 s.
- Space runtime: `cpu-basic`, `gcTimeout: 172800`. The Space **sleeps after 48 h idle**, so expect cold starts with slow or 503 responses and add retry and backoff. Space `lastModified` is 2026-04-01, but the data holds a 2026-08-07 row because data comes from the dataset at runtime.

### Licence verdict
- Space card (`https://huggingface.co/spaces/Vchitect/VBench_Leaderboard/blob/main/README.md`) front-matter has `license: mit`. This covers the Space repo, which contains only code.
- GitHub `https://github.com/Vchitect/VBench/blob/master/LICENSE` is **Apache-2.0** (GitHub API `license.spdx_id = Apache-2.0`). This covers the code.
- The data repo `Vchitect/vbench_leaderboard_submission` is private (401), and no data licence was found anywhere. The README asks readers to "See numeric values at our Leaderboard" and the Space shows a citation BibTeX (`huang2023vbench`, plus VBench++ and VBench-2.0 papers).
- **Verdict:** there is no explicit licence for the leaderboard numbers. They are published publicly as benchmark results. Reusing aggregate scores with attribution (a link to the Space and a citation of the VBench papers) is reasonable and low-risk. Do not redistribute the raw dataset. Note "no explicit data licence; Space MIT / code Apache-2.0" in the credits.

### Surprises
1. The default table is filtered (73 of 105 rows). The unfiltered endpoint emits invalid JSON (`NaN`).
2. Every score is a `"xx.xx%"` string even though `datatype` says `number`.
3. VBench-Long's headers are identical to T2V, and 46 of its 48 rows have scores identical to T2V.
4. Total, Quality and Semantic scores are recomputed by the app, not stored.
5. Seedance appears **only** in VBench-2.0, which has a different score scale (Total ~53–67%). Runway Gen-4 appears only in I2V.
6. The newest T2V row is `HiDream-O1-Video` dated 2026-08-07. Nothing newer than 2025-08 exists for closed commercial models (Veo 3 is the latest).

### Product family → exact model-name strings (after stripping markdown)
- **Veo:** `Veo 3` (T2V, 2025-08-06, Gold). Also `Veo 3` in VBench-2.0 (2025-09-04) and Long.
- **Sora (OpenAI):** `Sora` (T2V, 2025-01-14). `Sora-480p` (VBench-2.0). `Sora` (Video Quality tab, no date).
- **Kling:** `Kling 1.6` (2025-05-08), `Kling (2024-07 high-performance mode)` (2024-08-01). `Kling 1.6` in VBench-2.0.
- **Runway:** `Gen-3 (2024-07)` (2024-07-25), `Gen-2 (2023-12)` (2024-01-19). I2V only: `Gen-4-I2V` (2025-05-20). `Gen-2` in Quality.
- **Hailuo/MiniMax:** `MiniMax-Video-01` (2024-10-01). No "Hailuo" string anywhere.
- **Luma/Ray:** `Luma` (2025-01-14; link `lumalabs.ai/dream-machine`). No "Ray" string.
- **Wan:**
  - T2V: `Wan2.1 (2025-02-24)`, `Wan2.1`, `Wan2.1-T2V-1.3B`, `Wan2.1-T2V-1.3B (2025-05-03)`, `Wan2.1-T2V-14B`, `Wan2.2-T2V-A14B (Qwen prompt-optimized)`, `Wan2.2-T2V-A14B (w/o prompt-optimized)`.
  - VBench-2.0: `Wan2.1`.
  - I2V: `Wan2.2-TI2V-5B (Qwen prompt-optimized)`, `Wan2.2-I2V-A14B (Qwen prompt-optimized)`, `Wan2.2-I2V-A14B (w/o prompt-optimized)`, `Wan2.1-I2V-14B-720P`.
- **Seedance (ByteDance):** VBench-2.0 only: `Seedance 1.0 Pro (2025-05-28)` (Sampled and Evaluated by "Joyme Team", no certification, dated 2025-06-26). Related ByteDance entries: `Jimeng` (T2V, 2024-11-15; *mapping Jimeng→Seedance is unverified*), plus unfiltered-only `ContentV` and `Avalon`.
- **Grok Imagine:** none.
- **Pika:** `Pika-1.0 (2024-06)`, `Pika Beta (2023-12)`. `Pika` in Quality.
- **CogVideoX:**
  - T2V: `CogVideoX1.5-5B (5s SAT prompt-optimized)`, `CogVideoX1.5-5B`, `CogVideoX-5B (Diffusers)`, `CogVideoX-5B (SAT prompt-optimized)`, `CogVideoX-2B (Diffusers)`, `CogVideoX-2B (SAT prompt-optimized)`, `CogVideo`.
  - VBench-2.0: `CogVideoX-1.5`.
  - I2V: `CogVideoX-5b-I2V`, `CogVideoX1.5-5B-I2V`, `CogVideoSFT`.
- **HunyuanVideo:** `Hunyuan Video (2025-05-22)`, `HunyuanVideo (Open-Source Version)`. `HunyuanVideo` in VBench-2.0 and `HunyuanVideo-I2V` in I2V. (`Hunyuan-DiT + ExVideo-SVD` in the unfiltered table is not HunyuanVideo.)
- **Others (T2V default):** `Vidu Q1 (2025-04-17)`, `Vidu`, `Step-Video-T2V`, `MAGI-T2V-24B-distill`, `MAGI-T2V-4.5B-distill`, `LTX-Video (5s 768×512)`, `LTX-2 (Diffusers) (w/o prompt-optimized)`, `Mochi-1`, `HiDream-O1-Video`, `IPOW`, `IPOC`, `JT3.5`, `MiracleVision V5`, `LanDiff`, `CausVid`, `STIV (Apple)`, `EasyAnimateV5.1`, `AccVideo`, `RepVideo`, `Vchitect-2.0…`, `VideoCrafter-*`, `AnimateDiff-*`, `LaVie*`, `Latte-1`, `Show-1`, `ModelScope`, `Mira`, and others.
- **ElevenLabs / OpenAI TTS / Google TTS / MiniMax speech / Cartesia / Hume:** not applicable (video source).

### Fixture
`C:\Users\dahli\Documents\GitHub\EVAL\pipeline\test\fixtures\vbench\sample.json` is 59,326 bytes, valid JSON (checked with `node require`), pretty-printed with indent=1 and UTF-8 emoji kept literal (the original is also literal UTF-8).
- **Kept:** all 25 top-level keys in the original order, and their values unchanged except `components`, `layout` and `dependencies`.
- `components` is reduced to 10 entries, each with full original props, `api_info` and `example_inputs`:
  - `tabs` id 2
  - `tabitem` ids 3 (`📊 VBench 1.0`), 21 (`⭐ VBench 2.0`) and 56 (`VBench-I2V`)
  - filter `checkbox` ids 15, 16 and 17
  - `dataframe` ids 20, 41 and 69
- **Rows:**
  - id 20 has 40 of 73 rows, original order kept. Original indices: 0,1,2,5,8,10,11,12,14,15,17,18,19,21,22,24,26,27,28,29,30,31,32,34,35,36,37,38,42,44,45,46,47,49,50,54,63,67,70,72. This covers every family row (Veo, Sora, Kling×2, Gen-3/Gen-2, MiniMax, Luma, Wan×7, Hunyuan×2, CogVideoX×5 plus CogVideo, Pika×2, Vidu×2, Jimeng), dates 2023-11-23 → 2026-08-07, the empty-label Accessibility `[](…)`, and `×` in a name.
  - id 41 has all 12 rows.
  - id 69 has 12 of 35 rows, including bare-name rows, leading-space dates, `"nan"` score strings and a `null` Accessibility.
- `layout` is pruned to `{"id":0,"children":[{"id":2,"children":[{"id":3,"children":[15,16,17,20]},{"id":21,"children":[41]},{"id":56,"children":[69]}]}]}` (as objects).
- `dependencies` is reduced to 4 entries: `get_baseline_df`, `get_baseline_df_2`, `get_baseline_df_i2v` and `on_filter_model_size_method_change_5`.
- **Dropped:** 247 other components (markdown text, submit forms, Long/Quality/Trust tabs, About), the other 45 dependencies, and their layout nodes.
- The raw full files are in the scratchpad `recon-media/vbench/`:
  - `config.json`
  - `baseline_sse.txt`
  - `all_sse.txt`, the unfiltered output with `NaN`
  - `all_t2v.json`
  - `space_app.py` and `space_constants.py`


---

## tts-arena

### Working URL(s)
- **`GET https://tts-agi-tts-arena-v2.hf.space/api/leaderboard`** returns HTTP 200, `application/json;charset=utf-8`, 12,054 bytes, 39 rows.
- The same app is also reachable at the domain `tts-agi-tts-arena.hf.space` (from Space runtime domains). *(That domain's API route itself was not tested.)*
- The Space `TTS-AGI/TTS-Arena-V2` is a Docker SDK app built with Next.js. Its source mirror is `https://github.com/TTS-AGI/TTS-Arena`. The route is defined in `apps/web/src/app/api/leaderboard/route.ts`, and assembly happens in `apps/web/src/server/arena/leaderboard.ts`.
- **Query params (from the source, then verified):**
  - `type`: `tts` (default) or `conversational`. Any other value returns **400** `{"error":"invalid type"}`. `?type=conversational` currently returns `{"rows":[]}` (11 bytes).
  - `preliminary=1` lowers the vote floor from ≥100 counted votes to >0. It returned 46 rows, adding `gradium-tts-202608`, `tontaube-v1`, `cosyvoice-2.0`, `tontaube-v1-r2`, `fluxions-vui`, `mars` and `uni-tts-preview`, each with 4–65 votes. Ranks are renumbered because the floor changes which models are ranked.
  - `include_proprietary=true` **does not exist** and is ignored (identical output). There is no open/proprietary filter server-side. Filter client-side on `open`.

### Format & size
- The top level is `{ "rows": LeaderboardRow[] }` and nothing else. No metadata or timestamp is included.
- Row order: ranked rows first, sorted by **Bradley–Terry CI lower bound** (not by `elo`, so `elo` is not monotonic in rank). Ties break on elo, then totalVotes, then id. Suspended rows follow with `rank: 0`, sorted by `suspendedAt` descending.
- Delisted models (`hiddenAt` set in the DB) are omitted entirely.

| Field | JSON type | Notes |
|---|---|---|
| `rank` | int | 1-based; `0` means suspended |
| `tier` | `"S"`\|`"A"`\|`"B"`\|null | S = ranks 1–2, A = 3–4, B = 5–7, else null |
| `id` | string | Stable slug, sometimes a codename (`async-1`, `luck-dolphin`, `lanternfish-2`, `parmesan`) |
| `name` | string | Display name; can change over time |
| `url` | string | `""` for stealth models (`luck-dolphin`, `star-june-2026`, `parmesan`) |
| `icon` | string\|null | `/logos/*.webp`; null for `star-june-2026` |
| `elo` | int | Displayed BT rating, centred on about 1500 (Glicko fallback) |
| `uncertainty` | int | ± half the BT CI width |
| `winRate` | number (0–100) | A float, or an int when exact (`inworld-max-1.5` has `50`) |
| `totalVotes` | int | Counted BT games |
| `open` | bool | Open-weights flag |
| `preliminary` | bool | `totalVotes < 300` |
| `active` | bool | false means retired (no longer battled; rating kept) |
| `suspended` | bool | |
| `suspendedAt` | int\|null | Unix **seconds** (`1783097341` = 2026-07-03T16:49:01Z) |
| `suspendedReason` | string\|null | e.g. `"vote manipulation"` |

The zod schema is `leaderboardRowSchema` in `packages/shared/src/api.ts`.

Verbatim example rows:
```json
{"rank": 7, "tier": "B", "id": "hume-octave", "name": "Hume Octave", "url": "https://hume.ai/", "icon": "/logos/hume.webp", "elo": 1526, "uncertainty": 21, "winRate": 53.900087642418924, "totalVotes": 1141, "open": false, "preliminary": false, "active": true, "suspended": false, "suspendedAt": null, "suspendedReason": null}
{"rank": 0, "tier": null, "id": "vocu", "name": "Vocu V3.0", "url": "https://vocu.ai/", "icon": "/logos/vocu.webp", "elo": 1564, "uncertainty": 22, "winRate": 59.76454293628809, "totalVotes": 1444, "open": false, "preliminary": false, "active": true, "suspended": true, "suspendedAt": 1783097341, "suspendedReason": "vote manipulation"}
```

### Date semantics
- **Current snapshot only.** There is no date or as-of field in the response; only `suspendedAt` is a timestamp. The BT fit is cached and refit after ≥50 new counting votes. `Cache-Control: public, max-age=15, stale-while-revalidate=300`.
- A monthly history must be **built by our own scheduled fetches**, stamped with the fetch date.
- **Wayback Machine:**
  - `http://archive.org/wayback/available?url=…` returned **429 Too Many Requests** on the single attempt.
  - The CDX query `http://web.archive.org/cdx/search/cdx?url=tts-agi-tts-arena-v2.hf.space/api/leaderboard&output=json` returned `[]`, i.e. **0 captures**. The variants `/api/leaderboard*`, the other domain, and the prefix `…/api/` (only `/api/tts/cached-sentences` was captured) also had none.
  - The **HTML page** `https://tts-agi-tts-arena-v2.hf.space/leaderboard` has 10 captures: 20250810180807 (a 302 redirect that resolves to 20260120), 20260120010016, 20260214083325, 20260306053713, 20260310132823, 20260327140019, 20260407184418, 20260413090041, 20260514081356 and 20260608234019.
  - Fetch pattern: `http://web.archive.org/web/<timestamp>id_/https://tts-agi-tts-arena-v2.hf.space/leaderboard`.
  - The captures from 2026-01-20 to 2026-05-14 are the **old Flask app**. They are server-rendered, with 25–26 rows inside `<div id="tts-public-leaderboard">`.
  - Each row is `div.leaderboard-row.tier-x > div.rank ("#1") / div.model-name > a.model-name-link (name, href=url) + div.license-icon (img alt "Proprietary" when closed) / div.win-rate ("56%") / div.total-votes ("1254") / div.elo-score ("1579")`.
  - **The schema differs from the JSON API, and the numbers come from the old Elo system (k=2), which is not comparable to the current BT ratings.**
  - The 20260608 capture is the new Next.js app, which renders client-side and contains **no rows**.
  - The old app also had `GET /api/historical-leaderboard/<type>?date=YYYY-MM-01` (months 2025-04 → 2026-05, seen in the archived JS). It is **not archived** and now returns 404 on the live app.
- **Continuity break around June 2026 (new app, new DB volume `TTS-AGI/arena-v3-db`).** Vote counts are not continuous. For example Hume Octave had 3,298 votes in the old 2026-05-14 HTML and 1,141 now, Papla P1 went from 3,161 to 958, and CosyVoice 2.0 from 2,218 to 58 (now preliminary-only). CastleFlow stayed at 1,643. The cause is likely that only `sentenceOrigin='dataset'` votes are counted now *(unverified)*.
- **HF datasets:** there is no official TTS-Arena-V2 vote or leaderboard-history dataset. `TTS-AGI/*` datasets are training corpora; `TTS-AGI/arena-prompts` holds prompts. `Pendrokar/TTS_Arena` (updated 2026-10-08) is the vote DB of a **different** arena, "TTS Spaces Arena" (`Pendrokar/TTS-Spaces-Arena`). The others are community or language-specific arenas.

### Naming quirks
- Provider brand is not in `id`: `async-1` is CastleFlow (async.ai), `lanternfish-1`/`lanternfish-2` are OpenAudio S1/S2 (fish.audio), `luck-dolphin` is "Aurora" (stealth), `neuphonic` is "NeuTTS Max", and `typecast` is "Typecast SSFM 3.0".
- Stealth or codename rows have `url: ""`, and some have `name == id` (`star-june-2026`). Map providers by `url` host first, then by name regex.
- Names drifted between the old and new apps: `MiniMax Speech-02-HD` became `MiniMax Speech 02 HD`, and `MiniMax Speech-02-Turbo` became `MiniMax Speech 02 Turbo`. Some names carry snapshot labels: `Gradium TTS (pre-2026.08)` vs `Gradium TTS 2026.08`, and `Tontaube V1 (pre-filter-fix)`.
- `open` flags look questionable for some models. Chatterbox (Resemble) is `open:false` here *(Chatterbox's open-source status is from my knowledge, unverified)*. In the old HTML, StyleTTS 2 and Spark TTS had the "Proprietary" badge.
- `inactive` (retired) models stay on the board: `async-1`, `papla-p1`, `kokoro-v1`, `tontaube`, `magpie*`, `neuphonic`, `maya1`, `wordcab`, `veena`. The top-ranked model (CastleFlow) is retired.

### Auth / rate limits
- No auth is needed for GET (HF OAuth only gates voting). No rate-limit headers were seen. About 8 requests total returned 200 in 0.56–1.45 s (TTFB about 0.7 s). There was no cold start: runtime is `cpu-upgrade` with `gcTimeout: null`, so the Space does not sleep.
- Headers: `vary: RSC, Next-Router-State-Tree…`, `link: <https://huggingface.co/spaces/TTS-AGI/TTS-Arena-V2>;rel="canonical"`, `access-control-expose-headers: *`.
- Wayback `available` returned 429 on first use. CDX took 39 s for one query.

### Licence verdict
- Space card front-matter has **no `license:` field** (`cardData` has none; API `license: null`).
- Repo `LICENSE` is Apache-2.0 (`https://huggingface.co/spaces/TTS-AGI/TTS-Arena-V2/blob/main/LICENSE`; GitHub `TTS-AGI/TTS-Arena` reports `apache-2.0`). This covers the code.
- Docs (`apps/docs/content/docs/index.mdx`, served at `https://docs.ttsarena.org/`) say "the resulting leaderboard is open". `privacy.mdx` "What we publish" lists "The leaderboard: per-model ratings, uncertainty, win rates, and vote counts."
- `provider-agreement.mdx` §5 "No harvesting" forbids **providers** (parties listing models) from scraping the arena. It does not address third-party readers, but it signals that scraping is unwelcome.
- **Verdict:** there is no explicit data licence. The leaderboard is intentionally public and described as open. Reusing the aggregate numbers with attribution (a link to the Space or ttsarena.org) is reasonable. Be polite: one fetch per day at most (the cache is 15 s anyway). Fetch only `/api/leaderboard`, never audio or prompts. Credit the source as "TTS Arena (TTS-AGI)".

### Surprises
1. Ranking is by CI lower bound, so a higher `elo` can sit at a lower rank. Use `elo` or the rank as the strength signal deliberately.
2. There is no history API and no archived JSON. The only history is Wayback HTML of the old app (Jan–May 2026, old Elo scale), and votes are not continuous across the June 2026 rewrite.
3. **OpenAI, Google, Sesame and PlayHT do not appear on the current board.** PlayHT 2.0, StyleTTS 2, Spark TTS and NLS Pre V1 appear only in old HTML captures. There are no `openai` or `google` provider packages in `packages/providers/`.
4. `include_proprietary` does not exist. `preliminary=1` is the only filter param.

### Product family → exact model-name strings (current `/api/leaderboard`, name with `id` in brackets)
- **ElevenLabs:** `Eleven Flash v2.5` [eleven-flash-v2.5], `Eleven Turbo v2.5` [eleven-turbo-v2.5], `Eleven Multilingual v2` [eleven-multilingual-v2], `Eleven v3` [eleven-v3]. The URL is `https://elevenlabs.io/`.
- **OpenAI TTS:** none, now or in the old HTML captures (Jan–May 2026).
- **Google TTS:** none.
- **MiniMax speech:** `MiniMax Speech 2.8 HD`, `MiniMax Speech 2.8 Turbo`, `MiniMax Speech 2.6 HD`, `MiniMax Speech 2.6 Turbo`, `MiniMax Speech 02 HD`, `MiniMax Speech 02 Turbo`. Ids are `minimax-speech-*` and the URL is `https://minimax.io/`. Old HTML used `MiniMax Speech-02-HD` and `MiniMax Speech-02-Turbo`.
- **Cartesia:** `Cartesia Sonic 2` [cartesia-sonic-2].
- **Hume:** `Hume Octave` [hume-octave].
- **Kokoro:** `Kokoro v1.0` [kokoro-v1] (open, inactive).
- **Papla:** `Papla P1` [papla-p1] (inactive).
- **Fish Audio:** `OpenAudio S1` [lanternfish-1], `OpenAudio S2` [lanternfish-2], both with URL `https://fish.audio/`.
- **Sesame:** none.
- **Resemble:** `Chatterbox` [chatterbox], URL `https://www.resemble.ai/chatterbox/`.
- **Others:**
  - Inworld: `Inworld TTS`, `Inworld TTS MAX`, `Inworld TTS 1.5 MAX`
  - Async: `CastleFlow v1.0` [async-1]
  - smallest.ai: `Lightning v3.1 Pro`
  - Gradium: `Gradium TTS (pre-2026.08)`, plus preliminary-only `Gradium TTS 2026.08`
  - `Deepdub eTTS 3.2`, `Typecast SSFM 3.0`, `Hithink Speech 2.6` (readifyai.com), `Voice.ai Text to Speech V1`
  - Tontaube: `Tontaube V0`, plus preliminary-only `Tontaube V1` and `Tontaube V1 (pre-filter-fix)`
  - NVIDIA: `Magpie Research Preview`, `Magpie Multilingual`
  - Neuphonic: `NeuTTS Max`
  - Rumik: `Silk Mulberry 1.5`
  - Maya Research: `Maya 1`, `Veena`
  - `Wordcab TTS`
  - Suspended: `Vocu V3.0`, plus preliminary-only `U2-TTS` (Unisound)
  - Stealth: `Aurora`, `star-june-2026`, `Parmesan`
  - Preliminary-only: `CosyVoice 2.0`, `Fluxions Vui`, `MARS` (camb.ai)
- **Veo / Sora / Kling / Runway / Hailuo / Luma / Wan / Seedance / Grok Imagine / Pika:** not applicable (speech source).

### Fixtures
- `C:\Users\dahli\Documents\GitHub\EVAL\pipeline\test\fixtures\tts-arena\sample.json` is the **untrimmed** original response of `GET /api/leaderboard` (12,054 bytes, 39 rows). It includes tiers S/A/B and null, a suspended row with `rank` 0, preliminary and inactive rows, empty `url`, null `icon`, and an int `winRate`.
- `…\tts-arena\sample-preliminary.json` is the untrimmed response of `?preliminary=1` (14,203 bytes, 46 rows).
- `…\tts-arena\sample-wayback-20260514.html` (19,862 bytes) is a trimmed excerpt of the Wayback capture 20260514081356 of the old `/leaderboard` HTML. Only the `#tts-public-leaderboard` block with 26 rows is kept, behind a provenance comment. There is no JSON capture, so it is not a `.json` file.
- Raw files in the scratchpad `recon-media/tts-arena/`: `leaderboard.json`, `lb_*.json`, `wb_leaderboard_*.html`, `cdx*.json`, and `src/` (route, leaderboard.ts, elo.ts, api.ts, docs).

---

## music-arena

Recon date 2026-10-08. Every item below was observed directly unless marked **(unverified)**.

### Working URL(s)
| Purpose | URL | Observed |
|---|---|---|
| Card metadata (licence, configs, full file list in `siblings`) | `https://huggingface.co/api/datasets/music-arena/music-arena-dataset` | 200, 2.3 MB JSON. `siblings` = 21,221 files. `sha` 4dbe5384…, `lastModified` 2026-08-09T19:08:41Z |
| Repo tree | `https://huggingface.co/api/datasets/music-arena/music-arena-dataset/tree/main?recursive=true` | 200, paginated at 1000 entries per page. The next page is in the `Link: <…&cursor=…>; rel="next"` header |
| README | `https://huggingface.co/datasets/music-arena/music-arena-dataset/resolve/main/README.md` | 200 |
| One battle (raw) | `https://huggingface.co/datasets/music-arena/music-arena-dataset/resolve/main/battle_data/{NN-YYYYMON}/{battle_uuid}.json` | 200. Single-line JSON object |
| Monthly parquet index (**recommended**) | `https://datasets-server.huggingface.co/parquet?dataset=music-arena/music-arena-dataset` | 200. 12 entries, one per config. `partial:false` |
| Parquet file | `https://huggingface.co/datasets/music-arena/music-arena-dataset/resolve/refs%2Fconvert%2Fparquet/{config}/train/0000.parquet` | 200. 0.3–1.1 MB each, 8.87 MB total |
| Paged rows as JSON (no parquet library needed) | `https://datasets-server.huggingface.co/rows?dataset=music-arena/music-arena-dataset&config={config}&split=train&offset={n}&length=100` | 200. `length` > 100 returns `{"error":"Parameter 'length' must not be greater than 100"}`. Response is `{features[], rows:[{row_idx,row:{…},truncated_cells:[]}], num_rows_total, num_rows_per_page, partial}`. 8,117 rows ≈ 86 calls |
| splits / info / size / first-rows | `https://datasets-server.huggingface.co/{splits,info,size,first-rows}?dataset=music-arena/music-arena-dataset[&config=…&split=train]` | 200. `first-rows` returned 92 rows with `truncated:true`, so do not use it for a full read |
| Official leaderboard TSVs (precomputed, **cumulative**) | `https://raw.githubusercontent.com/gclef-cmu/music-arena/main/components/frontend/ma_frontend/leaderboard/{YYYYMMDD}/{vocal,instrumental}_leaderboard_20250728_to_{YYYYMMDD}.tsv` | 200. 22 files (11 month-end dates × 2) |
| Model registry (system key → display name, org, access, supports_lyrics) | `https://raw.githubusercontent.com/gclef-cmu/music-arena/main/systems/registry.yaml` | 200 (YAML) |
| Leaderboard code | `https://github.com/gclef-cmu/music-arena/tree/main/components/leaderboard` (`ma_leaderboard/scoring.py`, `leaderboard.py`, `cli.py`, `config.py`) | 200 |

`music-arena.org` returns 200 with a final URL of `https://beta.music-arena.org/` (a Gradio app). I found no JSON leaderboard endpoint there. The Gradio frontend loads the TSVs above.

### Format & size
- Configs are monthly (README `configs:`): `2025_07-08`, `2025_09`, `2025_10`, `2025_11`, `2025_12`, `2026_01` … `2026_07`. That is 12 configs, each with the single split `train`. The first config covers two months (Jul 28 – Aug 31, 2025).
- Repo layout:
  - `battle_data/{NN-YYYYMON}/{battle_uuid}.json`: one battle per file, 8,117 files. Folders are `01-2025JULAUG`, `02-2025SEP`, `03-2025OCT`, `04-2025NOV`, `05-2025DEC`, `06-2026JAN`, `07-2026FEB`, `08-2026MAR`, `09-2026APR`, `10-2026MAY`, `11-2026JUN`, `12-2026JUL`.
  - `audio_files/{same folder}/{original|prebaked}-{md5}-{battle_uuid}-{a|b}.mp3`: 13,080 mp3 files. These make up most of the 35.7 GB `usedStorage`. **Do not fetch.**
  - `metadata/{folder}.md`: 12 human-readable summaries with per-model appearance counts.
  - `README.md` and `.gitattributes`.
- The data is **battles (pairwise votes), not ratings.** Total 8,117 battles. Parquet files total 8.87 MB.
- Battles per config: 2025_07-08 1051 · 2025_09 352 · 2025_10 468 · 2025_11 256 · 2025_12 679 · 2026_01 470 · 2026_02 300 · 2026_03 986 · 2026_04 674 · 2026_05 468 · 2026_06 1049 · 2026_07 1364. Card counts, parquet row counts and JSON file counts all agree.
- Date range: 2025-07-28T09:28:54-04:00 to 2026-07-31T18:17:13-04:00.

### Exact field names + types
All 28 keys are present in every record, in the same order, in both the raw JSON and the parquet. The parquet dtypes below come from datasets-server `/info`.

| field | type | notes (observed) |
|---|---|---|
| `battle_uuid` | string | UUID v4. Unique across all 8,117 battles. Same as the JSON file name |
| `date` | string | ISO-8601 with microseconds and a **US-Eastern offset** (`-04:00` ×5983, `-05:00` ×2134). Always 32 chars, e.g. `2025-07-29T00:16:19.799690-04:00` |
| `prompt` | string | Free text. Can have a leading space |
| `is_instrumental` | bool | True 5,324 / False 2,793 |
| `is_prebaked` | bool | True 709. True means the prompt came from a preset list |
| `user_pseudonym` | string | 32-hex, a salted hash of the IP. 1,685 distinct |
| `audio_a`, `audio_b` | string | Repo-relative mp3 path, or **`""` (empty string, not null as the README says)** when the audio is unreleased: 1,612 for `audio_a` (sao, sao-small, sa3-medium, elevenlabs-music-v1) |
| `system_a`, `system_b` | string | **Model key**, e.g. `lyria-3-pro-preview`. Never equal to each other (0 self-battles) |
| `preference` | string | Exactly one of `"A"` (2,604), `"B"` (2,927), `"TIE"` (569), `"BOTH_BAD"` (2,017) |
| `total_listening_time_a/_b` | float64 | Seconds |
| `feedback` | string | Usually `""`. 360 are non-empty |
| `timestamp` | float64 | Unix seconds (UTC epoch). Equals `date` to within 0.5 µs |
| `lyrics` | string | `""` if none |
| `hardware_a/_b` | string | `"A6000"`, `"A5000"`, `"Unknown (API)"` |
| `system_time_a/_b`, `gateway_time_a/_b` | float64 | Seconds |
| `duration_a/_b` | float64 | Seconds |
| `sample_rate_a/_b` | int64 | e.g. 44100, 48000 |
| `listen_data_a/_b` | string \| **null** | A JSON-encoded string `[["PLAY",ts],["TICK",ts],["PAUSE",ts],…]`. Null in 1 (`_a`) and 5 (`_b`) records |

- There is no explicit is-valid or filtered flag and no session ID.
- The card's `features: {audio_a: audio, audio_b: audio}` is ignored by datasets-server, which types those columns as plain strings.

One verbatim example record (raw `battle_data/01-2025JULAUG/0031edcc-3b14-4a96-a2f7-60febd067b8d.json`; `lyrics` and `listen_data_a` truncated where marked):
```json
{"battle_uuid": "0031edcc-3b14-4a96-a2f7-60febd067b8d", "date": "2025-07-29T00:16:19.799690-04:00", "prompt": "Folk singer-songwriter making an intimate confession", "is_instrumental": false, "is_prebaked": true, "user_pseudonym": "f9b56a35ab647f7875cfb6f527fd5bb1", "audio_a": "audio_files/01-2025JULAUG/prebaked-cd7fba87f19c84bb249dd75b98bcea57-0031edcc-3b14-4a96-a2f7-60febd067b8d-a.mp3", "system_a": "acestep", "audio_b": "audio_files/01-2025JULAUG/prebaked-cd7fba87f19c84bb249dd75b98bcea57-0031edcc-3b14-4a96-a2f7-60febd067b8d-b.mp3", "system_b": "riffusion-fuzz-1-1", "preference": "B", "total_listening_time_a": 35.53386449813843, "total_listening_time_b": 4.309781074523926, "feedback": "", "timestamp": 1753762579.7996902, "lyrics": "Caught in a room with no windows,  \nI'm tracing shadows on t…[TRUNCATED]", "hardware_a": "A6000", "hardware_b": "Unknown (API)", "system_time_a": 7.949536561965942, "system_time_b": 34.21332097053528, "gateway_time_a": 9.52510690689087, "gateway_time_b": 43.816596031188965, "duration_a": 29.952, "duration_b": 199.915102, "sample_rate_a": 48000, "sample_rate_b": 44100, "listen_data_a": "[[\"PLAY\", 1753762515.1790552], [\"TICK\", 1753762516.4397266], [\"TICK\", 1753762517.4482489], …[TRUNCATED]]", "listen_data_b": "[[\"PLAY\", 1753762546.3006454], [\"TICK\", 1753762547.6212356], [\"TICK\", 1753762548.6347902], [\"TICK\", 1753762549.5979948], [\"TICK\", 1753762550.6104264]]"}
```

### Date semantics
- **Configs and folders follow US-Eastern calendar months.** The code (`preprocess.py` `get_month_folder`) uses `EASTERN_TZ`, and in the data the local part `date[:7]` matches the config 100% (apart from the combined Jul–Aug config). If you bucket by UTC instead, a few battles move: 2025_10 has 468 battles by ET but 471 by UTC, 2026_02 has 300 by ET vs 302 by UTC. Recommendation: bucket by `date.slice(0,7)` (ET) to match the official configs.
- `date` and `timestamp` are taken from the vote time (`preference_time`), falling back to session create time (`preprocess.py`).
- Release cadence is irregular, with a lag of about 1–6 weeks. From the HF commit log:
  - "Add March 2026 data" landed 2026-04-15, April 2026 on 05-19 and May 2026 on 06-04.
  - June and July 2026 both landed on 2026-08-09.
  - **As of 2026-10-08, Aug and Sep 2026 are not yet published.**
- The repo was rebuilt and reprocessed several times (Jan–Mar 2026 commits include "Delete data", "Upload dataset", and "Replace generation_time with system_time + gateway_time" on 2026-03-16). Older revisions therefore had a different schema. All 12 current configs share the 28-column schema above.

Battles per config by preference (A / B / TIE / BOTH_BAD):

| config | A | B | TIE | BOTH_BAD |
|---|---|---|---|---|
| 2025_07-08 | 373 | 420 | 45 | 213 |
| 2025_09 | 110 | 143 | 23 | 76 |
| 2025_10 | 182 | 195 | 18 | 73 |
| 2025_11 | 90 | 100 | 25 | 41 |
| 2025_12 | 205 | 207 | 41 | 226 |
| 2026_01 | 120 | 147 | 35 | 168 |
| 2026_02 | 93 | 97 | 45 | 65 |
| 2026_03 | 337 | 446 | 60 | 143 |
| 2026_04 | 204 | 232 | 67 | 171 |
| 2026_05 | 137 | 181 | 15 | 135 |
| 2026_06 | 361 | 353 | 86 | 249 |
| 2026_07 | 392 | 406 | 109 | 457 |

### Distinct models (18 keys in data; appearances = count as `system_a` + count as `system_b`)

| key (exact) | display name (registry.yaml) | org | access | appearances | first – last (UTC date) |
|---|---|---|---|---|---|
| `elevenlabs-music-v1` | ElevenLabs Music v1 | ElevenLabs | Proprietary | 2121 | 2025-10-16 – 2026-07-31 |
| `sonauto-v2-2` | Sonauto v2.2 | Sonauto | Proprietary | 2100 | 2025-10-16 – 2026-07-31 |
| `acestep-1.5-turbo-1.7b` | ACE-Step 1.5 Turbo (1.7B) | ACE Studio / StepFun | Open weights | 1499 | 2026-03-01 – 2026-07-31 |
| `magenta-rt-large` | Magenta RealTime (Large) | Google DeepMind | Open weights | 1352 | 2025-07-28 – 2026-07-31 |
| `riffusion-fuzz-1-1` | Riffusion FUZZ v1.1 | Producer.ai | Proprietary | 1261 | 2025-07-28 – 2026-02-19 |
| `lyria-3-pro-preview` | Lyria 3 Pro | Google DeepMind | Proprietary | 1142 | 2026-03-26 – 2026-07-29 |
| `sao` | Stable Audio Open | Stability AI | Open weights | 1091 | 2025-07-28 – 2026-06-04 |
| `musicgen-medium` | MusicGen Medium | Meta | Open weights | 1051 | 2025-10-17 – 2026-07-31 |
| `riffusion-fuzz-1-0` | Riffusion FUZZ v1.0 | Producer.ai | Proprietary | 863 | 2025-07-28 – 2026-02-20 |
| `musicgen-small` | MusicGen Small | Meta | Open weights | 726 | 2025-07-28 – 2026-02-18 |
| `sao-small` | Stable Audio Open Small | Stability AI | Open weights | 703 | 2025-07-28 – 2026-02-13 |
| `sa3-medium` | Stable Audio 3 (Medium) | Stability AI | Open weights | 496 | 2026-06-05 – 2026-07-30 |
| `lyria-3-30s` | Lyria 3 Clip | Google DeepMind | Proprietary | 470 | 2026-02-24 – 2026-04-15 |
| `magenta-rt-2-base` | Magenta RealTime 2 (Base) | Google DeepMind | Open weights | 443 | 2026-06-05 – 2026-07-31 |
| `acestep` | ACE-Step | ACE Studio | Open weights | 347 | 2025-07-28 – 2025-10-15 |
| `sonauto-v3-preview` | Sonauto v3 Preview | Sonauto | Proprietary | 308 | 2026-02-25 – 2026-04-15 |
| `preview-ocelot` | (excluded: "private testing model") | Hidden | – | 134 | 2025-07-28 – 2025-09-25 |
| `preview-jerboa` | (excluded: "private testing model") | Hidden | – | 127 | 2025-07-28 – 2025-09-24 |

Registered in `registry.yaml` but **not present in released data through 2026-07**: `elevenlabs-music-v2`, `lyria-3-5`, `minimax-music-3-0`, `minimax-music-2-6`, `acestep-1.5-turbo-4b`, `magenta-rt-2-small`, `sa3-small-music`, plus never-deployed `sa2`, `lyria-rt`, `musicgen-large`, `magenta-rt-base`, `audioldm2`, `songgen`, `noise`.

### Product family → exact model-name strings found
| family | strings in battle data | registry-only (not yet in data) |
|---|---|---|
| Suno | **none**: absent from data and registry (Suno is only thanked in the README acknowledgements) | none |
| Udio | **none** | none |
| ElevenLabs Music | `elevenlabs-music-v1` | `elevenlabs-music-v2` |
| Google Lyria | `lyria-3-30s` (Lyria 3 Clip), `lyria-3-pro-preview` (Lyria 3 Pro) | `lyria-3-5`, `lyria-rt` (never deployed) |
| Google Magenta RT (open) | `magenta-rt-large`, `magenta-rt-2-base` | `magenta-rt-2-small`, `magenta-rt-base` |
| MusicGen (Meta) | `musicgen-small`, `musicgen-medium` | `musicgen-large` (never deployed) |
| Stable Audio (Stability) | `sao`, `sao-small`, `sa3-medium` | `sa3-small-music`, `sa2` |
| Riffusion / Producer.ai | `riffusion-fuzz-1-0`, `riffusion-fuzz-1-1` | – |
| MiniMax Music | **none in data** | `minimax-music-2-6`, `minimax-music-3-0` |
| ACE-Step | `acestep`, `acestep-1.5-turbo-1.7b` | `acestep-1.5-turbo-4b` |
| Sonauto | `sonauto-v2-2`, `sonauto-v3-preview` | – |
| Anonymous previews | `preview-ocelot`, `preview-jerboa` | – |

### Official leaderboard and Bradley–Terry
- **We must compute monthly BT ourselves.** The dataset holds only votes.
- The official TSVs are **cumulative from 2025-07-28 to the month end**, not per month. Snapshot folders: 20250831, 20250930, 20251031, 20251130, 20251231, 20260131, 20260228, 20260331, 20260430, 20260531, 20260731. **There is no 20260630 snapshot.**
- Official method, from `components/leaderboard/README.md`, `ma_leaderboard/scoring.py`, `leaderboard.py` and `cli.py`:
  - BT through `sklearn LogisticRegression(fit_intercept=False, penalty="l2", C=1.0, solver="lbfgs", tol=1e-6, max_iter=10000)`.
  - Design row: +1 for model_a, −1 for model_b. `score = 400*coef/ln(10)`, then mean-centred to 1000.
  - `TIE` becomes two weighted rows (y=1 w=0.5, y=0 w=0.5). **`BOTH_BAD` is excluded.** Mapping is `{"A":"model_a","B":"model_b","TIE":"tie"}`.
  - 95% CI = ±1.96·SD over 1000 bootstraps. Only models with ≥30 votes are shown (`MIN_VOTES_THRESHOLD = 30`). `preview-ocelot` and `preview-jerboa` are excluded.
  - **Vocal board** = `is_instrumental == False` AND both systems have `supports_lyrics: true`. **Instrumental board** = `is_instrumental == True` AND NOT both systems have `supports_lyrics`.
  - I reproduced the `# Votes` column of both 20260731 TSVs exactly from the parquet data with these filters. For example, Lyria 3 Pro has 581 vocal and 241 instrumental votes, and Riffusion FUZZ v1.1 has 452 instrumental votes.
  - 843 non-BOTH_BAD battles appear on neither board: both models are lyrics-capable but the prompt is instrumental.
  - I found no listening-time filter in the leaderboard code.
- The official pipeline reads the same datasets-server `/parquet` endpoint we would use (`leaderboard.py fetch_hf_battles`).
- TSV schema:
  - **Late files** (20251130 onward): `Rank	Model	Arena Score	95% CI	# Votes	Generation Speed (RTF)	organization	training_data	supports_lyrics	access`. `Model` is the **display name** (e.g. `Lyria 3 Pro`). `Arena Score` is an integer. `95% CI` is `±39`.
  - **Early files** (20250831, 20250930): an extra `license` column, `Model` is the **system key** (`riffusion-fuzz-1-0`), Arena Score has one decimal (`1172.5`) and CI looks like `+97.5 / -68.5`.
  - **20251031** has no `license` column but still uses `+x / -y` CIs.
  - The files are UTF-8 (the `±` character) with LF line endings.

### Naming quirks
- Use `system_a` and `system_b` as stable keys. Display names come only from the GitHub `registry.yaml`, which also maps keys to org, access and lyrics support.
- `preview-*` systems are anonymous. Their org is "Hidden" in the early TSVs.
- Prompts may contain leading spaces.
- Audio paths use `original-` for user prompts and `prebaked-` for preset prompts.

### Auth / rate limits
- No token needed: `gated:false`, `private:false`. I made about 130 HF requests (API, resolve, datasets-server) with no throttling.
- Datasets-server caps `/rows` at `length` 100 and sends `cache-control: max-age=120`.
- The HF tree API pages at 1000 entries per page through the `Link` header.
- The GitHub REST API allows 60 requests per hour unauthenticated (GitHub-documented limit; I did not hit it). File contents can be fetched from `raw.githubusercontent.com` instead.
- HF's published anonymous rate limits **(unverified)**.

### Licence verdict
- The card has `license: cc-by-4.0` (`cardData.license`, plus tag `license:cc-by-4.0`). The README sets no different licence for metadata versus audio.
- The README says audio for some models is "not included … due to specific release agreements". The GitHub `registry.yaml` adds `release_audio_publicly: false` for sao, sao-small, sa3-*, sa2 and elevenlabs-*. Only the audio is withheld; the vote metadata for those battles is published.
- GitHub code and TSVs are MIT (`LICENSE`, and `api.github.com/repos/gclef-cmu/music-arena` reports `license.spdx_id: MIT`).
- **Verdict: OK to use.** We only need the vote metadata (CC BY 4.0: attribute "Music Arena (Kim et al., NeurIPS 2025 Creative AI track), music-arena/music-arena-dataset, CC BY 4.0" and note our changes). We never touch the audio.
- Whether third-party model-provider ToS add terms to generated audio is **unverified**. It does not matter for us because we don't fetch audio.
- Evidence: https://huggingface.co/datasets/music-arena/music-arena-dataset (README front matter), https://github.com/gclef-cmu/music-arena/blob/main/LICENSE

### Surprises
1. **No Suno, Udio or MiniMax data.** Frontier coverage is ElevenLabs, Lyria 3, Riffusion/Producer.ai and Sonauto, plus open models.
2. The README says unreleased audio is `null`. It is actually `""`.
3. `listen_data_*` can be `null`.
4. `BOTH_BAD` makes up 25% of votes (2,017 of 8,117), and 33.5% in 2026-07. It is excluded officially.
5. The first config spans two months.
6. A monthly snapshot is missing from the GitHub leaderboards (no 20260630).
7. The TSV schema changed twice (licence column dropped, CI format changed, Model switched from key to display name).
8. Some months are small: 256 battles in 2025-11 and 300 in 2026-02. Per-month BT for low-vote models will be noisy, so consider rolling windows.
9. Models come and go. Riffusion and the small Stable Audio Open models end around Feb 2026, while Lyria 3 Pro, SA3 and Magenta RT 2 start Mar–Jun 2026.

### Fixtures written (`pipeline/test/fixtures/music-arena/`)
- `sample.json`: 133 KB. A JSON array of 92 **verbatim raw battle objects** fetched from `battle_data/**.json`, with original key order.
  - It covers all 12 configs, all 18 systems and all 4 preference values (A 25, B 34, TIE 14, BOTH_BAD 19).
  - Edge cases included: both `-04:00` and `-05:00` dates; null `listen_data_a` and `listen_data_b`; empty `audio_*`; prebaked prompts; non-empty `feedback`; ET-month ≠ UTC-month battles.
  - Trimming: `prompt`, `lyrics` and `feedback` are cut at 160 chars with the suffix `…[truncated]`. `listen_data_*` is cut to its first 3 events and re-serialised with Python `json.dumps`, so it stays valid JSON in the same format.
  - The source is per-file JSON. Each array element is one file's content.
- `datasets-server-parquet.json`: verbatim `/parquet` response (12 configs, URLs, sizes).
- `official-vocal_leaderboard_20250728_to_20260731.tsv`, `official-instrumental_leaderboard_20250728_to_20260731.tsv` (late schema) and `official-vocal_leaderboard_20250728_to_20250831.tsv` (early schema): verbatim, for parser and BT-reproduction tests.


---

## genai-arena

### Working URL(s)
| Purpose | URL | Observed |
|---|---|---|
| Space metadata | `https://huggingface.co/api/spaces/TIGER-Lab/GenAI-Arena` | 200. `sha` 4197b3a6…, `lastModified` **2025-07-03**, `runtime.stage` **"BUILD_ERROR"** (the Space app is down) |
| Results tree | `https://huggingface.co/api/spaces/TIGER-Lab/GenAI-Arena/tree/main/arena_elo/results?recursive=true&expand=false` | 200. 1,048 entries in **2 pages**, using the `Link` header cursor |
| Leaderboard CSV | `https://huggingface.co/spaces/TIGER-Lab/GenAI-Arena/resolve/main/arena_elo/results/{YYYYMMDD\|latest}/{t2i_generation\|video_generation\|image_editing}_leaderboard.csv` | 307 to `/api/resolve-cache/…`, then 200 `text/plain`. Use `fetch` with redirects on (`curl -L`). All 288 CSVs fetched with 200 |
| Raw battles (all-time, per task) | `…/results/{folder}/clean_battle_{t2i_generation\|video_generation\|image_editing}.json` | 200. `latest` sizes: 4.0 MB, 1.2 MB, 0.7 MB |
| Elo pickle | `…/results/{folder}/elo_results_{task}.pkl` | 200. A **Python pickle**: I inspected it with `pickletools` only and **did not unpickle it**, because loading it would execute untrusted code |

### Format & size
- 179 dated folders, from `20240220` to `20250324`, plus `latest`.

| file | dated folders | first | last |
|---|---|---|---|
| `t2i_generation_leaderboard.csv` (image) | 149 | 20240220 | 20250324 |
| `video_generation_leaderboard.csv` | 95 | 20240526 | 20250322 |
| `image_editing_leaderboard.csv` | 41 | 20240220 | 20250309 |
| `elo_results_t2i_generation.pkl` / `elo_results_video_generation.pkl` / `elo_results_image_editing.pkl` | 149 / 95 / 41 | | |
| `clean_battle_t2i_generation.json` | 149 | 20240327 | |
| `clean_battle_video_generation.json` | 98 | 20240526 | |
| `clean_battle_image_editing.json` | 42 | 20240315 | |

- Not every folder holds every task. There are 13 different file combinations.
- `latest/` holds all 9 files. Its t2i and video CSVs are byte-identical to the 20250324 and 20250322 files.
- Image snapshots per month: 2024-02 1, 03 2, 04 2, 05 6, 06 5, **07 0**, 08 17, 09 15, 10 12, 11 20, 12 20, 2025-01 19, 02 16, 03 14.
- Video snapshots per month: 2024-05 3, 06 5, **07 0**, 08 12, 09 4, 10 5, 11 14, 12 12, 2025-01 14, 02 17, 03 9.
- CSVs are 0.9–2.6 KB, UTF-8 with no BOM, LF line endings and a trailing newline. The header is **identical across all 288 CSVs**.

### Exact field names + types (CSV)
Header: `key,Model,Arena Elo rating (anony),Arena Elo rating (full),License,Organization,Link`

| column | type | notes |
|---|---|---|
| `key` | string | Always equal to `Model` (0 mismatches across all files) |
| `Model` | string | Plain name. **No markdown links in the CSV.** The `[Name](url)` markdown exists only inside the pkl (`leaderboard_table` strings). If ever needed, strip it with `s.replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')` and also strip the 🥇🥈🥉 prefixes |
| `Arena Elo rating (anony)` | float | **Primary score.** BT-MLE on anonymous battles only. Rows are sorted by this column, descending |
| `Arena Elo rating (full)` | float | BT-MLE on all battles (anonymous and named) |
| `License` | string | Free text, e.g. `openrail++`, `Apache 2.0`, `flux-1-dev-non-commercial-license (other)`, `-`, or `N/A` |
| `Organization` | string | Can contain commas (quoted CSV), e.g. `"The Chinese University of Hong Kong, Shanghai AI Lab, Stanford University"`. Can also contain `;` |
| `Link` | string | URL, or `N/A` |

- **There are no CI, vote-count or rank columns in the CSV.**
  - `num_battles`, bootstrap results and `last_updated_datetime` (e.g. `"2025-03-24 06:31:12 PDT"`) live only in the pkl (`leaderboard_table_df`, `bootstrap_df`).
  - Instead, compute votes and CIs from `clean_battle_*.json`.
- `N/A` strings appear in 20240817 (`FluxTimestep,…,N/A,N/A,N/A`). pandas reads them as NaN, so a Node CSV parser should treat `N/A` as null.

Verbatim example row (`20250324/t2i_generation_leaderboard.csv`, row 1):
```
FLUX.1-dev,FLUX.1-dev,1132.6562046877937,1136.881626526418,flux-1-dev-non-commercial-license (other),Black Forest Labs,https://huggingface.co/docs/diffusers/main/en/api/pipelines/flux
```
Verbatim video row (`20250322/video_generation_leaderboard.csv`):
```
AnimateDiff,AnimateDiff,1039.2430147802825,1039.1706922566602,creativeml-openrail-m,"The Chinese University of Hong Kong, Shanghai AI Lab, Stanford University",https://fal.ai/models/fast-animatediff-t2v
```

`clean_battle_*.json` is a JSON array. Every record has exactly these keys:

| key | type | values |
|---|---|---|
| `model_a`, `model_b` | string | Canonical (post-rename) names |
| `winner` | string | `"model_a"`, `"model_b"`, `"tie"`, `"tie (bothbad)"` |
| `vote_type` | string | e.g. `"leftvote"`, `"rightvote"` |
| `anony` | bool | |
| `tstamp` | float | Unix seconds |
| `judge` | string | `"arena_user_<ip>"`. Internal IPs, so do not republish |
| `inputs` | object | e.g. `{"prompt":"Apple"}` or `{"online_load":false}` |
| `model_a_conv_id`, `model_b_conv_id` | string | |

Example: `{"model_a_conv_id": "8ad9cb0f10f24341a33842330f681d23", "model_b_conv_id": "865701203dc44d90bb193a5af2849101", "inputs": {"prompt": "Apple"}, "model_a": "AnimateDiff", "model_b": "AnimateDiff Turbo", "vote_type": "leftvote", "winner": "model_a", "judge": "arena_user_10.16.17.217", "anony": true, "tstamp": 1713914099.33}`

| `latest` battle file | battles | date range (UTC) | anony | model_a / model_b / tie / tie (bothbad) |
|---|---|---|---|---|
| t2i | 8,655 | 2024-02-12 – 2025-03-24 | 7,359 | 3197 / 3177 / 838 / 1443 |
| video | 2,953 | 2024-04-23 – 2025-03-23 | 2,872 | 999 / 1021 / 293 / 640 |
| editing | 1,282 | 2024-02-12 – 2025-03-09 | 1,230 | 352 / 378 / 26 / 526 |

### Date semantics
- The folder name is the **US/Pacific date of the last battle included** for that task (`clean_battle_data.py` writes `cut_off_date.txt` using `timezone("US/Pacific").strftime("%Y%m%d")`). It is not the run date.
- Ratings are **cumulative all-time BT** as of that cutoff. There are no monthly windows.
- Method (`arena_elo/elo_rating/elo_analysis.py`): `compute_elo_mle_with_tie`, SCALE 400, INIT 1000, sklearn LogisticRegression with default settings.
  - **Both `tie` and `tie (bothbad)` count as half-win/half-loss.** This differs from Music Arena, which drops BOTH_BAD.
  - `--rating-system` defaults to `bt`, and the pkl contains `rating_system: 'bt'`.
  - `--min_num_battles_per_model` defaults to 25.
  - 100 bootstraps.
- **The data is frozen. The last battle is 2025-03-24 and nothing is newer as of 2026-10-08.**

### Naming quirks (renames across snapshots, same model)
| image | video |
|---|---|
| `PlayGroundV2` (20240220) → `Playground v2` (0327–0408) → `PlayGround V2` (0411+) | `AnimateDiffTurbo` → `AnimateDiff Turbo` (0819+) |
| `Playground v2.5` → `PlayGround V2.5` | `T2VTurbo` → `T2V-Turbo` (0819+) |
| `SDXLLightning` (0327–0818) → `SDXL-Lightning` (0820+) | `CogVideoX` (0819–0821) → `CogVideoX-2B` (0822+) |
| `FLUX1dev` / `FLUX1schnell` (20240818 only) → `FLUX.1-dev` / `FLUX.1-schnell` (0820+) | |
| `FluxTimestep` (20240817 only, all metadata `N/A`) maps to FLUX.1-schnell per the code's `replace_model_name` | |

- The `latest` clean_battle files already use the final names.
- Other irregular names: `LCM(v1.5/XL)`, `PlayGround V2.5`, `Pyramid Flow`, `OpenSora v1.2`.
- The image `Link` and `Organization` for the same model change across snapshots (e.g. FLUX.1-schnell's licence changed from `flux-1-dev-non-commercial…` to `Apache-2.0`).

### Distinct model names, latest snapshot
- **Image (`20250324`, 17):** FLUX.1-dev, PlayGround V2.5, FLUX.1-schnell, PlayGround V2, Kolors, StableCascade, HunyuanDiT, PixArtAlpha, PixArtSigma, SDXL-Lightning, SD3, AuraFlow, SDXL, SDXLTurbo, LCM(v1.5/XL), OpenJourney, LCM.
- **Video (`20250322`, 15):** CogVideoX-5B, Mochi1, StableVideoDiffusion, Pyramid Flow, T2V-Turbo, CogVideoX-2B, AnimateDiff, VideoCrafter2, Allegro, LaVie, LTXVideo, OpenSora, OpenSora v1.2, AnimateDiff Turbo, ModelScope.
- **Image editing (`20250309`, 10):** CycleDiffusion, InstructPix2Pix, MagicBrush, PNP, Pix2PixZero, Prompt2prompt, SDEdit, CosXLEdit, InfEdit, UltraEdit. `AURORA` appears in only 3 battles and never on the board.

### Product family → exact model-name strings found
| family | strings (all snapshots) |
|---|---|
| FLUX (BFL) | `FLUX.1-dev`, `FLUX.1-schnell`; legacy `FLUX1dev`, `FLUX1schnell`, `FluxTimestep` |
| Stable Diffusion / Stability | `SDXL`, `SDXLTurbo`, `SD3`, `StableCascade`; video `StableVideoDiffusion`; editing `CosXLEdit`. SD derivatives: `SDXL-Lightning`/`SDXLLightning` (ByteDance), `LCM`, `LCM(v1.5/XL)`, `OpenJourney` |
| Playground | `PlayGround V2`, `PlayGround V2.5` (legacy `PlayGroundV2`, `Playground v2`, `Playground v2.5`) |
| DALL·E / GPT Image, Imagen, Ideogram, Midjourney, Recraft | **none** |
| Sora (OpenAI), Kling, Runway, Luma, Pika, Veo, Hailuo/MiniMax | **none** |
| CogVideoX | `CogVideoX-2B`, `CogVideoX-5B` (legacy `CogVideoX`) |
| OpenSora | `OpenSora`, `OpenSora v1.2` |
| Others (image) | `PixArtAlpha`, `PixArtSigma`, `HunyuanDiT`, `Kolors`, `AuraFlow` |
| Others (video) | `AnimateDiff`, `AnimateDiff Turbo`, `VideoCrafter2`, `LaVie`, `ModelScope`, `T2V-Turbo`, `Pyramid Flow`, `Allegro`, `LTXVideo`, `Mochi1` |

- **No proprietary or closed-API frontier models appear in any snapshot.** Every model is open-weight or research, although some were served through fal.ai.

### Auth / rate limits
- No auth needed. The tree API returned 2 pages with no problems.
- 288 CSV fetches at concurrency 4 all returned 200 with no throttling. Resolve URLs answer with a 307 redirect.
- HF anonymous limits **(unverified)**.

### Licence verdict
- The Space card README front matter has `license: mit` (also in `cardData.license`).
- The repo has `arena_elo/LICENSE`, which is MIT, "Copyright (c) 2024 WildVision-Bench" (the code was inherited). There is no root LICENSE file.
- There is no separate data licence for the results files. MIT on the repo covers them in practice, and the ratings are factual aggregates. The per-row `License` column describes **each model's** licence, not the data's.
- **Verdict: usable with attribution (MIT notice and a cite of GenAI-Arena, Jiang et al. 2024).**
- Do not republish `clean_battle_*.json` raw, because the `judge` field contains internal IPs.
- Evidence: https://huggingface.co/spaces/TIGER-Lab/GenAI-Arena/blob/main/README.md, https://huggingface.co/spaces/TIGER-Lab/GenAI-Arena/blob/main/arena_elo/LICENSE

### Surprises
1. **The source is stale.** The last results are from 2025-03-24, the Space was last modified 2025-07-03, and it is now in BUILD_ERROR. For 2025–2026 image and video "fronts" it provides no current data.
2. **No proprietary models at all.** There is no DALL·E, Midjourney, Imagen, Sora, Kling, Runway or Luma. It cannot represent frontier image or video vendors.
3. The CSVs have no vote counts and no CIs. Those exist only in the pickle (unsafe to load) or must be computed from `clean_battle_*.json`.
4. Names drift across snapshots (see table above). Normalise using the clean_battle names.
5. There are no snapshots for July 2024.
6. The `latest/` folder duplicates the last dated files.
7. Tie handling differs from Music Arena: `tie (bothbad)` counts as a tie here.

### Fixtures written (`pipeline/test/fixtures/genai-arena/`), all verbatim copies
- `sample-image-20240220.csv` (939 B, earliest; 6 rows, legacy `PlayGroundV2` naming)
- `sample-image-20250324.csv` (2.5 KB, latest; 17 rows)
- `sample-video-20240526.csv` (984 B, earliest; 6 rows)
- `sample-video-20250322.csv` (2.1 KB, latest; 15 rows)
- `sample-image-20240817.csv`: extra edge case with `FluxTimestep` and `N/A` values
- `dates.json`: tree API URL, resolve template, repo sha, the 179 dated folders with exact file names (`folders`), `latest` file list, per-file counts and ranges (`countsByFile`), and per-task CSV date lists (`leaderboardCsvDates.image|video|image_editing`)

---

## designarena-* (designarena-image / designarena-video / designarena-tts / designarena-music)

Recon date: 2026-10-08 (JST). Operator: Design Arena by Arcada Labs Incorporated. No API key held; nothing below was fetched with a key.
Raw captures: `scratchpad/recon-media/designarena/` (docs `.md`, `docs_openapi.yaml`, `docs_llms-full.txt`, `probe_noauth_*.txt`, `observed_*_2026-10-08.txt`, `terms_text.txt`).

### Working URL(s)

| What | URL | Status (2026-10-08) |
|---|---|---|
| Docs (Mintlify) | https://docs.designarena.ai/ | 200 |
| LLM index / full dump | https://docs.designarena.ai/llms.txt , https://docs.designarena.ai/llms-full.txt | 200 (full dump has all 6 pages) |
| Per-page markdown | `https://docs.designarena.ai/{introduction,quickstart,api-reference/overview,api-reference/arenas,api-reference/models,api-reference/leaderboard}.md` | 200 |
| OpenAPI spec | https://docs.designarena.ai/openapi.yaml (OpenAPI 3.1.0, `info.version: 1.2.0`) | 200 (`/openapi.json` = 404) |
| API base URL | `https://www.designarena.ai/api/v1` | 401 without a key (all paths) |
| Key application form | https://designarena.ai/developers/apply | 200 (form only; NOT submitted) |
| Public boards | https://www.designarena.ai/leaderboard/image , `/leaderboard/video` , `/leaderboard/tts` , `/leaderboard/audiorealismbench` | 200 (data loaded client-side) |
| Music board on public site | `/leaderboard/music` (and /audio, /songs, /sound, /speech, /text-to-speech, /voice, /sts, /stt) | **404** |
| ToS | https://www.designarena.ai/terms-and-conditions ("Last Updated: June 7, 2026") | 200 (`/terms`, `/tos` = 404) |
| Privacy | https://www.designarena.ai/privacy-policy | 200 |
| robots.txt | https://www.designarena.ai/robots.txt → `Disallow: /api/`, `Disallow: /admin/` | 200 |

### Endpoints + params (from docs; NOT verified live — no key)

All `GET`, no query parameters documented (no limit / date / as-of / pagination / filter).

| Method | Path | Purpose | CDN cache (docs) |
|---|---|---|---|
| GET | `/arenas` | list arenas + categories + pre-built `leaderboardUrl`s | `public, s-maxage=3600, stale-while-revalidate=7200` |
| GET | `/models` | every model with Elo/winRate/time nested `rankings[arena][category]` + tournament `rankingDistribution` — "recommended" one-call snapshot | `s-maxage=300, stale-while-revalidate=600` |
| GET | `/leaderboard/{arena}/{category}` | one board, sorted by Elo desc | `s-maxage=300, stale-while-revalidate=600` |

- `{arena}` enum: `models`, `builders`, `agents`. Docs say both slugs and display names (e.g. `Models Arena`, `Website`) are accepted as path params.
- Our four fronts → `GET /leaderboard/models/image`, `/leaderboard/models/video`, `/leaderboard/models/tts`, `/leaderboard/models/music`. Alternatively one `GET /models` and read `rankings.models.{image,video,tts,music}` (or display-name keys — see quirks).

### Auth header

`Authorization: Bearer sk_live_<key>` (OpenAPI `securitySchemes.BearerAuth: type http, scheme bearer`; keys "start with `sk_live_`"). No `x-api-key` variant documented.
Getting a key: free; apply at https://designarena.ai/developers/apply (name, email, optional org/website, use-case ≥20 chars, optional expected usage bucket: <10 / 10–100 / 100–500 / >500 requests/hour, mandatory attribution checkbox). Manual review, "usually 1-2 business days", key emailed.

Unauthenticated probe (2026-10-08, `curl -i`, with and without browser UA — identical): every path, including an invalid arena, returns
```
HTTP/1.1 401 Unauthorized
Cache-Control: no-store, max-age=0
Content-Type: application/json
Server: Vercel
X-Matched-Path: /api/v1/leaderboard/[arena]/[category]
{"success":false,"error":{"code":"MISSING_API_KEY","message":"Missing or invalid Authorization header. Use: Authorization: Bearer sk_live_..."}}
```
Auth is checked before arena/category validation (invalid arena also → 401). Hosted on Vercel.
Documented other errors: 400 `INVALID_ARENA` / `INVALID_CATEGORY`; 403 `INVALID_API_KEY` ("invalid or revoked"); 500 `FETCH_ERROR` / `INTERNAL_ERROR`. Envelope always `{success:false, error:{code, message}}`. (Quickstart table says 401 = "missing or invalid"; Overview says 401 = missing, 403 = invalid — minor docs inconsistency.)

### Rate limits

None enforced ("We do not currently enforce strict rate limits, but please be reasonable"); keys can be revoked for abuse. Responses are CDN-cached 5 min (leaderboard/models) / 1 h (arenas), so polling faster than that is pointless. Our need (≈4–5 calls/month, or 1 `/models` call) is trivially within the "<10 requests/hour" bucket.

### Response schema

`GET /leaderboard/{arena}/{category}` → `LeaderboardResponse`

| Field | Type | Notes |
|---|---|---|
| `success` | boolean | |
| `data[]` | array | sorted by `elo` desc |
| `data[].displayName` | string | human name, e.g. "Claude Opus 4.6" |
| `data[].provider` | string | docs example lowercase ("anthropic"); site shows "OpenAI" — casing unverified |
| `data[].openRouterId` | string \| null | null for image/video/audio generators |
| `data[].winRate` | number | percent 0–100 |
| `data[].elo` | integer | Bradley-Terry "Elo", base 1200 |
| `data[].avgGenerationTimeMs` | integer \| null | |
| `meta.arena` | string | slug (`models`) in MDX docs; display name (`Models Arena`) in OpenAPI |
| `meta.category` | string | slug (`website`) vs display name (`Website`) — same split |
| `meta.lastUpdated` | string (date-time) \| null | when the board was last recalculated |
| `timestamp` | string (date-time) | response generation time |

NOT in the public schema (but shown on the website): battles / wins / losses, ±standard error, rank. No stable model `id` on the leaderboard endpoint (only `/models` has `id`).

`GET /models` → `data[]` of `{ id (string, "stable across updates"), displayName, provider, openRouterId, rankings: { [arena]: { [category]: { elo:int, winRate:number, avgGenerationTimeMs:int|null } } }, rankingDistribution: { first, second, third, fourth, total : int } }`, `meta.lastUpdated` (date-time|null), `timestamp`. Only arena/category pairs with "sufficient data" appear.

`GET /arenas` → `data[]` of `{ id, name, description, categories:[{id,name}], leaderboardUrl:[{category,url}] }`, `timestamp`.

Docs example (leaderboard, verbatim; **docs example, not live data**; saved as fixture `pipeline/test/fixtures/designarena/docs-example.json`):
```json
{
  "success": true,
  "data": [
    { "displayName": "Claude Opus 4.6", "provider": "anthropic", "openRouterId": "anthropic/claude-opus-4.6", "winRate": 63.0, "elo": 1390, "avgGenerationTimeMs": 122828 },
    { "displayName": "GPT-5.1 Codex", "provider": "openai", "openRouterId": "openai/gpt-5.1-codex", "winRate": 60.5, "elo": 1298, "avgGenerationTimeMs": 88348 },
    { "displayName": "v0-1.5-lg", "provider": "vercel", "openRouterId": null, "winRate": 60.0, "elo": 1280, "avgGenerationTimeMs": 45000 }
  ],
  "meta": { "arena": "models", "category": "website", "lastUpdated": "2026-02-22T04:00:06.216429+00:00" },
  "timestamp": "2026-02-22T04:51:46.841Z"
}
```
(The fixture file is the pretty-printed original with docs indentation; the block above is compacted for reading.) Other docs examples (arenas 200, models 200, leaderboard 400) saved only in scratch as `docs_example_*.json`. Note: the docs example is a *website* board with LLMs — there is no media-board example anywhere in the docs.

### Category names (exact)

API slug → display name, from the docs Overview table (the most complete list):

- **models** (Models Arena): `codecategories` → Code Categories, `website` → Website, `gamedev` → Game Dev, `3d` → 3D Design, `dataviz` → Data Visualization, `uicomponent` → UI Component, **`image` → Image**, `logo` → Logo, `graphicdesign` → Graphic Design, `svg` → SVG, `ascii` → ASCII Art, **`video` → Video**, `videotovideo` → Video Editing, `imagetovideo` → Image to Video, `multitovideo` → Multi to Video, `multimodaltovideo` → Multimodal to Video, `imagetoimage` → Image Editing, `slides` → Slides, **`tts` → Text-to-Speech**, `sts` → Voice Chat, **`music` → Music**, `conversation` → Conversation, `stt` → Speech-to-Text, `worldmodel` → World Model
- **builders** (Builders Arena): `website` → Website (arenas example also shows `mobile`)
- **agents** (Agents Arena): `agon_webapps` → Web Apps, `mobileapps` → Mobile Apps, `nativeapps` → Android Native, `fullstack` → Fullstack, `agentic_gamedev`, `agon_godot`, `agentic_3d`, `agon_slides`

Website URL slugs differ from API slugs: `/leaderboard/image-to-image` (imagetoimage), `/logos` (logo), `/svgs` (svg), `/3d-design` (3d), `/video-to-video` (videotovideo), `/image-to-video`, `/multi-to-video`, `/multimodal-to-video`, `/tts` (tts), `/audiorealismbench` (no API slug documented).

### Date semantics

**Current-only.** No date/as-of parameter, no history endpoint, no documented data dumps. `meta.lastUpdated` = last recalculation; `timestamp` = response time. Docs contradict on freshness: Overview says rankings update "in real-time throughout the day"; `/models` page says Elo/winRate are recalculated "typically every few hours" and tournament distributions daily. Elo appears to be computed over all historical battles (cumulative), not a rolling window — **unverified**.
No vote dumps found either: GitHub org https://github.com/Design-Arena (`audio-arena-bench`, `audio-agent-bench` are a separate speech-to-speech agent benchmark) and Hugging Face `arcada-labs` (LeWitt-Bench, speech-to-speech test sets) hold no arena votes or leaderboard history (helper-agent finding, not independently re-checked).
Implication for AI WAR: monthly strength must come from our own monthly snapshots (fetch once per month, persist `meta.lastUpdated` + our fetch time). No backfill possible via the API. The website is client-rendered (data comes from an internal `POST /api/leaderboard`), so Wayback captures do not contain board data (checked: archived HTML holds only i18n/UI strings) — no historical backfill there either.

### Public website / scraping (observed only — do not rely on it)

- Pages are Next.js App Router (RSC `self.__next_f`, no `__NEXT_DATA__`). Server HTML contains no rankings.
- In a normal browser session the board page calls internal `GET /api/registry` and several `POST https://www.designarena.ai/api/leaderboard` (no auth needed in-browser). The response observed in the browser's network panel had shape `{success, arenaType, category, data:[{modelId, wins, losses, battles, winRate, elo, btStdErr, avgGenerationTimeMs}]}` — richer than the public API (battles + std-error) but `modelId`s include codenames (e.g. `carillon_2`, `babylon`, `chestnut`, `aurora`, `mantis`) mapped to names only client-side.
- **Not usable**: robots.txt disallows `/api/`; ToS §8 forbids accessing/downloading content with "spiders, robots, crawlers, data mining tools", forbids accessing "non-public areas" and reverse-engineering. Use the keyed public API only.
- **Disclosure:** during this recon a helper agent did call the internal endpoints directly with curl (one `GET /api/registry`, ~8 `POST /api/leaderboard` calls for audio categories, plus downloading a few JS chunks). That was a small one-off, but it goes against the robots/ToS guidance above. Raw output is in `scratchpad/recon-media/designarena/websearch/` (`registry.json`, `lb_*.json`). Use it only as a recon hint. The pipeline must not repeat these calls or depend on them.
- Third-party historical captures exist (e.g. benchmarklist.com captured the TTS board on 2026-09-02, with Gemini 3.1 Flash TTS #1 at 1459, per the helper agent). These are not an official history source.

### Naming quirks

1. **Slug vs display-name drift in docs**: MDX docs show `id: "models"`, `meta.arena: "models"`, `rankings.models.website`; the OpenAPI examples show `id: "Models Arena"`, `meta.arena: "Models Arena"`, `rankings["Models Arena"]["Code Categories"]`, and the Overview says "The API returns **display names**". Parser must accept both (map `Image`/`image`, `Text-to-Speech`/`tts`, `Music`/`music`, `Video`/`video`).
2. `/arenas` docs example lists only 14 Models categories (no tts/music); the leaderboard page lists 23; Overview lists 24 (+`worldmodel`). Discover via `/arenas` at runtime.
3. `displayName` is inconsistent: some carry a vendor prefix ("Google Gemini 3.1 Flash TTS", "OpenAI GPT-4o Mini TTS"), others not ("Eleven v3", "Grok TTS"); nicknames in parentheses ("Gemini 3.1 Flash Image Gen 2K (Nano Banana 2)"); resolution / quality / preview variants listed separately ("…Gen 2K" vs "…Gen", "Imagen 4 Ultra Generate Preview 06-06" vs "…Generate 001", "p-image-ideogram (high|low|medium|very high|very_low)", "P-Video-2-Pro (Cost|Quality|Speed)").
4. Same displayName on different boards = different models: "Grok Imagine" is on Image (#30) and Video (#15).
5. `provider` can be the *host*, not the maker: "MiniMax H3 Max" → provider "Fal" (video boards). Family mapping should key on displayName patterns, not `provider`.
6. Website "All Models" filter hides routers/agents (e.g. Sourceful "Riverflow 2.5 Pro" Elo 1366 is in the image data but not in the default view); the API may include them — decide whether to exclude non-model entries.
7. `openRouterId` is null for essentially all media models (no cross-ref value for us).
8. Public API lacks battle counts / CI → cannot down-weight thin entries (e.g. "Eleven v4" had ~580 battles vs ~32k for GPT-4o Mini TTS) unless an undocumented field exists.

### Licence / credit terms — verdict

- Docs (https://docs.designarena.ai/introduction, "License & Attribution"): data is free for personal **and commercial** projects. Attribution **required** when displayed publicly: (1) credit **Design Arena** as the source; (2) give "a visible link to designarena.ai". Applying for a key = agreeing to this.
- Apply form checkbox (https://designarena.ai/developers/apply): when displaying API data publicly in "dashboards, articles, applications, or any other format", credit Design Arena and include a visible link to designarena.ai. Submitting also accepts the ToS + Privacy Policy.
- Site FAQ ("Can I use these model evaluation scores in my own project?"): "Absolutely! Apply for API access at docs.designarena.ai".
- ToS (https://www.designarena.ai/terms-and-conditions, last updated 2026-06-07, Arcada Labs): prohibits crawlers/scrapers/data-mining tools; mirroring/framing site elements or using Arcada names/logos/trademarks without written consent; using the Services "for any commercial purpose … in any manner not permitted by these Terms"; reverse engineering. No API-specific clause on caching, storing snapshots or redistributing raw data was found (neither in docs nor ToS) — **open question**.
- **Verdict: GREEN via API key + attribution** (text credit "Data: Design Arena" + visible hyperlink to https://designarena.ai on every page/view that shows the data; avoid using their logo). **RED for scraping the website.** Storing monthly snapshots for our own computation seems consistent with the docs' "free to use" but is not explicitly addressed; publishing raw tables should keep the credit+link.

### Model lists per board (website, observed in a normal browser on 2026-10-08)

Full ranked lists with Elo saved in `observed_*_2026-10-08.txt`. Exact display strings below (Elo in brackets).

**Image** — https://www.designarena.ai/leaderboard/image ("Updated Oct 8, 2026, 7:09 PM GMT+9", 81 models in "All Models"):
- OpenAI: "GPT-Image-2.5 Sunburst" [1403, #1], "GPT-Image-2.5 Flare" [1381], "GPT Image 2" [1365], "GPT-Image-1.5" [1284], "GPT-Image-1" [1191], "GPT-Image-1 Mini" [1183], "DALL·E 3" [1068]
- Google (Nano Banana / Imagen): "Gemini 3.1 Flash Image Gen 2K (Nano Banana 2)" [1276], "Gemini 3.1 Flash Image Gen (Nano Banana 2)" [1268], "Gemini 3 Pro Image Gen 2K (Nano Banana Pro)" [1243], "Gemini 3.1 Flash Lite Image (Nano Banana 2 Lite)" [1238], "Gemini 3 Pro Image Preview" [1216], "Gemini 2.5 Flash Image Gen (Nano Banana)" [1186], "Gemini 2.5 Flash Image (Nano Banana)" [1178], "Gemini 2.0 Flash Image Gen (Preview)" [1050], "Imagen 4 Ultra Generate Preview 06-06" [1192], "Imagen 4 Ultra Generate 001" [1185], "Imagen 4 Generate Preview 06-06" [1176], "Imagen 4 Generate 001" [1167], "Imagen 3 Generate 002" [1156], "Imagen 4 Fast Generate 001" [1070]. ("Nano Banana 2.1" listed on /models as added Oct 6 but no Elo yet.)
- BFL FLUX: "FLUX.2 [flex]" [1200], "FLUX.2 [pro]" [1195], "FLUX.1 Kontext Max" [1154], "FLUX.2 [dev]" [1127], "FLUX.1 Kontext Pro" [1115], "FLUX.2 Klein 9B" [1110], "FLUX.1 [pro] Ultra" [1077], "FLUX.2 Klein 4B Distilled" [1063], "FLUX.2 Klein 4B" [1062], "FLUX.1 Krea Dev" [1032]. ("FLUX 3 Image" on /models, no Elo yet.)
- ByteDance Seedream: "Seedream 5.0 Pro" [1271], "Seedream Lite 5.0" [1201], "Seedream 4.0" [1182]
- Ideogram: "Ideogram 4.0" [1227], "Ideogram 3.0" [1094] (+ Pruna "p-image-ideogram (…)" variants)
- Recraft: "Recraft V4.1 Utility Pro" [1194], "Recraft V4.1 Pro" [1163], "Recraft V4 Pro" [1162], "Recraft V4.1" [1146], "Recraft V4.1 Flash" [1103], "Recraft V3" [1102]
- Others top-20: "Reve 2.1" [1323], "MAI-Image-2.6" [1318], "Reve 2.0" [1311], "Grok Imagine Image 2 Medium" [1311], "MAI-Image-2.6 Flash" [1306], "Grok Imagine Image 2 Auto" [1289], "Muse Image" (Meta) [1265], "Qwen Image 3 Pro" [1260], "MAI-Image-2.5" [1226], "UNI-1.1 Max" (Luma) [1224]
- **Midjourney: absent** (no Midjourney provider on /models either).

**Video** — https://www.designarena.ai/leaderboard/video (text-to-video; "Updated Oct 8, 2026, 7:28 PM GMT+9", 47 models):
- Top: "Gemini Omni 1.1 Flash" [1372, #1], "Gemini Omni Flash" [1356], "Wan 3.0" [1336], "P-Video-2-Pro (Cost)" [1321], "P-Video-2-Pro (Quality)" [1304], "FLUX 3 Video" [1295], "MiniMax H3" [1288], "MiniMax H3 Max" [1286]
- Veo: "Veo 3 Fast" [1192], "Veo 3.1 Lite" [1186], "Veo 3.1 Fast" [1179], "Veo 3.1" [1177], "Veo 3" [1161]
- Sora: "Sora 2" [1151], "Sora 2 Pro" [1150]
- Kling: "Kling v3 Pro" [1175], "Kling O3 (Omni)" [1137], "Kling v2.6 Pro" [1101], "Kling v2.5 Turbo Pro" [1085]
- Hailuo/MiniMax: "MiniMax Hailuo-2.3 (Pro)" [1084], "MiniMax Hailuo-2.3 (Standard)" [1077] (+ "MiniMax H3", "MiniMax H3 Max")
- Luma Ray: "Ray 3.2" [1104], "Ray 3.14" [1101], "Ray 2" [946], "Ray 2 Flash" [932]
- Wan: "Wan 3.0" [1336], "Wan 2.7" [1175]; Alibaba "Happy Horse 1.1" [1237], "Happy Horse 1.0" [1221]
- Seedance: "Seedance 2.5" [1269], "Seedance 2.0" [1264], "Seedance 2.0 Mini" [1263], "Seedance 2.0 Fast" [1261], "Seedance 1.5 Pro" [1111], "Seedance 1.0 Pro Fast" [1028]
- Grok: "Grok Imagine" [1231]
- **Runway: absent from Video**; present only on Video Editing (`videotovideo`): "Aleph 2.0" [1226], "Gen-4 Aleph" [1133].

**TTS** — https://www.designarena.ai/leaderboard/tts ("Updated Oct 8, 2026, 7:24 PM GMT+9", 33 models):
"Google Gemini 3.8 Flash TTS" [1441, #1], "Google Gemini 3.1 Flash TTS" [1432], "Google Gemini 2.5 Pro TTS" [1388], "Eleven v4 Turbo" [1348], "Google Gemini 2.5 Flash TTS" [1346], "Eleven v4" [1339], "Eleven v3" [1265], "Grok TTS" [1229], "OpenAI GPT Realtime 2" [1213], "OpenAI GPT-4o Mini TTS" [1196], "OpenAI GPT Realtime 2.1" [1183], "MAI-Voice-2" [1165], "Hume Octave 2" [1146], "Inworld TTS-1.5 Max" [1132], "MAI-Voice-2-Flash" [1127], "Cartesia Sonic 3.5" [1126], "Lightning v3.1 Pro" [1124], "MiniMax Speech-2.5 Turbo" [1118], "MiniMax Speech-02 HD" [1103], "Speech 2.6" (Hithink) [1085], "Murf AI Gen2" [1079], "Lightning v3.1" [1073], "Kalpa TTS Beta V0.1" [1018], "Qwen3 TTS Flash" [1017], "Kokoro TTS" [1016], "Voxtral Mini TTS (2603)" [998], "Deepgram Aura v2" [991], "Murf Falcon 2" [978], "Amazon Polly" [965], "Silk Mulberry 1.5" [959], "Maya1" [945], "Chatterbox" [934], "Magpie TTS Multilingual" [885].
Changelog dates (helper agent, https://www.designarena.ai/changelog): "Google Gemini 3.8 Flash TTS" added 2026-09-24; "Eleven v4" / "Eleven v4 Turbo" added 2026-09-28. No ElevenLabs Flash model is on the board.
Separate expert-panel board "Audio Realism Bench" (`/leaderboard/audiorealismbench`, updated Sep 28, 2026; includes a human-recording anchor "Humanity"; top AI = "Freya TTS Adam V1"; methodology post https://notes.designarena.ai/audio-realism-benchmark-measuring-realism-in-audio-models/ dated 2026-08-04). It is not a documented API category, so don't mix it with `tts`.

**Music** — **no public music leaderboard exists (2026-10-08).** Evidence:
- `/leaderboard/music` = 404; not in nav, footer, sitemap, or the Audio tab (`/leaderboard?tab=audio` shows only Audio Realism Bench, Text-to-Speech, Speech-to-Speech). No blog/X/news/changelog mention of a music arena was found (WebSearch + https://www.designarena.ai/changelog, by helper agent).
- The site's JS defines a `music` category ("Music Arena", 2 models per battle) but it is unlinked.
- Site's internal model registry (`/api/registry`, see caveat below) lists exactly **3** active music-arena models: "Stable Audio 2.5" (id `stable_audio_25`, provider `fal`), "Google Lyria-002" (`google_lyria`), "ElevenLabs Music v1" (`elevenlabs_music_v1`). The internal leaderboard response for `category: music` was `{"data":[],"metadata":null}` (2026-10-08T11:31Z) → no ranked data.
- **Suno: absent. Udio: absent.** Also absent: MiniMax Music, Mureka, ACE-Step, Riffusion/Producer.ai, Lyria 2/3/RealTime (only "Lyria-002"). Searched registry, site JS, /models providers, changelog.
- Verdict: `designarena-music` currently has **no usable data**; expect the keyed `GET /leaderboard/models/music` to return empty `data[]` (unverified until we have a key). Do not plan on Design Arena for the music front; keep the source ID but mark it "dormant".
- Related empty categories (same internal check): `stt`, `sts` empty; `conversation` empty (last updated 2026-04-13).

### Surprises

- `music` is a documented API category, but the public site has no music board. The /models catalogue has no music modality in its filters (Audio = Text to Speech (38) + Speech to Speech (1)). None of the ~66 providers listed on https://www.designarena.ai/models makes music models (no Suno, Udio, Mureka or Riffusion/Producer). Three music models (Stable Audio 2.5, Google Lyria-002, ElevenLabs Music v1) exist only in the internal registry, with zero ranked data. The Dec-2025 archived `/leaderboard/audio` page described audio as "conversation, text-to-speech, and speech-to-text", with no mention of music.
- Stable Audio 2.5 is listed with provider `fal` (the host), not Stability AI.
- Docs (Feb–Mar 2026 examples) are stale vs the live site (Oct 2026); OpenAPI and MDX examples disagree on slug vs display-name keys.
- TTS board is Google-dominated; ElevenLabs' newest "Eleven v4"/"v4 Turbo" were added Sep 28, 2026 with <600 battles each.
- The website shows richer stats (W/L, ±SE) than the public API schema exposes.

### Open questions to resolve once we have a key

1. Does `GET /leaderboard/models/music` return an empty `data[]` (expected), `INVALID_CATEGORY`, or data? Does `/models` contain any `music` keys? Re-check every month: if Stable Audio 2.5, Lyria-002 and ElevenLabs Music v1 start getting ranked, the music front becomes live (still without Suno or Udio).
2. Do live responses use slugs or display names in `meta.*`, `/arenas` ids and `/models` `rankings` keys?
3. Is `provider` lowercase-slug or display-cased? Is `/models[].id` a public slug or an internal codename (`chestnut`, `aurora`, …)?
4. Are routers/agents (e.g. Riverflow) included in `models/image`? Any undocumented fields (battles, wins, losses, stdErr)?
5. Exact cadence of `meta.lastUpdated` changes (hourly? every few hours?) — pick a monthly fetch day/time and record it.
6. Confirm by email (contact@designarena.ai) whether storing/republishing monthly snapshots (derived "strength" scores + credit/link) is fine — not explicitly covered.
7. Does the API expose `audiorealismbench` or `imagetovideo` boards we might want as secondary signals?

---

## Product family → exact model-name patterns per source

These are JavaScript regexes, case-sensitive unless they end in `i`, applied to these fields:
- **Arena**: `model_name`, scoped to the subset
- **Design Arena**: `displayName`, as shown on the public website on 2026-10-08. API strings are not verified, since we have no key.
- **VBench**: `Model Name (clickable)` after stripping the markdown link
- **TTS Arena**: `id`
- **Music Arena**: `system_a` / `system_b`
- **GenAI-Arena**: `Model`

"—" means the family is absent from that source. Always map by name, never by `organization` or `provider`. Arena's organization field and Design Arena's provider field both proved unreliable.

### Image front
| Family | Arena `text_to_image` / `image_edit` | Design Arena `image` | GenAI-Arena t2i |
|---|---|---|---|
| OpenAI (GPT Image / DALL·E) | `/^(dall-e-3\|gpt-image-\|chatgpt-image-)/` (dall-e-3 is t2i only; chatgpt-image-latest… is edit only) | `/^(GPT[- ]Image\|DALL·E)/` | — |
| Google (Imagen / Nano Banana / Gemini image) | `/^(imagen-\|gemini-.*image\|gemini-nano-banana)/` | `/^(Imagen \|Gemini .*Image\|Nano Banana)/` | — |
| FLUX (BFL) | `/^flux-/` | `/^FLUX/` (exclude `FLUX 3 Video` on the video board) | `/^(FLUX\.1-\|FLUX1\|FluxTimestep$)/` |
| ByteDance Seedream | `/^(seedream-\|seededit-)/` (exclude `bagel`) | `/^Seedream/` | (`SDXL-Lightning` is a ByteDance SD distillation, not Seedream) |
| Ideogram | `/^ideogram-/` | `/^Ideogram/` (exclude Pruna `p-image-ideogram (…)`) | — |
| Recraft | `/^recraft-/` (t2i only) | `/^Recraft/` | — |
| Midjourney | — (absent from all history) | — | — (`OpenJourney` is an SD fine-tune, not Midjourney) |
| xAI Grok Imagine (image) | `/^grok-imagine-image/` | `/^Grok Imagine( Image)?/` (plain "Grok Imagine" appears on both image and video boards) | — |
| Microsoft MAI-Image | `/^mai-image-/` | `/^MAI-Image/` | — |
| Reve | `/^reve-/` | `/^Reve /` | — |
| Alibaba Qwen-Image / Wan image | `/^(qwen-image\|z-image)/`, `/^wan/` | `/^Qwen Image/` | — |
| Luma (Photon / UNI) | `/^(photon\|uni-1)/` | `/^UNI-/` | — |
| Stability (SD) | `/^stable-diffusion/` | not checked | `/^(SD3\|SDXL\|StableCascade)/` |
| Playground | — | not checked | `/^Play[Gg]round/` |

I checked the Arena regexes above against every `model_name` in the image subsets. Each one matches only its own organization, and no name matches two families.

Still unmatched, so they need their own unit or an explicit drop:
- `runway-gen4` (Runway image)
- `kling-image-o1` (Kling image)
- `muse-image` (Meta)
- `hunyuan-image-3.0`, `hunyuan-image-3.0-instruct` (Tencent)
- `krea-2-*`
- `lucid-origin` (Leonardo)
- `hidream-o1-image`
- `glm-image` (Z.ai)
- `Cosmos3-Super-Text2Image*` (NVIDIA)
- `p-image*` (Pruna)
- `bagel`
- `step1x-edit`

### Video front
| Family | Arena `text_to_video` / `image_to_video` | Design Arena `video` | VBench (T2V `VBench 1.0` tab; others noted) | GenAI-Arena video |
|---|---|---|---|---|
| Google Veo | `/^veo-/` | `/^Veo /` | `/^Veo\b/` (`Veo 3`) | — |
| Google Gemini Omni (unit decision needed) | `/^gemini-omni-/` | `/^Gemini Omni/` | — | — |
| OpenAI Sora | `/^sora(-\|$)/` (t2v only) | `/^Sora /` | `/^Sora(\b\|-)/`. **Not** `Open-Sora`/`OpenSora*` | — (`OpenSora` is hpcaitech) |
| Kling | `/^kling-/` | `/^Kling /` | `/^Kling\b/` | — |
| Runway | `/^runway-/` (t2v `runway-gen-4.5`, i2v `runway-gen4-turbo`; t2i has `runway-gen4`) | — on `video`; `/Aleph/` on `videotovideo` | `/^Gen-[234]/` (Gen-4 is I2V tab only) | — |
| MiniMax Hailuo | `/^(hailuo-\|minimax-)/` | `/^MiniMax (Hailuo\|H3)/` (provider may be "Fal") | `/^MiniMax-Video/` | — |
| Luma Ray | `/^ray-?\d/` (`ray2`, `ray-3`) | `/^Ray \d/` | `/^Luma$/` | — |
| Alibaba Wan | `/^wan/` (`wan-v2.2-a14b`, `wan2.5-t2v-preview`, `wan3.0`, …) | `/^Wan \d/` (`Happy Horse` is listed as Alibaba on Design Arena; on Arena `happyhorse-1.0` has org `aorizon`) | `/^Wan2/` | — |
| ByteDance Seedance | `/^(dreamina-)?seedance-/` | `/^Seedance /` | VBench-2.0 tab only: `/^Seedance/` (`Jimeng` in T2V; mapping unverified) | — |
| xAI Grok Imagine (video) | `/^grok-imagine-video/` | `/^Grok Imagine$/` (video board) | — | — |
| BFL FLUX video | `/^flux-3-video/` | `/^FLUX 3 Video/` | — | — |
| Pika | `/^pika-/` | not seen | `/^Pika/` | — |
| Shengshu Vidu | `/^vidu-/` (i2v) | not checked | `/^Vidu/` | — |
| Tencent Hunyuan | `/^hunyuan-video/` | not checked | `/^Hunyuan ?Video/` | — |
| CogVideoX (Zhipu) | — | — | `/^CogVideo/` | `/^CogVideoX/` |

I checked the Arena regexes the same way for the video subsets: no double matches. Still unmatched:
- `happyhorse-1.0` (org `aorizon`; Design Arena lists "Happy Horse" under Alibaba)
- `muse-video` (Meta)
- `kandinsky-5.0-t2v-*`
- `ltx-2-19b`
- `mochi-v1`
- `p-video`
- `pixverse-v5.6`
- `hidream-o1-video-1.0`

### Speech (TTS) front
| Family | TTS Arena `id` | Design Arena `tts` `displayName` |
|---|---|---|
| ElevenLabs | `/^eleven-/` (`eleven-flash-v2.5`, `eleven-turbo-v2.5`, `eleven-multilingual-v2`, `eleven-v3`) | `/^Eleven /` (`Eleven v3`, `Eleven v4`, `Eleven v4 Turbo`) |
| OpenAI | — | `/^OpenAI GPT/` (`OpenAI GPT-4o Mini TTS`, `OpenAI GPT Realtime 2`, `… 2.1`) |
| Google | — | `/^Google Gemini .*TTS/` (`Google Gemini 3.8 Flash TTS` #1, `3.1 Flash`, `2.5 Pro`, `2.5 Flash`) |
| MiniMax | `/^minimax-speech-/` | `/^MiniMax Speech/` |
| Cartesia | `/^cartesia-/` (`cartesia-sonic-2`) | `/^Cartesia Sonic/` |
| Hume | `/^hume-/` (`hume-octave`) | `/^Hume Octave/` |
| Inworld | `/^inworld/` (`inworld`, `inworld-max`, `inworld-max-1.5`) | `/^Inworld/` |
| Fish Audio | `/^lanternfish-/` (names `OpenAudio S1/S2`) | not seen |
| Kokoro | `/^kokoro-/` | `/^Kokoro/` |
| Microsoft MAI-Voice | — | `/^MAI-Voice/` |
| xAI | — | `/^Grok TTS/` |
| Resemble (Chatterbox) | `/^chatterbox$/` | `/^Chatterbox$/` |
| smallest.ai Lightning | `/^lightning-/` | `/^Lightning v/` |
| Stealth/codenames (exclude or "unknown") | `luck-dolphin` (Aurora), `star-june-2026`, `parmesan`; `async-1` = CastleFlow | — |

### Music front
| Family | Music Arena system key | Design Arena `music` |
|---|---|---|
| Suno | — | — |
| Udio | — | — |
| ElevenLabs Music | `/^elevenlabs-music-/` | registered only: `ElevenLabs Music v1`, no ranked data |
| Google Lyria | `/^lyria-/` (`lyria-3-30s`, `lyria-3-pro-preview`) | registered only: `Google Lyria-002` |
| Google Magenta RT (open) | `/^magenta-rt-/` | — |
| Stability Stable Audio | `/^(sao(-small)?\|sa3-.*\|sa2)$/` | registered only: `Stable Audio 2.5` |
| Meta MusicGen | `/^musicgen-/` | — |
| Riffusion / Producer.ai | `/^riffusion-/` | — |
| Sonauto | `/^sonauto-/` | — |
| ACE-Step | `/^acestep/` | — |
| MiniMax Music | registry only (`minimax-music-2-6`, `minimax-music-3-0`), with no votes through 2026-07 | — |
| Anonymous previews (exclude) | `/^preview-/` | — |

The Design Arena music facts in this table come from the internal-endpoint calls disclosed above. Verify them with the keyed API.
