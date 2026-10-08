import type { Lang } from '../data/types';
import { tr } from '../i18n/strings';
import { h } from './dom';

/** A friendly full-screen message when the data (or the renderer) cannot start. */
export function showLoadError(root: HTMLElement, lang: Lang): HTMLElement {
  const el = h('div', { class: 'load-error', attrs: { role: 'alert' } }, [
    h('div', { class: 'load-error-box hud-box' }, [
      h('p', { class: 'load-error-logo', attrs: { 'aria-hidden': 'true' } }, ['AI WAR']),
      h('p', { class: 'load-error-text', attrs: { lang } }, [tr('loadError', lang)]),
    ]),
  ]);
  root.appendChild(el);
  return el;
}
