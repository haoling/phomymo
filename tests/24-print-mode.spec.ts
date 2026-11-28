import { test, expect, Page } from '@playwright/test';
import { waitForAppReady as waitForEditorReady, dismissInfoDialog } from './helpers/app';
import { installFakePrinter, resetDrawnTexts, getDrawnTexts } from './helpers/fake-printer';
import { FakeDrive, installFakeGoogle, loginViaUI } from './helpers/fake-google';

// 印刷専用モード: 編集はせず、デザインを開く・変数を変える・印刷するだけの画面(スマホ向け)

const MOBILE = { width: 390, height: 844 };

async function addText(page: Page, text: string) {
  await page.click('#add-text');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('#prop-text-content').fill(text);
  await page.locator('#prop-text-content').dispatchEvent('input');
  await page.waitForTimeout(200);
}

/** 印刷モードでは編集のキャンバスが隠れるので、表示を待たずに起動を待つ */
async function waitForAppReady(page: Page) {
  await page.waitForSelector('#preview-canvas', { state: 'attached', timeout: 10_000 });
  await page.waitForFunction(() => {
    const select = document.querySelector('#printer-model') as HTMLSelectElement;
    return select && select.options.length > 1;
  }, null, { timeout: 10_000 });
  await page.waitForTimeout(500);
}

/** 変数(文字)と連番を1つずつ持つデザインを作って保存する */
async function saveDesignWithVariables(page: Page, name: string) {
  await addText(page, '{{品名}} No.{{番号}}');
  await page.click('#template-toolbar-btn');
  await page.click('#variables-add');
  let row = page.locator('#variables-list .variable-row').last();
  await row.locator('.variable-name').fill('品名');
  await row.locator('.variable-value').fill('りんご');
  await page.click('#variables-add-counter');
  row = page.locator('#variables-list .variable-row').last();
  await row.locator('.variable-name').fill('番号');
  await row.locator('.variable-counter[data-key="pad"]').fill('3');
  await page.click('#save-btn');
  await page.fill('#save-name', name);
  await page.click('#save-confirm');
  await expect(page.locator('#save-dialog')).toHaveClass(/\bhidden\b/);
}

/** 印刷モードの印刷ボタンを押して、終わるまで待つ */
async function printModePrintAndWait(page: Page) {
  await page.click('#print-mode-print');
  await page.waitForFunction(() => {
    const btn = document.querySelector('#print-mode-print') as HTMLButtonElement;
    const label = document.querySelector('#print-mode-print-label');
    return btn && !btn.disabled && !label?.textContent?.includes('印刷中');
  }, null, { timeout: 90_000, polling: 200 });
}

test.describe('印刷モード(関数)', () => {
  test('入り方: ?mode=print > 覚えた画面 > スマホの既定', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const out = await page.evaluate(async () => {
      const m = await import('/print-mode.js');
      const d = m.decideInitialPrintMode;
      return {
        param: d({ search: '?mode=print', saved: 'edit' }),
        editParam: d({ search: '?mode=edit', saved: 'print' }),
        saved: d({ saved: 'print' }),
        nothing: d({}),
        mobileDefault: d({ isMobile: true }),
        url: m.urlForPrintMode('http://x/?a=1', true),
        urlOff: m.urlForPrintMode('http://x/?a=1&mode=print', false),
      };
    });
    expect(out).toEqual({
      param: true,
      editParam: false,
      saved: true,
      nothing: false,
      mobileDefault: false, // 仮決め: スマホでも最初は編集画面
      url: 'http://x/?a=1&mode=print',
      urlOff: 'http://x/?a=1',
    });
  });
});

