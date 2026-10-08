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
  it('ships an empty .nojekyll so GitHub Pages serves files and folders starting with an underscore', () => {
    expect(existsSync(site('public/.nojekyll'))).toBe(true);
    expect(statSync(site('public/.nojekyll')).size).toBe(0);
  });
});
