/**
 * 濃さのテスト印刷
 *
 * 濃さの設定(1〜8)を変えて、同じ見本を1段階につき1枚ずつ印刷する。
 * 印刷した見本を見比べて、ちょうどよい濃さを選んでもらうためのもの。
 *
 * 濃さはプリンターへの印刷1回ごとの設定なので、1枚のラベルの中で濃さを変えることはできない。
 * そのため「1段階 = 1枚」になる。枚数を抑えるため、既定では今の濃さとその前後だけを印刷する。
 */

import { createTextElement, createShapeElement } from './elements.js?v=104';

export const DENSITY_MIN = 1;
export const DENSITY_MAX = 8;

/**
 * 何段階を印刷するか
 * - near: 今の濃さとその前後(最大 NEAR_SPAN*2+1 枚)
 * - all:  1〜8 全部
 */
export const DENSITY_TEST_RANGES = ['near', 'all'];
export const DEFAULT_DENSITY_TEST_RANGE = 'near';
// 「前後」を何段階ずつ含めるか(仮決め: 1 → 最大3枚)
export const NEAR_SPAN = 1;

/**
 * 印刷する濃さの一覧を、薄い順に返す
 * @param {number} current - 今の濃さ(1〜8)
 * @param {'near'|'all'} range
 * @returns {number[]}
 */
export function densityTestLevels(current, range = DEFAULT_DENSITY_TEST_RANGE) {
  const c = Math.min(DENSITY_MAX, Math.max(DENSITY_MIN, Math.round(Number(current) || 6)));
  const from = range === 'all' ? DENSITY_MIN : Math.max(DENSITY_MIN, c - NEAR_SPAN);
  const to = range === 'all' ? DENSITY_MAX : Math.min(DENSITY_MAX, c + NEAR_SPAN);
  const levels = [];
  for (let d = from; d <= to; d++) levels.push(d);
  return levels;
}

/**
 * 1枚分の見本(ラベルの要素)を作る
 *
 * 上: 「濃さ 5」の大きな文字(今の設定には ★ を付ける)
 * 中: 黒べた・濃い網・中くらいの網・薄い網の4つの四角(かすれ・にじみを見る)
 * 下: 小さな文字(細い線がつぶれないかを見る)
 *
 * @param {number} density - この見本の濃さ
 * @param {object} opts
 * @param {number} opts.width - ラベルの幅(px, 8px = 1mm)
 * @param {number} opts.height - ラベルの高さ(px)
 * @param {string} opts.title - 上の文字(例: "濃さ 5")
 * @param {boolean} [opts.isCurrent] - 今の設定かどうか
 * @param {string} [opts.sampleText] - 下の小さな文字
 * @returns {Array} 要素の配列
 */
export function buildDensityTestElements(density, opts) {
  const { width, height, title, isCurrent = false, sampleText = 'あア漢字 Abc 123' } = opts;
  const margin = Math.max(4, Math.round(Math.min(width, height) * 0.06));
  const innerW = Math.max(8, width - margin * 2);
  const innerH = Math.max(8, height - margin * 2);
  const gap = Math.max(2, Math.round(innerH * 0.05));

  const titleH = Math.round((innerH - gap * 2) * 0.42);
  const patchH = Math.round((innerH - gap * 2) * 0.33);
  const sampleH = innerH - gap * 2 - titleH - patchH;

  const elements = [];

  elements.push(createTextElement(`${isCurrent ? '★' : ''}${title}`, {
    x: margin,
    y: margin,
    width: innerW,
    height: titleH,
    fontSize: Math.max(8, Math.round(titleH * 0.8)),
    fontWeight: 'bold',
    align: 'center',
    noWrap: true,
    autoScale: true,
  }));

  const fills = ['black', 'dither-75', 'dither-50', 'dither-25'];
  const patchGap = Math.max(2, Math.round(innerW * 0.03));
  const patchW = Math.floor((innerW - patchGap * (fills.length - 1)) / fills.length);
  const patchY = margin + titleH + gap;
  fills.forEach((fill, i) => {
    elements.push(createShapeElement('rectangle', {
      x: margin + i * (patchW + patchGap),
      y: patchY,
      width: patchW,
      height: patchH,
      fill,
      stroke: fill === 'black' ? 'none' : 'black',
      strokeWidth: 1,
    }));
  });

  elements.push(createTextElement(sampleText, {
    x: margin,
    y: patchY + patchH + gap,
    width: innerW,
    height: sampleH,
    fontSize: Math.max(6, Math.round(sampleH * 0.7)),
    align: 'center',
    noWrap: true,
    autoScale: true,
  }));

  // どの濃さの見本かを後から確かめられるように残しておく
  elements.forEach(el => { el.densityTest = density; });
  return elements;
}
