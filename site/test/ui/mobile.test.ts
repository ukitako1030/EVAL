// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createMobile, type OverlayHistory } from '../../src/ui/mobile';
import { mountHud } from '../../src/ui/hud';
import { createRanking, ROW_H } from '../../src/ui/ranking';
import { createDetail } from '../../src/ui/detail';
import { TALL_ROW_H, MOBILE_ROW_H } from '../../src/ui/mobileLayout';
import { createStore, defaultState, type AppState } from '../../src/state/store';
import type { World } from '../../src/data/types';
import { makeWorld } from '../fixtures/world';

/** The fixture world with `n` units on the general front (the stock fixture has three). */
function worldWith(n: number): World {
  const w = makeWorld();
  for (let k = 0; w.units.general && Object.keys(w.units.general).length < n; k++) {
    const id = `u${k}`;
    w.units.general[id] = { org: 'openai', name: `Unit ${k}`, since: '2025-01' };
    w.series.general[id] = w.months.map(() => ({ s: 50 + k, c: 1, q: 'high', qs: 'high', qc: 'high' }));
  }
  return w;
}

function fakeHistory() {
  const pops = new Set<() => void>();
  const h = {
    pushes: 0,
    backs: 0,
    top: false,
    push() {
      h.pushes++;
      h.top = true;
    },
    back() {
      if (!h.top) return false;
      h.backs++;
      h.top = false;
      queueMicrotask(() => pops.forEach((cb) => cb()));
      return true;
    },
    onPop(cb: () => void) {
      pops.add(cb);
      return () => void pops.delete(cb);
    },
    /** the reader presses the browser's back button */
    userBack() {
      h.top = false;
      pops.forEach((cb) => cb());
    },
  };
  return h satisfies OverlayHistory & Record<string, unknown>;
}

const live: { destroy(): void }[] = [];

