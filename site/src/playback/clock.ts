export const BASE_SECONDS_PER_MONTH = 1.4;
/** Longest step a single tick may advance (s); a stalled tab or a long GC pause must not skip months. */
export const MAX_DT = 0.25;
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

/**
 * What a store change that the playback tick did NOT make (`ticking` false: the visitor scrubbed, stepped, pressed
 * play…) means for the battle news, within one front: `clear` — `t` moved, so queued news is stale; `fromTop` — playback
 * is (now) on at month 0 because the visitor moved there or pressed play there, so the opening news and its hold must
 * run (playback never "crosses" month 0).
 */
export function newsAfterChange(
  s: { t: number; playing: boolean; front: string | null },
  prev: { t: number; playing: boolean; front: string | null },
  ticking: boolean,
): { clear: boolean; fromTop: boolean } {
  if (ticking || s.front !== prev.front) return { clear: false, fromTop: false };
  const moved = s.t !== prev.t;
  const pressedPlay = s.playing && !prev.playing;
  return { clear: moved, fromTop: s.playing && (moved || pressedPlay) && Math.floor(Math.max(0, s.t) + 1e-9) === 0 };
}

/** The app caps every month's hold at this many seconds (a month with many banners must not stall playback). */
export const MAX_HOLD_SECONDS = 6;

/**
 * How many of a month's `count` banners playback holds for at `speed` when each month's hold is capped at `maxSeconds`:
 * the largest number with `HOLD_SECONDS[speed] × n ≤ maxSeconds` (at least 1, so a month with news always pauses).
 */
export function cappedHoldCount(count: number, speed: 1 | 2 | 4, maxSeconds = Infinity): number {
  if (!(count > 0)) return 0;
  const most = Math.max(1, Math.floor(maxSeconds / HOLD_SECONDS[speed] + 1e-9));
  return Math.min(Math.floor(count), most);
}

/**
 * `eventMonths`: month index → number of banners that month; playback holds `HOLD_SECONDS[speed]` per banner, the
 * number of banners clamped so one month never holds longer than `maxHoldSeconds` (default: no cap).
 */
export function createPlayback(opts: { lastIndex: number; eventMonths: ReadonlyMap<number, number>; maxHoldSeconds?: number }) {
  let hold = 0;
  let heldMonth = -1; // the month the current hold belongs to
  const holdFor = (m: number, speed: 1 | 2 | 4) => HOLD_SECONDS[speed] * cappedHoldCount(opts.eventMonths.get(m) ?? 0, speed, opts.maxHoldSeconds);
  return {
    tick(rawDt: number, st: PlaybackState): TickResult {
      if (!st.playing) {
        hold = 0;
        heldMonth = -1;
        return { ...st, crossed: [], holding: false };
      }
      if (!Number.isFinite(rawDt) || rawDt <= 0) return { ...st, crossed: [], holding: hold > 0 };
      const dt = Math.min(rawDt, MAX_DT);
      if (hold > 0 && Math.floor(st.t + 1e-9) !== heldMonth) hold = 0; // the user scrubbed / stepped away from the held month
      if (hold > 0) {
        hold = Math.max(0, hold - dt);
        return { ...st, crossed: [], holding: hold > 0 };
      }
      const from = st.t;
      let to = Math.min(opts.lastIndex, from + (dt * st.speed) / BASE_SECONDS_PER_MONTH);
      const crossed: number[] = [];
      for (let m = Math.floor(from + 1e-9) + 1; m <= Math.floor(to + 1e-9); m++) {
        crossed.push(m);
        const secs = holdFor(m, st.speed);
        if (secs > 0 && m < opts.lastIndex) {
          to = m;
          hold = secs;
          heldMonth = m;
          break;
        }
      }
      return { t: to, playing: to < opts.lastIndex, speed: st.speed, crossed, holding: hold > 0 };
    },
    /**
     * Start holding on whole month `month` as if playback had just reached it (e.g. month 0 when the intro starts, which
     * playback never "crosses"). No-op for a month without banners or for the last month.
     */
    holdAt(month: number, speed: 1 | 2 | 4) {
      const secs = month < opts.lastIndex ? holdFor(month, speed) : 0;
      if (secs <= 0) return;
      hold = secs;
      heldMonth = month;
    },
    reset() {
      hold = 0;
      heldMonth = -1;
    },
  };
}
