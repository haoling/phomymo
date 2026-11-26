import { test, expect, Page } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { FakeDrive, installFakeGoogle, loginViaUI, waitForSynced, DRIVE_FILE_SCOPE } from './helpers/fake-google';
import { installFakePrinter, resetDrawnTexts, getDrawnTexts } from './helpers/fake-printer';

// Googleスプレッドシートからの差し込み(Google Picker + drive.file + Sheets API、すべて偽物)

async function openApp(page: Page, drive: FakeDrive) {
  await installFakeGoogle(page, drive);
  await installFakePrinter(page);
  await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
  await waitForAppReady(page);
  await dismissInfoDialog(page);
}

async function addText(page: Page, text: string) {
  await page.click('#add-text');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('#prop-text-content').fill(text);
  await page.locator('#prop-text-content').dispatchEvent('input');
  await page.waitForTimeout(200);
}

async function openPanel(page: Page) {
  await page.click('#template-toolbar-btn');
  await expect(page.locator('#template-panel')).not.toHaveClass(/\bhidden\b/);
}

async function saveAs(page: Page, name: string) {
  await page.click('#save-btn');
  await expect(page.locator('#save-dialog')).not.toHaveClass(/\bhidden\b/);
  await page.fill('#save-name', name);
  await page.click('#save-confirm');
}

function putBook(drive: FakeDrive, prices = ['100', '80', '250']) {
  drive.putSpreadsheet({
    id: 'sheet-abc',
    title: '商品リスト',
    sheets: [
      { sheetId: 0, title: 'メモ', values: [['覚え書き'], ['なし']] },
      { sheetId: 42, title: '在庫', values: [['名前', '価格'], ['りんご', prices[0]], ['みかん', prices[1]], ['ぶどう', prices[2]]] },
      { sheetId: 7, title: '隠し', hidden: true, values: [['x'], ['y']] },
    ],
  });
}

async function cellValues(page: Page, field: string) {
  return page.locator(`#template-data-body tr .template-field-input[data-field="${field}"]`)
    .evaluateAll((els: any[]) => els.map(e => e.value));
}

