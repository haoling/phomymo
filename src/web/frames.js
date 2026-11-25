/**
 * 枠・ボーダー素材(#28)
 *
 * 枠は画像ではなく、描画のたびに線を引き直す要素(type: 'frame')として扱う。
 * そのため、どんな大きさに伸び縮みさせても線の太さや飾りの形が崩れない。
 *
 * 要素のプロパティ
 *   frameStyle  : FRAME_STYLES の id
 *   frameShape  : 'rect' | 'ellipse'(丸ラベル用)
 *   strokeWidth : 線の太さ(px, 203dpi で 8px ≒ 1mm)
 *   frameMargin : ラベルの端からの余白(px)
 *   fitToLabel  : true ならラベルのサイズが変わったときに自動で合わせ直す
 *   color       : 'black' | 'white'
 */

import { generateId } from './elements.js';

/** 仮決め: 新しい枠の既定値(あとから変えられるよう定数にしておく) */
export const FRAME_DEFAULTS = {
  style: 'single',
  strokeWidth: 3,   // 約0.4mm。感熱紙でかすれにくい太さ
  margin: 8,        // 約1mm。ラベルの端ぎりぎりは印字がずれやすいので少し内側に
  fitToLabel: true,
};

/** 枠のスタイル一覧(パネルの並び順) */
export const FRAME_STYLES = [
  { id: 'single', name: '一本線', tags: ['シンプル', '線', 'single'] },
  { id: 'double', name: '二重線', tags: ['二重', 'double'] },
  { id: 'thick-thin', name: '太細二重', tags: ['二重', '太い', 'thick'] },
  { id: 'rounded', name: '角丸', tags: ['丸', 'まる', 'rounded'] },
  { id: 'rounded-double', name: '角丸二重', tags: ['丸', '二重', 'rounded'] },
  { id: 'dashed', name: '破線', tags: ['点線', 'ミシン目', 'dashed'] },
  { id: 'dotted', name: '点線', tags: ['ドット', '水玉', 'dotted'] },
  { id: 'stitch', name: 'ステッチ', tags: ['縫い目', '破線', 'stitch'] },
  { id: 'corners', name: 'コーナー', tags: ['かぎ括弧', '角', 'corner'] },
  { id: 'ticket', name: 'チケット', tags: ['切符', 'クーポン', 'ticket'] },
  { id: 'scallop', name: 'スカラップ', tags: ['波', 'なみ', 'フリル', 'scallop'] },
  { id: 'ornament', name: '飾り罫', tags: ['ひし形', '装飾', 'クラシック', 'ornament'] },
  { id: 'hearts', name: 'ハートの角', tags: ['ハート', 'かわいい', 'heart'] },
  { id: 'stars', name: '星の角', tags: ['星', 'ほし', 'star'] },
];

const STYLE_IDS = new Set(FRAME_STYLES.map(s => s.id));

/**
 * 枠の要素を作る
 */
export function createFrameElement(options = {}) {
  return {
    id: generateId(),
    type: 'frame',
    zone: options.zone ?? 0,
    x: options.x ?? 0,
    y: options.y ?? 0,
    width: options.width ?? 100,
    height: options.height ?? 100,
    rotation: 0,
    frameStyle: STYLE_IDS.has(options.frameStyle) ? options.frameStyle : FRAME_DEFAULTS.style,
    frameShape: options.frameShape === 'ellipse' ? 'ellipse' : 'rect',
    strokeWidth: options.strokeWidth ?? FRAME_DEFAULTS.strokeWidth,
    frameMargin: options.frameMargin ?? FRAME_DEFAULTS.margin,
    fitToLabel: options.fitToLabel ?? FRAME_DEFAULTS.fitToLabel,
    color: options.color === 'white' ? 'white' : 'black',
  };
}

/**
 * ラベルの大きさに合わせた位置と大きさを返す
 * @param {{frameMargin:number}} frame
 * @param {{width:number,height:number}} dims  1枚分のラベルの大きさ(px)
 */
