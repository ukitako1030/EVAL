/**
 * Swarm labels for the zoomed battle (mockup C `drawSwarmLabels`, laid out like mockup A's territory names), in
 * screen space so they stay crisp (the un-bloomed fx layer): `#rank name` over the strength / scale numbers.
 * Big swarms are labelled on their centroid; the rest stack in columns beside the planet with a leader line from
 * a ring marker on their centroid. Labels that would collide or leave the screen are skipped; positions glide
 * as the swarms move. Fogged units are dimmer. Text comes from data and is rendered as plain text.
 */
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Lang } from '../data/types';
import { STRINGS } from '../i18n/strings';
import { CORE } from './layout';
import { FONT_UI } from './labels';
import { mixColor } from './color';

export interface SwarmLabel {
  id: string;
  name: string;
  rank: number;
  s: number;
  c: number;
  color: number;
  fog: number;
  /** normalised centroid (planet-local, radius 1) */
  x: number;
  y: number;
  /** normalised point in the middle of the unit's territory: orders the outside label columns (stable while swarms move) */
  hx: number;
  hy: number;
  /** 0..1 share of the planet's territory */
  share: number;
}

export interface LabelFrame {
  lang: Lang;
  /** planet centre on screen and its radius in screen px */
  cx: number;
  cy: number;
  sr: number;
  /** 0..1 opacity */
  alpha: number;
  compact: boolean;
  selected: string | null;
  hovered: string | null;
  screen: { w: number; h: number };
  dt: number;
}

export interface BattleLabels {
  readonly container: Container;
  update(items: readonly SwarmLabel[], f: LabelFrame): void;
  /** re-render text (fonts loaded) */
  refresh(): void;
  clear(): void;
  destroy(): void;
}

