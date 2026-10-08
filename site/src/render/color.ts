/** Pure colour helpers for the renderer (0xRRGGBB numbers). Allocation-free: they run per unit per frame. */

const parsed = new Map<string, number>();

/** '#rrggbb' → 0xrrggbb (grey for anything unparsable); memoised, the palette is small */
export function hexColor(s: string): number {
  let c = parsed.get(s);
  if (c !== undefined) return c;
  const m = /^#?([0-9a-f]{6})/i.exec(String(s));
  c = m ? parseInt(m[1], 16) : 0x888888;
  if (parsed.size < 4096) parsed.set(s, c);
  return c;
}

/** linear mix of two colours, t = 0 → a, 1 → b */
export function mixColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const r = Math.round(ar + (((b >> 16) & 255) - ar) * k);
  const g = Math.round(ag + (((b >> 8) & 255) - ag) * k);
  const bl = Math.round(ab + ((b & 255) - ab) * k);
  return (r << 16) | (g << 8) | bl;
}

/** relative luminance 0..1 (Rec. 709 weights on the sRGB values — good enough for picking an alpha) */
export function luminance(c: number): number {
  return (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;
}

/**
 * Light org colours (xAI, ElevenLabs, Luma…) would read as glowing white blobs once bloomed: scale their
 * fill / glow alpha down (to ≥ 0.5) so a territory's brightness says "strength", not "pale brand colour".
 */
export function colorGain(c: number): number {
  const lum = luminance(c);
  return lum > 0.55 ? 1 - (0.5 * (lum - 0.55)) / 0.45 : 1;
}
