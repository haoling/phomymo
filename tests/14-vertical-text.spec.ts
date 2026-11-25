import { test, expect, Page } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { installFakePrinter, printAndWait, resetDrawnTexts, getDrawnTexts } from './helpers/fake-printer';

// #22 縦書き

async function addText(page: Page, text: string) {
  await page.click('#add-text');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.locator('#prop-text-content').fill(text);
  await page.locator('#prop-text-content').dispatchEvent('input');
  await page.waitForTimeout(200);
}

async function boxSize(page: Page) {
  return {
    x: Number(await page.locator('#prop-x').inputValue()),
    y: Number(await page.locator('#prop-y').inputValue()),
    width: Number(await page.locator('#prop-width').inputValue()),
    height: Number(await page.locator('#prop-height').inputValue()),
  };
}

test.describe('縦書き(組版ヘルパー)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
  });

  test('文字をマスに分ける: 約物・小書き仮名・縦中横・欧文', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const m = await import('/text-layout.js');
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = '20px sans-serif';
      const kinds = (s: string, o = {}) => m.verticalCells(ctx, s, 20, o).map((c: any) => `${c.kind}:${c.text}`);
      return {
        basic: kinds('「12月、ちょっと」ー'),
        long: kinds('2026年'),
        noTcy: kinds('12月', { tcy: false }),
        latin: kinds('ABC de', {}),
        upright: kinds('AB', { latinMode: 'upright' }),
      };
    });
    expect(r.basic).toEqual([
      'rotate:「', 'tcy:12', 'upright:月', 'punct:、', 'upright:ち', 'small:ょ', 'small:っ', 'upright:と', 'rotate:」', 'rotate:ー',
    ]);
    // 3桁以上は縦中横にしない(寝かせる)
    expect(r.long).toEqual(['latin:2026', 'upright:年']);
    expect(r.noTcy).toEqual(['latin:12', 'upright:月']);
    expect(r.latin).toEqual(['latin:ABC ', 'latin:de']);
    expect(r.upright).toEqual(['upright:A', 'upright:B']);
  });

  test('高さで折り返し、句読点は次の列の先頭に来ない', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const m = await import('/text-layout.js');
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = '10px sans-serif';
      const cols = (s: string, h: number | null) =>
        m.layoutVertical(ctx, s, { fontSize: 10, maxHeight: h }).map((c: any) => c.cells.map((x: any) => x.text).join(''));
      return {
        wrap: cols('あいうえおかきく', 30),
        kinsoku: cols('あいう。えお', 30),
        lines: cols('あい\nうえお', null),
      };
    });
    expect(r.wrap).toEqual(['あいう', 'えおか', 'きく']);
    expect(r.kinsoku).toEqual(['あいう。', 'えお']);
    expect(r.lines).toEqual(['あい', 'うえお']);
  });

  test('縦に描かれる: 1列目は右端、2列目はその左', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const m = await import('/text-layout.js');
      const c = document.createElement('canvas');
      c.width = 100; c.height = 200;
      const ctx = c.getContext('2d')!;
      ctx.translate(50, 100);
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#000';
      const cols = m.layoutVertical(ctx, '■■■■\n■', { fontSize: 20, maxHeight: null });
      m.drawVerticalText(ctx, cols, { width: 100, height: 200, fontSize: 20, verticalAlign: 'top', align: 'left' });
      const { data } = ctx.getImageData(0, 0, 100, 200);
      const ink = (x0: number, x1: number, y0: number, y1: number) => {
        let n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[(y * 100 + x) * 4 + 3] > 128) n++;
        return n;
      };
      return {
        // 1列目(右端 96〜72)の上と下(4文字 = 80px)
        rightTop: ink(72, 96, 4, 24),
        rightLow: ink(72, 96, 64, 84),
        // 2列目(72〜48)は1文字だけ
        secondTop: ink(48, 72, 4, 24),
        secondLow: ink(48, 72, 64, 84),
        left: ink(0, 40, 0, 200),
      };
    });
    expect(r.rightTop).toBeGreaterThan(50);
    expect(r.rightLow).toBeGreaterThan(50);
    expect(r.secondTop).toBeGreaterThan(50);
    expect(r.secondLow).toBe(0);
    expect(r.left).toBe(0);
  });
});

test.describe('縦書き(画面と印刷)', () => {
  test.beforeEach(async ({ page }) => {
    await installFakePrinter(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('縦書きにすると枠が縦長になり、1文字ずつ描かれる。横書きに戻せる', async ({ page }) => {
    await addText(page, 'たて12月');
    await expect(page.locator('[data-writing-mode="horizontal"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#prop-vertical-options')).toBeHidden();
    const before = await boxSize(page);
    expect(before.width).toBeGreaterThan(before.height);

    await page.click('[data-writing-mode="vertical"]');
    await expect(page.locator('[data-writing-mode="vertical"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#prop-vertical-options')).toBeVisible();
    await expect(page.locator('#prop-tcy')).toBeChecked();
    await expect(page.locator('#prop-latin-mode')).toHaveValue('rotate');
    const box = await boxSize(page);
    expect(box.width).toBe(before.height);
    expect(box.height).toBe(before.width);
    // 中心は動かない
    expect(Math.abs((box.x + box.width / 2) - (before.x + before.width / 2))).toBeLessThanOrEqual(1);

    await resetDrawnTexts(page);
    await printAndWait(page);
    await expect(page.locator('#status-message')).toHaveText('Print complete!');
    let drawn = await getDrawnTexts(page);
    expect(drawn).not.toContain('たて12月');
    for (const t of ['た', 'て', '12', '月']) expect(drawn).toContain(t);

    // 縦中横を切ると、数字は寝かせて描かれる(まとまりのまま)。英数字を立てると1文字ずつ
    await page.uncheck('#prop-tcy');
    await page.selectOption('#prop-latin-mode', 'upright');
    await resetDrawnTexts(page);
    await printAndWait(page);
    drawn = await getDrawnTexts(page);
    expect(drawn).toContain('1');
    expect(drawn).toContain('2');

    await page.click('[data-writing-mode="horizontal"]');
    await expect(page.locator('#prop-vertical-options')).toBeHidden();
    expect(await boxSize(page)).toEqual(before);
    await resetDrawnTexts(page);
    await printAndWait(page);
    expect(await getDrawnTexts(page)).toContain('たて12月');
  });

  test('曲線文字のときに縦書きにすると、曲線文字が解除される', async ({ page }) => {
    await addText(page, 'まる');
    await page.check('#prop-arc-enabled');
    await expect(page.locator('#prop-arc-options')).toBeVisible();
    await page.click('[data-writing-mode="vertical"]');
    await expect(page.locator('#prop-arc-enabled')).not.toBeChecked();
    await expect(page.locator('#prop-arc-options')).toBeHidden();
    const box = await boxSize(page);
    expect(box.height).toBeGreaterThan(box.width);
    // 曲線文字に戻すと横書きになる
    await page.check('#prop-arc-enabled');
    await expect(page.locator('[data-writing-mode="horizontal"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('元に戻す(Ctrl+Z)で縦書きを取り消せる', async ({ page }) => {
    await addText(page, 'もどす');
    const before = await boxSize(page);
    await page.click('[data-writing-mode="vertical"]');
    await expect(page.locator('#prop-vertical-options')).toBeVisible();
    await page.locator('[data-writing-mode="vertical"]').blur();
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-writing-mode="horizontal"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await boxSize(page)).toEqual(before);
  });
});
