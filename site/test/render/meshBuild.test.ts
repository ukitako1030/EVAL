import { describe, it, expect } from 'vitest';
import {
  CAP_BUTT,
  CAP_ROUND,
  JOIN_BEVEL,
  JOIN_MITER,
  JOIN_ROUND,
  arcSteps,
  circlePoints,
  createMeshBuf,
  createPath,
  fillCircle,
  fillRect,
  fillSector,
  pathArc,
  pathCircle,
  pathPush,
  pathReset,
  resetMeshBuf,
  rgba,
  scaleAlpha,
  strokeArc,
  strokeCircle,
  strokePath,
  strokeSegment,
  type MeshBuf,
} from '../../src/render/meshBuild';

type BuildLine = (
  points: number[],
  style: { width: number; alignment: number; miterLimit: number; join: string; cap: string },
  flipAlignment: boolean,
  closed: boolean,
  vertices: number[],
  indices: number[],
) => void;
type BuildArc = (points: number[], x: number, y: number, r: number, a0: number, a1: number, clockwise: boolean) => void;

// PixiJS's own tessellators, imported by file (the package's exports map hides them): the reference for parity
const PIXI = '../../node_modules/pixi.js/lib/scene/graphics/shared/buildCommands/';
const { buildLine } = (await import(/* @vite-ignore */ new URL(PIXI + 'buildLine.mjs', import.meta.url).href)) as { buildLine: BuildLine };
const { buildArc } = (await import(/* @vite-ignore */ new URL(PIXI + 'buildArc.mjs', import.meta.url).href)) as { buildArc: BuildArc };

const JOINS = { miter: JOIN_MITER, round: JOIN_ROUND, bevel: JOIN_BEVEL } as const;
const CAPS = { butt: CAP_BUTT, round: CAP_ROUND } as const;

function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function triangles(b: MeshBuf): number[] {
  return Array.from(b.idx.subarray(0, b.ni));
}

describe('mesh builder: colours', () => {
  it('packs 0xRRGGBB + alpha little-endian (R in the low byte), alpha truncated like the PixiJS batcher', () => {
    const c = rgba(0x112233, 1);
    const bytes = new Uint8Array(new Uint32Array([c]).buffer);
    expect([...bytes]).toEqual([0x11, 0x22, 0x33, 255]);
    expect(rgba(0xffffff, 0.05) >>> 24).toBe(12); // 12.75 → 12
    expect(rgba(0xffffff, -1) >>> 24).toBe(0);
    expect(rgba(0xffffff, 7) >>> 24).toBe(255);
  });

  it('scales only the alpha byte', () => {
    const c = rgba(0xabcdef, 0.8);
    const h = scaleAlpha(c, 0.5);
    expect(h & 0xffffff).toBe(c & 0xffffff);
    expect(h >>> 24).toBe(Math.round((c >>> 24) * 0.5));
    expect(scaleAlpha(c, 2)).toBe(c);
    expect(scaleAlpha(c, -1) >>> 24).toBe(0);
  });
});

describe('mesh builder: paths', () => {
  it('drops an exact repeat of the last point (Graphics.lineTo)', () => {
    const p = createPath(2);
    pathPush(p, 1, 2);
    pathPush(p, 1, 2);
    pathPush(p, 3, 4);
    pathPush(p, 5, 6); // grows past the initial capacity
    expect(p.n).toBe(3);
    expect(Array.from(p.xy.subarray(0, 6))).toEqual([1, 2, 3, 4, 5, 6]);
    pathReset(p);
    expect(p.n).toBe(0);
  });

  it('samples arcs exactly like PixiJS buildArc (incl. wrapping when a1 < a0)', () => {
    for (const [r, a0, a1] of [
      [40, 0.3, 1.9],
      [3, -2, -1.2],
      [250, 1, 0.5],
      [12, 0, Math.PI * 2],
    ]) {
      const ref: number[] = [];
      buildArc(ref, 5, -7, r, a0, a1, false);
      const p = createPath();
      pathArc(p, 5, -7, r, a0, a1);
      expect(p.n).toBe(ref.length / 2);
      for (let i = 0; i < ref.length; i++) expect(p.xy[i]).toBeCloseTo(ref[i], 9);
    }
    expect(arcSteps(1, 0.01)).toBe(6);
  });

  it('closes circles with PixiJS buildCircle point counts', () => {
    expect(circlePoints(10)).toBe(4 * Math.ceil(2.3 * Math.sqrt(20)));
    const p = createPath();
    pathCircle(p, 0, 0, 10);
    expect(p.n).toBe(circlePoints(10));
    for (let i = 0; i < p.n; i++) expect(Math.hypot(p.xy[2 * i], p.xy[2 * i + 1])).toBeCloseTo(10, 9);
  });
});

