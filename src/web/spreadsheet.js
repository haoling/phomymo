/**
 * Spreadsheet import for mail-merge printing (差し込み印刷)
 *
 * - CSV / TSV (UTF-8, UTF-8 BOM, UTF-16 BOM, Shift_JIS は自動判定)
 * - Excel (.xlsx) … ライブラリを使わず、ZIP を DecompressionStream で展開して XML を読む
 * - 貼り付け(Google スプレッドシートや Excel でセルをコピーしたもの = タブ区切り)
 * - 行の範囲指定 "1-10, 15, 20-"
 *
 * 画面(app.js)には依存しない。
 */

/** 読み込める行数の上限(ブラウザが重くならないように) */
export const MAX_SPREADSHEET_ROWS = 10000;

/** 読み込めるファイルの種類 */
export const SPREADSHEET_ACCEPT = '.csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MAX_FILE_MB = 20;

// =============================================================================
// FILE ENTRY
// =============================================================================

/**
 * Read a CSV/TSV/XLSX file
 * @param {File} file
 * @returns {Promise<{sheets: Array<{name: string, headers: string[], records: Object[], truncated: boolean}>}>}
 *   CSV は sheets が1つ。失敗したら Error を投げる(message は err.code で判別)
 */
export async function readSpreadsheetFile(file) {
  if (!file) throw codeError('no_file');
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw codeError('too_large', { maxSizeMB: MAX_FILE_MB });
  const name = (file.name || '').toLowerCase();
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"

  if (name.endsWith('.xlsx') || name.endsWith('.xlsm') || isZip) {
    if (!isZip) throw codeError('bad_xlsx');
    const sheets = await readXlsx(buffer);
    return { sheets: sheets.map(s => ({ name: s.name, ...rowsToTable(s.rows) })) };
  }
  if (name.endsWith('.xls') || name.endsWith('.numbers') || name.endsWith('.ods')) {
    throw codeError('unsupported_type');
  }
  const text = decodeText(buffer);
  return { sheets: [{ name: file.name || '', ...parseDelimitedTable(text) }] };
}

function codeError(code, params = {}) {
  const e = new Error(code);
  e.code = code;
  e.params = params;
  return e;
}

// =============================================================================
// TEXT (CSV / TSV)
// =============================================================================

/**
 * Decode a text file. BOM → UTF-8(厳密)→ Shift_JIS の順に試す
 * (日本語版 Excel の「CSV」保存は Shift_JIS になるため)
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
export function decodeText(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    try {
      return new TextDecoder('shift_jis').decode(b);
    } catch {
      return new TextDecoder('utf-8').decode(b);
    }
  }
}

/**
 * Guess the delimiter from the first line (タブがあればタブ区切り)
 */
export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  let tabs = 0, commas = 0, semis = 0, inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === '\t') tabs++;
      else if (ch === ',') commas++;
      else if (ch === ';') semis++;
    }
  }
  if (tabs > 0 && tabs >= commas) return '\t';
  if (semis > commas) return ';';
  return ',';
}

/**
 * Parse delimited text into rows (RFC 4180: "" エスケープ、引用符内の改行に対応)
 * @param {string} text
 * @param {string} [delimiter] - 省略時は自動判定
 * @returns {string[][]}
 */
export function parseDelimited(text, delimiter) {
  const delim = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
    } else {
      field += ch;
      if (ch !== ' ' && ch !== '\t') fieldStarted = true;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 値の前後の空白は取る(これまでの CSV 読み込みと同じ)
  return rows.map(r => r.map(v => v.trim()));
}

/**
 * Parse CSV/TSV text into { headers, records }
 */
export function parseDelimitedTable(text, delimiter) {
  return rowsToTable(parseDelimited(text, delimiter));
}

// =============================================================================
// TABLE
// =============================================================================

/** 0 → "A", 25 → "Z", 26 → "AA" */
export function columnLetter(index) {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Turn rows (1行目が見出し) into { headers, records }
 * - 見出しが空の列は列の記号(A, B, …)を名前にする
 * - 同じ見出しが続いたら「名前 (2)」にする
 * - 全部空の行は飛ばす
 * @param {string[][]} rows
 * @returns {{headers: string[], records: Object[], truncated: boolean}}
 */
export function rowsToTable(rows) {
  const nonEmpty = (r) => r.some(v => String(v ?? '').trim() !== '');
  const firstIdx = rows.findIndex(nonEmpty);
  if (firstIdx < 0) return { headers: [], records: [], truncated: false };

  const headerRow = rows[firstIdx];
  const width = Math.max(...rows.slice(firstIdx).map(r => {
    let w = r.length;
    while (w > 0 && String(r[w - 1] ?? '').trim() === '') w--;
    return w;
  }));

  const headers = [];
  const seen = new Map();
  for (let c = 0; c < width; c++) {
    let h = String(headerRow[c] ?? '').trim().replace(/[{}]/g, '') || columnLetter(c);
    const count = seen.get(h) || 0;
    seen.set(h, count + 1);
    if (count > 0) h = `${h} (${count + 1})`;
    headers.push(h);
  }

  const records = [];
  let truncated = false;
  for (let r = firstIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !nonEmpty(row)) continue;
    if (records.length >= MAX_SPREADSHEET_ROWS) { truncated = true; break; }
    const rec = {};
    headers.forEach((h, c) => { rec[h] = String(row[c] ?? ''); });
    records.push(rec);
  }
  return { headers, records, truncated };
}