export function frameGeometryForLabel(frame, dims) {
  const m = Math.max(0, Math.min(Number(frame.frameMargin) || 0, Math.min(dims.width, dims.height) / 2 - 4));
  return {
    x: m,
    y: m,
    width: Math.max(8, dims.width - m * 2),
    height: Math.max(8, dims.height - m * 2),
    rotation: 0,
  };
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

/**
 * 枠を描く。ctx の原点は要素の中心にしておくこと(canvas.js の renderElement と同じ)
 */
export function drawFrame(ctx, frame, width, height) {
  const t = Math.max(1, Number(frame.strokeWidth) || FRAME_DEFAULTS.strokeWidth);
  const color = frame.color === 'white' ? '#ffffff' : '#000000';
  const style = STYLE_IDS.has(frame.frameStyle) ? frame.frameStyle : 'single';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  if (frame.frameShape === 'ellipse') {
    drawEllipseFrame(ctx, style, width, height, t, color);
  } else {
    drawRectFrame(ctx, style, width, height, t, color);
  }
  ctx.restore();
}

function rectPath(ctx, w, h, inset, r = 0) {
  const x = -w / 2 + inset;
  const y = -h / 2 + inset;
  const ww = Math.max(0, w - inset * 2);
  const hh = Math.max(0, h - inset * 2);
  const rr = Math.max(0, Math.min(r, ww / 2, hh / 2));
  ctx.beginPath();
  if (rr > 0) {
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + ww, y, x + ww, y + hh, rr);
    ctx.arcTo(x + ww, y + hh, x, y + hh, rr);
    ctx.arcTo(x, y + hh, x, y, rr);
    ctx.arcTo(x, y, x + ww, y, rr);
    ctx.closePath();
  } else {
    ctx.rect(x, y, ww, hh);
  }
}

function strokeRect(ctx, w, h, inset, lw, r = 0) {
  ctx.lineWidth = lw;
  rectPath(ctx, w, h, inset + lw / 2, r > 0 ? Math.max(0, r - inset - lw / 2) : 0);
  ctx.stroke();
}

