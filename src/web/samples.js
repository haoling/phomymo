/**
 * サンプルデザイン(「デザインを開く」の一覧の下に並べる)
 *
 * - 保存はしない。開くと「名前のないデザイン」として読み込まれ、保存すれば自分のデザインになる
 * - 文言は表示言語(日本語 / English)に合わせる
 * - 素材(アイコン)は src/web/assets/ の SVG を開くときに PNG にして入れる
 * - 座標は px(1mm = 8px)
 *
 * 足すときは SAMPLES に1件足すだけでよい。
 */

import { generateId } from './elements.js?v=104';
import { createFrameElement, frameGeometryForLabel } from './frames.js';
import { JA_FONTS, fontValue } from './fonts-ja.js?v=1';
import { rasterizeSvg } from './assets-panel.js';
import { getLang } from './i18n.js';

const MM = 8;
const GOTHIC = fontValue(JA_FONTS[0]);
const UD = fontValue(JA_FONTS[1]);
const MARU = fontValue(JA_FONTS[3]);
const MINCHO = fontValue(JA_FONTS[4]);

/** 言語ごとの文言 */
const L = (ja, en) => ({ ja, en });

function text(str, x, y, width, height, opts = {}) {
  return {
    type: 'text', x, y, width, height, rotation: 0,
    text: str,
    fontSize: opts.fontSize ?? 24,
    color: opts.color ?? 'black',
    align: opts.align ?? 'center',
    verticalAlign: opts.verticalAlign ?? 'middle',
    fontFamily: opts.fontFamily ?? GOTHIC,
    fontWeight: opts.fontWeight ?? 'normal',
    fontStyle: 'normal',
    textDecoration: 'none',
    background: opts.background ?? 'transparent',
    noWrap: opts.noWrap ?? true,
    clipOverflow: false,
    autoScale: opts.autoScale ?? false,
    letterSpacing: opts.letterSpacing ?? 0,
    arc: opts.arc ?? null,
    writingMode: opts.writingMode ?? 'horizontal',
  };
}

function icon(assetId, x, y, size) {
  return { type: 'image', asset: assetId, x, y, width: size, height: size, rotation: 0 };
}

function frame(style, wMm, hMm, opts = {}) {
  const el = createFrameElement({ frameStyle: style, frameShape: opts.shape, strokeWidth: opts.strokeWidth });
  const geo = frameGeometryForLabel(el, { width: wMm * MM, height: hMm * MM });
  const { id, ...rest } = el;
  return { ...rest, ...geo };
}

function shape(shapeType, x, y, width, height, opts = {}) {
  return {
    type: 'shape', x, y, width, height, rotation: 0, shapeType,
    fill: opts.fill ?? 'black', stroke: opts.stroke ?? 'none',
    strokeWidth: opts.strokeWidth ?? 2, cornerRadius: opts.cornerRadius ?? 0,
  };
}

/**
 * サンプル一覧。elements(lang) は言語ごとの要素を返す
 * 仮決め: 家庭・小さなお店でよく使いそうなものを10件
 */
