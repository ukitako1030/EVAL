/**
 * Screen-space galaxy labels (mockup A `drawPlanetTitle` / `drawUnitLabels`): every planet gets its
 * front name, an English sub-title and the current leader; big planets also name their territories —
 * inside the wedge when it spans ≥ 18° and the name fits, otherwise outside with a leader line.
 * Labels that would collide with one already placed are skipped. Text comes from data as plain text
 * (PixiJS `Text`, no markup). Labels live in the un-bloomed fx layer so they stay crisp.
 */
import { CanvasTextMetrics, Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { FrontId, Lang, Localized } from '../data/types';
import type { Planet } from './planet';
import { hexColor } from './planet';

export interface LabelView {
  lang: Lang;
  /** world → screen */
  toScreen(x: number, y: number): { x: number; y: number };
  /** camera scale (screen px per world unit) */
  scale: number;
  /** 0..1 overall opacity (fades out while the camera zooms into a planet) */
  alpha: number;
  /** compact layout (portrait phones): smaller type, no sub-titles on small planets */
  compact: boolean;
  /** planet the pointer is over (shows the "click to enter" hint) */
  hover: FrontId | null;
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

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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

const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export function createGalaxyLabels(): GalaxyLabels {
  const container = new Container({ label: 'galaxy-labels' });
  container.eventMode = 'none';
  const lines = new Graphics();
  lines.blendMode = 'add';
  container.addChild(lines);
  const titles = new Map<FrontId, { name: Text; sub: Text; lead: Text }>();
  const units = new Map<string, Text>();
  const hint = makeText(FONT_JP, 12, '700', 0xbff6ff, 1);
  hint.style.dropShadow = { color: 0x3de8ff, alpha: 0.9, blur: 8, distance: 0, angle: 0 };
  container.addChild(hint);
  const all = (): Text[] => [hint, ...[...titles.values()].flatMap((t) => [t.name, t.sub, t.lead]), ...units.values()];

  function place(t: Text, x: number, y: number, placed: Rect[], pad = 2, force = false): boolean {
    // Text bounds include the style padding (room for the glow); collide on the glyph box only
    const tp = t.style.padding;
    const w = Math.max(0, t.width - 2 * tp);
    const h = Math.max(0, t.height - 2 * tp) * 0.42;
    const x0 = x - w * t.anchor.x - pad;
    const r = { x0, y0: y - h - pad, x1: x0 + w + 2 * pad, y1: y + h + pad };
    if (!force && placed.some((p) => hit(p, r))) {
      t.visible = false;
      return false;
    }
    t.position.set(Math.round(x), Math.round(y));
    t.visible = true;
    placed.push(r);
    return true;
  }

  return {
    container,
    update(planets, names, v) {
      container.alpha = v.alpha;
      lines.clear();
      const hidden = v.alpha <= 0.01;
      for (const t of all()) t.visible = false;
      if (hidden) return;
      const placed: Rect[] = [];
      const k = v.compact ? 0.8 : 1;
      const used = new Set<string>();

      // planet titles first (hub first), they always win
      const order = [...planets].sort((a, b) => Number(b.slot.hub) - Number(a.slot.hub));
      for (const p of order) {
        const c = v.toScreen(p.x, p.y);
        const sr = p.slot.r * v.scale;
        let T = titles.get(p.id);
        if (!T) {
          T = { name: makeText(FONT_JP, 14, '700', 0xeafcff, 2), sub: makeText(FONT_DISP, 8.5, '500', 0x3de8ff, 3), lead: makeText(FONT_UI, 11.5, '700', 0xffffff) };
          titles.set(p.id, T);
          container.addChild(T.name, T.sub, T.lead);
        }
        const nm = names.get(p.id) ?? { ja: p.id, en: p.id };
        const big = p.slot.hub;
        const atm = p.atmosphere;
        const s = big ? 1 : 0.74;
        set(T.name, v.lang === 'ja' ? nm.ja : nm.en.toUpperCase(), Math.round(19 * s * k), 0xeafcff, atm);
        set(T.sub, v.lang === 'ja' ? nm.en.toUpperCase() : nm.ja, Math.max(7, 8.5 * k), atm, DARK);
        const L = p.leader;
        set(T.lead, L ? `${WORDS.lead[v.lang]} ▸ ${L.name}` : WORDS.none[v.lang], Math.round(11.5 * k * 2) / 2, L ? hexColor(L.color) : 0x8899bb, L ? hexColor(L.color) : DARK);
        const showSub = !(v.compact && !big);
        const gap = 15 * k;
        const block = (showSub ? 2 : 1) * gap;
        const below = p.slot.labelSide === 'below';
        let y = below ? c.y + sr * 1.24 + 14 * k : c.y - sr * (big ? 1.36 : 1.22) - 20 * k - block;
        if (big && v.compact) y = c.y - sr * 1.28 - 12 - block;
        place(T.name, c.x, y, placed, 2, true);
        if (showSub) place(T.sub, c.x, y + gap, placed, 1, true);
        place(T.lead, c.x, y + block, placed, 1, true);
        if (v.hover === p.id) {
          set(hint, WORDS.hint[v.lang], Math.round(12 * k), 0xbff6ff, 0x3de8ff);
          const hy = below ? c.y - sr * 1.3 - 26 : c.y + sr * 1.32 + 24;
          place(hint, c.x, hy, placed, 1, true);
        }
      }

      // territory names on planets big enough to read them
      for (const p of order) {
        const sr = p.slot.r * v.scale;
        if (sr < 95 || !p.wedges.length) continue;
        const c = v.toScreen(p.x, p.y);
        const n = p.wedges.length;
        const fs = Math.round(Math.min(17, Math.max(12, sr / 11)) * (v.compact ? 0.9 : 1));
        const rhoL = n === 1 ? 0.58 : 0.62;
        const outs: { t: Text; am: number; side: number; y: number; col: number }[] = [];
        const ranked = p.wedges.map((w, i) => ({ w, i })).sort((a, b) => b.w.share - a.w.share);
        for (const { w, i } of ranked) {
          const key = p.id + ':' + w.id;
          let t = units.get(key);
          if (!t) {
            t = makeText(FONT_UI, fs, '700', 0xffffff);
            units.set(key, t);
            container.addChild(t);
          }
          used.add(key);
          const col = hexColor(w.color);
          set(t, (p.leader && p.leader.id === w.id ? '◆ ' : '') + w.name, fs, 0xffffff, col);
          t.alpha = w.fog >= 0.5 ? 0.8 : 1;
          let am: number;
          let aw: number;
          if (n === 1) {
            am = -Math.PI / 2;
            aw = Math.PI * 2;
          } else {
            const [a0, a1] = p.rangeAt(i, rhoL);
            am = (a0 + a1) / 2;
            aw = a1 - a0;
          }
          if (aw >= MIN_INSIDE && aw * rhoL * sr > t.width * 0.85 + 12) {
            t.anchor.set(0.5);
            if (place(t, c.x + Math.cos(am) * rhoL * sr, c.y + Math.sin(am) * rhoL * sr, placed)) continue;
          }
          if (w.share < 0.004) continue;
          outs.push({ t, am, side: Math.cos(am) >= 0 ? 1 : -1, y: c.y + Math.sin(am) * sr * 1.2, col });
        }
        const gap = fs + 4;
        for (const side of [1, -1]) {
          const list = outs.filter((o) => o.side === side).sort((a, b) => a.y - b.y);
          for (let i = 1; i < list.length; i++) if (list[i].y - list[i - 1].y < gap) list[i].y = list[i - 1].y + gap;
          for (const o of list) {
            const ax = c.x + Math.cos(o.am) * sr * 0.9;
            const ay = c.y + Math.sin(o.am) * sr * 0.9;
            const ex = c.x + Math.cos(o.am) * sr * 1.18;
            const tx = ex + side * 18;
            o.t.anchor.set(side > 0 ? 0 : 1, 0.5);
            if (!place(o.t, tx + side * 4, o.y, placed)) continue;
            lines.moveTo(ax, ay).lineTo(ex, o.y).lineTo(tx, o.y).stroke({ width: 1, color: o.col, alpha: 0.85 });
            lines.circle(ax, ay, 2).fill({ color: o.col, alpha: 0.9 });
          }
        }
      }
      for (const [key, t] of units) {
        if (used.has(key)) continue;
        t.destroy();
        units.delete(key);
      }
    },
    refresh() {
      CanvasTextMetrics.clearMetrics();
      for (const t of all()) t.style.update();
    },
    destroy() {
      container.destroy({ children: true });
      titles.clear();
      units.clear();
    },
  };
}
