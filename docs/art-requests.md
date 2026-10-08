# AI WAR — 画像生成の依頼リスト

画像は**段階2（画面の実装）から使います**。急ぎではないので、都合のよいときに生成してください。
画像がなくても、プログラムで描いた見た目で動きます。入れると質感が上がります。

## 置き場所とルール
- 生成した画像は、リポジトリ直下の **`art-inbox/`** フォルダに、下表のファイル名で保存してください。実装時に私（Claude）が切り抜き・圧縮・着色の調整をして組み込みます。
- **文字・ロゴが入った画像は使えません。** 企業名や実在のロゴに似たものが写っていたら、作り直してください（商標対策）。
- サイズは「生成できる最大サイズ」で構いません。下表のサイズは最低ラインの目安です。
- 依頼文（プロンプト）は英語の方が安定するので、英語のまま貼り付けてください。

## 優先度順の一覧

| 優先 | ファイル名 | 用途 | 向き・サイズ目安 |
|---|---|---|---|
| ★★★ | `planet-general.png` 〜 `planet-music.png`（7枚） | 惑星の表面の質感 | 正方形 1024×1024 以上 |
| ★★★ | `bg-desktop.png` | PCの背景（星雲） | 横長 16:9（1536×1024 以上） |
| ★★ | `bg-mobile.png` | スマホの背景 | 縦長 9:16（1024×1536 以上） |
| ★★ | `keyart.png` | SNSでシェアされたときのサムネイル | 横長（1536×1024 以上） |
| ★ | `insignia-sheet.png` | 軍の記章 16種 | 正方形 1024×1024 以上 |

---

## 1. 惑星の表面テクスチャ（7枚）

**グレースケール（白黒）で作るのがポイント**です。軍の色はプログラムで上から塗るので、元の画像に色が付いていると濁ります。

次の共通文の `{MOTIF}` を、各戦線のモチーフに置き換えて使ってください。

```
Top-down orthographic view of an alien planet's surface texture that fills the entire square frame.
Grayscale only — black, white and shades of grey, absolutely no color.
Even, flat lighting with no strong directional shadows. Medium contrast. Highly detailed.
No horizon, no perspective, no sky, no text, no letters, no logos.
Surface motif: {MOTIF}
```

| ファイル名 | 戦線 | {MOTIF} に入れる文 |
|---|---|---|
| `planet-general.png` | 総合 | a sprawling megacity made of circuitry, data highways and clusters of glowing nodes, like a motherboard grown into a continent |
| `planet-code.png` | コード | dense printed-circuit traces, microchip dies and abstract code-like glyphs etched into metal plates (glyphs must not be readable letters) |
| `planet-agent.png` | エージェント | an industrial landscape of interlocking machine parts, gears, conveyor lines and small drone landing pads |
| `planet-image.png` | 画像 | crystalline terrain of faceted prisms and mineral shards that refract light |
| `planet-video.png` | 動画 | terrain built from overlapping film strips, camera lens rings and frame grids |
| `planet-speech.png` | 音声 | rippling terrain shaped by sound waves, concentric acoustic patterns and waveform-shaped ridges |
| `planet-music.png` | 音楽 | concentric grooves like a vinyl record, crossed by string-like ridges and resonating rings |

## 2. 背景の星雲

### `bg-desktop.png`（横長）
```
A vast deep-space cyber nebula seen from far away. Dark navy-to-black background with subtle teal,
violet and magenta gas clouds, faint digital grid lines and drifting data particles dissolving into
the nebula, scattered tiny stars. Cinematic matte painting, dark cyberpunk sci-fi mood.
Keep the center area dark and low-contrast so that planets and UI overlaid on top remain readable.
No planets, no spaceships, no characters, no text, no logos. Wide 16:9 landscape composition.
```

### `bg-mobile.png`（縦長）
上と同じ文の最後の一文を、次に差し替えてください。
```
Tall 9:16 vertical composition.
```

## 3. シェア用キーアート `keyart.png`
文字は入れずに作ってください。タイトル「AI WAR」はプログラムで重ねます。
```
Epic cinematic key art of a war in a cyber galaxy: one giant glowing central planet surrounded by
six smaller planets, connected by streams of light. Fleets of tiny neon spaceships in different
colors (blue, green, orange, white, magenta, gold) clash between the planets with sparks and energy
beams. Deep-space background, dramatic rim lighting, dark cyberpunk sci-fi style.
Leave the upper-left third relatively empty and dark for a title.
No text, no letters, no logos. Wide landscape composition.
```

## 4. 軍の記章 `insignia-sheet.png`
特定の企業を表すものではなく、汎用の記章セットです。どの軍にどれを割り当てるかは、こちらで決めます。
```
A 4x4 grid of 16 distinct military-style sci-fi insignia emblems, each centered in its own cell with
generous empty space around it. Pure white flat shapes on a pure black background (or transparent
background). Abstract geometric designs: wings, chevrons, stars, shields, circuit patterns, crystals,
rings, arrows. Bold and simple enough to read at a small size.
No letters, no numbers, no text. Must not resemble any existing company or brand logo.
```

---

## 確認のポイント
- 惑星テクスチャに色が付いてしまったら、「grayscale only」を強調して作り直してください。軽い色なら、こちらで白黒に変換するので問題ありません。
- 背景は、中央が明るすぎると上に重ねる惑星や文字が読みにくくなります。暗めのものを選んでください。
- 気に入ったものが複数できたら、全部 `art-inbox/` に入れてください（例：`bg-desktop-2.png`）。比べて選びます。
