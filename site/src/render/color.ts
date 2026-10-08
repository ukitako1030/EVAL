/** Pure colour helpers for the renderer (0xRRGGBB numbers). */

/** '#rrggbb' → 0xrrggbb (grey for anything unparsable) */
export function hexColor(s: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(String(s));
  return m ? parseInt(m[1], 16) : 0x888888;
}

/** linear mix of two colours, t = 0 → a, 1 → b */
export function mixColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const ch = (sh: number) => {
    const x = (a >> sh) & 255;
    return Math.round(x + (((b >> sh) & 255) - x) * k);
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
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
