import { test, expect, Page } from '@playwright/test';
import path from 'path';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { installFakePrinter, resetDrawnTexts, getDrawnTexts } from './helpers/fake-printer';

// 表(CSV・Excel・貼り付け)からの差し込み印刷: 行を選んでプレビュー、行の範囲を指定して連続印刷

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

async function openDataDialog(page: Page) {
  await page.click('#template-toolbar-btn');
  await page.click('#template-manage-data');
  await expect(page.locator('#template-data-dialog')).toBeVisible();
}

test.describe('表の読み込み(関数)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
  });

  test('CSV/TSV: 引用符・改行・見出しの重複と空欄', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const s = await import('/spreadsheet.js');
      return {
        csv: s.parseDelimitedTable('名前,メモ\n"a, b","1行目\n2行目"\n\nc,"say ""hi"""\n'),
        tsv: s.parseDelimitedTable('名前\t価格\nりんご\t100\n'),
        dup: s.parseDelimitedTable('名前,名前,,{x}\n1,2,3,4').headers,
        letters: [0, 25, 26, 701].map(s.columnLetter),
        missing: s.findMissingFields(['Name', '価格', 'なし'], ['name', '価格 ']),
      };
    });
    expect(out.csv.headers).toEqual(['名前', 'メモ']);
    expect(out.csv.records).toEqual([
      { 名前: 'a, b', メモ: '1行目\n2行目' },
      { 名前: 'c', メモ: 'say "hi"' },
    ]);
    expect(out.tsv.records).toEqual([{ 名前: 'りんご', 価格: '100' }]);
    expect(out.dup).toEqual(['名前', '名前 (2)', 'C', 'x']);
    expect(out.letters).toEqual(['A', 'Z', 'AA', 'ZZ']);
    expect(out.missing).toEqual(['なし']);
  });

  test('行の範囲: 読み取りと書き出し', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const s = await import('/spreadsheet.js');
      return {
        basic: s.parseRowRange('1-3, 5', 10).indices,
        open: s.parseRowRange('8-', 10).indices,
        head: s.parseRowRange('-2', 10).indices,
        zenkaku: s.parseRowRange('２〜４、９', 10).indices,
        reversed: s.parseRowRange('4-2', 10).indices,
        clamp: s.parseRowRange('9-20', 10).indices,
        empty: s.parseRowRange('', 3).indices,
        bad: s.parseRowRange('1-3, abc', 10).error,
        fmt: s.formatRowRange([0, 1, 2, 4, 7, 8], 10),
        fmtAll: s.formatRowRange([0, 1, 2], 3),
        fmtNone: s.formatRowRange([], 3),
      };
    });
    expect(out.basic).toEqual([0, 1, 2, 4]);
    expect(out.open).toEqual([7, 8, 9]);
    expect(out.head).toEqual([0, 1]);
    expect(out.zenkaku).toEqual([1, 2, 3, 8]);
    expect(out.reversed).toEqual([1, 2, 3]);
    expect(out.clamp).toEqual([8, 9]);
    expect(out.empty).toEqual([0, 1, 2]);
    expect(out.bad).toBe('abc');
    expect(out.fmt).toBe('1-3, 5, 8-9');
    expect(out.fmtAll).toBe('1-3');
    expect(out.fmtNone).toBe('');
  });

  test('表示形式(数値・日付)', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const s = await import('/spreadsheet.js');
      return [
        s.formatNumber(0.1 + 0.2, 'General'),
        s.formatNumber(1234567.891, '#,##0'),
        s.formatNumber(3.5, '0.00'),
        s.formatNumber(42, '00000'),
        s.formatNumber(0.125, '0.0%'),
        s.formatNumber(1200, '"¥"#,##0'),
        s.formatNumber(1200, '#,##0"円"'),
        s.formatNumber(46352, 'yyyy/m/d'),
        s.formatNumber(46352.5, 'yyyy/m/d h:mm'),
        s.formatNumber(0.75, 'h:mm'),
        s.formatNumber(46352, '[$-ja-JP]yyyy"年"m"月"d"日"'),
      ];
    });
    expect(out).toEqual([
      '0.3', '1,234,568', '3.50', '00042', '12.5%', '¥1,200', '1,200円',
      '2026/11/26', '2026/11/26 12:00', '18:00', '2026/11/26',
    ]);
  });
});

