import type { FrontId, World, WorldEvent } from '../data/types';

/** Galaxy view (`front === null`) announces only major events; a focused view announces every event of its front. */
const shownIn = (e: WorldEvent, front: FrontId | null): boolean => (front ? e.front === front : e.major);

/** Battle news to announce when playback enters month `i`. */
export function selectEvents(world: World, i: number, front: FrontId | null): WorldEvent[] {
  const month = world.months[i];
  return world.events.filter((e) => e.month === month && shownIn(e, front));
}

/**
 * Month index → number of banners `selectEvents` returns for it, for every month that has at least one — the only months
 * playback should pause on, and how long: one hold per banner. Events whose month is not on the timeline are ignored.
 */
export function holdCounts(world: World, front: FrontId | null): Map<number, number> {
  const index = new Map(world.months.map((m, i) => [m, i] as const));
  const out = new Map<number, number>();
  for (const e of world.events) {
    const i = index.get(e.month);
    if (i !== undefined && shownIn(e, front)) out.set(i, (out.get(i) ?? 0) + 1);
  }
  return out;
}

/** The months that have at least one banner (the keys of `holdCounts`). */
export function holdMonths(world: World, front: FrontId | null): Set<number> {
  return new Set(holdCounts(world, front).keys());
}

export interface Banner {
  key: string;
  event: WorldEvent;
  start: number;
  end: number;
}

/**
 * Battle-news banners, `maxVisible` at a time, each up for `seconds`. `minSeconds` (default `seconds`): once a banner
 * has been up that long it makes way early for news that is waiting — set it to playback's per-banner hold so the
 * banners keep pace with playback (which holds that long per banner) instead of falling further and further behind.
 */
export function createBannerQueue(opts: { maxVisible: number; seconds: number; maxPending: number; stagger: number; minSeconds?: number }) {
  const pending: WorldEvent[] = [];
  const scheduled: Banner[] = [];
  /** what `update` returns: one array, rewritten every call (it runs every frame) */
  const visible: Banner[] = [];
  let seq = 0;
  let minSeconds = Math.min(opts.minSeconds ?? opts.seconds, opts.seconds);
  return {
    push(events: readonly WorldEvent[]) {
      for (const e of events) pending.push(e);
      if (pending.length > opts.maxPending) pending.splice(0, pending.length - opts.maxPending);
    },
    /** Change `minSeconds` (e.g. with the playback speed). */
    setMinSeconds(s: number) {
      if (Number.isFinite(s) && s >= 0) minSeconds = Math.min(s, opts.seconds);
    },
    /** Banners visible at `now` (seconds). The array is reused by the next call: read it, don't keep it. */
    update(now: number): readonly Banner[] {
      // drop the expired ones (in place)
      let k = 0;
      for (let i = 0; i < scheduled.length; i++) if (scheduled[i].end > now) scheduled[k++] = scheduled[i];
      scheduled.length = k;
      // the oldest banner yields to waiting news once it has been readable for minSeconds (scheduled is in start order)
      while (pending.length && scheduled.length >= opts.maxVisible && now - scheduled[0].start + 1e-9 >= minSeconds) scheduled.shift();
      while (scheduled.length < opts.maxVisible && pending.length) {
        const e = pending.shift()!;
        const last = scheduled[scheduled.length - 1];
        const start = Math.max(now, last ? last.start + opts.stagger : now);
        scheduled.push({ key: `${e.month}|${e.front}|${e.unit}|${e.type}|${seq++}`, event: e, start, end: start + opts.seconds });
      }
      visible.length = 0;
      for (let i = 0; i < scheduled.length; i++) if (scheduled[i].start <= now) visible.push(scheduled[i]);
      return visible;
    },
    clear() {
      pending.length = 0;
      scheduled.length = 0;
    },
  };
}
