/**
 * 「デザインを開く」の一覧(グリッド表示 / リスト表示)
 *
 * グリッド表示では、保存したデザインを縮小して描いたサムネイルを並べる。
 * サムネイルは保存しない。開くたびにデザインのデータから描き、メモリにだけ覚えておく。
 * (保存の量が増えない・Drive 同期で届いたデザインにもそのまま付く・古い絵が残らない)
 *
 * app.js からは renderDesignList() だけを使う。サンプル(samples.js)も同じ一覧の下に並べる。
 */

import { CanvasRenderer } from './canvas.js?v=120';
import { substituteFields, evaluateExpressions, buildFieldValues } from './templates.js?v=106';
import { waitForElementFonts } from './fonts-ja.js?v=1';
import * as kv from './kv.js';
import { t } from './i18n.js';

/** 表示の切り替え(グリッド / リスト)を覚えるキー。ゲストモードでは保存されない */
export const VIEW_KEY = 'phomymo_design_list_view';
/** 仮決め: はじめはグリッド表示 */
export const DEFAULT_VIEW = 'grid';

/** サムネイルの大きさ(CSS px)。画面の解像度に合わせて描く */
const THUMB_BOX = { width: 160, height: 120 };
/** 画像・バーコードの読み込みを待つ上限 */
const ASYNC_SETTLE_MS = 250;
const ASYNC_MAX_MS = 3000;
const FONT_TIMEOUT_MS = 1500;
/** 覚えておくサムネイルの数 */
const MAX_CACHE = 200;

const thumbCache = new Map(); // key -> dataURL

export function getDesignListView() {
  const v = kv.getItem(VIEW_KEY);
  return v === 'list' || v === 'grid' ? v : DEFAULT_VIEW;
}

export function setDesignListView(view) {
  kv.setItem(VIEW_KEY, view === 'list' ? 'list' : 'grid');
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** デザインが変わったらサムネイルも描き直すためのキー */
function cacheKey(summary, design) {
  return [summary.id, design.savedAt || 0, design.counter?.next ?? '', design.counter?.resume ? 1 : 0].join(':');
}

/** サムネイルに描く要素(変数と差し込みは1件目のデータ、日付・連番は今の値) */
function elementsForThumbnail(design) {
  let elements = design.elements || [];
  const record = design.templateData?.length ? design.templateData[0] : null;
  if (record || design.variables?.length) {
    // 変数と1件目のデータを入れる(同じ名前なら表の値が優先)
    elements = substituteFields(elements, buildFieldValues(design.variables, record));
  }
  const counterIndex = design.counter?.resume ? Math.max(0, design.counter.next | 0) : 0;
  return evaluateExpressions(elements, { counterIndex });
}

/**
 * デザインを縮小して描き、PNG の dataURL を返す
 * @param {object} design - storage.js の design({ elements, labelSize, multiLabel, ... })
 * @param {{width:number,height:number}} [box] - 収める大きさ(CSS px)
 * @returns {Promise<string>}
 */
export async function renderDesignThumbnail(design, box = THUMB_BOX) {
  const work = document.createElement('canvas');
  const renderer = new CanvasRenderer(work);
  const ml = design.multiLabel;
  const size = design.labelSize || { width: 40, height: 30 };
  const round = !ml?.enabled && !!size.round;
  if (ml?.enabled) {
    renderer.setMultiLabelDimensions(ml.labelWidth, ml.labelHeight, ml.labelsAcross, ml.gapMm, 1);
  } else {
    renderer.setDimensions(size.width, size.height, 1, round);
  }

  const elements = elementsForThumbnail(design);
  await waitForElementFonts(elements, { timeoutMs: FONT_TIMEOUT_MS }).catch(() => {});

  const lw = renderer.labelWidth || 1;
  const lh = renderer.labelHeight || 1;
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const scale = Math.min(box.width / lw, box.height / lh) * dpr;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(lw * scale));
  out.height = Math.max(1, Math.round(lh * scale));
  const ctx = out.getContext('2d');

  const draw = () => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, out.width, out.height);
    ctx.scale(scale, scale);
    if (round) {
      ctx.beginPath();
      ctx.ellipse(lw / 2, lh / 2, lw / 2, lh / 2, 0, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, lw, lh);
    try {
      renderer.renderAllToContext(ctx, elements, []);
    } catch (e) {
      console.warn('thumbnail render failed:', e);
    }
    ctx.restore();
  };

  // 画像・バーコード・QR は読み込み終わりに onAsyncLoad が来るので、静かになるまで描き直す
  await new Promise((resolve) => {
    let settleTimer = null;
    const finish = () => {
      clearTimeout(settleTimer);
      clearTimeout(maxTimer);
      renderer.onAsyncLoad = null;
      resolve();
    };
    const maxTimer = setTimeout(() => { draw(); finish(); }, ASYNC_MAX_MS);
    const settle = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (renderer.loadingImages.size === 0) finish();
        else settle();
      }, ASYNC_SETTLE_MS);
    };
    renderer.onAsyncLoad = () => { draw(); settle(); };
    draw();
    settle();
  });

  const url = out.toDataURL('image/png');
  renderer.destroy?.();
  return url;
}

