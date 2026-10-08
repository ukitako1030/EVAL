import type { FrontId, Lang, World } from '../data/types';
import { frontFrame, type FrameSource, type SortBy, type UnitFrame } from '../data/timeline';
import { FRONT_SHORT, trA11y } from '../i18n/strings';
import type { AppState, Store } from '../state/store';
import { FALLBACK_COLOR, frontName, h, setAccent, setAttr, setText } from './dom';

export interface FrontTabs {
  el: HTMLElement;
  update(state: AppState): void;
  destroy(): void;
}

interface Tab {
  id: FrontId;
  btn: HTMLButtonElement;
  glyph: HTMLElement;
  color: string;
}

/**
 * Desktop front selector (the keyboard / screen-reader way into a front; the planets are canvas-only): a strip of one
 * chip per front at the top of the ranking panel, labelled like the deployment matrix columns (総 コ エ … / G C A …) with
 * the full front name as accessible name and tooltip, and a bar in the colour of the front's current leader. A click
 * enters that front, like clicking its planet; the current front is `aria-current`. One tab stop (roving tabindex):
 * ← → / Home / End move between the chips, Enter / Space opens one. Hidden in the mobile layout (its ◀ ▶ row does this).
 */
export function createFrontTabs(root: HTMLElement, world: World, store: Store<AppState>, opts: { frames?: FrameSource } = {}): FrontTabs {
  const frameOf = (f: FrontId, t: number, sortBy: SortBy): readonly UnitFrame[] => (opts.frames ? (opts.frames(t, sortBy)[f] ?? []) : frontFrame(world, f, t, sortBy));
  const tabs: Tab[] = world.fronts.map((f) => {
    const glyph = h('span', { class: 'front-tab-glyph', attrs: { 'aria-hidden': 'true' } });
    const btn = h('button', { class: 'front-tab', attrs: { type: 'button', 'data-front': f.id, tabindex: -1 } }, [glyph]);
    return { id: f.id, btn, glyph, color: '' };
  });
  const el = h('nav', { id: 'hud-fronts', class: 'front-tabs' }, tabs.map((t) => t.btn));
  root.prepend(el);

  let lang: Lang | null = null;
  /** the chip that holds the strip's single tab stop */
  let stop = 0;
  let front: FrontId | null = store.get().front;
  const doc = root.ownerDocument;

  /**
   * Leaving a front (Escape, "back to galaxy") removes what had focus (its ranking rows, the hidden back button): once
   * every component has updated, a keyboard reader lands on the chip of the front just left instead of on <body>.
   */
  function landOn(id: FrontId): void {
    queueMicrotask(() => {
      const a = doc.activeElement;
      if (a && a !== doc.body) return;
      const i = tabs.findIndex((t) => t.id === id);
      if (i < 0 || !el.isConnected || getComputedStyle(el).display === 'none') return; // hidden (mobile layout)
      setStop(i);
      tabs[i].btn.focus({ preventScroll: true });
    });
  }

  function setStop(i: number): void {
    stop = i;
    tabs.forEach((t, k) => setAttr(t.btn, 'tabindex', k === i ? '0' : '-1'));
  }

  function update(state: AppState): void {
    if (state.lang !== lang) {
      lang = state.lang;
      setAttr(el, 'aria-label', trA11y('fronts', lang));
      for (const t of tabs) {
        const name = frontName(world, t.id, lang);
        setText(t.glyph, FRONT_SHORT[t.id]?.[lang] ?? t.id.slice(0, 1).toUpperCase());
        setAttr(t.btn, 'aria-label', name);
        setAttr(t.btn, 'title', name);
      }
    }
    if (state.front !== front) {
      if (front !== null && state.front === null) landOn(front);
      front = state.front;
    }
    const current = tabs.findIndex((t) => t.id === state.front);
    tabs.forEach((t, k) => {
      if (k === current) setAttr(t.btn, 'aria-current', 'true');
      else t.btn.removeAttribute('aria-current');
      // the bar shows who leads that front now (dim when nobody holds it yet)
      const lead = frameOf(t.id, state.t, state.sortBy).find((u) => u.rank === 1);
      const color = lead?.color ?? FALLBACK_COLOR;
      if (color !== t.color) {
        t.color = color;
        setAccent(t.btn, color);
      }
      t.btn.classList.toggle('empty', !lead);
    });
    // the tab stop follows the current front unless the reader is moving through the strip
    if (current >= 0 && current !== stop && !el.contains(el.ownerDocument.activeElement)) setStop(current);
  }

  function move(to: number): void {
    const i = (to + tabs.length) % tabs.length;
    setStop(i);
    tabs[i].btn.focus();
  }

  el.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('.front-tab');
    const tab = btn ? tabs.find((t) => t.btn === btn) : undefined;
    if (!tab) return;
    setStop(tabs.indexOf(tab));
    if (store.get().front !== tab.id) store.set({ front: tab.id, selectedUnit: null });
  });
  // ← → / Home / End inside the strip (consumed, so the timeline's ← → month step does not also fire)
  el.addEventListener('keydown', (e) => {
    const i = tabs.findIndex((t) => t.btn === e.target);
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = i + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = i - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = tabs.length - 1;
    else return;
    e.preventDefault();
    move(to);
  });

  setStop(0);
  const unsubscribe = store.subscribe((s) => update(s));
  update(store.get());

  return {
    el,
    update,
    destroy() {
      unsubscribe();
      el.remove();
    },
  };
}
