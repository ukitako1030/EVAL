/**
 * PixiJS render shell: one full-window canvas with three layers —
 *   background (screen space) · world (camera-transformed, bloomed at quality 0) · fx (screen space).
 * Owns the camera animation and the quality knobs; everything else plugs in via `layers` + `onFrame`.
 */
import { Application, Container, UPDATE_PRIORITY, type Ticker } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters/advanced-bloom';
import type { QualityLevel } from '../fx/quality';
import { createBackground, type BackgroundView } from './background';
import { cameraFor, ease, worldToScreen, worldTransform, type Camera, type CameraTarget, type Viewport } from './camera';
import { createErrorLog } from '../util/errorLog';
import { requireWebGL } from './webgl';

export interface RendererOptions {
  /** prefers-reduced-motion: camera moves are instant, ambient drift stops */
  reducedMotion?: boolean;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FocusOptions {
  /** jump without animating (always the case under reduced motion) */
  instant?: boolean;
  /** default 900 ms */
  durationMs?: number;
  /** start the move from this camera instead of the current one (e.g. an intro warp-in) */
  from?: Camera;
  /** a move under way keeps its start and progress and just heads for the new target (no restart, no snap) */
  retarget?: boolean;
}

/** `dt` is the frame time in seconds clamped to 0.1 s (for animation); `rawDt` is unclamped (for the quality governor). */
export type FrameCallback = (dt: number, rawDt: number) => void;

export interface Renderer {
  readonly app: Application;
  readonly layers: {
    /** screen-space backdrop (stars, nebula, grid) — owned by the renderer */
    background: Container;
    /** world space: add galaxy / planets / swarms here; the camera transforms this container */
    world: Container;
    /** screen-space effects above the world (not bloomed) */
    fx: Container;
  };
  readonly quality: QualityLevel;
  /** 1, or 0.5 at quality 3 — multiply particle / ship counts by this */
  readonly particleScale: number;
  /** current, animated camera */
  readonly camera: Camera;
  /** screen rectangle the camera frames (window minus insets) */
  readonly viewport: Viewport;
  /** true while a focus move is animating */
  readonly cameraMoving: boolean;
  /**
   * CPU time (ms) the last complete frame spent in update + render (the frame callbacks through PixiJS's render), NaN
   * before the first; the quality governor tells a slow app from a slow display (50 Hz, a 30 fps cap) with it
   */
  readonly workMs: number;
  setQuality(level: QualityLevel): void;
  setReducedMotion(on: boolean): void;
  /** keep HUD panels from covering the framed area */
  setInsets(insets: Partial<Insets>): void;
  /** animate the camera to a galaxy overview or a planet (900 ms, eased; instant under reduced motion) */
  focus(target: CameraTarget, opts?: FocusOptions): void;
  worldToScreen(x: number, y: number): { x: number; y: number };
  onFrame(cb: FrameCallback): () => void;
  destroy(): void;
}

export const CAMERA_MS = 900;
const MIN_VIEW = 120;
const MAX_DT = 0.1;

export async function createRenderer(canvasParent: HTMLElement, opts: RendererOptions = {}): Promise<Renderer> {
  const baseResolution = Math.min(window.devicePixelRatio || 1, 2);
  const app = new Application();
  // WebGL explicitly: the dynamic meshes (render/dynMesh.ts) ship a GLSL-only shader
  await app.init({
    preference: 'webgl',
    resizeTo: window,
    antialias: true,
    backgroundAlpha: 0,
    resolution: baseResolution,
    autoDensity: true,
  });
  // without WebGL PixiJS falls back to WebGPU / Canvas, which would draw nothing: fail loudly (load-error screen)
  try {
    requireWebGL(app.renderer);
  } catch (err) {
    app.destroy();
    throw err;
  }
  app.canvas.classList.add('stage');
  canvasParent.appendChild(app.canvas);

  const background = new Container({ label: 'background' });
  // the bloom sits on an untransformed wrapper so its filter area can simply be the screen
  const worldRoot = new Container({ label: 'world-root' });
  const world = new Container({ label: 'world' });
  const fx = new Container({ label: 'fx' });
  worldRoot.addChild(world);
  worldRoot.filterArea = app.screen;
  app.stage.addChild(background, worldRoot, fx);

  const bloom = new AdvancedBloomFilter({ threshold: 0.42, bloomScale: 0.9, brightness: 1, blur: 6, quality: 5 });
  bloom.antialias = 'inherit';

  let reduced = !!opts.reducedMotion;
  const bg = createBackground({ reducedMotion: reduced });
  background.addChild(bg.container);

  let quality: QualityLevel = 1;
  let particleScale = 1;
  let insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  let viewport: Viewport = computeViewport();
  let target: CameraTarget = { kind: 'galaxy' };
  let cam: Camera = cameraFor(target, viewport);
  let tween: { from: Camera; t: number; dur: number } | null = null;
  let warp = 0;
  const callbacks = new Set<FrameCallback>();

  function computeViewport(): Viewport {
    const W = app.screen.width;
    const H = app.screen.height;
    const w = Math.max(Math.min(MIN_VIEW, W), W - insets.left - insets.right);
    const h = Math.max(Math.min(MIN_VIEW, H), H - insets.top - insets.bottom);
    return { x: Math.min(insets.left, W - w), y: Math.min(insets.top, H - h), w, h };
  }

  function setQuality(level: QualityLevel) {
    if (level === quality) return;
    quality = level;
    worldRoot.filters = level === 0 ? [bloom] : [];
    const res = level >= 2 ? baseResolution * 0.75 : baseResolution;
    if (app.renderer.resolution !== res) app.renderer.resize(app.screen.width, app.screen.height, res);
    particleScale = level >= 3 ? 0.5 : 1;
  }
  setQuality(0);

  // PixiJS stops requesting frames when a ticker listener throws: never let one escape
  const tickError = createErrorLog('a renderer frame');
  // work time: from this (HIGH priority) listener to one that runs after PixiJS's render (LOW) — update + render
  let frameStart = Number.NaN;
  let workMs = Number.NaN;
  function tick(ticker: Ticker) {
    frameStart = performance.now();
    try {
      step(ticker);
    } catch (err) {
      tickError(err);
    }
  }
  function endWork() {
    if (frameStart === frameStart) workMs = performance.now() - frameStart;
  }

  // reused every frame
  const GALAXY: CameraTarget = { kind: 'galaxy' };
  const bgView: BackgroundView = { cam, viewport, overviewScale: 1, warp: 0 };

  function step(ticker: Ticker) {
    const rawDt = ticker.elapsedMS / 1000;
    const dt = Math.min(MAX_DT, Math.max(0, ticker.deltaMS / 1000));

    viewport = computeViewport();
    bg.resize(app.screen.width, app.screen.height, app.renderer.resolution);

    const prevScale = cam.scale;
    const to = cameraFor(target, viewport);
    if (tween) {
      tween.t += dt / tween.dur;
      cam = ease(tween.from, to, tween.t);
      if (tween.t >= 1) tween = null;
    } else cam = to;
    const v = dt > 0 ? (Math.log(cam.scale) - Math.log(prevScale)) / dt : 0;
    warp += (v - warp) * 0.25;
    const wt = worldTransform(cam, viewport);
    world.position.set(wt.x, wt.y);
    world.scale.set(wt.scale);

    bgView.cam = cam;
    bgView.viewport = viewport;
    bgView.overviewScale = cameraFor(GALAXY, viewport).scale;
    bgView.warp = warp;
    bg.update(dt, bgView);
    for (const cb of callbacks) {
      try {
        cb(dt, rawDt);
      } catch (err) {
        tickError(err);
      }
    }
  }
  app.ticker.add(tick, undefined, UPDATE_PRIORITY.HIGH);
  app.ticker.add(endWork, undefined, UPDATE_PRIORITY.UTILITY);

  return {
    app,
    layers: { background, world, fx },
    get quality() {
      return quality;
    },
    get particleScale() {
      return particleScale;
    },
    get camera() {
      return { ...cam };
    },
    get viewport() {
      return { ...viewport };
    },
    get cameraMoving() {
      return tween !== null;
    },
    get workMs() {
      return workMs;
    },
    setQuality,
    setReducedMotion(on) {
      reduced = on;
      bg.setReducedMotion(on);
      if (on) tween = null;
    },
    setInsets(next) {
      insets = { ...insets, ...next };
    },
    focus(next, o = {}) {
      target = next;
      if (o.retarget && tween) return;
      const dur = (o.durationMs ?? CAMERA_MS) / 1000;
      if (o.instant || reduced || dur <= 0) {
        tween = null;
        cam = cameraFor(target, viewport);
        return;
      }
      // (no hex-grid flicker: brightening the whole screen on every move — rapid ◀ ▶ taps, swipes — is a full-screen
      // flash outside the flash budget; the warp streaks carry the move)
      tween = { from: o.from ? { ...o.from } : { ...cam }, t: 0, dur };
    },
    worldToScreen(x, y) {
      return worldToScreen(cam, viewport, x, y);
    },
    onFrame(cb) {
      callbacks.add(cb);
      return () => void callbacks.delete(cb);
    },
    destroy() {
      callbacks.clear();
      app.ticker.remove(tick);
      app.ticker.remove(endWork);
      worldRoot.filters = [];
      bloom.destroy();
      bg.destroy();
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
