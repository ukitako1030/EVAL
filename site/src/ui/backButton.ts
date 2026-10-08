import type { Lang } from '../data/types';
import { tr } from '../i18n/strings';
import type { AppState, Store } from '../state/store';
import { h, setAttr, setText } from './dom';

export interface BackButton {
  el: HTMLButtonElement;
  update(state: AppState): void;
  destroy(): void;
}

/**
 * "◀ 銀河に戻る / Back to galaxy": a HUD button under the title, shown only while a front is focused. Leaving the front
 * also closes the unit detail (the same unit id can belong to a different front's standings).
 */
export function createBackButton(root: HTMLElement, store: Store<AppState>): BackButton {
  const label = h('span', { class: 'hud-back-label' });
  const el = h('button', { id: 'hud-back', class: 'hud-btn hud-back', attrs: { type: 'button', hidden: true } }, [
    h('span', { class: 'hud-back-arrow', attrs: { 'aria-hidden': 'true' } }, ['◀']),
    label,
  ]);
  root.appendChild(el);
  el.addEventListener('click', () => store.set({ front: null, selectedUnit: null }));

  let lang: Lang | null = null;
  function update(state: AppState): void {
    if (state.lang !== lang) {
      lang = state.lang;
      setText(label, tr('backToGalaxy', lang));
      setAttr(el, 'aria-keyshortcuts', 'Escape');
    }
    el.hidden = !state.front;
  }

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
