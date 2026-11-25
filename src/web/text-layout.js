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
