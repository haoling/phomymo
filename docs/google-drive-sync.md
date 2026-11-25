# Googleログインと Drive 同期の設定

ゲストモード(未ログイン)は設定なしで動きます。デザインの保存・端末間の同期を使うには、Google Cloud で OAuth クライアントIDを発行して `src/web/config.js` に入れます。

## 1. Google Cloud での準備

1. Google Cloud Console でプロジェクトを作る(既存のものでもよい)
2. 「APIとサービス」→「ライブラリ」で **Google Drive API** を有効にする
3. 「OAuth 同意画面」を作る
   - スコープ: `https://www.googleapis.com/auth/drive.appdata` だけ(推奨・非センシティブ)
   - 自分だけで使うなら「テスト」のままにして、テストユーザーに自分のアカウントを追加する
4. 「認証情報」→「OAuth クライアントID」→ 種類は **ウェブアプリケーション**
   - 承認済みの JavaScript 生成元: `https://<sub>.poko.be` と `http://localhost:8081`(開発用)
   - リダイレクトURIは不要(トークンモデルはポップアップで受け取る)

## 2. アプリに入れる

`src/web/config.js` の `googleClientId` に、発行したクライアントID(`xxxx.apps.googleusercontent.com`)を入れる。

```js
googleClientId: 'xxxx.apps.googleusercontent.com',
```

空のあいだは、ログインボタンが押せない状態でゲストモードだけで動きます。

## しくみ(メモ)

| 項目 | 内容 |
|---|---|
| 保存先 | Drive の appDataFolder(ユーザーからは見えないアプリ専用の領域) |
| ファイル | デザイン1件につき `design-<uuid>.json`。中身は `{ id, name, updatedAt, deleted, design }` |
| 競合 | デザインごとに `updatedAt` が新しいほうが勝つ |
| 削除 | 墓標(`deleted: true`)を置き、30日たったら物理削除(`tombstoneTtlDays`) |
| 手元 | localStorage はキャッシュ。キーは `phomymo:<GoogleアカウントのpermissionId>:<キー>` |
| トークン | メモリにだけ置く。約1時間で切れるので、保存・開く・アカウントのボタンを押したついでに無言で取り直す。だめなら「再接続」 |
| ログアウト | そのアカウントのキャッシュを全部消してゲストに戻る(Drive のデータは残る) |

同期の対象はデザインだけ。印刷設定・マルチラベルのプリセット・カスタム機種・デバイスと機種の割り当ては、アカウントごとの手元のキャッシュには入りますが、Drive には送りません。
