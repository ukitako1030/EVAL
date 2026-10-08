// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import { createBackButton } from '../../src/ui/backButton';
import { createStore, defaultState, type AppState } from '../../src/state/store';

function setup(patch: Partial<AppState> = {}) {
  const store = createStore<AppState>({ ...defaultState(3), ...patch });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const back = createBackButton(root, store);
  return { store, root, back };
}

afterEach(() => document.body.replaceChildren());

describe('back to galaxy button', () => {
  it('is hidden in the galaxy view and shown while a front is focused', () => {
    const { store, back } = setup();
    expect(back.el.hidden).toBe(true);
    store.set({ front: 'code' });
    expect(back.el.hidden).toBe(false);
    store.set({ front: null });
    expect(back.el.hidden).toBe(true);
  });

  it('is a labelled HUD button in both languages', () => {
    const { store, back } = setup({ front: 'image' });
    expect(back.el.tagName).toBe('BUTTON');
    expect(back.el.type).toBe('button');
    expect(back.el.classList.contains('hud-btn')).toBe(true);
    expect(back.el.textContent).toBe('◀銀河に戻る');
    store.set({ lang: 'en' });
    expect(back.el.textContent).toBe('◀Back to galaxy');
    expect(back.el.querySelector('[aria-hidden="true"]')?.textContent).toBe('◀');
  });

  it('leaves the front (and closes the unit detail) on click', () => {
    const { store, back } = setup({ front: 'video', selectedUnit: 'veo' });
    back.el.click();
    expect(store.get().front).toBe(null);
    expect(store.get().selectedUnit).toBe(null);
    expect(back.el.hidden).toBe(true);
  });

  it('sits right after the title in the DOM, so the tab order follows the screen', () => {
    const store = createStore<AppState>({ ...defaultState(3) });
    const root = document.createElement('div');
    const title = document.createElement('header');
    title.id = 'hud-title';
    const tools = document.createElement('nav');
    root.append(title, tools);
    document.body.appendChild(root);
    const back = createBackButton(root, store);
    expect([...root.children]).toEqual([title, back.el, tools]);
  });

  it('destroy removes it and stops following the store', () => {
    const { store, root, back } = setup();
    back.destroy();
    expect(root.querySelector('#hud-back')).toBe(null);
    expect(() => store.set({ front: 'code' })).not.toThrow();
  });
});
