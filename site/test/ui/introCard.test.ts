// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createIntroCard, INTRO_CARD_SECONDS, INTRO_FADE_MS } from '../../src/ui/introCard';
import { showLoadError } from '../../src/ui/loadError';
import { createStore, defaultState, type AppState } from '../../src/state/store';
import { makeWorld } from '../fixtures/world';

function setup(patch: Partial<AppState> = {}) {
  const world = makeWorld();
  const store = createStore<AppState>({ ...defaultState(world.months.length - 1), intro: true, t: 0, playing: true, ...patch });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const card = createIntroCard(root, world, store);
  return { store, root, card };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('intro title card', () => {
  it('shows the first month and the war-begins line in the current language', () => {
    const { store, card } = setup();
    expect(card.el.querySelector('.intro-date')?.textContent).toBe('2025.01');
    expect(card.el.querySelector('.intro-title')?.textContent).toBe('ChatGPT 公開、開戦');
    store.set({ lang: 'en' });
    expect(card.el.querySelector('.intro-title')?.textContent).toBe('ChatGPT launches — the war begins');
    expect(card.el.getAttribute('role')).toBe('status');
  });

  it('runs for INTRO_CARD_SECONDS, reports the end once, then fades out and is removed', () => {
    vi.useFakeTimers();
    const { root, card } = setup();
    expect(INTRO_CARD_SECONDS).toBe(2.5);
    let ends = 0;
    for (let k = 0; k < 24; k++) if (card.advance(0.1)) ends++;
    expect(ends).toBe(0);
    expect(card.closed).toBe(false);
    for (let k = 0; k < 5; k++) if (card.advance(0.1)) ends++;
    expect(ends).toBe(1);
    expect(card.closed).toBe(true);
    expect(card.el.classList.contains('intro-out')).toBe(true);
    expect(root.contains(card.el)).toBe(true); // still fading
    vi.advanceTimersByTime(INTRO_FADE_MS);
    expect(root.contains(card.el)).toBe(false);
    expect(card.advance(1)).toBe(false);
  });

  it('ignores bad dt and closes at once (no fade) under reduced motion', () => {
    const { root, card } = setup({ reducedMotion: true });
    for (const dt of [NaN, -1, 0, Infinity]) expect(card.advance(dt)).toBe(false);
    expect(card.el.classList.contains('reduced-motion')).toBe(true);
    card.close();
    expect(card.closed).toBe(true);
    expect(root.contains(card.el)).toBe(false);
    card.close(); // idempotent
  });
});

describe('load error', () => {
  it('shows the friendly message as an alert', () => {
    const el = showLoadError(document.body, 'en');
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.textContent).toContain('Could not load the data');
    el.remove();
    expect(showLoadError(document.body, 'ja').textContent).toContain('データを読み込めませんでした');
  });
  it('can say that WebGL is required instead', () => {
    expect(showLoadError(document.body, 'ja', 'webglRequired').textContent).toContain('WebGL が必要です');
    expect(showLoadError(document.body, 'en', 'webglRequired').textContent).toContain('WebGL is required');
  });
});
