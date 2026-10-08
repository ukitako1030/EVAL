export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
export const logit = (p: number): number => Math.log(p / (1 - p));

export function sum(xs: Iterable<number>): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs: number[]): number | null {
  return xs.length ? sum(xs) / xs.length : null;
}

export function weightedMean(items: { value: number; weight: number }[]): number | null {
  let sw = 0;
  let s = 0;
  for (const it of items) {
    if (it.weight > 0 && Number.isFinite(it.value)) {
      sw += it.weight;
      s += it.weight * it.value;
    }
  }
  return sw > 0 ? s / sw : null;
}

/**
 * Mean of the non-null values among the last `window` positions ending at i (nulls inside the window are skipped,
 * not replaced by earlier values); null where series[i] is null.
 */
export function trailingMean(series: (number | null)[], window: number): (number | null)[] {
  return series.map((cur, i) => {
    if (cur === null) return null;
    const vals = series.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v !== null);
    return sum(vals) / vals.length;
  });
}

/** Geometric interpolation between (x0,y0) and (x1,y1); y values must be > 0. */
export function logInterp(x0: number, y0: number, x1: number, y1: number, x: number): number {
  if (x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return Math.exp(Math.log(y0) + (Math.log(y1) - Math.log(y0)) * t);
}

export const round1 = (x: number): number => Math.round(x * 10 + Number.EPSILON) / 10;
export const round3 = (x: number): number => Math.round(x * 1000 + Number.EPSILON) / 1000;
