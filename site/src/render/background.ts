/**
 * Screen-space background (ported from mockups/a-galaxy.html): nebula, spiral galaxy disc,
 * three parallax star layers that drift slowly, twinkling glints, warp streaks while the camera
 * zooms, and a faint hex grid. Optional painted art (`public/art/bg-desktop.*` / `bg-mobile.*`,
 * detected at build time) replaces the procedural nebula when present.
 */
import { Assets, Container, Graphics, Particle, ParticleContainer, Sprite, type Texture } from 'pixi.js';
import type { Camera, Viewport } from './camera';
import { DOT_SIZE, GLINT_SIZE, dotTexture, drawHex, drawNebula, galaxyDiscTexture, glintTexture, glowTexture, mulberry32, nebulaSize, redrawableTexture } from './bgTextures';

export interface BackgroundView {
  /** current (animated) camera */
  cam: Camera;
  viewport: Viewport;
  /** camera scale of the galaxy overview at this viewport size — parallax is relative to it */
  overviewScale: number;
  /** smoothed d(log scale)/dt of the camera; > 0 zooming in */
  warp: number;
}

export interface Background {
  readonly container: Container;
  /** call when the screen size changes; heavy textures are rebuilt once the size settles */
  resize(w: number, h: number, resolution: number): void;
  update(dt: number, view: BackgroundView): void;
  setReducedMotion(on: boolean): void;
  destroy(): void;
}

interface StarLayer {
  /** camera parallax factor */
  k: number;
  /** zoom response exponent */
  zk: number;
  /** stars per 1440×900 */
  n: number;
  s0: number;
  s1: number;
  /** [tint, alpha] for the dim (70 %) and bright (30 %) buckets */
  cols: [[number, number], [number, number]];
  /** ambient drift, px/s */
  drift: number;
}

const STAR_LAYERS: StarLayer[] = [
  { k: 0.012, zk: 0.05, n: 300, s0: 0.5, s1: 1.1, cols: [[0x96aae1, 0.45], [0xc8d7ff, 0.65]], drift: 2 },
  { k: 0.035, zk: 0.12, n: 150, s0: 0.8, s1: 1.5, cols: [[0xaac8ff, 0.6], [0xe6f0ff, 0.9]], drift: 5 },
  { k: 0.08, zk: 0.24, n: 60, s0: 1.2, s1: 2.0, cols: [[0xbedcff, 0.8], [0xffffff, 1]], drift: 10 },
];
/** drift direction (normalised) — slowly up-left */
const DRIFT_DIR = { x: -0.97, y: -0.24 };
const TWINKLES = 46;
const TWINKLE_COLS = [0xcfe9ff, 0xffd0f4, 0xb9a8ff];
/** apparent dot diameter = star size × this */
const DOT_SPREAD = 2;
const REBUILD_DELAY = 0.15;
/** the hex grid's constant opacity */
const HEX_ALPHA = 0.05;

