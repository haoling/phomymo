import { Page, Route } from '@playwright/test';

/**
 * Googleログイン(GIS)と Drive API(appDataFolder)の偽物。
 * 本物の OAuth クライアントIDが無くても、ログイン・同期の流れをテストできるようにする。
 *
 * - FakeDrive は Node 側のメモリに置くので、複数の BrowserContext(=端末)で共有できる
 * - GIS は addInitScript で window.google を差し込む
 */

export interface FakeFile {
  id: string;
  name: string;
  parents: string[];
  appProperties: Record<string, string>;
  modifiedTime: string;
  content: string;
}

export interface FakeUser {
  permissionId: string;
  emailAddress: string;
  displayName: string;
}

export const TEST_USER: FakeUser = {
  permissionId: 'perm-hao-0001',
  emailAddress: 'hao@example.com',
  displayName: 'はおりん',
};

export interface FakeSheet {
  sheetId: number;
  title: string;
  hidden?: boolean;
  values: string[][];
}

export interface FakeSpreadsheet {
  id: string;
  title: string;
  sheets: FakeSheet[];
}

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export class FakeDrive {
  files = new Map<string, FakeFile>();
  validTokens = new Set<string>();
  /** トークンごとのスコープ */
  tokenScopes = new Map<string, Set<string>>();
  /** 利用者が許可したスコープ(include_granted_scopes で次のトークンにも入る) */
  grantedScopes = new Set<string>(['https://www.googleapis.com/auth/drive.appdata']);
  /** Googleスプレッドシート(Sheets API の偽物) */
  spreadsheets = new Map<string, FakeSpreadsheet>();
  /** drive.file: Picker で選ばれた(=アプリが読める)ファイル */
  pickedFiles = new Set<string>();
  sheetsRequests: string[] = [];
  tokenSeq = 0;
  fileSeq = 0;
  requests: string[] = [];
  user: FakeUser;

  constructor(user: FakeUser = TEST_USER) {
    this.user = user;
  }

  issueToken(scope = '') {
    if (scope) for (const sc of scope.split(/\s+/)) if (sc) this.grantedScopes.add(sc);
    const t = `tok-${++this.tokenSeq}`;
    this.validTokens.add(t);
    this.tokenScopes.set(t, new Set(this.grantedScopes));
    return { token: t, scope: [...this.grantedScopes].join(' ') };
  }

  putSpreadsheet(sp: FakeSpreadsheet) {
    this.spreadsheets.set(sp.id, sp);
  }

  /** Sheets API の偽物 */
  async handleSheets(rawRoute: Route) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    const req = rawRoute.request();
    if (req.method() === 'OPTIONS') return rawRoute.fulfill({ status: 204, body: '', headers: cors });
    const json = (status: number, body: any) =>
      rawRoute.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: cors });
    const url = new URL(req.url());
    this.sheetsRequests.push(`${req.method()} ${decodeURIComponent(url.pathname)}${url.search ? decodeURIComponent(url.search) : ''}`);
    const token = (req.headers()['authorization'] || '').replace(/^Bearer\s+/, '');
    if (!this.validTokens.has(token)) return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
    if (!this.tokenScopes.get(token)?.has(DRIVE_FILE_SCOPE)) return json(403, { error: { code: 403, message: 'Request had insufficient authentication scopes.' } });
    const m = /^\/v4\/spreadsheets\/([^/:]+)(\/values:batchGet)?$/.exec(url.pathname);
    if (!m) return json(400, { error: { message: `unhandled ${url.pathname}` } });
    const id = decodeURIComponent(m[1]);
    const sp = this.spreadsheets.get(id);
    // drive.file では、選ばれていないファイルは見えない
    if (!sp || !this.pickedFiles.has(id)) return json(404, { error: { code: 404, message: 'Requested entity was not found.' } });
    if (!m[2]) {
      return json(200, {
        properties: { title: sp.title },
        sheets: sp.sheets.map((sh, index) => ({ properties: { sheetId: sh.sheetId, title: sh.title, index, hidden: !!sh.hidden, sheetType: 'GRID' } })),
      });
    }
    const ranges = url.searchParams.getAll('ranges');
    const valueRanges = ranges.map((r) => {
      const title = /^'(.*)'$/.exec(r)?.[1]?.replace(/''/g, "'") ?? r;
      const sh = sp.sheets.find(x => x.title === title);
      return { range: r, majorDimension: 'ROWS', ...(sh && sh.values.length ? { values: sh.values } : {}) };
    });
    if (valueRanges.some((v, i) => !sp.sheets.find(x => `'${x.title.replace(/'/g, "''")}'` === ranges[i]))) {
      return json(400, { error: { code: 400, message: 'Unable to parse range' } });
    }
    return json(200, { spreadsheetId: id, valueRanges });
  }

  /** サーバー側でトークンを全部失効させる(期限切れの再現) */
  expireAllTokens() {
    this.validTokens.clear();
  }

  designFiles() {
    return [...this.files.values()].filter(f => f.name.startsWith('design-'));
  }

  designContents(): any[] {
    return this.designFiles().map(f => JSON.parse(f.content));
  }

  /** テスト用: Drive に直接ファイルを置く(他の端末が書いたものの代わり) */
  putDesign(rec: { id: string; name: string; updatedAt: number; deleted: boolean; design: any }) {
    const id = `file-${++this.fileSeq}`;
    this.files.set(id, {
      id,
      name: `design-${rec.id}.json`,
      parents: ['appDataFolder'],
      appProperties: { updatedAt: String(rec.updatedAt), deleted: String(rec.deleted) },
      modifiedTime: new Date().toISOString(),
      content: JSON.stringify(rec),
    });
    return id;
  }

  async handle(rawRoute: Route) {
    // どの応答にも CORS のヘッダーを付ける
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    const route = {
      fulfill: (o: any) => rawRoute.fulfill({ ...o, headers: { ...cors, ...(o.headers || {}) } }),
    };
    const req = rawRoute.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, body: '' });
    const url = new URL(req.url());
    const method = req.method();
    this.requests.push(`${method} ${url.pathname}`);

    const auth = req.headers()['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/, '');
    if (!this.validTokens.has(token)) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }) });
    }
    const json = (status: number, body: any) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    const p = url.pathname;
    if (method === 'GET' && p === '/drive/v3/about') {
      return json(200, { user: this.user });
    }
    if (method === 'GET' && p === '/drive/v3/files') {
      if (url.searchParams.get('spaces') !== 'appDataFolder') return json(400, { error: { message: 'spaces must be appDataFolder' } });
      return json(200, {
        files: [...this.files.values()].map(f => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, appProperties: f.appProperties })),
      });
    }
    const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (m) {
      const f = this.files.get(decodeURIComponent(m[1]));
      if (!f) return json(404, { error: { code: 404, message: 'File not found' } });
      if (method === 'GET' && url.searchParams.get('alt') === 'media') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: f.content });
      }
      if (method === 'DELETE') {
        this.files.delete(f.id);
        return route.fulfill({ status: 204, body: '' });
      }
    }
    const up = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(p);
    if (up && url.searchParams.get('uploadType') === 'multipart') {
      const { meta, content } = parseMultipart(req.headers()['content-type'] || '', req.postData() || '');
      if (method === 'POST' && !up[1]) {
        if (!Array.isArray(meta.parents) || meta.parents[0] !== 'appDataFolder') return json(400, { error: { message: 'must be in appDataFolder' } });
        const id = `file-${++this.fileSeq}`;
        const f: FakeFile = { id, name: meta.name, parents: meta.parents, appProperties: meta.appProperties || {}, modifiedTime: new Date().toISOString(), content };
        this.files.set(id, f);
        return json(200, { id, name: f.name, modifiedTime: f.modifiedTime, appProperties: f.appProperties });
      }
      if (method === 'PATCH' && up[1]) {
        const f = this.files.get(decodeURIComponent(up[1]));
        if (!f) return json(404, { error: { code: 404, message: 'File not found' } });
        f.content = content;
        f.appProperties = { ...f.appProperties, ...(meta.appProperties || {}) };
        f.modifiedTime = new Date().toISOString();
        return json(200, { id: f.id, name: f.name, modifiedTime: f.modifiedTime, appProperties: f.appProperties });
      }
    }
    return json(400, { error: { message: `unhandled ${method} ${p}` } });
  }
}

