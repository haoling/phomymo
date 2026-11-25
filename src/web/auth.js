/**
 * Googleログイン(Google Identity Services のトークンモデル)
 *
 * - サーバーは置かず、ブラウザだけで完結させる
 * - スコープは drive.appdata だけ
 * - アクセストークンは約1時間で切れる(リフレッシュトークンは無い)
 *   → ボタン操作のついでに requestAccessToken({prompt: ''}) で無言の取り直しを試す
 *   → だめなら「再接続」ボタンを出す(sync.js / account-ui.js)
 * - トークンはメモリにだけ置く(保存しない)
 */

import { CONFIG, isGoogleLoginConfigured } from './config.js';

export class AuthRequiredError extends Error {
  constructor(message = 'Googleへの再接続が必要です', cause) {
    super(message);
    this.name = 'AuthRequiredError';
    this.code = 'AUTH_REQUIRED';
    if (cause) this.cause = cause;
  }
}

let gisPromise = null;
let tokenClient = null;
let accessToken = null;
let expiresAt = 0;
let inflight = null;
const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    try { fn(hasValidToken()); } catch (e) { console.error(e); }
  }
}

/** トークンの有無が変わったら呼ばれる */
export function onTokenChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function gis() {
  return window.google?.accounts?.oauth2;
}

/** GIS のスクリプトを読み込む(必要になったときだけ) */
export function loadGis() {
  if (gis()) return Promise.resolve(gis());
  if (!isGoogleLoginConfigured()) return Promise.reject(new Error('Googleログインが設定されていません'));
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CONFIG.gisScriptUrl;
      s.async = true;
      s.defer = true;
      s.onload = () => (gis() ? resolve(gis()) : reject(new Error('Google Identity Services を読み込めませんでした')));
      s.onerror = () => {
        gisPromise = null;
        reject(new Error('Google Identity Services を読み込めませんでした'));
      };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

/** GIS がすでに使える状態か(同期的に呼ぶ必要がある場面のため) */
export function isGisReady() {
  return !!gis();
}

function ensureClient() {
  if (tokenClient) return tokenClient;
  const oauth2 = gis();
  if (!oauth2) throw new Error('Google Identity Services が読み込まれていません');
  tokenClient = oauth2.initTokenClient({
    client_id: CONFIG.googleClientId,
    scope: CONFIG.driveScope,
    callback: () => {},
  });
  return tokenClient;
}

/**
 * アクセストークンを取る
 * @param {{prompt?: string, hint?: string, timeoutMs?: number}} opts
 *   prompt: '' なら無言での取り直し、'select_account' ならアカウントを選ばせる
 * @returns {Promise<string>}
 */
export function requestToken({ prompt = '', hint = '', timeoutMs = 0 } = {}) {
  if (inflight) return inflight;
  let client;
  try {
    client = ensureClient();
  } catch (e) {
    return Promise.reject(e);
  }
  inflight = new Promise((resolve, reject) => {
    let timer = null;
    const done = (fn, v) => {
      if (timer) clearTimeout(timer);
      inflight = null;
      fn(v);
    };
    client.callback = (resp) => {
      if (!resp || resp.error || !resp.access_token) {
        done(reject, new AuthRequiredError(resp?.error_description || resp?.error || 'ログインできませんでした'));
        return;
      }
      accessToken = resp.access_token;
      expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      emit();
      done(resolve, accessToken);
    };
    client.error_callback = (err) => {
      // popup_failed_to_open / popup_closed など
      done(reject, new AuthRequiredError(err?.message || err?.type || 'ログインできませんでした'));
    };
    if (timeoutMs > 0) {
      timer = setTimeout(() => done(reject, new AuthRequiredError('ログインの応答がありませんでした')), timeoutMs);
    }
    const params = { prompt };
    if (hint) params.hint = hint; // login_hint
    try {
      client.requestAccessToken(params);
    } catch (e) {
      done(reject, new AuthRequiredError(e.message, e));
    }
  });
  return inflight;
}

export function hasValidToken() {
  return !!accessToken && Date.now() < expiresAt - 30 * 1000;
}

/** 期限が近い(または無い)か */
export function needsRefreshSoon() {
  return !accessToken || Date.now() > expiresAt - CONFIG.tokenRefreshMarginMs;
}

/** 有効なトークン(無ければ AuthRequiredError) */
export function getAccessToken() {
  if (!hasValidToken()) throw new AuthRequiredError();
  return accessToken;
}

/** Drive API が 401 を返したときなど、手元のトークンを捨てる */
export function invalidateToken() {
  if (!accessToken) return;
  accessToken = null;
  expiresAt = 0;
  emit();
}

/** ログアウト: トークンを取り消して捨てる */
export function revokeToken() {
  const t = accessToken;
  accessToken = null;
  expiresAt = 0;
  emit();
  if (t && gis()?.revoke) {
    try { gis().revoke(t, () => {}); } catch { /* ignore */ }
  }
}
