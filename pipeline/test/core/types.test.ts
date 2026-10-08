import { describe, it, expect } from 'vitest';
import { minConfidence, FRONT_IDS, SIGNAL_IDS, RANK_SIGNALS } from '../../src/core/types';

describe('types', () => {
  it('minConfidence picks the weaker level', () => {
    expect(minConfidence('high', 'medium')).toBe('medium');
    expect(minConfidence('reconstructed', 'high')).toBe('reconstructed');
    expect(minConfidence('estimated', 'reconstructed')).toBe('estimated');
    expect(minConfidence('high', 'high')).toBe('high');
  });
  it('declares 7 fronts and rank-type signals', () => {
    expect(FRONT_IDS).toEqual(['general', 'code', 'agent', 'image', 'video', 'speech', 'music']);
    expect(SIGNAL_IDS).toContain('announcements');
    expect([...RANK_SIGNALS].sort()).toEqual(['cloudflare', 'crux', 'tranco']);
  });
});
