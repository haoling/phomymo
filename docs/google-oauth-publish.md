# Googleログインを一般公開する(OAuth 同意画面の「本番環境」)

`docs/google-drive-sync.md` の設定(クライアントID発行)が済んでいる前提です。

## スコープの区分

| スコープ | 区分 | 審査 |
|---|---|---|
| `https://www.googleapis.com/auth/drive.appdata` | 非機密(non-sensitive) | 機密/制限付きスコープの審査(動画・セキュリティ評価)は**不要** |
| `https://www.googleapis.com/auth/drive.file` | 非機密(non-sensitive・推奨) | **不要**。「Googleスプレッドシートから」差し込むときだけ追加で求める(`sheetsScope`、くわしくは `docs/google-sheets-merge.md`) |

ログインのときに求めるのは drive.appdata だけ(`src/web/config.js` の `driveScope`)。`openid` / `email` / `profile` は使っていない(表示名とメールは Drive API の `about` から取る)。

非機密スコープだけなら「本番環境」に切り替えるだけで誰でもログインできる。ただし**アプリ名やロゴを同意画面に出す場合は「ブランドの確認(Verify Branding)」が必要**。確認に通るまでは、アプリ名の代わりにドメインが出たり「未確認のアプリ」と出たりする。

## ブランド確認に必要なもの

1. **独自ドメイン**(Search Console で所有確認できるもの)。`*.workers.dev` はおすすめしない(Search Console の所有確認が難しく、第三者のホスティングとみなされやすい)。
2. **ホームページ**: 認証なしで見られ、アプリの説明・Google データを使う理由・プライバシーポリシーへのリンクがあること → `about.html`
3. **プライバシーポリシー**: ホームページと同じドメインで、Google ユーザーデータの扱いと Limited Use の宣言があること → `privacy.html`
4. **利用規約**(任意だが入れておく) → `terms.html`
5. **ロゴ** 120x120 PNG(1MB 以下) → `src/web/brand/logo-120.png`(大きい版は `logo-512.png`、元データは `logo.svg`)
6. 承認済みドメインに、ホームページ・ポリシー・JavaScript 生成元のドメインをすべて入れる

## 同意画面(「ブランディング」ページ)に入れる値

仮決め: 本番ドメインは `phomymo.poko.be`。違うドメインにするなら、下の URL のドメイン部分を差し替える。

| 項目 | 値 |
|---|---|
| アプリ名 | `Phomymo` |
| ユーザーサポートメール | 自分の Gmail / Workspace のアドレス |
| アプリのロゴ | `src/web/brand/logo-120.png` |
| アプリのホームページ | `https://phomymo.poko.be/about.html` |
| プライバシーポリシーのリンク | `https://phomymo.poko.be/privacy.html` |
| 利用規約のリンク | `https://phomymo.poko.be/terms.html` |
| 承認済みドメイン | `poko.be` |
| デベロッパーの連絡先メール | 自分のアドレス |
| 対象 | 外部 → 公開ステータス「本番環境」 |
| データアクセス(スコープ) | `.../auth/drive.appdata` と `.../auth/drive.file`(どちらも非機密) |

OAuth クライアント(ウェブアプリケーション)の「承認済みの JavaScript 生成元」に `https://phomymo.poko.be` を足す。

## 手順

1. Cloudflare: Workers の `phomymo` → Settings → Domains & Routes → Custom Domain に `phomymo.poko.be` を追加
2. Search Console: ドメインプロパティ `poko.be` を DNS の TXT レコードで確認(同意画面を編集する Google アカウントで)
3. 上の表のとおり同意画面を入力 → 「ブランディングを確認」→ 通ったら「ブランディングを公開」
4. 「対象」で公開ステータスを「本番環境」にする
5. (済)GitHub リポジトリの Issues を有効にする(ポリシーと規約の問い合わせ先)
