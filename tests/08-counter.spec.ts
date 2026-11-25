import { test, expect, Page } from '@playwright/test';
import path from 'path';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { installFakePrinter, printAndWait, resetDrawnTexts, getDrawnTexts, setCopies } from './helpers/fake-printer';

// #31 連番

async function addText(page: Page, text: string) {
  await page.click('#add-text');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('#prop-text-content').fill(text);
  await page.locator('#prop-text-content').dispatchEvent('input');
  await page.waitForTimeout(200);
}

test.describe('連番 [[counter]] の式', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
  });

  test('書式指定どおりに番号が振られる', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const t = await import('/templates.js');
      const els = [
        { type: 'text', text: 'ITEM-[[counter|pad=4]]' },
        { type: 'barcode', barcodeData: '[[counter|start=10,step=5,pad=3]]' },
        { type: 'qr', qrData: 'https://example.com/?n=[[連番]]' },
      ];
      return [0, 1, 2].map((i) =>
        t.evaluateExpressions(els, { counterIndex: i }).map((e: any) => e.text || e.barcodeData || e.qrData)
      );
    });
    expect(out).toEqual([
      ['ITEM-0001', '010', 'https://example.com/?n=1'],
      ['ITEM-0002', '015', 'https://example.com/?n=2'],
      ['ITEM-0003', '020', 'https://example.com/?n=3'],
    ]);
  });

  test('既定値・負の数・ほかの式との組み合わせ', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const t = await import('/templates.js');
      return {
        defaults: t.parseCounterOptions(null),
        negative: t.formatCounter(0, t.parseCounterOptions('start=-3,pad=2')),
        spaced: t.parseCounterOptions('start=5; step=2 pad=3'),
        noContext: t.evaluateExpressions([{ text: '[[counter|pad=3]]' }])[0].text,
        mixed: t.evaluateExpressions([{ text: '[[counter]]/[[year]]' }], { counterIndex: 4 })[0].text,
        has: t.hasCounter([{ text: 'a' }, { qrData: '[[serial]]' }]),
        hasNot: t.hasCounter([{ text: '[[date]]' }]),
        preview: t.previewCounter([{ text: 'No.[[counter|pad=3]]' }], 6),
      };
    });
    expect(out.defaults).toEqual({ start: 1, step: 1, pad: 0 });
    expect(out.negative).toBe('-03');
    expect(out.spaced).toEqual({ start: 5, step: 2, pad: 3 });
    expect(out.noContext).toBe('001');
    expect(out.mixed).toBe(`5/${new Date().getFullYear()}`);
    expect(out.has).toBe(true);
    expect(out.hasNot).toBe(false);
    expect(out.preview).toBe('007');
  });
});

test.describe('連番での印刷', () => {
  test.beforeEach(async ({ page }) => {
    await installFakePrinter(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('部数5で印刷すると 001〜005 が出る', async ({ page }) => {
    test.setTimeout(120_000);
    await addText(page, 'No.[[counter|start=1,step=1,pad=3]]');
    await setCopies(page, 5);

    await resetDrawnTexts(page);
    await printAndWait(page);
    await expect(page.locator('#status-message')).toHaveText('Printed 5 copies!');

    const drawn = await getDrawnTexts(page);
    for (const n of ['001', '002', '003', '004', '005']) {
      expect(drawn).toContain(`No.${n}`);
    }
    expect(drawn).not.toContain('No.006');
  });

  test('「前回の続きから」を ON にすると、次の印刷は続きの番号から始まる', async ({ page }) => {
    test.setTimeout(120_000);
    await addText(page, 'No.[[counter|pad=3]]');

    await page.click('#print-settings-btn');
    await expect(page.locator('#counter-preview')).toHaveText('次に印刷される番号: 001');
    await page.locator('#counter-resume').check();
    await page.locator('#print-copies').fill('2');
    await page.click('#print-settings-save');

    await resetDrawnTexts(page);
    await printAndWait(page);
    let drawn = await getDrawnTexts(page);
    expect(drawn).toContain('No.001');
    expect(drawn).toContain('No.002');

    await resetDrawnTexts(page);
    await printAndWait(page);
    drawn = await getDrawnTexts(page);
    expect(drawn).toContain('No.003');
    expect(drawn).toContain('No.004');
    expect(drawn).not.toContain('No.001');

    await page.click('#print-settings-btn');
    await expect(page.locator('#counter-next')).toHaveValue('5');
    await expect(page.locator('#counter-preview')).toHaveText('次に印刷される番号: 005');

    // 最初に戻す
    await page.click('#counter-reset');
    await expect(page.locator('#counter-next')).toHaveValue('1');
    await expect(page.locator('#counter-preview')).toHaveText('次に印刷される番号: 001');
  });

  test('「前回の続きから」が OFF なら毎回 1 から', async ({ page }) => {
    test.setTimeout(120_000);
    await addText(page, 'No.[[counter|pad=3]]');
    await setCopies(page, 2);

    await printAndWait(page);
    await resetDrawnTexts(page);
    await printAndWait(page);
    const drawn = await getDrawnTexts(page);
    expect(drawn).toContain('No.001');
    expect(drawn).toContain('No.002');
    expect(drawn).not.toContain('No.003');
  });

  test('続きの番号はデザインごとに保存される', async ({ page }) => {
    test.setTimeout(120_000);
    await addText(page, 'No.[[counter|pad=3]]');

    await page.click('#print-settings-btn');
    await page.locator('#counter-resume').check();
    await page.locator('#counter-next').fill('42');
    await page.locator('#counter-next').dispatchEvent('change');
    await expect(page.locator('#counter-preview')).toHaveText('次に印刷される番号: 042');
    await page.click('#print-settings-save');

    // デザインに書き込む処理
    const saved = await page.evaluate(async () => {
      // 保存ダイアログを経由せず、保存処理と同じ形のデータを書き込めるかだけ確かめる
      const s = await import('/storage.js');
      s.saveDesign('連番テスト', { elements: [], labelSize: { width: 40, height: 30 }, counter: { resume: true, next: 0 } });
      const ok = s.updateDesignCounter('連番テスト', { resume: true, next: 41 });
      const missing = s.updateDesignCounter('存在しない', { resume: true, next: 1 });
      return { ok, missing, design: s.loadDesign('連番テスト') };
    });
    expect(saved.ok).toBe(true);
    expect(saved.missing).toBe(false);
    expect(saved.design.counter).toEqual({ resume: true, next: 41 });
  });

  test('CSV のバッチ印刷でも、行の順に連番が振られる', async ({ page }) => {
    test.setTimeout(120_000);
    await addText(page, '{{Name}} #[[counter|pad=2]]');

    await page.click('#template-toolbar-btn');
    await page.click('#template-manage-data');
    await page.locator('#template-csv-input').setInputFiles(path.join(__dirname, 'fixtures', 'sample.csv'));
    await page.waitForTimeout(500);

    await resetDrawnTexts(page);
    await page.click('#template-print-btn');
    await expect(page.locator('#status-message')).toHaveText('Printed 3 labels!', { timeout: 90_000 });

    // 折り返しで別々に描かれることがあるので、つなげてから確かめる
    const drawn = (await getDrawnTexts(page)).join(' ');
    expect(drawn).toContain('Widget A #01');
    expect(drawn).toContain('Widget B #02');
    expect(drawn).toContain('Widget C #03');
  });
});
