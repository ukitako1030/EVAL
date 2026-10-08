/**
 * A planet's decoration around its territories (mockup A `drawRing` / `drawCore` / rim light / halo):
 * tilted orbit ring split into a back half (behind the sphere) and a front half, travelling ring dashes,
 * a small moon, the hexagonal core and the rim light. Static strokes are rebuilt only when the size,
 * zoom or colours change; per frame only dashes, moon and core spin are touched (the travelling dashes are a
 * dynamic mesh refilled at the planet's geometry rate — nothing is allocated per frame).
 */
import { Container, Graphics, Sprite } from 'pixi.js';
import { CORE, TAU } from './layout';
import { HALO_SCALE, type PlanetTextures } from './planetTextures';
import { mixColor } from './color';
import { createDynMesh } from './dynMesh';
import { rgba, strokeSegment } from './meshBuild';

/** ring / orbit tilt (radians) */
export const TILT = -0.28;
const COS_T = Math.cos(TILT);
const SIN_T = Math.sin(TILT);
const CYAN = 0xaaf0ff;

export interface DecorState {
  R: number;
  /** world units per screen pixel */
  px: number;
  hub: boolean;
  /** atmosphere colour */
  atm: number;
  /** leader colour */
  lead: number;
}

export interface PlanetDecor {
  /** behind the sphere: ring back half, its dashes, the moon when behind, the halo */
  readonly back: Container;
  /** above everything: core, rim light, ring front half, dashes, the moon when in front */
  readonly front: Container;
  rebuild(s: DecorState): void;
  /** `redash`: redraw the travelling ring dashes this frame (they move slowly; the planet does it at its geometry rate) */
  update(time: number, ph: number, hover: number, reduced: boolean, redash: boolean): void;
  destroy(): void;
}

/** point on the tilted ring ellipse at parameter φ (written to `out`) */
function ringPoint(rx: number, ry: number, phi: number, out: { x: number; y: number }): void {
  const ex = Math.cos(phi) * rx;
  const ey = Math.sin(phi) * ry;
  out.x = ex * COS_T - ey * SIN_T;
  out.y = ex * SIN_T + ey * COS_T;
}

const pt = { x: 0, y: 0 };
const pt2 = { x: 0, y: 0 };

function ellipseArc(g: Graphics, rx: number, ry: number, from: number, to: number, steps: number) {
  for (let i = 0; i <= steps; i++) {
    ringPoint(rx, ry, from + ((to - from) * i) / steps, pt);
    if (i === 0) g.moveTo(pt.x, pt.y);
    else g.lineTo(pt.x, pt.y);
  }
}

