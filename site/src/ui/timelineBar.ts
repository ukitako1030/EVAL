import type { FrontId, Lang, World, WorldEvent } from '../data/types';
import { clampT, monthIndex, monthLabel } from '../data/timeline';
import { selectEvents } from '../events/queue';
import { tr } from '../i18n/strings';
import type { AppState, Store } from '../state/store';
import { clamp, dotMonth, frontName, h, isTypingTarget, setAccent, setAttr, setStyle, setText, unitColor } from './dom';

const SPEEDS: AppState['speed'][] = [1, 2, 4];
/** In the compact (mobile) timeline, news months closer than this share one marker. */
export const COMPACT_MONTH_GAP = 3;

/**
 * Sorted month indices → groups that share one marker: a month joins the current group while it is less than `gap`
 * months after the group's first month (gap 1 → every month on its own).
 */
export function groupMonths(months: readonly number[], gap: number): number[][] {
  const out: number[][] = [];
  for (const m of months) {
    const g = out[out.length - 1];
    if (g && m - g[0] < Math.max(1, gap)) g.push(m);
    else out.push([m]);
  }
  return out;
}

/**
 * Pointer x (px from the track's left edge) → fractional month index on a track `width` px wide covering `months` months.
 * Clamped to the timeline; `snap` rounds to the nearest whole month. A degenerate width or NaN x gives month 0.
 */
export function xToT(x: number, width: number, months: number, snap = false): number {
  const last = Math.max(0, Math.floor(months) - 1);
  if (!(width > 0) || Number.isNaN(x)) return 0;
  const t = clamp(x / width, 0, 1) * last;
  return snap ? Math.round(t) : t;
}

export interface TimelineBar {
  el: HTMLElement;
  update(state: AppState): void;
  /** true while the user drags the slider (no battle news while scrubbing) */
  isDragging(): boolean;
  /** narrow screens: nearby news months share one marker (`COMPACT_MONTH_GAP`) so the diamonds don't pile up */
  setCompact(on: boolean): void;
  destroy(): void;
}

/** Focused elements that Space already activates natively (we must not toggle playback on top of that). */
const activatesOnSpace = (t: EventTarget | null): boolean => t instanceof Element && t.closest('button, a[href], summary, [role="button"]') !== null;

/**
 * Timeline: play / pause, speed 1×/2×/4×, skip (intro only), a slider over `world.months` with year ticks and a marker
 * for every month that has battle news in the current view. Keyboard: Space plays / pauses, ←/→ step one month.
 */
