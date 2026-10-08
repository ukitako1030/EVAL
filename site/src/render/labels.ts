/**
 * Screen-space galaxy labels (mockup A `drawPlanetTitle` / `drawUnitLabels`): every planet gets its
 * front name, an English sub-title and the current leader; big planets also name their territories —
 * inside the wedge when it spans ≥ 18° and the name fits, otherwise outside with a leader line.
 * Labels that would collide with one already placed are skipped. Text comes from data as plain text
 * (PixiJS `Text`, no markup). Labels live in the un-bloomed fx layer so they stay crisp.
 *
 * Per frame nothing is allocated: label strings are rebuilt only when their inputs change, collision boxes and
 * leader-line lists are pooled, leader lines go into a dynamic mesh, and a label's `visible` flag is written only
 * when it actually changes (toggling it makes PixiJS rebuild the whole scene's instruction list).
 */
import { CanvasTextMetrics, Container, Text, TextStyle } from 'pixi.js';
import type { FrontId, Lang, Localized } from '../data/types';
import type { Planet } from './planet';
import { hexColor } from './color';
import { createDynMesh } from './dynMesh';
import { createPath, fillCircle, pathPush, pathReset, rgba, strokePath } from './meshBuild';

export interface LabelView {
  lang: Lang;
  /** world → screen (the result is read at once; it may be a reused object) */
  toScreen(x: number, y: number): { x: number; y: number };
  /** camera scale (screen px per world unit) */
  scale: number;
  /** 0..1 overall opacity (fades out while the camera zooms into a planet) */
  alpha: number;
  /** compact layout (portrait phones): smaller type, no sub-titles on small planets */
  compact: boolean;
  /** planet the pointer is over (shows the "click to enter" hint) */
  hover: FrontId | null;
  /** screen size: optional labels never leave it */
  screen: { w: number; h: number };
}

export interface GalaxyLabels {
  readonly container: Container;
  update(planets: readonly Planet[], names: ReadonlyMap<FrontId, Localized>, v: LabelView): void;
  /** re-render all text (call once web fonts have loaded) */
  refresh(): void;
  destroy(): void;
}

export const FONT_JP = ['Noto Sans JP', 'Yu Gothic UI', 'Meiryo', 'sans-serif'];
export const FONT_UI = ['Rajdhani', 'Noto Sans JP', 'Yu Gothic UI', 'sans-serif'];
export const FONT_DISP = ['Orbitron', 'Rajdhani', 'Segoe UI', 'sans-serif'];
const WORDS = {
  lead: { ja: '首位', en: 'LEAD' },
  none: { ja: '― 勢力なし ―', en: '— no forces —' },
  hint: { ja: '▶ クリックで戦線へ突入', en: '▶ Click to enter this front' },
} as const;
const DARK = 0x00030c;
const MIN_INSIDE = (18 * Math.PI) / 180;
/** satellite planets smaller than this (screen px radius) drop the tiny sub-title line (unreadable, and it pushes the
 * title stack into the HUD on short windows) */
const SUB_MIN_R = 56;

/** a label and whether this frame placed it */
interface Label {
  t: Text;
  want: boolean;
}

interface Title {
  name: Label;
  sub: Label;
  lead: Label;
  lang: Lang | null;
  /** the front's names the strings were built from */
  names: Localized | null;
  nameStr: string;
  subStr: string;
  /** leader line inputs and the string built from them */
  leadLang: Lang | null;
  leadName: string | null;
  leadStr: string;
}

interface UnitLabel extends Label {
  id: string;
  seen: number;
  isLead: boolean | null;
  src: string | null;
  str: string;
}

interface PlanetUnits {
  units: Map<string, UnitLabel>;
  list: UnitLabel[];
  /** wedge indices by share, largest first (for the planet's wedges at `revision`) */
  order: number[];
  /** `planet.revision` the order was computed for (the planet rewrites its wedges in place), −1 = never */
  revision: number;
}

/** insert `v` into `arr` at `j` (Array.splice would allocate its result) */
function insertAt(arr: number[], j: number, v: number): void {
  arr.push(v);
  for (let i = arr.length - 1; i > j; i--) arr[i] = arr[i - 1];
  arr[j] = v;
}

