import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

// AI による画像の白黒化。
// 本物の ONNX Runtime とモデルは大きく、外部(jsDelivr / Hugging Face)から読むので、
// テストでは偽のランタイム(下の FAKE_ORT)に差し替えて、画面と前後の処理を確かめる。
//   - 背景を消す: 偽モデルは「真ん中の円だけ 1、ほかは 0」のマスクを返す
//   - 線画: 偽モデルは入力の明るさの平均をそのまま返す

const FAKE_ORT = `
export const env = { wasm: {} };
export class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
export const InferenceSession = {
  async create(bytes) {
    window.__fakeOrtCreated = (window.__fakeOrtCreated || 0) + 1;
    return {
      inputNames: ['input'],
      outputNames: ['output'],
      async run(feeds) {
        const t = feeds.input;
        const [, , h, w] = t.dims;
        const out = new Float32Array(h * w);
        if (h === 320 && w === 320) {
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const dx = x - w / 2, dy = y - h / 2;
            out[y * w + x] = dx * dx + dy * dy < (w / 4) * (w / 4) ? 1 : 0;
          }
        } else {
          for (let i = 0; i < h * w; i++) out[i] = (t.data[i] + t.data[h * w + i] + t.data[2 * h * w + i]) / 3;
        }
        return { output: new Tensor('float32', out, [1, 1, h, w]) };
      },
    };
  },
};
`;

async function installFakes(page: Page) {
  const modelRequests: string[] = [];
  await page.route('https://cdn.jsdelivr.net/npm/onnxruntime-web@*/dist/**', route =>
    route.fulfill({ body: FAKE_ORT, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
  await page.route('**/models/u2netp.onnx', route => {
    modelRequests.push('removeBg');
    return route.fulfill({ body: 'fake', contentType: 'application/octet-stream' });
  });
  await page.route('https://huggingface.co/**', route => {
    modelRequests.push('lineArt');
    return route.fulfill({ body: 'fake', contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
  });
  return modelRequests;
}

/** 200×200 の画像を作って追加する(fill: 'blue' は全面青、'split' は左が黒・右が白) */
async function addImage(page: Page, fill: 'blue' | 'split') {
  const dataUrl = await page.evaluate((fill) => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 200;
    const ctx = c.getContext('2d')!;
    if (fill === 'blue') {
      ctx.fillStyle = '#00f';
      ctx.fillRect(0, 0, 200, 200);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 200, 200);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 100, 200);
    }
    return c.toDataURL('image/png');
  }, fill);
  const file = path.join(os.tmpdir(), `phomymo-aibw-${fill}-${process.pid}.png`);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await page.locator('#image-file-input').setInputFiles(file);
  await expect(page.locator('#props-image')).toBeVisible();
  await page.waitForTimeout(300);
}

/** キャンバスの四隅と真ん中の色 */
async function cornerAndCenter(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const c = document.querySelector(selector) as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const px = (x: number, y: number) => Array.from(ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data).slice(0, 3);
    return { corner: px(2, 2), center: px(c.width / 2, c.height / 2) };
  }, selector);
}

/** プレビューのキャンバスの青い画素の数 */
async function countBlue(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#preview-canvas') as HTMLCanvasElement;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] > 200) n++;
    return n;
  });
}

