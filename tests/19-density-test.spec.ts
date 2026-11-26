import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { installFakePrinter, resetDrawnTexts, getDrawnTexts } from './helpers/fake-printer';

// 濃さのテスト印刷: 濃さを変えて同じ見本を1段階1枚ずつ印刷する

test.describe('濃さのテスト印刷', () => {
  test.beforeEach(async ({ page }) => {
    await installFakePrinter(page, 'M110');
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('印刷する濃さの段階: 既定は今の濃さと前後、全部なら1〜8', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const m = await import('/density-test.js');
      return {
        mid: m.densityTestLevels(4, 'near'),
        low: m.densityTestLevels(1, 'near'),
        high: m.densityTestLevels(8, 'near'),
        all: m.densityTestLevels(6, 'all'),
        def: m.densityTestLevels(6),
      };
    });
    expect(out.mid).toEqual([3, 4, 5]);
    expect(out.low).toEqual([1, 2]);
    expect(out.high).toEqual([7, 8]);
    expect(out.all).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.def).toEqual([5, 6, 7]);
  });

  test('M110/M120 では1段階ごとに1回だけ印刷し、機種用の濃さの命令で濃さを変える', async ({ page }) => {
    const sent = await page.evaluate(async () => {
      const p = await import('/printer.js');
      await p.loadPrinterDefinitions();
      const chunks: number[][] = [];
      const transport = {
        async send(buf: Uint8Array) { chunks.push(Array.from(buf)); },
        async delay() {},
      };
      const widthBytes = 48, heightLines = 16;
      await p.printDensityTest(transport, {
        levels: [3, 4, 5],
        buildRaster: () => ({ data: new Uint8Array(widthBytes * heightLines), widthBytes, heightLines }),
        isBLE: true,
        deviceName: 'M110',
        printerModel: 'auto',
        feed: 32,
      });
      const isPrefix = (c: number[], pre: number[]) => pre.every((v, i) => c[i] === v);
      return {
        // M110 の印刷の終わり(1F F0 05 00 ...)の回数 = 送られるラベルの枚数
        footers: chunks.filter(c => isPrefix(c, [0x1f, 0xf0, 0x05, 0x00])).length,
        // M110 の濃さの命令(ESC N 04 n)の値
        densities: chunks.filter(c => isPrefix(c, [0x1b, 0x4e, 0x04])).map(c => c[3]),
        // 汎用の ESC/POS の濃さ命令(M110 には効かない)は送らない
        escPosHeat: chunks.filter(c => isPrefix(c, [0x1b, 0x37])).length,
      };
    });
    expect(sent.footers).toBe(3);
    expect(sent.densities).toHaveLength(3);
    expect(new Set(sent.densities).size).toBe(3);
    expect(sent.densities).toEqual([...sent.densities].sort((a, b) => a - b));
    expect(sent.escPosHeat).toBe(0);
  });

  test('ボタンを押すと、今の濃さと前後の3枚に番号入りの見本を印刷する', async ({ page }) => {
    await page.click('#print-settings-btn');
    await page.locator('#print-density').fill('4');
    await page.locator('#print-density').dispatchEvent('input');
    await expect(page.locator('#density-test-range')).toHaveValue('near');
    await resetDrawnTexts(page);

    await page.click('#print-density-test');
    await expect(page.locator('#status-message')).toContainText('濃さのテストが終わりました', { timeout: 60_000 });

    const texts = await getDrawnTexts(page);
    expect(texts).toContain('濃さ 3');
    expect(texts).toContain('★濃さ 4');
    expect(texts).toContain('濃さ 5');
    expect(texts.some(s => /濃さ [1-26-8]/.test(s))).toBe(false);
  });
});
