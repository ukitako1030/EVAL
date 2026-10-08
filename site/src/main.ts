/**
 * App wiring: data → store → playback / banners → shared frames → HUD + PixiJS renderer.
 *
 * One shared clock — the galaxy's animation clock (seconds of rendered frames since start) — drives the galaxy, the
 * org highlight, the battle, the banner queue and every flash-budget request, so the budget's "≤ 3 per second" is
 * measured on one timeline. Frames (`frontFrame` for every front) are computed once per animation frame and shared
 * by the galaxy (and through its planets the battle), the ranking and the deployment matrix.
 *
 * Below 768 px wide or in portrait orientation the HUD switches to the mobile layout (ui/mobile.ts, spec §8): one
 * front at a time, its swarm battle pinned inside the large planet, bloom off; the renderer insets follow the mobile
 * HUD (and an open bottom sheet) so the planet is never hidden.
 */
import './fonts';
import { createRenderer } from './render/app';
import { WebGLRequiredError } from './render/webgl';
import { createGalaxy } from './render/galaxy';
import { createFleets } from './render/fleets';
import { createHighlight } from './render/highlight';
import { createBattle } from './render/battle';
import { FONT_DISP, FONT_JP, FONT_UI } from './render/labels';
import { createQualityGovernor, type QualityLevel } from './fx/quality';
import { REDUCED_MOTION_FLASH, createFlashBudget, logFlashes, scaleGrants } from './fx/flashBudget';
import { tr } from './i18n/strings';
import { loadWorld } from './data/load';
import { createFrameSource, monthIndex } from './data/timeline';
import type { FrontId, Lang, World } from './data/types';
import { createStore, defaultState, type AppState } from './state/store';
import { decodeUrl } from './state/url';
import { nextSearch, syncUrl } from './state/urlSync';
import { initialPlayback, safeLocalStorage } from './state/intro';
import { HOLD_SECONDS, MAX_HOLD_SECONDS, createPlayback, newsAfterChange } from './playback/clock';
import { createBannerQueue, holdCounts, selectEvents } from './events/queue';
import { mountHud } from './ui/hud';
import { createRanking } from './ui/ranking';
import { createDeployment } from './ui/deployment';
import { createFrontTabs } from './ui/frontTabs';
import { createTimelineBar } from './ui/timelineBar';
import { createBanners } from './ui/banners';
import { createDetail } from './ui/detail';
import { createBackButton } from './ui/backButton';
import { createIntroCard, type IntroCard } from './ui/introCard';
import { showLoadError } from './ui/loadError';
import { createMobile, type Mobile, type OverlayHistory } from './ui/mobile';
import { holdOnScreen, layoutMode, viewportOf, type Insets } from './ui/mobileLayout';
import { createErrorLog } from './util/errorLog';

/** Banners stay up this long (s); the focused view shows one at a time, the galaxy two (one on phones). */
const BANNER_SECONDS = 4;
/** The mobile layout never renders above this quality level (1 = no bloom); the fps governor may still go lower. */
const MOBILE_QUALITY: QualityLevel = 1;
/**
 * Debug switches (`?quality`, `?hover`, `?debugFlash`) and the `window.__*` handles: the dev server, or a build made
 * with `VITE_DEBUG_HOOKS=1` (site/scripts/README.md). A production build ignores them and drops them from the address.
 */
const DEBUG = import.meta.env.DEV || import.meta.env.VITE_DEBUG_HOOKS === '1';
/** Camera glide when the framed area moves (a bottom sheet opens / closes), ms. */
const REFRAME_MS = 600;

const mount = document.getElementById('app');
if (mount) void boot(mount);

