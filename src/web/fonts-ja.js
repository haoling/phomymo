/**
 * Japanese font presets (#23)
 *
 * 日本語フォントのプリセットと、その読み込み・印刷前の待ち合わせを担当する。
 *
 * 仮決め(あとから変更可):
 *   - 配信元は Google Fonts(JA_FONT_CSS_URL を差し替えれば自前ホストに切り替えられる)
 *   - 収録フォントとウェイトは JA_FONTS の配列で管理
 *   - 新しく作るテキストの既定フォントは DEFAULT_TEXT_FONT
 */

/**
 * 日本語フォントの一覧
 * family:   CSS の font-family 名
 * fallback: 総称ファミリー
 * label:    UI に出す名前
 * weights:  読み込むウェイト。感熱紙でかすれにくいよう 500/700 も読み込む
 */
export const JA_FONTS = [
  { family: 'Noto Sans JP', fallback: 'sans-serif', label: 'Noto Sans JP(ゴシック)', weights: [400, 500, 700] },
  { family: 'BIZ UDPGothic', fallback: 'sans-serif', label: 'BIZ UDPゴシック', weights: [400, 700] },
  { family: 'M PLUS Rounded 1c', fallback: 'sans-serif', label: 'M PLUS Rounded 1c(丸ゴシック)', weights: [400, 500, 700] },
  { family: 'Zen Maru Gothic', fallback: 'sans-serif', label: 'Zen Maru Gothic(丸ゴシック)', weights: [400, 500, 700] },
  { family: 'Noto Serif JP', fallback: 'serif', label: 'Noto Serif JP(明朝)', weights: [400, 500, 700] },
];

/** UI 上のグループ名 */
export const JA_FONT_GROUP_LABEL = '日本語';

/**
 * 新しく作るテキスト要素の既定フォント(仮決め: Noto Sans JP)
 * 英語フォントに戻したいときは 'Inter, sans-serif' にする
 */
export const DEFAULT_TEXT_FONT = fontValue(JA_FONTS[0]);

/**
 * 日本語フォントの CSS の URL。
 * null なら Google Fonts の URL を組み立てる。自前ホストに切り替えるときは
 * 'fonts/ja.css' のように同梱した CSS のパスを入れる。
 */
export const JA_FONT_CSS_URL = null;

/** 印刷前にフォントの読み込みを待つ最大時間(ms)。超えたら代替フォントのまま進める */
export const FONT_LOAD_TIMEOUT_MS = 8000;

/**
 * セレクトボックスの value に入れる font-family 文字列を作る
 * (数字で始まる単語を含む名前もあるので、常に引用符で囲む)
 */
export function fontValue(font) {
  return `"${font.family}", ${font.fallback}`;
}

/**
 * Google Fonts の CSS2 API の URL を組み立てる
 */
export function buildGoogleFontsUrl(fonts = JA_FONTS) {
  const families = fonts.map(f => {
    const name = f.family.replace(/ /g, '+');
    const weights = [...f.weights].sort((a, b) => a - b).join(';');
    return `family=${name}:wght@${weights}`;
  });
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

/**
 * 日本語フォントの CSS を <head> に追加する(二重には追加しない)
 */
export function injectJapaneseFontStylesheet(doc = document) {
  if (doc.getElementById('ja-fonts-css')) return;
  const link = doc.createElement('link');
  link.id = 'ja-fonts-css';
  link.rel = 'stylesheet';
  link.href = JA_FONT_CSS_URL || buildGoogleFontsUrl();
  doc.head.appendChild(link);
}

/**
 * <option> の HTML を返す(モバイル用プロパティパネルで使う)
 */
export function japaneseFontOptionsHtml(selectedValue) {
  const opts = JA_FONTS.map(f => {
    const value = fontValue(f);
    const sel = value === selectedValue ? ' selected' : '';
    return `<option value='${value}'${sel}>${f.label}</option>`;
  }).join('');
  return `<optgroup label="${JA_FONT_GROUP_LABEL}">${opts}</optgroup>`;
}

/**
 * フォント選択の <select> の先頭に「日本語」グループを追加する
 */
export function addJapaneseFontsToSelect(select) {
  if (!select || select.querySelector(`optgroup[data-ja-fonts]`)) return;
  const group = select.ownerDocument.createElement('optgroup');
  group.label = JA_FONT_GROUP_LABEL;
  group.dataset.jaFonts = 'true';
  for (const f of JA_FONTS) {
    const opt = select.ownerDocument.createElement('option');
    opt.value = fontValue(f);
    opt.textContent = f.label;
    group.appendChild(opt);
  }
  select.insertBefore(group, select.firstChild);
}

/**
 * 要素で使われているフォントの読み込み完了を待つ。
 * 未ロードのまま描画すると代替フォントで印刷されてしまうため、印刷・書き出しの前に呼ぶ。
 * 時間切れや読み込み失敗でも例外は投げず、結果だけ返す。
 *
 * @param {Array} elements - ラベル要素
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{loaded: boolean, timedOut: boolean}>}
 */
export async function waitForElementFonts(elements, { timeoutMs = FONT_LOAD_TIMEOUT_MS } = {}) {
  if (typeof document === 'undefined' || !document.fonts?.load) {
    return { loaded: true, timedOut: false };
  }

  // フォント指定ごとに、使っている文字をまとめる(日本語フォントは unicode-range で分割配信されるため)
  const requests = new Map();
  for (const el of elements || []) {
    const texts = [];
    if (el.type === 'text' && el.text) texts.push(el.text);
    if (!texts.length) continue;
    const family = el.fontFamily || 'Inter, sans-serif';
    const weight = el.fontWeight === 'bold' ? 'bold' : (el.fontWeight || 'normal');
    const style = el.fontStyle === 'italic' ? 'italic' : 'normal';
    const key = `${style} ${weight} 16px ${family}`;
    requests.set(key, (requests.get(key) || '') + texts.join(''));
  }
  if (requests.size === 0) return { loaded: true, timedOut: false };

  const loads = [...requests.entries()].map(([font, text]) =>
    document.fonts.load(font, text).catch(() => [])
  );

  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const result = await Promise.race([Promise.all(loads).then(() => 'ok'), timeout]);
  clearTimeout(timer);
  return { loaded: result === 'ok', timedOut: result === 'timeout' };
}
