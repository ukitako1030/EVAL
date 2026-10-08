# First real data run (Task 33) — 2026-10-09

## Fetch
`npm run fetch -- --backfill`: 32 sources ok, 6 skipped (no key: Design Arena ×4, Cloudflare; OpenRouter ran keyless), 0 failed. Raw snapshots: 5.7 MB.

## Calibration (method.yaml)
Mean score of the units ranked 2–5 per month (2025-01 → 2026-10), measured groups only:

| source | before | after |
|---|---|---|
| general · arena-text (elo, unchanged) | 90.1 | 90.1 |
| general · epoch-eci | 66.5 (τ=8) | 84.2 (τ=18) |
| code · aider / swebench / terminalbench | 66 / 72 / 63 | 86 / 87 / 83 (percent.scale 0.4) |
| agent · metr | 36.5 (κ=1) | 76.1 (κ=0.25) |
| agent · osworld | 39.8 | 67.9 |
| agent · tau2 / vending / apex | 74 / 76 / 59 | 89 / 89 / 82 |

`percent.scale` (new, default 1) multiplies the logit gap so benchmarks whose top models are far apart don't dominate a front.

## Estimation rules changed after the first run
- **Strength gaps:** a unit keeps its last measured strength for up to 6 months (was: copy the nearest-scale unit — caused month-to-month zig-zags, e.g. Grok on the agent front).
- **Never-measured strength:** median of the month's measured strengths (was: nearest-scale neighbour, which let Midjourney inherit GPT Image's 100).
- **Missing scale:** units without base signals get `floorFactor × median` covered share (was: × minimum, which made GPT Image 0.7%).
- Added Wikipedia attention keys for products embedded in other apps: GPT Image (`DALL-E`), Seedream, Seedance.

## Sanity checks (general front, strength lead changes)
2024-03 Claude 3 Opus → 2024-04 GPT → 2025-03 Gemini 2.5 Pro → 2025-08 GPT-5 → 2025-11 Gemini 3 → 2026-02 Claude ↔ 2026-03 GPT → 2026-06 Claude. DeepSeek surges 2025-01 (R1). Claude 3.5 Sonnet ties GPT-4o in 2024-06/07 (inside the 1-point hysteresis, so no lead event). Matches public history.

Latest month (2026-10, partial): Claude 97 · GPT 93 · Gemini 86 (scale: GPT 54 %, Gemini 20 %, Claude 13 %).
Other fronts: code Claude; agent Claude; image GPT Image (scale Nano Banana 79 %); video Veo; speech MiniMax (scale ElevenLabs 79 %); music Lyria strongest measured, Suno 87 % of scale (strength estimated).

## Known limitations (for the methods page)
- Products embedded in other apps (GPT Image in ChatGPT, Nano Banana in Gemini, Seedream/Seedance in Doubao/Jimeng) have no clean usage signal; their scale rests on attention or shared hosts (`labs.google` is shared by Nano Banana and Veo).
- Suno/Udio/Midjourney have no public quality ranking under a usable licence → strength estimated (fog).
- Speech history before 2026-10 is estimated; TTS Arena has no OpenAI/Google entries. A Design Arena key fills this.
- OpenRouter history before 2026-08 needs `OPENROUTER_API_KEY` + `--backfill`.
- Music Arena's last snapshot is 2026-07-31; it ages out after 92 days.
