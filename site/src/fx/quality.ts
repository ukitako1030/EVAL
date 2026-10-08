/** 0 full · 1 no bloom · 2 + render resolution 0.75 · 3 + half particles. Only ever steps down (stable visuals). */
export type QualityLevel = 0 | 1 | 2 | 3;

/** A frame longer than this is a stall (hidden tab, GC pause, debugger), not a measure of rendering speed. */
export const MAX_FRAME_DT = 0.25;
/** Consecutive slow windows required before the level steps down. */
export const SLOW_WINDOWS_TO_STEP = 2;
/** Frames whose update + render work takes at least this share of the frame interval are limited by the app. */
export const BUSY_SHARE = 0.5;
/**
 * Frame intervals steadier than this (coefficient of variation) come from a display / browser rate limit (a 50 Hz
 * monitor, a 30 fps power-saving cap), not from frames the GPU cannot finish — those drop vsyncs irregularly.
 */
export const STEADY_CV = 0.15;

/**
 * Steps the render quality down when the app cannot keep up. A window is slow when its frame rate is below 85 % of
 * `targetFps` AND the app is the cause: its frames are busy (work ≥ `BUSY_SHARE` of the interval) or irregular
 * (dropped vsyncs, e.g. GPU-bound). A steady lower rate with cheap frames is the display's (50 Hz, a 30 fps cap) and
 * never costs quality. `work` is the frame's measured update + render time (s); without it, the rate alone decides.
 */
export function createQualityGovernor(opts: { targetFps: number; window: number }) {
  let level: QualityLevel = 0;
  let frames = 0;
  let elapsed = 0;
  let sumSq = 0;
  let workSum = 0;
  let workN = 0;
  let startup = true; // the first window after creation (shader compile, asset decode) is never judged
  let slowStreak = 0;
  const reset = () => {
    frames = 0;
    elapsed = 0;
    sumSq = 0;
    workSum = 0;
    workN = 0;
  };
  return {
    frame(_now: number, dt: number, work?: number): QualityLevel {
      if (!Number.isFinite(dt) || dt > MAX_FRAME_DT) {
        // a stall says nothing about steady-state speed: throw away the window it interrupted
        reset();
        return level;
      }
      if (dt <= 0) return level;
      frames++;
      elapsed += dt;
      sumSq += dt * dt;
      if (work !== undefined && Number.isFinite(work) && work >= 0) {
        workSum += work;
        workN++;
      }
      if (elapsed >= opts.window) {
        const mean = elapsed / frames;
        const cv = Math.sqrt(Math.max(0, sumSq / frames - mean * mean)) / mean;
        const busy = workN === 0 || workSum / workN >= BUSY_SHARE * mean;
        const slow = frames / elapsed < opts.targetFps * 0.85 && (busy || cv >= STEADY_CV);
        reset();
        if (startup) startup = false;
        else if (!slow) slowStreak = 0;
        else if (++slowStreak >= SLOW_WINDOWS_TO_STEP) {
          slowStreak = 0;
          if (level < 3) level = (level + 1) as QualityLevel;
        }
      }
      return level;
    },
    get level() {
      return level;
    },
  };
}
