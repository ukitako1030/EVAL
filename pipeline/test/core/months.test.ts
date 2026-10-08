import { describe, it, expect } from 'vitest';
import { toMonth, addMonths, monthRange, monthEnd, daysBetween, monthDiff } from '../../src/core/months';

describe('months', () => {
  it('toMonth parses dates, months and Date objects', () => {
    expect(toMonth('2025-03-15')).toBe('2025-03');
    expect(toMonth('2025-03')).toBe('2025-03');
    expect(toMonth('2025-03-15T10:00:00Z')).toBe('2025-03');
    expect(toMonth(new Date(Date.UTC(2024, 11, 31)))).toBe('2024-12');
  });
  it('toMonth rejects garbage', () => {
    expect(() => toMonth('March 2025')).toThrow();
  });
  it('addMonths crosses years both ways', () => {
    expect(addMonths('2022-11', 2)).toBe('2023-01');
    expect(addMonths('2023-01', -1)).toBe('2022-12');
    expect(addMonths('2024-06', 0)).toBe('2024-06');
  });
  it('monthRange is inclusive', () => {
    expect(monthRange('2022-11', '2023-02')).toEqual(['2022-11', '2022-12', '2023-01', '2023-02']);
    expect(monthRange('2023-02', '2023-01')).toEqual([]);
  });
  it('monthEnd handles leap years', () => {
    expect(monthEnd('2024-02')).toBe('2024-02-29');
    expect(monthEnd('2023-02')).toBe('2023-02-28');
    expect(monthEnd('2023-12')).toBe('2023-12-31');
  });
  it('daysBetween and monthDiff', () => {
    expect(daysBetween('2025-01-01', '2025-03-01')).toBe(59);
    expect(daysBetween('2025-03-01', '2025-01-01')).toBe(-59);
    expect(monthDiff('2024-11', '2025-02')).toBe(3);
  });
});
