/**
 * Google Drive API(appDataFolder だけを使う)の薄いクライアント
 */

import { CONFIG } from './config.js';
import { getAccessToken, invalidateToken, AuthRequiredError } from './auth.js';

export class DriveError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
  }
}

/**
 * Drive に投げる。401 ならトークンを捨てて、refresh() で取り直せたら1回だけやり直す。
 * @param {string} method
 * @param {string} path - '/drive/v3/...'
 * @param {{body?: any, headers?: object, refresh?: () => Promise<any>, raw?: boolean}} opts
 */
async function call(method, path, opts = {}, retried = false) {
  const token = getAccessToken();
  const res = await fetch(CONFIG.driveApiBase + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
    body: opts.body,
  });
  if (res.status === 401) {
    invalidateToken();
    if (!retried && opts.refresh) {
      await opts.refresh(); // 失敗すれば AuthRequiredError が投げられる
      return call(method, path, opts, true);
    }
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    let msg = `Drive API ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error?.message) msg += `: ${j.error.message}`;
    } catch { /* ignore */ }
    throw new DriveError(msg, res.status);
  }
  if (res.status === 204) return null;
  if (opts.raw) return res.text();
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function multipart(metadata, content) {
  const boundary = `phomymo-${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    content + '\r\n' +
    `--${boundary}--`;
  return { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } };
}

export function createDriveClient({ refresh } = {}) {
  return {
    /** ログインしたアカウント(permissionId が安定したID) */
    getAbout() {
      return call('GET', '/drive/v3/about?fields=' + encodeURIComponent('user(permissionId,emailAddress,displayName)'), { refresh });
    },

    /** appDataFolder のファイルを全部 */
    async listFiles() {
      const out = [];
      let pageToken = '';
      do {
        const q = new URLSearchParams({
          spaces: 'appDataFolder',
          pageSize: '1000',
          fields: 'nextPageToken,files(id,name,modifiedTime,appProperties)',
        });
        if (pageToken) q.set('pageToken', pageToken);
        const res = await call('GET', `/drive/v3/files?${q}`, { refresh });
        out.push(...(res?.files || []));
        pageToken = res?.nextPageToken || '';
      } while (pageToken);
      return out;
    },

    async download(fileId) {
      const text = await call('GET', `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { refresh, raw: true });
      return JSON.parse(text);
    },

    async create(name, json, appProperties) {
      const { body, headers } = multipart(
        { name, parents: ['appDataFolder'], mimeType: 'application/json', appProperties },
        JSON.stringify(json),
      );
      return call('POST', '/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,appProperties', { body, headers, refresh });
    },

    async update(fileId, json, appProperties) {
      const { body, headers } = multipart({ appProperties }, JSON.stringify(json));
      return call('PATCH', `/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,modifiedTime,appProperties`, { body, headers, refresh });
    },

    async remove(fileId) {
      try {
        await call('DELETE', `/drive/v3/files/${encodeURIComponent(fileId)}`, { refresh });
      } catch (e) {
        if (e instanceof DriveError && e.status === 404) return; // もう無い
        throw e;
      }
    },
  };
}
