import { test, expect, Page } from '@playwright/test';
import path from 'path';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { installFakePrinter, resetDrawnTexts, getDrawnTexts, printAndWait, setCopies } from './helpers/fake-printer';
import { FakeDrive, installFakeGoogle, loginViaUI } from './helpers/fake-google';

// デザインの変数: 名前と値を決めておき、文字・バーコード・QRに {{変数名}} で入れる

const FIXTURES = path.join(__dirname, 'fixtures');

async function addText(page: Page, text: string) {
  await page.click('#add-text');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('#prop-text-content').fill(text);
  await page.locator('#prop-text-content').dispatchEvent('input');
  await page.waitForTimeout(200);
}

/** 変数の欄を開いて、名前と値の組を足す */
async function addVariable(page: Page, name: string, value: string) {
  if (await page.locator('#template-panel').evaluate(el => el.classList.contains('hidden'))) {
    await page.click('#template-toolbar-btn');
  }
  await page.click('#variables-add');
  const row = page.locator('#variables-list .variable-row').last();
  await row.locator('.variable-name').fill(name);
  await row.locator('.variable-value').fill(value);
}

/** QRCode.toCanvas に渡された文字を記録する(CDN が読めないときは代わりを置く) */
async function recordQrData(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__qrData = [];
    if (!w.QRCode) w.QRCode = { toCanvas() {} };
    const orig = w.QRCode.toCanvas;
    w.QRCode.toCanvas = function (canvas: any, data: string, ...rest: any[]) {
      w.__qrData.push(data);
      return orig.call(this, canvas, data, ...rest);
    };
  });
}

test.describe('変数(関数)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
  });

  test('値の組み立て: 表の値が優先、値の中の {{…}} も置き換える', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const s = await import('/templates.js');
      const vars = [
        { name: ' 品名 ', value: 'りんご' },
        { name: '品名', value: '重複(使わない)' },
        { name: '', value: '名前なし' },
        { name: 'URL', value: 'https://example.com/{{品名}}?lot={{ロット}}' },
        { name: 'ロット', value: 'A1' },
        { name: '店', value: '既定の店' },
        { name: 'ループ', value: '{{ループ}}x' },
      ];
      return {
        normalized: s.normalizeVariables(vars).map((v: any) => v.name),
        plain: s.buildFieldValues(vars),
        withRecord: s.buildFieldValues(vars, { '店 ': '表の店', 'ロット': 'B2' }),
        applied: s.applyVariables([
          { type: 'text', text: '{{品名}} / {{ 店 }} / {{未定義}}' },
          { type: 'qr', qrData: '{{URL}}' },
          { type: 'barcode', barcodeData: 'X{{ロット}}' },
        ], vars),
        fields: s.fieldsWithoutVariables(['品名', 'url', '価格'], vars),
        none: s.applyVariables([{ type: 'text', text: '{{a}}' }], []),
      };
    });
    expect(out.normalized).toEqual(['品名', 'URL', 'ロット', '店', 'ループ']);
    expect(out.plain['URL']).toBe('https://example.com/りんご?lot=A1');
    expect(out.plain['ループ']).toMatch(/^\{\{ループ\}\}x+$/); // 自分を参照しても止まる
    expect(out.withRecord['店 ']).toBe('表の店');
    expect(out.withRecord['店']).toBeUndefined();
    expect(out.withRecord['URL']).toBe('https://example.com/りんご?lot=B2');
    expect(out.applied[0].text).toBe('りんご / 既定の店 / {{未定義}}');
    expect(out.applied[1].qrData).toBe('https://example.com/りんご?lot=A1');
    expect(out.applied[2].barcodeData).toBe('XA1');
    expect(out.fields).toEqual(['価格']);
    expect(out.none[0].text).toBe('{{a}}');
  });
});