interface Star {
  p: Particle;
  x: number;
  y: number;
  layer: number;
}
interface Twinkle {
  glow: Sprite;
  glint: Sprite | null;
  x: number;
  y: number;
  r: number;
  ph: number;
  sp: number;
  k: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function createBackground(opts: { reducedMotion?: boolean } = {}): Background {
  let reduced = !!opts.reducedMotion;
  const container = new Container({ label: 'background' });

  const dotTex = dotTexture();
  const glowTex = glowTexture();
  const glintTex = glintTexture();
  const discTex = galaxyDiscTexture();
  const nebTex = redrawableTexture();
  const hexTex = redrawableTexture();

  const nebula = new Sprite(nebTex.texture);
  nebula.anchor.set(0.5);
  const art = new Sprite();
  art.anchor.set(0.5);
  art.visible = false;

  const disc = new Container({ label: 'galaxy-disc' });
  const discSprite = new Sprite(discTex);
  discSprite.anchor.set(0.5);
  disc.addChild(discSprite);
  disc.alpha = 0.5;
  disc.blendMode = 'add';

  const starField = new ParticleContainer({ texture: dotTex, dynamicProperties: { position: true } });
  starField.blendMode = 'add';
  const streaks = new Graphics();
  streaks.blendMode = 'add';
  const twinkleLayer = new Container({ label: 'twinkles' });
  twinkleLayer.blendMode = 'add';
  const hex = new Sprite(hexTex.texture);
  hex.blendMode = 'add';

  container.addChild(nebula, art, disc, starField, streaks, twinkleLayer, hex);

  let W = 0;
  let H = 0;
  let res = 1;
  let builtW = 0;
  let builtH = 0;
  let builtRes = 0;
  let rebuildIn = -1;
  let time = 0;
  let drift = 0;
  let stars: Star[] = [];
  let twinkles: Twinkle[] = [];
  let artUrl: string | null = null;

  function seedStars() {
    const R = mulberry32(4242);
    const area = clamp((W * H) / (1440 * 900), 0.5, 2);
    starField.removeParticles();
    stars = [];
    STAR_LAYERS.forEach((L, layer) => {
      const n = Math.round(L.n * area);
      for (let i = 0; i < n; i++) {
        const [tint, alpha] = L.cols[R() < 0.7 ? 0 : 1];
        const size = L.s0 + (L.s1 - L.s0) * R();
        const sc = (size * DOT_SPREAD) / DOT_SIZE;
        const x = R() * W;
        const y = R() * H;
        const p = new Particle({ texture: dotTex, x, y, anchorX: 0.5, anchorY: 0.5, scaleX: sc, scaleY: sc, tint, alpha });
        starField.addParticle(p);
        stars.push({ p, x, y, layer });
      }
    });
    starField.update();

    for (const t of twinkles) {
      t.glow.destroy();
      t.glint?.destroy();
    }
    twinkleLayer.removeChildren();
    twinkles = [];
    for (let i = 0; i < TWINKLES; i++) {
      const x = R() * W;
      const y = R() * H;
      const r = 1 + R() * 2.2;
      const ph = R() * Math.PI * 2;
      const sp = 0.6 + R() * 2.2;
      const k = 0.05 + R() * 0.06;
      const hasGlint = R() < 0.3;
      const tint = TWINKLE_COLS[R() < 0.7 ? 0 : R() < 0.5 ? 1 : 2];
      const glow = new Sprite({ texture: glowTex, anchor: 0.5, tint });
      glow.width = glow.height = r * 8;
      twinkleLayer.addChild(glow);
      let glint: Sprite | null = null;
      if (hasGlint) {
        glint = new Sprite({ texture: glintTex, anchor: 0.5, tint });
        twinkleLayer.addChild(glint);
      }
      twinkles.push({ glow, glint, x, y, r, ph, sp, k });
    }
  }

  function rebuildTextures() {
    const n = nebulaSize(W, H);
    nebTex.redraw(n.w, n.h, 1, drawNebula);
    hexTex.redraw(W, H, res, (g) => drawHex(g, W, H, res));
    builtW = W;
    builtH = H;
    builtRes = res;
  }

  function pickArt(): string | null {
    const a = __BG_ART__;
    const portrait = W < 768 && H > W;
    return portrait ? (a.mobile ?? a.desktop) : (a.desktop ?? a.mobile);
  }

  function loadArt() {
    const url = pickArt();
    if (url === artUrl) return;
    artUrl = url;
    if (!url) {
      art.visible = false;
      return;
    }
    Assets.load<Texture>(import.meta.env.BASE_URL + url)
      .then((tex) => {
        if (artUrl !== url || container.destroyed) return;
        art.texture = tex;
        art.visible = true;
      })
      .catch((err: unknown) => console.warn('background art not loaded', url, err));
  }

  function resize(w: number, h: number, resolution: number) {
    if (w === W && h === H && resolution === res) return;
    const first = W === 0;
    W = Math.max(1, w);
    H = Math.max(1, h);
    res = resolution;
    seedStars();
    hex.width = nebula.width = W; // stretch the old textures until the rebuild
    hex.height = H;
    if (first) rebuildTextures();
    else rebuildIn = REBUILD_DELAY;
    loadArt();
  }

  function updateStars(view: BackgroundView) {
    const { cam, viewport, overviewScale, warp } = view;
    const zr = cam.scale / Math.max(1e-6, overviewScale);
    const ccx = viewport.x + viewport.w / 2;
    const ccy = viewport.y + viewport.h / 2;
    const camX = cam.x * cam.scale;
    const camY = cam.y * cam.scale;
    const layerOx: number[] = [];
    const layerOy: number[] = [];
    const layerSc: number[] = [];
    STAR_LAYERS.forEach((L, i) => {
      layerOx[i] = camX * L.k - DRIFT_DIR.x * drift * L.drift;
      layerOy[i] = camY * L.k - DRIFT_DIR.y * drift * L.drift;
      // never contract below the overview (only the intro zooms out further)
      layerSc[i] = Math.max(1, Math.pow(zr, L.zk));
    });
    for (const s of stars) {
      const i = s.layer;
      const sc = layerSc[i];
      s.p.x = ccx + (mod(s.x - layerOx[i], W) - ccx) * sc;
      s.p.y = ccy + (mod(s.y - layerOy[i], H) - ccy) * sc;
    }

    const aw = Math.abs(warp);
    streaks.clear();
    if (aw > 0.08 && !reduced) {
      streaks.visible = true;
      // the mockup's 1.45 s zoom → our 900 ms one is faster, so streaks are scaled down to keep the same feel
      const alpha = Math.min(0.42, aw * 0.18);
      for (let li = 1; li < STAR_LAYERS.length; li++) {
        const len = clamp(warp * 0.045 * li, -0.45, 0.45);
        for (const s of stars) {
          if (s.layer !== li) continue;
          const X = s.p.x;
          const Y = s.p.y;
          streaks.moveTo(X, Y).lineTo(X + (X - ccx) * len, Y + (Y - ccy) * len);
        }
        streaks.stroke({ width: li === 2 ? 1.4 : 0.8, color: 0xaadcff, alpha });
      }
    } else streaks.visible = false;

    for (const t of twinkles) {
      const px = mod(t.x - camX * t.k - DRIFT_DIR.x * drift * t.k * 80, W);
      const py = mod(t.y - camY * t.k - DRIFT_DIR.y * drift * t.k * 80, H);
      const a = reduced ? 0.6 : 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(time * t.sp + t.ph), 3);
      t.glow.position.set(px, py);
      t.glow.alpha = a * 0.7;
      if (t.glint) {
        t.glint.position.set(px, py);
        t.glint.alpha = a * 0.6;
        t.glint.scale.set((t.r * 12 * a) / GLINT_SIZE);
      }
    }
  }

