/**
 * Mobile layout controller (spec §8). Below 768 px wide or in portrait orientation the HUD root gets `.m` (`.m-land`
 * for a phone held sideways) and turns into: a top bar (AI WAR, month, 🌐, share), a front row "◀ 動画戦線 ▶" with a
 * small "全体マップ" button, one large planet with its swarm battle (main.ts pins the battle), the ranking's top 5
 * under it ("すべて表示" shows the rest), the timeline at the bottom and the unit detail as a half-height bottom sheet
 * that leaves the planet visible. Left / right swipes on the stage and ◀ ▶ step `state.front` through `world.fronts`
 * (wrapping); the galaxy map is `state.front === null`. Esc and the browser's back button close the sheet, the
 * expanded ranking and the map, in that order. Reacts live to resize / rotation (`refresh`).
 */
import type { FrontId, Lang, World } from '../data/types';
import { monthIndex } from '../data/timeline';
import { tr } from '../i18n/strings';
import type { AppState, Store } from '../state/store';
import { frontName, h, setAttr, setText } from './dom';
import type { HudSlots } from './hud';
import { ROW_H } from './ranking';
import { TOP_N, layoutMode, mobileRowHeight, stepFront, steadyInsets, type Insets } from './mobileLayout';
import { dragSheet, trackSwipes } from './mobileGestures';

/** Browser history for open overlays, so the back button / gesture closes them instead of leaving the page. */
export interface OverlayHistory {
  /** add an entry for an overlay that just opened */
  push(): void;
  /** step back over that entry if it is still the current one; false when it is not (nothing happened) */
  back(): boolean;
  /** back / forward navigation (`popstate`); returns an unsubscribe function */
  onPop(cb: () => void): () => void;
}

export interface MobileOptions {
  hud: { el: HTMLElement; slots: Pick<HudSlots, 'panel' | 'timeline'> };
  ranking: { setRowHeight(px: number): void };
  detail: { el: HTMLElement };
  /** the stage canvas: horizontal swipes on it step the front */
  stage: HTMLElement;
  /** window size in CSS px (default `innerWidth` × `innerHeight`) */
  size?: () => { w: number; h: number };
  /** the renderer must ignore taps while true (a swipe that ends on a swarm must not also select it) */
  suppressTaps?: (on: boolean) => void;
  history?: OverlayHistory | null;
  /** ms clock for gestures (default `performance.now`) */
  now?: () => number;
}

export interface Mobile {
  /** the mobile layout is in use */
  readonly active: boolean;
  /** …on a phone held sideways (ranking and sheet move to the right) */
  readonly landscape: boolean;
  /** the ranking shows every unit, not just the top 5 */
  readonly expanded: boolean;
  /** renderer insets that keep the planet clear of the mobile HUD (and of an open sheet); null on desktop */
  insets(): Insets | null;
  /** the layout mode changed or a mobile HUD part changed size: re-apply the insets */
  onLayout(cb: () => void): () => void;
  /** re-check the window size (resize / rotation) */
  refresh(): void;
  /** ◀ (−1) / ▶ (+1) */
  step(dir: 1 | -1): void;
  setExpanded(on: boolean): void;
  openMap(): void;
  closeMap(): void;
  destroy(): void;
}

/** px between the mobile HUD and the framed planet */
const GAP = 6;
/**
 * The portrait galaxy's outer planet rows and their titles reach past the box the camera fits (render/layout
 * `galaxyLayout`), so the galaxy map keeps this share of the free height clear above and below it.
 */
const MAP_MARGIN = 0.11;

