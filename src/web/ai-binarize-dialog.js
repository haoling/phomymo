/**
 * 「AIで白黒に」の画面
 *
 * - 加工の種類を選び、変換前と変換後を並べて見比べてから「適用」する
 * - AI モデルのダウンロードが要る加工は、ボタンを押すまでダウンロードしない
 * - 線の加工は「線の濃さ」をその場で変えられる(AI をもう一度走らせずに済む)
 * - 見た目(CSS)はこのファイルの中に置く(index.html を大きく触らないため)
 */

import { t, applyI18n } from './i18n.js';
import {
  AI_CONFIG, AI_MODES, modeNeedsModel, isLineMode, isModelCached, modelSizeMB,
  loadImage, imageToCanvas, processImage, thresholdToCanvas,
} from './ai-binarize.js';

/** 仮決め: 開いたときの加工の種類 */
export const AI_DIALOG_DEFAULTS = {
  mode: 'removeBg',
  removeBgFirst: false,
  previewMax: 280, // 見比べる画像の最大の大きさ(px)
};

const $ = (sel, root = document) => root.querySelector(sel);

let dialog = null;
let session = null;

const CSS = `
#ai-bw-dialog { position: fixed; inset: 0; background: rgba(17,24,39,.6); display: flex; align-items: center; justify-content: center; z-index: 66; padding: 16px; }
#ai-bw-dialog[hidden], #ai-bw-dialog [hidden] { display: none !important; }
#ai-bw-dialog .aibw-panel { background: #fff; border-radius: 12px; width: 640px; max-width: 100%; max-height: 100%; display: flex; flex-direction: column; box-shadow: 0 20px 25px -5px rgba(0,0,0,.25); color: #374151; font-size: 14px; overflow: auto; }
#ai-bw-dialog h3 { font-size: 16px; font-weight: 600; color: #111827; margin: 0; padding: 12px 16px 4px; }
#ai-bw-dialog .aibw-modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 8px 16px; }
#ai-bw-dialog .aibw-mode { text-align: left; padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; display: flex; flex-direction: column; gap: 2px; }
#ai-bw-dialog .aibw-mode:hover { background: #f9fafb; }
#ai-bw-dialog .aibw-mode[aria-checked="true"] { border-color: #2563eb; background: #eff6ff; box-shadow: 0 0 0 1px #2563eb inset; }
#ai-bw-dialog .aibw-mode-name { font-weight: 600; color: #111827; font-size: 13px; }
#ai-bw-dialog .aibw-mode-desc { font-size: 11px; color: #6b7280; line-height: 1.4; }
#ai-bw-dialog .aibw-badge { align-self: flex-start; font-size: 10px; padding: 1px 6px; border-radius: 9999px; background: #f3f4f6; color: #4b5563; margin-top: 2px; }
#ai-bw-dialog .aibw-opts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 4px 16px 8px; font-size: 13px; }
#ai-bw-dialog .aibw-opts label { display: inline-flex; align-items: center; gap: 6px; }
#ai-bw-dialog .aibw-opts input[type=range] { width: 140px; }
#ai-bw-dialog .aibw-stage { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px 16px; background: #f3f4f6; }
#ai-bw-dialog .aibw-pane { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
#ai-bw-dialog .aibw-pane-label { font-size: 11px; color: #6b7280; }
#ai-bw-dialog .aibw-box { position: relative; display: flex; align-items: center; justify-content: center; width: 100%; min-height: 120px; background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
#ai-bw-dialog .aibw-box img, #ai-bw-dialog .aibw-box canvas { display: block; max-width: 100%; height: auto; }
#ai-bw-dialog .aibw-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: rgba(255,255,255,.85); font-size: 12px; color: #374151; text-align: center; padding: 8px; }
#ai-bw-dialog .aibw-overlay[hidden] { display: none; }
#ai-bw-dialog .aibw-bar { width: 70%; height: 6px; background: #e5e7eb; border-radius: 9999px; overflow: hidden; }
#ai-bw-dialog .aibw-bar > div { height: 100%; width: 0; background: #2563eb; transition: width .15s; }
#ai-bw-dialog .aibw-note { margin: 0; padding: 8px 16px 0; font-size: 11px; color: #6b7280; line-height: 1.5; }
#ai-bw-dialog .aibw-crop-note { color: #b45309; }
#ai-bw-dialog .aibw-error { margin: 0; padding: 6px 16px 0; font-size: 12px; color: #b91c1c; }
#ai-bw-dialog .aibw-error[hidden] { display: none; }
#ai-bw-dialog .aibw-foot { display: flex; align-items: center; gap: 8px; padding: 10px 16px 14px; }
#ai-bw-dialog .aibw-spacer { flex: 1; }
#ai-bw-dialog .aibw-btn { padding: 6px 14px; border-radius: 8px; border: 1px solid #e5e7eb; background: #fff; font-size: 13px; color: #374151; }
#ai-bw-dialog .aibw-btn:hover:not(:disabled) { background: #f9fafb; }
#ai-bw-dialog .aibw-btn:disabled { opacity: .5; cursor: not-allowed; }
#ai-bw-dialog .aibw-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
#ai-bw-dialog .aibw-primary:hover:not(:disabled) { background: #1d4ed8; }
@media (max-width: 560px) {
  #ai-bw-dialog .aibw-modes { grid-template-columns: 1fr; }
}
`;

