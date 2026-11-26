import { test, expect, Page } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { installFakePrinter, printAndWait } from './helpers/fake-printer';

// Phomemo M120 対応
// - M120 は M110 と同じ命令(phomemo-tools の M110/M120 プロトコル)で印刷する
// - 印刷中に状態の問い合わせ(1F 11 xx)がラスタに混ざらない
// - つないでから時間が経った接続は、印刷の前につなぎ直す(約 28.8 秒で切られるため)

type LogEntry = number[] | { len: number };

const SPEED = [0x1b, 0x4e, 0x0d, 0x05];
const MEDIA_GAPS = [0x1f, 0x11, 0x0a];
const FOOTER = [0x1f, 0xf0, 0x05, 0x00, 0x1f, 0xf0, 0x03, 0x00];

async function getLog(page: Page): Promise<LogEntry[]> {
  return page.evaluate(() => (window as any).__fakePrinter.log);
}

async function getConnects(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__fakePrinter.connects);
}

const same = (a: LogEntry, b: number[]) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
const isRasterHeader = (a: LogEntry) => Array.isArray(a) && a.length === 8 && a[0] === 0x1d && a[1] === 0x76 && a[2] === 0x30;
const isQuery = (a: LogEntry) => Array.isArray(a) && a.length === 3 && a[0] === 0x1f && a[1] === 0x11 && a[2] !== 0x0a && a[2] !== 0x0b;

async function setup(page: Page, name: string) {
  await installFakePrinter(page, name);
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForAppReady(page);
  await dismissInfoDialog(page);
}

test.describe('Phomemo M120', () => {
  test('M120 を M110/M120 として認識し、M110 の命令で印刷する', async ({ page }) => {
    await setup(page, 'M120');
    await printAndWait(page);

    const log = await getLog(page);
    const header = log.findIndex(isRasterHeader);
    expect(header).toBeGreaterThan(0);
    // 48 バイト(384 ドット)幅
    expect((log[header] as number[])[4]).toBe(48);
    const before = log.slice(0, header);
    expect(before.some((e) => same(e, SPEED))).toBe(true);
    expect(before.some((e) => same(e, MEDIA_GAPS))).toBe(true);
    expect(log.some((e) => same(e, FOOTER))).toBe(true);
    // 機種を聞く画面は出ない
    await expect(page.locator('#printer-model-prompt')).toHaveClass(/hidden/);
  });

  test('接続直後に印刷しても、状態の問い合わせがラスタの途中に混ざらない', async ({ page }) => {
    await setup(page, 'M120');
    // 未接続のまま印刷ボタン → 接続 → すぐ印刷。接続 0.5 秒後に問い合わせが走る
    await printAndWait(page);
    await page.waitForTimeout(1500);

    const log = await getLog(page);
    const header = log.findIndex(isRasterHeader);
    const footer = log.findIndex((e) => same(e, FOOTER));
    expect(header).toBeGreaterThan(0);
    expect(footer).toBeGreaterThan(header);
    expect(log.slice(header, footer).some(isQuery)).toBe(false);
    // 問い合わせ自体は送られている(印刷のあと)
    expect(log.some(isQuery)).toBe(true);
  });

  test('接続から時間が経っていたら、印刷の前につなぎ直す', async ({ page }) => {
    await page.clock.install();
    await setup(page, 'M120');
    await printAndWait(page);
    expect(await getConnects(page)).toBe(1);

    // すぐの印刷ではつなぎ直さない
    await printAndWait(page);
    expect(await getConnects(page)).toBe(1);

    // 25 秒経つと、印刷の前につなぎ直す
    await page.clock.fastForward(25_000);
    await printAndWait(page);
    expect(await getConnects(page)).toBe(2);
  });
});
