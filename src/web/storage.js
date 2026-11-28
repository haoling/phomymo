/**
 * デザインの保存(kv.js 経由。ゲストモードではメモリ、ログイン中は localStorage)
 *
 * デザインは1件ずつ「レコード」として持つ。Drive 同期(#40)の単位もこれ。
 *   { id, name, updatedAt, deleted, design, driveFileId?, dirty? }
 * - id: リネームしても変わらない uuid
 * - deleted: 削除の墓標。他の端末に削除を伝えるために残す
 * - dirty: まだ Drive に送っていない変更がある
 * - driveFileId: Drive 上のファイル(一度でも送ったことがある印)
 *
 * app.js からは今までどおり「名前」で扱える同期APIのまま。
 */

import { STORAGE_KEYS } from './constants.js';
import * as kv from './kv.js';
import { t } from './i18n.js';

const RECORDS_KEY = STORAGE_KEYS.DESIGN_RECORDS;
const LEGACY_DESIGNS_KEY = STORAGE_KEYS.DESIGNS;
const MULTI_LABEL_PRESETS_KEY = STORAGE_KEYS.MULTI_LABEL_PRESETS;

export function newDesignId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // 予備(secure context でない場合)
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function nextTimestamp(prev) {
  return Math.max(Date.now(), (prev || 0) + 1);
}

/** 旧形式(名前がキー)のデザインがあれば、uuid を付けてレコードへ移す */
function migrateLegacy(records) {
  const raw = kv.getItem(LEGACY_DESIGNS_KEY);
  if (raw === null) return false;
  try {
    const legacy = JSON.parse(raw) || {};
    for (const [name, design] of Object.entries(legacy)) {
      const exists = Object.values(records).some(r => !r.deleted && r.name === name);
      if (exists) continue;
      const id = newDesignId();
      records[id] = {
        id,
        name,
        updatedAt: nextTimestamp(design?.savedAt),
        deleted: false,
        design: design || {},
        dirty: true,
      };
    }
  } catch (e) {
    console.error('Failed to migrate legacy designs:', e);
  }
  kv.removeItem(LEGACY_DESIGNS_KEY);
  return true;
}

function readRecords() {
  let records = {};
  try {
    const data = kv.getItem(RECORDS_KEY);
    records = data ? JSON.parse(data) || {} : {};
  } catch (e) {
    console.error('Failed to load designs:', e);
    records = {};
  }
  if (migrateLegacy(records)) writeRecords(records);
  return records;
}

function writeRecords(records) {
  try {
    kv.setItem(RECORDS_KEY, JSON.stringify(records));
    return true;
  } catch (e) {
    console.error('Failed to save designs:', e);
    return false;
  }
}

/** 名前で生きているレコードを探す(同名が複数あれば新しいほう) */
function findLiveByName(records, name) {
  let found = null;
  for (const r of Object.values(records)) {
    if (r.deleted || r.name !== name) continue;
    if (!found || r.updatedAt > found.updatedAt) found = r;
  }
  return found;
}

function touch(record) {
  record.updatedAt = nextTimestamp(record.updatedAt);
  record.dirty = true;
}

/**
 * Save a design
 * @param {string} name - Design name
 * @param {object} design - { elements: [], labelSize: { width, height } }
 */
export function saveDesign(name, design) {
  if (!name || !name.trim()) {
    throw new Error(t('err_design_name_required'));
  }
  const trimmed = name.trim();
  const records = readRecords();
  let record = findLiveByName(records, trimmed);
  if (!record) {
    const id = newDesignId();
    record = { id, name: trimmed, updatedAt: 0, deleted: false, design: null };
    records[id] = record;
  }
  record.design = { ...design, savedAt: Date.now() };
  touch(record);

  if (!writeRecords(records)) {
    throw new Error(t('err_save_design_failed'));
  }
  return true;
}

/**
 * Load a design
 * @param {string} name - Design name
 * @returns {object|null} - { elements: [], labelSize: { width, height }, savedAt: number }
 */
export function loadDesign(name) {
  const record = findLiveByName(readRecords(), name);
  return record ? record.design : null;
}

/**
 * Get list of saved design names with metadata
 * @returns {Array} - [{ id, name, savedAt, labelSize, elementCount, isTemplate, templateDataCount, isMultiLabel, dirty }]
 */
export function listDesigns() {
  return Object.values(readRecords())
    .filter(r => !r.deleted && r.design)
    .map(({ id, name, design, dirty }) => ({
      id,
      name,
      savedAt: design.savedAt,
      labelSize: design.labelSize,
      elementCount: design.elements?.length || 0,
      isTemplate: design.isTemplate || false,
      templateFieldCount: design.templateFields?.length || 0,
      templateDataCount: design.templateData?.length || 0,
      hasImages: design.elements?.some(el => el.type === 'image') || false,
      isMultiLabel: design.multiLabel?.enabled || false,
      multiLabel: design.multiLabel || null,
      dirty: !!dirty,
    }))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)); // Most recent first
}

