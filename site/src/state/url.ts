import type { World } from '../data/types';
import { clampT } from '../data/timeline';
import type { AppState } from './store';

export function encodeUrl(state: Pick<AppState, 'front' | 't' | 'lang'>, world: World): string {
  const p = new URLSearchParams();
  if (state.front) p.set('front', state.front);
  p.set('t', world.months[Math.floor(clampT(world, state.t) + 1e-9)]);
  p.set('lang', state.lang);
  return `?${p.toString()}`;
}

export function decodeUrl(search: string, world: World): Partial<AppState> {
  const p = new URLSearchParams(search);
  const out: Partial<AppState> = {};
  const f = p.get('front');
  if (f && world.fronts.some((x) => x.id === f)) out.front = f as AppState['front'];
  const m = p.get('t');
  if (m) {
    const i = world.months.indexOf(m);
    if (i >= 0) out.t = i;
  }
  const l = p.get('lang');
  if (l === 'ja' || l === 'en') out.lang = l;
  return out;
}
