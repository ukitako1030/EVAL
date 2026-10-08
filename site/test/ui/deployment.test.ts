// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import { createDeployment } from '../../src/ui/deployment';
import { createStore, defaultState, type AppState } from '../../src/state/store';
import { makeWorld } from '../fixtures/world';

function setup(patch: Partial<AppState> = {}) {
  const world = makeWorld();
  const store = createStore<AppState>({ ...defaultState(world.months.length - 1), ...patch });
  const root = document.createElement('div');
  document.body.appendChild(root);
  createDeployment(root, world, store);
  return { world, store, root };
}

const orgRow = (root: HTMLElement, org: string) => root.querySelector<HTMLTableRowElement>(`tr.deploy-row[data-org="${org}"]`);
const filled = (root: HTMLElement, org: string) => [...orgRow(root, org)!.querySelectorAll<HTMLElement>('td.deploy-cell.on')].map((td) => td.dataset.front);

afterEach(() => document.body.replaceChildren());

describe('deployment matrix', () => {
  it('has one column per front and one row per deployed org', () => {
    const { root } = setup({ t: 3 });
    expect(root.querySelectorAll('thead th')).toHaveLength(1 + 7 + 1);
    expect([...root.querySelectorAll<HTMLElement>('tr.deploy-row')].map((r) => r.dataset.org)).toEqual(['google', 'openai', 'anthropic']);
  });

  it('shows Google on 2 fronts at t=3', () => {
    const { root } = setup({ t: 3 });
    expect(filled(root, 'google')).toEqual(['general', 'image']);
    expect(orgRow(root, 'google')!.querySelector('.deploy-count')?.textContent).toBe('2');
    expect(filled(root, 'openai')).toEqual(['general']);
  });

  it('follows t (Google is not deployed yet in 2025-02)', () => {
    const { root, store } = setup({ t: 3 });
    store.set({ t: 1 });
    expect(orgRow(root, 'google')).toBeNull();
    expect(orgRow(root, 'openai')).not.toBeNull();
  });

  it('hovering an org row sets hoverOrg and dims the others', () => {
    const { root, store } = setup({ t: 3 });
    orgRow(root, 'google')!.dispatchEvent(new PointerEvent('pointerenter'));
    expect(store.get().hoverOrg).toBe('google');
    expect(orgRow(root, 'openai')!.classList.contains('dim')).toBe(true);
    orgRow(root, 'google')!.dispatchEvent(new PointerEvent('pointerleave'));
    expect(store.get().hoverOrg).toBeNull();
  });

  it('labels the front columns in the current language', () => {
    const { root, store } = setup({ t: 3 });
    const abbrs = () => [...root.querySelectorAll('thead abbr')].map((a) => a.textContent).join('');
    expect(abbrs()).toBe('総コエ画動声楽');
    expect(root.querySelector('thead abbr')?.getAttribute('title')).toBe('generalJA');
    store.set({ lang: 'en' });
    expect(abbrs()).toBe('GCAIVSM');
    expect(root.querySelector('h2')?.textContent).toBe('Deployment');
  });
});