  function update(dt: number, view: BackgroundView) {
    if (W === 0) return;
    time += dt;
    if (!reduced) drift += dt;
    if (rebuildIn >= 0) {
      rebuildIn -= dt;
      if (rebuildIn < 0 && (builtW !== W || builtH !== H || builtRes !== res)) rebuildTextures();
    }
    const { cam, viewport, overviewScale } = view;
    const zr = cam.scale / Math.max(1e-6, overviewScale);

    // nebula / art: tiny parallax + zoom response, plus a very slow sway
    const sway = reduced ? 0 : Math.sin(time * 0.021) * W * 0.012;
    const ox = clamp(cam.x * cam.scale * 0.02, -W * 0.05, W * 0.05) - sway;
    const oy = clamp(cam.y * cam.scale * 0.02, -H * 0.05, H * 0.05) - sway * 0.4;
    const nz = Math.pow(Math.max(zr, 1e-3), 0.05);
    nebula.position.set(W / 2 - ox, H / 2 - oy);
    nebula.width = W * 1.12 * nz;
    nebula.height = H * 1.12 * nz;
    if (art.visible) {
      const cover = Math.max((W * 1.08) / art.texture.width, (H * 1.08) / art.texture.height) * nz;
      art.scale.set(cover);
      art.position.set(W / 2 - ox * 0.6, H / 2 - oy * 0.6);
      nebula.visible = false;
    } else nebula.visible = true;

    // spiral disc around the world origin, with damped zoom
    const zo = overviewScale;
    const zg = zo * Math.pow(Math.max(cam.scale, 1e-3) / zo, 0.4);
    const S = (zg * 1700) / 1024;
    disc.position.set(viewport.x + viewport.w / 2 - cam.x * zg * 0.9, viewport.y + viewport.h / 2 - cam.y * zg * 0.9);
    disc.rotation = -0.16;
    disc.scale.set(S, S * 0.4);
    if (!reduced) discSprite.rotation = time * 0.01;

    updateStars(view);

    // a steady, faint grid: it never brightens (a full-screen brightening would be a flash outside the flash budget)
    hex.position.set(0, 0);
    hex.width = W;
    hex.height = H;
    hex.alpha = HEX_ALPHA;
  }

  return {
    container,
    resize,
    update,
    setReducedMotion(on) {
      reduced = on;
    },
    destroy() {
      artUrl = null;
      container.destroy({ children: true });
      for (const t of [dotTex, glowTex, glintTex, discTex]) t.destroy(true);
      nebTex.destroy();
      hexTex.destroy();
    },
  };
}
