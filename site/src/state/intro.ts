export const VISITED_KEY = 'aiwar.visited';

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };

/** First visit → play the whole war from 2022-11; later visits (or no usable storage) → start at the present, paused. */
export function initialPlayback(storage: KV | null, lastIndex: number): { t: number; playing: boolean; intro: boolean } {
  const present = { t: lastIndex, playing: false, intro: false };
  if (!storage) return present;
  try {
    const visited = storage.getItem(VISITED_KEY) === '1';
    storage.setItem(VISITED_KEY, '1');
    return visited ? present : { t: 0, playing: true, intro: true };
  } catch {
    return present;
  }
}