function remember(key, url) {
  thumbCache.delete(key);
  thumbCache.set(key, url);
  while (thumbCache.size > MAX_CACHE) thumbCache.delete(thumbCache.keys().next().value);
}

function badgesHtml(d) {
  const badges = [];
  if (d.hasImages) {
    badges.push(`<span class="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded" title="${esc(t('gallery_has_images'))}">🖼️</span>`);
  }
  if (d.isTemplate) {
    badges.push(`<span class="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">${t('template')}</span>`);
  }
  if (d.templateDataCount > 0) {
    badges.push(`<span class="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded">${t('n_records', { n: d.templateDataCount })}</span>`);
  }
  if (d.isMultiLabel) {
    badges.push(`<span class="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">${t('n_up', { n: d.multiLabel.labelsAcross })}</span>`);
  }
  if (d.dirty) {
    badges.push(`<span class="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded" title="${esc(t('not_synced_title'))}">${t('not_synced')}</span>`);
  }
  return badges;
}

function sizeText(d) {
  const s = d.labelSize || {};
  return s.round ? t('gallery_round_size', { width: s.width }) : `${s.width}x${s.height}mm`;
}

function listItemHtml(d) {
  const badges = badgesHtml(d);
  const sampleAttr = d.isSample ? ` data-sample="${esc(d.sampleId)}"` : '';
  const badgeHtml = badges.length > 0 ? `<div class="flex flex-wrap gap-1 mt-1">${badges.join('')}</div>` : '';
  return `
    <div class="design-item flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg cursor-pointer border border-gray-100 mb-2" data-name="${esc(d.name)}"${sampleAttr}>
      <div class="flex-1 min-w-0">
        <div class="font-medium text-sm text-gray-900 truncate">${esc(d.name)}</div>
        <div class="text-xs text-gray-400">${sizeText(d)} · ${t('n_elements', { n: d.elementCount })}</div>
        ${badgeHtml}
      </div>
      ${d.isSample ? '' : `<button class="delete-design text-red-500 hover:text-red-700 text-xs px-2 py-1 ml-2" data-name="${esc(d.name)}">${t('delete')}</button>`}
    </div>`;
}

function gridItemHtml(d) {
  const badges = badgesHtml(d);
  const sampleAttr = d.isSample ? ` data-sample="${esc(d.sampleId)}"` : '';
  return `
    <div class="design-item design-card group relative flex flex-col rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow cursor-pointer overflow-hidden bg-white"
         data-name="${esc(d.name)}" data-id="${esc(d.id)}" title="${esc(d.name)}"${sampleAttr}>
      <div class="design-thumb-box flex items-center justify-center bg-gray-100 p-2" style="height:${THUMB_BOX.height + 16}px">
        <img class="design-thumb max-w-full max-h-full shadow-sm hidden${d.labelSize?.round && !d.isMultiLabel ? ' rounded-full' : ''}" alt="">
        <div class="design-thumb-loading text-xs text-gray-400">${t('gallery_thumb_loading')}</div>
      </div>
      <div class="p-2 min-w-0">
        <div class="font-medium text-xs text-gray-900 truncate">${esc(d.name)}</div>
        <div class="text-[11px] text-gray-400 truncate">${sizeText(d)} · ${t('n_elements', { n: d.elementCount })}</div>
        ${badges.length ? `<div class="flex flex-wrap gap-1 mt-1">${badges.join('')}</div>` : ''}
      </div>
      ${d.isSample ? '' : `<button class="delete-design absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 border border-gray-200 text-red-500 hover:text-red-700 hover:bg-red-50 text-sm leading-none opacity-70 group-hover:opacity-100"
              data-name="${esc(d.name)}" title="${esc(t('delete'))}" aria-label="${esc(t('delete'))}">×</button>`}
    </div>`;
}

function toggleHtml(view) {
  const btn = (v, label, icon) => `
    <button type="button" class="design-view-btn flex items-center gap-1 px-2 py-1 rounded-md text-xs ${view === v ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-800'}"
            data-view="${v}" aria-pressed="${view === v}" title="${esc(label)}">${icon}<span>${esc(label)}</span></button>`;
  const gridIcon = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v6H4zM14 15h6v6h-6z"/></svg>';
  const listIcon = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>';
  return `
    <div id="design-view-toggle" class="flex justify-end mb-2">
      <div class="inline-flex gap-1 p-0.5 bg-gray-100 rounded-lg">
        ${btn('grid', t('gallery_view_grid'), gridIcon)}
        ${btn('list', t('gallery_view_list'), listIcon)}
      </div>
    </div>`;
}

let renderToken = 0;

/** サンプルの欄を開いておくか(一度開け閉めしたら、このページを開いている間は覚えておく) */
let samplesOpenOverride = null;

function sectionHtml(view, items, idAttr) {
  if (!items.length) return '';
  return view === 'grid'
    ? `<div ${idAttr} class="design-grid grid gap-3" style="display:grid;gap:0.75rem;grid-template-columns:repeat(auto-fill,minmax(${THUMB_BOX.width}px,1fr))">${items.map(gridItemHtml).join('')}</div>`
    : `<div ${idAttr}>${items.map(listItemHtml).join('')}</div>`;
}

