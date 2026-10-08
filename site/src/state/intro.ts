export const VISITED_KEY = 'aiwar.visited';

export type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };

/** `window.localStorage`, or null when the browser refuses access (blocked site data, sandboxed iframe, no window). */
export function safeLocalStorage(): KV | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * First visit → play the whole war from 2022-11; later visits (or no usable storage) → start at the present, paused.
 * A shared link (`sharedLink`) always opens at the present, paused, and does not use up the first-visit intro.
 */
export function initialPlayback(
  storage: KV | null,
  lastIndex: number,
  opts: { sharedLink?: boolean } = {},
): { t: number; playing: boolean; intro: boolean } {
  const present = { t: lastIndex, playing: false, intro: false };
  if (opts.sharedLink || !storage) return present;
  try {
    const visited = storage.getItem(VISITED_KEY) === '1';
    storage.setItem(VISITED_KEY, '1');
    return visited ? present : { t: 0, playing: true, intro: true };
  } catch {
    return present;
  }
}
