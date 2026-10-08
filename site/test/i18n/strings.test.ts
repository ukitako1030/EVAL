import { describe, it, expect } from 'vitest';
import { STRINGS, tr } from '../../src/i18n/strings';

describe('i18n', () => {
  it('every key has non-empty ja and en text', () => {
    for (const [k, v] of Object.entries(STRINGS)) {
      expect(v.ja.length, k).toBeGreaterThan(0);
      expect(v.en.length, k).toBeGreaterThan(0);
    }
  });
  it('tr picks the language', () => {
    expect(tr('strength', 'ja')).toBe('強さ');
    expect(tr('strength', 'en')).toBe('Strength');
  });
});
