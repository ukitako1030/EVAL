import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
  define: { __BG_ART__: JSON.stringify({ desktop: bgArt('desktop'), mobile: bgArt('mobile') }) },
  build: {
    outDir: 'dist',
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), methods: resolve(import.meta.dirname, 'methods.html') } },
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
