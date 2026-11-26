import { test, expect, Page } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { FakeDrive, installFakeGoogle, loginViaUI } from './helpers/fake-google';

// 保存済みのデザインを開いて編集中に保存するときは「上書き保存」と「別名で保存」を選べる

async function addText(page: Page, text: string) {
  await page.click('#add-text');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('#prop-text-content').fill(text);
  await page.locator('#prop-text-content').dispatchEvent('input');
  await page.waitForTimeout(200);
}

async function editFirstText(page: Page, text: string) {
  await page.click('#elements-btn');
  await page.locator('#elements-list .element-list-item').first().click();
  await page.locator('#prop-text-content').fill(text);
  await page.locator('#prop-text-content').dispatchEvent('input');
  await page.waitForTimeout(200);
}

async function openSaveDialog(page: Page) {
  await page.click('#save-btn');
  await expect(page.locator('#save-dialog')).not.toHaveClass(/\bhidden\b/);
}

async function openDesign(page: Page, name: string) {
  await page.click('#load-btn');
  await page.locator('#design-grid .design-card').filter({ hasText: name }).click();
  await expect(page.locator('#load-dialog')).toHaveClass(/\bhidden\b/);
}

async function storedTexts(page: Page) {
  return page.evaluate(async () => {
    const s = await import('/storage.js');
    const out: Record<string, string[]> = {};
    for (const d of s.listDesigns()) {
      const design = s.loadDesign(d.name);
      out[d.name] = (design?.elements || []).filter((e: any) => e.type === 'text').map((e: any) => e.text);
    }
    return out;
  });
}

test.describe('保存: 上書き保存と別名で保存', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeGoogle(page, new FakeDrive());
    await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    await loginViaUI(page);
  });

  test('新しいデザインは、従来どおり名前を付けて保存だけ', async ({ page }) => {
    await addText(page, 'はじめて');
    await openSaveDialog(page);
    await expect(page.locator('#save-overwrite-section')).toHaveClass(/\bhidden\b/);
    await expect(page.locator('#save-confirm')).toHaveText('保存');
    await page.fill('#save-name', '新しいの');
    await page.click('#save-confirm');
    await expect(page.locator('#save-dialog')).toHaveClass(/\bhidden\b/);
    expect(await storedTexts(page)).toEqual({ '新しいの': ['はじめて'] });
  });

  test('開いたデザインは、上書き保存すると同じデザインが書き換わる', async ({ page }) => {
    await addText(page, 'もと');
    await openSaveDialog(page);
    await page.fill('#save-name', '棚');
    await page.click('#save-confirm');

    // 新しい画面で開き直してから編集する
    await page.reload({ waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    await openDesign(page, '棚');
    await editFirstText(page, 'かえた');

    await openSaveDialog(page);
    await expect(page.locator('#save-overwrite-section')).not.toHaveClass(/\bhidden\b/);
    await expect(page.locator('#save-editing-note')).toHaveText('「棚」を編集中です。');
    await expect(page.locator('#save-overwrite')).toBeFocused();
    await expect(page.locator('#save-confirm')).toHaveText('別名で保存');
    await expect(page.locator('#save-name')).toHaveAttribute('placeholder', '棚 のコピー');

    await page.click('#save-overwrite');
    await expect(page.locator('#save-dialog')).toHaveClass(/\bhidden\b/);
    await expect(page.locator('#status-message')).toContainText('上書き保存しました');
    expect(await storedTexts(page)).toEqual({ '棚': ['かえた'] });
  });

  test('別名で保存すると、元のデザインは残って新しいデザインができる', async ({ page }) => {
    await addText(page, 'もと');
    await openSaveDialog(page);
    await page.fill('#save-name', '元');
    await page.click('#save-confirm');

    await editFirstText(page, 'べつ');
    await openSaveDialog(page);
    await page.fill('#save-name', '別の');
    await page.click('#save-confirm');
    await expect(page.locator('#save-dialog')).toHaveClass(/\bhidden\b/);
    expect(await storedTexts(page)).toEqual({ '元': ['もと'], '別の': ['べつ'] });

    // そのあとは新しいほうを編集中になる
    await openSaveDialog(page);
    await expect(page.locator('#save-editing-note')).toHaveText('「別の」を編集中です。');
  });

  test('別名にほかのデザインと同じ名前を入れると、一度確かめてから上書きする', async ({ page }) => {
    await addText(page, 'いち');
    await openSaveDialog(page);
    await page.fill('#save-name', 'A');
    await page.click('#save-confirm');
    await editFirstText(page, 'に');
    await openSaveDialog(page);
    await page.fill('#save-name', 'B');
    await page.click('#save-confirm');

    // B を編集中に、別名として A を入れる
    await editFirstText(page, 'さん');
    await openSaveDialog(page);
    await page.fill('#save-name', 'A');
    await page.click('#save-confirm');
    await expect(page.locator('#save-dialog')).not.toHaveClass(/\bhidden\b/);
    await expect(page.locator('#save-name-exists')).toContainText('「A」はすでにあります');
    await expect(page.locator('#save-confirm')).toHaveText('上書きする');
    expect((await storedTexts(page))['A']).toEqual(['いち']);

    // 名前を変えると確認は取り消される
    await page.fill('#save-name', 'C');
    await expect(page.locator('#save-name-exists')).toHaveClass(/\bhidden\b/);
    await expect(page.locator('#save-confirm')).toHaveText('別名で保存');

    await page.fill('#save-name', 'A');
    await page.click('#save-confirm');
    await page.click('#save-confirm');
    await expect(page.locator('#save-dialog')).toHaveClass(/\bhidden\b/);
    expect(await storedTexts(page)).toEqual({ 'A': ['さん'], 'B': ['に'] });
  });

  test('ファイルから読み込んだデザインには上書き保存を出さない', async ({ page }) => {
    const json = JSON.stringify({
      name: '読み込み',
      elements: [{ id: 'e1', type: 'text', text: 'file', x: 5, y: 5, width: 20, height: 8, rotation: 0, fontSize: 12 }],
      labelSize: { width: 40, height: 30 },
    });
    await page.click('#load-btn');
    await page.locator('#import-file-input').setInputFiles({ name: 'd.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await expect(page.locator('#status-message')).toContainText('読み込み');
    await openSaveDialog(page);
    await expect(page.locator('#save-overwrite-section')).toHaveClass(/\bhidden\b/);
    await expect(page.locator('#save-confirm')).toHaveText('保存');
  });
});