interface Item {
  name: Text;
  nums: Text;
  /** smoothed block top-left (screen px) */
  x: number;
  y: number;
  init: boolean;
  inside: boolean;
  side: number;
  numsKey: string;
  numsAge: number;
  seen: boolean;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Out {
  it: Item;
  l: SwarmLabel;
  w: number;
  h: number;
  y: number;
}

const DARK = 0x00030c;
const NUM_REFRESH = 0.12; // s between number re-renders while values move (playback)
const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function text(size: number, weight: '500' | '700'): Text {
  const t = new Text({
    text: '',
    style: new TextStyle({ fontFamily: FONT_UI, fontSize: size, fontWeight: weight, fill: 0xffffff, letterSpacing: 0.5, stroke: { color: DARK, width: 3, join: 'round' }, padding: 4 }),
  });
  t.anchor.set(0, 0);
  return t;
}

export function createBattleLabels(): BattleLabels {
  const container = new Container({ label: 'battle-labels' });
  container.eventMode = 'none';
  const lines = new Graphics();
  container.addChild(lines);
  const items = new Map<string, Item>();
  const placed: Rect[] = [];
  const outs: Out[] = [];
  const order: SwarmLabel[] = [];

  function setText(it: Item, l: SwarmLabel, f: LabelFrame, fsN: number, fsV: number) {
    const sel = f.selected === l.id || f.hovered === l.id;
    const name = `#${l.rank} ${l.name}`;
    if (it.name.text !== name) it.name.text = name;
    if (it.name.style.fontSize !== fsN) it.name.style.fontSize = fsN;
    const fill = mixColor(l.color, 0xffffff, sel ? 0.6 : 0.25);
    if (it.name.style.fill !== fill) it.name.style.fill = fill;
    const words = f.lang === 'ja' ? (f.compact ? ['強', '規'] : [STRINGS.strength.ja, STRINGS.scale.ja]) : f.compact ? ['S', 'C'] : ['STR', 'SCALE'];
    const nums = f.compact ? `${words[0]}${l.s.toFixed(0)} ${words[1]}${l.c.toFixed(0)}` : `${words[0]} ${l.s.toFixed(1)}  ${words[1]} ${l.c.toFixed(1)}`;
    it.numsAge += f.dt;
    if (nums !== it.numsKey && (it.numsAge >= NUM_REFRESH || it.nums.text === '')) {
      it.numsKey = nums;
      it.numsAge = 0;
      it.nums.text = nums;
    }
    if (it.nums.style.fontSize !== fsV) it.nums.style.fontSize = fsV;
    const nf = sel ? 0xeaf6ff : 0xc8dcef;
    if (it.nums.style.fill !== nf) it.nums.style.fill = nf;
  }

  /** place the text block with its top-left at (x, y), gliding there */
  function put(it: Item, x: number, y: number, k: number, compact: boolean, fsN: number, a: number) {
    if (!it.init) {
      it.x = x;
      it.y = y;
      it.init = true;
    } else {
      it.x += (x - it.x) * k;
      it.y += (y - it.y) * k;
    }
    it.name.position.set(Math.round(it.x), Math.round(it.y));
    if (compact) it.nums.position.set(Math.round(it.x + it.name.width + 5), Math.round(it.y + 1));
    else it.nums.position.set(Math.round(it.x), Math.round(it.y + fsN + 1));
    it.name.alpha = it.nums.alpha = a;
    it.name.visible = it.nums.visible = true;
  }

  return {
    container,
    update(list, f) {
      lines.clear();
      container.alpha = f.alpha;
      for (const it of items.values()) {
        it.seen = false;
        it.name.visible = it.nums.visible = false;
      }
      if (f.alpha <= 0.01) return;
      const k = 1 - Math.exp(-f.dt * 6);
      const fsN = f.compact ? 12 : 15;
      const fsV = f.compact ? 10 : 11;
      const sr = Math.max(1, f.sr);
      placed.length = 0;
      outs.length = 0;
      order.length = 0;
      for (const l of list) order.push(l);
      order.sort((a, b) => b.share - a.share);
      // the planet core stays clear
      placed.push({ x0: f.cx - sr * CORE * 1.15, y0: f.cy - sr * CORE * 1.15, x1: f.cx + sr * CORE * 1.15, y1: f.cy + sr * CORE * 1.15 });

      for (const l of order) {
        let it = items.get(l.id);
        if (!it) {
          it = { name: text(fsN, '700'), nums: text(fsV, '500'), x: 0, y: 0, init: false, inside: false, side: l.hx >= 0 ? 1 : -1, numsKey: '', numsAge: 1, seen: true };
          container.addChild(it.name, it.nums);
          items.set(l.id, it);
        }
        it.seen = true;
        setText(it, l, f, fsN, fsV);
        const w = f.compact ? it.name.width + 5 + it.nums.width : Math.max(it.name.width, it.nums.width);
        const h = f.compact ? fsN + 4 : fsN + fsV + 5;
        // inside: on the centroid (or further out along its direction, clear of the core), when the territory
        // is big enough (with hysteresis) and the block fits in the disc
        const big = l.share >= (it.inside ? 0.06 : 0.08);
        const rc = Math.hypot(l.x, l.y);
        let done = false;
        for (let c = 0; big && c < 3 && !done; c++) {
          const rho = c === 0 ? rc : Math.max(rc, c === 1 ? 0.55 : 0.7);
          const ux = rc > 0.05 ? l.x / rc : 0.6;
          const uy = rc > 0.05 ? l.y / rc : -0.8;
          const bx = f.cx + ux * rho * sr;
          const by = f.cy + uy * rho * sr;
          const r: Rect = { x0: bx - w / 2 - 3, y0: by - h / 2 - 2, x1: bx + w / 2 + 3, y1: by + h / 2 + 2 };
          const ax = Math.max(Math.abs(r.x0 - f.cx), Math.abs(r.x1 - f.cx));
          const ay = Math.max(Math.abs(r.y0 - f.cy), Math.abs(r.y1 - f.cy));
          if (ax * ax + ay * ay >= (sr * 0.94) ** 2 || placed.some((p) => hit(p, r))) continue; // the farthest corner must be inside
          it.inside = true;
          placed.push(r);
          put(it, bx - w / 2, by - h / 2, k, f.compact, fsN, l.fog >= 0.5 ? 0.75 : 1);
          done = true;
        }
        if (done) continue;
        it.inside = false;
        outs.push({ it, l, w, h, y: f.cy + l.hy * sr });
      }

      // outside: classic pie labels — a column on each side, elbows riding a circle just outside the planet
      const R1 = sr * 1.06;
      const leg = f.compact ? 10 : 18;
      for (const side of [1, -1]) {
        const col = outs.filter((o) => {
          // keep a label on its side unless its territory clearly crossed over (no flip-flopping)
          if (o.l.hx * o.it.side < -0.12) o.it.side = o.l.hx >= 0 ? 1 : -1;
          return o.it.side === side;
        });
        col.sort((a, b) => a.y - b.y);
        const gap = col.length ? Math.max(...col.map((o) => o.h)) + 3 : 0;
        for (let i = 1; i < col.length; i++) if (col[i].y - col[i - 1].y < gap) col[i].y = col[i - 1].y + gap;
        // keep the column on screen: shift it up if it runs off the bottom
        const bottom = f.screen.h - 8;
        const last = col[col.length - 1];
        if (last && last.y + last.h / 2 > bottom) {
          const d = last.y + last.h / 2 - bottom;
          for (const o of col) o.y -= d;
        }
        for (const o of col) {
          const { it, l, w, h } = o;
          const dy = clampAbs(o.y - f.cy, R1 * 0.98);
          const ex = f.cx + side * Math.sqrt(Math.max(0, R1 * R1 - dy * dy));
          const tx = side > 0 ? ex + leg + 4 : ex - leg - 4 - w;
          const left = Math.min(Math.max(6, tx), f.screen.w - 6 - w);
          const r: Rect = { x0: left - 2, y0: o.y - h / 2 - 1, x1: left + w + 2, y1: o.y + h / 2 + 1 };
          if (placed.some((p) => hit(p, r)) || r.y0 < 4) continue;
          placed.push(r);
          const a = l.fog >= 0.5 ? 0.75 : 1;
          put(it, left, o.y - h / 2, k, f.compact, fsN, a);
          const x0 = f.cx + l.x * sr;
          const y0 = f.cy + l.y * sr;
          const lc = mixColor(l.color, 0xffffff, 0.3);
          const sel = f.selected === l.id;
          const mr = sel ? 5 : f.compact ? 2.5 : 3.5;
          const ly = it.y + h / 2;
          const vx = ex - x0;
          const vy = ly - y0;
          const vl = Math.hypot(vx, vy) + 1e-6;
          lines.circle(x0, y0, mr).stroke({ width: sel ? 1.6 : 1, color: lc, alpha: 0.85 * a });
          lines
            .moveTo(x0 + (vx / vl) * mr, y0 + (vy / vl) * mr)
            .lineTo(ex, ly)
            .lineTo(ex + side * leg, ly)
            .stroke({ width: 1, color: lc, alpha: 0.75 * a });
        }
      }
      for (const [id, it] of items) {
        if (it.seen) continue;
        it.name.destroy();
        it.nums.destroy();
        items.delete(id);
      }
    },
    refresh() {
      for (const it of items.values()) {
        it.name.style.update();
        it.nums.style.update();
      }
    },
    clear() {
      for (const it of items.values()) {
        it.name.destroy();
        it.nums.destroy();
      }
      items.clear();
      lines.clear();
    },
    destroy() {
      items.clear();
      container.destroy({ children: true });
    },
  };
}

function clampAbs(v: number, m: number): number {
  return v > m ? m : v < -m ? -m : v;
}
