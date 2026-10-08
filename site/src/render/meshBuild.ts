/**
 * Non-allocating geometry for the renderer's dynamic meshes (./dynMesh): a growable vertex / index buffer plus the
 * strokes and fills that are redrawn every frame (frontlines, pulses, data streams, dashes, rings…). Rebuilding a
 * PixiJS `Graphics` re-tessellates it into fresh JS arrays every time (≈ 100+ MB/s of garbage for the galaxy); these
 * helpers write the same triangles into typed arrays that are reused from frame to frame.
 *
 * The stroke tessellation is a port of PixiJS 8's `buildLine` for centred strokes (miter / round / bevel joins, butt /
 * round caps, open and closed paths), and arcs / circles use PixiJS's segment counts, so a stroke looks exactly like
 * the `Graphics.stroke()` it replaces. Fills are triangulated directly (fans, rectangles, polar grids for territory
 * wedges). Colours are packed RGBA8 (straight alpha; ./dynMesh premultiplies in its shader, like PixiJS's batcher).
 */

export interface MeshBuf {
  /** x, y per vertex */
  pos: Float32Array;
  /** packed RGBA8 per vertex (see `rgba`) */
  col: Uint32Array;
  /** triangle list */
  idx: Uint32Array;
  /** vertices / indices written since the last `resetMeshBuf` */
  nv: number;
  ni: number;
  /** an array was reallocated (set by the builders, cleared by the uploader) */
  grew: boolean;
}

/** a polyline under construction: interleaved x, y */
export interface Path {
  xy: Float64Array;
  n: number;
}

export const JOIN_MITER = 0;
export const JOIN_ROUND = 1;
export const JOIN_BEVEL = 2;
export const CAP_BUTT = 0;
export const CAP_ROUND = 1;

const CLOSE_EPS = 1e-4; // PixiJS closePointEps
const AREA_EPS2 = 1e-8; // PixiJS curveEps²

export function createMeshBuf(verts = 256, indices = 768): MeshBuf {
  return { pos: new Float32Array(verts * 2), col: new Uint32Array(verts), idx: new Uint32Array(indices), nv: 0, ni: 0, grew: false };
}

export function resetMeshBuf(b: MeshBuf): void {
  b.nv = 0;
  b.ni = 0;
}

function growV(b: MeshBuf, need: number): void {
  let n = Math.max(16, b.col.length);
  while (n < need) n *= 2;
  const pos = new Float32Array(n * 2);
  pos.set(b.pos.subarray(0, b.nv * 2));
  const col = new Uint32Array(n);
  col.set(b.col.subarray(0, b.nv));
  b.pos = pos;
  b.col = col;
  b.grew = true;
}

function growI(b: MeshBuf, need: number): void {
  let n = Math.max(48, b.idx.length);
  while (n < need) n *= 2;
  const idx = new Uint32Array(n);
  idx.set(b.idx.subarray(0, b.ni));
  b.idx = idx;
  b.grew = true;
}

/** make room for `nv` more vertices and `ni` more indices */
export function reserve(b: MeshBuf, nv: number, ni: number): void {
  if (b.nv + nv > b.col.length) growV(b, b.nv + nv);
  if (b.ni + ni > b.idx.length) growI(b, b.ni + ni);
}

function vtx(b: MeshBuf, x: number, y: number): void {
  if (b.nv >= b.col.length) growV(b, b.nv + 1);
  const k = b.nv++ * 2;
  b.pos[k] = x;
  b.pos[k + 1] = y;
}

function tri(b: MeshBuf, a: number, c: number, d: number): void {
  if (b.ni + 3 > b.idx.length) growI(b, b.ni + 3);
  const k = b.ni;
  b.idx[k] = a;
  b.idx[k + 1] = c;
  b.idx[k + 2] = d;
  b.ni = k + 3;
}

/**
 * 0xRRGGBB + alpha → packed RGBA8 (little-endian: R in the low byte), straight alpha. The alpha byte is truncated
 * like PixiJS's batcher does.
 */
export function rgba(color: number, alpha: number): number {
  const a = alpha <= 0 ? 0 : alpha >= 1 ? 255 : (alpha * 255) | 0;
  return ((a << 24) | ((color & 0xff) << 16) | (color & 0xff00) | ((color >> 16) & 0xff)) >>> 0;
}

