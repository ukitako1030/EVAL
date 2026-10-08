import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMethod } from '../../src/config/load';

/** The committed config/method.yaml. */
const method = parseMethod(readFileSync(new URL('../../config/method.yaml', import.meta.url), 'utf8'));

describe('config/method.yaml', () => {
  it('lets stale strength sources fade out over 6 months', () => {
    expect(method.strength.fadeMonths).toBe(6);
  });
  it('reports a strength surge from +8 points', () => {
    expect(method.events.surgeStrength).toBe(8);
  });
});
