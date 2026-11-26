/**
 * 印刷時の回転(デザインの向きと用紙の向きが違うときに回して印刷する)
 *
 * - 機体ごとの既定: 接続しているプリンター(BLE/USB の名前)ごとに 0/90/180/270 を覚える
 * - デザインごとの指定: 'device'(機体の既定に従う)か 0/90/180/270。デザインと一緒に保存する
 * - 実際に使う角度 = デザインの指定が 'device' 以外ならそれ、でなければ機体の既定
 *
 * 角度は画面で見て時計回り。例: 30×40mm(縦長)のデザインを 90° にすると、
 * 40×30mm(横長)の用紙に、デザインの上側が右に来る向きで印刷される。
 */
import * as kv from './kv.js';

export const PRINT_ROTATIONS = [0, 90, 180, 270];
/** デザイン側の「機体の既定に従う」 */
export const ROTATION_FOLLOW_DEVICE = 'device';
/** 機体ごとの既定を保存するキー({ [機体名]: 角度 }) */
export const DEVICE_ROTATION_KEY = 'phomymo_device_print_rotation';
/** 機体ごとの既定がまだ無いときの角度(仮決め) */
export const DEFAULT_DEVICE_ROTATION = 0;

/** 0/90/180/270 に丸める。それ以外は null */
export function normalizeRotation(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const r = ((n % 360) + 360) % 360;
  return PRINT_ROTATIONS.includes(r) ? r : null;
}

/** デザイン側の値('device' か角度)をそろえる。分からない値は 'device' */
export function normalizeDesignRotation(value) {
  if (value === ROTATION_FOLLOW_DEVICE || value === undefined || value === null || value === '') {
    return ROTATION_FOLLOW_DEVICE;
  }
  const r = normalizeRotation(value);
  return r === null ? ROTATION_FOLLOW_DEVICE : r;
}

function readAll() {
  try {
    const parsed = JSON.parse(kv.getItem(DEVICE_ROTATION_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 機体ごとの既定の角度 */
export function getDeviceRotation(deviceName) {
  if (!deviceName) return DEFAULT_DEVICE_ROTATION;
  const r = normalizeRotation(readAll()[deviceName]);
  return r === null ? DEFAULT_DEVICE_ROTATION : r;
}

/** 機体ごとの既定の角度を保存する */
export function setDeviceRotation(deviceName, rotation) {
  if (!deviceName) return;
  const r = normalizeRotation(rotation);
  const all = readAll();
  if (r === null || r === DEFAULT_DEVICE_ROTATION) delete all[deviceName];
  else all[deviceName] = r;
  kv.setItem(DEVICE_ROTATION_KEY, JSON.stringify(all));
}

/** 実際に印刷で使う角度 */
export function resolvePrintRotation(designRotation, deviceName) {
  const d = normalizeDesignRotation(designRotation);
  return d === ROTATION_FOLLOW_DEVICE ? getDeviceRotation(deviceName) : d;
}

/** 回したあとの用紙の大きさ(mm) */
export function rotatedSize(width, height, rotation) {
  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height };
}
