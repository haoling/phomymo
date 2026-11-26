/**
 * テキストの「字間」「曲線文字」(#24)と「縦書き」(#22)のプロパティ UI
 *
 * パソコン用のパネル(index.html の #text-style-extra)と、スマホ用のシートの HTML をここで扱う。
 * app.js からは init / update / mobile 用の関数だけを呼ぶ。
 *
 * ctx = {
 *   getSelected(), modifyElement(id, changes), saveHistory(),
 *   getLabelDims() → {width, height}(px), refresh()(パネルを作り直す), setStatus(msg)
 * }
 */

import {
  LETTER_SPACING_MIN,
  LETTER_SPACING_MAX,
  ARC_RADIUS_MIN,
  ARC_RADIUS_MAX,
  normalizeArc,
  normalizeLetterSpacing,
  letterSpacingPx,
  measureLine,
  arcBoxSize,
  arcRadiusForBox,
  defaultArcRadius,
  normalizeWritingMode,
  isVertical,
  verticalOptions,
  swapBoxForWritingMode,
  layoutVertical,
  verticalBlockWidth,
} from './text-layout.js';
import { t } from './i18n.js';

const PX_PER_MM = 8;

/** スライダーの範囲(字間は %、半径は mm)。text-layout.js の上限・下限に合わせる */
export const SPACING_UI = { min: Math.round(LETTER_SPACING_MIN * 100), max: 100, step: 5 };
export const RADIUS_UI = { min: 1, max: 60, step: 0.5 };

const $ = (sel) => document.querySelector(sel);

let measureCtx = null;
function getMeasureCtx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/** 要素の1行目の幅(字間込み、px) */
function firstLineWidth(element) {
  const ctx = getMeasureCtx();
  const fontSize = element.fontSize || 24;
  const weight = element.fontWeight === 'bold' ? 'bold' : '';
  const style = element.fontStyle === 'italic' ? 'italic' : '';
  ctx.font = `${style} ${weight} ${fontSize}px ${element.fontFamily || 'Inter, sans-serif'}`.trim();
  const line = String(element.text || '').split('\n')[0] || ' ';
  return measureLine(ctx, line, letterSpacingPx(element, fontSize));
}

/** 縦書きにしたときの列の並びの幅(px、余白込み)。height は箱の高さ */
function verticalColumnsWidth(element, height) {
  const ctx = getMeasureCtx();
  const fontSize = element.fontSize || 24;
  const weight = element.fontWeight === 'bold' ? 'bold' : '';
  const style = element.fontStyle === 'italic' ? 'italic' : '';
  ctx.font = `${style} ${weight} ${fontSize}px ${element.fontFamily || 'Inter, sans-serif'}`.trim();
  const cols = layoutVertical(ctx, element.text || '', {
    fontSize,
    spacingPx: letterSpacingPx(element, fontSize),
    maxHeight: element.noWrap ? null : height - 8,
    ...verticalOptions(element),
  });
  return verticalBlockWidth(cols.length, fontSize) + 8;
}

function lineCount(element) {
  return Math.max(1, String(element.text || '').split('\n').length);
}

const round1 = (n) => Math.round(n * 10) / 10;
const pxToMm = (px) => round1(px / PX_PER_MM);
const mmToPx = (mm) => mm * PX_PER_MM;

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------

/** 字間(%)を設定する */
export function setLetterSpacing(ctx, element, percent) {
  const em = normalizeLetterSpacing(Number(percent) / 100);
  ctx.modifyElement(element.id, { letterSpacing: em });
}

/**
 * 曲線文字のオン・オフ
 * オンにするとき: 文字の位置がなるべく動かないよう、円の頂点を元の文字の中心に置く
 * オフにするとき: 頂点の位置に、まっすぐな文字の箱を戻す
 */
export function setArcEnabled(ctx, element, enabled) {
  const current = normalizeArc(element.arc);
  if (!!current === !!enabled) return;
  const fontSize = element.fontSize || 24;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  ctx.saveHistory();

  if (enabled) {
    const radius = defaultArcRadius(firstLineWidth(element), fontSize);
    const direction = 'up';
    const size = arcBoxSize(radius, fontSize, lineCount(element), direction);
    const ncy = cy + radius;
    ctx.modifyElement(element.id, {
      arc: { radius, direction },
      writingMode: 'horizontal', // 曲線文字と縦書きは同時に使わない
      x: cx - size / 2,
      y: ncy - size / 2,
      width: size,
      height: size,
    });
    ctx.setStatus?.(t('status_arc_on'));
  } else {
    const apexY = current.direction === 'down' ? cy + current.radius : cy - current.radius;
    const width = Math.max(40, Math.ceil(firstLineWidth(element) + 12));
    const height = Math.ceil(fontSize * 1.2 * lineCount(element) + 8);
    ctx.modifyElement(element.id, {
      arc: null,
      x: cx - width / 2,
      y: apexY - height / 2,
      width,
      height,
    });
    ctx.setStatus?.(t('status_arc_off'));
  }
  ctx.refresh();
}