describe('mesh builder: strokes match PixiJS buildLine', () => {
  const rnd = lcg(7);
  const cases: { pts: number[]; closed: boolean }[] = [
    { pts: [0, 0, 10, 0], closed: false },
    { pts: [0, 0, 10, 0, 10, 10], closed: false }, // right angle
    { pts: [0, 0, 10, 0, 0, 0.5], closed: false }, // hairpin: the miter limit kicks in
    { pts: [0, 0, 10, 0, 20, 0], closed: false }, // straight run (collinear branch)
    { pts: [0, 0, 10, 0, 0, 0], closed: false }, // reversal
    { pts: [0, 0, 10, 0, 10, 10, 0, 10], closed: true },
  ];
  for (let k = 0; k < 12; k++) {
    const n = 2 + Math.floor(rnd() * 12);
    const pts: number[] = [];
    let a = rnd() * 6;
    let x = 0;
    let y = 0;
    for (let i = 0; i < n; i++) {
      pts.push(x, y);
      a += (rnd() - 0.5) * 2.4; // gentle to sharp bends
      const L = 0.5 + rnd() * 30;
      x += Math.cos(a) * L;
      y += Math.sin(a) * L;
    }
    cases.push({ pts, closed: k % 4 === 3 });
  }

  for (const [jn, join] of Object.entries(JOINS))
    for (const [cn, cap] of Object.entries(CAPS))
      it(`same vertices and triangles — join ${jn}, cap ${cn}`, () => {
        for (const { pts, closed } of cases) {
          for (const [width, miterLimit] of [
            [1.5, 10],
            [6, 2],
          ]) {
            const refV: number[] = [];
            const refI: number[] = [];
            buildLine(pts.slice(), { width, alignment: 0.5, miterLimit, join: jn, cap: cn }, false, closed, refV, refI);
            const b = createMeshBuf(4, 6); // tiny: exercises growth too
            b.nv = 3; // a stroke appended after other geometry keeps its indices relative
            const p = createPath();
            for (let i = 0; i < pts.length; i += 2) pathPush(p, pts[i], pts[i + 1]);
            const col = rgba(0x3cd2ff, 0.5);
            strokePath(b, p, width, col, closed, join, cap, miterLimit);
            expect(b.nv - 3).toBe(refV.length / 2);
            for (let i = 0; i < refV.length; i++) expect(b.pos[6 + i]).toBeCloseTo(refV[i], 3);
            expect(triangles(b).map((v) => v - 3)).toEqual(refI);
            for (let v = 3; v < b.nv; v++) expect(b.col[v]).toBe(col);
          }
        }
      });

  it('strokeSegment / strokeArc / strokeCircle equal the generic path stroke', () => {
    const a = createMeshBuf();
    const b = createMeshBuf();
    const p = createPath();
    strokeSegment(a, 1, 2, 30, -4, 3, 7);
    pathPush(p, 1, 2);
    pathPush(p, 30, -4);
    strokePath(b, p, 3, 7);
    expect(Array.from(a.pos.subarray(0, a.nv * 2))).toEqual(Array.from(b.pos.subarray(0, b.nv * 2)));
    expect(triangles(a).length).toBe(6);

    resetMeshBuf(a);
    resetMeshBuf(b);
    strokeArc(a, 0, 0, 50, 0.2, 1.4, 2, 9);
    pathReset(p);
    pathPush(p, Math.cos(0.2) * 50, Math.sin(0.2) * 50); // moveTo(start) + arc: the repeated start point is dropped
    pathArc(p, 0, 0, 50, 0.2, 1.4);
    strokePath(b, p, 2, 9);
    expect(Array.from(a.pos.subarray(0, a.nv * 2))).toEqual(Array.from(b.pos.subarray(0, b.nv * 2)));

    resetMeshBuf(a);
    strokeCircle(a, 3, 4, 20, 2, 9);
    for (let v = 0; v < a.nv; v++) {
      const d = Math.hypot(a.pos[2 * v] - 3, a.pos[2 * v + 1] - 4);
      expect(d).toBeGreaterThan(18.9);
      expect(d).toBeLessThan(21.1);
    }
    expect(a.ni).toBeGreaterThan(0);
  });

  it('ignores empty, single-point and zero-width strokes', () => {
    const b = createMeshBuf();
    const p = createPath();
    strokePath(b, p, 2, 1);
    pathPush(p, 1, 1);
    strokePath(b, p, 2, 1);
    pathPush(p, 5, 1);
    strokePath(b, p, 0, 1);
    strokeSegment(b, 1, 1, 1, 1, 2, 1);
    strokeCircle(b, 0, 0, 0, 2, 1);
    expect(b.nv).toBe(0);
    expect(b.ni).toBe(0);
  });
});

