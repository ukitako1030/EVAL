import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpError, makeFetchCtx, parseRetryAfter, USER_AGENT } from '../../src/sources/http';
import type { FetchCtx } from '../../src/sources/types';

let server: Server;
let base: string;
let hits: string[] = [];
let handler: (req: IncomingMessage, res: ServerResponse, n: number) => void = () => {};

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '');
    handler(req, res, hits.length);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  hits = [];
  handler = () => {};
});

const ctx = (retry?: { attempts?: number; timeoutMs?: number; baseDelayMs?: number }): FetchCtx =>
  makeFetchCtx(new Date('2026-10-12T00:00:00Z'), {}, () => {}, { backfill: false, keys: () => [], retry });

const echoHeaders = (req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(req.headers));
};

describe('headers', () => {
  it('sends the default User-Agent', async () => {
    handler = echoHeaders;
    const h = await ctx().fetchJson<Record<string, string>>(`${base}/h`);
    expect(h['user-agent']).toBe(USER_AGENT);
  });
  it('keeps the headers of a Headers object (and a plain object / tuple list)', async () => {
    handler = echoHeaders;
    const c = ctx();
    const a = await c.fetchJson<Record<string, string>>(`${base}/h`, { headers: new Headers({ 'X-Test': 'yes', Authorization: 'Bearer abc' }) });
    expect(a['x-test']).toBe('yes');
    expect(a.authorization).toBe('Bearer abc');
    expect(a['user-agent']).toBe(USER_AGENT);
    const b = await c.fetchJson<Record<string, string>>(`${base}/h`, { headers: { 'X-Test': 'obj' } });
    expect(b['x-test']).toBe('obj');
    const t = await c.fetchJson<Record<string, string>>(`${base}/h`, { headers: [['X-Test', 'tuple']] });
    expect(t['x-test']).toBe('tuple');
  });
  it('does not override a caller-provided User-Agent (any case)', async () => {
    handler = echoHeaders;
    const c = ctx();
    const a = await c.fetchJson<Record<string, string>>(`${base}/h`, { headers: new Headers({ 'user-agent': 'mine/1' }) });
    expect(a['user-agent']).toBe('mine/1');
    const b = await c.fetchJson<Record<string, string>>(`${base}/h`, { headers: { 'User-Agent': 'mine/2' } });
    expect(b['user-agent']).toBe('mine/2');
  });
});

describe('retries', () => {
  it('retries a 5xx and then succeeds', async () => {
    handler = (_req, res, n) => {
      res.writeHead(n === 1 ? 503 : 200);
      res.end('fine');
    };
    expect(await ctx({ baseDelayMs: 5 }).fetchText(`${base}/r`)).toBe('fine');
    expect(hits).toHaveLength(2);
  });
  it('does not retry other 4xx', async () => {
    handler = (_req, res) => {
      res.writeHead(404);
      res.end();
    };
    await expect(ctx({ baseDelayMs: 5 }).fetchText(`${base}/missing`)).rejects.toThrow(/HTTP 404/);
    expect(hits).toHaveLength(1);
  });
  it('does not sleep after the last attempt', async () => {
    handler = (_req, res) => {
      res.writeHead(500);
      res.end();
    };
    const t0 = Date.now();
    await expect(ctx({ attempts: 2, baseDelayMs: 400 }).fetchText(`${base}/e`)).rejects.toThrow(/HTTP 500/);
    const ms = Date.now() - t0;
    expect(hits).toHaveLength(2);
    expect(ms).toBeGreaterThanOrEqual(380); // one back-off between the two attempts
    expect(ms).toBeLessThan(750); // not a second one after the last attempt (would be ~1200 ms)
  });
  it('honours Retry-After on a 429 instead of the (short) back-off', async () => {
    handler = (_req, res, n) => {
      if (n === 1) res.writeHead(429, { 'retry-after': '0.4' });
      else res.writeHead(200);
      res.end('ok');
    };
    const t0 = Date.now();
    expect(await ctx({ baseDelayMs: 5 }).fetchText(`${base}/rl`)).toBe('ok');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(380);
    expect(hits).toHaveLength(2);
  });
  it('falls back to the normal back-off when a 429 has no usable Retry-After', async () => {
    handler = (_req, res, n) => {
      res.writeHead(n === 1 ? 429 : 200, n === 1 ? { 'retry-after': 'soon' } : {});
      res.end('ok');
    };
    const t0 = Date.now();
    expect(await ctx({ baseDelayMs: 5 }).fetchText(`${base}/rl2`)).toBe('ok');
    expect(Date.now() - t0).toBeLessThan(300);
  });
});

