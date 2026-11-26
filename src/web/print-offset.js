/**
 * 印刷の横位置の補正(プリンターごと)
 *
 * 用紙がヘッドの中央に来ない機種や個体で、印刷が左右にずれるのを直すためのもの。
 * 接続しているプリンター(BLE/USB の名前)ごとに、横にずらす量(mm)を覚える。
 * ＋で右へ、−で左へずらす(印刷面を見て、文字が読める向きで)。
 *
 * ずらすのは印刷データ(ラスター)の各行を、ヘッドの幅の中で横に動かすだけ。
 * テープ機・D シリーズのように 90° 回して送る機種では、横が送り方向になるので使わない。
 */
import * as kv from './kv.js';
import { t } from './i18n.js';

/** 機体ごとの補正を保存するキー({ [機体名]: mm }) */
export const DEVICE_OFFSET_KEY = 'phomymo_device_print_offset_x';
/** 補正できる範囲(mm)。仮決め */
export const OFFSET_MIN_MM = -10;
export const OFFSET_MAX_MM = 10;
/** 補正の刻み(mm)。仮決め */
export const OFFSET_STEP_MM = 0.5;
/** 203dpi のときの 1mm あたりのドット数 */
const DOTS_PER_MM_203 = 8;

/** mm を範囲内・刻みにそろえる。数でなければ 0 */
export function normalizeOffsetMm(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.min(OFFSET_MAX_MM, Math.max(OFFSET_MIN_MM, n));
  const stepped = Math.round(clamped / OFFSET_STEP_MM) * OFFSET_STEP_MM;
  return Object.is(stepped, -0) ? 0 : stepped;
}

function readAll() {
  try {
    const parsed = JSON.parse(kv.getItem(DEVICE_OFFSET_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 機体ごとの横位置の補正(mm)。未設定なら 0 */
export function getDeviceOffsetMm(deviceName) {
  if (!deviceName) return 0;
  return normalizeOffsetMm(readAll()[deviceName]);
}

/** 機体ごとの横位置の補正(mm)を保存する。0 なら消す */
export function setDeviceOffsetMm(deviceName, mm) {
  if (!deviceName) return;
  const v = normalizeOffsetMm(mm);
  const all = readAll();
  if (v === 0) delete all[deviceName];
  else all[deviceName] = v;
  kv.setItem(DEVICE_OFFSET_KEY, JSON.stringify(all));
}

/** mm をドット数に(dpi に合わせる) */
export function offsetMmToDots(mm, dpi = 203) {
  return Math.round(normalizeOffsetMm(mm) * DOTS_PER_MM_203 * (dpi / 203));
}

/**
 * ラスターの各行を横に dots ドットずらす(＋で右、−で左)。はみ出た分は捨てる。
 * 幅・行数は変えない。
 * @param {{data: Uint8Array, widthBytes: number, heightLines: number}} raster
 * @param {number} dots
 * @returns {{data: Uint8Array, widthBytes: number, heightLines: number}}
 */
export function shiftRasterX(raster, dots) {
  const shift = Math.round(Number(dots) || 0);
  if (!shift || !raster?.data) return raster;
  const { data, widthBytes, heightLines } = raster;
  const widthPx = widthBytes * 8;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < heightLines; y++) {
    const row = y * widthBytes;
    for (let byteX = 0; byteX < widthBytes; byteX++) {
      const byte = data[row + byteX];
      if (!byte) continue;
      for (let bit = 0; bit < 8; bit++) {
        if (!(byte & (0x80 >> bit))) continue;
        const nx = byteX * 8 + bit + shift;
        if (nx < 0 || nx >= widthPx) continue;
        out[row + (nx >> 3)] |= 0x80 >> (nx & 7);
      }
    }
  }
  return { ...raster, data: out };
}

/**
 * 印刷設定ダイアログの「横位置の補正」欄をつなぐ
 * @param {{ getDeviceName: () => string }} opts - 接続中の機体名(未接続なら '')
 */
export function initPrintOffsetUI({ getDeviceName }) {
  const input = document.querySelector('#print-offset-x');
  if (!input) return;
  const label = document.querySelector('#print-offset-label');
  const note = document.querySelector('#print-offset-note');
  const deviceName = () => (typeof getDeviceName === 'function' ? getDeviceName() : '') || '';

  const load = () => {
    const name = deviceName();
    input.value = String(getDeviceOffsetMm(name));
    input.disabled = !name;
    document.querySelectorAll('[data-print-offset-step]').forEach((b) => { b.disabled = !name; });
    if (label) label.textContent = name ? t('print_offset_named', { name }) : t('print_offset');
    note?.classList.toggle('hidden', !!name);
  };

  const nudge = (delta) => {
    input.value = String(normalizeOffsetMm((Number(input.value) || 0) + delta));
  };

  document.querySelectorAll('[data-print-offset-step]').forEach((b) => {
    b.addEventListener('click', () => nudge(Number(b.dataset.printOffsetStep) || 0));
  });
  input.addEventListener('change', () => { input.value = String(normalizeOffsetMm(input.value)); });

  document.querySelector('#print-settings-btn')?.addEventListener('click', load);
  document.querySelector('#mobile-print-settings-btn')?.addEventListener('click', load);
  document.querySelector('#print-settings-reset')?.addEventListener('click', () => { input.value = '0'; });
  // 「保存」で保存する(ダイアログを閉じる処理より先に読んでおく)
  document.querySelector('#print-settings-save')?.addEventListener('click', () => {
    const name = deviceName();
    if (name) setDeviceOffsetMm(name, input.value);
  }, { capture: true });

  // 言語を切り替えたとき用
  return { refresh: load };
}
