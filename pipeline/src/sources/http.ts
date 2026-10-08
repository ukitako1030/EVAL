import type { FetchCtx } from './types';

export const USER_AGENT = 'AI-WAR-data-pipeline/0.1 (non-commercial research visualisation; https://github.com/ukitako1030)';

/** A `Retry-After` longer than this is not waited out. */
export const MAX_RETRY_AFTER_MS = 60_000;

/** A failed HTTP response. The message stays `HTTP <status> for <url>`, which the sources match on. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    /** the server's `Retry-After` in ms (capped at 60 s), when it sent a usable one */
    readonly retryAfterMs?: number,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

/** `Retry-After` as a number of seconds → ms, capped at 60 s. An HTTP date or anything else → undefined. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  const v = value?.trim();
  if (!v || !/^\d+$/.test(v)) return undefined;
  return Math.min(Number(v) * 1000, MAX_RETRY_AFTER_MS);
}

async function fetchWithRetry(url: string, init: RequestInit = {}, attempts = 3, timeoutMs = 60_000): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let waitMs = 1000 * 2 ** i;
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { 'User-Agent': USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
      });
      if (res.ok) return res;
      const retryAfterMs = res.status === 429 ? parseRetryAfter(res.headers.get('Retry-After')) : undefined;
      lastErr = new HttpError(res.status, url, retryAfterMs);
      if (res.status < 500 && res.status !== 429) break;
      if (retryAfterMs !== undefined) waitMs = retryAfterMs; // the server said when to come back
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function makeFetchCtx(
  now: Date,
  env: Record<string, string | undefined>,
  log: (m: string) => void,
  opts: { backfill: boolean; keys: FetchCtx['keys'] },
): FetchCtx {
  return {
    env,
    now,
    log,
    backfill: opts.backfill,
    keys: opts.keys,
    fetchText: async (url, init) => (await fetchWithRetry(url, init)).text(),
    fetchBytes: async (url, init) => new Uint8Array(await (await fetchWithRetry(url, init)).arrayBuffer()),
    fetchJson: async <T>(url: string, init?: RequestInit) => (await (await fetchWithRetry(url, init)).json()) as T,
  };
}

/** Sleep helper for polite APIs (e.g. Tranco 1 req/s). */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
