import { existsSync, readFileSync } from 'node:fs';

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };

/** The text of a quoted value (after the opening quote); null when the closing quote is missing. */
function readQuoted(rest: string, quote: '"' | "'"): string | null {
  let out = '';
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === quote) return out;
    if (quote === '"' && ch === '\\' && i + 1 < rest.length) {
      const next = rest[i + 1];
      if (next in ESCAPES) {
        out += ESCAPES[next];
        i++;
        continue;
      }
    }
    out += ch;
  }
  return null;
}

/**
 * Minimal .env parser (KEY=VALUE per line). Never logs values.
 * - blank lines and lines starting with # are skipped; an `export ` prefix is allowed; the last definition of a key wins
 * - unquoted values are trimmed, and an inline comment (# preceded by whitespace) is removed; `a#b` stays `a#b`
 * - "double" and 'single' quoted values keep their inner spaces and #; whatever follows the closing quote (such as
 *   a trailing comment) is ignored; double quotes expand \n \r \t \" \\ ; an unterminated quote is kept as typed
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    const raw = m[2].trimStart();
    const quote = raw[0];
    if (quote === '"' || quote === "'") {
      const quoted = readQuoted(raw.slice(1), quote);
      if (quoted !== null) {
        out[m[1]] = quoted;
        continue;
      }
    }
    // unquoted: a "#" counts as a comment only when whitespace precedes it (m[2] still starts right after "=")
    out[m[1]] = m[2].replace(/\s#.*$/, '').trim();
  }
  return out;
}

/** Reads and parses a .env file; {} when it does not exist. */
export function loadDotEnv(path: string): Record<string, string> {
  return existsSync(path) ? parseDotEnv(readFileSync(path, 'utf8')) : {};
}
