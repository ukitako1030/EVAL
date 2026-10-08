import { describe, it, expect } from 'vitest';
import { strengthConfidence, scaleConfidence, unitConfidence } from '../../src/compute/confidence';

describe('confidence', () => {
  it('strength', () => {
    expect(strengthConfidence({ measured: 2, reconstructed: 0, estimated: false })).toBe('high');
    expect(strengthConfidence({ measured: 1, reconstructed: 1, estimated: false })).toBe('medium');
    expect(strengthConfidence({ measured: 0, reconstructed: 1, estimated: false })).toBe('reconstructed');
    expect(strengthConfidence({ measured: 0, reconstructed: 0, estimated: true })).toBe('estimated');
  });
  it('scale', () => {
    expect(scaleConfidence(3)).toBe('high');
    expect(scaleConfidence(2)).toBe('high');
    expect(scaleConfidence(1)).toBe('medium');
    expect(scaleConfidence(0)).toBe('estimated');
  });
  it('unit = weaker of the two', () => {
    expect(unitConfidence({ measured: 2, reconstructed: 0, estimated: false }, 1)).toBe('medium');
    expect(unitConfidence({ measured: 0, reconstructed: 2, estimated: false }, 3)).toBe('reconstructed');
  });
});
