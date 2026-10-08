// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { fmt1, fmtCount, fmtShare, h, isHttpUrl, isTypingTarget, safeColor, safeLink, setAccent } from '../../src/ui/dom';

describe('dom helpers', () => {
  it('h() inserts strings as text, never as markup', () => {
    const el = h('p', { class: 'x' }, ['<img src=x onerror="alert(1)">', 42]);
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('<img src=x onerror="alert(1)">42');
    expect(el.className).toBe('x');
  });
  it('h() refuses event-handler and URL attributes', () => {
    expect(() => h('div', { attrs: { onclick: 'alert(1)' } })).toThrow();
    expect(() => h('a', { attrs: { href: 'javascript:alert(1)' } })).toThrow();
    expect(() => h('div', { attrs: { style: 'background:url(x)' } })).toThrow();
  });
  it('safeLink only links absolute http(s) URLs, opening a new tab without an opener', () => {
    const a = safeLink('https://example.com/a?b=1', 'Example');
    expect(a.tagName).toBe('A');
    expect(a.getAttribute('href')).toBe('https://example.com/a?b=1');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '/relative', 'not a url', '', null, undefined]) {
      const el = safeLink(bad, 'x');
      expect(el.tagName, String(bad)).toBe('SPAN');
      expect(el.hasAttribute('href')).toBe(false);
    }
    expect(isHttpUrl('http://a.b')).toBe(true);
    expect(isHttpUrl(' javascript:x')).toBe(false);
  });
  it('safeColor only lets #rrggbb through', () => {
    expect(safeColor('#19c37d')).toBe('#19c37d');
    expect(safeColor('red; background:url(https://evil)')).toBe('#888888');
    expect(safeColor(undefined, '#3de8ff')).toBe('#3de8ff');
    const el = h('div');
    setAccent(el, 'url(https://evil)');
    expect(el.style.getPropertyValue('--c')).toBe('#888888');
  });
  it('formats numbers', () => {
    expect(fmt1(92.04)).toBe('92.0');
    expect(fmt1(null)).toBe('—');
    expect(fmt1(Number.NaN)).toBe('—');
    expect(fmtShare(0.425)).toBe('43%');
    expect(fmtCount(1_200_000_000, 'en')).toBe('1.2B');
    expect(fmtCount(1_200_000_000, 'ja')).toBe('12億');
  });
  it('isTypingTarget is true inside form fields and editable content only', () => {
    const input = h('input');
    const div = h('div', { attrs: { contenteditable: 'true' } }, [h('span')]);
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(div.firstChild as Element)).toBe(true);
    expect(isTypingTarget(h('button'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
