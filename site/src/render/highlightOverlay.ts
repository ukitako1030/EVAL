/**
 * The lit look of a highlighted org (mockup B hover): an additive tint over its territories on every planet and a
 * bright edge along them, drawn above the planets from the planets' own wedge maths (`rangeAt`, wobble included).
 * Geometry is redrawn at ≈ 20 Hz (every frame while a transition runs); the pulse is a per-frame alpha.
 */
import { Container, Graphics } from 'pixi.js';
import type { Galaxy } from './galaxy';
import type { Planet } from './planet';
import { CORE } from './layout';
import { colorGain, hexColor, mixColor } from './color';

export interface HighlightOverlay {
  /**
   * `rise(org)`: 0..1 how lit an org is (0 = not at all); `pulse`: 0..1 extra brightness of this frame;
   * `moving`: a transition is running (redraw every frame).
   */
  update(dt: number, rise: (org: string) => number, pulse: number, moving: boolean): void;
  destroy(): void;
}

const REDRAW_S = 1 / 20;
const NS = 14;
const FILL = 0.16;
const EDGE = 0.8;

export function createHighlightOverlay(galaxy: Galaxy, planets: readonly Planet[]): HighlightOverlay {
  const root = new Container({ label: 'org-highlight' });
  root.eventMode = 'none';
  const gfx = planets.map(() => {
    const g = new Graphics();
    g.blendMode = 'add';
    root.addChild(g);
    return g;
  });
  // under the fleets, above the planets
  galaxy.layers.front.addChildAt(root, 0);
  let acc = REDRAW_S;
  let lit = false;

  function draw(g: Graphics, p: Planet, rise: (org: string) => number, px: number): boolean {
    g.clear();
    const n = p.wedges.length;
    const R = p.slot.r;
    let any = false;
    for (let k = 0; k < n; k++) {
      const w = p.wedges[k];
      const r = rise(w.org);
      if (r < 0.004) continue;
      any = true;
      const col = hexColor(w.color);
      const fill = { color: col, alpha: FILL * colorGain(col) * r * w.presence };
      const edge = { width: 1.5 * px, color: mixColor(col, 0xffffff, 0.55), alpha: EDGE * r * w.presence, join: 'round' as const };
      if (n === 1) {
        g.circle(0, 0, R * 0.995).fill(fill).stroke(edge);
        continue;
      }
      // the wedge outline: border k out to the rim, along the rim, border k+1 back in, along the core
      const pts: number[] = [];
      const ring = (rho: number, a0: number, a1: number) => {
        const m = Math.max(1, Math.ceil(Math.abs(a1 - a0) * 8));
        for (let j = 1; j < m; j++) {
          const a = a0 + ((a1 - a0) * j) / m;
          pts.push(Math.cos(a) * rho * R, Math.sin(a) * rho * R);
        }
      };
      const side = (end: 0 | 1, rho: number) => {
        const a = p.rangeAt(k, rho)[end];
        pts.push(Math.cos(a) * rho * R, Math.sin(a) * rho * R);
      };
      for (let i = 0; i <= NS; i++) side(0, CORE + ((1 - CORE) * i) / NS);
      const [o0, o1] = p.rangeAt(k, 1);
      ring(1, o0, o1);
      for (let i = NS; i >= 0; i--) side(1, CORE + ((1 - CORE) * i) / NS);
      const [c0, c1] = p.rangeAt(k, CORE);
      ring(CORE, c1, c0);
      g.poly(pts).fill(fill).stroke(edge);
    }
    return any;
  }

  return {
    update(dt, rise, pulse, moving) {
      acc += dt;
      if (acc >= REDRAW_S || moving) {
        acc = 0;
        const px = 1 / (galaxy.root.parent?.scale.x || 1);
        lit = false;
        for (let i = 0; i < planets.length; i++) lit = draw(gfx[i], planets[i], rise, px) || lit;
      }
      root.visible = lit;
      if (!lit) return;
      for (let i = 0; i < planets.length; i++) gfx[i].position.set(planets[i].x, planets[i].y);
      root.alpha = 0.8 + 0.2 * Math.min(1, Math.max(0, pulse));
    },
    destroy() {
      root.destroy({ children: true });
    },
  };
}