async function boot(mount: HTMLElement) {
  const params = new URLSearchParams(location.search);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  try {
    const fonts = loadFonts();
    const [renderer, world] = await Promise.all([createRenderer(mount, { reducedMotion: motion.matches }), loadWorld()]);
    const last = world.months.length - 1;
    // a shared link (with `t`) opens paused at its month and never plays the intro
    const store = createStore<AppState>({
      ...defaultState(last),
      ...initialPlayback(safeLocalStorage(), last, { sharedLink: params.has('t') }),
      ...decodeUrl(location.search, world),
      reducedMotion: motion.matches,
    });
    motion.addEventListener('change', (e) => store.set({ reducedMotion: e.matches }));

    // debug (dev server / debug build only): ?quality=0..3 pins the quality level (screenshot / fps harness);
    // otherwise the governor steps it down
    const q = DEBUG ? params.get('quality') : null;
    const pinnedQuality = q === '0' || q === '1' || q === '2' || q === '3';
    if (pinnedQuality) renderer.setQuality(Number(q) as QualityLevel);
    const compact = layoutMode(window.innerWidth, window.innerHeight) === 'mobile';
    if (compact && !pinnedQuality) renderer.setQuality(MOBILE_QUALITY); // no bloom from the first frame
    const governor = createQualityGovernor({ targetFps: compact ? 30 : 60, window: 2 });

    // every light flash goes through this budget; debug: ?debugFlash logs grants per second (window.__flashStats)
    const budget = createFlashBudget({ maxPerSecond: 3, maxIntensity: 0.35 });
    const flashLog = DEBUG && params.has('debugFlash') ? logFlashes(budget, { clock: () => performance.now() / 1000, log: (m) => console.log(m) }) : null;
    // reduced motion also means less light: every granted flash is dimmed here, in one place
    const flashes = scaleGrants(flashLog?.budget ?? budget, () => (store.get().reducedMotion ? REDUCED_MOTION_FLASH : 1));

    // wait briefly for the web fonts so the first labels render in the right face (refreshed if they arrive later)
    await Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]);
    const galaxy = createGalaxy(renderer, { world, store, flashes });
    const now = () => galaxy.time; // the shared clock
    const fleets = createFleets(galaxy, renderer, { world, store });
    const highlight = createHighlight(galaxy, { world, store, flashes, fleets });
    const battle = createBattle(renderer, galaxy, { store, flashes, now });
    const refreshText = () => {
      galaxy.refreshText();
      battle.refreshText();
    };
    void fonts.then(refreshText);
    preloadFontGlyphs(world).then(refreshText, () => undefined);

    // ---- HUD ----
    const frames = createFrameSource(world);
    const hud = mountHud(mount, store, world, { nativeShare: () => mobile.active });
    const ranking = createRanking(hud.slots.ranking, world, store, { frames });
    createDeployment(hud.slots.deployment, world, store, { frames });
    createFrontTabs(hud.slots.panel, world, store, { frames }); // desktop: the keyboard way into a front
    const timeline = createTimelineBar(hud.slots.timeline, world, store);
    const banners = createBanners(hud.slots.banners, world, store);
    const detail = createDetail(hud.slots.detail, world, store);
    createBackButton(hud.el, store);

    // ---- mobile layout (before anything reads `state.front`: it defaults the phone view to the general front) ----
    const pixiInput = renderer.app.renderer.events;
    const mobile: Mobile = createMobile(world, store, {
      hud,
      ranking,
      detail,
      stage: renderer.app.canvas,
      // a drag on the stage is a swipe, not a tap: keep PixiJS from turning its release into a unit / planet click
      suppressTaps: (on) => {
        pixiInput.features.click = !on;
      },
      history: overlayHistory(),
    });
    const pinnedFront = (s: AppState) => (mobile.active ? s.front : null);
    battle.setPinned(pinnedFront(store.get()));

    // ---- camera ----
    let insetsKey = '';
    /**
     * Keep the framed area clear of the HUD. `aim` re-targets the camera at the current front (a front change);
     * `animate` glides there, starting from where the planet is on screen now, so a moving frame does not jump.
     * Without either only the insets change (resize) and the camera follows the framed area on its own.
     */
    const reframe = (o: { aim: boolean; animate: boolean }) => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const ins = mobile.insets() ?? desktopInsets(W, H, hud.el, detail.el, store.get().front !== null);
      const k = [ins.top, ins.right, ins.bottom, ins.left].map((v) => v.toFixed(1)).join('|');
      if (k === insetsKey && !o.aim) return;
      insetsKey = k;
      const from = holdOnScreen(renderer.camera, renderer.viewport, viewportOf(ins, W, H));
      renderer.setInsets(ins);
      if (!o.aim && !o.animate) return;
      const target = galaxy.cameraTarget(store.get().front);
      renderer.focus(target, o.animate ? { from, durationMs: o.aim ? undefined : REFRAME_MS } : { instant: true });
    };
    reframe({ aim: false, animate: false });
    const onResize = () => {
      mobile.refresh();
      reframe({ aim: false, animate: false });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    // the desktop HUD boxes change size with the language (and web fonts): keep the framed area clear of them
    const hudRO = typeof ResizeObserver === 'function' ? new ResizeObserver(() => !mobile.active && reframe({ aim: false, animate: true })) : null;
    for (const sel of ['#hud-title', '#hud-legend', '#hud-panel', '#hud-timeline']) {
      const el = hud.el.querySelector(sel);
      if (el) hudRO?.observe(el);
    }
    timeline.setCompact(mobile.active);
    mobile.onLayout(() => {
      battle.setPinned(pinnedFront(store.get()));
      timeline.setCompact(mobile.active);
      reframe({ aim: false, animate: false });
    });
    renderer.focus(galaxy.cameraTarget(store.get().front), { instant: true });
    // a re-arranged galaxy (resize; on phones also the first frame, once the HUD insets apply) moves the target: a camera
    // move under way (the intro fly-in) is re-aimed, otherwise the camera follows at once
    galaxy.onLayoutChange(() => renderer.focus(galaxy.cameraTarget(store.get().front), { instant: true, retarget: true }));

    // ---- playback + battle news ----
    const playbackFor = (front: FrontId | null) => createPlayback({ lastIndex: last, eventMonths: holdCounts(world, front), maxHoldSeconds: MAX_HOLD_SECONDS });
    // a banner yields to waiting news after playback's per-banner hold, so the news keeps pace with the timeline
    const queueFor = (front: FrontId | null) =>
      createBannerQueue({ maxVisible: front || mobile.active ? 1 : 2, seconds: BANNER_SECONDS, maxPending: 6, stagger: 0.35, minSeconds: HOLD_SECONDS[store.get().speed] });
    let playback = playbackFor(store.get().front);
    let queue = queueFor(store.get().front);
    let ticking = false; // store writes from the playback tick (anything else moving `t` is the user)
    const started = new Set<string>();
    let card: IntroCard | null = null;
    /**
     * Playback starts at month 0 (after the intro card, "play again" from the end, or play pressed while paused there):
     * announce 開戦 and hold on it.
     */
    const startFromTheTop = () => {
      const s = store.get();
      if (!s.playing || monthIndex(world, s.t) !== 0) return;
      queue.clear(); // a restart (paused during the opening hold, then play) must not queue the opening news twice
      queue.push(selectEvents(world, 0, s.front));
      playback.holdAt(0, s.speed); // month 0 has news too: let it be read before moving on
    };

    store.subscribe((s, prev) => {
      if (s.front !== prev.front) {
        // the views announce different news and hold on different months
        playback = playbackFor(s.front);
        queue = queueFor(s.front);
        battle.setPinned(pinnedFront(s));
        reframe({ aim: true, animate: true });
      } else if ((s.selectedUnit === null) !== (prev.selectedUnit === null)) {
        reframe({ aim: false, animate: true }); // the mobile bottom sheet opened / closed: the planet moves above it
      }
      const news = newsAfterChange(s, prev, ticking);
      if (news.clear) queue.clear(); // scrubbed / stepped / skipped: news from the old position is stale
      if (news.fromTop && !card) startFromTheTop(); // incl. play pressed while paused at month 0
      if (s.speed !== prev.speed) queue.setMinSeconds(HOLD_SECONDS[s.speed]);
      if (s.reducedMotion !== prev.reducedMotion) renderer.setReducedMotion(s.reducedMotion);
      if (s.lang !== prev.lang) document.title = `AI WAR — ${tr('subtitle', s.lang)}`;
    });
    document.title = `AI WAR — ${tr('subtitle', store.get().lang)}`;

    window.addEventListener('keydown', (e) => {
      // the detail panel consumes its own Escape (closes first); otherwise Escape closes the detail, then leaves the front
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const s = store.get();
      if (s.selectedUnit) store.set({ selectedUnit: null });
      else if (s.front) store.set({ front: null });
    });

    // ---- first-visit intro: title card (playback waits), then the war from month 0 at 1× ----
    if (store.get().intro) {
      store.set({ speed: 1 });
      card = createIntroCard(hud.el, world, store);
      // fly in from deep space while the card is up (instant under reduced motion)
      const cam = renderer.camera;
      renderer.focus(galaxy.cameraTarget(store.get().front), { from: { ...cam, scale: cam.scale * 0.45 }, durationMs: 2600 });
    }

    // ---- frame loop ----
    // a step that throws must not freeze the site (PixiJS stops its ticker on an exception): log it once, keep going
    const frameError = createErrorLog('a frame');
    renderer.onFrame((dt, rawDt) => {
      try {
        if (!pinnedQuality) {
          // with the measured work time a steady 50 Hz / 30 fps-capped display with cheap frames is not "slow"
          const g = governor.frame(now(), rawDt, renderer.workMs / 1000);
          const level = mobile.active ? (Math.max(g, MOBILE_QUALITY) as QualityLevel) : g;
          if (level !== renderer.quality) renderer.setQuality(level);
        }
        let s = store.get();
        if (card) {
          if (!s.intro) card.close(); // skipped
          else if (card.advance(dt)) startFromTheTop(); // 開戦
          if (card.closed) card = null;
        } else if (!timeline.isDragging()) {
          const r = playback.tick(rawDt, s);
          if (r.t !== s.t || r.playing !== s.playing) {
            const ended = s.intro && !r.playing && r.t >= last;
            ticking = true;
            store.set(ended ? { t: r.t, playing: false, intro: false } : { t: r.t, playing: r.playing });
            ticking = false;
          }
          if (s.playing) for (const m of r.crossed) queue.push(selectEvents(world, m, s.front));
        }

        s = store.get();
        galaxy.update(dt, frames(s.t, s.sortBy));
        highlight.update(dt);
        fleets.update(dt, s.t);
        battle.update(dt); // after galaxy.update: reads this frame's planet wedges

        const visible = queue.update(now());
        banners.render(visible);
        for (const b of visible) {
          if (started.has(b.key)) continue;
          started.add(b.key);
          if (b.event.front === s.front) battle.shockwave(b.event.unit); // the news hits the focused battle
        }
        if (started.size > visible.length) for (const k of started) if (!visible.some((b) => b.key === k)) started.delete(k);
      } catch (err) {
        frameError(err);
      } finally {
        ticking = false;
      }
    });

    // keep the address bar shareable (front / whole month / language), throttled
    const writeSearch = (search: string) => {
      try {
        history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
      } catch {
        /* sandboxed / opaque origins refuse; the share button still works */
      }
    };
    // (writes the starting state at once; production drops the debug switches from the address)
    syncUrl(store, world, { read: () => location.search, write: writeSearch, keepDebug: DEBUG });
    // back / forward over a mobile overlay entry restores that entry's address: rewrite it from the live state
    window.addEventListener('popstate', () => writeSearch(nextSearch(store.get(), world, location.search, { keepDebug: DEBUG })));

    // debug (dev server / debug build only): ?hover=<org> pins the org highlight (screenshots)
    const hover = DEBUG ? params.get('hover') : null;
    if (hover && Object.hasOwn(world.orgs, hover)) store.set({ hoverOrg: hover });
    if (flashLog) Object.assign(window, { __flashStats: flashLog.stats });
    // dev server / debug build only: handles for poking the app from the console / harness (--eval)
    if (DEBUG) {
      Object.assign(window, { __renderer: renderer, __galaxy: galaxy, __store: store, __world: world, __fleets: fleets, __highlight: highlight, __battle: battle, __mobile: mobile });
    }
  } catch (err: unknown) {
    console.error('AI WAR failed to start', err);
    const l = params.get('lang');
    showLoadError(document.body, l === 'en' || l === 'ja' ? (l as Lang) : 'ja', err instanceof WebGLRequiredError ? 'webglRequired' : 'loadError');
  }
}

