import type { Confidence, Lang, SourceInfo, World } from '../data/types';
import { CONFIDENCE_KEY, tr } from '../i18n/strings';
import { h, safeLink } from './dom';
import { METHODS_TEXT } from './methodsText';

/** `?lang=en` → English; anything else → Japanese (the site default). */
export function langFromSearch(search: string): Lang {
  return new URLSearchParams(search).get('lang') === 'en' ? 'en' : 'ja';
}

/** The credit line with any `<date>` placeholder filled in with the source's `asOf` (the pipeline normally does this already). */
export function creditText(s: SourceInfo): string {
  return s.credit.split('<date>').join(s.asOf ?? '—');
}

export const CURATED_GROUP = 'curated';

const CONFIDENCE_ORDER: Confidence[] = ['high', 'medium', 'reconstructed', 'estimated'];

const section = (id: string, title: string, children: (Node | null)[]) =>
  h('section', { class: 'mt-section', id }, [h('h2', { class: 'mt-h' }, [title]), ...children]);
const paras = (ps: string[]) => ps.map((p) => h('p', {}, [p]));
const list = (items: string[], ordered = false) => h(ordered ? 'ol' : 'ul', { class: 'mt-list' }, items.map((x) => h('li', {}, [x])));

function sourceTable(sources: SourceInfo[], lang: Lang): HTMLElement {
  const th = (text: string) => h('th', { attrs: { scope: 'col' } }, [text]);
  return h('div', { class: 'mt-table-wrap' }, [
    h('table', { class: 'mt-sources' }, [
      h('thead', {}, [h('tr', {}, [th(tr('name', lang)), th(tr('license', lang)), th(tr('credit', lang)), th(tr('asOf', lang))])]),
      h('tbody', {}, sources.map((s) =>
        h('tr', { class: 'mt-source', attrs: { 'data-source': s.id } }, [
          h('th', { attrs: { scope: 'row' } }, [safeLink(s.url, s.name, { class: 'mt-source-name' })]),
          h('td', { class: 'mt-license' }, [s.license]),
          h('td', { class: 'mt-credit' }, [creditText(s)]),
          h('td', { class: 'mt-asof' }, [s.asOf ?? '—']),
        ]),
      )),
    ]),
  ]);
}

function curatedList(sources: SourceInfo[], lang: Lang): HTMLElement {
  return h('ul', { class: 'mt-list mt-credits' }, sources.map((s) =>
    h('li', { class: 'mt-source', attrs: { 'data-source': s.id } }, [
      safeLink(s.url, s.name, { class: 'mt-source-name' }),
      ' — ',
      h('span', { class: 'mt-license' }, [s.license]),
      ' — ',
      h('span', { class: 'mt-credit' }, [creditText(s)]),
      s.asOf ? h('span', { class: 'mt-asof' }, [` (${tr('asOf', lang)} ${s.asOf})`]) : null,
    ]),
  ));
}
/** Renders the whole "data & method" page for `world` in `lang` into `root` (replacing what was there). */
export function renderMethodsPage(root: HTMLElement, world: World, lang: Lang): void {
  const T = METHODS_TEXT[lang];
  const updated = world.generatedAt.slice(0, 10);
  const measured = world.sources.filter((s) => s.group !== CURATED_GROUP);
  const curated = world.sources.filter((s) => s.group === CURATED_GROUP);
  const langLink = (l: Lang, text: string, label: string) => {
    const a = h('a', { class: 'hud-btn', attrs: { lang: l, 'aria-label': label, 'aria-current': l === lang ? 'true' : null } }, [text]);
    a.setAttribute('href', `?lang=${l}`); // constant, not from world.json
    return a;
  };
  const back = h('a', { class: 'hud-btn mt-back' }, [`◀ ${tr('backToMonitor', lang)}`]);
  back.setAttribute('href', `./?lang=${lang}`);

  root.replaceChildren(
    h('div', { class: 'mt-page' }, [
      h('header', { class: 'mt-header hud-box' }, [
        h('nav', { class: 'mt-nav', attrs: { 'aria-label': tr('language', lang) } }, [back, h('span', { class: 'mt-lang' }, [langLink('ja', '日本語', '日本語'), langLink('en', 'EN', 'English')])]),
        h('p', { class: 'mt-brand' }, ['AI WAR — ', tr('subtitle', lang)]),
        h('h1', { class: 'mt-title' }, [T.title]),
        h('p', { class: 'mt-lead' }, [T.lead]),
        h('p', { class: 'mt-updated' }, [`${tr('lastUpdated', lang)} `, h('time', { attrs: { datetime: updated } }, [updated])]),
      ]),
      section('purpose', T.purpose.h, paras(T.purpose.p)),
      section('strength', T.strength.h, [...paras(T.strength.p), list(T.strength.steps, true)]),
      section('scale', T.scale.h, [...paras(T.scale.p), list(T.scale.steps, true)]),
      section('confidence', T.confidence.h, [
        ...paras(T.confidence.p),
        h('dl', { class: 'mt-levels' }, CONFIDENCE_ORDER.flatMap((q) => [
          h('dt', { class: `mt-q q-${q}` }, [tr(CONFIDENCE_KEY[q], lang)]),
          h('dd', {}, [T.confidence.levels[q]]),
        ])),
      ]),
      section('weights', T.weights.h, [...paras(T.weights.p), list(T.weights.items)]),
      section('sources', T.sources.h, [...paras(T.sources.p), sourceTable(measured, lang)]),
      curated.length ? section('other-credits', tr('otherCredits', lang), [...paras(T.otherCredits.p), curatedList(curated, lang)]) : null,
      section('limitations', T.limitations.h, [list(T.limitations.items)]),
      section('licence', T.licence.h, [h('p', { class: 'mt-data-license' }, [lang === 'ja' ? world.dataLicenseJa : world.dataLicense])]),
      section('unofficial', T.unofficial.h, paras(T.unofficial.p)),
      h('footer', { class: 'mt-footer' }, [`${tr('lastUpdated', lang)} ${updated}`]),
    ].filter((n): n is HTMLElement => n !== null)),
  );
  root.ownerDocument.title = `AI WAR — ${T.title}`;
  root.ownerDocument.documentElement.lang = lang;
}

/** Friendly message when world.json cannot be loaded. */
export function renderLoadError(root: HTMLElement, lang: Lang): void {
  root.replaceChildren(h('div', { class: 'mt-page' }, [h('p', { class: 'mt-error', attrs: { role: 'alert' } }, [tr('loadError', lang)])]));
}
