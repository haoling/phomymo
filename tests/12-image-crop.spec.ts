import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

// #26 画像のトリミング・反転

/** 左半分が黒、右半分が青の 200×100 の PNG を作って、画像要素として追加する */
async function addTwoToneImage(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 100;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = '#00f';
    ctx.fillRect(100, 0, 100, 100);
    return c.toDataURL('image/png');
  });
  const file = path.join(os.tmpdir(), `phomymo-two-tone-${process.pid}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await page.locator('#image-file-input').setInputFiles(file);
  await expect(page.locator('#props-image')).toBeVisible();
  // 画像の読み込みは非同期なので、描かれるまで待つ
  await expect.poll(async () => {
    const r = await countColors(page);
    return r.blackLeft + r.blackRight;
  }, { timeout: 5000 }).toBeGreaterThan(100);
}

/** プレビューのキャンバスで、黒と青の画素がキャンバスの左右どちらに多いか数える */
async function countColors(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#preview-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const r = { blackLeft: 0, blackRight: 0, blueLeft: 0, blueRight: 0 };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 200) continue;
        const left = x < width / 2;
        if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40) left ? r.blackLeft++ : r.blackRight++;
        else if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] > 200) left ? r.blueLeft++ : r.blueRight++;
      }
    }
    return r;
  });
}

async function dragBy(page: Page, selector: string, dx: number, dy: number) {
  const box = (await page.locator(selector).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test.describe('画像のトリミング・反転(#26)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('切り抜き範囲の計算(縦横比を保つ・はみ出さない)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const crop = await import('/image-crop.js');
      const el = await import('/elements.js');
      return {
        full: el.normalizeCrop({ x: 0, y: 0, w: 1, h: 1 }),
        bad: el.normalizeCrop({ x: 'a', y: 0, w: 1, h: 1 }),
        clamped: el.normalizeCrop({ x: -0.5, y: 0.5, w: 3, h: 0.25 }),
        free: crop.resizeRect({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'se', 0.1, -0.1, null),
        square: crop.resizeRect({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 'e', 0.2, 0, 1),
        outside: crop.resizeRect({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, 'se', 1, 1, 1),
        move: crop.moveRect({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, 1, -1),
        base: el.getImageBaseSize({ naturalWidth: 200, naturalHeight: 100, crop: { x: 0, y: 0, w: 0.5, h: 1 } }),
        src: el.getImageSourceRect({ crop: { x: 0.25, y: 0.5, w: 0.5, h: 0.5 } }, 400, 200),
      };
    });
    expect(r.full).toBeNull();
    expect(r.bad).toBeNull();
    expect(r.clamped).toEqual({ x: 0, y: 0.5, w: 1, h: 0.25 });
    expect(r.free.w).toBeCloseTo(0.6);
    expect(r.free.h).toBeCloseTo(0.4);
    // 右の辺を引っぱると、高さも同じだけ増える(縦の中心は保つ)
    expect(r.square.w).toBeCloseTo(0.6);
    expect(r.square.h).toBeCloseTo(0.6);
    expect(r.square.y).toBeCloseTo(0.1);
    // 画像の外へは広がらない
    expect(r.outside.x + r.outside.w).toBeLessThanOrEqual(1.000001);
    expect(r.outside.y + r.outside.h).toBeLessThanOrEqual(1.000001);
    expect(r.outside.w).toBeCloseTo(r.outside.h);
    expect(r.move).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.4 });
    expect(r.base).toEqual({ width: 100, height: 100 });
    expect(r.src).toEqual({ sx: 100, sy: 100, sw: 200, sh: 100 });
  });

  test('切り抜いた画像は、縦横比を保ったリサイズで切り抜き後の縦横比を使う', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const h = await import('/handles.js');
      // 200×100 の画像の左半分(100×100、正方形)を切り抜き、100×100 で置いた状態
      const el = {
        type: 'image', x: 0, y: 0, width: 100, height: 100, rotation: 0,
        naturalWidth: 200, naturalHeight: 100, crop: { x: 0, y: 0, w: 0.5, h: 1 },
      };
      const plain = { ...el, crop: null, width: 200, height: 100 };
      return {
        corner: h.calculateResize(el, h.HandleType.SE, 50, 10, true),
        side: h.calculateResize(el, h.HandleType.E, 40, 0, true),
        vertical: h.calculateResize(el, h.HandleType.S, 0, 20, true),
        // 切り抜いていない画像は、これまでどおり元画像の縦横比(2:1)
        uncropped: h.calculateResize(plain, h.HandleType.SE, 100, 0, true),
      };
    });
    expect(r.corner.width).toBeCloseTo(150);
    expect(r.corner.height).toBeCloseTo(150);
    expect(r.side.width).toBeCloseTo(140);
    expect(r.side.height).toBeCloseTo(140);
    expect(r.vertical.width).toBeCloseTo(120);
    expect(r.vertical.height).toBeCloseTo(120);
    expect(r.uncropped.width).toBeCloseTo(300);
    expect(r.uncropped.height).toBeCloseTo(150);
  });

  test('左右反転・上下反転のボタンで、プレビューが裏返る', async ({ page }) => {
    await addTwoToneImage(page);
    const before = await countColors(page);
    expect(before.blackLeft).toBeGreaterThan(before.blackRight * 5);
    expect(before.blueRight).toBeGreaterThan(before.blueLeft * 5);

    await page.click('#prop-image-flip-x');
    await expect(page.locator('#prop-image-flip-x')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(200);
    const flipped = await countColors(page);
    expect(flipped.blackRight).toBeGreaterThan(flipped.blackLeft * 5);
    expect(flipped.blueLeft).toBeGreaterThan(flipped.blueRight * 5);

    // 上下反転は左右の並びを変えない
    await page.click('#prop-image-flip-y');
    await expect(page.locator('#prop-image-flip-y')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(200);
    const both = await countColors(page);
    expect(both.blackRight).toBeGreaterThan(both.blackLeft * 5);

    // 元に戻す(Ctrl+Z)で反転が外れる
    await page.locator('#preview-canvas').focus().catch(() => {});
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const undone = await countColors(page);
    expect(undone.blackLeft).toBeGreaterThan(undone.blackRight * 5);
  });

  test('ハンドルで範囲を決めて切り抜ける。解除・元に戻すもできる', async ({ page }) => {
    await addTwoToneImage(page);
    const before = await countColors(page);
    expect(before.blueRight).toBeGreaterThan(100);

    await page.click('#prop-image-crop');
    await expect(page.locator('#crop-dialog')).toBeVisible();
    await expect(page.locator('#crop-size')).toHaveText('200 × 100 px');

    // 右の辺のハンドルを、画像の幅の半分だけ左へ
    const stage = (await page.locator('#crop-stage').boundingBox())!;
    await dragBy(page, '#crop-box .crop-handle-e', -stage.width / 2, 0);
    await expect(page.locator('#crop-size')).toHaveText(/^(99|100|101) × 100 px$/);

    // ダイアログの中で Delete を押しても、要素は消えない
    await page.locator('#crop-box').focus();
    await page.keyboard.press('Delete');
    await page.click('#crop-apply');
    await expect(page.locator('#crop-dialog')).toBeHidden();
    await expect(page.locator('#props-image')).toBeVisible();
    await expect(page.locator('#prop-image-crop-clear')).toBeVisible();
    await page.waitForTimeout(200);

    const cropped = await countColors(page);
    expect(cropped.blueLeft + cropped.blueRight).toBeLessThan(before.blueRight / 20);
    expect(cropped.blackLeft + cropped.blackRight).toBeGreaterThan(100);

    // もう一度開くと、前の範囲が残っている
    await page.click('#prop-image-crop');
    await expect(page.locator('#crop-size')).toHaveText(/^(99|100|101) × 100 px$/);
    // キャンセル(Esc)では何も変わらない
    await page.keyboard.press('Escape');
    await expect(page.locator('#crop-dialog')).toBeHidden();
    await expect(page.locator('#props-image')).toBeVisible();

    // 解除すると青が戻る
    await page.click('#prop-image-crop-clear');
    await page.waitForTimeout(200);
    const cleared = await countColors(page);
    expect(cleared.blueRight + cleared.blueLeft).toBeGreaterThan(before.blueRight / 2);
    await expect(page.locator('#prop-image-crop-clear')).toBeHidden();
  });

  test('反転している画像は、見た目のままトリミングできる', async ({ page }) => {
    await addTwoToneImage(page);
    await page.click('#prop-image-flip-x');
    // 見た目では左が青。左半分を残すと青だけになる
    await page.click('#prop-image-crop');
    const stage = (await page.locator('#crop-stage').boundingBox())!;
    await dragBy(page, '#crop-box .crop-handle-e', -stage.width / 2, 0);
    await page.click('#crop-apply');
    await page.waitForTimeout(200);
    const r = await countColors(page);
    expect(r.blueLeft + r.blueRight).toBeGreaterThan(100);
    expect(r.blackLeft + r.blackRight).toBeLessThan(20);
  });

  test('縦横比 1:1 を選ぶと正方形になり、ダブルクリックでも開ける', async ({ page }) => {
    await addTwoToneImage(page);
    await page.locator('#preview-canvas').dblclick({ position: await (async () => {
      const b = (await page.locator('#preview-canvas').boundingBox())!;
      return { x: b.width / 2, y: b.height / 2 };
    })() });
    await expect(page.locator('#crop-dialog')).toBeVisible();
    await page.click('#crop-dialog [data-ratio="1:1"]');
    await expect(page.locator('#crop-dialog [data-ratio="1:1"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#crop-size')).toHaveText('100 × 100 px');
    // 正方形のまま角を引っぱっても正方形
    await dragBy(page, '#crop-box .crop-handle-se', -30, -5);
    const text = await page.locator('#crop-size').textContent();
    const [w, h] = text!.match(/\d+/g)!.map(Number);
    expect(Math.abs(w - h)).toBeLessThanOrEqual(1);
    await page.click('#crop-reset');
    await expect(page.locator('#crop-size')).toHaveText('200 × 100 px');
    await page.click('#crop-cancel');
    await expect(page.locator('#crop-dialog')).toBeHidden();
  });
});
