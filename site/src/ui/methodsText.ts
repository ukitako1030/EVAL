import type { Confidence, Lang } from '../data/types';

/**
 * Prose of the "data & method" page (spec §6 / §13, docs/superpowers/recon/first-run.md). Method weights are not in
 * world.json, so they are described qualitatively here; keep this in step with pipeline/config/method.yaml.
 */
export interface MethodsText {
  title: string;
  lead: string;
  purpose: { h: string; p: string[] };
  strength: { h: string; p: string[]; steps: string[] };
  scale: { h: string; p: string[]; steps: string[] };
  confidence: { h: string; p: string[]; levels: Record<Confidence, string> };
  weights: { h: string; p: string[]; items: string[] };
  sources: { h: string; p: string[] };
  otherCredits: { p: string[] };
  limitations: { h: string; items: string[] };
  licence: { h: string };
  unofficial: { h: string; p: string[] };
}

export const METHODS_TEXT: Record<Lang, MethodsText> = {
  ja: {
    title: 'データと方法',
    lead: 'AI WAR が何をどう計算しているか、どのデータを使っているかの説明です。',
    purpose: {
      h: '目的',
      p: [
        'AI WAR は、日々生まれ・更新される AI（LLM、画像・動画・音楽・音声の生成、エージェント）の現在の立ち位置を、公開されている客観的なデータにもとづいて「戦況」として可視化する、非公式・非商用のプロジェクトです。',
        '企業を「軍」、製品ファミリーを「部隊」、分野を「戦線（惑星）」として描き、2022年11月（ChatGPT 公開＝開戦）から現在までの推移を月単位で再生できます。',
      ],
    },
    strength: {
      h: '強さ（0〜100）の計算',
      p: ['強さは「その月の首位にどれだけ迫っているか」です。データ源の生の点数は年々インフレし、採点方法も変わるため、毎月データ源ごとに首位との差へ変換してから合算します。'],
      steps: [
        '部隊の値：ベンチマークはその月末までに出たその部隊のモデルの最高値、対戦型のランキング（Arena など）は月末に最も近いスナップショットでの部隊内の最高レーティングを使います。',
        '首位との差を「首位に対する期待勝率 p」に変換し、200 × p を点数にします（首位＝100）。レーティングは Elo の式、正答率はロジットの差、METR の時間軸は時間の対数の差、Epoch の能力指数は指数の差から計算します。',
        'ベンチマークの版が変わったところ（Arena の集計方法の変更、Terminal-Bench の世代など）は別のデータ源として扱い、生の値をつなげません。',
        'その月にデータがあるデータ源だけで重みを正規化して加重平均します。更新が古くなったデータ源は重みを徐々に下げます。データ源に載っていない部隊は減点せず、確度だけを下げます。',
        '測定が途切れた部隊は、最後の実測値を最大6か月まで引き継ぎます。',
        'データ源の開始前の月は、現在も表に残っている古いモデルの値と発売日から逆算します（確度「再構成」）。',
        '一度も測定されたことのない部隊（使える品質ランキングがない製品）には、その月に実測された部隊の中央値を中立的な仮の値として与え、確度「推定」として霧をかけます。',
        '強さは平滑化しません。新型投入による急変をそのまま見せます。',
      ],
    },
    scale: {
      h: '規模（戦線内シェア %）の計算',
      p: ['規模は戦線の中でのシェアで、戦線ごとに合計100%になります。惑星上の領土の広さとして描きます。'],
      steps: [
        'シグナルごとに戦線内の部隊間シェアを計算し、要素ごとにまとめてから重み付きで合算します。要素は「利用者数（公式発表）」「一般向けの浸透度（Web アクセス：CrUX、Tranco、StatCounter、Cloudflare Radar）」「企業・開発者の利用（OpenRouter）」「注目度（Wikipedia の閲覧数、App Store の評価数）」です。',
        '公式発表の利用者数は出典 URL のあるものだけを使い、発表と発表の間を対数で補間します。最後の発表から6か月を過ぎた値は使いません。MAU・WAU・DAU の違いは係数で揃えます。',
        '画像・動画・音声・音楽の戦線では、部隊ごとに使えるシグナル（製品サイトのアクセス順位、公式発表、注目度、アプリの評価数）を選んで使います。',
        '基本のシグナルがない部隊には、ほかの部隊の中央値をもとにした控えめな値を割り当て、確度を下げます。',
        '3か月の移動平均で平滑化し、戦線内の合計が100%になるよう正規化します。',
      ],
    },
    confidence: {
      h: '確度と霧',
      p: ['数値の確かさを4段階で示し、確かでないほど濃い霧をかけます。部隊の確度は、強さの確度と規模の確度のうち低いほうです（詳細パネルでは両方を別々に表示します）。'],
      levels: {
        high: '強さのデータ源が2つ以上あり、規模も実測。霧なし。',
        medium: '実測のデータ源が1つ。薄い霧。',
        reconstructed: 'データ源の開始前を逆算した値。やや濃い霧。',
        estimated: '使える実測がなく推定した値（一度も測定されていない部隊を含む）。濃い霧。',
      },
    },
    weights: {
      h: '現在の重み（概要）',
      p: ['重みは設定ファイルで管理し、変更は更新履歴に残します。おおまかな配分は次のとおりです。'],
      items: [
        '総合：Arena（テキスト）と Epoch Capabilities Index をほぼ同じ重みで使います。',
        'コード：SWE-bench Verified、Terminal-Bench、Arena（WebDev・コーディング）、LiveBench を組み合わせ、Aider は2023〜2025年の補完に使います。',
        'エージェント：METR の時間軸を最も重く、次に OSWorld、τ²-bench、Vending-Bench などを使います。',
        '画像・動画・音声・音楽：Arena 系のランキングを主に、Design Arena などを補助に使います。',
        '規模：公式発表の利用者数を最も重く、次に一般向けの浸透度、企業・開発者の利用、注目度の順です。',
      ],
    },
    sources: {
      h: 'データ源',
      p: ['各データ源のライセンスとクレジット表記に従って利用しています。取得日は、このサイトのデータを作るためにそのデータ源を最後に取得した日です。'],
    },
    otherCredits: { p: ['人が確認して追加した情報（公式発表の利用者数など）の出典です。個々の数値の出典リンクは詳細パネルに表示します。'] },
    limitations: {
      h: '既知の偏りと限界',
      items: [
        '他のアプリに組み込まれた製品（ChatGPT の中の GPT Image、Gemini の中の Nano Banana、Doubao・Jimeng の中の Seedream・Seedance など）は利用者を切り分けられず、規模は注目度や共有ドメインに頼っています（例：labs.google は Nano Banana と Veo で共有）。',
        'Suno・Udio・Midjourney には使える条件で公開された品質ランキングがないため、強さは推定（霧）です。',
        '音声戦線の過去の強さの多くは推定です。TTS Arena には OpenAI や Google の音声が載っていません。',
        'OpenRouter の利用データは過去の期間が短く、それより前の「企業・開発者の利用」はほかのシグナルで補っています。',
        'Arena は大手のモデルに、OpenRouter は安価なモデルに偏りがちです。複数のデータ源を混ぜて偏りを薄めていますが、なくなるわけではありません。',
        '更新が止まったデータ源は、時間がたつと重みが下がり、やがて使われなくなります。',
        '当月の値は月の途中までのデータによる速報値です。',
      ],
    },
    licence: { h: 'データのライセンス' },
    unofficial: {
      h: '非公式・非商用',
      p: [
        '各社とは無関係の非公式・非商用プロジェクトです。収益化はしていません。',
        '企業のロゴは使わず、名前と色だけで表現しています。各データ源の利用条件（非商用ライセンスを含む）に従っています。',
      ],
    },
  },
  en: {
    title: 'Data & method',
    lead: 'What AI WAR computes, how, and from which data.',
    purpose: {
      h: 'Purpose',
      p: [
        'AI WAR is an unofficial, non-commercial project that shows where today’s AI products (LLMs, image, video, music and speech generation, agents) stand, as a “battlefield” drawn from public, objective data.',
        'Companies are factions, product families are units and fields are fronts (planets). You can replay the war month by month from November 2022 (the launch of ChatGPT) to today.',
      ],
    },
    strength: {
      h: 'How strength (0–100) is computed',
      p: ['Strength says how close a unit is to the month’s leader. Raw scores inflate over the years and scoring rules change, so every month each source is first turned into a gap to its leader, and only then are the sources combined.'],
      steps: [
        'A unit’s value: for benchmarks, the best score of the unit’s models released by the end of the month; for head-to-head leaderboards (such as Arena), the unit’s best rating in the snapshot closest to the end of the month.',
        'The gap to the leader becomes an expected win rate p against the leader, and the score is 200 × p (leader = 100). Ratings use the Elo formula, accuracies a logit difference, METR time horizons a log-time difference, and the Epoch Capabilities Index an index difference.',
        'A new version of a benchmark (a change in how Arena is tallied, a new Terminal-Bench generation, …) counts as a separate source; raw values are never stitched together.',
        'Sources are averaged with weights normalised over the sources that have data that month; stale sources fade out gradually. A unit missing from a source is not penalised; only its confidence drops.',
        'When measurements stop, a unit keeps its last measured strength for up to six months.',
        'Months before a source started are back-filled from the older models still on its tables and their release dates (confidence “reconstructed”).',
        'A unit that has never been measured (no usable public quality ranking) gets the median of the month’s measured units as a neutral stand-in, marked “estimated” and drawn in fog.',
        'Strength is not smoothed, so a new model’s jump shows up at once.',
      ],
    },
    scale: {
      h: 'How scale (share of the front, %) is computed',
      p: ['Scale is a unit’s share of its front; each front adds up to 100 %. It is drawn as the territory a unit holds on its planet.'],
      steps: [
        'Each signal gives shares between the units of a front; signals are grouped into components that are blended with weights. The components are users (official figures), consumer reach (web traffic: CrUX, Tranco, StatCounter, Cloudflare Radar), business and developer use (OpenRouter), and attention (Wikipedia page views, App Store rating counts).',
        'Official user counts are used only with a source link; between two announcements they are interpolated on a log scale, and a figure older than six months is dropped. MAU, WAU and DAU are aligned with conversion factors.',
        'On the image, video, speech and music fronts each unit uses the signals that exist for it (product-site traffic rank, announcements, attention, app ratings).',
        'A unit without any base signal gets a modest share derived from the other units’ median, and lower confidence.',
        'Shares are smoothed with a three-month moving average and normalised so each front adds up to 100 %.',
      ],
    },
    confidence: {
      h: 'Confidence and fog',
      p: ['Four levels say how sure a number is; the less sure, the thicker the fog. A unit’s confidence is the lower of its strength and scale confidence (the detail panel shows both).'],
      levels: {
        high: 'Two or more strength sources and measured scale. No fog.',
        medium: 'One measured source. Light fog.',
        reconstructed: 'Back-filled from before a source started. Denser fog.',
        estimated: 'No usable measurement (including never-measured units). Thick fog.',
      },
    },
    weights: {
      h: 'Current weights (overview)',
      p: ['Weights live in a configuration file and every change is kept in the update history. Roughly:'],
      items: [
        'General: Arena (text) and the Epoch Capabilities Index about equally.',
        'Code: SWE-bench Verified, Terminal-Bench, Arena (WebDev and coding) and LiveBench; Aider fills in for 2023–2025.',
        'Agent: METR time horizons weigh most, then OSWorld, τ²-bench, Vending-Bench and others.',
        'Image, video, speech, music: mainly the Arena leaderboards, with Design Arena and others in support.',
        'Scale: official user counts weigh most, then consumer reach, business and developer use, and attention.',
      ],
    },
    sources: {
      h: 'Sources',
      p: ['Every source is used under its licence and with its credit line. “Retrieved” is the last date the source was fetched to build this site’s data.'],
    },
    otherCredits: { p: ['Sources of information added by hand after review (such as official user counts). The link for each figure is shown in the detail panel.'] },
    limitations: {
      h: 'Known biases and limitations',
      items: [
        'Products embedded in other apps (GPT Image in ChatGPT, Nano Banana in Gemini, Seedream and Seedance in Doubao / Jimeng, …) have no clean usage signal; their scale rests on attention or shared hosts (labs.google is shared by Nano Banana and Veo).',
        'Suno, Udio and Midjourney have no public quality ranking under a usable licence, so their strength is estimated (fog).',
        'Much of the speech front’s past strength is estimated; TTS Arena has no OpenAI or Google voices.',
        'OpenRouter usage history is short; before it, business and developer use rests on the other signals.',
        'Arena leans towards big labs and OpenRouter towards cheap models. Mixing sources dilutes these biases but does not remove them.',
        'A source that stops updating loses weight over time and is eventually dropped.',
        'The current month is preliminary: it only covers part of the month.',
      ],
    },
    licence: { h: 'Data licence' },
    unofficial: {
      h: 'Unofficial and non-commercial',
      p: [
        'Unofficial, non-commercial project; not affiliated with any company. It makes no money.',
        'No company logos are used, only names and colours. Every source’s terms (including non-commercial licences) are followed.',
      ],
    },
  },
};
