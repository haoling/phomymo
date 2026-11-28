import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';
import { installFakePrinter } from './helpers/fake-printer';

// 接続直後の印刷: 接続時の状態の問い合わせ(1F 11 xx)と印刷が同時に走っても、
// 問い合わせが印刷データの途中に混ざらず、書き込みが断られて印刷が止まらないこと

test.describe('BLE の書き込みを1つずつ流す', () => {
  test.beforeEach(async ({ page }) => {
    await installFakePrinter(page, 'M110');
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('印刷中に問い合わせが来ても、印刷データの途中に混ざらない', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const { BLETransport } = await import('/ble.js');
      const p = await import('/printer.js');
      await p.loadPrinterDefinitions();

      // 実機の BLE と同じく、書き込みが終わる前に次の書き込みが来たら断る
      const writes: number[][] = [];
      let busy = false;
      const write = async (buf: ArrayBuffer) => {
        if (busy) throw new DOMException('GATT operation already in progress.', 'NetworkError');
        busy = true;
        await new Promise(r => setTimeout(r, 2));
        writes.push(Array.from(new Uint8Array(buf)));
        busy = false;
      };
      const tr: any = new BLETransport();
      tr.device = { name: 'M110', gatt: { connected: true } };
      tr.connected = true;
      tr.writeChar = { writeValueWithoutResponse: write, writeValue: write };
      tr.delay = (ms: number) => new Promise(r => setTimeout(r, Math.min(ms, 5)));

      const widthBytes = 48, heightLines = 40;
      const data = new Uint8Array(widthBytes * heightLines).fill(0xaa);
      let error: string | null = null;
      const printing = p.print(tr, { data, widthBytes, heightLines }, {
        isBLE: true, deviceName: 'M110', printerModel: 'auto', density: 6, feed: 32,
      }).catch((e: Error) => { error = e.message; });
      // 印刷を始めた直後に、接続時と同じ問い合わせを流す
      await new Promise(r => setTimeout(r, 3));
      const querying = tr.queryAll();
      await Promise.all([printing, querying]);

      const isPrefix = (c: number[], pre: number[]) => pre.every((v, i) => c[i] === v);
      const footerAt = writes.findIndex(c => isPrefix(c, [0x1f, 0xf0, 0x05, 0x00]));
      // 電池・用紙・ファームウェア・製造番号の問い合わせ(印刷の用紙種類 1F 11 0A は含めない)
      const queryCodes = [0x08, 0x11, 0x07, 0x09];
      const queryAt = writes
        .map((c, i) => (c.length === 3 && isPrefix(c, [0x1f, 0x11]) && queryCodes.includes(c[2]) ? i : -1))
        .filter(i => i >= 0);
      return { error, footerAt, queryAt, withResponse: tr._useWriteWithResponse };
    });
    expect(out.error).toBeNull();
    expect(out.footerAt).toBeGreaterThan(0);
    // 問い合わせ4つは、印刷の終わりより後にまとめて送られる
    expect(out.queryAt).toHaveLength(4);
    for (const i of out.queryAt) expect(i).toBeGreaterThan(out.footerAt);
    // 断られても writeValue(応答待ちの遅い書き方)に切り替えない
    expect(out.withResponse).toBe(false);
  });

  test('「ほかの書き込みの途中」で断られたら、待って同じデータを送り直す', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const { BLETransport } = await import('/ble.js');
      const writes: number[][] = [];
      let refuse = 2;
      const tr: any = new BLETransport();
      tr.device = { name: 'M110', gatt: { connected: true } };
      tr.connected = true;
      tr.writeChar = {
        async writeValueWithoutResponse(buf: ArrayBuffer) {
          if (refuse-- > 0) throw new DOMException('GATT operation already in progress.', 'NetworkError');
          writes.push(Array.from(new Uint8Array(buf)));
        },
        async writeValue() { throw new Error('should not switch to writeValue'); },
      };
      await tr.send(new Uint8Array([1, 2, 3]));
      return { writes, withResponse: tr._useWriteWithResponse };
    });
    expect(out.writes).toEqual([[1, 2, 3]]);
    expect(out.withResponse).toBe(false);
  });

  test('一度失敗した印刷のあとも、次の印刷や問い合わせは止まらない', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const { BLETransport } = await import('/ble.js');
      const tr: any = new BLETransport();
      const first = tr.exclusive(async () => { throw new Error('boom'); }).catch((e: Error) => e.message);
      const second = tr.exclusive(async () => 'ok');
      return [await first, await second];
    });
    expect(out).toEqual(['boom', 'ok']);
  });
});