test.describe('印刷モード', () => {
  test('?mode=print で開くと、編集の画面は出ず、デザインを選ぶよう案内する', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/?mode=print', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    await expect(page.locator('#print-mode-view')).toBeVisible();
    await expect(page.locator('#print-mode-empty')).toBeVisible();
    await expect(page.locator('#print-mode-print')).toBeDisabled();
    await expect(page.locator('#mobile-toolbar')).toBeHidden();
    await expect(page.locator('#mobile-header')).toBeHidden();
    await expect(page.locator('#preview-canvas')).toBeHidden();

    // 「編集する」で編集画面に戻り、URL から ?mode=print が外れる
    await page.click('#print-mode-exit');
    await expect(page.locator('#print-mode-view')).toBeHidden();
    await expect(page.locator('#mobile-toolbar')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('mode')).toBeNull();
  });

  test('保存したデザインを開き、変数と次の番号を変えて印刷できる', async ({ page }) => {
    test.setTimeout(150_000);
    await installFakePrinter(page);
    await installFakeGoogle(page, new FakeDrive());
    await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
    await waitForEditorReady(page);
    await dismissInfoDialog(page);
    await loginViaUI(page);
    await saveDesignWithVariables(page, '値札');

    // スマホの幅にして、メニューから印刷モードへ
    await page.setViewportSize(MOBILE);
    await page.locator('#mobile-menu-btn').dispatchEvent('click'); // 幅を変えた直後は下の帯が重なることがあるので、直接押す
    await page.locator('#mobile-print-mode-btn').dispatchEvent('click');
    await expect(page.locator('#print-mode-view')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('mode')).toBe('print');

    // 開いていたデザインがそのまま出ている
    await expect(page.locator('#print-mode-design-name')).toHaveText('値札');
    await expect(page.locator('#print-mode-canvas')).toBeVisible();
    const input = page.locator('#print-mode-variables .print-mode-variable');
    await expect(input).toHaveCount(1); // 連番は「次に印刷する番号」の欄になる
    await expect(input).toHaveValue('りんご');
    await expect(page.locator('#print-mode-counter-row')).toBeVisible();
    await expect(page.locator('#print-mode-counter-next')).toHaveValue('1');

    // 値を変えるとプレビューに映る
    await resetDrawnTexts(page);
    await input.fill('みかん');
    await expect.poll(async () => (await getDrawnTexts(page)).join(' ')).toContain('みかん No.001');

    // 次の番号と部数を決めて印刷
    await page.locator('#print-mode-counter-next').fill('10');
    await page.locator('#print-mode-counter-next').dispatchEvent('change');
    await page.click('#print-mode-copies-plus');
    await expect(page.locator('#print-mode-copies')).toHaveValue('2');
    await expect(page.locator('#print-mode-print-label')).toHaveText('印刷 (2部)');

    await resetDrawnTexts(page);
    await printModePrintAndWait(page);
    // 文字は枠の幅で折り返して描かれるので、つなげて確かめる
    const drawn = (await getDrawnTexts(page)).join(' ');
    expect(drawn).toContain('みかん No.010');
    expect(drawn).toContain('みかん No.011');
    await expect(page.locator('#print-mode-counter-next')).toHaveValue('12');
    await expect(page.locator('#print-mode-connection')).toContainText('M110');

    // 編集のショートカットは効かない(Delete で消えない)
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    await expect(page.locator('#print-mode-canvas')).toBeVisible();
    await expect(page.locator('#print-mode-empty')).toBeHidden();

    // 編集画面に戻ると、変えた値が変数欄に入っている
    await page.click('#print-mode-exit');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('#variables-list .variable-value')).toHaveValue('みかん');
  });

  test('最後に使った画面を覚えていて、次に開いたときもその画面になる', async ({ page }) => {
    await installFakeGoogle(page, new FakeDrive());
    await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
    await waitForEditorReady(page);
    await dismissInfoDialog(page);
    await loginViaUI(page);
    await page.setViewportSize(MOBILE);

    await page.locator('#mobile-menu-btn').dispatchEvent('click'); // 幅を変えた直後は下の帯が重なることがあるので、直接押す
    await page.locator('#mobile-print-mode-btn').dispatchEvent('click');
    await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await expect(page.locator('#print-mode-view')).toBeVisible();

    // 「デザインを選ぶ」で読み込みダイアログが前に出る
    await page.click('#print-mode-load');
    await expect(page.locator('#load-dialog')).toBeVisible();
    await page.click('#load-cancel');

    await page.click('#print-mode-exit');
    await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await expect(page.locator('#print-mode-view')).toBeHidden();
  });

  test('英語表示でも印刷モードに日本語が残らない', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/?mode=print', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    await page.evaluate(async () => (await import('/i18n.js')).setLang('en'));
    const text = await page.locator('#print-mode-view').innerText();
    expect(text).toContain('Print mode');
    expect(text).not.toMatch(/[぀-ヿ一-鿿]/);
  });
});
