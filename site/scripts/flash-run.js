// Page-side script for `shoot.mjs --eval-file scripts/flash-run.js` (page opened with ?debugFlash; dev server or preview):
// drives the app's own timeline controls — speed to 4×, play — so the real playback clock (holds on news months),
// banner queue and battle shockwaves run, until playback stops at the end of the timeline (or window.FLASH_RUN_TO,
// e.g. '2025-12', is shown). Then, on the dev server only (window.__battle), hammers the budget with a burst of
// shockwaves. Returns at once; progress and the summary go to the console (`--console`), totals stay on
// window.__flashStats and the summary on window.__flashRun.
void (async () => {
  const stats = window.__flashStats;
  const speed = document.querySelector('.tl-speed');
  const play = document.querySelector('.tl-play');
  const month = document.querySelector('#hud-month');
  if (!stats || !speed || !play || !month) throw new Error('flash-run needs the app opened with ?debugFlash');
  const playing = () => play.textContent.includes('❚❚');
  const to = (window.FLASH_RUN_TO ?? '').replace('-', '.');
  for (let k = 0; k < 3 && speed.textContent.trim() !== '4×'; k++) speed.click();
  const from = month.textContent;
  if (!playing()) play.click();
  let banners = 0;
  const seen = new WeakSet();
  const watch = new MutationObserver(() => {
    for (const b of document.querySelectorAll('.banner:not(.banner-out)')) {
      if (seen.has(b)) continue;
      seen.add(b);
      banners++;
      console.log(`[run] ${month.textContent} banner: ${b.querySelector('.banner-text')?.textContent ?? ''}`);
    }
  });
  watch.observe(document.querySelector('#hud-banners') ?? document.body, { childList: true, subtree: true });
  const t0 = performance.now();
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      if (to && month.textContent === to && playing()) play.click();
      if (!playing() || performance.now() - t0 > 180000) {
        clearInterval(iv);
        resolve();
      }
    }, 100);
  });
  await new Promise((r) => setTimeout(r, 4500)); // let the last banners (and their shockwaves) play out
  watch.disconnect();
  const run = { from, to: month.textContent, seconds: +((performance.now() - t0) / 1000).toFixed(1), banners, granted: stats.granted, denied: stats.denied, maxPerSecond: stats.maxPerSecond };
  console.log(`[run] playback ${run.from}→${run.to} at 4× done: ${JSON.stringify(run)}`);
  window.__flashRun = run;
  const battle = window.__battle;
  if (!battle) return;
  // stress (dev server): 12 shockwave requests within ~1.1 s — the budget must still grant at most 3 in any second
  const before = stats.granted;
  const ids = [...document.querySelectorAll('.rank-row[data-unit]')].map((r) => r.dataset.unit);
  for (let k = 0; k < 12 && ids.length; k++) {
    battle.shockwave(ids[k % ids.length]);
    await new Promise((r) => setTimeout(r, 90));
  }
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`[run] stress: 12 shockwaves in 1.1 s → ${stats.granted - before} granted · max flashes in any 1 s over the whole run: ${stats.maxPerSecond}`);
  window.__flashRun = { ...run, stressGranted: stats.granted - before, maxPerSecond: stats.maxPerSecond };
})().catch((e) => console.error('flash-run failed', e));
'flash-run started';
