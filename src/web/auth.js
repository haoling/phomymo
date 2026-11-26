/**
 * Googleログイン(Google Identity Services のトークンモデル)
 *
 * - サーバーは置かず、ブラウザだけで完結させる
 * - スコープはふだん drive.appdata だけ。Googleスプレッドシートから差し込むときだけ
 *   drive.file(アプリで開いたファイルだけ)を追加で求める(段階的な認可)
 * - アクセストークンは約1時間で切れる(リフレッシュトークンは無い)
 *   → ボタン操作のついでに requestAccessToken({prompt: ''}) で無言の取り直しを試す
 *   → だめなら「再接続」ボタンを出す(sync.js / account-ui.js)
 * - トークンはメモリにだけ置く(保存しない)
 */

import { CONFIG, isGoogleLoginConfigured } from './config.js';
import { t } from './i18n.js';

export class AuthRequiredError extends Error {
  constructor(message = t('err_reconnect_required'), cause) {
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
let grantedScopes = new Set();
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
  if (!isGoogleLoginConfigured()) return Promise.reject(new Error(t('err_google_login_unconfigured')));
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CONFIG.gisScriptUrl;
      s.async = true;
      s.defer = true;
      s.onload = () => (gis() ? resolve(gis()) : reject(new Error(t('err_gis_load_failed'))));
      s.onerror = () => {
        gisPromise = null;
        reject(new Error(t('err_gis_load_failed')));
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
  if (!oauth2) throw new Error(t('err_gis_not_loaded'));
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
export function requestToken({ prompt = '', hint = '', timeoutMs = 0, scope = '' } = {}) {
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
        done(reject, new AuthRequiredError(resp?.error_description || resp?.error || t('err_login_failed')));
        return;
      }
      accessToken = resp.access_token;
      // include_granted_scopes で、前に許可したスコープも同じトークンに入る
      grantedScopes = new Set(String(resp.scope || CONFIG.driveScope).split(/\s+/).filter(Boolean));
      expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      emit();
      done(resolve, accessToken);
    };
    client.error_callback = (err) => {
      // popup_failed_to_open / popup_closed など
      done(reject, new AuthRequiredError(err?.message || err?.type || t('err_login_failed')));
    };
    if (timeoutMs > 0) {
      timer = setTimeout(() => done(reject, new AuthRequiredError(t('err_login_no_response'))), timeoutMs);
    }
    const params = { prompt };
    if (hint) params.hint = hint; // login_hint
    if (scope) {
      params.scope = scope;
      params.include_granted_scopes = true;
    }
    try {
      client.requestAccessToken(params);
    } catch (e) {
      done(reject, new AuthRequiredError(e.message, e));
    }
  });
  return inflight;
}

/** 今のトークンにそのスコープが入っているか */
export function hasScope(scope) {
  return hasValidToken() && grantedScopes.has(scope);
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
  grantedScopes = new Set();
  emit();
  if (t && gis()?.revoke) {
    try { gis().revoke(t, () => {}); } catch { /* ignore */ }
  }
}