export function createPlanetDecor(tex: PlanetTextures): PlanetDecor {
  const back = new Container({ label: 'decor-back' });
  const front = new Container({ label: 'decor-front' });

  const ringBack = new Graphics();
  ringBack.blendMode = 'add';
  const dashBack = createDynMesh({ label: 'ring-dashes-back', blendMode: 'add' });
  const moonBack = new Container();
  const halo = new Sprite({ texture: tex.halo, anchor: 0.5 });
  halo.blendMode = 'add';
  back.addChild(ringBack, dashBack.mesh, moonBack, halo);

  const core = new Container({ label: 'core' });
  const coreDisk = new Graphics();
  const coreGlow = new Sprite({ texture: tex.glow, anchor: 0.5 });
  coreGlow.blendMode = 'add';
  const coreRing = new Graphics();
  coreRing.blendMode = 'add';
  const coreDash = new Graphics();
  coreDash.blendMode = 'add';
  const coreHex = new Graphics();
  coreHex.blendMode = 'add';
  const coreDot = new Sprite({ texture: tex.glow, anchor: 0.5 });
  coreDot.blendMode = 'add';
  core.addChild(coreDisk, coreGlow, coreRing, coreDash, coreHex, coreDot);

  const rim = new Graphics();
  rim.blendMode = 'add';
  const rimSoft = new Graphics();
  rimSoft.blendMode = 'add';
  const ringFront = new Graphics();
  ringFront.blendMode = 'add';
  const dashFront = createDynMesh({ label: 'ring-dashes-front', blendMode: 'add' });
  const moonFront = new Container();
  front.addChild(core, rimSoft, rim, ringFront, dashFront.mesh, moonFront);

  const moonGlow = new Sprite({ texture: tex.glow, anchor: 0.5 });
  moonGlow.blendMode = 'add';
  const moonCore = new Sprite({ texture: tex.glow, anchor: 0.5 });
  moonCore.blendMode = 'add';
  moonFront.addChild(moonGlow, moonCore);

  let st: DecorState = { R: 1, px: 1, hub: false, atm: 0x3cc8ff, lead: 0x5a7bb0 };
  let rx = 1;
  let ry = 1;
  let dashPx = -1;

  function rebuild(s: DecorState) {
    st = s;
    dashPx = -1; // size or zoom changed: redraw the dashes on the next update
    const { R, px, hub } = s;
    rx = R * (hub ? 1.62 : 1.42);
    ry = rx * 0.22;

    // ring halves (drawn white, tinted with the atmosphere)
    for (const [g, from, to, a1, a2] of [
      [ringBack, Math.PI, TAU, 0.06, 0.25],
      [ringFront, 0, Math.PI, 0.06, 0.5],
    ] as const) {
      g.clear();
      ellipseArc(g, rx, ry, from, to, 40);
      g.stroke({ width: Math.max(px, R * 0.06), color: 0xffffff, alpha: a1 });
      ellipseArc(g, rx, ry, from, to, 40);
      g.stroke({ width: px, color: 0xffffff, alpha: a2 });
      if (hub) {
        ellipseArc(g, rx * 1.22, ry * 1.22, from, to, 48);
        g.stroke({ width: 2 * px, color: 0xffffff, alpha: a2 * 0.33 });
      }
      g.tint = s.atm;
    }

    halo.width = halo.height = 2 * HALO_SCALE * R;
    halo.tint = s.atm;

    // core
    const rc = R * CORE;
    coreDisk.clear().circle(0, 0, rc).fill({ color: 0x040915 });
    coreGlow.width = coreGlow.height = rc * 6.4;
    coreGlow.tint = s.lead;
    coreRing.clear().circle(0, 0, rc).stroke({ width: 1.6 * px, color: 0xffffff, alpha: 0.95 });
    coreRing.tint = s.lead;
    coreDash.clear();
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i * TAU) / n;
      coreDash.moveTo(Math.cos(a) * rc * 0.74, Math.sin(a) * rc * 0.74).arc(0, 0, rc * 0.74, a, a + (TAU / n) * 0.45);
    }
    coreDash.stroke({ width: px, color: 0xffffff, alpha: 0.5 });
    coreHex.clear();
    for (let i = 0; i <= 6; i++) {
      const a = (i * TAU) / 6;
      if (i === 0) coreHex.moveTo(Math.cos(a) * rc * 0.45, Math.sin(a) * rc * 0.45);
      else coreHex.lineTo(Math.cos(a) * rc * 0.45, Math.sin(a) * rc * 0.45);
    }
    coreHex.closePath().stroke({ width: 1.2 * px, color: 0xffffff, alpha: 0.9 });
    coreHex.tint = s.lead;
    coreDot.width = coreDot.height = rc;
    coreDot.alpha = 0.6;

    // rim light: bright cyan top-left fading into the atmosphere colour bottom-right
    rim.clear();
    const seg = 32;
    for (let i = 0; i < seg; i++) {
      const a0 = (i * TAU) / seg;
      const am = a0 + TAU / seg / 2;
      const p = (Math.cos(am) + Math.sin(am)) / Math.SQRT2; // −1 top-left … 1 bottom-right
      const color = p < 0 ? mixColor(CYAN, s.atm, p + 1) : s.atm;
      const alpha = p < 0 ? 0.95 + (0.4 - 0.95) * (p + 1) : 0.4 + (0.12 - 0.4) * p;
      rim.moveTo(Math.cos(a0) * R, Math.sin(a0) * R).arc(0, 0, R, a0, a0 + TAU / seg + 0.004);
      rim.stroke({ width: 1.8 * px, color, alpha });
    }
    rimSoft.clear().circle(0, 0, R).stroke({ width: 7 * px, color: 0xffffff, alpha: 1 });
    rimSoft.tint = s.atm;

    moonGlow.tint = s.atm;
    moonGlow.width = moonGlow.height = 2 * (8 * px + R * 0.03);
    moonCore.width = moonCore.height = 2 * (2.5 * px + R * 0.008);
  }

  const DASH_BACK = rgba(0xffffff, 0.18);
  const DASH_FRONT = rgba(0xffffff, 0.38);

  function dashes(time: number) {
    const { px } = st;
    dashBack.begin();
    dashFront.begin();
    const rxs = rx * 1.08;
    const rys = ry * 1.08;
    // dashes evenly spaced on the (3-D) ring, so they bunch up toward its far ends like real perspective
    const perim = (Math.PI * (rxs + rys)) / px;
    const n = Math.max(12, Math.round(perim / 11 / 2) * 2);
    const step = TAU / n;
    const len = step * 0.22;
    const off = (((-time * 18) / Math.max(1, perim)) * TAU) % step;
    for (let i = 0; i < n; i++) {
      const p0 = off + i * step;
      const s = Math.sin(p0 + len / 2);
      ringPoint(rxs, rys, p0, pt);
      ringPoint(rxs, rys, p0 + len, pt2);
      if (s < 0) strokeSegment(dashBack.buf, pt.x, pt.y, pt2.x, pt2.y, px, DASH_BACK);
      else strokeSegment(dashFront.buf, pt.x, pt.y, pt2.x, pt2.y, px, DASH_FRONT);
    }
    dashBack.end();
    dashFront.end();
  }

  return {
    back,
    front,
    rebuild,
    update(time, ph, hover, reduced, redash) {
      const t = reduced ? 0 : time;
      if (redash || dashPx !== st.px) {
        dashes(t);
        dashPx = st.px;
      }
      const m = t * (st.hub ? 0.35 : 0.5) + ph;
      const behind = Math.sin(m) < 0;
      ringPoint(rx * 1.08, ry * 1.08, m, pt);
      const host = behind ? moonBack : moonFront;
      if (moonGlow.parent !== host) host.addChild(moonGlow, moonCore);
      moonGlow.position.set(pt.x, pt.y);
      moonCore.position.set(pt.x, pt.y);
      // brightness follows the orbit smoothly (no pop when the moon passes in front of the planet)
      const lit = 0.5 + 0.5 * Math.sin(m);
      moonGlow.alpha = 0.4 + 0.5 * lit;
      moonCore.alpha = 0.5 + 0.5 * lit;
      coreGlow.alpha = 0.5 + 0.15 * Math.sin(t * 3 + ph);
      coreDash.rotation = t * 0.5;
      coreHex.rotation = t * 0.6;
      halo.alpha = 0.8 + 0.2 * hover;
      rimSoft.alpha = 0.07 + 0.08 * hover;
    },
    destroy() {
      dashBack.destroy();
      dashFront.destroy();
      back.destroy({ children: true });
      front.destroy({ children: true });
    },
  };
}
