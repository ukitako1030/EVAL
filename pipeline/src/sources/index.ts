import type { SourceModule } from './types';
import {
  arenaText,
  arenaTextStyle,
  arenaCoding,
  arenaCodingRaw,
  arenaWebdev,
  arenaT2i,
  arenaImageEdit,
  arenaT2v,
  arenaI2v,
} from './arena';
import { arenaLegacy } from './arenaLegacy';
import {
  epochEci,
  epochTerminalBench,
  epochSwebench,
  epochMetr,
  epochVending,
  epochApex,
  epochOsworld,
  epochOsworld2,
} from './epoch';
import { swebench } from './swebench';
import { aiderEdit, aiderPolyglot } from './aider';
import { livebenchCoding } from './livebench';
import { osworld } from './osworld';
import { tau2 } from './tau2';
import { vbench } from './vbench';
import { ttsArena } from './ttsArena';
import { musicArena } from './musicArena';
import { designArenaImage, designArenaVideo, designArenaTts, designArenaMusic } from './designArena';
import { crux } from './crux';
import { tranco } from './tranco';
import { statcounter } from './statcounter';
import { cloudflare } from './cloudflare';
import { openrouter } from './openrouter';
import { wikipedia } from './wikipedia';
import { itunes } from './itunes';

/**
 * Every source module, in fetch order: strength sources first, then scale sources.
 * Arena modules sit together so that those sharing a dataset file reuse one download.
 * Ramp is intentionally absent (no usable public data); `ramp` stays a valid scale signal id but nothing fetches it.
 */
export const SOURCES: SourceModule[] = [
  // strength
  arenaText,
  arenaTextStyle,
  arenaLegacy,
  arenaCoding,
  arenaCodingRaw,
  arenaWebdev,
  arenaT2i,
  arenaImageEdit,
  arenaT2v,
  arenaI2v,
  epochEci,
  epochTerminalBench,
  epochSwebench,
  epochMetr,
  epochVending,
  epochApex,
  epochOsworld,
  epochOsworld2,
  swebench,
  aiderEdit,
  aiderPolyglot,
  livebenchCoding,
  osworld,
  tau2,
  vbench,
  ttsArena,
  musicArena,
  designArenaImage,
  designArenaVideo,
  designArenaTts,
  designArenaMusic,
  // scale
  crux,
  tranco,
  statcounter,
  cloudflare,
  openrouter,
  wikipedia,
  itunes,
];