function parseMultipart(contentType: string, body: string) {
  const b = /boundary=([^;]+)/.exec(contentType)?.[1];
  if (!b) throw new Error('no boundary');
  const parts = body.split(`--${b}`).slice(1, -1).map(part => {
    const idx = part.indexOf('\r\n\r\n');
    return part.slice(idx + 4).replace(/\r\n$/, '');
  });
  return { meta: JSON.parse(parts[0]), content: parts[1] };
}

/**
 * GIS の偽物と Drive の偽物を差し込む。
 * window.__fakeGis.denySilent = true にすると、prompt: '' の取り直しが失敗する(ポップアップがブロックされた状態)
 */
export async function installFakeGoogle(page: Page, drive: FakeDrive, opts: { clientId?: string } = {}) {
  await page.exposeFunction('__fakeIssueToken', (scope: string) => drive.issueToken(scope));
  await page.exposeFunction('__fakePick', (id: string) => { drive.pickedFiles.add(id); });
  await page.addInitScript((clientId) => {
    const w = window as any;
    w.__PHOMYMO_CONFIG__ = { googleClientId: clientId, syncDebounceMs: 200 };
    const gis = { requests: [] as any[], settled: 0, denySilent: false, denyScope: false, revoked: [] as string[] };
    w.__fakeGis = gis;
    // Google Picker の偽物: __fakePicker.next に選ぶファイル(null なら取り消し)
    const fakePicker: any = { next: null, shown: [] as any[] };
    w.__fakePicker = fakePicker;
    class DocsView { opts: any = {}; constructor(public viewId: string) {} setIncludeFolders() { return this; } setSelectFolderEnabled() { return this; } setMode() { return this; } }
    class PickerBuilder {
      cfg: any = { views: [] };
      addView(v: any) { this.cfg.views.push(v.viewId); return this; }
      setOAuthToken(tk: string) { this.cfg.token = tk; return this; }
      setDeveloperKey(k: string) { this.cfg.key = k; return this; }
      setAppId(a: string) { this.cfg.appId = a; return this; }
      setLocale(l: string) { this.cfg.locale = l; return this; }
      setTitle(tt: string) { this.cfg.title = tt; return this; }
      setCallback(cb: Function) { this.cfg.cb = cb; return this; }
      build() {
        const cfg = this.cfg;
        return {
          setVisible() {
            fakePicker.shown.push({ views: cfg.views, token: cfg.token, appId: cfg.appId, locale: cfg.locale, title: cfg.title });
            const doc = fakePicker.next;
            setTimeout(async () => {
              if (!doc) { cfg.cb({ action: 'cancel' }); return; }
              await w.__fakePick(doc.id);
              cfg.cb({ action: 'picked', docs: [{ id: doc.id, name: doc.name, url: `https://docs.google.com/spreadsheets/d/${doc.id}/edit` }] });
            }, 10);
          },
        };
      }
    }
    const picker = {
      DocsView, PickerBuilder,
      ViewId: { SPREADSHEETS: 'spreadsheets' },
      DocsViewMode: { LIST: 'list' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Document: { ID: 'id', NAME: 'name', URL: 'url' },
    };
    w.google = {
      picker,
      accounts: {
        oauth2: {
          initTokenClient(cfg: any) {
            const client: any = {
              callback: cfg.callback,
              error_callback: cfg.error_callback,
              requestAccessToken(params: any = {}) {
                gis.requests.push({ ...params });
                setTimeout(async () => {
                  if (params.prompt === '' && gis.denySilent) {
                    gis.settled++;
                    client.error_callback?.({ type: 'popup_failed_to_open', message: 'Failed to open popup window' });
                    return;
                  }
                  if (params.scope && gis.denyScope) {
                    // 同意画面で追加のスコープを外された
                    const issued = await w.__fakeIssueToken('');
                    gis.settled++;
                    client.callback({ access_token: issued.token, expires_in: 3599, scope: issued.scope, token_type: 'Bearer' });
                    return;
                  }
                  const issued = await w.__fakeIssueToken(params.scope || cfg.scope);
                  gis.settled++;
                  client.callback({ access_token: issued.token, expires_in: 3599, scope: issued.scope, token_type: 'Bearer' });
                }, 10);
              },
            };
            return client;
          },
          revoke(token: string, cb: Function) {
            gis.revoked.push(token);
            cb?.({ successful: true });
          },
        },
      },
    };
  }, opts.clientId ?? 'test-client-id.apps.googleusercontent.com');
  await page.route('https://www.googleapis.com/**', (route) => drive.handle(route));
  await page.route('https://sheets.googleapis.com/**', (route) => drive.handleSheets(route));
}

/** アカウントのダイアログからログインする */
export async function loginViaUI(page: Page) {
  await page.click('#account-btn');
  await page.click('#account-login-btn');
  await page.waitForFunction(() => document.querySelector('#account-btn')?.getAttribute('data-state') === 'synced', null, { timeout: 10_000 });
}

/** 同期が落ち着くまで待つ(未送信が無く、同期済み) */
export async function waitForSynced(page: Page, timeout = 10_000) {
  await page.waitForFunction(() => document.querySelector('#account-btn')?.getAttribute('data-state') === 'synced', null, { timeout });
}

/** GIS への要求が全部終わるまで待つ */
export async function waitForGisSettled(page: Page) {
  await page.waitForFunction(() => {
    const g = (window as any).__fakeGis;
    return g.settled === g.requests.length;
  });
  await page.waitForTimeout(100);
}
