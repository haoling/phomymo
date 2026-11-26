import { test, expect, Page } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

// 表示言語(日本語 / English)の切り替え

const JA = /[ぁ-んァ-ヶ一-龠々]/;
// 英語表示でも日本語のままでよいもの(言語の選択肢・日本語フォントの名前・利用者が入れた文字)
const JA_ALLOWED = ['日本語', '表示言語 / Language', '[[date|YYYY年M月D日]]'];

/** 見えている文字と title / placeholder / aria-label のうち、日本語を含むものを集める */
async function visibleJapanese(page: Page, rootSelector = 'body') {
  return page.evaluate(({ rootSelector, allowed }) => {
    const ja = /[ぁ-んァ-ヶ一-龠々]/;
    const root = document.querySelector(rootSelector)!;
    const out: string[] = [];
    const visible = (el: Element) => (el as HTMLElement).checkVisibility?.({ checkOpacity: false, checkVisibilityCSS: true }) ?? true;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const text = (n.textContent || '').trim();
      const parent = n.parentElement;
      if (!text || !parent || !ja.test(text)) continue;
      if (parent.closest('script, style, textarea, select.lang-select, #prop-font-family, #mobile-prop-fontFamily')) continue;
      if (!visible(parent)) continue;
      if (allowed.includes(text)) continue;
      out.push(text);
    }
    root.querySelectorAll('[title], [placeholder], [aria-label]').forEach(el => {
      if (!visible(el)) return;
      for (const a of ['title', 'placeholder', 'aria-label']) {
        const v = el.getAttribute(a);
        if (v && ja.test(v) && !allowed.includes(v)) out.push(`@${a}: ${v}`);
      }
    });
    return [...new Set(out)];
  }, { rootSelector, allowed: JA_ALLOWED });
}

async function setLang(page: Page, lang: 'ja' | 'en') {
  await page.selectOption('#lang-select', lang);
  await page.waitForTimeout(200);
}

test.describe('表示言語', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('ブラウザが日本語なら、最初から日本語で表示する', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page.locator('#lang-select')).toHaveValue('ja');
    await expect(page.locator('#print-btn')).toHaveText('印刷');
    await expect(page.locator('#connect-btn')).toHaveText('接続');
    await expect(page.locator('#add-text')).toHaveAttribute('title', 'テキストを追加');
  });

  test('English に切り替えると、メイン画面に日本語が残らない', async ({ page }) => {
    await setLang(page, 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#print-btn')).toHaveText('Print');
    await expect(page.locator('#connect-btn')).toHaveText('Connect');
    await expect(page.locator('#add-text')).toHaveAttribute('title', 'Add Text');
    await expect(page.locator('#status-message')).toHaveText('Ready');
    expect(await visibleJapanese(page)).toEqual([]);
  });

  test('English: 印刷設定・プロパティ・素材・アカウントのダイアログ', async ({ page }) => {
    await setLang(page, 'en');

    await page.click('#print-settings-btn');
    await expect(page.locator('#print-settings-dialog')).toBeVisible();
    expect(await visibleJapanese(page, '#print-settings-dialog')).toEqual([]);
    await page.click('#print-settings-close');
    await page.waitForTimeout(200);

    // テキスト要素のプロパティ
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    expect(await visibleJapanese(page, '#props-panel')).toEqual([]);

    // 素材パネル
    await page.click('#add-asset');
    await expect(page.locator('#assets-dialog')).toBeVisible();
    await expect(page.locator('#assets-title')).toHaveText('Assets');
    expect(await visibleJapanese(page, '#assets-dialog')).toEqual([]);
    await page.click('#assets-close');

    // アカウント(ゲスト)
    await page.click('#account-btn');
    await expect(page.locator('#account-dialog')).toBeVisible();
    expect(await visibleJapanese(page, '#account-dialog')).toEqual([]);
    await expect(page.locator('#account-label')).toHaveText('Guest');
  });

  test('日本語に戻すと、JS が書いた文言も日本語に戻る', async ({ page }) => {
    await setLang(page, 'en');
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.click('#elements-btn');
    await expect(page.locator('#elements-list')).toContainText('New Text');

    await setLang(page, 'ja');
    await expect(page.locator('#print-btn')).toHaveText('印刷');
    await expect(page.locator('#add-text')).toHaveAttribute('title', 'テキストを追加');
    await expect(page.locator('#account-label')).toHaveText('ゲスト');
    await expect(page.locator('#props-panel h2')).toHaveText('プロパティ');
    // 文字そのもの(利用者のデータ)は訳さない
    await expect(page.locator('#elements-list')).toContainText('New Text');
  });

  test('ゲストモードでは言語の設定も保存しない(localStorage を使わない)', async ({ page }) => {
    await setLang(page, 'en');
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).toEqual([]);
  });
});

test.describe('ブラウザが英語のとき', () => {
  test.use({ locale: 'en-US' });

  test('最初から English で表示する', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#lang-select')).toHaveValue('en');
    await expect(page.locator('#print-btn')).toHaveText('Print');
    expect(await visibleJapanese(page)).toEqual([]);
  });
});

void JA;
