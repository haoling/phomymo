# 同梱素材のライセンス

素材集(#27)と枠(#28)で使う素材は、すべてリポジトリに同梱しています(`src/web/assets/`)。
外部の CDN からは読み込まないので、CSP を足すときに素材のための許可は要りません(同じオリジンだけで足ります)。

配信物の中にも同じ内容のライセンス文を `src/web/assets/LICENSES.txt` として置いています。
素材パネルの下部にも、帰属表示(クレジット)を出しています。

| 素材 | 置き場所 | ライセンス | 帰属表示 | 改変 |
|---|---|---|---|---|
| Tabler Icons 3.53.0 | `src/web/assets/tabler/` | MIT | 著作権表示とライセンス文を同梱(必須) | SVG から `class` と透明の背景パスを取り除いただけ。線の太さは挿入するときに変える |
| Twemoji 15.0 (`@twemoji/svg` 15.0.0) | `src/web/assets/twemoji/` | CC-BY 4.0 | 必要。パネルと LICENSES.txt に表示 | なし(挿入するときに PNG に変換し、印刷時に白黒化する) |
| 自作のステッカー | `src/web/assets/stickers/` | MIT(このリポジトリと同じ) | 不要 | — |
| 枠(14種) | `src/web/frames.js`(コードで描画) | MIT(このリポジトリと同じ) | 不要 | — |

## Tabler Icons

- https://tabler.io/icons / https://github.com/tabler/tabler-icons
- MIT License, Copyright (c) 2020-2026 Paweł Kuna
- MIT なので、商用・改変・再配布とも自由。条件は著作権表示とライセンス文を残すことだけ

## Twemoji

- https://github.com/jdecked/twemoji(Twitter が公開していた Twemoji の後継)
- Copyright 2019 Twitter, Inc and other contributors / Copyright 2024 jdecked and other contributors
- グラフィックは CC-BY 4.0(https://creativecommons.org/licenses/by/4.0/)
- 条件は帰属表示(作者名・ライセンス名・ライセンスへのリンク)。アプリでは素材パネルの下部に「絵文字: Twemoji (CC-BY 4.0)」と出している
- 白黒印刷で色がディザに置き換わるのは「改変」にあたりうるが、CC-BY 4.0 は改変を認めている

## 検討したが入れなかったもの

- **Material Symbols**(Apache 2.0): ライセンス上は問題ないが、Tabler Icons と用途が重なるので今回は見送り。足すときは `NOTICE` の同梱が必要
- **Noto Emoji**(Apache 2.0 / OFL): Twemoji で足りたので見送り

## 素材を追加するとき

1. `scripts/asset-list.py` に追加する(Tabler / Twemoji の名前、日本語名、検索用のタグ)
2. `npm pack @tabler/icons @twemoji/svg` で取ってきて展開し、`python3 scripts/build-assets.py <tabler-icons/package> <twemoji-svg/package>` を実行する
3. 新しい入手先を足したときは、この表と `src/web/assets/LICENSES.txt`、`scripts/build-assets.py` の `sources` を更新する(テストで突き合わせている)
