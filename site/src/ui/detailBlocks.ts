import type { Announcement, AnnouncementPoint, FrontId, Lang, SourceInfo, UnitMonth, World } from '../data/types';
import { SCALE_COMPONENT_KEY, tr } from '../i18n/strings';
import { fmt1, fmtCount, fmtShare, h, safeLink } from './dom';

export function sourcesForGroup(world: World, group: string): SourceInfo[] {
  return world.sources.filter((s) => s.group === group);
}

/** Every source module of a group as a link (plain text when it has no http(s) URL), joined with " / ". */
export function sourceNames(world: World, group: string, fallback = group): HTMLElement {
  const srcs = sourcesForGroup(world, group);
  const wrap = h('span', { class: 'src-names' });
  if (!srcs.length) {
    wrap.append(fallback);
    return wrap;
  }
  srcs.forEach((s, k) => {
    if (k) wrap.append(' / ');
    wrap.append(safeLink(s.url, s.name, { class: 'src-link' }));
  });
  return wrap;
}

/** The latest `dataThrough` among a group's modules (null when none is known). */
export function groupDataThrough(world: World, group: string): string | null {
  let best: string | null = null;
  for (const s of sourcesForGroup(world, group)) if (s.dataThrough && (!best || s.dataThrough > best)) best = s.dataThrough;
  return best;
}

/**
 * The announcement points the pipeline used for `month` (YYYY-MM): the latest point dated up to the month's end, plus the
 * next point when the month's value is interpolated between the two (i.e. the latest point is from an earlier month).
 */
export function announcementPointsUsed(ann: Announcement, month: string): AnnouncementPoint[] {
  const pts = [...ann.points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const end = `${month}-31`; // YYYY-MM-DD: every day of the month sorts at or before "-31"
  let prev = -1;
  for (let k = 0; k < pts.length && pts[k].date <= end; k++) prev = k;
  if (prev < 0) return [];
  if (pts[prev].date.startsWith(month) || prev === pts.length - 1) return [pts[prev]];
  return [pts[prev], pts[prev + 1]];
}

const th = (text: string) => h('th', { attrs: { scope: 'col' } }, [text]);

/** "How strength is made": one row per source group for the month, or the estimated / empty explanation. */
export function strengthBlock(world: World, front: FrontId, unit: string, month: string, cell: UnitMonth | null, lang: Lang): HTMLElement {
  const sec = h('section', { class: 'bd bd-strength' }, [h('h4', { class: 'bd-h' }, [tr('strengthBreakdown', lang)])]);
  const rows = world.breakdown[front]?.[unit]?.[month] ?? [];
  if (!rows.length) {
    const q = cell ? (cell.qs ?? cell.q) : null;
    sec.append(
      q === 'estimated'
        ? h('p', { class: 'bd-estimated' }, [h('b', {}, [tr('qEstimated', lang)]), ' ', tr('estimatedNote', lang)])
        : h('p', { class: 'bd-empty' }, [tr('noBreakdown', lang)]),
    );
    return sec;
  }
  const body = h('tbody', {}, rows.map((r) => {
    const through = groupDataThrough(world, r.source);
    return h('tr', { class: 'bd-row', attrs: { 'data-source': r.source } }, [
      h('th', { attrs: { scope: 'row' } }, [
        sourceNames(world, r.source),
        r.model ? h('span', { class: 'bd-model' }, [r.model]) : null,
        through ? h('small', { class: 'bd-through' }, [`${tr('dataThrough', lang)} ${through}`]) : null,
      ]),
      h('td', { class: 'bd-value' }, [fmt1(r.value)]),
      h('td', { class: 'bd-share' }, [fmtShare(r.share)]),
      h('td', {}, [h('span', { class: `bd-tag ${r.kind}` }, [tr(r.kind, lang)])]),
    ]);
  }));
  sec.append(
    h('table', { class: 'bd-table' }, [
      h('thead', {}, [h('tr', {}, [th(`${tr('source', lang)} / ${tr('model', lang)}`), th(tr('value', lang)), th(tr('contribution', lang)), th(tr('kind', lang))])]),
      body,
    ]),
  );
  return sec;
}

const componentLabel = (id: string, lang: Lang) => (Object.hasOwn(SCALE_COMPONENT_KEY, id) ? tr(SCALE_COMPONENT_KEY[id], lang) : id);

function signalList(world: World, signals: string[], lang: Lang): HTMLElement {
  const wrap = h('span', { class: 'sbd-signals', attrs: { title: tr('signals', lang) } });
  if (!signals.length) {
    wrap.append(tr('baseShare', lang));
    return wrap;
  }
  signals.forEach((s, k) => {
    if (k) wrap.append(', ');
    wrap.append(s === 'announcements' ? tr('signalAnnouncements', lang) : sourceNames(world, s));
  });
  return wrap;
}

/** "How scale is made": the month's scale components and the official user-count points behind them. */
export function scaleBlock(world: World, front: FrontId, unit: string, month: string, lang: Lang): HTMLElement {
  const sec = h('section', { class: 'bd bd-scale' }, [h('h4', { class: 'bd-h' }, [tr('scaleBreakdown', lang)])]);
  const items = world.scaleBreakdown?.[front]?.[unit]?.[month] ?? [];
  if (items.length) {
    sec.append(
      h('table', { class: 'bd-table sbd-table' }, [
        h('thead', {}, [h('tr', {}, [th(`${tr('component', lang)} / ${tr('signals', lang)}`), th(tr('impliedShare', lang))])]),
        h('tbody', {}, items.map((c) =>
          h('tr', { class: 'sbd-row', attrs: { 'data-component': c.component } }, [
            h('th', { attrs: { scope: 'row' } }, [h('span', { class: 'sbd-label' }, [componentLabel(c.component, lang)]), signalList(world, c.signals, lang)]),
            h('td', { class: 'bd-value' }, [`${fmt1(c.share)}%`]),
          ]),
        )),
      ]),
    );
  } else {
    sec.append(h('p', { class: 'bd-empty' }, [tr('noBreakdown', lang)]));
  }

  const key = world.units[front]?.[unit]?.announcements;
  const ann = key && world.announcements && Object.hasOwn(world.announcements, key) ? world.announcements[key] : undefined;
  const used = ann ? announcementPointsUsed(ann, month) : [];
  if (ann && used.length) {
    sec.append(
      h('h5', { class: 'bd-h' }, [tr('announcementsUsed', lang)]),
      h('ul', { class: 'ann-list' }, used.map((p) =>
        h('li', { class: 'ann-point' }, [
          h('time', { attrs: { datetime: p.date } }, [p.date]),
          ' ',
          h('b', {}, [`${fmtCount(p.value, lang)} ${ann.metric}`]),
          ' ',
          safeLink(p.url, tr('source', lang), { class: 'src-link' }),
        ]),
      )),
    );
  }
  return sec;
}
