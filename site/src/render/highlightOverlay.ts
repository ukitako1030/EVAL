/**
 * The lit look of a highlighted org (mockup B hover): an additive tint over its territories on every planet and a
 * bright edge along them, drawn above the planets from the planets' own wedge maths (frontlines, wobble included).
 * Geometry is redrawn at ≈ 20 Hz (every frame while a transition runs) into dynamic meshes; the pulse is a per-frame
 * alpha. Nothing is allocated per redraw.
 */
import { Container } from 'pixi.js';
import type { Galaxy } from './galaxy';
import type { Planet } from './planet';
import { CORE, TAU } from './layout';
import { colorGain, hexColor, mixColor } from './color';
import { createDynMesh, type DynMesh } from './dynMesh';
import { JOIN_ROUND, createPath, fillCircle, fillSector, pathPush, pathReset, rgba, strokeCircle, strokePath, type MeshBuf } from './meshBuild';

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
/** rim / core arcs: 8 segments per radian (the outline the overlay always used) */
const ARC_STEP = 1 / 8;

export function createHighlightOverlay(galaxy: Galaxy, planets: readonly Planet[]): HighlightOverlay {
  const root = new Container({ label: 'org-highlight' });
  root.eventMode = 'none';
  const gfx: DynMesh[] = planets.map(() => {
    const g = createDynMesh({ label: 'org-highlight-planet', blendMode: 'add' });
    root.addChild(g.mesh);
    return g;
  });
  // under the fleets, above the planets
  galaxy.layers.front.addChildAt(root, 0);
  let acc = REDRAW_S;
  let lit = false;
  const bs = new Float64Array(NS + 1);
  const be = new Float64Array(NS + 1);
  const outline = createPath(64);

  function ring(rho: number, R: number, a0: number, a1: number) {
    const m = Math.max(1, Math.ceil(Math.abs(a1 - a0) * 8));
    for (let j = 1; j < m; j++) {
      const a = a0 + ((a1 - a0) * j) / m;
      pathPush(outline, Math.cos(a) * rho * R, Math.sin(a) * rho * R);
    }
  }

  function draw(b: MeshBuf, p: Planet, rise: (org: string) => number, px: number): boolean {
    const n = p.wedges.length;
    const R = p.slot.r;
    let any = false;
    for (let k = 0; k < n; k++) {
      const w = p.wedges[k];
      const r = rise(w.org);
      if (r < 0.004) continue;
      any = true;
      const col = hexColor(w.color);
      const fill = rgba(col, FILL * colorGain(col) * r * w.presence);
      const edge = rgba(mixColor(col, 0xffffff, 0.55), EDGE * r * w.presence);
      if (n === 1) {
        fillCircle(b, 0, 0, R * 0.995, fill);
        strokeCircle(b, 0, 0, R * 0.995, 1.5 * px, edge);
        continue;
      }
      // the wedge: border k out to the rim, along the rim, border k+1 back in, along the core (planet.rangeAt)
      const wrap = k === n - 1 ? TAU : 0;
      for (let i = 0; i <= NS; i++) {
        const rho = CORE + ((1 - CORE) * i) / NS;
        bs[i] = p.borderAt(k, rho);
        be[i] = p.borderAt((k + 1) % n, rho);
      }
      fillSector(b, bs, be, wrap, NS, R, CORE, fill, ARC_STEP);
      pathReset(outline);
      for (let i = 0; i <= NS; i++) {
        const rho = CORE + ((1 - CORE) * i) / NS;
        pathPush(outline, Math.cos(bs[i]) * rho * R, Math.sin(bs[i]) * rho * R);
      }
      ring(1, R, bs[NS], be[NS] + wrap);
      for (let i = NS; i >= 0; i--) {
        const rho = CORE + ((1 - CORE) * i) / NS;
        pathPush(outline, Math.cos(be[i] + wrap) * rho * R, Math.sin(be[i] + wrap) * rho * R);
      }
      ring(CORE, R, be[0] + wrap, bs[0]);
      strokePath(b, outline, 1.5 * px, edge, true, JOIN_ROUND);
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
        for (let i = 0; i < planets.length; i++) {
          const g = gfx[i];
          g.begin();
          lit = draw(g.buf, planets[i], rise, px) || lit;
          g.end();
        }
      }
      if (root.visible !== lit) root.visible = lit;
      if (!lit) return;
      for (let i = 0; i < planets.length; i++) gfx[i].mesh.position.set(planets[i].x, planets[i].y);
      root.alpha = 0.8 + 0.2 * Math.min(1, Math.max(0, pulse));
    },
    destroy() {
      for (const g of gfx) g.destroy();
      root.destroy({ children: true });
    },
  };
}