describe('mesh builder: fills', () => {
  it('fills rectangles and circles (fan, PixiJS circle resolution)', () => {
    const b = createMeshBuf();
    fillRect(b, 1, 2, 3, 4, 5);
    expect(b.nv).toBe(4);
    expect(triangles(b)).toEqual([0, 1, 2, 0, 2, 3]);
    fillCircle(b, 0, 0, 8, 6);
    expect(b.nv).toBe(4 + 1 + circlePoints(8));
    expect(b.ni).toBe(6 + 3 * circlePoints(8));
    expect(b.col[4]).toBe(6);
    fillRect(b, 0, 0, 0, 4, 5);
    fillCircle(b, 0, 0, -1, 5);
    expect(b.nv).toBe(4 + 1 + circlePoints(8));
  });

  it('fills a territory as a polar grid between its two frontlines', () => {
    const NS = 6;
    const bs = new Float64Array(NS + 1).map((_, i) => -1.2 + 0.02 * Math.sin(i));
    const be = new Float64Array(NS + 1).map((_, i) => 0.4 + 0.03 * Math.cos(i));
    const b = createMeshBuf(8, 8);
    fillSector(b, bs, be, 0, NS, 100, 0.17, 3);
    const J = Math.ceil(Math.max(...Array.from(be, (v, i) => v - bs[i])) / 0.08);
    expect(b.nv).toBe((NS + 1) * (J + 1));
    expect(b.ni).toBe(6 * NS * J);
    expect(b.grew).toBe(true);
    // rows run from the core to the rim along both borders
    for (let i = 0; i <= NS; i++) {
      const r = (0.17 + (0.83 * i) / NS) * 100;
      const first = i * (J + 1);
      const last = first + J;
      expect(Math.atan2(b.pos[2 * first + 1], b.pos[2 * first])).toBeCloseTo(bs[i], 5);
      expect(Math.atan2(b.pos[2 * last + 1], b.pos[2 * last])).toBeCloseTo(be[i], 5);
      expect(Math.hypot(b.pos[2 * first], b.pos[2 * first + 1])).toBeCloseTo(r, 3);
    }
    // the triangles tile the sector: their areas sum to the annular sector's area (borders nearly straight)
    let area = 0;
    for (let t = 0; t < b.ni; t += 3) {
      const [p, q, s] = [b.idx[t], b.idx[t + 1], b.idx[t + 2]];
      const ax = b.pos[2 * p];
      const ay = b.pos[2 * p + 1];
      area += Math.abs((b.pos[2 * q] - ax) * (b.pos[2 * s + 1] - ay) - (b.pos[2 * s] - ax) * (b.pos[2 * q + 1] - ay)) / 2;
    }
    const span = 1.6; // ≈ be − bs
    expect(area).toBeGreaterThan(0.9 * (span / 2) * (100 ** 2 - 17 ** 2));
    expect(area).toBeLessThan(1.1 * (span / 2) * (100 ** 2 - 17 ** 2));
  });
});
