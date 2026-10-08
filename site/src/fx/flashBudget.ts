/**
 * How long a granted flash occupies a slot (s). Longer than one second so that `maxPerSecond + 1` grants can never fall
 * inside any closed 1 s interval: with a window of exactly 1 s, grants at t=0 and t=1.0 (plus two in between) would
 * be four flashes in [0, 1].
 */
export const FLASH_WINDOW_SECONDS = 1.2;

/**
 * Global limiter for every light flash (spec §9.5, WCAG 2.3.1): at most `maxPerSecond` flashes in any 1 s interval,
 * each capped at `maxIntensity` (0..1 of the effect's own maximum). Callers must route ALL flashes through it.
 * Returns the intensity to use, or 0 when the flash is denied (also for a non-finite `now` or an intensity that is not > 0;
 * those never use up a slot).
 */
export function createFlashBudget(opts: { maxPerSecond: number; maxIntensity: number }) {
  let granted: number[] = [];
  return {
    request(intensity: number, now: number): number {
      if (!Number.isFinite(now) || !(intensity > 0)) return 0;
      granted = granted.filter((t) => now - t < FLASH_WINDOW_SECONDS);
      if (granted.length >= opts.maxPerSecond) return 0;
      granted.push(now);
      return Math.min(intensity, opts.maxIntensity);
    },
  };
}

export type FlashBudget = ReturnType<typeof createFlashBudget>;

export interface FlashLogStats {
  granted: number;
  denied: number;
  /** most grants seen in any closed 1 s interval of `clock` time */
  maxPerSecond: number;
  /** [whole second of `clock`, grants in it] for every second that had a request */
  perSecond: [number, number][];
}

/**
 * Debug wrapper (`?debugFlash`): passes every request through to `budget` and, once per second of `clock` time
 * (real time, e.g. `performance.now() / 1000`), logs how many flashes were granted / denied in the previous second
 * and the most grants seen in any 1 s window so far. `stats` stays live for inspection.
 */
export function logFlashes(budget: FlashBudget, opts: { clock: () => number; log: (msg: string) => void }): { budget: FlashBudget; stats: FlashLogStats } {
  const stats: FlashLogStats = { granted: 0, denied: 0, maxPerSecond: 0, perSecond: [] };
  const recent: number[] = [];
  let sec = Number.NaN;
  let secGranted = 0;
  let secDenied = 0;
  const flush = () => {
    if (!Number.isFinite(sec)) return;
    stats.perSecond.push([sec, secGranted]);
    opts.log(`[flash] ${sec}s: ${secGranted} granted, ${secDenied} denied · max in any 1 s so far: ${stats.maxPerSecond}`);
  };
  return {
    stats,
    budget: {
      request(intensity, now) {
        const g = budget.request(intensity, now);
        const t = opts.clock();
        const s = Math.floor(t);
        if (s !== sec) {
          flush();
          sec = s;
          secGranted = 0;
          secDenied = 0;
        }
        if (g > 0) {
          stats.granted++;
          secGranted++;
          recent.push(t);
          while (recent.length && t - recent[0] > 1) recent.shift();
          stats.maxPerSecond = Math.max(stats.maxPerSecond, recent.length);
        } else {
          stats.denied++;
          secDenied++;
        }
        return g;
      },
    },
  };
}
