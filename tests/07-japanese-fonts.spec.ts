import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { installFakePrinter, printAndWait, resetDrawnTexts } from './helpers/fake-printer';

// #23 日本語フォントのプリセット
test.describe('日本語フォント', () => {
  test.beforeEach(async ({ page }) => {
    await installFakePrinter(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('フォント選択の先頭に「日本語」グループがある', async ({ page }) => {
    const group = page.locator('#prop-font-family optgroup[label="日本語"]');
    await expect(group).toHaveCount(1);
    const values = await group.locator('option').evaluateAll(
      (opts) => opts.map((o) => (o as HTMLOptionElement).value)
    );
    expect(values).toEqual([
      '"Noto Sans JP", sans-serif',
      '"BIZ UDPGothic", sans-serif',
      '"M PLUS Rounded 1c", sans-serif',
      '"Zen Maru Gothic", sans-serif',
      '"Noto Serif JP", serif',
    ]);
    // 先頭のグループであること
    const firstLabel = await page.locator('#prop-font-family optgroup').first().getAttribute('label');
    expect(firstLabel).toBe('日本語');
  });

  test('日本語フォントの CSS が読み込まれる(太めのウェイト付き)', async ({ page }) => {
    const href = await page.locator('link#ja-fonts-css').getAttribute('href');
    expect(href).toContain('fonts.googleapis.com/css2');
    expect(href).toContain('family=Noto+Sans+JP:wght@400;500;700');
    expect(href).toContain('family=M+PLUS+Rounded+1c:wght@400;500;700');
    expect(href).toContain('display=swap');
  });

  test('新しいテキストの既定フォントは Noto Sans JP', async ({ page }) => {
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(page.locator('#prop-font-family')).toHaveValue('"Noto Sans JP", sans-serif');
  });

  test('フォントを切り替えられる', async ({ page }) => {
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.locator('#prop-font-family').selectOption('"Zen Maru Gothic", sans-serif');
    await expect(page.locator('#prop-font-family')).toHaveValue('"Zen Maru Gothic", sans-serif');
  });

  test('印刷前にフォントの読み込みを待つ関数が、時間内に終わる', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const mod = await import('/fonts-ja.js');
      const started = performance.now();
      const r = await mod.waitForElementFonts(
        [{ type: 'text', text: 'あいうえお漢字', fontFamily: '"Noto Sans JP", sans-serif', fontWeight: 'bold' }],
        { timeoutMs: 15000 }
      );
      return { ...r, elapsed: performance.now() - started };
    });
    expect(result.elapsed).toBeLessThan(15500);
    if (process.env.CI) {
      // CI ではネットワークがあるので、実際に読み込めていること
      expect(result.loaded).toBe(true);
      const ok = await page.evaluate(() => document.fonts.check('bold 16px "Noto Sans JP"', 'あいうえお漢字'));
      expect(ok).toBe(true);
    }
  });

  test('日本語のテキストを日本語フォントで印刷できる', async ({ page }) => {
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.locator('#prop-text-content').fill('こんにちは世界');
    await page.locator('#prop-text-content').dispatchEvent('input');
    await page.waitForTimeout(200);

    await resetDrawnTexts(page);
    await printAndWait(page);
    await expect(page.locator('#status-message')).toHaveText('Print complete!');

    const drawn = await page.evaluate(() => {
      const w = window as any;
      return (w.__drawnTexts as string[]).map((t, i) => ({ t, f: w.__drawnFonts[i] as string }));
    });
    const hit = drawn.find((d) => d.t.includes('こんにちは世界'));
    expect(hit).toBeTruthy();
    expect(hit!.f).toContain('Noto Sans JP');
    expect(await page.evaluate(() => (window as any).__fakePrinter.bytesWritten)).toBeGreaterThan(0);
  });
});