export const SAMPLES = [
  {
    id: 'name-sticker',
    name: L('なまえシール', 'Name sticker'),
    labelSize: { width: 40, height: 30 },
    elements: (l) => [
      frame('hearts', 40, 30),
      text(l === 'en' ? 'NAME' : 'なまえ', 24, 40, 272, 40, { fontSize: 22, fontFamily: MARU, letterSpacing: 0.2 }),
      text(l === 'en' ? 'Alex Smith' : 'やまだ はなこ', 48, 92, 224, 80, { fontSize: 36, fontFamily: MARU, fontWeight: 'bold', autoScale: true }),
      shape('line', 56, 176, 208, 4, { fill: 'black' }),
    ],
  },
  {
    id: 'spice',
    name: L('調味料ラベル', 'Spice jar'),
    labelSize: { width: 30, height: 20 },
    elements: (l) => [
      frame('rounded', 30, 20),
      icon('tabler:salt', 24, 40, 80),
      text(l === 'en' ? 'SALT' : 'しお', 104, 32, 116, 96, { fontSize: 52, fontFamily: MARU, fontWeight: 'bold', autoScale: true }),
    ],
  },
  {
    id: 'freezer',
    name: L('冷凍保存', 'Freezer label'),
    labelSize: { width: 40, height: 30 },
    elements: (l) => [
      frame('single', 40, 30),
      icon('tabler:snowflake', 24, 24, 72),
      text(l === 'en' ? 'FROZEN' : '冷凍保存', 104, 24, 196, 72, { fontSize: 40, fontWeight: 'bold', align: 'left', autoScale: true }),
      text(l === 'en' ? 'Item:' : '中身:', 24, 112, 272, 48, { fontSize: 26, align: 'left' }),
      text(l === 'en' ? 'Date: [[date|YYYY/MM/DD]]' : '日付: [[date|YYYY/MM/DD]]', 24, 164, 272, 48, { fontSize: 26, align: 'left' }),
    ],
  },
  {
    id: 'storage',
    name: L('収納ラベル', 'Storage box'),
    labelSize: { width: 50, height: 30 },
    elements: (l) => [
      frame('corners', 50, 30),
      icon('tabler:pencil', 40, 64, 112),
      text(l === 'en' ? 'Stationery' : '文房具', 164, 48, 208, 144, { fontSize: 64, fontFamily: UD, fontWeight: 'bold', autoScale: true }),
    ],
  },
  {
    id: 'fragile',
    name: L('取扱注意', 'Fragile'),
    labelSize: { width: 50, height: 30 },
    elements: (l) => [
      shape('rectangle', 8, 8, 384, 224, { fill: 'black', cornerRadius: 16 }),
      text(l === 'en' ? 'FRAGILE' : '取扱注意', 24, 32, 352, 112, { fontSize: 72, fontWeight: 'bold', color: 'white', autoScale: true }),
      text(l === 'en' ? 'Handle with care' : 'こわれもの・天地無用', 24, 152, 352, 56, { fontSize: 28, color: 'white', autoScale: true }),
    ],
  },
  {
    id: 'wifi',
    name: L('Wi-Fi の QRコード', 'Wi-Fi QR code'),
    labelSize: { width: 40, height: 30 },
    elements: (l) => [
      { type: 'qr', x: 16, y: 24, width: 192, height: 192, rotation: 0, qrData: 'WIFI:T:WPA;S:MyWiFi;P:password;;' },
      icon('tabler:wifi', 224, 40, 72),
      text('Wi-Fi', 208, 120, 104, 40, { fontSize: 28, fontWeight: 'bold' }),
      text(l === 'en' ? 'Scan to join' : '読み取って接続', 208, 164, 104, 32, { fontSize: 16, autoScale: true }),
    ],
  },
  {
    id: 'inventory',
    name: L('在庫管理バーコード', 'Inventory barcode'),
    labelSize: { width: 50, height: 30 },
    elements: (l) => [
      text(l === 'en' ? 'Screw M3 x 10' : 'ネジ M3×10', 16, 12, 368, 56, { fontSize: 36, fontWeight: 'bold', autoScale: true }),
      { type: 'barcode', x: 32, y: 76, width: 336, height: 144, rotation: 0, barcodeData: 'ITEM-0001', barcodeFormat: 'CODE128' },
    ],
  },
  {
    id: 'thanks',
    name: L('サンキューシール', 'Thank-you sticker'),
    labelSize: { width: 40, height: 40, round: true },
    elements: (l) => [
      frame('dotted', 40, 40, { shape: 'ellipse' }),
      text('THANK YOU', 0, 0, 320, 320, { fontSize: 34, fontWeight: 'bold', letterSpacing: 0.15, arc: { radius: 112, direction: 'up' } }),
      icon('tabler:heart:filled', 116, 112, 88),
      text(l === 'en' ? 'for your order' : 'ありがとうございます', 40, 216, 240, 40, { fontSize: 22, fontFamily: MARU, autoScale: true }),
    ],
  },
  {
    id: 'serial',
    name: L('管理番号(連番)', 'Serial number'),
    labelSize: { width: 40, height: 30 },
    elements: (l) => [
      frame('ticket', 40, 30),
      text(l === 'en' ? 'ASSET No.' : '管理番号', 24, 32, 272, 48, { fontSize: 26, letterSpacing: 0.1 }),
      text('[[counter|start=1,pad=4]]', 24, 88, 272, 104, { fontSize: 72, fontWeight: 'bold', fontFamily: 'Roboto Mono, monospace' }),
    ],
  },
  {
    id: 'price',
    name: L('値札', 'Price tag'),
    labelSize: { width: 30, height: 20 },
    elements: (l) => [
      frame('double', 30, 20),
      text(l === 'en' ? '$5.00' : '¥500', 16, 24, 208, 88, { fontSize: 60, fontWeight: 'bold', fontFamily: MINCHO, autoScale: true }),
      text(l === 'en' ? 'tax incl.' : '(税込)', 16, 108, 208, 32, { fontSize: 20 }),
    ],
  },
];

function currentLang() {
  return getLang() === 'en' ? 'en' : 'ja';
}

export function sampleName(sample, lang = currentLang()) {
  return sample.name[lang] || sample.name.ja;
}

/** 一覧に出す要約(storage.listDesigns() と同じ形) */
export function listSamples(lang = currentLang()) {
  return SAMPLES.map(s => {
    const els = s.elements(lang);
    return {
      id: `sample:${s.id}`,
      sampleId: s.id,
      name: sampleName(s, lang),
      labelSize: s.labelSize,
      elementCount: els.length,
      hasImages: els.some(e => e.type === 'image'),
      isTemplate: false,
      templateDataCount: 0,
      isMultiLabel: false,
      multiLabel: null,
      dirty: false,
      isSample: true,
    };
  });
}

const iconCache = new Map(); // assetId -> Promise<{dataUrl,width,height}>

async function loadIcon(assetId) {
  if (!iconCache.has(assetId)) {
    iconCache.set(assetId, (async () => {
      const res = await fetch('assets/manifest.json');
      const manifest = await res.json();
      const item = manifest.items.find(i => i.id === assetId);
      if (!item) throw new Error(`asset not found: ${assetId}`);
      const svg = await (await fetch('assets/' + item.file)).text();
      return rasterizeSvg(svg);
    })().catch((e) => {
      iconCache.delete(assetId);
      throw e;
    }));
  }
  return iconCache.get(assetId);
}

/**
 * サンプルを、開ける形のデザインにする(要素に id を付け、素材を画像にする)
 * @returns {Promise<object|null>}
 */
export async function buildSampleDesign(sampleId, lang = currentLang()) {
  const sample = SAMPLES.find(s => s.id === sampleId);
  if (!sample) return null;
  const elements = [];
  for (const el of sample.elements(lang)) {
    const out = { ...el, id: generateId(), zone: 0 };
    if (el.type === 'image' && el.asset) {
      try {
        const { dataUrl, width, height } = await loadIcon(el.asset);
        delete out.asset;
        Object.assign(out, {
          imageData: dataUrl, naturalWidth: width, naturalHeight: height,
          lockAspectRatio: true, crop: null, flipX: false, flipY: false, assetId: el.asset,
        });
      } catch (e) {
        console.warn('sample icon failed:', e);
        continue;
      }
    }
    elements.push(out);
  }
  return {
    elements,
    labelSize: { ...sample.labelSize },
    savedAt: 0,
  };
}
