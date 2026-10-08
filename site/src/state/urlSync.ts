import type { World } from '../data/types';
import { monthIndex } from '../data/timeline';
import type { AppState, Store } from './store';
import { encodeUrl } from './url';

/** Minimum gap between two address-bar writes (ms). */
export const URL_THROTTLE_MS = 350;
/** The parameters `encodeUrl` owns. */
const SHARE_KEYS = new Set(['front', 't', 'lang']);
/** Debug switches main.ts honours in dev builds only (`?quality`, `?hover`, `?debugFlash`); never carried along otherwise. */
export const DEBUG_KEYS: ReadonlySet<string> = new Set(['quality', 'hover', 'debugFlash']);

/**
 * The query string for `state`: the shareable parameters (`encodeUrl`), then every other parameter of `current` —
 * except the debug switches, unless `keepDebug` (dev builds). An absent `front` means the galaxy, so an old `front`
 * is dropped.
 */
export function nextSearch(state: Pick<AppState, 'front' | 't' | 'lang'>, world: World, current: string, opts: { keepDebug?: boolean } = {}): string {
  const next = new URLSearchParams(encodeUrl(state, world));
  for (const [k, v] of new URLSearchParams(current)) if (!SHARE_KEYS.has(k) && (opts.keepDebug || !DEBUG_KEYS.has(k))) next.append(k, v);
  return `?${next.toString()}`;
}

/**
 * Keeps the address bar shareable: writes `nextSearch(...)` through `io.write` (main.ts: `history.replaceState`, so no
 * history entry) once at the start — so a fresh visit's address already says `t` / `front` / `lang` — and then whenever
 * the front, the whole month or the language changes, at most once per `minInterval` ms, always ending on the latest
 * state. `io.keepDebug` keeps the debug switches (dev builds). Returns a function that stops syncing.
 */
export function syncUrl(
  store: Store<AppState>,
  world: World,
  io: { read(): string; write(search: string): void; keepDebug?: boolean },
  minInterval = URL_THROTTLE_MS,
): () => void {
  const opts = { keepDebug: !!io.keepDebug };
  const keyOf = (s: AppState) => `${s.front ?? ''}|${monthIndex(world, s.t)}|${s.lang}`;
  let key = keyOf(store.get());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastWrite = -Infinity;
  const flush = () => {
    timer = undefined;
    lastWrite = Date.now();
    io.write(nextSearch(store.get(), world, io.read(), opts));
  };
  // the starting state (not throttled: it is one write, and the next change should not wait for it)
  const current = io.read();
  const initial = nextSearch(store.get(), world, current, opts);
  if (initial !== current) io.write(initial);
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
