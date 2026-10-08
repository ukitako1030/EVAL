/**
 * Offscreen-canvas textures for the background (ported from mockups/a-galaxy.html §5).
 * Everything here is generated procedurally and deterministically (seeded RNG).
 */
import { CanvasSource, Texture } from 'pixi.js';

const TAU = Math.PI * 2;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return [c, g];
}

function toTexture(c: HTMLCanvasElement, resolution = 1): Texture {
  return new Texture({ source: new CanvasSource({ resource: c, resolution }) });
}

/**
 * A canvas-backed texture that is redrawn in place (same texture, same GPU source) when the screen
 * size changes — destroying a batched texture makes PixiJS warn about stale bind groups.
 */
export interface RedrawableTexture {
  readonly texture: Texture;
  /** resize to w × h (texture units) at `resolution`, clear, draw with an identity transform in canvas pixels */
  redraw(w: number, h: number, resolution: number, draw: (g: CanvasRenderingContext2D, pw: number, ph: number) => void): void;
  destroy(): void;
}

export function redrawableTexture(): RedrawableTexture {
  const [c] = canvas(1, 1);
  const source = new CanvasSource({ resource: c, resolution: 1 });
  const texture = new Texture({ source });
  return {
    texture,
    redraw(w, h, resolution, draw) {
      source.resize(Math.max(1, w), Math.max(1, h), resolution);
      const g = source.context2D as CanvasRenderingContext2D;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, c.width, c.height);
      draw(g, c.width, c.height);
      source.update();
    },
    destroy() {
      texture.destroy(true);
    },
  };
}

/** Nebula canvas size for a screen: 1/2.5 of it (drawn stretched). */
export function nebulaSize(screenW: number, screenH: number): { w: number; h: number } {
  return { w: Math.max(64, Math.ceil(screenW / 2.5)), h: Math.max(64, Math.ceil(screenH / 2.5)) };
}

