import { Page } from '@playwright/test';

/**
 * 実機が無くても印刷の流れをテストできるように、Web Bluetooth の偽物を差し込む。
 * あわせて Canvas の fillText を記録し、印刷用に描画された文字列を確認できるようにする。
 *
 * - window.__fakePrinter.bytesWritten: プリンタに送られたバイト数
 * - window.__fakePrinter.log: 書き込みごとの記録(16 バイト以下はバイト列そのもの、それより長いものは長さだけ)
 * - window.__fakePrinter.connects: GATT 接続の回数
 * - window.__drawnTexts: fillText で描かれた文字列(順番どおり)
 * - window.__drawnFonts: そのときの ctx.font
 */
export async function installFakePrinter(page: Page, deviceName = 'M110') {
  await page.addInitScript((name) => {
    const w = window as any;
    w.__drawnTexts = [] as string[];
    w.__drawnFonts = [] as string[];
    const origFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text: string, ...rest: any[]) {
      w.__drawnTexts.push(String(text));
      w.__drawnFonts.push(String(this.font));
      return (origFillText as any).call(this, text, ...rest);
    };

    const state = { bytesWritten: 0, writes: 0, connects: 0, log: [] as (number[] | { len: number })[] };
    const record = (buf: ArrayBuffer | ArrayBufferView) => {
      const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array((buf as any).buffer, (buf as any).byteOffset, (buf as any).byteLength);
      state.log.push(u8.length <= 16 ? Array.from(u8) : { len: u8.length });
    };
    w.__fakePrinter = state;

    const writeChar = {
      properties: { write: true, writeWithoutResponse: true, read: false, notify: false },
      async writeValueWithoutResponse(buf: ArrayBuffer | ArrayBufferView) {
        state.bytesWritten += (buf as any).byteLength;
        state.writes++;
        record(buf);
      },
      async writeValue(buf: ArrayBuffer | ArrayBufferView) {
        state.bytesWritten += (buf as any).byteLength;
        state.writes++;
        record(buf);
      },
    };
    const service = {
      async getCharacteristic(uuid: unknown) {
        // 通知用キャラクタリスティックは無いものとして扱う(アプリ側は待ち時間で代替する)
        if (uuid === 0xff03 || String(uuid).toLowerCase().includes('ff03')) throw new Error('not supported');
        return writeChar;
      },
    };
    const listeners: Record<string, Function[]> = {};
    const device: any = {
      name,
      id: 'fake-device',
      gatt: {
        connected: false,
        async connect() { device.gatt.connected = true; state.connects++; return { getPrimaryService: async () => service }; },
        disconnect() {
          device.gatt.connected = false;
          // 本物と同じく、切断の知らせは少し遅れて届く
          setTimeout(() => (listeners['gattserverdisconnected'] || []).forEach((fn) => fn()), 0);
        },
      },
      addEventListener(type: string, fn: Function) { (listeners[type] ||= []).push(fn); },
      removeEventListener() {},
      watchAdvertisements() { return Promise.reject(new Error('not supported in fake')); },
    };
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        async requestDevice() { return device; },
        async getDevices() { return []; },
        async getAvailability() { return true; },
      },
    });
  }, deviceName);
}

/** 記録した描画文字列をリセットする */
export async function resetDrawnTexts(page: Page) {
  await page.evaluate(() => {
    (window as any).__drawnTexts = [];
    (window as any).__drawnFonts = [];
  });
}

/** 記録した描画文字列を取得する */
export async function getDrawnTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__drawnTexts as string[]);
}

/** 部数を設定して、印刷設定ダイアログを閉じる */
export async function setCopies(page: Page, copies: number) {
  await page.click('#print-settings-btn');
  await page.locator('#print-copies').fill(String(copies));
  await page.click('#print-settings-save');
}

/** 印刷ボタンを押して、印刷が終わるまで待つ */
export async function printAndWait(page: Page, timeout = 90_000) {
  await page.click('#print-btn');
  await page.waitForFunction(() => {
    const btn = document.querySelector('#print-btn') as HTMLButtonElement;
    return btn && !btn.disabled && btn.textContent?.trim() === '印刷';
  }, null, { timeout, polling: 200 });
}
