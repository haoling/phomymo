/**
 * アプリの読み書きの窓口(3.4 ゲストモード)
 *
 * localStorage を直接使ってよいのはこのファイルだけ。
 * (tests/09-guest-mode.spec.ts が grep で確かめている)
 *
 * - ゲストモード: Map(メモリ)にだけ置く。タブを閉じる・リロードすると消える
 * - ログイン中: localStorage に、Googleアカウントごとの接頭辞を付けて置く
 *   キー: `phomymo:<accountId>:<key>`
 * - ログイン中かどうかは `phomymo_session` に記録する(ログイン中しか書かない)
 */

const SESSION_KEY = 'phomymo_session';
const NS = 'phomymo:';

/** 旧版(接頭辞なし)が使っていたキーの接頭辞 */
const LEGACY_PREFIX = 'phomymo_';

let mem = new Map();
let session = null; // { accountId, email, name }
const listeners = new Set();

function ls() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function prefix() {
  return `${NS}${session.accountId}:`;
}

// 起動時: ログイン中の記録があればアカウントのキャッシュを使う
(() => {
  try {
    const raw = ls()?.getItem(SESSION_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (s && typeof s.accountId === 'string' && s.accountId) {
      session = { accountId: s.accountId, email: s.email || '', name: s.name || '' };
    }
  } catch {
    session = null;
  }
})();

function emit(key) {
  for (const fn of listeners) {
    try {
      fn(key);
    } catch (e) {
      console.error('kv listener failed:', e);
    }
  }
}

/** ゲストモードか(=何も保存しない) */
export function isGuest() {
  return !session;
}

/** ログイン中のアカウント情報(ゲストなら null) */
export function getSession() {
  return session ? { ...session } : null;
}

export function getItem(key) {
  if (!session) return mem.has(key) ? mem.get(key) : null;
  return ls()?.getItem(prefix() + key) ?? null;
}

export function setItem(key, value) {
  const v = String(value);
  if (!session) {
    mem.set(key, v);
  } else {
    ls().setItem(prefix() + key, v); // QuotaExceededError は呼び出し側へ
  }
  emit(key);
}

export function removeItem(key) {
  if (!session) {
    mem.delete(key);
  } else {
    ls()?.removeItem(prefix() + key);
  }
  emit(key);
}

/** 今のモードで使われているキーの一覧(接頭辞は外す) */
export function keys() {
  if (!session) return [...mem.keys()];
  const store = ls();
  if (!store) return [];
  const p = prefix();
  const out = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(p)) out.push(k.slice(p.length));
  }
  return out;
}

/** 値が変わったら呼ばれる(戻り値で解除) */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * ゲスト → ログイン。以後は localStorage(アカウントごと)に書く。
 * ゲスト中にメモリに置いたものは捨てる(保存しなかったものは破棄する)。
 * 旧版が接頭辞なしで残したデータがあれば、このアカウントに引き取る。
 */
export function startAccountSession({ accountId, email = '', name = '' }) {
  if (!accountId) throw new Error('accountId is required');
  session = { accountId: String(accountId), email, name };
  ls().setItem(SESSION_KEY, JSON.stringify(session));
  mem = new Map();
  adoptLegacyData();
  emit(null);
}

/** ログイン中の表示名などを更新する */
export function updateSessionInfo({ email, name }) {
  if (!session) return;
  if (email !== undefined) session.email = email;
  if (name !== undefined) session.name = name;
  ls()?.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * ログイン → ゲスト。そのアカウントのキャッシュを全部消す。
 * (共用PCでログアウトしたあとにデータが残らないようにするため)
 */
export function endAccountSession() {
  const store = ls();
  if (session && store) {
    const p = prefix();
    const doomed = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(p)) doomed.push(k);
    }
    doomed.forEach(k => store.removeItem(k));
    store.removeItem(SESSION_KEY);
  }
  session = null;
  mem = new Map();
  emit(null);
}

/** 旧版(接頭辞なし)のデータをこのアカウントへ移して、元は消す */
function adoptLegacyData() {
  const store = ls();
  if (!store) return;
  const legacy = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(LEGACY_PREFIX) && k !== SESSION_KEY) legacy.push(k);
  }
  const p = prefix();
  for (const k of legacy) {
    const v = store.getItem(k);
    if (v !== null && store.getItem(p + k) === null) {
      try {
        store.setItem(p + k, v);
      } catch (e) {
        console.warn('Failed to adopt legacy data:', k, e);
        continue;
      }
    }
    store.removeItem(k);
  }
}

/**
 * 別のタブでログイン中のアカウントが変わった(ログアウトされた)ら呼ばれる。
 * このタブがログイン中のときだけ。
 */
export function onSessionChangedElsewhere(fn) {
  window.addEventListener('storage', (e) => {
    if (e.key !== SESSION_KEY && e.key !== null) return;
    if (!session) return;
    let next = null;
    try {
      next = JSON.parse(ls()?.getItem(SESSION_KEY) || 'null');
    } catch { /* ignore */ }
    if (!next || next.accountId !== session.accountId) fn();
  });
}