/** 半径を変える。円の中心は動かさず、要素の箱を円に合わせる */
export function setArcRadius(ctx, element, radiusPx) {
  const arc = normalizeArc(element.arc);
  if (!arc) return;
  const radius = Math.min(ARC_RADIUS_MAX, Math.max(ARC_RADIUS_MIN, Math.round(radiusPx * 10) / 10));
  applyArc(ctx, element, { ...arc, radius });
}

/** 向き('up' | 'down')を変える */
export function setArcDirection(ctx, element, direction) {
  const arc = normalizeArc(element.arc);
  if (!arc || arc.direction === direction) return;
  applyArc(ctx, element, { ...arc, direction: direction === 'down' ? 'down' : 'up' });
}

function applyArc(ctx, element, arc) {
  const fontSize = element.fontSize || 24;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const size = arcBoxSize(arc.radius, fontSize, lineCount(element), arc.direction);
  ctx.modifyElement(element.id, {
    arc,
    x: cx - size / 2,
    y: cy - size / 2,
    width: size,
    height: size,
  });
}

/**
 * #22 横書き ↔ 縦書きの切り替え
 * 中心を保ったまま箱の幅と高さを入れ替える。曲線文字だったら解除する
 */
export function setWritingMode(ctx, element, mode) {
  const next = normalizeWritingMode(mode);
  const arc = normalizeArc(element.arc);
  const current = isVertical(element) ? 'vertical' : 'horizontal';
  if (next === current && !(arc && next === 'vertical')) return;
  ctx.saveHistory();
  const changes = { writingMode: next };
  if (arc && next === 'vertical') {
    // 曲線文字の正方形の箱から、縦長の箱を作る
    const fontSize = element.fontSize || 24;
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const width = Math.ceil(fontSize * 1.2 * lineCount(element) + 8);
    const height = Math.max(40, Math.ceil(lineCount(element) === 1 ? firstLineWidth(element) + 12 : element.height));
    Object.assign(changes, { arc: null, x: cx - width / 2, y: cy - height / 2, width, height });
  } else {
    const box = swapBoxForWritingMode(element);
    if (next === 'vertical' && !element.autoScale) {
      // 入れ替えた箱で列があふれるときは、列が収まる幅まで広げる(中心は保つ)
      const needed = Math.ceil(verticalColumnsWidth(element, box.height));
      if (needed > box.width) {
        box.x -= (needed - box.width) / 2;
        box.width = needed;
      }
    }
    Object.assign(changes, box);
  }
  if (next === 'vertical') {
    // 初めて縦書きにしたときは、縦書きの設定を要素に書いておく
    Object.assign(changes, verticalOptions(element));
  }
  ctx.modifyElement(element.id, changes);
  ctx.setStatus?.(next === 'vertical' ? t('status_vertical_on') : t('status_horizontal_on'));
  ctx.refresh();
}

/** 縦中横のオン・オフ */
export function setTcy(ctx, element, enabled) {
  ctx.saveHistory();
  ctx.modifyElement(element.id, { tcy: !!enabled });
  ctx.refresh();
}

/** 縦書きの英数字の向き('rotate' | 'upright') */
export function setLatinMode(ctx, element, mode) {
  ctx.saveHistory();
  ctx.modifyElement(element.id, { latinMode: mode === 'upright' ? 'upright' : 'rotate' });
  ctx.refresh();
}

/**
 * ラベルいっぱいに広げる(丸ラベル向け)
 * 要素をラベルの中央の正方形にし、文字がラベルの縁に沿うように半径を合わせる
 */
export function fitArcToLabel(ctx, element) {
  const arc = normalizeArc(element.arc);
  if (!arc) return;
  const dims = ctx.getLabelDims();
  const size = Math.min(dims.width, dims.height);
  const fontSize = element.fontSize || 24;
  const radius = arcRadiusForBox(size, size, fontSize, lineCount(element), arc.direction);
  ctx.saveHistory();
  ctx.modifyElement(element.id, {
    arc: { ...arc, radius },
    x: (dims.width - size) / 2,
    y: (dims.height - size) / 2,
    width: size,
    height: size,
    rotation: 0,
  });
  ctx.refresh();
  ctx.setStatus?.(t('status_arc_fit'));
}

// ---------------------------------------------------------------------------
// パソコン用パネル
// ---------------------------------------------------------------------------

/**
 * スライダーをドラッグしている間は履歴を1回だけ積む
 */
