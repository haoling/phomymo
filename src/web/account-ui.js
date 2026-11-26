/**
 * アカウントと同期の画面まわり(3.3, 3.4)
 *
 * - ヘッダーのチップ: ゲスト / 同期済み / 同期中 / 未送信 / 再接続 を表示
 * - アカウントのダイアログ: ログイン・ログアウト・今すぐ同期・再接続
 * - ゲストモードでは、作業中のデザインがあればタブを閉じる前に確認する
 */

import * as kv from './kv.js';
import * as account from './account.js';
import * as sync from './sync.js';
import { t, onLangChange } from './i18n.js';

const $ = (sel) => document.querySelector(sel);

let hooks = {
  hasWork: () => false,
  openSaveDialog: () => {},
  refreshLoadDialog: () => {},
  setStatus: () => {},
  showToast: () => {},
};
let suppressUnloadWarning = false;

const STATE_VIEW = {
  guest: { dot: 'acct-dot-gray', label: 'acct_guest', title: 'acct_guest_title' },
  off: { dot: 'acct-dot-gray', label: 'acct_signed_in', title: '' },
  syncing: { dot: 'acct-dot-blue', label: 'acct_syncing', title: 'acct_syncing_title' },
  synced: { dot: 'acct-dot-green', label: 'acct_synced', title: 'acct_synced_title' },
  pending: { dot: 'acct-dot-amber', label: 'not_synced', title: 'acct_pending_title' },
  'needs-auth': { dot: 'acct-dot-red', label: 'acct_reconnect', title: 'acct_needs_auth_title' },
  error: { dot: 'acct-dot-red', label: 'acct_sync_error', title: 'acct_sync_error_title' },
};

/** STATE_VIEW の label / title(文言のキー)を今の言語にする */
function viewText(key) {
  return key ? t(key) : '';
}

