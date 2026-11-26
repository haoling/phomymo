import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

// 要素のミラー配置(シールを2つ折りにして使う)

/** 左半分が黒、右半分が青の画像を追加し、ラベルの左側に小さく置く */
async function addTwoToneImageOnLeft(page: Page) {
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
  const file = path.join(os.tmpdir(), `phomymo-mirror-${process.pid}.png`);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await page.locator('#image-file-input').setInputFiles(file);
  await expect(page.locator('#props-image')).toBeVisible();
  await setNumber(page, '#prop-width', 80);
  await setNumber(page, '#prop-height', 40);
  await setNumber(page, '#prop-x', 8);
  await setNumber(page, '#prop-y', 8);
  await expect.poll(async () => (await measure(page)).left.black, { timeout: 5000 }).toBeGreaterThan(100);
}

async function setNumber(page: Page, selector: string, value: number) {
  await page.locator(selector).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForTimeout(100);
}

/** プレビューのキャンバスの左右それぞれで、黒と青の画素の数と平均の x を測る(キャンバスの中心=ラベルの中心) */
async function measure(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#preview-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const mk = () => ({ black: 0, blue: 0, blackX: 0, blueX: 0 });
    const r = { left: mk(), right: mk() };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 200) continue;
        const side = x < width / 2 ? r.left : r.right;
        if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40) { side.black++; side.blackX += x; }
        else if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] > 200) { side.blue++; side.blueX += x; }
      }
    }
    for (const s of [r.left, r.right]) {
      s.blackX = s.black ? s.blackX / s.black : 0;
      s.blueX = s.blue ? s.blueX / s.blue : 0;
    }
    return r;
  });
}

test.describe('ミラー配置(位置と向きの計算)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
  });

  test('折り線をはさんだ反対側に写しを作り、向きの指定どおりに回す', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const m = await import('/mirror.js');
      const el = { id: 'a', type: 'shape', x: 10, y: 20, width: 30, height: 40, rotation: 30 };
      return {
        none: m.mirrorCopyOf(el, 200, 100),
        xm: m.mirrorCopyOf({ ...el, mirror: { axis: 'x', orient: 'mirror' } }, 200, 100),
        xu: m.mirrorCopyOf({ ...el, mirror: { axis: 'x', orient: 'upright' } }, 200, 100),
        y180: m.mirrorCopyOf({ ...el, mirror: { axis: 'y', orient: 'rotate180' } }, 200, 100),
        ym: m.mirrorCopyOf({ ...el, mirror: { axis: 'y' } }, 200, 100),
        broken: m.normalizeMirror({ axis: 'z', orient: 'zz' }),
        list: m.withMirrorCopies([{ ...el, mirror: { axis: 'x' } }, { ...el, id: 'b' }], 200, 100).map(e => e.id),
        same: (() => { const a = [el]; return m.withMirrorCopies(a, 200, 100) === a; })(),
      };
    });
    expect(r.none).toBeNull();
    expect(r.xm).toMatchObject({ x: 160, y: 20, rotation: 30, _mirrorScale: [-1, 1], _mirrorCopy: true });
    expect(r.xm.mirror).toBeUndefined();
    expect(r.xu).toMatchObject({ x: 160, y: 20, rotation: 330 });
    expect(r.xu._mirrorScale).toBeUndefined();
    expect(r.y180).toMatchObject({ x: 10, y: 40, rotation: 150 });
    expect(r.ym).toMatchObject({ y: 40, _mirrorScale: [1, -1] });
    expect(r.broken).toEqual({ axis: 'x', orient: 'mirror' });
    expect(r.list).toEqual(['a', 'a', 'b']);
    expect(r.same).toBe(true);
  });

  test('印刷用の画素にも写しが入る', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { CanvasRenderer } = await import('/canvas.js');
      const renderer = new CanvasRenderer(document.createElement('canvas'));
      renderer.setDimensions(40, 20, 1);
      const shape = { id: 's', type: 'shape', shape: 'rectangle', x: 8, y: 8, width: 40, height: 40, rotation: 0, fill: 'black', stroke: 'black', strokeWidth: 1 };
      const count = (els: any[]) => {
        const { pixels, width, height } = (renderer as any)._renderToPixels(els);
        let left = 0, right = 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          if (pixels[(y * width + x) * 4] < 100) (x < width / 2 ? left++ : right++);
        }
        return { left, right };
      };
      return { plain: count([shape]), mirrored: count([{ ...shape, mirror: { axis: 'x', orient: 'mirror' } }]) };
    });
    expect(r.plain.left).toBeGreaterThan(500);
    expect(r.plain.right).toBe(0);
    expect(r.mirrored.right).toBe(r.mirrored.left);
  });
});

test.describe('ミラー配置(画面)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('左右に折る: 右側に鏡像が出て、元を動かすと写しも追従し、元に戻せる', async ({ page }) => {
    await addTwoToneImageOnLeft(page);
    let m = await measure(page);
    expect(m.right.black).toBe(0);
    await expect(page.locator('#prop-mirror-orient')).toBeDisabled();

    await page.locator('#prop-mirror-axis').selectOption('x');
    await expect(page.locator('#status-message')).toContainText('ミラー配置をオンにしました');
    await expect(page.locator('#prop-mirror-orient')).toBeEnabled();
    m = await measure(page);
    expect(m.right.black).toBeGreaterThan(m.left.black * 0.8);
    // 元は左が黒・右が青。鏡像では外側(右端)が黒になる
    expect(m.left.blackX).toBeLessThan(m.left.blueX);
    expect(m.right.blackX).toBeGreaterThan(m.right.blueX);

    // 反転しない: 写しも左が黒
    await page.locator('#prop-mirror-orient').selectOption('upright');
    m = await measure(page);
    expect(m.right.blackX).toBeLessThan(m.right.blueX);

    // 元の要素を動かすと、写しは反対向きに動く
    const before = m.right.blackX;
    await setNumber(page, '#prop-x', 20);
    m = await measure(page);
    expect(m.right.blackX).toBeLessThan(before);

    // 元に戻す(ミラー配置の切り替えも1手で戻る)
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect(page.locator('#prop-mirror-orient')).toHaveValue('mirror');

    // オフにすると写しが消える
    await page.locator('#prop-mirror-axis').selectOption('');
    m = await measure(page);
    expect(m.right.black).toBe(0);
  });

});
