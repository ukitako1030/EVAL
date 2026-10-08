import type { FetchCtx } from './types';

export const USER_AGENT = 'AI-WAR-data-pipeline/0.1 (non-commercial research visualisation; https://github.com/ukitako1030)';

/** True when an https request ended (after redirects) on a plain-http URL. `res.url` is '' for synthetic responses, which never match. */
function isHttpsDowngrade(requested: string, finalUrl: string): boolean {
  return /^https:/i.test(requested) && /^http:/i.test(finalUrl);
}

/**
 * Fetches with retries. An https request that was redirected to plain http is refused (and not retried): the data would have
 * travelled in cleartext. Note the redirected request itself has already been sent when this is detected, so source URLs
 * must still point at the HTTPS host directly (see OSWORLD_XLSX_URL); this guard turns a later silent downgrade into a loud failure.
 */
async function fetchWithRetry(url: string, init: RequestInit = {}, attempts = 3, timeoutMs = 60_000): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { 'User-Agent': USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
      });
      if (isHttpsDowngrade(url, res.url)) {
        lastErr = new Error(`refusing ${url}: it was redirected to cleartext ${res.url} (https to http downgrade)`);
        break;
      }
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
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
