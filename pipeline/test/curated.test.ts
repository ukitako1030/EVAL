import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { parseAnnouncements, parseEvents, parseReleases, parseUnits, type CompiledUnit } from '../src/config/load';
import { FRONT_IDS, type FrontId, type Observation } from '../src/core/types';
import { toMonth } from '../src/core/months';
import { arenaImageEdit, arenaI2v, arenaT2i, arenaT2v, arenaText, arenaTextStyle, arenaWebdev } from '../src/sources/arena';
import { arenaLegacy } from '../src/sources/arenaLegacy';
import { epochApex, epochEci, epochMetr, epochOsworld, epochOsworld2, epochSwebench, epochTerminalBench, epochVending } from '../src/sources/epoch';
import { swebench } from '../src/sources/swebench';
import { aiderEdit, aiderPolyglot } from '../src/sources/aider';
import { livebenchCoding } from '../src/sources/livebench';
import { parseOsworld } from '../src/sources/osworld';
import { parseTau2 } from '../src/sources/tau2';
import { parseTtsArena } from '../src/sources/ttsArena';
import { parseMusicArena } from '../src/sources/musicArena';
import { parseDesignArena } from '../src/sources/designArena';
import { parseVbench } from '../src/sources/vbench';

/**
 * Checks the curated configuration against the model names that the real source parsers produce from the
 * committed fixtures (plus the committed arena-legacy raw snapshot).
 */

const curated = (f: string) => readFileSync(new URL(`../curated/${f}`, import.meta.url), 'utf8');
const fx = (p: string) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8');
const json = (p: string): unknown => JSON.parse(fx(p));
const now = new Date('2026-10-08T00:00:00Z');
const ctx = { now };

const units = parseUnits(curated('units.yaml'));
const announcements = parseAnnouncements(curated('announcements.yaml'));
const events = parseEvents(curated('events.yaml'));
const releases = parseReleases(curated('releases.yaml'));

interface Name {
  source: string;
  model: string;
  org?: string;
  /** snapshot date (snapshot-type sources only) */
  snapshot?: string;
}

function fromObs(source: string, obs: Observation[]): Name[] {
  return obs.map((o) => ({ source, model: o.model, org: o.org, snapshot: o.dateKind === 'snapshot' ? o.date : undefined }));
}

