import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { installFakePrinter, printAndWait } from './helpers/fake-printer';

// 3.4 ゲストモード: 未ログインのときは何も保存しない

async function addText(page: Page, text: string) {
  await page.click('#add-text');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('#prop-text-content').fill(text);
  await page.locator('#prop-text-content').dispatchEvent('input');
  await page.waitForTimeout(200);
}

/** ブラウザに残っているアプリのデータを全部調べる */
async function collectPersistedData(page: Page) {
  const inPage = await page.evaluate(async () => {
    const ls: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      ls[k] = localStorage.getItem(k)!;
    }
    const ss: Record<string, string> = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)!;
      ss[k] = sessionStorage.getItem(k)!;
    }
    const idb = indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : [];
    const caches_ = 'caches' in window ? await caches.keys() : [];
    return { localStorage: ls, sessionStorage: ss, indexedDB: idb, caches: caches_, cookie: document.cookie };
  });
  const cookies = await page.context().cookies('http://localhost:8081');
  return { ...inPage, cookies: cookies.map(c => c.name) };
}

test.describe('ゲストモード', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('起動するとゲストモードで、チップに「ゲスト」と出る', async ({ page }) => {
    await expect(page.locator('#account-btn')).toHaveAttribute('data-state', 'guest');
    await expect(page.locator('#account-label')).toHaveText('ゲスト');
  });

  test('保存ボタンを押すと「ログインすると保存できます」の案内が出る', async ({ page }) => {
    await page.click('#save-btn');
    await expect(page.locator('#account-dialog')).toBeVisible();
    await expect(page.locator('#account-reason')).toHaveText('ログインすると保存できます。');
    await expect(page.locator('#save-dialog')).toHaveClass(/\bhidden\b/);
    // クライアントIDが未設定なので、ログインボタンは押せず、その旨が出る
    await expect(page.locator('#account-login-btn')).toBeDisabled();
    await expect(page.locator('#account-login-unconfigured')).toBeVisible();
    await page.click('#account-close');
    await expect(page.locator('#account-dialog')).not.toBeVisible();
  });

  test('開くダイアログでは保存済みの一覧の代わりに案内が出て、ファイルからの読み込みは使える', async ({ page }) => {
    await page.click('#load-btn');
    await expect(page.locator('#load-guest-notice')).toBeVisible();
    await expect(page.locator('#import-file-btn')).toBeVisible();
  });

  test('デザインを作って印刷しても、ブラウザに何も残らない', async ({ page, context }) => {
    test.setTimeout(120_000);
    // 印刷のために偽プリンタを入れて開き直す
    await installFakePrinter(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);

    await addText(page, 'ゲストで印刷 [[counter|pad=3]]');
    // 印刷設定を変える(保存ボタンを押す = 今までなら localStorage に書いていた)
    await page.click('#print-settings-btn');
    await page.locator('#print-density').fill('5');
    await page.locator('#print-density').dispatchEvent('input');
    await page.click('#print-settings-save');
    await printAndWait(page);
    expect(await page.evaluate(() => (window as any).__fakePrinter.bytesWritten)).toBeGreaterThan(0);

    const data = await collectPersistedData(page);
    expect(data.localStorage).toEqual({});
    expect(data.sessionStorage).toEqual({});
    expect(data.indexedDB).toEqual([]);
    expect(data.caches).toEqual([]);
    expect(data.cookie).toBe('');
    expect(data.cookies).toEqual([]);
  });

  test('リロードすると初期状態に戻り、作業中ならタブを閉じる前に確認が出る', async ({ page }) => {
    await addText(page, '消えるテキスト');
    expect(await page.evaluate(async () => (await import('/kv.js')).isGuest())).toBe(true);

    const dialogs: string[] = [];
    page.on('dialog', async (d) => {
      dialogs.push(d.type());
      await d.accept();
    });
    await page.reload({ waitUntil: 'networkidle' });
    await waitForAppReady(page);
    expect(dialogs).toContain('beforeunload');

    // 要素は無くなっている
    await page.click('#elements-btn');
    const count = await page.evaluate(() => document.querySelectorAll('#elements-list .element-list-item').length);
    expect(count).toBe(0);
  });

  test('何も作っていなければ、離脱の確認は出ない', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (d) => {
      dialogs.push(d.type());
      await d.accept();
    });
    await page.click('#print-settings-btn'); // ユーザー操作だけはしておく
    await page.click('#print-settings-save');
    await page.reload({ waitUntil: 'networkidle' });
    expect(dialogs).toEqual([]);
  });
});

test('kv.js 以外で localStorage などを直接使っていない', () => {
  const root = path.join(__dirname, '..', 'src', 'web');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'docs') walk(p);
      } else if (e.name.endsWith('.js') || e.name.endsWith('.html')) {
        files.push(p);
      }
    }
  };
  walk(root);

  const forbidden = /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/;
  const offenders: string[] = [];
  for (const f of files) {
    if (path.basename(f) === 'kv.js') continue;
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').trim();
      if (code.startsWith('*') || code.startsWith('/*') || code.startsWith('<!--')) return; // コメント
      if (forbidden.test(code)) offenders.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(offenders).toEqual([]);
});
