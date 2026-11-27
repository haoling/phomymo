/**
 * 端末間の同期(#40): Google Drive の appDataFolder にデザインを1件1ファイルで置く
 *
 * - ファイル名: design-<uuid>.json
 * - 中身: { id, name, updatedAt, deleted, design }
 * - appProperties に updatedAt / deleted を持たせ、一覧だけで新旧を比べられるようにする
 * - 競合はファイル(=デザイン)単位で「updatedAt が新しいほうが勝つ」
 * - 削除は墓標(deleted: true)。tombstoneTtlDays を過ぎたら物理削除する
 * - 手元(localStorage)はキャッシュ。変更は先に手元へ書き(dirty)、あとで Drive に送る
 */

import { CONFIG } from './config.js';
import * as kv from './kv.js';
import * as auth from './auth.js';
import { createDriveClient } from './drive.js';
import {
  getDesignRecords,
  putDesignRecord,
  removeDesignRecord,
  countUnsyncedDesigns,
  DESIGN_RECORDS_KEY,
} from './storage.js?v=104';

const FILE_RE = /^design-([0-9a-zA-Z-]{8,})\.json$/;
const DAY_MS = 24 * 60 * 60 * 1000;

let status = { state: 'off', unsynced: 0, lastSyncedAt: 0, error: '' };
const statusListeners = new Set();
const pulledListeners = new Set();

let started = false;
let running = null;
let rerun = false;
let applying = 0;
let debounceTimer = null;
let intervalTimer = null;
let offKv = null;

const drive = createDriveClient({ refresh: refreshInBackground });

/** ボタン操作の直後なら、無言でトークンを取り直してみる(ポップアップがブロックされないため) */
async function refreshInBackground() {
  const active = navigator.userActivation ? navigator.userActivation.isActive : false;
  if (!active || !auth.isGisReady()) throw new auth.AuthRequiredError();
  await auth.requestToken({ prompt: '', hint: kv.getSession()?.email || '', timeoutMs: 15000 });
}

function setStatus(patch) {
  status = { ...status, ...patch };
  if (!kv.isGuest()) {
    try { status.unsynced = countUnsyncedDesigns(); } catch { /* ignore */ }
  }
  for (const fn of statusListeners) {
    try { fn({ ...status }); } catch (e) { console.error(e); }
  }
}

export function getStatus() {
  return { ...status };
}

/** 同期の状態が変わったら呼ばれる */
export function onStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/** Drive から変更を取り込んだら呼ばれる(デザイン一覧の更新用) */
export function onPulled(fn) {
  pulledListeners.add(fn);
  return () => pulledListeners.delete(fn);
}

function apply(fn) {
  applying++;
  try { return fn(); } finally { applying--; }
}

function remoteUpdatedAt(file) {
  const n = Number(file.appProperties?.updatedAt);
  if (Number.isFinite(n) && n > 0) return n;
  return Date.parse(file.modifiedTime) || 0;
}

function isRemoteDeleted(file) {
  return file.appProperties?.deleted === 'true';
}

function payloadOf(rec) {
  return {
    id: rec.id,
    name: rec.name,
    updatedAt: rec.updatedAt,
    deleted: !!rec.deleted,
    design: rec.deleted ? null : rec.design,
  };
}

function propsOf(rec) {
  return { updatedAt: String(rec.updatedAt), deleted: String(!!rec.deleted), format: '1' };
}

