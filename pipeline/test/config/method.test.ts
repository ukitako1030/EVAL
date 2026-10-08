import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMethod } from '../../src/config/load';
import { SignalIdSchema } from '../../src/config/schemas';

/** The committed config/method.yaml. */
const method = parseMethod(readFileSync(new URL('../../config/method.yaml', import.meta.url), 'utf8'));

describe('config/method.yaml', () => {
  it('lets stale strength sources fade out over 6 months', () => {
    expect(method.strength.fadeMonths).toBe(6);
  });
  it('reports a strength surge from +8 points', () => {
    expect(method.events.surgeStrength).toBe(8);
  });
  it('uses no Ramp signal (no usable public data); the business component rests on OpenRouter', () => {
    expect(method.scale.components.business.signals).toEqual(['openrouter']);
    for (const [name, c] of Object.entries(method.scale.components)) expect(c.signals, name).not.toContain('ramp');
    // the id stays valid, so a future Ramp source needs no schema change
    expect(SignalIdSchema.safeParse('ramp').success).toBe(true);
  });
});