describe('parseRetryAfter', () => {
  const now = new Date('2026-10-12T00:00:00Z');
  it('parses seconds (fractions allowed) and caps at 60 s', () => {
    expect(parseRetryAfter('2', now)).toBe(2000);
    expect(parseRetryAfter('0.4', now)).toBe(400);
    expect(parseRetryAfter('0', now)).toBe(0);
    expect(parseRetryAfter('120', now)).toBe(60_000);
    expect(parseRetryAfter(' 7 ', now)).toBe(7000);
  });
  it('parses an HTTP date, capped and never negative', () => {
    expect(parseRetryAfter('Mon, 12 Oct 2026 00:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfter('Mon, 12 Oct 2026 00:10:00 GMT', now)).toBe(60_000);
    expect(parseRetryAfter('Sun, 11 Oct 2026 00:00:00 GMT', now)).toBe(0);
  });
  it('returns null for missing or unusable values', () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('', now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter('-3', now)).toBeNull();
  });
});

describe('error messages', () => {
  it('never contain the query string (keys must not reach raw/_status)', async () => {
    handler = (_req, res) => {
      res.writeHead(500);
      res.end();
    };
    const err = await ctx({ attempts: 1 })
      .fetchText(`${base}/data?api_key=SECRET123&x=1#frag`)
      .then(
        () => null,
        (e: Error) => e,
      );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain(`HTTP 500 for ${base}/data`);
    expect(err!.message).not.toContain('SECRET123');
    expect(err!.message).not.toContain('?');
    expect(err!.message).not.toContain('frag');
  });
  it('are scrubbed for an unparseable URL too', async () => {
    const err = await ctx({ attempts: 1 })
      .fetchText('http://exa mple.invalid/x?key=SECRET456')
      .then(
        () => null,
        (e: Error) => e,
      );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).not.toContain('SECRET456');
  });
  it('are scrubbed on network errors', async () => {
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    const port = (dead.address() as AddressInfo).port;
    await new Promise<void>((r) => dead.close(() => r()));
    const err = await ctx({ attempts: 1 })
      .fetchText(`http://127.0.0.1:${port}/x?key=SECRET789`)
      .then(
        () => null,
        (e: Error) => e,
      );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).not.toContain('SECRET789');
  });
});

describe('timeout and abort', () => {
  it('times out while the body is stalled (the timer stays active until the body has been read)', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('partial');
      // never ends
    };
    const t0 = Date.now();
    await expect(ctx({ attempts: 1, timeoutMs: 200 }).fetchText(`${base}/stall?k=SECRET`)).rejects.toThrow(/timeout/i);
    expect(Date.now() - t0).toBeLessThan(2000);
    await expect(ctx({ attempts: 1, timeoutMs: 200 }).fetchBytes(`${base}/stall`)).rejects.toThrow(/timeout/i);
    await expect(ctx({ attempts: 1, timeoutMs: 200 }).fetchJson(`${base}/stall`)).rejects.toThrow(/timeout/i);
  });
  it('retries after a stalled body', async () => {
    handler = (_req, res, n) => {
      res.writeHead(200);
      if (n === 1) res.write('partial');
      else res.end('whole');
    };
    expect(await ctx({ attempts: 2, timeoutMs: 200, baseDelayMs: 5 }).fetchText(`${base}/stall2`)).toBe('whole');
    expect(hits).toHaveLength(2);
  });
  it('aborts when the caller signal fires, without retrying', async () => {
    handler = () => {
      /* never answers */
    };
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const t0 = Date.now();
    await expect(ctx({ attempts: 3, timeoutMs: 10_000, baseDelayMs: 5 }).fetchText(`${base}/hang`, { signal: ac.signal })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(hits).toHaveLength(1);
  });
  it('rejects at once for a caller signal that is already aborted', async () => {
    handler = (_req, res) => res.end('x');
    const ac = new AbortController();
    ac.abort();
    await expect(ctx({ attempts: 3, baseDelayMs: 5 }).fetchText(`${base}/pre`, { signal: ac.signal })).rejects.toThrow();
    expect(hits).toHaveLength(0);
  });
});

describe('fetchJson / fetchBytes', () => {
  it('parse the body; invalid JSON is an error without retries', async () => {
    handler = (req, res) => {
      res.writeHead(200);
      res.end(req.url === '/json' ? '{"a":1}' : '<html>');
    };
    const c = ctx({ baseDelayMs: 5 });
    expect(await c.fetchJson(`${base}/json`)).toEqual({ a: 1 });
    expect(Array.from(await c.fetchBytes(`${base}/json`))).toEqual(Array.from(Buffer.from('{"a":1}')));
    hits = [];
    await expect(c.fetchJson(`${base}/bad?k=SECRET`)).rejects.toThrow(/invalid JSON/);
    expect(hits).toHaveLength(1);
  });
});

// --- https → http downgrade guard (stubbed fetch) ---

const plainCtx = () => makeFetchCtx(new Date('2026-10-08T00:00:00Z'), {}, () => {}, { backfill: false, keys: () => [] });

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
    expect(await plainCtx().fetchText('https://example.test/a')).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses an https request that ended on a plain-http URL (redirect downgrade) without retrying', async () => {
    const fetchMock = vi.fn(async () => responseAt('http://example.test/a'));
    vi.stubGlobal('fetch', fetchMock);
    const c = plainCtx();
    await expect(c.fetchBytes('https://example.test/a')).rejects.toThrow(/cleartext|downgrade/i);
    await expect(c.fetchJson('https://example.test/a')).rejects.toThrow(/http:\/\/example\.test\/a/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one attempt per call, never retried
  });

  it('does not touch requests that were plain http to begin with, or responses without a url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseAt('http://example.test/b', 'plain')));
    expect(await plainCtx().fetchText('http://example.test/b')).toBe('plain');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no url')));
    expect(await plainCtx().fetchText('https://example.test/c')).toBe('no url');
  });
});

// --- HttpError (used by sources that handle 429 themselves, e.g. wikipedia) ---
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