async function syncOnce() {
  if (kv.isGuest()) return;

  if (!auth.hasValidToken()) {
    try {
      await refreshInBackground();
    } catch {
      setStatus({ state: 'needs-auth', error: '' });
      return;
    }
  }

  setStatus({ state: 'syncing', error: '' });
  const ttlBorder = Date.now() - CONFIG.tombstoneTtlDays * DAY_MS;
  let pulled = 0;

  // 1. Drive の一覧(同じ uuid のファイルが複数あれば新しいものだけ残す)
  const files = await drive.listFiles();
  const remote = new Map();
  const duplicates = [];
  for (const f of files) {
    const m = FILE_RE.exec(f.name || '');
    if (!m) continue;
    const id = m[1];
    const ra = remoteUpdatedAt(f);
    const cur = remote.get(id);
    if (cur && cur.ra >= ra) {
      duplicates.push(f);
    } else {
      if (cur) duplicates.push(cur.file);
      remote.set(id, { file: f, ra });
    }
  }
  for (const f of duplicates) await drive.remove(f.id);

  // 2. Drive → 手元
  let local = getDesignRecords();
  for (const [id, { file, ra }] of remote) {
    const l = local[id];
    const deleted = isRemoteDeleted(file);

    if (deleted && ra < ttlBorder) {
      // 期限切れの墓標は物理削除
      await drive.remove(file.id);
      if (l) apply(() => removeDesignRecord(id));
      continue;
    }

    if (!l) {
      if (deleted) continue; // 手元に無いものの墓標は取り込まなくてよい
    } else if (ra <= l.updatedAt) {
      if (ra === l.updatedAt && (l.dirty || l.driveFileId !== file.id)) {
        apply(() => putDesignRecord({ ...l, driveFileId: file.id, dirty: false }, { ifUpdatedAt: l.updatedAt }));
      } else if (l.driveFileId !== file.id) {
        apply(() => putDesignRecord({ ...l, driveFileId: file.id }, { ifUpdatedAt: l.updatedAt }));
      }
      continue; // 手元のほうが新しい(あとで送る)か、同じ
    }

    // Drive のほうが新しい
    let rec;
    if (deleted) {
      rec = { id, name: l?.name || '', updatedAt: ra, deleted: true, design: null };
    } else {
      const data = await drive.download(file.id);
      if (!data || typeof data !== 'object') continue;
      rec = {
        id,
        name: String(data.name || ''),
        updatedAt: Number(data.updatedAt) || ra,
        deleted: !!data.deleted,
        design: data.deleted ? null : (data.design || null),
      };
    }
    rec.driveFileId = file.id;
    rec.dirty = false;
    const wrote = apply(() => putDesignRecord(rec, l ? { ifUpdatedAt: l.updatedAt } : { ifUpdatedAt: undefined }));
    if (wrote) pulled++;
  }

  // 3. 手元にだけあるもの
  local = getDesignRecords();
  for (const l of Object.values(local)) {
    if (remote.has(l.id)) continue;
    if (l.driveFileId && !l.dirty) {
      // 一度送ったのに Drive から消えている = 他の端末で物理削除された
      apply(() => removeDesignRecord(l.id));
      pulled++;
    } else if (l.deleted && (!l.driveFileId || l.updatedAt < ttlBorder)) {
      // 一度も送っていない削除は送らなくてよい
      apply(() => removeDesignRecord(l.id));
    }
  }

  // 4. 手元 → Drive
  local = getDesignRecords();
  for (const l of Object.values(local)) {
    if (!l.dirty) continue;
    let res = null;
    if (l.driveFileId) {
      try {
        res = await drive.update(l.driveFileId, payloadOf(l), propsOf(l));
      } catch (e) {
        if (e.status !== 404) throw e;
        res = null; // 消えていたら作り直す
      }
    }
    if (!res) res = await drive.create(`design-${l.id}.json`, payloadOf(l), propsOf(l));
    apply(() => putDesignRecord({ ...l, driveFileId: res.id, dirty: false }, { ifUpdatedAt: l.updatedAt }));
  }

  setStatus({ state: 'synced', lastSyncedAt: Date.now(), error: '' });
  if (pulled > 0) {
    for (const fn of pulledListeners) {
      try { fn(); } catch (e) { console.error(e); }
    }
  }
}

/** 今すぐ同期する(実行中なら、終わったあとにもう1回) */
export function syncNow() {
  if (kv.isGuest()) return Promise.resolve();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerun = false;
        await syncOnce();
      } while (rerun);
    } catch (e) {
      if (e instanceof auth.AuthRequiredError) {
        setStatus({ state: 'needs-auth', error: '' });
      } else {
        console.error('Sync failed:', e);
        setStatus({ state: 'error', error: e.message || String(e) });
      }
    } finally {
      running = null;
    }
    // 同期中に手元で変更があれば、もう一度
    if (status.state === 'synced' && countUnsyncedDesigns() > 0) schedule();
  })();
  return running;
}

/** 少し待ってから同期する(続けて変更されたらまとめる) */
export function schedule(delay = CONFIG.syncDebounceMs) {
  if (!started || kv.isGuest()) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    syncNow();
  }, delay);
  setStatus({});
}

function onVisible() {
  if (document.visibilityState === 'visible') schedule(0);
}

/** ログイン中の同期を始める */
export function start() {
  if (started || kv.isGuest()) return;
  started = true;
  offKv = kv.onChange((key) => {
    if (applying) return;
    if (key === DESIGN_RECORDS_KEY) schedule();
  });
  intervalTimer = setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, CONFIG.syncIntervalMs);
  document.addEventListener('visibilitychange', onVisible);
  setStatus({ state: auth.hasValidToken() ? 'synced' : 'needs-auth' });
}

/** 同期をやめる(ログアウト時) */
export function stop() {
  started = false;
  offKv?.();
  offKv = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  debounceTimer = null;
  intervalTimer = null;
  document.removeEventListener('visibilitychange', onVisible);
  status = { state: 'off', unsynced: 0, lastSyncedAt: 0, error: '' };
  for (const fn of statusListeners) {
    try { fn({ ...status }); } catch (e) { console.error(e); }
  }
}

/** 同期まわりの Drive クライアント(account.js がログイン時に使う) */
export function getDrive() {
  return drive;
}
