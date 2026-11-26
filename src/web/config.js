/**
 * Phomymo の設定値(あとから差し替えるもの)
 *
 * - googleClientId: Google Cloud で発行した OAuth クライアントID(ウェブアプリケーション)。
 *   空のあいだは Googleログインを出さず、ゲストモードだけで動く。
 * - テストや開発では、ページ読み込み前に window.__PHOMYMO_CONFIG__ を置くと上書きできる。
 */
const overrides = (typeof globalThis !== 'undefined' && globalThis.__PHOMYMO_CONFIG__) || {};

export const CONFIG = Object.freeze({
  // Google Cloud で発行したクライアントID(公開してよい値。シークレットは使わない)
  googleClientId: '47606521143-icbdpla7k3rtn26gcair90ec2rj9i3ub.apps.googleusercontent.com',
  // Drive のアプリ専用領域だけを使う(推奨・非センシティブなスコープ)
  driveScope: 'https://www.googleapis.com/auth/drive.appdata',
  // Google Identity Services のスクリプト
  gisScriptUrl: 'https://accounts.google.com/gsi/client',
  // Drive API の置き場所
  driveApiBase: 'https://www.googleapis.com',
  // デザインを変更してから Drive に送るまでの待ち時間
  syncDebounceMs: 1500,
  // 定期的に Drive の変更を取りに行く間隔(タブが表示されているときだけ)
  syncIntervalMs: 5 * 60 * 1000,
  // 削除の墓標を残しておく日数(これを過ぎたら物理削除する)
  tombstoneTtlDays: 30,
  // トークンの残りがこれより短ければ、ボタン操作のついでに取り直す
  tokenRefreshMarginMs: 5 * 60 * 1000,
  ...overrides,
});

export function isGoogleLoginConfigured() {
  return !!CONFIG.googleClientId;
}