test.describe('連番の変数', () => {
  test.beforeEach(async ({ page }) => {
    await installFakePrinter(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('関数: 連番の変数は [[連番]] の式になり、位置を渡すと番号になる', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const s = await import('/templates.js');
      const vars = [
        { name: '番号', type: 'counter', start: 10, step: 5, pad: '3' },
        { name: 'ラベル', value: 'No.{{番号}}' },
      ];
      return {
        token: s.buildFieldValues(vars)['番号'],
        nested: s.evaluateExpressions(s.applyVariables([{ type: 'text', text: '{{ラベル}}' }], vars), { counterIndex: 2 })[0].text,
        preview: s.buildFieldValues(vars, null, { counterIndex: 1 })['ラベル'],
        normalized: s.normalizeVariables([{ name: 'n', type: 'counter' }])[0],
      };
    });
    expect(out.token).toBe('[[counter|start=10,step=5,pad=3]]');
    expect(out.nested).toBe('No.020');
    expect(out.preview).toBe('No.015');
    expect(out.normalized).toEqual({ name: 'n', value: '', type: 'counter', start: 1, step: 1, pad: 0 });
  });

  test('「＋ 連番を追加」で作った変数は、1枚ごとに番号が進み、続きの設定も変数欄にある', async ({ page }) => {
    test.setTimeout(120_000);
    await addText(page, 'No.{{番号}}');
    await page.click('#template-toolbar-btn');
    await expect(page.locator('#counter-settings')).toHaveClass(/\bhidden\b/);

    await page.click('#variables-add-counter');
    const row = page.locator('#variables-list .variable-row').last();
    await expect(row.locator('.variable-type')).toHaveValue('counter');
    await row.locator('.variable-name').fill('番号');
    await row.locator('.variable-counter[data-key="pad"]').fill('3');
    await expect(row.locator('.variable-counter-preview')).toHaveText('→ 001, 002, 003…');

    // キャンバスには次に印刷する番号
    await resetDrawnTexts(page);
    await row.locator('.variable-counter[data-key="start"]').fill('1');
    expect((await getDrawnTexts(page)).join(' ')).toContain('No.001');

    // 連番の続きの欄が出る(印刷設定からは無くなった)
    await expect(page.locator('#counter-settings')).not.toHaveClass(/\bhidden\b/);
    await expect(page.locator('#counter-preview')).toHaveText('次に印刷される番号: 001');
    await expect(page.locator('#print-settings-dialog #counter-resume')).toHaveCount(0);
    await page.locator('#counter-resume').check();

    await setCopies(page, 2);
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
    await expect(page.locator('#counter-preview')).toHaveText('次に印刷される番号: 005');
    await expect(row.locator('.variable-counter-preview')).toHaveText('→ 005, 006, 007…');

    // 種類を文字に戻すと、ふつうの値の欄になる
    await row.locator('.variable-type').selectOption('text');
    await expect(page.locator('#variables-list .variable-row').last().locator('.variable-value')).toHaveCount(1);
    await expect(page.locator('#counter-settings')).toHaveClass(/\bhidden\b/);
  });
});

