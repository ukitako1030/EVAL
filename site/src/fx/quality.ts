/** 0 full · 1 no bloom · 2 + render resolution 0.75 · 3 + half particles. Only ever steps down (stable visuals). */
export type QualityLevel = 0 | 1 | 2 | 3;

export function createQualityGovernor(opts: { targetFps: number; window: number }) {
  let level: QualityLevel = 0;
  let frames = 0;
  let elapsed = 0;
  return {
    frame(_now: number, dt: number): QualityLevel {
      frames++;
      elapsed += dt;
      if (elapsed >= opts.window) {
        const fps = frames / elapsed;
        if (fps < opts.targetFps * 0.85 && level < 3) level = (level + 1) as QualityLevel;
        frames = 0;
        elapsed = 0;
      }
      return level;
    },
    get level() {
      return level;
    },
  };
}
