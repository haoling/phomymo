import { test, expect, Page } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { installFakePrinter, printAndWait, resetDrawnTexts, getDrawnTexts } from './helpers/fake-printer';

// #24 曲線文字・字間の調整

async function addText(page: Page, text: string) {
  await page.click('#add-text');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.locator('#prop-text-content').fill(text);
  await page.locator('#prop-text-content').dispatchEvent('input');
  await page.waitForTimeout(200);
}

async function setRange(page: Page, selector: string, value: number) {
  await page.locator(selector).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForTimeout(100);
}

async function boxSize(page: Page) {
  return {
    x: Number(await page.locator('#prop-x').inputValue()),
    y: Number(await page.locator('#prop-y').inputValue()),
    width: Number(await page.locator('#prop-width').inputValue()),
    height: Number(await page.locator('#prop-height').inputValue()),
  };
}

test.describe('字間・曲線文字(組版ヘルパー)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
  });

  test('字間ありの幅は 文字幅の合計 + 字間×(文字数-1)、絵文字は1文字として扱う', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const m = await import('/text-layout.js');
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = '20px sans-serif';
      const sum = ['A', 'B', 'C'].reduce((a, c) => a + ctx.measureText(c).width, 0);
      return {
        plain: m.measureLine(ctx, 'ABC', 0),
        native: ctx.measureText('ABC').width,
        spaced: m.measureLine(ctx, 'ABC', 5),
        expected: sum + 10,
        graphemes: m.splitGraphemes('あ👍🏽か').length,
      };
    });
    expect(r.plain).toBeCloseTo(r.native, 5);
    expect(r.spaced).toBeCloseTo(r.expected, 5);
    expect(r.graphemes).toBe(3);
  });

  test('値の正規化(範囲外・壊れた値)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const m = await import('/text-layout.js');
      return {
        a: m.normalizeArc(null),
        b: m.normalizeArc({ radius: 0 }),
        c: m.normalizeArc({ radius: 100, direction: 'down' }),
        d: m.normalizeArc({ radius: 1e9, direction: 'xx' }),
        s1: m.normalizeLetterSpacing('abc'),
        s2: m.normalizeLetterSpacing(99),
        s3: m.normalizeLetterSpacing(-99),
      };
    });
    expect(r.a).toBeNull();
    expect(r.b).toBeNull();
    expect(r.c).toEqual({ radius: 100, direction: 'down' });
    expect(r.d).toEqual({ radius: 2000, direction: 'up' });
    expect(r.s1).toBe(0);
    expect(r.s2).toBe(2);
    expect(r.s3).toBe(-0.3);
  });

  test('円弧の文字は、上向きなら上側・下向きなら下側に描かれる', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const m = await import('/text-layout.js');
      const c = document.createElement('canvas');
      c.width = 200; c.height = 200;
      const run = (direction: 'up' | 'down') => {
        const ctx = c.getContext('2d')!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, 200, 200);
        ctx.translate(100, 100);
        ctx.font = 'bold 20px sans-serif';
        ctx.fillStyle = '#000';
        m.drawArcText(ctx, ['WWWWWW'], { radius: 70, direction, lineHeight: 24, fontSize: 20 });
        const { data } = ctx.getImageData(0, 0, 200, 200);
        let top = 0, bottom = 0;
        for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
          if (data[(y * 200 + x) * 4 + 3] > 128) (y < 100 ? top++ : bottom++);
        }
        return { top, bottom };
      };
      return { up: run('up'), down: run('down') };
    });
    expect(r.up.top).toBeGreaterThan(50);
    expect(r.up.bottom).toBe(0);
    expect(r.down.bottom).toBeGreaterThan(50);
    expect(r.down.top).toBe(0);
  });
});

