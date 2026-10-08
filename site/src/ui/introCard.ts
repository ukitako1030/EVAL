import type { Lang, World } from '../data/types';
import { tr } from '../i18n/strings';
import type { AppState, Store } from '../state/store';
import { dotMonth, h, setText } from './dom';

/** How long the first-visit title card stays up before playback starts (s). */
export const INTRO_CARD_SECONDS = 2.5;
/** Its fade-out (ms; matches `intro-out` in intro.css). */
export const INTRO_FADE_MS = 700;

export interface IntroCard {
  el: HTMLElement;
  /** true once the card has started leaving (timed out or closed) */
  readonly closed: boolean;
  /** advance the card's clock by `dt` seconds; returns true on the call where its time runs out (and it starts to fade) */
  advance(dt: number): boolean;
  /** fade out now (skip, or the intro was cancelled); idempotent */
  close(): void;
  destroy(): void;
}

/**
 * The first-visit "war begins" title card over the galaxy: the first month in big digits and "ChatGPT 公開、開戦".
 * Opacity fades only (no brightness flash; nothing at all under reduced motion). Not interactive: the timeline's
 * skip button stays reachable underneath.
 */
export function createIntroCard(root: HTMLElement, world: World, store: Store<AppState>): IntroCard {
  const title = h('h2', { class: 'intro-title' });
  const el = h('div', { class: 'intro-card', attrs: { role: 'status' } }, [
    h('div', { class: 'intro-inner' }, [
      h('p', { class: 'intro-kicker', attrs: { 'aria-hidden': 'true' } }, ['AI WAR']),
      h('p', { class: 'intro-date' }, [dotMonth(world.months[0] ?? '')]),
      h('i', { class: 'intro-rule', attrs: { 'aria-hidden': 'true' } }),
      title,
    ]),
  ]);
  root.appendChild(el);

  let elapsed = 0;
  let closed = false;
  let lang: Lang | null = null;
  let removeTimer: ReturnType<typeof setTimeout> | undefined;

  function update(state: AppState): void {
    if (state.lang !== lang) {
      lang = state.lang;
      setText(title, tr('introTitle', lang));
    }
    el.classList.toggle('reduced-motion', state.reducedMotion);
  }

  function close(): void {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (store.get().reducedMotion) {
      el.remove();
      return;
    }
    el.classList.add('intro-out');
    removeTimer = setTimeout(() => el.remove(), INTRO_FADE_MS);
  }

  const unsubscribe = store.subscribe((s) => update(s));
  update(store.get());

  return {
    el,
    get closed() {
      return closed;
    },
    advance(dt) {
      if (closed || !(dt > 0) || !Number.isFinite(dt)) return false;
      elapsed += dt;
      if (elapsed < INTRO_CARD_SECONDS) return false;
      close();
      return true;
    },
    close,
    destroy() {
      if (!closed) unsubscribe();
      closed = true;
      clearTimeout(removeTimer);
      el.remove();
    },
  };
}
