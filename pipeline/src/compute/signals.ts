import { RANK_SIGNALS, type SignalId, type SignalObs } from '../core/types';
import type { Month } from '../core/months';
import type { CompiledUnit } from '../config/load';

export type SignalTable = Map<SignalId, Map<string, Map<Month, number>>>;

type KeyedSignal = Exclude<SignalId, 'announcements'>;

function unitKeys(u: CompiledUnit, sig: KeyedSignal): string[] {
  return (u.scale[sig] as string[] | undefined) ?? [];
}

/** The unit owning the longest openrouter slug prefix that `key` starts with (the first unit wins a tie), or null. */
function openrouterUnit(units: CompiledUnit[], key: string): CompiledUnit | null {
  let best: CompiledUnit | null = null;
  let bestLen = -1;
  for (const u of units) {
    for (const p of unitKeys(u, 'openrouter')) {
      if (key.startsWith(p) && p.length > bestLen) {
        best = u;
        bestLen = p.length;
      }
    }
  }
  return best;
}

export function buildSignalTable(units: CompiledUnit[], obs: SignalObs[]): SignalTable {
  // 1) dedupe per (signal,key,month), keeping the max transformed value; zero/negative/non-finite values carry no information
  const dedup = new Map<string, SignalObs & { t: number }>();
  for (const o of obs) {
    if (o.signal === 'announcements') continue;
    if (!Number.isFinite(o.value) || !(o.value > 0)) continue;
    const t = RANK_SIGNALS.has(o.signal) ? 1 / o.value : o.value;
    const k = `${o.signal}\u0000${o.key}\u0000${o.month}`;
    const cur = dedup.get(k);
    if (!cur || t > cur.t) dedup.set(k, { ...o, t });
  }
  // 2) map keys to units and sum per unit+month
  const table: SignalTable = new Map();
  for (const o of dedup.values()) {
    const sig = o.signal as KeyedSignal;
    const hits = sig === 'openrouter' ? [openrouterUnit(units, o.key)].filter((u): u is CompiledUnit => u !== null) : units.filter((u) => unitKeys(u, sig).includes(o.key));
    for (const u of hits) {
      if (!table.has(sig)) table.set(sig, new Map());
      const byUnit = table.get(sig)!;
      if (!byUnit.has(u.id)) byUnit.set(u.id, new Map());
      const byMonth = byUnit.get(u.id)!;
      byMonth.set(o.month, (byMonth.get(o.month) ?? 0) + o.t);
    }
  }
  return table;
}
