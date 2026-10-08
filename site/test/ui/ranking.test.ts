// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import { createRanking, ROW_H } from '../../src/ui/ranking';
import { createStore, defaultState, type AppState } from '../../src/state/store';
import { makeWorld } from '../fixtures/world';

function setup(patch: Partial<AppState> = {}) {
  const world = makeWorld();
  const store = createStore<AppState>({ ...defaultState(world.months.length - 1), t: 2, ...patch });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ranking = createRanking(root, world, store);
  return { world, store, root, ranking };
}

const visibleRows = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLLIElement>('li.rank-row')].filter((li) => !li.hidden).sort((a, b) => Number(a.dataset.rank) - Number(b.dataset.rank));
const order = (root: HTMLElement) => visibleRows(root).map((li) => li.dataset.unit);
const row = (root: HTMLElement, unit: string) => root.querySelector<HTMLLIElement>(`li.rank-row[data-unit="${unit}"]`)!;

afterEach(() => document.body.replaceChildren());

describe('ranking panel', () => {
  it('is an ordered list of rows in strength order with ▲/▼ from rankDelta', () => {
    const { root } = setup();
    expect(root.querySelector('ol.rank-list')).not.toBeNull();
    expect(order(root)).toEqual(['claude', 'gpt', 'gemini']);
    expect(row(root, 'claude').querySelector('.rank-delta')?.className).toBe('rank-delta up');
    expect(row(root, 'claude').querySelector('.rank-delta [aria-hidden]')?.textContent).toBe('▲1');
    expect(row(root, 'gpt').querySelector('.rank-delta [aria-hidden]')?.textContent).toBe('▼1');
    expect(row(root, 'gpt').querySelector('.rank-delta')?.classList.contains('down')).toBe(true);
    expect(row(root, 'gemini').querySelector('.rank-delta [aria-hidden]')?.textContent).toBe('NEW');
    expect(row(root, 'claude').getAttribute('aria-posinset')).toBe('1');
    expect(row(root, 'claude').getAttribute('aria-setsize')).toBe('3');
  });

  it('setRowHeight re-pitches the rows and the list (the mobile layout)', () => {
    const { root, ranking } = setup();
    ranking.setRowHeight(40);
    expect(row(root, 'gpt').style.transform).toBe('translateY(40px)');
    expect(row(root, 'gemini').style.transform).toBe('translateY(80px)');
    expect(root.querySelector<HTMLElement>('ol.rank-list')!.style.height).toBe('120px');
    ranking.setRowHeight(0); // ignored
    expect(row(root, 'gpt').style.transform).toBe('translateY(40px)');
    ranking.setRowHeight(ROW_H);
    expect(row(root, 'gpt').style.transform).toBe(`translateY(${ROW_H}px)`);
  });

  it('positions rows by rank and shows the real values', () => {
    const { root } = setup();
    expect(row(root, 'claude').style.transform).toBe('translateY(0px)');
    expect(row(root, 'gpt').style.transform).toBe(`translateY(${ROW_H}px)`);
    expect(row(root, 'gemini').style.transform).toBe(`translateY(${2 * ROW_H}px)`);
    const vals = [...row(root, 'gpt').querySelectorAll('.rank-v')].map((b) => b.textContent);
    expect(vals).toEqual(['90.0', '60.0%']);
    // the strength bar spans 40..100: 90 → (90-40)/60
    expect(row(root, 'gpt').querySelector<HTMLElement>('.rank-bar-s i')!.style.transform).toBe('scaleX(0.833)');
    expect(row(root, 'gpt').querySelector<HTMLElement>('.rank-bar-c i')!.style.transform).toBe('scaleX(0.600)');
    expect(row(root, 'gpt').querySelector('.rank-name b')?.textContent).toBe('GPT');
    expect(row(root, 'gpt').querySelector('.rank-name small')?.textContent).toBe('OpenAI');
    expect(row(root, 'gpt').style.getPropertyValue('--c')).toBe('#19c37d');
  });

  it('marks fogged units and the leader', () => {
    const { root } = setup();
    expect(row(root, 'gemini').classList.contains('fog')).toBe(true);
    expect(row(root, 'claude').classList.contains('fog')).toBe(false);
    expect(row(root, 'claude').classList.contains('lead')).toBe(true);
  });

  it('toggling the sort reorders the rows', () => {
    const { root, store } = setup();
    const byScale = root.querySelector<HTMLButtonElement>('button[data-sort="scale"]')!;
    byScale.click();
    expect(store.get().sortBy).toBe('scale');
    expect(order(root)).toEqual(['gpt', 'claude', 'gemini']);
    expect(byScale.getAttribute('aria-pressed')).toBe('true');
    root.querySelector<HTMLButtonElement>('button[data-sort="strength"]')!.click();
    expect(order(root)).toEqual(['claude', 'gpt', 'gemini']);
  });

  it('clicking a row selects the unit', () => {
    const { root, store } = setup();
    row(root, 'gpt').querySelector<HTMLButtonElement>('button.rank-name')!.click();
    expect(store.get().selectedUnit).toBe('gpt');
  });

  it('hovering a row sets hoverOrg and dims the other orgs; leaving clears it', () => {
    const { root, store } = setup();
    row(root, 'gpt').dispatchEvent(new PointerEvent('pointerenter'));
    expect(store.get().hoverOrg).toBe('openai');
    expect(row(root, 'claude').classList.contains('dim')).toBe(true);
    expect(row(root, 'gpt').classList.contains('dim')).toBe(false);
    row(root, 'gpt').dispatchEvent(new PointerEvent('pointerleave'));
    expect(store.get().hoverOrg).toBeNull();
    expect(row(root, 'claude').classList.contains('dim')).toBe(false);
  });

  it('follows the focused front and shows an empty note when nobody is deployed yet', () => {
    const { root, store } = setup({ front: 'image' });
    expect(order(root)).toEqual(['nb']);
    expect(root.querySelector('.rank-front')?.textContent).toBe('imageJA');
    store.set({ t: 0 });
    expect(order(root)).toEqual([]);
    expect(root.querySelector<HTMLElement>('.rank-empty')!.hidden).toBe(false);
    store.set({ front: null, t: 2 });
    expect(order(root)).toEqual(['claude', 'gpt', 'gemini']);
    expect(root.querySelector('.rank-front')?.textContent).toBe('generalJA');
  });

  it('keeps the rows in rank order in the DOM (tab / reading order), with focus staying on a moved row', () => {
    const { root, store } = setup({ t: 0 });
    const domOrder = () => [...root.querySelectorAll<HTMLLIElement>('li.rank-row')].filter((li) => !li.hidden).map((li) => li.dataset.unit);
    expect(domOrder()).toEqual(['gpt', 'claude']); // 2025-01
    const gptBtn = row(root, 'gpt').querySelector<HTMLButtonElement>('button.rank-name')!;
    gptBtn.focus();
    expect(store.get().hoverOrg).toBe('openai');
    store.set({ t: 2 }); // Claude takes the lead, Gemini arrives
    expect(domOrder()).toEqual(['claude', 'gpt', 'gemini']);
    expect(document.activeElement).toBe(gptBtn); // re-focused after the move
    expect(store.get().hoverOrg).toBe('openai'); // the move is not a blur
    store.set({ sortBy: 'scale' });
    expect(domOrder()).toEqual(['gpt', 'claude', 'gemini']);
    expect(row(root, 'gpt').style.transform).toBe('translateY(0px)'); // still placed by rank on screen
  });

  it('setVisibleRows makes the rows below the cut inert (the collapsed mobile list) until it is lifted', () => {
    const { root, ranking } = setup();
    ranking.setVisibleRows(2);
    expect(row(root, 'claude').hasAttribute('inert')).toBe(false);
    expect(row(root, 'gpt').hasAttribute('inert')).toBe(false);
    expect(row(root, 'gemini').hasAttribute('inert')).toBe(true);
    ranking.setVisibleRows(null);
    expect(row(root, 'gemini').hasAttribute('inert')).toBe(false);
  });

  it('switches language and turns transitions off under reduced motion', () => {
    const { root, store } = setup();
    store.set({ lang: 'en', reducedMotion: true });
    expect(root.querySelector('h2')?.textContent).toBe('Standings');
    expect(row(root, 'gpt').querySelector('.rank-bar-s em')?.textContent).toBe('Strength');
    expect(row(root, 'gpt').querySelector('button.rank-name')?.getAttribute('aria-label')).toBe('GPT (OpenAI) — Open details');
    expect(root.querySelector('.ranking')?.classList.contains('reduced-motion')).toBe(true);
  });
});
