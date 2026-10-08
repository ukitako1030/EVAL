import { describe, it, expect } from 'vitest';
import { colorGain, hexColor, luminance, mixColor } from '../../src/render/color';

describe('colour helpers', () => {
  it('parses #rrggbb and falls back to grey', () => {
    expect(hexColor('#4c8dff')).toBe(0x4c8dff);
    expect(hexColor('19C37D')).toBe(0x19c37d);
    expect(hexColor('nope')).toBe(0x888888);
  });

  it('mixes channel by channel and clamps t', () => {
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixColor(0xff0000, 0x0000ff, 0)).toBe(0xff0000);
    expect(mixColor(0xff0000, 0x0000ff, 2)).toBe(0x0000ff);
    expect(mixColor(0x102030, 0x405060, Number.NaN)).toBe(0x102030);
  });

  it('tones down only light colours, never below half', () => {
    expect(colorGain(0x4c8dff)).toBe(1); // Google blue
    expect(colorGain(0x19c37d)).toBeGreaterThan(0.9); // OpenAI green: barely touched
    expect(colorGain(0xe6e8f2)).toBeLessThan(0.65); // xAI near-white
    expect(colorGain(0xffffff)).toBeCloseTo(0.5, 12);
    expect(luminance(0xffffff)).toBeCloseTo(1, 12);
    expect(luminance(0)).toBe(0);
  });
});
