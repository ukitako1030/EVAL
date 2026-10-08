/**
 * Pure camera maths (no PixiJS). A camera is the world point shown at the centre of the
 * viewport rectangle plus a world→screen scale; the renderer turns it into the world
 * container's transform with `worldTransform`.
 */

export interface Camera {
  /** world point at the centre of the viewport */
  x: number;
  y: number;
  /** world → screen pixels */
  scale: number;
}

/** Screen rectangle (CSS px) the camera frames — the window minus any HUD insets. */
export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CameraTarget =
  | { kind: 'galaxy'; extent?: { w: number; h: number } }
  | { kind: 'planet'; x: number; y: number; r: number };

/** World-space box the galaxy overview fits into the viewport (mockup A: 960 × 590 around the origin). */
export const GALAXY_EXTENT = { w: 960, h: 590 } as const;
/** A focused planet's radius fills this share of the shorter viewport side. */
export const PLANET_FILL = 0.36;
/**
 * …and at most this share of a landscape viewport's width, so a narrow landscape frame (a side panel open) keeps
 * room beside the planet for the battle's outside label columns. Portrait frames (phones) always use PLANET_FILL.
 */
export const PLANET_SIDE_FILL = 0.3;
/** Focus slightly below the planet centre (× radius) so its title above stays in frame. */
const PLANET_DROP = 0.06;
const MIN_SCALE = 1e-3;

export function cameraFor(target: CameraTarget, viewport: Viewport): Camera {
  const w = Math.max(1, viewport.w);
  const h = Math.max(1, viewport.h);
  if (target.kind === 'galaxy') {
    const ext = target.extent ?? GALAXY_EXTENT;
    return { x: 0, y: 0, scale: Math.max(MIN_SCALE, Math.min(w / Math.max(1, ext.w), h / Math.max(1, ext.h))) };
  }
  const r = Math.max(1, target.r);
  const fill = w > h ? Math.min(PLANET_FILL * h, PLANET_SIDE_FILL * w) : PLANET_FILL * w;
  return { x: target.x, y: target.y + r * PLANET_DROP, scale: Math.max(MIN_SCALE, fill / r) };
}

export function easeInOutCubic(p: number): number {
  if (!(p > 0)) return 0;
  if (p >= 1) return 1;
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/**
 * Camera at eased progress `p` (0..1) of a move from `from` to `to`. Zoom is interpolated
 * logarithmically and the pan is chosen so the destination point travels across the screen
 * in a straight line (no swing-out when zooming into an off-centre planet).
 */
export function ease(from: Camera, to: Camera, p: number): Camera {
  const e = easeInOutCubic(p);
  if (e <= 0) return { ...from };
  if (e >= 1) return { ...to };
  const fs = Math.max(MIN_SCALE, from.scale);
  const ts = Math.max(MIN_SCALE, to.scale);
  const scale = Math.exp(Math.log(fs) + (Math.log(ts) - Math.log(fs)) * e);
  const k = (fs * (1 - e)) / scale;
  return { x: to.x - (to.x - from.x) * k, y: to.y - (to.y - from.y) * k, scale };
}

/** Position + scale for the world container so that `cam` is centred in `viewport`. */
export function worldTransform(cam: Camera, viewport: Viewport): { x: number; y: number; scale: number } {
  return {
    x: viewport.x + viewport.w / 2 - cam.x * cam.scale,
    y: viewport.y + viewport.h / 2 - cam.y * cam.scale,
    scale: cam.scale,
  };
}

/** World point → screen point for the given camera / viewport. */
export function worldToScreen(cam: Camera, viewport: Viewport, x: number, y: number): { x: number; y: number } {
  const t = worldTransform(cam, viewport);
  return { x: t.x + x * t.scale, y: t.y + y * t.scale };
}
