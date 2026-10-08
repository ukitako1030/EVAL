import { describe, it, expect } from 'vitest';
import { detectSwipe } from '../../src/input/swipe';

describe('detectSwipe', () => {
  const p = (x: number, y: number, t: number) => ({ x, y, t });
  it('detects quick horizontal swipes', () => {
    expect(detectSwipe(p(300, 400, 0), p(200, 410, 200))).toBe('left');
    expect(detectSwipe(p(100, 400, 0), p(220, 390, 250))).toBe('right');
  });
  it('ignores short, slow or vertical gestures', () => {
    expect(detectSwipe(p(100, 400, 0), p(130, 400, 100))).toBeNull();
    expect(detectSwipe(p(100, 400, 0), p(250, 400, 900))).toBeNull();
    expect(detectSwipe(p(100, 400, 0), p(160, 520, 200))).toBeNull();
  });
});
