import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFetchCtx } from '../../src/sources/http';

const ctx = () => makeFetchCtx(new Date('2026-10-08T00:00:00Z'), {}, () => {}, { backfill: false, keys: () => [] });

/** A Response whose `url` is what Node's fetch reports after following redirects. */
function responseAt(finalUrl: string, body = 'ok', status = 200): Response {
  const res = new Response(body, { status });
  Object.defineProperty(res, 'url', { value: finalUrl });
  return res;
}

afterEach(() => vi.unstubAllGlobals());

describe('http fetch path', () => {
  it('returns the body when the final URL stays on https', async () => {
    const fetchMock = vi.fn(async () => responseAt('https://example.test/a'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await ctx().fetchText('https://example.test/a')).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses an https request that ended on a plain-http URL (redirect downgrade) without retrying', async () => {
    const fetchMock = vi.fn(async () => responseAt('http://example.test/a'));
    vi.stubGlobal('fetch', fetchMock);
    const c = ctx();
    await expect(c.fetchBytes('https://example.test/a')).rejects.toThrow(/cleartext|downgrade/i);
    await expect(c.fetchJson('https://example.test/a')).rejects.toThrow(/http:\/\/example\.test\/a/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one attempt per call, never retried
  });

  it('does not touch requests that were plain http to begin with, or responses without a url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseAt('http://example.test/b', 'plain')));
    expect(await ctx().fetchText('http://example.test/b')).toBe('plain');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no url')));
    expect(await ctx().fetchText('https://example.test/c')).toBe('no url');
  });
});
