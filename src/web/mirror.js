/**
 * ミラー配置(シールを2つ折りにして使うためのもの)
 *
 * 要素に `mirror: { axis, orient }` を持たせると、用紙の中心線(折り線)をはさんだ
 * 反対側に、同じ要素の写しを描く。写しは保存されない「描くときだけの要素」なので、
 * 元の要素を編集すれば写しもそのまま追従する。
 *
 * - axis: 'x' … 縦の折り線(左右に折る) / 'y' … 横の折り線(上下に折る)
 * - orient: 写しの向き
 *     'mirror'    … 鏡像(折り線で鏡に映した形。文字は裏返しになる)
 *     'upright'   … 反転しない(位置だけ反対側。折って裏から見ると読める向き)
 *     'rotate180' … 180°回して置く(上下に折ったものを横に返して見るとき読める向き)
 */

/** 折り線の向きの選択肢(先頭が既定) */
export const MIRROR_AXES = ['x', 'y'];
/** 写しの向きの選択肢 */
export const MIRROR_ORIENTS = ['mirror', 'upright', 'rotate180'];

/**
 * 折る向きごとの、写しの向きの既定(はおりんの指定)
 * 左右に折る → 反転しない / 上下に折る → 180°回転(どちらも折って裏から見ると読める向き)
 */
export const DEFAULT_ORIENT_BY_AXIS = Object.freeze({ x: 'upright', y: 'rotate180' });

/** ミラー配置をオンにしたときの既定値(ここを変えれば既定が変わる) */
export const DEFAULT_MIRROR = Object.freeze({ axis: 'x', orient: DEFAULT_ORIENT_BY_AXIS.x });

/** その折る向きのときの写しの向きの既定 */
export function defaultOrientFor(axis) {
  return DEFAULT_ORIENT_BY_AXIS[axis] || DEFAULT_MIRROR.orient;
}

/**
 * 要素の mirror を正しい形にそろえる。ミラー配置しないなら null
 * @param {*} mirror
 * @returns {{axis:'x'|'y', orient:string}|null}
 */
export function normalizeMirror(mirror) {
  if (!mirror || typeof mirror !== 'object') return null;
  const axis = MIRROR_AXES.includes(mirror.axis) ? mirror.axis : DEFAULT_MIRROR.axis;
  const orient = MIRROR_ORIENTS.includes(mirror.orient) ? mirror.orient : defaultOrientFor(axis);
  return { axis, orient };
}

/**
 * 1つの要素の写しを作る(ミラー配置しない要素なら null)
 * 座標はその要素が属するラベル(多面ラベルなら1面)の中での値。
 * @param {Object} element
 * @param {number} labelWidth
 * @param {number} labelHeight
 * @returns {Object|null}
 */
export function mirrorCopyOf(element, labelWidth, labelHeight) {
  const m = normalizeMirror(element?.mirror);
  if (!m) return null;
  const rotation = element.rotation || 0;
  const copy = { ...element, _mirrorCopy: true };
  delete copy.mirror;
  if (m.axis === 'x') {
    copy.x = labelWidth - element.x - element.width;
  } else {
    copy.y = labelHeight - element.y - element.height;
  }
  if (m.orient === 'mirror') {
    // 鏡像: 要素の中心で裏返してから元と同じだけ回す(= 折り線での鏡映し)
    copy._mirrorScale = m.axis === 'x' ? [-1, 1] : [1, -1];
    copy.rotation = rotation;
  } else if (m.orient === 'upright') {
    copy.rotation = normalizeDeg(-rotation);
  } else {
    copy.rotation = normalizeDeg(180 - rotation);
  }
  return copy;
}

/**
 * 描く用の要素の並びを作る。ミラー配置の要素のすぐ後ろ(重なり順で1つ上)に写しを入れる。
 * ミラー配置の要素が1つもなければ、渡された配列をそのまま返す。
 */
export function withMirrorCopies(elements, labelWidth, labelHeight) {
  if (!Array.isArray(elements) || !elements.some(e => e && e.mirror)) return elements;
  const out = [];
  for (const el of elements) {
    out.push(el);
    const copy = mirrorCopyOf(el, labelWidth, labelHeight);
    if (copy) out.push(copy);
  }
  return out;
}

/** 折り線を描く必要があれば、その向きの一覧を返す(重複なし) */
export function foldAxesOf(elements) {
  const axes = new Set();
  for (const el of elements || []) {
    const m = normalizeMirror(el?.mirror);
    if (m) axes.add(m.axis);
  }
  return [...axes];
}

function normalizeDeg(deg) {
  const d = ((deg % 360) + 360) % 360;
  return d;
}
