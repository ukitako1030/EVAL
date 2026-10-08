import { describe, it, expect } from 'vitest';
import { createQualityGovernor } from '../../src/fx/quality';

describe('quality governor', () => {
  it('steps down one level per slow window, never back up, max 3', () => {
    // dt values are exact binary fractions so window boundaries are exact
    const g = createQualityGovernor({ targetFps: 64, window: 1 });
    for (let i = 0; i < 64 * 3; i++) g.frame(0, 1 / 64); // 3 windows at 64 fps
    expect(g.level).toBe(0);
    for (let i = 0; i < 32; i++) g.frame(0, 1 / 32); // 1 window at 32 fps (< 64 × 0.85)
    expect(g.level).toBe(1);
    for (let i = 0; i < 32 * 5; i++) g.frame(0, 1 / 32); // 5 more slow windows → capped at 3
    expect(g.level).toBe(3);
    for (let i = 0; i < 64 * 5; i++) g.frame(0, 1 / 64); // fast again → never steps back up
    expect(g.level).toBe(3);
  });
});
