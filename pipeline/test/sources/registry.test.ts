import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { SOURCES } from '../../src/sources/index';
import { parseMethod } from '../../src/config/load';
import { FRONT_IDS, SIGNAL_IDS } from '../../src/core/types';
import type { SourceModule, StrengthModule } from '../../src/sources/types';

const method = parseMethod(readFileSync(new URL('../../config/method.yaml', import.meta.url), 'utf8'));
const strength = SOURCES.filter((m): m is StrengthModule => m.role === 'strength');
const scale = SOURCES.filter((m) => m.role === 'scale');
const weighted = new Set(Object.values(method.strength.weights).flatMap((w) => Object.keys(w)));
const provided = new Set(strength.map((m) => m.group));

describe('source registry', () => {
  it('has unique module ids', () => {
    const ids = SOURCES.map((m) => m.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('lists strength modules first, then scale modules', () => {
    const roles = SOURCES.map((m) => m.role);
    const firstScale = roles.indexOf('scale');
    expect(firstScale).toBeGreaterThan(0);
    expect(roles.slice(firstScale).every((r) => r === 'scale')).toBe(true);
  });

  it('contains every module exported from src/sources/*.ts', async () => {
    const files = readdirSync(new URL('../../src/sources/', import.meta.url))
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
      .map((f) => f.slice(0, -'.ts'.length));
    const exported = new Set<string>();
    for (const f of files) {
      const mod = (await import(`../../src/sources/${f}.ts`)) as Record<string, unknown>;
      for (const v of Object.values(mod)) {
        const m = v as Partial<SourceModule> | null;
        if (m && typeof m === 'object' && (m.role === 'strength' || m.role === 'scale') && typeof m.id === 'string') exported.add(m.id);
      }
    }
    expect(exported.size).toBeGreaterThan(0);
    expect([...exported].filter((id) => !SOURCES.some((m) => m.id === id))).toEqual([]);
  });

  it('has no Ramp module (intentionally dropped)', () => {
    expect(SOURCES.some((m) => m.id === 'ramp')).toBe(false);
  });

  it('weights every strength module group on at least one front', () => {
    expect(strength.filter((m) => !weighted.has(m.group)).map((m) => `${m.id} -> ${m.group}`)).toEqual([]);
  });

  it('provides every weights key from at least one strength module', () => {
    expect([...weighted].filter((g) => !provided.has(g))).toEqual([]);
  });

  it('weights only known fronts and gives each front at least one group', () => {
    expect(Object.keys(method.strength.weights).sort()).toEqual([...FRONT_IDS].sort());
    for (const f of FRONT_IDS) expect(Object.keys(method.strength.weights[f]).length).toBeGreaterThan(0);
  });

  it('scale module ids are signal ids', () => {
    const signals = new Set<string>(SIGNAL_IDS);
    expect(scale.filter((m) => !signals.has(m.id)).map((m) => m.id)).toEqual([]);
    // announcements are hand-curated and ramp is dropped: every other signal has a module
    const covered = new Set(scale.map((m) => m.id));
    expect(SIGNAL_IDS.filter((s) => !covered.has(s) && s !== 'announcements' && s !== 'ramp')).toEqual([]);
  });
});

describe('method.yaml', () => {
  it('is accepted by parseMethod with the specified parameters', () => {
    expect(method.start).toBe('2022-11');
    expect(method.strength.minUnits).toBe(2);
    expect(method.strength.kinds.elo.scale).toBe(400);
    expect(method.scale.components.business.signals).toContain('openrouter');
    expect(method.scale.base).toEqual(['consumer', 'attention']);
  });
});
