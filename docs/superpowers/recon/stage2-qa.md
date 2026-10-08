# Stage 2 visual QA (Task 16) — 2026-10-09

Production build (`npm run build` + `vite preview`), headless Chrome 154 on an RTX 4070 SUPER (ANGLE / D3D11), driven by
`site/scripts/shoot.mjs` (new: `--reduced-motion`, CDP `Emulation.setEmulatedMedia`). Data: `world.json` through
2026-10 (partial month). The final shots (56) are in the session scratchpad `shots9/`; the README screenshots in
`mockups/shots/site-*.jpg` were refreshed from them.

## Screenshots

| set | shots |
| --- | --- |
| galaxy, 1440×900 | `galaxy-{2023-03,2024-06,2025-03,2025-11,2026-10}` |
| galaxy, other sizes | `galaxy-2026-10` 1280×720 / 1920×1080, `galaxy-en` 1440×900 / 1280×720, `galaxy-en-2025-03` 1280×720 / 1920×1080, `galaxy-en-2023-03` |
| fronts zoomed at 2026-10, 1440×900 | `front-{general,code,agent,image,video,speech,music}`, `front-video-2023-03` (empty front) |
| fronts, other | `front-general` 1280×720 / 1920×1080, `front-{code,speech,agent}-en`, `front-code-en` 1280×720 |
| detail panel | `detail-general` 1440×900 / 1280×720 (mid-glide 3.2 s and settled 5 s), `detail-video-en` 1440×900 / 1920×1080 |
| org highlight | `hover-google` (galaxy), `hover-openai-general` (zoomed) |
| reduced motion | `rm-galaxy` 1440×900, `rm-general` 1440×900 / 390×844 |
| mobile 390×844 / 360×780 | `m-front-{general,image,speech}`, `m-front-music-en`, `m-map`, `m-map-en`, `m-sheet`, `m-sheet-en`, `m-front-video-2023-03` |
| data & method page | `methods-ja`, `methods-en` at 1440×900 and 390×844 |
| showcase | `best-galaxy-1920x1080`, `best-zoom-general-1440x900`, `best-zoom-video-1440x900`, `best-detail-general-1440x900`, `best-mobile-general-390x844` |

Every run: no console errors, exceptions, failed requests or warnings.

## fps

`--fps --fps-ms 6000`, auto quality (no `?quality` pin), before = d9bce65, after = this branch.

| scenario | before | after |
| --- | --- | --- |
| 1440×900 galaxy / zoomed general / general + detail panel | 59.8 / 59.8 / 59.8 | 59.8 / 59.8 / 59.8 |
| 390×844 zoomed general / bottom sheet open / galaxy map | 59.7 / 59.8 / 59.8 | 59.8 / 59.8 / 59.8 |
| 1440×900 zoomed general, `--cpu-throttle 4` (4 runs) | 35.1, 27.5, 33.9, 30.8 | 45.5, 29.3, 36.0, 32.9 |
| 1440×900 general + detail (backdrop blur), throttle 4 (3 runs) | 27.3, 31.7, 31.8 | 26.4, 38.3, 36.6 |
| 390×844 zoomed general, throttle 4 (4 runs) | 59.0, 54.6, 54.0, 54.1 | 55.4, 50.3, 59.2, 54.8 |

Unthrottled runs sit at the 60 Hz cap. Throttled runs are noisy (the quality governor steps down at different
moments); on average nothing got slower. No per-frame `Graphics.clear()` or allocations were added: the battle
reads the viewport once per frame, the fog fade only writes `alpha` when it changes, and the empty-front caption is
one `Text` made at start-up.

## Fixes

| before | after |
| --- | --- |
| Galaxy: code-front title under the HUD title box (fixed top inset 76, title box ends at 96; EN box is wider) | Desktop insets are measured from the HUD boxes (title, ranking panel, legend, timeline; `ResizeObserver` for language / font changes) plus `TITLE_ROOM` for the screen-size planet titles in the overview; small satellites drop the unreadable sub-title line |
| Galaxy: speech-front lead line under the legend; video-front title close to the timeline | bottom inset = above the legend (not just the timeline) |
| Detail panel: battle labels ghosting through it; the planet stays under the panel | Panel 0.95 opaque + `backdrop-filter: blur(12px)`; an open panel pushes the framed area right and the camera glides there (600 ms), as far as the frame stays landscape (no galaxy re-arrangement at 768–1023 px); narrow landscape frames cap the planet at 0.3 × width so the label columns fit; battle label columns stay inside the framed area on desktop |
| Zoomed: "最終更新 2026-10-08" over a neighbouring planet; tool buttons translucent over planets | dark backing + text-shadow on the meta line; tool buttons get a dark base under their cyan tint |
| Mobile bottom sheet: ranking rows ghost through (0.97) | sheet opaque, no blur (no cost on phones) |
| Breakdown table head "寄与" broke into one glyph per line | column heads `nowrap` |
| Zoomed battle: large estimated / mid-strength territories read as an empty dark planet (music, image, speech) | battle veil 0.72 → 0.5, the planet's fog thins by 45 % while zoomed; galaxy fog slightly lighter (veil 0.32 → 0.30, puffs 0.5 → 0.42) |
| Empty fronts (video before 2024): a bare dark sphere, "未参戦" trailing at the bottom of a huge empty mobile ranking box | "― 未参戦 ― / No units yet" caption on the zoomed planet; empty ranking styled as an idle sector (dashed frame, faint stripes), centred in the mobile list |
| Deployment matrix cut mid-row at the bottom of the ranking panel | its slot takes the panel's remaining height: the matrix scrolls and fades out at the edge |
| Neighbouring planets competing with the ranking text | HUD glass 0.82 → 0.86 |
| Timeline: month badge cut the year label ("202[2025.03]") | the covered year label fades out (desktop timeline) |

## Known limitations

- The overview is ~14 % smaller at 1440×900 than before (it now stays clear of the title box and the legend); at
  1280×720 it is noticeably compact.
- Mobile battle labels are placed over the planet's left edge (by design, no room beside it); with many units a
  label is occasionally skipped for a frame or two when swarm centroids cross.
- Speech (ElevenLabs) and video (Luma) use pale org colours, so those territories look grey rather than coloured.
- 768–1023 px windows with the detail panel open: the planet is only partly pushed out from under the panel.
- The mobile galaxy map shows the hub's territory names only when the hub is ≥ 95 px (not in EN at 390×844, nor at
  360×780).
