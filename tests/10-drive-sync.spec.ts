import { test, expect, Page, Browser } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { FakeDrive, installFakeGoogle, loginViaUI, waitForSynced, TEST_USER } from './helpers/fake-google';

// 3.3 端末間の同期(#40)。Google と Drive は偽物(tests/helpers/fake-google.ts)

const PREFIX = `phomymo:${TEST_USER.permissionId}:`;

async function openApp(page: Page, drive: FakeDrive) {
  await installFakeGoogle(page, drive);
  await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
  await waitForAppReady(page);
  await dismissInfoDialog(page);
}

async function newDevice(browser: Browser, drive: FakeDrive) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await openApp(page, drive);
  return { ctx, page };
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

async function saveAs(page: Page, name: string) {
  await page.click('#save-btn');
  await expect(page.locator('#save-dialog')).not.toHaveClass(/\bhidden\b/);
  await page.fill('#save-name', name);
  await page.click('#save-confirm');
}

async function designNamesInLoadDialog(page: Page) {
  await page.click('#load-btn');
  const names = await page.locator('#design-list .design-item').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.name));
  await page.click('#load-cancel');
  return names;
}

async function syncNow(page: Page) {
  await page.click('#account-btn');
  await page.click('#account-sync-now');
  await waitForSynced(page);
  await page.click('#account-close');
}

async function localKeys(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)!);
    return out.sort();
  });
}

