// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { mountHud } from '../../src/ui/hud';
import { createStore, defaultState, type AppState } from '../../src/state/store';
import { makeWorld } from '../fixtures/world';

function setup(patch: Partial<AppState> = {}) {
  const world = makeWorld();
  const store = createStore<AppState>({ ...defaultState(world.months.length - 1), ...patch });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const hud = mountHud(root, store, world);
  return { world, store, root, hud };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.useRealTimers();
});

describe('HUD shell', () => {
  it('shows the title, big month digits and the preliminary tag only on the partial month', () => {
    const { root, store } = setup();
    expect(root.querySelector('.hud-logo')?.textContent).toBe('AI WAR');
    expect(root.querySelector('.hud-sub')?.textContent).toBe('電脳戦況モニター');
    expect(root.querySelector('#hud-month')?.textContent).toBe('2025.04');
    const prelim = root.querySelector<HTMLElement>('#hud-preliminary')!;
    expect(prelim.hidden).toBe(false);
    expect(prelim.textContent).toBe('速報値');
    store.set({ t: 2.4 });
    expect(root.querySelector('#hud-month')?.textContent).toBe('2025.03');
    expect(prelim.hidden).toBe(true);
  });

  it('shows the last-updated date, legend, unofficial line and the methods link', () => {
    const { root } = setup();
    expect(root.querySelector('#hud-updated')?.textContent).toBe('最終更新 2025-04-15');
    expect(root.querySelectorAll('.hud-lg')).toHaveLength(3);
    expect(root.querySelector('#hud-legend')?.textContent).toContain('霧＝推定を含む');
    expect(root.querySelector('#hud-unofficial')?.textContent).toBe('各社とは無関係の非公式・非商用プロジェクトです');
    expect(root.querySelector('#hud-methods')?.getAttribute('href')).toBe('methods.html?lang=ja');
  });

  it('exposes empty slots for the other components', () => {
    const { hud, root } = setup();
    for (const slot of Object.values(hud.slots)) expect(root.contains(slot)).toBe(true);
    expect(hud.slots.panel.contains(hud.slots.ranking)).toBe(true);
    expect(hud.slots.panel.contains(hud.slots.deployment)).toBe(true);
  });

  it('language toggle switches the visible strings', () => {
    const { root, store } = setup();
    const en = root.querySelector<HTMLButtonElement>('button[data-lang="en"]')!;
    const ja = root.querySelector<HTMLButtonElement>('button[data-lang="ja"]')!;
    expect(ja.getAttribute('aria-pressed')).toBe('true');
    en.click();
    expect(store.get().lang).toBe('en');
    expect(root.querySelector('.hud-sub')?.textContent).toBe('AI battlefield monitor');
    expect(root.querySelector('#hud-share')?.textContent).toBe('Share');
    expect(root.querySelector('#hud-preliminary')?.textContent).toBe('preliminary');
    expect(root.querySelector('#hud-methods')?.getAttribute('href')).toBe('methods.html?lang=en');
    expect(en.getAttribute('aria-pressed')).toBe('true');
    expect(ja.getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.lang).toBe('en');
    ja.click();
    expect(root.querySelector('.hud-sub')?.textContent).toBe('電脳戦況モニター');
  });

  it('share copies the page URL with the encoded state and confirms', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { root } = setup();
    root.querySelector<HTMLButtonElement>('#hud-share')!.click();
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    const url = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(url.endsWith('?t=2025-04&lang=ja')).toBe(true);
    expect(url.startsWith(location.origin + location.pathname)).toBe(true);
    expect(root.querySelector('#hud-share-status')?.textContent).toBe('リンクをコピーしました');
  });

  it('share does not throw without a clipboard (or when it refuses) and says so', async () => {
    const { root } = setup();
    expect(() => root.querySelector<HTMLButtonElement>('#hud-share')!.click()).not.toThrow();
    await flush();
    expect(root.querySelector('#hud-share-status')?.textContent).toBe('リンクをコピーできませんでした');

    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    root.querySelector<HTMLElement>('#hud-share-status')!.textContent = '';
    root.querySelector<HTMLButtonElement>('#hud-share')!.click();
    await flush();
    expect(root.querySelector('#hud-share-status')?.textContent).toBe('リンクをコピーできませんでした');
  });

  it('the share confirmation disappears after a while', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
    const { root } = setup();
    root.querySelector<HTMLButtonElement>('#hud-share')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector('#hud-share-status')?.textContent).toBe('リンクをコピーしました');
    await vi.advanceTimersByTimeAsync(2100);
    expect(root.querySelector('#hud-share-status')?.textContent).toBe('');
  });

  it('flags reduced motion and stops listening after destroy', () => {
    const { root, store, hud } = setup();
    store.set({ reducedMotion: true });
    expect(root.querySelector('#hud')?.classList.contains('reduced-motion')).toBe(true);
    hud.destroy();
    expect(root.querySelector('#hud')).toBeNull();
    expect(() => store.set({ t: 0 })).not.toThrow();
  });
});