function badgeText(mode) {
  return modeNeedsModel(mode) ? t('aibw_badge_ai', { mb: modelSizeMB(mode) }) : t('aibw_badge_fast');
}

function buildDialog() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.id = 'ai-bw-dialog';
  el.hidden = true;
  el.innerHTML = `
    <div class="aibw-panel" role="dialog" aria-modal="true" aria-labelledby="aibw-title">
      <h3 id="aibw-title" data-i18n="aibw_title">${t('aibw_title')}</h3>
      <div class="aibw-modes" role="radiogroup" aria-label="${t('aibw_mode')}" data-i18n-aria-label="aibw_mode">
        ${AI_MODES.map(m => `
          <button type="button" class="aibw-mode" role="radio" data-mode="${m}" aria-checked="false">
            <span class="aibw-mode-name" data-i18n="aibw_mode_${m}">${t(`aibw_mode_${m}`)}</span>
            <span class="aibw-mode-desc" data-i18n="aibw_desc_${m}">${t(`aibw_desc_${m}`)}</span>
            <span class="aibw-badge" data-badge="${m}">${badgeText(m)}</span>
          </button>`).join('')}
      </div>
      <div class="aibw-opts">
        <label id="aibw-rmbg-wrap"><input type="checkbox" id="aibw-rmbg-first"> <span data-i18n="aibw_remove_bg_first">${t('aibw_remove_bg_first')}</span></label>
        <label id="aibw-strength-wrap"><span data-i18n="aibw_strength">${t('aibw_strength')}</span>
          <input type="range" id="aibw-strength" min="0" max="100" value="${AI_CONFIG.defaultStrength}"></label>
      </div>
      <div class="aibw-stage">
        <div class="aibw-pane">
          <span class="aibw-pane-label" data-i18n="aibw_before">${t('aibw_before')}</span>
          <div class="aibw-box"><img id="aibw-before" alt=""></div>
        </div>
        <div class="aibw-pane">
          <span class="aibw-pane-label" data-i18n="aibw_after">${t('aibw_after')}</span>
          <div class="aibw-box" id="aibw-after-box">
            <canvas id="aibw-after" width="1" height="1"></canvas>
            <div class="aibw-overlay" id="aibw-overlay">
              <span id="aibw-overlay-text"></span>
              <div class="aibw-bar" id="aibw-bar" hidden><div id="aibw-bar-fill"></div></div>
              <button type="button" class="aibw-btn aibw-primary" id="aibw-run"></button>
            </div>
          </div>
        </div>
      </div>
      <p class="aibw-error" id="aibw-error" role="alert" hidden></p>
      <p class="aibw-note aibw-crop-note" id="aibw-crop-note" data-i18n="aibw_cropped_note" hidden>${t('aibw_cropped_note')}</p>
      <p class="aibw-note" data-i18n="aibw_privacy_note">${t('aibw_privacy_note')}</p>
      <div class="aibw-foot">
        <span class="aibw-spacer"></span>
        <button type="button" class="aibw-btn" id="aibw-cancel" data-i18n="cancel">${t('cancel')}</button>
        <button type="button" class="aibw-btn aibw-primary" id="aibw-apply" data-i18n="aibw_apply" disabled>${t('aibw_apply')}</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener('pointerdown', (e) => {
    if (e.target === el) finish(null);
  });
  $('#aibw-cancel', el).addEventListener('click', () => finish(null));
  $('#aibw-apply', el).addEventListener('click', apply);
  $('#aibw-run', el).addEventListener('click', () => run());
  el.querySelectorAll('.aibw-mode').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  $('#aibw-rmbg-first', el).addEventListener('change', (e) => {
    if (!session) return;
    session.removeBgFirst = e.target.checked;
    onSettingsChanged();
  });
  $('#aibw-strength', el).addEventListener('input', (e) => {
    if (!session) return;
    session.strength = Number(e.target.value);
    drawResult();
  });
  document.addEventListener('keydown', onKeyDown, true);
  return el;
}

function onKeyDown(e) {
  if (!session) return;
  // 後ろの画面のショートカット(Delete、Ctrl+Z など)に届かないようにする
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    finish(null);
  }
}

/**
 * 画面を開く
 * @param {Object} opts
 * @param {string} opts.imageData - 画像(data URL)。トリミングしている画像は、切り抜いたあとの画像を渡す
 * @param {boolean} [opts.cropped] - トリミングした範囲だけを加工するか(注意書きを出す)
 * @returns {Promise<{imageData:string, mode:string, lineMode:boolean}|null>}
 */
export function openAiBinarizeDialog({ imageData, cropped = false }) {
  if (!dialog) dialog = buildDialog();
  else {
    applyI18n(dialog);
    dialog.querySelectorAll('[data-badge]').forEach(b => { b.textContent = badgeText(b.dataset.badge); });
  }
  if (session) finish(null);

  return new Promise((resolve) => {
    session = {
      resolve,
      imageData,
      img: null,
      src: null,
      mode: AI_DIALOG_DEFAULTS.mode,
      removeBgFirst: AI_DIALOG_DEFAULTS.removeBgFirst,
      strength: AI_CONFIG.defaultStrength,
      result: null,
      runId: 0,
      running: false,
      returnFocus: document.activeElement,
    };
    $('#aibw-before', dialog).src = imageData;
    $('#aibw-crop-note', dialog).hidden = !cropped;
    $('#aibw-rmbg-first', dialog).checked = session.removeBgFirst;
    $('#aibw-strength', dialog).value = String(session.strength);
    $('#aibw-error', dialog).hidden = true;
    dialog.hidden = false;
    const s = session;
    loadImage(imageData).then((img) => {
      if (session !== s) return;
      s.img = img;
      s.src = imageToCanvas(img);
      setMode(s.mode);
    }).catch(() => showError(t('aibw_err_image')));
    setModeButtons();
    $(`.aibw-mode[data-mode="${session.mode}"]`, dialog)?.focus();
  });
}

function setModeButtons() {
  dialog.querySelectorAll('.aibw-mode').forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.mode === session.mode));
  });
  const line = isLineMode(session.mode);
  $('#aibw-rmbg-wrap', dialog).hidden = !line;
  $('#aibw-strength-wrap', dialog).hidden = !line;
}

function setMode(mode) {
  if (!session) return;
  session.mode = mode;
  setModeButtons();
  onSettingsChanged();
}

function needsDownload() {
  const s = session;
  const modes = [];
  if (s.mode === 'removeBg' || (isLineMode(s.mode) && s.removeBgFirst)) modes.push('removeBg');
  if (s.mode === 'lineArt') modes.push('lineArt');
  return modes;
}

/** 設定が変わったら、ダウンロード無しで済むならすぐ変換し、要るならボタンを出す */
async function onSettingsChanged() {
  const s = session;
  if (!s || !s.src) return;
  s.result = null;
  s.runId++;
  $('#aibw-apply', dialog).disabled = true;
  $('#aibw-error', dialog).hidden = true;
  const myId = s.runId;
  const models = needsDownload();
  const cached = (await Promise.all(models.map(isModelCached))).every(Boolean);
  if (session !== s || s.runId !== myId) return;
  if (cached) {
    run();
  } else {
    const mb = Math.round(models.reduce((a, m) => a + modelSizeMB(m), 0) * 10) / 10;
    showOverlay({ text: t('aibw_need_download', { mb }), button: t('aibw_download_run') });
  }
}

function showOverlay({ text = '', button = null, progress = null }) {
  const ov = $('#aibw-overlay', dialog);
  ov.hidden = false;
  $('#aibw-overlay-text', dialog).textContent = text;
  const run = $('#aibw-run', dialog);
  run.hidden = !button;
  if (button) run.textContent = button;
  const bar = $('#aibw-bar', dialog);
  bar.hidden = progress === null;
  if (progress !== null) $('#aibw-bar-fill', dialog).style.width = `${Math.round(progress * 100)}%`;
}

function hideOverlay() {
  $('#aibw-overlay', dialog).hidden = true;
}

function showError(msg) {
  const e = $('#aibw-error', dialog);
  e.textContent = msg;
  e.hidden = false;
}

async function run() {
  const s = session;
  if (!s || !s.src) return;
  const myId = ++s.runId;
  s.result = null;
  $('#aibw-apply', dialog).disabled = true;
  $('#aibw-error', dialog).hidden = true;
  showOverlay({ text: t('aibw_processing'), progress: null });
  try {
    const result = await processImage(s.src, {
      mode: s.mode,
      removeBgFirst: s.removeBgFirst,
      onProgress: (stage, f) => {
        if (session !== s || s.runId !== myId) return;
        if (f < 1) showOverlay({ text: t('aibw_downloading', { pct: Math.round(f * 100) }), progress: f });
        else showOverlay({ text: t('aibw_processing'), progress: null });
      },
    });
    if (session !== s || s.runId !== myId) return;
    s.result = result;
    hideOverlay();
    drawResult();
    $('#aibw-apply', dialog).disabled = false;
  } catch (err) {
    if (session !== s || s.runId !== myId) return;
    console.error('[ai-binarize]', err);
    showOverlay({ text: '', button: t('aibw_retry') });
    const message = String(err?.message || err).split('\n')[0].slice(0, 120);
    showError(t('aibw_err_failed', { message }));
  }
}

/** 結果を「変換後」に描く(線の加工はしきい値をかけて白黒に) */
function resultCanvas() {
  const r = session?.result;
  if (!r) return null;
  if (r.kind === 'image') return r.canvas;
  return thresholdToCanvas(r.gray, r.width, r.height, session.strength);
}

function drawResult() {
  const c = resultCanvas();
  if (!c) return;
  const out = $('#aibw-after', dialog);
  out.width = c.width;
  out.height = c.height;
  out.getContext('2d').drawImage(c, 0, 0);
  out.style.maxHeight = `${AI_DIALOG_DEFAULTS.previewMax}px`;
  out.style.width = 'auto';
}

function apply() {
  const c = resultCanvas();
  if (!c || !session) return;
  finish({ imageData: c.toDataURL('image/png'), mode: session.mode, lineMode: isLineMode(session.mode) });
}

function finish(result) {
  if (!session) return;
  const { resolve, returnFocus } = session;
  session.runId++;
  session = null;
  dialog.hidden = true;
  $('#aibw-before', dialog).removeAttribute('src');
  if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
  resolve(result);
}
