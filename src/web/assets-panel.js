/**
 * 素材パネル(#27 素材集、#28 枠・ボーダー素材)
 *
 * - 素材は src/web/assets/ に同梱した SVG。一覧は assets/manifest.json
 *   (作り直しは scripts/build-assets.py)
 * - 選んだ素材は PNG にしてから既存の「画像」要素として挿入する。
 *   印刷時は画像と同じディザ処理で白黒になる
 * - 「枠」カテゴリだけは画像ではなく、伸び縮みする枠要素(frames.js)を挿入する
 */

import * as kv from './kv.js';
import { FRAME_STYLES, renderFrameThumbnail } from './frames.js';
import { t, getLang, onLangChange, applyI18n } from './i18n.js';

/** 仮決め: あとから変えられるように定数にまとめておく */
export const ASSET_DEFAULTS = {
  sizeRatio: 0.5,          // 挿入時の大きさ(ラベルの短い辺に対する割合)
  rasterSize: 512,         // PNG にするときの長い辺(px)。拡大しても粗くならないよう大きめに
  lineWidth: '2',          // 線アイコンの太さの初期値
  recentMax: 16,           // 「最近使った」に残す数
  closeAfterInsert: true,  // 挿入したらパネルを閉じる
};

/** 線アイコンの太さの選択肢(Tabler Icons の stroke-width、24px 基準) */
export const LINE_WIDTHS = [
  { value: '1.5', labelKey: 'line_thin' },
  { value: '2', labelKey: 'line_normal' },
  { value: '2.5', labelKey: 'line_thick' },
  { value: '3', labelKey: 'line_extra_thick' },
];

const RECENT_KEY = 'phomymo_recent_assets';
const LINE_WIDTH_KEY = 'phomymo_asset_line_width';
const FRAME_CATEGORY = { id: 'frames', nameKey: 'frame' };
const BASE = './assets/';

const $ = (sel, root = document) => root.querySelector(sel);

let hooks = {
  insertImage: async () => {},
  insertFrame: () => {},
  isRoundLabel: () => false,
  setStatus: () => {},
};
let manifest = null;
let manifestPromise = null;
let current = { category: 'all', query: '' };

// ---------------------------------------------------------------------------
// マニフェストと検索
// ---------------------------------------------------------------------------

export async function loadManifest() {
  if (manifest) return manifest;
  if (!manifestPromise) {
    manifestPromise = fetch(BASE + 'manifest.json')
      .then(r => {
        if (!r.ok) throw new Error(`manifest ${r.status}`);
        return r.json();
      })
      .then(m => { manifest = m; return m; })
      .catch(e => { manifestPromise = null; throw e; });
  }
  return manifestPromise;
}

/** カタカナをひらがなに、英字を小文字にそろえる(「ネコ」でも「ねこ」でも見つかるように) */
export function normalizeQuery(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .trim();
}

function frameItems() {
  return FRAME_STYLES.map(s => ({
    id: `frame:${s.id}`, cats: ['frames'], name: s.name, nameEn: s.nameEn, tags: s.tags, kind: 'frame', frameStyle: s.id,
  }));
}

/** 素材・カテゴリの表示名(表示言語に合わせる) */
export function displayName(entry) {
  if (!entry) return '';
  if (entry.nameKey) return t(entry.nameKey);
  return getLang() === 'en' ? (entry.nameEn || entry.name) : entry.name;
}

/**
 * 条件に合う素材を返す
 * @param {object} m マニフェスト
 * @param {{category:string, query:string, recent?:string[]}} opts
 */
