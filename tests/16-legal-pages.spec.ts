import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForAppReady } from './helpers/app';

// Google の同意画面(ブランド確認)に出すページとロゴ

const pages = ['about.html', 'privacy.html', 'terms.html'];

for (const name of pages) {
  test(`${name} は日英の両方があり、ほかのページとロゴへのリンクが切れていない`, async ({ page, request }) => {
    const res = await page.goto(`/${name}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('section[lang="ja"] h1')).toBeVisible();
    await expect(page.locator('section[lang="en"] h1')).toBeVisible();
    // 非公式であることを両方の言語で書いている
    await expect(page.locator('section[lang="ja"]')).toContainText('非公式');
    await expect(page.locator('section[lang="en"]')).toContainText(/unofficial/i);

    const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
    const local = [...new Set(hrefs.filter((h) => !/^(https?:|#)/.test(h)).map((h) => h.split('#')[0]))];
    for (const h of [...local, 'brand/logo-120.png', 'legal.css']) {
      const r = await request.get(`/${h === './' ? '' : h}`);
      expect(r.status(), h).toBe(200);
    }
  });
}

test('プライバシーポリシーにスコープと Limited Use の宣言がある', async ({ page }) => {
  await page.goto('/privacy.html');
  const { CONFIG } = await page.evaluate(() => import('./config.js'));
  await expect(page.locator('section[lang="ja"]')).toContainText(CONFIG.driveScope);
  await expect(page.locator('section[lang="en"]')).toContainText(CONFIG.driveScope);
  await expect(page.locator('section[lang="en"]')).toContainText('Limited Use requirements');
});

test('ロゴは 120x120 の PNG で 1MB 以下', async () => {
  const file = path.join(__dirname, '..', 'src', 'web', 'brand', 'logo-120.png');
  const buf = fs.readFileSync(file);
  expect(buf.length).toBeLessThan(1024 * 1024);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  expect(buf.readUInt32BE(16)).toBe(120);
  expect(buf.readUInt32BE(20)).toBe(120);
});

test('アプリからプライバシーポリシーと利用規約に行ける', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);
  await expect(page.locator('#footer-privacy-link')).toHaveAttribute('href', 'privacy.html');
  await expect(page.locator('#footer-terms-link')).toHaveAttribute('href', 'terms.html');
  await expect(page.locator('#account-privacy-link')).toHaveAttribute('href', 'privacy.html');
  await expect(page.locator('#account-terms-link')).toHaveAttribute('href', 'terms.html');
});

test('アプリ内の GitHub リンクはこのフォークを指す', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);
  const hrefs = await page.locator('a[href*="github.com"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const h of hrefs) expect(h).toMatch(/^https:\/\/github\.com\/haoling\/phomymo(\/|$)/);
});

test('寄付ボタンは元作者への寄付だと分かる', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);
  // Chromium 以外で出る警告ダイアログ(app.js が作る)にもあるので、ソースも確かめる
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'app.js'), 'utf8');
  const tags = src.match(/<a href="https:\/\/donate\.stripe\.com[^>]*>/g) || [];
  for (const tag of tags) expect(tag).toContain('original Phomymo');
  const links = page.locator('a[href*="donate.stripe.com"]');
  const n = await links.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await expect(links.nth(i)).toHaveAttribute('title', /original Phomymo/);
    await expect(links.nth(i)).toContainText('Support the original author');
  }
});
