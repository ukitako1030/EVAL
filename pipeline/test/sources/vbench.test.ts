import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { findMainTable, parseVbench, slimConfig, stripMarkdownLink, vbench } from '../../src/sources/vbench';
import type { FetchCtx } from '../../src/sources/types';

type Json = Record<string, any>;
const text = readFileSync(new URL('../fixtures/vbench/sample.json', import.meta.url), 'utf8');
const config = () => JSON.parse(text) as Json;
const now = new Date('2026-10-12T06:00:00Z');

describe('vbench parse', () => {
  const obs = parseVbench(config());
  const byModel = (m: string) => obs.find((o) => o.model === m);

  it('reads the 40 fixture rows of the main T2V table as percent / release observations', () => {
    expect(obs).toHaveLength(40);
    expect(obs.every((o) => o.series === 'vbench' && o.kind === 'percent' && o.dateKind === 'release')).toBe(true);
    expect(obs.every((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date) && o.value > 0 && o.value < 100)).toBe(true);
  });

  it('maps concrete rows exactly (markdown stripped, "85.06%" → 85.06)', () => {
    expect(byModel('Veo 3')).toEqual({ series: 'vbench', kind: 'percent', model: 'Veo 3', date: '2025-08-06', dateKind: 'release', value: 85.06 });
    expect(byModel('HiDream-O1-Video')).toMatchObject({ date: '2026-08-07', value: 89.74 });
    expect(byModel('Vidu Q1 (2025-04-17)')).toMatchObject({ date: '2025-04-21', value: 87.41 });
    expect(byModel('Sora')).toMatchObject({ date: '2025-01-14', value: 84.28 });
    expect(obs.some((o) => o.model.includes('](') || o.model.startsWith('['))).toBe(false);
  });

  it('does not mix in the VBench 2.0 / I2V tables', () => {
    expect(obs.some((o) => /Seedance|Sora-480p|StepVideo/.test(o.model))).toBe(false);
  });

  it('accepts the config as a JSON string too', () => {
    expect(parseVbench(text)).toEqual(obs);
  });

  it('still finds the table after a renumbering of the component ids (layout label)', () => {
    const cfg = config();
    for (const c of cfg.components) c.id += 500;
    const shift = (n: Json): void => {
      n.id += 500;
      (n.children ?? []).forEach(shift);
    };
    shift(cfg.layout);
    expect(findMainTable(cfg)?.data).toHaveLength(40);
    expect(parseVbench(cfg)).toEqual(obs);
  });

  it('falls back to the header (Total Score + Semantic Score) when the layout is gone', () => {
    const cfg = config();
    cfg.layout = { id: 0 };
    for (const c of cfg.components) c.id += 7; // main table is no longer id 20 either
    expect(parseVbench(cfg)).toEqual(obs);
  });

  it('yields [] when no table has the total-score columns, and never throws on a bad row', () => {
    expect(parseVbench({})).toEqual([]);
    expect(parseVbench(null)).toEqual([]);
    expect(parseVbench('not json')).toEqual([]);
    const cfg = config();
    const t = cfg.components.find((c: Json) => c.id === 20).props.value;
    t.data.push(null, ['only one cell'], [`[Broken](u)`, '', '', '', '', 'not a date', 'n/a'], ['', '', '', '', '', '2026-01-01', '50.00%']);
    expect(parseVbench(cfg)).toEqual(obs);
    const noScores = config();
    noScores.components = noScores.components.filter((c: Json) => c.id !== 20);
    // without the main table the VBench 2.0 / I2V tables must not be used instead
    expect(parseVbench(noScores)).toEqual([]);
  });
});

describe('stripMarkdownLink', () => {
  it('extracts the link text', () => {
    expect(stripMarkdownLink('[Veo 3](https://cloud.google.com/x?hl=zh-cn)')).toBe('Veo 3');
    expect(stripMarkdownLink('  [Wan2.1 (2025-02-24)](https://t.example/a_(b))  ')).toBe('Wan2.1 (2025-02-24)');
    expect(stripMarkdownLink('[modiv1.2]')).toBe('modiv1.2');
    expect(stripMarkdownLink('LTX-Video (5s 768×512)')).toBe('LTX-Video (5s 768×512)');
    expect(stripMarkdownLink('[LTX-Video (5s 768×512)](https://github.com/Lightricks/LTX-Video)')).toBe('LTX-Video (5s 768×512)');
  });
});

describe('vbench module', () => {
  it('fetches the Gradio /config document, keeping only the tables and dropping page prose (e-mail addresses)', async () => {
    const seen: string[] = [];
    const cfg = config();
    cfg.components.push({ id: 999, type: 'markdown', props: { value: 'Contact the VBench Team at someone@example.edu to submit.' } });
    const ctx = {
      fetchJson: async (url: string) => {
        seen.push(url);
        return structuredClone(cfg);
      },
    } as unknown as FetchCtx;
    const raw = await vbench.fetch(ctx);
    expect(seen).toEqual(['https://vchitect-vbench-leaderboard.hf.space/config']);
    expect(JSON.stringify(raw)).not.toMatch(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(JSON.stringify(raw)).not.toContain('Contact the VBench Team');
    expect(JSON.parse(JSON.stringify(raw))).toEqual(raw);
    expect(vbench.parse(raw, { now })).toEqual(parseVbench(config()));
    expect(vbench.parse(raw, { now })).toHaveLength(40);
  });

  it('slimConfig scrubs e-mail addresses even inside table cells', () => {
    const cfg = config();
    cfg.components.find((c: Json) => c.id === 20).props.value.data[0][2] = 'Team (a.b@lab.example.org)';
    const slim = slimConfig(cfg) as Json;
    expect(JSON.stringify(slim)).not.toContain('@');
    expect(findMainTable(slim)?.data[0][2]).toBe('Team (<redacted>)');
  });

  it('declares the module contract', () => {
    expect(vbench).toMatchObject({ id: 'vbench', role: 'strength', group: 'vbench', history: 'full' });
    expect(vbench.meta.credit).toBe('VBench leaderboard (Vchitect), cited; no explicit data licence');
  });
});