/** Soft violet / cyan / magenta nebula blobs on near-black. */
export function drawNebula(g: CanvasRenderingContext2D, w: number, h: number): void {
  const R = mulberry32(20260);
  g.fillStyle = '#02030a';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  const cols = ['88,40,200', '24,110,210', '190,40,170', '20,160,190', '60,50,170', '140,30,120'];
  const M = Math.max(w, h);
  for (let i = 0; i < 24; i++) {
    const x = R() * w;
    const y = R() * h;
    const r = (0.1 + R() * 0.42) * M;
    const col = cols[i % cols.length];
    const a = 0.05 + R() * 0.14;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${col},${a})`);
    gr.addColorStop(0.5, `rgba(${col},${a * 0.4})`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  // dark dust lanes
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 12; i++) {
    const x = R() * w;
    const y = R() * h;
    const r = (0.05 + R() * 0.18) * M;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(0,0,6,0.38)');
    gr.addColorStop(1, 'rgba(0,0,6,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
}

/** Thin cyan hex grid over the whole screen (W × H CSS px at `resolution`), faded towards the centre. */
export function drawHex(g: CanvasRenderingContext2D, W: number, H: number, resolution: number): void {
  g.setTransform(resolution, 0, 0, resolution, 0, 0);
  const s = 22;
  const hw = Math.sqrt(3) * s;
  const rows = Math.ceil(H / (1.5 * s)) + 2;
  const cols = Math.ceil(W / hw) + 2;
  g.strokeStyle = 'rgba(110,210,255,1)';
  g.lineWidth = 0.6;
  g.beginPath();
  for (let r = -1; r < rows; r++) {
    for (let col = -1; col < cols; col++) {
      const x = col * hw + (r & 1 ? hw / 2 : 0);
      const y = r * 1.5 * s;
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        const px = x + Math.cos(a) * s;
        const py = y + Math.sin(a) * s;
        if (k) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.closePath();
    }
  }
  g.stroke();
  g.globalCompositeOperation = 'destination-in';
  const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.15, W / 2, H / 2, Math.max(W, H) * 0.75);
  gr.addColorStop(0, 'rgba(0,0,0,0.15)');
  gr.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
}

/** 1024² three-armed spiral galaxy disc (drawn squashed and slowly rotating behind the planets). */
export function galaxyDiscTexture(): Texture {
  const S = 1024;
  const C = S / 2;
  const [c, g] = canvas(S, S);
  const R = mulberry32(777);
  g.globalCompositeOperation = 'lighter';
  let gr = g.createRadialGradient(C, C, 0, C, C, 270);
  gr.addColorStop(0, 'rgba(255,230,255,0.5)');
  gr.addColorStop(0.12, 'rgba(200,140,255,0.32)');
  gr.addColorStop(0.45, 'rgba(90,60,220,0.11)');
  gr.addColorStop(1, 'rgba(30,20,120,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const armCols = ['120,90,255', '255,70,210', '60,200,255'];
  const ARMS = 3;
  for (let i = 0; i < 320; i++) {
    const arm = i % ARMS;
    const t = Math.pow(R(), 0.85);
    const ang = (arm * TAU) / ARMS + t * 5.4 + (R() - 0.5) * 0.5;
    const rr = 50 + t * 430;
    const x = C + Math.cos(ang) * rr;
    const y = C + Math.sin(ang) * rr;
    const rad = (20 + R() * 50) * (1.1 - t * 0.5);
    const col = armCols[(arm + (R() < 0.3 ? 1 : 0)) % 3];
    const a = 0.035 + R() * 0.05;
    gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${col},${a})`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 3800; i++) {
    const arm = i % ARMS;
    const t = Math.pow(R(), 0.7);
    const ang = (arm * TAU) / ARMS + t * 5.4 + (R() - 0.5) * (0.3 + t * 0.6);
    const rr = 30 + t * 470 + (R() - 0.5) * 30;
    const x = C + Math.cos(ang) * rr;
    const y = C + Math.sin(ang) * rr;
    const sz = R() < 0.08 ? 1.8 : 0.6 + R() * 0.9;
    const col = R() < 0.5 ? '210,235,255' : R() < 0.5 ? '180,150,255' : '255,170,230';
    g.fillStyle = `rgba(${col},${(0.25 + R() * 0.6).toFixed(2)})`;
    g.fillRect(x, y, sz, sz);
  }
  return toTexture(c);
}

/** White radial falloff; `stops` are [offset, alpha] pairs. Tinted per sprite. */
function radialTexture(size: number, stops: [number, number][]): Texture {
  const [c, g] = canvas(size, size);
  const h = size / 2;
  const gr = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [o, a] of stops) gr.addColorStop(o, `rgba(255,255,255,${a})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return toTexture(c);
}

/** Star dot: a tight soft disc so sub-pixel stars move smoothly instead of popping between pixels. */
export const DOT_SIZE = 8;
export function dotTexture(): Texture {
  return radialTexture(DOT_SIZE, [
    [0, 1],
    [0.45, 0.85],
    [1, 0],
  ]);
}

/** Glow halo (mockup `glowSprite`). */
export function glowTexture(): Texture {
  return radialTexture(64, [
    [0, 1],
    [0.22, 0.55],
    [0.55, 0.14],
    [1, 0],
  ]);
}

/** Four-point glint: a thin cross that fades towards its tips. */
export const GLINT_SIZE = 64;
export function glintTexture(): Texture {
  const S = GLINT_SIZE;
  const h = S / 2;
  const [c, g] = canvas(S, S);
  const line = (horizontal: boolean) => {
    const gr = horizontal ? g.createLinearGradient(0, 0, S, 0) : g.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    if (horizontal) g.fillRect(0, h - 0.75, S, 1.5);
    else g.fillRect(h - 0.75, 0, 1.5, S);
  };
  line(true);
  line(false);
  return toTexture(c);
}
