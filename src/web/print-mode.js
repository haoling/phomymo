/**
 * 印刷専用モード(スマホ向け)
 *
 * ラベルの編集はせず「保存済みデザインを開く」「変数の値を変える」「印刷」だけができる画面。
 * 画面の組み立てと操作は app.js(PRINT MODE の節)。ここには入り方の決まりだけを置く。
 *
 * 仮決め(あとから変えられるよう、ここに集めている):
 * - URL に ?mode=print を付けると印刷モードで開く。?mode=edit なら編集画面で開く
 * - 最後に使った画面(印刷モードか編集画面か)を覚えておき、次に開いたときもそれで開く
 * - スマホ幅でも、最初から印刷モードにはしない(DEFAULT_ON_MOBILE)
 */

export const PRINT_MODE = {
  /** URL のパラメータ名と値 */
  URL_PARAM: 'mode',
  URL_PRINT: 'print',
  URL_EDIT: 'edit',
  /** 最後に使った画面を覚えておくキー(kv.js 経由。ゲストモードでは覚えない) */
  STORAGE_KEY: 'phomymo_view_mode',
  /** 最後に使った画面で開き直すか */
  REMEMBER_LAST_MODE: true,
  /** 何も決まっていないとき、スマホ幅なら印刷モードで開くか */
  DEFAULT_ON_MOBILE: false,
  /** プレビューを何倍の解像度で描くか(画面の dpr に関係なく、くっきり見せるため) */
  PREVIEW_SCALE: 3,
};

/**
 * 起動したときに印刷モードで開くか
 * @param {{ search?: string, saved?: string|null, isMobile?: boolean }} opts
 *   search: location.search、saved: 覚えておいた画面('print' / 'edit')、isMobile: スマホ幅か
 * @returns {boolean}
 */
export function decideInitialPrintMode({ search = '', saved = null, isMobile = false } = {}) {
  const param = new URLSearchParams(search).get(PRINT_MODE.URL_PARAM);
  if (param === PRINT_MODE.URL_PRINT) return true;
  if (param === PRINT_MODE.URL_EDIT) return false;
  if (PRINT_MODE.REMEMBER_LAST_MODE && (saved === PRINT_MODE.URL_PRINT || saved === PRINT_MODE.URL_EDIT)) {
    return saved === PRINT_MODE.URL_PRINT;
  }
  return !!(PRINT_MODE.DEFAULT_ON_MOBILE && isMobile);
}

/**
 * 今の画面に合わせた URL(?mode=print を付ける/外す。ほかのパラメータは残す)
 * @param {string} href
 * @param {boolean} printMode
 * @returns {string}
 */
export function urlForPrintMode(href, printMode) {
  const url = new URL(href);
  if (printMode) url.searchParams.set(PRINT_MODE.URL_PARAM, PRINT_MODE.URL_PRINT);
  else url.searchParams.delete(PRINT_MODE.URL_PARAM);
  return url.toString();
}
