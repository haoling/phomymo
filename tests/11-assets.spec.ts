import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

// #27 素材集、#28 枠・ボーダー素材

const WEB = path.join(__dirname, '..', 'src', 'web');

async function openAssets(page: Page, button = '#add-asset') {
  await page.click(button);
  await expect(page.locator('#assets-dialog')).toBeVisible();
  await expect(page.locator('#assets-grid .assets-item').first()).toBeVisible();
}

/** 要素の一覧から、いちばん下の要素を選ぶ */
async function selectFirstElement(page: Page) {
  await page.click('#elements-btn');
  await page.locator('#elements-list .element-list-item').last().dispatchEvent('click');
  await page.waitForTimeout(200);
}

/** プレビューのキャンバスで、ラベルの範囲にある黒っぽい画素の数を数える */
async function countDarkPixels(page: Page, region: 'edge' | 'center' | 'all' = 'all') {
  return page.evaluate((region) => {
    const canvas = document.querySelector('#preview-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const fx = x / width, fy = y / height;
        const inCenter = fx > 0.35 && fx < 0.65 && fy > 0.35 && fy < 0.65;
        if (region === 'center' && !inCenter) continue;
        if (region === 'edge' && inCenter) continue;
        const i = (y * width + x) * 4;
        if (data[i + 3] > 200 && data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80) n++;
      }
    }
    return n;
  }, region);
}

test.describe('素材集(#27)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('マニフェストに載っている素材のファイルがすべて同梱されている', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(WEB, 'assets', 'manifest.json'), 'utf-8'));
    expect(manifest.items.length).toBeGreaterThan(200);
    const ids = new Set<string>();
    const catIds = new Set(manifest.categories.map((c: any) => c.id));
    for (const item of manifest.items) {
      expect(ids.has(item.id), `重複: ${item.id}`).toBe(false);
      ids.add(item.id);
      expect(fs.existsSync(path.join(WEB, 'assets', item.file)), item.file).toBe(true);
      expect(item.name).toBeTruthy();
      for (const c of item.cats) expect(catIds.has(c), `${item.id} のカテゴリ ${c}`).toBe(true);
      expect(manifest.sources[item.source], item.id).toBeTruthy();
    }
  });

  test('素材のライセンスが ASSETS_LICENSE.md に書かれている', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(WEB, 'assets', 'manifest.json'), 'utf-8'));
    const doc = fs.readFileSync(path.join(__dirname, '..', 'ASSETS_LICENSE.md'), 'utf-8');
    for (const src of Object.values(manifest.sources) as any[]) {
      expect(doc).toContain(src.name);
      expect(doc).toContain(src.license);
    }
    // 配信物にもライセンス文を同梱している
    expect(fs.existsSync(path.join(WEB, 'assets', 'LICENSES.txt'))).toBe(true);
  });

  test('ツールバーの「素材」でパネルが開き、カテゴリで絞り込める', async ({ page }) => {
    await openAssets(page);
    const cats = await page.locator('#assets-cats .assets-cat').allTextContents();
    expect(cats.slice(0, 2)).toEqual(['すべて', '枠']);
    expect(cats).toContain('絵文字');
    expect(cats).toContain('ステッカー');

    await page.locator('#assets-cats .assets-cat', { hasText: '絵文字' }).click();
    const ids = await page.locator('#assets-grid .assets-item').evaluateAll(
      (els) => els.map((e) => (e as HTMLElement).dataset.assetId)
    );
    expect(ids.length).toBeGreaterThan(50);
    expect(ids.every((id) => id!.startsWith('twemoji:'))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('#assets-dialog')).toBeHidden();
  });

  test('ひらがな・カタカナどちらでも検索できる', async ({ page }) => {
    await openAssets(page);
    await page.fill('#assets-search', 'ネコ');
    const names1 = await page.locator('#assets-grid .assets-item span').allTextContents();
    expect(names1).toContain('ねこ');
    await page.fill('#assets-search', 'ねこ');
    const names2 = await page.locator('#assets-grid .assets-item span').allTextContents();
    expect(names2).toEqual(names1);
    await page.fill('#assets-search', 'そんなそざいはない');
    await expect(page.locator('#assets-grid .assets-empty')).toHaveText('見つかりませんでした');
  });

  test('素材を選ぶと画像として真ん中に追加され、印刷用に PNG になっている', async ({ page }) => {
    await openAssets(page);
    await page.fill('#assets-search', 'ハート(塗り)');
    await page.locator('#assets-grid .assets-item').first().click();
    await expect(page.locator('#assets-dialog')).toBeHidden();
    // 画像のプロパティが出る
    await expect(page.locator('#props-image')).toBeVisible();
    const w = Number(await page.locator('#prop-width').inputValue());
    const h = Number(await page.locator('#prop-height').inputValue());
    // 40x30mm(320x240px)の短い辺の半分
    expect(Math.max(w, h)).toBe(120);
    // 真ん中に黒い画素がある
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await countDarkPixels(page, 'center')).toBeGreaterThan(500);
  });

  test('線の太さを変えると、線アイコンの線が太くなる', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const mod = await import('/assets-panel.js');
      const svg = await (await fetch('/assets/tabler/circle.svg')).text();
      const count = async (lw: string) => {
        const { dataUrl } = await mod.rasterizeSvg(svg, { lineWidth: lw, size: 96 });
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 96; c.height = 96;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, 96, 96).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
        return n;
      };
      return { thin: await count('1.5'), thick: await count('3') };
    });
    expect(res.thick).toBeGreaterThan(res.thin * 1.6);
  });

  test('最近使った素材がカテゴリに出る', async ({ page }) => {
    await openAssets(page);
    await page.fill('#assets-search', 'りんご');
    const first = page.locator('#assets-grid .assets-item').first();
    const id = await first.getAttribute('data-asset-id');
    await first.click();
    await expect(page.locator('#assets-dialog')).toBeHidden();
    await openAssets(page);
    await page.fill('#assets-search', '');
    await page.locator('#assets-cats .assets-cat', { hasText: '最近使った' }).click();
    const ids = await page.locator('#assets-grid .assets-item').evaluateAll(
      (els) => els.map((e) => (e as HTMLElement).dataset.assetId)
    );
    expect(ids[0]).toBe(id);
  });
});

