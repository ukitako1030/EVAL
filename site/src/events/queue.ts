import type { FrontId, World, WorldEvent } from '../data/types';

/** Galaxy view (`front === null`) announces only major events; a focused view announces every event of its front. */
const shownIn = (e: WorldEvent, front: FrontId | null): boolean => (front ? e.front === front : e.major);

/** Battle news to announce when playback enters month `i`. */
export function selectEvents(world: World, i: number, front: FrontId | null): WorldEvent[] {
  const month = world.months[i];
  return world.events.filter((e) => e.month === month && shownIn(e, front));
}

/** Month indices at which `selectEvents` returns something for this view — the only months playback should pause on. */
export function holdMonths(world: World, front: FrontId | null): Set<number> {
  const index = new Map(world.months.map((m, i) => [m, i] as const));
  const out = new Set<number>();
  for (const e of world.events) {
    const i = index.get(e.month);
    if (i !== undefined && shownIn(e, front)) out.add(i);
  }
  return out;
}

export interface Banner {
  key: string;
  event: WorldEvent;
  start: number;
  end: number;
}

export function createBannerQueue(opts: { maxVisible: number; seconds: number; maxPending: number; stagger: number }) {
  let pending: WorldEvent[] = [];
  let scheduled: Banner[] = [];
  let seq = 0;
  return {
    push(events: WorldEvent[]) {
      pending.push(...events);
      if (pending.length > opts.maxPending) pending = pending.slice(pending.length - opts.maxPending);
    },
    /** Banners visible at `now` (seconds). */
    update(now: number): Banner[] {
      scheduled = scheduled.filter((b) => b.end > now);
      while (scheduled.length < opts.maxVisible && pending.length) {
        const e = pending.shift()!;
        const last = scheduled[scheduled.length - 1];
        const start = Math.max(now, last ? last.start + opts.stagger : now);
        scheduled.push({ key: `${e.month}|${e.front}|${e.unit}|${e.type}|${seq++}`, event: e, start, end: start + opts.seconds });
      }
      return scheduled.filter((b) => b.start <= now);
    },
    clear() {
      pending = [];
      scheduled = [];
    },
  };
}
