import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { CRUX_REP, crux, cruxFileMonths, fetchCrux, parseCrux, scanCruxCsv, selectCruxMonths } from '../../src/sources/crux';
import { gunzipText } from '../../src/sources/lib/archive';
import type { FetchCtx } from '../../src/sources/types';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/crux/${name}`, import.meta.url));
const text = (name: string) => fixture(name).toString('utf8');
const bucketOf = (rows: { host: string; bucket: number }[]) => Object.fromEntries(rows.map((r) => [r.host, r.bucket]));

describe('CRUX_REP', () => {
  it('holds the geometric-mean representative rank of the seven buckets', () => {
    expect(CRUX_REP).toEqual({ 1000: 316, 5000: 2236, 10000: 7071, 50000: 22361, 100000: 70711, 500000: 223607, 1000000: 707107 });
  });
});

describe('scanCruxCsv', () => {
  it('maps hosts to their bucket, trying https://host and https://www.host (202402)', () => {
    const rows = scanCruxCsv(text('sample-202402.csv'), ['gemini.google.com', 'chat.openai.com', 'bard.google.com', 'perplexity.ai', 'midjourney.com', 'claude.ai', 'chatgpt.com']);
    // chatgpt.com is not in the 2024-02 file at all; perplexity.ai and midjourney.com only exist as the www. variant
    expect(bucketOf(rows)).toEqual({
      'gemini.google.com': 1000,
      'chat.openai.com': 1000,
      'bard.google.com': 5000,
      'perplexity.ai': 10000,
      'midjourney.com': 50000,
      'claude.ai': 50000,
    });
    expect(rows.map((r) => r.host)).toEqual(['gemini.google.com', 'chat.openai.com', 'bard.google.com', 'perplexity.ai', 'midjourney.com', 'claude.ai']);
  });

  it('takes the best bucket when both the bare and the www. origin are present (202501 klingai, 202301 midjourney)', () => {
    const k = bucketOf(scanCruxCsv(text('sample-202501.csv'), ['klingai.com', 'www.klingai.com', 'kling.ai']));
    expect(k).toEqual({ 'klingai.com': 10000, 'www.klingai.com': 50000 }); // bare 10k beats www 50k; an explicit www key only sees www
    const m = bucketOf(scanCruxCsv(text('sample-202301.csv'), ['midjourney.com', 'perplexity.ai', 'lumalabs.ai']));
    expect(m).toEqual({ 'midjourney.com': 50000, 'perplexity.ai': 100000, 'lumalabs.ai': 1000000 });
  });

  it('matches whole origins only: openai.com does not pick up chat.openai.com', () => {
    expect(scanCruxCsv(text('sample-202402.csv'), ['openai.com', 'google.com'])).toEqual([]);
    expect(scanCruxCsv(text('sample-202608.csv'), ['openai.com', 'chat.qwen.ai'])).toEqual([{ host: 'chat.qwen.ai', bucket: 10000 }]);
  });

  it('accepts CRLF line endings, a missing final newline and de-duplicates hosts', () => {
    const crlf = text('sample-202608.csv').replace(/\n/g, '\r\n').trimEnd();
    expect(scanCruxCsv(crlf, ['sora.chatgpt.com', 'klingai.com', 'klingai.com'])).toEqual([
      { host: 'sora.chatgpt.com', bucket: 500000 },
      { host: 'klingai.com', bucket: 500000 },
    ]);
  });

  it('keeps independent answers for two configured hosts that share an origin', () => {
    const r = bucketOf(scanCruxCsv(text('sample-202608.csv'), ['meta.ai', 'www.meta.ai']));
    // bare host: min(https://meta.ai 100k, https://www.meta.ai 10k) = 10k; explicit www host: 10k
    expect(r).toEqual({ 'meta.ai': 10000, 'www.meta.ai': 10000 });
  });

  it('reads the gzipped fixture exactly like the plain one', () => {
    const hosts = ['chatgpt.com', 'suno.com', 'hailuoai.video', 'www.udio.com'];
    const viaGz = scanCruxCsv(gunzipText(new Uint8Array(fixture('sample-202608.csv.gz'))), hosts);
    expect(viaGz).toEqual(scanCruxCsv(text('sample-202608.csv'), hosts));
    expect(bucketOf(viaGz)).toEqual({ 'chatgpt.com': 1000, 'suno.com': 5000, 'hailuoai.video': 50000, 'www.udio.com': 100000 });
  });
});

describe('file listing and month selection', () => {
  const listing = [
    { name: '202609.csv.gz' },
    { name: 'README.md' },
    { name: '202211.csv.gz' },
    { name: 'current.csv.gz' },
    { name: '202102.csv.gz' },
    { name: '202210.csv.gz' },
    { name: '202608.csv.gz' },
    { name: '202608.csv.gz' },
    null,
    { name: 5 },
  ];
  it('extracts the sorted unique YYYYMM names of the monthly files', () => {
    expect(cruxFileMonths(listing)).toEqual(['202102', '202210', '202211', '202608', '202609']);
    expect(cruxFileMonths({ message: 'API rate limit exceeded' })).toEqual([]);
  });
  it('uses everything from 202211 with backfill, the newest two otherwise', () => {
    const all = cruxFileMonths(listing);
    expect(selectCruxMonths(all, true)).toEqual(['202211', '202608', '202609']);
    expect(selectCruxMonths(all, false)).toEqual(['202608', '202609']);
    expect(selectCruxMonths(['202608'], false)).toEqual(['202608']);
  });
});

describe('parseCrux', () => {
  it('maps buckets to the representative rank', () => {
    const raw = [
      { month: '2026-08', rows: scanCruxCsv(text('sample-202608.csv'), ['chatgpt.com', 'suno.com', 'chat.qwen.ai', 'meta.ai', 'klingai.com', 'lumalabs.ai']) },
      { month: '2024-02', rows: scanCruxCsv(text('sample-202402.csv'), ['gemini.google.com', 'claude.ai', 'perplexity.ai']) },
    ];
    const out = parseCrux(raw);
    expect(out).toHaveLength(9);
    const at = (key: string, month: string) => out.find((o) => o.key === key && o.month === month);
    expect(at('chatgpt.com', '2026-08')).toEqual({ signal: 'crux', key: 'chatgpt.com', month: '2026-08', value: 316 });
    expect(at('suno.com', '2026-08')).toEqual({ signal: 'crux', key: 'suno.com', month: '2026-08', value: 2236 });
    expect(at('chat.qwen.ai', '2026-08')?.value).toBe(7071);
    expect(at('meta.ai', '2026-08')?.value).toBe(7071); // www.meta.ai (10k) beats meta.ai (100k)
    expect(at('lumalabs.ai', '2026-08')?.value).toBe(70711);
    expect(at('klingai.com', '2026-08')?.value).toBe(223607);
    expect(at('claude.ai', '2024-02')?.value).toBe(22361);
    expect(at('perplexity.ai', '2024-02')?.value).toBe(7071);
    expect(at('gemini.google.com', '2024-02')?.value).toBe(316);
  });

  it('skips unknown buckets and malformed entries, never emits 0 or NaN', () => {
    const out = parseCrux([
      { month: '2026-08', rows: [{ host: 'a.com', bucket: 1000 }, { host: 'b.com', bucket: 777 }, { host: 'c.com', bucket: 0 }, { host: 'd.com', bucket: 'x' }, null, { bucket: 5000 }] },
      { month: 'bad', rows: [{ host: 'e.com', bucket: 1000 }] },
      { month: '2026-07' },
      null,
    ]);
    expect(out).toEqual([{ signal: 'crux', key: 'a.com', month: '2026-08', value: 316 }]);
    expect(out.every((o) => Number.isFinite(o.value) && o.value > 0)).toBe(true);
    expect(parseCrux('nope')).toEqual([]);
    expect(parseCrux(null)).toEqual([]);
  });
});

describe('fetchCrux', () => {
  const listing = ['202210', '202211', '202212', '202607', '202608'].map((m) => ({ name: `${m}.csv.gz` })).concat([{ name: 'current.csv.gz' }]);
  const gz = (csv: string) => new Uint8Array(gzipSync(Buffer.from(csv)));
  const csvFor = (m: string) => `origin,rank\nhttps://chatgpt.com,1000\nhttps://www.claude.ai,${m === '202212' ? 50000 : 5000}\nhttps://other.example,5000\n`;

  function stub(over: Partial<FetchCtx> = {}) {
    const urls: string[] = [];
    const inits = new Map<string, RequestInit | undefined>();
    const logs: string[] = [];
    const ctx: FetchCtx = {
      env: {},
      now: new Date('2026-10-08T00:00:00Z'),
      backfill: false,
      keys: (s) => (s === 'crux' ? ['chatgpt.com', 'claude.ai', 'absent.example'] : []),
      fetchText: async () => '',
      fetchBytes: async (url, init) => {
        urls.push(url);
        inits.set(url, init);
        const m = /(\d{6})\.csv\.gz$/.exec(url)![1];
        return gz(csvFor(m));
      },
      fetchJson: async <T>(url: string, init?: RequestInit) => {
        urls.push(url);
        inits.set(url, init);
        return listing as unknown as T;
      },
      log: (m) => logs.push(m),
      ...over,
    };
    return { ctx, urls, inits, logs };
  }

  it('downloads the newest two months without backfill', async () => {
    const { ctx, urls } = stub();
    const raw = await fetchCrux(ctx);
    expect(urls).toEqual([
      'https://api.github.com/repos/zakird/crux-top-lists/contents/data/global',
      'https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/global/202607.csv.gz',
      'https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/global/202608.csv.gz',
    ]);
    expect(raw).toEqual([
      { month: '2026-07', rows: [{ host: 'chatgpt.com', bucket: 1000 }, { host: 'claude.ai', bucket: 5000 }] },
      { month: '2026-08', rows: [{ host: 'chatgpt.com', bucket: 1000 }, { host: 'claude.ai', bucket: 5000 }] },
    ]);
    expect(crux.parse(raw, { now: ctx.now }).map((o) => [o.key, o.month, o.value])).toEqual([
      ['chatgpt.com', '2026-07', 316],
      ['claude.ai', '2026-07', 2236],
      ['chatgpt.com', '2026-08', 316],
      ['claude.ai', '2026-08', 2236],
    ]);
  });

  describe('GitHub token for the listing', () => {
    const LISTING = 'https://api.github.com/repos/zakird/crux-top-lists/contents/data/global';

    it('sends the GITHUB_TOKEN as a bearer token on the listing request when it is set', async () => {
      const { ctx, inits } = stub({ env: { GITHUB_TOKEN: 'ghp_test_token' } });
      await fetchCrux(ctx);
      expect(inits.get(LISTING)?.headers).toEqual({ Authorization: 'Bearer ghp_test_token' });
    });

    it('sends no Authorization header when it is unset or empty', async () => {
      for (const env of [{}, { GITHUB_TOKEN: undefined }, { GITHUB_TOKEN: '' }]) {
        const { ctx, inits } = stub({ env });
        await fetchCrux(ctx);
        expect(inits.get(LISTING)).toBeUndefined();
      }
    });

    it('keeps the token off the file downloads (raw.githubusercontent.com) and out of the log', async () => {
      const { ctx, urls, inits, logs } = stub({ env: { GITHUB_TOKEN: 'ghp_test_token' } });
      await fetchCrux(ctx);
      const files = urls.filter((u) => u.startsWith('https://raw.githubusercontent.com/'));
      expect(files.length).toBeGreaterThan(0);
      for (const u of files) expect(inits.get(u)).toBeUndefined();
      expect(logs.join(' | ')).not.toContain('ghp_test_token');
    });

    it('does not put the token in the error when the listing fails', async () => {
      const { ctx } = stub({
        env: { GITHUB_TOKEN: 'ghp_test_token' },
        fetchJson: async (url: string) => {
          throw new Error(`HTTP 403 for ${url}`);
        },
      });
      const err = await fetchCrux(ctx).catch((e: Error) => e);
      expect((err as Error).message).toContain('HTTP 403');
      expect((err as Error).message).not.toContain('ghp_test_token');
    });
  });

  it('downloads every month from 202211 with backfill and skips a month that fails to download', async () => {
    const { ctx, logs } = stub({
      backfill: true,
      fetchBytes: async (url) => {
        const m = /(\d{6})\.csv\.gz$/.exec(url)![1];
        if (m === '202607') throw new Error('HTTP 404 for ' + url);
        return gz(csvFor(m));
      },
    });
    const raw = (await fetchCrux(ctx)) as { month: string }[];
    expect(raw.map((r) => r.month)).toEqual(['2022-11', '2022-12', '2026-08']); // 202210 is before the half-step buckets
    expect(logs.some((l) => l.includes('202607') && l.includes('HTTP 404'))).toBe(true);
  });

  it('fails when nothing can be downloaded or no host is configured', async () => {
    const down = stub({ fetchBytes: async () => { throw new Error('HTTP 503'); } });
    await expect(fetchCrux(down.ctx)).rejects.toThrow('HTTP 503');
    await expect(fetchCrux(stub({ keys: () => [] }).ctx)).rejects.toThrow(/no crux hosts/);
    await expect(fetchCrux(stub({ fetchJson: async <T>() => ({ message: 'rate limited' }) as T }).ctx)).rejects.toThrow(/no monthly files/);
  });
});

describe('crux module', () => {
  it('declares an accumulating scale source with the CC BY 4.0 credit', () => {
    expect(crux).toMatchObject({ id: 'crux', role: 'scale', history: 'accumulate' });
    expect(crux.meta.credit).toBe('Chrome UX Report (Google), CC BY 4.0, via zakird/crux-top-lists');
    expect(crux.meta.license).toBe('CC BY 4.0');
  });
});