export function filterItems(m, { category = 'all', query = '', recent = [] } = {}) {
  const all = [...m.items, ...frameItems()];
  let list;
  if (category === 'recent') {
    const byId = new Map(all.map(i => [i.id, i]));
    list = recent.map(id => byId.get(id)).filter(Boolean);
  } else if (category === 'all') {
    list = all;
  } else {
    list = all.filter(i => i.cats.includes(category));
  }
  const words = normalizeQuery(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return list;
  return list.filter(i => {
    const hay = normalizeQuery([i.name, i.nameEn || '', ...(i.tags || [])].join(' '));
    return words.every(w => hay.includes(w));
  });
}

function getRecent() {
  try {
    const v = JSON.parse(kv.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function pushRecent(id) {
  const list = [id, ...getRecent().filter(x => x !== id)].slice(0, ASSET_DEFAULTS.recentMax);
  kv.setItem(RECENT_KEY, JSON.stringify(list));
}

function getLineWidth() {
  const v = kv.getItem(LINE_WIDTH_KEY);
  return LINE_WIDTHS.some(w => w.value === v) ? v : ASSET_DEFAULTS.lineWidth;
}

// ---------------------------------------------------------------------------
// SVG → PNG
// ---------------------------------------------------------------------------

/**
 * SVG の文字列を、指定の線の太さ・大きさの SVG に整える
 */
export function prepareSvg(svgText, { lineWidth = null, size = ASSET_DEFAULTS.rasterSize } = {}) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('not an svg');
  let vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some(n => !Number.isFinite(n))) {
    const w = parseFloat(svg.getAttribute('width')) || 24;
    const h = parseFloat(svg.getAttribute('height')) || 24;
    vb = [0, 0, w, h];
    svg.setAttribute('viewBox', vb.join(' '));
  }
  const [, , vw, vh] = vb;
  const scale = size / Math.max(vw, vh);
  const width = Math.max(1, Math.round(vw * scale));
  const height = Math.max(1, Math.round(vh * scale));
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  if (lineWidth && svg.getAttribute('stroke-width')) svg.setAttribute('stroke-width', String(lineWidth));
  let out = new XMLSerializer().serializeToString(svg);
  out = out.replace(/currentColor/g, '#000');
  return { svg: out, width, height };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/**
 * SVG を PNG の data URL にする
 */
export async function rasterizeSvg(svgText, opts = {}) {
  const { svg, width, height } = prepareSvg(svgText, opts);
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

async function insertItem(item) {
  if (item.kind === 'frame') {
    hooks.insertFrame(item.frameStyle);
    pushRecent(item.id);
    return;
  }
  const res = await fetch(BASE + item.file);
  if (!res.ok) throw new Error(`asset ${res.status}`);
  const text = await res.text();
  const { dataUrl, width, height } = await rasterizeSvg(text, {
    lineWidth: item.kind === 'line' ? getLineWidth() : null,
  });
  await hooks.insertImage({ dataUrl, width, height, name: displayName(item), assetId: item.id });
  pushRecent(item.id);
}

// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------

function buildDialog() {
  const el = document.createElement('div');
  el.id = 'assets-dialog';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'assets-title');
  el.hidden = true;
  el.innerHTML = `
    <div class="assets-panel">
      <div class="assets-head">
        <h3 id="assets-title" data-i18n="assets">${t('assets')}</h3>
        <input id="assets-search" type="search" placeholder="${t('assets_search_placeholder')}" data-i18n-placeholder="assets_search_placeholder" autocomplete="off">
        <button id="assets-close" type="button" class="assets-icon-btn" aria-label="${t('close')}" data-i18n-aria-label="close">✕</button>
      </div>
      <div id="assets-cats" class="assets-cats" role="tablist"></div>
      <div id="assets-grid" class="assets-grid"></div>
      <div class="assets-foot">
        <label class="assets-linewidth"><span data-i18n="line_width">${t('line_width')}</span>
          <select id="assets-line-width">
            ${LINE_WIDTHS.map(w => `<option value="${w.value}" data-i18n="${w.labelKey}">${t(w.labelKey)}</option>`).join('')}
          </select>
        </label>
        <span class="assets-credit" data-i18n="assets_credit">${t('assets_credit')}</span>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener('click', (e) => { if (e.target === el) closeAssetsPanel(); });
  $('#assets-close', el).addEventListener('click', closeAssetsPanel);
  $('#assets-search', el).addEventListener('input', (e) => {
    current.query = e.target.value;
    // 検索するときは、カテゴリをまたいで探す
    if (current.query.trim() && current.category !== 'all') {
      current.category = 'all';
      renderCats();
    }
    renderGrid();
  });
  $('#assets-line-width', el).addEventListener('change', (e) => {
    kv.setItem(LINE_WIDTH_KEY, e.target.value);
    renderGrid();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeAssetsPanel();
    }
  });
  return el;
}

function renderCats() {
  const box = $('#assets-cats');
  const cats = [
    { id: 'all', nameKey: 'assets_all' },
    ...(getRecent().length ? [{ id: 'recent', nameKey: 'assets_recent' }] : []),
    FRAME_CATEGORY,
    ...manifest.categories,
  ];
  if (!cats.some(c => c.id === current.category)) current.category = 'all';
  box.innerHTML = cats.map(c =>
    `<button type="button" role="tab" class="assets-cat" data-cat="${c.id}" aria-selected="${c.id === current.category}">${displayName(c)}</button>`
  ).join('');
  box.querySelectorAll('.assets-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      current.category = btn.dataset.cat;
      box.querySelectorAll('.assets-cat').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
      renderGrid();
    });
  });
}

const frameThumbCache = new Map();
function frameThumb(styleId, shape) {
  const key = `${styleId}:${shape}`;
  if (!frameThumbCache.has(key)) frameThumbCache.set(key, renderFrameThumbnail(styleId, { shape }));
  return frameThumbCache.get(key);
}

function renderGrid() {
  const grid = $('#assets-grid');
  const items = filterItems(manifest, { category: current.category, query: current.query, recent: getRecent() });
  const round = hooks.isRoundLabel();
  grid.innerHTML = '';
  if (items.length === 0) {
    grid.innerHTML = `<p class="assets-empty">${t('assets_not_found')}</p>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'assets-item' + (item.kind === 'frame' ? ' assets-item-frame' : '');
    btn.dataset.assetId = item.id;
    const name = displayName(item);
    btn.title = name;
    const img = document.createElement('img');
    img.alt = name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = item.kind === 'frame' ? frameThumb(item.frameStyle, round ? 'ellipse' : 'rect') : BASE + item.file;
    const label = document.createElement('span');
    label.textContent = name;
    btn.append(img, label);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await insertItem(item);
        if (ASSET_DEFAULTS.closeAfterInsert) closeAssetsPanel();
      } catch (e) {
        console.error('[assets] insert failed', e);
        hooks.setStatus(t('assets_insert_failed'));
      } finally {
        btn.disabled = false;
      }
    });
    frag.appendChild(btn);
  }
  grid.appendChild(frag);
}

