import type { Confidence, FrontId, Lang, World } from '../data/types';
import { monthIndex } from '../data/timeline';
import { CONFIDENCE_KEY, tr } from '../i18n/strings';
import type { AppState, Store } from '../state/store';
import { dotMonth, fmt1, frontName, h, orgName, setAccent, setAttr, uid } from './dom';
import { scaleBlock, strengthBlock } from './detailBlocks';
import { sparkline } from './sparkline';

export interface Detail {
  el: HTMLElement;
  update(state: AppState): void;
  destroy(): void;
}

function stat(label: string, value: string, q: Confidence | null, lang: Lang, cls: string): HTMLElement {
  return h('div', { class: `detail-stat ${cls}` }, [
    h('dt', {}, [label]),
    h('dd', {}, [
      h('b', { class: 'detail-v' }, [value]),
      q ? h('span', { class: `detail-q q-${q}` }, [`${tr('confidence', lang)}: ${tr(CONFIDENCE_KEY[q], lang)}`]) : null,
    ]),
  ]);
}

function build(world: World, front: FrontId, id: string, i: number, lang: Lang, titleId: string): (Node | null)[] {
  const unit = world.units[front][id];
  const cells = world.series[front]?.[id] ?? [];
  const cell = cells[i] ?? null;
  const month = world.months[i];
  const title = h('h2', { id: titleId, class: 'detail-name', attrs: { tabindex: -1 } }, [unit.name]);
  return [
    h('header', { class: 'detail-head' }, [
      h('i', { class: 'detail-chip', attrs: { 'aria-hidden': 'true' } }),
      h('div', {}, [title, h('p', { class: 'detail-org' }, [`${orgName(world, unit.org)} · ${frontName(world, front, lang)}`])]),
    ]),
    h('p', { class: 'detail-month' }, [dotMonth(month), month === world.partialMonth ? h('span', { class: 'hud-prelim' }, [tr('preliminary', lang)]) : null]),
    h('dl', { class: 'detail-stats' }, [
      stat(tr('strength', lang), cell ? fmt1(cell.s) : '—', cell ? (cell.qs ?? cell.q) : null, lang, 'detail-s'),
      stat(tr('scale', lang), cell ? `${fmt1(cell.c)}%` : '—', cell ? (cell.qc ?? cell.q) : null, lang, 'detail-c'),
    ]),
    cell ? null : h('p', { class: 'detail-note' }, [tr('notPresent', lang)]),
    h('section', { class: 'detail-history' }, [
      h('h3', { class: 'hud-h' }, [tr('history', lang)]),
      sparkline(cells, i, { strength: tr('strength', lang), scale: tr('scale', lang) }),
      h('p', { class: 'spark-keys', attrs: { 'aria-hidden': 'true' } }, [
        h('span', { class: 'spark-key-s' }, [tr('strength', lang)]),
        h('span', { class: 'spark-key-c' }, [tr('scale', lang)]),
      ]),
    ]),
    h('section', { class: 'detail-breakdown' }, [
      h('h3', { class: 'hud-h' }, [tr('breakdown', lang)]),
      strengthBlock(world, front, id, month, cell, lang),
      scaleBlock(world, front, id, month, lang),
    ]),
  ];
}

/**
 * Unit detail panel (a bottom sheet on narrow screens): shown while `state.selectedUnit` is a unit of
 * `state.front ?? 'general'`; values, confidence, history and the source breakdown of the current whole month.
 */
export function createDetail(root: HTMLElement, world: World, store: Store<AppState>): Detail {
  const titleId = uid('detail-title');
  const close = h('button', { class: 'detail-close', attrs: { type: 'button' } }, [h('span', { attrs: { 'aria-hidden': 'true' } }, ['✕'])]);
  const body = h('div', { class: 'detail-body' });
  const el = h('aside', { class: 'detail hud-box', attrs: { 'aria-labelledby': titleId, hidden: true } }, [close, body]);
  root.appendChild(el);

  let key = '';
  let shown = '';

  function update(state: AppState): void {
    el.classList.toggle('reduced-motion', state.reducedMotion);
    setAttr(close, 'aria-label', tr('close', state.lang));
    const front = state.front ?? 'general';
    const id = state.selectedUnit;
    const unit = id && world.units[front] && Object.hasOwn(world.units[front], id) ? world.units[front][id] : undefined;
    if (!id || !unit) {
      el.hidden = true;
      key = '';
      shown = '';
      return;
    }
    const i = monthIndex(world, state.t);
    const k = `${front}|${id}|${i}|${state.lang}`;
    if (k !== key) {
      key = k;
      setAccent(el, world.orgs[unit.org]?.color);
      body.replaceChildren(...build(world, front, id, i, state.lang, titleId).filter((n): n is Node => n !== null));
    }
    el.hidden = false;
    if (shown !== `${front}|${id}`) {
      shown = `${front}|${id}`;
      body.querySelector<HTMLElement>('.detail-name')?.focus({ preventScroll: true }); // announce the newly opened unit
    }
  }

  close.addEventListener('click', () => store.set({ selectedUnit: null }));
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); // close the panel first; Escape again (outside it) can leave the front
    store.set({ selectedUnit: null });
  });

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