function drawRectFrame(ctx, style, w, h, t, color) {
  const minSide = Math.min(w, h);
  const radius = Math.max(t * 2, minSide * 0.12);
  switch (style) {
    case 'double':
      strokeRect(ctx, w, h, 0, t);
      strokeRect(ctx, w, h, t * 2.5, t);
      break;
    case 'thick-thin':
      strokeRect(ctx, w, h, 0, t * 2);
      strokeRect(ctx, w, h, t * 3.2, Math.max(1, t * 0.6));
      break;
    case 'rounded':
      strokeRect(ctx, w, h, 0, t, radius);
      break;
    case 'rounded-double':
      strokeRect(ctx, w, h, 0, t, radius);
      strokeRect(ctx, w, h, t * 2.5, t, radius);
      break;
    case 'dashed':
      ctx.setLineDash([t * 3, t * 2]);
      strokeRect(ctx, w, h, 0, t);
      break;
    case 'dotted':
      ctx.lineCap = 'round';
      ctx.setLineDash([0.01, t * 2.6]);
      strokeRect(ctx, w, h, t * 0.2, t * 1.4);
      break;
    case 'stitch':
      strokeRect(ctx, w, h, 0, Math.max(1, t * 0.7), radius);
      ctx.setLineDash([t * 2.2, t * 1.6]);
      strokeRect(ctx, w, h, t * 2.6, Math.max(1, t * 0.8), radius);
      break;
    case 'corners': {
      const len = Math.max(t * 4, minSide * 0.2);
      ctx.lineWidth = t * 1.3;
      ctx.lineCap = 'square';
      const x0 = -w / 2 + ctx.lineWidth / 2;
      const y0 = -h / 2 + ctx.lineWidth / 2;
      const x1 = -x0;
      const y1 = -y0;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + len); ctx.lineTo(x0, y0); ctx.lineTo(x0 + len, y0);
      ctx.moveTo(x1 - len, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + len);
      ctx.moveTo(x1, y1 - len); ctx.lineTo(x1, y1); ctx.lineTo(x1 - len, y1);
      ctx.moveTo(x0 + len, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - len);
      ctx.stroke();
      break;
    }
    case 'ticket': {
      const r = Math.max(t * 2, minSide * 0.1);
      const draw = (inset) => {
        const x0 = -w / 2 + inset, y0 = -h / 2 + inset, x1 = w / 2 - inset, y1 = h / 2 - inset;
        const rr = Math.max(1, r - inset);
        ctx.beginPath();
        ctx.moveTo(x0 + rr, y0);
        ctx.lineTo(x1 - rr, y0);
        ctx.arc(x1, y0, rr, Math.PI, Math.PI / 2, true);
        ctx.lineTo(x1, y1 - rr);
        ctx.arc(x1, y1, rr, -Math.PI / 2, Math.PI, true);
        ctx.lineTo(x0 + rr, y1);
        ctx.arc(x0, y1, rr, 0, -Math.PI / 2, true);
        ctx.lineTo(x0, y0 + rr);
        ctx.arc(x0, y0, rr, Math.PI / 2, 0, true);
        ctx.closePath();
        ctx.stroke();
      };
      ctx.lineWidth = t;
      draw(t / 2);
      ctx.setLineDash([t * 2, t * 1.5]);
      ctx.lineWidth = Math.max(1, t * 0.7);
      draw(t * 3);
      break;
    }
    case 'scallop': {
      ctx.lineWidth = t;
      const target = Math.max(t * 2, minSide * 0.045);
      const inset = target + t / 2;
      const iw = w - inset * 2;
      const ih = h - inset * 2;
      const nx = Math.max(2, Math.round(iw / (target * 2)));
      const ny = Math.max(2, Math.round(ih / (target * 2)));
      const rx = iw / nx / 2;
      const ry = ih / ny / 2;
      const x0 = -iw / 2, y0 = -ih / 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let i = 0; i < nx; i++) ctx.arc(x0 + rx * (2 * i + 1), y0, rx, Math.PI, 0, false);
      for (let i = 0; i < ny; i++) ctx.arc(-x0, y0 + ry * (2 * i + 1), ry, -Math.PI / 2, Math.PI / 2, false);
      for (let i = 0; i < nx; i++) ctx.arc(-x0 - rx * (2 * i + 1), -y0, rx, 0, Math.PI, false);
      for (let i = 0; i < ny; i++) ctx.arc(x0, -y0 - ry * (2 * i + 1), ry, Math.PI / 2, Math.PI * 1.5, false);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'ornament': {
      const d = Math.max(t * 3, minSide * 0.07); // ひし形の半径
      strokeRect(ctx, w, h, d - t, t);
      strokeRect(ctx, w, h, d + t * 1.6, Math.max(1, t * 0.6));
      const cx = w / 2 - d;
      const cy = h / 2 - d;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        drawDiamond(ctx, sx * cx, sy * cy, d, color);
      }
      break;
    }
    case 'hearts':
    case 'stars': {
      const s = Math.max(t * 4, minSide * 0.16);
      strokeRect(ctx, w, h, s / 2 - t / 2, t);
      const cx = w / 2 - s / 2;
      const cy = h / 2 - s / 2;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        drawSymbol(ctx, style, sx * cx, sy * cy, s, color);
      }
      break;
    }
    case 'single':
    default:
      strokeRect(ctx, w, h, 0, t);
  }
}

function ellipsePath(ctx, w, h, inset) {
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(1, w / 2 - inset), Math.max(1, h / 2 - inset), 0, 0, Math.PI * 2);
}

function strokeEllipse(ctx, w, h, inset, lw) {
  ctx.lineWidth = lw;
  ellipsePath(ctx, w, h, inset + lw / 2);
  ctx.stroke();
}

