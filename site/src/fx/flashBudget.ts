/**
 * Global limiter for every light flash (spec §9.5, WCAG 2.3.1): at most `maxPerSecond` flashes in any rolling
 * second, each capped at `maxIntensity` (0..1 of the effect's own maximum). Callers must route ALL flashes through it.
 */
export function createFlashBudget(opts: { maxPerSecond: number; maxIntensity: number }) {
  let granted: number[] = [];
  return {
    request(intensity: number, now: number): number {
      granted = granted.filter((t) => now - t < 1);
      if (granted.length >= opts.maxPerSecond) return 0;
      granted.push(now);
      return Math.min(Math.max(intensity, 0), opts.maxIntensity);
    },
  };
}
