/**
 * Googleスプレッドシートから差し込みデータを読む
 *
 * 方式(OAuth 審査への影響を小さくするため):
 * - スコープは drive.file だけを追加で求める(非センシティブ。審査は不要)
 *   → アプリが読めるのは、利用者が Google Picker で選んだスプレッドシートだけ
 *   → 一度選んだファイルは、同じアカウントなら次からも(別の端末でも)読める
 * - 読み込みは Sheets API の values(表示されている文字のまま)
 * - drive.file は「使うときにだけ」求める(ログイン時の同意画面は drive.appdata のまま)
 */

import { CONFIG, isGoogleLoginConfigured } from './config.js';
import { loadGis, isGisReady, requestToken, hasScope, getAccessToken, invalidateToken, AuthRequiredError } from './auth.js';
import { rowsToTable } from './spreadsheet.js';
import * as kv from './kv.js';
import { t, getLang } from './i18n.js';

/** 一度に読むシートの数の上限(多すぎるブックで止まらないように) */
export const MAX_SHEETS = 30;

export class SheetsError extends Error {
  /**
   * @param {string} code - 'not_found' | 'forbidden' | 'scope_denied' | 'picker_failed' | 'empty' | 'api'
   */
  constructor(code, message, status = 0) {
    super(message || t(`err_gsheet_${code}`));
    this.name = 'SheetsError';
    this.code = code;
    this.status = status;
  }
}

/** スプレッドシートからの差し込みが使えるか(ログイン中で、クライアントIDがある) */
export function isSheetsAvailable() {
  return isGoogleLoginConfigured() && !kv.isGuest();
}

/** drive.file の許可がもう入っていて、ポップアップ無しで読めるか */
export function canReadSilently() {
  return hasScope(CONFIG.sheetsScope);
}

/**
 * drive.file の許可を取る。ボタンのクリックから同期的に呼ぶこと(ポップアップのため)。
 * 許可済みならそのまま。
 */
export function ensureSheetsScope() {
  if (hasScope(CONFIG.sheetsScope)) return Promise.resolve(getAccessToken());
  const session = kv.getSession();
  const go = () => requestToken({ prompt: '', hint: session?.email || '', scope: CONFIG.sheetsScope })
    .then((token) => {
      if (!hasScope(CONFIG.sheetsScope)) throw new SheetsError('scope_denied');
      return token;
    });
  if (isGisReady()) return go();
  return loadGis().then(go);
}

// ---------------------------------------------------------------------------
// Google Picker
// ---------------------------------------------------------------------------

let gapiPromise = null;
let pickerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new SheetsError('picker_failed'));
    document.head.appendChild(s);
  });
}

function loadPicker() {
  if (window.google?.picker) return Promise.resolve(window.google.picker);
  if (!pickerPromise) {
    gapiPromise = gapiPromise || (window.gapi ? Promise.resolve() : loadScript(CONFIG.gapiScriptUrl));
    pickerPromise = gapiPromise.then(() => new Promise((resolve, reject) => {
      window.gapi.load('picker', {
        callback: () => (window.google?.picker ? resolve(window.google.picker) : reject(new SheetsError('picker_failed'))),
        onerror: () => reject(new SheetsError('picker_failed')),
      });
    })).catch((e) => {
      pickerPromise = null;
      gapiPromise = null;
      throw e;
    });
  }
  return pickerPromise;
}

/** Picker の読み込みを先に始めておく(ダイアログを開いたときなど) */
export function preloadPicker() {
  if (!isSheetsAvailable()) return;
  loadPicker().catch(() => { /* 押したときにもう一度試す */ });
}

/**
 * Google Picker でスプレッドシートを選ばせる(ボタンのクリックから呼ぶこと)
 * @returns {Promise<{spreadsheetId: string, name: string} | null>} 取り消したら null
 */
export async function pickSpreadsheet() {
  // 許可のポップアップは、クリック直後(await の前)に開く
  const tokenPromise = ensureSheetsScope();
  const [token, picker] = await Promise.all([tokenPromise, loadPicker()]);
  return new Promise((resolve, reject) => {
    try {
      const view = new picker.DocsView(picker.ViewId.SPREADSHEETS)
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false)
        .setMode(picker.DocsViewMode.LIST);
      const builder = new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setAppId(CONFIG.googleAppId)
        .setLocale(getLang() === 'en' ? 'en' : 'ja')
        .setTitle(t('gsheet_picker_title'))
        .setCallback((data) => {
          const action = data?.[picker.Response.ACTION] ?? data?.action;
          if (action === picker.Action.PICKED) {
            const doc = (data[picker.Response.DOCUMENTS] || data.docs || [])[0];
            if (!doc) { resolve(null); return; }
            resolve({
              spreadsheetId: doc[picker.Document.ID] ?? doc.id,
              name: doc[picker.Document.NAME] ?? doc.name ?? '',
            });
          } else if (action === picker.Action.CANCEL) {
            resolve(null);
          }
        });
      if (CONFIG.googleApiKey) builder.setDeveloperKey(CONFIG.googleApiKey);
      builder.build().setVisible(true);
    } catch (e) {
      console.error(e);
      reject(new SheetsError('picker_failed'));
    }
  });
}

