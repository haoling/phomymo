/**
 * テキストの組版ヘルパー(#24 字間・曲線文字)
 *
 * canvas.js の renderTextElement から呼ばれる。1文字ずつ並べる処理をここにまとめ、
 * 縦書き(#22)など、別の組み方を足すときもこのモジュールに追加する想定。
 *
 * 単位:
 * - element.letterSpacing: 文字の大きさに対する割合(em)。0.1 = 文字の大きさの 10%
 * - element.arc: null(まっすぐ)か { radius, direction }
 *   - radius: 円弧の半径(px = ドット)。文字の高さの中心が通る円
 *   - direction: 'up'(∩ 円の上側に沿う)か 'down'(∪ 円の下側に沿う)
 *   - 円の中心は要素の中心
 */

/** 字間の上限・下限(em)。UI のスライダーもこれに合わせる */
export const LETTER_SPACING_MIN = -0.3;
export const LETTER_SPACING_MAX = 2;

/** 曲線文字の半径の上限・下限(px) */
export const ARC_RADIUS_MIN = 8;
export const ARC_RADIUS_MAX = 2000;

/** 曲線文字にしたときの外側の余白(文字の大きさに対する割合) */
const ARC_BOX_MARGIN_EM = 0.8;

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('ja', { granularity: 'grapheme' })
  : null;

/** 文字列を「見た目の1文字」(絵文字や結合文字をまとめた単位)に分ける */
export function splitGraphemes(text) {
  if (!text) return [];
  if (segmenter) return Array.from(segmenter.segment(text), s => s.segment);
  return Array.from(text);
}

/** 字間(em)を安全な数値にする */
export function normalizeLetterSpacing(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(LETTER_SPACING_MAX, Math.max(LETTER_SPACING_MIN, n));
}

/** arc を安全な形にする。曲線文字でなければ null */
export function normalizeArc(arc) {
  if (!arc || typeof arc !== 'object') return null;
  const r = Number(arc.radius);
  if (!Number.isFinite(r) || r <= 0) return null;
  return {
    radius: Math.min(ARC_RADIUS_MAX, Math.max(ARC_RADIUS_MIN, r)),
    direction: arc.direction === 'down' ? 'down' : 'up',
  };
}

/** 字間を px にする */
export function letterSpacingPx(element, fontSize) {
  return normalizeLetterSpacing(element?.letterSpacing) * fontSize;
}

/**
 * 1行の幅を測る(字間込み)。字間が 0 ならブラウザの measureText と同じ値
 * ctx.font は呼び出し側で設定しておく
 */
export function measureLine(ctx, line, spacingPx = 0) {
  if (!spacingPx) return ctx.measureText(line).width;
  const chars = splitGraphemes(line);
  if (!chars.length) return 0;
  let w = 0;
  for (const ch of chars) w += ctx.measureText(ch).width;
  return w + spacingPx * (chars.length - 1);
}

/**
 * 1行を描く。字間が 0 なら普通の fillText、そうでなければ1文字ずつ並べる
 * x は textAlign(left/center/right)の基準点。ctx.textAlign の値に合わせて配置する
 */