/**
 * Delete a design(墓標を残す)
 * @param {string} name - Design name
 */
export function deleteDesign(name) {
  const records = readRecords();
  const record = findLiveByName(records, name);
  if (!record) {
    return false;
  }
  record.deleted = true;
  record.design = null;
  touch(record);
  return writeRecords(records);
}

/**
 * Update only the counter state of a saved design (#31)
 * 印刷のたびに呼ばれるので savedAt は変えない(同期用の updatedAt は進める)
 * @param {string} name - Design name
 * @param {{resume: boolean, next: number}} counter
 * @returns {boolean} - false if the design does not exist
 */
export function updateDesignCounter(name, counter) {
  const records = readRecords();
  const record = findLiveByName(records, name);
  if (!record) {
    return false;
  }
  record.design.counter = { resume: !!counter.resume, next: Math.max(0, counter.next | 0) };
  touch(record);
  return writeRecords(records);
}

/**
 * 保存済みデザインの「印刷時の回転」だけを書き換える
 * @param {string} name - Design name
 * @param {'device'|0|90|180|270} printRotation - 'device' は機体の既定に従う(項目を消す)
 * @returns {boolean} - false if the design does not exist
 */
export function updateDesignPrintRotation(name, printRotation) {
  const records = readRecords();
  const record = findLiveByName(records, name);
  if (!record) {
    return false;
  }
  if ([0, 90, 180, 270].includes(printRotation)) record.design.printRotation = printRotation;
  else delete record.design.printRotation;
  touch(record);
  return writeRecords(records);
}

/**
 * Rename a design
 * @param {string} oldName - Current name
 * @param {string} newName - New name
 */
export function renameDesign(oldName, newName) {
  if (!newName || !newName.trim()) {
    throw new Error(t('err_new_name_required'));
  }

  const records = readRecords();
  const record = findLiveByName(records, oldName);
  if (!record) {
    throw new Error(t('status_design_not_found'));
  }

  const trimmedNew = newName.trim();
  if (trimmedNew !== oldName && findLiveByName(records, trimmedNew)) {
    throw new Error(t('err_design_name_exists'));
  }

  record.name = trimmedNew;
  touch(record);
  return writeRecords(records);
}

/**
 * Check if a design name exists
 * @param {string} name - Design name
 */
export function designExists(name) {
  return !!findLiveByName(readRecords(), name);
}

// =============================================================================
// 同期(#40)用。sync.js から使う
// =============================================================================

/** 全レコード(墓標を含む)のコピー */
export function getDesignRecords() {
  return readRecords();
}

/**
 * レコードを差し替える(同期で取ってきたもの、または送ったあとの印付け)
 * @param {object} record
 * @param {{ifUpdatedAt?: number}} [opts] - 指定したときは、手元の updatedAt が同じときだけ書く
 *   (送っている間に手元で編集された場合に、その編集を消さないため)
 * @returns {boolean} 書いたかどうか
 */
export function putDesignRecord(record, opts = {}) {
  const records = readRecords();
  const cur = records[record.id];
  if (opts.ifUpdatedAt !== undefined && cur && cur.updatedAt !== opts.ifUpdatedAt) {
    return false;
  }
  records[record.id] = { ...record };
  return writeRecords(records);
}

/** レコードを手元から消す(墓標の物理削除など) */
export function removeDesignRecord(id) {
  const records = readRecords();
  if (!(id in records)) return false;
  delete records[id];
  return writeRecords(records);
}

/** まだ Drive に送っていない変更の数 */
export function countUnsyncedDesigns() {
  return Object.values(readRecords()).filter(r => r.dirty).length;
}

/** 同期の対象になるキー(kv.onChange で使う) */
export const DESIGN_RECORDS_KEY = RECORDS_KEY;

/**
 * Export design as JSON string (for file download)
 * @param {string} name - Design name
 */
export function exportDesign(name) {
  const design = loadDesign(name);
  if (!design) {
    throw new Error(t('status_design_not_found'));
  }

  return JSON.stringify({
    name,
    version: 3, // Version 3 includes multi-label support
    ...design,
  }, null, 2);
}

/**
 * Import design from JSON string
 * @param {string} jsonString - JSON data
 * @param {string} overrideName - Optional name override
 * @returns {object} - { name, hasTemplateData, hasMultiLabel }
 */