function setup(o: { w?: number; h?: number; patch?: Partial<AppState>; units?: number; history?: ReturnType<typeof fakeHistory> } = {}) {
  const world = o.units ? worldWith(o.units) : makeWorld();
  const store = createStore<AppState>({ ...defaultState(world.months.length - 1), ...o.patch });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const hud = mountHud(root, store, world);
  const ranking = createRanking(hud.slots.ranking, world, store);
  const setRowHeight = vi.spyOn(ranking, 'setRowHeight');
  const detail = createDetail(hud.slots.detail, world, store);
  const stage = document.createElement('canvas');
  document.body.appendChild(stage);
  const size = { w: o.w ?? 390, h: o.h ?? 844 };
  let clock = 0;
  const suppressTaps = vi.fn();
  const mobile = createMobile(world, store, {
    hud,
    ranking,
    detail,
    stage,
    size: () => size,
    suppressTaps,
    history: o.history ?? null,
    now: () => clock,
  });
  live.push(mobile);
  const tick = (ms: number) => (clock += ms);
  return { world, store, root, hud, mobile, stage, size, suppressTaps, setRowHeight, tick, detail };
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const pe = (type: string, x: number, y: number, id = 1) =>
  new PointerEvent(type, { pointerId: id, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y, bubbles: true });

/** a one-finger gesture on the stage from (x0, y0) to (x1, y1) taking `ms` */
function swipe(t: ReturnType<typeof setup>, x0: number, y0: number, x1: number, y1: number, ms = 200) {
  t.stage.dispatchEvent(pe('pointerdown', x0, y0));
  t.tick(ms / 2);
  window.dispatchEvent(pe('pointermove', (x0 + x1) / 2, (y0 + y1) / 2));
  t.tick(ms / 2);
  window.dispatchEvent(pe('pointerup', x1, y1));
}

afterEach(() => {
  for (const m of live.splice(0)) m.destroy(); // their document / window listeners outlive the DOM
  document.body.replaceChildren();
});

describe('mobile layout: mode detection', () => {
  it('turns the HUD into the mobile layout on a phone and opens on the general front', () => {
    const t = setup({ w: 390, h: 844 });
    expect(t.mobile.active).toBe(true);
    expect(t.root.querySelector('#hud')!.classList.contains('m')).toBe(true);
    expect($('#m-front').hidden).toBe(false);
    expect(t.store.get().front).toBe('general');
    expect($('.m-front-name').textContent).toBe('generalJA');
    expect(t.setRowHeight).toHaveBeenLastCalledWith(TALL_ROW_H);
  });

  it('keeps the desktop layout on a wide landscape window', () => {
    const t = setup({ w: 1440, h: 900 });
    expect(t.mobile.active).toBe(false);
    expect(t.hud.el.classList.contains('m')).toBe(false);
    expect($('#m-front').hidden).toBe(true);
    expect(t.store.get().front).toBeNull();
    expect(t.mobile.insets()).toBeNull();
  });

  it('follows resizes and rotation live', () => {
    const t = setup({ w: 1440, h: 900 });
    const layout = vi.fn();
    t.mobile.onLayout(layout);
    t.size.w = 360;
    t.size.h = 780;
    t.mobile.refresh();
    expect(t.mobile.active).toBe(true);
    expect(t.store.get().front).toBe('general'); // the desktop galaxy becomes the default planet
    expect(t.setRowHeight).toHaveBeenLastCalledWith(MOBILE_ROW_H);
    expect(layout).toHaveBeenCalledTimes(1);

    t.size.w = 667; // held sideways, still narrow
    t.size.h = 375;
    t.mobile.refresh();
    expect(t.mobile.landscape).toBe(true);
    expect(t.hud.el.classList.contains('m-land')).toBe(true);

    t.size.w = 1440;
    t.size.h = 900;
    t.mobile.refresh();
    expect(t.mobile.active).toBe(false);
    expect(t.hud.el.classList.contains('m')).toBe(false);
    expect(t.setRowHeight).toHaveBeenLastCalledWith(ROW_H);
    expect(t.store.get().front).toBe('general'); // the desktop keeps showing that front
    t.mobile.refresh();
    expect(layout).toHaveBeenCalledTimes(3); // nothing changed the last time
  });

  it('keeps a front from a shared link', () => {
    const t = setup({ patch: { front: 'video' } });
    expect(t.store.get().front).toBe('video');
    expect($('.m-dots i.on').getAttribute('data-front')).toBe('video');
  });
});

describe('mobile layout: stepping fronts', () => {
  it('◀ ▶ walk world.fronts and wrap, closing a unit detail on the way', () => {
    const t = setup({ patch: { selectedUnit: 'gpt' } });
    $('.m-next').click();
    expect(t.store.get().front).toBe('code');
    expect(t.store.get().selectedUnit).toBeNull();
    $('.m-prev').click();
    $('.m-prev').click();
    expect(t.store.get().front).toBe('music');
    $('.m-next').click();
    expect(t.store.get().front).toBe('general');
    expect($('.m-next').getAttribute('aria-label')).toBe('次の戦線: codeJA');
    expect($('.m-prev').getAttribute('aria-label')).toBe('前の戦線: musicJA');
  });

  it('a quick horizontal swipe on the stage steps the front: left = next, right = previous', () => {
    const t = setup();
    swipe(t, 300, 400, 180, 410);
    expect(t.store.get().front).toBe('code');
    swipe(t, 100, 400, 260, 390);
    expect(t.store.get().front).toBe('general');
    swipe(t, 100, 400, 260, 390);
    expect(t.store.get().front).toBe('music');
  });

  it('ignores short, slow and vertical drags (threshold 50 px within 600 ms, mostly sideways)', () => {
    const t = setup();
    swipe(t, 300, 400, 260, 400); // 40 px
    swipe(t, 300, 400, 100, 400, 900); // too slow
    swipe(t, 300, 400, 240, 520); // more down than sideways
    expect(t.store.get().front).toBe('general');
  });

  it('suppresses the renderer’s taps while a finger drags, so a swipe never also selects a unit', () => {
    const t = setup();
    t.stage.dispatchEvent(pe('pointerdown', 200, 400));
    window.dispatchEvent(pe('pointermove', 204, 402)); // still a tap
    expect(t.suppressTaps).not.toHaveBeenCalled();
    window.dispatchEvent(pe('pointermove', 150, 402));
    expect(t.suppressTaps).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(pe('pointerup', 120, 402));
    expect(t.suppressTaps).toHaveBeenLastCalledWith(false);
  });

  it('a second finger cancels the swipe (pinch)', () => {
    const t = setup();
    t.stage.dispatchEvent(pe('pointerdown', 300, 400, 1));
    t.stage.dispatchEvent(pe('pointerdown', 100, 400, 2));
    t.tick(150);
    window.dispatchEvent(pe('pointerup', 100, 400, 1));
    expect(t.store.get().front).toBe('general');
  });

  it('does not step from the galaxy map, nor on the desktop', () => {
    const t = setup();
    $('#m-map').click();
    expect(t.store.get().front).toBeNull();
    swipe(t, 300, 400, 100, 400);
    expect(t.store.get().front).toBeNull();

    const d = setup({ w: 1440, h: 900 });
    swipe(d, 300, 400, 100, 400);
    expect(d.store.get().front).toBeNull();
  });
});

describe('mobile layout: galaxy map', () => {
  it('opens the overview and returns to the last front', () => {
    const t = setup({ patch: { front: 'image' } });
    const map = $<HTMLButtonElement>('#m-map');
    expect(map.textContent).toBe('全体マップ');
    map.click();
    expect(t.store.get().front).toBeNull();
    expect(t.hud.el.classList.contains('m-map')).toBe(true);
    expect($('.m-front-name').textContent).toBe('全体マップ');
    expect($('.m-front-hint').hidden).toBe(false);
    expect($('.m-next').hidden).toBe(true);
    expect(map.getAttribute('aria-pressed')).toBe('true');
    expect(map.textContent).toBe('戦線に戻る');
    map.click();
    expect(t.store.get().front).toBe('image');
    expect(t.hud.el.classList.contains('m-map')).toBe(false);
  });

  it('entering a planet from the map (tap in the renderer) closes the map', () => {
    const t = setup();
    t.mobile.openMap();
    t.store.set({ front: 'agent' });
    expect(t.hud.el.classList.contains('m-map')).toBe(false);
    expect($('.m-front-name').textContent).toBe('agentJA');
  });
});

describe('mobile layout: ranking top 5', () => {
  it('offers "show all" only when the front has more than five units, and toggles the full list', () => {
    const t = setup({ units: 7 });
    const btn = $<HTMLButtonElement>('#m-showall');
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe('すべて表示 ▾');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    expect(t.mobile.expanded).toBe(true);
    expect(t.hud.el.classList.contains('m-expanded')).toBe(true);
    expect(btn.textContent).toBe('上位5件 ▴');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    btn.click();
    expect(t.hud.el.classList.contains('m-expanded')).toBe(false);

    t.store.set({ lang: 'en' });
    expect(btn.textContent).toBe('Show all ▾');
  });

  it('has nothing to expand with five units or fewer, nor on the desktop', () => {
    setup(); // three units
    expect($('#m-showall').hidden).toBe(true);
    for (const m of live.splice(0)) m.destroy();
    document.body.replaceChildren();
    setup({ w: 1440, h: 900, units: 7 });
    expect($('#m-showall').hidden).toBe(true);
  });

  it('the rows under the top five are out of reach (inert) while the list is collapsed', () => {
    const t = setup({ units: 7 });
    const rows = () => [...document.querySelectorAll<HTMLLIElement>('li.rank-row')].filter((li) => !li.hidden);
    expect(rows().map((li) => li.hasAttribute('inert'))).toEqual([false, false, false, false, false, true, true]);
    t.mobile.setExpanded(true);
    expect(rows().some((li) => li.hasAttribute('inert'))).toBe(false);
    t.mobile.setExpanded(false);
    expect(rows().filter((li) => li.hasAttribute('inert'))).toHaveLength(2);
    t.size.w = 1440; // desktop: every row
    t.size.h = 900;
    t.mobile.refresh();
    expect(rows().some((li) => li.hasAttribute('inert'))).toBe(false);
  });

  it('collapses when the window becomes desktop-sized', () => {
    const t = setup({ units: 7 });
    t.mobile.setExpanded(true);
    t.size.w = 1440;
    t.size.h = 900;
    t.mobile.refresh();
    expect(t.mobile.expanded).toBe(false);
    expect(t.hud.el.classList.contains('m-expanded')).toBe(false);
  });
});

describe('mobile layout: closing things', () => {
  it('Escape closes the sheet, then the full list, then the map, and never opens the map', () => {
    const t = setup({ units: 7 });
    const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    esc();
    expect(t.store.get().front).toBe('general'); // nothing open: Escape does not leave the planet
    t.mobile.openMap();
    t.mobile.setExpanded(true);
    t.store.set({ selectedUnit: 'gpt' });
    esc();
    expect(t.store.get().selectedUnit).toBeNull();
    expect(t.mobile.expanded).toBe(true);
    esc();
    expect(t.mobile.expanded).toBe(false);
    expect(t.store.get().front).toBeNull();
    esc();
    expect(t.store.get().front).toBe('general');
  });

  it('marks Escape as handled so the desktop handler does not leave the front', () => {
    setup();
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('the browser back button closes the sheet instead of leaving the page', async () => {
    const history = fakeHistory();
    const t = setup({ history });
    t.store.set({ selectedUnit: 'gpt' });
    expect(history.pushes).toBe(1);
    history.userBack();
    expect(t.store.get().selectedUnit).toBeNull();
    expect(history.backs).toBe(0);
  });

  it('closing an overlay with its own button drops the history entry again', async () => {
    const history = fakeHistory();
    const t = setup({ history });
    t.store.set({ selectedUnit: 'gpt' });
    $<HTMLButtonElement>('.detail-close').click();
    expect(history.backs).toBe(1);
    await Promise.resolve(); // our own back() → popstate is ignored
    expect(t.store.get().front).toBe('general');
    t.mobile.openMap();
    expect(history.pushes).toBe(2);
    history.userBack();
    expect(t.store.get().front).toBe('general');
  });

  it('back with the map and a sheet open closes the sheet first and keeps an entry for the map', () => {
    const history = fakeHistory();
    const t = setup({ history });
    t.mobile.openMap();
    t.store.set({ selectedUnit: 'gpt' });
    expect(history.pushes).toBe(1);
    history.userBack();
    expect(t.store.get().selectedUnit).toBeNull();
    expect(t.store.get().front).toBeNull();
    expect(history.pushes).toBe(2);
    history.userBack();
    expect(t.store.get().front).toBe('general');
  });

  it('the sheet handle closes the sheet on a tap or a long drag down, and springs back from a short one', () => {
    const t = setup();
    t.store.set({ selectedUnit: 'gpt' });
    const handle = $<HTMLButtonElement>('.sheet-handle');
    expect(handle.hidden).toBe(false);
    expect(handle.getAttribute('aria-label')).toBe('詳細シートを閉じる');
    const sheet = t.detail.el;
    Object.defineProperty(sheet, 'offsetHeight', { configurable: true, value: 440 });

    handle.dispatchEvent(pe('pointerdown', 200, 450));
    t.tick(100);
    handle.dispatchEvent(pe('pointermove', 200, 480));
    expect(sheet.style.transform).toBe('translateY(30.0px)');
    t.tick(200);
    handle.dispatchEvent(pe('pointerup', 200, 490));
    expect(t.store.get().selectedUnit).toBe('gpt');
    expect(sheet.style.transform).toBe('');

    handle.dispatchEvent(pe('pointerdown', 200, 450));
    t.tick(100);
    handle.dispatchEvent(pe('pointermove', 200, 520));
    t.tick(100);
    handle.dispatchEvent(pe('pointermove', 200, 600));
    handle.dispatchEvent(pe('pointerup', 200, 600));
    expect(t.store.get().selectedUnit).toBeNull();

    t.store.set({ selectedUnit: 'gpt' });
    handle.dispatchEvent(pe('pointerdown', 200, 450));
    handle.dispatchEvent(pe('pointerup', 201, 451));
    expect(t.store.get().selectedUnit).toBeNull();
  });
});

describe('mobile layout: teardown', () => {
  it('destroy removes its elements and classes', () => {
    const t = setup();
    t.mobile.destroy();
    expect(document.querySelector('#m-front')).toBeNull();
    expect(document.querySelector('#m-showall')).toBeNull();
    expect(document.querySelector('.sheet-handle')).toBeNull();
    expect(t.hud.el.classList.contains('m')).toBe(false);
  });
});