/** a territory name placed outside its planet */
interface Out {
  l: UnitLabel;
  am: number;
  side: number;
  y: number;
  col: number;
}

function makeText(family: string[], size: number, weight: '500' | '700' | '800', fill: number, spacing = 0): Text {
  const t = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: family,
      fontSize: size,
      fontWeight: weight,
      fill,
      letterSpacing: spacing,
      stroke: { color: DARK, width: 3, join: 'round' },
      dropShadow: { color: fill, alpha: 0.85, blur: 7, distance: 0, angle: 0 },
      padding: 8,
    }),
  });
  t.anchor.set(0.5);
  t.visible = false;
  return t;
}

function set(t: Text, text: string, size: number, fill: number, glow: number) {
  if (t.text !== text) t.text = text;
  const s = t.style;
  if (s.fontSize !== size) s.fontSize = size;
  if (s.fill !== fill) s.fill = fill;
  const ds = s.dropShadow;
  if (ds && ds.color !== glow) s.dropShadow = { ...ds, color: glow };
}

export function createGalaxyLabels(): GalaxyLabels {
  const container = new Container({ label: 'galaxy-labels' });
  container.eventMode = 'none';
  const lines = createDynMesh({ label: 'label-lines', blendMode: 'add' });
  container.addChild(lines.mesh);
  const titles = new Map<FrontId, Title>();
  const perPlanet = new Map<FrontId, PlanetUnits>();
  const planetUnits: PlanetUnits[] = [];
  /** every label, for the end-of-frame visibility pass */
  const all: Label[] = [];
  const hint: Label = { t: makeText(FONT_JP, 12, '700', 0xbff6ff, 1), want: false };
  hint.t.style.dropShadow = { color: 0x3de8ff, alpha: 0.9, blur: 8, distance: 0, angle: 0 };
  container.addChild(hint.t);
  all.push(hint);
  let screen = { w: 1e9, h: 1e9 };
  let frame = 0;

  // placed boxes: x0 y0 x1 y1 per box
  let boxes = new Float64Array(4 * 64);
  let nb = 0;
  // screen centres of the planets this frame, and the order titles are placed in (hub first)
  let cx = new Float64Array(8);
  let cy = new Float64Array(8);
  const order: number[] = [];
  const outs: Out[] = [];
  let nOut = 0;
  const side: number[] = [];
  const path = createPath(4);

  function label(t: Text): Label {
    const l = { t, want: false };
    all.push(l);
    return l;
  }

  function drop(l: Label) {
    const i = all.indexOf(l);
    if (i >= 0) {
      all[i] = all[all.length - 1];
      all.pop();
    }
    l.t.destroy();
  }

  function hitsBox(x0: number, y0: number, x1: number, y1: number): boolean {
    for (let i = 0; i < nb; i++) {
      const k = 4 * i;
      if (boxes[k] < x1 && x0 < boxes[k + 2] && boxes[k + 1] < y1 && y0 < boxes[k + 3]) return true;
    }
    return false;
  }

  function pushBox(x0: number, y0: number, x1: number, y1: number) {
    if (4 * nb + 4 > boxes.length) {
      const b = new Float64Array(boxes.length * 2);
      b.set(boxes);
      boxes = b;
    }
    const k = 4 * nb++;
    boxes[k] = x0;
    boxes[k + 1] = y0;
    boxes[k + 2] = x1;
    boxes[k + 3] = y1;
  }

  /**
   * Show `l` at (x, y) with horizontal anchor `ax` unless it collides (or `force`). The anchor is written only on
   * success and only when it changes: a text's anchor change re-validates it and rebuilds PixiJS's instruction list.
   */
  function place(l: Label, x: number, y: number, pad = 2, force = false, ax = 0.5): boolean {
    const t = l.t;
    // collide on the glyph box (the line box is taller than the glyphs)
    const w = t.width;
    const h = t.height * 0.38;
    const x0 = x - w * ax - pad;
    const y0 = y - h - pad;
    const x1 = x0 + w + 2 * pad;
    const y1 = y + h + pad;
    if (!force && (hitsBox(x0, y0, x1, y1) || x0 < 4 || y0 < 4 || x1 > screen.w - 4 || y1 > screen.h - 4)) return false;
    if (t.anchor.x !== ax || t.anchor.y !== 0.5) t.anchor.set(ax, 0.5);
    t.position.set(Math.round(x), Math.round(y));
    l.want = true;
    pushBox(x0, y0, x1, y1);
    return true;
  }

  function titleOf(p: Planet): Title {
    let T = titles.get(p.id);
    if (!T) {
      T = {
        name: label(makeText(FONT_JP, 14, '700', 0xeafcff, 2)),
        sub: label(makeText(FONT_DISP, 8.5, '500', 0x3de8ff, 3)),
        lead: label(makeText(FONT_UI, 11.5, '700', 0xffffff)),
        lang: null,
        names: null,
        nameStr: '',
        subStr: '',
        leadLang: null,
        leadName: null,
        leadStr: '',
      };
      titles.set(p.id, T);
      container.addChild(T.name.t, T.sub.t, T.lead.t);
    }
    return T;
  }

  function unitsOf(p: Planet): PlanetUnits {
    let u = perPlanet.get(p.id);
    if (!u) {
      u = { units: new Map(), list: [], order: [], revision: -1 };
      perPlanet.set(p.id, u);
      planetUnits.push(u);
    }
    // territory order by share, largest first (stable), recomputed only when the territories change
    if (u.revision !== p.revision) {
      const ws = p.wedges;
      u.revision = p.revision;
      const o = u.order;
      o.length = 0;
      for (let i = 0; i < ws.length; i++) {
        let j = o.length;
        while (j > 0 && ws[o[j - 1]].share < ws[i].share) j--;
        insertAt(o, j, i);
      }
    }
    return u;
  }

  function outSlot(): Out {
    return (outs[nOut++] ??= { l: hint as UnitLabel, am: 0, side: 1, y: 0, col: 0 });
  }

  function territoryNames(p: Planet, i: number, sr: number, v: LabelView) {
    const n = p.wedges.length;
    const c0x = cx[i];
    const c0y = cy[i];
    const U = unitsOf(p);
    const fs = Math.round(Math.min(17, Math.max(12, sr / 11)) * (v.compact ? 0.9 : 1));
    const rhoL = n === 1 ? 0.58 : 0.62;
    nOut = 0;
    for (let r = 0; r < U.order.length; r++) {
      const wi = U.order[r];
      const w = p.wedges[wi];
      let l = U.units.get(w.id);
      if (!l) {
        const t = makeText(FONT_UI, fs, '700', 0xffffff);
        l = { t, want: false, id: w.id, seen: frame, isLead: null, src: null, str: '' };
        all.push(l);
        U.units.set(w.id, l);
        U.list.push(l);
        container.addChild(t);
      }
      l.seen = frame;
      const isLead = !!p.leader && p.leader.id === w.id;
      if (isLead !== l.isLead || w.name !== l.src) {
        l.isLead = isLead;
        l.src = w.name;
        l.str = (isLead ? '◆ ' : '') + w.name;
      }
      const col = hexColor(w.color);
      set(l.t, l.str, fs, 0xffffff, col);
      l.t.alpha = w.fog >= 0.5 ? 0.8 : 1;
      let am: number;
      let aw: number;
      if (n === 1) {
        am = -Math.PI / 2;
        aw = Math.PI * 2;
      } else {
        // p.rangeAt(wi, rhoL) without the tuple: the territory lies between frontlines wi and wi + 1
        const a0 = p.borderAt(wi, rhoL);
        const a1 = p.borderAt((wi + 1) % n, rhoL) + (wi === n - 1 ? Math.PI * 2 : 0);
        am = (a0 + a1) / 2;
        aw = a1 - a0;
      }
      if (aw >= MIN_INSIDE && aw * rhoL * sr > l.t.width * 0.85 + 12) {
        if (place(l, c0x + Math.cos(am) * rhoL * sr, c0y + Math.sin(am) * rhoL * sr, 2, false, 0.5)) continue;
      }
      if (w.share < 0.004) continue;
      const o = outSlot();
      o.l = l;
      o.am = am;
      o.side = Math.cos(am) >= 0 ? 1 : -1;
      o.y = c0y + Math.sin(am) * sr * 1.2;
      o.col = col;
    }
    const gap = fs + 5;
    for (let s = 1; s >= -1; s -= 2) {
      // classic pie labels: stack top-down on each side, elbows riding a circle just outside the planet
      side.length = 0;
      for (let k = 0; k < nOut; k++) {
        if (outs[k].side !== s) continue;
        let j = side.length;
        while (j > 0 && outs[side[j - 1]].y > outs[k].y) j--;
        insertAt(side, j, k);
      }
      for (let k = 1; k < side.length; k++) if (outs[side[k]].y - outs[side[k - 1]].y < gap) outs[side[k]].y = outs[side[k - 1]].y + gap;
      for (let k = 0; k < side.length; k++) {
        const o = outs[side[k]];
        const ax = c0x + Math.cos(o.am) * sr * 0.9;
        const ay = c0y + Math.sin(o.am) * sr * 0.9;
        const R1 = sr * 1.18;
        const dy = o.y - c0y;
        const ex = c0x + s * Math.sqrt(Math.max(0, R1 * R1 - dy * dy));
        // blocked (e.g. by the planet title)? slide outward along a longer leader line
        let tx = Number.NaN;
        for (let q = 0; q < 6; q++) {
          const x = ex + s * (18 + q * 14);
          if (place(o.l, x + s * 4, o.y, 2, false, s > 0 ? 0 : 1)) {
            tx = x;
            break;
          }
        }
        if (Number.isNaN(tx)) continue;
        const col = rgba(o.col, 0.9);
        pathReset(path);
        pathPush(path, ax, ay);
        pathPush(path, ex, o.y);
        pathPush(path, tx, o.y);
        strokePath(lines.buf, path, 1.2, col);
        fillCircle(lines.buf, ax, ay, 2, col);
      }
    }
  }

  return {
    container,
    update(planets, names, v) {
      frame++;
      container.alpha = v.alpha;
      screen = v.screen;
      for (let i = 0; i < all.length; i++) all[i].want = false;
      lines.begin();
      const hidden = v.alpha <= 0.01;
      if (!hidden) {
        nb = 0;
        const k = v.compact ? 0.8 : 1;
        if (cx.length < planets.length) {
          cx = new Float64Array(planets.length);
          cy = new Float64Array(planets.length);
        }
        order.length = 0;
        for (let i = 0; i < planets.length; i++) {
          const c = v.toScreen(planets[i].x, planets[i].y);
          cx[i] = c.x;
          cy[i] = c.y;
          if (planets[i].slot.hub) order.push(i);
        }
        for (let i = 0; i < planets.length; i++) if (!planets[i].slot.hub) order.push(i);
        let hintI = -1;
        let hintBelow = false;
        let hintTop = 0;
        let hintBottom = 0;

        // planet titles first (hub first), they always win
        for (let oi = 0; oi < order.length; oi++) {
          const i = order[oi];
          const p = planets[i];
          const sr = p.slot.r * v.scale;
          const T = titleOf(p);
          const nm = names.get(p.id) ?? null;
          const big = p.slot.hub;
          const atm = p.atmosphere;
          const s = big ? 1 : 0.74;
          if (T.lang !== v.lang || T.names !== nm) {
            // Japanese title in Noto Sans JP with an Orbitron sub-title; English title in Rajdhani with a Japanese sub-title
            if (T.lang !== v.lang) {
              T.name.t.style.fontFamily = v.lang === 'ja' ? FONT_JP : FONT_UI;
              T.name.t.style.letterSpacing = v.lang === 'ja' ? 2 : 1.5;
              T.sub.t.style.fontFamily = v.lang === 'ja' ? FONT_DISP : FONT_JP;
              T.sub.t.style.letterSpacing = v.lang === 'ja' ? 3 : 1;
            }
            T.lang = v.lang;
            T.names = nm;
            const ja = nm ? nm.ja : p.id;
            const en = nm ? nm.en : p.id;
            T.nameStr = v.lang === 'ja' ? ja : en.toUpperCase();
            T.subStr = v.lang === 'ja' ? en.toUpperCase() : ja;
          }
          set(T.name.t, T.nameStr, Math.round((v.lang === 'ja' ? 19 : 20) * s * k), 0xeafcff, atm);
          set(T.sub.t, T.subStr, Math.max(7, (v.lang === 'ja' ? 8.5 : 9.5) * k), atm, DARK);
          const L = p.leader;
          const leadName = L ? L.name : null;
          if (T.leadLang !== v.lang || T.leadName !== leadName || T.leadStr === '') {
            T.leadLang = v.lang;
            T.leadName = leadName;
            T.leadStr = L ? `${WORDS.lead[v.lang]} ▸ ${L.name}` : WORDS.none[v.lang];
          }
          const lc = L ? hexColor(L.color) : 0x8899bb;
          set(T.lead.t, T.leadStr, Math.round(11.5 * k * 2) / 2, lc, L ? lc : DARK);
          const showSub = big || (!v.compact && sr >= SUB_MIN_R);
          const gap = 15 * k;
          const block = (showSub ? 2 : 1) * gap;
          const below = p.slot.labelSide === 'below';
          let y = below ? cy[i] + sr * 1.24 + 14 * k : cy[i] - sr * (big ? 1.36 : 1.22) - 20 * k - block;
          if (big && v.compact) y = cy[i] - sr * 1.28 - 12 - block;
          place(T.name, cx[i], y, 2, true);
          if (showSub) place(T.sub, cx[i], y + gap, 1, true);
          place(T.lead, cx[i], y + block, 1, true);
          if (v.hover === p.id) {
            hintI = i;
            hintBelow = below;
            hintTop = y;
            hintBottom = y + block;
          }
        }

        // "click to enter" hint for the hovered planet: on the open side, never over another planet
        if (hintI >= 0) {
          const sr = planets[hintI].slot.r * v.scale;
          const hx = cx[hintI];
          set(hint.t, WORDS.hint[v.lang], Math.round(12 * k), 0xbff6ff, 0x3de8ff);
          const hw = hint.t.width / 2 + 4;
          for (let tr = 0; tr < 2; tr++) {
            const hy = hintBelow ? (tr === 0 ? cy[hintI] - sr * 1.3 - 26 : hintBottom + 20) : tr === 0 ? cy[hintI] + sr * 1.32 + 24 : hintTop - 20;
            let clear = true;
            for (let j = 0; j < planets.length && clear; j++) {
              if (j === hintI) continue;
              clear = Math.max(Math.abs(cx[j] - hx) - hw, Math.abs(cy[j] - hy) - 9) > planets[j].slot.r * v.scale * 1.25;
            }
            if (clear && place(hint, hx, hy, 1)) break;
          }
        }

        // territory names on planets big enough to read them
        for (let oi = 0; oi < order.length; oi++) {
          const i = order[oi];
          const p = planets[i];
          const sr = p.slot.r * v.scale;
          if (sr < 95 || !p.wedges.length) continue;
          territoryNames(p, i, sr, v);
        }
      }
      lines.end();

      // territory labels not shown this frame (unit left, planet too small) are dropped
      if (!hidden)
        for (let pi = 0; pi < planetUnits.length; pi++) {
          const U = planetUnits[pi];
          for (let j = U.list.length - 1; j >= 0; j--) {
            const l = U.list[j];
            if (l.seen === frame) continue;
            U.units.delete(l.id);
            U.list[j] = U.list[U.list.length - 1];
            U.list.pop();
            drop(l);
          }
        }
      for (let i = 0; i < all.length; i++) {
        const l = all[i];
        if (l.t.visible !== l.want) l.t.visible = l.want;
      }
    },
    refresh() {
      CanvasTextMetrics.clearMetrics();
      for (const l of all) l.t.style.update();
    },
    destroy() {
      lines.destroy();
      container.destroy({ children: true });
      titles.clear();
      perPlanet.clear();
      planetUnits.length = 0;
      all.length = 0;
    },
  };
}
