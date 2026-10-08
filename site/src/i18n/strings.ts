import type { Lang } from '../data/types';

export const STRINGS = {
  subtitle: { ja: '電脳戦況モニター', en: 'AI Battlefield Monitor' },
  strength: { ja: '強さ', en: 'Strength' },
  scale: { ja: '規模', en: 'Scale' },
  confidence: { ja: '確度', en: 'Confidence' },
  legendArea: { ja: '領土の広さ＝規模（利用者・展開範囲）', en: 'Territory = scale (users, reach)' },
  legendGlow: { ja: '輝き・攻勢＝強さ（ベンチマーク＋ユーザー投票）', en: 'Glow & push = strength (benchmarks + user votes)' },
  legendFog: { ja: '霧＝推定を含む', en: 'Fog = includes estimates' },
  play: { ja: '再生', en: 'Play' },
  pause: { ja: '一時停止', en: 'Pause' },
  skip: { ja: 'スキップ', en: 'Skip' },
  backToGalaxy: { ja: '銀河に戻る', en: 'Back to galaxy' },
  standings: { ja: '戦況ランキング', en: 'Standings' },
  sortStrength: { ja: '強さ順', en: 'By strength' },
  sortScale: { ja: '規模順', en: 'By scale' },
  deployment: { ja: '陣営展開', en: 'Deployment' },
  breaking: { ja: '戦況速報', en: 'Breaking' },
  methods: { ja: 'データと方法', en: 'Data & method' },
  share: { ja: 'シェア', en: 'Share' },
  copied: { ja: 'リンクをコピーしました', en: 'Link copied' },
  preliminary: { ja: '速報値', en: 'preliminary' },
  lastUpdated: { ja: '最終更新', en: 'Last updated' },
  breakdown: { ja: 'この数値の内訳', en: 'How this number is made' },
  history: { ja: '推移', en: 'History' },
  measured: { ja: '実測', en: 'measured' },
  reconstructed: { ja: '再構成', en: 'reconstructed' },
  estimated: { ja: '推定', en: 'estimated' },
  qHigh: { ja: '高（複数のデータ源）', en: 'High (several sources)' },
  qMedium: { ja: '中（1つのデータ源）', en: 'Medium (one source)' },
  qReconstructed: { ja: '再構成（過去を逆算）', en: 'Reconstructed (back-filled)' },
  qEstimated: { ja: '推定（霧）', en: 'Estimated (fog)' },
  unofficial: { ja: '各社とは無関係の非公式・非商用プロジェクトです', en: 'Unofficial, non-commercial project; not affiliated with any company' },
  clickPlanet: { ja: '惑星をクリックで戦線へ突入', en: 'Click a planet to enter its front' },
  sources: { ja: 'データ源', en: 'Sources' },
  license: { ja: 'ライセンス', en: 'Licence' },
} as const satisfies Record<string, { ja: string; en: string }>;

export type StringKey = keyof typeof STRINGS;

export function tr(key: StringKey, lang: Lang): string {
  return STRINGS[key][lang];
}
