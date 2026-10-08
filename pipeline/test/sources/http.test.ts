import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { HttpError, makeFetchCtx, parseRetryAfter } from '../../src/sources/http';

describe('parseRetryAfter', () => {
  it('reads a number of seconds, in milliseconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    expect(parseRetryAfter(' 7 ')).toBe(7_000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('caps at 60 seconds', () => {
    expect(parseRetryAfter('60')).toBe(60_000);
    expect(parseRetryAfter('61')).toBe(60_000);
    expect(parseRetryAfter('86400')).toBe(60_000);
  });

  it('ignores anything that is not a plain number of seconds (missing header, HTTP date, negatives, junk)', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter('-5')).toBeUndefined();
    expect(parseRetryAfter('1.5')).toBeUndefined();
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
  });
});

describe('HttpError', () => {
  it('keeps the "HTTP <status> for <url>" message that the sources match on', () => {
    const e = new HttpError(429, 'https://x.example/a', 5_000);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('HTTP 429 for https://x.example/a');
    expect(e).toMatchObject({ status: 429, retryAfterMs: 5_000 });
    expect(new HttpError(404, 'https://x.example/b').retryAfterMs).toBeUndefined();
  });
});

describe('makeFetchCtx fetch helpers on HTTP 429', () => {
  const reply = (status: number, headers: Record<string, string> = {}, body = 'ok') => new Response(body, { status, headers });
  const ctx = () => makeFetchCtx(new Date('2026-10-08T00:00:00Z'), {}, () => {}, { backfill: false, keys: () => [] });

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for Retry-After (not the 1 s default backoff) before retrying', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(429, { 'Retry-After': '7' }))
      .mockResolvedValueOnce(reply(200, {}, 'done'));
    vi.stubGlobal('fetch', fetchMock);
    const p = ctx().fetchText('https://x.example/a');
    await vi.advanceTimersByTimeAsync(6_999);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the default backoff would already have retried after 1 s
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe('done');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to exponential backoff without a usable Retry-After', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(429)).mockResolvedValueOnce(reply(200, {}, 'done'));
    vi.stubGlobal('fetch', fetchMock);
    const p = ctx().fetchText('https://x.example/a');
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe('done');
  });

  it('after the last attempt throws an HttpError that carries the (capped) Retry-After', async () => {
    const fetchMock = vi.fn(async () => reply(429, { 'Retry-After': '300' }));
    vi.stubGlobal('fetch', fetchMock);
    const p = ctx().fetchJson('https://x.example/a');
    const settled = p.then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const err = await settled;
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ message: 'HTTP 429 for https://x.example/a', status: 429, retryAfterMs: 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a plain 404 and reports it as an HttpError', async () => {
    const fetchMock = vi.fn(async () => reply(404));
    vi.stubGlobal('fetch', fetchMock);
    await expect(ctx().fetchText('https://x.example/missing')).rejects.toMatchObject({ message: 'HTTP 404 for https://x.example/missing', status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