export function drawLine(ctx, line, x, y, spacingPx = 0) {
  if (!spacingPx) {
    ctx.fillText(line, x, y);
    return;
  }
  const chars = splitGraphemes(line);
  if (!chars.length) return;
  const widths = chars.map(ch => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacingPx * (chars.length - 1);
  const align = ctx.textAlign;
  let left = x;
  if (align === 'center') left = x - total / 2;
  else if (align === 'right' || align === 'end') left = x - total;

  ctx.save();
  ctx.textAlign = 'left';
  let cx = left;
  chars.forEach((ch, i) => {
    ctx.fillText(ch, cx, y);
    cx += widths[i] + spacingPx;
  });
  ctx.restore();
}

/**
 * 円弧に沿って文字を描く(要素の中心を原点にした座標系で呼ぶ)
 *
 * - 'up': 円の上側を左から右へ。2行目以降は内側へ
 * - 'down': 円の下側を左から右へ(文字は正立)。2行目以降は外側へ
 * 文字列は常に円の頂点(上なら真上、下なら真下)を中心に並べる
 *
 * @returns {Array<{radius:number, angle:number}>} 各行の半径と、使った角度(ラジアン)
 */
export function drawArcText(ctx, lines, { radius, direction, spacingPx = 0, lineHeight, underline = false, fontSize = 16 }) {
  const result = [];
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  lines.forEach((line, lineIndex) => {
    const r = direction === 'down'
      ? radius + lineIndex * lineHeight
      : radius - lineIndex * lineHeight;
    if (r <= 1) return;
    const chars = splitGraphemes(line);
    const widths = chars.map(ch => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacingPx * Math.max(0, chars.length - 1);
    const span = total / r;
    result.push({ radius: r, angle: span });

    let pos = 0;
    chars.forEach((ch, i) => {
      const mid = (pos + widths[i] / 2) / r;
      ctx.save();
      if (direction === 'down') {
        ctx.rotate(span / 2 - mid);
        ctx.fillText(ch, 0, r);
      } else {
        ctx.rotate(-span / 2 + mid);
        ctx.fillText(ch, 0, -r);
      }
      ctx.restore();
      pos += widths[i] + spacingPx;
    });

    if (underline && chars.length) {
      // 文字の下側に沿った円弧を引く('up' なら内側、'down' なら外側)
      const off = fontSize * 0.45;
      const ur = direction === 'down' ? r + off : r - off;
      if (ur > 0) {
        ctx.beginPath();
        ctx.lineWidth = Math.max(1, fontSize / 16);
        if (direction === 'down') {
          ctx.arc(0, 0, ur, Math.PI / 2 - span / 2, Math.PI / 2 + span / 2);
        } else {
          ctx.arc(0, 0, ur, -Math.PI / 2 - span / 2, -Math.PI / 2 + span / 2);
        }
        ctx.stroke();
      }
    }
  });

  ctx.restore();
  return result;
}

/**
 * 曲線文字にするときの要素の大きさ(正方形の一辺)
 * 円がちょうど収まり、外側に文字ぶんの余白がある大きさ
 */
export function arcBoxSize(radius, fontSize, lineCount = 1, direction = 'up') {
  const extraLines = direction === 'down' ? Math.max(0, lineCount - 1) * fontSize * 1.2 : 0;
  return Math.ceil(2 * (radius + extraLines + fontSize * ARC_BOX_MARGIN_EM));
}

/**
 * 箱(幅・高さ)にちょうど収まる半径
 * 丸ラベル全体に広げたとき、文字が外にはみ出さない大きさにする
 */
export function arcRadiusForBox(width, height, fontSize, lineCount = 1, direction = 'up') {
  const extraLines = direction === 'down' ? Math.max(0, lineCount - 1) * fontSize * 1.2 : 0;
  const r = Math.min(width, height) / 2 - fontSize * ARC_BOX_MARGIN_EM - extraLines;
  return Math.max(ARC_RADIUS_MIN, Math.round(r));
}

/**
 * 曲線文字をオンにしたときの初期の半径
 * 1行目がおよそ 120° に広がる大きさ(短い文字列でも曲がり過ぎないよう下限あり)
 */
export function defaultArcRadius(lineWidth, fontSize) {
  const r = lineWidth / ((2 * Math.PI) / 3);
  return Math.round(Math.min(ARC_RADIUS_MAX, Math.max(fontSize * 2, r)));
}

// ===========================================================================
// 縦書き(#22)
// ===========================================================================
//
// - element.writingMode: 'horizontal'(既定)か 'vertical'
// - element.tcy: 縦中横。true なら、TCY_MAX_CHARS 文字以下の半角数字のまとまりを横に並べて1マスに入れる
// - element.latinMode: 縦書きの中の半角英数字の扱い
//   - 'rotate'(既定): まとまりごとに 90° 寝かせる(ブラウザの縦書きと同じ)
//   - 'upright': 1文字ずつ立てて並べる
// 行(列)は右から左へ並ぶ。1列の幅は文字の大きさ × LINE_HEIGHT

/** 1列の幅(文字の大きさに対する割合)。横書きの行の高さと同じ */
export const VERTICAL_LINE_HEIGHT = 1.2;

/** 縦中横にする文字数の上限(この文字数以下の半角数字のまとまりを横に並べる) */
export const TCY_MAX_CHARS = 2;

/** 縦書きの初期設定(要素に値が無いとき) */
export const VERTICAL_DEFAULTS = Object.freeze({ tcy: true, latinMode: 'rotate' });

/** 句読点: マスの右上に寄せる */
const VERTICAL_PUNCT = new Set(['、', '。', '，', '．', '､', '｡']);
/** 小書きの仮名: 少し右上に寄せる */
const VERTICAL_SMALL_KANA = new Set(Array.from('ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ'));
/** 90° 回して描く約物(括弧・長音・波線・ダッシュ・三点リーダーなど) */
const VERTICAL_ROTATE = new Set(Array.from(
  '「」『』（）()［］[]｛｝{}〔〕〈〉《》【】〖〗〘〙〚〛＜＞<>‹›«»ー－−‐‑–—―～〜~…‥＝=｜|：:；;→←⇒⇔'
));
/** 列の先頭に来てはいけない文字(行頭禁則の簡易版) */
const NO_LINE_START = new Set(Array.from('、。，．,.)）」』】〕〉》〙〗〛ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ!?！？・：；ゝゞヽヾ々…‥'));

/** 句読点を右上に寄せる量(文字の大きさに対する割合) */
const PUNCT_OFFSET_EM = { x: 0.6, y: -0.6 };
const SMALL_KANA_OFFSET_EM = { x: 0.1, y: -0.1 };

export function normalizeWritingMode(value) {
  return value === 'vertical' ? 'vertical' : 'horizontal';
}

export function isVertical(element) {
  return normalizeWritingMode(element?.writingMode) === 'vertical' && !normalizeArc(element?.arc);
}

/** 縦書きの設定を、値が無ければ初期値で埋めて返す */
export function verticalOptions(element) {
  return {
    tcy: typeof element?.tcy === 'boolean' ? element.tcy : VERTICAL_DEFAULTS.tcy,
    latinMode: element?.latinMode === 'upright' ? 'upright' : (element?.latinMode === 'rotate' ? 'rotate' : VERTICAL_DEFAULTS.latinMode),
  };
}

/** 半角(ASCII の表示文字と半角スペース)か */
function isHalfWidth(ch) {
  if (ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return c >= 0x20 && c <= 0x7e;
}

/**
 * 1行(改行で区切った文字列)を、縦書きの「マス」に分ける
 * マス = { kind, text, advance }
 *   kind: 'upright' | 'punct' | 'small' | 'rotate' | 'latin'(寝かせた欧文) | 'tcy'(縦中横)
 *   advance: 縦方向に進む量(px)
 */
export function verticalCells(ctx, line, fontSize, { tcy = VERTICAL_DEFAULTS.tcy, latinMode = VERTICAL_DEFAULTS.latinMode } = {}) {
  const chars = splitGraphemes(line);
  const cells = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (isHalfWidth(ch)) {
      // 半角のまとまりを取る
      let j = i;
      while (j < chars.length && isHalfWidth(chars[j])) j++;
      const run = chars.slice(i, j).join('');
      if (tcy && /^[0-9]+$/.test(run) && run.length <= TCY_MAX_CHARS) {
        cells.push({ kind: 'tcy', text: run, advance: fontSize });
      } else if (latinMode === 'upright') {
        for (const c of chars.slice(i, j)) {
          cells.push(VERTICAL_ROTATE.has(c)
            ? { kind: 'rotate', text: c, advance: fontSize }
            : { kind: 'upright', text: c, advance: fontSize });
        }
      } else {
        // 寝かせる: 長いまとまりは折り返せるよう、単語(空白区切り)ごとに分ける
        const parts = run.match(/\S+\s*|\s+/g) || [run];
        for (const p of parts) cells.push({ kind: 'latin', text: p, advance: ctx.measureText(p).width });
      }
      i = j;
      continue;
    }
    let kind = 'upright';
    if (VERTICAL_PUNCT.has(ch)) kind = 'punct';
    else if (VERTICAL_SMALL_KANA.has(ch)) kind = 'small';
    else if (VERTICAL_ROTATE.has(ch)) kind = 'rotate';
    cells.push({ kind, text: ch, advance: fontSize });
    i++;
  }
  return cells;
}

/** マスの並びの長さ(字間込み) */
function cellsLength(cells, spacingPx) {
  if (!cells.length) return 0;
  return cells.reduce((a, c) => a + c.advance, 0) + spacingPx * (cells.length - 1);
}

/**
 * 縦書きの組版: テキストを列に分ける
 * maxHeight を渡すと、その高さで折り返す(null なら改行でだけ分ける)
 * @returns {Array<{cells: Array, length: number}>} 右から順の列
 */
export function layoutVertical(ctx, text, { fontSize, spacingPx = 0, maxHeight = null, tcy, latinMode } = {}) {
  const columns = [];
  for (const line of String(text ?? '').split('\n')) {
    const cells = verticalCells(ctx, line, fontSize, { tcy, latinMode });
    if (maxHeight == null || maxHeight <= 0) {
      columns.push({ cells, length: cellsLength(cells, spacingPx) });
      continue;
    }
    let col = [];
    let len = 0;
    for (const cell of cells) {
      const add = (col.length ? spacingPx : 0) + cell.advance;
      if (col.length && len + add > maxHeight + 0.01) {
        // 行頭禁則: 句読点・閉じ括弧などは前の列にぶら下げる
        if (cell.text.length === 1 && NO_LINE_START.has(cell.text)) {
          col.push(cell);
          len += add;
          continue;
        }
        columns.push({ cells: col, length: len });
        col = [cell];
        len = cell.advance;
      } else {
        col.push(cell);
        len += add;
      }
    }
    columns.push({ cells: col, length: len });
  }
  return columns;
}

/** 縦書きにしたときの、列の並び全体の幅 */
export function verticalBlockWidth(columnCount, fontSize) {
  return columnCount * fontSize * VERTICAL_LINE_HEIGHT;
}

/**
 * 1マスを描く。(cx, top) は列の中心線とマスの上端
 * ctx.font は呼び出し側で設定しておく
 */
/**
 * 全角の字面の中心が、alphabetic のベースラインからどれだけ上にあるか(px)
 * textBaseline 'middle' はフォントによって全角の枠の中心からずれるので、漢字の字面から求める
 */
const emCenterCache = new Map();
function emCenterOffset(ctx) {
  const key = ctx.font;
  if (emCenterCache.has(key)) return emCenterCache.get(key);
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText('国');
  ctx.restore();
  let off = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  if (!Number.isFinite(off) || off <= 0) off = parseFloat(key.match(/(\d+(?:\.\d+)?)px/)?.[1] || '16') * 0.38;
  if (emCenterCache.size > 200) emCenterCache.clear();
  emCenterCache.set(key, off);
  return off;
}

export function drawVerticalCell(ctx, cell, cx, top, fontSize) {
  const midY = top + cell.advance / 2;
  ctx.save();
  ctx.textAlign = 'center';
  if (cell.kind === 'latin') {
    ctx.textBaseline = 'middle';
  } else {
    // 全角の枠の中心が (x, y) に来るように描く
    const off = emCenterOffset(ctx);
    ctx.textBaseline = 'alphabetic';
    ctx.translate(0, off);
    // 回転するものは、回転の中心を枠の中心にしたいので戻す
    if (cell.kind === 'rotate' || cell.kind === 'tcy') ctx.translate(0, -off);
  }
  switch (cell.kind) {
    case 'punct':
      ctx.fillText(cell.text, cx + fontSize * PUNCT_OFFSET_EM.x, midY + fontSize * PUNCT_OFFSET_EM.y);
      break;
    case 'small':
      ctx.fillText(cell.text, cx + fontSize * SMALL_KANA_OFFSET_EM.x, midY + fontSize * SMALL_KANA_OFFSET_EM.y);
      break;
    case 'rotate':
      ctx.translate(cx, midY);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(cell.text, 0, emCenterOffset(ctx));
      break;
    case 'latin':
      ctx.translate(cx, top);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'left';
      ctx.fillText(cell.text, 0, 0);
      break;
    case 'tcy': {
      // 1マスの幅に収まらなければ横方向だけ縮める
      const w = ctx.measureText(cell.text).width;
      const limit = fontSize * 1.0;
      ctx.translate(cx, midY);
      if (w > limit) ctx.scale(limit / w, 1);
      ctx.fillText(cell.text, 0, emCenterOffset(ctx));
      break;
    }
    default:
      ctx.fillText(cell.text, cx, midY);
  }
  ctx.restore();
}

/**
 * 縦書きのテキストを箱の中に描く(要素の中心を原点にした座標系で呼ぶ)
 *
 * 揃えの読み替え(縦書きでは向きが 90° 変わるため):
 * - align(横の揃え) 'left' / 'center' / 'right' → 列の中での 上 / 中央 / 下 揃え
 * - verticalAlign(縦の揃え) 'top' / 'middle' / 'bottom' → 列の並びの 右 / 中央 / 左 寄せ
 *
 * @returns {{columns: Array, fontSize: number}}
 */
export function drawVerticalText(ctx, columns, {
  width, height, fontSize, spacingPx = 0, align = 'left', verticalAlign = 'top',
  underline = false, padding = 4,
}) {
  const colWidth = fontSize * VERTICAL_LINE_HEIGHT;
  const blockWidth = columns.length * colWidth;
  let right;
  if (verticalAlign === 'bottom') right = -width / 2 + padding + blockWidth;
  else if (verticalAlign === 'middle') right = blockWidth / 2;
  else right = width / 2 - padding;

  columns.forEach((col, idx) => {
    const cx = right - colWidth * idx - colWidth / 2;
    let top;
    if (align === 'center') top = -col.length / 2;
    else if (align === 'right') top = height / 2 - padding - col.length;
    else top = -height / 2 + padding;

    let y = top;
    col.cells.forEach((cell) => {
      drawVerticalCell(ctx, cell, cx, y, fontSize);
      y += cell.advance + spacingPx;
    });

    if (underline && col.cells.length) {
      // 縦書きの下線 = 文字の右側の傍線
      const lx = cx + fontSize * 0.55;
      ctx.beginPath();
      ctx.lineWidth = Math.max(1, fontSize / 16);
      ctx.moveTo(lx, top);
      ctx.lineTo(lx, top + col.length);
      ctx.stroke();
    }
  });
  return { columns, fontSize };
}

/**
 * 縦書き ↔ 横書きを切り替えたときの箱の大きさ
 * 中心を保ったまま、幅と高さを入れ替える
 */
export function swapBoxForWritingMode(element) {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const width = element.height;
  const height = element.width;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}