test.describe('Drive 同期', () => {
  let drive: FakeDrive;

  test.beforeEach(async ({ page }) => {
    drive = new FakeDrive();
    await openApp(page, drive);
  });

  test('ログインして保存すると、Drive に1デザイン1ファイルで置かれ、手元はアカウントごとのキーになる', async ({ page }) => {
    await expect(page.locator('#account-btn')).toHaveAttribute('data-state', 'guest');
    await loginViaUI(page);
    await expect(page.locator('#account-label')).toHaveText('同期済み');

    await addText(page, '同期テスト');
    await saveAs(page, '棚ラベル');
    await expect.poll(() => drive.designFiles().length).toBe(1);
    await waitForSynced(page);

    const [file] = drive.designFiles();
    const content = JSON.parse(file.content);
    expect(file.name).toBe(`design-${content.id}.json`);
    expect(file.parents).toEqual(['appDataFolder']);
    expect(content.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(content.name).toBe('棚ラベル');
    expect(content.deleted).toBe(false);
    expect(content.updatedAt).toBeGreaterThan(0);
    expect(content.design.elements[0].text).toBe('同期テスト');
    expect(file.appProperties.updatedAt).toBe(String(content.updatedAt));

    // 手元は「セッションの印」と「アカウントの接頭辞付きのキー」だけ
    const keys = await localKeys(page);
    for (const k of keys) {
      expect(k === 'phomymo_session' || k.startsWith(PREFIX)).toBe(true);
    }
    expect(keys).toContain(`${PREFIX}phomymo_design_records`);
  });

  test('ゲストで作っていたデザインがあれば、ログインしたあとに Drive に保存するか聞く', async ({ page }) => {
    await addText(page, 'ゲストで作った');
    await loginViaUI(page);
    await expect(page.locator('#save-dialog')).not.toHaveClass(/\bhidden\b/);
    await expect(page.locator('#save-dialog-title')).toHaveText('作業中のデザインを Drive に保存しますか?');
    await page.fill('#save-name', 'ゲストから');
    await page.click('#save-confirm');
    await expect.poll(() => drive.designContents().map(c => c.name)).toEqual(['ゲストから']);
  });

  test('別の端末でも同じデザインが見え、削除も伝わる', async ({ page, browser }) => {
    test.setTimeout(60_000);
    await loginViaUI(page);
    await addText(page, 'A で作成');
    await saveAs(page, '共有デザイン');
    await expect.poll(() => drive.designFiles().length).toBe(1);

    const b = await newDevice(browser, drive);
    await loginViaUI(b.page);
    expect(await designNamesInLoadDialog(b.page)).toEqual(['共有デザイン']);

    // B で開くと中身も同じ
    await b.page.click('#load-btn');
    await b.page.click('#design-list .design-item[data-name="共有デザイン"]');
    await b.page.click('#elements-btn');
    await expect(b.page.locator('#elements-list')).toContainText('A で作成');

    // B で削除 → 墓標が Drive に置かれる
    b.page.once('dialog', d => d.accept());
    await b.page.click('#load-btn');
    await b.page.click('#design-list .delete-design[data-name="共有デザイン"]');
    await expect.poll(() => drive.designContents()[0]?.deleted).toBe(true);
    expect(drive.designContents()[0].design).toBeNull();

    // A で同期すると消える
    await waitForSynced(page);
    await syncNow(page);
    expect(await designNamesInLoadDialog(page)).toEqual([]);
    await b.ctx.close();
  });

  test('Drive のほうが新しければ取り込む', async ({ page }) => {
    await loginViaUI(page);
    await addText(page, '古い');
    await saveAs(page, '競合');
    await expect.poll(() => drive.designFiles().length).toBe(1);
    await waitForSynced(page);

    // 他の端末が新しい版を書いた
    const file = drive.designFiles()[0];
    const c = JSON.parse(file.content);
    const newer = { ...c, updatedAt: c.updatedAt + 10_000, design: { ...c.design, elements: [{ ...c.design.elements[0], text: '新しい' }] } };
    file.content = JSON.stringify(newer);
    file.appProperties.updatedAt = String(newer.updatedAt);

    await syncNow(page);
    const loaded = await page.evaluate(async () => (await import('/storage.js?v=102')).loadDesign('競合'));
    expect(loaded.elements[0].text).toBe('新しい');
  });

  test('リロードしてもログインは続き、キャッシュから一覧が出る。操作のついでに無言で再接続する', async ({ page }) => {
    await loginViaUI(page);
    await addText(page, 'x');
    await saveAs(page, 'リロード後');
    await expect.poll(() => drive.designFiles().length).toBe(1);
    await waitForSynced(page);

    await page.reload({ waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    // トークンはメモリにしか無いので、リロード直後は再接続待ち
    await expect(page.locator('#account-btn')).toHaveAttribute('data-state', 'needs-auth');
    await expect(page.locator('#account-label')).toHaveText('再接続');

    await page.click('#load-btn');
    await expect(page.locator('#design-list .design-item[data-name="リロード後"]')).toHaveCount(1);
    await page.click('#load-cancel');
    // 「開く」のクリックのついでに prompt: '' で取り直している
    await waitForSynced(page);
    const prompts = await page.evaluate(() => (window as any).__fakeGis.requests.map((r: any) => r.prompt));
    expect(prompts).toEqual(['']);
  });

  test('トークンが切れても、保存の直後なら無言で取り直して送る', async ({ page }) => {
    await loginViaUI(page);
    drive.expireAllTokens();
    await addText(page, 'y');
    await saveAs(page, '期限切れ後');
    await expect.poll(() => drive.designContents().map(c => c.name)).toEqual(['期限切れ後']);
    await waitForSynced(page);
    const prompts = await page.evaluate(() => (window as any).__fakeGis.requests.map((r: any) => r.prompt));
    expect(prompts).toEqual(['select_account', '']);
  });

  test('無言の取り直しに失敗したら「再接続」になり、変更は手元に残って再接続後に送られる', async ({ page }) => {
    await loginViaUI(page);
    await page.evaluate(() => { (window as any).__fakeGis.denySilent = true; });
    drive.expireAllTokens();
    await addText(page, 'z');
    await saveAs(page, '再接続待ち');
    await expect(page.locator('#account-btn')).toHaveAttribute('data-state', 'needs-auth', { timeout: 10_000 });
    expect(drive.designFiles()).toHaveLength(0);

    // 一覧には「未送信」の印
    await page.click('#load-btn');
    await expect(page.locator('#design-list .design-item[data-name="再接続待ち"]')).toContainText('未送信');
    await page.click('#load-cancel');

    // 再接続ボタン
    await page.click('#account-btn');
    await expect(page.locator('#account-reconnect')).toBeVisible();
    await expect(page.locator('#account-sync-status')).toContainText('未送信 1 件');
    await page.evaluate(() => { (window as any).__fakeGis.denySilent = false; });
    await page.click('#account-reconnect');
    await waitForSynced(page);
    expect(drive.designContents().map(c => c.name)).toEqual(['再接続待ち']);
  });

  test('ログアウトすると、そのアカウントのキャッシュが全部消えてゲストに戻る', async ({ page }) => {
    await loginViaUI(page);
    await addText(page, 'w');
    await saveAs(page, '消えるキャッシュ');
    await expect.poll(() => drive.designFiles().length).toBe(1);
    await waitForSynced(page);
    // 設定類も書いておく
    await page.click('#print-settings-btn');
    await page.click('#print-settings-save');
    expect((await localKeys(page)).filter(k => k.startsWith(PREFIX)).length).toBeGreaterThan(1);

    const messages: string[] = [];
    page.on('dialog', async d => {
      messages.push(`${d.type()}:${d.message()}`);
      await d.accept();
    });
    await page.click('#account-btn');
    await page.click('#account-logout');
    await page.waitForLoadState('networkidle');
    await waitForAppReady(page);

    expect(messages).toHaveLength(1); // 確認だけで、離脱の警告は出ない
    expect(messages[0]).toContain('confirm:');
    expect(messages[0]).not.toContain('未送信');
    expect(await localKeys(page)).toEqual([]);
    await expect(page.locator('#account-btn')).toHaveAttribute('data-state', 'guest');
    const gis = await page.evaluate(() => (window as any).__fakeGis);
    expect(gis.requests).toEqual([]); // 新しいページでは何もしていない
    // Drive のデータは残る
    expect(drive.designFiles()).toHaveLength(1);
  });

  test('未送信の変更があるときは、ログアウトの前に警告する', async ({ page }) => {
    await loginViaUI(page);
    await page.evaluate(() => { (window as any).__fakeGis.denySilent = true; });
    drive.expireAllTokens();
    await addText(page, 'v');
    await saveAs(page, '未送信のまま');
    await expect(page.locator('#account-btn')).toHaveAttribute('data-state', 'needs-auth', { timeout: 10_000 });

    let message = '';
    page.once('dialog', async d => {
      message = d.message();
      await d.dismiss();
    });
    await page.click('#account-btn');
    await page.click('#account-logout');
    expect(message).toContain('まだ Drive に送っていない変更が 1 件');
    // キャンセルしたのでログインしたまま
    expect((await localKeys(page)).some(k => k.startsWith(PREFIX))).toBe(true);
  });

  test('旧形式(名前がキー)のデータは、ログインしたときに uuid を付けて引き取る', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('phomymo_designs', JSON.stringify({
        '旧デザイン': { elements: [], labelSize: { width: 40, height: 30 }, savedAt: 1000 },
      }));
      localStorage.setItem('phomymo_print_settings', JSON.stringify({ density: 3 }));
    });
    await loginViaUI(page);
    await expect.poll(() => drive.designContents().map(c => c.name)).toEqual(['旧デザイン']);
    expect(drive.designContents()[0].id).toMatch(/^[0-9a-f-]{36}$/);
    const keys = await localKeys(page);
    expect(keys).not.toContain('phomymo_designs');
    expect(keys).not.toContain('phomymo_print_settings');
    expect(keys).toContain(`${PREFIX}phomymo_print_settings`);
  });

  test('期限を過ぎた墓標は物理削除し、期限内の墓標は残す', async ({ page }) => {
    const day = 24 * 60 * 60 * 1000;
    drive.putDesign({ id: '11111111-1111-4111-8111-111111111111', name: '古い削除', updatedAt: Date.now() - 40 * day, deleted: true, design: null });
    drive.putDesign({ id: '22222222-2222-4222-8222-222222222222', name: '最近の削除', updatedAt: Date.now() - 1 * day, deleted: true, design: null });
    drive.putDesign({ id: '33333333-3333-4333-8333-333333333333', name: '生きている', updatedAt: Date.now() - 1 * day, deleted: false, design: { elements: [], labelSize: { width: 40, height: 30 }, savedAt: 1 } });
    await loginViaUI(page);
    await expect.poll(() => drive.designContents().map(c => c.name).sort()).toEqual(['最近の削除', '生きている']);
    expect(await designNamesInLoadDialog(page)).toEqual(['生きている']);
  });
});
