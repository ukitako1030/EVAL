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
