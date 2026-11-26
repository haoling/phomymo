# Googleスプレッドシートからの差し込み

ログイン中は、差し込み印刷のパネルとデータ画面に「Googleスプレッドシートから」が出る。押すと Google のファイル選択画面(Google Picker)が開き、選んだスプレッドシートを読み込む。連携したシートはデザインと一緒に保存され(`design.mergeSource`)、次にそのデザインを開くと同じシートの最新を読み込む。

## 方式と OAuth 審査への影響

| 項目 | 内容 |
|---|---|
| 追加のスコープ | `https://www.googleapis.com/auth/drive.file`(非機密・Google 推奨) |
| 求めるタイミング | 「Googleスプレッドシートから」を初めて押したときだけ(段階的な認可、`include_granted_scopes`)。ログインの同意画面は今までどおり `drive.appdata` だけ |
| 読めるもの | 利用者が Picker で選んだスプレッドシートだけ。一度選べば、同じアカウントなら別の端末でも読める |
| 読み方 | Sheets API `spreadsheets.get`(シート名)と `values:batchGet`(表示形式どおりの文字)。書き込みはしない |
| 審査 | 機密/制限付きスコープの審査は**不要**。同意画面の「データアクセス」に `drive.file` を足し、ブランド確認のままでよい |

`spreadsheets.readonly` や `drive.readonly` を使えば Picker なしで URL から読めるが、これらは機密/制限付きスコープで審査(動画・場合によってはセキュリティ評価)が要るので避けた。

## Google Cloud 側の設定(はおりんがやること)

プロジェクト(クライアントIDと同じ `47606521143`)で:

1. 「API とサービス」→「ライブラリ」で **Google Sheets API** と **Google Picker API** を有効にする
2. 「認証情報」→「認証情報を作成」→「API キー」
   - アプリケーションの制限: **ウェブサイト**、`https://phomymo.poko.be/*`(プレビューを使うなら `https://*-phomymo.ayapanda.workers.dev/*` も)
   - API の制限: **Google Picker API** だけ
   - できたキーを `src/web/config.js` の `googleApiKey` に入れる(公開してよい値。2026-11-26 に設定済み)
3. 「OAuth 同意画面」→「データアクセス」→「スコープを追加」で `.../auth/drive.file` を足す

`googleApiKey` が空でも Picker は開こうとするが、Google はキーを付けるよう求めている。

## 保存する値(design.mergeSource)

```json
{ "type": "gsheet", "spreadsheetId": "…", "name": "商品リスト", "sheetId": 42, "sheetName": "在庫", "rowRange": "2-3" }
```

- `sheetId` で同じシートを探す(名前を変えても追える)。見つからなければ名前、それも無ければ差し込み項目と合う列がいちばん多いシートを読み、知らせる
- `rowRange` は「印刷する行」を全部にしていないときだけ
- 読み込んだ値は今までどおり `templateData` にも保存する(読めないときやログアウト中はそれを表示)
- CSV/Excel/貼り付けで読み込む、「すべて消す」「連携をやめる」で連携は外れる

## コード

- `src/web/gsheets.js`: 許可(drive.file)・Picker・Sheets API
- `src/web/auth.js`: `requestToken({scope})` と `hasScope()`(許可されたスコープを覚える)
- `src/web/app.js` の「GOOGLE SHEETS」節: 画面と保存・復元
- テスト: `tests/21-gsheet-merge.spec.ts`(偽の Picker と Sheets API は `tests/helpers/fake-google.ts`)