export function createMobile(world: World, store: Store<AppState>, o: MobileOptions): Mobile {
  const root = o.hud.el;
  const panel = o.hud.slots.panel;
  const timeline = o.hud.slots.timeline;
  const sheet = o.detail.el;
  const size = o.size ?? (() => ({ w: window.innerWidth, h: window.innerHeight }));
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;

  // ---- front row: ◀ name ▶ + galaxy map button ----
  const arrow = (cls: string, glyph: string) =>
    h('button', { class: `hud-btn m-step ${cls}`, attrs: { type: 'button' } }, [h('span', { attrs: { 'aria-hidden': 'true' } }, [glyph])]);
  const prev = arrow('m-prev', '◀');
  const next = arrow('m-next', '▶');
  const name = h('p', { class: 'm-front-name', attrs: { 'aria-live': 'polite' } });
  const hint = h('p', { class: 'm-front-hint', attrs: { hidden: true } });
  const dots = h('div', { class: 'm-dots', attrs: { 'aria-hidden': 'true' } }, world.fronts.map((f) => h('i', { attrs: { 'data-front': f.id } })));
  const mapLabel = h('span');
  const mapBtn = h('button', { id: 'm-map', class: 'hud-btn m-map-btn', attrs: { type: 'button', 'aria-pressed': 'false' } }, [
    h('i', { class: 'm-map-ic', attrs: { 'aria-hidden': 'true' } }),
    mapLabel,
  ]);
  const row = h('nav', { id: 'm-front', class: 'm-front', attrs: { hidden: true } }, [prev, h('div', { class: 'm-front-mid' }, [name, hint, dots]), next, mapBtn]);
  root.appendChild(row);

  // ---- ranking: top 5 ↔ all ----
  const showAll = h('button', { id: 'm-showall', class: 'hud-btn m-showall', attrs: { type: 'button', 'aria-expanded': 'false', hidden: true } });
  panel.appendChild(showAll);

  // ---- bottom sheet handle (drag down / tap to close) ----
  const handle = h('button', { class: 'sheet-handle', attrs: { type: 'button', hidden: true } }, [h('i', { attrs: { 'aria-hidden': 'true' } })]);
  sheet.prepend(handle);

  let active = false;
  let land = false;
  let rowH = 0;
  let expanded = false;
  let lastFront: FrontId = store.get().front ?? (world.fronts.some((f) => f.id === 'general') ? 'general' : (world.fronts[0]?.id ?? 'general'));
  let collapsedTop = 0;
  let key = '';
  const layoutCbs = new Set<() => void>();
  const emit = () => {
    for (const cb of layoutCbs) cb();
  };

  const mapOpen = () => active && store.get().front === null;
  const shown = (s: AppState): FrontId => s.front ?? lastFront;

  /** units of `front` on the map at `t` (the whole month and the one it blends into) */
  function unitCount(front: FrontId, t: number): number {
    const i0 = monthIndex(world, t);
    const i1 = Math.min(i0 + 1, world.months.length - 1);
    let n = 0;
    for (const cells of Object.values(world.series[front] ?? {})) if (cells[i0] || cells[i1]) n++;
    return n;
  }

  function render(s: AppState): void {
    if (s.front) lastFront = s.front;
    const map = mapOpen();
    const f = shown(s);
    const many = unitCount(f, s.t) > TOP_N;
    const k = `${active}|${map}|${f}|${s.lang}|${many}|${expanded}`;
    if (k === key) return;
    key = k;
    const l: Lang = s.lang;
    root.classList.toggle('m-map', map);
    root.classList.toggle('m-expanded', active && expanded);
    setText(name, map ? tr('galaxyMap', l) : frontName(world, f, l));
    setText(hint, tr('tapPlanet', l));
    hint.hidden = !map;
    prev.hidden = map;
    next.hidden = map;
    dots.hidden = map;
    for (const d of dots.children) d.classList.toggle('on', (d as HTMLElement).dataset.front === f);
    const p = stepFront(world.fronts, f, -1);
    const n = stepFront(world.fronts, f, 1);
    setAttr(prev, 'aria-label', `${tr('prevFront', l)}: ${p ? frontName(world, p, l) : ''}`);
    setAttr(next, 'aria-label', `${tr('nextFront', l)}: ${n ? frontName(world, n, l) : ''}`);
    setText(mapLabel, tr(map ? 'backToFront' : 'galaxyMap', l));
    setAttr(mapBtn, 'aria-pressed', String(map));
    showAll.hidden = !active || map || (!many && !expanded);
    setText(showAll, expanded ? `${tr('showTop', l)} ▴` : `${tr('showAll', l)} ▾`);
    setAttr(showAll, 'aria-expanded', String(expanded));
  }

  // ---- history: back closes the top overlay ----
  let pushed = false;
  let ignorePops = 0;
  const overlayOpen = () => {
    const s = store.get();
    return active && (s.selectedUnit !== null || expanded || s.front === null);
  };
  function syncHistory(): void {
    if (!o.history) return;
    const open = overlayOpen();
    if (open && !pushed) {
      o.history.push();
      pushed = true;
    } else if (!open && pushed) {
      pushed = false;
      if (o.history.back()) ignorePops++;
    }
  }
  /** sheet, then the expanded ranking, then the galaxy map; false when nothing was open */
  function closeTop(): boolean {
    const s = store.get();
    if (s.selectedUnit) store.set({ selectedUnit: null });
    else if (expanded) setExpanded(false);
    else if (s.front === null) closeMap();
    else return false;
    return true;
  }
  const offPop = o.history?.onPop(() => {
    if (ignorePops > 0) {
      ignorePops--;
      return;
    }
    if (!pushed) return;
    pushed = false;
    if (active) closeTop();
    syncHistory(); // another overlay may still be open under the one that closed
  });

  // ---- mode ----
  function refresh(): void {
    const { w, h: ht } = size();
    const on = layoutMode(w, ht) === 'mobile';
    const sideways = on && w > ht;
    const pitch = on ? mobileRowHeight(w, ht) : ROW_H;
    if (on === active && sideways === land && pitch === rowH) return;
    const entering = on && !active;
    active = on;
    land = sideways;
    rowH = pitch;
    root.classList.toggle('m', active);
    root.classList.toggle('m-land', land);
    row.hidden = !active;
    handle.hidden = !active;
    o.ranking.setRowHeight(rowH);
    root.style.setProperty('--m-rank', `${rowH}px`); // the collapsed list shows exactly TOP_N rows
    if (!active) expanded = false;
    key = '';
    // the mobile view is one planet: arriving from the desktop galaxy overview shows the last front (default general)
    if (entering && store.get().front === null) store.set({ front: lastFront, selectedUnit: null });
    render(store.get());
    syncHistory();
    emit();
  }

  function setExpanded(on: boolean): void {
    const v = on && active;
    if (v === expanded) return;
    expanded = v;
    render(store.get());
    syncHistory();
  }

  function step(dir: 1 | -1): void {
    const to = stepFront(world.fronts, store.get().front ?? lastFront, dir);
    if (to) store.set({ front: to, selectedUnit: null });
  }
  const openMap = () => store.set({ front: null, selectedUnit: null });
  const closeMap = () => {
    if (store.get().front === null) store.set({ front: lastFront });
  };

  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  mapBtn.addEventListener('click', () => (mapOpen() ? closeMap() : openMap()));
  showAll.addEventListener('click', () => setExpanded(!expanded));

  const unsubscribe = store.subscribe((s, p) => {
    render(s);
    if (s.front !== p.front || (s.selectedUnit === null) !== (p.selectedUnit === null)) syncHistory();
  });

  // Escape (mobile): sheet → expanded ranking → map; never opens the map (desktop's "Escape leaves the front")
  const onKey = (e: KeyboardEvent) => {
    if (!active || e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    closeTop();
  };
  doc.addEventListener('keydown', onKey);

  const offSwipe = trackSwipes({
    surface: o.stage,
    enabled: () => active,
    steppable: () => active && store.get().front !== null,
    onSwipe: (dir) => step(dir === 'left' ? 1 : -1),
    suppressTaps: o.suppressTaps,
    now: o.now,
  });
  const offDrag = dragSheet({
    handle,
    sheet,
    enabled: () => active,
    onClose: () => store.set({ selectedUnit: null }),
    now: o.now,
  });

  // the top bar / front row / panel / sheet change size with fonts, language and rotation
  const RO = (win as typeof window).ResizeObserver;
  const ro = RO ? new RO(() => active && emit()) : null;
  const title = root.querySelector<HTMLElement>('#hud-title');
  const legend = root.querySelector<HTMLElement>('#hud-legend');
  for (const el of [title, row, panel, sheet, timeline]) if (el) ro?.observe(el);

  /** bottom edge of an element in the HUD root (layout box: transforms such as the sheet's slide-in don't count) */
  const bottomOf = (el: HTMLElement | null) => (el && !el.hidden ? el.offsetTop + el.offsetHeight : 0);

  function insets(): Insets | null {
    if (!active) return null;
    const { w: W, h: H } = size();
    const s = store.get();
    const sheetOpen = !sheet.hidden;
    let top = Math.max(bottomOf(title), bottomOf(row)) + GAP;
    let bottom = H - timeline.offsetTop + GAP;
    let right = 0;
    if (!expanded && s.front !== null && panel.offsetHeight > 0) collapsedTop = panel.offsetTop;
    if (land) {
      if (sheetOpen) right = W - sheet.offsetLeft + GAP;
      else if (s.front !== null && panel.offsetHeight > 0) right = W - panel.offsetLeft + GAP;
    } else if (sheetOpen) bottom = H - sheet.offsetTop + GAP;
    else if (s.front !== null && collapsedTop > 0) bottom = H - collapsedTop + GAP; // the expanded list may cover the planet
    else if (s.front === null && legend && legend.offsetHeight > 0) bottom = H - legend.offsetTop + GAP; // the map's legend
    if (s.front === null && !land) {
      const pad = Math.max(0, H - top - bottom) * MAP_MARGIN;
      top += pad;
      bottom += pad;
    }
    return steadyInsets({ top, right, bottom: Math.max(0, bottom), left: 0 }, W, H);
  }

  refresh();
  render(store.get());

  return {
    get active() {
      return active;
    },
    get landscape() {
      return land;
    },
    get expanded() {
      return expanded;
    },
    insets,
    onLayout(cb) {
      layoutCbs.add(cb);
      return () => void layoutCbs.delete(cb);
    },
    refresh,
    step,
    setExpanded,
    openMap,
    closeMap,
    destroy() {
      unsubscribe();
      offPop?.();
      offSwipe();
      offDrag();
      ro?.disconnect();
      doc.removeEventListener('keydown', onKey);
      layoutCbs.clear();
      root.classList.remove('m', 'm-land', 'm-map', 'm-expanded');
      row.remove();
      showAll.remove();
      handle.remove();
    },
  };
}
