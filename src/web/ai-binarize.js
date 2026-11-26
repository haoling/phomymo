/**
 * ブラウザの中だけで動く、画像の白黒化(AI)
 *
 * - 画像はこの端末の中だけで処理する(サーバには送らない)
 * - AI の実行には ONNX Runtime Web(WebAssembly)を使う。ランタイムもモデルも、
 *   使うときに初めて読み込む(画面を開いただけではダウンロードしない)
 * - 読み込んだモデルは Cache Storage に置き、2回目からはダウンロードしない
 *
 * 加工の種類(AI_MODES):
 *   'removeBg' 背景を消す(AI: U²-Net small / u2netp)
 *   'lineArt'  線画にする(AI: Informative Drawings の line art)
 *   'edges'    輪郭線(AI なし。XDoG という昔ながらの方法で、すぐに終わる)
 */

/**
 * 仮決め: あとから変えられるように、読み込み先や大きさはここにまとめる
 */
export const AI_CONFIG = {
  // ONNX Runtime Web(WebAssembly 版)。index.html の他のライブラリと同じく jsDelivr から
  ortUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort.wasm.min.mjs',
  ortWasmBase: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/',
  models: {
    // U²-Net small(Apache-2.0)。このサイトに同梱(src/web/models/)
    removeBg: { url: 'models/u2netp.onnx', bytes: 4574861 },
    // Informative Drawings の line art(MIT)。17MB あるので Hugging Face から読む
    lineArt: { url: 'https://huggingface.co/rocca/informative-drawings-line-art-onnx/resolve/main/model.onnx', bytes: 17200000 },
  },
  cacheName: 'phomymo-ai-models-v1',
  // 処理する大きさ(長い辺の画素)。感熱プリンタ(203dpi)なら 1024 で 128mm 分ある
  maxSide: 1024,
  // 線画の AI に入れる大きさ(長い辺)。大きいほど細かいが遅い
  lineArtSide: 512,
  // 背景を消す AI の入力の大きさ(モデルで決まっている)
  removeBgSide: 320,
  // 線の濃さ(しきい値)の初期値 0〜100
  defaultStrength: 60,
};

export const AI_MODES = ['removeBg', 'lineArt', 'edges'];

/** その加工に AI モデルのダウンロードが要るか */
export function modeNeedsModel(mode) {
  return mode === 'removeBg' || mode === 'lineArt';
}

/** 線だけの結果になる加工か(2値化は「しきい値」で行う) */
export function isLineMode(mode) {
  return mode === 'lineArt' || mode === 'edges';
}

// ---------------------------------------------------------------------------
// ランタイムとモデルの読み込み

let ortPromise = null;
const sessions = new Map();

async function loadOrt() {
  if (!ortPromise) {
    ortPromise = (async () => {
      const ort = await import(/* @vite-ignore */ AI_CONFIG.ortUrl);
      const mod = ort.default && ort.default.InferenceSession ? ort.default : ort;
      if (mod.env?.wasm) {
        mod.env.wasm.wasmPaths = AI_CONFIG.ortWasmBase;
        // crossOriginIsolated でないとスレッドは使えない
        mod.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      }
      return mod;
    })();
    ortPromise.catch(() => { ortPromise = null; });
  }
  return ortPromise;
}

/** モデルが端末に保存済みか(ダウンロードが要らないか) */
export async function isModelCached(mode) {
  const model = AI_CONFIG.models[mode];
  if (!model) return true;
  if (sessions.has(mode)) return true;
  try {
    if (!globalThis.caches) return false;
    const cache = await caches.open(AI_CONFIG.cacheName);
    return !!(await cache.match(new URL(model.url, location.href).href));
  } catch {
    return false;
  }
}

/** モデルの大きさ(MB、表示用) */
export function modelSizeMB(mode) {
  const model = AI_CONFIG.models[mode];
  return model ? Math.round(model.bytes / 100000) / 10 : 0;
}

