import { describe, it, expect } from 'vitest';
import { STRINGS, tr } from '../../src/i18n/strings';

describe('i18n', () => {
  it('every key has non-empty ja and en text', () => {
    for (const [k, v] of Object.entries(STRINGS)) {
      expect(v.ja.length, k).toBeGreaterThan(0);
      expect(v.en.length, k).toBeGreaterThan(0);
    }
  });
  it('has the keys the panels and controls need', () => {
    const keys = ['speed', 'weight', 'value', 'source', 'vsLastMonth', 'showAll', 'galaxyMap', 'close', 'language', 'scaleBreakdown', 'strengthBreakdown'] as const;
    for (const k of keys) expect(STRINGS, k).toHaveProperty(k);
    expect(tr('scaleBreakdown', 'ja')).toBe('規模の内訳');
    expect(tr('scaleBreakdown', 'en')).toBe('How scale is made');
    expect(tr('strengthBreakdown', 'ja')).toBe('強さの内訳');
    expect(tr('strengthBreakdown', 'en')).toBe('How strength is made');
  });
  it('English is sentence case: only the first word (and acronyms) start with a capital', () => {
    for (const [k, v] of Object.entries(STRINGS)) {
      const later = v.en.split(/\s+/).slice(1);
      for (const w of later) expect(/^[A-Z][a-z]/.test(w), `${k}: "${v.en}" (${w})`).toBe(false);
    }
  });
  it('tr picks the language', () => {
    expect(tr('strength', 'ja')).toBe('強さ');
    expect(tr('strength', 'en')).toBe('Strength');
  });
});
