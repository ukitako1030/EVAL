import type { World } from '../data/types';
import { monthIndex } from '../data/timeline';
import type { AppState, Store } from './store';
import { encodeUrl } from './url';

/** Minimum gap between two address-bar writes (ms). */
export const URL_THROTTLE_MS = 350;
/** The parameters `encodeUrl` owns. */
const SHARE_KEYS = new Set(['front', 't', 'lang']);

/**
 * The query string for `state`: the shareable parameters (`encodeUrl`), then every other parameter of `current`
 * (debug switches such as `?quality`). An absent `front` means the galaxy, so an old `front` is dropped.
 */
export function nextSearch(state: Pick<AppState, 'front' | 't' | 'lang'>, world: World, current: string): string {
  const next = new URLSearchParams(encodeUrl(state, world));
  for (const [k, v] of new URLSearchParams(current)) if (!SHARE_KEYS.has(k)) next.append(k, v);
  return `?${next.toString()}`;
}

/**
 * Keeps the address bar shareable: whenever the front, the whole month or the language changes, writes
 * `nextSearch(...)` through `io.write` (main.ts: `history.replaceState`) — at most once per `minInterval` ms, always
 * ending on the latest state. Returns a function that stops syncing.
 */
export function syncUrl(
  store: Store<AppState>,
  world: World,
  io: { read(): string; write(search: string): void },
  minInterval = URL_THROTTLE_MS,
): () => void {
  const keyOf = (s: AppState) => `${s.front ?? ''}|${monthIndex(world, s.t)}|${s.lang}`;
  let key = keyOf(store.get());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastWrite = -Infinity;
  const flush = () => {
    timer = undefined;
    lastWrite = Date.now();
    io.write(nextSearch(store.get(), world, io.read()));
  };
  const unsubscribe = store.subscribe((s) => {
    const k = keyOf(s);
    if (k === key) return;
    key = k;
    if (timer === undefined) timer = setTimeout(flush, Math.max(0, lastWrite + minInterval - Date.now()));
  });
  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}
