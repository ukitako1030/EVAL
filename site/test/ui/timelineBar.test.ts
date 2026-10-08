// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import { createTimelineBar, xToT } from '../../src/ui/timelineBar';
import { createStore, defaultState, type AppState } from '../../src/state/store';
import { makeWorld } from '../fixtures/world';

function setup(patch: Partial<AppState> = {}) {
  const world = makeWorld();
  const store = createStore<AppState>({ ...defaultState(world.months.length - 1), t: 2, ...patch });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const bar = createTimelineBar(root, world, store);
  return { world, store, root, bar };
}

const key = (k: string, target: EventTarget = document.body) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};
const markers = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.tl-marker')];

let teardown: (() => void) | null = null;
afterEach(() => {
  teardown?.();
  teardown = null;
  document.body.replaceChildren();
});

describe('xToT', () => {
  it('maps x across the track to a fractional month index, clamped', () => {
    expect(xToT(0, 300, 4)).toBe(0);
    expect(xToT(150, 300, 4)).toBe(1.5);
    expect(xToT(300, 300, 4)).toBe(3);
    expect(xToT(-50, 300, 4)).toBe(0);
    expect(xToT(900, 300, 4)).toBe(3);
    expect(xToT(Number.POSITIVE_INFINITY, 300, 4)).toBe(3);
  });
  it('rounds to whole months when snapping', () => {
    expect(xToT(140, 300, 4, true)).toBe(1);
    expect(xToT(160, 300, 4, true)).toBe(2);
    expect(xToT(299, 300, 4, true)).toBe(3);
  });
  it('degenerate input gives month 0', () => {
    expect(xToT(10, 0, 4)).toBe(0);
    expect(xToT(Number.NaN, 300, 4)).toBe(0);
    expect(xToT(10, 300, 1)).toBe(0);
    expect(xToT(10, 300, 0)).toBe(0);
  });
});

