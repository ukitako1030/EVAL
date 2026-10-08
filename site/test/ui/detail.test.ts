// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import { createDetail } from '../../src/ui/detail';
import { announcementPointsUsed } from '../../src/ui/detailBlocks';
import { sparkPath } from '../../src/ui/sparkline';
import { createStore, defaultState, type AppState } from '../../src/state/store';
import type { World } from '../../src/data/types';
import { makeWorld } from '../fixtures/world';

const ARENA_URL = 'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset';

function setup(patch: Partial<AppState> = {}, edit?: (w: World) => void) {
  const world = makeWorld();
  edit?.(world);
  const store = createStore<AppState>({ ...defaultState(world.months.length - 1), ...patch });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const detail = createDetail(root, world, store);
  return { world, store, root, detail, panel: detail.el };
}

const text = (root: ParentNode, sel: string) => root.querySelector(sel)?.textContent;

afterEach(() => document.body.replaceChildren());

describe('sparkPath', () => {
  it('breaks the line at null months and keeps a lone point visible', () => {
    expect(sparkPath([10, null, 30, 40], 300, 100)).toBe('M0 90 h0 M200 70 L300 60');
    expect(sparkPath([null, null, 50, 60], 300, 100)).toBe('M200 50 L300 40');
    expect(sparkPath([null, null], 300, 100)).toBe('');
    expect(sparkPath([150, -5], 100, 100)).toBe('M0 0 L100 100'); // clamped to 0..100
  });
});

describe('announcementPointsUsed', () => {
  const url = 'https://example.com/a';
  const ann = { metric: 'WAU' as const, points: [{ date: '2025-02-20', value: 4e8, url }, { date: '2024-12-04', value: 3e8, url }, { date: '2025-03-31', value: 5e8, url }] };
  it('uses the bracketing points while interpolating, the month’s own point when there is one', () => {
    expect(announcementPointsUsed(ann, '2025-01').map((p) => p.date)).toEqual(['2024-12-04', '2025-02-20']);
    expect(announcementPointsUsed(ann, '2025-03').map((p) => p.date)).toEqual(['2025-03-31']);
    expect(announcementPointsUsed(ann, '2025-06').map((p) => p.date)).toEqual(['2025-03-31']);
    expect(announcementPointsUsed(ann, '2024-11')).toEqual([]);
  });
});

