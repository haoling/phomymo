/**
 * Template system for variable data printing
 * Handles field detection, substitution, and CSV parsing
 */

import { t } from './i18n.js';

// Field pattern: {{FieldName}}
const FIELD_PATTERN = /\{\{([^}]+)\}\}/g;

/**
 * Extract all field names from elements
 * @param {Array} elements - Array of label elements
 * @returns {Array} - Array of unique field names
 */
export function extractFields(elements) {
  const fields = new Set();

  for (const el of elements) {
    // Check text content
    if (el.text) {
      extractFromString(el.text, fields);
    }
    // Check barcode data
    if (el.barcodeData) {
      extractFromString(el.barcodeData, fields);
    }
    // Check QR data
    if (el.qrData) {
      extractFromString(el.qrData, fields);
    }
  }

  return Array.from(fields);
}

/**
 * Extract field names from a string
 * @param {string} str - String to search
 * @param {Set} fields - Set to add field names to
 */
function extractFromString(str, fields) {
  // Reset regex lastIndex for fresh search
  FIELD_PATTERN.lastIndex = 0;
  let match;
  while ((match = FIELD_PATTERN.exec(str)) !== null) {
    fields.add(match[1].trim());
  }
}

/**
 * Check if elements contain any template fields
 * @param {Array} elements - Array of label elements
 * @returns {boolean}
 */
export function hasTemplateFields(elements) {
  return extractFields(elements).length > 0;
}

/**
 * Substitute fields in elements with values from a record
 * @param {Array} elements - Array of label elements
 * @param {Object} record - Object with field values { FieldName: 'value', ... }
 * @returns {Array} - New array of elements with substituted values
 */
export function substituteFields(elements, record) {
  return elements.map(el => {
    const clone = { ...el };

    if (clone.text) {
      clone.text = substituteString(clone.text, record);
    }
    if (clone.barcodeData) {
      clone.barcodeData = substituteString(clone.barcodeData, record);
    }
    if (clone.qrData) {
      clone.qrData = substituteString(clone.qrData, record);
    }

    return clone;
  });
}

/**
 * Substitute fields in a string
 * @param {string} str - String with {{field}} placeholders
 * @param {Object} record - Object with field values
 * @returns {string} - String with substituted values
 */
function substituteString(str, record) {
  return str.replace(FIELD_PATTERN, (match, field) => {
    const trimmedField = field.trim();
    // Return the value if it exists, otherwise keep the placeholder
    if (Object.prototype.hasOwnProperty.call(record, trimmedField)) return record[trimmedField];
    // 表の見出しと大文字・小文字や前後の空白が違っても差し込む
    const lower = trimmedField.toLowerCase();
    const key = Object.keys(record).find(k => k.trim().toLowerCase() === lower);
    return key !== undefined ? record[key] : match;
  });
}

// =============================================================================
// DESIGN VARIABLES - デザインごとの変数(名前と値)。書き方は差し込みと同じ {{変数名}}
// =============================================================================

/** 変数の値の中で別の変数を使えるようにするときの、たどる深さの上限(循環を止める) */
const VARIABLE_MAX_DEPTH = 5;

/**
 * 変数の一覧を整える(名前の前後の空白と { } を取り、空の名前・同じ名前の重複は捨てる)
 * @param {Array<{name:string,value:string}>} list
 * @param {{keepEmptyNames?: boolean}} [opts] - 編集中の空の行を残すとき true
 * @returns {Array<{name:string,value:string}>}
 */
export function normalizeVariables(list, opts = {}) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    const name = cleanVariableName(v.name);
    const value = v.value == null ? '' : String(v.value);
    if (!name) {
      if (opts.keepEmptyNames) out.push({ name: '', value });
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, value });
  }
  return out;
}

/** 変数名として使えない文字({ } と改行)を取り除く */
export function cleanVariableName(name) {
  return String(name ?? '').replace(/[{}\r\n]/g, '').trim();
}

/**
 * 差し込みに使う値をまとめる。表の行(record)の値が変数より優先。
 * 変数の値の中の {{名前}} は、表の列やほかの変数で置き換える。
 * @param {Array<{name:string,value:string}>} variables
 * @param {Object|null} [record] - 表の1行
 * @returns {Object} - substituteFields に渡せる { 名前: 値 }
 */
