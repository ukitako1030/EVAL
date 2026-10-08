import { describe, it, expect } from 'vitest';
import { buildSignalTable } from '../../src/compute/signals';
import type { CompiledUnit } from '../../src/config/load';
import type { SignalObs } from '../../src/core/types';

const u = (id: string, scale: CompiledUnit['scale']): CompiledUnit => ({ id, front: 'general', org: id, name: id, since: '2022-11', regexes: [], scale });

describe('buildSignalTable', () => {
  const units = [
    u('gpt', { crux: ['chatgpt.com', 'chat.openai.com'], openrouter: ['openai/'], itunes: ['111'] }),
    u('claude', { crux: ['claude.ai'], openrouter: ['anthropic/'] }),
  ];
  const obs: SignalObs[] = [
    { signal: 'crux', key: 'chatgpt.com', month: '2025-01', value: 1000 },
    { signal: 'crux', key: 'chat.openai.com', month: '2025-01', value: 5000 },
    { signal: 'crux', key: 'claude.ai', month: '2025-01', value: 10000 },
    { signal: 'openrouter', key: 'openai/gpt-5', month: '2025-01', value: 0.2 },
    { signal: 'openrouter', key: 'openai/gpt-4o', month: '2025-01', value: 0.1 },
    { signal: 'openrouter', key: 'anthropic/claude-4', month: '2025-01', value: 0.3 },
    { signal: 'itunes', key: '111', month: '2025-01', value: 900 },
    { signal: 'itunes', key: '111', month: '2025-01', value: 1000 },
    { signal: 'wikipedia', key: 'Unmapped', month: '2025-01', value: 5 },
  ];
  const t = buildSignalTable(units, obs);
  it('converts ranks to 1/rank and sums keys of a unit', () => {
    expect(t.get('crux')!.get('gpt')!.get('2025-01')).toBeCloseTo(1 / 1000 + 1 / 5000, 12);
    expect(t.get('crux')!.get('claude')!.get('2025-01')).toBeCloseTo(1 / 10000, 12);
  });
  it('matches openrouter by slug prefix', () => {
    expect(t.get('openrouter')!.get('gpt')!.get('2025-01')).toBeCloseTo(0.3, 12);
    expect(t.get('openrouter')!.get('claude')!.get('2025-01')).toBeCloseTo(0.3, 12);
  });
  it('keeps the max for duplicate key+month observations', () => {
    expect(t.get('itunes')!.get('gpt')!.get('2025-01')).toBe(1000);
  });
  it('ignores unmapped keys', () => {
    expect(t.get('wikipedia')).toBeUndefined();
  });
});