/**
 * デザインの差し込み項目のうち、表の列に見つからないもの(大文字小文字・前後の空白は区別しない)
 */
export function findMissingFields(fields, headers) {
  const norm = (s) => String(s).trim().toLowerCase();
  const set = new Set(headers.map(norm));
  return fields.filter(f => !set.has(norm(f)));
}

// =============================================================================
// ROW RANGE "1-10, 15, 20-"
// =============================================================================

/**
 * Parse a row range spec. 行番号は 1 始まり(データの1行目 = 1)
 * 区切り: , 、 ; 空白 / 範囲: - ~ 〜 ‐ – (全角数字もOK)/ "20-" は最後まで、"-5" は最初から
 * @param {string} text
 * @param {number} count - データの行数
 * @returns {{indices: number[], error: string|null}} indices は 0 始まり・昇順・重複なし
 */
export function parseRowRange(text, count) {
  const src = String(text ?? '').normalize('NFKC').trim();
  if (src === '' || /^(all|全部|すべて|全て)$/i.test(src)) {
    return { indices: Array.from({ length: count }, (_, i) => i), error: null };
  }
  const set = new Set();
  for (const raw of src.split(/[,、;\s]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d*)\s*[-~〜‐–ー]\s*(\d*)$/);
    let from, to;
    if (m && (m[1] || m[2])) {
      from = m[1] ? parseInt(m[1], 10) : 1;
      to = m[2] ? parseInt(m[2], 10) : count;
    } else if (/^\d+$/.test(part)) {
      from = to = parseInt(part, 10);
    } else {
      return { indices: [], error: part };
    }
    if (from > to) [from, to] = [to, from];
    from = Math.max(1, from);
    to = Math.min(count, to);
    for (let i = from; i <= to; i++) set.add(i - 1);
  }
  return { indices: [...set].sort((a, b) => a - b), error: null };
}

/**
 * Format indices (0 始まり) as a range spec "1-5, 8"
 */
export function formatRowRange(indices, count) {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  if (count > 0 && sorted.length === count) return `1-${count}`;
  const parts = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) { end++; i++; }
    parts.push(start === end ? `${start + 1}` : `${start + 1}-${end + 1}`);
  }
  return parts.join(', ');
}

// =============================================================================
// XLSX
// =============================================================================

/**
 * Read all sheets of an .xlsx file
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Array<{name: string, rows: string[][]}>>}
 */
export async function readXlsx(buffer) {
  const zip = readZipDirectory(buffer);
  const text = async (path) => {
    const entry = zip.get(path);
    if (!entry) return null;
    return new TextDecoder('utf-8').decode(await inflateEntry(buffer, entry));
  };

  const workbookXml = await text('xl/workbook.xml');
  if (!workbookXml) throw codeError('bad_xlsx');
  const workbook = parseXml(workbookXml);
  const date1904 = ['1', 'true'].includes(byTag(workbook, 'workbookPr')[0]?.getAttribute('date1904') || '');

  // シートのファイルの場所(rels)
  const rels = new Map();
  const relsXml = await text('xl/_rels/workbook.xml.rels');
  if (relsXml) {
    for (const rel of byTag(parseXml(relsXml), 'Relationship')) {
      let target = rel.getAttribute('Target') || '';
      target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      rels.set(rel.getAttribute('Id'), normalizePath(target));
    }
  }

  const sharedStrings = [];
  const ssXml = await text('xl/sharedStrings.xml');
  if (ssXml) {
    for (const si of byTag(parseXml(ssXml), 'si')) sharedStrings.push(richText(si));
  }

  const styles = await readStyles(await text('xl/styles.xml'));

  const sheets = [];
  const sheetEls = byTag(workbook, 'sheet');
  for (let i = 0; i < sheetEls.length; i++) {
    const el = sheetEls[i];
    const state = el.getAttribute('state');
    if (state === 'hidden' || state === 'veryHidden') continue;
    const rid = el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
      || el.getAttribute('r:id');
    const path = rels.get(rid) || `xl/worksheets/sheet${i + 1}.xml`;
    const xml = await text(path);
    if (!xml) continue;
    sheets.push({
      name: el.getAttribute('name') || `Sheet${i + 1}`,
      rows: readSheetRows(parseXml(xml), sharedStrings, styles, date1904),
    });
  }
  if (sheets.length === 0) throw codeError('bad_xlsx');
  return sheets;
}