describe('unit detail panel', () => {
  it('is hidden until a unit of the current front is selected', () => {
    const { panel, store } = setup();
    expect(panel.hidden).toBe(true);
    store.set({ selectedUnit: 'gpt' });
    expect(panel.hidden).toBe(false);
    store.set({ front: 'image' }); // gpt is not on the image front
    expect(panel.hidden).toBe(true);
  });

  it('shows name, org, colour, values and their own confidence labels for the current month', () => {
    const { panel } = setup({ t: 2.3, selectedUnit: 'claude' });
    expect(text(panel, '.detail-name')).toBe('Claude');
    expect(text(panel, '.detail-org')).toBe('Anthropic · generalJA');
    expect(panel.style.getPropertyValue('--c')).toBe('#ff8a4c');
    expect(text(panel, '.detail-month')).toBe('2025.03');
    expect(text(panel, '.detail-s .detail-v')).toBe('100.0');
    expect(text(panel, '.detail-s .detail-q')).toBe('確度: 高（複数のデータ源）');
    expect(text(panel, '.detail-c .detail-v')).toBe('28.0%');
  });

  it('labels strength and scale confidence separately (qs / qc)', () => {
    const { panel } = setup({ t: 3, selectedUnit: 'gemini' }, (w) => {
      w.series.general.gemini[3] = { s: 85, c: 15, q: 'estimated', qs: 'reconstructed', qc: 'estimated' };
    });
    expect(text(panel, '.detail-s .detail-q')).toBe('確度: 再構成（過去を逆算）');
    expect(text(panel, '.detail-c .detail-q')).toBe('確度: 推定（霧）');
    expect(text(panel, '.detail-month')).toBe('2025.04速報値');
  });

  it('lists the strength breakdown with source links, data-through date, model, value, share and kind', () => {
    const { panel } = setup({ t: 0, selectedUnit: 'gpt' });
    const rows = panel.querySelectorAll('.bd-strength .bd-row');
    expect(rows).toHaveLength(1);
    const a = rows[0].querySelector('a')!;
    expect(a.textContent).toBe('Arena');
    expect(a.getAttribute('href')).toBe(ARENA_URL);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(text(rows[0], '.bd-through')).toBe('データの最終日 2025-04-10');
    expect(text(rows[0], '.bd-model')).toBe('gpt-4o');
    expect(text(rows[0], '.bd-value')).toBe('100.0');
    expect(text(rows[0], '.bd-share')).toBe('100%');
    expect(text(rows[0], '.bd-tag')).toBe('実測');
  });

  it('joins the names of the modules that share a source group, each with its own link', () => {
    const { panel } = setup({ t: 0, selectedUnit: 'gpt' }, (w) => {
      w.sources.push({ ...w.sources[0], id: 'arena-text-style', name: 'Arena (style control)', url: 'https://lmarena.ai/', dataThrough: '2025-04-12' });
    });
    const names = panel.querySelector('.bd-row .src-names')!;
    expect(names.textContent).toBe('Arena / Arena (style control)');
    expect([...names.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([ARENA_URL, 'https://lmarena.ai/']);
    expect(text(panel, '.bd-through')).toBe('データの最終日 2025-04-12');
  });

  it('renders a source without a URL (or with a non-http one) as plain text', () => {
    const { panel } = setup({ t: 0, selectedUnit: 'gpt' }, (w) => {
      w.sources[0].url = null;
      w.sources.push({ ...w.sources[0], id: 'x', name: 'Evil', url: 'javascript:alert(1)' });
    });
    const names = panel.querySelector('.bd-row .src-names')!;
    expect(names.textContent).toBe('Arena / Evil');
    expect(names.querySelectorAll('a')).toHaveLength(0);
  });

  it('explains an estimated unit with no breakdown, and says so plainly otherwise', () => {
    const { panel, store } = setup({ t: 2, selectedUnit: 'gemini' });
    expect(panel.querySelector('.bd-strength .bd-row')).toBeNull();
    const est = panel.querySelector('.bd-strength .bd-estimated')!;
    expect(est.querySelector('b')?.textContent).toBe('推定（霧）');
    expect(est.textContent).toContain('中央値');
    store.set({ t: 0, selectedUnit: 'claude' }); // medium confidence, no rows that month
    expect(panel.querySelector('.bd-strength .bd-estimated')).toBeNull();
    expect(text(panel, '.bd-strength .bd-empty')).toBe('この月の内訳はありません');
  });

  it('shows how scale is made and the announcement points used, with links', () => {
    const annUrl = 'https://example.com/chatgpt-300m';
    const { panel, store } = setup({ t: 0, selectedUnit: 'gpt' }, (w) => {
      w.sources.push({ id: 'crux', group: 'crux', name: 'CrUX', url: 'https://github.com/zakird/crux-top-lists', license: 'CC BY 4.0', credit: 'CrUX', asOf: null, dataThrough: null });
      w.scaleBreakdown.general = {
        gpt: {
          '2025-01': [
            { component: 'users', share: 54.25, signals: ['announcements'] },
            { component: 'consumer', share: 60, signals: ['crux'] },
            { component: 'business', share: 40, signals: [] },
            { component: 'mystery', share: 1, signals: ['nope'] },
          ],
        },
      };
      w.units.general.gpt.announcements = 'chatgpt';
      w.announcements.chatgpt = { metric: 'WAU', points: [{ date: '2024-12-04', value: 3e8, url: annUrl }, { date: '2025-02-20', value: 4e8, url: 'ftp://x' }] };
    });
    const rows = [...panel.querySelectorAll('.bd-scale .sbd-row')];
    expect(rows.map((r) => r.querySelector('.sbd-label')?.textContent)).toEqual(['利用者数（公式発表）', '一般向けの浸透度', '企業・開発者の利用', 'mystery']);
    expect(rows.map((r) => r.querySelector('.bd-value')?.textContent)).toEqual(['54.3%', '60.0%', '40.0%', '1.0%']);
    expect(rows[0].querySelector('.sbd-signals')?.textContent).toBe('公式発表');
    expect(rows[1].querySelector('.sbd-signals a')?.getAttribute('href')).toBe('https://github.com/zakird/crux-top-lists');
    expect(rows[2].querySelector('.sbd-signals')?.textContent).toBe('シグナルなし（基準値）');
    expect(rows[3].querySelector('.sbd-signals')?.textContent).toBe('nope');
    const points = [...panel.querySelectorAll('.ann-point')];
    expect(points).toHaveLength(2);
    expect(points[0].querySelector('time')?.textContent).toBe('2024-12-04');
    expect(points[0].querySelector('b')?.textContent).toBe('3億 WAU');
    expect(points[0].querySelector('a')?.getAttribute('href')).toBe(annUrl);
    expect(points[1].querySelector('a')).toBeNull(); // not an http(s) link
    store.set({ lang: 'en' });
    expect(panel.querySelector('.ann-point b')?.textContent).toBe('300M WAU');
    expect(text(panel, '.bd-scale .bd-h')).toBe('How scale is made');
  });

  it('draws a sparkline of s and c over all months with the current month marked and gaps for null months', () => {
    const { panel, store } = setup({ t: 3, selectedUnit: 'gemini' });
    expect(panel.querySelector('.spark-s')?.getAttribute('d')).toBe('M200 19.2 L300 9.6');
    expect(panel.querySelector('.spark-now')?.getAttribute('x1')).toBe('300');
    store.set({ selectedUnit: 'claude', t: 1 });
    expect(panel.querySelector('.spark-now')?.getAttribute('x1')).toBe('100');
    expect(panel.querySelector('.spark-s')?.getAttribute('d')?.match(/M/g)).toHaveLength(1);
  });

  it('a null month in the middle splits the sparkline', () => {
    const { panel } = setup({ t: 3, selectedUnit: 'claude' }, (w) => {
      w.series.general.claude[1] = null;
    });
    const d = panel.querySelector('.spark-s')!.getAttribute('d')!;
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).toBe('M0 12.8 h0 M200 0 L300 0');
    expect(text(panel, '.detail-note')).toBeUndefined();
  });

  it('says when the unit has no data for the month', () => {
    const { panel } = setup({ t: 0, selectedUnit: 'gemini' });
    expect(text(panel, '.detail-s .detail-v')).toBe('—');
    expect(text(panel, '.detail-note')).toBe('この月はデータがありません');
  });

  it('close button and Escape clear the selection', () => {
    const { panel, store } = setup({ selectedUnit: 'gpt' });
    const close = panel.querySelector<HTMLButtonElement>('.detail-close')!;
    expect(close.getAttribute('aria-label')).toBe('閉じる');
    close.click();
    expect(store.get().selectedUnit).toBeNull();
    expect(panel.hidden).toBe(true);
    store.set({ selectedUnit: 'gpt' });
    panel.querySelector('.detail-name')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(store.get().selectedUnit).toBeNull();
  });

  it('moves focus to the unit name when it opens', () => {
    const { panel, store } = setup();
    store.set({ selectedUnit: 'gpt' });
    expect(document.activeElement).toBe(panel.querySelector('.detail-name'));
  });

  it('renders untrusted names as text', () => {
    const { panel } = setup({ t: 0, selectedUnit: 'gpt' }, (w) => {
      w.units.general.gpt.name = '<b id="pwn">x</b>';
      w.breakdown.general.gpt['2025-01'][0].model = '<script>alert(1)</script>';
    });
    expect(panel.querySelector('#pwn')).toBeNull();
    expect(panel.querySelector('script')).toBeNull();
    expect(text(panel, '.detail-name')).toBe('<b id="pwn">x</b>');
  });
});
