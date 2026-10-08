import { describe, it, expect } from 'vitest';
import { announcementMonthly } from '../../src/compute/announcements';
import { monthRange } from '../../src/core/months';

const factors = { MAU: 1, WAU: 1.4, DAU: 2.5 };

describe('announcementMonthly', () => {
  const series = {
    metric: 'MAU' as const,
    points: [
      { date: '2024-01-31', value: 100, url: 'https://x' },
      { date: '2024-03-31', value: 400, url: 'https://x' },
    ],
  };
  const out = announcementMonthly(series, monthRange('2023-12', '2024-12'), factors, 6);
  it('is empty before the first point', () => {
    expect(out.has('2023-12')).toBe(false);
  });
  it('hits points exactly and interpolates geometrically between them', () => {
    expect(out.get('2024-01')).toBeCloseTo(100, 6);
    expect(out.get('2024-02')).toBeCloseTo(195.5, 0); // 100·4^(29/60): Feb 29 is day 29 of 60
    expect(out.get('2024-03')).toBeCloseTo(400, 6);
  });
  it('carries the last value for staleMonths, then stops', () => {
    expect(out.get('2024-09')).toBeCloseTo(400, 6);
    expect(out.has('2024-10')).toBe(false);
  });
  it('converts WAU/DAU to MAU-equivalent, honouring per-point metric', () => {
    const w = announcementMonthly(
      { metric: 'WAU', points: [{ date: '2024-01-15', value: 10, url: 'https://x' }, { date: '2024-02-15', value: 10, metric: 'DAU', url: 'https://x' }] },
      ['2024-01', '2024-02'],
      factors,
      6,
    );
    expect(w.get('2024-01')).toBeCloseTo(14, 6);
    expect(w.get('2024-02')).toBeCloseTo(25, 6);
  });
});