test.describe('字間・曲線文字(画面と印刷)', () => {
  test.beforeEach(async ({ page }) => {
    await installFakePrinter(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('字間を広げると1文字ずつ描かれ、印刷にも反映される', async ({ page }) => {
    await addText(page, 'ABCD');
    await expect(page.locator('#text-style-extra')).toBeVisible();
    await expect(page.locator('#prop-letter-spacing')).toHaveValue('0');

    // 字間 0 のときは、文字列がまとめて描かれる
    await resetDrawnTexts(page);
    await printAndWait(page);
    expect(await getDrawnTexts(page)).toContain('ABCD');

    await setRange(page, '#prop-letter-spacing', 50);
    await expect(page.locator('#prop-letter-spacing-input')).toHaveValue('50');

    await resetDrawnTexts(page);
    await printAndWait(page);
    await expect(page.locator('#status-message')).toHaveText('印刷が終わりました!');
    const drawn = await getDrawnTexts(page);
    expect(drawn).not.toContain('ABCD');
    for (const ch of ['A', 'B', 'C', 'D']) expect(drawn).toContain(ch);

    // 数値欄からも変えられ、「0に戻す」で戻る
    await page.locator('#prop-letter-spacing-input').fill('-10');
    await page.locator('#prop-letter-spacing-input').dispatchEvent('change');
    await expect(page.locator('#prop-letter-spacing')).toHaveValue('-10');
    await page.click('#prop-letter-spacing-reset');
    await expect(page.locator('#prop-letter-spacing')).toHaveValue('0');
  });

  test('曲線文字: オンにすると枠が正方形になり、1文字ずつ描かれる。オフで戻る', async ({ page }) => {
    await addText(page, 'HELLO');
    await expect(page.locator('#prop-arc-options')).toBeHidden();

    await page.check('#prop-arc-enabled');
    await expect(page.locator('#prop-arc-options')).toBeVisible();
    await expect(page.locator('[data-arc-direction="up"]')).toHaveAttribute('aria-pressed', 'true');
    let box = await boxSize(page);
    expect(box.width).toBe(box.height);
    expect(Number(await page.locator('#prop-arc-radius-input').inputValue())).toBeGreaterThan(0);

    await resetDrawnTexts(page);
    await printAndWait(page);
    const drawn = await getDrawnTexts(page);
    expect(drawn).not.toContain('HELLO');
    expect(drawn.filter((t) => t === 'L').length).toBeGreaterThanOrEqual(2);

    // 半径を変えると、円の中心を保ったまま枠の大きさが変わる
    const before = await boxSize(page);
    await setRange(page, '#prop-arc-radius', 20);
    await expect(page.locator('#prop-arc-radius-input')).toHaveValue('20');
    box = await boxSize(page);
    expect(box.width).toBe(box.height);
    expect(box.width).toBeGreaterThan(2 * 20 * 8);
    expect(Math.abs((box.x + box.width / 2) - (before.x + before.width / 2))).toBeLessThanOrEqual(1);

    // 向きを下に
    await page.click('[data-arc-direction="down"]');
    await expect(page.locator('[data-arc-direction="down"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-arc-direction="up"]')).toHaveAttribute('aria-pressed', 'false');

    // オフにすると、まっすぐな文字の枠に戻る
    await page.uncheck('#prop-arc-enabled');
    await expect(page.locator('#prop-arc-options')).toBeHidden();
    box = await boxSize(page);
    expect(box.width).toBeGreaterThan(box.height);
    await resetDrawnTexts(page);
    await printAndWait(page);
    expect(await getDrawnTexts(page)).toContain('HELLO');
  });

  test('丸ラベルでは「ラベルいっぱいに合わせる」で縁に沿う', async ({ page }) => {
    await page.selectOption('#label-size', '40mm Round');
    await page.waitForTimeout(300);
    await addText(page, 'まるいラベル');
    await page.check('#prop-arc-enabled');
    await page.click('#prop-arc-fit');
    const box = await boxSize(page);
    expect(box).toEqual({ x: 0, y: 0, width: 320, height: 320 });
    const mm = Number(await page.locator('#prop-arc-radius-input').inputValue());
    // ラベル半径 20mm から、文字の大きさぶん内側
    expect(mm).toBeGreaterThan(15);
    expect(mm).toBeLessThan(20);
  });

  test('元に戻す(Ctrl+Z)で曲線文字を取り消せる', async ({ page }) => {
    await addText(page, 'UNDO');
    const before = await boxSize(page);
    await page.check('#prop-arc-enabled');
    await expect(page.locator('#prop-arc-options')).toBeVisible();
    // チェックボックスにフォーカスがあると Ctrl+Z はブラウザに任されるので、外してから押す
    await page.locator('#prop-arc-enabled').blur();
    await page.keyboard.press('Control+z');
    await expect(page.locator('#prop-arc-enabled')).not.toBeChecked();
    await expect(page.locator('#prop-arc-options')).toBeHidden();
    expect(await boxSize(page)).toEqual(before);
  });
});
