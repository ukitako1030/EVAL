import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseStatcounter, statcounter, statcounterUrl } from '../../src/sources/statcounter';
import type { FetchCtx } from '../../src/sources/types';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/statcounter/${name}`, import.meta.url), 'utf8');
const csv = fixture('sample.csv');

describe('statcounterUrl', () => {
  it('requests the worldwide monthly CSV from 202301 up to the previous month', () => {
    const url = statcounterUrl(new Date('2026-10-08T06:00:00Z'));
    expect(url).toBe(
      'https://gs.statcounter.com/chart.php?device=Desktop%20%26%20Mobile%20%26%20Tablet%20%26%20Console&device_hidden=desktop%2Bmobile%2Btablet%2Bconsole&multi-device=true&statType_hidden=ai_chatbot&region_hidden=ww&granularity=monthly&statType=AI%20Chatbot&region=Worldwide&fromInt=202301&toInt=202609&fromMonthYear=2023-01&toMonthYear=2026-09&csv=1',
    );
  });
  it('rolls over the year boundary', () => {
    const url = statcounterUrl(new Date('2027-01-03T00:00:00Z'));
    expect(url).toContain('toInt=202612&');
    expect(url).toContain('toMonthYear=2026-12&');
  });
});

describe('parseStatcounter (fixture sample.csv)', () => {
  const out = parseStatcounter(csv);
  const at = (key: string, month: string) => out.find((o) => o.key === key && o.month === month);

  it('drops the all-zero rows (2023-01 … 2025-03 are missing, not 0 %)', () => {
    expect(out.every((o) => o.month >= '2025-04')).toBe(true);
    expect(out.every((o) => o.value > 0 && Number.isFinite(o.value))).toBe(true);
    expect([...new Set(out.map((o) => o.month))]).toHaveLength(18); // 2025-04 … 2026-09
  });

  it('maps every column label except Date and Other to a signal key', () => {
    expect([...new Set(out.map((o) => o.key))].sort()).toEqual(['ChatGPT', 'Claude', 'Deepseek', 'Google Gemini', 'Microsoft Copilot', 'Perplexity']);
    expect(out).toHaveLength(18 * 6);
  });

  it('keeps the share values (0–100) of specific rows exactly', () => {
    expect(at('ChatGPT', '2025-04')).toEqual({ signal: 'statcounter', key: 'ChatGPT', month: '2025-04', value: 84.21 });
    expect(at('Google Gemini', '2026-09')).toEqual({ signal: 'statcounter', key: 'Google Gemini', month: '2026-09', value: 10.94 });
    expect(at('Claude', '2026-03')?.value).toBe(2.91);
    expect(at('Deepseek', '2025-10')?.value).toBe(0.01);
    expect(at('Perplexity', '2025-04')?.value).toBe(12.07);
    expect(at('Other', '2026-06')).toBeUndefined(); // 0.01 in the file, but Other is not a product
  });

  it('emits months in ascending order although the file has the real rows first', () => {
    const months = out.map((o) => o.month);
    expect(months).toEqual([...months].sort());
    expect(months[0]).toBe('2025-04');
    expect(months[months.length - 1]).toBe('2026-09');
  });

  it('returns [] for the single-month bar format (no Date column)', () => {
    expect(parseStatcounter(fixture('sample-bar.csv'))).toEqual([]);
  });
});

describe('parseStatcounter (edge cases)', () => {
  it('maps columns by header name, whatever their order, and sorts by Date', () => {
    const text = '"Date","Claude","Other","ChatGPT"\n2025-06,1.11,0,79.86\n2025-05,0.46,0,79.79\n2025-04,0,0,0\n';
    expect(parseStatcounter(text)).toEqual([
      { signal: 'statcounter', key: 'Claude', month: '2025-05', value: 0.46 },
      { signal: 'statcounter', key: 'ChatGPT', month: '2025-05', value: 79.79 },
      { signal: 'statcounter', key: 'Claude', month: '2025-06', value: 1.11 },
      { signal: 'statcounter', key: 'ChatGPT', month: '2025-06', value: 79.86 },
    ]);
  });

  it('does not emit a 0 for one label of an otherwise real row, and skips unreadable cells', () => {
    const text = '"Date","A","B","C","Other"\n2025-07,5.5,0,-,0.01\n';
    expect(parseStatcounter(text)).toEqual([{ signal: 'statcounter', key: 'A', month: '2025-07', value: 5.5 }]);
  });

  it('emits nothing for a month in which only Other is non-zero, and handles CRLF and a BOM', () => {
    const text = '﻿"Date","A","Other"\r\n2025-07,0,0.5\r\n2025-08,1.5,0\r\n';
    expect(parseStatcounter(text)).toEqual([{ signal: 'statcounter', key: 'A', month: '2025-08', value: 1.5 }]);
  });

  it('skips rows without a valid Date and returns [] for unusable payloads', () => {
    expect(parseStatcounter('"Date","A"\nnot-a-date,5\n,6\n2025-09,7\n')).toEqual([{ signal: 'statcounter', key: 'A', month: '2025-09', value: 7 }]);
    expect(parseStatcounter('')).toEqual([]);
    expect(parseStatcounter('<html>blocked</html>')).toEqual([]);
    expect(parseStatcounter(null)).toEqual([]);
    expect(parseStatcounter({})).toEqual([]);
  });
});

describe('statcounter module', () => {
  it('declares a full-history scale source with a linked CC BY-SA credit', () => {
    expect(statcounter).toMatchObject({ id: 'statcounter', role: 'scale', history: 'full' });
    expect(statcounter.meta.license).toBe('CC BY-SA 3.0');
    expect(statcounter.meta.credit).toContain('https://gs.statcounter.com');
  });

  it('fetch() requests the URL for the previous month and returns the CSV text', async () => {
    const seen: string[] = [];
    const ctx = {
      now: new Date('2026-10-08T06:00:00Z'),
      fetchText: async (url: string) => {
        seen.push(url);
        return csv;
      },
    } as unknown as FetchCtx;
    const raw = await statcounter.fetch(ctx);
    expect(raw).toBe(csv);
    expect(seen).toEqual([statcounterUrl(ctx.now)]);
    expect(statcounter.parse(raw, { now: ctx.now })).toHaveLength(108);
  });
});