function collectNames(): Name[] {
  const out: Name[] = [];
  const arena = { 'arena-text': arenaText, 'arena-text-style': arenaTextStyle, 'arena-webdev': arenaWebdev, 'arena-t2i': arenaT2i, 'arena-image-edit': arenaImageEdit, 'arena-t2v': arenaT2v, 'arena-i2v': arenaI2v };
  for (const [id, mod] of Object.entries(arena)) out.push(...fromObs(id, mod.parse(json(`${id}/sample.rows.json`), ctx)));
  // Agent Arena has no strength module yet; its display names are still useful regex test cases
  for (const r of json('arena-agent/sample.rows.json') as { model_name: string; organization: string }[]) {
    out.push({ source: 'arena-agent', model: r.model_name, org: r.organization || undefined });
  }
  const legacyDir = new URL('../raw/arena-legacy/', import.meta.url);
  for (const f of readdirSync(legacyDir).filter((n) => n.endsWith('.json'))) {
    const snap = JSON.parse(readFileSync(new URL(f, legacyDir), 'utf8')) as { items: unknown };
    out.push(...fromObs('arena-legacy', arenaLegacy.parse(snap.items, ctx)));
  }
  const epoch = { 'epoch-eci': epochEci, 'epoch-terminalbench': epochTerminalBench, 'epoch-swebench': epochSwebench, 'epoch-metr': epochMetr, 'epoch-vending': epochVending, 'epoch-apex': epochApex, 'epoch-osworld': epochOsworld, 'epoch-osworld2': epochOsworld2 };
  for (const [id, mod] of Object.entries(epoch)) out.push(...fromObs(id, mod.parse(fx(`${id}/sample.csv`), ctx)));
  out.push(...fromObs('swebench', swebench.parse(json('swebench/sample.json'), ctx)));
  out.push(...fromObs('aider-edit', aiderEdit.parse(fx('aider-edit/sample.yml'), ctx)));
  out.push(...fromObs('aider-polyglot', aiderPolyglot.parse(fx('aider-polyglot/sample.yml'), ctx)));
  for (const [table, cats] of [
    ['sample_2024_06_24.csv', 'categories_2024_06_24.json'],
    ['sample_2025_04_02.csv', 'categories_2025_04_02.json'],
    ['sample.csv', 'categories_2026_06_25.json'],
  ]) {
    out.push(...fromObs('livebench', livebenchCoding.parse({ table: fx(`livebench/${table}`), categories: json(`livebench/${cats}`) }, ctx)));
  }
  out.push(...fromObs('osworld', parseOsworld(json('osworld/sample.rows.json'))));
  const tau2 = (json('tau2/sample.json') as { submission: unknown }[]).map((e) => e.submission);
  for (const f of readdirSync(new URL('./fixtures/tau2/', import.meta.url)).filter((n) => n.startsWith('submission-'))) tau2.push(json(`tau2/${f}`));
  out.push(...fromObs('tau2', parseTau2(tau2)));
  // TTS Arena: the parser keys on `id`; display names are what Design Arena shows, so both are checked
  for (const f of ['sample.json', 'sample-preliminary.json']) {
    out.push(...fromObs('tts-arena', parseTtsArena(json(`tts-arena/${f}`), now)));
    for (const r of (json(`tts-arena/${f}`) as { rows: { name: string }[] }).rows) out.push({ source: 'tts-arena-name', model: r.name });
  }
  const tsv = (f: string) => {
    const m = /_(\d{4})(\d{2})(\d{2})\.tsv$/.exec(f)!;
    return { date: `${m[1]}-${m[2]}-${m[3]}`, board: f.includes('instrumental') ? 'instrumental' : 'vocal', text: fx(`music-arena/${f}`) };
  };
  const tsvs = readdirSync(new URL('./fixtures/music-arena/', import.meta.url)).filter((n) => n.endsWith('.tsv'));
  out.push(...fromObs('music-arena', parseMusicArena(tsvs.map(tsv))));
  // Music Arena battles: system keys (the TSVs switched to display names from 2025-11)
  for (const b of json('music-arena/sample.json') as { system_a: string; system_b: string }[]) {
    out.push({ source: 'music-arena-battles', model: b.system_a }, { source: 'music-arena-battles', model: b.system_b });
  }
  out.push(...fromObs('designarena', parseDesignArena(json('designarena/docs-example.json'), 'image', now)));
  out.push(...fromObs('vbench', parseVbench(json('vbench/sample.json'))));
  // GenAI-Arena (no module yet): open image/video models
  for (const f of readdirSync(new URL('./fixtures/genai-arena/', import.meta.url)).filter((n) => n.endsWith('.csv'))) {
    for (const line of fx(`genai-arena/${f}`).split(/\r?\n/).slice(1)) {
      const model = line.split(',')[1];
      if (model) out.push({ source: 'genai-arena', model });
    }
  }
  return out;
}

const names = collectNames();
const excluded = (model: string) => units.exclude.some((r) => r.test(model));
const regexHit = (u: CompiledUnit, model: string) => u.regexes.some((r) => r.test(model));
const orgOk = (u: CompiledUnit, org?: string) => !u.orgRegex || !org || u.orgRegex.test(org);
/** all units of a front that `matchUnit` could pick for this observation */
const candidates = (front: FrontId, n: Name) => (excluded(n.model) ? [] : units.units[front].filter((u) => regexHit(u, n.model) && orgOk(u, n.org)));

/** Unit patterns that no committed fixture exercises, with the reason. Key: `front/unit/pattern`. */
const DAVINCI = '(?<![a-z0-9])(?:text-|code-)?davinci(?![a-z])';
const NO_FIXTURE: Record<string, string> = {
  ...Object.fromEntries(
    (['general', 'code', 'agent'] as const).map((f) => [
      `${f}/gpt/${DAVINCI}`,
      'GPT-3-era Epoch slugs (davinci-002, text-davinci-003); the METR fixture row is dropped by the newest-version rule',
    ]),
  ),
  'speech/openaitts/(?<![a-z0-9])(?:tts-1(?:-hd)?|gpt-4o(?:-mini)?-(?:tts|realtime)|gpt[-_ ]realtime)(?![a-z])':
    'OpenAI API ids; no committed TTS fixture lists OpenAI (tau2 voice rows are dropped by the parser)',
  'image/midjourney/(?<![a-z0-9])midjourney(?![a-z])': 'Midjourney is absent from every strength source (estimated unit, spec §6.1-7)',
  'speech/openaitts/(?<![a-z0-9])openai[-_ ](?:gpt|tts)': 'Design Arena TTS display names ("OpenAI GPT-4o Mini TTS"); only the docs example is a fixture',
  'speech/geminitts/(?<![a-z0-9])gemini(?![a-z]).*tts': 'Design Arena TTS display names ("Google Gemini 3.8 Flash TTS"); not in TTS Arena',
  'music/suno/(?<![a-z0-9])suno(?![a-z])': 'Suno is absent from Music Arena and Design Arena (estimated unit)',
  'music/udio/(?<![a-z0-9])udio(?![a-z])': 'Udio is absent from Music Arena and Design Arena (estimated unit)',
};

