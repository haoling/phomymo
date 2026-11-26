/**
 * 画像のトリミング画面(#26)
 *
 * - 画像の全体を表示し、枠の 8 つのハンドルで切り抜く範囲を決める
 * - 枠の中をドラッグすると、大きさを変えずに動かせる
 * - マウスでもタッチでも動くよう Pointer Events で書く
 * - 切り抜き範囲は「元画像に対する割合(0〜1)」で返す(elements.js の crop と同じ形)
 * - 反転している画像は、反転した見た目のまま範囲を選べる(返す値は反転前の座標)
 */

import { normalizeCrop, MIN_CROP_FRACTION } from './elements.js';
import { t, applyI18n } from './i18n.js';

/** 仮決め: あとから変えられるように定数にまとめておく */
export const CROP_DEFAULTS = {
  maxStageWidth: 560,   // 画像を表示する最大の幅(px)
  maxStageHeight: 420,  // 同じく高さ(px)
  keyStep: 0.01,        // 矢印キーで動かす量(割合)。Shift を押すと 10 倍
  defaultRatio: 'free', // 開いたときの縦横比
};

/**
 * 縦横比の選択肢。value は「幅 ÷ 高さ」(画像の画素で)。
 * 'original' は画像そのもの、'label' はラベルの形、'free' は自由
 */
