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
  guest: { dot: 'acct-dot-gray', label: 'ゲスト', title: 'ゲストモード: デザインや設定はどこにも保存されません' },
  off: { dot: 'acct-dot-gray', label: 'ログイン中', title: '' },
  syncing: { dot: 'acct-dot-blue', label: '同期中…', title: 'Google Drive と同期しています' },
  synced: { dot: 'acct-dot-green', label: '同期済み', title: 'Google Drive と同期済み' },
  pending: { dot: 'acct-dot-amber', label: '未送信', title: 'まだ Drive に送っていない変更があります' },
  'needs-auth': { dot: 'acct-dot-red', label: '再接続', title: 'Google の接続が切れました。クリックして再接続してください(変更はこの端末に残っています)' },
  error: { dot: 'acct-dot-red', label: '同期エラー', title: '同期に失敗しました。あとでもう一度試します' },
};

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
    let label = view.label;
    if (key === 'pending') label = `未送信 ${st.unsynced}`;
    $('#account-label').textContent = label;
    btn.title = session ? `${session.email}\n${view.title}` : view.title;
  }
  const mobileLabel = $('#mobile-account-label');
  if (mobileLabel) {
    mobileLabel.textContent = session ? `アカウント: ${session.email || session.name}` : 'ゲストモード(ログイン)';
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
    $('#account-name').textContent = session.name || session.email || 'Googleアカウント';
    $('#account-email').textContent = session.email || '';
    let text = view.title;
    if (key === 'synced' && st.lastSyncedAt) text = `Google Drive と同期済み(${formatTime(st.lastSyncedAt)})`;
    if (key === 'pending') text = `まだ Drive に送っていない変更が ${st.unsynced} 件あります`;
    if (key === 'error' && st.error) text = `同期に失敗しました: ${st.error}`;
    if (key === 'needs-auth' && st.unsynced > 0) text += `(未送信 ${st.unsynced} 件)`;
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
    ? 'ログインすると、保存したデザインを開けます。'
    : 'ログインすると保存できます。';
  showAccountDialog(msg);
}

export function isGuest() {
  return kv.isGuest();
}

async function handleLogin() {
  const btn = $('#account-login-btn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'ログインしています…';
  try {
    const user = await account.login();
    hideAccountDialog();
    render();
    hooks.showToast(`${user.email || user.name} でログインしました`, 'success');
    hooks.setStatus('ログインしました。デザインは Google Drive に保存されます');
    hooks.refreshLoadDialog();
    // ゲストモードで作っていたデザインがあれば、保存するか聞く
    if (hooks.hasWork()) {
      hooks.openSaveDialog({ title: '作業中のデザインを Drive に保存しますか?' });
    }
  } catch (e) {
    console.error('Login failed:', e);
    hooks.showToast(`ログインできませんでした: ${e.message}`, 'error');
  } finally {
    btn.textContent = original;
    render();
  }
}

async function handleReconnect() {
  try {
    await account.reconnect();
    hooks.showToast('再接続しました', 'success');
  } catch (e) {
    hooks.showToast(`再接続できませんでした: ${e.message}`, 'error');
  }
  render();
}

function handleLogout() {
  const n = account.unsyncedCount();
  const base = 'ログアウトすると、この端末に残っているデザインや設定のキャッシュを消して、ゲストモードに戻ります。\n(Google Drive のデータは残ります。編集中の内容は閉じます)';
  const msg = n > 0
    ? `⚠ まだ Drive に送っていない変更が ${n} 件あります。ログアウトすると失われます。\n\n${base}\n\nそれでもログアウトしますか?`
    : `${base}\n\nログアウトしますか?`;
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
  sync.onPulled(() => hooks.refreshLoadDialog());
  account.restore();
  render();
}