function bindRangeWithHistory(range, number, ctx, apply) {
  let dragging = false;
  range.addEventListener('input', () => {
    const el = ctx.getSelected();
    if (!el || el.type !== 'text') return;
    if (!dragging) { ctx.saveHistory(); dragging = true; }
    number.value = range.value;
    apply(el, Number(range.value));
  });
  range.addEventListener('change', () => { dragging = false; ctx.refresh(); });
  number.addEventListener('change', () => {
    const el = ctx.getSelected();
    if (!el || el.type !== 'text' || number.value === '') return;
    ctx.saveHistory();
    apply(el, Number(number.value));
    ctx.refresh();
  });
}

export function initTextStylePanel(ctx) {
  const spacing = $('#prop-letter-spacing');
  const spacingInput = $('#prop-letter-spacing-input');
  if (!spacing || !spacingInput) return;

  bindRangeWithHistory(spacing, spacingInput, ctx, (el, v) => setLetterSpacing(ctx, el, v));
  $('#prop-letter-spacing-reset')?.addEventListener('click', () => {
    const el = ctx.getSelected();
    if (!el || el.type !== 'text' || !el.letterSpacing) return;
    ctx.saveHistory();
    setLetterSpacing(ctx, el, 0);
    ctx.refresh();
  });

  document.querySelectorAll('[data-writing-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = ctx.getSelected();
      if (el && el.type === 'text') setWritingMode(ctx, el, btn.dataset.writingMode);
    });
  });
  $('#prop-tcy')?.addEventListener('change', (e) => {
    const el = ctx.getSelected();
    if (el && el.type === 'text') setTcy(ctx, el, e.target.checked);
  });
  $('#prop-latin-mode')?.addEventListener('change', (e) => {
    const el = ctx.getSelected();
    if (el && el.type === 'text') setLatinMode(ctx, el, e.target.value);
  });

  $('#prop-arc-enabled')?.addEventListener('change', (e) => {
    const el = ctx.getSelected();
    if (el && el.type === 'text') setArcEnabled(ctx, el, e.target.checked);
  });

  bindRangeWithHistory($('#prop-arc-radius'), $('#prop-arc-radius-input'), ctx,
    (el, mm) => setArcRadius(ctx, el, mmToPx(mm)));

  document.querySelectorAll('[data-arc-direction]').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = ctx.getSelected();
      if (!el || el.type !== 'text') return;
      ctx.saveHistory();
      setArcDirection(ctx, el, btn.dataset.arcDirection);
      ctx.refresh();
    });
  });

  $('#prop-arc-fit')?.addEventListener('click', () => {
    const el = ctx.getSelected();
    if (el && el.type === 'text') fitArcToLabel(ctx, el);
  });
}

/** 選んでいるテキスト要素に合わせてパネルを更新する */
export function updateTextStylePanel(element) {
  const spacing = $('#prop-letter-spacing');
  if (!spacing) return;
  const percent = Math.round(normalizeLetterSpacing(element.letterSpacing) * 100);
  spacing.value = percent;
  $('#prop-letter-spacing-input').value = percent;

  const vertical = isVertical(element);
  document.querySelectorAll('[data-writing-mode]').forEach(btn => {
    btn.setAttribute('aria-pressed', String((btn.dataset.writingMode === 'vertical') === vertical));
  });
  const vOpts = $('#prop-vertical-options');
  if (vOpts) {
    vOpts.hidden = !vertical;
    const opts = verticalOptions(element);
    $('#prop-tcy').checked = opts.tcy;
    $('#prop-latin-mode').value = opts.latinMode;
  }

  const arc = normalizeArc(element.arc);
  $('#prop-arc-enabled').checked = !!arc;
  $('#prop-arc-options').hidden = !arc;
  if (arc) {
    const mm = pxToMm(arc.radius);
    $('#prop-arc-radius').value = mm;
    $('#prop-arc-radius-input').value = mm;
    document.querySelectorAll('[data-arc-direction]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.arcDirection === arc.direction));
    });
  }
}

// ---------------------------------------------------------------------------
// スマホ用シート
// ---------------------------------------------------------------------------