describe('timeline bar', () => {
  it('draws one marker per month with battle news in the current view, coloured by the first event', () => {
    const { root, store, bar } = setup();
    teardown = bar.destroy;
    expect(markers(root).map((m) => m.dataset.month)).toEqual(['0', '2']); // galaxy: major events only
    expect(markers(root)[1].style.getPropertyValue('--c')).toBe('#ff8a4c'); // Claude's lead change → Anthropic
    expect(markers(root)[1].getAttribute('aria-label')).toBe('2025.03 generalJA — 首位交代');
    store.set({ front: 'general' });
    expect(markers(root).map((m) => m.dataset.month)).toEqual(['0', '2', '3']);
    store.set({ front: 'image' });
    expect(markers(root).map((m) => m.dataset.month)).toEqual(['2']);
    expect(markers(root)[0].style.getPropertyValue('--c')).toBe('#4c8dff');
  });

  it('a year label steps aside while the month badge under the thumb covers it (not in the compact layout)', () => {
    const { root, bar } = setup({ t: 2 });
    teardown = bar.destroy;
    const year = root.querySelector<HTMLElement>('.tl-years span');
    expect(year?.textContent).toBe('2025');
    expect(year?.classList.contains('covered')).toBe(true); // badge two months after 2025-01
    bar.setCompact(true); // the phone badge sits above the track
    expect(year?.classList.contains('covered')).toBe(false);
  });

  it('compact (mobile): news months close together share one marker that lists all their news', () => {
    const { root, store, bar } = setup({ front: 'general' });
    teardown = bar.destroy;
    expect(markers(root).map((m) => m.dataset.month)).toEqual(['0', '2', '3']);
    bar.setCompact(true);
    expect(markers(root).map((m) => m.dataset.month)).toEqual(['0', '3']); // months 0..2 → one marker at 0
    expect(markers(root)[0].dataset.n).toBe('2');
    expect(markers(root)[0].getAttribute('aria-label')).toBe('2025.01 generalJA — 開戦\n2025.03 generalJA — 首位交代');
    store.set({ t: 0 });
    expect(markers(root)[0].classList.contains('past')).toBe(true);
    expect(markers(root)[1].classList.contains('past')).toBe(false);
    bar.setCompact(false);
    expect(markers(root).map((m) => m.dataset.month)).toEqual(['0', '2', '3']);
  });

  it('marks markers up to the current month as past and labels the slider', () => {
    const { root, bar } = setup();
    teardown = bar.destroy;
    expect(markers(root).map((m) => m.classList.contains('past'))).toEqual([true, true]);
    const track = root.querySelector('[role="slider"]')!;
    expect(track.getAttribute('aria-valuenow')).toBe('2');
    expect(track.getAttribute('aria-valuetext')).toBe('2025.03');
    expect(track.getAttribute('aria-valuemax')).toBe('3');
    expect(root.querySelector('.tl-label')?.textContent).toBe('2025.03');
    expect(root.querySelectorAll('.tl-years span')).toHaveLength(1); // only 2025-01 starts a year
  });

  it('clicking a marker jumps to its month and pauses', () => {
    const { root, store, bar } = setup({ t: 3, playing: true });
    teardown = bar.destroy;
    markers(root)[0].click();
    expect(store.get()).toMatchObject({ t: 0, playing: false });
  });

  it('play / pause button with aria-labels; Space toggles playback', () => {
    const { root, store, bar } = setup();
    teardown = bar.destroy;
    const play = root.querySelector<HTMLButtonElement>('.tl-play')!;
    expect(play.getAttribute('aria-label')).toBe('再生');
    play.click();
    expect(store.get().playing).toBe(true);
    expect(play.getAttribute('aria-label')).toBe('一時停止');
    const e = key(' ');
    expect(e.defaultPrevented).toBe(true);
    expect(store.get().playing).toBe(false);
    key(' ');
    expect(store.get().playing).toBe(true);
  });

  it('Space at the last month plays the war again from the start', () => {
    const { store, bar } = setup({ t: 3 });
    teardown = bar.destroy;
    key(' ');
    expect(store.get()).toMatchObject({ t: 0, playing: true });
  });

  it('arrow keys step one whole month and pause', () => {
    const { store, bar } = setup({ playing: true });
    teardown = bar.destroy;
    key('ArrowRight');
    expect(store.get()).toMatchObject({ t: 3, playing: false });
    key('ArrowRight');
    expect(store.get().t).toBe(3);
    key('ArrowLeft');
    key('ArrowLeft');
    expect(store.get().t).toBe(1);
    store.set({ t: 1.5 });
    key('ArrowLeft');
    expect(store.get().t).toBe(1);
    store.set({ t: 1.5 });
    key('ArrowRight');
    expect(store.get().t).toBe(2);
    key('ArrowLeft');
    key('ArrowLeft');
    key('ArrowLeft');
    expect(store.get().t).toBe(0);
  });

  it('keys are ignored while typing in a field, and Space is left to a focused button', () => {
    const { root, store, bar } = setup();
    teardown = bar.destroy;
    const input = document.createElement('input');
    document.body.appendChild(input);
    key(' ', input);
    key('ArrowRight', input);
    expect(store.get()).toMatchObject({ t: 2, playing: false });
    const speed = root.querySelector<HTMLButtonElement>('.tl-speed')!;
    const e = key(' ', speed);
    expect(e.defaultPrevented).toBe(false);
    expect(store.get().playing).toBe(false);
  });

  it('speed toggles 1× → 2× → 4× → 1×', () => {
    const { root, store, bar } = setup();
    teardown = bar.destroy;
    const speed = root.querySelector<HTMLButtonElement>('.tl-speed')!;
    expect(speed.textContent).toBe('1×');
    speed.click();
    expect(store.get().speed).toBe(2);
    expect(speed.textContent).toBe('2×');
    speed.click();
    expect(store.get().speed).toBe(4);
    speed.click();
    expect(store.get().speed).toBe(1);
  });

  it('the skip button shows only during the intro and jumps to the present', () => {
    const { root, store, bar } = setup({ t: 0.5, playing: true, intro: true });
    teardown = bar.destroy;
    const skip = root.querySelector<HTMLButtonElement>('.tl-skip')!;
    expect(skip.hidden).toBe(false);
    skip.click();
    expect(store.get()).toMatchObject({ t: 3, playing: false, intro: false });
    expect(skip.hidden).toBe(true);
  });

  it('dragging sets t continuously, pauses, and rests on a whole month', () => {
    const { root, store, bar } = setup({ playing: true });
    teardown = bar.destroy;
    const track = root.querySelector<HTMLElement>('.tl-track')!;
    track.getBoundingClientRect = () => ({ left: 100, width: 300, top: 0, height: 16, right: 400, bottom: 16, x: 100, y: 0, toJSON: () => ({}) });
    track.dispatchEvent(new PointerEvent('pointerdown', { clientX: 250, button: 0, bubbles: true }));
    expect(store.get()).toMatchObject({ t: 1.5, playing: false });
    expect(bar.isDragging()).toBe(true);
    expect(bar.el.classList.contains('tl-dragging')).toBe(true); // the mobile month badge shows while scrubbing
    track.dispatchEvent(new PointerEvent('pointermove', { clientX: 330, bubbles: true }));
    expect(store.get().t).toBeCloseTo(2.3);
    track.dispatchEvent(new PointerEvent('pointerup', { clientX: 190, bubbles: true }));
    expect(store.get().t).toBe(1);
    expect(bar.isDragging()).toBe(false);
    expect(bar.el.classList.contains('tl-dragging')).toBe(false);
    expect(bar.el.style.getPropertyValue('--tl-f')).toBe('0.333'); // month 1 of 0..3
    track.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, bubbles: true }));
    expect(store.get().t).toBe(1); // not dragging any more
  });

  it('stops listening to the keyboard after destroy', () => {
    const { store, bar } = setup();
    bar.destroy();
    key(' ');
    expect(store.get().playing).toBe(false);
  });
});
