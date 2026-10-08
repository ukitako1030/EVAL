// Page-side script for `shoot.mjs --eval-file scripts/flash-run.js` (dev server, page opened with ?debugFlash):
// plays the timeline from the page's current month to FLASH_RUN_TO (default 2025-12) at 4× with the real playback
// clock (holds on event months) and banner queue, fires `__battle.shockwave(unit)` whenever a banner of the focused
// front starts (what Task 15's wiring will do), then hammers the budget with a burst of shockwaves. Returns at once;
// progress and the summary go to the console (`--console`), totals stay on window.__flashStats.
void (async () => {
  const { createPlayback } = await import('/src/playback/clock.ts');
  const { holdCounts, selectEvents, createBannerQueue } = await import('/src/events/queue.ts');
  const world = window.__world;
  const store = window.__store;
  const battle = window.__battle;
  const stats = window.__flashStats;
  if (!world || !store || !battle || !stats) throw new Error('flash-run needs the dev server and ?debugFlash');
  const front = store.get().front ?? 'general';
  const to = world.months.indexOf(window.FLASH_RUN_TO ?? '2025-12');
  const from = Math.floor(store.get().t);
  const playback = createPlayback({ lastIndex: to, eventMonths: holdCounts(world, front) });
  const queue = createBannerQueue({ maxVisible: 2, seconds: 4, maxPending: 6, stagger: 0.35 });
  let st = { t: from, playing: true, speed: 4 };
  store.set({ t: from, speed: 4, playing: true });
  const started = new Set();
  let banners = 0;
  let shocks = 0;
  let quiet = 0;
  const t0 = performance.now();
  let last = t0;
  await new Promise((resolve) => {
    const frame = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      const r = playback.tick(dt, st);
      st = { t: r.t, playing: r.playing, speed: 4 };
      store.set({ t: r.t, playing: r.playing });
      for (const m of r.crossed) queue.push(selectEvents(world, m, front));
      let any = false;
      for (const b of queue.update(now / 1000)) {
        any = true;
        if (started.has(b.key)) continue;
        started.add(b.key);
        banners++;
        if (battle.shockwave(b.event.unit)) shocks++;
        console.log(`[run] ${b.event.month} banner: ${b.event.unit} (${b.event.type})`);
      }
      quiet = any || r.playing ? 0 : quiet + dt;
      if (quiet < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  const run = { seconds: +((performance.now() - t0) / 1000).toFixed(1), banners, shockwaves: shocks, granted: stats.granted, denied: stats.denied, maxPerSecond: stats.maxPerSecond };
  console.log(`[run] playback ${world.months[from]}→${world.months[to]} at 4× done: ${JSON.stringify(run)}`);
  // stress: 12 shockwave requests within ~1.1 s — the budget must still grant at most 3 in any second
  const before = stats.granted;
  const ids = Object.keys(world.units[front]);
  for (let k = 0; k < 12; k++) {
    battle.shockwave(ids[k % ids.length]);
    await new Promise((r) => setTimeout(r, 90));
  }
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`[run] stress: 12 shockwaves in 1.1 s → ${stats.granted - before} granted · max flashes in any 1 s over the whole run: ${stats.maxPerSecond}`);
  window.__flashRun = { ...run, stressGranted: stats.granted - before, maxPerSecond: stats.maxPerSecond };
})().catch((e) => console.error('flash-run failed', e));
'flash-run started';