describe('curated files', () => {
  it('parse with the real loaders', () => {
    expect(Object.keys(units.units).sort()).toEqual([...FRONT_IDS].sort());
    for (const f of FRONT_IDS) expect(units.units[f].length, f).toBeGreaterThanOrEqual(2);
    expect(units.exclude.length).toBeGreaterThan(0);
    expect(Object.keys(announcements.series).length).toBeGreaterThan(0);
    expect(events.custom).toContainEqual(expect.objectContaining({ month: '2022-11', front: 'general', unit: 'gpt' }));
    expect(releases.length).toBeGreaterThan(0);
  });

  it('collects model names from every fixture source', () => {
    const sources = new Set(names.map((n) => n.source));
    for (const s of ['arena-text', 'arena-legacy', 'arena-t2v', 'epoch-eci', 'swebench', 'livebench', 'osworld', 'tau2', 'tts-arena', 'music-arena', 'vbench']) {
      expect(sources, s).toContain(s);
    }
    expect(names.length).toBeGreaterThan(1000);
  });
});

describe('units.yaml', () => {
  it('every unit pattern matches at least one fixture model name (or is allow-listed with a reason)', () => {
    const missing: string[] = [];
    const stale: string[] = [];
    for (const f of FRONT_IDS) {
      for (const u of units.units[f]) {
        for (const r of u.regexes) {
          const key = `${f}/${u.id}/${r.source}`;
          const hit = names.some((n) => !excluded(n.model) && r.test(n.model));
          if (!hit && !(key in NO_FIXTURE)) missing.push(key);
          if (hit && key in NO_FIXTURE) stale.push(key);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('no fixture model name matches two units of one front', () => {
    const clashes: string[] = [];
    for (const f of FRONT_IDS) {
      for (const n of names) {
        const c = candidates(f, n);
        if (c.length > 1) clashes.push(`${f}: "${n.model}" (${n.source}) → ${c.map((u) => u.id).join(', ')}`);
      }
    }
    expect([...new Set(clashes)]).toEqual([]);
  });

  it('orgMatch only rejects names that are not the vendor’s own models', () => {
    const rejected = new Set<string>();
    for (const f of FRONT_IDS) {
      for (const n of names) {
        if (excluded(n.model)) continue;
        for (const u of units.units[f]) if (regexHit(u, n.model) && !orgOk(u, n.org)) rejected.add(`${n.model} [${n.org}] ✗ ${u.id}`);
      }
    }
    // Agent Arena's org column is clean; nothing else that the parsers emit should be rejected either
    expect([...rejected]).toEqual([]);
  });

  it('keeps known look-alikes out of the units', () => {
    const general = (model: string, org?: string) => candidates('general', { source: 't', model, org }).map((u) => u.id);
    expect(general('gemma-2-27b-it')).toEqual([]);
    expect(general('palm-2')).toEqual([]);
    expect(general('gpt-realtime-2')).toEqual([]);
    expect(general('gemini-live-2.5-flash-native-audio')).toEqual([]);
    expect(general('grok-voice-think-fast-2.0')).toEqual([]);
    expect(general('xai-realtime')).toEqual([]);
    expect(general('gpt-image-1')).toEqual([]);
    expect(general('Lingma SWE-GPT 72b')).toEqual([]);
    expect(general('deepseek-r1-distill-llama-70b')).toEqual([]);
    expect(general('openrouter/meta-llama/llama-3.1-405b-instruct')).toEqual(['llama']);
    expect(general('x-ai/grok-4')).toEqual(['grok']);
    expect(general('o4-mini-2025-04-16')).toEqual(['gpt']);
    expect(general('gpt-oss-120b')).toEqual(['gpt']);
    expect(general('muse-glimmer')).toEqual(['llama']);
    expect(candidates('image', { source: 't', model: 'recraft-v3' }).map((u) => u.id)).toEqual(['recraft']);
    expect(candidates('image', { source: 't', model: 'imagen-4.0-generate-001' }).map((u) => u.id)).toEqual(['nanobanana']);
    expect(candidates('video', { source: 't', model: 'Open-Sora-2.0 (2025-03-18)' }).map((u) => u.id)).toEqual([]);
    expect(candidates('video', { source: 't', model: 'gemini-omni-flash' }).map((u) => u.id)).toEqual(['veo']);
    expect(candidates('agent', { source: 't', model: 'agent s2 w/ gemini-2.5-pro', org: 'Simular Research' })).toEqual([]);
  });

  // Design Arena display names observed on 2026-10-08 (sources-media.md "Model lists per board"; no keyed fixture yet)
  it.each([
    ['image', 'GPT-Image-2.5 Sunburst', 'gptimage'],
    ['image', 'DALL·E 3', 'gptimage'],
    ['image', 'Gemini 3.1 Flash Image Gen 2K (Nano Banana 2)', 'nanobanana'],
    ['image', 'Imagen 4 Ultra Generate Preview 06-06', 'nanobanana'],
    ['image', 'FLUX.2 [flex]', 'flux'],
    ['image', 'FLUX.2 Klein 4B Distilled', 'flux'],
    ['image', 'Seedream Lite 5.0', 'seedream'],
    ['image', 'Ideogram 4.0', 'ideogram'],
    ['image', 'p-image-ideogram (high)', null],
    ['image', 'Recraft V4.1 Utility Pro', 'recraft'],
    ['image', 'Grok Imagine Image 2 Medium', null],
    ['video', 'Gemini Omni 1.1 Flash', 'veo'],
    ['video', 'Veo 3.1 Fast', 'veo'],
    ['video', 'Sora 2 Pro', 'sora'],
    ['video', 'Kling O3 (Omni)', 'kling'],
    ['video', 'MiniMax Hailuo-2.3 (Pro)', 'hailuo'],
    ['video', 'MiniMax H3 Max', 'hailuo'],
    ['video', 'Ray 3.2', 'luma'],
    ['video', 'Wan 3.0', 'wan'],
    ['video', 'Seedance 2.0 Mini', 'seedance'],
    ['video', 'FLUX 3 Video', null],
    ['speech', 'Google Gemini 3.8 Flash TTS', 'geminitts'],
    ['speech', 'OpenAI GPT Realtime 2', 'openaitts'],
    ['speech', 'OpenAI GPT-4o Mini TTS', 'openaitts'],
    ['speech', 'Eleven v4 Turbo', 'elevenlabs'],
    ['speech', 'MiniMax Speech-2.5 Turbo', 'minimax'],
    ['speech', 'Speech 2.6', null],
    ['speech', 'Cartesia Sonic 3.5', 'cartesia'],
    ['speech', 'Hume Octave 2', 'hume'],
    ['speech', 'Grok TTS', null],
    ['music', 'Stable Audio 2.5', 'stableaudio'],
    ['music', 'Google Lyria-002', 'lyria'],
    ['music', 'ElevenLabs Music v1', 'elevenmusic'],
  ] as const)('%s: "%s" → %s', (front, model, unit) => {
    expect(candidates(front, { source: 't', model }).map((u) => u.id)).toEqual(unit ? [unit] : []);
  });

  it('never shares a scale key between two units of one front, and has no Ramp keys', () => {
    for (const f of FRONT_IDS) {
      const seen = new Map<string, string>();
      for (const u of units.units[f]) {
        expect(u.scale.ramp, `${f}.${u.id}`).toBeUndefined();
        for (const [signal, v] of Object.entries(u.scale)) {
          for (const key of Array.isArray(v) ? v : [v]) {
            const k = `${signal}:${key}`;
            expect(seen.get(k), `${f}: ${k} on ${u.id}`).toBeUndefined();
            seen.set(k, u.id);
          }
        }
      }
    }
    // 1558240027 is the renamed Meta View glasses app, not Meta AI
    const itunes = FRONT_IDS.flatMap((f) => units.units[f].flatMap((u) => u.scale.itunes ?? []));
    expect(itunes).not.toContain('1558240027');
  });

  it('every announcements key used by a unit exists, and every series is used', () => {
    const used = new Set(FRONT_IDS.flatMap((f) => units.units[f].map((u) => u.scale.announcements).filter((k): k is string => !!k)));
    for (const k of used) expect(announcements.series[k], k).toBeDefined();
    for (const k of Object.keys(announcements.series)) expect(used, k).toContain(k);
  });

  it('gives each org a distinct colour within a front', () => {
    for (const f of FRONT_IDS) {
      const byColour = new Map<string, string>();
      for (const u of units.units[f]) {
        const c = units.orgs[u.org].color.toLowerCase();
        const other = byColour.get(c);
        if (other !== undefined) expect(other, `${f}: ${u.org} and ${other} share ${c}`).toBe(u.org);
        byColour.set(c, u.org);
      }
    }
  });
});

describe('announcements.yaml', () => {
  it('keeps one metric per series, sorted dates and an https source on every point', () => {
    for (const [id, s] of Object.entries(announcements.series)) {
      const dates = s.points.map((p) => p.date);
      expect([...dates].sort(), id).toEqual(dates);
      for (const p of s.points) {
        expect(p.metric ?? s.metric, `${id} ${p.date}`).toBe(s.metric);
        expect(p.url, `${id} ${p.date}`).toMatch(/^https:\/\//);
      }
    }
  });
});

describe('events.yaml', () => {
  it('refers to existing units', () => {
    for (const e of [...events.custom, ...events.overrides]) {
      expect(units.units[e.front].map((u) => u.id), `${e.month} ${e.front}`).toContain(e.unit);
    }
  });
});

describe('releases.yaml', () => {
  const releaseOf = (model: string) => releases.find((r) => r.regex.test(model)) ?? null;
  const isUnitModel = (n: Name) => FRONT_IDS.some((f) => candidates(f, n).length > 0);

  /** First-snapshot unit models without a sourced release month, with the reason. */
  const UNDATED: Record<string, string> = {
    'riffusion-fuzz-1-0': 'no verifiable vendor date (riffusion.com now redirects to producer.ai)',
    'riffusion-fuzz-1-1': 'no verifiable vendor date (riffusion.com now redirects to producer.ai)',
  };

  it('dates every unit model of the first snapshot of each snapshot series', () => {
    const bySeries = new Map<string, Name[]>();
    for (const n of names) {
      if (!n.snapshot || ['livebench', 'tts-arena', 'designarena'].includes(n.source)) continue; // dated by fetch time
      if (!bySeries.has(n.source)) bySeries.set(n.source, []);
      bySeries.get(n.source)!.push(n);
    }
    const undated: string[] = [];
    for (const [source, list] of bySeries) {
      const first = list.map((n) => n.snapshot!).sort()[0];
      for (const n of list) {
        if (n.snapshot === first && isUnitModel(n) && !releaseOf(n.model) && !(n.model in UNDATED)) undated.push(`${source} ${first}: ${n.model}`);
      }
    }
    expect([...new Set(undated)]).toEqual([]);
    for (const m of Object.keys(UNDATED)) expect(releaseOf(m), `${m} is dated now: drop it from UNDATED`).toBeNull();
  });

  it('never dates a model after a snapshot it already appears in', () => {
    const late: string[] = [];
    for (const n of names) {
      if (!n.snapshot || ['livebench', 'tts-arena', 'designarena'].includes(n.source)) continue;
      const r = releaseOf(n.model);
      if (r && r.release > toMonth(n.snapshot)) late.push(`${n.model}: release ${r.release} > ${n.source} ${n.snapshot}`);
    }
    expect([...new Set(late)]).toEqual([]);
  });

  it('gives headline models their vendor spelling', () => {
    const display = (model: string) => releaseOf(model)?.display;
    expect(display('gpt-4o-2024-05-13')).toBe('GPT-4o');
    expect(display('claude-3-5-sonnet-20240620')).toBe('Claude 3.5 Sonnet');
    expect(display('gemini-2.5-pro')).toBe('Gemini 2.5 Pro');
    expect(display('veo-3')).toBe('Veo 3');
    expect(display('sora-2')).toBe('Sora 2');
    expect(display('gemini-3-pro-image-preview (nano-banana-pro)')).toBe('Nano Banana Pro');
    expect(display('gpt-4o-mini-2024-07-18')).not.toBe('GPT-4o');
  });

  it('keeps the parsed YAML free of unknown top-level keys', () => {
    expect(Object.keys(parseYaml(curated('releases.yaml')) as object)).toEqual(['models']);
  });
});