/** `c` with its alpha byte multiplied by k (0..1) */
export function scaleAlpha(c: number, k: number): number {
  const a = (c >>> 24) * (k <= 0 ? 0 : k >= 1 ? 1 : k);
  return ((c & 0xffffff) | ((a + 0.5) << 24)) >>> 0;
}

// ---------------------------------------------------------------------------------------------
// paths

export function createPath(points = 64): Path {
  return { xy: new Float64Array(points * 2), n: 0 };
}

export function pathReset(p: Path): void {
  p.n = 0;
}

/** append a point (an exact repeat of the last one is dropped, like `Graphics.lineTo`) */
export function pathPush(p: Path, x: number, y: number): void {
  const k = p.n * 2;
  if (p.n > 0 && p.xy[k - 2] === x && p.xy[k - 1] === y) return;
  if (k + 2 > p.xy.length) {
    const xy = new Float64Array(Math.max(32, p.xy.length * 2));
    xy.set(p.xy);
    p.xy = xy;
  }
  p.xy[k] = x;
  p.xy[k + 1] = y;
  p.n++;
}

/** PixiJS `buildArc` segment count for an arc of `dist` radians at radius r (world units) */
export function arcSteps(r: number, dist: number): number {
  return Math.max(3, Math.max(6, Math.floor(6 * Math.pow(r, 1 / 3) * (dist / Math.PI))));
}

/** append the arc a0 → a1 (increasing; wraps when a1 < a0) as `Graphics.arc(cx, cy, r, a0, a1)` samples it */
export function pathArc(p: Path, cx: number, cy: number, r: number, a0: number, a1: number): void {
  let dist = Math.abs(a0 - a1);
  if (a0 > a1) dist = 2 * Math.PI - dist;
  const steps = arcSteps(r, dist);
  const f = dist / steps;
  let t = a0;
  for (let i = 0; i <= steps; i++) {
    pathPush(p, cx + Math.cos(t) * r, cy + Math.sin(t) * r);
    t += f;
  }
}

/** PixiJS `buildCircle` point count for radius r */
export function circlePoints(r: number): number {
  return 4 * Math.ceil(2.3 * Math.sqrt(2 * r));
}

