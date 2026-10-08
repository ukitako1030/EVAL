import { RANK_SIGNALS, type SignalId, type SignalObs } from '../core/types';
import type { Month } from '../core/months';
import type { CompiledUnit } from '../config/load';

export type SignalTable = Map<SignalId, Map<string, Map<Month, number>>>;

type KeyedSignal = Exclude<SignalId, 'announcements'>;

function unitKeys(u: CompiledUnit, sig: KeyedSignal): string[] {
  return (u.scale[sig] as string[] | undefined) ?? [];
}

export function buildSignalTable(units: CompiledUnit[], obs: SignalObs[]): SignalTable {
  // 1) dedupe per (signal,key,month), keeping the max transformed value
  const dedup = new Map<string, SignalObs & { t: number }>();
  for (const o of obs) {
    if (o.signal === 'announcements') continue;
    const t = RANK_SIGNALS.has(o.signal) ? (o.value > 0 ? 1 / o.value : 0) : o.value;
    const k = `${o.signal}\u0000${o.key}\u0000${o.month}`;
    const cur = dedup.get(k);
    if (!cur || t > cur.t) dedup.set(k, { ...o, t });
  }
  // 2) map keys to units and sum per unit+month
  const table: SignalTable = new Map();
  for (const o of dedup.values()) {
    const sig = o.signal as KeyedSignal;
    for (const u of units) {
      const keys = unitKeys(u, sig);
      const hit = sig === 'openrouter' ? keys.some((p) => o.key.startsWith(p)) : keys.includes(o.key);
      if (!hit) continue;
      if (!table.has(sig)) table.set(sig, new Map());
      const byUnit = table.get(sig)!;
      if (!byUnit.has(u.id)) byUnit.set(u.id, new Map());
      const byMonth = byUnit.get(u.id)!;
      byMonth.set(o.month, (byMonth.get(o.month) ?? 0) + o.t);
    }
  }
  return table;
}
