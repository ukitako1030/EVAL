/** Helpers shared by the source modules that must keep personal data out of what they store. */

export type Json = Record<string, unknown>;

/** A plain JSON object (not null, not an array). */
export function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const EMAIL_ALL = new RegExp(EMAIL, 'g');

/** True when the string contains something that looks like an e-mail address. */
export function containsEmail(s: string): boolean {
  return EMAIL.test(s);
}

/**
 * Returns a copy of any JSON value with every e-mail address inside its strings (at any depth) replaced by `<redacted>`.
 * Non-string leaves and object keys are left as they are; the input is not mutated.
 */
export function redactEmails(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(EMAIL_ALL, '<redacted>');
  if (Array.isArray(v)) return v.map(redactEmails);
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactEmails(x)]));
  return v;
}
