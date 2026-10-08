/**
 * Pure maths for the mobile layout (spec §8): when it applies, how ◀ ▶ / swipes walk the fronts, how the renderer
 * insets are kept steady, and how the camera is carried across an inset change. No DOM, no PixiJS.
 */
import type { FrontId } from '../data/types';

/** Narrower than this (or taller than wide) → the mobile layout. */
export const MOBILE_MAX_W = 768;
/** The collapsed mobile ranking shows this many rows ("すべて表示" shows the rest). */
export const TOP_N = 5;
/** Row pitch of the mobile ranking (px; desktop uses ranking.ROW_H); tall portrait phones get TALL_ROW_H. */
export const MOBILE_ROW_H = 40;
export const TALL_ROW_H = 44;
/** Portrait windows at least this tall have room for the taller rows without shrinking the planet. */
const TALL_MIN_H = 820;
/** A pointer that moves further than this (px) is a drag, not a tap. */
export const TAP_SLOP = 10;

export type LayoutMode = 'desktop' | 'mobile';

/** `mobile` below 768 px wide or in portrait orientation (taller than wide), else `desktop`. */
export function layoutMode(w: number, h: number): LayoutMode {
  return w < MOBILE_MAX_W || h > w ? 'mobile' : 'desktop';
}

/** Ranking row pitch for a mobile window: roomier rows (full 44 px touch targets) on tall portrait phones. */
export function mobileRowHeight(w: number, h: number): number {
  return h > w && h >= TALL_MIN_H ? TALL_ROW_H : MOBILE_ROW_H;
}

/**
 * The front `dir` steps away from `current` in `fronts` order, wrapping at both ends. From no front (the galaxy
 * map) the walk starts at `general` (or the first front). Null only when there are no fronts.
 */
export function stepFront(fronts: readonly { id: FrontId }[], current: FrontId | null, dir: 1 | -1): FrontId | null {
  const n = fronts.length;
  if (!n) return null;
  let i = current ? fronts.findIndex((f) => f.id === current) : -1;
  if (i < 0) {
    const g = fronts.findIndex((f) => f.id === 'general');
    return fronts[g >= 0 ? g : 0].id;
  }
  i = (((i + dir) % n) + n) % n;
  return fronts[i].id;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Cam {
  x: number;
  y: number;
  scale: number;
}

/** The screen rectangle a renderer with these insets frames (window `W` × `H` minus the insets, never negative). */
export function viewportOf(ins: Insets, W: number, H: number): Rect {
  const w = Math.max(1, W - ins.left - ins.right);
  const h = Math.max(1, H - ins.top - ins.bottom);
  return { x: ins.left, y: ins.top, w, h };
}

/** Portrait viewports keep h / w inside (MIN, MAX]; landscape ones stay below 1 / LAND. */
const PORTRAIT_MIN = 1.02;
const PORTRAIT_MAX = 1.3;
const LAND = 1.02;

/**
 * Pads mobile insets so the framed rectangle keeps one steady shape: in a portrait window its aspect (h / w) stays
 * inside (1.02, 1.3], in a landscape window below 1 / 1.02. Padding is symmetric and only ever trims the longer side,
 * so the centre and the shorter side — and with them a focused planet's size and position (render/camera
 * `cameraFor`) and the width-limited galaxy fit — do not change. What it buys: the galaxy picks its portrait or
 * landscape arrangement (render/galaxy `computeLayout`) from the framed rectangle, and with a steady shape opening
 * the detail sheet or the galaxy map never re-arranges the planets mid-animation.
 */
export function steadyInsets(ins: Insets, W: number, H: number): Insets {
  const v = viewportOf(ins, W, H);
  const out = { ...ins };
  if (H > W) {
    if (v.h > v.w * PORTRAIT_MAX) {
      const pad = (v.h - v.w * PORTRAIT_MAX) / 2;
      out.top += pad;
      out.bottom += pad;
    } else if (v.h < v.w * PORTRAIT_MIN) {
      const pad = (v.w - v.h / PORTRAIT_MIN) / 2;
      out.left += pad;
      out.right += pad;
    }
  } else if (v.h * LAND > v.w) {
    const pad = (v.h - v.w / LAND) / 2;
    out.top += pad;
    out.bottom += pad;
  }
  return out;
}

/**
 * The camera that keeps every world point exactly where `cam` showed it in viewport `from`, once the framed
 * viewport becomes `to` (a camera is the world point at the viewport centre, so the centre shift is undone).
 * Start a camera move from this and an inset change glides instead of jumping.
 */
export function holdOnScreen(cam: Cam, from: Rect, to: Rect): Cam {
  const s = Math.max(1e-6, cam.scale);
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  return { x: cam.x - dx / s, y: cam.y - dy / s, scale: cam.scale };
}

/**
 * Bottom-sheet drag release: close when it was pulled down past a quarter of its height, or flicked down
 * (> 0.6 px/ms) at least 24 px; otherwise it springs back.
 */
export function sheetShouldClose(dy: number, vy: number, height: number): boolean {
  if (!(dy > 0)) return false;
  return dy > Math.max(60, height * 0.25) || (vy > 0.6 && dy > 24);
}