/** px between a desktop HUD box and the framed area */
const HUD_GAP = 8;
/**
 * Galaxy overview: the planet titles are screen-size text stacked above the top row and below the bottom row of
 * planets, past the box the camera fits (render/layout). This much extra room (px) keeps them clear of the title box
 * and the legend at every desktop size (render/labels drops the sub-title on small planets for the same reason).
 */
const TITLE_ROOM = { top: 26, bottom: 14 };

/**
 * Desktop layout: the framed area is the window minus the HUD boxes, measured from the DOM (layout boxes, so the
 * detail panel's slide-in transform doesn't count): below the title, left of the ranking panel, above the legend
 * and the timeline (plus TITLE_ROOM in the galaxy overview, `focused` false). An open unit detail panel on the left
 * pushes the frame right, so the planet glides into the free space beside it, as far as the frame stays landscape.
 */
function desktopInsets(w: number, h: number, hud: HTMLElement, detail: HTMLElement, focused: boolean): Insets {
  const box = (sel: string) => {
    const el = hud.querySelector<HTMLElement>(sel);
    return el && !el.hidden && el.offsetWidth > 0 && el.offsetHeight > 0 ? el : null;
  };
  const panel = box('#hud-panel');
  const timeline = box('#hud-timeline');
  const title = box('#hud-title');
  const legend = box('#hud-legend');
  const right = panel ? Math.max(0, w - panel.offsetLeft + HUD_GAP) : 0;
  const room = focused ? { top: 0, bottom: 0 } : TITLE_ROOM;
  const top = (title ? title.offsetTop + title.offsetHeight + HUD_GAP : 56) + room.top;
  const floor = Math.min(timeline ? timeline.offsetTop : h - 88, legend ? legend.offsetTop : h);
  const bottom = Math.max(0, h - floor + HUD_GAP) + room.bottom;
  // a detail panel on the left pushes the frame right (short windows show it over the ranking panel instead) — but
  // never so far that the frame turns portrait: that would flip the galaxy into its phone arrangement (render/layout)
  let left = 0;
  if (!detail.hidden && detail.offsetWidth > 0 && detail.offsetLeft < w / 2) {
    const l = detail.offsetLeft + detail.offsetWidth + HUD_GAP;
    left = Math.max(0, Math.min(l, w - right - (h - top - bottom)));
  }
  return { top, right, bottom, left };
}

