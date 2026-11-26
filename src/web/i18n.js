/**
 * 表示言語(日本語 / English)の切り替え
 *
 * - 文言は i18n-messages.js に { ja, en } の組で置く
 * - HTML は data-i18n="キー"(textContent)、data-i18n-html(innerHTML)、
 *   data-i18n-title / -placeholder / -aria-label / -alt / -label(属性)で指定する
 * - JS からは t('キー', { 差し込み }) で引く。{name} の形で差し込める
 * - 言語の設定は kv.js に置く(ゲストモードではタブを閉じると消える)。
 *   設定がなければブラウザの言語が日本語なら日本語、ほかは英語
 */
import * as kv from './kv.js';
import { MESSAGES as BASE_MESSAGES } from './i18n-messages.js';
import { AI_BINARIZE_MESSAGES } from './i18n-messages-ai.js';

// 機能ごとに分けたファイルの文言もまとめて引けるようにする
const MESSAGES = { ...BASE_MESSAGES, ...AI_BINARIZE_MESSAGES };

export const LANGS = ['ja', 'en'];
const KV_KEY = 'ui_lang';

const listeners = new Set();
let lang = detect();

function detect() {
  const saved = kv.getItem(KV_KEY);
  if (LANGS.includes(saved)) return saved;
  const nav = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || '';
  return nav.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/** 今の表示言語('ja' | 'en') */
export function getLang() {
  return lang;
}

/**
 * 文言を引く。見つからなければキーをそのまま返す。
 * 値が関数なら params を渡して呼ぶ(英語の単数・複数など)。
 */
export function t(key, params = {}) {
  const m = MESSAGES[key];
  if (!m) {
    console.warn('[i18n] missing key:', key);
    return key;
  }
  let s = m[lang] ?? m.ja;
  if (typeof s === 'function') s = s(params);
  return String(s).replace(/\{(\w+)\}/g, (all, name) => (name in params ? String(params[name]) : all));
}

/** 指定した範囲(省略時はページ全体)の data-i18n* を今の言語で書き換える */
export function applyI18n(root = document) {
  if (!root?.querySelectorAll) return;
  const each = (sel, fn) => {
    if (root.matches?.(sel)) fn(root);
    root.querySelectorAll(sel).forEach(fn);
  };
  each('[data-i18n]', el => { el.textContent = t(el.dataset.i18n); });
  each('[data-i18n-html]', el => { el.innerHTML = t(el.dataset.i18nHtml); });
  for (const attr of ['title', 'placeholder', 'aria-label', 'alt', 'label']) {
    const ds = 'i18n' + attr.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
    each(`[data-i18n-${attr}]`, el => { el.setAttribute(attr, t(el.dataset[ds])); });
  }
}

/** 言語を変える(保存して、画面を書き換えて、登録された関数を呼ぶ) */
export function setLang(next, { save = true } = {}) {
  if (!LANGS.includes(next)) return;
  if (save) {
    try {
      kv.setItem(KV_KEY, next);
    } catch (e) {
      console.warn('[i18n] could not save language:', e);
    }
  }
  if (next === lang) return;
  lang = next;
  refresh();
  listeners.forEach(fn => {
    try {
      fn(lang);
    } catch (e) {
      console.error('[i18n] listener failed:', e);
    }
  });
}

/** 言語が変わったら呼ばれる(戻り値で解除) */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function refresh() {
  document.documentElement.lang = lang;
  applyI18n(document);
  document.querySelectorAll('select.lang-select').forEach(sel => { sel.value = lang; });
}

/** 言語の選択欄をつなぐ。ログイン・ログアウトで設定が変わったときも追従する */
function init() {
  refresh();
  document.querySelectorAll('select.lang-select').forEach(sel => {
    sel.addEventListener('change', () => setLang(sel.value));
  });
  kv.onChange(key => {
    if (key !== null && key !== KV_KEY) return;
    const next = detect();
    if (next !== lang) setLang(next, { save: false });
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}