async function fetchModel(mode, onProgress) {
  const model = AI_CONFIG.models[mode];
  const url = new URL(model.url, location.href).href;
  let cache = null;
  try {
    if (globalThis.caches) cache = await caches.open(AI_CONFIG.cacheName);
  } catch { cache = null; }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      onProgress?.(1);
      return new Uint8Array(await hit.arrayBuffer());
    }
  }
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || model.bytes;
  let bytes;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress?.(Math.min(0.99, got / total));
    }
    bytes = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { bytes.set(c, off); off += c.length; }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  if (cache) {
    try {
      await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }));
    } catch { /* 保存できなくても今回は使える */ }
  }
  onProgress?.(1);
  return bytes;
}

async function getSession(mode, onProgress) {
  if (sessions.has(mode)) return sessions.get(mode);
  const p = (async () => {
    const [ort, bytes] = await Promise.all([loadOrt(), fetchModel(mode, onProgress)]);
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    return { ort, session };
  })();
  sessions.set(mode, p);
  p.catch(() => sessions.delete(mode));
  return p;
}

// ---------------------------------------------------------------------------
// 画像のやりとり

/** data URL を読み込む */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** 画像を長い辺 maxSide 以下にして、白の上に描いた canvas を返す(透明は白=印字しない) */
export function imageToCanvas(img, maxSide = AI_CONFIG.maxSide) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.min(1, maxSide / Math.max(iw, ih));
  const c = makeCanvas(iw * s, ih * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function resized(src, w, h) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function toGray(rgba) {
  const n = rgba.length / 4;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    g[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
  }
  return g;
}

/** 0〜1 の濃淡(1=白)を、同じ大きさの canvas にする */
export function grayToCanvas(gray, w, h) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(w, h);
  for (let i = 0; i < gray.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(gray[i] * 255)));
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** canvas の濃淡(0〜1、1=白)を取り出す */
export function canvasToGray(canvas) {
  const { width, height } = canvas;
  return toGray(canvas.getContext('2d').getImageData(0, 0, width, height).data);
}

// ---------------------------------------------------------------------------
// 加工

/**
 * 背景を消す。被写体はそのまま(カラー)で、背景を白にした canvas を返す
 */
async function removeBackground(src, onProgress) {
  const { ort, session } = await getSession('removeBg', onProgress);
  const S = AI_CONFIG.removeBgSide;
  const small = resized(src, S, S).getContext('2d').getImageData(0, 0, S, S).data;
  // rembg と同じ前処理: 一番明るい値で割ってから ImageNet の平均・標準偏差で正規化
  let max = 1e-6;
  for (let i = 0; i < small.length; i += 4) max = Math.max(max, small[i], small[i + 1], small[i + 2]);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const input = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) {
    for (let ch = 0; ch < 3; ch++) {
      input[ch * S * S + i] = (small[i * 4 + ch] / max - mean[ch]) / std[ch];
    }
  }
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) };
  const results = await session.run(feeds);
  const pred = results[session.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < S * S; i++) { lo = Math.min(lo, pred[i]); hi = Math.max(hi, pred[i]); }
  const span = hi - lo || 1;
  const mask = makeCanvas(S, S);
  const mctx = mask.getContext('2d');
  const m = mctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    m.data[i * 4 + 3] = Math.round(((pred[i] - lo) / span) * 255);
  }
  mctx.putImageData(m, 0, 0);

  // 元の大きさの上で「被写体 × マスク」を白の上に重ねる
  const w = src.width, h = src.height;
  const fg = makeCanvas(w, h);
  const fctx = fg.getContext('2d');
  fctx.imageSmoothingEnabled = true;
  fctx.drawImage(mask, 0, 0, w, h);
  fctx.globalCompositeOperation = 'source-in';
  fctx.drawImage(src, 0, 0);
  const out = makeCanvas(w, h);
  const octx = out.getContext('2d');
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, w, h);
  octx.drawImage(fg, 0, 0);
  return out;
}

/**
 * 線画にする(AI)。0〜1 の濃淡(1=白)を返す
 */
