/**
 * Self-hosted web fonts (no Google Fonts request, so no visitor IP leaves for a third party): the same families and
 * weights the pages used to load from fonts.googleapis.com — Noto Sans JP 400 / 700, Orbitron 500 / 800, Rajdhani
 * 500 / 700 — from @fontsource. Like Google's, every face is split into unicode-range slices (Noto Sans JP into ~120
 * Japanese ones), so a visitor downloads only the slices of the characters on screen. vite.config.ts drops the
 * .woff fallbacks. Imported first by both entries (main.ts, methods.ts).
 */
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/700.css';
import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/800.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/700.css';
