/**
 * Swarm labels for the zoomed battle (mockup C `drawSwarmLabels`, laid out like mockup A's territory names), in
 * screen space so they stay crisp (the un-bloomed fx layer): `#rank name` over the strength / scale numbers.
 * Big swarms are labelled on their centroid; the rest stack in columns beside the planet with a leader line from
 * a ring marker on their centroid. Labels that would collide or leave the screen are skipped; positions glide
 * as the swarms move. Fogged units are dimmer. Text comes from data and is rendered as plain text.
 *
 * Per frame nothing is allocated while the numbers stand still: strings are rebuilt only when their inputs change,
 * collision boxes and column lists are pooled, leader lines go into a dynamic mesh, and `visible` is written only
 * when it changes (toggling it makes PixiJS rebuild the whole scene's instruction list).
 */
import { Container, Text, TextStyle } from 'pixi.js';
import type { Lang } from '../data/types';
import { STRINGS } from '../i18n/strings';
import { CORE } from './layout';
import { FONT_UI } from './labels';
import { mixColor } from './color';
import { createDynMesh } from './dynMesh';
import { createPath, pathPush, pathReset, rgba, strokeCircle, strokePath } from './meshBuild';

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
  id: string;
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
  /** placed this frame */
  want: boolean;
  // inputs of the cached strings
  rank: number;
  src: string | null;
  nameStr: string;
  numS: number;
  numC: number;
  numLang: Lang | null;
  numCompact: boolean;
  numsStr: string;
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
const WORDS = {
  ja: [STRINGS.strength.ja, STRINGS.scale.ja],
  jaCompact: ['強', '規'],
  en: ['STR', 'SCALE'],
  enCompact: ['S', 'C'],
} as const;

function text(size: number, weight: '500' | '700'): Text {
  const t = new Text({
    text: '',
    style: new TextStyle({ fontFamily: FONT_UI, fontSize: size, fontWeight: weight, fill: 0xffffff, letterSpacing: 0.5, stroke: { color: DARK, width: 3, join: 'round' }, padding: 4 }),
  });
  t.anchor.set(0, 0);
  t.visible = false;
  return t;
}

