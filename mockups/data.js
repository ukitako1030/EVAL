// ============================================================
// AI WAR — 見た目確認用ダミーデータ（数値はすべて仮・雰囲気用）
// s = 強さ（ベンチマーク＋ユーザーレビューの合成スコア 0-100）
// c = 規模（利用者数・展開範囲 0-100）
// ============================================================
(function () {
  const START = [2023, 1];
  const END = [2026, 10];

  const months = [];
  for (let y = START[0], m = START[1]; y < END[0] || (y === END[0] && m <= END[1]); ) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  const idx = (ym) => months.indexOf(ym);

  // 陣営（企業）。同じ企業のユニットは全戦線で同じ色 → 「Google軍が広範囲に布陣」が見える
  const orgs = {
    openai:    { name: 'OpenAI',     color: '#19c37d' },
    anthropic: { name: 'Anthropic',  color: '#ff8a4c' },
    google:    { name: 'Google',     color: '#4c8dff' },
    xai:       { name: 'xAI',        color: '#e6e8f2' },
    meta:      { name: 'Meta',       color: '#00e0ff' },
    deepseek:  { name: 'DeepSeek',   color: '#7a6cff' },
    alibaba:   { name: 'Alibaba',    color: '#ff4fd8' },
    midjourney:{ name: 'Midjourney', color: '#ffd23f' },
    bfl:       { name: 'Black Forest Labs', color: '#b388ff' },
    bytedance: { name: 'ByteDance',  color: '#ff3b5c' },
    kuaishou:  { name: 'Kuaishou',   color: '#ffb300' },
    runway:    { name: 'Runway',     color: '#a0ff3c' },
    minimax:   { name: 'MiniMax',    color: '#ff6ec7' },
    suno:      { name: 'Suno',       color: '#ffcf33' },
    udio:      { name: 'Udio',       color: '#b06bff' },
    elevenlabs:{ name: 'ElevenLabs', color: '#dcdcdc' },
  };

  // 戦線（星）。general が最大の主戦場
  const sectors = [
    { id: 'general', name: '総合戦線', en: 'GENERAL FRONT', size: 1.0 },
    { id: 'code',    name: 'コード戦線', en: 'CODE FRONT',  size: 0.55 },
    { id: 'image',   name: '画像戦線',   en: 'IMAGE FRONT', size: 0.55 },
    { id: 'video',   name: '動画戦線',   en: 'VIDEO FRONT', size: 0.55 },
    { id: 'music',   name: '音楽戦線',   en: 'MUSIC FRONT', size: 0.45 },
  ];

  // キーフレーム：[年月, 強さ, 規模]。最初のキーフレーム以前は「未参戦」(null)
  const K = {
    general: {
      gpt:      { org: 'openai',    name: 'GPT',      kf: [['2023-01',70,90],['2023-03',88,95],['2024-03',82,90],['2024-05',88,92],['2024-09',90,90],['2025-01',85,88],['2025-04',88,88],['2025-08',90,90],['2025-12',91,88],['2026-10',90,85]] },
      claude:   { org: 'anthropic', name: 'Claude',   kf: [['2023-03',55,10],['2023-07',62,15],['2024-03',84,22],['2024-06',88,28],['2025-02',88,32],['2025-05',91,38],['2025-09',93,42],['2025-11',95,45],['2026-10',96,52]] },
      gemini:   { org: 'google',    name: 'Gemini',   kf: [['2023-03',40,20],['2023-12',70,35],['2024-02',80,42],['2024-12',84,55],['2025-03',93,62],['2025-11',96,72],['2026-03',90,80],['2026-10',82,88]] },
      grok:     { org: 'xai',       name: 'Grok',     kf: [['2023-11',45,5],['2024-08',70,12],['2025-02',85,20],['2025-07',88,25],['2026-10',84,28]] },
      deepseek: { org: 'deepseek',  name: 'DeepSeek', kf: [['2024-05',60,4],['2024-12',78,10],['2025-01',86,30],['2025-06',80,22],['2026-10',78,18]] },
      qwen:     { org: 'alibaba',   name: 'Qwen',     kf: [['2023-09',50,4],['2024-09',70,10],['2025-04',80,16],['2026-10',82,22]] },
      llama:    { org: 'meta',      name: 'Llama',    kf: [['2023-02',45,8],['2023-07',55,18],['2024-04',70,25],['2024-07',75,28],['2025-04',70,20],['2026-10',62,14]] },
    },
    code: {
      claude:   { org: 'anthropic', name: 'Claude',   kf: [['2023-07',55,8],['2024-06',85,30],['2025-02',90,45],['2025-05',93,60],['2025-09',95,66],['2026-10',96,70]] },
      gpt:      { org: 'openai',    name: 'GPT / Codex', kf: [['2023-03',78,60],['2024-05',82,55],['2025-04',86,50],['2025-09',92,55],['2026-10',93,58]] },
      gemini:   { org: 'google',    name: 'Gemini',   kf: [['2023-12',55,15],['2025-03',85,30],['2025-06',86,38],['2025-11',92,45],['2026-10',86,50]] },
      deepseek: { org: 'deepseek',  name: 'DeepSeek', kf: [['2024-06',65,8],['2025-01',80,15],['2026-10',78,12]] },
      qwen:     { org: 'alibaba',   name: 'Qwen Coder', kf: [['2024-11',68,6],['2025-07',82,14],['2026-10',84,18]] },
      grok:     { org: 'xai',       name: 'Grok',     kf: [['2025-02',70,5],['2025-08',80,10],['2026-10',80,12]] },
    },
    image: {
      midjourney: { org: 'midjourney', name: 'Midjourney', kf: [['2023-01',80,60],['2023-12',88,65],['2025-04',86,50],['2026-10',80,38]] },
      gptimage:   { org: 'openai',     name: 'GPT Image',  kf: [['2023-01',55,35],['2023-10',75,50],['2025-03',92,80],['2026-10',88,70]] },
      nanobanana: { org: 'google',     name: 'Nano Banana', kf: [['2024-05',65,15],['2024-12',78,25],['2025-08',95,60],['2025-11',97,75],['2026-10',94,82]] },
      flux:       { org: 'bfl',        name: 'FLUX',       kf: [['2024-08',85,25],['2025-05',86,28],['2026-10',82,22]] },
      seedream:   { org: 'bytedance',  name: 'Seedream',   kf: [['2025-04',80,10],['2025-09',92,25],['2026-10',90,30]] },
    },
    video: {
      runway:   { org: 'runway',    name: 'Runway',   kf: [['2023-03',45,20],['2024-06',72,30],['2025-03',80,25],['2026-10',78,18]] },
      sora:     { org: 'openai',    name: 'Sora',     kf: [['2024-12',75,30],['2025-09',92,65],['2026-10',86,55]] },
      veo:      { org: 'google',    name: 'Veo',      kf: [['2024-05',55,8],['2024-12',85,25],['2025-05',95,55],['2025-10',96,62],['2026-10',93,70]] },
      kling:    { org: 'kuaishou',  name: 'Kling',    kf: [['2024-06',78,20],['2025-04',88,38],['2026-10',90,45]] },
      hailuo:   { org: 'minimax',   name: 'Hailuo',   kf: [['2024-09',78,15],['2025-06',86,22],['2026-10',84,20]] },
      seedance: { org: 'bytedance', name: 'Seedance', kf: [['2025-06',88,15],['2026-10',92,30]] },
    },
    music: {
      suno:   { org: 'suno',       name: 'Suno',       kf: [['2023-09',60,20],['2024-03',75,50],['2024-11',82,65],['2025-05',88,75],['2025-09',93,85],['2026-10',94,88]] },
      udio:   { org: 'udio',       name: 'Udio',       kf: [['2024-04',80,30],['2025-01',82,30],['2025-10',75,18],['2026-10',70,12]] },
      lyria:  { org: 'google',     name: 'Lyria',      kf: [['2024-12',60,5],['2025-06',72,12],['2026-10',80,25]] },
      eleven: { org: 'elevenlabs', name: 'Eleven Music', kf: [['2025-08',80,10],['2026-10',84,18]] },
    },
  };

  // 疑似乱数（再現性のある揺らぎ用）
  function rng(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 月次系列へ展開：series[sector][unit] = [{s,c} | null, ...]
  const series = {};
  const units = {};
  let seed = 1;
  for (const [sid, list] of Object.entries(K)) {
    series[sid] = {};
    units[sid] = {};
    for (const [uid, u] of Object.entries(list)) {
      units[sid][uid] = { id: uid, name: u.name, org: u.org, color: orgs[u.org].color };
      const r = rng(seed++);
      const kf = u.kf.map(([ym, s, c]) => [idx(ym), s, c]);
      series[sid][uid] = months.map((_, i) => {
        if (i < kf[0][0]) return null;
        let a = kf[0], b = kf[kf.length - 1];
        for (let k = 0; k < kf.length - 1; k++) {
          if (i >= kf[k][0] && i <= kf[k + 1][0]) { a = kf[k]; b = kf[k + 1]; break; }
        }
        const t = b[0] === a[0] ? 0 : (i - a[0]) / (b[0] - a[0]);
        const jitter = () => (r() - 0.5) * 2.2;
        return {
          s: Math.max(0, Math.min(100, a[1] + (b[1] - a[1]) * t + jitter())),
          c: Math.max(0, Math.min(100, a[2] + (b[2] - a[2]) * t + jitter())),
        };
      });
    }
  }

  // 戦況イベント（新型投入など）。2026年以降は仮のもの
  const events = [
    ['2023-03', 'general', 'gpt',        'GPT-4 投入 — 総合戦線を制圧'],
    ['2023-03', 'general', 'claude',     'Claude 初陣'],
    ['2023-07', 'general', 'claude',     'Claude 2 投入'],
    ['2023-10', 'image',   'gptimage',   'DALL·E 3 投入'],
    ['2023-12', 'general', 'gemini',     'Gemini 1.0 参戦'],
    ['2023-12', 'image',   'midjourney', 'Midjourney v6 投入'],
    ['2024-02', 'general', 'gemini',     'Gemini 1.5 Pro — 長大な補給線（100万トークン）'],
    ['2024-03', 'general', 'claude',     'Claude 3 Opus 投入'],
    ['2024-03', 'music',   'suno',       'Suno v3 — 音楽戦線を急拡大'],
    ['2024-04', 'music',   'udio',       'Udio 参戦'],
    ['2024-05', 'general', 'gpt',        'GPT-4o 投入'],
    ['2024-06', 'general', 'claude',     'Claude 3.5 Sonnet 投入'],
    ['2024-06', 'code',    'claude',     'Claude 3.5 Sonnet — コード戦線で突破'],
    ['2024-06', 'video',   'kling',      'Kling 参戦'],
    ['2024-08', 'image',   'flux',       'FLUX.1 参戦'],
    ['2024-09', 'general', 'gpt',        'o1 — 推論型部隊を投入'],
    ['2024-12', 'general', 'deepseek',   'DeepSeek V3 投入'],
    ['2024-12', 'video',   'veo',        'Veo 2 投入'],
    ['2024-12', 'video',   'sora',       'Sora 一般公開'],
    ['2025-01', 'general', 'deepseek',   'DeepSeek R1 — 低コスト奇襲'],
    ['2025-02', 'general', 'grok',       'Grok 3 投入'],
    ['2025-02', 'general', 'claude',     'Claude 3.7 Sonnet 投入'],
    ['2025-03', 'general', 'gemini',     'Gemini 2.5 Pro — 総合戦線で反攻'],
    ['2025-03', 'image',   'gptimage',   'GPT-4o 画像生成 — 画像戦線を席巻'],
    ['2025-04', 'general', 'gpt',        'o3 / GPT-4.1 投入'],
    ['2025-05', 'general', 'claude',     'Claude 4 投入'],
    ['2025-05', 'video',   'veo',        'Veo 3 — 音声付き動画で動画戦線を制圧'],
    ['2025-07', 'general', 'grok',       'Grok 4 投入'],
    ['2025-08', 'general', 'gpt',        'GPT-5 投入'],
    ['2025-08', 'image',   'nanobanana', 'Nano Banana 参戦 — 画像戦線に激震'],
    ['2025-09', 'general', 'claude',     'Claude Sonnet 4.5 投入'],
    ['2025-09', 'video',   'sora',       'Sora 2 投入'],
    ['2025-09', 'music',   'suno',       'Suno v5 投入'],
    ['2025-11', 'general', 'gemini',     'Gemini 3 Pro 投入'],
    ['2025-11', 'general', 'claude',     'Claude Opus 4.5 投入'],
    ['2025-11', 'image',   'nanobanana', 'Nano Banana Pro 投入'],
    ['2026-03', 'general', 'gemini',     '（仮）Gemini 全方位展開 — 布陣は最大、戦力は分散'],
    ['2026-06', 'general', 'claude',     '（仮）Claude 新型投入'],
    ['2026-09', 'general', 'gpt',        '（仮）GPT 新型投入'],
  ].map(([ym, sector, unit, text]) => ({ i: idx(ym), month: ym, sector, unit, text }));

  // ユーティリティ：小数インデックスで補間した値を返す（アニメーション用）
  function at(sectorId, unitId, fi) {
    const arr = series[sectorId][unitId];
    const i0 = Math.max(0, Math.min(months.length - 1, Math.floor(fi)));
    const i1 = Math.min(months.length - 1, i0 + 1);
    const a = arr[i0], b = arr[i1], t = fi - i0;
    if (!a && !b) return null;
    if (!a) return t > 0.5 ? { s: b.s, c: b.c * (t - 0.5) * 2 } : null; // 参戦アニメ
    if (!b) return a;
    return { s: a.s + (b.s - a.s) * t, c: a.c + (b.c - a.c) * t };
  }

  // その月・その戦線の勢力一覧（規模シェア付き）
  function snapshot(sectorId, fi) {
    const list = [];
    for (const uid of Object.keys(units[sectorId])) {
      const v = at(sectorId, uid, fi);
      if (v && v.c > 0.1) list.push({ ...units[sectorId][uid], s: v.s, c: v.c });
    }
    const total = list.reduce((a, u) => a + u.c, 0) || 1;
    list.forEach((u) => (u.share = u.c / total));
    // 総合力 = 強さ × 規模 の混合（並び替え用）
    list.forEach((u) => (u.power = u.s * 0.6 + u.c * 0.4));
    list.sort((a, b) => b.power - a.power);
    return list;
  }

  window.AIWAR = { months, orgs, sectors, units, series, events, at, snapshot, isDummy: true };
})();
