#!/usr/bin/env node
// Assembles the frames from record.mjs into the vertical X (Twitter) promo: Japanese captions (ffmpeg drawtext, Windows
// Yu Gothic Bold), the end card, H.264 / yuv420p / 30 fps / faststart, plus a poster and sample frames.
//   node scripts/compose-promo.mjs --frames <frames dir> --out ../promo
// Caption times: the shot list in record.mjs and the cues.json it writes next to the frames.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const FRAMES = path.resolve(args.frames ?? 'frames');
const OUT = path.resolve(args.out ?? '../promo');
const FPS = 30;
const FONT = 'C\\:/Windows/Fonts/YuGothB.ttc';
fs.mkdirSync(OUT, { recursive: true });
const work = path.join(FRAMES, '..', 'compose');
fs.mkdirSync(work, { recursive: true });

let n = 0;
/** text file for drawtext (UTF-8, no escaping headaches); returns a filter-safe path */
const tf = (text) => {
  const p = path.join(work, `t${n++}.txt`);
  fs.writeFileSync(p, text, 'utf8');
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
};
/** alpha: fade in over `fi` from `a`, out over `fo` before `b` */
const fade = (a, b, fi = 0.25, fo = 0.25) => `'if(lt(t,${a}),0,if(lt(t,${a + fi}),(t-${a})/${fi},if(lt(t,${b - fo}),1,if(lt(t,${b}),(${b}-t)/${fo},0))))'`;

const draws = [];
/** one line of text, centred horizontally, top at y */
function line(text, { y, size, a, b, color = 'white', box = true, fi, fo, border = 22 }) {
  draws.push(
    `drawtext=fontfile='${FONT}':textfile='${tf(text)}':fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${y}` +
      `:shadowcolor=black@0.85:shadowx=3:shadowy=3` +
      (box ? `:box=1:boxcolor=0x05101c@0.72:boxborderw=${border}` : '') +
      `:enable='between(t,${a},${b})':alpha=${fade(a, b, fi, fo)}`,
  );
}

const V2 = args.variant === 'v2';
const cueFile = JSON.parse(fs.readFileSync(path.join(FRAMES, 'cues.json'), 'utf8'));
if (!V2) {
  // (1) hook — over the zoomed-in battle, below the front name, above the planet's top
  line('ChatGPT公開から', { y: 200, size: 72, a: 0.15, b: 2.75, fi: 0.3, fo: 0.3, border: 22 });
  line('今日までのAI戦争', { y: 306, size: 72, a: 0.15, b: 2.75, fi: 0.3, fo: 0.3, border: 22 });

  // (2) timeline captions — in the gap between the general front and the bottom row of planets
  const CAP_Y = 1196;
  function caption(date, text, a, b) {
    line(date, { y: CAP_Y, size: 58, a, b, color: '0x7fe8ff', border: 18 });
    line(text, { y: CAP_Y + 92, size: 46, a, b, border: 18 });
  }
  caption('2022.11', 'ChatGPT公開 ― 開戦', 3.1, 5.0);
  // key months: record.mjs slows the timeline down on them and writes when each one starts / its dwell ends (cues.json)
  const cues = cueFile.months;
  const at = (m) => [cues[m].start - 0.05, cues[m].end + 0.35];
  caption('2024.03', '総合戦線 首位交代 GPT → Claude', ...at(16));
  caption('2025.03', '総合戦線 首位交代 GPT → Gemini', ...at(28));
  caption('2025.08', '総合戦線 首位交代 Gemini → GPT', ...at(33));
  caption('2026.06', '総合戦線 首位交代 GPT → Claude', ...at(43));
}

// (3) end card — the final state, dimmed (a slow fade to dark, never a flash), with the title / address / note
// v2 (record-playback.mjs): no other overlays; the end card starts just after playback stops at the last month
const E = V2 ? +cueFile.endCard.toFixed(2) : 20.6;
const END = V2 ? +cueFile.end.toFixed(3) : 24.0;
line('AI WAR', { y: 690, size: 132, a: E + 0.3, b: END + 1, fi: 0.4, box: false });
line('電脳戦況モニター', { y: 860, size: 70, a: E + 0.3, b: END + 1, fi: 0.4, box: false });
line('ukitako1030.github.io/EVAL', { y: 1010, size: 54, a: E + 0.6, b: END + 1, fi: 0.4, color: '0x7fe8ff', box: false });
line('非公式・公開データから作成', { y: 1120, size: 42, a: E + 0.8, b: END + 1, fi: 0.4, color: '0xd0dae6', box: false });

const filter = [
  `[0:v]scale=1080:1920:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p[base]`,
  `color=c=0x020610:s=1080x1920:r=${FPS}:d=${END},format=rgba,colorchannelmixer=aa=0.78,fade=t=in:st=${E}:d=0.6:alpha=1[dim]`,
  `[base][dim]overlay=0:0:shortest=1[v0]`,
  `[v0]${draws.join(',')},format=yuv420p[v]`,
].join(';\n');
const script = path.join(work, 'filter.txt');
fs.writeFileSync(script, filter, 'utf8');

const tag = V2 ? '-v2' : '';
const mp4 = path.join(OUT, `ai-war-x${tag}.mp4`);
const run = (a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });
run(['-framerate', String(FPS), '-i', path.join(FRAMES, 'f%04d.jpg'), '-filter_complex_script', script, '-map', '[v]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', String(args.crf ?? 19), '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-color_range', 'tv',
  '-r', String(FPS), '-movflags', '+faststart', '-an', mp4]);
const grab = (sec, file) => run(['-ss', String(sec), '-i', mp4, '-frames:v', '1', '-q:v', '3', path.join(OUT, file)]);
if (V2) {
  // --samples "banner=12.3,churn=20.1,poster=12.3" (seconds); the end sample is always 1 s before the end
  const pick = Object.fromEntries((args.samples ?? '').split(',').filter(Boolean).map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)]));
  grab(pick.banner ?? 5, 'ai-war-x-v2-sample-banner.jpg');
  grab(pick.churn ?? END / 2, 'ai-war-x-v2-sample-churn.jpg');
  grab(+(END - 1).toFixed(2), 'ai-war-x-v2-sample-end.jpg');
  grab(pick.poster ?? pick.banner ?? 5, 'ai-war-x-v2-poster.jpg');
} else {
  // poster: the hook frame; samples: the hook, the middle of the war, the end card
  grab(1.5, 'ai-war-x-sample-start.jpg');
  grab(+(cueFile.months[28].start + 0.6).toFixed(2), 'ai-war-x-sample-middle.jpg');
  grab(23.0, 'ai-war-x-sample-end.jpg');
  grab(1.5, 'ai-war-x-poster.jpg');
}
console.log(`wrote ${mp4} (${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB)`);