export async function openAssetsPanel({ category } = {}) {
  const el = $('#assets-dialog') || buildDialog();
  el.hidden = false;
  if (category) current.category = category;
  else if (current.category === 'frames') current.category = 'all';
  $('#assets-line-width').value = getLineWidth();
  const grid = $('#assets-grid');
  try {
    await loadManifest();
  } catch (e) {
    console.error('[assets] manifest load failed', e);
    grid.innerHTML = `<p class="assets-empty">${t('assets_list_failed')}</p>`;
    return;
  }
  renderCats();
  renderGrid();
  const search = $('#assets-search');
  search.focus();
  search.select();
}

export function closeAssetsPanel() {
  const el = $('#assets-dialog');
  if (el) el.hidden = true;
}

export function isAssetsPanelOpen() {
  const el = $('#assets-dialog');
  return !!el && !el.hidden;
}

/**
 * @param {object} h  insertImage({dataUrl,width,height,name,assetId}), insertFrame(styleId), isRoundLabel(), setStatus(msg)
 */
export function initAssetsPanel(h = {}) {
  hooks = { ...hooks, ...h };
  // 表示言語が変わったら、開いているパネルを書き直す
  onLangChange(() => {
    const el = $('#assets-dialog');
    if (!el) return;
    applyI18n(el);
    if (manifest) {
      renderCats();
      renderGrid();
    }
  });
  document.querySelectorAll('[data-open-assets]').forEach(btn => {
    btn.addEventListener('click', () => openAssetsPanel({ category: btn.dataset.openAssets || undefined }));
  });
}
