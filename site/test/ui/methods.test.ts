// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import { creditText, langFromSearch, renderLoadError, renderMethodsPage } from '../../src/ui/methodsPage';
import { METHODS_TEXT } from '../../src/ui/methodsText';
import type { World } from '../../src/data/types';
import { makeWorld } from '../fixtures/world';

function world(): World {
  const w = makeWorld();
  w.sources.push(
    { id: 'openrouter', group: 'openrouter', name: 'OpenRouter rankings', url: 'https://openrouter.ai/rankings', license: 'CC BY 4.0', credit: 'Source: OpenRouter (openrouter.ai/rankings), as of <date>', asOf: '2025-04-09', dataThrough: '2025-04-08' },
    { id: 'swebench', group: 'swebench', name: 'SWE-bench Verified', url: 'https://www.swebench.com', license: 'CC BY-NC 4.0', credit: 'SWE-bench leaderboards, CC BY-NC 4.0', asOf: null, dataThrough: null },
    { id: 'announcements', group: 'curated', name: 'Company announcements', url: null, license: 'Facts with source links', credit: 'Company announcements (see each figure’s link)', asOf: '2025-04-01', dataThrough: null },
    { id: 'releases', group: 'curated', name: 'Release dates', url: 'https://example.com/releases', license: 'CC BY 4.0', credit: 'Release dates compiled by hand', asOf: null, dataThrough: null },
  );
  return w;
}

function render(lang: 'ja' | 'en', w = world()) {
  const root = document.createElement('main');
  document.body.appendChild(root);
  renderMethodsPage(root, w, lang);
  return { root, w };
}

const sourceRow = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`.mt-source[data-source="${id}"]`)!;

afterEach(() => document.body.replaceChildren());

describe('data & method page', () => {
  it('lists every non-curated source in the table with its link, licence, credit and retrieval date', () => {
    const { root, w } = render('ja');
    const table = root.querySelector('#sources table')!;
    for (const s of w.sources.filter((x) => x.group !== 'curated')) {
      const row = table.querySelector<HTMLElement>(`.mt-source[data-source="${s.id}"]`)!;
      expect(row, s.id).not.toBeNull();
      const a = row.querySelector('a')!;
      expect(a.textContent).toBe(s.name);
      expect(a.getAttribute('href')).toBe(new URL(s.url!).href);
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.getAttribute('target')).toBe('_blank');
      expect(row.querySelector('.mt-license')?.textContent).toBe(s.license);
      expect(row.querySelector('.mt-asof')?.textContent).toBe(s.asOf ?? '—');
    }
    expect(table.querySelectorAll('.mt-source')).toHaveLength(3);
  });

  it('substitutes <date> in credits with the source’s asOf', () => {
    const { root } = render('en');
    expect(sourceRow(root, 'openrouter').querySelector('.mt-credit')?.textContent).toBe('Source: OpenRouter (openrouter.ai/rankings), as of 2025-04-09');
    expect(root.textContent).not.toContain('<date>');
    expect(creditText({ ...world().sources[1], asOf: null })).toBe('Source: OpenRouter (openrouter.ai/rankings), as of —');
  });

  it('lists curated sources under “Other credits”, a source without a URL as plain text', () => {
    const { root } = render('ja');
    const other = root.querySelector('#other-credits')!;
    expect(other.querySelector('h2')?.textContent).toBe('その他の出典');
    expect(root.querySelector('#sources .mt-source[data-source="announcements"]')).toBeNull();
    const ann = sourceRow(root, 'announcements');
    expect(other.contains(ann)).toBe(true);
    expect(ann.querySelector('a')).toBeNull();
    expect(ann.querySelector('.mt-source-name')?.textContent).toBe('Company announcements');
    expect(ann.querySelector('.mt-license')?.textContent).toBe('Facts with source links');
    expect(sourceRow(root, 'releases').querySelector('a')?.getAttribute('href')).toBe('https://example.com/releases');
  });

  it('renders the method, limitations, data licence, unofficial statement and last update in Japanese', () => {
    const { root, w } = render('ja');
    expect(root.querySelector('h1')?.textContent).toBe('データと方法');
    for (const id of ['purpose', 'strength', 'scale', 'confidence', 'weights', 'sources', 'limitations', 'licence', 'unofficial']) {
      expect(root.querySelector(`section#${id} h2`), id).not.toBeNull();
    }
    expect(root.querySelector('#strength')?.textContent).toContain('中央値');
    expect(root.querySelector('#confidence dl')?.textContent).toContain('推定（霧）');
    expect(root.querySelectorAll('#limitations li').length).toBe(METHODS_TEXT.ja.limitations.items.length);
    expect(root.querySelector('.mt-data-license')?.textContent).toBe(w.dataLicenseJa);
    expect(root.querySelector('#unofficial')?.textContent).toContain('非商用');
    expect(root.querySelector('.mt-updated')?.textContent).toBe('最終更新 2025-04-15');
    expect(document.documentElement.lang).toBe('ja');
    expect(document.title).toBe('AI WAR — データと方法');
  });

  it('renders in English with the English licence and language links', () => {
    const { root, w } = render('en');
    expect(root.querySelector('h1')?.textContent).toBe('Data & method');
    expect(root.querySelector('#strength h2')?.textContent).toBe('How strength (0–100) is computed');
    expect(root.querySelector('.mt-data-license')?.textContent).toBe(w.dataLicense);
    expect(root.querySelector('#sources thead')?.textContent).toBe('NameLicenceCreditRetrieved');
    expect(root.querySelector('a[aria-current="true"]')?.getAttribute('href')).toBe('?lang=en');
    expect(root.querySelector('.mt-back')?.getAttribute('href')).toBe('./?lang=en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('both languages cover the same sections', () => {
    const ja = METHODS_TEXT.ja;
    const en = METHODS_TEXT.en;
    expect(en.strength.steps).toHaveLength(ja.strength.steps.length);
    expect(en.scale.steps).toHaveLength(ja.scale.steps.length);
    expect(en.weights.items).toHaveLength(ja.weights.items.length);
    expect(en.limitations.items).toHaveLength(ja.limitations.items.length);
  });

  it('shows untrusted source fields as text and never links a non-http URL', () => {
    const w = world();
    w.sources.push({ id: 'evil', group: 'evil', name: '<img src=x onerror="alert(1)">', url: 'javascript:alert(1)', license: '<b>x</b>', credit: '<script>1</script>', asOf: null, dataThrough: null });
    const { root } = render('en', w);
    const row = sourceRow(root, 'evil');
    expect(row.querySelector('a')).toBeNull();
    expect(row.querySelector('img, b, script')).toBeNull();
    expect(row.querySelector('.mt-source-name')?.textContent).toBe('<img src=x onerror="alert(1)">');
  });

  it('reads the language from ?lang= and shows a friendly error when the data cannot be loaded', () => {
    expect(langFromSearch('?lang=en')).toBe('en');
    expect(langFromSearch('?lang=ja')).toBe('ja');
    expect(langFromSearch('?lang=fr')).toBe('ja');
    expect(langFromSearch('')).toBe('ja');
    const root = document.createElement('main');
    renderLoadError(root, 'en');
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Could not load the data; please reload in a moment.');
  });
});
