/**
 * Phomymo Label Designer Application
 * Multi-element label editor with drag, resize, and rotate
 * v116
 */

import { CanvasRenderer } from './canvas.js?v=120';
import { BLETransport } from './ble.js?v=104';
import { USBTransport } from './usb.js?v=101';
import { normalizeMirror, defaultOrientFor, DEFAULT_MIRROR } from './mirror.js';
import { PRINT_ROTATIONS, ROTATION_FOLLOW_DEVICE, normalizeDesignRotation, getDeviceRotation, setDeviceRotation, resolvePrintRotation, rotatedSize } from './print-rotation.js';
import { print, printDensityTest, isDSeriesPrinter, isP12Printer, isA30Printer, isTapePrinter, isPM241Printer, isTSPLPrinter, isRotatedPrinter, getPrinterWidthBytes, getPrinterDpi, getPrinterAlignment, getPrinterDescription, isDeviceRecognized, getMatchedPattern, loadPrinterDefinitions, getAllPrinterDefinitions, getPrinterDefinition, getCustomPrinterDefinitions, saveCustomPrinterDefinition, deleteCustomPrinterDefinition, isBuiltinPrinter, resetBuiltinPrinter, getAvailableProtocols, getAvailableLabelPresets, getDetectedDefinition } from './printer.js?v=131';
import { densityTestLevels, buildDensityTestElements, DEFAULT_DENSITY_TEST_RANGE } from './density-test.js?v=1';
import {
  createTextElement,
  createImageElement,
  createBarcodeElement,
  createQRElement,
  createShapeElement,
  updateElement,
  deleteElement,
  duplicateElement,
  bringToFront,
  sendToBack,
  getElementAtPoint,
  constrainSize,
  groupElements,
  ungroupElements,
  getGroupMembers,
  getElementGroupId,
  getMultiElementBounds,
  moveElements,
  scaleElements,
  rotateElements,
  // Multi-label zone functions
  getElementsInZone,
  cloneElementsToZone,
  cloneElementsToAllZones,
  collapseToSingleZone,
  hasElementsInHigherZones,
  removeElementsInHigherZones,
  normalizeCrop,
  getImageBaseSize,
  getImageSourceRect,
} from './elements.js?v=104';
import {
  HandleType,
  getHandleAtPoint,
  getCursorForHandle,
  calculateResize,
  calculateRotation,
  snapRotation,
  getGroupHandleAtPoint,
  drawGroupHandles,
  calculateGroupResize,
  calculateGroupRotation,
} from './handles.js?v=101';
import {
  saveDesign,
  loadDesign,
  listDesigns,
  deleteDesign,
  updateDesignCounter,
  updateDesignPrintRotation,
} from './storage.js?v=104';
import { initAccountUI, showGuestNotice, showAccountDialog, isGuest } from './account-ui.js';
import { onTokenChange } from './auth.js';
import { onStatus as onSyncStatus } from './sync.js';
import { initAssetsPanel, ASSET_DEFAULTS } from './assets-panel.js';
import { createFrameElement, frameGeometryForLabel, FRAME_STYLES, frameStyleName } from './frames.js';
import { t, onLangChange } from './i18n.js';
import { openCropDialog } from './image-crop.js';
import { openAiBinarizeDialog } from './ai-binarize-dialog.js';
import { renderDesignList } from './design-gallery.js';
import { listSamples, buildSampleDesign, SAMPLES, sampleName } from './samples.js';
import { initTextStylePanel, updateTextStylePanel, mobileTextStyleHtml, wireMobileTextStyle } from './text-style-panel.js';
import { isVertical } from './text-layout.js';
import { initPrintOffsetUI } from './print-offset.js';
import {
  extractFields,
  hasTemplateFields,
  substituteFields,
  substituteFieldsByZone,
  parseCSV,
  createEmptyRecord,
  hasExpressions,
  evaluateExpressions,
  hasCounter,
  previewCounter,
  buildFieldValues,
  applyVariables,
  normalizeVariables,
  cleanVariableName,
  fieldsWithoutVariables,
  normalizeCounterVariable,
  formatCounter,
  findCounterOptions,
  COUNTER_DEFAULTS,
} from './templates.js?v=106';
import {
  readSpreadsheetFile,
  parseDelimitedTable,
  parseRowRange,
  formatRowRange,
  findMissingFields,
  SPREADSHEET_ACCEPT,
} from './spreadsheet.js';
import {
  isSheetsAvailable,
  canReadSilently,
  ensureSheetsScope,
  pickSpreadsheet,
  readSpreadsheet,
  preloadPicker,
  makeSource,
  normalizeSource,
  findSheetIndex,
  spreadsheetUrl,
} from './gsheets.js';
import {
  injectJapaneseFontStylesheet,
  addJapaneseFontsToSelect,
  japaneseFontOptionsHtml,
  waitForElementFonts,
} from './fonts-ja.js?v=1';
import {
  ZOOM,
  TEXT,
  IMAGE,
  ELEMENT,
  LABEL,
  MULTI_LABEL,
  PRINT,
  HISTORY,
  GUIDES,
  TOUCH,
  STORAGE_KEYS,
  M_SERIES_LABEL_SIZES,
  M_SERIES_ROUND_LABELS,
  D_SERIES_LABEL_SIZES,
  D_SERIES_CONTINUOUS_SIZES,
  D_SERIES_ROUND_LABELS,
  TAPE_LABEL_SIZES,
  PM241_LABEL_SIZES,
} from './constants.js?v=106';
import {
  bindCheckbox,
  bindToggleButton,
  bindButtonGroup,
  bindSelect,
  bindNumericInput,
  bindSlider,
  bindPositionInputs,
  bindAlignButtons,
  createBindingContext,
} from './utils/bindings.js?v=100';
import {
  configureErrorHandlers,
  safeAsync,
  trySafe,
  safeJsonParse,
  safeJsonStringify,
  safeStorageGet,
  safeStorageSet,
  showError,
  logError,
  ErrorLevel,
  ErrorCodes,
  getErrorMessage,
} from './utils/errors.js?v=101';
import {
  validateFontSize,
  validateImageScale,
  validateWidth,
  validateHeight,
  validateLabelWidth,
  validateLabelHeight,
  validateCopies,
  validateRotation,
  validateStrokeWidth,
  validateCornerRadius,
  validateBarcodeData,
  validateQRData,
  validateTextContent,
  validateDesignName,
  validateImageFile,
  validateCSVFile,
  validateJSONFile,
  validatePosition,
} from './utils/validation.js?v=101';

// DOM helpers
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Default to M-series sizes (imported from constants.js)
let LABEL_SIZES = { ...M_SERIES_LABEL_SIZES, ...M_SERIES_ROUND_LABELS };

// App state
const state = {
  connectionType: 'ble',
  labelSize: { width: 40, height: 30 },
  tapeWidth: 12,  // Tape width in mm for tape printers (P12/A30), default 12mm
  elements: [],
  selectedIds: [],  // Array of selected element IDs (supports multi-select)
  transport: null,
  renderer: null,
  canPrint: true,   // Set to false if browser doesn't support Bluetooth/USB
  currentDesignName: null,  // Name of the currently loaded design
  currentDesignSaved: false, // currentDesignName が保存済みのデザインを指しているか(ファイルからの読み込みは false)
  // 印刷時の回転(デザインごと)。'device' = 接続中の機体の既定に従う、または 0/90/180/270
  printRotation: ROTATION_FOLLOW_DEVICE,
  // Drag state
  isDragging: false,
  dragType: null, // 'move', 'resize', 'rotate'
  dragHandle: null,
  dragStartX: 0,
  dragStartY: 0,
  dragStartElements: null,  // Array of elements being dragged
  dragStartBounds: null,    // Group bounds at drag start
  dragStartAngle: 0,        // For group rotation
  // Zoom state
  zoom: 1,
  // Dither preview mode (shows how images will look when printed)
  ditherPreview: false,
  // Print settings
  printSettings: {
    density: 6,       // 1-8 (darkness)
    copies: 1,        // Number of copies
    feed: 32,         // Feed after print in dots (8 dots = 1mm)
    printerModel: 'auto',  // 'auto', 'narrow-48', 'mini-54', 'wide-72', 'mid-76', 'wide-81', 'd-series'
  },
  // Counter ([[counter]]) state (#31)
  // resume: true のとき、前回の続きから番号を振る(デザインごとに保存)
  // next:   次に印刷するラベルの位置(0 始まり)
  counter: { resume: false, next: 0 },
  // Template state
  variables: [],         // デザインの変数 [{ name, value }]({{変数名}} で文字・バーコード・QRに入る)
  templateFields: [],     // Detected field names from elements
  templateData: [],       // Array of data records for batch printing
  selectedRecords: [],    // Indices of selected records for printing
  currentPreviewIndex: 0, // Current label index in full preview
  // 表からの差し込み: 読み込んだ表の列・シート、キャンバスでプレビューする行
  templateColumns: [],    // Column names of the imported table (in order)
  templateSheets: null,   // [{ name, headers, records, truncated }] of the last .xlsx (in memory only)
  templateSheetIndex: 0,
  // 連携した Googleスプレッドシート(デザインの mergeSource として保存する)
  templateSource: null,   // { type: 'gsheet', spreadsheetId, name, sheetId, sheetName, rowRange? }
  templateSourceStatus: { loading: false, loadedAt: 0 },
  mergePreview: { enabled: false, row: 0 },
  // Inline text editing state
  editingTextId: null,    // ID of text element being inline-edited
  // Undo/Redo history
  history: [],            // Array of previous element states
  historyIndex: -1,       // Current position in history (-1 = no history)
  // Alignment guides (populated during drag)
  alignmentGuides: [],    // Array of { type: 'h'|'v', pos: number, label?: string }
  // Clipboard for copy/paste
  clipboard: [],          // Array of copied elements
  // Local fonts from system
  localFonts: [],         // Array of { family, fullName, style }
  localFontsEnabled: false, // Whether local fonts have been loaded
  // Multi-label roll configuration
  multiLabel: {
    enabled: false,
    labelWidth: 10,       // Individual label width in mm
    labelHeight: 20,      // Individual label height in mm
    labelsAcross: 4,      // Number of labels across
    gapMm: 2,             // Gap between labels in mm
    cloneMode: true,      // true = all zones identical, false = design individually
  },
  activeZone: 0,          // Currently selected zone for editing (0-based)
  // Pointer/touch state
  pointer: {
    pointers: new Map(),        // Track active pointers by pointerId
    longPressTimer: null,       // Timer for long-press detection
    longPressTriggered: false,  // Whether long-press was triggered
    longPressTarget: null,      // Element under long-press
    isPinching: false,          // Whether pinch gesture is active
    pinchStartDistance: 0,      // Initial distance between two fingers
    pinchStartZoom: 1,          // Zoom level when pinch started
    lastTapTime: 0,             // Timestamp of last tap (for double-tap detection)
    lastTapPos: { x: 0, y: 0 }, // Position of last tap
    usingTouch: false,          // Flag to prevent pointer/touch event conflicts
    // Two-finger gesture state
    isPanning: false,           // Whether two-finger pan is active
    panStartMidpoint: null,     // Starting midpoint of two fingers
    panStartOffset: { x: 0, y: 0 }, // Pan offset when gesture started
    gestureMode: null,          // null, 'zoom', or 'pan'
    lastDistance: 0,            // Last distance between fingers
    lastMidpoint: null,         // Last midpoint position
  },
  // Canvas pan offset (for viewing when zoomed in)
  panOffset: { x: 0, y: 0 },
  // Mobile UI state
  mobile: {
    isMobile: false,            // Whether viewport is mobile (<768px)
    menuOpen: false,            // Whether hamburger menu is open
    propsOpen: false,           // Whether properties panel is open
  },
};

// Note: GUIDES.SNAP_THRESHOLD, HISTORY.MAX_SIZE, and STORAGE_KEYS are imported from constants.js

/**
 * Get saved device-to-model mappings from localStorage
 * @returns {Object} Map of deviceName -> printerModel
 */
function getDeviceMappings() {
  const saved = safeStorageGet(STORAGE_KEYS.DEVICE_MAPPING);
  return safeJsonParse(saved, {});
}

/**
 * Save a device-to-model mapping
 * @param {string} deviceName - BLE device name
 * @param {string} printerModel - Selected printer model
 */
function saveDeviceMapping(deviceName, printerModel) {
  if (!deviceName) return;
  const mappings = getDeviceMappings();
  mappings[deviceName] = printerModel;
  safeStorageSet(STORAGE_KEYS.DEVICE_MAPPING, safeJsonStringify(mappings));
}

/**
 * Get saved model for a device
 * @param {string} deviceName - BLE device name
 * @returns {string|null} Saved printer model or null
 */
/**
 * 印刷で実際に使う回転の角度(デザインの指定 > 接続中の機体の既定)
 */
function currentPrintRotation() {
  const deviceName = state.transport?.getDeviceName?.() || '';
  return resolvePrintRotation(state.printRotation, deviceName);
}

function getSavedDeviceModel(deviceName) {
  if (!deviceName) return null;
  const mappings = getDeviceMappings();
  return mappings[deviceName] || null;
}

/**
 * 表示言語が変わったとき(と起動時)に、JS が書いている文言を書き直す。
 * data-i18n の付いた静的な文言は i18n.js が書き換える。
 */
function refreshLanguageTexts() {
  const connectBtn = $('#connect-btn');
  if (connectBtn && !connectBtn.disabled) connectBtn.textContent = t('connect');
  const printBtn = $('#print-btn');
  if (printBtn && !printBtn.disabled) printBtn.textContent = t('print');
  const fontsBtn = $('#add-system-fonts-btn');
  if (fontsBtn) fontsBtn.textContent = t('add_system_fonts');
  const saveTitle = $('#save-dialog-title');
  if (saveTitle && $('#save-dialog')?.classList.contains('hidden')) saveTitle.textContent = t('save_design');
  const status = $('#status-message');
  if (status && ['', 'Ready', '準備完了'].includes(status.textContent.trim())) status.textContent = t('ready');

  updateMobileLabelName();
  updateTemplateIndicator();
  renderVariablesPanel();
  updateImportInfo();
  updateCounterUI();
  updatePrintSize();
  updateElementsList();
  updatePropertiesPanel();
  if (state.mobile?.propsOpen) populateMobileProps();
  else if ($('#mobile-props-title')) $('#mobile-props-title').textContent = t('properties');
  const mobileTemplateStatus = $('#mobile-template-status');
  if (mobileTemplateStatus && !state.templateFields.length) mobileTemplateStatus.textContent = t('n_fields', { n: 0 });

  // JS で作り直したラベルサイズの選択肢は、作り直して訳す
  const deviceName = state.transport?.getDeviceName?.() || '';
  const model = state.printSettings?.printerModel || 'auto';
  if ($('#label-size') && !$('#label-size option[data-i18n]')) updateLabelSizeDropdown(deviceName, model);
  if ($('#mobile-label-size') && !$('#mobile-label-size option[data-i18n]')) updateMobileLabelSizeDropdown(deviceName, model);

  // 機種の一覧(グループ名)と枠の種類
  if (getAllPrinterDefinitions().length) populatePrinterModelDropdown();
  const frameStyleSelect = $('#prop-frame-style');
  if (frameStyleSelect) {
    const v = frameStyleSelect.value;
    frameStyleSelect.innerHTML = FRAME_STYLES.map(fs => `<option value="${fs.id}">${frameStyleName(fs)}</option>`).join('');
    frameStyleSelect.value = v;
  }
  if (state.transport?.isConnected?.()) {
    updatePrinterInfoUI(deviceName, state.printSettings?.printerModel);
  }
  updatePrintRotationTexts();
  if ($('#template-data-dialog') && !$('#template-data-dialog').classList.contains('hidden')) updateTemplateDataTable();
  else if ($('#template-record-count')) $('#template-record-count').textContent = t('n_records', { n: state.templateData.length });
  const previewCount = $('#preview-count');
  if (previewCount && /^\d+\D*$/.test(previewCount.textContent.trim())) {
    previewCount.textContent = t('n_labels', { n: parseInt(previewCount.textContent, 10) || 0 });
  }
}

/**
 * プリンター機種の一覧のグループ名(printers.json の英語名)を表示用にする
 */
function printerGroupLabel(group) {
  const map = { 'Tape Printers': 'tape_printers_group', 'D-Series': 'd_series_group' };
  if (map[group]) return t(map[group]);
  const m = /^(.+) Series$/.exec(group);
  return m ? t('series_group', { name: m[1] }) : group;
}

/**
 * 図形の種類の表示名
 */
function shapeName(shapeType) {
  const keys = { rectangle: 'rectangle', ellipse: 'ellipse', triangle: 'triangle', line: 'line' };
  return t(keys[shapeType] || 'shape');
}

/**
 * Update status message
 */
function setStatus(message) {
  $('#status-message').textContent = message;
}

/**
 * Check if Local Font Access API is available
 */
function isLocalFontAccessAvailable() {
  return 'queryLocalFonts' in window;
}

/**
 * Load locally installed system fonts using Local Font Access API
 * Requires user permission (Chrome/Edge 103+)
 */
async function loadLocalFonts() {
  if (!isLocalFontAccessAvailable()) {
    console.log('Local Font Access API not available');
    setStatus(t('status_system_fonts_unsupported'));
    return false;
  }

  try {
    setStatus(t('status_requesting_font_access'));
    const fonts = await window.queryLocalFonts();

    // Deduplicate by family name, keep unique families
    const familyMap = new Map();
    for (const font of fonts) {
      if (!familyMap.has(font.family)) {
        familyMap.set(font.family, font);
      }
    }

    state.localFonts = Array.from(familyMap.values())
      .sort((a, b) => a.family.localeCompare(b.family));
    state.localFontsEnabled = true;

    // Persist preference
    safeStorageSet(STORAGE_KEYS.LOCAL_FONTS_ENABLED, 'true');

    // Update all font dropdowns
    updateFontDropdowns();

    setStatus(t('status_loaded_system_fonts', { n: state.localFonts.length }));
    console.log(`Loaded ${state.localFonts.length} local fonts`);
    return true;
  } catch (err) {
    console.error('Failed to load local fonts:', err);
    if (err.name === 'NotAllowedError') {
      setStatus(t('status_font_access_denied'));
    } else {
      setStatus(t('status_system_fonts_failed'));
    }
    return false;
  }
}

/**
 * Update all font dropdowns with local fonts
 */
function updateFontDropdowns() {
  const dropdown = $('#prop-font-family');
  if (!dropdown) return;

  // Remove existing "System Fonts" optgroup if present
  const existing = dropdown.querySelector('optgroup[data-system-fonts]');
  if (existing) existing.remove();

  // Add new optgroup with local fonts
  if (state.localFonts.length > 0) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = t('system_fonts');
    optgroup.dataset.systemFonts = '';
    optgroup.dataset.i18nLabel = 'system_fonts';

    for (const font of state.localFonts) {
      const option = document.createElement('option');
      option.value = font.family;
      option.textContent = font.family;
      option.style.fontFamily = font.family;
      optgroup.appendChild(option);
    }

    dropdown.appendChild(optgroup);
  }

  // Hide "Add System Fonts" button
  const btn = $('#add-system-fonts-btn');
  if (btn) btn.classList.add('hidden');
}

/**
 * Initialize local fonts UI - show button if API available, auto-load if previously enabled
 */
async function initLocalFonts() {
  const btn = $('#add-system-fonts-btn');
  if (!btn) return;

  if (!isLocalFontAccessAvailable()) {
    // API not available, keep button hidden
    return;
  }

  // Check if user previously enabled local fonts
  const wasEnabled = safeStorageGet(STORAGE_KEYS.LOCAL_FONTS_ENABLED) === 'true';

  if (wasEnabled) {
    // Auto-load fonts (permission should be remembered)
    await loadLocalFonts();
  } else {
    // Show the button so user can opt-in
    btn.classList.remove('hidden');
  }
}

/**
 * Detect dither mode from elements
 * Uses first image element's dither setting, or 'auto' if none
 * @param {Array} elements - Array of label elements
 * @returns {string} Dither mode ('auto', 'none', 'threshold', 'floyd-steinberg', 'atkinson', 'ordered')
 */
function getDitherMode(elements) {
  for (const el of elements) {
    if (el.type === 'image' && el.dither) {
      return el.dither;
    }
  }
  return 'auto';
}

/**
 * Save current state to history (call before modifications)
 */
function saveHistory() {
  // Deep clone current elements
  const snapshot = JSON.parse(JSON.stringify(state.elements));

  // If we're not at the end of history, truncate future states
  if (state.historyIndex < state.history.length - 1) {
    state.history = state.history.slice(0, state.historyIndex + 1);
  }

  // Add new state
  state.history.push(snapshot);

  // Limit history size
  if (state.history.length > HISTORY.MAX_SIZE) {
    state.history.shift();
  } else {
    state.historyIndex++;
  }

  updateUndoRedoButtons();
}

// Track input values for change detection on blur
const _inputHistoryTracking = new WeakMap();

/**
 * Set up an input element to save history only if value changed
 * @param {string} selector - CSS selector for the input
 * @param {Function} getElementValue - Function to get the current element's value for comparison
 */
function trackInputForHistory(selector, getElementValue) {
  const el = $(selector);
  if (!el) return;

  el.addEventListener('focus', () => {
    if (!state.selectedIds[0]) return;
    // Store snapshot of current state when focus begins
    const snapshot = JSON.parse(JSON.stringify(state.elements));
    _inputHistoryTracking.set(el, { snapshot, elementId: state.selectedIds[0] });
  });

  el.addEventListener('blur', () => {
    const tracking = _inputHistoryTracking.get(el);
    if (!tracking) return;

    // Compare current state to snapshot - only save if different
    const currentState = JSON.stringify(state.elements);
    const snapshotState = JSON.stringify(tracking.snapshot);

    if (currentState !== snapshotState) {
      // Value changed - push the old state to history
      if (state.historyIndex < state.history.length - 1) {
        state.history = state.history.slice(0, state.historyIndex + 1);
      }
      state.history.push(tracking.snapshot);
      if (state.history.length > HISTORY.MAX_SIZE) {
        state.history.shift();
      } else {
        state.historyIndex++;
      }
      updateUndoRedoButtons();
    }

    _inputHistoryTracking.delete(el);
  });
}

/**
 * Undo last action
 */
function undo() {
  if (state.historyIndex < 0) return;

  // Save current state if we're at the end (so we can redo back to it)
  if (state.historyIndex === state.history.length - 1) {
    const current = JSON.parse(JSON.stringify(state.elements));
    state.history.push(current);
  }

  // Restore previous state
  state.elements = JSON.parse(JSON.stringify(state.history[state.historyIndex]));
  state.historyIndex--;

  // Clear selection if selected elements no longer exist
  state.selectedIds = state.selectedIds.filter(id =>
    state.elements.some(el => el.id === id)
  );

  state.renderer.clearCache();
  render();
  updatePropertiesPanel();
  updateToolbarState();
  updateUndoRedoButtons();
  detectTemplateFields();
  setStatus(t('undo'));
}

/**
 * Redo last undone action
 */
function redo() {
  if (state.historyIndex >= state.history.length - 2) return;

  state.historyIndex++;
  const nextState = state.history[state.historyIndex + 1];
  if (!nextState) return; // Safety check
  state.elements = JSON.parse(JSON.stringify(nextState));

  // Clear selection if selected elements no longer exist
  state.selectedIds = state.selectedIds.filter(id =>
    state.elements.some(el => el.id === id)
  );

  state.renderer.clearCache();
  render();
  updatePropertiesPanel();
  updateToolbarState();
  updateUndoRedoButtons();
  detectTemplateFields();
  setStatus(t('redo'));
}

/**
 * Update undo/redo button states
 */
function updateUndoRedoButtons() {
  const undoBtn = $('#undo-btn');
  const redoBtn = $('#redo-btn');
  if (undoBtn) undoBtn.disabled = state.historyIndex < 0;
  if (redoBtn) redoBtn.disabled = state.historyIndex >= state.history.length - 2;
}

/**
 * Reset history (call when loading a new design)
 */
function resetHistory() {
  state.history = [];
  state.historyIndex = -1;
  updateUndoRedoButtons();
}

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - 'success', 'error', 'info', or 'warning'
 * @param {number} duration - Duration in ms (default 2000)
 */
function showToast(message, type = 'info', duration = 2000) {
  const container = $('#toast-container');

  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'px-4 py-2 rounded-lg shadow-lg text-sm font-medium transform transition-all duration-300 translate-y-2 opacity-0';

  // Set colors based on type
  switch (type) {
    case 'success':
      toast.classList.add('bg-green-600', 'text-white');
      break;
    case 'error':
      toast.classList.add('bg-red-600', 'text-white');
      break;
    case 'warning':
      toast.classList.add('bg-yellow-500', 'text-white');
      break;
    default:
      toast.classList.add('bg-gray-800', 'text-white');
  }

  toast.textContent = message;
  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  // Remove after duration
  setTimeout(() => {
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Print progress state
 */
let printProgressCancelled = false;

/**
 * Show print progress modal
 */
function showPrintProgress(title, total) {
  printProgressCancelled = false;
  const modal = $('#print-progress-modal');
  $('#progress-title').textContent = title;
  $('#progress-subtitle').textContent = t('progress_preparing');
  $('#progress-bar').style.width = '0%';
  $('#progress-detail').textContent = t('progress_count', { current: 0, total });
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

/**
 * Update print progress
 */
function updatePrintProgress(current, total, sublabel = '') {
  const percent = Math.round((current / total) * 100);
  $('#progress-bar').style.width = `${percent}%`;
  $('#progress-detail').textContent = t('progress_count', { current, total });
  $('#progress-subtitle').textContent = sublabel || t('progress_printing_label', { n: current });
}

/**
 * Hide print progress modal
 */
function hidePrintProgress() {
  const modal = $('#print-progress-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

/**
 * Check if print was cancelled
 */
function isPrintCancelled() {
  return printProgressCancelled;
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(connected) {
  const dot = $('#status-dot');
  const dotStandalone = $('#status-dot-standalone');
  const printerInfoBtn = $('#printer-info-btn');
  const ditherPreviewBtn = $('#dither-preview-btn');
  const connectBtn = $('#connect-btn');
  const connType = $('#conn-type');
  const mobileDot = $('#mobile-status-dot');
  const mobileConnectBtn = $('#mobile-connect-btn');
  const mobileDisconnectBtn = $('#mobile-disconnect-btn');

  dot.classList.toggle('bg-green-500', connected);
  dot.classList.toggle('bg-gray-400', !connected);

  // Update mobile status dot
  if (mobileDot) {
    mobileDot.classList.toggle('bg-green-500', connected);
    mobileDot.classList.toggle('bg-gray-400', !connected);
  }

  // Hide/show desktop connect button and connection type selector
  if (connectBtn) {
    connectBtn.classList.toggle('hidden', connected);
  }
  if (connType) {
    connType.classList.toggle('hidden', connected);
    // On small screens conn-type is already hidden, so only toggle for larger screens
    if (!connected) {
      connType.classList.add('hidden', 'sm:block');
    }
  }

  // Hide/show mobile connect button
  if (mobileConnectBtn) {
    mobileConnectBtn.classList.toggle('hidden', connected);
  }
  if (mobileDisconnectBtn) {
    mobileDisconnectBtn.classList.toggle('hidden', !connected);
  }

  // Show/hide printer info button vs standalone dot
  if (connected) {
    printerInfoBtn.classList.remove('hidden');
    dotStandalone.classList.add('hidden');
    // When printer info button is visible, it has rounded-l-lg, so dither preview shouldn't
    ditherPreviewBtn.classList.remove('rounded-l-lg');
  } else {
    printerInfoBtn.classList.add('hidden');
    dotStandalone.classList.remove('hidden');
    // When printer info button is hidden, dither preview needs rounded-l-lg
    ditherPreviewBtn.classList.add('rounded-l-lg');
    // Hide popup if open
    $('#printer-info-popup').classList.add('hidden');
  }
}

/**
 * Update printer info UI with current data
 */
function updatePrinterInfoUI(deviceName, printerModel) {
  const effectiveModel = printerModel || state.printSettings.printerModel;
  const isDSeries = isDSeriesPrinter(deviceName, effectiveModel);
  const isP12 = isP12Printer(deviceName, effectiveModel);
  const width = getPrinterWidthBytes(deviceName, effectiveModel);

  // Update device info
  $('#pi-device-name').textContent = deviceName || '--';
  $('#pi-model').textContent = getMatchedPattern(deviceName) || effectiveModel || t('unknown');
  // P12 uses M-series protocol but prints rotated like D-series
  $('#pi-protocol').textContent = isP12 ? t('protocol_p12') : isDSeries ? t('protocol_d_series') : t('protocol_m_series');
  $('#pi-width').textContent = isDSeries ? t('variable') : `${width * 8}px (${Math.round(width * 8 / 8)}mm)`;

  // Update summary in button
  const battery = state.transport?.printerInfo?.battery;
  const summaryParts = [];
  if (getMatchedPattern(deviceName)) {
    summaryParts.push(getMatchedPattern(deviceName));
  }
  if (battery !== null && battery !== undefined) {
    summaryParts.push(`${battery}%`);
  }
  $('#printer-info-summary').textContent = summaryParts.length ? summaryParts.join(' | ') : deviceName?.substring(0, 8) || '--';
}

/**
 * Update the mobile label name display
 */
function updateMobileLabelName() {
  const mobileLabelName = $('#mobile-label-name');
  if (mobileLabelName) {
    mobileLabelName.textContent = state.currentDesignName || t('untitled_label');
  }
}

/**
 * Update printer info popup with live data from printer queries
 */
function updatePrinterInfoFromQuery(field, value, allInfo) {
  switch (field) {
    case 'battery':
      $('#pi-battery-text').textContent = value !== null ? `${value}%` : '--';
      // Update icon color based on level
      const icon = $('#pi-battery-icon');
      if (value !== null) {
        if (value <= 10) icon.classList.replace('text-gray-400', 'text-red-500');
        else if (value <= 30) icon.classList.replace('text-gray-400', 'text-yellow-500');
        else icon.classList.replace('text-gray-400', 'text-green-500');
      }
      // Update summary
      const deviceName = state.transport?.getDeviceName?.() || '';
      updatePrinterInfoUI(deviceName, state.printSettings.printerModel);
      break;
    case 'paper':
      // Use icon prefix for accessibility (not just color)
      $('#pi-paper').textContent = value === 'ok' ? t('paper_ok') : (value === 'out' ? t('paper_out') : '--');
      if (value === 'out') {
        $('#pi-paper').classList.add('text-red-600', 'font-semibold');
      } else {
        $('#pi-paper').classList.remove('text-red-600', 'font-semibold');
      }
      break;
    case 'firmware':
      $('#pi-firmware').textContent = value || '--';
      break;
    case 'serial':
      $('#pi-serial').textContent = value || '--';
      break;
  }
}

/**
 * Update label size dropdown options based on connected printer type
 * @param {string} deviceName - BLE device name (optional)
 * @param {string} model - Printer model override (optional)
 */
function updateLabelSizeDropdown(deviceName = '', model = 'auto') {
  const select = $('#label-size');
  const currentValue = select.value;
  const currentSize = state.labelSize;

  // Determine printer type and appropriate sizes
  const isTape = isTapePrinter(deviceName, model);
  const isDSeries = isDSeriesPrinter(deviceName, model);
  const isPM241 = isPM241Printer(deviceName, model);

  // Show/hide tape width selector
  updateTapeWidthVisibility(isTape);
  // Show "Continuous" checkbox in Custom row only for D-series
  updateCustomContinuousVisibility(isDSeries);

  let rectSizes, roundSizes, defaultKey;
  if (isTape) {
    // Tape printers (P12/A30) - filter by selected tape width
    rectSizes = Object.fromEntries(
      Object.entries(TAPE_LABEL_SIZES).filter(([key, size]) => size.tapeWidth === state.tapeWidth)
    );
    roundSizes = {}; // No round labels for tape printers
    defaultKey = `40x${state.tapeWidth}`;
  } else if (isDSeries) {
    // D-series uses fixed narrow label sizes + continuous tape options
    rectSizes = D_SERIES_LABEL_SIZES;
    roundSizes = D_SERIES_ROUND_LABELS;
    defaultKey = '40x12';
  } else if (isPM241) {
    // PM-241 shipping label sizes (4-inch width)
    rectSizes = PM241_LABEL_SIZES;
    roundSizes = {}; // No round labels for shipping printer
    defaultKey = '102x152'; // 4x6" default
  } else {
    // Standard M-series label sizes
    rectSizes = M_SERIES_LABEL_SIZES;
    roundSizes = M_SERIES_ROUND_LABELS;
    defaultKey = '40x30';
  }

  const continuousSizes = isDSeries ? D_SERIES_CONTINUOUS_SIZES : {};
  LABEL_SIZES = { ...rectSizes, ...roundSizes, ...continuousSizes };

  // Clear existing options (except custom)
  while (select.options.length > 0) {
    select.remove(0);
  }

  // Add rectangular label options
  for (const [key, size] of Object.entries(rectSizes)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = `${size.width}x${size.height}mm`;
    select.appendChild(option);
  }

  // Add separator and round label options if available
  if (Object.keys(roundSizes).length > 0) {
    const separator = document.createElement('option');
    separator.disabled = true;
    separator.textContent = t('round_labels');
    select.appendChild(separator);

    for (const [key, size] of Object.entries(roundSizes)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = t('round_size', { w: size.width }); // e.g., "20mm Round"
      select.appendChild(option);
    }
  }

  // Add continuous tape options for D-series
  if (Object.keys(continuousSizes).length > 0) {
    const separator = document.createElement('option');
    separator.disabled = true;
    separator.textContent = t('continuous_tape_separator');
    select.appendChild(separator);

    for (const [key, size] of Object.entries(continuousSizes)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = t('continuous_size', { w: size.width, h: size.height });
      select.appendChild(option);
    }
  }

  // Add custom option
  const customOption = document.createElement('option');
  customOption.value = 'custom';
  customOption.textContent = t('custom');
  select.appendChild(customOption);

  // Add multi-label option
  const multiLabelOption = document.createElement('option');
  multiLabelOption.value = 'multi-label';
  multiLabelOption.textContent = t('multi_label_roll');
  select.appendChild(multiLabelOption);

  // Try to restore current size or pick a sensible default
  const currentKey = currentSize.round
    ? `${currentSize.width}mm Round`
    : `${currentSize.width}x${currentSize.height}`;
  if (currentValue === 'multi-label') {
    // Keep multi-label mode if already in it
    select.value = 'multi-label';
  } else if (LABEL_SIZES[currentKey]) {
    select.value = currentKey;
    $('#custom-size').classList.add('hidden');
  } else if (currentValue === 'custom') {
    select.value = 'custom';
    $('#custom-size').classList.remove('hidden');
  } else {
    // Pick default based on printer type
    select.value = defaultKey;
    state.labelSize = { ...LABEL_SIZES[defaultKey] };
    state.renderer.setDimensions(state.labelSize.width, state.labelSize.height, state.zoom, state.labelSize.round || false);
    state.renderer.clearCache();
    updatePrintSize();
    // Auto zoom-to-fit if label is too large at 100% zoom
    zoomToFitIfNeeded();
    render();
    $('#custom-size').classList.add('hidden');
  }

  // Also update mobile dropdown
  updateMobileLabelSizeDropdown(deviceName, model);
}

/**
 * Update mobile label size dropdown to match desktop
 * @param {string} deviceName - BLE device name (optional)
 * @param {string} model - Printer model override (optional)
 */
function updateMobileLabelSizeDropdown(deviceName = '', model = 'auto') {
  const mobileSelect = $('#mobile-label-size');
  const desktopSelect = $('#label-size');
  if (!mobileSelect) return;

  // Determine printer type and appropriate sizes
  const isTape = isTapePrinter(deviceName, model);
  const isDSeries = isDSeriesPrinter(deviceName, model);
  const isPM241 = isPM241Printer(deviceName, model);

  let rectSizes, roundSizes;
  if (isTape) {
    // Tape printers - filter by selected tape width
    rectSizes = Object.fromEntries(
      Object.entries(TAPE_LABEL_SIZES).filter(([key, size]) => size.tapeWidth === state.tapeWidth)
    );
    roundSizes = {};
  } else if (isDSeries) {
    rectSizes = D_SERIES_LABEL_SIZES;
    roundSizes = D_SERIES_ROUND_LABELS;
  } else if (isPM241) {
    rectSizes = PM241_LABEL_SIZES;
    roundSizes = {};
  } else {
    rectSizes = M_SERIES_LABEL_SIZES;
    roundSizes = M_SERIES_ROUND_LABELS;
  }

  const continuousSizes = isDSeries ? D_SERIES_CONTINUOUS_SIZES : {};

  // Clear and rebuild mobile dropdown
  while (mobileSelect.options.length > 0) {
    mobileSelect.remove(0);
  }

  // Add rectangular labels
  for (const [key, size] of Object.entries(rectSizes)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = `${size.width}x${size.height}mm`;
    mobileSelect.appendChild(option);
  }

  // Add round labels
  if (Object.keys(roundSizes).length > 0) {
    const separator = document.createElement('option');
    separator.disabled = true;
    separator.textContent = t('round_labels_short');
    mobileSelect.appendChild(separator);

    for (const [key, size] of Object.entries(roundSizes)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = t('round_size', { w: size.width });
      mobileSelect.appendChild(option);
    }
  }

  // Add continuous tape options for D-series
  if (Object.keys(continuousSizes).length > 0) {
    const separator = document.createElement('option');
    separator.disabled = true;
    separator.textContent = t('continuous_separator');
    mobileSelect.appendChild(separator);

    for (const [key, size] of Object.entries(continuousSizes)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = t('continuous_size', { w: size.width, h: size.height });
      mobileSelect.appendChild(option);
    }
  }

  // Add custom option
  const customOption = document.createElement('option');
  customOption.value = 'custom';
  customOption.textContent = t('custom');
  mobileSelect.appendChild(customOption);

  // Add multi-label option
  const multiLabelOption = document.createElement('option');
  multiLabelOption.value = 'multi-label';
  multiLabelOption.textContent = t('multi_label_short');
  mobileSelect.appendChild(multiLabelOption);

  // Sync with desktop selection
  mobileSelect.value = desktopSelect.value;
}

/**
 * Check if the currently connected printer is a continuous tape printer (P12/A30)
 * or a D-series with a continuous tape label selected
 * @returns {boolean} True if continuous tape mode is active
 */
function isContinuousTapePrinter() {
  const deviceName = state.transport?.getDeviceName?.() || '';
  const printerModel = state.printSettings.printerModel;
  if (isTapePrinter(deviceName, printerModel)) return true;
  // D-series with continuous label selected
  return !!(state.labelSize && state.labelSize.continuous);
}

/**
 * Show or hide the label length adjust buttons based on printer type
 * Only shown for tape printers (P12/A30)
 */
function updateLengthAdjustButtons() {
  const show = isContinuousTapePrinter();
  $('#label-length-adjust')?.classList.toggle('hidden', !show);
  $('#mobile-label-length-adjust')?.classList.toggle('hidden', !show);
}

/**
 * Show or hide the tape width selector based on printer type
 * @param {boolean} show - Whether to show the tape width selector
 */
function updateTapeWidthVisibility(show) {
  $('#tape-width-selector')?.classList.toggle('hidden', !show);
  $('#mobile-tape-width-selector')?.classList.toggle('hidden', !show);
}

/**
 * Show or hide the "Continuous" checkbox in the Custom size row.
 * Only meaningful for D-series (M-series has no continuous mode; P12/A30 are
 * always continuous and use a different UI).
 * @param {boolean} show - Whether to show the continuous checkbox
 */
function updateCustomContinuousVisibility(show) {
  $('#custom-continuous-wrap')?.classList.toggle('hidden', !show);
  $('#mobile-custom-continuous-wrap')?.classList.toggle('hidden', !show);
  if (!show) {
    if ($('#custom-continuous')) $('#custom-continuous').checked = false;
    if ($('#mobile-custom-continuous')) $('#mobile-custom-continuous').checked = false;
  }
}

/**
 * Handle tape width change from dropdown
 * @param {number} width - New tape width in mm
 */
function setTapeWidth(width) {
  state.tapeWidth = width;

  // Sync both dropdowns
  const desktopSelect = $('#tape-width');
  const mobileSelect = $('#mobile-tape-width');
  if (desktopSelect) desktopSelect.value = width;
  if (mobileSelect) mobileSelect.value = width;

  // Save tape width preference for this device
  saveTapeWidthForDevice();

  // Refresh label size options to match new tape width
  const deviceName = state.transport?.getDeviceName?.() || '';
  const printerModel = state.printSettings.printerModel;
  updateLabelSizeDropdown(deviceName, printerModel);
}

/**
 * Save tape width preference for the current device
 */
function saveTapeWidthForDevice() {
  const deviceName = state.transport?.getDeviceName?.();
  if (!deviceName) return;

  try {
    const stored = safeStorageGet(STORAGE_KEYS.DEVICE_MAPPING) || '{}';
    const mapping = JSON.parse(stored);

    if (!mapping[deviceName]) {
      mapping[deviceName] = {};
    }
    mapping[deviceName].tapeWidth = state.tapeWidth;

    safeStorageSet(STORAGE_KEYS.DEVICE_MAPPING, JSON.stringify(mapping));
  } catch (e) {
    console.warn('Failed to save tape width preference:', e);
  }
}

/**
 * Load tape width preference for a device
 * @param {string} deviceName - Device name
 * @returns {number} Tape width in mm (default 12)
 */
function loadTapeWidthForDevice(deviceName) {
  try {
    const stored = safeStorageGet(STORAGE_KEYS.DEVICE_MAPPING) || '{}';
    const mapping = JSON.parse(stored);
    return mapping[deviceName]?.tapeWidth || 12;
  } catch (e) {
    return 12;
  }
}

/**
 * Adjust the label length by a delta (for continuous tape printers)
 * @param {number} delta - Amount to adjust in mm (positive or negative)
 */
function adjustLabelLength(delta) {
  const currentWidth = state.labelSize.width;
  const tapeHeight = state.labelSize.height || 12;
  const newWidth = Math.max(10, Math.min(100, currentWidth + delta));

  if (newWidth !== currentWidth) {
    // Update to custom size, preserve continuous flag and tape height
    state.labelSize = { width: newWidth, height: tapeHeight, continuous: state.labelSize.continuous || false };
    $('#label-size').value = 'custom';
    $('#custom-size').classList.remove('hidden');
    $('#custom-width').value = newWidth;
    $('#custom-height').value = tapeHeight;

    // Update canvas
    state.renderer.setDimensions(newWidth, tapeHeight, state.zoom, false);
    state.renderer.clearCache();
    render();
    updatePrintSize();

    // Sync mobile
    $('#mobile-label-size').value = 'custom';
    $('#mobile-custom-size')?.classList.remove('hidden');
    $('#mobile-custom-width').value = newWidth;
    $('#mobile-custom-height').value = tapeHeight;
  }
}

/**
 * Update print size display
 */
function updatePrintSize() {
  const { width, height, round } = state.labelSize;
  if (round) {
    $('#print-size').textContent = t('print_size_round', { w: width });
  } else {
    $('#print-size').textContent = `${width} x ${height} mm`;
  }
}

/**
 * Update zoom level display and re-render at new resolution
 */
function updateZoom() {
  $('#zoom-level').textContent = `${Math.round(state.zoom * 100)}%`;
  // Set zoom on renderer for high-resolution rendering (prevents pixelation)
  state.renderer.setZoom(state.zoom);
  render();
}

/**
 * Zoom in
 */
function zoomIn() {
  state.zoom = Math.min(state.zoom + ZOOM.STEP, ZOOM.MAX);
  updateZoom();
}

/**
 * Zoom out
 */
function zoomOut() {
  state.zoom = Math.max(state.zoom - ZOOM.STEP, ZOOM.MIN);
  updateZoom();
}

/**
 * Reset zoom to 100%
 */
function zoomReset() {
  state.zoom = 1;
  updateZoom();
  resetPanOffset();
}

/**
 * Zoom to fit label within visible canvas area
 * Calculates optimal zoom level so the entire label is visible
 */
function zoomToFit() {
  // Get the canvas area container (parent of canvas-container)
  const canvasArea = $('#canvas-container')?.parentElement;
  if (!canvasArea) return;

  // Get available space (with some padding)
  const padding = 48; // px padding on each side
  const availableWidth = canvasArea.clientWidth - padding * 2;
  const availableHeight = canvasArea.clientHeight - padding * 2;

  // Get label dimensions in pixels (from renderer)
  const dims = state.renderer.getDimensions();
  if (!dims.width || !dims.height) return;

  // Calculate zoom to fit both dimensions
  const zoomX = availableWidth / dims.width;
  const zoomY = availableHeight / dims.height;
  let fitZoom = Math.min(zoomX, zoomY);

  // Clamp to valid zoom range
  fitZoom = Math.max(ZOOM.MIN, Math.min(ZOOM.MAX, fitZoom));

  // Round to nearest step for cleaner display
  fitZoom = Math.round(fitZoom / ZOOM.STEP) * ZOOM.STEP;
  fitZoom = Math.max(ZOOM.MIN, Math.min(ZOOM.MAX, fitZoom));

  state.zoom = fitZoom;
  updateZoom();
  resetPanOffset();
}

/**
 * Zoom to fit only if current label doesn't fit at 100% zoom
 * Preserves zoom if label already fits, adjusts if too large
 */
function zoomToFitIfNeeded() {
  // Get the canvas area container (parent of canvas-container)
  const canvasArea = $('#canvas-container')?.parentElement;
  if (!canvasArea) return;

  // Get available space (with some padding)
  const padding = 48;
  const availableWidth = canvasArea.clientWidth - padding * 2;
  const availableHeight = canvasArea.clientHeight - padding * 2;

  // Get label dimensions in pixels
  const dims = state.renderer.getDimensions();
  if (!dims.width || !dims.height) return;

  // Check if label fits at 100% zoom
  const fitsAt100 = dims.width <= availableWidth && dims.height <= availableHeight;

  if (fitsAt100) {
    // Label fits at 100%, reset to default zoom
    state.zoom = 1;
    updateZoom();
    resetPanOffset();
  } else {
    // Label too large, zoom to fit
    zoomToFit();
  }
}

/**
 * 差し込みに使う値(デザインの変数 + 表の1行。同じ名前なら表の値が優先)
 * @param {Object|null} [record]
 */
function fieldValues(record = null, opts = {}) {
  return buildFieldValues(state.variables, record, opts);
}

/**
 * 変数と表の1行を入れた要素(どちらも無ければ state.elements をそのまま返す)
 * @param {Object|null} [record]
 */
function elementsWithValues(record = null, opts = {}) {
  if (!record && state.variables.length === 0) return state.elements;
  return substituteFields(state.elements, fieldValues(record, opts));
}

/**
 * Render the canvas
 */
function render() {
  // In print preview mode, evaluate expressions so users see actual values
  let elementsToRender = state.elements;
  const mergeRecord = mergePreviewRecord();
  if (mergeRecord) {
    // 表の行を差し込んで表示(行を選んでプレビュー)
    elementsToRender = evaluateExpressions(elementsWithValues(mergeRecord), {
      counterIndex: counterIndexForLabel(batchPositionOf(state.mergePreview.row)),
    });
  } else if (state.ditherPreview) {
    elementsToRender = evaluateExpressions(elementsWithValues(), { counterIndex: counterIndexForLabel(0) });
  } else if (state.variables.length) {
    // 変数はキャンバスでも値を入れて見せる(連番の変数は次に印刷する番号)
    elementsToRender = elementsWithValues(null, { counterIndex: counterIndexForLabel(0) });
  }
  state.renderer.renderAll(elementsToRender, state.selectedIds, state.alignmentGuides);
}

// =============================================================================
// COUNTER ([[counter]]) - #31
// =============================================================================

/** 番号を振り始める位置(「前回の続きから」が OFF なら常に 0) */
function counterBase() {
  return state.counter.resume ? Math.max(0, parseInt(state.counter.next, 10) || 0) : 0;
}

/** 印刷する n 枚目(0 始まり)の連番の位置 */
function counterIndexForLabel(position) {
  return counterBase() + position;
}

/** バッチ印刷で、そのレコードが何枚目に印刷されるか(0 始まり) */
function batchPositionOf(recordIndex) {
  const pos = state.selectedRecords.indexOf(recordIndex);
  return pos >= 0 ? pos : recordIndex;
}

/** 印刷した枚数だけ番号を進める(「前回の続きから」が ON のときだけ) */
function advanceCounter(count) {
  if (!state.counter.resume || !(count > 0) || !hasCounter(elementsWithValues())) return;
  state.counter.next = counterBase() + count;
  persistCounter();
  updateCounterUI();
  render(); // キャンバスの連番も次に印刷する番号に
}

/** 保存済みのデザインなら、連番の状態をデザインに書き込む */
function persistCounter() {
  if (!state.currentDesignName) return;
  try {
    updateDesignCounter(state.currentDesignName, { ...state.counter });
  } catch (e) {
    logError(e, 'persistCounter');
  }
}

/** 印刷設定ダイアログの「連番」欄を最新にする */
function updateCounterUI() {
  const resume = $('#counter-resume');
  const next = $('#counter-next');
  const preview = $('#counter-preview');
  if (!resume || !next || !preview) return;

  resume.checked = !!state.counter.resume;
  // 次に印刷する番号(最初の連番の開始・増分で数える)。いつでも書き換えられる
  const opts = findCounterOptions(elementsWithValues()) || COUNTER_DEFAULTS;
  if (document.activeElement !== next) next.value = opts.start + counterBase() * opts.step;
  next.disabled = false;
  $('#counter-reset').disabled = counterBase() === 0;

  const value = previewCounter(elementsWithValues(), counterBase());
  // 変数欄の連番の見本も、続きの番号に合わせる
  $$('#variables-list .variable-row').forEach(row => {
    const v = state.variables[parseInt(row.dataset.index, 10)];
    const el = row.querySelector('.variable-counter-preview');
    if (v && el) el.textContent = variablePreviewText(v);
  });
  // 連番を使っているデザインだけ「連番の続き」欄を出す
  $('#counter-settings')?.classList.toggle('hidden', value === null);
  if (value === null) {
    preview.textContent = t('counter_none_in_design');
    preview.dataset.hasCounter = 'false';
  } else {
    preview.textContent = t('counter_next_number', { value });
    preview.dataset.hasCounter = 'true';
  }
  const note = $('#counter-unsaved-note');
  if (note) note.classList.toggle('hidden', !state.counter.resume || !!state.currentDesignName);
}

/** 印刷設定ダイアログの「印刷の向き」欄を state から作り直す */
function loadPrintRotationUI() {
  const designSelect = $('#print-rotation-design');
  const deviceSelect = $('#print-rotation-device');
  if (!designSelect || !deviceSelect) return;
  const deviceName = state.transport?.isConnected?.() ? (state.transport.getDeviceName?.() || '') : '';
  designSelect.value = String(state.printRotation);
  deviceSelect.value = String(getDeviceRotation(deviceName));
  deviceSelect.disabled = !deviceName;
  updatePrintRotationTexts();
}

/** 「印刷の向き」欄の、選んでいる値から決まる文言を書き直す */
function updatePrintRotationTexts() {
  const designSelect = $('#print-rotation-design');
  const deviceSelect = $('#print-rotation-device');
  const result = $('#print-rotation-result');
  if (!designSelect || !deviceSelect || !result) return;
  const deviceName = state.transport?.isConnected?.() ? (state.transport.getDeviceName?.() || '') : '';
  const label = $('#print-rotation-device-label');
  if (label) label.textContent = deviceName ? t('print_rotation_device_named', { name: deviceName }) : t('print_rotation_device');
  $('#print-rotation-device-note')?.classList.toggle('hidden', !!deviceName);

  const design = normalizeDesignRotation(designSelect.value);
  const rotation = design === ROTATION_FOLLOW_DEVICE ? (Number(deviceSelect.value) || 0) : design;
  // 多面ラベルのときは並べた全体の大きさ
  const size = state.renderer?.getDimensions?.();
  const mm = (px) => Math.round((px / 8) * 10) / 10;
  const paper = size?.width
    ? rotatedSize(mm(size.width), mm(size.height), rotation)
    : rotatedSize(state.labelSize.width, state.labelSize.height, rotation);
  result.textContent = t('print_rotation_result', { width: paper.width, height: paper.height, rotation });
  result.dataset.rotation = String(rotation);
}

/** 「印刷の向き」欄で選んだ値を保存する(印刷設定の「保存」で呼ぶ) */
function savePrintRotationUI() {
  const designSelect = $('#print-rotation-design');
  const deviceSelect = $('#print-rotation-device');
  if (!designSelect || !deviceSelect) return;
  state.printRotation = normalizeDesignRotation(designSelect.value);
  const deviceName = state.transport?.isConnected?.() ? (state.transport.getDeviceName?.() || '') : '';
  if (deviceName) setDeviceRotation(deviceName, Number(deviceSelect.value));
  // 保存済みのデザインを開いているなら、デザインにも書き込む
  if (state.currentDesignName) {
    try {
      updateDesignPrintRotation(state.currentDesignName, state.printRotation);
    } catch (e) {
      logError(e, 'savePrintRotationUI');
    }
  }
}

function initCounterSettings() {
  $('#counter-resume')?.addEventListener('change', (e) => {
    state.counter.resume = e.target.checked;
    persistCounter();
    updateCounterUI();
    render(); // キャンバスの連番も次に印刷する番号に
  });
  $('#counter-next')?.addEventListener('change', (e) => {
    // 入れた番号から何枚目かを求める。番号を決めたら、続きから振るようにする
    const opts = findCounterOptions(elementsWithValues()) || COUNTER_DEFAULTS;
    const value = parseInt(e.target.value, 10);
    const index = Number.isFinite(value) && opts.step ? Math.round((value - opts.start) / opts.step) : 0;
    state.counter.next = Math.max(0, index);
    state.counter.resume = true;
    e.target.blur();
    persistCounter();
    updateCounterUI();
    render(); // キャンバスの連番も次に印刷する番号に
  });
  $('#counter-reset')?.addEventListener('click', () => {
    state.counter.next = 0;
    persistCounter();
    updateCounterUI();
    render(); // キャンバスの連番も次に印刷する番号に
  });
}

// =============================================================================
// JAPANESE FONTS - #23
// =============================================================================

function initJapaneseFonts() {
  injectJapaneseFontStylesheet();
  addJapaneseFontsToSelect($('#prop-font-family'));
  // Webフォントが届いたら描画し直す(届く前は代替フォントで表示されるため)
  if (document.fonts?.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => render());
  }
}

/**
 * Detect template fields from current elements
 */
function detectTemplateFields() {
  const previousFields = [...state.templateFields];
  // 変数として値が決まっている名前は、表の列として探さない
  state.templateFields = fieldsWithoutVariables(extractFields(state.elements), state.variables);

  // If fields changed significantly, clear template data
  const fieldsChanged = previousFields.length !== state.templateFields.length ||
    !previousFields.every(f => state.templateFields.includes(f));

  if (fieldsChanged && state.templateData.length > 0) {
    // Fields changed - keep data but user may need to re-map
    console.log('Template fields changed:', state.templateFields);
  }

  updateTemplateIndicator();
  updateCounterUI();
}

/**
 * Update template mode indicator in UI
 */
function updateTemplateIndicator() {
  updateGsheetUI();
  const fieldCount = $('#template-field-count');
  const fieldTags = $('#template-field-tags');
  const dataCount = $('#template-data-count');
  const printCount = $('#template-print-count');
  const toolbarBtn = $('#template-toolbar-btn');
  const toolbarDivider = $('#template-toolbar-divider');
  const toolbarLabel = $('#template-toolbar-label');

  // デザインで使っている変数・連番も、差し込み項目として並べる(種類の印つき)
  const usedVariables = variablesUsedInDesign();
  const hasFields = state.templateFields.length + usedVariables.length > 0;
  fieldCount.textContent = state.templateFields.length + usedVariables.length;

  if (hasFields) {
    fieldTags.innerHTML = usedVariables.map(variableFieldTag).join('') + state.templateFields.map(f =>
      `<span class="merge-field-tag px-2 py-1 bg-purple-100 text-purple-700 rounded-full font-medium">{{${escapeHtml(f)}}}</span>`
    ).join('');
  } else {
    fieldTags.innerHTML = `<span class="text-purple-400 italic">${t('none')}</span>`;
  }
  $('#template-fields-hint')?.classList.toggle('hidden', hasFields);

  // ツールバーのボタンは常に出す(先に表を読み込んでから {{列名}} を足せるように)
  toolbarBtn.classList.remove('hidden');
  toolbarDivider.classList.remove('hidden');
  toolbarLabel.textContent = state.templateData.length > 0
    ? t('template_with_count', { n: state.templateData.length })
    : t('template');

  // 表の列(押すと {{列名}} を入れる)
  const columnsSection = $('#template-columns-section');
  const columnChips = $('#template-column-chips');
  if (columnsSection && columnChips) {
    columnsSection.classList.toggle('hidden', state.templateColumns.length === 0);
    const used = state.templateFields.map(f => f.trim().toLowerCase());
    columnChips.innerHTML = state.templateColumns.map(c => {
      const isUsed = used.includes(c.trim().toLowerCase());
      return `<button class="merge-column-chip px-2 py-1 rounded-full font-medium border ${isUsed
        ? 'bg-purple-100 text-purple-700 border-purple-200'
        : 'bg-white text-purple-700 border-purple-300 hover:bg-purple-100'}" data-column="${escapeHtml(c)}">${escapeHtml(c)}</button>`;
    }).join('');
  }

  // Update data count
  dataCount.textContent = state.templateData.length;
  const selectedCount = state.selectedRecords.length;
  const allSelected = selectedCount === state.templateData.length;
  // 表を読み込んでいないときは、ふつうの印刷(部数ぶん)のボタンにする
  const hasData = state.templateData.length > 0;
  const copies = state.printSettings?.copies || 1;
  printCount.textContent = hasData ? selectedCount : t('n_copies_short', { n: copies });
  const printLabel = $('#template-print-label');
  if (printLabel) printLabel.textContent = !hasData ? t('print_plain_open') : t(allSelected ? 'print_all' : 'print_selected_rows');
  $('#template-quick-preview')?.classList.toggle('hidden', !hasData);
  $('#mobile-template-preview')?.classList.toggle('hidden', !hasData);
  const dialogPrintLabel = $('#template-print-btn-label');
  if (dialogPrintLabel) {
    dialogPrintLabel.textContent = allSelected
      ? t('print_all_2')
      : `${t('print_selected_rows_2')} (${selectedCount})`;
  }

  // Update mobile template UI
  const mobileStatus = $('#mobile-template-status');
  const mobileFields = $('#mobile-template-fields');
  const mobileFieldTags = $('#mobile-template-field-tags');
  const mobileDataCount = $('#mobile-template-data-count');
  const mobilePrintCount = $('#mobile-template-print-count');

  if (mobileStatus) {
    if (hasFields) {
      mobileStatus.textContent = t('n_fields', { n: state.templateFields.length + usedVariables.length });
      mobileStatus.classList.remove('hidden');
      mobileFields?.classList.remove('hidden');
      if (mobileFieldTags) {
        mobileFieldTags.innerHTML = usedVariables.map(variableFieldTag).join('') + state.templateFields.map(f =>
          `<span class="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">{{${escapeHtml(f)}}}</span>`
        ).join('');
      }
    } else {
      mobileStatus.classList.add('hidden');
      mobileFields?.classList.add('hidden');
    }
  }
  if (mobileDataCount) mobileDataCount.textContent = state.templateData.length;
  if (mobilePrintCount) mobilePrintCount.textContent = hasData ? state.selectedRecords.length : t('n_copies_short', { n: copies });

  // Update field dropdowns for insert field buttons
  updateFieldDropdowns();
  updateMergeControls();
}

/**
 * Toggle template panel visibility
 */
function toggleTemplatePanel() {
  const templatePanel = $('#template-panel');
  templatePanel.classList.toggle('hidden');
}

/**
 * Escape HTML for safe insertion
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Update field dropdowns for insert field buttons
 */
function updateFieldDropdowns() {
  const types = ['text', 'barcode', 'qr'];

  for (const type of types) {
    const fieldList = $(`#field-list-${type}`);
    if (!fieldList) continue;

    // デザインの変数 + デザインの項目 + 読み込んだ表の列(まだ使っていないもの)
    const variables = definedVariables();
    const lowerFields = [...variables.map(v => v.name), ...state.templateFields].map(f => f.toLowerCase());
    const choices = [
      ...state.templateFields,
      ...state.templateColumns.filter(c => !lowerFields.includes(c.toLowerCase())),
    ];
    if (choices.length > 0 || variables.length > 0) {
      const sectionLabel = (key) => `<div class="px-3 pt-1.5 pb-0.5 text-[10px] text-gray-400">${t(key)}</div>`;
      const variableHtml = variables.map(v =>
        `<button class="field-option variable-option w-full text-left px-3 py-1.5 text-sm hover:bg-purple-50 text-gray-700 flex items-baseline gap-2" data-field="${escapeAttr(v.name)}" data-type="${type}"><span>{{${escapeHtml(v.name)}}}</span><span class="text-[10px] text-gray-400 truncate">${escapeHtml(variablePreviewText(v))}</span></button>`
      ).join('');
      const fieldHtml = choices.map(f =>
        `<button class="field-option w-full text-left px-3 py-1.5 text-sm hover:bg-purple-50 text-gray-700" data-field="${escapeAttr(f)}" data-type="${type}">{{${escapeHtml(f)}}}</button>`
      ).join('');
      fieldList.innerHTML = variables.length
        ? sectionLabel('variables_title') + variableHtml + (choices.length ? sectionLabel('field_section_merge') + fieldHtml : '')
        : fieldHtml;
    } else {
      fieldList.innerHTML = `<div class="px-3 py-2 text-xs text-gray-400 italic">${t('no_fields_yet')}</div>`;
    }
  }
}

/**
 * Insert a field placeholder into an input
 */
function insertFieldIntoInput(type, fieldName) {
  let inputEl;
  let propKey;

  switch (type) {
    case 'text':
      inputEl = $('#prop-text-content');
      propKey = 'text';
      break;
    case 'barcode':
      inputEl = $('#prop-barcode-data');
      propKey = 'barcodeData';
      break;
    case 'qr':
      inputEl = $('#prop-qr-data');
      propKey = 'qrData';
      break;
  }

  if (!inputEl) return;

  const fieldPlaceholder = `{{${fieldName}}}`;
  const start = inputEl.selectionStart || 0;
  const end = inputEl.selectionEnd || 0;
  const value = inputEl.value;

  // Insert at cursor position
  const newValue = value.substring(0, start) + fieldPlaceholder + value.substring(end);
  inputEl.value = newValue;

  // Update the element
  const element = getSelected();
  if (element) {
    modifyElement(element.id, { [propKey]: newValue });
  }

  // Move cursor after inserted field
  const newCursorPos = start + fieldPlaceholder.length;
  inputEl.setSelectionRange(newCursorPos, newCursorPos);
  inputEl.focus();

  // Close dropdown
  $(`#field-dropdown-${type}`).classList.add('hidden');
}

/**
 * Create a new field and insert it
 */
function createAndInsertField(type, fieldName) {
  if (!fieldName.trim()) return;

  // Clean field name (remove invalid characters)
  const cleanName = fieldName.trim().replace(/[{}]/g, '');
  if (!cleanName) return;

  insertFieldIntoInput(type, cleanName);
}

/**
 * Toggle field dropdown visibility
 */
function toggleFieldDropdown(type) {
  const dropdown = $(`#field-dropdown-${type}`);
  const isHidden = dropdown.classList.contains('hidden');

  // Close all dropdowns first
  $$('[id^="field-dropdown-"]').forEach(d => d.classList.add('hidden'));

  if (isHidden) {
    dropdown.classList.remove('hidden');
    // Focus the new field input
    $(`#new-field-${type}`).value = '';
    $(`#new-field-${type}`).focus();
  }
}

/**
 * Add a template data record
 */
function addTemplateRecord(record = null) {
  if (!record) {
    record = createEmptyRecord(state.templateFields);
  }
  state.templateData.push(record);
  state.selectedRecords.push(state.templateData.length - 1);
  updateTemplateDataTable();
}

/**
 * Update a template data record
 */
function updateTemplateRecord(index, field, value) {
  if (index >= 0 && index < state.templateData.length) {
    state.templateData[index][field] = value;
    if (state.mergePreview.enabled && state.mergePreview.row === index) {
      render();
      updateMergeControls();
    }
  }
}

/**
 * Delete a template data record
 */
function deleteTemplateRecord(index) {
  if (index >= 0 && index < state.templateData.length) {
    state.templateData.splice(index, 1);
    // Update selected records indices
    state.selectedRecords = state.selectedRecords
      .filter(i => i !== index)
      .map(i => i > index ? i - 1 : i);
    clampMergePreviewRow();
    updateTemplateDataTable();
  }
}

/**
 * Clear all template data
 */
function clearTemplateData() {
  state.templateData = [];
  state.selectedRecords = [];
  state.templateColumns = [];
  state.templateSheets = null;
  setTemplateSource(null);
  clampMergePreviewRow();
  updateTemplateDataTable();
}

/**
 * Toggle record selection for printing
 */
function toggleRecordSelection(index) {
  const idx = state.selectedRecords.indexOf(index);
  if (idx >= 0) {
    state.selectedRecords.splice(idx, 1);
  } else {
    state.selectedRecords.push(index);
    state.selectedRecords.sort((a, b) => a - b);
  }
  updateTemplateDataTable();
}

/**
 * Select all records for printing
 */
function selectAllRecords() {
  state.selectedRecords = state.templateData.map((_, i) => i);
  updateTemplateDataTable();
}

/**
 * Deselect all records
 */
function deselectAllRecords() {
  state.selectedRecords = [];
  updateTemplateDataTable();
}

/**
 * Update the template data table in the dialog
 */
function updateTemplateDataTable() {
  const tableBody = $('#template-data-body');
  const emptyState = $('#template-data-empty');
  const tableHeader = $('#template-data-header');
  const recordCount = $('#template-record-count');

  if (state.templateData.length === 0) {
    emptyState.classList.remove('hidden');
    tableHeader.classList.add('hidden');
    tableBody.innerHTML = '';
    recordCount.textContent = t('n_records', { n: 0 });
    updateTemplateIndicator();
    return;
  }

  emptyState.classList.add('hidden');
  tableHeader.classList.remove('hidden');

  // デザインの項目を先に、ほかの表の列はあとに(薄く)出す
  const lowerFields = state.templateFields.map(f => f.toLowerCase());
  const extraColumns = state.templateColumns.filter(c => !lowerFields.includes(c.toLowerCase()));
  const columns = [...state.templateFields, ...extraColumns];
  const cellValue = (record, f) => {
    if (Object.prototype.hasOwnProperty.call(record, f)) return record[f];
    const key = Object.keys(record).find(k => k.trim().toLowerCase() === f.trim().toLowerCase());
    return key !== undefined ? record[key] : '';
  };
  const previewRow = state.mergePreview.enabled ? state.mergePreview.row : -1;

  // Build header
  tableHeader.innerHTML = `
    <th class="px-2 py-1 text-left text-xs font-medium text-gray-500 w-8">
      <input type="checkbox" id="template-select-all" class="rounded"
        ${state.selectedRecords.length === state.templateData.length ? 'checked' : ''}>
    </th>
    <th class="px-2 py-1 text-left text-xs font-medium text-gray-500 w-8">#</th>
    ${columns.map(f => `
      <th class="px-2 py-1 text-left text-xs font-medium ${extraColumns.includes(f) ? 'text-gray-400' : 'text-gray-500'}">${escapeHtml(f)}</th>
    `).join('')}
    <th class="px-2 py-1 text-right text-xs font-medium text-gray-500 w-16">${t('actions')}</th>
  `;

  // Build rows
  tableBody.innerHTML = state.templateData.map((record, idx) => `
    <tr class="border-t border-gray-100 hover:bg-gray-50 ${idx === previewRow ? 'bg-purple-50' : ''}" data-index="${idx}">
      <td class="px-2 py-1">
        <input type="checkbox" class="template-row-select rounded"
          data-index="${idx}" ${state.selectedRecords.includes(idx) ? 'checked' : ''}>
      </td>
      <td class="px-2 py-1 text-xs">
        <button class="template-preview-row px-1 rounded ${idx === previewRow ? 'bg-purple-600 text-white' : 'text-gray-400 hover:bg-purple-100 hover:text-purple-700'}"
          data-index="${idx}" title="${escapeHtml(t('merge_preview_this_row'))}">${idx + 1}</button>
      </td>
      ${columns.map(f => `
        <td class="px-2 py-1">
          <input type="text" class="template-field-input w-full text-base border-0 bg-transparent p-0 focus:ring-1 focus:ring-blue-500 rounded ${extraColumns.includes(f) ? 'text-gray-400' : ''}"
            data-index="${idx}" data-field="${escapeHtml(f)}" value="${escapeHtml(cellValue(record, f) || '')}">
        </td>
      `).join('')}
      <td class="px-2 py-1 text-right">
        <button class="template-delete-row text-red-500 hover:text-red-700 text-xs" data-index="${idx}">${t('delete')}</button>
      </td>
    </tr>
  `).join('');

  recordCount.textContent = t('n_records', { n: state.templateData.length });

  // Bind event handlers
  bindTemplateTableEvents();

  // Update properties panel indicator
  updateTemplateIndicator();
}

/**
 * Bind event handlers for template data table
 */
function bindTemplateTableEvents() {
  // Select all checkbox
  const selectAll = $('#template-select-all');
  if (selectAll) {
    selectAll.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectAllRecords();
      } else {
        deselectAllRecords();
      }
    });
  }

  // Row checkboxes
  $$('.template-row-select').forEach(cb => {
    cb.addEventListener('change', (e) => {
      toggleRecordSelection(parseInt(e.target.dataset.index));
    });
  });

  // Field inputs
  $$('.template-field-input').forEach(input => {
    input.addEventListener('change', (e) => {
      updateTemplateRecord(
        parseInt(e.target.dataset.index),
        e.target.dataset.field,
        e.target.value
      );
    });
  });

  // Row number: show the row on the canvas
  $$('.template-preview-row').forEach(btn => {
    btn.addEventListener('click', (e) => {
      setMergePreviewRow(parseInt(e.currentTarget.dataset.index, 10), true);
    });
  });

  // Delete buttons
  $$('.template-delete-row').forEach(btn => {
    btn.addEventListener('click', (e) => {
      deleteTemplateRecord(parseInt(e.target.dataset.index));
    });
  });
}

/**
 * Import a table file (CSV / TSV / Excel .xlsx)
 * @param {File} file
 */
async function handleCSVFileImport(file) {
  try {
    const { sheets } = await readSpreadsheetFile(file);
    setTemplateSource(null);
    if (sheets.length > 1) {
      state.templateSheets = sheets;
      // 差し込み項目と合う列がいちばん多いシートを選ぶ
      let best = 0, bestScore = -1;
      sheets.forEach((sh, i) => {
        const score = sh.records.length > 0
          ? state.templateFields.length - findMissingFields(state.templateFields, sh.headers).length
          : -1;
        if (score > bestScore) { best = i; bestScore = score; }
      });
      applyImportedTable(sheets[best], best);
    } else {
      state.templateSheets = null;
      applyImportedTable(sheets[0], 0);
    }
  } catch (e) {
    const key = e?.code ? `err_table_${e.code}` : null;
    if (e?.code === 'too_large') setStatus(t('val_file_too_large', e.params));
    else if (e?.code === 'no_file') setStatus(t('val_no_file'));
    else if (key && t(key) !== key) setStatus(t(key));
    else {
      logError(e, 'handleCSVFileImport');
      setStatus(t('status_csv_read_failed'));
    }
    showToast($('#status-message')?.textContent || t('status_csv_read_failed'), 'error');
  }
}

/**
 * Import CSV/TSV text (also used by paste)
 */
function importCSVData(csvString, sheetName = '') {
  state.templateSheets = null;
  setTemplateSource(null);
  applyImportedTable({ name: sheetName, ...parseDelimitedTable(csvString) }, 0);
}

/**
 * Replace the template data with an imported table
 * 表の列はすべて残す(あとから {{列名}} を足しても差し込める)
 * @param {{name: string, headers: string[], records: Object[], truncated: boolean}} table
 */
function applyImportedTable(table, sheetIndex = 0) {
  if (!table || table.records.length === 0) {
    setStatus(t('status_csv_no_data'));
    return false;
  }
  state.templateSheetIndex = sheetIndex;
  state.templateColumns = [...table.headers];
  state.templateData = table.records.map(r => ({ ...r }));
  state.selectedRecords = state.templateData.map((_, i) => i);
  state.mergePreview.row = 0;
  updateTemplateDataTable();
  updateImportInfo();
  render();
  const msg = table.truncated
    ? t('status_table_truncated', { n: table.records.length })
    : (state.templateSheets
      ? t('status_sheet_imported', { sheet: table.name, n: table.records.length })
      : t('status_imported_records', { n: table.records.length }));
  setStatus(msg);
  if (table.truncated) showToast(msg, 'warning');
  return true;
}

/** 読み込んだ表の情報(シート・列・見つからない項目)を出す */
function updateImportInfo() {
  const info = $('#template-import-info');
  updateGsheetUI();
  if (!info) return;
  const hasTable = state.templateColumns.length > 0 && state.templateData.length > 0;
  info.classList.toggle('hidden', !hasTable);
  if (!hasTable) return;

  const sheetRow = $('#template-sheet-row');
  const sheetSelect = $('#template-sheet-select');
  if (state.templateSheets && state.templateSheets.length > 1) {
    sheetRow.classList.remove('hidden');
    sheetSelect.innerHTML = state.templateSheets.map((sh, i) =>
      `<option value="${i}">${escapeHtml(sh.name)} (${sh.records.length})</option>`
    ).join('');
    sheetSelect.value = String(state.templateSheetIndex);
  } else {
    sheetRow.classList.add('hidden');
  }

  $('#template-columns-list').textContent = state.templateColumns.join(', ');
  const missing = findMissingFields(state.templateFields, state.templateColumns);
  const missingEl = $('#template-missing-fields');
  missingEl.classList.toggle('hidden', missing.length === 0);
  missingEl.textContent = missing.length
    ? t('merge_missing_fields', { fields: missing.map(f => `{{${f}}}`).join(' ') })
    : '';
}

// =============================================================================
// GOOGLE SHEETS - 連携したスプレッドシートから読み込む(デザインごとに保存)
// =============================================================================

function setTemplateSource(src) {
  state.templateSource = src;
  if (!src) state.templateSourceStatus = { loading: false, loadedAt: 0 };
  updateGsheetUI();
}

/** 保存されていた mergeSource を戻し、読めるなら最新を読み込む */
function restoreTemplateSource(raw) {
  const src = normalizeSource(raw);
  state.templateSource = src;
  state.templateSourceStatus = { loading: false, loadedAt: 0 };
  if (src?.rowRange && state.templateData.length > 0) {
    const { indices, error } = parseRowRange(src.rowRange, state.templateData.length);
    if (!error) state.selectedRecords = indices;
  }
  updateGsheetUI();
  // 許可済みなら(ポップアップ無しで読めるなら)そのまま最新にする
  if (src && isSheetsAvailable() && canReadSilently()) {
    reloadGsheet({ interactive: false });
  }
}

/** 保存する mergeSource(印刷する行の指定も一緒に) */
function currentMergeSourceForSave() {
  const src = state.templateSource;
  if (!src) return null;
  const out = { ...src };
  delete out.rowRange;
  const n = state.templateData.length;
  if (n > 0 && state.selectedRecords.length !== n) {
    out.rowRange = formatRowRange(state.selectedRecords, n);
  }
  return out;
}

/**
 * 読み込んだスプレッドシートを差し込みデータにする
 * @param {{spreadsheetId: string, name: string}} file
 * @param {{title: string, sheets: Array}} book
 * @param {object|null} saved - 前の連携(シートと印刷する行を引き継ぐ)
 */
function applyGsheetBook(file, book, saved = null) {
  const sheets = book.sheets;
  const name = book.title || file.name || '';
  let index = findSheetIndex(sheets, saved);
  let missingSheet = '';
  if (index < 0) {
    if (saved && (saved.sheetName || saved.sheetId != null)) missingSheet = saved.sheetName || String(saved.sheetId);
    // 差し込み項目と合う列がいちばん多いシート
    let bestScore = -1;
    index = 0;
    sheets.forEach((sh, i) => {
      const score = sh.records.length > 0
        ? state.templateFields.length - findMissingFields(state.templateFields, sh.headers).length
        : -1;
      if (score > bestScore) { index = i; bestScore = score; }
    });
  }
  const sheet = sheets[index];
  state.templateSheets = sheets.length > 1 ? sheets : null;
  const prevRow = state.mergePreview.row;
  const prevPreview = state.mergePreview.enabled;
  if (!applyImportedTable(sheet, index)) {
    // 行が無いシートでも連携は残す(あとで行を足してから読み直せる)
    state.templateSource = { ...makeSource({ spreadsheetId: file.spreadsheetId, name }, sheet) };
    state.templateSourceStatus = { loading: false, loadedAt: Date.now() };
    updateGsheetUI();
    return false;
  }
  const src = makeSource({ spreadsheetId: file.spreadsheetId, name }, sheet);
  // 印刷する行の指定を引き継ぐ(同じシートを読み直したときだけ)
  if (saved?.rowRange && missingSheet === '' && saved.spreadsheetId === file.spreadsheetId) {
    const { indices, error } = parseRowRange(saved.rowRange, state.templateData.length);
    if (!error) {
      state.selectedRecords = indices;
      src.rowRange = saved.rowRange;
    }
  }
  if (saved && saved.spreadsheetId === file.spreadsheetId && missingSheet === '') {
    state.mergePreview.row = prevRow;
    state.mergePreview.enabled = prevPreview;
    clampMergePreviewRow();
  }
  state.templateSource = src;
  state.templateSourceStatus = { loading: false, loadedAt: Date.now() };
  updateTemplateDataTable();
  updateImportInfo();
  render();
  const msg = missingSheet
    ? t('status_gsheet_sheet_missing', { sheet: missingSheet, used: sheet.name })
    : t('status_gsheet_imported', { name: name || t('gsheet_untitled'), sheet: sheet.name, n: sheet.records.length });
  setStatus(msg);
  if (missingSheet) showToast(msg, 'warning');
  return true;
}

function showGsheetError(e) {
  if (e?.name === 'AuthRequiredError') {
    showToast(e.message, 'error');
    setStatus(e.message);
    return;
  }
  const msg = e?.name === 'SheetsError' ? e.message : t('err_gsheet_failed', { message: e?.message || '' });
  if (e?.name !== 'SheetsError') logError(e, 'gsheet');
  showToast(msg, 'error');
  setStatus(msg);
}

/** Picker でスプレッドシートを選んで読み込む(クリックから呼ぶ) */
async function handleGsheetPick() {
  if (!isSheetsAvailable()) {
    showAccountDialog(t('gsheet_login_to_reload'));
    return;
  }
  let file;
  try {
    file = await pickSpreadsheet();
  } catch (e) {
    showGsheetError(e);
    return;
  }
  if (!file) return;
  state.templateSourceStatus = { loading: true, loadedAt: 0 };
  updateGsheetUI();
  setStatus(t('gsheet_loading'));
  try {
    const book = await readSpreadsheet(file.spreadsheetId);
    const same = state.templateSource?.spreadsheetId === file.spreadsheetId ? state.templateSource : null;
    applyGsheetBook(file, book, same);
  } catch (e) {
    state.templateSourceStatus = { loading: false, loadedAt: state.templateSourceStatus.loadedAt };
    updateGsheetUI();
    showGsheetError(e);
  }
}

/**
 * 連携中のスプレッドシートを読み直す
 * @param {{interactive: boolean}} opts - interactive: クリックから(許可のポップアップを出してよい)
 */
async function reloadGsheet({ interactive }) {
  const saved = state.templateSource;
  if (!saved || state.templateSourceStatus.loading) return;
  // 許可のポップアップはクリック直後に開く必要があるので、await の前に始める
  const scopeReady = interactive ? ensureSheetsScope() : Promise.resolve();
  state.templateSourceStatus = { loading: true, loadedAt: state.templateSourceStatus.loadedAt };
  updateGsheetUI();
  try {
    await scopeReady;
    const book = await readSpreadsheet(saved.spreadsheetId);
    // 読み込みのあいだに別の表に変えられていたら捨てる
    if (state.templateSource?.spreadsheetId !== saved.spreadsheetId) return;
    applyGsheetBook({ spreadsheetId: saved.spreadsheetId, name: saved.name }, book, state.templateSource);
  } catch (e) {
    if (state.templateSource?.spreadsheetId === saved.spreadsheetId) {
      state.templateSourceStatus = { loading: false, loadedAt: state.templateSourceStatus.loadedAt };
      updateGsheetUI();
    }
    if (interactive) showGsheetError(e);
    else console.warn('[gsheet] reload skipped:', e);
  }
}

/** スプレッドシートのボタンと「連携中」の表示を最新にする */
function updateGsheetUI() {
  const available = isSheetsAvailable();
  const src = state.templateSource;
  $('#template-panel-gsheet')?.classList.toggle('hidden', !available || !!src);
  $('#template-gsheet-btn')?.classList.toggle('hidden', !available);

  const box = $('#gsheet-link');
  if (box) {
    box.classList.toggle('hidden', !src);
    if (src) {
      const link = $('#gsheet-link-name');
      link.textContent = src.name || t('gsheet_untitled');
      link.href = spreadsheetUrl(src);
      link.title = src.name || '';
      $('#gsheet-link-sheet').textContent = src.sheetName ? t('gsheet_sheet_name', { sheet: src.sheetName }) : '';
      const st = state.templateSourceStatus;
      $('#gsheet-link-status').textContent = st.loading
        ? t('gsheet_loading')
        : st.loadedAt
          ? t('gsheet_loaded_at', { time: new Date(st.loadedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })
          : (available ? t('gsheet_showing_saved') : t('gsheet_login_to_reload'));
      const reload = $('#gsheet-reload');
      reload.disabled = st.loading;
      reload.classList.toggle('opacity-50', st.loading);
      $('#gsheet-repick').classList.toggle('hidden', !available);
    }
  }
  const info = $('#template-gsheet-info');
  if (info) {
    info.classList.toggle('hidden', !src);
    info.textContent = src ? t('gsheet_info', { name: src.name || t('gsheet_untitled') }) : '';
  }
}

// =============================================================================
// SPREADSHEET MERGE - 行を選んでプレビュー・行の範囲を指定して印刷
// =============================================================================

/** キャンバスに差し込んで表示する行(表示しないときは null) */
function mergePreviewRecord() {
  if (!state.mergePreview.enabled) return null;
  return state.templateData[state.mergePreview.row] || null;
}

function clampMergePreviewRow() {
  const max = state.templateData.length - 1;
  state.mergePreview.row = Math.max(0, Math.min(max, state.mergePreview.row));
  if (max < 0) state.mergePreview.enabled = false;
}

/**
 * Choose the row shown on the canvas
 * @param {number} index - 0 始まり
 * @param {boolean} [enable] - true ならキャンバスへの差し込み表示を ON にする
 */
function setMergePreviewRow(index, enable = false) {
  if (!state.templateData.length) return;
  const n = state.templateData.length;
  state.mergePreview.row = ((index % n) + n) % n;
  if (enable) state.mergePreview.enabled = true;
  render();
  updateMergeControls();
  if (!$('#template-data-dialog').classList.contains('hidden')) updateTemplateDataTable();
}

/** 印刷する行を選び直す(範囲の欄・チェックボックス・枚数をそろえる) */
function setRecordSelection(indices) {
  state.selectedRecords = [...new Set(indices)]
    .filter(i => i >= 0 && i < state.templateData.length)
    .sort((a, b) => a - b);
  if (!$('#template-data-dialog').classList.contains('hidden')) updateTemplateDataTable();
  else updateTemplateIndicator();
  if (state.mergePreview.enabled) render(); // 連番の位置が変わる
}

/** 範囲の欄に入力された文字で、印刷する行を選ぶ */
function applyRangeInput(inputEl, statusEl) {
  const { indices, error } = parseRowRange(inputEl.value, state.templateData.length);
  if (error) {
    statusEl.textContent = t('merge_range_invalid', { part: error });
    statusEl.classList.add('text-red-600');
    return;
  }
  statusEl.classList.remove('text-red-600');
  setRecordSelection(indices);
}

/** テンプレートパネルとデータ画面の「プレビューする行」「印刷する行」を最新にする */
function updateMergeControls() {
  const total = state.templateData.length;
  const controls = $('#merge-controls');
  if (controls) controls.classList.toggle('hidden', total === 0);
  clampMergePreviewRow();

  const rowInput = $('#merge-row-input');
  if (rowInput) {
    rowInput.max = String(Math.max(1, total));
    if (document.activeElement !== rowInput) rowInput.value = String(state.mergePreview.row + 1);
  }
  const totalEl = $('#merge-row-total');
  if (totalEl) totalEl.textContent = `/ ${total}`;
  const toggle = $('#merge-preview-toggle');
  if (toggle) toggle.checked = state.mergePreview.enabled;

  const summary = $('#merge-row-summary');
  if (summary) {
    const record = state.templateData[state.mergePreview.row];
    const fields = state.templateFields.length ? state.templateFields : state.templateColumns;
    summary.textContent = record
      ? fields.slice(0, 3).map(f => {
        const key = Object.keys(record).find(k => k.trim().toLowerCase() === f.trim().toLowerCase());
        return key !== undefined ? record[key] : '';
      }).filter(v => v !== '').join(' / ')
      : t('merge_no_data');
  }

  const rangeText = formatRowRange(state.selectedRecords, total);
  const status = t('merge_range_selected', { n: state.selectedRecords.length, total });
  for (const [inputId, statusId] of [['#merge-range-input', '#merge-range-status'], ['#template-range-input', '#template-range-status']]) {
    const input = $(inputId);
    const statusEl = $(statusId);
    if (input && document.activeElement !== input) input.value = total ? rangeText : '';
    if (statusEl && !(document.activeElement === input && statusEl.classList.contains('text-red-600'))) {
      statusEl.classList.remove('text-red-600');
      statusEl.textContent = total ? status : '';
    }
  }
}

/**
 * Put {{column}} into the design: into the selected text/barcode/QR, or as a new text
 */
function insertColumnIntoDesign(column, statusKey = 'status_column_inserted') {
  const placeholder = `{{${column}}}`;
  const el = getSelected();
  const key = el?.type === 'text' ? 'text'
    : el?.type === 'barcode' ? 'barcodeData'
      : el?.type === 'qr' ? 'qrData' : null;
  saveHistory();
  if (el && key) {
    const current = el[key] || '';
    const sep = current && !/\s$/.test(current) ? ' ' : '';
    modifyElement(el.id, { [key]: current + sep + placeholder });
  } else {
    const dims = state.renderer.getSingleLabelDimensions();
    const element = createTextElement(placeholder, {
      x: dims.width / 2 - 75,
      y: dims.height / 2 - 20,
      width: 150,
      height: 40,
      zone: state.activeZone,
    });
    state.elements.push(element);
    autoCloneIfEnabled();
    detectTemplateFields();
    selectElement(element.id);
  }
  // 表を読み込んでいれば、すぐ差し込んだ結果が見えるようにする
  if (state.templateData.length > 0 && !state.mergePreview.enabled) {
    state.mergePreview.enabled = true;
    render();
    updateMergeControls();
  }
  setStatus(t(statusKey, { field: column }));
}

// =============================================================================
// DESIGN VARIABLES - デザインごとの変数({{変数名}} で文字・バーコード・QRに入る)
// =============================================================================

/** 属性値に入れる文字のエスケープ */
function escapeAttr(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 変数の値の見本(連番なら次に印刷する番号から3つ) */
function variablePreviewText(v) {
  if (v.type !== 'counter') return v.value || t('variable_empty_value');
  const opts = normalizeCounterVariable(v);
  const base = counterBase();
  const nums = [0, 1, 2].map(i => formatCounter(base + i, opts));
  return t('variable_counter_preview', { values: nums.join(', ') });
}

/** デザインの中で {{名前}} として使っている変数 */
function variablesUsedInDesign() {
  const used = new Set(extractFields(state.elements).map(f => f.trim().toLowerCase()));
  return definedVariables().filter(v => used.has(v.name.toLowerCase()));
}

/** 差し込み項目の一覧に出す、変数・連番の札(値の見本を title に) */
function variableFieldTag(v) {
  const kind = t(v.type === 'counter' ? 'variable_type_counter' : 'variables_title');
  return `<span class="variable-field-tag px-2 py-1 bg-white text-purple-700 border border-purple-300 rounded-full font-medium" data-field="${escapeAttr(v.name)}" title="${escapeAttr(variablePreviewText(v))}">{{${escapeHtml(v.name)}}} <span class="text-[10px] text-purple-500">${escapeHtml(kind)}</span></span>`;
}

/** 使える変数(名前が空でない、重複を除いたもの) */
function definedVariables() {
  return normalizeVariables(state.variables);
}

/** 変数の欄を描き直す */
function renderVariablesPanel() {
  const list = $('#variables-list');
  if (list) {
    const input = 'min-w-0 px-1.5 py-1 text-xs border border-purple-200 rounded focus:outline-none focus:ring-1 focus:ring-purple-400 bg-white';
    list.innerHTML = state.variables.map((v, i) => {
      const isCounter = v.type === 'counter';
      const c = normalizeCounterVariable(v);
      const counterInput = (key, labelKey, min) => `
        <label class="flex items-center gap-0.5 text-[11px] text-purple-700">${t(labelKey)}
          <input type="number" class="variable-counter w-12 ${input}" data-key="${key}" value="${escapeAttr(v[key] ?? c[key])}"${min != null ? ` min="${min}"` : ''}>
        </label>`;
      const second = isCounter
        ? `<div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-0.5">
            ${counterInput('start', 'variable_counter_start')}
            ${counterInput('step', 'variable_counter_step')}
            ${counterInput('pad', 'variable_counter_pad', 0)}
            <span class="variable-counter-preview text-[11px] text-gray-500 truncate">${escapeHtml(variablePreviewText(v))}</span>
          </div>`
        : `<input type="text" class="variable-value w-full ${input}"
            value="${escapeAttr(v.value)}" placeholder="${escapeAttr(t('variable_value_placeholder'))}" aria-label="${escapeAttr(t('variable_value'))}">`;
      return `
      <div class="variable-row space-y-1 p-1.5 rounded-lg bg-white/60 border border-purple-100" data-index="${i}">
        <div class="flex items-center gap-1">
          <input type="text" class="variable-name flex-1 ${input}"
            value="${escapeAttr(v.name)}" placeholder="${escapeAttr(t('variable_name_placeholder'))}" aria-label="${escapeAttr(t('variable_name'))}">
          <select class="variable-type ${input}" aria-label="${escapeAttr(t('variable_type'))}">
            <option value="text"${isCounter ? '' : ' selected'}>${t('variable_type_text')}</option>
            <option value="counter"${isCounter ? ' selected' : ''}>${t('variable_type_counter')}</option>
          </select>
          <button class="variable-insert p-1 rounded text-purple-600 hover:bg-purple-100" title="${escapeAttr(t('variable_insert'))}" aria-label="${escapeAttr(t('variable_insert'))}">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          </button>
          <button class="variable-delete p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" title="${escapeAttr(t('variable_delete'))}" aria-label="${escapeAttr(t('variable_delete'))}">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        ${second}
      </div>
      <div class="variable-error hidden text-[11px] text-red-600 pl-1" data-index="${i}"></div>
    `;
    }).join('');
  }
  updateVariableRowStates();
}

/** 名前の重複などを行ごとに知らせ、件数を更新する */
function updateVariableRowStates() {
  const seen = new Set();
  state.variables.forEach((v, i) => {
    const name = cleanVariableName(v.name);
    const errorEl = $(`.variable-error[data-index="${i}"]`);
    const nameEl = $(`.variable-row[data-index="${i}"] .variable-name`);
    let error = '';
    if (name) {
      const key = name.toLowerCase();
      if (seen.has(key)) error = t('variable_duplicate', { name });
      else seen.add(key);
    } else if (v.value || v.type === 'counter') {
      error = t('variable_name_required');
    }
    if (errorEl) {
      errorEl.textContent = error;
      errorEl.classList.toggle('hidden', !error);
    }
    nameEl?.classList.toggle('border-red-400', !!error);
  });
  const n = definedVariables().length;
  if ($('#variables-count')) $('#variables-count').textContent = n;
  if ($('#mobile-variables-count')) $('#mobile-variables-count').textContent = n;
}

/** 変数が変わったら、差し込み項目の検出と表示をやり直す */
function onVariablesChanged() {
  updateVariableRowStates();
  detectTemplateFields();
  updateCounterUI();
  render();
}

function addVariable(type = 'text') {
  state.variables.push(type === 'counter'
    ? { name: '', value: '', type: 'counter', ...normalizeCounterVariable() }
    : { name: '', value: '' });
  renderVariablesPanel();
  const rows = $$('#variables-list .variable-name');
  rows[rows.length - 1]?.focus();
}

function initVariables() {
  renderVariablesPanel();
  $('#variables-add')?.addEventListener('click', () => addVariable());
  $('#variables-add-counter')?.addEventListener('click', () => addVariable('counter'));
  const list = $('#variables-list');
  list?.addEventListener('input', (e) => {
    const row = e.target.closest('.variable-row');
    if (!row) return;
    const v = state.variables[parseInt(row.dataset.index, 10)];
    if (!v) return;
    if (e.target.classList.contains('variable-name')) v.name = e.target.value;
    else if (e.target.classList.contains('variable-value')) v.value = e.target.value;
    else if (e.target.classList.contains('variable-counter')) {
      v[e.target.dataset.key] = e.target.value;
      const preview = row.querySelector('.variable-counter-preview');
      if (preview) preview.textContent = variablePreviewText(v);
    } else return;
    onVariablesChanged();
  });
  list?.addEventListener('change', (e) => {
    if (!e.target.classList.contains('variable-type')) return;
    const row = e.target.closest('.variable-row');
    const v = state.variables[parseInt(row?.dataset.index, 10)];
    if (!v) return;
    if (e.target.value === 'counter') Object.assign(v, { type: 'counter', ...normalizeCounterVariable(v) });
    else delete v.type;
    renderVariablesPanel();
    onVariablesChanged();
  });
  list?.addEventListener('keydown', (e) => {
    // 名前の欄で Enter → 値の欄へ。最後の行の値で Enter → 次の変数を足す
    if (e.key !== 'Enter' || e.isComposing) return;
    const row = e.target.closest('.variable-row');
    if (!row) return;
    e.preventDefault();
    if (e.target.classList.contains('variable-name')) {
      (row.querySelector('.variable-value') || row.querySelector('.variable-counter'))?.focus();
    } else if (parseInt(row.dataset.index, 10) === state.variables.length - 1) {
      addVariable();
    }
  });
  list?.addEventListener('click', (e) => {
    const row = e.target.closest('.variable-row');
    if (!row) return;
    const i = parseInt(row.dataset.index, 10);
    if (e.target.closest('.variable-delete')) {
      state.variables.splice(i, 1);
      renderVariablesPanel();
      onVariablesChanged();
    } else if (e.target.closest('.variable-insert')) {
      const name = cleanVariableName(state.variables[i]?.name);
      if (!name) {
        row.querySelector('.variable-name')?.focus();
        return;
      }
      insertColumnIntoDesign(name, 'status_variable_inserted');
    }
  });
  $('#mobile-variables-btn')?.addEventListener('click', () => {
    closeMobileMenu();
    $('#template-panel')?.classList.remove('hidden');
  });
}

function initSpreadsheetMerge() {
  const fileInput = $('#template-csv-input');
  if (fileInput) fileInput.accept = SPREADSHEET_ACCEPT;

  $('#template-panel-import')?.addEventListener('click', () => $('#template-csv-input').click());
  $('#template-column-chips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.merge-column-chip');
    if (chip) insertColumnIntoDesign(chip.dataset.column);
  });

  // 貼り付け(Google スプレッドシート / Excel のセルをコピー)
  $('#template-paste-btn')?.addEventListener('click', () => {
    const area = $('#template-paste-area');
    area.classList.toggle('hidden');
    if (!area.classList.contains('hidden')) $('#template-paste-text').focus();
  });
  $('#template-paste-cancel')?.addEventListener('click', () => {
    $('#template-paste-area').classList.add('hidden');
    $('#template-paste-text').value = '';
  });
  $('#template-paste-apply')?.addEventListener('click', () => {
    const text = $('#template-paste-text').value;
    const table = { name: '', ...parseDelimitedTable(text) };
    if (table.records.length > 0) {
      state.templateSheets = null;
      setTemplateSource(null);
    }
    if (applyImportedTable(table, 0)) {
      $('#template-paste-area').classList.add('hidden');
      $('#template-paste-text').value = '';
    }
  });

  // シートを選び直す
  $('#template-sheet-select')?.addEventListener('change', (e) => {
    const i = parseInt(e.target.value, 10);
    const sheet = state.templateSheets?.[i];
    if (sheet && applyImportedTable(sheet, i) && state.templateSource) {
      setTemplateSource({ ...state.templateSource, sheetId: sheet.sheetId ?? null, sheetName: sheet.name });
    }
  });

  // Googleスプレッドシート(ログイン中だけ)
  for (const id of ['#template-panel-gsheet', '#template-gsheet-btn', '#gsheet-repick']) {
    $(id)?.addEventListener('click', () => handleGsheetPick());
  }
  $('#gsheet-reload')?.addEventListener('click', () => {
    if (!isSheetsAvailable()) {
      showAccountDialog(t('gsheet_login_to_reload'));
      return;
    }
    reloadGsheet({ interactive: true });
  });
  $('#gsheet-unlink')?.addEventListener('click', () => {
    setTemplateSource(null);
    setStatus(t('status_gsheet_unlinked'));
  });
  onTokenChange(() => updateGsheetUI());
  // ログインした直後(トークンが来たあとでアカウントが決まる)にもボタンを出す
  onSyncStatus(() => updateGsheetUI());

  // プレビューする行
  $('#merge-row-prev')?.addEventListener('click', () => setMergePreviewRow(state.mergePreview.row - 1, true));
  $('#merge-row-next')?.addEventListener('click', () => setMergePreviewRow(state.mergePreview.row + 1, true));
  $('#merge-row-input')?.addEventListener('change', (e) => {
    const n = parseInt(e.target.value, 10);
    if (Number.isFinite(n)) setMergePreviewRow(Math.max(1, Math.min(state.templateData.length, n)) - 1, true);
    else updateMergeControls();
  });
  $('#merge-preview-toggle')?.addEventListener('change', (e) => {
    state.mergePreview.enabled = e.target.checked && state.templateData.length > 0;
    render();
    updateMergeControls();
    if (!$('#template-data-dialog').classList.contains('hidden')) updateTemplateDataTable();
  });

  // 印刷する行(範囲)
  for (const [inputId, statusId] of [['#merge-range-input', '#merge-range-status'], ['#template-range-input', '#template-range-status']]) {
    const input = $(inputId);
    if (!input) continue;
    input.addEventListener('change', () => applyRangeInput(input, $(statusId)));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyRangeInput(input, $(statusId));
        input.blur();
      }
    });
    input.addEventListener('blur', () => updateMergeControls());
  }
  $('#template-range-all')?.addEventListener('click', () => selectAllRecords());
}

/** 保存されていたデータから列の名前を取り出す(出てきた順) */
function columnsOfRecords(records) {
  const cols = [];
  for (const r of records || []) {
    for (const k of Object.keys(r || {})) if (!cols.includes(k)) cols.push(k);
  }
  return cols;
}

/**
 * Show template data dialog
 */
function showTemplateDataDialog() {
  $('#template-fields-list').textContent = state.templateFields.join(', ');
  updateTemplateDataTable();
  updateImportInfo();
  preloadPicker();
  $('#template-data-dialog').classList.remove('hidden');
}

/**
 * Hide template data dialog
 */
function hideTemplateDataDialog() {
  $('#template-data-dialog').classList.add('hidden');
}

/**
 * Show preview dialog with label thumbnails
 */
function showPreviewDialog() {
  if (state.templateData.length === 0) {
    setStatus(t('status_no_data_to_preview'));
    return;
  }

  const grid = $('#preview-grid');
  const recordsToPreview = state.selectedRecords.length > 0
    ? state.selectedRecords
    : state.templateData.map((_, i) => i);

  // Generate thumbnails
  grid.innerHTML = recordsToPreview.map(idx => {
    const record = state.templateData[idx];
    const firstField = state.templateFields[0];
    const label = record[firstField] || t('record_n', { n: idx + 1 });

    return `
      <div class="preview-thumbnail cursor-pointer hover:ring-2 hover:ring-blue-500 rounded-lg p-2 bg-gray-50"
           data-index="${idx}">
        <canvas class="preview-canvas bg-white shadow rounded w-full" data-index="${idx}"></canvas>
        <div class="text-xs text-gray-600 mt-1 truncate text-center">${escapeHtml(label)}</div>
        <div class="text-xs text-gray-400 text-center">#${idx + 1}</div>
      </div>
    `;
  }).join('');

  // Render previews
  requestAnimationFrame(() => {
    $$('.preview-canvas').forEach(canvas => {
      const idx = parseInt(canvas.dataset.index);
      renderPreviewThumbnail(canvas, idx);
    });
  });

  // Bind click handlers for full preview
  $$('.preview-thumbnail').forEach(thumb => {
    thumb.addEventListener('click', () => {
      showFullPreview(parseInt(thumb.dataset.index));
    });
  });

  $('#preview-count').textContent = t('n_labels', { n: recordsToPreview.length });
  $('#preview-dialog').classList.remove('hidden');
}

/**
 * Hide preview dialog
 */
function hidePreviewDialog() {
  $('#preview-dialog').classList.add('hidden');
}

/**
 * Render a preview thumbnail
 */
function renderPreviewThumbnail(canvas, recordIndex) {
  const record = state.templateData[recordIndex];
  if (!record) return;

  // Substitute fields and evaluate expressions
  const substitutedElements = elementsWithValues(record);
  const mergedElements = evaluateExpressions(substitutedElements, { counterIndex: counterIndexForLabel(batchPositionOf(recordIndex)) });

  // Create a temporary renderer at smaller scale
  const scale = 0.5;
  const dims = state.renderer.getDimensions();
  canvas.width = dims.width * scale;
  canvas.height = dims.height * scale;

  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, dims.width, dims.height);

  // Render elements (simplified - reuse main renderer logic)
  state.renderer.renderAllToContext(ctx, mergedElements, []);
}

/**
 * Show full-size preview of a single label
 */
function showFullPreview(recordIndex) {
  state.currentPreviewIndex = recordIndex;

  const record = state.templateData[recordIndex];
  const substitutedElements = elementsWithValues(record);
  const mergedElements = evaluateExpressions(substitutedElements, { counterIndex: counterIndexForLabel(batchPositionOf(recordIndex)) });

  // Render to full preview canvas
  const canvas = $('#full-preview-canvas');
  const dims = state.renderer.getDimensions();
  canvas.width = dims.width;
  canvas.height = dims.height;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, dims.width, dims.height);
  state.renderer.renderAllToContext(ctx, mergedElements, []);

  // Update label info
  const firstField = state.templateFields[0];
  const label = record[firstField] || t('record_n', { n: recordIndex + 1 });
  $('#full-preview-title').textContent = t('label_n_title', { n: recordIndex + 1, label });

  // Update include checkbox
  $('#full-preview-include').checked = state.selectedRecords.includes(recordIndex);

  $('#full-preview-dialog').classList.remove('hidden');
}

/**
 * Hide full preview dialog
 */
function hideFullPreview() {
  $('#full-preview-dialog').classList.add('hidden');
}

/**
 * Navigate to previous/next preview
 */
function navigatePreview(direction) {
  const indices = state.selectedRecords.length > 0
    ? state.selectedRecords
    : state.templateData.map((_, i) => i);

  const currentPos = indices.indexOf(state.currentPreviewIndex);
  let newPos = currentPos + direction;

  if (newPos < 0) newPos = indices.length - 1;
  if (newPos >= indices.length) newPos = 0;

  showFullPreview(indices[newPos]);
}

/**
 * Print batch of labels
 */
/** 差し込み印刷パネルの印刷ボタン: 表があれば連続印刷、無ければふつうの印刷(部数ぶん、連番は1枚ごとに進む) */
function printFromTemplatePanel() {
  return state.templateData.length > 0 ? handleBatchPrint() : handlePrint();
}

async function handleBatchPrint() {
  // 選んだ行(範囲)だけを印刷する。1行も選ばれていなければ印刷しない
  const recordsToPrint = [...state.selectedRecords];

  if (recordsToPrint.length === 0) {
    showToast(t('toast_no_records_selected'), 'warning');
    return;
  }

  const btn = $('#template-print-btn');
  const originalText = btn.textContent;
  const { density, feed, printerModel } = state.printSettings;

  // Calculate total prints based on multi-label mode
  const isMultiLabel = state.multiLabel.enabled;
  const cloneMode = state.multiLabel.cloneMode;
  const labelsAcross = state.multiLabel.labelsAcross;

  // In multi-label mode with clone mode OFF, records fill zones sequentially
  // So N records with M zones = ceil(N/M) rows to print
  const totalRecords = recordsToPrint.length;
  const totalRows = isMultiLabel && !cloneMode
    ? Math.ceil(totalRecords / labelsAcross)
    : totalRecords;

  try {
    btn.disabled = true;

    // Ensure connected
    if (!state.transport || !state.transport.isConnected()) {
      hideTemplateDataDialog();
      setStatus(t('connecting'));
      await handleConnect();

      if (!state.transport || !state.transport.isConnected()) {
        throw new Error(t('error_connect_first'));
      }
      showTemplateDataDialog();
    }

    // Show progress modal
    const labelText = isMultiLabel && !cloneMode
      ? t('progress_title_rows', { rows: totalRows, labels: totalRecords })
      : t('progress_title_labels', { n: totalRecords });
    showPrintProgress(labelText, totalRows);

    let labelsPrinted = 0;
    try {
    for (let rowIndex = 0; rowIndex < totalRows; rowIndex++) {
      // Check for cancellation
      if (isPrintCancelled()) {
        showToast(t('toast_print_cancelled_rows', { n: rowIndex }), 'warning');
        break;
      }

      let substitutedElements;
      let counterIndex;

      if (isMultiLabel && !cloneMode) {
        // Clone mode OFF: Different record per zone
        // Get records for this row (up to labelsAcross records)
        const startIdx = rowIndex * labelsAcross;
        const rowRecords = [];
        for (let z = 0; z < labelsAcross; z++) {
          const recordIdx = startIdx + z;
          if (recordIdx < recordsToPrint.length) {
            rowRecords[z] = state.templateData[recordsToPrint[recordIdx]];
          }
          // If no more records, zone will be empty (no substitution)
        }
        // 変数は表の値の後に入れる(同じ名前なら表の値が優先、データのないゾーンにも変数は入る)
        const zoneRecords = rowRecords.map(r => fieldValues(r));
        substitutedElements = applyVariables(substituteFieldsByZone(state.elements, zoneRecords, labelsAcross), state.variables);
        // 連番: ゾーンごとに1つずつ進める
        counterIndex = (el) => counterIndexForLabel(startIdx + (el.zone || 0));

        updatePrintProgress(rowIndex + 1, totalRows, t('progress_printing_row', { n: rowIndex + 1 }));
        btn.textContent = t('btn_printing_row', { n: rowIndex + 1, total: totalRows });
      } else {
        // Clone mode ON or single-label: Same data for all zones
        const recordIndex = recordsToPrint[rowIndex];
        const record = state.templateData[recordIndex];
        substitutedElements = elementsWithValues(record);
        // 連番: CSV の印刷順に番号を振る
        counterIndex = counterIndexForLabel(rowIndex);

        updatePrintProgress(rowIndex + 1, totalRows, t('progress_printing_label', { n: rowIndex + 1 }));
        btn.textContent = t('btn_printing_n_of', { n: rowIndex + 1, total: totalRows });
      }

      // Evaluate instant expressions (date/time, counter, etc.)
      const mergedElements = evaluateExpressions(substitutedElements, { counterIndex });
      await waitForElementFonts(mergedElements);

      // Render to raster (use raw format for rotated printers like D-series and P12)
      const deviceName = state.transport.getDeviceName?.() || '';
      const printerWidth = getPrinterWidthBytes(deviceName, printerModel);
      const printerAlignment = getPrinterAlignment(deviceName, printerModel);
      // Force threshold mode for TSPL printers (shipping labels need crisp barcodes)
      let ditherMode = getDitherMode(mergedElements);
      if (ditherMode === 'auto' && isTSPLPrinter(deviceName, printerModel)) {
        ditherMode = 'threshold';
      }
      const rasterData = isRotatedPrinter(deviceName, printerModel)
        ? state.renderer.getRasterDataRaw(mergedElements, ditherMode, currentPrintRotation())
        : state.renderer.getRasterData(mergedElements, printerWidth, 203, ditherMode, printerAlignment, currentPrintRotation());

      // Print
      await print(state.transport, rasterData, {
        isBLE: state.connectionType === 'ble',
        deviceName,
        printerModel,
        density,
        feed,
        continuous: !!(state.labelSize?.continuous),
        onProgress: (progress) => {
          updatePrintProgress(rowIndex + 1, totalRows, t('progress_sending', { progress }));
        },
      });

      labelsPrinted += isMultiLabel && !cloneMode
        ? Math.min(labelsAcross, totalRecords - rowIndex * labelsAcross)
        : 1;

      // Delay between prints
      if (rowIndex < totalRows - 1 && !isPrintCancelled()) {
        updatePrintProgress(rowIndex + 1, totalRows, t('progress_waiting'));
        await new Promise(r => setTimeout(r, 500));
      }
    }
    } finally {
      advanceCounter(labelsPrinted);
    }

    if (!isPrintCancelled()) {
      const successMsg = isMultiLabel && !cloneMode
        ? t('toast_printed_rows', { rows: totalRows, labels: totalRecords })
        : t('toast_printed_labels', { n: totalRecords });
      showToast(successMsg, 'success');
      setStatus(successMsg);
    }
    btn.textContent = originalText;

  } catch (error) {
    logError(error, 'handleBatchPrint');
    setStatus(error.message || t('print_failed'));
    btn.textContent = originalText;
  } finally {
    btn.disabled = false;
    hidePrintProgress();
  }
}

/**
 * Print single label from preview
 */
async function handlePrintSinglePreview() {
  const recordIndex = state.currentPreviewIndex;
  const record = state.templateData[recordIndex];

  if (!record) {
    setStatus(t('status_no_record_to_print'));
    return;
  }

  const btn = $('#full-preview-print');
  const originalText = btn.textContent;
  const { density, feed, printerModel } = state.printSettings;

  try {
    btn.disabled = true;
    btn.textContent = t('printing');

    // Ensure connected
    if (!state.transport || !state.transport.isConnected()) {
      hideFullPreview();
      setStatus(t('connecting'));
      await handleConnect();

      if (!state.transport || !state.transport.isConnected()) {
        throw new Error(t('error_connect_first'));
      }
    }

    // Substitute fields and evaluate expressions
    const substitutedElements = elementsWithValues(record);
    const mergedElements = evaluateExpressions(substitutedElements, { counterIndex: counterIndexForLabel(batchPositionOf(recordIndex)) });
    await waitForElementFonts(mergedElements);

    // Render to raster (use raw format for rotated printers like D-series and P12)
    const deviceName = state.transport.getDeviceName?.() || '';
    const printerWidth = getPrinterWidthBytes(deviceName, printerModel);
    const printerAlignment = getPrinterAlignment(deviceName, printerModel);
    // Force threshold mode for TSPL printers (shipping labels need crisp barcodes)
    let ditherMode = getDitherMode(mergedElements);
    if (ditherMode === 'auto' && isTSPLPrinter(deviceName, printerModel)) {
      ditherMode = 'threshold';
    }
    const rasterData = isRotatedPrinter(deviceName, printerModel)
      ? state.renderer.getRasterDataRaw(mergedElements, ditherMode, currentPrintRotation())
      : state.renderer.getRasterData(mergedElements, printerWidth, 203, ditherMode, printerAlignment, currentPrintRotation());

    // Print
    await print(state.transport, rasterData, {
      isBLE: state.connectionType === 'ble',
      deviceName,
      printerModel,
      density,
      feed,
      continuous: !!(state.labelSize?.continuous),
      onProgress: (progress) => {
        btn.textContent = t('printing_progress', { progress });
      },
    });

    setStatus(t('status_label_printed'));
    btn.textContent = originalText;

  } catch (error) {
    logError(error, 'handlePrintSinglePreview');
    setStatus(error.message || t('print_failed'));
    btn.textContent = originalText;
  } finally {
    btn.disabled = false;
  }
}

/**
 * Get selected elements
 */
function getSelectedElements() {
  return state.elements.filter(e => state.selectedIds.includes(e.id));
}

/**
 * Get single selected element (for properties panel - only when one selected)
 */
function getSelected() {
  if (state.selectedIds.length === 1) {
    return state.elements.find(e => e.id === state.selectedIds[0]);
  }
  return null;
}

/**
 * Select an element (replaces current selection)
 * If element is part of a group, select entire group
 */
function selectElement(id, addToSelection = false) {
  const element = state.elements.find(e => e.id === id);
  if (!element) return;

  // If element is in a group, get all group members
  let idsToSelect = [id];
  if (element.groupId) {
    const groupMembers = getGroupMembers(state.elements, element.groupId);
    idsToSelect = groupMembers.map(e => e.id);
  }

  if (addToSelection) {
    // Add to existing selection (Shift+click)
    const newIds = new Set([...state.selectedIds, ...idsToSelect]);
    state.selectedIds = Array.from(newIds);
  } else {
    // Replace selection
    state.selectedIds = idsToSelect;
  }

  updateToolbarState();
  updatePropertiesPanel();
  render();
}

/**
 * Toggle element selection (for Shift+click)
 */
function toggleElementSelection(id) {
  const element = state.elements.find(e => e.id === id);
  if (!element) return;

  // If element is in a group, toggle entire group
  let idsToToggle = [id];
  if (element.groupId) {
    const groupMembers = getGroupMembers(state.elements, element.groupId);
    idsToToggle = groupMembers.map(e => e.id);
  }

  const isSelected = state.selectedIds.includes(id);
  if (isSelected) {
    // Remove from selection
    state.selectedIds = state.selectedIds.filter(sid => !idsToToggle.includes(sid));
  } else {
    // Add to selection
    const newIds = new Set([...state.selectedIds, ...idsToToggle]);
    state.selectedIds = Array.from(newIds);
  }

  updateToolbarState();
  updatePropertiesPanel();
  render();
}

/**
 * Deselect all elements
 */
function deselect() {
  state.selectedIds = [];
  updateToolbarState();
  updatePropertiesPanel();
  render();
}

/**
 * Update element and re-render
 */
function modifyElement(id, changes) {
  state.elements = updateElement(state.elements, id, changes);
  if (['x', 'y', 'width', 'height', 'rotation'].some(k => k in changes)) releaseMovedFrames();

  // Only clear cache if content or size changed (not just position/rotation)
  const contentKeys = ['width', 'height', 'text', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'textDecoration', 'background', 'noWrap', 'clipOverflow', 'autoScale', 'verticalAlign', 'imageData', 'barcodeData', 'barcodeFormat', 'qrData', 'brightness', 'contrast', 'dither', 'crop', 'flipX', 'flipY', 'letterSpacing', 'arc', 'writingMode', 'tcy', 'latinMode', 'align', 'showText', 'textFontSize', 'textBold'];
  const needsCacheClear = Object.keys(changes).some(key => contentKeys.includes(key));
  if (needsCacheClear) {
    state.renderer.clearCache(id);
  }

  // Detect template fields if text/barcode/qr data changed
  const templateKeys = ['text', 'barcodeData', 'qrData'];
  if (Object.keys(changes).some(key => templateKeys.includes(key))) {
    detectTemplateFields();
  }

  // Auto-clone after property changes
  autoCloneIfEnabled();

  render();
  updatePropertiesPanel();
}

/**
 * Start inline editing of a text element
 * Shows a textarea overlay positioned over the element
 */
function startInlineEdit(elementId) {
  const element = state.elements.find(e => e.id === elementId);
  if (!element || element.type !== 'text') return;

  // Save history before editing starts (for undo)
  saveHistory();

  // Save current text for potential cancel
  state.editingTextId = elementId;
  state.editingOriginalText = element.text;

  const editor = $('#inline-text-editor');
  const canvas = $('#preview-canvas');
  const canvasRect = canvas.getBoundingClientRect();
  const zoom = state.renderer.zoom;

  // Canvas CSS size is scaled by zoom, so scale element coordinates too
  const baseLabelOffsetX = state.renderer.baseLabelOffsetX;
  const baseLabelOffsetY = state.renderer.baseLabelOffsetY;
  const left = canvasRect.left + (baseLabelOffsetX + element.x) * zoom;
  const top = canvasRect.top + (baseLabelOffsetY + element.y) * zoom;
  const width = element.width * zoom;
  const height = element.height * zoom;

  // Apply styles to match the element (scaled by zoom)
  Object.assign(editor.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    transform: `rotate(${element.rotation || 0}deg)`,
    transformOrigin: 'top left',
    fontFamily: element.fontFamily || 'Inter, sans-serif',
    fontSize: `${(element.fontSize || 24) * zoom}px`,
    fontWeight: element.fontWeight || 'normal',
    fontStyle: element.fontStyle || 'normal',
    textAlign: element.align || 'left',
    color: element.color === 'white' ? '#fff' : '#000',
    lineHeight: '1.2',
    letterSpacing: element.letterSpacing ? `${element.letterSpacing}em` : '',
    writingMode: isVertical(element) ? 'vertical-rl' : '', // #22 縦書き
  });

  // Set content and show
  editor.value = element.text || '';
  editor.classList.remove('hidden');
  editor.focus();
  editor.select();
}

/**
 * Stop inline editing
 * @param {boolean} save - Whether to save changes (false = cancel/revert)
 */
function stopInlineEdit(save = true) {
  if (!state.editingTextId) return;

  const editor = $('#inline-text-editor');

  if (save) {
    // Save the final text
    modifyElement(state.editingTextId, { text: editor.value });
  } else {
    // Revert to original text
    modifyElement(state.editingTextId, { text: state.editingOriginalText });
  }

  editor.classList.add('hidden');
  state.editingTextId = null;
  state.editingOriginalText = null;
}

/**
 * Update toolbar button states
 */
function updateToolbarState() {
  const hasSelection = state.selectedIds.length > 0;
  const hasMultipleSelected = state.selectedIds.length > 1;
  const selectedElements = getSelectedElements();

  // Check if selection contains any grouped elements
  const hasGroupedElements = selectedElements.some(e => e.groupId);
  // Check if all selected elements are in the same group
  const groupIds = new Set(selectedElements.map(e => e.groupId).filter(Boolean));
  const canUngroup = groupIds.size === 1 && hasGroupedElements;

  $('#duplicate-btn').disabled = !hasSelection;
  $('#delete-btn').disabled = !hasSelection;
  $('#bring-front').disabled = !hasSelection;
  $('#send-back').disabled = !hasSelection;

  // Group button: enabled when 2+ ungrouped elements selected
  const groupBtn = $('#group-btn');
  if (groupBtn) {
    groupBtn.disabled = !hasMultipleSelected || hasGroupedElements;
  }

  // Ungroup button: enabled when a group is selected
  const ungroupBtn = $('#ungroup-btn');
  if (ungroupBtn) {
    ungroupBtn.disabled = !canUngroup;
  }
}

/**
 * Update properties panel for selected element
 */
function updatePropertiesPanel() {
  const element = getSelected();
  const selectedCount = state.selectedIds.length;

  // Handle multi-selection or no selection
  if (!element) {
    if (selectedCount > 1) {
      // Multiple elements selected
      $('#props-empty').innerHTML = `<span class="text-gray-500">${t('n_elements_selected', { n: selectedCount })}</span>`;
    } else {
      $('#props-empty').innerHTML = `<span class="text-gray-400">${t('select_element_to_edit')}</span>`;
    }
    $('#props-empty').classList.remove('hidden');
    $('#props-content').classList.add('hidden');
    return;
  }

  $('#props-empty').classList.add('hidden');
  $('#props-content').classList.remove('hidden');

  // Update common properties
  $('#prop-x').value = Math.round(element.x);
  $('#prop-y').value = Math.round(element.y);
  $('#prop-width').value = Math.round(element.width);
  $('#prop-height').value = Math.round(element.height);
  $('#prop-rotation').value = Math.round(element.rotation || 0);
  syncMirrorControls($('#prop-mirror-axis'), $('#prop-mirror-orient'), element);

  // Update layer number (1-indexed for display, position in array determines z-order)
  const layerIndex = state.elements.findIndex(el => el.id === element.id);
  $('#prop-layer').textContent = layerIndex + 1;
  $('#prop-layer-total').textContent = state.elements.length;

  // Hide all type-specific panels
  $('#props-text').classList.add('hidden');
  $('#props-image').classList.add('hidden');
  $('#props-barcode').classList.add('hidden');
  $('#props-qr').classList.add('hidden');
  $('#props-shape').classList.add('hidden');
  $('#props-frame').classList.add('hidden');

  // Show and populate type-specific panel
  switch (element.type) {
    case 'text':
      $('#props-text').classList.remove('hidden');
      $('#prop-text-content').value = element.text || '';
      $('#prop-font-family').value = element.fontFamily || 'Inter, sans-serif';
      $('#prop-font-size').value = element.fontSize || 24;
      $('#prop-no-wrap').checked = element.noWrap || false;
      $('#prop-clip-overflow').checked = element.clipOverflow || false;
      $('#prop-auto-scale').checked = element.autoScale || false;
      updateTextStylePanel(element); // #24 字間・曲線文字
      // Update horizontal alignment buttons
      $$('.align-btn').forEach(btn => {
        btn.classList.toggle('bg-gray-100', btn.dataset.align === element.align);
      });
      // Update vertical alignment buttons
      const vAlign = element.verticalAlign || 'middle';
      $$('.valign-btn').forEach(btn => {
        btn.classList.toggle('bg-gray-100', btn.dataset.valign === vAlign);
      });
      // Update style buttons
      $('#style-bold').classList.toggle('bg-gray-200', element.fontWeight === 'bold');
      $('#style-italic').classList.toggle('bg-gray-200', element.fontStyle === 'italic');
      $('#style-underline').classList.toggle('bg-gray-200', element.textDecoration === 'underline');
      // Update text color buttons
      const colorValue = element.color || 'black';
      $$('.color-btn').forEach(btn => {
        btn.classList.toggle('bg-gray-100', btn.dataset.color === colorValue);
        btn.classList.toggle('ring-2', btn.dataset.color === colorValue);
        btn.classList.toggle('ring-blue-400', btn.dataset.color === colorValue);
      });
      // Update background buttons
      const bgValue = element.background || 'transparent';
      $$('.bg-btn').forEach(btn => {
        btn.classList.toggle('bg-gray-100', btn.dataset.bg === bgValue);
        btn.classList.toggle('ring-2', btn.dataset.bg === bgValue);
        btn.classList.toggle('ring-blue-400', btn.dataset.bg === bgValue);
      });
      break;

    case 'image':
      $('#props-image').classList.remove('hidden');
      // Calculate current scale based on natural size (#26: 切り抜き後の大きさが基準)
      const imgBase = getImageBaseSize(element);
      const scaleW = (element.width / imgBase.width) * 100;
      const scaleH = (element.height / imgBase.height) * 100;
      const currentScale = Math.round(Math.max(scaleW, scaleH));
      $('#prop-image-scale').value = currentScale;
      $('#prop-image-scale-input').value = currentScale;
      $('#prop-image-lock-ratio').checked = element.lockAspectRatio !== false;
      $('#prop-image-dither').value = element.dither || 'floyd-steinberg';
      $('#prop-image-brightness').value = element.brightness || 0;
      $('#prop-image-brightness-input').value = element.brightness || 0;
      $('#prop-image-contrast').value = element.contrast || 0;
      $('#prop-image-contrast-input').value = element.contrast || 0;
      $('#prop-image-flip-x').setAttribute('aria-pressed', String(!!element.flipX));
      $('#prop-image-flip-y').setAttribute('aria-pressed', String(!!element.flipY));
      $('#prop-image-crop').setAttribute('aria-pressed', String(!!normalizeCrop(element.crop)));
      $('#prop-image-crop-clear').hidden = !normalizeCrop(element.crop);
      break;

    case 'barcode':
      $('#props-barcode').classList.remove('hidden');
      $('#prop-barcode-data').value = element.barcodeData || '';
      $('#prop-barcode-format').value = element.barcodeFormat || 'CODE128';
      $('#prop-barcode-showtext').checked = element.showText !== false;
      $('#prop-barcode-fontsize').value = element.textFontSize || 12;
      $('#prop-barcode-bold').checked = element.textBold || false;
      $('#barcode-text-options')?.classList.toggle('hidden', element.showText === false);
      break;

    case 'qr':
      $('#props-qr').classList.remove('hidden');
      $('#prop-qr-data').value = element.qrData || '';
      break;

    case 'shape':
      $('#props-shape').classList.remove('hidden');
      $('#prop-shape-type').value = element.shapeType || 'rectangle';
      $('#prop-stroke-width').value = element.strokeWidth || 2;
      $('#prop-corner-radius').value = element.cornerRadius || 0;
      // Show/hide corner radius based on shape type
      const showCornerRadius = element.shapeType === 'rectangle';
      $('#prop-corner-radius-group').classList.toggle('hidden', !showCornerRadius);
      // Update fill dropdown (map legacy values to new ones)
      let fillValue = element.fill || 'black';
      if (fillValue === 'dither-light') fillValue = 'dither-25';
      if (fillValue === 'dither-medium') fillValue = 'dither-50';
      if (fillValue === 'dither-dark') fillValue = 'dither-75';
      $('#shape-fill').value = fillValue;
      // Update stroke buttons
      const strokeValue = element.stroke || 'none';
      $$('.stroke-btn').forEach(btn => {
        btn.classList.toggle('bg-gray-100', btn.dataset.stroke === strokeValue);
        btn.classList.toggle('ring-2', btn.dataset.stroke === strokeValue);
        btn.classList.toggle('ring-blue-400', btn.dataset.stroke === strokeValue);
      });
      break;

    case 'frame':
      $('#props-frame').classList.remove('hidden');
      $('#prop-frame-style').value = element.frameStyle || 'single';
      $('#prop-frame-shape').value = element.frameShape === 'ellipse' ? 'ellipse' : 'rect';
      $('#prop-frame-color').value = element.color === 'white' ? 'white' : 'black';
      $('#prop-frame-stroke').value = element.strokeWidth || 3;
      $('#prop-frame-margin').value = element.frameMargin ?? 8;
      $('#prop-frame-fit').checked = !!element.fitToLabel;
      break;
  }

  // Update mobile UI when selection changes
  updateMobileUI();
}

/**
 * Handle label size change
 */
function handleLabelSizeChange() {
  const select = $('#label-size');
  const value = select.value;

  if (value === 'multi-label') {
    // Show multi-label configuration modal
    $('#custom-size').classList.add('hidden');
    showMultiLabelModal();
    return;
  } else if (value === 'custom') {
    $('#custom-size').classList.remove('hidden');
    // Reset round checkbox to unchecked when switching to custom
    $('#custom-round').checked = false;
    if ($('#custom-continuous')) $('#custom-continuous').checked = false;
    $('#custom-height').disabled = false;
    $('#custom-size-x').classList.remove('hidden');
    $('#custom-height').classList.remove('hidden');
    const w = validateLabelWidth($('#custom-width').value);
    const h = validateLabelHeight($('#custom-height').value);
    state.labelSize = { width: w, height: h, round: false, continuous: false };
  } else {
    $('#custom-size').classList.add('hidden');
    const preset = LABEL_SIZES[value];
    if (preset) {
      state.labelSize = { ...preset };
    }
  }

  // Disable multi-label mode if switching to a single-label preset
  if (state.multiLabel.enabled) {
    exitMultiLabelMode();
  }

  state.renderer.setDimensions(state.labelSize.width, state.labelSize.height, state.zoom, state.labelSize.round || false);
  updatePrintSize();
  updateLengthAdjustButtons();

  // Auto zoom-to-fit if label is too large at 100% zoom
  zoomToFitIfNeeded();

  render();
}

/**
 * Handle custom size input
 */
function handleCustomSizeChange() {
  const w = validateLabelWidth($('#custom-width').value);
  const isRound = $('#custom-round').checked;
  const isContinuous = !isRound && !!$('#custom-continuous')?.checked;
  const h = isRound ? w : validateLabelHeight($('#custom-height').value);

  // Sync height input when round is checked
  if (isRound) {
    $('#custom-height').value = w;
    $('#custom-height').disabled = true;
    $('#custom-size-x').classList.add('hidden');
    $('#custom-height').classList.add('hidden');
  } else {
    $('#custom-height').disabled = false;
    $('#custom-size-x').classList.remove('hidden');
    $('#custom-height').classList.remove('hidden');
  }

  state.labelSize = { width: w, height: h, round: isRound, continuous: isContinuous };
  state.renderer.setDimensions(state.labelSize.width, state.labelSize.height, state.zoom, isRound);
  updatePrintSize();
  updateLengthAdjustButtons();

  // Auto zoom-to-fit if label is too large at 100% zoom
  zoomToFitIfNeeded();

  render();

  // Sync to mobile custom inputs
  if ($('#mobile-custom-width')) $('#mobile-custom-width').value = w;
  if ($('#mobile-custom-height')) $('#mobile-custom-height').value = h;
  if ($('#mobile-custom-round')) $('#mobile-custom-round').checked = isRound;
  if ($('#mobile-custom-continuous')) $('#mobile-custom-continuous').checked = isContinuous;
}

// =============================================================================
// MULTI-LABEL FUNCTIONS
// =============================================================================

/**
 * Show multi-label configuration modal
 */
function showMultiLabelModal() {
  const modal = $('#multi-label-modal');

  // Populate with current values if already in multi-label mode
  if (state.multiLabel.enabled) {
    $('#multi-label-width').value = state.multiLabel.labelWidth;
    $('#multi-label-height').value = state.multiLabel.labelHeight;
    $('#multi-label-count').value = state.multiLabel.labelsAcross;
    $('#multi-label-gap').value = state.multiLabel.gapMm;
    $('#multi-label-clone-mode').checked = state.multiLabel.cloneMode;
  }

  updateMultiLabelPreview();
  loadMultiLabelPresets();
  modal.classList.remove('hidden');
}

/**
 * Hide multi-label modal
 */
function hideMultiLabelModal() {
  $('#multi-label-modal').classList.add('hidden');

  // Reset label size dropdown if not applied
  if (!state.multiLabel.enabled) {
    $('#label-size').value = '40x30';
  }
}

/**
 * Update multi-label total width preview
 */
function updateMultiLabelPreview() {
  const width = parseFloat($('#multi-label-width').value) || 10;
  const count = parseInt($('#multi-label-count').value) || 1;
  const gap = parseFloat($('#multi-label-gap').value) || 0;

  const totalWidth = (width * count) + (gap * (count - 1));
  $('#multi-label-total-width').textContent = `${totalWidth.toFixed(1)}mm`;
}

/**
 * Apply multi-label configuration
 */
function applyMultiLabelConfig() {
  const labelWidth = Math.max(5, Math.min(50, parseFloat($('#multi-label-width').value) || 10));
  const labelHeight = Math.max(5, Math.min(100, parseFloat($('#multi-label-height').value) || 20));
  const labelsAcross = Math.max(1, Math.min(8, parseInt($('#multi-label-count').value) || 4));
  const gapMm = Math.max(0, Math.min(10, parseFloat($('#multi-label-gap').value) || 2));
  const cloneMode = $('#multi-label-clone-mode').checked;

  // Update state
  state.multiLabel = {
    enabled: true,
    labelWidth: labelWidth,
    labelHeight: labelHeight,
    labelsAcross: labelsAcross,
    gapMm: gapMm,
    cloneMode: cloneMode,
  };
  state.activeZone = 0;

  // Update renderer
  state.renderer.setMultiLabelDimensions(labelWidth, labelHeight, labelsAcross, gapMm);
  state.renderer.setActiveZone(0);

  // Update label size for single label operations
  state.labelSize = { width: labelWidth, height: labelHeight };

  // Show zone toolbar
  updateZoneToolbar();
  $('#zone-toolbar').classList.remove('hidden');

  // Update dropdown to show multi-label is active
  $('#label-size').value = 'multi-label';

  hideMultiLabelModal();
  updatePrintSize();
  render();

  showToast(t('toast_multi_label', { n: labelsAcross, w: labelWidth, h: labelHeight }), 'success');
}

/**
 * Exit multi-label mode
 */
function exitMultiLabelMode() {
  // Collapse all elements to zone 0
  state.elements = collapseToSingleZone(state.elements);

  state.multiLabel = {
    enabled: false,
    labelWidth: 10,
    labelHeight: 20,
    labelsAcross: 4,
    gapMm: 2,
    cloneMode: true,
  };
  state.activeZone = 0;

  // Disable multi-label in renderer
  state.renderer.disableMultiLabel();

  // Hide zone toolbar
  $('#zone-toolbar').classList.add('hidden');

  // Reset to default label size
  $('#label-size').value = '40x30';
  state.labelSize = { width: 40, height: 30, round: false };
  state.renderer.setDimensions(40, 30, state.zoom, false);

  updatePrintSize();
  render();
}

/**
 * Update zone toolbar with current configuration
 */
function updateZoneToolbar() {
  const { labelWidth, labelHeight, labelsAcross, cloneMode } = state.multiLabel;

  // Update config summary
  $('#zone-config-summary').textContent = `${labelsAcross} × ${labelWidth}×${labelHeight}mm`;

  // Update clone mode checkbox
  $('#zone-clone-mode').checked = cloneMode;

  // Create zone buttons
  const container = $('#zone-buttons');
  container.innerHTML = '';

  for (let i = 0; i < labelsAcross; i++) {
    const btn = document.createElement('button');
    btn.className = `px-2 py-0.5 text-xs font-medium rounded transition-colors ${
      i === state.activeZone
        ? 'bg-blue-600 text-white'
        : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-100'
    }`;
    btn.textContent = `${i + 1}`;
    btn.addEventListener('click', () => setActiveZone(i));
    container.appendChild(btn);
  }
}

/**
 * Set active zone for editing
 */
function setActiveZone(zone) {
  state.activeZone = zone;
  state.renderer.setActiveZone(zone);
  updateZoneToolbar();
  render();
}

/**
 * Clone current zone elements to all other zones
 */
function cloneToAllZones() {
  if (!state.multiLabel.enabled) return;

  saveHistory();
  state.elements = cloneElementsToAllZones(
    state.elements,
    state.activeZone,
    state.multiLabel.labelsAcross
  );
  render();
  showToast(t('toast_cloned_to_all'), 'success');
}

/**
 * Auto-clone elements if clone mode is enabled
 * Called after element additions/modifications
 */
function autoCloneIfEnabled() {
  if (!state.multiLabel.enabled || !state.multiLabel.cloneMode) return;

  // Clone elements from active zone to all other zones (silently)
  state.elements = cloneElementsToAllZones(
    state.elements,
    state.activeZone,
    state.multiLabel.labelsAcross
  );
}

/**
 * Load multi-label presets from localStorage
 */
function loadMultiLabelPresets() {
  const presets = safeJsonParse(safeStorageGet(STORAGE_KEYS.MULTI_LABEL_PRESETS), {});
  const select = $('#multi-label-preset');

  // Clear existing options (except first)
  while (select.options.length > 1) {
    select.remove(1);
  }

  // Add preset options
  for (const name of Object.keys(presets)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
}

/**
 * Save current multi-label config as a preset
 */
function saveMultiLabelPreset() {
  const name = prompt(t('prompt_preset_name'));
  if (!name || !name.trim()) return;

  const presets = safeJsonParse(safeStorageGet(STORAGE_KEYS.MULTI_LABEL_PRESETS), {});

  presets[name.trim()] = {
    labelWidth: parseFloat($('#multi-label-width').value) || 10,
    labelHeight: parseFloat($('#multi-label-height').value) || 20,
    labelsAcross: parseInt($('#multi-label-count').value) || 4,
    gapMm: parseFloat($('#multi-label-gap').value) || 2,
  };

  safeStorageSet(STORAGE_KEYS.MULTI_LABEL_PRESETS, safeJsonStringify(presets));
  loadMultiLabelPresets();
  showToast(t('toast_preset_saved', { name: name.trim() }), 'success');
}

/**
 * Load a multi-label preset
 */
function loadMultiLabelPreset(name) {
  const presets = safeJsonParse(safeStorageGet(STORAGE_KEYS.MULTI_LABEL_PRESETS), {});
  const preset = presets[name];

  if (preset) {
    $('#multi-label-width').value = preset.labelWidth;
    $('#multi-label-height').value = preset.labelHeight;
    $('#multi-label-count').value = preset.labelsAcross;
    $('#multi-label-gap').value = preset.gapMm;
    updateMultiLabelPreview();

    // Show delete button
    $('#multi-label-delete-preset').classList.remove('hidden');
  }
}

/**
 * Delete current multi-label preset
 */
function deleteMultiLabelPreset() {
  const select = $('#multi-label-preset');
  const name = select.value;

  if (!name) return;

  if (!confirm(t('confirm_delete_preset', { name }))) return;

  const presets = safeJsonParse(safeStorageGet(STORAGE_KEYS.MULTI_LABEL_PRESETS), {});
  delete presets[name];
  safeStorageSet(STORAGE_KEYS.MULTI_LABEL_PRESETS, safeJsonStringify(presets));

  loadMultiLabelPresets();
  select.value = '';
  $('#multi-label-delete-preset').classList.add('hidden');
  showToast(t('toast_preset_deleted', { name }), 'success');
}

/**
 * Get mouse position relative to label (accounting for zoom and label offset)
 */
function getCanvasPos(e) {
  const rect = state.renderer.canvas.getBoundingClientRect();
  const zoom = state.renderer.zoom;

  // Convert mouse position from screen coordinates to base label coordinates
  // rect is now scaled by zoom, so divide by zoom to get base coordinates
  const baseLabelOffsetX = state.renderer.baseLabelOffsetX;
  const baseLabelOffsetY = state.renderer.baseLabelOffsetY;

  return {
    x: (e.clientX - rect.left) / zoom - baseLabelOffsetX,
    y: (e.clientY - rect.top) / zoom - baseLabelOffsetY,
  };
}

/**
 * Convert canvas position to zone-relative position
 * Returns { zoneIndex, x, y } where x,y are relative to the zone
 */
function getZoneRelativePos(canvasX, canvasY) {
  if (!state.multiLabel.enabled) {
    return { zoneIndex: 0, x: canvasX, y: canvasY };
  }

  const zoneIndex = state.renderer.getZoneAtPoint(canvasX, canvasY);
  if (zoneIndex === null) {
    // Clicked in gap or outside zones
    return { zoneIndex: null, x: canvasX, y: canvasY };
  }

  const zone = state.renderer.multiLabel.zones[zoneIndex];
  return {
    zoneIndex,
    x: canvasX - zone.x,
    y: canvasY - zone.y,
  };
}

/**
 * Convert zone-relative position to canvas position
 */
function getCanvasPosFromZone(zoneIndex, zoneX, zoneY) {
  if (!state.multiLabel.enabled || zoneIndex === 0) {
    return { x: zoneX, y: zoneY };
  }

  const zone = state.renderer.multiLabel.zones[zoneIndex];
  return {
    x: zone.x + zoneX,
    y: zone.y + zoneY,
  };
}

/**
 * Get element at point, accounting for multi-label zones
 */
function getElementAtCanvasPoint(canvasX, canvasY) {
  if (!state.multiLabel.enabled) {
    return getElementAtPoint(canvasX, canvasY, state.elements);
  }

  // In multi-label mode, check elements in the clicked zone
  const { zoneIndex, x, y } = getZoneRelativePos(canvasX, canvasY);
  if (zoneIndex === null) return null;

  // Filter to elements in this zone and check hit
  const zoneElements = state.elements.filter(el => (el.zone || 0) === zoneIndex);
  return getElementAtPoint(x, y, zoneElements);
}

/**
 * Detect alignment guides and calculate snap adjustments
 * Returns { guides: [...], snapX: number, snapY: number }
 *
 * @param {Object} bounds - { x, y, width, height } of the element(s) being moved
 * @param {Array} excludeIds - IDs to exclude from other element matching
 */
function detectAlignmentGuides(bounds, excludeIds = []) {
  const guides = [];
  // Use label dimensions, not canvas dimensions (canvas includes overflow padding)
  const labelWidth = state.renderer.labelWidth;
  const labelHeight = state.renderer.labelHeight;

  // Element bounds
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  // Label center
  const labelCenterX = labelWidth / 2;
  const labelCenterY = labelHeight / 2;

  // Track best snap for each axis (closest match)
  let snapX = null;
  let snapXDist = GUIDES.SNAP_THRESHOLD;
  let snapY = null;
  let snapYDist = GUIDES.SNAP_THRESHOLD;

  // Helper to check and record vertical snap (x position)
  const checkSnapX = (elementEdge, targetPos, edgeType) => {
    const dist = Math.abs(elementEdge - targetPos);
    if (dist < snapXDist) {
      snapXDist = dist;
      // Calculate how much to move the element
      if (edgeType === 'left') snapX = targetPos - left;
      else if (edgeType === 'right') snapX = targetPos - right;
      else if (edgeType === 'center') snapX = targetPos - centerX;
      guides.push({ type: 'v', pos: targetPos });
    }
  };

  // Helper to check and record horizontal snap (y position)
  const checkSnapY = (elementEdge, targetPos, edgeType) => {
    const dist = Math.abs(elementEdge - targetPos);
    if (dist < snapYDist) {
      snapYDist = dist;
      if (edgeType === 'top') snapY = targetPos - top;
      else if (edgeType === 'bottom') snapY = targetPos - bottom;
      else if (edgeType === 'center') snapY = targetPos - centerY;
      guides.push({ type: 'h', pos: targetPos });
    }
  };

  // Check label center alignment
  checkSnapX(centerX, labelCenterX, 'center');
  checkSnapY(centerY, labelCenterY, 'center');

  // Check label edge alignment
  checkSnapX(left, 0, 'left');
  checkSnapX(right, labelWidth, 'right');
  checkSnapY(top, 0, 'top');
  checkSnapY(bottom, labelHeight, 'bottom');

  // Check alignment with other elements
  for (const other of state.elements) {
    if (excludeIds.includes(other.id)) continue;

    const oLeft = other.x;
    const oRight = other.x + other.width;
    const oTop = other.y;
    const oBottom = other.y + other.height;
    const oCenterX = other.x + other.width / 2;
    const oCenterY = other.y + other.height / 2;

    // Vertical snaps (x positions)
    checkSnapX(left, oLeft, 'left');
    checkSnapX(left, oRight, 'left');
    checkSnapX(right, oLeft, 'right');
    checkSnapX(right, oRight, 'right');
    checkSnapX(centerX, oCenterX, 'center');

    // Horizontal snaps (y positions)
    checkSnapY(top, oTop, 'top');
    checkSnapY(top, oBottom, 'top');
    checkSnapY(bottom, oTop, 'bottom');
    checkSnapY(bottom, oBottom, 'bottom');
    checkSnapY(centerY, oCenterY, 'center');
  }

  // Deduplicate guides (same type and position within 1px)
  const unique = [];
  for (const guide of guides) {
    const exists = unique.some(g =>
      g.type === guide.type && Math.abs(g.pos - guide.pos) < 1
    );
    if (!exists) unique.push(guide);
  }

  return {
    guides: unique,
    snapX: snapX || 0,
    snapY: snapY || 0,
  };
}

/**
 * Get element with canvas-adjusted position for multi-label mode
 */
function getElementWithCanvasPos(element) {
  if (!state.multiLabel.enabled || !element) return element;

  const zoneIndex = element.zone || 0;
  const zone = state.renderer.multiLabel.zones[zoneIndex];
  if (!zone) return element;

  return {
    ...element,
    x: element.x + zone.x,
    y: element.y + zone.y,
  };
}

/**
 * Get bounds with canvas-adjusted position for multi-label mode
 */
function getBoundsWithCanvasPos(bounds, zoneIndex) {
  if (!state.multiLabel.enabled || !bounds) return bounds;

  const zone = state.renderer.multiLabel.zones[zoneIndex];
  if (!zone) return bounds;

  return {
    ...bounds,
    x: bounds.x + zone.x,
    y: bounds.y + zone.y,
    cx: bounds.cx + zone.x,
    cy: bounds.cy + zone.y,
  };
}

/**
 * Handle canvas mouse down
 */
function handleCanvasMouseDown(e) {
  const pos = getCanvasPos(e);

  // If inline editing is active, clicking on canvas closes it
  if (state.editingTextId) {
    // Don't close immediately - let the dblclick event fire first if it's a double-click
    return;
  }

  // In multi-label mode, check which zone was clicked and switch if needed
  if (state.multiLabel.enabled) {
    const { zoneIndex } = getZoneRelativePos(pos.x, pos.y);
    if (zoneIndex !== null && zoneIndex !== state.activeZone) {
      // Switch to clicked zone
      setActiveZone(zoneIndex);
    }
  }

  // Use zone-aware element detection
  const clickedElement = getElementAtCanvasPoint(pos.x, pos.y);
  const selectedElements = getSelectedElements();
  const isMultiSelect = state.selectedIds.length > 1;

  // For multi-selection or groups, check group bounding box handles first
  if (isMultiSelect || (selectedElements.length === 1 && selectedElements[0].groupId)) {
    const rawBounds = getMultiElementBounds(selectedElements);
    // Adjust bounds for canvas position in multi-label mode
    const bounds = selectedElements.length > 0
      ? getBoundsWithCanvasPos(rawBounds, selectedElements[0].zone || 0)
      : rawBounds;
    if (bounds) {
      const handle = getGroupHandleAtPoint(pos.x, pos.y, bounds);
      if (handle) {
        saveHistory();
        state.isDragging = true;
        state.dragStartX = pos.x;
        state.dragStartY = pos.y;
        state.dragStartElements = selectedElements.map(el => ({ ...el }));
        state.dragStartBounds = { ...rawBounds }; // Store raw bounds for calculations

        if (handle === HandleType.ROTATE) {
          state.dragType = 'group-rotate';
          // Calculate starting angle using canvas-adjusted center
          const angle = Math.atan2(pos.y - bounds.cy, pos.x - bounds.cx);
          state.dragStartAngle = (angle * 180) / Math.PI + 90;
        } else {
          state.dragType = 'group-resize';
          state.dragHandle = handle;
        }
        return;
      }
    }
  }

  // Single element: check individual handles
  if (state.selectedIds.length === 1) {
    const selected = selectedElements[0];
    if (selected) {
      // Get element with canvas-adjusted position for handle detection
      const adjustedElement = getElementWithCanvasPos(selected);
      const handle = getHandleAtPoint(pos.x, pos.y, adjustedElement);
      if (handle) {
        saveHistory();
        state.isDragging = true;
        state.dragStartX = pos.x;
        state.dragStartY = pos.y;
        state.dragStartElements = [{ ...selected }]; // Store original element

        if (handle === HandleType.ROTATE) {
          state.dragType = 'rotate';
        } else {
          state.dragType = 'resize';
          state.dragHandle = handle;
        }
        return;
      }
    }
  }

  // Check if clicking on an element
  if (clickedElement) {
    // Shift+click toggles selection
    if (e.shiftKey) {
      toggleElementSelection(clickedElement.id);
    } else {
      // Check if clicking on already-selected element
      const alreadySelected = state.selectedIds.includes(clickedElement.id);
      if (!alreadySelected) {
        selectElement(clickedElement.id);
      }
    }

    // Start move drag for all selected elements
    const currentSelected = getSelectedElements();
    saveHistory();
    state.isDragging = true;
    state.dragType = currentSelected.length > 1 ? 'group-move' : 'move';
    state.dragStartX = pos.x;
    state.dragStartY = pos.y;
    state.dragStartElements = currentSelected.map(el => ({ ...el }));
    state.dragStartBounds = getMultiElementBounds(currentSelected);
    return;
  }

  // Clicked on empty area - but still in a valid zone in multi-label mode
  if (state.multiLabel.enabled) {
    const { zoneIndex } = getZoneRelativePos(pos.x, pos.y);
    if (zoneIndex === null) {
      // Clicked in gap, just deselect
      deselect();
      return;
    }
  }

  deselect();
}

/**
 * Handle canvas mouse move
 */
function handleCanvasMouseMove(e) {
  const pos = getCanvasPos(e);
  const canvas = state.renderer.canvas;

  if (state.isDragging && state.dragStartElements) {
    const dx = pos.x - state.dragStartX;
    const dy = pos.y - state.dragStartY;

    switch (state.dragType) {
      case 'move':
        // Single element move
        const el = state.dragStartElements[0];
        let newX = el.x + dx;
        let newY = el.y + dy;
        // Detect alignment guides and get snap adjustments
        const snapResult = detectAlignmentGuides(
          { x: newX, y: newY, width: el.width, height: el.height },
          [el.id]
        );
        // Apply soft snap
        newX += snapResult.snapX;
        newY += snapResult.snapY;
        modifyElement(el.id, { x: newX, y: newY });
        state.alignmentGuides = snapResult.guides;
        break;

      case 'group-move':
        // Multi-element move - first move without snap to calculate bounds
        state.elements = moveElements(
          state.elements,
          state.dragStartElements.map(e => e.id),
          dx, dy
        );
        // Detect alignment guides for the group bounds
        const movedElements = getSelectedElements();
        const groupBounds = getMultiElementBounds(movedElements);
        if (groupBounds) {
          const groupSnapResult = detectAlignmentGuides(
            { x: groupBounds.x, y: groupBounds.y, width: groupBounds.width, height: groupBounds.height },
            movedElements.map(e => e.id)
          );
          // Apply soft snap by moving elements again by snap offset
          if (groupSnapResult.snapX !== 0 || groupSnapResult.snapY !== 0) {
            state.elements = moveElements(
              state.elements,
              movedElements.map(e => e.id),
              groupSnapResult.snapX, groupSnapResult.snapY
            );
          }
          state.alignmentGuides = groupSnapResult.guides;
        }
        // Reset start positions for continuous drag
        state.dragStartElements = getSelectedElements().map(e => ({ ...e }));
        state.dragStartX = pos.x;
        state.dragStartY = pos.y;
        render();
        break;

      case 'resize':
        // Single element resize
        const resizeEl = state.dragStartElements[0];
        // For images with lockAspectRatio, preserve aspect by default (Shift to unlock)
        // For other elements, Shift preserves aspect
        const isLockedImage = resizeEl.type === 'image' && resizeEl.lockAspectRatio !== false;
        const preserveAspect = isLockedImage ? !e.shiftKey : e.shiftKey;
        const newBounds = calculateResize(resizeEl, state.dragHandle, dx, dy, preserveAspect);
        modifyElement(resizeEl.id, constrainSize({ ...resizeEl, ...newBounds }));
        break;

      case 'group-resize':
        // Multi-element resize - scale from original positions
        const { scaleX, scaleY } = calculateGroupResize(
          state.dragStartBounds,
          state.dragHandle,
          dx, dy,
          e.shiftKey
        );

        // Determine if this is a side handle (only one dimension changes)
        const isHorizontalSide = state.dragHandle === HandleType.E || state.dragHandle === HandleType.W;
        const isVerticalSide = state.dragHandle === HandleType.N || state.dragHandle === HandleType.S;

        // Apply scale to original elements, not current state
        const scaledElements = state.dragStartElements.map(origEl => {
          const elCx = origEl.x + origEl.width / 2;
          const elCy = origEl.y + origEl.height / 2;
          const centerX = state.dragStartBounds.cx;
          const centerY = state.dragStartBounds.cy;

          // For side handles, only scale in one direction
          const effectiveScaleX = isVerticalSide ? 1 : scaleX;
          const effectiveScaleY = isHorizontalSide ? 1 : scaleY;

          // Scale position relative to group center
          const newCx = centerX + (elCx - centerX) * effectiveScaleX;
          const newCy = centerY + (elCy - centerY) * effectiveScaleY;

          // Scale size - for side handles, only change one dimension
          const newWidth = Math.max(origEl.width * effectiveScaleX, ELEMENT.MIN_WIDTH);
          const newHeight = Math.max(origEl.height * effectiveScaleY, ELEMENT.MIN_HEIGHT);

          return {
            ...origEl,
            x: newCx - newWidth / 2,
            y: newCy - newHeight / 2,
            width: newWidth,
            height: newHeight,
          };
        });

        // Update elements in state
        state.elements = state.elements.map(el => {
          const scaled = scaledElements.find(s => s.id === el.id);
          return scaled || el;
        });

        // Clear caches for resized elements
        state.dragStartElements.forEach(el => state.renderer.clearCache(el.id));
        render();
        break;

      case 'rotate':
        // Single element rotation - use canvas-adjusted position for calculation
        const rotEl = state.dragStartElements[0];
        const adjustedRotEl = getElementWithCanvasPos(rotEl);
        let rotation = calculateRotation(adjustedRotEl, pos.x, pos.y);
        if (!e.shiftKey) {
          rotation = snapRotation(rotation);
        }
        modifyElement(rotEl.id, { rotation });
        break;

      case 'group-rotate':
        // Multi-element rotation around group center - adjust bounds for canvas position
        const adjustedBounds = getBoundsWithCanvasPos(state.dragStartBounds, state.dragStartElements[0]?.zone || 0);
        const currentAngle = Math.atan2(pos.y - adjustedBounds.cy, pos.x - adjustedBounds.cx);
        let angleDelta = ((currentAngle * 180) / Math.PI + 90) - state.dragStartAngle;
        if (!e.shiftKey) {
          angleDelta = snapRotation(angleDelta);
        }
        state.elements = rotateElements(
          state.elements,
          state.dragStartElements.map(e => e.id),
          angleDelta,
          { x: state.dragStartBounds.cx, y: state.dragStartBounds.cy }
        );
        // Update start angle for continuous drag
        state.dragStartAngle = (currentAngle * 180) / Math.PI + 90;
        state.dragStartElements = getSelectedElements().map(e => ({ ...e }));
        render();
        break;
    }
    return;
  }

  // Update cursor based on what's under mouse
  const selectedElements = getSelectedElements();
  const isMultiSelect = state.selectedIds.length > 1;

  // Check group handles for multi-selection
  if (isMultiSelect || (selectedElements.length === 1 && selectedElements[0].groupId)) {
    const rawBounds = getMultiElementBounds(selectedElements);
    const bounds = selectedElements.length > 0
      ? getBoundsWithCanvasPos(rawBounds, selectedElements[0].zone || 0)
      : rawBounds;
    if (bounds) {
      const handle = getGroupHandleAtPoint(pos.x, pos.y, bounds);
      if (handle) {
        canvas.style.cursor = getCursorForHandle(handle, 0);
        return;
      }
    }
  }

  // Check single element handles
  if (state.selectedIds.length === 1) {
    const selected = selectedElements[0];
    if (selected) {
      const adjustedElement = getElementWithCanvasPos(selected);
      const handle = getHandleAtPoint(pos.x, pos.y, adjustedElement);
      if (handle) {
        canvas.style.cursor = getCursorForHandle(handle, selected.rotation);
        return;
      }
    }
  }

  const hovered = getElementAtCanvasPoint(pos.x, pos.y);
  canvas.style.cursor = hovered ? 'move' : 'crosshair';
}

/**
 * Handle canvas mouse up
 */
function handleCanvasMouseUp() {
  const wasDragging = state.isDragging;
  state.isDragging = false;
  state.dragType = null;
  state.dragHandle = null;
  state.dragStartElements = null;
  state.dragStartBounds = null;
  state.dragStartAngle = 0;
  // Clear alignment guides when drag ends
  if (state.alignmentGuides.length > 0) {
    state.alignmentGuides = [];
    render();
  }
  // Auto-clone after drag/resize operations
  if (wasDragging) {
    releaseMovedFrames();
    autoCloneIfEnabled();
    render();
  }
}

// =============================================================================
// POINTER EVENT HANDLERS (Touch + Mouse unified)
// =============================================================================

/**
 * Calculate distance between two pointers (for pinch gesture)
 */
function getPointerDistance(pointers) {
  const pts = Array.from(pointers.values());
  if (pts.length < 2) return 0;
  // Use clientX/clientY for screen-space distance (works for both pointer and touch)
  const dx = (pts[1].clientX || pts[1].x) - (pts[0].clientX || pts[0].x);
  const dy = (pts[1].clientY || pts[1].y) - (pts[0].clientY || pts[0].y);
  return Math.hypot(dx, dy);
}

/**
 * Get the midpoint between two pointers (for pinch gesture)
 */
function getPointerMidpoint(pointers) {
  const pts = Array.from(pointers.values());
  if (pts.length < 2) return { x: 0, y: 0 };
  // Use clientX/clientY for screen-space position (works for both pointer and touch)
  const x0 = pts[0].clientX ?? pts[0].x;
  const y0 = pts[0].clientY ?? pts[0].y;
  const x1 = pts[1].clientX ?? pts[1].x;
  const y1 = pts[1].clientY ?? pts[1].y;
  return {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
  };
}

/**
 * Start long-press timer
 */
function startLongPressTimer(element, pos) {
  cancelLongPress();
  state.pointer.longPressTarget = element;
  state.pointer.longPressTriggered = false;
  state.pointer.longPressTimer = setTimeout(() => {
    state.pointer.longPressTriggered = true;
    handleLongPress(element, pos);
  }, TOUCH.LONG_PRESS_DURATION_MS);
}

/**
 * Cancel long-press timer
 */
function cancelLongPress() {
  if (state.pointer.longPressTimer) {
    clearTimeout(state.pointer.longPressTimer);
    state.pointer.longPressTimer = null;
  }
  state.pointer.longPressTarget = null;
}

/**
 * Handle long-press gesture
 * - On text element: trigger inline editing
 * - On other elements: open properties panel (mobile)
 */
function handleLongPress(element, pos) {
  if (!element) {
    // Long-press on empty area - no action
    return;
  }

  if (element.type === 'text') {
    // Start inline editing for text elements
    startInlineEdit(element.id);
  } else {
    // For other elements, ensure it's selected and show properties panel on mobile
    selectElement(element.id);
    // On mobile, the properties panel toggle is handled by the props-toggle button
    // but we can show it automatically on long-press
    const propsPanel = $('#props-panel');
    if (propsPanel && window.innerWidth < 768) {
      propsPanel.classList.remove('hidden');
    }
  }
}

/**
 * Check for double-tap gesture
 * Returns true if this is a double-tap
 */
function checkDoubleTap(pos) {
  const now = Date.now();
  const timeDelta = now - state.pointer.lastTapTime;
  const dx = pos.x - state.pointer.lastTapPos.x;
  const dy = pos.y - state.pointer.lastTapPos.y;
  const distance = Math.hypot(dx, dy);

  // Update last tap info
  state.pointer.lastTapTime = now;
  state.pointer.lastTapPos = { x: pos.x, y: pos.y };

  // Check if this qualifies as a double-tap
  return timeDelta < TOUCH.DOUBLE_TAP_DELAY_MS && distance < TOUCH.LONG_PRESS_MOVE_TOLERANCE;
}

/**
 * Start two-finger gesture
 */
function startPinchGesture() {
  state.pointer.isPinching = true;
  state.pointer.isPanning = true;
  state.pointer.gestureMode = null;  // Will be set on first significant movement
  state.pointer.pinchStartDistance = getPointerDistance(state.pointer.pointers);
  state.pointer.pinchStartZoom = state.zoom;
  state.pointer.lastDistance = state.pointer.pinchStartDistance;
  state.pointer.panStartMidpoint = getPointerMidpoint(state.pointer.pointers);
  state.pointer.lastMidpoint = { ...state.pointer.panStartMidpoint };
  state.pointer.panStartOffset = { ...state.panOffset };
}

/**
 * Handle two-finger move - zoom OR pan based on movement type
 */
function handlePinchMove() {
  const currentDistance = getPointerDistance(state.pointer.pointers);
  const currentMidpoint = getPointerMidpoint(state.pointer.pointers);

  // Calculate how much distance changed vs how much midpoint moved
  const distanceChange = Math.abs(currentDistance - state.pointer.lastDistance);
  const midpointDelta = Math.hypot(
    currentMidpoint.x - state.pointer.lastMidpoint.x,
    currentMidpoint.y - state.pointer.lastMidpoint.y
  );

  // Determine gesture type if not yet locked
  if (!state.pointer.gestureMode) {
    // Need some minimum movement to decide
    if (distanceChange > 5 || midpointDelta > 5) {
      // If distance is changing more than midpoint is moving, it's a zoom
      // If midpoint is moving more than distance is changing, it's a pan
      if (distanceChange > midpointDelta * 1.5) {
        state.pointer.gestureMode = 'zoom';
      } else if (midpointDelta > distanceChange * 1.5) {
        state.pointer.gestureMode = 'pan';
      }
    }
  }

  // Handle zoom (pinch)
  if (state.pointer.gestureMode === 'zoom' || !state.pointer.gestureMode) {
    if (state.pointer.gestureMode === 'zoom' && state.pointer.pinchStartDistance >= 10) {
      const scale = currentDistance / state.pointer.pinchStartDistance;
      let newZoom = state.pointer.pinchStartZoom * scale;

      newZoom = Math.max(ZOOM.MIN, Math.min(ZOOM.MAX, newZoom));
      newZoom = Math.round(newZoom * 20) / 20;

      if (newZoom !== state.zoom) {
        state.zoom = newZoom;
        updateZoom();
      }
    }
  }

  // Handle pan (two-finger drag)
  if (state.pointer.gestureMode === 'pan') {
    const deltaX = currentMidpoint.x - state.pointer.panStartMidpoint.x;
    const deltaY = currentMidpoint.y - state.pointer.panStartMidpoint.y;

    state.panOffset.x = state.pointer.panStartOffset.x + deltaX;
    state.panOffset.y = state.pointer.panStartOffset.y + deltaY;

    applyPanOffset();
  }

  // Update last values for next frame
  state.pointer.lastDistance = currentDistance;
  state.pointer.lastMidpoint = { ...currentMidpoint };
}

/**
 * End two-finger gesture
 */
function endPinchGesture() {
  state.pointer.isPinching = false;
  state.pointer.isPanning = false;
  state.pointer.gestureMode = null;
  state.pointer.pinchStartDistance = 0;
  state.pointer.pinchStartZoom = 1;
  state.pointer.panStartMidpoint = null;
  state.pointer.lastDistance = 0;
  state.pointer.lastMidpoint = null;
}

/**
 * Apply pan offset to canvas container via CSS transform
 */
function applyPanOffset() {
  const container = $('#canvas-container');
  if (container) {
    container.style.transform = `translate(${state.panOffset.x}px, ${state.panOffset.y}px)`;
  }
}

/**
 * Reset pan offset to center
 */
function resetPanOffset() {
  state.panOffset = { x: 0, y: 0 };
  applyPanOffset();
}

/**
 * Handle canvas pointer down (unified touch/mouse)
 */
function handleCanvasPointerDown(e) {
  // Skip if touch events are handling this (prevents double-handling on iOS)
  if (state.pointer.usingTouch && e.pointerType === 'touch') {
    return;
  }

  // Prevent default to stop iOS Safari from scrolling/zooming
  e.preventDefault();

  const canvas = state.renderer.canvas;

  // Capture pointer for reliable tracking on iOS Safari
  if (e.pointerType === 'touch') {
    canvas.setPointerCapture(e.pointerId);
  }

  // Track this pointer (raw coordinates for pinch)
  state.pointer.pointers.set(e.pointerId, {
    clientX: e.clientX,
    clientY: e.clientY,
  });

  // Check for pinch gesture (two fingers)
  if (state.pointer.pointers.size === 2) {
    cancelLongPress();
    startPinchGesture();
    return;
  }

  // For single pointer, continue with normal handling
  if (state.pointer.pointers.size > 2) {
    return; // Ignore 3+ finger gestures
  }

  // Use getCanvasPos for correct coordinate calculation
  const pos = getCanvasPos(e);

  // If inline editing is active, clicking on canvas closes it
  if (state.editingTextId) {
    stopInlineEdit(true);
    return;
  }

  // In multi-label mode, check which zone was clicked and switch if needed
  if (state.multiLabel.enabled) {
    const { zoneIndex } = getZoneRelativePos(pos.x, pos.y);
    if (zoneIndex !== null && zoneIndex !== state.activeZone) {
      setActiveZone(zoneIndex);
    }
  }

  // Get element at click position for long-press handling
  const clickedElement = getElementAtCanvasPoint(pos.x, pos.y);

  // Start long-press timer for touch input
  if (e.pointerType === 'touch') {
    startLongPressTimer(clickedElement, pos);
  }

  // Continue with standard mouse-like handling
  const selectedElements = getSelectedElements();
  const isMultiSelect = state.selectedIds.length > 1;

  // For multi-selection or groups, check group bounding box handles first
  if (isMultiSelect || (selectedElements.length === 1 && selectedElements[0].groupId)) {
    const rawBounds = getMultiElementBounds(selectedElements);
    const bounds = selectedElements.length > 0
      ? getBoundsWithCanvasPos(rawBounds, selectedElements[0].zone || 0)
      : rawBounds;
    if (bounds) {
      const handle = getGroupHandleAtPoint(pos.x, pos.y, bounds, e.pointerType === 'touch');
      if (handle) {
        cancelLongPress();
        saveHistory();
        state.isDragging = true;
        state.dragStartX = pos.x;
        state.dragStartY = pos.y;
        state.dragStartElements = selectedElements.map(el => ({ ...el }));
        state.dragStartBounds = { ...rawBounds };

        if (handle === HandleType.ROTATE) {
          state.dragType = 'group-rotate';
          const angle = Math.atan2(pos.y - bounds.cy, pos.x - bounds.cx);
          state.dragStartAngle = (angle * 180) / Math.PI + 90;
        } else {
          state.dragType = 'group-resize';
          state.dragHandle = handle;
        }
        return;
      }
    }
  }

  // Single element: check individual handles
  if (state.selectedIds.length === 1) {
    const selected = selectedElements[0];
    if (selected) {
      const adjustedElement = getElementWithCanvasPos(selected);
      const handle = getHandleAtPoint(pos.x, pos.y, adjustedElement, e.pointerType === 'touch');
      if (handle) {
        cancelLongPress();
        saveHistory();
        state.isDragging = true;
        state.dragStartX = pos.x;
        state.dragStartY = pos.y;
        state.dragStartElements = [{ ...selected }];

        if (handle === HandleType.ROTATE) {
          state.dragType = 'rotate';
        } else {
          state.dragType = 'resize';
          state.dragHandle = handle;
        }
        return;
      }
    }
  }

  // Check if clicking on an element
  if (clickedElement) {
    // Shift+click toggles selection (not applicable to touch)
    if (e.shiftKey) {
      toggleElementSelection(clickedElement.id);
    } else {
      const alreadySelected = state.selectedIds.includes(clickedElement.id);
      if (!alreadySelected) {
        selectElement(clickedElement.id);
      }
    }

    // Start move drag for all selected elements
    const currentSelected = getSelectedElements();
    saveHistory();
    state.isDragging = true;
    state.dragType = currentSelected.length > 1 ? 'group-move' : 'move';
    state.dragStartX = pos.x;
    state.dragStartY = pos.y;
    state.dragStartElements = currentSelected.map(el => ({ ...el }));
    state.dragStartBounds = getMultiElementBounds(currentSelected);
    return;
  }

  // Clicked on empty area
  if (state.multiLabel.enabled) {
    const { zoneIndex } = getZoneRelativePos(pos.x, pos.y);
    if (zoneIndex === null) {
      deselect();
      return;
    }
  }

  deselect();
}

/**
 * Handle canvas pointer move (unified touch/mouse)
 */
function handleCanvasPointerMove(e) {
  // Skip if touch events are handling this
  if (state.pointer.usingTouch && e.pointerType === 'touch') {
    return;
  }

  // Prevent default to stop iOS Safari from scrolling
  if (e.pointerType === 'touch') {
    e.preventDefault();
  }

  const canvas = state.renderer.canvas;

  // Update pointer position (raw for pinch)
  if (state.pointer.pointers.has(e.pointerId)) {
    state.pointer.pointers.set(e.pointerId, {
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }

  // Handle pinch gesture
  if (state.pointer.isPinching && state.pointer.pointers.size === 2) {
    handlePinchMove();
    return;
  }

  // Use getCanvasPos for correct coordinates
  const pos = getCanvasPos(e);

  // Check if long-press should be cancelled due to movement
  if (state.pointer.longPressTimer && state.pointer.pointers.size === 1) {
    const dx = pos.x - state.dragStartX;
    const dy = pos.y - state.dragStartY;
    if (Math.hypot(dx, dy) > TOUCH.LONG_PRESS_MOVE_TOLERANCE) {
      cancelLongPress();
    }
  }

  if (state.isDragging && state.dragStartElements) {
    // Cancel long-press on any drag
    cancelLongPress();

    const dx = pos.x - state.dragStartX;
    const dy = pos.y - state.dragStartY;

    switch (state.dragType) {
      case 'move': {
        const el = state.dragStartElements[0];
        let newX = el.x + dx;
        let newY = el.y + dy;
        const snapResult = detectAlignmentGuides(
          { x: newX, y: newY, width: el.width, height: el.height },
          [el.id]
        );
        newX += snapResult.snapX;
        newY += snapResult.snapY;
        modifyElement(el.id, { x: newX, y: newY });
        state.alignmentGuides = snapResult.guides;
        break;
      }

      case 'group-move': {
        state.elements = moveElements(
          state.elements,
          state.dragStartElements.map(e => e.id),
          dx, dy
        );
        const movedElements = getSelectedElements();
        const groupBounds = getMultiElementBounds(movedElements);
        if (groupBounds) {
          const groupSnapResult = detectAlignmentGuides(
            { x: groupBounds.x, y: groupBounds.y, width: groupBounds.width, height: groupBounds.height },
            movedElements.map(e => e.id)
          );
          if (groupSnapResult.snapX !== 0 || groupSnapResult.snapY !== 0) {
            state.elements = moveElements(
              state.elements,
              movedElements.map(e => e.id),
              groupSnapResult.snapX, groupSnapResult.snapY
            );
          }
          state.alignmentGuides = groupSnapResult.guides;
        }
        state.dragStartElements = getSelectedElements().map(e => ({ ...e }));
        state.dragStartX = pos.x;
        state.dragStartY = pos.y;
        render();
        break;
      }

      case 'resize': {
        const resizeEl = state.dragStartElements[0];
        const isLockedImage = resizeEl.type === 'image' && resizeEl.lockAspectRatio !== false;
        const preserveAspect = isLockedImage ? !e.shiftKey : e.shiftKey;
        const newBounds = calculateResize(resizeEl, state.dragHandle, dx, dy, preserveAspect);
        modifyElement(resizeEl.id, constrainSize({ ...resizeEl, ...newBounds }));
        break;
      }

      case 'group-resize': {
        const { scaleX, scaleY } = calculateGroupResize(
          state.dragStartBounds,
          state.dragHandle,
          dx, dy,
          e.shiftKey
        );

        const isHorizontalSide = state.dragHandle === HandleType.E || state.dragHandle === HandleType.W;
        const isVerticalSide = state.dragHandle === HandleType.N || state.dragHandle === HandleType.S;

        const scaledElements = state.dragStartElements.map(origEl => {
          const elCx = origEl.x + origEl.width / 2;
          const elCy = origEl.y + origEl.height / 2;
          const centerX = state.dragStartBounds.cx;
          const centerY = state.dragStartBounds.cy;

          const effectiveScaleX = isVerticalSide ? 1 : scaleX;
          const effectiveScaleY = isHorizontalSide ? 1 : scaleY;

          const newCx = centerX + (elCx - centerX) * effectiveScaleX;
          const newCy = centerY + (elCy - centerY) * effectiveScaleY;

          const newWidth = Math.max(origEl.width * effectiveScaleX, ELEMENT.MIN_WIDTH);
          const newHeight = Math.max(origEl.height * effectiveScaleY, ELEMENT.MIN_HEIGHT);

          return {
            ...origEl,
            x: newCx - newWidth / 2,
            y: newCy - newHeight / 2,
            width: newWidth,
            height: newHeight,
          };
        });

        state.elements = state.elements.map(el => {
          const scaled = scaledElements.find(s => s.id === el.id);
          return scaled || el;
        });

        state.dragStartElements.forEach(el => state.renderer.clearCache(el.id));
        render();
        break;
      }

      case 'rotate': {
        const rotEl = state.dragStartElements[0];
        const adjustedRotEl = getElementWithCanvasPos(rotEl);
        let rotation = calculateRotation(adjustedRotEl, pos.x, pos.y);
        if (!e.shiftKey) {
          rotation = snapRotation(rotation);
        }
        modifyElement(rotEl.id, { rotation });
        break;
      }

      case 'group-rotate': {
        const adjustedBounds = getBoundsWithCanvasPos(state.dragStartBounds, state.dragStartElements[0]?.zone || 0);
        const currentAngle = Math.atan2(pos.y - adjustedBounds.cy, pos.x - adjustedBounds.cx);
        let angleDelta = ((currentAngle * 180) / Math.PI + 90) - state.dragStartAngle;
        if (!e.shiftKey) {
          angleDelta = snapRotation(angleDelta);
        }
        state.elements = rotateElements(
          state.elements,
          state.dragStartElements.map(e => e.id),
          angleDelta,
          { x: state.dragStartBounds.cx, y: state.dragStartBounds.cy }
        );
        state.dragStartAngle = (currentAngle * 180) / Math.PI + 90;
        state.dragStartElements = getSelectedElements().map(e => ({ ...e }));
        render();
        break;
      }
    }
    return;
  }

  // Update cursor based on what's under pointer (only for mouse)
  if (e.pointerType !== 'touch') {
    const selectedElements = getSelectedElements();
    const isMultiSelect = state.selectedIds.length > 1;

    if (isMultiSelect || (selectedElements.length === 1 && selectedElements[0].groupId)) {
      const rawBounds = getMultiElementBounds(selectedElements);
      const bounds = selectedElements.length > 0
        ? getBoundsWithCanvasPos(rawBounds, selectedElements[0].zone || 0)
        : rawBounds;
      if (bounds) {
        const handle = getGroupHandleAtPoint(pos.x, pos.y, bounds, false);
        if (handle) {
          canvas.style.cursor = getCursorForHandle(handle, 0);
          return;
        }
      }
    }

    if (state.selectedIds.length === 1) {
      const selected = selectedElements[0];
      if (selected) {
        const adjustedElement = getElementWithCanvasPos(selected);
        const handle = getHandleAtPoint(pos.x, pos.y, adjustedElement, false);
        if (handle) {
          canvas.style.cursor = getCursorForHandle(handle, selected.rotation);
          return;
        }
      }
    }

    const hovered = getElementAtCanvasPoint(pos.x, pos.y);
    canvas.style.cursor = hovered ? 'move' : 'crosshair';
  }
}

/**
 * Handle canvas pointer up (unified touch/mouse)
 */
function handleCanvasPointerUp(e) {
  // Skip if touch events are handling this
  if (state.pointer.usingTouch && e.pointerType === 'touch') {
    return;
  }

  const pos = getCanvasPos(e);

  // Cancel long-press
  cancelLongPress();

  // Remove this pointer
  state.pointer.pointers.delete(e.pointerId);

  // End pinch if we go below 2 fingers
  if (state.pointer.isPinching && state.pointer.pointers.size < 2) {
    endPinchGesture();
  }

  // Check for double-tap on touch (for inline text editing)
  if (e.pointerType === 'touch' && !state.isDragging) {
    if (checkDoubleTap(pos)) {
      const element = getElementAtCanvasPoint(pos.x, pos.y);
      if (element && element.type === 'text') {
        startInlineEdit(element.id);
        return;
      }
    }
  }

  // Standard drag end handling
  const wasDragging = state.isDragging;
  state.isDragging = false;
  state.dragType = null;
  state.dragHandle = null;
  state.dragStartElements = null;
  state.dragStartBounds = null;
  state.dragStartAngle = 0;

  if (state.alignmentGuides.length > 0) {
    state.alignmentGuides = [];
    render();
  }

  if (wasDragging) {
    releaseMovedFrames();
    autoCloneIfEnabled();
    render();
  }
}

/**
 * Handle canvas pointer cancel (touch interrupted)
 */
function handleCanvasPointerCancel(e) {
  cancelLongPress();
  state.pointer.pointers.delete(e.pointerId);

  if (state.pointer.isPinching && state.pointer.pointers.size < 2) {
    endPinchGesture();
  }

  // Reset drag state
  state.isDragging = false;
  state.dragType = null;
  state.dragHandle = null;
  state.dragStartElements = null;
  state.dragStartBounds = null;
  state.dragStartAngle = 0;

  if (state.alignmentGuides.length > 0) {
    state.alignmentGuides = [];
    render();
  }
}

// =============================================================================
// TOUCH EVENT HANDLERS (iOS Safari fallback)
// =============================================================================

/**
 * Convert touch to pointer-like event for iOS Safari
 */
function touchToPointerEvent(touch, type) {
  return {
    pointerId: touch.identifier,
    pointerType: 'touch',
    clientX: touch.clientX,
    clientY: touch.clientY,
    preventDefault: () => {},
    shiftKey: false,
  };
}

/**
 * Handle touch start (iOS Safari fallback)
 */
function handleCanvasTouchStart(e) {
  e.preventDefault();

  // Mark that we're using touch events (prevents pointer event double-handling)
  state.pointer.usingTouch = true;

  // Process all changed touches - store raw positions for pinch calculation
  for (const touch of e.changedTouches) {
    state.pointer.pointers.set(touch.identifier, {
      clientX: touch.clientX,
      clientY: touch.clientY,
    });
  }

  // Check for pinch gesture (two fingers)
  if (e.touches.length === 2) {
    cancelLongPress();
    startPinchGesture();
    return;
  }

  if (e.touches.length > 2) {
    return;
  }

  // Single touch - use getCanvasPos for correct coordinate calculation
  const touch = e.touches[0];
  const pos = getCanvasPos(touch);

  // If inline editing is active, clicking on canvas closes it
  if (state.editingTextId) {
    stopInlineEdit(true);
    return;
  }

  // In multi-label mode, check which zone was clicked
  if (state.multiLabel.enabled) {
    const { zoneIndex } = getZoneRelativePos(pos.x, pos.y);
    if (zoneIndex !== null && zoneIndex !== state.activeZone) {
      setActiveZone(zoneIndex);
    }
  }

  const clickedElement = getElementAtCanvasPoint(pos.x, pos.y);

  // Start long-press timer only if touching an element
  if (clickedElement) {
    startLongPressTimer(clickedElement, pos);
  }

  const selectedElements = getSelectedElements();
  const isMultiSelect = state.selectedIds.length > 1;

  // Check group handles
  if (isMultiSelect || (selectedElements.length === 1 && selectedElements[0].groupId)) {
    const rawBounds = getMultiElementBounds(selectedElements);
    const bounds = selectedElements.length > 0
      ? getBoundsWithCanvasPos(rawBounds, selectedElements[0].zone || 0)
      : rawBounds;
    if (bounds) {
      const handle = getGroupHandleAtPoint(pos.x, pos.y, bounds, true);
      if (handle) {
        cancelLongPress();
        saveHistory();
        state.isDragging = true;
        state.dragStartX = pos.x;
        state.dragStartY = pos.y;
        state.dragStartElements = selectedElements.map(el => ({ ...el }));
        state.dragStartBounds = { ...rawBounds };

        if (handle === HandleType.ROTATE) {
          state.dragType = 'group-rotate';
          const angle = Math.atan2(pos.y - bounds.cy, pos.x - bounds.cx);
          state.dragStartAngle = (angle * 180) / Math.PI + 90;
        } else {
          state.dragType = 'group-resize';
          state.dragHandle = handle;
        }
        return;
      }
    }
  }

  // Single element handles
  if (state.selectedIds.length === 1) {
    const selected = selectedElements[0];
    if (selected) {
      const adjustedElement = getElementWithCanvasPos(selected);
      const handle = getHandleAtPoint(pos.x, pos.y, adjustedElement, true);
      if (handle) {
        cancelLongPress();
        saveHistory();
        state.isDragging = true;
        state.dragStartX = pos.x;
        state.dragStartY = pos.y;
        state.dragStartElements = [{ ...selected }];

        if (handle === HandleType.ROTATE) {
          state.dragType = 'rotate';
        } else {
          state.dragType = 'resize';
          state.dragHandle = handle;
        }
        return;
      }
    }
  }

  // Check if touching an element
  if (clickedElement) {
    const alreadySelected = state.selectedIds.includes(clickedElement.id);
    if (!alreadySelected) {
      selectElement(clickedElement.id);
    }

    const currentSelected = getSelectedElements();
    saveHistory();
    state.isDragging = true;
    state.dragType = currentSelected.length > 1 ? 'group-move' : 'move';
    state.dragStartX = pos.x;
    state.dragStartY = pos.y;
    state.dragStartElements = currentSelected.map(el => ({ ...el }));
    state.dragStartBounds = getMultiElementBounds(currentSelected);
    return;
  }

  // Touched empty area
  if (state.multiLabel.enabled) {
    const { zoneIndex } = getZoneRelativePos(pos.x, pos.y);
    if (zoneIndex === null) {
      deselect();
      return;
    }
  }

  deselect();
}

/**
 * Handle touch move (iOS Safari fallback)
 */
function handleCanvasTouchMove(e) {
  e.preventDefault();

  // Update all touch positions (raw for pinch calculation)
  for (const touch of e.touches) {
    state.pointer.pointers.set(touch.identifier, {
      clientX: touch.clientX,
      clientY: touch.clientY,
    });
  }

  // Handle pinch
  if (state.pointer.isPinching && e.touches.length === 2) {
    handlePinchMove();
    return;
  }

  // Cancel long-press if moved
  if (state.pointer.longPressTimer && e.touches.length === 1) {
    const touch = e.touches[0];
    const pos = getCanvasPos(touch);
    const dx = pos.x - state.dragStartX;
    const dy = pos.y - state.dragStartY;
    if (Math.hypot(dx, dy) > TOUCH.LONG_PRESS_MOVE_TOLERANCE) {
      cancelLongPress();
    }
  }

  if (!state.isDragging || !state.dragStartElements || e.touches.length !== 1) {
    return;
  }

  const touch = e.touches[0];
  const pos = getCanvasPos(touch);

  const dx = pos.x - state.dragStartX;
  const dy = pos.y - state.dragStartY;

  switch (state.dragType) {
    case 'move': {
      const el = state.dragStartElements[0];
      let newX = el.x + dx;
      let newY = el.y + dy;
      const snapResult = detectAlignmentGuides(
        { x: newX, y: newY, width: el.width, height: el.height },
        [el.id]
      );
      newX += snapResult.snapX;
      newY += snapResult.snapY;
      modifyElement(el.id, { x: newX, y: newY });
      state.alignmentGuides = snapResult.guides;
      break;
    }

    case 'group-move': {
      state.elements = moveElements(
        state.elements,
        state.dragStartElements.map(e => e.id),
        dx, dy
      );
      const movedElements = getSelectedElements();
      const groupBounds = getMultiElementBounds(movedElements);
      if (groupBounds) {
        const groupSnapResult = detectAlignmentGuides(
          { x: groupBounds.x, y: groupBounds.y, width: groupBounds.width, height: groupBounds.height },
          movedElements.map(e => e.id)
        );
        if (groupSnapResult.snapX !== 0 || groupSnapResult.snapY !== 0) {
          state.elements = moveElements(
            state.elements,
            movedElements.map(e => e.id),
            groupSnapResult.snapX, groupSnapResult.snapY
          );
        }
        state.alignmentGuides = groupSnapResult.guides;
      }
      state.dragStartElements = getSelectedElements().map(e => ({ ...e }));
      state.dragStartX = pos.x;
      state.dragStartY = pos.y;
      render();
      break;
    }

    case 'resize': {
      const resizeEl = state.dragStartElements[0];
      const isLockedImage = resizeEl.type === 'image' && resizeEl.lockAspectRatio !== false;
      const newBounds = calculateResize(resizeEl, state.dragHandle, dx, dy, isLockedImage);
      modifyElement(resizeEl.id, constrainSize({ ...resizeEl, ...newBounds }));
      break;
    }

    case 'group-resize': {
      const { scaleX, scaleY } = calculateGroupResize(
        state.dragStartBounds,
        state.dragHandle,
        dx, dy,
        false
      );

      const isHorizontalSide = state.dragHandle === HandleType.E || state.dragHandle === HandleType.W;
      const isVerticalSide = state.dragHandle === HandleType.N || state.dragHandle === HandleType.S;

      const scaledElements = state.dragStartElements.map(origEl => {
        const elCx = origEl.x + origEl.width / 2;
        const elCy = origEl.y + origEl.height / 2;
        const centerX = state.dragStartBounds.cx;
        const centerY = state.dragStartBounds.cy;

        const effectiveScaleX = isVerticalSide ? 1 : scaleX;
        const effectiveScaleY = isHorizontalSide ? 1 : scaleY;

        const newCx = centerX + (elCx - centerX) * effectiveScaleX;
        const newCy = centerY + (elCy - centerY) * effectiveScaleY;

        const newWidth = Math.max(origEl.width * effectiveScaleX, ELEMENT.MIN_WIDTH);
        const newHeight = Math.max(origEl.height * effectiveScaleY, ELEMENT.MIN_HEIGHT);

        return {
          ...origEl,
          x: newCx - newWidth / 2,
          y: newCy - newHeight / 2,
          width: newWidth,
          height: newHeight,
        };
      });

      state.elements = state.elements.map(el => {
        const scaled = scaledElements.find(s => s.id === el.id);
        return scaled || el;
      });

      state.dragStartElements.forEach(el => state.renderer.clearCache(el.id));
      render();
      break;
    }

    case 'rotate': {
      const rotEl = state.dragStartElements[0];
      const adjustedRotEl = getElementWithCanvasPos(rotEl);
      let rotation = calculateRotation(adjustedRotEl, pos.x, pos.y);
      rotation = snapRotation(rotation);
      modifyElement(rotEl.id, { rotation });
      break;
    }

    case 'group-rotate': {
      const adjustedBounds = getBoundsWithCanvasPos(state.dragStartBounds, state.dragStartElements[0]?.zone || 0);
      const currentAngle = Math.atan2(pos.y - adjustedBounds.cy, pos.x - adjustedBounds.cx);
      let angleDelta = ((currentAngle * 180) / Math.PI + 90) - state.dragStartAngle;
      angleDelta = snapRotation(angleDelta);
      state.elements = rotateElements(
        state.elements,
        state.dragStartElements.map(e => e.id),
        angleDelta,
        { x: state.dragStartBounds.cx, y: state.dragStartBounds.cy }
      );
      state.dragStartAngle = (currentAngle * 180) / Math.PI + 90;
      state.dragStartElements = getSelectedElements().map(e => ({ ...e }));
      render();
      break;
    }
  }
}

/**
 * Handle touch end (iOS Safari fallback)
 */
function handleCanvasTouchEnd(e) {
  e.preventDefault();

  // Get position from changed touches before cleanup
  let pos = { x: 0, y: 0 };
  if (e.changedTouches.length > 0) {
    pos = getCanvasPos(e.changedTouches[0]);
  }

  cancelLongPress();

  // Remove ended touches
  for (const touch of e.changedTouches) {
    state.pointer.pointers.delete(touch.identifier);
  }

  // End pinch if needed
  if (state.pointer.isPinching && e.touches.length < 2) {
    endPinchGesture();
  }

  // Standard drag end - but first check if user actually moved or just tapped
  const wasDragging = state.isDragging;
  const actuallyMoved = wasDragging && state.dragStartX !== undefined &&
    (Math.abs(pos.x - state.dragStartX) > 5 || Math.abs(pos.y - state.dragStartY) > 5);

  // Check for double-tap (only if didn't actually drag/move)
  if (!actuallyMoved && e.touches.length === 0) {
    if (checkDoubleTap(pos)) {
      const element = getElementAtCanvasPoint(pos.x, pos.y);
      if (element) {
        // On mobile, open properties panel for any element type
        if (state.mobile.isMobile) {
          selectElement(element.id);
          openMobileProps();
          // Reset drag state
          state.isDragging = false;
          state.dragType = null;
          state.dragHandle = null;
          state.dragStartElements = null;
          return;
        }
        // On desktop, only inline edit for text
        if (element.type === 'text') {
          startInlineEdit(element.id);
          return;
        }
      }
    }
  }
  state.isDragging = false;
  state.dragType = null;
  state.dragHandle = null;
  state.dragStartElements = null;
  state.dragStartBounds = null;
  state.dragStartAngle = 0;

  if (state.alignmentGuides.length > 0) {
    state.alignmentGuides = [];
    render();
  }

  if (wasDragging) {
    releaseMovedFrames();
    autoCloneIfEnabled();
    render();
  }
}

/**
 * Handle touch cancel (iOS Safari fallback)
 */
function handleCanvasTouchCancel(e) {
  e.preventDefault();
  cancelLongPress();

  // Clear all touches
  for (const touch of e.changedTouches) {
    state.pointer.pointers.delete(touch.identifier);
  }

  if (state.pointer.isPinching) {
    endPinchGesture();
  }

  state.isDragging = false;
  state.dragType = null;
  state.dragHandle = null;
  state.dragStartElements = null;
  state.dragStartBounds = null;
  state.dragStartAngle = 0;

  if (state.alignmentGuides.length > 0) {
    state.alignmentGuides = [];
    render();
  }
}

/**
 * Add a new text element
 */
function addTextElement() {
  saveHistory();
  const dims = state.renderer.getSingleLabelDimensions();
  const element = createTextElement(t('new_text'), {
    x: dims.width / 2 - 75,
    y: dims.height / 2 - 20,
    width: 150,
    height: 40,
    zone: state.activeZone,
  });
  state.elements.push(element);
  autoCloneIfEnabled();
  selectElement(element.id);
  setStatus(t('status_text_added'));

  // Start inline editing immediately so user can type
  setTimeout(() => startInlineEdit(element.id), 50);
}

/**
 * Add a new image element
 */
async function addImageElement(file) {
  // Validate file at function boundary
  const validation = validateImageFile(file);
  if (!validation.valid) {
    setStatus(validation.error);
    return;
  }

  try {
    const isPDF = file.type === 'application/pdf';
    const { dataUrl, width, height } = isPDF
      ? await state.renderer.loadPDFFile(file)
      : await state.renderer.loadImageFile(file);

    // Use native size if it fits, otherwise scale down to fit
    const dims = state.renderer.getSingleLabelDimensions();
    const maxWidth = dims.width * 0.95;   // Leave small margin
    const maxHeight = dims.height * 0.95;

    // Only scale down if needed (scale <= 1), never scale up
    const scale = Math.min(maxWidth / width, maxHeight / height, 1);
    const scaledW = width * scale;
    const scaledH = height * scale;

    const element = createImageElement(dataUrl, {
      x: (dims.width - scaledW) / 2,
      y: (dims.height - scaledH) / 2,
      width: scaledW,
      height: scaledH,
      naturalWidth: width,
      naturalHeight: height,
      zone: state.activeZone,
    });

    saveHistory();
    state.elements.push(element);
    autoCloneIfEnabled();
    selectElement(element.id);
    setStatus(scale < 1 ? t('status_image_scaled', { percent: Math.round(scale * 100) }) : (isPDF ? t('status_pdf_imported') : t('status_image_added')));
  } catch (e) {
    logError(e, 'addImageElement');
    setStatus(file.type === 'application/pdf' ? t('status_pdf_load_failed') : t('status_image_load_failed'));
  }
}

/**
 * Add a new barcode element
 */
function addBarcodeElement() {
  saveHistory();
  const dims = state.renderer.getSingleLabelDimensions();
  const element = createBarcodeElement('123456789012', {
    x: dims.width / 2 - 90,
    y: dims.height / 2 - 40,
    width: 180,
    height: 80,
    zone: state.activeZone,
  });
  state.elements.push(element);
  autoCloneIfEnabled();
  selectElement(element.id);
  setStatus(t('status_barcode_added'));
}

/**
 * Add a new QR element
 */
function addQRElement() {
  saveHistory();
  const dims = state.renderer.getSingleLabelDimensions();
  const size = Math.min(dims.width, dims.height) * 0.5;
  const element = createQRElement('https://example.com', {
    x: (dims.width - size) / 2,
    y: (dims.height - size) / 2,
    width: size,
    height: size,
    zone: state.activeZone,
  });
  state.elements.push(element);
  autoCloneIfEnabled();
  selectElement(element.id);
  setStatus(t('status_qr_added'));
}

/**
 * Add shape element
 */
function addShapeElement(shapeType = 'rectangle') {
  saveHistory();
  const dims = state.renderer.getSingleLabelDimensions();
  const width = shapeType === 'line' ? 100 : 80;
  const height = shapeType === 'line' ? 4 : 60;
  const element = createShapeElement(shapeType, {
    x: dims.width / 2 - width / 2,
    y: dims.height / 2 - height / 2,
    width: width,
    height: height,
    strokeWidth: shapeType === 'line' ? 3 : 2,
    zone: state.activeZone,
  });
  state.elements.push(element);
  autoCloneIfEnabled();
  selectElement(element.id);
  setStatus(t('status_shape_added', { shape: shapeName(shapeType) }));
}

// ---------------------------------------------------------------------------
// #26 画像のトリミング・反転
// ---------------------------------------------------------------------------

/**
 * ミラー配置を変える(mirror.js)。axis が空ならオフ。
 * orient を省いたとき: 折る向きが今と同じなら今の向き、オンにした・折る向きを変えたときはその折り方の既定
 */
function setElementMirror(id, axis, orient) {
  const element = state.elements.find(e => e.id === id);
  if (!element) return;
  const current = normalizeMirror(element.mirror);
  const next = axis
    ? normalizeMirror({ axis, orient: orient || (current?.axis === axis ? current.orient : defaultOrientFor(axis)) })
    : null;
  if (JSON.stringify(current) === JSON.stringify(next)) return;
  saveHistory();
  modifyElement(id, { mirror: next });
  refreshMobilePropsIfOpen();
  if (!current !== !next) setStatus(t(next ? 'status_mirror_on' : 'status_mirror_off'));
}

/** ミラー配置の選択欄を要素の値にそろえる */
function syncMirrorControls(axisSelect, orientSelect, element) {
  if (!axisSelect || !orientSelect) return;
  const m = normalizeMirror(element.mirror);
  axisSelect.value = m ? m.axis : '';
  orientSelect.value = m ? m.orient : DEFAULT_MIRROR.orient;
  orientSelect.disabled = !m;
  orientSelect.classList.toggle('opacity-50', !m);
}

/** 選んでいる画像を反転する(key は 'flipX' か 'flipY') */
function toggleImageFlip(id, key) {
  const element = state.elements.find(e => e.id === id);
  if (!element || element.type !== 'image') return;
  saveHistory();
  modifyElement(id, { [key]: !element[key] });
  updatePropertiesPanel();
  refreshMobilePropsIfOpen();
  const on = !element[key];
  setStatus(t(key === 'flipX' ? (on ? 'status_flip_x_on' : 'status_flip_x_off') : (on ? 'status_flip_y_on' : 'status_flip_y_off')));
}

/**
 * 切り抜き範囲を変える。拡大率は保ったまま、要素の大きさを切り抜いた形に合わせる
 * (中心の位置は動かさない)
 */
function applyImageCrop(id, crop) {
  const element = state.elements.find(e => e.id === id);
  if (!element || element.type !== 'image') return;
  const next = normalizeCrop(crop);
  if (JSON.stringify(normalizeCrop(element.crop)) === JSON.stringify(next)) return;
  const oldBase = getImageBaseSize(element);
  const newBase = getImageBaseSize({ ...element, crop: next });
  const width = Math.max(4, newBase.width * (element.width / oldBase.width));
  const height = Math.max(4, newBase.height * (element.height / oldBase.height));
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  saveHistory();
  modifyElement(id, { crop: next, width, height, x: cx - width / 2, y: cy - height / 2 });
  updatePropertiesPanel();
  refreshMobilePropsIfOpen();
  setStatus(next ? t('status_cropped') : t('status_crop_removed'));
}

/** トリミング画面を開き、決定したら反映する */
async function openImageCrop(id) {
  const element = state.elements.find(e => e.id === id);
  if (!element || element.type !== 'image' || !element.imageData) return;
  const dims = state.renderer.getSingleLabelDimensions();
  const result = await openCropDialog({
    imageData: element.imageData,
    crop: element.crop,
    flipX: element.flipX,
    flipY: element.flipY,
    labelAspect: dims.width / dims.height,
  });
  if (result) applyImageCrop(id, result.crop);
}

/**
 * トリミングしている画像は、切り抜いた範囲だけの画像(data URL)にする。
 * 反転は表示のときにかかるので、ここでは反転前の画像のまま切り抜く
 */
async function cropImageDataUrl(element) {
  const crop = normalizeCrop(element.crop);
  if (!crop) return element.imageData;
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('image load failed'));
    im.src = element.imageData;
  });
  const { sx, sy, sw, sh } = getImageSourceRect(element, img.naturalWidth, img.naturalHeight);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw));
  c.height = Math.max(1, Math.round(sh));
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/**
 * 「AIで白黒に」の画面を開き、決定したら画像を差し替える。
 * トリミングしている画像は、切り抜いた範囲だけを加工し、その範囲を新しい画像にする
 * (トリミングは解除される。外側はもう無いので、あとから範囲を広げることはできない)。
 * 拡大率が変わらないよう、naturalWidth/Height は加工前の見かけの大きさにそろえる。
 * 線の加工は白黒にしてあるので、ディザは「なし(しきい値)」にする
 */
async function openAiBinarize(id) {
  const element = state.elements.find(e => e.id === id);
  if (!element || element.type !== 'image' || !element.imageData) return;
  const cropped = !!normalizeCrop(element.crop);
  let source;
  try {
    source = await cropImageDataUrl(element);
  } catch {
    setStatus(t('aibw_err_image'));
    return;
  }
  const result = await openAiBinarizeDialog({ imageData: source, cropped });
  if (!result) return;
  const current = state.elements.find(e => e.id === id);
  if (!current || current.imageData !== element.imageData) return;
  const base = getImageBaseSize(current);
  saveHistory();
  const changes = {
    imageData: result.imageData,
    crop: null,
    naturalWidth: base.width,
    naturalHeight: base.height,
  };
  if (result.lineMode) changes.dither = 'none';
  modifyElement(id, changes);
  updatePropertiesPanel();
  refreshMobilePropsIfOpen();
  setStatus(t('status_aibw_applied'));
}

/** #24 字間・曲線文字のパネルに渡すもの */
const textStyleCtx = {
  getSelected: () => getSelected(),
  modifyElement: (id, changes) => modifyElement(id, changes),
  saveHistory: () => saveHistory(),
  getLabelDims: () => state.renderer.getSingleLabelDimensions(),
  refresh: () => { updatePropertiesPanel(); refreshMobilePropsIfOpen(); },
  setStatus: (msg) => setStatus(msg),
};

/** スマホのプロパティシートが開いていれば作り直す */
function refreshMobilePropsIfOpen() {
  const panel = document.getElementById('mobile-props-panel');
  if (panel && panel.classList.contains('props-open')) {
    populateMobileProps();
  }
}

/**
 * 素材パネル(#27)から選んだ素材を、画像要素として追加する
 */
function addAssetImage({ dataUrl, width, height, name, assetId }) {
  const dims = state.renderer.getSingleLabelDimensions();
  // 仮決め: ラベルの短い辺の半分の大きさで、真ん中に置く(ASSET_DEFAULTS.sizeRatio)
  const target = Math.min(dims.width, dims.height) * ASSET_DEFAULTS.sizeRatio;
  const scale = target / Math.max(width, height);
  const w = Math.max(8, Math.round(width * scale));
  const h = Math.max(8, Math.round(height * scale));
  const element = createImageElement(dataUrl, {
    x: (dims.width - w) / 2,
    y: (dims.height - h) / 2,
    width: w,
    height: h,
    naturalWidth: w,
    naturalHeight: h,
    zone: state.activeZone,
  });
  element.assetId = assetId;
  saveHistory();
  state.elements.push(element);
  autoCloneIfEnabled();
  selectElement(element.id);
  setStatus(t('status_asset_added', { name }));
}

/**
 * 枠(#28)を追加する。ほかの要素の下に敷きたいので、いちばん後ろに入れる
 */
function addFrameElement(frameStyle) {
  const dims = state.renderer.getSingleLabelDimensions();
  const element = createFrameElement({
    frameStyle,
    frameShape: state.renderer.isRound ? 'ellipse' : 'rect',
    zone: state.activeZone,
  });
  Object.assign(element, frameGeometryForLabel(element, dims));
  saveHistory();
  state.elements.unshift(element);
  autoCloneIfEnabled();
  selectElement(element.id);
  const style = FRAME_STYLES.find(s => s.id === frameStyle);
  setStatus(t('status_frame_added', { name: style ? frameStyleName(style) : frameStyle }));
}

/**
 * 手で動かしたりサイズを変えたりした枠は、「ラベルに合わせる」を外す
 * (そのままだと、ラベルのサイズを変えたときに元の位置へ戻ってしまうため)
 */
function releaseMovedFrames() {
  const dims = state.renderer?.getSingleLabelDimensions();
  if (!dims) return;
  let released = false;
  for (const el of state.elements) {
    if (el.type !== 'frame' || !el.fitToLabel) continue;
    const g = frameGeometryForLabel(el, dims);
    const same = Math.abs(el.x - g.x) < 0.5 && Math.abs(el.y - g.y) < 0.5 &&
      Math.abs(el.width - g.width) < 0.5 && Math.abs(el.height - g.height) < 0.5 && !el.rotation;
    if (!same) {
      el.fitToLabel = false;
      released = true;
    }
  }
  if (released) updatePropertiesPanel();
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 「ラベルに合わせる」がオンの枠を、今のラベルの大きさに合わせ直す
 * @returns {boolean} 変わったものがあれば true
 */
function refitFramesToLabel({ syncShape = false } = {}) {
  if (!state.renderer || !Array.isArray(state.elements)) return false;
  const dims = state.renderer.getSingleLabelDimensions();
  if (!dims.width || !dims.height) return false;
  let changed = false;
  // 同じオブジェクトを書き換える(モバイルのプロパティ画面が要素を参照で持っているため)
  for (const el of state.elements) {
    if (el.type !== 'frame' || !el.fitToLabel) continue;
    if (syncShape) {
      const shape = state.renderer.isRound ? 'ellipse' : 'rect';
      if (el.frameShape !== shape) { el.frameShape = shape; changed = true; }
    }
    const g = frameGeometryForLabel(el, dims);
    if (el.x === g.x && el.y === g.y && el.width === g.width && el.height === g.height && !el.rotation) continue;
    Object.assign(el, g);
    changed = true;
  }
  return changed;
}

/**
 * Show printer model selection prompt for unrecognized devices
 * @param {string} deviceName - The connected device name
 */
function showPrinterModelPrompt(deviceName) {
  const dialog = $('#printer-model-prompt');
  if (!dialog) return;

  const select = $('#prompt-model-select');
  const confirmBtn = $('#prompt-model-confirm');

  // Reset state
  select.value = '';
  confirmBtn.disabled = true;
  $('#prompt-device-name').textContent = deviceName;

  // Store device name for confirm handler
  dialog._deviceName = deviceName;

  // Show dialog
  dialog.classList.remove('hidden');
}

// Wire up model prompt listeners on page load
function initPrinterModelPrompt() {
  const dialog = $('#printer-model-prompt');
  if (!dialog) return;

  const select = $('#prompt-model-select');
  const confirmBtn = $('#prompt-model-confirm');

  select.addEventListener('change', () => {
    confirmBtn.disabled = !select.value;
  });

  confirmBtn.addEventListener('click', () => {
    const model = select.value;
    const deviceName = dialog._deviceName || '';
    if (!model) return;

    // Save the mapping for this device
    if (deviceName) saveDeviceMapping(deviceName, model);

    // Update current print settings
    state.printSettings.printerModel = model;

    // Update status
    const modelDesc = getPrinterDescription(deviceName, model);
    setStatus(t('status_connected', { device: deviceName, model: modelDesc }));

    // Initialize tape width for tape printers
    if (isTapePrinter(deviceName, model)) {
      const savedTapeWidth = loadTapeWidthForDevice(deviceName);
      const defaultWidth = isA30Printer(deviceName, model) ? 15 : 12;
      state.tapeWidth = savedTapeWidth || defaultWidth;
      $('#tape-width').value = state.tapeWidth;
      $('#mobile-tape-width').value = state.tapeWidth;
    }

    // Update label sizes based on printer type
    updateLabelSizeDropdown(deviceName, model);
    updateLengthAdjustButtons();

    // Close dialog
    dialog.classList.add('hidden');
  });
}

/**
 * Handle connect button click
 * @param {MouseEvent} event - Click event (shift+click shows all devices)
 */
async function handleConnect(event) {
  // Check if printing is supported in this browser
  if (!state.canPrint) {
    alert(t('alert_printing_unavailable'));
    return;
  }

  // Shift+Click bypasses device filter to show all Bluetooth devices
  const showAllDevices = event?.shiftKey ?? false;
  if (showAllDevices) {
    console.log('Shift+Click detected: will show all Bluetooth devices');
  }

  const btn = $('#connect-btn');
  const originalText = btn.textContent;

  try {
    btn.disabled = true;
    btn.textContent = t('connecting');
    setStatus(showAllDevices ? t('status_select_printer_all') : t('status_select_printer'));

    const isBLE = state.connectionType === 'ble';

    if (isBLE) {
      if (!BLETransport.isAvailable()) {
        throw new Error(t('error_bluetooth_unsupported'));
      }
      state.transport = BLETransport.getShared();
    } else {
      if (!USBTransport.isAvailable()) {
        throw new Error(t('error_usb_unsupported'));
      }
      state.transport = USBTransport.getShared();
    }

    await state.transport.connect({ showAllDevices });

    if (!state.transport.isConnected()) {
      throw new Error(t('connection_failed'));
    }

    updateConnectionStatus(true);

    // Check device recognition and handle accordingly
    const deviceName = state.transport.getDeviceName?.() || '';
    const recognized = isDeviceRecognized(deviceName);
    const savedModel = getSavedDeviceModel(deviceName);
    const printerModel = state.printSettings.printerModel;

    // Determine effective model: auto-detect for recognized devices, else saved mapping > print settings
    let effectiveModel = printerModel;
    if (recognized) {
      // Device is recognized - use auto-detection (ignore saved model which may be outdated)
      effectiveModel = 'auto';
      state.printSettings.printerModel = 'auto';
      $('#printer-model').value = 'auto';  // Update dropdown to match
    } else if (savedModel && printerModel === 'auto') {
      // Unrecognized device with saved mapping - use saved model
      state.printSettings.printerModel = savedModel;
      effectiveModel = savedModel;
    }

    // Show detected/configured model in status
    const modelDesc = getPrinterDescription(deviceName, effectiveModel);
    if (recognized || savedModel || printerModel !== 'auto') {
      setStatus(t('status_connected', { device: deviceName, model: modelDesc }));
    } else {
      // Device not recognized and no saved preference - prompt user
      setStatus(t('status_connected_select_model', { device: deviceName }));
      showPrinterModelPrompt(deviceName);
    }

    // Initialize tape width for tape printers
    if (isTapePrinter(deviceName, effectiveModel)) {
      const savedTapeWidth = loadTapeWidthForDevice(deviceName);
      const defaultWidth = isA30Printer(deviceName, effectiveModel) ? 15 : 12;
      state.tapeWidth = savedTapeWidth || defaultWidth;
      $('#tape-width').value = state.tapeWidth;
      $('#mobile-tape-width').value = state.tapeWidth;
    }

    // Update label sizes based on printer type
    updateLabelSizeDropdown(deviceName, effectiveModel);
    updateLengthAdjustButtons();

    // Update printer info UI
    updatePrinterInfoUI(deviceName, effectiveModel);

    // Set up printer info callback and query status (BLE only)
    if (isBLE && state.transport.onPrinterInfo !== undefined) {
      state.transport.onPrinterInfo = updatePrinterInfoFromQuery;

      // Query printer info after a short delay
      setTimeout(async () => {
        try {
          await state.transport.queryAll();
        } catch (e) {
          console.warn('Failed to query printer info:', e.message);
        }
      }, 500);
    }

  } catch (error) {
    logError(error, 'handleConnect');
    setStatus(error.message || t('connection_failed'));
    btn.textContent = originalText;
    updateConnectionStatus(false);
  } finally {
    btn.disabled = false;
  }
}

/**
 * Handle print button click
 */
async function handlePrint() {
  const btn = $('#print-btn');
  const originalText = btn.textContent;
  const { density, copies, feed, printerModel } = state.printSettings;

  try {
    btn.disabled = true;

    if (!state.transport || !state.transport.isConnected()) {
      setStatus(t('connecting'));
      await handleConnect();

      if (!state.transport || !state.transport.isConnected()) {
        throw new Error(t('error_connect_first'));
      }
    }

    btn.textContent = t('printing');

    // Substitute template fields if template data is loaded
    // (キャンバスで行をプレビュー中なら、その行を印刷する)
    const elements = elementsWithValues(state.templateData.length > 0
      ? (mergePreviewRecord() || state.templateData[0])
      : null);

    // Render to raster (use raw format for rotated printers like D-series and P12)
    const deviceName = state.transport.getDeviceName?.() || '';
    const printerWidth = getPrinterWidthBytes(deviceName, printerModel);
    const printerDpi = getPrinterDpi(deviceName, printerModel);
    const printerAlignment = getPrinterAlignment(deviceName, printerModel);

    // 連番を使っているときは1枚ごとに描画し直す(番号が進むため)
    const usesCounter = hasCounter(elements);
    const labelsPerCopy = state.multiLabel.enabled ? state.multiLabel.labelsAcross : 1;

    const buildRaster = async (copyIndex) => {
      // Evaluate instant expressions (date/time, counter, etc.)
      const counterIndex = state.multiLabel.enabled
        ? (el) => counterIndexForLabel(copyIndex * labelsPerCopy + (el.zone || 0))
        : counterIndexForLabel(copyIndex);
      const elementsToRender = evaluateExpressions(elements, { counterIndex });
      // 未ロードのフォントで印刷しないよう待つ
      await waitForElementFonts(elementsToRender);
      // Force threshold mode for TSPL printers (shipping labels need crisp barcodes)
      // Auto-detection can incorrectly choose dithering due to anti-aliased edges
      let ditherMode = getDitherMode(elementsToRender);
      if (ditherMode === 'auto' && isTSPLPrinter(deviceName, printerModel)) {
        ditherMode = 'threshold';
        console.log('TSPL printer: forcing threshold mode for crisp barcodes');
      }
      return isRotatedPrinter(deviceName, printerModel)
        ? state.renderer.getRasterDataRaw(elementsToRender, ditherMode, currentPrintRotation())
        : state.renderer.getRasterData(elementsToRender, printerWidth, printerDpi, ditherMode, printerAlignment, currentPrintRotation());
    };

    let rasterData = await buildRaster(0);
    let printedCopies = 0;

    try {
    // Print multiple copies if requested
    for (let copy = 1; copy <= copies; copy++) {
      const copyText = copies > 1 ? ` (${copy}/${copies})` : '';
      setStatus(t('status_printing_copy', { copy: copyText }));

      if (usesCounter && copy > 1) {
        rasterData = await buildRaster(copy - 1);
      }

      await print(state.transport, rasterData, {
        isBLE: state.connectionType === 'ble',
        deviceName,
        printerModel,
        density,
        feed,
        continuous: !!(state.labelSize?.continuous),
        onProgress: (progress) => {
          btn.textContent = t('printing_progress', { progress });
          setStatus(t('status_printing_copy_progress', { copy: copyText, progress }));
        },
      });
      printedCopies++;

      // Small delay between copies
      if (copy < copies) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    } finally {
      if (usesCounter) advanceCounter(printedCopies * labelsPerCopy);
    }

    setStatus(copies > 1 ? t('status_printed_copies', { n: copies }) : t('status_print_complete'));
    btn.textContent = t('print');

  } catch (error) {
    logError(error, 'handlePrint');
    setStatus(error.message || t('print_failed'));
    btn.textContent = originalText;
  } finally {
    btn.disabled = false;
  }
}

/**
 * Show info dialog
 */
function showInfoDialog() {
  $('#info-dialog').classList.remove('hidden');
}

/**
 * Hide info dialog and mark as seen
 */
function hideInfoDialog() {
  $('#info-dialog').classList.add('hidden');
  safeStorageSet('phomymo_info_seen', 'true');
}

/**
 * Check if info dialog should show on first visit
 */
function shouldShowInfoOnLoad() {
  return !safeStorageGet('phomymo_info_seen');
}

/**
 * Show save dialog
 */
function showSaveDialog(opts = {}) {
  // ゲストモードでは保存しない(3.4)。ログインの案内を出す
  if (isGuest()) {
    showGuestNotice('save');
    return;
  }
  $('#save-dialog-title').textContent = opts.title || t('save_design');

  // 保存済みのデザインを開いて編集しているときは「上書き保存」と「別名で保存」を選べるようにする
  const editingName = getOverwritableDesignName();
  const overwriteSection = $('#save-overwrite-section');
  overwriteSection.classList.toggle('hidden', !editingName);
  overwriteSection.hidden = !editingName;
  $('#save-confirm').textContent = editingName ? t('save_as_new') : t('save');
  if (editingName) {
    $('#save-editing-note').textContent = t('save_editing_note', { name: editingName });
  }
  resetSaveNameExists();

  $('#save-dialog').classList.remove('hidden');
  $('#save-dialog').hidden = false;
  $('#save-name').value = '';
  if (editingName) {
    $('#save-name').placeholder = t('save_copy_name', { name: editingName });
    $('#save-overwrite').focus();
  } else {
    $('#save-name').placeholder = t('design_name');
    $('#save-name').focus();
  }
}

/**
 * 上書き保存できるデザイン名(保存済みのデザインを開いて編集中で、そのデザインがまだあるとき)。無ければ null
 */
function getOverwritableDesignName() {
  const name = state.currentDesignName;
  if (!name || !state.currentDesignSaved) return null;
  return loadDesign(name) ? name : null;
}

/** 同名のデザインがあるときの注意を消す */
function resetSaveNameExists() {
  const note = $('#save-name-exists');
  note.classList.add('hidden');
  note.hidden = true;
  delete note.dataset.name;
  const editing = !$('#save-overwrite-section').classList.contains('hidden');
  $('#save-confirm').textContent = editing ? t('save_as_new') : t('save');
}

/**
 * Hide save dialog
 */
function hideSaveDialog() {
  $('#save-dialog').classList.add('hidden');
  $('#save-dialog').hidden = true;
}

/**
 * Save current design
 */
function handleSave() {
  const nameValidation = validateDesignName($('#save-name').value);
  if (!nameValidation.valid) {
    setStatus(nameValidation.error);
    return;
  }
  const name = nameValidation.sanitized;

  // 別の(いま編集中ではない)デザインと同じ名前なら、黙って上書きせず一度確かめる
  const editingName = getOverwritableDesignName();
  const note = $('#save-name-exists');
  if (name !== editingName && loadDesign(name) && note.dataset.name !== name) {
    note.textContent = t('save_name_exists', { name });
    note.dataset.name = name;
    note.classList.remove('hidden');
    note.hidden = false;
    $('#save-confirm').textContent = t('overwrite_it');
    return;
  }

  writeCurrentDesign(name, name === editingName);
}

/**
 * いま編集中のデザインを、元の名前のまま上書き保存する
 */
function handleOverwriteSave() {
  const name = getOverwritableDesignName();
  if (!name) {
    // 保存のあいだに消えた(別の端末で消して同期された等)ときは名前を付けて保存に戻す
    showSaveDialog();
    return;
  }
  writeCurrentDesign(name, true);
}

/**
 * いまのデザインを name で保存する
 * @param {string} name
 * @param {boolean} overwrite - 編集中のデザインへの上書き保存か(メッセージだけが変わる)
 */
function writeCurrentDesign(name, overwrite) {
  try {
    const designData = {
      elements: state.elements,
      labelSize: state.labelSize,
    };

    // Include template data if present
    if (state.templateFields.length > 0) {
      designData.isTemplate = true;
      designData.templateFields = state.templateFields;
    }
    if (state.templateData.length > 0) {
      designData.templateData = state.templateData;
    }
    // デザインの変数
    const variables = normalizeVariables(state.variables);
    if (variables.length > 0) designData.variables = variables;

    // 連携した Googleスプレッドシート(次に開いたとき、同じシートから読み直す)
    const mergeSource = currentMergeSourceForSave();
    if (mergeSource) designData.mergeSource = mergeSource;

    // Include multi-label config if enabled
    if (state.multiLabel.enabled) {
      designData.multiLabel = { ...state.multiLabel };
    }

    // 連番の状態(前回の続きから振るためのもの)
    designData.counter = { ...state.counter };

    // 印刷時の回転(機体の既定に従うときは保存しない)
    if (state.printRotation !== ROTATION_FOLLOW_DEVICE) {
      designData.printRotation = state.printRotation;
    }

    saveDesign(name, designData);
    hideSaveDialog();

    // Update current design name and mobile display
    state.currentDesignName = name;
    state.currentDesignSaved = true;
    updateMobileLabelName();

    const templateInfo = state.templateData.length > 0
      ? t('with_n_data_records', { n: state.templateData.length })
      : '';
    setStatus(t(overwrite ? 'status_design_overwritten' : 'status_design_saved', { name, info: templateInfo }));
  } catch (e) {
    showToast(e.message, 'error');
    setStatus(e.message);
  }
}

/**
 * Show load dialog
 */
function showLoadDialog() {
  const designs = isGuest() ? [] : listDesigns();
  const listEl = $('#design-list');

  let headerHtml = '';
  if (isGuest()) {
    // ゲストモード(3.4): 保存したデザインは無い。ファイルからの読み込みとサンプルは使える
    headerHtml = `
      <div id="load-guest-notice" class="text-sm text-gray-500 text-center py-6 px-2">
        <p class="mb-3">${t('load_guest_notice_html')}</p>
        <button id="load-guest-login" class="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-sm">${t('about_signing_in')}</button>
      </div>`;
  } else if (designs.length === 0) {
    headerHtml = `<div class="text-sm text-gray-400 text-center py-8">${t('no_saved_designs')}</div>`;
  }

  // グリッド(サムネイル)/リスト表示とサンプルは design-gallery.js / samples.js
  renderDesignList(listEl, designs, {
    headerHtml,
    onHeaderRendered: (root) => {
      root.querySelector('#load-guest-login')?.addEventListener('click', () => {
        hideLoadDialog();
        showAccountDialog(t('account_reason_load'));
      });
    },
    getDesign: loadDesign,
    onOpen: (name) => handleLoad(name),
    onDelete: (name) => {
      if (confirm(t('confirm_delete_design', { name }))) {
        deleteDesign(name);
        showLoadDialog(); // Refresh list
        setStatus(t('status_design_deleted', { name }));
      }
    },
    samples: listSamples(),
    getSample: (id) => buildSampleDesign(id),
    onOpenSample: (id) => handleOpenSample(id),
    onViewChange: setLoadDialogWidth,
  });

  $('#load-dialog').classList.remove('hidden');
  $('#load-dialog').hidden = false;
}

/** グリッド表示のときはダイアログを広げる */
function setLoadDialogWidth(view) {
  const panel = $('#load-dialog-panel');
  if (!panel) return;
  panel.classList.toggle('w-96', view !== 'grid');
  panel.classList.toggle('load-dialog-wide', view === 'grid');
}

/**
 * Hide load dialog
 */
function hideLoadDialog() {
  $('#load-dialog').classList.add('hidden');
  $('#load-dialog').hidden = true;
}

/**
 * Export current design to file
 */
function handleExport() {
  if (state.elements.length === 0) {
    setStatus(t('status_nothing_to_export'));
    return;
  }

  // Build export data
  const exportData = {
    name: t('untitled_design'),
    version: 3, // Version 3 includes multi-label support
    elements: state.elements,
    labelSize: state.labelSize,
    exportedAt: new Date().toISOString(),
  };

  // Include template data if present
  if (state.templateFields.length > 0) {
    exportData.isTemplate = true;
    exportData.templateFields = state.templateFields;
  }
  if (state.templateData.length > 0) {
    exportData.templateData = state.templateData;
  }
  const exportVariables = normalizeVariables(state.variables);
  if (exportVariables.length > 0) exportData.variables = exportVariables;
  const exportSource = currentMergeSourceForSave();
  if (exportSource) exportData.mergeSource = exportSource;

  // Include multi-label config if enabled
  if (state.multiLabel.enabled) {
    exportData.multiLabel = { ...state.multiLabel };
  }

  // 印刷時の回転
  if (state.printRotation !== ROTATION_FOLLOW_DEVICE) {
    exportData.printRotation = state.printRotation;
  }

  // Create and download file
  const jsonString = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `phomymo-design-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setStatus(t('status_design_exported'));
}

/**
 * Export current design to PDF
 */
async function handleExportPDF() {
  if (state.elements.length === 0) {
    setStatus(t('status_nothing_to_export'));
    return;
  }

  // Evaluate expressions (date/time substitutions)
  const elementsToRender = evaluateExpressions(elementsWithValues(), { counterIndex: counterIndexForLabel(0) });
  await waitForElementFonts(elementsToRender);

  // Render to temporary canvas at high DPI for quality
  const scale = 4; // 4x scale for 300 DPI quality
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = state.renderer.labelWidth * scale;
  tempCanvas.height = state.renderer.labelHeight * scale;
  const tempCtx = tempCanvas.getContext('2d');

  // Scale context and fill white background
  tempCtx.scale(scale, scale);
  tempCtx.fillStyle = 'white';
  tempCtx.fillRect(0, 0, state.renderer.labelWidth, state.renderer.labelHeight);

  // Render elements (reuse existing render logic)
  state.renderer.renderAllToContext(tempCtx, elementsToRender, []);

  // Get label dimensions in mm
  const widthMm = state.labelSize.width;
  const heightMm = state.labelSize.height;

  // Create PDF with exact label dimensions
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: widthMm > heightMm ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [widthMm, heightMm]
  });

  // Add canvas as image to PDF
  const imgData = tempCanvas.toDataURL('image/png');
  pdf.addImage(imgData, 'PNG', 0, 0, widthMm, heightMm);

  // Download PDF
  const filename = state.currentDesignName
    ? `${state.currentDesignName}.pdf`
    : `label-${Date.now()}.pdf`;
  pdf.save(filename);

  setStatus(t('status_pdf_exported'));
}

/**
 * Export current design to PNG
 */
async function handleExportPNG() {
  if (state.elements.length === 0) {
    setStatus(t('status_nothing_to_export'));
    return;
  }

  const elementsToRender = evaluateExpressions(elementsWithValues(), { counterIndex: counterIndexForLabel(0) });
  await waitForElementFonts(elementsToRender);

  // Render at 4x scale for quality
  const scale = 4;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = state.renderer.labelWidth * scale;
  tempCanvas.height = state.renderer.labelHeight * scale;
  const tempCtx = tempCanvas.getContext('2d');

  tempCtx.scale(scale, scale);
  tempCtx.fillStyle = 'white';
  tempCtx.fillRect(0, 0, state.renderer.labelWidth, state.renderer.labelHeight);
  state.renderer.renderAllToContext(tempCtx, elementsToRender, []);

  // Download as PNG
  tempCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.currentDesignName
      ? `${state.currentDesignName}.png`
      : `label-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus(t('status_png_exported'));
  }, 'image/png');
}

/**
 * Import design from file
 */
function handleImportFile(file) {
  // Validate file at function boundary
  const validation = validateJSONFile(file);
  if (!validation.valid) {
    setStatus(validation.error);
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);

      // Validate the data
      if (!data.elements || !Array.isArray(data.elements)) {
        throw new Error(t('error_invalid_design_file'));
      }

      // Load the design
      state.elements = data.elements;

      // Load label size if present
      if (data.labelSize) {
        state.labelSize = data.labelSize;
        // Update the label size dropdown
        const sizeKey = data.labelSize.round
          ? `${data.labelSize.width}mm Round`
          : `${data.labelSize.width}x${data.labelSize.height}`;
        const select = $('#label-size');
        if (LABEL_SIZES[sizeKey]) {
          select.value = sizeKey;
          $('#custom-size').classList.add('hidden');
        } else {
          select.value = 'custom';
          $('#custom-size').classList.remove('hidden');
          $('#custom-width').value = data.labelSize.width;
          $('#custom-height').value = data.labelSize.height;
        }
      }

      // Load template data if present
      if (data.templateData && Array.isArray(data.templateData)) {
        state.templateData = data.templateData;
        state.selectedRecords = data.templateData.map((_, i) => i); // Select all by default
        state.templateColumns = columnsOfRecords(state.templateData);
        state.templateSheets = null;
        state.mergePreview = { enabled: false, row: 0 };
      }
      restoreTemplateSource(data.mergeSource);
      state.variables = normalizeVariables(data.variables);
      renderVariablesPanel();

      // Clear selection and update renderer
      state.selectedIds = [];
      state.renderer.setDimensions(state.labelSize.width, state.labelSize.height, state.zoom, state.labelSize.round || false);
      state.renderer.clearCache();
      resetHistory();
      updatePrintSize();
      updateToolbarState();
      updatePropertiesPanel();

      // Detect template fields from elements
      detectTemplateFields();

      render();
      hideLoadDialog();

      const name = data.name || t('imported_design');
      state.currentDesignName = name;
      state.currentDesignSaved = false;
      updateMobileLabelName();
      setStatus(t('status_imported', { name }));
    } catch (err) {
      logError(err, 'importDesign');
      setStatus(t('status_import_failed', { message: err.message }));
    }
  };
  reader.readAsText(file);
}

/**
 * Update elements list dropdown
 */
function updateElementsList() {
  const container = $('#elements-list');

  if (state.elements.length === 0) {
    container.innerHTML = `<div class="px-3 py-2 text-gray-400 text-center">${t('no_elements')}</div>`;
    return;
  }

  // Build list HTML - elements in z-order (bottom to top)
  const html = state.elements.map((el, index) => {
    const isSelected = state.selectedIds.includes(el.id);
    const icon = getElementIcon(el.type);
    const label = getElementLabel(el);
    const layerNum = index + 1;

    return `
      <button class="element-list-item w-full px-3 py-1.5 text-left hover:bg-gray-100 flex items-center gap-2 ${isSelected ? 'bg-blue-50 text-blue-700' : ''}"
              data-element-id="${el.id}">
        <span class="text-gray-400 text-xs w-4">${layerNum}</span>
        ${icon}
        <span class="flex-1 truncate">${escapeHtml(label)}</span>
        ${el.groupId ? '<span class="text-xs text-gray-400">G</span>' : ''}
      </button>
    `;
  }).reverse().join(''); // Reverse to show top layer first

  container.innerHTML = html;

  // Add click handlers
  container.querySelectorAll('.element-list-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.elementId;
      selectElement(id);
      $('#elements-dropdown').classList.add('hidden');
    });
  });
}

/**
 * Get icon SVG for element type
 */
function getElementIcon(type) {
  const icons = {
    text: '<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h8m-8 6h16"/></svg>',
    image: '<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>',
    barcode: '<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h2M4 12h2m10 0h2"/></svg>',
    qr: '<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h2M4 12h2m10 0h2"/></svg>',
    shape: '<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z"/></svg>',
    frame: '<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" stroke-width="2"/><rect x="6.5" y="7.5" width="11" height="9" rx="1" stroke-width="1.5" stroke-dasharray="2 2"/></svg>',
  };
  return icons[type] || icons.shape;
}

/**
 * Get label for element
 */
function getElementLabel(el) {
  switch (el.type) {
    case 'text':
      return el.text ? (el.text.substring(0, 20) + (el.text.length > 20 ? '...' : '')) : t('text');
    case 'image':
      return t('image');
    case 'barcode':
      return el.barcodeData ? `${t('barcode')}: ${el.barcodeData.substring(0, 10)}` : t('barcode');
    case 'qr':
      return el.qrData ? `QR: ${el.qrData.substring(0, 15)}` : t('qr_code');
    case 'shape':
      return shapeName(el.shapeType);
    case 'frame': {
      const style = FRAME_STYLES.find(s => s.id === el.frameStyle);
      return `${t('frame')}: ${style ? frameStyleName(style) : ''}`;
    }
    default:
      return t('element');
  }
}

/**
 * Load a design
 */
/**
 * サンプルを開く。保存はしないので「名前のないデザイン」として読み込む
 */
async function handleOpenSample(sampleId) {
  const sample = SAMPLES.find(x => x.id === sampleId);
  const design = await buildSampleDesign(sampleId);
  if (!sample || !design) return;
  handleLoad(null, design);
  setStatus(t('status_sample_opened', { name: sampleName(sample) }));
}

function handleLoad(name, sampleDesign = null) {
  const design = sampleDesign || loadDesign(name);
  if (!design) {
    setStatus(t('status_design_not_found'));
    return;
  }

  state.elements = design.elements || [];
  state.labelSize = design.labelSize || { width: 40, height: 30 };
  state.selectedIds = [];

  // Restore template data if present
  state.templateData = design.templateData || [];
  state.selectedRecords = state.templateData.map((_, i) => i); // Select all by default
  state.templateColumns = columnsOfRecords(state.templateData);
  state.templateSheets = null;
  state.mergePreview = { enabled: false, row: 0 };
  restoreTemplateSource(design.mergeSource);
  state.variables = normalizeVariables(design.variables);
  renderVariablesPanel();

  // 印刷時の回転を復元(無ければ機体の既定に従う)
  state.printRotation = normalizeDesignRotation(design.printRotation);

  // 連番の状態を復元
  state.counter = {
    resume: !!design.counter?.resume,
    next: Math.max(0, parseInt(design.counter?.next, 10) || 0),
  };

  // Restore multi-label config if present
  if (design.multiLabel && design.multiLabel.enabled) {
    state.multiLabel = { ...design.multiLabel };
    state.activeZone = 0;

    // Update label size dropdown to show multi-label
    const select = $('#label-size');
    select.value = 'multi-label';
    $('#custom-size').classList.add('hidden');

    // Apply multi-label dimensions
    state.renderer.setMultiLabelDimensions(
      state.multiLabel.labelWidth,
      state.multiLabel.labelHeight,
      state.multiLabel.labelsAcross,
      state.multiLabel.gapMm
    );
    state.renderer.setActiveZone(state.activeZone);
    updateZoneToolbar();
  } else {
    // Reset multi-label state
    state.multiLabel = {
      enabled: false,
      labelWidth: 10,
      labelHeight: 20,
      labelsAcross: 4,
      gapMm: 2,
      cloneMode: true,
    };
    state.activeZone = 0;
    state.renderer.disableMultiLabel();
    $('#zone-toolbar').classList.add('hidden');

    // Update label size dropdown
    const sizeKey = state.labelSize.round
      ? `${state.labelSize.width}mm Round`
      : `${state.labelSize.width}x${state.labelSize.height}`;
    const select = $('#label-size');
    if (LABEL_SIZES[sizeKey]) {
      select.value = sizeKey;
      $('#custom-size').classList.add('hidden');
    } else {
      select.value = 'custom';
      $('#custom-size').classList.remove('hidden');
      $('#custom-width').value = state.labelSize.width;
      $('#custom-height').value = state.labelSize.height;
    }

    state.renderer.setDimensions(state.labelSize.width, state.labelSize.height, state.zoom, state.labelSize.round || false);
  }

  state.renderer.clearCache();
  resetHistory();
  updatePrintSize();
  updateToolbarState();
  updatePropertiesPanel();

  // Detect template fields from loaded elements
  detectTemplateFields();

  // Set current design name and update mobile display
  state.currentDesignName = name;
  state.currentDesignSaved = !!name;
  updateMobileLabelName();

  render();

  hideLoadDialog();

  // Show status with template info
  const templateInfo = state.templateData.length > 0
    ? t('n_data_records_suffix', { n: state.templateData.length })
    : '';
  const multiLabelInfo = state.multiLabel.enabled
    ? ` [${t('n_up', { n: state.multiLabel.labelsAcross })}]`
    : '';
  setStatus(t('status_design_loaded', { name, info: `${templateInfo}${multiLabelInfo}` }));
}

/**
 * Handle keyboard shortcuts
 */
function handleKeyDown(e) {
  // Skip all shortcuts when inline text editing is active
  if (state.editingTextId) {
    return;
  }

  // Undo: Ctrl/Cmd + Z
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      undo();
      return;
    }
  }

  // Redo: Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y
  if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y')) {
    if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      redo();
      return;
    }
  }

  const selectedElements = getSelectedElements();
  const hasSelection = selectedElements.length > 0;

  // Delete key - delete all selected elements
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (hasSelection && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      saveHistory();
      const count = selectedElements.length;
      // Delete all selected elements and clear their cache
      state.selectedIds.forEach(id => {
        state.renderer.clearCache(id);
        state.elements = deleteElement(state.elements, id);
      });
      autoCloneIfEnabled();
      deselect();
      setStatus(count > 1 ? t('status_n_elements_deleted', { n: count }) : t('status_element_deleted'));
    }
  }

  // Arrow keys for nudging - move all selected elements
  if (hasSelection && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      let dx = 0, dy = 0;
      switch (e.key) {
        case 'ArrowUp': dy = -step; break;
        case 'ArrowDown': dy = step; break;
        case 'ArrowLeft': dx = -step; break;
        case 'ArrowRight': dx = step; break;
      }
      state.elements = moveElements(state.elements, state.selectedIds, dx, dy);
      autoCloneIfEnabled();
      render();
    }
  }

  // Escape to deselect or close modals
  if (e.key === 'Escape') {
    if ($('#shortcuts-modal').classList.contains('hidden') === false) {
      hideShortcutsModal();
    } else if ($('#info-dialog').classList.contains('hidden') === false) {
      hideInfoDialog();
    } else if ($('#save-dialog').classList.contains('hidden') === false) {
      hideSaveDialog();
    } else if ($('#load-dialog').classList.contains('hidden') === false) {
      hideLoadDialog();
    } else {
      deselect();
    }
  }

  // Ctrl/Cmd + D to duplicate
  if ((e.ctrlKey || e.metaKey) && e.key === 'd' && hasSelection) {
    e.preventDefault();
    saveHistory();
    // Duplicate all selected elements
    const newIds = [];
    selectedElements.forEach(el => {
      state.elements = duplicateElement(state.elements, el.id);
      newIds.push(state.elements[state.elements.length - 1].id);
    });
    autoCloneIfEnabled();
    state.selectedIds = newIds;
    updateToolbarState();
    render();
    setStatus(selectedElements.length > 1 ? t('status_n_elements_duplicated', { n: selectedElements.length }) : t('status_element_duplicated'));
  }

  // Ctrl/Cmd + G to group
  if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !e.shiftKey && selectedElements.length > 1) {
    e.preventDefault();
    handleGroup();
  }

  // Ctrl/Cmd + Shift + G to ungroup
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'G') {
    e.preventDefault();
    handleUngroup();
  }

  // Ctrl/Cmd + C to copy
  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && hasSelection) {
    if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      copyElements();
    }
  }

  // Ctrl/Cmd + V to paste — try clipboard image first, fall back to element paste
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      handlePaste();
    }
  }

  // ? to show keyboard shortcuts
  if (e.key === '?' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    showShortcutsModal();
  }
}

/**
 * Group selected elements
 */
function handleGroup() {
  const selectedElements = getSelectedElements();
  if (selectedElements.length < 2) {
    showToast(t('toast_select_two_to_group'), 'warning');
    return;
  }

  // Check if any are already grouped
  if (selectedElements.some(e => e.groupId)) {
    showToast(t('toast_already_grouped'), 'warning');
    return;
  }

  saveHistory();
  const result = groupElements(state.elements, state.selectedIds);
  state.elements = result.elements;
  render();
  updateToolbarState();
  showToast(t('status_elements_grouped'), 'success');
  setStatus(t('status_elements_grouped'));
}

/**
 * Ungroup selected elements
 */
function handleUngroup() {
  const selectedElements = getSelectedElements();
  const groupIds = new Set(selectedElements.map(e => e.groupId).filter(Boolean));

  if (groupIds.size === 0) {
    showToast(t('toast_no_groups'), 'warning');
    return;
  }

  saveHistory();
  // Ungroup all selected groups
  groupIds.forEach(groupId => {
    state.elements = ungroupElements(state.elements, groupId);
  });

  render();
  updateToolbarState();
  showToast(t('status_elements_ungrouped'), 'success');
  setStatus(t('status_elements_ungrouped'));
}

/**
 * Copy selected elements to clipboard
 */
function copyElements() {
  const selectedElements = getSelectedElements();
  if (selectedElements.length === 0) return;

  // Deep clone the elements
  state.clipboard = JSON.parse(JSON.stringify(selectedElements));
  showToast(t('toast_n_copied', { n: selectedElements.length }), 'success');
}

/**
 * Handle paste — try reading image from system clipboard, fall back to element paste
 */
async function handlePaste() {
  if (navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], 'pasted-image.png', { type: imageType });
          addImageElement(file);
          return;
        }
      }
    } catch (err) {
      // Clipboard API not available or permission denied
    }
  }
  pasteElements();
}

/**
 * Paste elements from clipboard
 */
function pasteElements() {
  if (state.clipboard.length === 0) {
    showToast(t('toast_nothing_to_paste'), 'warning');
    return;
  }

  saveHistory();

  // Offset pasted elements by 10px and set to active zone
  const newElements = state.clipboard.map(el => {
    const clone = JSON.parse(JSON.stringify(el));
    clone.id = 'el_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    clone.x += 10;
    clone.y += 10;
    clone.zone = state.activeZone; // Paste to active zone
    // Clear group id on paste
    delete clone.groupId;
    return clone;
  });

  state.elements.push(...newElements);
  autoCloneIfEnabled();
  state.selectedIds = newElements.map(el => el.id);

  render();
  updatePropertiesPanel();
  updateToolbarState();
  showToast(t('toast_n_pasted', { n: newElements.length }), 'success');
  setStatus(t('status_elements_pasted'));
}

/**
 * Show keyboard shortcuts modal
 */
function showShortcutsModal() {
  $('#shortcuts-modal').classList.remove('hidden');
}

/**
 * Hide keyboard shortcuts modal
 */
function hideShortcutsModal() {
  $('#shortcuts-modal').classList.add('hidden');
}

/**
 * Check browser compatibility
 */
function checkCompatibility() {
  const warnings = [];
  let canPrint = true;

  if (!window.isSecureContext) {
    warnings.push(t('compat_https_required'));
    canPrint = false;
  }

  if (!('bluetooth' in navigator)) {
    warnings.push(t('compat_no_web_bluetooth'));
    canPrint = false;
  }

  if (!('usb' in navigator)) {
    console.warn('WebUSB not supported - USB printing will not be available');
  }

  // Store print capability in state for disabling print buttons
  state.canPrint = canPrint;

  if (warnings.length > 0) {
    const overlay = document.createElement('div');
    overlay.id = 'compatibility-warning';
    overlay.className = 'fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-[600px] max-w-full overflow-hidden">
        <!-- Header -->
        <div class="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white relative">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            </div>
            <div>
              <h3 class="text-lg font-bold" data-i18n="compat_title">${t('compat_title')}</h3>
              <p class="text-amber-100 text-xs" data-i18n="compat_subtitle">${t('compat_subtitle')}</p>
            </div>
          </div>
        </div>

        <!-- Content -->
        <div class="p-5 space-y-4">
          <!-- Warning Messages -->
          <div class="bg-amber-50 rounded-lg p-3 border border-amber-200">
            <div class="flex items-start gap-2">
              <svg class="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <div class="text-sm text-gray-700 space-y-1">
                ${warnings.map(w => `<p>${w}</p>`).join('')}
              </div>
            </div>
          </div>

          <!-- Still Available -->
          <div class="grid grid-cols-2 gap-3">
            <div class="bg-green-50 rounded-lg p-3 border border-green-100">
              <div class="flex items-center gap-2 mb-1">
                <div class="w-6 h-6 bg-green-500 rounded flex items-center justify-center">
                  <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                </div>
                <h4 class="font-semibold text-gray-900 text-sm" data-i18n="compat_design_labels">${t('compat_design_labels')}</h4>
              </div>
              <p class="text-xs text-gray-600" data-i18n="compat_design_labels_desc">${t('compat_design_labels_desc')}</p>
            </div>
            <div class="bg-green-50 rounded-lg p-3 border border-green-100">
              <div class="flex items-center gap-2 mb-1">
                <div class="w-6 h-6 bg-green-500 rounded flex items-center justify-center">
                  <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                </div>
                <h4 class="font-semibold text-gray-900 text-sm" data-i18n="compat_save_export">${t('compat_save_export')}</h4>
              </div>
              <p class="text-xs text-gray-600" data-i18n="compat_save_export_desc">${t('compat_save_export_desc')}</p>
            </div>
          </div>

          <!-- User Manual Link -->
          <a href="docs/manual.html" target="_blank" rel="noopener" class="flex items-center justify-center gap-2 w-full px-4 py-2 bg-blue-50 text-blue-700 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors text-sm font-medium">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
            ${t('read_the_user_manual')}
          </a>

          <!-- Supported Printers (compact) -->
          <div class="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1" data-i18n="supported_printers">${t('supported_printers')}</p>
            <p class="text-xs text-gray-700">P12, A30, M02-M260, M04S, T02, D30-D110, Q30/Q30S, PM-241</p>
          </div>

          <!-- Action Button -->
          <button id="dismiss-warning-btn" class="w-full px-6 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium" data-i18n="compat_continue">
            ${t('compat_continue')}
          </button>
        </div>

        <!-- Footer -->
        <div class="bg-gray-50 px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <p class="text-xs text-gray-400" data-i18n="not_affiliated_with_phomemo">${t('not_affiliated_with_phomemo')}</p>
            <a href="https://donate.stripe.com/7sY7sMese0182tXgn8eAg00" target="_blank" rel="noopener" data-donate-original data-i18n-title="support_original_author_tooltip" title="${t('support_original_author_tooltip')}" class="inline-flex items-center gap-1 px-2 py-1 text-pink-600 text-xs hover:text-pink-700 transition-colors">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              <span data-i18n="support_original_author">${t('support_original_author')}</span>
            </a>
          </div>
          <a href="https://affordablemagic.net" target="_blank" rel="noopener" class="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all">
            <img src="https://affordablemagic.net/affordablemagic-400w.png" alt="Affordable Magic" class="h-4">
            <span class="text-xs font-medium text-gray-700" data-i18n="original_by_affordable_magic">${t('original_by_affordable_magic')}</span>
          </a>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Set up dismiss button
    document.getElementById('dismiss-warning-btn').addEventListener('click', () => {
      overlay.remove();
    });
  }

  return true; // Always return true to allow app to initialize
}

// =============================================================================
// MOBILE UI FUNCTIONS
// =============================================================================

/**
 * Check if viewport is mobile (< 768px)
 */
function isMobileViewport() {
  return window.matchMedia('(max-width: 767px)').matches;
}

/**
 * Handle viewport changes (resize, orientation)
 */
function handleViewportChange() {
  const wasMobile = state.mobile.isMobile;
  state.mobile.isMobile = isMobileViewport();

  if (wasMobile !== state.mobile.isMobile) {
    // Close mobile props panel when switching modes
    closeMobileProps();
    updateMobileUI();
  }
}

/**
 * Initialize mobile UI event handlers
 */
function initMobileUI() {
  // Menu toggle
  $('#mobile-menu-btn')?.addEventListener('click', openMobileMenu);
  $('#mobile-menu-close')?.addEventListener('click', closeMobileMenu);
  $('#mobile-menu-backdrop')?.addEventListener('click', closeMobileMenu);

  // Mobile menu actions
  $('#mobile-save-btn')?.addEventListener('click', () => {
    closeMobileMenu();
    showSaveDialog();
  });
  $('#mobile-load-btn')?.addEventListener('click', () => {
    closeMobileMenu();
    showLoadDialog();
  });
  $('#mobile-export-json-btn')?.addEventListener('click', () => {
    closeMobileMenu();
    handleExport();
  });
  $('#mobile-export-pdf-btn')?.addEventListener('click', () => {
    closeMobileMenu();
    handleExportPDF();
  });
  $('#mobile-export-png-btn')?.addEventListener('click', () => {
    closeMobileMenu();
    handleExportPNG();
  });
  $('#mobile-undo-btn')?.addEventListener('click', () => undo());
  $('#mobile-redo-btn')?.addEventListener('click', () => redo());
  $('#mobile-print-settings-btn')?.addEventListener('click', () => {
    closeMobileMenu();
    updateCounterUI();
    $('#print-settings-dialog')?.classList.remove('hidden');
    $('#print-settings-dialog')?.classList.add('flex');
  });
  $('#mobile-info-btn')?.addEventListener('click', () => {
    closeMobileMenu();
    showInfoDialog();
  });
  $('#mobile-print-btn')?.addEventListener('click', handlePrint);

  // Mobile dither preview toggle
  $('#mobile-dither-preview-btn')?.addEventListener('click', () => {
    state.ditherPreview = !state.ditherPreview;
    state.renderer.setDitherPreview(state.ditherPreview);

    // Update both buttons
    const desktopBtn = $('#dither-preview-btn');
    const mobileBtn = $('#mobile-dither-preview-btn');
    if (state.ditherPreview) {
      desktopBtn?.classList.remove('bg-gray-100', 'text-gray-700');
      desktopBtn?.classList.add('bg-blue-500', 'text-white');
      mobileBtn?.classList.remove('bg-gray-100', 'text-gray-700');
      mobileBtn?.classList.add('bg-blue-500', 'text-white');
    } else {
      desktopBtn?.classList.remove('bg-blue-500', 'text-white');
      desktopBtn?.classList.add('bg-gray-100', 'text-gray-700');
      mobileBtn?.classList.remove('bg-blue-500', 'text-white');
      mobileBtn?.classList.add('bg-gray-100', 'text-gray-700');
    }
    setStatus(state.ditherPreview ? t('status_preview_on') : t('status_preview_off'));
    render();
  });

  // Mobile template buttons
  $('#mobile-template-manage')?.addEventListener('click', () => {
    closeMobileMenu();
    showTemplateDataDialog();
  });
  $('#mobile-template-preview')?.addEventListener('click', () => {
    closeMobileMenu();
    showPreviewDialog();
  });
  $('#mobile-template-print')?.addEventListener('click', () => {
    closeMobileMenu();
    printFromTemplatePanel();
  });

  // Sync mobile label size selector with desktop
  const mobileLabelSize = $('#mobile-label-size');
  const desktopLabelSize = $('#label-size');
  if (mobileLabelSize && desktopLabelSize) {
    mobileLabelSize.value = desktopLabelSize.value;
    mobileLabelSize.addEventListener('change', (e) => {
      const value = e.target.value;
      desktopLabelSize.value = value;

      // Show/hide mobile custom size inputs
      const mobileCustomSize = $('#mobile-custom-size');
      if (value === 'custom') {
        mobileCustomSize?.classList.remove('hidden');
        // Sync values from desktop
        $('#mobile-custom-width').value = $('#custom-width').value || '';
        $('#mobile-custom-height').value = $('#custom-height').value || '';
        $('#mobile-custom-round').checked = $('#custom-round').checked || false;
        if ($('#mobile-custom-continuous')) {
          $('#mobile-custom-continuous').checked = $('#custom-continuous')?.checked || false;
        }
        updateMobileCustomSizeVisibility();
      } else {
        mobileCustomSize?.classList.add('hidden');
        handleLabelSizeChange({ target: desktopLabelSize });
        if (value !== 'multi-label') {
          closeMobileMenu();
        }
      }
    });
  }

  // Mobile custom size input handlers
  const mobileCustomWidth = $('#mobile-custom-width');
  const mobileCustomHeight = $('#mobile-custom-height');
  const mobileCustomRound = $('#mobile-custom-round');

  function updateMobileCustomSizeVisibility() {
    const isRound = $('#mobile-custom-round')?.checked;
    const heightInput = $('#mobile-custom-height');
    if (isRound) {
      heightInput?.classList.add('hidden');
      heightInput.previousElementSibling?.classList.add('hidden'); // hide 'x'
    } else {
      heightInput?.classList.remove('hidden');
      heightInput.previousElementSibling?.classList.remove('hidden');
    }
  }

  function syncMobileCustomToDesktop() {
    const w = $('#mobile-custom-width')?.value;
    const h = $('#mobile-custom-height')?.value;
    const isRound = $('#mobile-custom-round')?.checked;
    const isContinuous = !!$('#mobile-custom-continuous')?.checked;

    // Sync to desktop inputs
    if ($('#custom-width')) $('#custom-width').value = w;
    if ($('#custom-height')) $('#custom-height').value = isRound ? w : h;
    if ($('#custom-round')) $('#custom-round').checked = isRound;
    if ($('#custom-continuous')) $('#custom-continuous').checked = isContinuous;

    // Trigger the desktop handler
    handleCustomSizeChange();
  }

  // Helper to reset iOS zoom after input blur
  function resetMobileZoom() {
    // Force viewport reset by temporarily scrolling
    window.scrollTo(0, 0);
    // Also blur any active element to ensure keyboard dismisses
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  }

  mobileCustomWidth?.addEventListener('change', syncMobileCustomToDesktop);
  mobileCustomHeight?.addEventListener('change', syncMobileCustomToDesktop);
  mobileCustomWidth?.addEventListener('blur', resetMobileZoom);
  mobileCustomHeight?.addEventListener('blur', resetMobileZoom);
  mobileCustomRound?.addEventListener('change', () => {
    updateMobileCustomSizeVisibility();
    // If round is checked, sync width to height
    if ($('#mobile-custom-round')?.checked) {
      $('#mobile-custom-height').value = $('#mobile-custom-width').value;
    }
    syncMobileCustomToDesktop();
  });
  $('#mobile-custom-continuous')?.addEventListener('change', syncMobileCustomToDesktop);

  // Sync mobile connection type
  const mobileConnType = $('#mobile-conn-type');
  const desktopConnType = $('#conn-type');
  if (mobileConnType && desktopConnType) {
    mobileConnType.value = desktopConnType.value;
    mobileConnType.addEventListener('change', (e) => {
      desktopConnType.value = e.target.value;
      state.connectionType = e.target.value;
    });
  }

  // Mobile connect button
  $('#mobile-connect-btn')?.addEventListener('click', (e) => {
    closeMobileMenu();
    handleConnect(e);
  });

  // Mobile disconnect button
  $('#mobile-disconnect-btn')?.addEventListener('click', async () => {
    closeMobileMenu();
    if (state.transport) {
      try {
        await state.transport.disconnect();
      } catch (e) {
        console.warn('Disconnect error:', e.message);
      }
      state.transport = null;
    }
    updateConnectionStatus(false);
    setStatus(t('status_disconnected'));
  });

  // Fixed toolbar - add element buttons
  $('#mobile-add-text')?.addEventListener('click', () => addTextElement());
  $('#mobile-add-image')?.addEventListener('click', () => $('#image-file-input').click());
  $('#mobile-add-rect')?.addEventListener('click', () => addShapeElement('rectangle'));
  $('#mobile-add-ellipse')?.addEventListener('click', () => addShapeElement('ellipse'));
  $('#mobile-add-line')?.addEventListener('click', () => addShapeElement('line'));
  $('#mobile-add-barcode')?.addEventListener('click', () => addBarcodeElement());
  $('#mobile-add-qr')?.addEventListener('click', () => addQRElement());

  // Edit button - open properties panel
  $('#mobile-edit-btn')?.addEventListener('click', openMobileProps);
  $('#mobile-props-close')?.addEventListener('click', closeMobileProps);

  // Selection actions
  $('#mobile-duplicate-btn')?.addEventListener('click', () => {
    const selected = getSelected();
    if (selected) {
      saveHistory();
      state.elements = duplicateElement(state.elements, selected.id);
      autoCloneIfEnabled();
      selectElement(state.elements[state.elements.length - 1].id);
      setStatus(t('status_element_duplicated'));
    }
  });

  $('#mobile-delete-btn')?.addEventListener('click', () => {
    if (state.selectedIds.length > 0) {
      saveHistory();
      state.selectedIds.forEach(id => {
        state.renderer.clearCache(id);
        state.elements = deleteElement(state.elements, id);
      });
      autoCloneIfEnabled();
      deselect();
      setStatus(t('status_element_deleted'));
    }
  });

  $('#mobile-raise-btn')?.addEventListener('click', () => {
    const selected = getSelected();
    if (selected) {
      saveHistory();
      state.elements = bringToFront(state.elements, selected.id);
      render();
      setStatus(t('status_element_raised'));
    }
  });

  $('#mobile-lower-btn')?.addEventListener('click', () => {
    const selected = getSelected();
    if (selected) {
      saveHistory();
      state.elements = sendToBack(state.elements, selected.id);
      render();
      setStatus(t('status_element_lowered'));
    }
  });

  // Viewport change listener
  window.matchMedia('(max-width: 767px)').addEventListener('change', handleViewportChange);
  handleViewportChange(); // Initial check
}

/**
 * Open mobile menu
 */
function openMobileMenu() {
  const overlay = $('#mobile-menu-overlay');
  const panel = $('#mobile-menu-panel');
  if (!overlay || !panel) return;

  overlay.classList.remove('mobile-hidden');
  requestAnimationFrame(() => {
    panel.classList.add('menu-open');
  });
  state.mobile.menuOpen = true;
}

/**
 * Close mobile menu
 */
function closeMobileMenu() {
  const overlay = $('#mobile-menu-overlay');
  const panel = $('#mobile-menu-panel');
  if (!overlay || !panel) return;

  panel.classList.remove('menu-open');
  setTimeout(() => overlay.classList.add('mobile-hidden'), 300);
  state.mobile.menuOpen = false;
}

/**
 * Open mobile properties panel
 */
function openMobileProps() {
  const panel = $('#mobile-props-panel');
  if (!panel) return;

  populateMobileProps();
  panel.classList.add('props-open');
  state.mobile.propsOpen = true;
}

/**
 * Close mobile properties panel
 */
function closeMobileProps() {
  const panel = $('#mobile-props-panel');
  if (!panel) return;

  panel.classList.remove('props-open');
  state.mobile.propsOpen = false;
}

/**
 * Populate mobile properties panel based on selected element
 */
function populateMobileProps() {
  const content = $('#mobile-props-content');
  const title = $('#mobile-props-title');
  if (!content || !title) return;

  const selected = getSelected();
  if (!selected) {
    content.innerHTML = `<p class="text-gray-500 text-center py-4">${t('no_element_selected')}</p>`;
    title.textContent = t('properties');
    return;
  }

  // Set title based on element type
  const typeNames = {
    text: t('text'),
    image: t('image'),
    shape: shapeName(selected.shapeType),
    barcode: t('barcode'),
    qr: t('qr_code'),
    frame: t('frame'),
  };
  title.textContent = typeNames[selected.type] || t('properties');

  // Generate properties form
  let html = '<div class="space-y-4">';

  // Helper to generate field dropdown HTML
  const fieldDropdownHtml = (inputId) => {
    const existingFields = [...definedVariables().map(v => v.name), ...(state.templateFields || [])];
    const fieldOptions = existingFields.map(f =>
      `<button class="w-full px-3 py-2 text-left text-sm hover:bg-purple-50 active:bg-purple-100" data-insert-field="${escapeAttr(f)}" data-target="${inputId}">{{${escapeHtml(f)}}}</button>`
    ).join('');
    return `
      <div class="mobile-field-dropdown hidden absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-[80] min-w-[160px] overflow-hidden">
        ${fieldOptions}
        <div class="border-t border-gray-100 p-2">
          <input type="text" class="mobile-new-field-input w-full px-2 py-1.5 text-base border border-gray-200 rounded" placeholder="${t('new_field_name')}" data-target="${inputId}">
        </div>
      </div>
    `;
  };

  // Type-specific properties FIRST (content is most important on mobile)
  if (selected.type === 'text') {
    const fontFamily = selected.fontFamily || 'Inter, sans-serif';
    const vAlign = selected.verticalAlign || 'middle';
    const textColor = selected.color || 'black';
    const bgColor = selected.background || 'transparent';
    html += `
      <div class="prop-group">
        <div class="flex items-center justify-between mb-1">
          <div class="prop-label mb-0">${t('text_content')}</div>
          <div class="relative">
            <button class="mobile-field-btn text-xs text-purple-600 font-medium flex items-center gap-0.5 px-2 py-1 rounded hover:bg-purple-50 active:bg-purple-100">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              ${t('field')}
            </button>
            ${fieldDropdownHtml('mobile-prop-text')}
          </div>
        </div>
        <textarea id="mobile-prop-text" class="prop-input" rows="2">${escapeHtml(selected.text || '')}</textarea>
      </div>
      <div class="prop-group">
        <div class="prop-row">
          <div class="flex-1">
            <div class="prop-label">${t('font')}</div>
            <select id="mobile-prop-fontFamily" class="prop-input">
              ${japaneseFontOptionsHtml(fontFamily)}
              <optgroup label="${t('sans_serif')}">
                <option value="Inter, sans-serif" ${fontFamily === 'Inter, sans-serif' ? 'selected' : ''}>Inter</option>
                <option value="Roboto, sans-serif" ${fontFamily === 'Roboto, sans-serif' ? 'selected' : ''}>Roboto</option>
                <option value="Open Sans, sans-serif" ${fontFamily === 'Open Sans, sans-serif' ? 'selected' : ''}>Open Sans</option>
                <option value="Arial, sans-serif" ${fontFamily === 'Arial, sans-serif' ? 'selected' : ''}>Arial</option>
              </optgroup>
              <optgroup label="${t('serif')}">
                <option value="Georgia, serif" ${fontFamily === 'Georgia, serif' ? 'selected' : ''}>Georgia</option>
                <option value="Times New Roman, serif" ${fontFamily === 'Times New Roman, serif' ? 'selected' : ''}>Times New Roman</option>
              </optgroup>
              <optgroup label="${t('monospace')}">
                <option value="Roboto Mono, monospace" ${fontFamily === 'Roboto Mono, monospace' ? 'selected' : ''}>Roboto Mono</option>
                <option value="Courier New, monospace" ${fontFamily === 'Courier New, monospace' ? 'selected' : ''}>Courier New</option>
              </optgroup>
              ${state.localFonts.length > 0 ? `
              <optgroup label="${t('system_fonts')}">
                ${state.localFonts.map(f => `<option value="${f.family}" ${fontFamily === f.family ? 'selected' : ''}>${f.family}</option>`).join('')}
              </optgroup>
              ` : ''}
            </select>
            ${!state.localFontsEnabled && isLocalFontAccessAvailable() ? `
            <button id="mobile-add-system-fonts-btn" class="w-full mt-1 py-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded">${t('add_system_fonts')}</button>
            ` : ''}
          </div>
          <div class="w-20">
            <div class="prop-label">${t('size')}</div>
            <input type="number" id="mobile-prop-fontSize" class="prop-input" value="${selected.fontSize || 24}" min="8" max="200">
          </div>
        </div>
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('horizontal_align')}</div>
        <div class="flex gap-2">
          <button class="flex-1 py-2.5 border rounded ${(selected.align || 'left') === 'left' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-align="left">${t('left')}</button>
          <button class="flex-1 py-2.5 border rounded ${selected.align === 'center' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-align="center">${t('center')}</button>
          <button class="flex-1 py-2.5 border rounded ${selected.align === 'right' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-align="right">${t('right')}</button>
        </div>
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('vertical_align')}</div>
        <div class="flex gap-2">
          <button class="flex-1 py-2.5 border rounded ${vAlign === 'top' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-valign="top">${t('top')}</button>
          <button class="flex-1 py-2.5 border rounded ${vAlign === 'middle' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-valign="middle">${t('middle')}</button>
          <button class="flex-1 py-2.5 border rounded ${vAlign === 'bottom' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-valign="bottom">${t('bottom')}</button>
        </div>
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('style')}</div>
        <div class="flex gap-2">
          <button id="mobile-prop-bold" class="flex-1 py-2.5 border rounded font-bold ${selected.fontWeight === 'bold' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}">B</button>
          <button id="mobile-prop-italic" class="flex-1 py-2.5 border rounded italic ${selected.fontStyle === 'italic' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}">I</button>
          <button id="mobile-prop-underline" class="flex-1 py-2.5 border rounded underline ${selected.textDecoration === 'underline' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}">U</button>
        </div>
      </div>
      <div class="prop-group">
        <div class="prop-row">
          <div class="flex-1">
            <div class="prop-label">${t('text_color')}</div>
            <div class="flex gap-2">
              <button class="flex-1 py-2.5 border rounded flex items-center justify-center gap-1 ${textColor === 'black' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-color="black">
                <span class="w-4 h-4 bg-black rounded"></span> ${t('black')}
              </button>
              <button class="flex-1 py-2.5 border rounded flex items-center justify-center gap-1 ${textColor === 'white' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-color="white">
                <span class="w-4 h-4 bg-white border border-gray-300 rounded"></span> ${t('white')}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('background')}</div>
        <div class="flex gap-2">
          <button class="flex-1 py-2.5 border rounded text-sm ${bgColor === 'transparent' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-bg="transparent">${t('none')}</button>
          <button class="flex-1 py-2.5 border rounded flex items-center justify-center gap-1 ${bgColor === 'black' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-bg="black">
            <span class="w-4 h-4 bg-black rounded"></span>
          </button>
          <button class="flex-1 py-2.5 border rounded flex items-center justify-center gap-1 ${bgColor === 'white' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-bg="white">
            <span class="w-4 h-4 bg-white border border-gray-300 rounded"></span>
          </button>
        </div>
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('text_options')}</div>
        <div class="flex flex-wrap gap-x-4 gap-y-2">
          <label class="flex items-center gap-2">
            <input type="checkbox" id="mobile-prop-noWrap" class="w-5 h-5" ${selected.noWrap ? 'checked' : ''}>
            <span class="text-sm">${t('no_wrap')}</span>
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" id="mobile-prop-clipOverflow" class="w-5 h-5" ${selected.clipOverflow ? 'checked' : ''}>
            <span class="text-sm">${t('clip')}</span>
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" id="mobile-prop-autoScale" class="w-5 h-5" ${selected.autoScale ? 'checked' : ''}>
            <span class="text-sm">${t('auto_fit')}</span>
          </label>
        </div>
      </div>
      ${mobileTextStyleHtml(selected)}
    `;
  } else if (selected.type === 'barcode') {
    html += `
      <div class="prop-group">
        <div class="flex items-center justify-between mb-1">
          <div class="prop-label mb-0">${t('barcode_value')}</div>
          <div class="relative">
            <button class="mobile-field-btn text-xs text-purple-600 font-medium flex items-center gap-0.5 px-2 py-1 rounded hover:bg-purple-50 active:bg-purple-100">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              ${t('field')}
            </button>
            ${fieldDropdownHtml('mobile-prop-value')}
          </div>
        </div>
        <input type="text" id="mobile-prop-value" class="prop-input" value="${escapeHtml(selected.value || selected.barcodeData || '')}">
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('format')}</div>
        <select id="mobile-prop-format" class="prop-input">
          <option value="CODE128" ${(selected.format || selected.barcodeFormat) === 'CODE128' ? 'selected' : ''}>Code 128</option>
          <option value="EAN13" ${(selected.format || selected.barcodeFormat) === 'EAN13' ? 'selected' : ''}>EAN-13</option>
          <option value="UPC" ${(selected.format || selected.barcodeFormat) === 'UPC' ? 'selected' : ''}>UPC</option>
          <option value="CODE39" ${(selected.format || selected.barcodeFormat) === 'CODE39' ? 'selected' : ''}>Code 39</option>
        </select>
      </div>
      <div class="prop-group">
        <label class="flex items-center gap-2 py-1">
          <input type="checkbox" id="mobile-prop-showText" class="w-5 h-5" ${selected.showText !== false ? 'checked' : ''}>
          <span class="text-sm">${t('show_text_below_barcode')}</span>
        </label>
      </div>
      <div class="prop-group ${selected.showText === false ? 'hidden' : ''}" id="mobile-barcode-text-options">
        <div class="prop-label">${t('text_style')}</div>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2">
            <label class="text-sm text-gray-600">${t('size')}:</label>
            <input type="number" id="mobile-prop-textFontSize" class="w-16 px-2 py-1.5 text-sm border border-gray-200 rounded" value="${selected.textFontSize || 12}">
          </div>
          <label class="flex items-center gap-2">
            <input type="checkbox" id="mobile-prop-textBold" class="w-5 h-5" ${selected.textBold ? 'checked' : ''}>
            <span class="text-sm font-bold">B</span>
          </label>
        </div>
      </div>
    `;
  } else if (selected.type === 'qr') {
    html += `
      <div class="prop-group">
        <div class="flex items-center justify-between mb-1">
          <div class="prop-label mb-0">${t('qr_content')}</div>
          <div class="relative">
            <button class="mobile-field-btn text-xs text-purple-600 font-medium flex items-center gap-0.5 px-2 py-1 rounded hover:bg-purple-50 active:bg-purple-100">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              ${t('field')}
            </button>
            ${fieldDropdownHtml('mobile-prop-value')}
          </div>
        </div>
        <textarea id="mobile-prop-value" class="prop-input" rows="3">${escapeHtml(selected.value || selected.qrData || '')}</textarea>
      </div>
    `;
  } else if (selected.type === 'shape') {
    const shapeType = selected.shapeType || 'rectangle';
    let fillValue = selected.fill || 'black';
    const strokeValue = selected.stroke || 'black';
    html += `
      <div class="prop-group">
        <div class="prop-label">${t('shape_type')}</div>
        <select id="mobile-prop-shapeType" class="prop-input">
          <option value="rectangle" ${shapeType === 'rectangle' ? 'selected' : ''}>${t('rectangle')}</option>
          <option value="ellipse" ${shapeType === 'ellipse' ? 'selected' : ''}>${t('ellipse')}</option>
          <option value="triangle" ${shapeType === 'triangle' ? 'selected' : ''}>${t('triangle')}</option>
          <option value="line" ${shapeType === 'line' ? 'selected' : ''}>${t('line')}</option>
        </select>
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('fill')}</div>
        <select id="mobile-prop-fill" class="prop-input">
          <option value="none" ${fillValue === 'none' ? 'selected' : ''}>${t('none_outline_only')}</option>
          <option value="white" ${fillValue === 'white' ? 'selected' : ''}>${t('white_0')}</option>
          <option value="dither-25" ${fillValue === 'dither-25' ? 'selected' : ''}>${t('25_gray')}</option>
          <option value="dither-50" ${fillValue === 'dither-50' ? 'selected' : ''}>${t('50_gray')}</option>
          <option value="dither-75" ${fillValue === 'dither-75' ? 'selected' : ''}>${t('75_gray')}</option>
          <option value="black" ${fillValue === 'black' ? 'selected' : ''}>${t('black_100')}</option>
        </select>
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('stroke')}</div>
        <div class="flex gap-2">
          <button class="flex-1 py-2.5 border rounded ${strokeValue === 'none' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-stroke="none">${t('none')}</button>
          <button class="flex-1 py-2.5 border rounded flex items-center justify-center gap-1 ${strokeValue === 'black' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-stroke="black">
            <span class="w-4 h-4 bg-black rounded"></span> ${t('black')}
          </button>
          <button class="flex-1 py-2.5 border rounded flex items-center justify-center gap-1 ${strokeValue === 'white' ? 'bg-blue-100 border-blue-400' : 'border-gray-300 bg-gray-50'}" data-stroke="white">
            <span class="w-4 h-4 bg-white border border-gray-300 rounded"></span> ${t('white')}
          </button>
        </div>
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('stroke_width')}</div>
        <input type="number" id="mobile-prop-strokeWidth" class="prop-input" value="${selected.strokeWidth || 2}" min="1" max="20">
      </div>
      ${shapeType === 'rectangle' ? `
      <div class="prop-group">
        <div class="prop-label">${t('corner_radius')}</div>
        <input type="number" id="mobile-prop-cornerRadius" class="prop-input" value="${selected.cornerRadius || 0}" min="0" max="100">
      </div>
      ` : ''}
    `;
  } else if (selected.type === 'frame') {
    html += `
      <div class="prop-group">
        <div class="prop-label">${t('frame_style')}</div>
        <select id="mobile-prop-frameStyle" class="prop-input">
          ${FRAME_STYLES.map(fs => `<option value="${fs.id}" ${selected.frameStyle === fs.id ? 'selected' : ''}>${frameStyleName(fs)}</option>`).join('')}
        </select>
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('shape_2')}</div>
        <select id="mobile-prop-frameShape" class="prop-input">
          <option value="rect" ${selected.frameShape !== 'ellipse' ? 'selected' : ''}>${t('square')}</option>
          <option value="ellipse" ${selected.frameShape === 'ellipse' ? 'selected' : ''}>${t('round')}</option>
        </select>
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('line_width_px')}</div>
        <input type="number" id="mobile-prop-frameStroke" class="prop-input" value="${selected.strokeWidth || 3}" min="1" max="20">
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('margin_px')}</div>
        <input type="number" id="mobile-prop-frameMargin" class="prop-input" value="${selected.frameMargin ?? 8}" min="0" max="80">
      </div>
      <div class="prop-group">
        <label class="flex items-center gap-2 py-1">
          <input type="checkbox" id="mobile-prop-frameFit" class="w-5 h-5" ${selected.fitToLabel ? 'checked' : ''}>
          <span class="text-sm">${t('fit_to_label_size')}</span>
        </label>
      </div>
    `;
  } else if (selected.type === 'image') {
    const imgBase = getImageBaseSize(selected);
    const scaleW = (selected.width / imgBase.width) * 100;
    const scaleH = (selected.height / imgBase.height) * 100;
    const currentScale = Math.round(Math.max(scaleW, scaleH));
    const hasCrop = !!normalizeCrop(selected.crop);
    html += `
      <div class="prop-group">
        <div class="prop-label">${t('crop_flip')}</div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">
          <button type="button" id="mobile-prop-crop" class="img-tool-btn" style="padding:10px 4px;font-size:13px" aria-pressed="${hasCrop}">${t('crop')}</button>
          <button type="button" id="mobile-prop-flipX" class="img-tool-btn" style="padding:10px 4px;font-size:13px" aria-pressed="${!!selected.flipX}">${t('flip_horizontally')}</button>
          <button type="button" id="mobile-prop-flipY" class="img-tool-btn" style="padding:10px 4px;font-size:13px" aria-pressed="${!!selected.flipY}">${t('flip_vertically')}</button>
        </div>
        ${hasCrop ? `<button type="button" id="mobile-prop-crop-clear" class="text-sm text-blue-600 mt-2">${t('remove_crop')}</button>` : ''}
        <button type="button" id="mobile-prop-ai-bw" class="img-tool-btn" style="width:100%;margin-top:6px;padding:10px 4px;font-size:13px">${t('aibw_button')}</button>
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('scale')}: ${currentScale}%</div>
        <input type="range" id="mobile-prop-scale" class="w-full" min="10" max="200" value="${currentScale}">
      </div>
      <div class="prop-group">
        <label class="flex items-center gap-2 py-1">
          <input type="checkbox" id="mobile-prop-lockRatio" class="w-5 h-5" ${selected.lockAspectRatio !== false ? 'checked' : ''}>
          <span class="text-sm">${t('lock_aspect_ratio')}</span>
        </label>
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('dithering')}</div>
        <select id="mobile-prop-dither" class="prop-input">
          <option value="none" ${selected.dither === 'none' ? 'selected' : ''}>${t('none_threshold')}</option>
          <option value="ordered" ${selected.dither === 'ordered' ? 'selected' : ''}>${t('ordered_bayer')}</option>
          <option value="atkinson" ${selected.dither === 'atkinson' ? 'selected' : ''}>Atkinson</option>
          <option value="floyd-steinberg" ${(selected.dither === 'floyd-steinberg' || !selected.dither) ? 'selected' : ''}>Floyd-Steinberg</option>
        </select>
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('brightness')}</div>
        <input type="range" id="mobile-prop-brightness" class="w-full" min="-100" max="100" value="${selected.brightness || 0}">
      </div>
      <div class="prop-group">
        <div class="prop-label">${t('contrast')}</div>
        <input type="range" id="mobile-prop-contrast" class="w-full" min="-100" max="100" value="${selected.contrast || 0}">
      </div>
    `;
  }

  // Position/Size/Rotation section (collapsible, at bottom)
  html += `
    <div class="border-t border-gray-200 pt-4 mt-4">
      <div class="prop-label text-gray-400 mb-3">${t('position_size')}</div>
      <div class="prop-group">
        <div class="prop-row">
          <div class="flex-1">
            <label class="text-xs text-gray-500">X</label>
            <input type="number" id="mobile-prop-x" class="prop-input" value="${Math.round(selected.x)}">
          </div>
          <div class="flex-1">
            <label class="text-xs text-gray-500">Y</label>
            <input type="number" id="mobile-prop-y" class="prop-input" value="${Math.round(selected.y)}">
          </div>
        </div>
      </div>
      <div class="prop-group">
        <div class="prop-row">
          <div class="flex-1">
            <label class="text-xs text-gray-500">${t('width')}</label>
            <input type="number" id="mobile-prop-width" class="prop-input" value="${Math.round(selected.width)}">
          </div>
          <div class="flex-1">
            <label class="text-xs text-gray-500">${t('height')}</label>
            <input type="number" id="mobile-prop-height" class="prop-input" value="${Math.round(selected.height)}">
          </div>
        </div>
      </div>
      <div class="prop-group">
        <div class="prop-row">
          <div class="flex-1">
            <label class="text-xs text-gray-500">${t('rotation')}</label>
            <input type="number" id="mobile-prop-rotation" class="prop-input" value="${selected.rotation || 0}" min="0" max="360">
          </div>
          <div class="flex-1"></div>
        </div>
        <div class="prop-row">
          <div class="flex-1">
            <label class="text-xs text-gray-500">${t('mirror_layout')}</label>
            <select id="mobile-prop-mirror-axis" class="prop-input">
              <option value="">${t('mirror_none')}</option>
              <option value="x">${t('mirror_axis_x')}</option>
              <option value="y">${t('mirror_axis_y')}</option>
            </select>
          </div>
          <div class="flex-1">
            <label class="text-xs text-gray-500">${t('mirror_orient')}</label>
            <select id="mobile-prop-mirror-orient" class="prop-input">
              <option value="mirror">${t('mirror_orient_mirror')}</option>
              <option value="upright">${t('mirror_orient_upright')}</option>
              <option value="rotate180">${t('mirror_orient_rotate180')}</option>
              <option value="point">${t('mirror_orient_point')}</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  `;

  html += '</div>';
  content.innerHTML = html;

  // Wire up event handlers
  wireUpMobilePropHandlers(selected);
}

/**
 * Wire up event handlers for mobile properties
 */
function wireUpMobilePropHandlers(element) {
  // Full update - saves history and syncs desktop panel (use for discrete changes)
  const updateProp = (prop, value) => {
    saveHistory();
    element[prop] = value;
    state.renderer.clearCache(element.id);
    autoCloneIfEnabled();
    render();
    updatePropertiesPanel();
  };

  // Live update - no history save, no panel sync (use for continuous input like typing)
  const updatePropLive = (prop, value) => {
    element[prop] = value;
    state.renderer.clearCache(element.id);
    autoCloneIfEnabled();
    render();
  };

  // Save history on blur for live inputs (captures the final value)
  const saveOnBlur = (prop) => (e) => {
    saveHistory();
    updatePropertiesPanel(); // Sync desktop panel on blur
  };

  // Position and size
  $('#mobile-prop-x')?.addEventListener('change', (e) => updateProp('x', parseFloat(e.target.value)));
  $('#mobile-prop-y')?.addEventListener('change', (e) => updateProp('y', parseFloat(e.target.value)));
  $('#mobile-prop-width')?.addEventListener('change', (e) => updateProp('width', parseFloat(e.target.value)));
  $('#mobile-prop-height')?.addEventListener('change', (e) => updateProp('height', parseFloat(e.target.value)));
  $('#mobile-prop-rotation')?.addEventListener('change', (e) => updateProp('rotation', parseFloat(e.target.value)));

  // ミラー配置
  syncMirrorControls($('#mobile-prop-mirror-axis'), $('#mobile-prop-mirror-orient'), element);
  $('#mobile-prop-mirror-axis')?.addEventListener('change', (e) => setElementMirror(element.id, e.target.value));
  $('#mobile-prop-mirror-orient')?.addEventListener('change', (e) => {
    const m = normalizeMirror(element.mirror);
    if (m) setElementMirror(element.id, m.axis, e.target.value);
  });

  // Text properties - use live update for typing, save history on blur
  const textInput = $('#mobile-prop-text');
  if (textInput) {
    textInput.addEventListener('input', (e) => {
      updatePropLive('text', e.target.value);
      detectTemplateFields(); // Detect {{fields}} as user types
    });
    textInput.addEventListener('blur', saveOnBlur('text'));
  }
  $('#mobile-prop-fontSize')?.addEventListener('change', (e) => updateProp('fontSize', parseInt(e.target.value)));
  $('#mobile-prop-fontFamily')?.addEventListener('change', (e) => updateProp('fontFamily', e.target.value));

  // Mobile add system fonts button
  $('#mobile-add-system-fonts-btn')?.addEventListener('click', async () => {
    await loadLocalFonts();
    populateMobileProps(); // Refresh to show new fonts
  });

  // Horizontal alignment
  $$('[data-align]').forEach(btn => {
    btn.addEventListener('click', () => {
      updateProp('align', btn.dataset.align);
      populateMobileProps();
    });
  });

  // Vertical alignment
  $$('[data-valign]').forEach(btn => {
    btn.addEventListener('click', () => {
      updateProp('verticalAlign', btn.dataset.valign);
      populateMobileProps();
    });
  });

  // Text style buttons
  $('#mobile-prop-bold')?.addEventListener('click', () => {
    updateProp('fontWeight', element.fontWeight === 'bold' ? 'normal' : 'bold');
    populateMobileProps();
  });
  $('#mobile-prop-italic')?.addEventListener('click', () => {
    updateProp('fontStyle', element.fontStyle === 'italic' ? 'normal' : 'italic');
    populateMobileProps();
  });
  $('#mobile-prop-underline')?.addEventListener('click', () => {
    updateProp('textDecoration', element.textDecoration === 'underline' ? 'none' : 'underline');
    populateMobileProps();
  });

  // Text color buttons
  $$('[data-color]').forEach(btn => {
    btn.addEventListener('click', () => {
      updateProp('color', btn.dataset.color);
      populateMobileProps();
    });
  });

  // Background buttons
  $$('[data-bg]').forEach(btn => {
    btn.addEventListener('click', () => {
      updateProp('background', btn.dataset.bg);
      populateMobileProps();
    });
  });

  // Text options checkboxes (wrap/clip/fit)
  $('#mobile-prop-noWrap')?.addEventListener('change', (e) => updateProp('noWrap', e.target.checked));
  $('#mobile-prop-clipOverflow')?.addEventListener('change', (e) => updateProp('clipOverflow', e.target.checked));
  $('#mobile-prop-autoScale')?.addEventListener('change', (e) => updateProp('autoScale', e.target.checked));
  if (element.type === 'text') wireMobileTextStyle(element, textStyleCtx); // #24

  // Barcode/QR properties - use live update for typing
  const valueInput = $('#mobile-prop-value');
  if (valueInput) {
    // Update both value and legacy property names
    valueInput.addEventListener('input', (e) => {
      updatePropLive('value', e.target.value);
      if (element.type === 'barcode') element.barcodeData = e.target.value;
      if (element.type === 'qr') element.qrData = e.target.value;
      detectTemplateFields(); // Detect {{fields}} as user types
    });
    valueInput.addEventListener('blur', saveOnBlur('value'));
  }
  $('#mobile-prop-format')?.addEventListener('change', (e) => {
    updateProp('format', e.target.value);
    element.barcodeFormat = e.target.value; // Also update legacy property
  });
  $('#mobile-prop-showText')?.addEventListener('change', (e) => {
    updateProp('showText', e.target.checked);
    // Show/hide text options
    const textOptions = $('#mobile-barcode-text-options');
    if (textOptions) {
      textOptions.classList.toggle('hidden', !e.target.checked);
    }
  });
  $('#mobile-prop-textFontSize')?.addEventListener('change', (e) => updateProp('textFontSize', parseInt(e.target.value) || 12));
  $('#mobile-prop-textBold')?.addEventListener('change', (e) => updateProp('textBold', e.target.checked));

  // Mobile field insertion buttons
  $$('.mobile-field-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = btn.parentElement.querySelector('.mobile-field-dropdown');
      // Close any other open dropdowns
      $$('.mobile-field-dropdown').forEach(d => {
        if (d !== dropdown) d.classList.add('hidden');
      });
      dropdown?.classList.toggle('hidden');
    });
  });

  // Helper to insert field text and update element property
  const insertFieldText = (target, fieldText, targetId) => {
    const start = target.selectionStart || target.value.length;
    const end = target.selectionEnd || target.value.length;
    target.value = target.value.slice(0, start) + fieldText + target.value.slice(end);
    target.focus();
    target.selectionStart = target.selectionEnd = start + fieldText.length;

    // Directly update the element property based on target ID
    if (targetId === 'mobile-prop-text' && element.type === 'text') {
      element.text = target.value;
      state.renderer.clearCache(element.id);
      render();
    } else if (targetId === 'mobile-prop-value') {
      element.value = target.value;
      if (element.type === 'barcode') element.barcodeData = target.value;
      if (element.type === 'qr') element.qrData = target.value;
      state.renderer.clearCache(element.id);
      render();
    }

    // Detect template fields
    detectTemplateFields();
  };

  // Insert existing field
  $$('[data-insert-field]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const fieldName = btn.dataset.insertField;
      const targetId = btn.dataset.target;
      const target = $(`#${targetId}`);
      if (target) {
        insertFieldText(target, `{{${fieldName}}}`, targetId);
      }
      btn.closest('.mobile-field-dropdown')?.classList.add('hidden');
    });
  });

  // Add new field from input
  $$('.mobile-new-field-input').forEach(input => {
    let isInserting = false; // Prevent double insertion from Enter + change events

    // Helper to insert the field
    const insertNewField = () => {
      if (isInserting) return; // Prevent double execution
      if (!input.value.trim()) return;

      isInserting = true;
      const fieldName = input.value.trim();
      const targetId = input.dataset.target;
      const target = $(`#${targetId}`);
      if (target) {
        insertFieldText(target, `{{${fieldName}}}`, targetId);
      }
      input.value = '';
      input.closest('.mobile-field-dropdown')?.classList.add('hidden');

      // Reset flag after a short delay to allow for next insertion
      setTimeout(() => { isInserting = false; }, 100);
    };

    // Enter key (desktop + some mobile keyboards)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        insertNewField();
      }
    });

    // Change event (mobile Done/checkmark button)
    input.addEventListener('change', insertNewField);
  });

  // Shape properties
  $('#mobile-prop-shapeType')?.addEventListener('change', (e) => {
    updateProp('shapeType', e.target.value);
    populateMobileProps(); // Refresh to show/hide corner radius
  });
  $('#mobile-prop-fill')?.addEventListener('change', (e) => updateProp('fill', e.target.value));
  $('#mobile-prop-strokeWidth')?.addEventListener('change', (e) => updateProp('strokeWidth', parseInt(e.target.value)));
  $('#mobile-prop-cornerRadius')?.addEventListener('change', (e) => updateProp('cornerRadius', parseInt(e.target.value)));

  // 枠(#28)
  $('#mobile-prop-frameStyle')?.addEventListener('change', (e) => updateProp('frameStyle', e.target.value));
  $('#mobile-prop-frameShape')?.addEventListener('change', (e) => updateProp('frameShape', e.target.value));
  $('#mobile-prop-frameStroke')?.addEventListener('change', (e) => updateProp('strokeWidth', clampInt(e.target.value, 1, 20, 3)));
  $('#mobile-prop-frameMargin')?.addEventListener('change', (e) => {
    updateProp('frameMargin', clampInt(e.target.value, 0, 80, 8));
    if (element.fitToLabel && refitFramesToLabel()) render();
  });
  $('#mobile-prop-frameFit')?.addEventListener('change', (e) => {
    updateProp('fitToLabel', e.target.checked);
    if (e.target.checked && refitFramesToLabel()) { render(); updatePropertiesPanel(); }
  });

  // Stroke buttons
  $$('[data-stroke]').forEach(btn => {
    btn.addEventListener('click', () => {
      updateProp('stroke', btn.dataset.stroke);
      populateMobileProps();
    });
  });

  // Image properties - use live update for sliders
  // #26 トリミング・反転
  $('#mobile-prop-crop')?.addEventListener('click', () => openImageCrop(element.id));
  $('#mobile-prop-ai-bw')?.addEventListener('click', () => openAiBinarize(element.id));
  $('#mobile-prop-crop-clear')?.addEventListener('click', () => applyImageCrop(element.id, null));
  $('#mobile-prop-flipX')?.addEventListener('click', () => toggleImageFlip(element.id, 'flipX'));
  $('#mobile-prop-flipY')?.addEventListener('click', () => toggleImageFlip(element.id, 'flipY'));

  const scaleInput = $('#mobile-prop-scale');
  if (scaleInput && element.naturalWidth && element.naturalHeight) {
    scaleInput.addEventListener('input', (e) => {
      const scale = parseInt(e.target.value) / 100;
      const lockRatio = element.lockAspectRatio !== false;
      const base = getImageBaseSize(element);
      if (lockRatio) {
        element.width = base.width * scale;
        element.height = base.height * scale;
      } else {
        element.width = base.width * scale;
      }
      state.renderer.clearCache(element.id);
      autoCloneIfEnabled();
      render();
    });
    scaleInput.addEventListener('change', saveOnBlur('width'));
  }
  $('#mobile-prop-lockRatio')?.addEventListener('change', (e) => updateProp('lockAspectRatio', e.target.checked));

  const brightnessInput = $('#mobile-prop-brightness');
  if (brightnessInput) {
    brightnessInput.addEventListener('input', (e) => updatePropLive('brightness', parseInt(e.target.value)));
    brightnessInput.addEventListener('change', saveOnBlur('brightness'));
  }
  const contrastInput = $('#mobile-prop-contrast');
  if (contrastInput) {
    contrastInput.addEventListener('input', (e) => updatePropLive('contrast', parseInt(e.target.value)));
    contrastInput.addEventListener('change', saveOnBlur('contrast'));
  }
  $('#mobile-prop-dither')?.addEventListener('change', (e) => updateProp('dither', e.target.value));
}

/**
 * Update mobile UI state (selection actions, properties sync)
 */
function updateMobileUI() {
  if (!state.mobile.isMobile) return;

  // Show/hide selection actions row
  const selectionRow = $('#mobile-selection-row');
  if (selectionRow) {
    selectionRow.classList.toggle('hidden', state.selectedIds.length === 0);
  }

  // Sync undo/redo button states
  const undoBtn = $('#mobile-undo-btn');
  const redoBtn = $('#mobile-redo-btn');
  if (undoBtn) undoBtn.disabled = state.historyIndex < 0;
  if (redoBtn) redoBtn.disabled = state.historyIndex >= state.history.length - 1;

  // Sync mobile label size selector with desktop
  syncMobileLabelSize();

  // Note: Don't auto-rebuild mobile props panel here - it causes keyboard dismissal during typing
}

/**
 * Sync mobile label size selector and custom inputs with desktop state
 */
function syncMobileLabelSize() {
  const mobileLabelSize = $('#mobile-label-size');
  const desktopLabelSize = $('#label-size');
  const mobileCustomSize = $('#mobile-custom-size');

  if (!mobileLabelSize || !desktopLabelSize) return;

  // Sync selector value
  mobileLabelSize.value = desktopLabelSize.value;

  // Show/hide custom inputs
  if (desktopLabelSize.value === 'custom') {
    mobileCustomSize?.classList.remove('hidden');
    // Sync custom values
    const mobileW = $('#mobile-custom-width');
    const mobileH = $('#mobile-custom-height');
    const mobileRound = $('#mobile-custom-round');
    const mobileContinuous = $('#mobile-custom-continuous');
    if (mobileW) mobileW.value = $('#custom-width')?.value || '';
    if (mobileH) mobileH.value = $('#custom-height')?.value || '';
    if (mobileRound) mobileRound.checked = $('#custom-round')?.checked || false;
    if (mobileContinuous) mobileContinuous.checked = $('#custom-continuous')?.checked || false;
    // Update visibility based on round
    const isRound = mobileRound?.checked;
    if (mobileH) {
      mobileH.classList.toggle('hidden', isRound);
      mobileH.previousElementSibling?.classList.toggle('hidden', isRound);
    }
  } else {
    mobileCustomSize?.classList.add('hidden');
  }
}

// =============================================================================
// PRINTER DEFINITIONS UI
// =============================================================================

/**
 * Populate the printer model dropdown from loaded definitions
 */
function populatePrinterModelDropdown() {
  const defs = getAllPrinterDefinitions();
  // Group by group name
  const groups = {};
  for (const def of defs) {
    const group = def.group || t('other');
    if (!groups[group]) groups[group] = [];
    groups[group].push(def);
  }

  // Populate both the print settings dropdown and the model prompt dropdown
  const selects = [
    { el: $('#printer-model'), keepFirst: true },
    { el: $('#prompt-model-select'), keepFirst: true },
  ];

  for (const { el: select, keepFirst } of selects) {
    if (!select) continue;
    const currentValue = select.value;

    // Clear all options except the first
    while (select.options.length > (keepFirst ? 1 : 0)) {
      select.remove(keepFirst ? 1 : 0);
    }
    // Remove any optgroups
    select.querySelectorAll('optgroup').forEach(g => g.remove());

    for (const [groupName, printers] of Object.entries(groups)) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = printerGroupLabel(groupName);
      for (const def of printers) {
        const opt = document.createElement('option');
        opt.value = def.id;
        const widthMm = def.widthBytes ? Math.round(def.widthBytes * 8 / 8) : null;
        const dpiNote = def.dpi === 300 ? ', 300 DPI' : '';
        opt.textContent = def.name + (widthMm ? ` (${widthMm}mm${dpiNote})` : '') + (!def.builtin ? ' *' : '');
        optgroup.appendChild(opt);
      }
      select.appendChild(optgroup);
    }

    // Restore selection
    select.value = currentValue;
    // If saved value is no longer valid, fall back
    if (!select.value || select.selectedIndex === -1) {
      select.selectedIndex = 0;
    }
  }
}

/**
 * Initialize the Printer Definitions Manager dialog
 */
function initPrinterDefsManager() {
  const dialog = $('#printer-defs-dialog');
  const list = $('#printer-defs-list');
  const editor = $('#printer-def-editor');
  const editorTitle = $('#printer-def-editor-title');
  if (!dialog || !list || !editor) return;

  let editingId = null; // null = new, string = editing existing

  // Populate protocol and label preset dropdowns in editor
  const protocolSelect = $('#pdef-protocol');
  const labelPresetsSelect = $('#pdef-label-presets');
  if (protocolSelect) {
    protocolSelect.innerHTML = '';
    for (const p of getAvailableProtocols()) {
      const opt = document.createElement('option');
      opt.value = p.value;
      opt.textContent = p.label;
      protocolSelect.appendChild(opt);
    }
  }
  if (labelPresetsSelect) {
    labelPresetsSelect.innerHTML = '';
    for (const p of getAvailableLabelPresets()) {
      const opt = document.createElement('option');
      opt.value = p.value;
      opt.textContent = p.label;
      labelPresetsSelect.appendChild(opt);
    }
  }

  // Width info helper
  const widthInput = $('#pdef-width');
  const widthInfo = $('#pdef-width-info');
  if (widthInput && widthInfo) {
    widthInput.addEventListener('input', () => {
      const bytes = parseInt(widthInput.value);
      if (bytes > 0) {
        const px = bytes * 8;
        const mm = bytes; // 8px/mm at 203 DPI ~ 1 byte/mm
        widthInfo.textContent = `= ${px}px = ~${mm}mm`;
      } else {
        widthInfo.textContent = '';
      }
    });
  }

  // Tape toggle
  const tapeSelect = $('#pdef-tape');
  const tapeOptions = $('#pdef-tape-options');
  if (tapeSelect && tapeOptions) {
    tapeSelect.addEventListener('change', () => {
      tapeOptions.classList.toggle('hidden', tapeSelect.value !== 'true');
    });
  }

  function renderList() {
    list.innerHTML = '';
    const defs = getAllPrinterDefinitions();
    const customs = getCustomPrinterDefinitions();
    const customIds = new Set(customs.map(d => d.id));

    for (const def of defs) {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between px-3 py-2 hover:bg-gray-50 cursor-pointer';

      const isCustomized = customIds.has(def.id) && isBuiltinPrinter(def.id);
      const isUserCreated = !isBuiltinPrinter(def.id);
      const badge = isUserCreated ? `<span class="ml-1 text-xs bg-blue-100 text-blue-700 px-1 rounded">${t('badge_custom')}</span>`
        : isCustomized ? `<span class="ml-1 text-xs bg-amber-100 text-amber-700 px-1 rounded">${t('badge_modified')}</span>`
        : '';

      row.innerHTML = `
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-gray-800 truncate">${def.name}${badge}</div>
          <div class="text-xs text-gray-400 truncate">${def.description || def.protocol}</div>
        </div>
        <div class="flex gap-1 ml-2 shrink-0">
          <button class="pdef-edit-btn text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded" data-id="${def.id}">${t('edit')}</button>
          ${isUserCreated ? `<button class="pdef-delete-btn text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded" data-id="${def.id}">${t('delete')}</button>` : ''}
          ${isCustomized ? `<button class="pdef-reset-btn text-xs px-2 py-1 text-amber-600 hover:bg-amber-50 rounded" data-id="${def.id}">${t('reset')}</button>` : ''}
        </div>
      `;
      list.appendChild(row);
    }

    // Bind edit buttons
    list.querySelectorAll('.pdef-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditor(btn.dataset.id);
      });
    });

    // Bind delete buttons
    list.querySelectorAll('.pdef-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(t('confirm_delete_printer', { id: btn.dataset.id }))) {
          deleteCustomPrinterDefinition(btn.dataset.id);
          renderList();
          populatePrinterModelDropdown();
        }
      });
    });

    // Bind reset buttons
    list.querySelectorAll('.pdef-reset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(t('confirm_reset_printer', { id: btn.dataset.id }))) {
          resetBuiltinPrinter(btn.dataset.id);
          renderList();
          populatePrinterModelDropdown();
        }
      });
    });
  }

  function openEditor(id) {
    editingId = id || null;
    editor.classList.remove('hidden');

    const def = id ? getPrinterDefinition(id) : null;
    editorTitle.textContent = def ? t('edit_printer_title', { name: def.name }) : t('new_printer_definition');

    const idInput = $('#pdef-id');
    idInput.value = def?.id || '';
    idInput.disabled = !!id; // Can't change id of existing definition

    $('#pdef-name').value = def?.name || '';
    $('#pdef-group').value = def?.group || t('custom_printers_group');
    $('#pdef-description').value = def?.description || '';
    protocolSelect.value = def?.protocol || 'm-series';
    $('#pdef-dpi').value = def?.dpi || 203;
    $('#pdef-width').value = def?.widthBytes ?? '';
    widthInput.dispatchEvent(new Event('input')); // Update info text
    $('#pdef-alignment').value = def?.alignment || 'center';
    $('#pdef-rotated').value = def?.rotated ? 'true' : 'false';
    labelPresetsSelect.value = def?.labelPresets || 'm-series';
    tapeSelect.value = def?.tape ? 'true' : 'false';
    tapeOptions.classList.toggle('hidden', !def?.tape);
    $('#pdef-tape-widths').value = def?.tapeWidths ? def.tapeWidths.join(', ') : '';
    $('#pdef-default-tape-width').value = def?.defaultTapeWidth || '';
    $('#pdef-patterns').value = def?.namePatterns ? def.namePatterns.join(', ') : '';
  }

  function closeEditor() {
    editor.classList.add('hidden');
    editingId = null;
  }

  function saveEditor() {
    const id = $('#pdef-id').value.trim().toLowerCase().replace(/[^a-z0-9\-]/g, '-');
    const name = $('#pdef-name').value.trim();

    if (!id) { alert(t('alert_id_required')); return; }
    if (!name) { alert(t('alert_name_required')); return; }

    // Check for id collision when creating new
    if (!editingId && getPrinterDefinition(id)) {
      alert(t('alert_printer_id_exists', { id }));
      return;
    }

    const tapeWidthsRaw = $('#pdef-tape-widths').value.trim();
    const tapeWidths = tapeWidthsRaw ? tapeWidthsRaw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0) : null;

    const patternsRaw = $('#pdef-patterns').value.trim();
    const patterns = patternsRaw ? patternsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

    const widthVal = $('#pdef-width').value.trim();

    const def = {
      id: editingId || id,
      name,
      group: $('#pdef-group').value.trim() || t('custom_printers_group'),
      description: $('#pdef-description').value.trim(),
      protocol: protocolSelect.value,
      widthBytes: widthVal === '' ? null : parseInt(widthVal),
      dpi: parseInt($('#pdef-dpi').value),
      alignment: $('#pdef-alignment').value,
      rotated: $('#pdef-rotated').value === 'true',
      tape: tapeSelect.value === 'true',
      tapeWidths: tapeSelect.value === 'true' ? tapeWidths : null,
      defaultTapeWidth: tapeSelect.value === 'true' ? (parseInt($('#pdef-default-tape-width').value) || null) : null,
      namePatterns: patterns,
      labelPresets: labelPresetsSelect.value,
      builtin: false,
    };

    saveCustomPrinterDefinition(def);
    closeEditor();
    renderList();
    populatePrinterModelDropdown();
  }

  // Open manager
  $('#manage-printers-btn')?.addEventListener('click', () => {
    renderList();
    closeEditor();
    dialog.classList.remove('hidden');
  });

  // Close manager
  $('#printer-defs-close')?.addEventListener('click', () => {
    dialog.classList.add('hidden');
  });

  // Close on backdrop click
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.classList.add('hidden');
  });

  // Add new
  $('#printer-def-add')?.addEventListener('click', () => openEditor(null));

  // Cancel editor
  $('#printer-def-cancel')?.addEventListener('click', closeEditor);

  // Save editor
  $('#printer-def-save')?.addEventListener('click', saveEditor);
}

/**
 * Initialize the application
 */
function init() {
  if (!checkCompatibility()) {
    return;
  }

  // Configure error handlers
  configureErrorHandlers({
    setStatus: setStatus,
  });

  // Japanese font presets (#23)
  initJapaneseFonts();

  // Initialize local fonts (show button or auto-load if previously enabled)
  initLocalFonts();

  // Counter settings (#31)
  initCounterSettings();
  initSpreadsheetMerge();
  initVariables();

  // 印刷の横位置の補正(プリンターごと)
  initPrintOffsetUI({
    getDeviceName: () => (state.transport?.isConnected?.() ? (state.transport.getDeviceName?.() || '') : ''),
  });

  // Load printer definitions (built-in + custom) then populate dropdown
  loadPrinterDefinitions().then(() => {
    populatePrinterModelDropdown();
    initPrinterDefsManager();
    // Restore saved printer model selection
    const savedPrintSettings = safeStorageGet('phomymo_print_settings');
    if (savedPrintSettings) {
      const settings = safeJsonParse(savedPrintSettings, null);
      if (settings && settings.printerModel) {
        $('#printer-model').value = settings.printerModel;
      }
    }
  });

  // Create canvas renderer
  const canvas = $('#preview-canvas');
  state.renderer = new CanvasRenderer(canvas);
  // ラベルの大きさが変わったら、「ラベルに合わせる」枠を合わせ直す(#28)
  // (ズームでも呼ばれるので、ラベルの大きさが本当に変わったときだけ動かす)
  let lastLabelDims = '';
  state.renderer.onDimensionsChange = () => {
    const d = state.renderer.getSingleLabelDimensions();
    const key = `${d.width}x${d.height}:${state.renderer.isRound ? 'r' : ''}`;
    if (key === lastLabelDims) return;
    const roundChanged = lastLabelDims !== '' && lastLabelDims.endsWith(':r') !== key.endsWith(':r');
    lastLabelDims = key;
    if (refitFramesToLabel({ syncShape: roundChanged })) requestAnimationFrame(() => { render(); updatePropertiesPanel(); });
  };
  state.renderer.setDimensions(state.labelSize.width, state.labelSize.height, state.zoom, state.labelSize.round || false);
  // Re-render when async content (barcodes, QR codes) finishes loading
  // Use requestAnimationFrame to batch multiple async loads
  let asyncRenderPending = false;
  state.renderer.onAsyncLoad = () => {
    if (!asyncRenderPending) {
      asyncRenderPending = true;
      requestAnimationFrame(() => {
        asyncRenderPending = false;
        render();
      });
    }
  };
  updatePrintSize();

  // Label size
  $('#label-size').addEventListener('change', handleLabelSizeChange);
  $('#custom-width').addEventListener('change', handleCustomSizeChange);
  $('#custom-height').addEventListener('change', handleCustomSizeChange);
  $('#custom-round').addEventListener('change', handleCustomSizeChange);
  $('#custom-continuous')?.addEventListener('change', handleCustomSizeChange);

  // P12/A30 label length adjust buttons
  $('#length-plus')?.addEventListener('click', () => adjustLabelLength(5));
  $('#length-minus')?.addEventListener('click', () => adjustLabelLength(-5));
  $('#mobile-length-plus')?.addEventListener('click', () => adjustLabelLength(5));
  $('#mobile-length-minus')?.addEventListener('click', () => adjustLabelLength(-5));

  // Tape width selector (for P12/A30 tape printers)
  $('#tape-width')?.addEventListener('change', (e) => {
    setTapeWidth(parseInt(e.target.value, 10));
  });
  $('#mobile-tape-width')?.addEventListener('change', (e) => {
    setTapeWidth(parseInt(e.target.value, 10));
  });

  // Connection type
  const connType = $('#conn-type');
  if (!('usb' in navigator)) {
    const usbOption = connType.querySelector('option[value="usb"]');
    if (usbOption) usbOption.remove();
  }
  connType.addEventListener('change', (e) => {
    state.connectionType = e.target.value;
    const btn = $('#connect-btn');
    btn.textContent = t('connect');
    btn.classList.remove('bg-green-100', 'text-green-800', 'border-green-300');
    btn.classList.add('bg-white', 'hover:bg-gray-50');
    updateConnectionStatus(false);
    // Reset to M-series sizes when disconnecting/changing connection
    updateLabelSizeDropdown('', 'auto');
    updateLengthAdjustButtons();
  });

  // Info dialog
  $('#info-btn').addEventListener('click', showInfoDialog);
  $('#info-close').addEventListener('click', hideInfoDialog);
  $('#info-get-started')?.addEventListener('click', hideInfoDialog);
  $('#info-dialog').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideInfoDialog();
  });

  // Keyboard shortcuts modal
  $('#shortcuts-close').addEventListener('click', hideShortcutsModal);
  $('#shortcuts-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideShortcutsModal();
  });

  // Multi-label modal
  $('#multi-label-close').addEventListener('click', hideMultiLabelModal);
  $('#multi-label-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideMultiLabelModal();
  });
  $('#multi-label-apply').addEventListener('click', applyMultiLabelConfig);
  $('#multi-label-save-preset').addEventListener('click', saveMultiLabelPreset);
  $('#multi-label-delete-preset').addEventListener('click', deleteMultiLabelPreset);
  $('#multi-label-preset').addEventListener('change', (e) => {
    if (e.target.value) {
      loadMultiLabelPreset(e.target.value);
    } else {
      $('#multi-label-delete-preset').classList.add('hidden');
    }
  });

  // Multi-label input updates
  $('#multi-label-width').addEventListener('input', updateMultiLabelPreview);
  $('#multi-label-height').addEventListener('input', updateMultiLabelPreview);
  $('#multi-label-count').addEventListener('input', updateMultiLabelPreview);
  $('#multi-label-gap').addEventListener('input', updateMultiLabelPreview);

  // Zone toolbar controls
  $('#clone-to-all-btn').addEventListener('click', cloneToAllZones);
  $('#zone-clone-mode').addEventListener('change', (e) => {
    state.multiLabel.cloneMode = e.target.checked;
  });
  $('#exit-multi-label-btn').addEventListener('click', exitMultiLabelMode);

  // Connect and print
  $('#connect-btn').addEventListener('click', handleConnect);
  $('#print-btn').addEventListener('click', handlePrint);

  // Printer info popup
  const printerInfoPopup = $('#printer-info-popup');
  const printerInfoBtn = $('#printer-info-btn');

  printerInfoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = printerInfoPopup.classList.contains('hidden');
    if (isHidden) {
      // Position popup below the button
      const rect = printerInfoBtn.getBoundingClientRect();
      printerInfoPopup.style.top = `${rect.bottom + 8}px`;
      printerInfoPopup.style.right = `${window.innerWidth - rect.right}px`;
      printerInfoPopup.classList.remove('hidden');
    } else {
      printerInfoPopup.classList.add('hidden');
    }
  });

  $('#printer-info-refresh').addEventListener('click', async () => {
    if (state.transport?.isConnected() && state.transport.queryAll) {
      try {
        setStatus(t('status_querying_printer'));
        await state.transport.queryAll();
        setStatus(t('status_printer_info_updated'));
      } catch (e) {
        console.warn('Failed to query printer:', e.message);
        setStatus(t('status_query_failed'));
      }
    }
  });

  $('#printer-info-disconnect').addEventListener('click', async () => {
    printerInfoPopup.classList.add('hidden');
    if (state.transport) {
      try {
        await state.transport.disconnect();
      } catch (e) {
        console.warn('Disconnect error:', e.message);
      }
      state.transport = null;
    }
    updateConnectionStatus(false);
    setStatus(t('status_disconnected'));
  });

  // Close popup when clicking outside
  document.addEventListener('click', (e) => {
    if (!printerInfoPopup.contains(e.target) && !printerInfoBtn.contains(e.target)) {
      printerInfoPopup.classList.add('hidden');
    }
  });

  // Print settings dialog
  const printSettingsDialog = $('#print-settings-dialog');
  const densitySlider = $('#print-density');
  const densityValue = $('#print-density-value');
  const copiesInput = $('#print-copies');
  const feedSelect = $('#print-feed');
  const printerModelSelect = $('#printer-model');

  // Load saved print settings from localStorage
  const savedPrintSettings = safeStorageGet('phomymo_print_settings');
  if (savedPrintSettings) {
    const settings = safeJsonParse(savedPrintSettings, null);
    if (settings) {
      // Migrate old printerModel values to new format
      if (settings.printerModel === 'narrow') {
        settings.printerModel = 'narrow-48';
      } else if (settings.printerModel === 'wide') {
        settings.printerModel = 'wide-72';
      }
      state.printSettings = { ...state.printSettings, ...settings };
      densitySlider.value = state.printSettings.density;
      densityValue.textContent = state.printSettings.density;
      copiesInput.value = state.printSettings.copies;
      feedSelect.value = state.printSettings.feed;
      printerModelSelect.value = state.printSettings.printerModel || 'auto';
    }
  }

  // Dither preview toggle (shows exact print output for all elements)
  const ditherPreviewBtn = $('#dither-preview-btn');
  const updatePreviewButtonState = () => {
    const mobileBtn = $('#mobile-dither-preview-btn');
    if (state.ditherPreview) {
      ditherPreviewBtn?.classList.remove('bg-gray-100', 'text-gray-700');
      ditherPreviewBtn?.classList.add('bg-blue-500', 'text-white');
      mobileBtn?.classList.remove('bg-gray-100', 'text-gray-700');
      mobileBtn?.classList.add('bg-blue-500', 'text-white');
    } else {
      ditherPreviewBtn?.classList.remove('bg-blue-500', 'text-white');
      ditherPreviewBtn?.classList.add('bg-gray-100', 'text-gray-700');
      mobileBtn?.classList.remove('bg-blue-500', 'text-white');
      mobileBtn?.classList.add('bg-gray-100', 'text-gray-700');
    }
  };

  ditherPreviewBtn?.addEventListener('click', () => {
    state.ditherPreview = !state.ditherPreview;
    state.renderer.setDitherPreview(state.ditherPreview);
    updatePreviewButtonState();
    setStatus(state.ditherPreview ? t('status_preview_on') : t('status_preview_off'));
    render();
  });

  $('#print-settings-btn').addEventListener('click', () => {
    // Update dialog with current values
    densitySlider.value = state.printSettings.density;
    densityValue.textContent = state.printSettings.density;
    copiesInput.value = state.printSettings.copies;
    feedSelect.value = state.printSettings.feed;
    printerModelSelect.value = state.printSettings.printerModel || 'auto';
    updateCounterUI();
    loadPrintRotationUI();
    printSettingsDialog.classList.remove('hidden');
  });

  $('#print-settings-close').addEventListener('click', () => {
    printSettingsDialog.classList.add('hidden');
  });

  densitySlider.addEventListener('input', (e) => {
    densityValue.textContent = e.target.value;
  });

  $('#print-settings-reset').addEventListener('click', () => {
    state.printSettings = { density: 6, copies: 1, feed: 32, printerModel: 'auto' };
    densitySlider.value = 6;
    densityValue.textContent = '6';
    copiesInput.value = 1;
    feedSelect.value = 32;
    printerModelSelect.value = 'auto';
    $('#print-rotation-design').value = ROTATION_FOLLOW_DEVICE;
    $('#print-rotation-device').value = '0';
    updatePrintRotationTexts();
  });

  $('#print-rotation-design').addEventListener('change', updatePrintRotationTexts);
  $('#print-rotation-device').addEventListener('change', updatePrintRotationTexts);

  $('#print-settings-save').addEventListener('click', () => {
    state.printSettings.density = parseInt(densitySlider.value);
    state.printSettings.copies = Math.max(PRINT.MIN_COPIES, Math.min(PRINT.MAX_COPIES, parseInt(copiesInput.value) || PRINT.DEFAULT_COPIES));
    state.printSettings.feed = parseInt(feedSelect.value);
    state.printSettings.printerModel = printerModelSelect.value;
    savePrintRotationUI();
    updateTemplateIndicator(); // 差し込み印刷パネルの「印刷 (N部)」

    // Save to localStorage
    safeStorageSet('phomymo_print_settings', safeJsonStringify(state.printSettings));

    // Update UI based on printer model (for P12 length buttons and label sizes)
    const deviceName = state.transport?.getDeviceName?.() || '';
    updateLabelSizeDropdown(deviceName, state.printSettings.printerModel);
    updateLengthAdjustButtons();

    printSettingsDialog.classList.add('hidden');
    setStatus(t('status_print_settings_saved'));
  });

  // Close dialog on backdrop click
  printSettingsDialog.addEventListener('click', (e) => {
    if (e.target === printSettingsDialog) {
      printSettingsDialog.classList.add('hidden');
    }
  });

  // Density test button
  $('#print-density-test').addEventListener('click', async () => {
    const btn = $('#print-density-test');
    const originalText = btn.innerHTML;

    try {
      // Ensure connected
      if (!state.transport || !state.transport.isConnected()) {
        printSettingsDialog.classList.add('hidden');
        setStatus(t('connecting'));
        await handleConnect();

        if (!state.transport || !state.transport.isConnected()) {
          throw new Error(t('error_connect_first'));
        }
      }

      // 何段階を印刷するか(既定: 今の濃さとその前後)
      const range = $('#density-test-range')?.value || DEFAULT_DENSITY_TEST_RANGE;
      const { feed, printerModel } = state.printSettings;
      // 保存前でも、画面のつまみで選んでいる濃さを基準にする
      const currentDensity = Number($('#print-density')?.value) || state.printSettings.density;
      const levels = densityTestLevels(currentDensity, range);

      btn.disabled = true;
      btn.textContent = t('btn_printing_test');
      printSettingsDialog.classList.add('hidden');
      setStatus(t('status_density_test_printing', { n: levels.length }));

      const deviceName = state.transport.getDeviceName?.() || '';
      const printerWidth = getPrinterWidthBytes(deviceName, printerModel);
      const printerDpi = getPrinterDpi(deviceName, printerModel);
      const printerAlignment = getPrinterAlignment(deviceName, printerModel);
      // 見本は1枚目のラベル(複数面のときは左端)の大きさに合わせる
      const ml = state.renderer.multiLabel;
      const labelW = ml?.enabled ? ml.labelWidth : state.renderer.labelWidth;
      const labelH = ml?.enabled ? ml.labelHeight : state.renderer.labelHeight;

      const buildRaster = async (density) => {
        const elements = buildDensityTestElements(density, {
          width: labelW,
          height: labelH,
          title: t('density_test_label_title', { n: density }),
          isCurrent: density === currentDensity,
        });
        // 複数面のときは、横に並んだラベル全部に同じ見本を入れる
        const zones = ml?.enabled ? (ml.zones?.length || 1) : 1;
        const allElements = [];
        for (let z = 0; z < zones; z++) {
          elements.forEach(el => allElements.push({ ...el, id: `${el.id}_z${z}`, zone: z }));
        }
        await waitForElementFonts(allElements);
        // 網かけの見え方を比べたいので、ディザは掛けずにそのまま白黒にする
        return isRotatedPrinter(deviceName, printerModel)
          ? state.renderer.getRasterDataRaw(allElements, 'threshold', currentPrintRotation())
          : state.renderer.getRasterData(allElements, printerWidth, printerDpi, 'threshold', printerAlignment, currentPrintRotation());
      };

      let labelIndex = 0;
      await printDensityTest(state.transport, {
        levels,
        buildRaster,
        isBLE: state.connectionType === 'ble',
        deviceName,
        printerModel,
        feed,
        continuous: !!(state.labelSize?.continuous),
        onLabel: (i) => { labelIndex = i; },
        onProgress: (progress) => setStatus(t('status_density_test_progress', {
          n: labelIndex + 1, total: levels.length, progress,
        })),
      });

      setStatus(t('status_density_test_done', { from: levels[0], to: levels[levels.length - 1], current: currentDensity }));
    } catch (error) {
      logError(error, 'densityTest');
      setStatus(error.message || t('status_density_test_failed'));
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

  // Add element buttons
  $('#add-text').addEventListener('click', addTextElement);
  $('#add-image').addEventListener('click', () => $('#image-file-input').click());
  $('#image-file-input').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      addImageElement(e.target.files[0]);  // Validation inside function
      e.target.value = '';
    }
  });
  $('#add-barcode').addEventListener('click', addBarcodeElement);
  $('#add-qr').addEventListener('click', addQRElement);

  // Shape dropdown toggle
  $('#add-shape-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#shape-dropdown').classList.toggle('hidden');
  });

  // Shape options
  $$('.shape-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const shapeType = btn.dataset.shape;
      addShapeElement(shapeType);
      $('#shape-dropdown').classList.add('hidden');
    });
  });

  // Close shape dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#add-shape-btn') && !e.target.closest('#shape-dropdown')) {
      $('#shape-dropdown').classList.add('hidden');
    }
  });

  // Element actions
  $('#duplicate-btn').addEventListener('click', () => {
    const selected = getSelected();
    if (selected) {
      saveHistory();
      state.elements = duplicateElement(state.elements, selected.id);
      autoCloneIfEnabled();
      selectElement(state.elements[state.elements.length - 1].id);
      setStatus(t('status_element_duplicated'));
    }
  });

  $('#delete-btn').addEventListener('click', () => {
    const selected = getSelected();
    if (selected) {
      saveHistory();
      state.renderer.clearCache(selected.id);
      state.elements = deleteElement(state.elements, selected.id);
      autoCloneIfEnabled();
      deselect();
      setStatus(t('status_element_deleted'));
    }
  });

  // Undo/Redo buttons
  $('#undo-btn').addEventListener('click', undo);
  $('#redo-btn').addEventListener('click', redo);

  $('#bring-front').addEventListener('click', () => {
    if (state.selectedIds.length > 0) {
      saveHistory();
      // Bring all selected elements to front (in order)
      state.selectedIds.forEach(id => {
        state.elements = bringToFront(state.elements, id);
      });
      render();
    }
  });

  $('#send-back').addEventListener('click', () => {
    if (state.selectedIds.length > 0) {
      saveHistory();
      // Send all selected elements to back (in reverse order)
      [...state.selectedIds].reverse().forEach(id => {
        state.elements = sendToBack(state.elements, id);
      });
      render();
    }
  });

  // Group/Ungroup
  $('#group-btn').addEventListener('click', handleGroup);
  $('#ungroup-btn').addEventListener('click', handleUngroup);

  // Save/Load
  $('#save-btn').addEventListener('click', showSaveDialog);
  $('#save-cancel').addEventListener('click', hideSaveDialog);
  $('#save-confirm').addEventListener('click', handleSave);
  $('#save-overwrite').addEventListener('click', handleOverwriteSave);
  $('#save-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSave();
  });
  // 名前を変えたら「すでにあります」の確認はやり直し
  $('#save-name').addEventListener('input', () => {
    if ($('#save-name-exists').dataset.name) resetSaveNameExists();
  });

  $('#load-btn').addEventListener('click', showLoadDialog);
  $('#load-cancel').addEventListener('click', hideLoadDialog);

  // Import from file
  $('#import-file-btn').addEventListener('click', () => $('#import-file-input').click());
  $('#import-file-input').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      handleImportFile(e.target.files[0]);  // Validation inside function
      e.target.value = '';
    }
  });

  // Export dropdown toggle
  $('#export-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#elements-dropdown').classList.add('hidden'); // Close other dropdown
    $('#export-dropdown').classList.toggle('hidden');
  });

  // Export options
  $('#export-json-btn').addEventListener('click', () => {
    $('#export-dropdown').classList.add('hidden');
    handleExport(); // existing JSON export
  });

  $('#export-pdf-btn').addEventListener('click', () => {
    $('#export-dropdown').classList.add('hidden');
    handleExportPDF();
  });

  $('#export-png-btn').addEventListener('click', () => {
    $('#export-dropdown').classList.add('hidden');
    handleExportPNG();
  });

  // Print progress cancel button
  $('#progress-cancel').addEventListener('click', () => {
    printProgressCancelled = true;
    $('#progress-subtitle').textContent = t('progress_cancelling');
  });

  // Elements dropdown
  $('#elements-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#export-dropdown').classList.add('hidden'); // Close other dropdown
    updateElementsList();
    $('#elements-dropdown').classList.toggle('hidden');
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#elements-btn') && !e.target.closest('#elements-dropdown')) {
      $('#elements-dropdown').classList.add('hidden');
    }
    if (!e.target.closest('#export-btn') && !e.target.closest('#export-dropdown')) {
      $('#export-dropdown').classList.add('hidden');
    }
  });

  // Zoom controls
  $('#zoom-in').addEventListener('click', zoomIn);
  $('#zoom-out').addEventListener('click', zoomOut);
  $('#zoom-reset').addEventListener('click', zoomReset);

  // Mobile properties panel toggle
  const propsPanel = $('#props-panel');
  const propsBackdrop = $('#props-backdrop');
  const propsToggle = $('#props-toggle');
  const propsClose = $('#props-close');

  function openPropsPanel() {
    propsPanel.classList.add('panel-open');
    propsBackdrop.classList.add('backdrop-visible');
  }

  function closePropsPanel() {
    propsPanel.classList.remove('panel-open');
    propsBackdrop.classList.remove('backdrop-visible');
  }

  if (propsToggle) {
    propsToggle.addEventListener('click', openPropsPanel);
  }
  if (propsClose) {
    propsClose.addEventListener('click', closePropsPanel);
  }
  if (propsBackdrop) {
    propsBackdrop.addEventListener('click', closePropsPanel);
  }

  // Properties panel - common position/dimension inputs (only works for single selection)
  bindPositionInputs({
    x: '#prop-x',
    y: '#prop-y',
    width: '#prop-width',
    height: '#prop-height',
    rotation: '#prop-rotation',
  }, createBindingContext(state, getSelected, modifyElement), {
    minWidth: ELEMENT.MIN_WIDTH,
    minHeight: ELEMENT.MIN_HEIGHT,
  });

  // ミラー配置(2つ折りシール用)
  $('#prop-mirror-axis')?.addEventListener('change', (e) => {
    const id = state.selectedIds[0];
    if (id) setElementMirror(id, e.target.value);
  });
  $('#prop-mirror-orient')?.addEventListener('change', (e) => {
    const element = getSelected();
    const m = element && normalizeMirror(element.mirror);
    if (m) setElementMirror(element.id, m.axis, e.target.value);
  });

  // Properties panel - text
  // Track input changes for history (saves on blur only if value changed)
  trackInputForHistory('#prop-text-content');
  $('#prop-text-content').addEventListener('input', (e) => {
    const id = state.selectedIds[0];
    if (id) modifyElement(id, { text: e.target.value });
  });
  trackInputForHistory('#prop-font-family');
  $('#prop-font-family').addEventListener('change', (e) => {
    const id = state.selectedIds[0];
    if (id) modifyElement(id, { fontFamily: e.target.value });
  });

  // Local fonts button
  $('#add-system-fonts-btn')?.addEventListener('click', async () => {
    await loadLocalFonts();
  });
  trackInputForHistory('#prop-font-size');
  $('#prop-font-size').addEventListener('input', (e) => {
    const id = state.selectedIds[0];
    if (id) modifyElement(id, { fontSize: validateFontSize(e.target.value) });
  });
  $$('.align-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = state.selectedIds[0];
      if (id) {
        modifyElement(id, { align: btn.dataset.align });
        $$('.align-btn').forEach(b => b.classList.toggle('bg-gray-100', b === btn));
      }
    });
  });

  // Vertical alignment buttons
  $$('.valign-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = state.selectedIds[0];
      if (id) {
        modifyElement(id, { verticalAlign: btn.dataset.valign });
        $$('.valign-btn').forEach(b => b.classList.toggle('bg-gray-100', b === btn));
      }
    });
  });

  // Create binding context for property panel controls
  const bindCtx = createBindingContext(state, getSelected, modifyElement);

  // === TEXT ELEMENT BINDINGS ===
  // Checkboxes
  bindCheckbox('#prop-no-wrap', 'noWrap', 'text', bindCtx);
  bindCheckbox('#prop-clip-overflow', 'clipOverflow', 'text', bindCtx);
  bindCheckbox('#prop-auto-scale', 'autoScale', 'text', bindCtx);
  initTextStylePanel(textStyleCtx); // #24 字間・曲線文字

  // Font style toggle buttons
  bindToggleButton('#style-bold', 'fontWeight', 'text', bindCtx);
  bindToggleButton('#style-italic', 'fontStyle', 'text', bindCtx);
  bindToggleButton('#style-underline', 'textDecoration', 'text', bindCtx);

  // Button groups
  bindButtonGroup('.bg-btn', 'background', 'bg', 'text', bindCtx);
  bindButtonGroup('.color-btn', 'color', 'color', 'text', bindCtx);

  // === SHAPE ELEMENT BINDINGS ===
  // Shape type dropdown (with special handling for corner radius visibility)
  bindSelect('#prop-shape-type', 'shapeType', 'shape', bindCtx, (value) => {
    $('#prop-corner-radius-group').classList.toggle('hidden', value !== 'rectangle');
  });

  // Shape fill and stroke
  bindSelect('#shape-fill', 'fill', 'shape', bindCtx);
  bindButtonGroup('.stroke-btn', 'stroke', 'stroke', 'shape', bindCtx);

  // Shape numeric inputs
  bindNumericInput('#prop-stroke-width', 'strokeWidth', 'shape', bindCtx, { min: 1, max: 20, defaultVal: 2 });
  bindNumericInput('#prop-corner-radius', 'cornerRadius', 'shape', bindCtx, { min: 0, max: 50, defaultVal: 0 });

  // === 枠(#28) ===
  const frameStyleSelect = $('#prop-frame-style');
  frameStyleSelect.innerHTML = FRAME_STYLES.map(fs => `<option value="${fs.id}">${frameStyleName(fs)}</option>`).join('');
  bindSelect('#prop-frame-style', 'frameStyle', 'frame', bindCtx);
  bindSelect('#prop-frame-shape', 'frameShape', 'frame', bindCtx);
  bindSelect('#prop-frame-color', 'color', 'frame', bindCtx);
  bindNumericInput('#prop-frame-stroke', 'strokeWidth', 'frame', bindCtx, { min: 1, max: 20, defaultVal: 3 });
  bindNumericInput('#prop-frame-margin', 'frameMargin', 'frame', bindCtx, { min: 0, max: 80, defaultVal: 8 });
  $('#prop-frame-margin').addEventListener('change', () => {
    if (refitFramesToLabel()) { render(); updatePropertiesPanel(); }
  });
  $('#prop-frame-fit').addEventListener('change', (e) => {
    const selected = getSelected();
    if (!selected || selected.type !== 'frame') return;
    saveHistory();
    modifyElement(selected.id, { fitToLabel: e.target.checked });
    if (e.target.checked && refitFramesToLabel()) { render(); updatePropertiesPanel(); }
  });

  // Properties panel - image
  $('#prop-replace-image').addEventListener('click', () => $('#prop-image-input').click());
  $('#prop-image-input').addEventListener('change', async (e) => {
    const id = state.selectedIds[0];
    const file = e.target.files[0];
    if (file && id) {
      // Validate file
      const validation = validateImageFile(file);
      if (!validation.valid) {
        setStatus(validation.error);
        e.target.value = '';
        return;
      }
      try {
        const { dataUrl } = await state.renderer.loadImageFile(file);
        // #26: 別の画像に差し替えたら、前の画像用の切り抜き範囲は外す
        modifyElement(id, { imageData: dataUrl, crop: null });
        setStatus(t('status_image_replaced'));
      } catch (err) {
        logError(err, 'replaceImage');
        setStatus(t('status_image_load_failed'));
      }
      e.target.value = '';
    }
  });

  // #26 トリミング・反転
  $('#prop-image-crop').addEventListener('click', () => {
    const element = getSelected();
    if (element && element.type === 'image') openImageCrop(element.id);
  });
  $('#prop-image-ai-bw')?.addEventListener('click', () => {
    const element = getSelected();
    if (element && element.type === 'image') openAiBinarize(element.id);
  });
  $('#prop-image-crop-clear').addEventListener('click', () => {
    const element = getSelected();
    if (element && element.type === 'image') applyImageCrop(element.id, null);
  });
  $('#prop-image-flip-x').addEventListener('click', () => {
    const element = getSelected();
    if (element && element.type === 'image') toggleImageFlip(element.id, 'flipX');
  });
  $('#prop-image-flip-y').addEventListener('click', () => {
    const element = getSelected();
    if (element && element.type === 'image') toggleImageFlip(element.id, 'flipY');
  });

  // Image scale slider
  const applyImageScale = (scalePercent) => {
    const element = getSelected();
    if (element && element.type === 'image') {
      const scale = scalePercent / 100;
      const base = getImageBaseSize(element);
      const newWidth = base.width * scale;
      const newHeight = base.height * scale;
      // Keep centered on current center point
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      modifyElement(element.id, {
        width: newWidth,
        height: newHeight,
        x: cx - newWidth / 2,
        y: cy - newHeight / 2,
      });
    }
  };

  // Track slider: save snapshot on mousedown, push to history on mouseup if changed
  let sliderSnapshot = null;
  $('#prop-image-scale').addEventListener('mousedown', () => {
    if (state.selectedIds[0]) {
      sliderSnapshot = JSON.parse(JSON.stringify(state.elements));
    }
  });
  $('#prop-image-scale').addEventListener('input', (e) => {
    const scale = parseInt(e.target.value);
    $('#prop-image-scale-input').value = scale;
    applyImageScale(scale);
  });
  $('#prop-image-scale').addEventListener('mouseup', () => {
    if (sliderSnapshot) {
      const currentState = JSON.stringify(state.elements);
      if (currentState !== JSON.stringify(sliderSnapshot)) {
        // Push old state to history
        if (state.historyIndex < state.history.length - 1) {
          state.history = state.history.slice(0, state.historyIndex + 1);
        }
        state.history.push(sliderSnapshot);
        if (state.history.length > HISTORY.MAX_SIZE) {
          state.history.shift();
        } else {
          state.historyIndex++;
        }
        updateUndoRedoButtons();
      }
      sliderSnapshot = null;
    }
  });

  trackInputForHistory('#prop-image-scale-input');
  $('#prop-image-scale-input').addEventListener('change', (e) => {
    const scale = Math.max(IMAGE.MIN_SCALE, Math.min(IMAGE.MAX_SCALE, parseInt(e.target.value) || IMAGE.DEFAULT_SCALE));
    $('#prop-image-scale').value = scale;
    $('#prop-image-scale-input').value = scale;
    applyImageScale(scale);
  });

  // Lock aspect ratio checkbox
  $('#prop-image-lock-ratio').addEventListener('change', (e) => {
    const element = getSelected();
    if (element && element.type === 'image') {
      saveHistory();
      modifyElement(element.id, { lockAspectRatio: e.target.checked });
    }
  });

  // Reset image to native size
  $('#prop-image-reset').addEventListener('click', () => {
    const element = getSelected();
    if (element && element.type === 'image') {
      saveHistory();
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      const base = getImageBaseSize(element);
      modifyElement(element.id, {
        width: base.width,
        height: base.height,
        x: cx - base.width / 2,
        y: cy - base.height / 2,
      });
      setStatus(t('status_image_reset'));
    }
  });

  // Dithering select
  $('#prop-image-dither').addEventListener('change', (e) => {
    const element = getSelected();
    if (element && element.type === 'image') {
      saveHistory();
      modifyElement(element.id, { dither: e.target.value });
    }
  });

  // Brightness slider
  let brightnessSnapshot = null;
  $('#prop-image-brightness').addEventListener('mousedown', () => {
    if (state.selectedIds[0]) {
      brightnessSnapshot = JSON.parse(JSON.stringify(state.elements));
    }
  });
  $('#prop-image-brightness').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    $('#prop-image-brightness-input').value = value;
    const element = getSelected();
    if (element && element.type === 'image') {
      modifyElement(element.id, { brightness: value });
    }
  });
  $('#prop-image-brightness').addEventListener('mouseup', () => {
    if (brightnessSnapshot) {
      const currentState = JSON.stringify(state.elements);
      if (currentState !== JSON.stringify(brightnessSnapshot)) {
        if (state.historyIndex < state.history.length - 1) {
          state.history = state.history.slice(0, state.historyIndex + 1);
        }
        state.history.push(brightnessSnapshot);
        if (state.history.length > HISTORY.MAX_SIZE) {
          state.history.shift();
        } else {
          state.historyIndex++;
        }
        updateUndoRedoButtons();
      }
      brightnessSnapshot = null;
    }
  });
  trackInputForHistory('#prop-image-brightness-input');
  $('#prop-image-brightness-input').addEventListener('change', (e) => {
    const value = Math.max(-100, Math.min(100, parseInt(e.target.value) || 0));
    $('#prop-image-brightness').value = value;
    $('#prop-image-brightness-input').value = value;
    const element = getSelected();
    if (element && element.type === 'image') {
      modifyElement(element.id, { brightness: value });
    }
  });

  // Contrast slider
  let contrastSnapshot = null;
  $('#prop-image-contrast').addEventListener('mousedown', () => {
    if (state.selectedIds[0]) {
      contrastSnapshot = JSON.parse(JSON.stringify(state.elements));
    }
  });
  $('#prop-image-contrast').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    $('#prop-image-contrast-input').value = value;
    const element = getSelected();
    if (element && element.type === 'image') {
      modifyElement(element.id, { contrast: value });
    }
  });
  $('#prop-image-contrast').addEventListener('mouseup', () => {
    if (contrastSnapshot) {
      const currentState = JSON.stringify(state.elements);
      if (currentState !== JSON.stringify(contrastSnapshot)) {
        if (state.historyIndex < state.history.length - 1) {
          state.history = state.history.slice(0, state.historyIndex + 1);
        }
        state.history.push(contrastSnapshot);
        if (state.history.length > HISTORY.MAX_SIZE) {
          state.history.shift();
        } else {
          state.historyIndex++;
        }
        updateUndoRedoButtons();
      }
      contrastSnapshot = null;
    }
  });
  trackInputForHistory('#prop-image-contrast-input');
  $('#prop-image-contrast-input').addEventListener('change', (e) => {
    const value = Math.max(-100, Math.min(100, parseInt(e.target.value) || 0));
    $('#prop-image-contrast').value = value;
    $('#prop-image-contrast-input').value = value;
    const element = getSelected();
    if (element && element.type === 'image') {
      modifyElement(element.id, { contrast: value });
    }
  });

  // Properties panel - barcode
  trackInputForHistory('#prop-barcode-data');
  $('#prop-barcode-data').addEventListener('input', (e) => {
    const id = state.selectedIds[0];
    if (!id) return;
    const selected = state.elements.find(el => el.id === id);
    const format = selected?.barcodeFormat || 'CODE128';
    const result = validateBarcodeData(e.target.value, format);
    if (!result.valid && e.target.value.length > 0) {
      e.target.classList.add('border-red-300');
      setStatus(result.error);
    } else {
      e.target.classList.remove('border-red-300');
    }
    modifyElement(id, { barcodeData: e.target.value });
  });
  trackInputForHistory('#prop-barcode-format');
  $('#prop-barcode-format').addEventListener('change', (e) => {
    const id = state.selectedIds[0];
    if (!id) return;
    modifyElement(id, { barcodeFormat: e.target.value });
    // Re-validate data with new format
    const dataInput = $('#prop-barcode-data');
    const result = validateBarcodeData(dataInput.value, e.target.value);
    if (!result.valid && dataInput.value.length > 0) {
      dataInput.classList.add('border-red-300');
      setStatus(result.error);
    } else {
      dataInput.classList.remove('border-red-300');
    }
  });

  // Show text checkbox
  $('#prop-barcode-showtext').addEventListener('change', (e) => {
    const element = getSelected();
    if (element && element.type === 'barcode') {
      saveHistory();
      modifyElement(element.id, { showText: e.target.checked });
      // Show/hide text options
      $('#barcode-text-options')?.classList.toggle('hidden', !e.target.checked);
    }
  });

  // Barcode text font size
  trackInputForHistory('#prop-barcode-fontsize');
  $('#prop-barcode-fontsize').addEventListener('change', (e) => {
    const element = getSelected();
    if (element && element.type === 'barcode') {
      const size = parseInt(e.target.value) || 12;
      modifyElement(element.id, { textFontSize: size });
    }
  });

  // Barcode text bold
  $('#prop-barcode-bold').addEventListener('change', (e) => {
    const element = getSelected();
    if (element && element.type === 'barcode') {
      saveHistory();
      modifyElement(element.id, { textBold: e.target.checked });
    }
  });

  // Properties panel - QR
  trackInputForHistory('#prop-qr-data');
  $('#prop-qr-data').addEventListener('input', (e) => {
    const id = state.selectedIds[0];
    if (!id) return;
    const result = validateQRData(e.target.value);
    if (!result.valid && e.target.value.length > 0) {
      e.target.classList.add('border-red-300');
      setStatus(result.error);
    } else {
      e.target.classList.remove('border-red-300');
    }
    modifyElement(id, { qrData: e.target.value });
  });


  // Canvas pointer events (for mouse and non-iOS touch)
  canvas.addEventListener('pointerdown', handleCanvasPointerDown, { passive: false });
  canvas.addEventListener('pointermove', handleCanvasPointerMove, { passive: false });
  canvas.addEventListener('pointerup', handleCanvasPointerUp);
  canvas.addEventListener('pointercancel', handleCanvasPointerCancel);
  canvas.addEventListener('pointerleave', handleCanvasPointerUp);

  // Touch events as fallback for iOS Safari (which has quirky Pointer Events)
  canvas.addEventListener('touchstart', handleCanvasTouchStart, { passive: false });
  canvas.addEventListener('touchmove', handleCanvasTouchMove, { passive: false });
  canvas.addEventListener('touchend', handleCanvasTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', handleCanvasTouchCancel, { passive: false });

  // Native double-click for inline text editing (mouse only)
  canvas.addEventListener('dblclick', (e) => {
    const pos = getCanvasPos(e);
    const clickedElement = getElementAtCanvasPoint(pos.x, pos.y);
    if (clickedElement?.type === 'text') {
      e.preventDefault();
      e.stopPropagation();
      startInlineEdit(clickedElement.id);
    } else if (clickedElement?.type === 'image') {
      // #26: 画像をダブルクリックでトリミング
      e.preventDefault();
      e.stopPropagation();
      openImageCrop(clickedElement.id);
    }
  });

  // Inline text editor events
  const inlineEditor = $('#inline-text-editor');

  // Real-time sync as user types
  inlineEditor.addEventListener('input', (e) => {
    if (state.editingTextId) {
      modifyElement(state.editingTextId, { text: e.target.value });
    }
  });

  // Handle Escape to cancel, Enter for single-line exit
  inlineEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stopInlineEdit(false); // Cancel - revert to original
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const element = state.elements.find(el => el.id === state.editingTextId);
      if (element?.noWrap) {
        e.preventDefault();
        stopInlineEdit(true); // Save and exit for single-line text
      }
    }
  });

  // Blur saves and exits (with delay to prevent immediate close)
  inlineEditor.addEventListener('blur', () => {
    setTimeout(() => {
      if (state.editingTextId) {
        stopInlineEdit(true);
      }
    }, 150);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyDown);

  // Template toolbar button - toggle template panel
  $('#template-toolbar-btn').addEventListener('click', toggleTemplatePanel);

  // Template panel close button
  $('#template-panel-close').addEventListener('click', () => {
    $('#template-panel').classList.add('hidden');
  });

  // Template panel: Manage Data button opens the dialog
  $('#template-manage-data').addEventListener('click', showTemplateDataDialog);

  // Template data dialog close
  $('#template-data-close').addEventListener('click', hideTemplateDataDialog);
  $('#template-data-dialog').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideTemplateDataDialog();
  });

  // Template quick actions (properties panel)
  $('#template-quick-preview').addEventListener('click', showPreviewDialog);
  $('#template-quick-print').addEventListener('click', printFromTemplatePanel);

  // Template data actions
  $('#template-import-csv').addEventListener('click', () => $('#template-csv-input').click());
  $('#template-csv-input').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      handleCSVFileImport(e.target.files[0]);  // Validation inside function
      e.target.value = '';
    }
  });
  $('#template-add-row').addEventListener('click', () => addTemplateRecord());
  $('#template-clear-all').addEventListener('click', () => {
    if (confirm(t('confirm_clear_template_data'))) {
      clearTemplateData();
    }
  });

  // Template preview
  $('#template-preview-btn').addEventListener('click', () => {
    hideTemplateDataDialog();
    showPreviewDialog();
  });
  $('#template-print-btn').addEventListener('click', handleBatchPrint);

  // Insert field buttons
  ['text', 'barcode', 'qr'].forEach(type => {
    // Toggle dropdown on button click
    $(`#insert-field-${type}`).addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFieldDropdown(type);
    });

    // Handle new field input (Enter key)
    $(`#new-field-${type}`).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createAndInsertField(type, e.target.value);
      }
    });

    // Handle clicking on existing field options (delegated)
    $(`#field-list-${type}`).addEventListener('click', (e) => {
      const fieldOption = e.target.closest('.field-option');
      if (fieldOption) {
        const fieldName = fieldOption.dataset.field;
        insertFieldIntoInput(type, fieldName);
      }
    });
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[id^="field-dropdown-"]') && !e.target.closest('[id^="insert-field-"]')) {
      $$('[id^="field-dropdown-"]').forEach(d => d.classList.add('hidden'));
    }
  });

  // Expression insertion dropdown (date/time)
  $('#insert-expr-text')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = $('#expr-dropdown-text');
    // Close field dropdowns
    $$('[id^="field-dropdown-"]').forEach(d => d.classList.add('hidden'));
    dropdown.classList.toggle('hidden');
  });

  // Handle expression option clicks
  $$('#expr-dropdown-text .expr-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const expr = btn.dataset.expr;
      const textarea = $('#prop-text-content');
      if (textarea && expr) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        textarea.value = text.substring(0, start) + expr + text.substring(end);
        textarea.setSelectionRange(start + expr.length, start + expr.length);
        textarea.focus();
        // Trigger change event to update element
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      $('#expr-dropdown-text').classList.add('hidden');
    });
  });

  // Close expression dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#expr-dropdown-text') && !e.target.closest('#insert-expr-text')) {
      $('#expr-dropdown-text')?.classList.add('hidden');
    }
  });

  // Close mobile field dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.mobile-field-btn') && !e.target.closest('.mobile-field-dropdown')) {
      $$('.mobile-field-dropdown').forEach(d => d.classList.add('hidden'));
    }
  });

  // Preview dialog
  $('#preview-close').addEventListener('click', hidePreviewDialog);
  $('#preview-dialog').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hidePreviewDialog();
  });
  $('#preview-print-selected').addEventListener('click', () => {
    hidePreviewDialog();
    handleBatchPrint();
  });

  // Full preview dialog
  $('#full-preview-close').addEventListener('click', hideFullPreview);
  $('#full-preview-dialog').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideFullPreview();
  });
  $('#full-preview-prev').addEventListener('click', () => navigatePreview(-1));
  $('#full-preview-next').addEventListener('click', () => navigatePreview(1));
  $('#full-preview-include').addEventListener('change', (e) => {
    const idx = state.currentPreviewIndex;
    if (e.target.checked) {
      if (!state.selectedRecords.includes(idx)) {
        state.selectedRecords.push(idx);
        state.selectedRecords.sort((a, b) => a - b);
      }
    } else {
      state.selectedRecords = state.selectedRecords.filter(i => i !== idx);
    }
  });
  $('#full-preview-print').addEventListener('click', handlePrintSinglePreview);

  // Initial render
  render();

  // Detect template fields on load
  detectTemplateFields();

  // 表示言語(日本語 / English)。JS が書く文言を今の言語で出し直す
  refreshLanguageTexts();
  onLangChange(() => refreshLanguageTexts());

  // Show info dialog on first visit
  if (shouldShowInfoOnLoad()) {
    showInfoDialog();
  }

  // Initialize mobile UI
  initMobileUI();

  // 素材集(#27)・枠(#28)
  initAssetsPanel({
    insertImage: (asset) => addAssetImage(asset),
    insertFrame: (styleId) => addFrameElement(styleId),
    isRoundLabel: () => !!state.renderer?.isRound,
    setStatus,
  });

  // アカウント・同期(3.3)とゲストモード(3.4)
  initAccountUI({
    hasWork: () => state.elements.length > 0,
    openSaveDialog: (opts) => showSaveDialog(opts),
    refreshLoadDialog: () => {
      if (!$('#load-dialog').classList.contains('hidden')) showLoadDialog();
    },
    setStatus,
    showToast,
  });

  // Initialize printer model prompt listeners
  initPrinterModelPrompt();

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    // Destroy renderer to clean up caches
    if (state.renderer) {
      state.renderer.destroy();
    }
    // Disconnect transport if connected
    if (state.transport && state.transport.connected) {
      state.transport.disconnect();
    }
  });

  console.log('Phomymo Label Designer initialized');
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