test.describe('枠・ボーダー素材(#28)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('ツールバーの「枠」で枠のカテゴリが開く', async ({ page }) => {
    await openAssets(page, '#add-frame');
    const selected = await page.locator('#assets-cats .assets-cat[aria-selected="true"]').textContent();
    expect(selected).toBe('枠');
    const ids = await page.locator('#assets-grid .assets-item').evaluateAll(
      (els) => els.map((e) => (e as HTMLElement).dataset.assetId)
    );
    expect(ids.length).toBeGreaterThanOrEqual(12);
    expect(ids.every((id) => id!.startsWith('frame:'))).toBe(true);
  });

  test('枠を追加すると、ラベルいっぱいに広がり、ラベルのサイズを変えると追従する', async ({ page }) => {
    await page.selectOption('#label-size', '40x30');
    await openAssets(page, '#add-frame');
    await page.locator('#assets-grid .assets-item[data-asset-id="frame:double"]').click();
    await expect(page.locator('#props-frame')).toBeVisible();
    await expect(page.locator('#prop-frame-style')).toHaveValue('double');
    await expect(page.locator('#prop-frame-fit')).toBeChecked();
    expect(await page.locator('#prop-x').inputValue()).toBe('8');
    expect(await page.locator('#prop-width').inputValue()).toBe(String(320 - 16));
    expect(await page.locator('#prop-height').inputValue()).toBe(String(240 - 16));

    // 縁に線が描かれていて、真ん中は空いている
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await countDarkPixels(page, 'edge')).toBeGreaterThan(1000);
    expect(await countDarkPixels(page, 'center')).toBe(0);

    // ラベルを 50x30 に変えると、枠も伸びる
    await page.selectOption('#label-size', '50x30');
    await page.waitForTimeout(300);
    await selectFirstElement(page);
    await expect(page.locator('#props-frame')).toBeVisible();
    expect(await page.locator('#prop-width').inputValue()).toBe(String(400 - 16));
    expect(await page.locator('#prop-height').inputValue()).toBe(String(240 - 16));
  });

  test('手で動かした枠は「ラベルに合わせる」が外れる', async ({ page }) => {
    await page.selectOption('#label-size', '40x30');
    await openAssets(page, '#add-frame');
    await page.locator('#assets-grid .assets-item[data-asset-id="frame:single"]').click();
    await expect(page.locator('#prop-frame-fit')).toBeChecked();
    await page.locator('#prop-x').fill('20');
    await page.locator('#prop-x').dispatchEvent('change');
    await page.locator('#prop-x').dispatchEvent('input');
    await expect(page.locator('#prop-frame-fit')).not.toBeChecked();
    // チェックを入れ直すと、ラベルに合わせ直す
    await page.locator('#prop-frame-fit').check();
    await expect(page.locator('#prop-x')).toHaveValue('8');
  });

  test('すべての枠のスタイルが、四角でも丸でも描ける', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const f = await import('/frames.js');
      const out: Record<string, number> = {};
      for (const s of f.FRAME_STYLES) {
        for (const shape of ['rect', 'ellipse']) {
          const c = document.createElement('canvas');
          c.width = 320; c.height = 240;
          const ctx = c.getContext('2d')!;
          ctx.translate(160, 120);
          f.drawFrame(ctx, { frameStyle: s.id, frameShape: shape, strokeWidth: 3, color: 'black' }, 300, 220);
          const d = ctx.getImageData(0, 0, 320, 240).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
          out[`${s.id}/${shape}`] = n;
        }
      }
      return out;
    });
    for (const [k, n] of Object.entries(res)) {
      expect(n, k).toBeGreaterThan(300);
    }
  });
});
