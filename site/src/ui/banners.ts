import type { Lang, World, WorldEvent } from '../data/types';
import type { Banner } from '../events/queue';
import { tr } from '../i18n/strings';
import type { AppState, Store } from '../state/store';
import { dotMonth, frontName, h, orgName, setAccent, setAttr, setText, unitColor } from './dom';

/** How long a retired banner plays its exit animation before it is removed (ms; matches `banner-out` in banners.css). */
export const BANNER_EXIT_MS = 450;

interface Live {
  el: HTMLElement;
  event: WorldEvent;
  front: HTMLElement;
  text: HTMLElement;
}

export interface Banners {
  el: HTMLElement;
  /** Show exactly these banners (from the banner queue in main.ts): new keys enter, missing keys leave. */
  render(banners: readonly Banner[]): void;
  update(state: AppState): void;
  destroy(): void;
}

/**
 * Battle-news banners: ⚡, YYYY.MM, front name, org tag and `event.text[lang]`, accented with the unit's org colour.
 * The enter animation is a slide + short clip-path glitch with no brightness flash (none at all under reduced motion).
 */
export function createBanners(root: HTMLElement, world: World, store: Store<AppState>): Banners {
  const el = h('div', { class: 'banners', attrs: { role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' } });
  root.appendChild(el);

  const live = new Map<string, Live>();
  let lang: Lang = store.get().lang;
  let reduced = store.get().reducedMotion;

  function label(v: Live): void {
    setText(v.front, frontName(world, v.event.front, lang));
    setText(v.text, v.event.text[lang]);
  }

  function make(b: Banner): Live {
    const e = b.event;
    const front = h('span', { class: 'banner-front' });
    const text = h('p', { class: 'banner-text' });
    const org = world.units[e.front]?.[e.unit]?.org;
    const bar = h('i', { class: 'banner-bar', attrs: { 'aria-hidden': 'true' } });
    bar.style.animationDuration = `${Math.max(0, b.end - b.start).toFixed(2)}s`;
    const node = h('div', { class: 'banner', attrs: { 'data-key': b.key } }, [
      h('div', { class: 'banner-head' }, [
        h('span', { class: 'banner-bolt', attrs: { 'aria-hidden': 'true' } }, ['⚡']),
        h('span', { class: 'banner-month' }, [dotMonth(e.month)]),
        front,
        org ? h('span', { class: 'banner-org' }, [orgName(world, org)]) : null,
      ]),
      text,
      bar,
    ]);
    setAccent(node, unitColor(world, e.front, e.unit));
    const v = { el: node, event: e, front, text };
    label(v);
    return v;
  }

  function retire(node: HTMLElement): void {
    if (reduced) {
      node.remove();
      return;
    }
    node.classList.add('banner-out');
    setAttr(node, 'aria-hidden', 'true');
    setTimeout(() => node.remove(), BANNER_EXIT_MS);
  }

  function render(banners: readonly Banner[]): void {
    // called every frame, and almost always with the banners already shown: check that without allocating
    let same = banners.length === live.size;
    for (let i = 0; same && i < banners.length; i++) same = live.has(banners[i].key);
    if (same) return;
    for (const [k, v] of live) {
      let keep = false;
      for (let i = 0; i < banners.length && !keep; i++) keep = banners[i].key === k;
      if (keep) continue;
      live.delete(k);
      retire(v.el);
    }
    for (const b of banners) {
      if (live.has(b.key)) continue;
      const v = make(b);
      live.set(b.key, v);
      el.appendChild(v.el);
    }
  }

  function update(state: AppState): void {
    reduced = state.reducedMotion;
    el.classList.toggle('reduced-motion', reduced);
    setAttr(el, 'aria-label', tr('breaking', state.lang));
    if (state.lang !== lang) {
      lang = state.lang;
      for (const v of live.values()) label(v);
    }
  }

  const unsubscribe = store.subscribe((s) => update(s));
  update(store.get());

  return {
    el,
    render,
    update,
    destroy() {
      unsubscribe();
      el.remove();
    },
  };
}
