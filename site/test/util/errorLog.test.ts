import { describe, it, expect } from 'vitest';
import { createErrorLog, errorKey } from '../../src/util/errorLog';

describe('createErrorLog', () => {
  it('logs the first occurrence of each distinct message and swallows repeats', () => {
    const lines: unknown[][] = [];
    const report = createErrorLog('frame', (...a) => lines.push(a));
    const e1 = new Error('boom');
    expect(report(e1)).toBe(true);
    expect(report(new Error('boom'))).toBe(false);
    expect(report(new TypeError('boom'))).toBe(true); // another kind of error is another message
    expect(report('plain string')).toBe(true);
    expect(report('plain string')).toBe(false);
    expect(lines).toHaveLength(3);
    expect(lines[0][0]).toContain('frame');
    expect(lines[0][1]).toBe(e1);
  });
  it('stops remembering after a cap, so an error with a changing message cannot grow memory without bound', () => {
    let n = 0;
    const report = createErrorLog('x', () => n++, 4);
    for (let i = 0; i < 100; i++) report(new Error(`e${i}`));
    expect(n).toBe(4);
  });
  it('errorKey names the error type and message', () => {
    expect(errorKey(new RangeError('r'))).toBe('RangeError: r');
    expect(errorKey(42)).toBe('42');
    expect(errorKey(null)).toBe('null');
  });
});