test.describe('変数(画面)', () => {
  test.beforeEach(async ({ page }) => {
    await installFakePrinter(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('文字に {{変数名}} を書くと、キャンバスと印刷に値が入る', async ({ page }) => {
    await addText(page, '{{品名}} {{価格}}円');
    await resetDrawnTexts(page);
    await addVariable(page, '品名', 'りんご');
    await addVariable(page, '価格', '120');
    await expect(page.locator('#variables-count')).toHaveText('2');

    // キャンバスには値が入って見える(要素の文字は {{…}} のまま)
    expect((await getDrawnTexts(page)).join(' ')).toContain('りんご 120円');
    await expect(page.locator('#prop-text-content')).toHaveValue('{{品名}} {{価格}}円');
    // 変数は表の列として探さない
    await expect(page.locator('#template-field-count')).toHaveText('0');

    // 値を変えるとすぐ反映される
    await page.locator('#variables-list .variable-row').first().locator('.variable-value').fill('みかん');
    expect((await getDrawnTexts(page)).join(' ')).toContain('みかん 120円');

    await resetDrawnTexts(page);
    await printAndWait(page);
    expect((await getDrawnTexts(page)).join(' ')).toContain('みかん 120円');
  });

  test('QRコードの内容にも変数が入る。差し込みのメニューから選べる', async ({ page }) => {
    await recordQrData(page);
    await addVariable(page, 'ID', 'abc-001');
    await page.click('#add-qr');
    await page.waitForTimeout(300);
    await page.locator('#prop-qr-data').fill('https://example.com/item/');
    await page.locator('#prop-qr-data').dispatchEvent('input');

    // 「{{項目}}」のメニューに変数が出て、押すと入る
    await page.locator('#prop-qr-data').evaluate((el: HTMLInputElement) => el.setSelectionRange(el.value.length, el.value.length));
    await page.click('#insert-field-qr');
    const option = page.locator('#field-list-qr .variable-option[data-field="ID"]');
    await expect(option).toContainText('abc-001');
    await option.click();
    await expect(page.locator('#prop-qr-data')).toHaveValue('https://example.com/item/{{ID}}');

    await expect.poll(async () => page.evaluate(() => (window as any).__qrData as string[]))
      .toContain('https://example.com/item/abc-001');
  });

  test('「＋」で選んでいる文字に {{変数名}} を足す。名前の重複を知らせる', async ({ page }) => {
    await addText(page, 'ロット:');
    await addVariable(page, 'ロット', 'L-9');
    await page.locator('#variables-list .variable-row').last().locator('.variable-insert').click();
    await expect(page.locator('#prop-text-content')).toHaveValue('ロット: {{ロット}}');
    await expect(page.locator('#status-message')).toHaveText('変数 {{ロット}} を入れました');

    await addVariable(page, 'ロット', '別の値');
    const error = page.locator('#variables-list .variable-error').last();
    await expect(error).not.toHaveClass(/\bhidden\b/);
    await expect(error).toContainText('同じ名前');
    await expect(page.locator('#variables-count')).toHaveText('1');

    // 消すと警告も消える
    await page.locator('#variables-list .variable-row').last().locator('.variable-delete').click();
    await expect(page.locator('#variables-list .variable-row')).toHaveCount(1);
  });

  test('表に同じ名前の列があれば表の値、無い名前は変数の値を使う', async ({ page }) => {
    await addText(page, '{{Name}} @ {{店}}');
    await addVariable(page, 'Name', '既定の名前');
    await addVariable(page, '店', '本店');
    await page.locator('#template-csv-input').setInputFiles(path.join(FIXTURES, 'sample.csv'));
    await expect(page.locator('#merge-controls')).not.toHaveClass(/\bhidden\b/);

    await resetDrawnTexts(page);
    await page.locator('#merge-preview-toggle').check();
    expect((await getDrawnTexts(page)).join(' ')).toContain('Widget A @ 本店');
  });
});

test.describe('変数(保存)', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeGoogle(page, new FakeDrive());
    await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    await loginViaUI(page);
  });

  test('変数はデザインといっしょに保存され、開き直すと戻る', async ({ page }) => {
    await addText(page, '{{品名}}');
    await addVariable(page, '品名', 'ぶどう');
    await page.click('#variables-add-counter');
    await page.locator('#variables-list .variable-row').last().locator('.variable-name').fill('番号');
    await page.locator('#variables-list .variable-row').last().locator('.variable-counter[data-key="pad"]').fill('2');
    await page.click('#save-btn');
    await page.fill('#save-name', '変数つき');
    await page.click('#save-confirm');
    await expect(page.locator('#save-dialog')).toHaveClass(/\bhidden\b/);

    const stored = await page.evaluate(async () => {
      const s = await import('/storage.js');
      return s.loadDesign('変数つき')?.variables;
    });
    expect(stored).toEqual([
      { name: '品名', value: 'ぶどう' },
      { name: '番号', value: '', type: 'counter', start: 1, step: 1, pad: 2 },
    ]);

    await page.reload({ waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    await expect(page.locator('#variables-list .variable-row')).toHaveCount(0);
    await page.click('#load-btn');
    await page.locator('#design-grid .design-card').filter({ hasText: '変数つき' }).click();
    await expect(page.locator('#load-dialog')).toHaveClass(/\bhidden\b/);

    await expect(page.locator('#variables-list .variable-row')).toHaveCount(2);
    await expect(page.locator('#variables-list .variable-value')).toHaveValue('ぶどう');
    await expect(page.locator('#variables-list .variable-row').last().locator('.variable-type')).toHaveValue('counter');
    await expect(page.locator('#variables-list .variable-row').last().locator('.variable-counter[data-key="pad"]')).toHaveValue('2');
    await expect(page.locator('#variables-count')).toHaveText('2');
  });
});
