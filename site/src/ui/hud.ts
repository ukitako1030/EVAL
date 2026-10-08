import type { Lang, World } from '../data/types';
import { monthIndex, monthLabel } from '../data/timeline';
import { tr, type StringKey } from '../i18n/strings';
import type { AppState, Store } from '../state/store';
import { encodeUrl } from '../state/url';
import { h, setAttr, setText } from './dom';

/** Empty containers the other HUD components mount into (`createRanking(slots.ranking, …)` etc.). */
export interface HudSlots {
  /** the right-hand panel that holds ranking + deployment */
  panel: HTMLElement;
  ranking: HTMLElement;
  deployment: HTMLElement;
  timeline: HTMLElement;
  banners: HTMLElement;
  detail: HTMLElement;
}

export interface Hud {
  el: HTMLElement;
  slots: HudSlots;
  update(state: AppState): void;
  destroy(): void;
}

const STATUS_SECONDS = 2;

/**
 * The HUD shell: title + month, preliminary tag, last update, language toggle, share, methods link, legend, the
 * "unofficial" line, and the slots for the other components. Subscribes to `store`; `update` re-renders on demand.
 */
export function mountHud(root: HTMLElement, store: Store<AppState>, world: World): Hud {
  const subtitle = h('div', { class: 'hud-sub' });
  const month = h('div', { id: 'hud-month', class: 'hud-digits' });
  const prelim = h('span', { id: 'hud-preliminary', class: 'hud-prelim', attrs: { hidden: true } });
  const title = h('header', { id: 'hud-title', class: 'hud-box hud-title' }, [
    h('div', { class: 'hud-title-left' }, [h('h1', { class: 'hud-logo', attrs: { 'data-text': 'AI WAR' } }, ['AI WAR']), subtitle]),
    h('div', { class: 'hud-date' }, [month, prelim]),
  ]);

  const updatedDate = world.generatedAt.slice(0, 10);
  const updatedKey = h('span', { class: 'hud-updated-k' });
  const updated = h('p', { id: 'hud-updated', class: 'hud-updated' }, [updatedKey, ' ', h('time', { attrs: { datetime: updatedDate } }, [updatedDate])]);

  const langBtn = (l: Lang, text: string, label: string) =>
    h('button', { class: 'hud-btn hud-lang-btn', attrs: { type: 'button', 'data-lang': l, lang: l, 'aria-label': label, 'aria-pressed': 'false' } }, [text]);
  const langJa = langBtn('ja', '日本語', '日本語');
  const langEn = langBtn('en', 'EN', 'English');
  const langGroup = h('div', { id: 'hud-lang', class: 'hud-lang', attrs: { role: 'group' } }, [langJa, langEn]);

  const shareBtn = h('button', { id: 'hud-share', class: 'hud-btn', attrs: { type: 'button' } });
  const shareStatus = h('span', { id: 'hud-share-status', class: 'hud-share-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const methods = h('a', { id: 'hud-methods', class: 'hud-btn hud-link' });
  const tools = h('nav', { id: 'hud-tools', class: 'hud-tools' }, [updated, langGroup, shareBtn, methods, shareStatus]);

  const legendItem = (icon: string) => {
    const text = h('span');
    return { text, el: h('li', { class: 'hud-lg' }, [h('i', { class: `hud-ic ${icon}`, attrs: { 'aria-hidden': 'true' } }), text]) };
  };
  const lgArea = legendItem('hud-ic-area');
  const lgGlow = legendItem('hud-ic-glow');
  const lgFog = legendItem('hud-ic-fog');
  const unofficial = h('p', { id: 'hud-unofficial', class: 'hud-unofficial' });
  const legend = h('div', { id: 'hud-legend', class: 'hud-box hud-legend' }, [h('ul', { class: 'hud-lg-list' }, [lgArea.el, lgGlow.el, lgFog.el]), unofficial]);

  const slots: HudSlots = {
    panel: h('aside', { id: 'hud-panel', class: 'hud-box hud-panel' }),
    ranking: h('div', { id: 'hud-ranking' }),
    deployment: h('div', { id: 'hud-deployment' }),
    timeline: h('footer', { id: 'hud-timeline', class: 'hud-box hud-timeline' }),
    banners: h('div', { id: 'hud-banners', class: 'hud-banners' }),
    detail: h('div', { id: 'hud-detail' }),
  };
  slots.panel.append(slots.ranking, slots.deployment);

  const el = h('div', { id: 'hud', class: 'hud-root' }, [title, tools, slots.panel, legend, slots.banners, slots.detail, slots.timeline]);
  root.appendChild(el);

  let lang: Lang | null = null;
  let status: StringKey | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  function showStatus(key: StringKey | null): void {
    status = key;
    setText(shareStatus, key ? tr(key, store.get().lang) : '');
    clearTimeout(statusTimer);
    if (key) statusTimer = setTimeout(() => showStatus(null), STATUS_SECONDS * 1000);
  }

  async function share(): Promise<void> {
    const url = location.origin + location.pathname + encodeUrl(store.get(), world);
    let ok = false;
    try {
      const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (clip && typeof clip.writeText === 'function') {
        await clip.writeText(url);
        ok = true;
      }
    } catch {
      ok = false; // permission denied, insecure context, …
    }
    showStatus(ok ? 'copied' : 'copyFailed');
  }

  function relabel(l: Lang): void {
    setText(subtitle, tr('subtitle', l));
    setText(prelim, tr('preliminary', l));
    setText(updatedKey, tr('lastUpdated', l));
    setAttr(langGroup, 'aria-label', tr('language', l));
    setText(shareBtn, tr('share', l));
    setText(methods, tr('methods', l));
    methods.setAttribute('href', `methods.html?lang=${l}`); // constant, not from world.json
    setText(lgArea.text, tr('legendArea', l));
    setText(lgGlow.text, tr('legendGlow', l));
    setText(lgFog.text, tr('legendFog', l));
    setText(unofficial, tr('unofficial', l));
    if (status) setText(shareStatus, tr(status, l));
    setAttr(langJa, 'aria-pressed', String(l === 'ja'));
    setAttr(langEn, 'aria-pressed', String(l === 'en'));
    root.ownerDocument.documentElement.lang = l;
  }

  function update(state: AppState): void {
    if (state.lang !== lang) {
      lang = state.lang;
      relabel(lang);
    }
    setText(month, monthLabel(world, state.t));
    prelim.hidden = world.months[monthIndex(world, state.t)] !== world.partialMonth;
    el.classList.toggle('reduced-motion', state.reducedMotion);
  }

  langJa.addEventListener('click', () => store.set({ lang: 'ja' }));
  langEn.addEventListener('click', () => store.set({ lang: 'en' }));
  shareBtn.addEventListener('click', () => void share());

  const unsubscribe = store.subscribe((s) => update(s));
  update(store.get());

  return {
    el,
    slots,
    update,
    destroy() {
      unsubscribe();
      clearTimeout(statusTimer);
      el.remove();
    },
  };
}
