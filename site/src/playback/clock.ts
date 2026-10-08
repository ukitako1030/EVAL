export const BASE_SECONDS_PER_MONTH = 1.4;
export const HOLD_SECONDS: Record<1 | 2 | 4, number> = { 1: 2, 2: 1.5, 4: 0.8 };

export interface PlaybackState {
  t: number;
  playing: boolean;
  speed: 1 | 2 | 4;
}

export interface TickResult extends PlaybackState {
  /** whole-month indices entered during this tick (for battle-news banners) */
  crossed: number[];
  holding: boolean;
}

export function createPlayback(opts: { lastIndex: number; eventMonths: ReadonlySet<number> }) {
  let hold = 0;
  return {
    tick(dt: number, st: PlaybackState): TickResult {
      if (!st.playing) {
        hold = 0;
        return { ...st, crossed: [], holding: false };
      }
      if (hold > 0) {
        hold = Math.max(0, hold - dt);
        return { ...st, crossed: [], holding: hold > 0 };
      }
      const from = st.t;
      let to = Math.min(opts.lastIndex, from + (dt * st.speed) / BASE_SECONDS_PER_MONTH);
      const crossed: number[] = [];
      for (let m = Math.floor(from + 1e-9) + 1; m <= Math.floor(to + 1e-9); m++) {
        crossed.push(m);
        if (opts.eventMonths.has(m)) {
          to = m;
          hold = HOLD_SECONDS[st.speed];
          break;
        }
      }
      return { t: to, playing: to < opts.lastIndex, speed: st.speed, crossed, holding: hold > 0 };
    },
    reset() {
      hold = 0;
    },
  };
}
