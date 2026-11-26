import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { installFakePrinter, printAndWait, resetSentBytes, getLastRaster } from './helpers/fake-printer';
import { FakeDrive, installFakeGoogle, loginViaUI } from './helpers/fake-google';

// 印刷時の回転(30×40mm のデザインを 40×30mm の用紙に印刷する)

async function setNumber(page: Page, selector: string, value: number) {
  await page.locator(selector).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForTimeout(100);
}

/** ラベルを 30×40mm(縦長)にし、上の方に黒い横長の四角を置く */
async function setupPortraitDesign(page: Page) {
  await page.locator('#label-size').selectOption('custom');
  await setNumber(page, '#custom-width', 30);
  await setNumber(page, '#custom-height', 40);

  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 40;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 200, 40);
    return c.toDataURL('image/png');
  });
  const file = path.join(os.tmpdir(), `phomymo-rotation-${process.pid}.png`);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await page.locator('#image-file-input').setInputFiles(file);
  await expect(page.locator('#props-image')).toBeVisible();
  await setNumber(page, '#prop-width', 200);
  await setNumber(page, '#prop-height', 40);
  await setNumber(page, '#prop-x', 20);
  await setNumber(page, '#prop-y', 8);
  await page.keyboard.press('Escape');
}

async function openPrintSettings(page: Page) {
  await page.click('#print-settings-btn');
  await expect(page.locator('#print-settings-dialog')).not.toHaveClass(/\bhidden\b/);
}

async function savePrintSettings(page: Page) {
  await page.click('#print-settings-save');
  await expect(page.locator('#print-settings-dialog')).toHaveClass(/\bhidden\b/);
}

test.describe('印刷時の回転', () => {
  test.beforeEach(async ({ page }) => {
    await installFakePrinter(page, 'M110');
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    await setupPortraitDesign(page);
  });

  test('回さないときは 30×40mm のまま、デザインで 90° にすると 40×30mm で上側が右に来る', async ({ page }) => {
    await printAndWait(page);
    const upright = await getLastRaster(page);
    expect(upright).not.toBeNull();
    expect(upright!.heightLines).toBe(320); // 40mm
    expect(upright!.meanY!).toBeLessThan(0.3); // 黒は上の方

    await openPrintSettings(page);
    await expect(page.locator('#print-rotation-design')).toHaveValue('device');
    await page.locator('#print-rotation-design').selectOption('90');
    await expect(page.locator('#print-rotation-result')).toContainText('40×30mm');
    await savePrintSettings(page);

    await resetSentBytes(page);
    await printAndWait(page);
    const rotated = await getLastRaster(page);
    expect(rotated!.heightLines).toBe(240); // 30mm
    expect(rotated!.black).toBeGreaterThan(upright!.black * 0.9);
    // 時計回りに回したので、デザインの上側は用紙の右側
    expect(rotated!.meanX!).toBeGreaterThan(0.6);

    // 270° なら左側
    await openPrintSettings(page);
    await page.locator('#print-rotation-design').selectOption('270');
    await savePrintSettings(page);
    await resetSentBytes(page);
    await printAndWait(page);
    const ccw = await getLastRaster(page);
    expect(ccw!.heightLines).toBe(240);
    expect(ccw!.meanX!).toBeLessThan(0.4);

    // 180° なら縦長のまま、下側
    await openPrintSettings(page);
    await page.locator('#print-rotation-design').selectOption('180');
    await savePrintSettings(page);
    await resetSentBytes(page);
    await printAndWait(page);
    const flipped = await getLastRaster(page);
    expect(flipped!.heightLines).toBe(320);
    expect(flipped!.meanY!).toBeGreaterThan(0.7);
  });

  test('プリンターごとの既定は接続中の機体に覚えられ、デザインの指定が優先される', async ({ page }) => {
    // 未接続のときは機体の既定を選べない
    await openPrintSettings(page);
    await expect(page.locator('#print-rotation-device')).toBeDisabled();
    await expect(page.locator('#print-rotation-device-note')).not.toHaveClass(/\bhidden\b/);
    await page.click('#print-settings-close');

    await printAndWait(page); // 接続される

    await openPrintSettings(page);
    await expect(page.locator('#print-rotation-device')).toBeEnabled();
    await expect(page.locator('#print-rotation-device-label')).toContainText('M110');
    await page.locator('#print-rotation-device').selectOption('90');
    await expect(page.locator('#print-rotation-result')).toContainText('40×30mm');
    await savePrintSettings(page);

    await resetSentBytes(page);
    await printAndWait(page);
    expect((await getLastRaster(page))!.heightLines).toBe(240);

    // デザインで「回さない」を選ぶと、機体の既定より優先される
    await openPrintSettings(page);
    await expect(page.locator('#print-rotation-device')).toHaveValue('90');
    await page.locator('#print-rotation-design').selectOption('0');
    await expect(page.locator('#print-rotation-result')).toContainText('30×40mm');
    await savePrintSettings(page);

    await resetSentBytes(page);
    await printAndWait(page);
    expect((await getLastRaster(page))!.heightLines).toBe(320);
  });

});

async function openSavedDesign(page: Page, name: string) {
  await page.click('#load-btn');
  await page.locator('#design-grid .design-card').filter({ hasText: name }).click();
  await expect(page.locator('#load-dialog')).toHaveClass(/\bhidden\b/);
}

async function reloadApp(page: Page) {
  await page.reload({ waitUntil: 'networkidle' });
  await waitForAppReady(page);
  await dismissInfoDialog(page);
  // リロード直後は再接続待ち(ログインは続いている)
  await expect(page.locator('#account-btn')).toHaveAttribute('data-state', 'needs-auth');
}

test.describe('印刷時の回転: デザインへの保存', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeGoogle(page, new FakeDrive());
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    await loginViaUI(page);
    await setupPortraitDesign(page);
  });

  test('デザインの回転はデザインと一緒に保存・読み込みされる', async ({ page }) => {
    await openPrintSettings(page);
    await page.locator('#print-rotation-design').selectOption('90');
    await savePrintSettings(page);

    await page.click('#save-btn');
    await expect(page.locator('#save-dialog')).not.toHaveClass(/\bhidden\b/);
    await page.fill('#save-name', '回転つき');
    await page.click('#save-confirm');
    await expect(page.locator('#save-dialog')).toHaveClass(/\bhidden\b/);

    await reloadApp(page);

    await openPrintSettings(page);
    await expect(page.locator('#print-rotation-design')).toHaveValue('device');
    await page.click('#print-settings-close');

    await openSavedDesign(page, '回転つき');
    await openPrintSettings(page);
    await expect(page.locator('#print-rotation-design')).toHaveValue('90');

    // 開いているデザインで変えると、保存し直さなくてもデザインに残る
    await page.locator('#print-rotation-design').selectOption('270');
    await savePrintSettings(page);
    await reloadApp(page);
    await openSavedDesign(page, '回転つき');
    await openPrintSettings(page);
    await expect(page.locator('#print-rotation-design')).toHaveValue('270');
  });
});