export const CROP_RATIOS = [
  { id: 'free', labelKey: 'crop_ratio_free' },
  { id: 'original', labelKey: 'crop_ratio_original' },
  { id: 'label', labelKey: 'crop_ratio_label' },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:3', label: '4:3', value: 4 / 3 },
  { id: '3:4', label: '3:4', value: 3 / 4 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
];

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

let dialog = null;
let session = null;

function buildDialog() {
  const el = document.createElement('div');
  el.id = 'crop-dialog';
  el.hidden = true;
  el.innerHTML = `
    <div class="crop-panel" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <div class="crop-head">
        <h3 id="crop-title" data-i18n="crop_title">${t('crop_title')}</h3>
        <span class="crop-size" id="crop-size"></span>
      </div>
      <div class="crop-ratios" role="radiogroup" aria-label="${t('crop_aspect')}" data-i18n-aria-label="crop_aspect">
        ${CROP_RATIOS.map(r => `<button type="button" class="crop-ratio" role="radio" data-ratio="${r.id}" aria-checked="false"${r.labelKey ? ` data-i18n="${r.labelKey}"` : ''}>${r.labelKey ? t(r.labelKey) : r.label}</button>`).join('')}
      </div>
      <div class="crop-stage-wrap">
        <div class="crop-stage" id="crop-stage">
          <img id="crop-image" alt="" draggable="false">
          <div class="crop-box" id="crop-box" tabindex="0" aria-label="${t('crop_box_label')}" data-i18n-aria-label="crop_box_label">
            <div class="crop-grid"></div>
            ${HANDLES.map(h => `<div class="crop-handle crop-handle-${h}" data-handle="${h}"></div>`).join('')}
          </div>
        </div>
      </div>
      <p class="crop-hint" data-i18n="crop_hint">${t('crop_hint')}</p>
      <div class="crop-foot">
        <button type="button" class="crop-btn" id="crop-reset" data-i18n="crop_reset">${t('crop_reset')}</button>
        <span class="crop-spacer"></span>
        <button type="button" class="crop-btn" id="crop-cancel" data-i18n="cancel">${t('cancel')}</button>
        <button type="button" class="crop-btn crop-primary" id="crop-apply" data-i18n="crop_apply">${t('crop_apply')}</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener('pointerdown', (e) => {
    if (e.target === el) finish(null); // 外側を押したら閉じる
  });
  $('#crop-cancel', el).addEventListener('click', () => finish(null));
  $('#crop-apply', el).addEventListener('click', apply);
  $('#crop-reset', el).addEventListener('click', () => {
    if (!session) return;
    setRatio('free');
    session.rect = { x: 0, y: 0, w: 1, h: 1 };
    layoutBox();
  });
  el.querySelectorAll('.crop-ratio').forEach(btn => {
    btn.addEventListener('click', () => {
      setRatio(btn.dataset.ratio);
      fitRectToRatio();
      layoutBox();
    });
  });

  const box = $('#crop-box', el);
  box.addEventListener('pointerdown', onPointerDown);
  box.addEventListener('pointermove', onPointerMove);
  box.addEventListener('pointerup', onPointerUp);
  box.addEventListener('pointercancel', onPointerUp);
  // 開いている間は、ほかのショートカットより先にキーを受け取る
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', () => { if (session) layoutStage(); });
  return el;
}

/**
 * トリミング画面を開く
 * @param {Object} opts
 * @param {string} opts.imageData - 画像(data URL)
 * @param {Object|null} opts.crop - いまの切り抜き範囲
 * @param {boolean} opts.flipX - 左右反転しているか
 * @param {boolean} opts.flipY - 上下反転しているか
 * @param {number} [opts.labelAspect] - ラベルの幅 ÷ 高さ(「ラベルの形」用)
 * @returns {Promise<{crop: Object|null}|null>} 決定したら {crop}、キャンセルなら null
 */
export function openCropDialog({ imageData, crop = null, flipX = false, flipY = false, labelAspect = 1 }) {
  if (!dialog) dialog = buildDialog();
  else applyI18n(dialog); // 表示言語が変わっていても今の言語で出す
  if (session) finish(null);

  return new Promise((resolve) => {
    const c = normalizeCrop(crop) || { x: 0, y: 0, w: 1, h: 1 };
    session = {
      resolve,
      flipX: !!flipX,
      flipY: !!flipY,
      labelAspect: labelAspect > 0 ? labelAspect : 1,
      imgW: 1,
      imgH: 1,
      ratio: null,
      // 画面に見えている(反転後の)座標で持つ
      rect: {
        x: flipX ? 1 - (c.x + c.w) : c.x,
        y: flipY ? 1 - (c.y + c.h) : c.y,
        w: c.w,
        h: c.h,
      },
      drag: null,
      returnFocus: document.activeElement,
    };

    const img = $('#crop-image', dialog);
    img.style.transform = `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`;
    img.onload = () => {
      if (!session) return;
      session.imgW = img.naturalWidth || 1;
      session.imgH = img.naturalHeight || 1;
      layoutStage();
    };
    img.src = imageData;
    setRatio(CROP_DEFAULTS.defaultRatio);
    dialog.hidden = false;
    $('#crop-box', dialog).focus();
    if (img.complete && img.naturalWidth) img.onload();
  });
}

/** 開いているかどうか(テスト・キーボードショートカット用) */
export function isCropDialogOpen() {
  return !!session;
}

function finish(result) {
  if (!session) return;
  const { resolve, returnFocus } = session;
  session = null;
  dialog.hidden = true;
  $('#crop-image', dialog).removeAttribute('src');
  if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
  resolve(result);
}

function apply() {
  if (!session) return;
  const { rect, flipX, flipY } = session;
  const crop = normalizeCrop({
    x: flipX ? 1 - (rect.x + rect.w) : rect.x,
    y: flipY ? 1 - (rect.y + rect.h) : rect.y,
    w: rect.w,
    h: rect.h,
  });
  finish({ crop });
}

// ---------------------------------------------------------------------------
// 縦横比
// ---------------------------------------------------------------------------

/** 画像の画素での「幅 ÷ 高さ」を、割合の座標での「w ÷ h」に直したもの */
function fractionRatio() {
  if (!session || !session.ratio) return null;
  return session.ratio * session.imgH / session.imgW;
}

function setRatio(id) {
  const def = CROP_RATIOS.find(r => r.id === id) || CROP_RATIOS[0];
  session.ratioId = def.id;
  if (def.id === 'free') session.ratio = null;
  else if (def.id === 'original') session.ratio = session.imgW / session.imgH;
  else if (def.id === 'label') session.ratio = session.labelAspect;
  else session.ratio = def.value;
  dialog.querySelectorAll('.crop-ratio').forEach(btn => {
    btn.setAttribute('aria-checked', String(btn.dataset.ratio === def.id));
  });
}

/** 縦横比を選んだとき: いまの範囲の中心を保ったまま、入るいちばん大きな枠にする */
function fitRectToRatio() {
  // 'original' は画像を読み終えてから比が決まるので計算し直す
  if (session.ratioId === 'original') session.ratio = session.imgW / session.imgH;
  const kk = fractionRatio();
  if (!kk) return;
  const { rect } = session;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  let w = 1;
  let h = w / kk;
  if (h > 1) { h = 1; w = h * kk; }
  const x = clamp(cx - w / 2, 0, 1 - w);
  const y = clamp(cy - h / 2, 0, 1 - h);
  session.rect = { x, y, w, h };
}

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------

function layoutStage() {
  const { imgW, imgH } = session;
  const maxW = Math.min(CROP_DEFAULTS.maxStageWidth, window.innerWidth - 56);
  const maxH = Math.min(CROP_DEFAULTS.maxStageHeight, window.innerHeight - 260);
  const scale = Math.min(maxW / imgW, Math.max(120, maxH) / imgH);
  const w = Math.max(40, Math.round(imgW * scale));
  const h = Math.max(40, Math.round(imgH * scale));
  const stage = $('#crop-stage', dialog);
  const img = $('#crop-image', dialog);
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  img.style.width = `${w}px`;
  img.style.height = `${h}px`;
  session.stageW = w;
  session.stageH = h;
  if (session.ratioId === 'original') setRatio('original');
  layoutBox();
}

function layoutBox() {
  if (!session || !session.stageW) return;
  const { rect, stageW, stageH, imgW, imgH } = session;
  const box = $('#crop-box', dialog);
  box.style.left = `${rect.x * stageW}px`;
  box.style.top = `${rect.y * stageH}px`;
  box.style.width = `${rect.w * stageW}px`;
  box.style.height = `${rect.h * stageH}px`;
  $('#crop-size', dialog).textContent =
    `${Math.max(1, Math.round(rect.w * imgW))} × ${Math.max(1, Math.round(rect.h * imgH))} px`;
}

// ---------------------------------------------------------------------------
// ドラッグ
// ---------------------------------------------------------------------------

function onPointerDown(e) {
  if (!session || !session.stageW) return;
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  const handle = e.target.dataset?.handle || 'move';
  session.drag = {
    handle,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    startRect: { ...session.rect },
  };
  e.currentTarget.setPointerCapture?.(e.pointerId);
  e.currentTarget.focus();
}

function onPointerMove(e) {
  const drag = session?.drag;
  if (!drag || drag.pointerId !== e.pointerId) return;
  e.preventDefault();
  const ddx = (e.clientX - drag.startX) / session.stageW;
  const ddy = (e.clientY - drag.startY) / session.stageH;
  session.rect = drag.handle === 'move'
    ? moveRect(drag.startRect, ddx, ddy)
    : resizeRect(drag.startRect, drag.handle, ddx, ddy, fractionRatio());
  layoutBox();
}

function onPointerUp(e) {
  if (session?.drag && session.drag.pointerId === e.pointerId) {
    session.drag = null;
  }
}

function onKeyDown(e) {
  if (!session) return;
  // 画面の後ろのショートカット(Delete で要素を消す、Ctrl+Z など)に届かないようにする
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    finish(null);
    return;
  }
  if (e.key === 'Enter' && !e.target.closest?.('button')) {
    e.preventDefault();
    e.stopPropagation();
    apply();
    return;
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key] && e.target.id === 'crop-box') {
    e.preventDefault();
    e.stopPropagation();
    const step = CROP_DEFAULTS.keyStep * (e.shiftKey ? 10 : 1);
    const [dx, dy] = arrows[e.key];
    session.rect = moveRect(session.rect, dx * step, dy * step);
    layoutBox();
  }
}

/** 大きさを変えずに動かす(画像からはみ出さない) */
export function moveRect(r, ddx, ddy) {
  return {
    x: clamp(r.x + ddx, 0, 1 - r.w),
    y: clamp(r.y + ddy, 0, 1 - r.h),
    w: r.w,
    h: r.h,
  };
}

/**
 * ハンドルで大きさを変える
 * @param {Object} r - ドラッグを始めたときの範囲
 * @param {string} dir - 'n' 'ne' 'e' 'se' 's' 'sw' 'w' 'nw'
 * @param {number} ddx - 横の移動量(割合)
 * @param {number} ddy - 縦の移動量(割合)
 * @param {number|null} k - 縦横比(割合の座標での w ÷ h)。null なら自由
 */
export function resizeRect(r, dir, ddx, ddy, k = null) {
  const min = MIN_CROP_FRACTION * 2;
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  if (dir.includes('w')) left = clamp(left + ddx, 0, right - min);
  if (dir.includes('e')) right = clamp(right + ddx, left + min, 1);
  if (dir.includes('n')) top = clamp(top + ddy, 0, bottom - min);
  if (dir.includes('s')) bottom = clamp(bottom + ddy, top + min, 1);
  if (!k) return { x: left, y: top, w: right - left, h: bottom - top };

  // 縦横比を保つ: 動かした辺に合わせて、もう一方の辺を決める
  let w = right - left;
  let h = bottom - top;
  const horiz = dir.includes('e') || dir.includes('w');
  const vert = dir.includes('n') || dir.includes('s');
  if (horiz && !vert) h = w / k;
  else if (vert && !horiz) w = h * k;
  else if (w / k > h) h = w / k;
  else w = h * k;

  // 動かさない側を固定する(辺のハンドルなら反対の向きは中心を固定)
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const anchorX = dir.includes('w') ? 'right' : dir.includes('e') ? 'left' : 'center';
  const anchorY = dir.includes('n') ? 'bottom' : dir.includes('s') ? 'top' : 'center';
  const fixedRight = r.x + r.w;
  const fixedBottom = r.y + r.h;
  const maxW = anchorX === 'right' ? fixedRight : anchorX === 'left' ? 1 - r.x : 2 * Math.min(cx, 1 - cx);
  const maxH = anchorY === 'bottom' ? fixedBottom : anchorY === 'top' ? 1 - r.y : 2 * Math.min(cy, 1 - cy);
  const s = Math.min(1, maxW / w, maxH / h);
  w *= s;
  h *= s;
  const x = anchorX === 'right' ? fixedRight - w : anchorX === 'left' ? r.x : cx - w / 2;
  const y = anchorY === 'bottom' ? fixedBottom - h : anchorY === 'top' ? r.y : cy - h / 2;
  return {
    x: clamp(x, 0, 1 - w),
    y: clamp(y, 0, 1 - h),
    w,
    h,
  };
}
