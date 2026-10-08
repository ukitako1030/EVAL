import type { FrontId, Lang, World } from '../data/types';

/**
 * Shared DOM helpers for the HUD. Everything that comes from world.json (names, event text, credits, URLs, colours) is
 * untrusted: text only ever goes in through text nodes / `textContent`, links only through `safeLink`, colours only
 * through `safeColor`. Nothing here (or in any component) uses `innerHTML`.
 */

export type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  id?: string;
  /** plain attributes; `null` / `undefined` / `false` skip the attribute, `true` sets it empty */
  attrs?: Record<string, string | number | boolean | null | undefined>;
}

/** Attributes that can carry script or load URLs; set them through dedicated helpers (`safeLink`) instead. */
const UNSAFE_ATTR = /^(on|href$|src$|srcdoc$|xlink:href$|style$|action$|formaction$)/i;

function setAttrs(el: Element, attrs: Props['attrs']): void {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (UNSAFE_ATTR.test(k)) throw new Error(`dom: attribute "${k}" must not be set through h()`);
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

/** Creates an element; string children become text nodes (never parsed as HTML). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, children: Child[] = []): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  setAttrs(el, props.attrs);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Props['attrs'] = {}, children: Child[] = []): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

export function isHttpUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const p = new URL(url).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

/**
 * An external link that opens in a new tab without giving the target page a handle on ours. Anything that is not an
 * absolute http(s) URL (javascript:, data:, relative paths, garbage) renders as plain text instead.
 */
export function safeLink(url: string | null | undefined, text: string, props: Props = {}): HTMLAnchorElement | HTMLSpanElement {
  if (!isHttpUrl(url)) return h('span', props, [text]);
  const a = h('a', props, [text]);
  a.href = new URL(url).href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

const HEX = /^#[0-9a-f]{6}$/i;
export const FALLBACK_COLOR = '#888888';

/** Only `#rrggbb` reaches CSS (a custom property could otherwise smuggle in `url(...)`). */
export function safeColor(c: unknown, fallback = FALLBACK_COLOR): string {
  return typeof c === 'string' && HEX.test(c) ? c : fallback;
}

/** Sets `--c` (the accent colour every HUD component styles with). */
export function setAccent(el: HTMLElement | SVGElement, color: unknown, fallback?: string): void {
  el.style.setProperty('--c', safeColor(color, fallback));
}

/** Writes only when the text changed (cheap enough to call every animation frame). */
export function setText(el: Node, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setStyle(el: HTMLElement, prop: string, value: string): void {
  if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}

export function setAttr(el: Element, name: string, value: string): void {
  if (UNSAFE_ATTR.test(name)) throw new Error(`dom: attribute "${name}" must not be set through setAttr()`);
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** One decimal, or an em dash for a missing / non-finite number. */
export function fmt1(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—';
}

/** A 0..1 fraction as a whole percentage ("42%"). */
export function fmtShare(fraction: number): string {
  return Number.isFinite(fraction) ? `${Math.round(fraction * 100)}%` : '—';
}

/** Large counts in the reader's language ("12億" / "1.2B"). */
export function fmtCount(n: number, lang: Lang): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(lang === 'ja' ? 'ja-JP' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** "2025-04" → "2025.04" */
export const dotMonth = (month: string): string => month.replace('-', '.');

export function frontName(world: World, id: FrontId, lang: Lang): string {
  return world.fronts.find((f) => f.id === id)?.name[lang] ?? id;
}

export function orgName(world: World, org: string): string {
  return world.orgs[org]?.name ?? org;
}

/** The org colour of a front's unit (for event accents); `fallback` when the unit or org is unknown. */
export function unitColor(world: World, front: FrontId, unit: string, fallback = '#3de8ff'): string {
  const org = world.units[front]?.[unit]?.org;
  return safeColor(org ? world.orgs[org]?.color : undefined, fallback);
}

let idSeq = 0;
/** A document-unique id (components can be mounted more than once, e.g. desktop + mobile layouts). */
export const uid = (prefix: string): string => `${prefix}-${++idSeq}`;

/** Visually hidden text for screen readers. */
export const srOnly = (text: string): HTMLSpanElement => h('span', { class: 'sr-only' }, [text]);

/** True when keyboard shortcuts must leave the event alone (typing in a field). */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  return t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null;
}
