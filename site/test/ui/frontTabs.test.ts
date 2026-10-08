// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import { createFrontTabs } from '../../src/ui/frontTabs';
import { createStore, defaultState, type AppState } from '../../src/state/store';
import { makeWorld } from '../fixtures/world';

function setup(patch: Partial<AppState> = {}) {
  const world = makeWorld();
  const store = createStore<AppState>({ ...defaultState(world.months.length - 1), ...patch });
  const root = document.createElement('div');
  root.appendChild(document.createElement('section')); // the ranking already in the panel
  document.body.appendChild(root);
  const tabs = createFrontTabs(root, world, store);
  return { world, store, root, tabs };
}

const chips = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('button.front-tab')];
const chip = (root: HTMLElement, id: string) => root.querySelector<HTMLButtonElement>(`button.front-tab[data-front="${id}"]`)!;
const key = (target: HTMLElement, k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};

afterEach(() => document.body.replaceChildren());

describe('desktop front selector', () => {
  it('is a labelled nav with one chip per front, first in the panel, named by the full front name', () => {
    const { root, store } = setup();
    const nav = root.firstElementChild as HTMLElement;
    expect(nav.tagName).toBe('NAV');
    expect(nav.getAttribute('aria-label')).toBe('戦線');
    expect(chips(root).map((b) => b.dataset.front)).toEqual(['general', 'code', 'agent', 'image', 'video', 'speech', 'music']);
    expect(chips(root).map((b) => b.textContent)).toEqual(['総', 'コ', 'エ', '画', '動', '声', '楽']);
    expect(chip(root, 'code').getAttribute('aria-label')).toBe('codeJA');
    expect(chip(root, 'code').title).toBe('codeJA');
    store.set({ lang: 'en' });
    expect(nav.getAttribute('aria-label')).toBe('Fronts');
    expect(chips(root).map((b) => b.textContent).join('')).toBe('GCAIVSM');
    expect(chip(root, 'image').getAttribute('aria-label')).toBe('imageEN');
  });

  it('a click enters that front (closing a unit detail), like clicking its planet; the current front is aria-current', () => {
    const { root, store } = setup({ selectedUnit: 'gpt' });
    expect(chips(root).some((b) => b.hasAttribute('aria-current'))).toBe(false); // galaxy overview
    chip(root, 'image').click();
    expect(store.get().front).toBe('image');
    expect(store.get().selectedUnit).toBeNull();
    expect(chip(root, 'image').getAttribute('aria-current')).toBe('true');
    store.set({ front: 'general' });
    expect(chip(root, 'image').hasAttribute('aria-current')).toBe(false);
    expect(chip(root, 'general').getAttribute('aria-current')).toBe('true');
  });

  it('is one tab stop; arrows / Home / End move focus along it (and are consumed), Enter-click opens', () => {
    const { root, store } = setup({ front: 'agent' });
    expect(chips(root).filter((b) => b.tabIndex === 0).map((b) => b.dataset.front)).toEqual(['agent']); // follows the front
    chip(root, 'agent').focus();
    const e = key(chip(root, 'agent'), 'ArrowRight');
    expect(e.defaultPrevented).toBe(true); // the timeline's ← → month step must not also fire
    expect(document.activeElement).toBe(chip(root, 'image'));
    expect(chips(root).filter((b) => b.tabIndex === 0).map((b) => b.dataset.front)).toEqual(['image']);
    key(chip(root, 'image'), 'End');
    expect(document.activeElement).toBe(chip(root, 'music'));
    key(chip(root, 'music'), 'ArrowRight'); // wraps
    expect(document.activeElement).toBe(chip(root, 'general'));
    key(chip(root, 'general'), 'ArrowLeft');
    expect(document.activeElement).toBe(chip(root, 'music'));
    key(chip(root, 'music'), 'Home');
    expect(document.activeElement).toBe(chip(root, 'general'));
    expect(store.get().front).toBe('agent'); // moving focus does not switch the front
    expect(key(chip(root, 'general'), 'a').defaultPrevented).toBe(false);
    (document.activeElement as HTMLButtonElement).click();
    expect(store.get().front).toBe('general');
  });

  it('marks each chip with the colour of that front’s leader (dim when nobody is there yet)', () => {
    const { root, store } = setup({ t: 3 });
    expect(chip(root, 'general').style.getPropertyValue('--c')).toBe('#ff8a4c'); // Claude leads in 2025-04
    expect(chip(root, 'image').style.getPropertyValue('--c')).toBe('#4c8dff');
    expect(chip(root, 'code').classList.contains('empty')).toBe(true);
    store.set({ t: 0 });
    expect(chip(root, 'general').style.getPropertyValue('--c')).toBe('#19c37d'); // GPT in 2025-01
    expect(chip(root, 'image').classList.contains('empty')).toBe(true);
  });

  it('leaving a front with focus nowhere (its rows / the back button are gone) lands focus on that front’s chip', async () => {
    const { root, store } = setup({ front: 'video' });
    const gone = document.createElement('button');
    root.appendChild(gone);
    gone.focus();
    gone.remove(); // what had focus disappears with the front
    store.set({ front: null });
    await Promise.resolve();
    expect(document.activeElement).toBe(chip(root, 'video'));
    expect(chip(root, 'video').tabIndex).toBe(0);
    // focus somewhere else is left alone
    store.set({ front: 'code' });
    const other = document.createElement('button');
    root.appendChild(other);
    other.focus();
    store.set({ front: null });
    await Promise.resolve();
    expect(document.activeElement).toBe(other);
  });

  it('destroy removes it', () => {
    const { root, tabs, store } = setup();
    tabs.destroy();
    expect(root.querySelector('nav')).toBeNull();
    store.set({ front: 'code' }); // no longer listening
  });
});