export function importDesign(jsonString, overrideName = null) {
  try {
    const data = JSON.parse(jsonString);

    if (!data.elements || !Array.isArray(data.elements)) {
      throw new Error(t('err_design_missing_elements'));
    }

    if (!data.labelSize || typeof data.labelSize.width !== 'number') {
      throw new Error(t('err_design_missing_label_size'));
    }

    const name = overrideName || data.name || t('imported_at', { date: new Date().toLocaleString() });

    const designData = {
      elements: data.elements,
      labelSize: data.labelSize,
    };

    // Import template data if present
    if (data.isTemplate) {
      designData.isTemplate = true;
    }
    if (data.templateFields && Array.isArray(data.templateFields)) {
      designData.templateFields = data.templateFields;
    }
    if (data.templateData && Array.isArray(data.templateData)) {
      designData.templateData = data.templateData;
    }
    // デザインの変数 [{ name, value }]
    if (Array.isArray(data.variables)) {
      designData.variables = data.variables
        .filter(v => v && typeof v.name === 'string')
        .map(v => {
          const out = { name: v.name, value: v.value == null ? '' : String(v.value) };
          if (v.type === 'counter') {
            out.type = 'counter';
            for (const k of ['start', 'step', 'pad']) {
              if (Number.isFinite(Number(v[k]))) out[k] = Number(v[k]);
            }
          }
          return out;
        });
    }

    // Import multi-label configuration if present
    if (data.multiLabel && typeof data.multiLabel === 'object') {
      designData.multiLabel = {
        enabled: data.multiLabel.enabled || false,
        labelWidth: data.multiLabel.labelWidth || 10,
        labelHeight: data.multiLabel.labelHeight || 20,
        labelsAcross: data.multiLabel.labelsAcross || 4,
        gapMm: data.multiLabel.gapMm || 2,
        cloneMode: data.multiLabel.cloneMode !== false, // Default to true
      };
    }

    // 印刷時の回転(0/90/180/270)
    if ([0, 90, 180, 270].includes(data.printRotation)) {
      designData.printRotation = data.printRotation;
    }

    saveDesign(name, designData);

    return {
      name,
      hasTemplateData: (data.templateData?.length || 0) > 0,
      templateDataCount: data.templateData?.length || 0,
      hasMultiLabel: data.multiLabel?.enabled || false,
    };
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(t('err_invalid_json'));
    }
    throw e;
  }
}

/**
 * Get storage usage info
 */
export function getStorageInfo() {
  const designs = Object.values(readRecords()).filter(r => !r.deleted);
  const designCount = designs.length;
  const dataSize = JSON.stringify(designs).length;

  return {
    designCount,
    dataSize,
    dataSizeKB: (dataSize / 1024).toFixed(2),
  };
}

// =============================================================================
// MULTI-LABEL PRESETS
// =============================================================================

/**
 * Get all saved multi-label presets 
 * @returns {object} - { presetName: { labelWidth, labelHeight, labelsAcross, gapMm }, ... }
 */
export function getMultiLabelPresets() {
  try {
    const data = kv.getItem(MULTI_LABEL_PRESETS_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.error('Failed to load multi-label presets:', e);
    return {};
  }
}

/**
 * Save a multi-label preset
 * @param {string} name - Preset name
 * @param {object} config - { labelWidth, labelHeight, labelsAcross, gapMm }
 */
export function saveMultiLabelPreset(name, config) {
  if (!name || !name.trim()) {
    throw new Error(t('err_preset_name_required'));
  }

  const presets = getMultiLabelPresets();
  presets[name.trim()] = {
    labelWidth: config.labelWidth,
    labelHeight: config.labelHeight,
    labelsAcross: config.labelsAcross,
    gapMm: config.gapMm,
  };

  try {
    kv.setItem(MULTI_LABEL_PRESETS_KEY, JSON.stringify(presets));
    return true;
  } catch (e) {
    console.error('Failed to save multi-label preset:', e);
    throw new Error(t('err_save_preset_failed'));
  }
}

/**
 * Delete a multi-label preset
 * @param {string} name - Preset name
 */
export function deleteMultiLabelPreset(name) {
  const presets = getMultiLabelPresets();
  if (!(name in presets)) {
    return false;
  }

  delete presets[name];
  try {
    kv.setItem(MULTI_LABEL_PRESETS_KEY, JSON.stringify(presets));
    return true;
  } catch (e) {
    console.error('Failed to delete multi-label preset:', e);
    return false;
  }
}

/**
 * List all multi-label presets
 * @returns {Array} - [{ name, labelWidth, labelHeight, labelsAcross, gapMm }]
 */
export function listMultiLabelPresets() {
  const presets = getMultiLabelPresets();
  return Object.entries(presets).map(([name, config]) => ({
    name,
    ...config,
  }));
}
