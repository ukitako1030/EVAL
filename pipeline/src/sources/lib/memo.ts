const cache = new Map<string, Promise<Uint8Array>>();

/**
 * Process-level cache so that two modules sharing one download (e.g. Arena text_style_control) fetch it once.
 * Concurrent callers share the same in-flight promise; a failed load is not cached, so a later call can retry.
 */
export function memoBytes(key: string, load: () => Promise<Uint8Array>): Promise<Uint8Array> {
  let hit = cache.get(key);
  if (!hit) {
    hit = load();
    cache.set(key, hit);
    hit.catch(() => {
      if (cache.get(key) === hit) cache.delete(key);
    });
  }
  return hit;
}
