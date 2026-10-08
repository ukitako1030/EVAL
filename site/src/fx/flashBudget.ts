/**
 * How long a granted flash occupies a slot (s). Longer than one second so that `maxPerSecond + 1` grants can never fall
 * inside any closed 1 s interval: with a window of exactly 1 s, grants at t=0 and t=1.0 (plus two in between) would
 * be four flashes in [0, 1].
 */
export const FLASH_WINDOW_SECONDS = 1.2;

/**
 * Slots an ambient flash (a frontline boom: there is always another one coming) must leave free, so the battle's
 * background chatter can never use up the flashes that news shockwaves, warp-ins and glow rises ask for.
 */
export const AMBIENT_RESERVE = 1;

/** Under prefers-reduced-motion every granted flash is this much dimmer (see `scaleGrants`). */
export const REDUCED_MOTION_FLASH = 0.3;

export interface FlashBudget {
  /**
   * Ask for a flash of `intensity` at `now` (s). Returns the intensity to use, or 0 when denied. `reserve` (default 0):
   * grant only if at least that many slots stay free afterwards (ambient effects pass `AMBIENT_RESERVE`).
   */
  request(intensity: number, now: number, reserve?: number): number;
}

/**
 * Global limiter for every light flash (spec §9.5, WCAG 2.3.1): at most `maxPerSecond` flashes in any 1 s interval,
 * each capped at `maxIntensity` (0..1 of the effect's own maximum). Callers must route ALL flashes through it.
 * Returns the intensity to use, or 0 when the flash is denied (also for a non-finite `now` or an intensity that is not > 0;
 * those never use up a slot). Allocation-free: the grant times live in a fixed ring.
 */
export function createFlashBudget(opts: { maxPerSecond: number; maxIntensity: number }): FlashBudget {
  const max = Math.max(0, Math.floor(opts.maxPerSecond));
  const granted = new Float64Array(Math.max(1, max));
  let n = 0;
  return {
    request(intensity, now, reserve = 0) {
      if (!Number.isFinite(now) || !(intensity > 0)) return 0;
      // forget the grants that left the window (in place: the ring is tiny and in time order)
      let k = 0;
      for (let i = 0; i < n; i++) if (now - granted[i] < FLASH_WINDOW_SECONDS) granted[k++] = granted[i];
      n = k;
      if (n + Math.max(0, reserve) >= max) return 0;
      granted[n++] = now;
      return Math.min(intensity, opts.maxIntensity);
    },
  };
}

/**
 * `budget` with every granted intensity multiplied by `factor()` (main.ts: `REDUCED_MOTION_FLASH` while the visitor
 * prefers reduced motion, else 1) — the one place that makes reduced motion reduce light as well. Denials and slot
 * accounting are untouched.
 */
export function scaleGrants(budget: FlashBudget, factor: () => number): FlashBudget {
  return {
    request(intensity, now, reserve) {
      const g = budget.request(intensity, now, reserve);
      if (!(g > 0)) return 0;
      const k = factor();
      return Number.isFinite(k) && k > 0 ? g * Math.min(1, k) : g;
    },
  };
}

/** `FlashLogStats.perSecond` keeps this many seconds (the newest). */
export const FLASH_LOG_SECONDS = 600;

export interface FlashLogStats {
  granted: number;
  denied: number;
  /** most grants seen in any closed 1 s interval of `clock` time */
  maxPerSecond: number;
  /** [whole second of `clock`, grants in it] for every second that had a request (the last `FLASH_LOG_SECONDS`) */
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
    if (stats.perSecond.length > FLASH_LOG_SECONDS) stats.perSecond.splice(0, stats.perSecond.length - FLASH_LOG_SECONDS);
    opts.log(`[flash] ${sec}s: ${secGranted} granted, ${secDenied} denied · max in any 1 s so far: ${stats.maxPerSecond}`);
  };
  return {
    stats,
    budget: {
      request(intensity, now, reserve) {
        const g = budget.request(intensity, now, reserve);
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