function drawEllipseFrame(ctx, style, w, h, t, color) {
  const minSide = Math.min(w, h);
  switch (style) {
    case 'double':
    case 'rounded-double':
    case 'ticket':
      strokeEllipse(ctx, w, h, 0, t);
      strokeEllipse(ctx, w, h, t * 2.5, t);
      break;
    case 'thick-thin':
      strokeEllipse(ctx, w, h, 0, t * 2);
      strokeEllipse(ctx, w, h, t * 3.2, Math.max(1, t * 0.6));
      break;
    case 'dashed':
      ctx.setLineDash([t * 3, t * 2]);
      strokeEllipse(ctx, w, h, 0, t);
      break;
    case 'dotted':
      ctx.lineCap = 'round';
      ctx.setLineDash([0.01, t * 2.6]);
      strokeEllipse(ctx, w, h, t * 0.2, t * 1.4);
      break;
    case 'stitch':
      strokeEllipse(ctx, w, h, 0, Math.max(1, t * 0.7));
      ctx.setLineDash([t * 2.2, t * 1.6]);
      strokeEllipse(ctx, w, h, t * 2.6, Math.max(1, t * 0.8));
      break;
    case 'scallop': {
      // 楕円の周に沿って半円のふくらみを並べる
      const bump = Math.max(t * 2, minSide * 0.04);
      const a = w / 2 - bump - t / 2;
      const b = h / 2 - bump - t / 2;
      const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
      const n = Math.max(8, Math.round(perimeter / (bump * 2)));
      const steps = n * 16;
      ctx.lineWidth = t;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const th = (i / steps) * Math.PI * 2;
        const k = Math.abs(Math.sin((th * n) / 2));
        const px = Math.cos(th) * (a + bump * k);
        const py = Math.sin(th) * (b + bump * k);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'ornament':
    case 'hearts':
    case 'stars': {
      const s = Math.max(t * 4, minSide * 0.14);
      strokeEllipse(ctx, w, h, s / 2 - t / 2, t);
      const a = w / 2 - s / 2;
      const b = h / 2 - s / 2;
      for (const [px, py] of [[0, -b], [a, 0], [0, b], [-a, 0]]) {
        if (style === 'ornament') drawDiamond(ctx, px, py, s / 2, color);
        else drawSymbol(ctx, style, px, py, s, color);
      }
      break;
    }
    case 'corners':
    case 'rounded':
    case 'single':
    default:
      strokeEllipse(ctx, w, h, 0, t);
  }
}

/** 下の線を白で抜いてから、飾りを塗る */
function knockout(ctx, pathFn) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = ctx.fillStyle === '#ffffff' ? '#000000' : '#ffffff';
  ctx.globalCompositeOperation = 'source-over';
  pathFn(1.25);
  ctx.fill();
  ctx.restore();
}

function drawDiamond(ctx, cx, cy, r, color) {
  const path = (scale) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * scale);
    ctx.lineTo(cx + r * scale, cy);
    ctx.lineTo(cx, cy + r * scale);
    ctx.lineTo(cx - r * scale, cy);
    ctx.closePath();
  };
  knockout(ctx, path);
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  path(1);
  ctx.fill();
  ctx.restore();
}

function drawSymbol(ctx, kind, cx, cy, size, color) {
  const r = size / 2;
  const heart = (scale) => {
    const s = r * scale;
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.85);
    ctx.bezierCurveTo(cx - s * 1.25, cy + s * 0.05, cx - s * 0.75, cy - s * 0.95, cx, cy - s * 0.35);
    ctx.bezierCurveTo(cx + s * 0.75, cy - s * 0.95, cx + s * 1.25, cy + s * 0.05, cx, cy + s * 0.85);
    ctx.closePath();
  };
  const star = (scale) => {
    const outer = r * scale;
    const inner = outer * 0.45;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? outer : inner;
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
  const path = kind === 'hearts' ? heart : star;
  knockout(ctx, path);
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  path(1);
  ctx.fill();
  ctx.restore();
}

/**
 * 素材パネルのサムネイル用に、小さなキャンバスへ枠を描いて data URL を返す
 */
export function renderFrameThumbnail(styleId, { width = 72, height = 52, shape = 'rect' } = {}) {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  const pad = 4 * scale;
  drawFrame(ctx, { frameStyle: styleId, frameShape: shape, strokeWidth: 2 * scale, color: 'black' },
    canvas.width - pad * 2, canvas.height - pad * 2);
  return canvas.toDataURL('image/png');
}