function normalizePath(p) {
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '..') out.pop();
    else if (seg && seg !== '.') out.push(seg);
  }
  return out.join('/');
}

function parseXml(str) {
  const doc = new DOMParser().parseFromString(str, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw codeError('bad_xlsx');
  return doc;
}

function byTag(node, localName) {
  return Array.from(node.getElementsByTagNameNS('*', localName));
}

function childrenByTag(node, localName) {
  return Array.from(node.childNodes).filter(n => n.nodeType === 1 && n.localName === localName);
}

/** <si>/<is> の文字(ふりがな <rPh> は除く) */
function richText(node) {
  let s = '';
  for (const child of node.childNodes) {
    if (child.nodeType !== 1) continue;
    if (child.localName === 't') s += child.textContent;
    else if (child.localName === 'r') {
      for (const t of childrenByTag(child, 't')) s += t.textContent;
    }
  }
  return s;
}

/** "B12" → 1 (列の番号、0 始まり) */
function refToColumn(ref) {
  const m = /^([A-Z]+)/i.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readSheetRows(doc, sharedStrings, styles, date1904) {
  const rows = [];
  const rowEls = byTag(doc, 'row');
  let nextRow = 0;
  for (const rowEl of rowEls) {
    if (rows.length > MAX_SPREADSHEET_ROWS + 1) break;
    const r = parseInt(rowEl.getAttribute('r'), 10);
    const rowIndex = Number.isFinite(r) ? r - 1 : nextRow;
    nextRow = rowIndex + 1;
    // 空の行もそのまま詰める(行番号がずれないように)
    while (rows.length < rowIndex) rows.push([]);
    const values = [];
    let nextCol = 0;
    for (const c of childrenByTag(rowEl, 'c')) {
      let col = refToColumn(c.getAttribute('r'));
      if (col < 0) col = nextCol;
      nextCol = col + 1;
      values[col] = cellValue(c, sharedStrings, styles, date1904);
    }
    for (let i = 0; i < values.length; i++) if (values[i] === undefined) values[i] = '';
    rows[rowIndex] = values;
  }
  return rows;
}

function cellValue(c, sharedStrings, styles, date1904) {
  const type = c.getAttribute('t') || 'n';
  const v = childrenByTag(c, 'v')[0]?.textContent ?? '';
  switch (type) {
    case 's': return sharedStrings[parseInt(v, 10)] ?? '';
    case 'inlineStr': {
      const is = childrenByTag(c, 'is')[0];
      return is ? richText(is) : '';
    }
    case 'str': return v;
    case 'b': return v === '1' ? 'TRUE' : 'FALSE';
    case 'e': return v;
    case 'd': return v.replace('T', ' ').replace(/(\.\d+)?Z?$/, '');
    default: {
      if (v === '') return '';
      const num = Number(v);
      if (!Number.isFinite(num)) return v;
      const s = parseInt(c.getAttribute('s') || '0', 10);
      return formatNumber(num, styles[s] || 'General', date1904);
    }
  }
}

// ---- 表示形式(よく使うものだけ。仮決め) ------------------------------------

/** 組み込みの表示形式の番号 → 形式(日付・時刻・よく使う数値だけ) */
const BUILTIN_FORMATS = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'yyyy/m/d', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy',
  18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'yyyy/m/d h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 49: '@',
  // 日本語版 Excel の日付(和暦などは西暦で出す)
  27: 'yyyy/m/d', 28: 'yyyy/m/d', 29: 'yyyy/m/d', 30: 'yyyy/m/d', 31: 'yyyy/m/d',
  32: 'h:mm', 33: 'h:mm:ss', 34: 'h:mm', 35: 'h:mm:ss', 36: 'yyyy/m/d',
  50: 'yyyy/m/d', 51: 'yyyy/m/d', 52: 'yyyy/m/d', 53: 'yyyy/m/d', 54: 'yyyy/m/d',
  55: 'yyyy/m/d', 56: 'yyyy/m/d', 57: 'yyyy/m/d', 58: 'yyyy/m/d',
};

async function readStyles(xml) {
  if (!xml) return [];
  const doc = parseXml(xml);
  const custom = {};
  for (const nf of byTag(doc, 'numFmt')) {
    custom[nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode') || 'General';
  }
  const cellXfs = byTag(doc, 'cellXfs')[0];
  if (!cellXfs) return [];
  return childrenByTag(cellXfs, 'xf').map(xf => {
    const id = xf.getAttribute('numFmtId') || '0';
    return custom[id] ?? BUILTIN_FORMATS[id] ?? 'General';
  });
}

/** 15桁に丸めて、0.1+0.2 のような誤差を消す */
function cleanNumber(num) {
  return String(parseFloat(num.toPrecision(15)));
}

/**
 * Format a numeric cell value with its number format (よく使うものだけ)
 * @param {number} num
 * @param {string} format
 * @param {boolean} [date1904]
 */
export function formatNumber(num, format, date1904 = false) {
  if (!format || format === 'General' || format === '@') return cleanNumber(num);
  // 正の数の部分だけを見る。"..." の文字列と [Red] などは除いた形で判定
  const section = format.split(';')[0];
  const bare = section.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');

  if (/[ymdhs]/i.test(bare) && !/^[#0.,%E+\-\s?/]*$/i.test(bare)) {
    return formatExcelDate(num, bare, date1904);
  }
  if (bare.includes('%')) {
    const decimals = (bare.split('.')[1] || '').replace(/[^0#]/g, '').length;
    return `${(num * 100).toFixed(decimals)}%`;
  }
  if (/E\+/i.test(bare)) return cleanNumber(num);

  const numberPart = bare.replace(/[^#0.,?]/g, '');
  if (!numberPart) return cleanNumber(num);
  const [intPart, fracPart = ''] = numberPart.split('.');
  const decimals = fracPart.replace(/[^0]/g, '').length;
  const optionalDecimals = fracPart.replace(/[^#?]/g, '').length;
  let str = optionalDecimals
    ? String(parseFloat(Math.abs(num).toFixed(decimals + optionalDecimals)))
    : Math.abs(num).toFixed(decimals);
  if (optionalDecimals && decimals) {
    const [i, f = ''] = str.split('.');
    str = `${i}.${f.padEnd(decimals, '0')}`;
  }
  let [i, f] = str.split('.');
  const minInt = intPart.replace(/[^0]/g, '').length;
  if (minInt > 1) i = i.padStart(minInt, '0');
  if (intPart.includes(',')) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = f !== undefined ? `${i}.${f}` : i;
  // 前後の決まった文字("円" や ¥ など)
  const literal = (s) => s.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1').replace(/\[[^\]]*\]/g, '').replace(/[_*]./g, '');
  const m = section.match(/^(.*?)[#0?][#0?,.]*(.*)$/);
  const prefix = m ? literal(m[1]).replace(/[()]/g, '') : '';
  const suffix = m ? literal(m[2]).replace(/[()]/g, '').trimEnd() : '';
  return `${num < 0 ? '-' : ''}${prefix}${body}${suffix}`;
}

/**
 * Excel のシリアル値 → "YYYY/MM/DD" / "HH:mm" / "YYYY/MM/DD HH:mm"(仮決め)
 */
export function formatExcelDate(serial, bareFormat = 'yyyy/m/d', date1904 = false) {
  const f = bareFormat.toLowerCase();
  // "m" は h のあと・s の前なら分。日付があるかは y か d で見る
  const hasDate = /[yd]/.test(f) || (/m/.test(f) && !/[hs]/.test(f));
  const hasTime = /[hs]/.test(f);
  const hasSeconds = /s/.test(f);
  const days = serial + (date1904 ? 1462 : 0);
  // 1900年うるう年のバグ(60 = 1900/2/29)を含めて、1899/12/30 起点で計算
  const ms = Math.round((days - 25569) * 86400000);
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  const datePart = `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
  let timePart = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (hasSeconds) timePart += `:${pad(d.getUTCSeconds())}`;
  if (hasDate && hasTime) return `${datePart} ${timePart}`;
  if (hasTime) return timePart;
  return datePart;
}

// ---- ZIP ----------------------------------------------------------------

/**
 * Read the central directory of a ZIP file
 * @returns {Map<string, {method: number, compressedSize: number, localOffset: number}>}
 */
function readZipDirectory(buffer) {
  const view = new DataView(buffer);
  const len = buffer.byteLength;
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw codeError('bad_xlsx');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  const decoder = new TextDecoder('utf-8');
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw codeError('bad_xlsx');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLen));
    entries.set(name.replace(/\\/g, '/'), { method, compressedSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateEntry(buffer, entry) {
  const view = new DataView(buffer);
  const lo = entry.localOffset;
  if (view.getUint32(lo, true) !== 0x04034b50) throw codeError('bad_xlsx');
  const nameLen = view.getUint16(lo + 26, true);
  const extraLen = view.getUint16(lo + 28, true);
  const start = lo + 30 + nameLen + extraLen;
  const data = new Uint8Array(buffer, start, entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw codeError('bad_xlsx');
  if (typeof DecompressionStream === 'undefined') throw codeError('xlsx_unsupported_browser');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
