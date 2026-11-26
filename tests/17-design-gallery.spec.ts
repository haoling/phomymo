import { test, expect, Page } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { FakeDrive, installFakeGoogle, loginViaUI } from './helpers/fake-google';

// 保存したデザインを、サムネイルのグリッドで選ぶ(design-gallery.js)

async function addText(page: Page, text: string) {
  await page.click('#add-text');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('#prop-text-content').fill(text);
  await page.locator('#prop-text-content').dispatchEvent('input');
  await page.waitForTimeout(200);
}

async function saveAs(page: Page, name: string) {
  await page.click('#save-btn');
  await expect(page.locator('#save-dialog')).not.toHaveClass(/\bhidden\b/);
  await page.fill('#save-name', name);
  await page.click('#save-confirm');
  await expect(page.locator('#save-dialog')).toHaveClass(/\bhidden\b/);
}

test.describe('デザインを開く: グリッド表示', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeGoogle(page, new FakeDrive());
    await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    await loginViaUI(page);
  });

  test('はじめはグリッドで、デザインごとにサムネイルが出る。押すと開ける', async ({ page }) => {
    await addText(page, 'りんご');
    await saveAs(page, 'りんごラベル');
    await addText(page, 'みかん');
    await saveAs(page, 'みかんラベル');

    await page.click('#load-btn');
    await expect(page.locator('#design-list')).toHaveAttribute('data-view', 'grid');
    const cards = page.locator('#design-grid .design-card');
    await expect(cards).toHaveCount(2);
    await expect(page.locator('#load-dialog-panel')).toHaveClass(/load-dialog-wide/);

    // サムネイルは PNG で、ラベルの縦横比(40x30mm)で描かれている
    const thumb = cards.filter({ hasText: 'りんごラベル' }).locator('img.design-thumb');
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveAttribute('src', /^data:image\/png;base64,/);
    const ratio = await thumb.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
    expect(ratio).toBeCloseTo(40 / 30, 1);

    // 白一色ではない(文字が描かれている)
    const inked = await thumb.evaluate((img: HTMLImageElement) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
      return dark;
    });
    expect(inked).toBeGreaterThan(20);

    await cards.filter({ hasText: 'りんごラベル' }).click();
    await expect(page.locator('#load-dialog')).toHaveClass(/\bhidden\b/);
    await expect(page.locator('#status-message')).toContainText('「りんごラベル」を開きました');
  });

  test('リスト表示に切り替えられ、その選択は覚えておく', async ({ page }) => {
    await addText(page, 'テスト');
    await saveAs(page, '切り替え');

    await page.click('#load-btn');
    await page.click('.design-view-btn[data-view="list"]');
    await expect(page.locator('#design-list')).toHaveAttribute('data-view', 'list');
    await expect(page.locator('#design-grid')).toHaveCount(0);
    await expect(page.locator('#design-list .design-item[data-name="切り替え"]')).toBeVisible();
    await expect(page.locator('#load-dialog-panel')).not.toHaveClass(/load-dialog-wide/);
    await page.click('#load-cancel');

    await page.click('#load-btn');
    await expect(page.locator('#design-list')).toHaveAttribute('data-view', 'list');
    await page.click('.design-view-btn[data-view="grid"]');
    await expect(page.locator('#design-grid .design-card')).toHaveCount(1);
  });

  test('グリッドから削除できる', async ({ page }) => {
    await addText(page, '消す');
    await saveAs(page, '消すデザイン');
    await page.click('#load-btn');
    page.once('dialog', d => d.accept());
    await page.click('#design-grid .delete-design[data-name="消すデザイン"]');
    await expect(page.locator('#design-grid')).toHaveCount(0);
    await expect(page.locator('#design-list')).toContainText('保存したデザインはありません');
  });

  test('名前に記号があっても崩れない', async ({ page }) => {
    await addText(page, 'x');
    await saveAs(page, "A&amp;B 'x'");
    await page.click('#load-btn');
    await expect(page.locator('#design-grid .design-card')).toHaveCount(1);
    await expect(page.locator('#design-grid .design-card')).toContainText("A&amp;B 'x'");
    await page.locator('#design-grid .design-card').click();
    await expect(page.locator('#status-message')).toContainText("A&amp;B 'x'");
  });
});

test.describe('サンプルデザイン', () => {
  test('ゲストでもサンプルが10件並び、押すと名前のないデザインとして開ける', async ({ page }) => {
    await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);

    await page.click('#load-btn');
    await expect(page.locator('#load-guest-notice')).toBeVisible();
    const samples = page.locator('#design-samples');
    await expect(samples).toHaveAttribute('open', '');
    const cards = samples.locator('.design-card');
    await expect(cards).toHaveCount(10);
    await expect(samples.locator('.delete-design')).toHaveCount(0);

    // 素材(アイコン)入りのサンプルもサムネイルが出る
    const salt = cards.filter({ hasText: '調味料ラベル' });
    await expect(salt.locator('img.design-thumb')).toHaveAttribute('src', /^data:image\/png/, { timeout: 15_000 });

    await salt.click();
    await expect(page.locator('#load-dialog')).toHaveClass(/\bhidden\b/);
    await expect(page.locator('#status-message')).toContainText('サンプル「調味料ラベル」を開きました');
  });

  test('保存したデザインがあるときは、サンプルの欄は閉じておく', async ({ page }) => {
    await installFakeGoogle(page, new FakeDrive());
    await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    await loginViaUI(page);
    await addText(page, 'a');
    await saveAs(page, '自分の');
    await page.click('#load-btn');
    await expect(page.locator('#design-samples')).not.toHaveAttribute('open', '');
    await page.click('#design-samples summary');
    await expect(page.locator('#design-samples .design-card')).toHaveCount(10);
    // サンプルを開いても、保存したデザインは増えない
    await page.locator('#design-samples .design-card').first().click();
    await page.click('#load-btn');
    await expect(page.locator('#design-grid .design-card')).toHaveCount(1);
  });
});