/** Browser history entries for the mobile overlays (bottom sheet, full ranking, galaxy map): back closes them. */
function overlayHistory(): OverlayHistory {
  const KEY = 'aiwarOverlay';
  const isOurs = () => {
    const st: unknown = history.state;
    return typeof st === 'object' && st !== null && (st as Record<string, unknown>)[KEY] === true;
  };
  return {
    push() {
      try {
        history.pushState({ [KEY]: true }, '', location.href);
      } catch {
        /* sandboxed: Esc and the close buttons still work */
      }
    },
    back() {
      if (!isOurs()) return false;
      history.back();
      return true;
    },
    onPop(cb) {
      window.addEventListener('popstate', cb);
      return () => window.removeEventListener('popstate', cb);
    },
  };
}

function loadFonts(): Promise<unknown> {
  if (!document.fonts?.load) return Promise.resolve();
  const head = (f: string[]) => `"${f[0]}"`;
  return Promise.allSettled([
    document.fonts.load(`700 16px ${head(FONT_JP)}`, '総合戦線コード画像動画音声音楽エージェント首位勢力なし'),
    document.fonts.load(`700 16px ${head(FONT_UI)}`, 'LEAD GPT Claude Gemini 0123456789'),
    document.fonts.load(`500 16px ${head(FONT_DISP)}`, 'GENERAL FRONT'),
  ]);
}

/** Noto Sans JP is served in unicode-range slices: load the slices every label needs. */
function preloadFontGlyphs(world: World): Promise<unknown> {
  if (!document.fonts?.load) return Promise.resolve();
  const text = [
    ...world.fronts.flatMap((f) => [f.name.ja, f.name.en]),
    ...Object.values(world.units).flatMap((u) => Object.values(u).map((x) => x.name)),
    '首位 勢力なし ▶ クリックで戦線へ突入 ◆ ― —',
  ].join('');
  return Promise.allSettled([document.fonts.load(`700 16px "${FONT_JP[0]}"`, text), document.fonts.load(`700 16px "${FONT_UI[0]}"`, text)]);
}