export function createBattleLabels(): BattleLabels {
  const container = new Container({ label: 'battle-labels' });
  container.eventMode = 'none';
  const lines = createDynMesh({ label: 'battle-label-lines' });
  container.addChild(lines.mesh);
  const items = new Map<string, Item>();
  const list: Item[] = [];
  const order: SwarmLabel[] = [];
  const outs: Out[] = [];
  let nOut = 0;
  const col: number[] = [];
  let boxes = new Float64Array(4 * 32);
  let nb = 0;
  const path = createPath(4);

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

  function setText(it: Item, l: SwarmLabel, f: LabelFrame, fsN: number, fsV: number) {
    const sel = f.selected === l.id || f.hovered === l.id;
    if (it.rank !== l.rank || it.src !== l.name) {
      it.rank = l.rank;
      it.src = l.name;
      it.nameStr = `#${l.rank} ${l.name}`;
    }
    if (it.name.text !== it.nameStr) it.name.text = it.nameStr;
    if (it.name.style.fontSize !== fsN) it.name.style.fontSize = fsN;
    const fill = mixColor(l.color, 0xffffff, sel ? 0.6 : 0.25);
    if (it.name.style.fill !== fill) it.name.style.fill = fill;
    if (it.numS !== l.s || it.numC !== l.c || it.numLang !== f.lang || it.numCompact !== f.compact) {
      it.numS = l.s;
      it.numC = l.c;
      it.numLang = f.lang;
      it.numCompact = f.compact;
      const words = f.lang === 'ja' ? (f.compact ? WORDS.jaCompact : WORDS.ja) : f.compact ? WORDS.enCompact : WORDS.en;
      it.numsStr = f.compact ? `${words[0]}${l.s.toFixed(0)} ${words[1]}${l.c.toFixed(0)}` : `${words[0]} ${l.s.toFixed(1)}  ${words[1]} ${l.c.toFixed(1)}`;
    }
    const nums = it.numsStr;
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
    it.want = true;
  }

  function show() {
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it.name.visible !== it.want) it.name.visible = it.want;
      if (it.nums.visible !== it.want) it.nums.visible = it.want;
    }
  }

  function dropItem(i: number) {
    const it = list[i];
    it.name.destroy();
    it.nums.destroy();
    items.delete(it.id);
    list[i] = list[list.length - 1];
    list.pop();
  }

  return {
    container,
    update(input, f) {
      lines.begin();
      container.alpha = f.alpha;
      for (let i = 0; i < list.length; i++) {
        list[i].seen = false;
        list[i].want = false;
      }
      if (f.alpha <= 0.01) {
        lines.end();
        show();
        return;
      }
      const k = 1 - Math.exp(-f.dt * 6);
      const fsN = f.compact ? 12 : 15;
      const fsV = f.compact ? 10 : 11;
      const sr = Math.max(1, f.sr);
      nb = 0;
      nOut = 0;
      // largest share first (stable insertion sort: Array.sort would allocate)
      order.length = 0;
      for (let i = 0; i < input.length; i++) {
        const l = input[i];
        let j = order.length;
        order.push(l);
        while (j > 0 && order[j - 1].share < l.share) {
          order[j] = order[j - 1];
          j--;
        }
        order[j] = l;
      }
      // the planet core stays clear
      pushBox(f.cx - sr * CORE * 1.15, f.cy - sr * CORE * 1.15, f.cx + sr * CORE * 1.15, f.cy + sr * CORE * 1.15);

      for (let oi = 0; oi < order.length; oi++) {
        const l = order[oi];
        let it = items.get(l.id);
        if (!it) {
          it = {
            id: l.id,
            name: text(fsN, '700'),
            nums: text(fsV, '500'),
            x: 0,
            y: 0,
            init: false,
            inside: false,
            side: l.hx >= 0 ? 1 : -1,
            numsKey: '',
            numsAge: 1,
            seen: true,
            want: false,
            rank: -1,
            src: null,
            nameStr: '',
            numS: Number.NaN,
            numC: Number.NaN,
            numLang: null,
            numCompact: false,
            numsStr: '',
          };
          container.addChild(it.name, it.nums);
          items.set(l.id, it);
          list.push(it);
        }
        it.seen = true;
        setText(it, l, f, fsN, fsV);
        const w = f.compact ? it.name.width + 5 + it.nums.width : Math.max(it.name.width, it.nums.width);
        const h = f.compact ? fsN + 4 : fsN + fsV + 5;
        // inside: on the centroid (or further out along its direction, clear of the core), when the territory
        // is big enough (with hysteresis) and the block fits in the disc
        const big = l.share >= (it.inside ? 0.06 : 0.08);
        const rc = Math.sqrt(l.x * l.x + l.y * l.y);
        let done = false;
        for (let c = 0; big && c < 3 && !done; c++) {
          const rho = c === 0 ? rc : Math.max(rc, c === 1 ? 0.55 : 0.7);
          const ux = rc > 0.05 ? l.x / rc : 0.6;
          const uy = rc > 0.05 ? l.y / rc : -0.8;
          const bx = f.cx + ux * rho * sr;
          const by = f.cy + uy * rho * sr;
          const x0 = bx - w / 2 - 3;
          const y0 = by - h / 2 - 2;
          const x1 = bx + w / 2 + 3;
          const y1 = by + h / 2 + 2;
          const ax = Math.max(Math.abs(x0 - f.cx), Math.abs(x1 - f.cx));
          const ay = Math.max(Math.abs(y0 - f.cy), Math.abs(y1 - f.cy));
          if (ax * ax + ay * ay >= (sr * 0.94) ** 2 || hitsBox(x0, y0, x1, y1)) continue; // the farthest corner must be inside
          it.inside = true;
          pushBox(x0, y0, x1, y1);
          put(it, bx - w / 2, by - h / 2, k, f.compact, fsN, l.fog >= 0.5 ? 0.75 : 1);
          done = true;
        }
        if (done) continue;
        it.inside = false;
        const o = (outs[nOut++] ??= { it, l, w: 0, h: 0, y: 0 });
        o.it = it;
        o.l = l;
        o.w = w;
        o.h = h;
        o.y = f.cy + l.hy * sr;
      }

      // outside: classic pie labels — a column on each side, elbows riding a circle just outside the planet
      const R1 = sr * 1.06;
      const leg = f.compact ? 10 : 18;
      for (let side = 1; side >= -1; side -= 2) {
        col.length = 0;
        let gap = 0;
        for (let q = 0; q < nOut; q++) {
          const o = outs[q];
          // keep a label on its side unless its territory clearly crossed over (no flip-flopping)
          if (o.l.hx * o.it.side < -0.12) o.it.side = o.l.hx >= 0 ? 1 : -1;
          if (o.it.side !== side) continue;
          let j = col.length;
          col.push(q);
          while (j > 0 && outs[col[j - 1]].y > o.y) {
            col[j] = col[j - 1];
            j--;
          }
          col[j] = q;
          gap = Math.max(gap, o.h + 3);
        }
        for (let i = 1; i < col.length; i++) if (outs[col[i]].y - outs[col[i - 1]].y < gap) outs[col[i]].y = outs[col[i - 1]].y + gap;
        // keep the column on screen: shift it up if it runs off the bottom
        const bottom = f.screen.h - 8;
        if (col.length) {
          const last = outs[col[col.length - 1]];
          if (last.y + last.h / 2 > bottom) {
            const d = last.y + last.h / 2 - bottom;
            for (let i = 0; i < col.length; i++) outs[col[i]].y -= d;
          }
        }
        for (let i = 0; i < col.length; i++) {
          const o = outs[col[i]];
          const { it, l, w, h } = o;
          const dy = clampAbs(o.y - f.cy, R1 * 0.98);
          const ex = f.cx + side * Math.sqrt(Math.max(0, R1 * R1 - dy * dy));
          const tx = side > 0 ? ex + leg + 4 : ex - leg - 4 - w;
          const left = Math.min(Math.max(6, tx), f.screen.w - 6 - w);
          const y0 = o.y - h / 2 - 1;
          if (hitsBox(left - 2, y0, left + w + 2, o.y + h / 2 + 1) || y0 < 4) continue;
          pushBox(left - 2, y0, left + w + 2, o.y + h / 2 + 1);
          const a = l.fog >= 0.5 ? 0.75 : 1;
          put(it, left, o.y - h / 2, k, f.compact, fsN, a);
          const x0 = f.cx + l.x * sr;
          const yc = f.cy + l.y * sr;
          const lc = mixColor(l.color, 0xffffff, 0.3);
          const sel = f.selected === l.id;
          const mr = sel ? 5 : f.compact ? 2.5 : 3.5;
          const ly = it.y + h / 2;
          const vx = ex - x0;
          const vy = ly - yc;
          const vl = Math.sqrt(vx * vx + vy * vy) + 1e-6;
          strokeCircle(lines.buf, x0, yc, mr, sel ? 1.6 : 1, rgba(lc, 0.85 * a));
          pathReset(path);
          pathPush(path, x0 + (vx / vl) * mr, yc + (vy / vl) * mr);
          pathPush(path, ex, ly);
          pathPush(path, ex + side * leg, ly);
          strokePath(lines.buf, path, 1, rgba(lc, 0.75 * a));
        }
      }
      lines.end();
      for (let i = list.length - 1; i >= 0; i--) if (!list[i].seen) dropItem(i);
      show();
    },
    refresh() {
      for (const it of list) {
        it.name.style.update();
        it.nums.style.update();
      }
    },
    clear() {
      for (let i = list.length - 1; i >= 0; i--) dropItem(i);
      lines.begin();
      lines.end();
    },
    destroy() {
      items.clear();
      list.length = 0;
      lines.destroy();
      container.destroy({ children: true });
    },
  };
}

function clampAbs(v: number, m: number): number {
  return v > m ? m : v < -m ? -m : v;
}
