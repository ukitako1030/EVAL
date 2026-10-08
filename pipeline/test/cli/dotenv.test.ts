import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDotEnv, parseDotEnv } from '../../src/cli/dotenv';

describe('parseDotEnv', () => {
  it('reads KEY=VALUE lines, skipping blanks and comment lines', () => {
    expect(parseDotEnv('A=1\n\n# a comment\n  # indented comment\nB_2=two\n')).toEqual({ A: '1', B_2: 'two' });
  });
  it('handles CRLF line endings and a BOM', () => {
    expect(parseDotEnv('﻿A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' });
  });
  it('trims whitespace around the key and the value', () => {
    expect(parseDotEnv('  A  =   spaced value   \nB=\t tab\t')).toEqual({ A: 'spaced value', B: 'tab' });
  });
  it('allows an empty value', () => {
    expect(parseDotEnv('A=\nB=   \nC= # only a comment')).toEqual({ A: '', B: '', C: '' });
  });
  it('strips an inline comment only when # is preceded by whitespace', () => {
    expect(parseDotEnv('A=abc # note\nB=abc\t# note\nC=abc#def\nD=#abc\nE=a # b # c')).toEqual({
      A: 'abc',
      B: 'abc',
      C: 'abc#def',
      D: '#abc',
      E: 'a',
    });
  });
  it('supports double- and single-quoted values (quotes removed, # and spaces kept)', () => {
    expect(parseDotEnv(`A="va lue # not a comment"\nB='single # quoted'\nC="  padded  "`)).toEqual({
      A: 'va lue # not a comment',
      B: 'single # quoted',
      C: '  padded  ',
    });
  });
  it('ignores what follows the closing quote, including an inline comment', () => {
    expect(parseDotEnv(`A="quoted" # comment\nB='x'   # c\nC="y"z`)).toEqual({ A: 'quoted', B: 'x', C: 'y' });
  });
  it('keeps a quote inside an unquoted value and an unterminated opening quote as typed', () => {
    expect(parseDotEnv(`A=it's\nB="never closed\nC=a"b"`)).toEqual({ A: "it's", B: '"never closed', C: 'a"b"' });
  });
  it('expands escapes in double quotes only', () => {
    expect(parseDotEnv(String.raw`A="line1\nline2 \"q\" back\\slash"` + '\n' + String.raw`B='raw\n'`)).toEqual({
      A: 'line1\nline2 "q" back\\slash',
      B: String.raw`raw\n`,
    });
  });
  it('keeps = signs inside the value (base64 padding, URLs with queries)', () => {
    expect(parseDotEnv('A=abc==\nB=https://x/y?k=v&z=1')).toEqual({ A: 'abc==', B: 'https://x/y?k=v&z=1' });
  });
  it('accepts an export prefix and lower-case keys; ignores lines that are not assignments', () => {
    expect(parseDotEnv('export A=1\nlower_key=2\nnot an assignment\n=novalue\n1BAD=3')).toEqual({ A: '1', lower_key: '2' });
  });
  it('lets a later definition win', () => {
    expect(parseDotEnv('A=1\nA=2')).toEqual({ A: '2' });
  });
});

describe('loadDotEnv', () => {
  it('returns {} for a missing file and parses an existing one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'env-'));
    expect(loadDotEnv(join(dir, 'nope.env'))).toEqual({});
    writeFileSync(join(dir, '.env'), 'KEY = "abc" # secret\n');
    expect(loadDotEnv(join(dir, '.env'))).toEqual({ KEY: 'abc' });
  });
});
