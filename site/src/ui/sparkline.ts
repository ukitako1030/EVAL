import type { UnitMonth } from '../data/types';
import { clamp, svg } from './dom';

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * SVG path for a series over a `w` × `h` box (`lo` at the bottom, `hi` at the top). A null (or non-finite) value lifts
 * the pen, so gaps stay gaps; a point with no neighbour becomes a zero-length stroke (a dot with round caps).
 */
export function sparkPath(values: readonly (number | null)[], w: number, h: number, lo = 0, hi = 100): string {
  const n = values.length;
  const x = (i: number) => r1(n > 1 ? (i / (n - 1)) * w : w / 2);
  const y = (v: number) => r1(h - ((clamp(v, lo, hi) - lo) / (hi - lo || 1)) * h);
  const parts: string[] = [];
  let run = 0;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (run === 1) parts.push('h0');
      run = 0;
      return;
    }
    parts.push(`${run ? 'L' : 'M'}${x(i)} ${y(v)}`);
    run++;
  });
  if (run === 1) parts.push('h0');
  return parts.join(' ');
}

export const SPARK_W = 300;
export const SPARK_H = 64;

/** Strength (solid) and scale (dashed) over all months, 0–100, with the current month marked. */
export function sparkline(cells: readonly (UnitMonth | null)[], current: number, labels: { strength: string; scale: string }): SVGSVGElement {
  const n = cells.length;
  const x = n > 1 ? (current / (n - 1)) * SPARK_W : SPARK_W / 2;
  const cur = cells[current];
  const dot = (v: number, cls: string) => svg('circle', { class: cls, cx: r1(x), cy: r1(SPARK_H - (clamp(v, 0, 100) / 100) * SPARK_H), r: 2.5 });
  return svg('svg', { class: 'spark', viewBox: `0 0 ${SPARK_W} ${SPARK_H}`, role: 'img', 'aria-label': `${labels.strength} / ${labels.scale}` }, [
    svg('line', { class: 'spark-grid', x1: 0, x2: SPARK_W, y1: SPARK_H / 2, y2: SPARK_H / 2 }),
    svg('path', { class: 'spark-c', d: sparkPath(cells.map((c) => c?.c ?? null), SPARK_W, SPARK_H) }),
    svg('path', { class: 'spark-s', d: sparkPath(cells.map((c) => c?.s ?? null), SPARK_W, SPARK_H) }),
    svg('line', { class: 'spark-now', x1: r1(x), x2: r1(x), y1: 0, y2: SPARK_H }),
    cur ? dot(cur.c, 'spark-dot-c') : null,
    cur ? dot(cur.s, 'spark-dot-s') : null,
  ]);
}
