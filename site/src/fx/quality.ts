/** 0 full · 1 no bloom · 2 + render resolution 0.75 · 3 + half particles. Only ever steps down (stable visuals). */
export type QualityLevel = 0 | 1 | 2 | 3;

/** A frame longer than this is a stall (hidden tab, GC pause, debugger), not a measure of rendering speed. */
export const MAX_FRAME_DT = 0.25;
/** Consecutive slow windows required before the level steps down. */
export const SLOW_WINDOWS_TO_STEP = 2;

export function createQualityGovernor(opts: { targetFps: number; window: number }) {
  let level: QualityLevel = 0;
  let frames = 0;
  let elapsed = 0;
  let startup = true; // the first window after creation (shader compile, asset decode) is never judged
  let slowStreak = 0;
  return {
    frame(_now: number, dt: number): QualityLevel {
      if (!Number.isFinite(dt) || dt > MAX_FRAME_DT) {
        // a stall says nothing about steady-state speed: throw away the window it interrupted
        frames = 0;
        elapsed = 0;
        return level;
      }
      if (dt <= 0) return level;
      frames++;
      elapsed += dt;
      if (elapsed >= opts.window) {
        const slow = frames / elapsed < opts.targetFps * 0.85;
        frames = 0;
        elapsed = 0;
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
