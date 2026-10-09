# AI WAR（電脳戦況モニター）

> 非公式・非商用のプロジェクトです。各 AI 企業とは関係ありません。

**サイト：<https://ukitako1030.github.io/EVAL/>** · [English](README.en.md)

![AI WAR の画面。中央の大きな惑星が総合戦線、まわりの惑星がコード・エージェント・画像・動画・音声・音楽の戦線。右にランキングと陣営展開、下に 2022 年から現在までのタイムライン。](mockups/shots/site-galaxy-latest.jpg)

| 惑星にズームした戦闘 | スマホ |
| --- | --- |
| ![総合戦線にズームし、粒子の部隊がぶつかり合う画面](mockups/shots/site-zoom-general.jpg) | ![スマホ縦画面の全体マップ](mockups/shots/site-galaxy-latest-mobile.jpg) |

## AI WAR とは

ChatGPT のような文章 AI、画像・動画・音声・音楽の生成 AI、パソコンを操作するエージェントなど、AI の**いまの立ち位置**を描くサイトです。公開されている客観的なデータをもとに、サイバー空間の銀河で戦う「戦況」として眺められます。

- **軍**は企業、**部隊**は製品ファミリー（GPT、Claude、Gemini など）、**戦線（惑星）**は分野です。戦線は総合・コード・エージェント・画像・動画・音声・音楽の 7 つ。
- **領土の広さ＝規模**：どれだけ使われ、広まっているか。公式発表の利用者数、Web のアクセス順位、OpenRouter の利用シェア、注目度などから計算します。
- **輝き・攻勢＝強さ**：ベンチマークとユーザー投票。Arena、SWE-bench、METR、OSWorld、τ²-bench、Epoch AI、Design Arena などを使います。
- **霧**がかかった部分は、データが少なく推定を含みます。
- 2022 年 11 月（ChatGPT 公開＝開戦）から現在までを、月ごとに再生できます。見る人は操作せず「観戦」します。

使っているデータ源・ライセンス・計算方法は、サイトの「**データと方法**」ページにすべて載せています。

## 更新のしくみ

毎週月曜に GitHub Actions がデータを取得し、`site/public/data/world.json` を計算し直して、テストを通してから更新の提案（プルリクエスト）を作ります。運営者が中身を確認して承認するまで、サイトは変わりません。サイトが読むのはこの JSON ファイル 1 つだけです。

- `pipeline/`：データの収集と計算（TypeScript、Node 24）
- `site/`：サイト本体（Vite、PixiJS）

```
cd pipeline && npm ci && npm run fetch && npm run compute
cd site && npm ci && npm run dev
```

運営者向けの詳しい手順は [`docs/運営マニュアル.md`](docs/運営マニュアル.md) にあります。

## ライセンス

- **プログラム（コード）**：MIT ライセンス（[`LICENSE`](LICENSE)）。
- **データ**：MIT の対象はコードだけです。`pipeline/raw/`、`pipeline/curated/`、`site/public/data/` のデータは、それぞれのデータ源のライセンスと条件に従います（[`pipeline/raw/LICENSES.md`](pipeline/raw/LICENSES.md)）。CC BY-NC（非営利のみ）のデータ源を含むため、データを営利目的に使うことはできません。
- 企業のロゴは使わず、名前と色で表しています。社名・製品名は各社の商標です。

## 免責

数字は公開データをもとにした計算結果で、データが少ない部隊には推定が含まれます（霧で示しています）。公式な評価や順位ではありません。
