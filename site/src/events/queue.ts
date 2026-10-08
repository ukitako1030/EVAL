import type { FrontId, World, WorldEvent } from '../data/types';

/** Battle news to announce when playback enters month `i`. Galaxy view hides other fronts' surges (too chatty). */
export function selectEvents(world: World, i: number, front: FrontId | null): WorldEvent[] {
  const month = world.months[i];
  return world.events.filter((e) => e.month === month && (front ? e.front === front : e.type !== 'surge' || e.front === 'general'));
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
