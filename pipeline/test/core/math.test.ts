import { describe, it, expect } from 'vitest';
import { clamp, sigmoid, logit, weightedMean, mean, sum, trailingMean, logInterp, round1 } from '../../src/core/math';

describe('math', () => {
  it('clamp/sigmoid/logit', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(sigmoid(0)).toBe(0.5);
    expect(logit(0.5)).toBe(0);
    expect(sigmoid(logit(0.8))).toBeCloseTo(0.8, 10);
  });
  it('weightedMean ignores non-positive weights and returns null when empty', () => {
    expect(weightedMean([{ value: 10, weight: 1 }, { value: 20, weight: 3 }])).toBe(17.5);
    expect(weightedMean([{ value: 10, weight: 0 }])).toBeNull();
    expect(weightedMean([])).toBeNull();
  });
  it('mean/sum', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBeNull();
    expect(sum([1, 2, 3])).toBe(6);
  });
  it('trailingMean skips nulls and keeps null where the current value is null', () => {
    expect(trailingMean([1, 3, null, 5, 7], 3)).toEqual([1, 2, null, 4, 6]);
  });
  it('logInterp interpolates geometrically', () => {
    expect(logInterp(0, 100, 10, 10000, 5)).toBeCloseTo(1000, 6);
    expect(logInterp(3, 50, 3, 80, 3)).toBe(50);
  });
  it('round1', () => {
    expect(round1(12.345)).toBe(12.3);
    expect(round1(12.35)).toBe(12.4);
  });
});
