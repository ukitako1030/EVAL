import type { FrontId, Lang, World } from '../data/types';
import { frontFrame, monthIndex, type FrameSource, type SortBy, type UnitFrame } from '../data/timeline';
import { CONFIDENCE_KEY, tr } from '../i18n/strings';
import type { AppState, Store } from '../state/store';
import { clamp, fmt1, frontName, h, orgName, setAccent, setAttr, setStyle, setText, srOnly, uid } from './dom';

/** Row pitch in px; rows sit at `translateY((rank - 1) * ROW_H)`. */
export const ROW_H = 46;
/** The strength bar spans 40..100 (below 40 is a sliver), like the mockups. */
export const S_BAR_MIN = 40;

interface Row {
  org: string;
  li: HTMLLIElement;
  btn: HTMLButtonElement;
  rank: HTMLElement;
  chip: HTMLElement;
  delta: HTMLElement;
  deltaSr: HTMLElement;
  deltaVis: HTMLElement;
  sLabel: HTMLElement;
  sBar: HTMLElement;
  sVal: HTMLElement;
  cLabel: HTMLElement;
  cBar: HTMLElement;
  cVal: HTMLElement;
}

export interface Ranking {
  el: HTMLElement;
  update(state: AppState): void;
  /** row pitch in px (default `ROW_H`; the mobile layout uses shorter rows) */
  setRowHeight(px: number): void;
  destroy(): void;
}

/** "▲2" / "▼1" / "―" / "NEW" for a row, from `rankDelta` and whether the unit had data last month. */
export function deltaMark(u: Pick<UnitFrame, 'rankDelta'>, isNew: boolean, lang: Lang): { text: string; cls: 'up' | 'down' | 'eq' | 'new' } {
  if (isNew) return { text: tr('newEntry', lang), cls: 'new' };
  if (u.rankDelta > 0) return { text: `▲${u.rankDelta}`, cls: 'up' };
  if (u.rankDelta < 0) return { text: `▼${-u.rankDelta}`, cls: 'down' };
  return { text: '―', cls: 'eq' };
}

/**
 * Standings of `state.front ?? 'general'` at `state.t`: one absolutely positioned `<li>` per unit that slides to its
 * rank (CSS transition; none under reduced motion). Click → `selectedUnit`, hover / focus → `hoverOrg`.
 * `opts.frames` shares the app's per-frame `frontFrame`s (main.ts); without it the ranking computes its own.
 */