export function buildFieldValues(variables, record = null) {
  const vars = normalizeVariables(variables);
  const base = record ? { ...record } : {};
  if (vars.length === 0) return base;

  const lookup = {};
  for (const v of vars) lookup[v.name] = v.value;
  // 表の列が同じ名前なら表の値を使う(大文字・小文字の違いは同じ扱い)
  for (const key of Object.keys(base)) {
    const lower = key.trim().toLowerCase();
    for (const name of Object.keys(lookup)) {
      if (name.toLowerCase() === lower) delete lookup[name];
    }
  }
  const all = { ...lookup, ...base };
  const resolved = {};
  for (const name of Object.keys(lookup)) {
    let value = lookup[name];
    for (let i = 0; i < VARIABLE_MAX_DEPTH; i++) {
      FIELD_PATTERN.lastIndex = 0;
      if (!FIELD_PATTERN.test(value)) break;
      const next = substituteString(value, all);
      if (next === value) break;
      value = next;
    }
    FIELD_PATTERN.lastIndex = 0;
    resolved[name] = value;
  }
  return { ...resolved, ...base };
}

/**
 * デザインの変数を要素に入れる(表のデータなし。表の値も使うときは buildFieldValues を使う)
 * @param {Array} elements
 * @param {Array<{name:string,value:string}>} variables
 * @returns {Array}
 */
export function applyVariables(elements, variables) {
  const vars = normalizeVariables(variables);
  if (vars.length === 0) return elements;
  return substituteFields(elements, buildFieldValues(vars));
}

/**
 * 差し込み項目のうち、変数として値が決まっているものを除く(表の列として要るものだけ残す)
 * @param {Array<string>} fields
 * @param {Array<{name:string,value:string}>} variables
 * @returns {Array<string>}
 */
export function fieldsWithoutVariables(fields, variables) {
  const names = new Set(normalizeVariables(variables).map(v => v.name.toLowerCase()));
  if (names.size === 0) return fields;
  return fields.filter(f => !names.has(f.trim().toLowerCase()));
}

/**
 * Validate that a record has all required fields
 * @param {Array} fields - Array of required field names
 * @param {Object} record - Record to validate
 * @returns {Object} - { valid: boolean, missing: Array }
 */
export function validateRecord(fields, record) {
  const missing = fields.filter(f => !record.hasOwnProperty(f) || record[f] === '');
  return {
    valid: missing.length === 0,
    missing,
  };
}

// Maximum records to prevent browser memory issues
const MAX_CSV_RECORDS = 10000;

/**
 * Parse CSV string to array of records
 * Handles:
 * - Header row (first row becomes field names)
 * - Quoted values with commas
 * - Escaped quotes ("" inside quoted values)
 * - Empty rows (skipped)
 * - Max record limit (10,000) to prevent memory issues
 *
 * @param {string} csvString - CSV content
 * @returns {Object} - { headers: Array, records: Array, errors: Array }
 */
export function parseCSV(csvString) {
  const lines = csvString.split(/\r?\n/);
  const errors = [];
  const records = [];

  if (lines.length === 0) {
    return { headers: [], records: [], errors: [t('err_csv_empty')] };
  }

  // Parse header row
  const headers = parseCSVLine(lines[0]);
  if (headers.length === 0) {
    return { headers: [], records: [], errors: [t('err_csv_no_headers')] };
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    // Check record limit
    if (records.length >= MAX_CSV_RECORDS) {
      errors.push(t('err_csv_truncated', { MAX_CSV_RECORDS: MAX_CSV_RECORDS }));
      break;
    }

    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    const values = parseCSVLine(line);

    if (values.length !== headers.length) {
      errors.push(t('err_csv_row_columns', { row: i + 1, expected: headers.length, actual: values.length }));
      continue;
    }

    // Create record object
    const record = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j];
    }
    records.push(record);
  }

  return { headers, records, errors };
}

/**
 * Parse a single CSV line into values
 * Handles quoted values and escaped quotes
 * @param {string} line - CSV line
 * @returns {Array} - Array of values
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        // End of quoted value
        inQuotes = false;
        i++;
        continue;
      }
      current += char;
      i++;
    } else {
      if (char === '"') {
        // Start of quoted value
        inQuotes = true;
        i++;
        continue;
      }
      if (char === ',') {
        // End of value
        values.push(current.trim());
        current = '';
        i++;
        continue;
      }
      current += char;
      i++;
    }
  }

  // Add last value
  values.push(current.trim());

  return values;
}

/**
 * Convert records to CSV string
 * @param {Array} headers - Array of field names
 * @param {Array} records - Array of record objects
 * @returns {string} - CSV content
 */
