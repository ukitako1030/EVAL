import { describe, it, expect } from 'vitest';
import {
  MOBILE_ROW_H,
  TALL_ROW_H,
  holdOnScreen,
  layoutMode,
  mobileRowHeight,
  sheetShouldClose,
  steadyInsets,
  stepFront,
  viewportOf,
} from '../../src/ui/mobileLayout';
import { groupMonths } from '../../src/ui/timelineBar';
import { FRONT_IDS, type FrontId } from '../../src/data/types';

const fronts = FRONT_IDS.map((id) => ({ id }));

describe('layoutMode', () => {
  it('is mobile below 768 px wide or in portrait orientation', () => {
    expect(layoutMode(390, 844)).toBe('mobile');
    expect(layoutMode(360, 780)).toBe('mobile');
    expect(layoutMode(667, 375)).toBe('mobile'); // narrow, held sideways
    expect(layoutMode(768, 1024)).toBe('mobile'); // tablet portrait
    expect(layoutMode(900, 1000)).toBe('mobile'); // a tall desktop window
  });
  it('is desktop from 768 px wide in landscape', () => {
    expect(layoutMode(1440, 900)).toBe('desktop');
    expect(layoutMode(844, 390)).toBe('desktop'); // a large phone held sideways falls back to the desktop layout
    expect(layoutMode(768, 768)).toBe('desktop');
  });
});

describe('mobileRowHeight', () => {
  it('gives tall portrait phones 44 px rows and everything else the compact pitch', () => {
    expect(mobileRowHeight(390, 844)).toBe(TALL_ROW_H);
    expect(mobileRowHeight(430, 932)).toBe(TALL_ROW_H);
    expect(mobileRowHeight(360, 780)).toBe(MOBILE_ROW_H);
    expect(mobileRowHeight(844, 900)).toBe(TALL_ROW_H);
    expect(mobileRowHeight(900, 844)).toBe(MOBILE_ROW_H); // landscape
  });
});

describe('stepFront', () => {
  it('walks the fronts in order and wraps at both ends', () => {
    expect(stepFront(fronts, 'general', 1)).toBe('code');
    expect(stepFront(fronts, 'code', -1)).toBe('general');
    expect(stepFront(fronts, 'general', -1)).toBe('music');
    expect(stepFront(fronts, 'music', 1)).toBe('general');
  });
  it('starts at general from the galaxy map (or an unknown front), and is null without fronts', () => {
    expect(stepFront(fronts, null, 1)).toBe('general');
    expect(stepFront(fronts, 'nope' as FrontId, -1)).toBe('general');
    expect(stepFront([{ id: 'code' }], null, 1)).toBe('code');
    expect(stepFront([], 'general', 1)).toBeNull();
  });
});

describe('steadyInsets', () => {
  const ratio = (i: ReturnType<typeof steadyInsets>, W: number, H: number) => {
    const v = viewportOf(i, W, H);
    return v.h / v.w;
  };
  const centre = (i: ReturnType<typeof steadyInsets>, W: number, H: number) => {
    const v = viewportOf(i, W, H);
    return [v.x + v.w / 2, v.y + v.h / 2];
  };

  it('keeps a portrait frame between 1.02 and 1.3 tall, without moving its centre or its short side', () => {
    const tall = { top: 100, right: 0, bottom: 80, left: 0 }; // 390 × 664: map mode
    const t = steadyInsets(tall, 390, 844);
    expect(ratio(t, 390, 844)).toBeCloseTo(1.3, 6);
    expect(centre(t, 390, 844)).toEqual(centre(tall, 390, 844));
    expect(viewportOf(t, 390, 844).w).toBe(390);

    const flat = { top: 100, right: 0, bottom: 440, left: 0 }; // 390 × 304: the sheet is open
    const f = steadyInsets(flat, 390, 844);
    expect(ratio(f, 390, 844)).toBeCloseTo(1.02, 6);
    expect(centre(f, 390, 844)[0]).toBeCloseTo(195, 6);
    expect(viewportOf(f, 390, 844).h).toBe(304);

    const ok = { top: 100, right: 0, bottom: 330, left: 0 }; // 390 × 414
    expect(steadyInsets(ok, 390, 844)).toEqual(ok);
  });

  it('keeps a landscape window landscape', () => {
    const ins = { top: 100, right: 300, bottom: 80, left: 0 }; // 367 × 195 → already wide
    expect(steadyInsets(ins, 667, 375)).toEqual(ins);
    const narrow = { top: 50, right: 500, bottom: 70, left: 0 }; // 167 × 255 → trimmed to wide
    const n = steadyInsets(narrow, 667, 375);
    expect(ratio(n, 667, 375)).toBeLessThan(1);
    expect(centre(n, 667, 375)).toEqual(centre(narrow, 667, 375));
  });
});

describe('holdOnScreen', () => {
  it('keeps every world point at the same screen position when the framed viewport moves', () => {
    const cam = { x: 10, y: -20, scale: 2 };
    const from = { x: 0, y: 100, w: 390, h: 420 };
    const to = { x: 0, y: 100, w: 390, h: 300 };
    const c = holdOnScreen(cam, from, to);
    const screen = (k: typeof cam, v: typeof from, px: number, py: number) => [v.x + v.w / 2 + (px - k.x) * k.scale, v.y + v.h / 2 + (py - k.y) * k.scale];
    for (const [px, py] of [
      [0, 0],
      [50, -80],
      [-120, 33],
    ]) {
      expect(screen(c, to, px, py)[0]).toBeCloseTo(screen(cam, from, px, py)[0], 9);
      expect(screen(c, to, px, py)[1]).toBeCloseTo(screen(cam, from, px, py)[1], 9);
    }
    expect(c.scale).toBe(2);
  });
});

describe('sheetShouldClose', () => {
  it('closes when pulled past a quarter of the sheet or flicked down', () => {
    expect(sheetShouldClose(130, 0.1, 440)).toBe(true);
    expect(sheetShouldClose(40, 1.2, 440)).toBe(true);
  });
  it('springs back from short or upward drags', () => {
    expect(sheetShouldClose(80, 0.2, 440)).toBe(false);
    expect(sheetShouldClose(20, 2, 440)).toBe(false);
    expect(sheetShouldClose(-50, -2, 440)).toBe(false);
  });
});

describe('groupMonths (compact timeline markers)', () => {
  it('merges news months closer than the gap into one marker', () => {
    expect(groupMonths([0, 1, 2, 3, 7, 8, 12], 3)).toEqual([[0, 1, 2], [3], [7, 8], [12]]);
    expect(groupMonths([0, 1, 2], 1)).toEqual([[0], [1], [2]]);
    expect(groupMonths([], 3)).toEqual([]);
  });
});
