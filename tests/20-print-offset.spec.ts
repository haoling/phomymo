import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { installFakePrinter } from './helpers/fake-printer';

// 印刷の横位置: M120 は用紙がヘッドの右に寄る機種として扱う + プリンターごとの横位置の補正

test.describe('印刷の横位置', () => {
  test.beforeEach(async ({ page }) => {
    await installFakePrinter(page, 'Q244J3CB0350030');
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('M120(Q244J… の名前も)は右寄せ、M110 は中央寄せ', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const p = await import('/printer.js');
      await p.loadPrinterDefinitions();
      return {
        m120: p.getPrinterAlignment('M120', 'auto'),
        q244j: p.getPrinterAlignment('Q244J3CB0350030', 'auto'),
        m110: p.getPrinterAlignment('M110', 'auto'),
        m120Override: p.getPrinterAlignment('', 'm120'),
        q244jWidth: p.getPrinterWidthBytes('Q244J3CB0350030', 'auto'),
      };
    });
    expect(out).toEqual({ m120: 'right', q244j: 'right', m110: 'center', m120Override: 'right', q244jWidth: 48 });
  });

  test('補正の値は範囲内・0.5mm 刻みにそろえる', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const m = await import('/print-offset.js');
      return [m.normalizeOffsetMm('1.3'), m.normalizeOffsetMm(-99), m.normalizeOffsetMm('abc'), m.normalizeOffsetMm(-0.1), m.offsetMmToDots(1.5)];
    });
    expect(out).toEqual([1.5, -10, 0, 0, 12]);
  });

  test('ラスターを横にずらす(＋で右、−で左、はみ出た分は捨てる)', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const m = await import('/print-offset.js');
      // 2バイト幅 × 1行。左から 0, 7, 8 ドット目が黒
      const raster = { data: new Uint8Array([0b10000001, 0b10000000]), widthBytes: 2, heightLines: 1 };
      return {
        right3: Array.from(m.shiftRasterX(raster, 3).data),
        left1: Array.from(m.shiftRasterX(raster, -1).data),
        none: m.shiftRasterX(raster, 0) === raster,
      };
    });
    expect(out.right3).toEqual([0b00010000, 0b00110000]);
    expect(out.left1).toEqual([0b00000011, 0b00000000]);
    expect(out.none).toBe(true);
  });

  test('print() で横位置の補正をかける', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const p = await import('/printer.js');
      await p.loadPrinterDefinitions();
      const run = async (deviceName: string, offsetMm: number) => {
        const chunks: number[][] = [];
        const transport = { async send(buf: Uint8Array) { chunks.push(Array.from(buf)); }, async delay() {} };
        const widthBytes = 48, heightLines = 2;
        const data = new Uint8Array(widthBytes * heightLines);
        data[10] = 0x80; // 1行目の 80 ドット目
        await p.print(transport, { data, widthBytes, heightLines }, { isBLE: true, deviceName, printerModel: 'auto', offsetMm });
        const hi = chunks.findIndex(c => c[0] === 0x1d && c[1] === 0x76 && c[2] === 0x30);
        const body = chunks.slice(hi + 1).flat().slice(0, widthBytes * heightLines);
        const firstBlack = body.findIndex(b => b !== 0);
        return firstBlack < 0 ? -1 : firstBlack * 8 + Math.clz32(body[firstBlack]) - 24;
      };
      return { m120Plus1: await run('M120', 1), m110Minus2: await run('M110', -2), none: await run('M120', 0) };
    });
    expect(out.none).toBe(80);
    expect(out.m120Plus1).toBe(88);
    expect(out.m110Minus2).toBe(64);
  });

  test('印刷設定で、接続中のプリンターごとに補正を保存できる', async ({ page }) => {
    // 未接続のときは決められない
    await page.click('#print-settings-btn');
    await expect(page.locator('#print-offset-x')).toBeDisabled();
    await expect(page.locator('#print-offset-note')).toBeVisible();
    await page.click('#print-settings-close');

    await page.click('#connect-btn');
    await expect(page.locator('#status-message')).toContainText('Q244J3CB0350030', { timeout: 15_000 });

    await page.click('#print-settings-btn');
    await expect(page.locator('#print-offset-x')).toBeEnabled();
    await expect(page.locator('#print-offset-label')).toContainText('Q244J3CB0350030');
    await page.click('[data-print-offset-step="0.5"]');
    await page.click('[data-print-offset-step="0.5"]');
    await page.click('[data-print-offset-step="0.5"]');
    await page.click('[data-print-offset-step="-0.5"]');
    await expect(page.locator('#print-offset-x')).toHaveValue('1');
    await page.click('#print-settings-save');

    const saved = await page.evaluate(async () => {
      const m = await import('/print-offset.js');
      return [m.getDeviceOffsetMm('Q244J3CB0350030'), m.getDeviceOffsetMm('M110')];
    });
    expect(saved).toEqual([1, 0]);

    // もう一度開くと保存した値が入っている
    await page.click('#print-settings-btn');
    await expect(page.locator('#print-offset-x')).toHaveValue('1');
  });
});