async function lineArt(src, onProgress) {
  const { ort, session } = await getSession('lineArt', onProgress);
  const side = AI_CONFIG.lineArtSide;
  const s = Math.min(1, side / Math.max(src.width, src.height));
  // モデルの中で縮小・拡大するので、8 の倍数にそろえる
  const w = Math.max(8, Math.round((src.width * s) / 8) * 8);
  const h = Math.max(8, Math.round((src.height * s) / 8) * 8);
  const px = resized(src, w, h).getContext('2d').getImageData(0, 0, w, h).data;
  const input = new Float32Array(3 * w * h);
  for (let i = 0; i < w * h; i++) {
    input[i] = px[i * 4] / 255;
    input[w * h + i] = px[i * 4 + 1] / 255;
    input[2 * w * h + i] = px[i * 4 + 2] / 255;
  }
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, h, w]) };
  const results = await session.run(feeds);
  const outData = results[session.outputNames[0]].data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = Math.max(0, Math.min(1, outData[i]));
  // 元の大きさに戻す
  return canvasToGray(resized(grayToCanvas(gray, w, h), src.width, src.height));
}

function gaussianBlur(src, w, h, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(r * 2 + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        a += src[row + xx] * k[i + r];
      }
      tmp[row + x] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        a += tmp[yy * w + x] * k[i + r];
      }
      out[y * w + x] = a;
    }
  }
  return out;
}

/**
 * 輪郭線(AI なし)。XDoG(ぼかしの差分)で明暗の境目を線にする。0〜1 の濃淡(1=白)を返す
 */
export function edgesXDoG(gray, w, h) {
  // 画像の大きさに合わせて線の太さを決める(長い辺 1024 で sigma 1.2 くらい)
  const sigma = Math.max(0.6, (Math.max(w, h) / 1024) * 1.2);
  const g1 = gaussianBlur(gray, w, h, sigma);
  const g2 = gaussianBlur(gray, w, h, sigma * 1.6);
  const out = new Float32Array(w * h);
  const tau = 0.98, eps = -0.005, phi = 60;
  for (let i = 0; i < out.length; i++) {
    const d = g1[i] - tau * g2[i];
    out[i] = d >= eps ? 1 : 1 + Math.tanh(phi * (d - eps));
  }
  return out;
}

/**
 * 加工する
 * @param {HTMLImageElement|HTMLCanvasElement} img
 * @param {Object} opts
 * @param {string} opts.mode - 'removeBg' | 'lineArt' | 'edges'
 * @param {boolean} [opts.removeBgFirst] - 線にする前に背景を消すか
 * @param {(stage:string, fraction:number)=>void} [opts.onProgress]
 * @returns {Promise<{kind:'image', canvas:HTMLCanvasElement} | {kind:'gray', gray:Float32Array, width:number, height:number}>}
 *   kind 'image' はそのまま(濃淡はディザで表す)、'gray' はしきい値で白黒にする線
 */
export async function processImage(img, { mode, removeBgFirst = false, onProgress } = {}) {
  let src = img instanceof HTMLCanvasElement ? img : imageToCanvas(img);
  const progress = (stage) => (f) => onProgress?.(stage, f);
  if (mode === 'removeBg' || (isLineMode(mode) && removeBgFirst)) {
    src = await removeBackground(src, progress('removeBg'));
    if (mode === 'removeBg') return { kind: 'image', canvas: src };
  }
  if (mode === 'lineArt') {
    const gray = await lineArt(src, progress('lineArt'));
    return { kind: 'gray', gray, width: src.width, height: src.height };
  }
  if (mode === 'edges') {
    const gray = edgesXDoG(canvasToGray(src), src.width, src.height);
    return { kind: 'gray', gray, width: src.width, height: src.height };
  }
  throw new Error(`unknown mode: ${mode}`);
}

/**
 * 線の結果を、濃さ(0〜100)に合わせて白黒にした canvas にする
 * 濃さが大きいほど、薄い線も黒にする
 */
export function thresholdToCanvas(gray, w, h, strength = AI_CONFIG.defaultStrength) {
  const t = 0.15 + (Math.max(0, Math.min(100, strength)) / 100) * 0.8; // 0.15〜0.95
  const bw = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) bw[i] = gray[i] < t ? 0 : 1;
  return grayToCanvas(bw, w, h);
}

/** テスト用: 読み込んだランタイムとモデルを忘れる */
export function _resetForTest() {
  ortPromise = null;
  sessions.clear();
}
