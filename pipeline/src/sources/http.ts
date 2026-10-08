import type { FetchCtx } from './types';

export const USER_AGENT = 'AI-WAR-data-pipeline/0.1 (non-commercial research visualisation; https://github.com/ukitako1030)';

/** A server-requested back-off (Retry-After) is never honoured for longer than this. */
const MAX_RETRY_AFTER_MS = 60_000;

export interface RetryOpts {
  /** total tries per request (default 3) */
  attempts?: number;
  /** abort one try — headers AND body — after this long (default 60 s) */
  timeoutMs?: number;
  /** wait baseDelayMs·2^i between tries i and i+1 (default 1000) */
  baseDelayMs?: number;
}

/** The URL without query string and fragment: query strings may carry API keys, so they never go into messages. */
export function stripQuery(url: string): string {
  const i = url.search(/[?#]/);
  return i < 0 ? url : url.slice(0, i);
}

/** Removes the query string / fragment of `url` (and of any other URL) from an error message. */
function scrub(message: string, url: string): string {
  const safe = stripQuery(url);
  let m = message.split(url).join(safe);
  const q = url.search(/[?#]/);
  if (q >= 0) m = m.split(url.slice(q)).join(''); // the bare query, e.g. in "Failed to parse URL" messages
  return m.replace(/(\bhttps?:\/\/[^\s?#'"<>)]*)[?#][^\s'"<>)]*/gi, '$1');
}

function describeError(e: unknown, url: string): Error {
  const err = e instanceof Error ? e : new Error(String(e));
  const code = (err.cause as { code?: unknown } | undefined)?.code;
  const msg = scrub(err.message, url) + (typeof code === 'string' ? ` (${code})` : '');
  return new Error(msg);
}

/** Retry-After as milliseconds: seconds (fractions allowed) or an HTTP date; capped at 60 s; null when absent or unusable. */
export function parseRetryAfter(value: string | null | undefined, now: Date = new Date()): number | null {
  const v = value?.trim();
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return secs >= 0 ? Math.min(secs * 1000, MAX_RETRY_AFTER_MS) : null;
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now.getTime()), MAX_RETRY_AFTER_MS);
}

/** Aborts when any of the signals does (AbortSignal.any where available). */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/** True when an https request ended (after redirects) on a plain-http URL. `res.url` is '' for synthetic responses, which never match. */
function isHttpsDowngrade(requested: string, finalUrl: string): boolean {
  return /^https:/i.test(requested) && /^http:/i.test(finalUrl);
}

/**
 * One request with retries. `read` turns the response into the result and runs INSIDE the try/timeout, so the abort timer
 * covers the body download as well (a server that stalls after the headers can no longer hang the run).
 * Retries on network errors, timeouts, 5xx and 429 (Retry-After honoured); other 4xx fail at once; a caller-provided
 * `init.signal` that fires ends the request without a retry. No sleep after the last attempt.
 * An https request that was redirected to plain http is refused without retry: the data would have travelled in cleartext.
 * The redirected request has already been sent when this is detected, so source URLs must still point at the HTTPS host
 * directly (see OSWORLD_XLSX_URL); the guard turns a later silent downgrade into a loud failure.
 */
async function request<T>(url: string, init: RequestInit, read: (res: Response) => Promise<T>, retry: RetryOpts): Promise<T> {
  const attempts = retry.attempts ?? 3;
  const timeoutMs = retry.timeoutMs ?? 60_000;
  const baseDelayMs = retry.baseDelayMs ?? 1000;
  const safeUrl = stripQuery(url);
  try {
    new URL(url);
  } catch {
    throw new Error(`invalid URL ${safeUrl}`);
  }
  const headers = new Headers(init.headers);
  if (!headers.has('user-agent')) headers.set('User-Agent', USER_AGENT);

  let lastErr: Error = new Error(`no attempt made for ${safeUrl}`);
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    const signal = init.signal ? anySignal([init.signal, ctrl.signal]) : ctrl.signal;
    let delay = baseDelayMs * 2 ** i;
    try {
      const res = await fetch(url, { ...init, headers, signal });
      if (isHttpsDowngrade(url, res.url)) {
        void res.body?.cancel().catch(() => {});
        lastErr = new Error(`refusing ${safeUrl}: it was redirected to cleartext ${stripQuery(res.url)} (https to http downgrade)`);
        break;
      }
      if (res.ok) return await read(res);
      void res.body?.cancel().catch(() => {});
      lastErr = new Error(`HTTP ${res.status} for ${safeUrl}`);
      if (res.status === 429) {
        const ra = parseRetryAfter(res.headers.get('retry-after'));
        if (ra != null) delay = ra;
      } else if (res.status < 500) {
        break;
      }
    } catch (e) {
      if (init.signal?.aborted) throw init.signal.reason instanceof Error ? init.signal.reason : new Error(`request aborted for ${safeUrl}`);
      lastErr = timedOut ? new Error(`timeout after ${timeoutMs} ms for ${safeUrl}`) : describeError(e, url);
    } finally {
      clearTimeout(timer);
    }
    if (i < attempts - 1) await sleep(delay);
  }
  throw lastErr;
}

export function makeFetchCtx(
  now: Date,
  env: Record<string, string | undefined>,
  log: (m: string) => void,
  opts: { backfill: boolean; keys: FetchCtx['keys']; retry?: RetryOpts },
): FetchCtx {
  const retry = opts.retry ?? {};
  const text = (url: string, init?: RequestInit) => request(url, init ?? {}, (res) => res.text(), retry);
  return {
    env,
    now,
    log,
    backfill: opts.backfill,
    keys: opts.keys,
    fetchText: text,
    fetchBytes: (url, init) => request(url, init ?? {}, async (res) => new Uint8Array(await res.arrayBuffer()), retry),
    fetchJson: async <T>(url: string, init?: RequestInit) => {
      const body = await text(url, init);
      try {
        return JSON.parse(body) as T; // a malformed body is not a transient error: no retry
      } catch (e) {
        throw new Error(`invalid JSON from ${stripQuery(url)}: ${(e as Error).message}`);
      }
    },
  };
}

/** Sleep helper for polite APIs (e.g. Tranco 1 req/s). */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
