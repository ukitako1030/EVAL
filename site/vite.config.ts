import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), methods: resolve(import.meta.dirname, 'methods.html') } },
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
