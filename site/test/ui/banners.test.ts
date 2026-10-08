// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { BANNER_EXIT_MS, createBanners } from '../../src/ui/banners';
import { createBannerQueue, selectEvents, type Banner } from '../../src/events/queue';
import { createStore, defaultState, type AppState } from '../../src/state/store';
import { makeWorld } from '../fixtures/world';

function setup(patch: Partial<AppState> = {}) {
  const world = makeWorld();
  const store = createStore<AppState>({ ...defaultState(world.months.length - 1), ...patch });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const banners = createBanners(root, world, store);
  return { world, store, root, banners };
}

const live = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.banner:not(.banner-out)')];

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('battle-news banners', () => {
  it('renders the queued banners with month, front, org and text in the org colour', () => {
    const { world, root, banners } = setup();
    const q = createBannerQueue({ maxVisible: 2, seconds: 4, maxPending: 6, stagger: 0.35 });
    q.push(selectEvents(world, 2, 'general'));
    banners.render(q.update(0));
    const [b] = live(root);
    expect(b.querySelector('.banner-bolt')?.textContent).toBe('⚡');
    expect(b.querySelector('.banner-month')?.textContent).toBe('2025.03');
    expect(b.querySelector('.banner-front')?.textContent).toBe('generalJA');
    expect(b.querySelector('.banner-org')?.textContent).toBe('Anthropic');
    expect(b.querySelector('.banner-text')?.textContent).toBe('首位交代');
    expect(b.style.getPropertyValue('--c')).toBe('#ff8a4c');
    expect(root.querySelector('.banners')?.getAttribute('aria-live')).toBe('polite');
  });

  it('a frame with the same banners touches nothing; a changed set swaps exactly the changed ones', () => {
    const { world, root, banners } = setup();
    const q = createBannerQueue({ maxVisible: 2, seconds: 4, maxPending: 6, stagger: 0 });
    q.push(selectEvents(world, 2, null));
    banners.render(q.update(0));
    const before = live(root);
    expect(before).toHaveLength(1);
    const spy = vi.spyOn(root.querySelector('.banners')!, 'appendChild');
    for (let f = 1; f < 30; f++) banners.render(q.update(f / 60)); // the same banner every frame
    expect(spy).not.toHaveBeenCalled();
    expect(live(root)[0]).toBe(before[0]);
    q.push(selectEvents(world, 0, null));
    banners.render(q.update(0.6)); // a second banner arrives, the first stays
    expect(spy).toHaveBeenCalledTimes(1);
    expect(live(root)[0]).toBe(before[0]);
    expect(live(root)).toHaveLength(2);
  });

  it('switches the banner text with the language', () => {
    const { world, root, store, banners } = setup();
    const q = createBannerQueue({ maxVisible: 2, seconds: 4, maxPending: 6, stagger: 0 });
    q.push(selectEvents(world, 2, null));
    banners.render(q.update(0));
    store.set({ lang: 'en' });
    expect(live(root)[0].querySelector('.banner-text')?.textContent).toBe('Lead change');
    expect(live(root)[0].querySelector('.banner-front')?.textContent).toBe('generalEN');
    store.set({ lang: 'ja' });
    expect(live(root)[0].querySelector('.banner-text')?.textContent).toBe('首位交代');
  });

  it('adds new keys, keeps existing ones and retires missing ones after their exit animation', () => {
    vi.useFakeTimers();
    const { world, root, banners } = setup();
    const ev = world.events;
    const mk = (key: string, i: number): Banner => ({ key, event: ev[i], start: 0, end: 4 });
    banners.render([mk('a', 0), mk('b', 1)]);
    const first = live(root)[0];
    banners.render([mk('b', 1), mk('c', 3)]);
    expect(live(root).map((b) => b.dataset.key)).toEqual(['b', 'c']);
    expect(first.classList.contains('banner-out')).toBe(true);
    expect(first.isConnected).toBe(true);
    vi.advanceTimersByTime(BANNER_EXIT_MS);
    expect(first.isConnected).toBe(false);
  });

  it('under reduced motion banners leave at once and do not animate', () => {
    const { world, root, banners } = setup({ reducedMotion: true });
    banners.render([{ key: 'a', event: world.events[0], start: 0, end: 4 }]);
    expect(root.querySelector('.banners')?.classList.contains('reduced-motion')).toBe(true);
    banners.render([]);
    expect(root.querySelectorAll('.banner')).toHaveLength(0);
  });

  it('event text is shown as text, never parsed as markup', () => {
    const { world, root, banners } = setup();
    const event = { ...world.events[0], text: { ja: '<img src=x onerror="alert(1)">', en: 'x' } };
    banners.render([{ key: 'x', event, start: 0, end: 4 }]);
    expect(root.querySelector('.banner img')).toBeNull();
    expect(root.querySelector('.banner-text')?.textContent).toBe('<img src=x onerror="alert(1)">');
  });
});
