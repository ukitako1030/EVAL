import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';

const site = (p: string) => new URL(`../${p}`, import.meta.url);
const json = (p: string) => JSON.parse(readFileSync(site(p), 'utf8'));

describe('package hygiene', () => {
  it('declares the Node version the toolchain needs', () => {
    expect(json('package.json').engines).toEqual({ node: '>=20.11' });
  });
  it('type-checks browser code and Node-side code with separate configs', () => {
    const scripts = json('package.json').scripts;
    expect(scripts.typecheck).toBe('tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json');
    expect(scripts.build).toContain('typecheck');

    const browser = json('tsconfig.json');
    expect(browser.include).toEqual(['src']);
    expect(browser.compilerOptions.types).toEqual(['vite/client']);
    expect(browser.compilerOptions.lib).toContain('DOM');

    const node = json('tsconfig.node.json');
    expect([...node.include].sort()).toEqual(['test', 'vite.config.ts']);
    expect(node.compilerOptions.types).toEqual(['node']);
  });
  it('self-hosts the web fonts: no page talks to Google Fonts (visitor IPs stay with the site)', () => {
    for (const page of ['index.html', 'methods.html']) {
      const html = readFileSync(site(page), 'utf8');
      expect(html, page).not.toMatch(/googleapis|gstatic/);
    }
    const deps = json('package.json').dependencies;
    for (const f of ['@fontsource/noto-sans-jp', '@fontsource/orbitron', '@fontsource/rajdhani']) expect(deps, f).toHaveProperty(f);
    const fonts = readFileSync(site('src/fonts.ts'), 'utf8');
    // the weights the Google Fonts link used to load, and only those
    const weights = [...fonts.matchAll(/@fontsource\/([a-z-]+)\/(?:[a-z-]+-)?(\d00)\.css/g)].map((m) => `${m[1]} ${m[2]}`);
    expect([...new Set(weights)].sort()).toEqual(['noto-sans-jp 400', 'noto-sans-jp 700', 'orbitron 500', 'orbitron 800', 'rajdhani 500', 'rajdhani 700']);
    for (const entry of ['src/main.ts', 'src/methods.ts']) expect(readFileSync(site(entry), 'utf8'), entry).toMatch(/^import '\.\/fonts';$/m);
  });
  it('ships an empty .nojekyll so GitHub Pages serves files and folders starting with an underscore', () => {
    expect(existsSync(site('public/.nojekyll'))).toBe(true);
    expect(statSync(site('public/.nojekyll')).size).toBe(0);
  });
});