test.describe('表からの差し込み(画面)', () => {
  test.beforeEach(async ({ page }) => {
    await installFakePrinter(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('Excel (.xlsx) を読み込むと、シート・列・表示形式どおりの値が出る', async ({ page }) => {
    await addText(page, '{{名前}} {{価格}}円');
    await openDataDialog(page);
    await page.locator('#template-csv-input').setInputFiles(path.join(FIXTURES, 'merge-sample.xlsx'));

    await expect(page.locator('#template-data-body tr')).toHaveCount(4);
    await expect(page.locator('#template-sheet-row')).toBeVisible();
    await expect(page.locator('#template-sheet-select option')).toHaveCount(2);
    await expect(page.locator('#template-columns-list')).toHaveText('名前, 価格, 日付, コード, 割合');
    await expect(page.locator('#template-missing-fields')).toHaveClass(/\bhidden\b/);

    const firstRow = page.locator('#template-data-body tr').first().locator('.template-field-input');
    await expect(firstRow).toHaveCount(5); // デザインの2項目 + ほかの3列
    expect(await firstRow.evaluateAll((els: any[]) => els.map(e => e.value)))
      .toEqual(['りんご', '1,200', '2026/11/26', '00123', '25%']);

    // シートを切り替える
    await page.locator('#template-sheet-select').selectOption('1');
    await expect(page.locator('#template-data-body tr')).toHaveCount(1);
    await expect(page.locator('#template-columns-list')).toHaveText('見出し, 値');
    await expect(page.locator('#template-missing-fields')).toContainText('{{名前}}');
  });

  test('項目を書く前でも表を読み込めて、列を押すと {{列名}} が入る', async ({ page }) => {
    // 差し込み項目がなくても、ツールバーに入口がある
    await expect(page.locator('#template-toolbar-btn')).toBeVisible();
    await page.click('#template-toolbar-btn');
    await expect(page.locator('#template-panel')).not.toHaveClass(/\bhidden\b/);
    await expect(page.locator('#template-fields-hint')).not.toHaveClass(/\bhidden\b/);

    await page.locator('#template-csv-input').setInputFiles(path.join(FIXTURES, 'merge-sample.xlsx'));
    await expect(page.locator('.merge-column-chip')).toHaveCount(5);
    await expect(page.locator('#template-toolbar-label')).toHaveText('差し込み印刷 (4)');

    // 何も選んでいなければ、新しい文字として入る
    await resetDrawnTexts(page);
    await page.locator('.merge-column-chip[data-column="名前"]').click();
    await expect(page.locator('#prop-text-content')).toHaveValue('{{名前}}');
    await expect(page.locator('#merge-preview-toggle')).toBeChecked();
    await expect(page.locator('#status-message')).toHaveText('{{名前}} を入れました');
    expect((await getDrawnTexts(page)).join(' ')).toContain('りんご');

    // 文字を選んでいれば、その後ろに足す
    await page.locator('.merge-column-chip[data-column="価格"]').click();
    await expect(page.locator('#prop-text-content')).toHaveValue('{{名前}} {{価格}}');
    await expect(page.locator('#template-field-count')).toHaveText('2');
    await expect(page.locator('#template-fields-hint')).toHaveClass(/\bhidden\b/);
  });

  test('Shift_JIS の CSV も読める(Excel の「CSV」保存)', async ({ page }) => {
    await addText(page, '{{名前}}');
    await openDataDialog(page);
    await page.locator('#template-csv-input').setInputFiles(path.join(FIXTURES, 'merge-sjis.csv'));
    await expect(page.locator('#template-data-body tr')).toHaveCount(2);
    const names = await page.locator('#template-data-body tr .template-field-input[data-field="名前"]')
      .evaluateAll((els: any[]) => els.map(e => e.value));
    expect(names).toEqual(['山田, 太郎', '鈴木 花子']);
  });

  test('貼り付け(タブ区切り)で読み込める', async ({ page }) => {
    await addText(page, '{{Name}}');
    await openDataDialog(page);
    await page.click('#template-paste-btn');
    await page.locator('#template-paste-text').fill('name\tprice\nAlpha\t1\nBeta\t2\n');
    await page.click('#template-paste-apply');
    await expect(page.locator('#template-paste-area')).toHaveClass(/\bhidden\b/);
    await expect(page.locator('#template-data-body tr')).toHaveCount(2);
    // 見出しの大文字・小文字が違っても差し込める
    const v = await page.locator('#template-data-body tr').first()
      .locator('.template-field-input[data-field="Name"]').inputValue();
    expect(v).toBe('Alpha');
  });

  test('行を選ぶと、キャンバスにその行を差し込んで表示する', async ({ page }) => {
    await addText(page, '{{Name}}!');
    await openDataDialog(page);
    await page.locator('#template-csv-input').setInputFiles(path.join(FIXTURES, 'sample.csv'));
    await expect(page.locator('#template-data-body tr')).toHaveCount(3);

    await resetDrawnTexts(page);
    await page.locator('.template-preview-row[data-index="1"]').click();
    await expect(page.locator('.template-preview-row[data-index="1"]')).toHaveClass(/bg-purple-600/);
    let drawn = (await getDrawnTexts(page)).join(' ');
    expect(drawn).toContain('Widget B!');

    await page.click('#template-data-close');
    await expect(page.locator('#merge-controls')).toBeVisible();
    await expect(page.locator('#merge-preview-toggle')).toBeChecked();
    await expect(page.locator('#merge-row-input')).toHaveValue('2');
    await expect(page.locator('#merge-row-total')).toHaveText('/ 3');

    await resetDrawnTexts(page);
    await page.click('#merge-row-next');
    await expect(page.locator('#merge-row-input')).toHaveValue('3');
    drawn = (await getDrawnTexts(page)).join(' ');
    expect(drawn).toContain('Widget C!');

    // 行番号を直接入れる
    await page.locator('#merge-row-input').fill('1');
    await page.locator('#merge-row-input').dispatchEvent('change');
    await expect(page.locator('#merge-row-summary')).toHaveText('Widget A');

    // OFF にすると {{Name}} のまま
    await resetDrawnTexts(page);
    await page.locator('#merge-preview-toggle').uncheck();
    drawn = (await getDrawnTexts(page)).join(' ');
    expect(drawn).toContain('{{Name}}!');
    // 元のデザインは書き換わっていない
    await expect(page.locator('#prop-text-content')).toHaveValue('{{Name}}!');
  });

  test('行の範囲を指定すると、その行だけ順に印刷する', async ({ page }) => {
    test.setTimeout(120_000);
    await addText(page, '{{名前}} #[[counter|pad=2]]');
    await openDataDialog(page);
    await page.locator('#template-csv-input').setInputFiles(path.join(FIXTURES, 'merge-sample.xlsx'));
    await expect(page.locator('#template-data-body tr')).toHaveCount(4);
    await expect(page.locator('#template-range-input')).toHaveValue('1-4');

    await page.locator('#template-range-input').fill('2-3');
    await page.locator('#template-range-input').press('Enter');
    await expect(page.locator('#template-range-status')).toHaveText('2 / 4 行を印刷します');
    await expect(page.locator('.template-row-select:checked')).toHaveCount(2);
    await expect(page.locator('#template-print-btn')).toContainText('選んだ行を印刷 (2)');

    // パネルの範囲の欄もそろう
    await expect(page.locator('#merge-range-input')).toHaveValue('2-3');
    await expect(page.locator('#template-print-count')).toHaveText('2');

    // 読めない指定はエラーを出して、選択は変えない
    await page.locator('#template-range-input').fill('2-3, x');
    await page.locator('#template-range-input').dispatchEvent('change');
    await expect(page.locator('#template-range-status')).toHaveText('「x」は行の指定として読めません');
    await expect(page.locator('.template-row-select:checked')).toHaveCount(2);

    await resetDrawnTexts(page);
    await page.click('#template-print-btn');
    await expect(page.locator('#status-message')).toHaveText('2 枚印刷しました!', { timeout: 90_000 });
    const drawn = (await getDrawnTexts(page)).join(' ');
    expect(drawn).toContain('みかん #01');
    expect(drawn).toContain('ぶどう #02');
    expect(drawn).not.toContain('りんご');
    expect(drawn).not.toContain('メロン');
  });

  test('1行も選んでいなければ印刷しない', async ({ page }) => {
    await addText(page, '{{Name}}');
    await openDataDialog(page);
    await page.locator('#template-csv-input').setInputFiles(path.join(FIXTURES, 'sample.csv'));
    await page.locator('#template-select-all').uncheck();
    await expect(page.locator('.template-row-select:checked')).toHaveCount(0);
    await resetDrawnTexts(page);
    await page.click('#template-print-btn');
    await expect(page.locator('#toast-container')).toContainText('印刷するデータが選ばれていません');
    expect((await getDrawnTexts(page)).join(' ')).not.toContain('Widget');
  });

  test('英語表示でも新しい文言が英語になる', async ({ page }) => {
    await page.selectOption('#lang-select', 'en');
    await page.waitForTimeout(300);
    await addText(page, '{{Name}}');
    await openDataDialog(page);
    await page.locator('#template-csv-input').setInputFiles(path.join(FIXTURES, 'sample.csv'));
    await page.locator('#template-range-input').fill('1');
    await page.locator('#template-range-input').press('Enter');
    await expect(page.locator('#template-range-status')).toHaveText('1 of 3 rows will print');
    await expect(page.locator('#template-print-btn')).toContainText('Print selected (1)');
  });
});