function viewKey(st) {
  if (kv.isGuest()) return 'guest';
  if (st.state === 'synced' && st.unsynced > 0) return 'pending';
  return STATE_VIEW[st.state] ? st.state : 'off';
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function render() {
  const st = sync.getStatus();
  const key = viewKey(st);
  const view = STATE_VIEW[key];
  const session = kv.getSession();

  // ヘッダーのチップ
  const btn = $('#account-btn');
  if (btn) {
    btn.dataset.state = key;
    const dot = $('#account-dot');
    dot.className = `acct-dot ${view.dot}${key === 'syncing' ? ' acct-pulse' : ''}`;
    let label = viewText(view.label);
    if (key === 'pending') label = t('acct_pending_label', { n: st.unsynced });
    $('#account-label').textContent = label;
    btn.title = session ? `${session.email}\n${viewText(view.title)}` : viewText(view.title);
  }
  const mobileLabel = $('#mobile-account-label');
  if (mobileLabel) {
    mobileLabel.textContent = session ? t('acct_mobile_account', { name: session.email || session.name }) : t('guest_mode_sign_in');
  }

  // ダイアログ
  const guest = !session;
  $('#account-guest').hidden = !guest;
  $('#account-user').hidden = guest;
  if (guest) {
    const configured = account.isGoogleLoginConfigured();
    $('#account-login-btn').disabled = !configured;
    $('#account-login-unconfigured').hidden = configured;
  } else {
    $('#account-name').textContent = session.name || session.email || t('google_account');
    $('#account-email').textContent = session.email || '';
    let text = viewText(view.title);
    if (key === 'synced' && st.lastSyncedAt) text = t('acct_synced_at', { time: formatTime(st.lastSyncedAt) });
    if (key === 'pending') text = t('acct_pending_count', { n: st.unsynced });
    if (key === 'error' && st.error) text = t('acct_sync_failed', { error: st.error });
    if (key === 'needs-auth' && st.unsynced > 0) text += t('acct_unsynced_suffix', { n: st.unsynced });
    $('#account-sync-status').textContent = text;
    $('#account-sync-status').dataset.state = key;
    $('#account-reconnect').hidden = key !== 'needs-auth';
    $('#account-sync-now').hidden = key === 'needs-auth';
    $('#account-sync-now').disabled = key === 'syncing';
  }
}

/**
 * アカウントのダイアログを開く
 * @param {string} [reason] - 上に出す案内(例: 「ログインすると保存できます」)
 */
export function showAccountDialog(reason = '') {
  account.preload();
  const r = $('#account-reason');
  r.textContent = reason;
  r.hidden = !reason;
  render();
  $('#account-dialog').hidden = false;
}

export function hideAccountDialog() {
  $('#account-dialog').hidden = true;
}

/** ゲストモードで「保存」「開く」を押したときの案内 */
export function showGuestNotice(kind = 'save') {
  const msg = kind === 'load'
    ? t('account_reason_load')
    : t('account_reason_save');
  showAccountDialog(msg);
}

export function isGuest() {
  return kv.isGuest();
}

async function handleLogin() {
  const btn = $('#account-login-btn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = t('acct_signing_in');
  try {
    const user = await account.login();
    hideAccountDialog();
    render();
    hooks.showToast(t('acct_signed_in_as', { name: user.email || user.name }), 'success');
    hooks.setStatus(t('acct_signed_in_status'));
    hooks.refreshLoadDialog();
    // ゲストモードで作っていたデザインがあれば、保存するか聞く
    if (hooks.hasWork()) {
      hooks.openSaveDialog({ title: t('acct_save_current_to_drive') });
    }
  } catch (e) {
    console.error('Login failed:', e);
    hooks.showToast(t('acct_login_failed', { message: e.message }), 'error');
  } finally {
    btn.textContent = original;
    render();
  }
}

async function handleReconnect() {
  try {
    await account.reconnect();
    hooks.showToast(t('acct_reconnected'), 'success');
  } catch (e) {
    hooks.showToast(t('acct_reconnect_failed', { message: e.message }), 'error');
  }
  render();
}

function handleLogout() {
  const n = account.unsyncedCount();
  const base = t('acct_logout_base');
  const msg = n > 0
    ? t('acct_logout_confirm_unsynced', { n, base })
    : t('acct_logout_confirm', { base });
  if (!confirm(msg)) return;
  account.logout();
  suppressUnloadWarning = true;
  location.reload();
}

/**
 * @param {object} h
 * @param {() => boolean} h.hasWork - 作業中のデザインがあるか(ゲストモードの離脱確認に使う)
 * @param {(opts: {title?: string}) => void} h.openSaveDialog
 * @param {() => void} h.refreshLoadDialog - 同期で一覧が変わったとき
 * @param {(msg: string) => void} h.setStatus
 * @param {(msg: string, type?: string) => void} h.showToast
 */
export function initAccountUI(h = {}) {
  hooks = { ...hooks, ...h };

  $('#account-btn')?.addEventListener('click', () => showAccountDialog());
  $('#mobile-account-btn')?.addEventListener('click', () => showAccountDialog());
  $('#account-close').addEventListener('click', hideAccountDialog);
  $('#account-dialog').addEventListener('click', (e) => {
    if (e.target.id === 'account-dialog') hideAccountDialog();
  });
  $('#account-login-btn').addEventListener('click', handleLogin);
  $('#account-reconnect').addEventListener('click', handleReconnect);
  $('#account-sync-now').addEventListener('click', () => sync.syncNow());
  $('#account-logout').addEventListener('click', handleLogout);

  // ボタン操作のついでにトークンを取り直す(クリック直後でないとポップアップが開けない)
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('#save-btn, #save-confirm, #load-btn, #mobile-save-btn, #mobile-load-btn, #account-btn, #mobile-account-btn')) {
      account.refreshTokenInGesture();
    }
  }, true);

  // ゲストモードでは、作業中のデザインがあればタブを閉じる前に確認する
  window.addEventListener('beforeunload', (e) => {
    if (suppressUnloadWarning || !kv.isGuest() || !hooks.hasWork()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // 別のタブでログアウトされたら、このタブもゲストに戻す
  kv.onSessionChangedElsewhere(() => {
    suppressUnloadWarning = true;
    location.reload();
  });

  sync.onStatus(render);
  onLangChange(render);
  sync.onPulled(() => hooks.refreshLoadDialog());
  account.restore();
  render();
}
