import { createRenderer, type Renderer } from './render/app';
import { createGalaxy, type Galaxy } from './render/galaxy';
import { FONT_DISP, FONT_JP, FONT_UI } from './render/labels';
import { isPortrait } from './render/layout';
import type { QualityLevel } from './fx/quality';
import { createFlashBudget } from './fx/flashBudget';
import { loadWorld } from './data/load';
import { frontFrame, type UnitFrame } from './data/timeline';
import type { FrontId, World } from './data/types';
import { createStore, defaultState } from './state/store';
import { decodeUrl } from './state/url';

// Minimal wiring for the galaxy overview — playback, HUD and the full frame loop arrive in Task 15.
const mount = document.getElementById('app');
if (mount) void boot(mount);

async function boot(mount: HTMLElement) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  try {
    const fonts = loadFonts();
    const [renderer, world] = await Promise.all([createRenderer(mount, { reducedMotion: motion.matches }), loadWorld()]);
    const params = new URLSearchParams(location.search);
    // debug: ?quality=0..3 pins the quality level (used by the screenshot / fps harness)
    const q = params.get('quality');
    if (q === '0' || q === '1' || q === '2' || q === '3') renderer.setQuality(Number(q) as QualityLevel);

    const store = createStore({ ...defaultState(world.months.length - 1), ...decodeUrl(location.search, world), reducedMotion: motion.matches });
    const flashes = createFlashBudget({ maxPerSecond: 3, maxIntensity: 0.35 });
    // wait briefly for the web fonts so the first labels render in the right face (refreshed if they arrive later)
    await Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]);
    const galaxy = createGalaxy(renderer, { world, store, flashes });
    void fonts.then(() => galaxy.refreshText());
    preloadFontGlyphs(world).then(() => galaxy.refreshText(), () => undefined);

    applyInsets(renderer);
    window.addEventListener('resize', () => applyInsets(renderer));
    const aim = (instant: boolean) => renderer.focus(galaxy.cameraTarget(store.get().front), { instant });
    aim(true);
    galaxy.onLayoutChange(() => aim(true));
    store.subscribe((s, prev) => {
      if (s.front !== prev.front) aim(false);
      if (s.reducedMotion !== prev.reducedMotion) renderer.setReducedMotion(s.reducedMotion);
    });
    motion.addEventListener('change', (e) => store.set({ reducedMotion: e.matches }));

    renderer.onFrame((dt) => {
      const s = store.get();
      galaxy.update(dt, framesAt(world, s.t, s.sortBy));
    });

    // dev only: handles for poking the app from the console / harness (--eval)
    if (import.meta.env.DEV) Object.assign(window, { __renderer: renderer, __galaxy: galaxy, __store: store, __world: world });
  } catch (err: unknown) {
    console.error('AI WAR failed to start', err);
  }
}

function framesAt(world: World, t: number, sortBy: 'strength' | 'scale'): Partial<Record<FrontId, UnitFrame[]>> {
  const out: Partial<Record<FrontId, UnitFrame[]>> = {};
  for (const f of world.fronts) out[f.id] = frontFrame(world, f.id, t, sortBy);
  return out;
}

/** Leave room for the HUD: ranking panel on the right (desktop), top bar and timeline. */
function applyInsets(renderer: Renderer) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (isPortrait({ w, h })) renderer.setInsets({ top: 56, right: 0, bottom: 96, left: 0 });
  else if (w >= 1024) renderer.setInsets({ top: 76, right: 360, bottom: 120, left: 0 });
  else renderer.setInsets({ top: 56, right: 0, bottom: 96, left: 0 });
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
