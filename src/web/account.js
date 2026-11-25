/**
 * ログイン / ログアウト / 再接続(3.3, 3.4)
 */

import { isGoogleLoginConfigured } from './config.js';
import * as kv from './kv.js';
import * as auth from './auth.js';
import * as sync from './sync.js';
import { countUnsyncedDesigns } from './storage.js?v=102';

export { isGoogleLoginConfigured };

/** ログイン中なら同期を始める(起動時) */
export function restore() {
  if (kv.isGuest()) return;
  sync.start();
  // GIS は先に読んでおく(再接続ボタンを押したときにすぐ開けるように)
  if (isGoogleLoginConfigured()) {
    auth.loadGis().catch(e => console.warn(e));
  }
}

/** 使う直前に GIS を読み込んでおく(ポップアップをクリック直後に開くため) */
export function preload() {
  if (isGoogleLoginConfigured()) return auth.loadGis().catch(e => { console.warn(e); });
  return Promise.resolve();
}

/**
 * Googleでログインする(ボタンのクリックから呼ぶこと)
 * @returns {Promise<{email: string, name: string}>}
 */
export async function login() {
  if (!isGoogleLoginConfigured()) throw new Error('Googleログインが設定されていません');
  await auth.loadGis();
  await auth.requestToken({ prompt: 'select_account' });
  const about = await sync.getDrive().getAbout();
  const user = about?.user || {};
  if (!user.permissionId) throw new Error('Googleアカウントの情報を取得できませんでした');
  kv.startAccountSession({
    accountId: user.permissionId,
    email: user.emailAddress || '',
    name: user.displayName || '',
  });
  sync.start();
  await sync.syncNow();
  return { email: user.emailAddress || '', name: user.displayName || '' };
}

/**
 * トークンが切れたあとの再接続(ボタンのクリックから呼ぶこと)
 * 別のアカウントを選ばれたら、そのトークンは捨ててエラーにする
 */
export async function reconnect() {
  const session = kv.getSession();
  if (!session) throw new Error('ログインしていません');
  await auth.loadGis();
  await auth.requestToken({ prompt: '', hint: session.email });
  const about = await sync.getDrive().getAbout();
  if (about?.user?.permissionId !== session.accountId) {
    auth.revokeToken();
    throw new Error(`ログイン中のアカウント(${session.email})とは別のアカウントが選ばれました`);
  }
  kv.updateSessionInfo({ email: about.user.emailAddress || session.email, name: about.user.displayName || session.name });
  await sync.syncNow();
}

/**
 * ボタン操作のついでに、期限が近いトークンを無言で取り直す。
 * (クリックの直後でないとポップアップがブロックされるため、クリックのハンドラから同期的に呼ぶ)
 */
export function refreshTokenInGesture() {
  if (kv.isGuest() || !auth.isGisReady() || !auth.needsRefreshSoon()) return;
  const session = kv.getSession();
  auth.requestToken({ prompt: '', hint: session?.email || '', timeoutMs: 15000 })
    .then(() => sync.syncNow())
    .catch(() => { /* 再接続ボタンで対応 */ });
}

/** まだ Drive に送っていない変更の数 */
export function unsyncedCount() {
  return kv.isGuest() ? 0 : countUnsyncedDesigns();
}

/**
 * ログアウト: トークンを取り消し、このアカウントのキャッシュを全部消してゲストに戻る
 * (確認はUI側で行う)
 */
export function logout() {
  sync.stop();
  auth.revokeToken();
  kv.endAccountSession();
}