export function createRanking(root: HTMLElement, world: World, store: Store<AppState>, opts: { frames?: FrameSource } = {}): Ranking {
  const frameOf = (f: FrontId, t: number, sortBy: SortBy): readonly UnitFrame[] => (opts.frames ? (opts.frames(t, sortBy)[f] ?? []) : frontFrame(world, f, t, sortBy));
  const titleId = uid('rank-title');
  const titleEl = h('h2', { id: titleId, class: 'hud-h' });
  const frontEl = h('div', { class: 'rank-front' });
  const sortBtn = (by: SortBy) => h('button', { class: 'hud-btn rank-sort-btn', attrs: { type: 'button', 'data-sort': by, 'aria-pressed': 'false' } });
  const sortS = sortBtn('strength');
  const sortC = sortBtn('scale');
  const sortGroup = h('div', { class: 'rank-sort', attrs: { role: 'group' } }, [sortS, sortC]);
  const list = h('ol', { class: 'rank-list', attrs: { 'aria-labelledby': titleId } });
  const empty = h('p', { class: 'rank-empty', attrs: { hidden: true } });
  const el = h('section', { class: 'ranking', attrs: { 'aria-labelledby': titleId } }, [
    h('div', { class: 'rank-head' }, [titleEl, sortGroup]),
    frontEl,
    list,
    empty,
  ]);
  root.appendChild(el);

  const rows = new Map<string, Row>();
  let front: FrontId | null = null;
  let lang: Lang | null = null;
  let rowH = ROW_H;

  function makeRow(id: string, unit: { org: string; name: string }): Row {
    const color = world.orgs[unit.org]?.color;
    const rank = h('span', { class: 'rank-num', attrs: { 'aria-hidden': 'true' } });
    const chip = h('i', { class: 'rank-chip', attrs: { 'aria-hidden': 'true' } });
    const btn = h('button', { class: 'rank-name', attrs: { type: 'button', 'data-unit': id } }, [
      h('b', {}, [unit.name]),
      h('small', {}, [orgName(world, unit.org)]),
    ]);
    const deltaSr = srOnly('');
    const deltaVis = h('span', { attrs: { 'aria-hidden': 'true' } });
    const delta = h('span', { class: 'rank-delta eq' }, [deltaSr, deltaVis]);
    const bar = (cls: string) => {
      const label = h('em');
      const fill = h('i');
      const value = h('b', { class: 'rank-v' });
      return { label, fill, value, el: h('span', { class: `rank-bar ${cls}` }, [label, h('span', { class: 'rank-track', attrs: { 'aria-hidden': 'true' } }, [fill]), value]) };
    };
    const s = bar('rank-bar-s');
    const c = bar('rank-bar-c');
    const li = h('li', { class: 'rank-row', attrs: { 'data-unit': id, 'data-org': unit.org } }, [
      rank,
      chip,
      btn,
      delta,
      h('div', { class: 'rank-bars' }, [s.el, c.el]),
    ]);
    setAccent(li, color);
    btn.addEventListener('click', () => store.set({ selectedUnit: id }));
    const hoverOn = () => store.set({ hoverOrg: unit.org });
    const hoverOff = () => {
      if (store.get().hoverOrg === unit.org) store.set({ hoverOrg: null });
    };
    li.addEventListener('pointerenter', hoverOn);
    li.addEventListener('pointerleave', hoverOff);
    btn.addEventListener('focus', hoverOn);
    btn.addEventListener('blur', hoverOff);
    return { org: unit.org, li, btn, rank, chip, delta, deltaSr, deltaVis, sLabel: s.label, sBar: s.fill, sVal: s.value, cLabel: c.label, cBar: c.fill, cVal: c.value };
  }

  function build(f: FrontId): void {
    rows.clear();
    list.replaceChildren();
    for (const [id, unit] of Object.entries(world.units[f] ?? {})) {
      const row = makeRow(id, unit);
      row.li.hidden = true;
      rows.set(id, row);
      list.appendChild(row.li);
    }
    lang = null; // new rows need their labels
  }

  function relabel(l: Lang, f: FrontId): void {
    setText(titleEl, tr('standings', l));
    setText(frontEl, frontName(world, f, l));
    setAttr(sortGroup, 'aria-label', tr('sortBy', l));
    setText(sortS, tr('sortStrength', l));
    setText(sortC, tr('sortScale', l));
    setText(empty, tr('noUnits', l));
    for (const [id, r] of rows) {
      const unit = world.units[f][id];
      setAttr(r.btn, 'aria-label', `${unit.name} (${orgName(world, unit.org)}) — ${tr('openDetail', l)}`);
      setText(r.sLabel, tr('strength', l));
      setText(r.cLabel, tr('scale', l));
    }
  }

  function update(state: AppState): void {
    const f = state.front ?? 'general';
    if (f !== front) {
      front = f;
      build(f);
    }
    if (state.lang !== lang) {
      lang = state.lang;
      relabel(lang, f);
    }
    setAttr(sortS, 'aria-pressed', String(state.sortBy === 'strength'));
    setAttr(sortC, 'aria-pressed', String(state.sortBy === 'scale'));
    el.classList.toggle('reduced-motion', state.reducedMotion);

    const frame = frameOf(f, state.t, state.sortBy);
    const i0 = monthIndex(world, state.t);
    const series = world.series[f] ?? {};
    const shown = new Set<string>();
    for (const u of frame) {
      const r = rows.get(u.id);
      if (!r) continue;
      shown.add(u.id);
      r.li.hidden = false;
      setStyle(r.li, 'transform', `translateY(${(u.rank - 1) * rowH}px)`);
      setStyle(r.li, 'opacity', u.presence.toFixed(2));
      setAttr(r.li, 'data-rank', String(u.rank));
      setAttr(r.li, 'aria-posinset', String(u.rank));
      setAttr(r.li, 'aria-setsize', String(frame.length));
      r.li.classList.toggle('lead', u.rank === 1);
      r.li.classList.toggle('fog', u.fog > 0);
      r.li.classList.toggle('dim', state.hoverOrg !== null && state.hoverOrg !== u.org);
      setAttr(r.chip, 'title', tr(CONFIDENCE_KEY[u.q], state.lang));
      setText(r.rank, String(u.rank));
      const isNew = i0 > 0 && !series[u.id]?.[i0 - 1] && !!series[u.id]?.[i0];
      const d = deltaMark(u, isNew, state.lang);
      setText(r.deltaVis, d.text);
      setText(r.deltaSr, `${tr('vsLastMonth', state.lang)} ${isNew ? d.text : u.rankDelta > 0 ? `+${u.rankDelta}` : String(u.rankDelta)}`);
      setAttr(r.delta, 'class', `rank-delta ${d.cls}`);
      setStyle(r.sBar, 'transform', `scaleX(${clamp((u.s - S_BAR_MIN) / (100 - S_BAR_MIN), 0.02, 1).toFixed(3)})`);
      setStyle(r.cBar, 'transform', `scaleX(${clamp(u.c / 100, 0.02, 1).toFixed(3)})`);
      setText(r.sVal, fmt1(u.s));
      setText(r.cVal, `${fmt1(u.c)}%`);
    }
    for (const [id, r] of rows) if (!shown.has(id)) r.li.hidden = true;
    setStyle(list, 'height', `${frame.length * rowH}px`);
    empty.hidden = frame.length > 0;
  }

  sortS.addEventListener('click', () => store.set({ sortBy: 'strength' }));
  sortC.addEventListener('click', () => store.set({ sortBy: 'scale' }));

  const unsubscribe = store.subscribe((s) => update(s));
  update(store.get());

  return {
    el,
    update,
    setRowHeight(px) {
      if (!(px > 0) || px === rowH) return;
      rowH = px;
      update(store.get());
    },
    destroy() {
      unsubscribe();
      el.remove();
    },
  };
}
