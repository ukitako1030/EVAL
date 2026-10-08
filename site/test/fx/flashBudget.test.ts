import { describe, it, expect } from 'vitest';
import { createFlashBudget } from '../../src/fx/flashBudget';

describe('flash budget', () => {
  it('grants at most 3 flashes per rolling second and caps intensity', () => {
    const b = createFlashBudget({ maxPerSecond: 3, maxIntensity: 0.35 });
    expect(b.request(1, 0)).toBe(0.35);
    expect(b.request(0.2, 0.1)).toBe(0.2);
    expect(b.request(0.5, 0.2)).toBe(0.35);
    expect(b.request(0.5, 0.3)).toBe(0); // 4th within 1 s denied
    expect(b.request(0.5, 1.05)).toBe(0.35); // the first grant (t=0) left the window
  });
});
