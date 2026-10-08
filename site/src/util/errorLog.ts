/**
 * Errors that must not stop the app (a frame-loop step, a store subscriber): log the first occurrence of each distinct
 * message, swallow the repeats — a bug that throws on every frame would otherwise flood the console 60 times a second.
 */

/** 'TypeError: x is undefined' for an Error, the plain string otherwise. */
export function errorKey(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/**
 * Returns `report(err)`: logs `err` through `log` (default `console.error`) the first time its message is seen and
 * returns true; false for a repeat. At most `max` distinct messages are remembered (and logged).
 */
export function createErrorLog(scope: string, log: (...args: unknown[]) => void = (...a) => console.error(...a), max = 50): (err: unknown) => boolean {
  const seen = new Set<string>();
  return (err) => {
    const key = errorKey(err);
    if (seen.has(key) || seen.size >= max) return false;
    seen.add(key);
    log(`AI WAR: ${scope} failed (logged once, the app keeps running)`, err);
    return true;
  };
}