test.describe('AIで白黒に', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('背景を消す: ボタンを押すまでダウンロードせず、適用すると背景が白になる。Ctrl+Z で戻る', async ({ page }) => {
    const modelRequests = await installFakes(page);
    await addImage(page, 'blue');
    const blueBefore = await countBlue(page);
    expect(blueBefore).toBeGreaterThan(1000);

    await page.click('#prop-image-ai-bw');
    await expect(page.locator('#ai-bw-dialog')).toBeVisible();
    await expect(page.locator('.aibw-mode[data-mode="removeBg"]')).toHaveAttribute('aria-checked', 'true');
    // まだダウンロードしていない
    await expect(page.locator('#aibw-run')).toHaveText('ダウンロードして変換');
    await expect(page.locator('#aibw-apply')).toBeDisabled();
    expect(modelRequests).toEqual([]);
    // 背景を消すだけのときは、線の濃さは出さない
    await expect(page.locator('#aibw-strength')).toBeHidden();

    await page.click('#aibw-run');
    await expect(page.locator('#aibw-apply')).toBeEnabled();
    expect(modelRequests).toEqual(['removeBg']);
    const after = await cornerAndCenter(page, '#aibw-after');
    expect(after.corner).toEqual([255, 255, 255]);
    expect(after.center[2]).toBeGreaterThan(200);
    expect(after.center[0]).toBeLessThan(60);

    // ダイアログの中で Delete を押しても、要素は消えない
    await page.keyboard.press('Delete');
    await page.click('#aibw-apply');
    await expect(page.locator('#ai-bw-dialog')).toBeHidden();
    await expect(page.locator('#props-image')).toBeVisible();
    // 背景を消しただけなので、ディザはそのまま
    await expect(page.locator('#prop-image-dither')).toHaveValue('floyd-steinberg');
    await page.waitForTimeout(300);
    const blueAfter = await countBlue(page);
    expect(blueAfter).toBeLessThan(blueBefore * 0.4);
    expect(blueAfter).toBeGreaterThan(blueBefore * 0.05);

    // 元に戻す
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(await countBlue(page)).toBeGreaterThan(blueBefore * 0.9);

    // 2回目はモデルを読み直さずに、開いてすぐ変換される
    const box = (await page.locator('#preview-canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#props-image')).toBeVisible();
    await page.click('#prop-image-ai-bw');
    await expect(page.locator('#aibw-apply')).toBeEnabled();
    expect(modelRequests).toEqual(['removeBg']);
    await page.click('#aibw-cancel');
    await expect(page.locator('#ai-bw-dialog')).toBeHidden();
  });

  test('輪郭線はダウンロードなしですぐ変換し、適用するとディザが「しきい値」になる', async ({ page }) => {
    const modelRequests = await installFakes(page);
    await addImage(page, 'split');
    await page.click('#prop-image-ai-bw');
    await page.click('.aibw-mode[data-mode="edges"]');
    await expect(page.locator('#aibw-apply')).toBeEnabled();
    await expect(page.locator('#aibw-strength')).toBeVisible();
    expect(modelRequests).toEqual([]);

    // 白黒の 2 色だけになっていて、境目(真ん中)に線がある
    const r = await page.evaluate(() => {
      const c = document.querySelector('#aibw-after') as HTMLCanvasElement;
      const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
      let other = 0, blackMid = 0, blackFar = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const v = data[i];
        if (v !== 0 && v !== 255) other++;
        if (v === 0) (Math.abs(x - width / 2) < 10 ? blackMid++ : Math.abs(x - width / 2) > 40 && blackFar++);
      }
      return { other, blackMid, blackFar };
    });
    expect(r.other).toBe(0);
    expect(r.blackMid).toBeGreaterThan(100);
    expect(r.blackFar).toBe(0);

    await page.click('#aibw-apply');
    await expect(page.locator('#ai-bw-dialog')).toBeHidden();
    await expect(page.locator('#prop-image-dither')).toHaveValue('none');
  });

  test('線画(AI)は Hugging Face からモデルを読み、「先に背景を消す」も使える', async ({ page }) => {
    const modelRequests = await installFakes(page);
    await addImage(page, 'split');
    await page.click('#prop-image-ai-bw');
    await page.click('.aibw-mode[data-mode="lineArt"]');
    await expect(page.locator('.aibw-mode[data-mode="lineArt"] .aibw-badge')).toHaveText('AI・初回 17.2MB');
    await expect(page.locator('#aibw-run')).toBeVisible();
    await page.check('#aibw-rmbg-first');
    await expect(page.locator('#aibw-overlay-text')).toContainText('21.8MB');
    await page.click('#aibw-run');
    await expect(page.locator('#aibw-apply')).toBeEnabled();
    expect(modelRequests.sort()).toEqual(['lineArt', 'removeBg']);
    // 偽の線画モデルは明るさをそのまま返すので、左が黒・右が白のまま(背景は円の外が白になる)
    const px = await cornerAndCenter(page, '#aibw-after');
    expect(px.corner).toEqual([255, 255, 255]);
    await page.click('#aibw-apply');
    await expect(page.locator('#prop-image-dither')).toHaveValue('none');
  });

  test('モデルが読めないときはエラーを出し、もう一度試せる', async ({ page }) => {
    await page.route('https://cdn.jsdelivr.net/npm/onnxruntime-web@*/dist/**', route =>
      route.fulfill({ body: FAKE_ORT, contentType: 'text/javascript' }));
    await page.route('**/models/u2netp.onnx', route => route.fulfill({ status: 404, body: '' }));
    await addImage(page, 'blue');
    await page.click('#prop-image-ai-bw');
    await page.click('#aibw-run');
    await expect(page.locator('#aibw-error')).toContainText('変換できませんでした');
    await expect(page.locator('#aibw-run')).toHaveText('もう一度試す');
    await expect(page.locator('#aibw-apply')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ai-bw-dialog')).toBeHidden();
  });

  test('英語表示でも文言が切り替わる', async ({ page }) => {
    await installFakes(page);
    await page.evaluate(async () => {
      const i18n = await import('/i18n.js');
      i18n.setLang?.('en');
    });
    await addImage(page, 'blue');
    await expect(page.locator('#prop-image-ai-bw')).toContainText('AI B&W');
    await page.click('#prop-image-ai-bw');
    await expect(page.locator('#aibw-title')).toHaveText('Convert to black & white with AI');
    await expect(page.locator('#aibw-run')).toHaveText('Download and convert');
  });
});