/** append a full circle (closed shape: stroke it with `closed = true`) */
export function pathCircle(p: Path, cx: number, cy: number, r: number): void {
  const n = circlePoints(r);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pathPush(p, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
}

// ---------------------------------------------------------------------------------------------
// strokes (port of PixiJS 8 buildLine, alignment 0.5)

let scratch = new Float64Array(256);
/** the stroke's triangle strip in float64 (PixiJS tests degenerate triangles on unrounded values) */
let strip = new Float64Array(512);
let ns = 0;

function sv(x: number, y: number): void {
  if (2 * ns + 2 > strip.length) {
    const next = new Float64Array(strip.length * 2);
    next.set(strip);
    strip = next;
  }
  strip[2 * ns] = x;
  strip[2 * ns + 1] = y;
  ns++;
}

function roundJoin( cx: number, cy: number, sx: number, sy: number, ex: number, ey: number, clockwise: boolean): void {
  const c2p0x = sx - cx;
  const c2p0y = sy - cy;
  let angle0 = Math.atan2(c2p0x, c2p0y);
  let angle1 = Math.atan2(ex - cx, ey - cy);
  if (clockwise && angle0 < angle1) angle0 += Math.PI * 2;
  else if (!clockwise && angle0 > angle1) angle1 += Math.PI * 2;
  let start = angle0;
  const diff = angle1 - angle0;
  const radius = Math.sqrt(c2p0x * c2p0x + c2p0y * c2p0y);
  const segCount = ((15 * Math.abs(diff) * Math.sqrt(radius)) / Math.PI) | 0 || 0;
  const segs = segCount + 1;
  const inc = diff / segs;
  start += inc;
  if (clockwise) {
    sv(cx, cy);
    sv(sx, sy);
    for (let i = 1, a = start; i < segs; i++, a += inc) {
      sv(cx, cy);
      sv(cx + Math.sin(a) * radius, cy + Math.cos(a) * radius);
    }
    sv(cx, cy);
    sv(ex, ey);
  } else {
    sv(sx, sy);
    sv(cx, cy);
    for (let i = 1, a = start; i < segs; i++, a += inc) {
      sv(cx + Math.sin(a) * radius, cy + Math.cos(a) * radius);
      sv(cx, cy);
    }
    sv(ex, ey);
    sv(cx, cy);
  }
}

/**
 * Stroke a path (centred, like `Graphics.stroke({ width, join, cap, miterLimit })`). `closed` joins the last point back
 * to the first (circles); open paths get `cap` at both ends.
 */
export function strokePath(b: MeshBuf, p: Path, width: number, color: number, closed = false, join = JOIN_MITER, cap = CAP_BUTT, miterLimit = 10): void {
  let n = p.n;
  if (n < 2 || !(width > 0)) return;
  let pts = p.xy;
  if (closed) {
    const fx = pts[0];
    const fy = pts[1];
    let m = n;
    if (Math.abs(fx - pts[2 * n - 2]) < CLOSE_EPS && Math.abs(fy - pts[2 * n - 1]) < CLOSE_EPS) m--;
    if (m < 2) return;
    if (scratch.length < 2 * (m + 2)) scratch = new Float64Array(4 * (m + 2));
    const mx = (fx + pts[2 * m - 2]) * 0.5;
    const my = (fy + pts[2 * m - 1]) * 0.5;
    scratch[0] = mx;
    scratch[1] = my;
    for (let i = 0; i < 2 * m; i++) scratch[2 + i] = pts[i];
    scratch[2 * m + 2] = mx;
    scratch[2 * m + 3] = my;
    pts = scratch;
    n = m + 2;
  }
  ns = 0;
  const hw = width / 2;
  const hw2 = hw * hw;
  const ml2 = miterLimit * miterLimit;

  let x0 = pts[0];
  let y0 = pts[1];
  let x1 = pts[2];
  let y1 = pts[3];
  let x2 = 0;
  let y2 = 0;
  let perpX = -(y0 - y1);
  let perpY = x0 - x1;
  let perp1x = 0;
  let perp1y = 0;
  let dist = Math.sqrt(perpX * perpX + perpY * perpY);
  perpX = (perpX / dist) * hw;
  perpY = (perpY / dist) * hw;
  if (!closed && cap === CAP_ROUND) roundJoin(x0, y0, x0 - perpX, y0 - perpY, x0 + perpX, y0 + perpY, true);
  sv(x0 - perpX, y0 - perpY);
  sv(x0 + perpX, y0 + perpY);

  for (let i = 1; i < n - 1; ++i) {
    x0 = pts[(i - 1) * 2];
    y0 = pts[(i - 1) * 2 + 1];
    x1 = pts[i * 2];
    y1 = pts[i * 2 + 1];
    x2 = pts[(i + 1) * 2];
    y2 = pts[(i + 1) * 2 + 1];
    perpX = -(y0 - y1);
    perpY = x0 - x1;
    dist = Math.sqrt(perpX * perpX + perpY * perpY);
    perpX = (perpX / dist) * hw;
    perpY = (perpY / dist) * hw;
    perp1x = -(y1 - y2);
    perp1y = x1 - x2;
    dist = Math.sqrt(perp1x * perp1x + perp1y * perp1y);
    perp1x = (perp1x / dist) * hw;
    perp1y = (perp1y / dist) * hw;
    const dx0 = x1 - x0;
    const dy0 = y0 - y1;
    const dx1 = x1 - x2;
    const dy1 = y2 - y1;
    const dot = dx0 * dx1 + dy0 * dy1;
    const cross = dy0 * dx1 - dy1 * dx0;
    const clockwise = cross < 0;
    if (Math.abs(cross) < 1e-3 * Math.abs(dot)) {
      sv(x1 - perpX, y1 - perpY);
      sv(x1 + perpX, y1 + perpY);
      if (dot >= 0) {
        if (join === JOIN_ROUND) roundJoin(x1, y1, x1 - perpX, y1 - perpY, x1 - perp1x, y1 - perp1y, false);
        sv(x1 - perp1x, y1 - perp1y);
        sv(x1 + perp1x, y1 + perp1y);
      }
      continue;
    }
    const c1 = (-perpX + x0) * (-perpY + y1) - (-perpX + x1) * (-perpY + y0);
    const c2 = (-perp1x + x2) * (-perp1y + y1) - (-perp1x + x1) * (-perp1y + y2);
    const px = (dx0 * c2 - dx1 * c1) / cross;
    const py = (dy1 * c1 - dy0 * c2) / cross;
    const pDist = (px - x1) * (px - x1) + (py - y1) * (py - y1);
    const imx = x1 + (px - x1);
    const imy = y1 + (py - y1);
    const omx = x1 - (px - x1);
    const omy = y1 - (py - y1);
    const smallerInsideSegmentSq = Math.min(dx0 * dx0 + dy0 * dy0, dx1 * dx1 + dy1 * dy1);
    const insideMiterOk = pDist <= smallerInsideSegmentSq + hw2;
    if (insideMiterOk) {
      if (join === JOIN_BEVEL || pDist / hw2 > ml2) {
        if (clockwise) {
          sv(imx, imy);
          sv(x1 + perpX, y1 + perpY);
          sv(imx, imy);
          sv(x1 + perp1x, y1 + perp1y);
        } else {
          sv(x1 - perpX, y1 - perpY);
          sv(omx, omy);
          sv(x1 - perp1x, y1 - perp1y);
          sv(omx, omy);
        }
      } else if (join === JOIN_ROUND) {
        if (clockwise) {
          sv(imx, imy);
          sv(x1 + perpX, y1 + perpY);
          roundJoin(x1, y1, x1 + perpX, y1 + perpY, x1 + perp1x, y1 + perp1y, true);
          sv(imx, imy);
          sv(x1 + perp1x, y1 + perp1y);
        } else {
          sv(x1 - perpX, y1 - perpY);
          sv(omx, omy);
          roundJoin(x1, y1, x1 - perpX, y1 - perpY, x1 - perp1x, y1 - perp1y, false);
          sv(x1 - perp1x, y1 - perp1y);
          sv(omx, omy);
        }
      } else {
        sv(imx, imy);
        sv(omx, omy);
      }
    } else {
      sv(x1 - perpX, y1 - perpY);
      sv(x1 + perpX, y1 + perpY);
      if (join === JOIN_ROUND) {
        if (clockwise) roundJoin(x1, y1, x1 + perpX, y1 + perpY, x1 + perp1x, y1 + perp1y, true);
        else roundJoin(x1, y1, x1 - perpX, y1 - perpY, x1 - perp1x, y1 - perp1y, false);
      } else if (join === JOIN_MITER && pDist / hw2 <= ml2) {
        if (clockwise) {
          sv(omx, omy);
          sv(omx, omy);
        } else {
          sv(imx, imy);
          sv(imx, imy);
        }
      }
      sv(x1 - perp1x, y1 - perp1y);
      sv(x1 + perp1x, y1 + perp1y);
    }
  }

  x0 = pts[(n - 2) * 2];
  y0 = pts[(n - 2) * 2 + 1];
  x1 = pts[(n - 1) * 2];
  y1 = pts[(n - 1) * 2 + 1];
  perpX = -(y0 - y1);
  perpY = x0 - x1;
  dist = Math.sqrt(perpX * perpX + perpY * perpY);
  perpX = (perpX / dist) * hw;
  perpY = (perpY / dist) * hw;
  sv(x1 - perpX, y1 - perpY);
  sv(x1 + perpX, y1 + perpY);
  if (!closed && cap === CAP_ROUND) roundJoin(x1, y1, x1 - perpX, y1 - perpY, x1 + perpX, y1 + perpY, false);

  // the strip as a triangle list, skipping (near-)degenerate triangles
  reserve(b, ns, 3 * ns);
  const v0 = b.nv;
  const pos = b.pos;
  for (let i = 0, o = 2 * v0; i < 2 * ns; i++) pos[o + i] = strip[i];
  b.nv = v0 + ns;
  for (let i = 0; i < ns - 2; ++i) {
    const ax = strip[i * 2];
    const ay = strip[i * 2 + 1];
    const bx = strip[i * 2 + 2];
    const by = strip[i * 2 + 3];
    const cx = strip[i * 2 + 4];
    const cy = strip[i * 2 + 5];
    if (Math.abs(ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) < AREA_EPS2) continue;
    tri(b, v0 + i, v0 + i + 1, v0 + i + 2);
  }
  b.col.fill(color, v0, b.nv);
}

/** a single straight stroke with butt caps (one `moveTo` / `lineTo` sub-path) */
export function strokeSegment(b: MeshBuf, x0: number, y0: number, x1: number, y1: number, width: number, color: number): void {
  let px = -(y0 - y1);
  let py = x0 - x1;
  const d = Math.sqrt(px * px + py * py);
  if (!(d > 0) || !(width > 0)) return;
  px = (px / d) * (width / 2);
  py = (py / d) * (width / 2);
  reserve(b, 4, 6);
  const v = b.nv;
  vtx(b, x0 - px, y0 - py);
  vtx(b, x0 + px, y0 + py);
  vtx(b, x1 - px, y1 - py);
  vtx(b, x1 + px, y1 + py);
  tri(b, v, v + 1, v + 2);
  tri(b, v + 1, v + 2, v + 3);
  b.col.fill(color, v, v + 4);
}

const arcPath = createPath(64);

/** stroke the arc a0 → a1 (`moveTo(start).arc(…).stroke(…)`) */
export function strokeArc(b: MeshBuf, cx: number, cy: number, r: number, a0: number, a1: number, width: number, color: number): void {
  pathReset(arcPath);
  pathArc(arcPath, cx, cy, r, a0, a1);
  strokePath(b, arcPath, width, color);
}

/** stroke a circle (`circle(…).stroke(…)`) */
export function strokeCircle(b: MeshBuf, cx: number, cy: number, r: number, width: number, color: number): void {
  if (!(r > 0)) return;
  pathReset(arcPath);
  pathCircle(arcPath, cx, cy, r);
  strokePath(b, arcPath, width, color, true);
}

// ---------------------------------------------------------------------------------------------
// fills

export function fillRect(b: MeshBuf, x: number, y: number, w: number, h: number, color: number): void {
  if (!(w > 0) || !(h > 0)) return;
  reserve(b, 4, 6);
  const v = b.nv;
  vtx(b, x, y);
  vtx(b, x + w, y);
  vtx(b, x + w, y + h);
  vtx(b, x, y + h);
  tri(b, v, v + 1, v + 2);
  tri(b, v, v + 2, v + 3);
  b.col.fill(color, v, v + 4);
}

export function fillCircle(b: MeshBuf, cx: number, cy: number, r: number, color: number): void {
  if (!(r > 0)) return;
  const n = circlePoints(r);
  reserve(b, n + 1, 3 * n);
  const c = b.nv;
  vtx(b, cx, cy);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    vtx(b, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  for (let i = 0; i < n; i++) tri(b, c, c + 1 + i, c + 1 + ((i + 1) % n));
  b.col.fill(color, c, c + 1 + n);
}

/**
 * Fill the region between two sampled frontlines of a planet: border `bs` starts it and `be` (+ `wrap`) ends it, both
 * sampled at radius fractions `rho(i) = core + (1 − core) i / NS`, i = 0..NS (planet-local, radius R). Triangulated as
 * a polar grid whose rim and core edges are arcs of at most `step` radians — the same outline as the territory
 * polygon (./planetDraw `wedgePolygon`).
 */
export function fillSector(b: MeshBuf, bs: ArrayLike<number>, be: ArrayLike<number>, wrap: number, NS: number, R: number, core: number, color: number, step = 0.08): void {
  let span = 0;
  for (let i = 0; i <= NS; i++) span = Math.max(span, be[i] + wrap - bs[i]);
  const J = Math.max(1, Math.ceil(span / step));
  reserve(b, (NS + 1) * (J + 1), 6 * NS * J);
  const v0 = b.nv;
  for (let i = 0; i <= NS; i++) {
    const r = (core + ((1 - core) * i) / NS) * R;
    const a0 = bs[i];
    const da = (be[i] + wrap - a0) / J;
    for (let j = 0; j <= J; j++) {
      const a = a0 + da * j;
      vtx(b, Math.cos(a) * r, Math.sin(a) * r);
    }
  }
  const W = J + 1;
  for (let i = 0; i < NS; i++) {
    for (let j = 0; j < J; j++) {
      const a = v0 + i * W + j;
      tri(b, a, a + 1, a + W);
      tri(b, a + 1, a + W + 1, a + W);
    }
  }
  b.col.fill(color, v0, b.nv);
}