export function toCSV(headers, records) {
  const lines = [];

  // Header row
  lines.push(headers.map(h => escapeCSVValue(h)).join(','));

  // Data rows
  for (const record of records) {
    const values = headers.map(h => escapeCSVValue(record[h] || ''));
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/**
 * Escape a value for CSV output
 * @param {string} value - Value to escape
 * @returns {string} - Escaped value
 */
function escapeCSVValue(value) {
  const str = String(value);
  // Quote if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Create an empty record with all fields
 * @param {Array} fields - Array of field names
 * @returns {Object} - Record with empty values
 */
export function createEmptyRecord(fields) {
  const record = {};
  for (const field of fields) {
    record[field] = '';
  }
  return record;
}

/**
 * Substitute fields in elements by zone, using different records per zone
 * Used for multi-label mode with clone mode OFF
 * @param {Array} elements - Array of label elements with zone property
 * @param {Array} records - Array of records, one per zone (can be sparse)
 * @param {number} numZones - Total number of zones
 * @returns {Array} - New array of elements with substituted values
 */
export function substituteFieldsByZone(elements, records, numZones) {
  return elements.map(el => {
    const zone = el.zone || 0;
    const record = records[zone];

    // If no record for this zone, return element unchanged
    if (!record) {
      return { ...el };
    }

    const clone = { ...el };

    if (clone.text) {
      clone.text = substituteString(clone.text, record);
    }
    if (clone.barcodeData) {
      clone.barcodeData = substituteString(clone.barcodeData, record);
    }
    if (clone.qrData) {
      clone.qrData = substituteString(clone.qrData, record);
    }

    return clone;
  });
}

/**
 * Generate sample data for preview/testing
 * @param {Array} fields - Array of field names
 * @param {number} count - Number of records to generate
 * @returns {Array} - Array of sample records
 */
export function generateSampleData(fields, count = 3) {
  const records = [];
  for (let i = 1; i <= count; i++) {
    const record = {};
    for (const field of fields) {
      record[field] = `${field} ${i}`;
    }
    records.push(record);
  }
  return records;
}

// =============================================================================
// INSTANT EXPRESSIONS - [[expression]] syntax for runtime evaluation
// =============================================================================

// Expression pattern: [[expression]] or [[expression|format]]
const EXPRESSION_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/**
 * Check if elements contain any instant expressions
 * @param {Array} elements - Array of label elements
 * @returns {boolean}
 */
export function hasExpressions(elements) {
  for (const el of elements) {
    if (el.text && EXPRESSION_PATTERN.test(el.text)) return true;
    if (el.barcodeData && EXPRESSION_PATTERN.test(el.barcodeData)) return true;
    if (el.qrData && EXPRESSION_PATTERN.test(el.qrData)) return true;
    // Reset lastIndex after each test
    EXPRESSION_PATTERN.lastIndex = 0;
  }
  return false;
}

/**
 * Evaluate instant expressions in elements
 * Replaces [[expression]] with evaluated values at call time
 * @param {Array} elements - Array of label elements
 * @param {Object} [context] - Evaluation context
 * @param {number|Function} [context.counterIndex] - 0-based position of the label
 *   being printed (used by [[counter]]). Either a number, or a function
 *   (element) => number for multi-label layouts where each zone gets its own number.
 * @returns {Array} - New array of elements with evaluated expressions
 */
export function evaluateExpressions(elements, context = {}) {
  return elements.map(el => {
    const clone = { ...el };
    const counterIndex = typeof context.counterIndex === 'function'
      ? context.counterIndex(el)
      : (context.counterIndex ?? 0);
    const ctx = { counterIndex };

    if (clone.text) {
      clone.text = evaluateExpressionsInString(clone.text, ctx);
    }
    if (clone.barcodeData) {
      clone.barcodeData = evaluateExpressionsInString(clone.barcodeData, ctx);
    }
    if (clone.qrData) {
      clone.qrData = evaluateExpressionsInString(clone.qrData, ctx);
    }

    return clone;
  });
}

// =============================================================================
// COUNTER - [[counter|start=1,step=1,pad=3]] (#31)
// =============================================================================

/** Names that evaluate as a counter (serial number) */
export const COUNTER_NAMES = ['counter', 'serial', 'seq', '連番'];

/** Default counter options (仮決め: 1 から 1 ずつ、ゼロ埋めなし) */
export const COUNTER_DEFAULTS = Object.freeze({ start: 1, step: 1, pad: 0 });

const COUNTER_PATTERN = new RegExp(
  `\\[\\[\\s*(?:${COUNTER_NAMES.join('|')})\\s*(?:\\|([^\\]]*))?\\]\\]`, 'gi'
);

/**
 * Parse counter options: "start=1,step=1,pad=3"
 * Separators "," ";" and spaces are accepted. Unknown keys are ignored.
 * @param {string|null} formatStr
 * @returns {{start: number, step: number, pad: number}}
 */
export function parseCounterOptions(formatStr) {
  const opts = { ...COUNTER_DEFAULTS };
  if (!formatStr) return opts;
  for (const part of formatStr.split(/[,;\s]+/)) {
    const m = part.match(/^(start|step|pad)\s*[=:]\s*(-?\d+)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = parseInt(m[2], 10);
    if (key === 'pad') {
      opts.pad = Math.max(0, Math.min(20, value));
    } else {
      opts[key] = value;
    }
  }
  return opts;
}

/**
 * Format the counter value for the given label position
 * @param {number} index - 0-based label position
 * @param {{start: number, step: number, pad: number}} opts
 * @returns {string}
 */
export function formatCounter(index, opts = COUNTER_DEFAULTS) {
  const value = opts.start + index * opts.step;
  const digits = String(Math.abs(value)).padStart(opts.pad, '0');
  return value < 0 ? `-${digits}` : digits;
}

/**
 * Check whether any element uses [[counter]]
 * @param {Array} elements
 * @returns {boolean}
 */
export function hasCounter(elements) {
  for (const el of elements || []) {
    for (const str of [el.text, el.barcodeData, el.qrData]) {
      if (!str) continue;
      COUNTER_PATTERN.lastIndex = 0;
      if (COUNTER_PATTERN.test(str)) {
        COUNTER_PATTERN.lastIndex = 0;
        return true;
      }
    }
  }
  return false;
}

/**
 * Return the first counter expression's value at a position (for UI preview)
 * @param {Array} elements
 * @param {number} index - 0-based label position
 * @returns {string|null} - null when the design has no counter
 */
export function previewCounter(elements, index) {
  for (const el of elements || []) {
    for (const str of [el.text, el.barcodeData, el.qrData]) {
      if (!str) continue;
      COUNTER_PATTERN.lastIndex = 0;
      const m = COUNTER_PATTERN.exec(str);
      COUNTER_PATTERN.lastIndex = 0;
      if (m) return formatCounter(index, parseCounterOptions(m[1] || null));
    }
  }
  return null;
}

/**
 * Evaluate expressions in a string
 * @param {string} str - String with [[expression]] placeholders
 * @param {Object} [ctx] - { counterIndex }
 * @returns {string} - String with evaluated values
 */
function evaluateExpressionsInString(str, ctx = {}) {
  EXPRESSION_PATTERN.lastIndex = 0;
  return str.replace(EXPRESSION_PATTERN, (match, expr, format) => {
    const expression = expr.trim().toLowerCase();
    const formatStr = format?.trim() || null;

    if (COUNTER_NAMES.includes(expression)) {
      return formatCounter(ctx.counterIndex ?? 0, parseCounterOptions(formatStr));
    }

    switch (expression) {
      case 'dt':
      case 'datetime':
        return formatDateTime(new Date(), formatStr || 'YYYY-MM-DD HH:mm:ss');

      case 'date':
        return formatDateTime(new Date(), formatStr || 'YYYY-MM-DD');

      case 'time':
        return formatDateTime(new Date(), formatStr || 'HH:mm:ss');

      case 'timestamp':
      case 'ts':
        return Date.now().toString();

      case 'year':
        return new Date().getFullYear().toString();

      case 'month':
        return String(new Date().getMonth() + 1).padStart(2, '0');

      case 'day':
        return String(new Date().getDate()).padStart(2, '0');

      case 'hour':
        return String(new Date().getHours()).padStart(2, '0');

      case 'minute':
      case 'min':
        return String(new Date().getMinutes()).padStart(2, '0');

      case 'second':
      case 'sec':
        return String(new Date().getSeconds()).padStart(2, '0');

      default:
        // Unknown expression, keep original
        return match;
    }
  });
}

/**
 * Format a date using a format string
 * Supports: YYYY, YY, MM, M, DD, D, HH, H, hh, h, mm, m, ss, s, A, a, Z
 * @param {Date} date - Date to format
 * @param {string} format - Format string
 * @returns {string} - Formatted date string
 */
function formatDateTime(date, format) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const ampm = hours24 < 12 ? 'AM' : 'PM';

  // Get timezone offset in ±HH:mm format
  const tzOffset = date.getTimezoneOffset();
  const tzSign = tzOffset <= 0 ? '+' : '-';
  const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
  const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0');
  const timezone = `${tzSign}${tzHours}:${tzMins}`;

  // Replace tokens (order matters - longer tokens first)
  return format
    .replace(/YYYY/g, year)
    .replace(/YY/g, String(year).slice(-2))
    .replace(/MM/g, String(month).padStart(2, '0'))
    .replace(/M/g, month)
    .replace(/DD/g, String(day).padStart(2, '0'))
    .replace(/D/g, day)
    .replace(/HH/g, String(hours24).padStart(2, '0'))
    .replace(/H/g, hours24)
    .replace(/hh/g, String(hours12).padStart(2, '0'))
    .replace(/h/g, hours12)
    .replace(/mm/g, String(minutes).padStart(2, '0'))
    .replace(/m/g, minutes)
    .replace(/ss/g, String(seconds).padStart(2, '0'))
    .replace(/s/g, seconds)
    .replace(/A/g, ampm)
    .replace(/a/g, ampm.toLowerCase())
    .replace(/Z/g, timezone);
}
