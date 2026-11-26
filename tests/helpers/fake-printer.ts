import { Page } from '@playwright/test';

/**
 * 実機が無くても印刷の流れをテストできるように、Web Bluetooth の偽物を差し込む。
 * あわせて Canvas の fillText を記録し、印刷用に描画された文字列を確認できるようにする。
 *
 * - window.__fakePrinter.bytesWritten: プリンタに送られたバイト数
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

    const state = { bytesWritten: 0, writes: 0, chunks: [] as Uint8Array[] };
    w.__fakePrinter = state;
    const record = (buf: ArrayBuffer | ArrayBufferView) => {
      state.bytesWritten += (buf as any).byteLength;
      state.writes++;
      const bytes = buf instanceof ArrayBuffer
        ? new Uint8Array(buf)
        : new Uint8Array((buf as ArrayBufferView).buffer, (buf as ArrayBufferView).byteOffset, (buf as ArrayBufferView).byteLength);
      state.chunks.push(bytes.slice());
    };

    const writeChar = {
      properties: { write: true, writeWithoutResponse: true, read: false, notify: false },
      async writeValueWithoutResponse(buf: ArrayBuffer | ArrayBufferView) { record(buf); },
      async writeValue(buf: ArrayBuffer | ArrayBufferView) { record(buf); },
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
        async connect() { device.gatt.connected = true; return { getPrimaryService: async () => service }; },
        disconnect() { device.gatt.connected = false; },
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

/** 送られたバイト列を消す */
export async function resetSentBytes(page: Page) {
  await page.evaluate(() => { (window as any).__fakePrinter.chunks = []; });
}

/**
 * 最後に送られた ESC/POS のラスター(GS v 0)を取り出す。
 * 黒い点の数と、その平均の位置(画像の幅・高さに対する 0〜1 の割合)も返す。
 */
export async function getLastRaster(page: Page) {
  return page.evaluate(() => {
    const chunks: Uint8Array[] = (window as any).__fakePrinter.chunks;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    let start = -1;
    for (let i = all.length - 8; i >= 0; i--) {
      if (all[i] === 0x1d && all[i + 1] === 0x76 && all[i + 2] === 0x30 && all[i + 3] === 0x00) { start = i; break; }
    }
    if (start < 0) return null;
    const widthBytes = all[start + 4] | (all[start + 5] << 8);
    const heightLines = all[start + 6] | (all[start + 7] << 8);
    const data = all.subarray(start + 8, start + 8 + widthBytes * heightLines);
    let black = 0, sumX = 0, sumY = 0;
    for (let y = 0; y < heightLines; y++) {
      for (let x = 0; x < widthBytes * 8; x++) {
        if (data[y * widthBytes + (x >> 3)] & (0x80 >> (x & 7))) { black++; sumX += x; sumY += y; }
      }
    }
    return {
      widthBytes,
      heightLines,
      black,
      meanX: black ? sumX / black / (widthBytes * 8) : null,
      meanY: black ? sumY / black / heightLines : null,
    };
  });
}