// ---------------------------------------------------------------------------
// Sheets API
// ---------------------------------------------------------------------------

async function call(path, retried = false) {
  const token = getAccessToken();
  const res = await fetch(CONFIG.sheetsApiBase + path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    invalidateToken();
    if (!retried) {
      // 無言で取り直せたら1回だけやり直す(だめなら再接続)
      const session = kv.getSession();
      await requestToken({ prompt: '', hint: session?.email || '', scope: CONFIG.sheetsScope, timeoutMs: 15000 });
      return call(path, true);
    }
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
    if (res.status === 404) throw new SheetsError('not_found', undefined, 404);
    if (res.status === 403) throw new SheetsError('forbidden', undefined, 403);
    throw new SheetsError('api', t('err_gsheet_api', { status: res.status, message: msg }), res.status);
  }
  return res.json();
}

/** シート名を A1 記法の範囲として使える形にする('名前' で囲み、' は '' に) */
export function quoteSheetName(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

/**
 * スプレッドシートのシートを全部読む(非表示のシートは飛ばす)
 * @param {string} spreadsheetId
 * @returns {Promise<{title: string, sheets: Array<{name: string, sheetId: number, headers: string[], records: Object[], truncated: boolean}>}>}
 */
export async function readSpreadsheet(spreadsheetId) {
  const id = encodeURIComponent(spreadsheetId);
  const meta = await call(`/v4/spreadsheets/${id}?fields=${encodeURIComponent('properties(title),sheets(properties(sheetId,title,index,hidden,sheetType))')}`);
  const props = (meta?.sheets || [])
    .map(s => s.properties || {})
    .filter(p => !p.hidden && (!p.sheetType || p.sheetType === 'GRID'))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .slice(0, MAX_SHEETS);
  if (props.length === 0) throw new SheetsError('empty');

  const q = new URLSearchParams({ valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'ROWS' });
  for (const p of props) q.append('ranges', quoteSheetName(p.title));
  const values = await call(`/v4/spreadsheets/${id}/values:batchGet?${q}`);
  const ranges = values?.valueRanges || [];

  const sheets = props.map((p, i) => {
    const rows = (ranges[i]?.values || []).map(r => r.map(v => String(v ?? '')));
    return { name: p.title, sheetId: p.sheetId, ...rowsToTable(rows) };
  });
  return { title: meta?.properties?.title || '', sheets };
}

/** 保存しておく連携の情報(デザインの mergeSource) */
export function makeSource({ spreadsheetId, name }, sheet) {
  return {
    type: 'gsheet',
    spreadsheetId,
    name: name || '',
    sheetId: sheet?.sheetId ?? null,
    sheetName: sheet?.name || '',
  };
}

/** 保存されていた mergeSource を確かめる(壊れていれば null) */
export function normalizeSource(src) {
  if (!src || src.type !== 'gsheet' || typeof src.spreadsheetId !== 'string' || !src.spreadsheetId) return null;
  return {
    type: 'gsheet',
    spreadsheetId: src.spreadsheetId,
    name: typeof src.name === 'string' ? src.name : '',
    sheetId: Number.isFinite(src.sheetId) ? src.sheetId : null,
    sheetName: typeof src.sheetName === 'string' ? src.sheetName : '',
    ...(typeof src.rowRange === 'string' && src.rowRange ? { rowRange: src.rowRange } : {}),
  };
}

/** 保存されていたシート(sheetId、無ければ名前)の位置。見つからなければ -1 */
export function findSheetIndex(sheets, src) {
  if (!src) return -1;
  let i = src.sheetId != null ? sheets.findIndex(s => s.sheetId === src.sheetId) : -1;
  if (i < 0 && src.sheetName) i = sheets.findIndex(s => s.name === src.sheetName);
  return i;
}

/** スプレッドシートを開く URL */
export function spreadsheetUrl(src) {
  if (!src) return '';
  const gid = src.sheetId != null ? `#gid=${src.sheetId}` : '';
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(src.spreadsheetId)}/edit${gid}`;
}