/**
 * 一覧を描く
 * @param {HTMLElement} listEl - #design-list
 * @param {Array} designs - storage.listDesigns() の結果
 * @param {object} opts
 * @param {(name:string)=>object|null} opts.getDesign - 名前からデザイン本体(storage.loadDesign)
 * @param {(name:string)=>void} opts.onOpen
 * @param {(name:string)=>void} opts.onDelete
 * @param {(view:string)=>void} [opts.onViewChange] - 表示を切り替えたとき(ダイアログの幅を変える)
 * @param {string} [opts.headerHtml] - 一覧の上に出す案内(ゲストモード・空のとき)
 * @param {(root:HTMLElement)=>void} [opts.onHeaderRendered]
 * @param {Array} [opts.samples] - samples.listSamples() の結果
 * @param {(sampleId:string)=>Promise<object|null>} [opts.getSample]
 * @param {(sampleId:string)=>void} [opts.onOpenSample]
 */
export function renderDesignList(listEl, designs, opts) {
  const view = getDesignListView();
  const token = ++renderToken;
  const samples = opts.samples || [];
  const samplesOpen = samplesOpenOverride ?? designs.length === 0;

  const samplesHtml = samples.length ? `
    <details id="design-samples" class="mt-3" ${samplesOpen ? 'open' : ''}>
      <summary class="cursor-pointer select-none text-sm font-medium text-gray-700 py-1">${t('gallery_samples', { n: samples.length })}</summary>
      <p class="text-xs text-gray-500 mb-2">${t('gallery_samples_hint')}</p>
      ${sectionHtml(view, samples, 'id="design-sample-grid"')}
    </details>` : '';

  listEl.innerHTML = toggleHtml(view)
    + (opts.headerHtml || '')
    + sectionHtml(view, designs, view === 'grid' ? 'id="design-grid"' : 'id="design-rows"')
    + samplesHtml;
  listEl.dataset.view = view;
  opts.onViewChange?.(view);
  opts.onHeaderRendered?.(listEl);

  listEl.querySelectorAll('.design-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.dataset.view === getDesignListView()) return;
      setDesignListView(btn.dataset.view);
      renderDesignList(listEl, designs, opts);
    });
  });

  const details = listEl.querySelector('#design-samples');
  details?.addEventListener('toggle', () => {
    samplesOpenOverride = details.open;
    if (details.open && view === 'grid') fillThumbnails(listEl, samples, opts, token, '#design-sample-grid');
  });

  listEl.querySelectorAll('.design-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (item.dataset.sample) {
        opts.onOpenSample?.(item.dataset.sample);
        return;
      }
      const del = e.target.closest('.delete-design');
      if (del) {
        e.stopPropagation();
        opts.onDelete(del.dataset.name);
        return;
      }
      opts.onOpen(item.dataset.name);
    });
  });

  if (view === 'grid') {
    fillThumbnails(listEl, designs, opts, token, '#design-grid').then(() => {
      if (details?.open) fillThumbnails(listEl, samples, opts, token, '#design-sample-grid');
    });
  }
}

/** サムネイルを1枚ずつ描いて差し込む(覚えているものはすぐ出す) */
async function fillThumbnails(listEl, items, opts, token, containerSel) {
  const byId = new Map(items.map(d => [d.id, d]));
  const pending = [];
  for (const card of listEl.querySelectorAll(`${containerSel} .design-card`)) {
    if (card.dataset.thumb) continue; // もう描いた・描いている
    const summary = byId.get(card.dataset.id);
    if (!summary) continue;
    card.dataset.thumb = '1';
    if (summary.isSample) {
      const key = `${summary.id}:${getLangKey()}`;
      if (thumbCache.has(key)) showThumb(card, thumbCache.get(key));
      else pending.push({ card, key, load: () => opts.getSample(summary.sampleId) });
      continue;
    }
    const design = opts.getDesign(summary.name);
    if (!design) {
      showThumb(card, null);
      continue;
    }
    const key = cacheKey(summary, design);
    if (thumbCache.has(key)) showThumb(card, thumbCache.get(key));
    else pending.push({ card, key, load: async () => design });
  }
  for (const { card, key, load } of pending) {
    if (token !== renderToken) return; // 描き直された
    let url = null;
    try {
      const design = await load();
      if (design) {
        url = await renderDesignThumbnail(design);
        remember(key, url);
      }
    } catch (e) {
      console.warn('thumbnail failed:', e);
    }
    if (token !== renderToken) return;
    showThumb(card, url);
  }
}

function getLangKey() {
  return document.documentElement.lang || '';
}

function showThumb(card, url) {
  const img = card.querySelector('.design-thumb');
  const loading = card.querySelector('.design-thumb-loading');
  if (url) {
    img.src = url;
    img.classList.remove('hidden');
    loading?.remove();
  } else if (loading) {
    loading.textContent = t('gallery_thumb_failed');
  }
}

/** テスト・デバッグ用 */
export function clearThumbnailCache() {
  thumbCache.clear();
}
