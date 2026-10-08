/**
 * Offscreen-canvas textures shared by every planet (ported from the gradients mockups/a-galaxy.html
 * draws per frame): sphere body, core darkening, sphere shading, specular highlight, atmosphere halo,
 * surface grid, fog puff and spark streak. All white / greyscale where they are meant to be tinted.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { CORE } from './layout';
import { glowTexture, mulberry32 } from './bgTextures';

const TAU = Math.PI * 2;

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return [c, g];
}

const tex = (c: HTMLCanvasElement) => new Texture({ source: new CanvasSource({ resource: c, resolution: 1 }) });

/** A disc of radius S/2 (1 px inset so the edge stays anti-aliased) filled by `paint`, everything outside cleared. */
function disc(S: number, paint: (g: CanvasRenderingContext2D, R: number, C: number) => void): Texture {
  const [c, g] = canvas(S);
  const C = S / 2;
  const R = C - 1;
  g.save();
  g.beginPath();
  g.arc(C, C, R, 0, TAU);
  g.clip();
  paint(g, R, C);
  g.restore();
  return tex(c);
}

export interface PlanetTextures {
  /** dark sphere (#0c1838 → #03050f), lit from the top-left */
  body: Texture;
  /** body-coloured veil, opaque at the core and clear at the rim: turns flat territory fills into the mockup's radial gradient */
  coreDark: Texture;
  /** sphere shading: clear at the lit side, dark toward the rim */
  shade: Texture;
  /** additive specular spot, top-left */
  highlight: Texture;
  /** white atmosphere halo out to 1.55 R (texture radius = 1.55 R), tint with the atmosphere colour */
  halo: Texture;
  /** additive surface: dot grid, latitude rings and spokes */
  surface: Texture;
  /** soft fog puff */
  cloud: Texture;
  /** spark streak, bright head at the right edge (anchor 1, 0.5) */
  streak: Texture;
  /** soft round glow */
  glow: Texture;
  destroy(): void;
}

export const HALO_SCALE = 1.55;

export function createPlanetTextures(): PlanetTextures {
  const body = disc(256, (g, R, C) => {
    const gr = g.createRadialGradient(C - R * 0.3, C - R * 0.35, R * 0.1, C, C, R);
    gr.addColorStop(0, '#0c1838');
    gr.addColorStop(1, '#03050f');
    g.fillStyle = gr;
    g.fillRect(0, 0, 2 * C, 2 * C);
  });

  // effective territory alpha (mockup): ≈ 27 % of the rim value at the core, 50 % at 0.6 R, 100 % at the rim
  const coreDark = disc(256, (g, R, C) => {
    const gr = g.createRadialGradient(C, C, 0, C, C, R);
    gr.addColorStop(0, 'rgba(6,12,32,0.8)');
    gr.addColorStop(CORE, 'rgba(6,12,32,0.64)');
    gr.addColorStop(0.6, 'rgba(6,12,32,0.38)');
    gr.addColorStop(0.86, 'rgba(6,12,32,0.12)');
    gr.addColorStop(1, 'rgba(6,12,32,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 2 * C, 2 * C);
  });

  const shade = disc(256, (g, R, C) => {
    const gr = g.createRadialGradient(C - R * 0.32, C - R * 0.36, R * 0.15, C, C, R * 1.05);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.62, 'rgba(1,3,12,0.12)');
    gr.addColorStop(1, 'rgba(1,3,14,0.75)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 2 * C, 2 * C);
  });

  const highlight = disc(256, (g, R, C) => {
    const x = C - R * 0.42;
    const y = C - R * 0.46;
    const gr = g.createRadialGradient(x, y, 0, x, y, R * 0.75);
    gr.addColorStop(0, 'rgba(190,235,255,0.15)');
    gr.addColorStop(1, 'rgba(190,235,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 2 * C, 2 * C);
  });

  const halo = (() => {
    const S = 256;
    const [c, g] = canvas(S);
    const C = S / 2;
    const i0 = 0.92 / HALO_SCALE;
    const gr = g.createRadialGradient(C, C, 0, C, C, C);
    // 25 % stronger than the mockup: the sprite runs at alpha 0.8 and goes to 1 on hover
    gr.addColorStop(0, 'rgba(255,255,255,0.52)');
    gr.addColorStop(i0, 'rgba(255,255,255,0.52)');
    gr.addColorStop(i0 + (1 - i0) * 0.12, 'rgba(255,255,255,0.25)');
    gr.addColorStop(i0 + (1 - i0) * 0.45, 'rgba(255,255,255,0.06)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return tex(c);
  })();

  const surface = disc(512, (g, R, C) => {
    // dot grid (mockup: 6 px pitch on a ~150 px planet)
    const pitch = 10;
    g.fillStyle = 'rgba(170,235,255,0.2)';
    for (let y = C % pitch; y < 2 * C; y += pitch) for (let x = C % pitch; x < 2 * C; x += pitch) g.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    g.strokeStyle = 'rgba(150,225,255,0.11)';
    g.lineWidth = 1.6;
    g.beginPath();
    for (const lat of [0.5, 0.766, 0.94]) {
      g.moveTo(C + R * lat, C);
      g.arc(C, C, R * lat, 0, TAU);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12;
      g.moveTo(C + Math.cos(a) * R * CORE, C + Math.sin(a) * R * CORE);
      g.lineTo(C + Math.cos(a) * R, C + Math.sin(a) * R);
    }
    g.stroke();
  });

  const cloud = (() => {
    const S = 128;
    const [c, g] = canvas(S);
    const C = S / 2;
    const R = mulberry32(9071);
    for (let i = 0; i < 26; i++) {
      const a = R() * TAU;
      const d = Math.pow(R(), 0.7) * C * 0.42;
      const x = C + Math.cos(a) * d;
      const y = C + Math.sin(a) * d;
      const r = C * (0.22 + R() * 0.3);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const al = 0.1 + R() * 0.14;
      gr.addColorStop(0, `rgba(255,255,255,${al})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, S, S);
    }
    // fade the square out so tinted puffs never show an edge
    g.globalCompositeOperation = 'destination-in';
    const m = g.createRadialGradient(C, C, C * 0.35, C, C, C);
    m.addColorStop(0, 'rgba(0,0,0,1)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m;
    g.fillRect(0, 0, S, S);
    return tex(c);
  })();

  const streak = (() => {
    const [c, g] = canvas(32, 8);
    const gr = g.createLinearGradient(0, 0, 32, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.8, 'rgba(255,255,255,0.75)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.fillRect(0, 2.5, 32, 3);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(8, 1.5, 24, 1);
    g.fillRect(8, 5.5, 24, 1);
    return tex(c);
  })();

  const glow = glowTexture();
  const all = [body, coreDark, shade, highlight, halo, surface, cloud, streak, glow];
  return {
    body,
    coreDark,
    shade,
    highlight,
    halo,
    surface,
    cloud,
    streak,
    glow,
    destroy() {
      for (const t of all) t.destroy(true);
    },
  };
}