export function createTimelineBar(root: HTMLElement, world: World, store: Store<AppState>): TimelineBar {
  const last = world.months.length - 1;
  const pct = (i: number) => (last > 0 ? (i / last) * 100 : 0);

  const playIcon = h('span', { attrs: { 'aria-hidden': 'true' } });
  const play = h('button', { class: 'tl-btn tl-play', attrs: { type: 'button' } }, [playIcon]);
  const speed = h('button', { class: 'tl-btn tl-speed', attrs: { type: 'button' } });
  const skip = h('button', { class: 'tl-btn tl-skip', attrs: { type: 'button', hidden: true } });
  const markers = h('div', { class: 'tl-markers' });
  const ticks = h('div', { class: 'tl-ticks', attrs: { 'aria-hidden': 'true' } });
  const years = h('div', { class: 'tl-years', attrs: { 'aria-hidden': 'true' } });
  const fill = h('div', { class: 'tl-fill', attrs: { 'aria-hidden': 'true' } });
  const label = h('span', { class: 'tl-label' });
  const thumb = h('div', { class: 'tl-thumb', attrs: { 'aria-hidden': 'true' } }, [label]);
  const track = h('div', { class: 'tl-track', attrs: { role: 'slider', tabindex: 0, 'aria-valuemin': 0, 'aria-valuemax': last } }, [ticks, fill, thumb]);
  const el = h('div', { class: 'timeline-bar' }, [play, speed, h('div', { class: 'tl-wrap' }, [markers, track, years]), skip]);
  root.appendChild(el);

  world.months.forEach((m, i) => {
    const tick = h('i', { class: m.endsWith('-01') ? 'yr' : undefined });
    tick.style.left = `${pct(i)}%`;
    ticks.appendChild(tick);
    if (m.endsWith('-01')) {
      const y = h('span', {}, [m.slice(0, 4)]);
      y.style.left = `${pct(i)}%`;
      years.appendChild(y);
    }
  });

  let markerEls: { i: number; el: HTMLButtonElement }[] = [];
  let markerKey = '';
  let pastMonth = -1;
  let compact = false;

  function buildMarkers(front: FrontId | null, lang: Lang): void {
    markerEls = [];
    markers.replaceChildren();
    const news = new Map<number, WorldEvent[]>();
    for (let i = 0; i <= last; i++) {
      const evs = selectEvents(world, i, front);
      if (evs.length) news.set(i, evs);
    }
    for (const group of groupMonths([...news.keys()], compact ? COMPACT_MONTH_GAP : 1)) {
      const i = group[0];
      const evs = group.flatMap((m) => news.get(m) ?? []);
      const desc = evs.map((e) => `${dotMonth(e.month)} ${frontName(world, e.front, lang)} — ${e.text[lang]}`).join('\n');
      const b = h('button', { class: 'tl-marker', attrs: { type: 'button', 'data-month': i, title: desc, 'aria-label': desc } });
      b.style.left = `${pct(i)}%`;
      setAccent(b, unitColor(world, evs[0].front, evs[0].unit));
      if (evs.length > 1) b.dataset.n = String(evs.length);
      b.addEventListener('click', () => store.set({ t: i, playing: false }));
      markers.appendChild(b);
      markerEls.push({ i, el: b });
    }
    pastMonth = -1;
  }

  function togglePlay(): void {
    const s = store.get();
    if (s.playing) store.set({ playing: false });
    else if (s.t >= last - 1e-6) store.set({ t: 0, playing: true }); // at the end: play the war again
    else store.set({ playing: true });
  }

  /** → goes to the next whole month, ← to the previous one (from between two months, to the nearer edge first). */
  function step(d: 1 | -1): void {
    const t = clampT(world, store.get().t);
    const to = d > 0 ? Math.floor(t + 1e-9) + 1 : Math.ceil(t - 1e-9) - 1;
    store.set({ t: clamp(to, 0, last), playing: false });
  }

  // ---- pointer scrubbing ----
  let dragging = false;
  const tAt = (e: PointerEvent, snap: boolean) => {
    const r = track.getBoundingClientRect();
    return xToT(e.clientX - r.left, r.width, world.months.length, snap);
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    el.classList.add('tl-dragging');
    try {
      track.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best effort */
    }
    track.focus({ preventScroll: true });
    store.set({ t: tAt(e, false), playing: false });
  });
  track.addEventListener('pointermove', (e) => {
    if (dragging) store.set({ t: tAt(e, false), playing: false });
  });
  track.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('tl-dragging');
    store.set({ t: tAt(e, true), playing: false }); // rest on a whole month
  });
  track.addEventListener('pointercancel', () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('tl-dragging');
    store.set({ t: Math.round(clampT(world, store.get().t)) });
  });

  // ---- buttons ----
  play.addEventListener('click', togglePlay);
  speed.addEventListener('click', () => {
    const s = store.get().speed;
    store.set({ speed: SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length] });
  });
  skip.addEventListener('click', () => store.set({ t: last, playing: false, intro: false }));

  // ---- keyboard ----
  const doc = root.ownerDocument;
  function onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
    if (e.key === ' ' || e.key === 'Spacebar') {
      if (activatesOnSpace(e.target)) return;
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    } else if ((e.key === 'Home' || e.key === 'End') && e.target === track) {
      e.preventDefault();
      store.set({ t: e.key === 'Home' ? 0 : last, playing: false });
    }
  }
  doc.addEventListener('keydown', onKey);

  let lang: Lang | null = null;

  function update(state: AppState): void {
    const key = `${state.front ?? ''}|${state.lang}|${compact}`;
    if (key !== markerKey) {
      markerKey = key;
      buildMarkers(state.front, state.lang);
    }
    if (state.lang !== lang) {
      lang = state.lang;
      setAttr(track, 'aria-label', tr('timeline', lang));
      setText(skip, `${tr('skip', lang)} ▶▶`);
    }
    setText(playIcon, state.playing ? '❚❚' : '▶');
    setAttr(play, 'aria-label', tr(state.playing ? 'pause' : 'play', state.lang));
    setText(speed, `${state.speed}×`);
    setAttr(speed, 'aria-label', `${tr('speed', state.lang)} ${state.speed}×`);
    skip.hidden = !state.intro;

    const t = clampT(world, state.t);
    const f = last > 0 ? t / last : 1;
    setStyle(fill, 'transform', `scaleX(${f.toFixed(4)})`);
    setStyle(thumb, 'left', `${(f * 100).toFixed(3)}%`);
    setStyle(el, '--tl-f', f.toFixed(3)); // lets the compact layout keep the month badge inside the track
    const lbl = monthLabel(world, t);
    setText(label, lbl);
    const mi = monthIndex(world, t);
    setAttr(track, 'aria-valuenow', String(mi));
    setAttr(track, 'aria-valuetext', lbl);
    if (mi !== pastMonth) {
      pastMonth = mi;
      for (const m of markerEls) m.el.classList.toggle('past', m.i <= mi);
    }
    el.classList.toggle('reduced-motion', state.reducedMotion);
  }

  const unsubscribe = store.subscribe((s) => update(s));
  update(store.get());

  return {
    el,
    update,
    isDragging: () => dragging,
    setCompact(on) {
      if (on === compact) return;
      compact = on;
      update(store.get());
    },
    destroy() {
      unsubscribe();
      doc.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}
