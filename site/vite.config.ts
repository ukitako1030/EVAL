import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * @fontsource CSS lists a .woff fallback after every .woff2. Every browser that runs the site (WebGL) reads woff2, so
 * drop the fallbacks: dist then carries one file per font slice instead of two (src/fonts.ts).
 */
export function woff2Only(): Plugin {
  return {
    name: 'aiwar-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]@fontsource[\\/][^?]*\.css(\?|$)/.test(id)) return null;
      return { code: code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, ''), map: null };
    },
  };
}

/** Optional painted background art in public/art/, detected at build time so the page never requests a missing file. */
function bgArt(kind: 'desktop' | 'mobile'): string | null {
  for (const ext of ['webp', 'jpg', 'png']) {
    const rel = `art/bg-${kind}.${ext}`;
    if (existsSync(resolve(import.meta.dirname, 'public', rel))) return rel;
  }
  return null;
}

export default defineConfig({
  base: './',
  plugins: [woff2Only()],
  define: { __BG_ART__: JSON.stringify({ desktop: bgArt('desktop'), mobile: bgArt('mobile') }) },
  build: {
    outDir: 'dist',
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), methods: resolve(import.meta.dirname, 'methods.html') } },
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