export function mobileTextStyleHtml(element) {
  const percent = Math.round(normalizeLetterSpacing(element.letterSpacing) * 100);
  const arc = normalizeArc(element.arc);
  const mm = arc ? pxToMm(arc.radius) : 10;
  const btn = 'class="img-tool-btn" style="padding:10px 4px;font-size:13px"';
  const vertical = isVertical(element);
  const vopts = verticalOptions(element);
  return `
    <div class="prop-group">
      <div class="prop-label">${t('writing_direction')}</div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">
        <button type="button" ${btn} data-mobile-writing-mode="horizontal" aria-pressed="${!vertical}">${t('horizontal')}</button>
        <button type="button" ${btn} data-mobile-writing-mode="vertical" aria-pressed="${vertical}">${t('vertical')}</button>
      </div>
      ${vertical ? `
        <label class="flex items-center gap-2" style="margin-top:8px">
          <input type="checkbox" id="mobile-prop-tcy" class="w-5 h-5" ${vopts.tcy ? 'checked' : ''}>
          <span class="text-sm">${t('tate_chu_yoko_numbers_up_to')}</span>
        </label>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px">
          <button type="button" ${btn} data-mobile-latin-mode="rotate" aria-pressed="${vopts.latinMode === 'rotate'}">${t('latin_rotate')}</button>
          <button type="button" ${btn} data-mobile-latin-mode="upright" aria-pressed="${vopts.latinMode === 'upright'}">${t('latin_upright')}</button>
        </div>
      ` : ''}
    </div>
    <div class="prop-group">
      <div class="prop-label">${t('letter_spacing')}: <span id="mobile-prop-letterSpacing-value">${percent}</span>%</div>
      <input type="range" id="mobile-prop-letterSpacing" class="w-full" min="${SPACING_UI.min}" max="${SPACING_UI.max}" step="${SPACING_UI.step}" value="${percent}">
    </div>
    <div class="prop-group">
      <label class="flex items-center gap-2">
        <input type="checkbox" id="mobile-prop-arc" class="w-5 h-5" ${arc ? 'checked' : ''}>
        <span class="text-sm">${t('follow_an_arc_curved_text')}</span>
      </label>
      ${arc ? `
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px">
          <button type="button" ${btn} data-mobile-arc-direction="up" aria-pressed="${arc.direction === 'up'}">${t('top_arc')}</button>
          <button type="button" ${btn} data-mobile-arc-direction="down" aria-pressed="${arc.direction === 'down'}">${t('bottom_arc')}</button>
        </div>
        <div class="prop-label" style="margin-top:8px">${t('radius')}: <span id="mobile-prop-arcRadius-value">${mm}</span>mm</div>
        <input type="range" id="mobile-prop-arcRadius" class="w-full" min="${RADIUS_UI.min}" max="${RADIUS_UI.max}" step="${RADIUS_UI.step}" value="${mm}">
        <button type="button" id="mobile-prop-arcFit" class="img-tool-btn" style="padding:10px 4px;font-size:13px;width:100%;margin-top:6px">${t('fit_to_label')}</button>
      ` : ''}
    </div>
  `;
}

export function wireMobileTextStyle(element, ctx) {
  const range = document.getElementById('mobile-prop-letterSpacing');
  if (!range) return;
  let dragging = false;
  range.addEventListener('input', () => {
    if (!dragging) { ctx.saveHistory(); dragging = true; }
    document.getElementById('mobile-prop-letterSpacing-value').textContent = range.value;
    setLetterSpacing(ctx, element, Number(range.value));
  });
  range.addEventListener('change', () => { dragging = false; });

  document.querySelectorAll('[data-mobile-writing-mode]').forEach(b => {
    b.addEventListener('click', () => setWritingMode(ctx, ctx.getSelected() || element, b.dataset.mobileWritingMode));
  });
  document.getElementById('mobile-prop-tcy')?.addEventListener('change', (e) => {
    setTcy(ctx, ctx.getSelected() || element, e.target.checked);
  });
  document.querySelectorAll('[data-mobile-latin-mode]').forEach(b => {
    b.addEventListener('click', () => setLatinMode(ctx, ctx.getSelected() || element, b.dataset.mobileLatinMode));
  });

  document.getElementById('mobile-prop-arc')?.addEventListener('change', (e) => {
    setArcEnabled(ctx, element, e.target.checked);
  });

  document.querySelectorAll('[data-mobile-arc-direction]').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = ctx.getSelected() || element;
      ctx.saveHistory();
      setArcDirection(ctx, el, btn.dataset.mobileArcDirection);
      ctx.refresh();
    });
  });

  const radius = document.getElementById('mobile-prop-arcRadius');
  if (radius) {
    let rDragging = false;
    radius.addEventListener('input', () => {
      if (!rDragging) { ctx.saveHistory(); rDragging = true; }
      document.getElementById('mobile-prop-arcRadius-value').textContent = radius.value;
      const el = ctx.getSelected() || element;
      setArcRadius(ctx, el, mmToPx(Number(radius.value)));
    });
    radius.addEventListener('change', () => { rDragging = false; });
  }

  document.getElementById('mobile-prop-arcFit')?.addEventListener('click', () => {
    fitArcToLabel(ctx, ctx.getSelected() || element);
  });
}
