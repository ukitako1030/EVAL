import { describe, it, expect } from 'vitest';
import { containsEmail, isObject, redactEmails } from '../../src/sources/lib/privacy';

describe('privacy helpers', () => {
  it('isObject accepts plain objects only', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
    for (const v of [null, undefined, [], [1], 'x', 0, true]) expect(isObject(v)).toBe(false);
  });

  it('containsEmail finds addresses and is not stateful across calls', () => {
    expect(containsEmail('write to first.last+tag@sub.example.org now')).toBe(true);
    expect(containsEmail('write to first.last+tag@sub.example.org now')).toBe(true);
    expect(containsEmail('@mention and user@host (no tld)')).toBe(false);
    expect(containsEmail('')).toBe(false);
  });

  it('redactEmails scrubs every address in strings at any depth, without mutating the input', () => {
    const input = { a: 'mail a@b.co or c.d@e.org', list: ['x@y.zz', 1, null, { deep: 'f@g.hh' }], n: 5, ok: true, nil: null };
    const out = redactEmails(input);
    expect(out).toEqual({ a: 'mail <redacted> or <redacted>', list: ['<redacted>', 1, null, { deep: '<redacted>' }], n: 5, ok: true, nil: null });
    expect(input.a).toBe('mail a@b.co or c.d@e.org');
    expect(input.list[0]).toBe('x@y.zz');
  });

  it('redactEmails passes scalars and e-mail-free values through unchanged', () => {
    expect(redactEmails('plain text')).toBe('plain text');
    expect(redactEmails(null)).toBeNull();
    expect(redactEmails(undefined)).toBeUndefined();
    expect(redactEmails(42)).toBe(42);
    expect(redactEmails([])).toEqual([]);
    expect(redactEmails({})).toEqual({});
  });
});
