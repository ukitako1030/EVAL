import type { FrontId, Lang } from '../data/types';
import type { SortBy } from '../data/timeline';
import { createErrorLog } from '../util/errorLog';

export interface AppState {
  /** fractional month index into world.months */
  t: number;
  playing: boolean;
  speed: 1 | 2 | 4;
  /** null = galaxy overview */
  front: FrontId | null;
  lang: Lang;
  hoverOrg: string | null;
  selectedUnit: string | null;
  sortBy: SortBy;
  reducedMotion: boolean;
  /** first-visit "war begins" run */
  intro: boolean;
}

export function defaultState(lastIndex: number): AppState {
  return { t: lastIndex, playing: false, speed: 1, front: null, lang: 'ja', hoverOrg: null, selectedUnit: null, sortBy: 'strength', reducedMotion: false, intro: false };
}

export interface Store<S> {
  get(): S;
  set(patch: Partial<S>): void;
  subscribe(fn: (state: S, prev: S) => void): () => void;
}

/**
 * `onError` receives what a subscriber throws (default: logged once per distinct message). Each subscriber runs in its
 * own try / catch, so one broken view cannot keep the others — or the caller of `set` — from seeing the new state.
 */
export function createStore<S extends object>(initial: S, opts: { onError?: (err: unknown) => void } = {}): Store<S> {
  let state = initial;
  const subs = new Set<(s: S, p: S) => void>();
  const onError = opts.onError ?? createErrorLog('a store subscriber');
  return {
    get: () => state,
    set(patch) {
      const keys = Object.keys(patch) as (keyof S)[];
      if (keys.every((k) => Object.is(state[k], patch[k]))) return;
      const prev = state;
      state = { ...state, ...patch };
      for (const fn of subs) {
        try {
          fn(state, prev);
        } catch (err) {
          onError(err);
        }
      }
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}