test.describe('Googleスプレッドシートから差し込む', () => {
  let drive: FakeDrive;

  test.beforeEach(async ({ page }) => {
    drive = new FakeDrive();
    putBook(drive);
    await openApp(page, drive);
  });

  test('ゲストモードではスプレッドシートのボタンを出さない', async ({ page }) => {
    await openPanel(page);
    await expect(page.locator('#template-panel-gsheet')).toHaveClass(/\bhidden\b/);
    await page.click('#template-manage-data');
    await expect(page.locator('#template-gsheet-btn')).toHaveClass(/\bhidden\b/);
  });

  test('ログイン中は Picker で選んだシートを読み込み、使うときだけ drive.file を求める', async ({ page }) => {
    await loginViaUI(page);
    // ログインのときは drive.appdata だけ(追加のスコープは求めない)
    let reqs = await page.evaluate(() => (window as any).__fakeGis.requests);
    expect(reqs.every((r: any) => !r.scope)).toBe(true);

    await addText(page, '{{名前}} {{価格}}円');
    await openPanel(page);
    await expect(page.locator('#template-panel-gsheet')).toBeVisible();

    await page.evaluate(() => { (window as any).__fakePicker.next = { id: 'sheet-abc', name: '商品リスト' }; });
    await resetDrawnTexts(page);
    await page.click('#template-panel-gsheet');

    await expect(page.locator('#gsheet-link')).toBeVisible();
    await expect(page.locator('#gsheet-link-name')).toHaveText('商品リスト');
    // 差し込み項目と合う列があるシートを選ぶ(非表示のシートは読まない)
    await expect(page.locator('#gsheet-link-sheet')).toHaveText('シート: 在庫');
    await expect(page.locator('#gsheet-link-name')).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/sheet-abc/edit#gid=42');
    await expect(page.locator('#template-data-count')).toHaveText('3');
    await expect(page.locator('#status-message')).toHaveText('「商品リスト」の「在庫」から 3 件を読み込みました');
    await expect(page.locator('#template-panel-gsheet')).toHaveClass(/\bhidden\b/);
    await page.locator('#merge-preview-toggle').check();
    await expect.poll(async () => (await getDrawnTexts(page)).join(' ')).toContain('りんご 100円');

    reqs = await page.evaluate(() => (window as any).__fakeGis.requests);
    const scoped = reqs.filter((r: any) => r.scope);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toMatchObject({ scope: DRIVE_FILE_SCOPE, include_granted_scopes: true, prompt: '', hint: 'hao@example.com' });
    const shown = await page.evaluate(() => (window as any).__fakePicker.shown);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ views: ['spreadsheets'], appId: '47606521143', locale: 'ja' });
    expect(drive.sheetsRequests.some(r => r.includes("ranges='隠し'"))).toBe(false);

    // データ画面: シートを選び直すと連携のシートも変わる
    await page.click('#template-manage-data');
    await expect(page.locator('#template-gsheet-info')).toHaveText('Googleスプレッドシート: 商品リスト');
    await page.selectOption('#template-sheet-select', '0');
    await expect(page.locator('#gsheet-link-sheet')).toHaveText('シート: メモ');
    await page.selectOption('#template-sheet-select', '1');
    await page.click('#template-data-close');

    // 2回目は許可済みなので、ポップアップ無しで Picker を開く
    await page.evaluate(() => { (window as any).__fakePicker.next = null; });
    await page.click('#gsheet-repick');
    await expect.poll(() => page.evaluate(() => (window as any).__fakePicker.shown.length)).toBe(2);
    reqs = await page.evaluate(() => (window as any).__fakeGis.requests);
    expect(reqs.filter((r: any) => r.scope)).toHaveLength(1);
    // 取り消したら今の連携のまま
    await expect(page.locator('#gsheet-link-name')).toHaveText('商品リスト');
  });

  test('保存するとデザインに連携を残し、開き直すと同じシートの最新を読み込む(印刷する行も)', async ({ page }) => {
    await loginViaUI(page);
    await addText(page, '{{名前}}');
    await openPanel(page);
    await page.evaluate(() => { (window as any).__fakePicker.next = { id: 'sheet-abc', name: '商品リスト' }; });
    await page.click('#template-panel-gsheet');
    await expect(page.locator('#template-data-count')).toHaveText('3');
    await page.locator('#merge-range-input').fill('2-3');
    await page.locator('#merge-range-input').press('Enter');
    await expect(page.locator('#template-print-count')).toHaveText('2');

    await saveAs(page, '在庫ラベル');
    await expect.poll(() => drive.designFiles().length).toBe(1);
    await waitForSynced(page);
    const saved = drive.designContents()[0].design;
    expect(saved.mergeSource).toEqual({
      type: 'gsheet', spreadsheetId: 'sheet-abc', name: '商品リスト', sheetId: 42, sheetName: '在庫', rowRange: '2-3',
    });

    // シートを書き換えておく(行が1つ増え、値も変わる)
    drive.putSpreadsheet({
      id: 'sheet-abc',
      title: '商品リスト',
      sheets: [
        { sheetId: 0, title: 'メモ', values: [['覚え書き'], ['なし']] },
        { sheetId: 42, title: '在庫', values: [['名前', '価格'], ['りんご', '1'], ['なし', '2'], ['ぶどう', '3'], ['もも', '4']] },
      ],
    });

    await page.reload({ waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    // 「開く」のクリックのついでにトークンを無言で取り直す(前に許可した drive.file も入る)
    await page.click('#load-btn');
    await waitForSynced(page);
    await page.locator('#design-list .design-item[data-name="在庫ラベル"]').click();
    if (await page.locator('#template-panel').evaluate(el => el.classList.contains('hidden'))) await openPanel(page);
    await expect(page.locator('#gsheet-link')).toBeVisible();
    await expect(page.locator('#gsheet-link-name')).toHaveText('商品リスト');
    await expect(page.locator('#template-data-count')).toHaveText('4');
    await expect(page.locator('#gsheet-link-status')).toContainText('に読み込みました');
    await expect(page.locator('#template-print-count')).toHaveText('2');
    await page.click('#template-manage-data');
    expect(await cellValues(page, '名前')).toEqual(['りんご', 'なし', 'ぶどう', 'もも']);
    await expect(page.locator('#template-range-input')).toHaveValue('2-3');
  });

  test('読めなくなったシートは、保存したときのデータのまま知らせる', async ({ page }) => {
    await loginViaUI(page);
    await addText(page, '{{名前}}');
    await openPanel(page);
    await page.evaluate(() => { (window as any).__fakePicker.next = { id: 'sheet-abc', name: '商品リスト' }; });
    await page.click('#template-panel-gsheet');
    await expect(page.locator('#template-data-count')).toHaveText('3');

    drive.spreadsheets.delete('sheet-abc');
    await page.click('#gsheet-reload');
    await expect(page.locator('#status-message')).toContainText('スプレッドシートが見つかりません');
    await expect(page.locator('#template-data-count')).toHaveText('3');
    await expect(page.locator('#gsheet-link')).toBeVisible();
    await expect(page.locator('#gsheet-reload')).toBeEnabled();
  });

  test('許可を外されたら読み込まずに知らせる', async ({ page }) => {
    await loginViaUI(page);
    await openPanel(page);
    await page.evaluate(() => {
      (window as any).__fakeGis.denyScope = true;
      (window as any).__fakePicker.next = { id: 'sheet-abc', name: '商品リスト' };
    });
    await page.click('#template-panel-gsheet');
    await expect(page.locator('#status-message')).toHaveText('スプレッドシートを読む許可がもらえませんでした');
    await expect(page.locator('#gsheet-link')).toHaveClass(/\bhidden\b/);
    expect(await page.evaluate(() => (window as any).__fakePicker.shown.length)).toBe(0);
  });

  test('連携をやめる・ほかの表を読み込むと連携が外れ、保存にも残らない', async ({ page }) => {
    await loginViaUI(page);
    await addText(page, '{{名前}}');
    await openPanel(page);
    await page.evaluate(() => { (window as any).__fakePicker.next = { id: 'sheet-abc', name: '商品リスト' }; });
    await page.click('#template-panel-gsheet');
    await expect(page.locator('#gsheet-link')).toBeVisible();

    await page.click('#gsheet-unlink');
    await expect(page.locator('#gsheet-link')).toHaveClass(/\bhidden\b/);
    await expect(page.locator('#template-data-count')).toHaveText('3'); // データは残す
    await expect(page.locator('#template-panel-gsheet')).toBeVisible();

    await page.click('#template-panel-gsheet');
    await expect(page.locator('#gsheet-link')).toBeVisible();
    await page.click('#template-manage-data');
    await page.click('#template-paste-btn');
    await page.locator('#template-paste-text').fill('名前\nA\nB\n');
    await page.click('#template-paste-apply');
    await expect(page.locator('#gsheet-link')).toHaveClass(/\bhidden\b/);
    await expect(page.locator('#template-gsheet-info')).toHaveClass(/\bhidden\b/);
    await page.click('#template-data-close');

    await saveAs(page, '貼り付け');
    await expect.poll(() => drive.designFiles().length).toBe(1);
    await waitForSynced(page);
    expect(drive.designContents()[0].design.mergeSource).toBeUndefined();
  });

  test('英語表示でも連携の文言が英語になる', async ({ page }) => {
    await loginViaUI(page);
    await page.selectOption('#lang-select', 'en');
    await page.waitForTimeout(300);
    await addText(page, '{{名前}}');
    await openPanel(page);
    await expect(page.locator('#template-panel-gsheet')).toHaveText('From Google Sheets');
    await page.evaluate(() => { (window as any).__fakePicker.next = { id: 'sheet-abc', name: '商品リスト' }; });
    await page.click('#template-panel-gsheet');
    await expect(page.locator('#gsheet-link-sheet')).toHaveText('Sheet: 在庫');
    await expect(page.locator('#status-message')).toHaveText('Imported 3 rows from "在庫" in "商品リスト"');
    const shown = await page.evaluate(() => (window as any).__fakePicker.shown);
    expect(shown[0].locale).toBe('en');
  });
});
