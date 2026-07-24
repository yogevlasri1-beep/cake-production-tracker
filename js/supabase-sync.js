/**
 * Continuous multi-device sync: IndexedDB ↔ Supabase sync_* tables.
 * Last-write-wins by updated_at. Soft-delete via deleted_at.
 */
import { db, getSetting, setSetting } from './db.js?v=352';
import {
  getSupabaseBackupConfig,
  saveSupabaseBackupConfig,
  buildSupabaseRestUrl,
  buildSupabaseHeaders,
  getOrCreateDeviceId,
  BACKUP_SCOPE_ID,
} from './supabase-backup.js?v=352';
import {
  COLLECTION_TABLE,
  KITCHEN_ID,
  isSyncCollection,
  orderedCollections,
  shouldApplyRemote,
} from './sync/collections.js?v=352';
import {
  ensureSyncId,
  getMetaByLocal,
  getMetaBySyncId,
  localKeyOf,
  markMetaDeleted,
  remapFksToLocalIds,
  remapFksToSyncIds,
  upsertMeta,
} from './sync/id-map.js?v=352';

const LIVE_SYNC_SETTINGS = 'liveSync';
const DEFAULT_LIVE = {
  enabled: true,
  lastPullAt: null,
  lastPushAt: null,
  lastError: null,
  seedDone: false,
  pendingCount: 0,
};

let applyingRemote = false;
let flushTimer = null;
let pullTimer = null;
let started = false;
let statusListeners = new Set();

export function onLiveSyncStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function emitStatus(patch) {
  for (const fn of statusListeners) {
    try { fn(patch); } catch { /* ignore */ }
  }
}

export async function getLiveSyncSettings() {
  const saved = await getSetting(LIVE_SYNC_SETTINGS);
  return { ...DEFAULT_LIVE, ...(saved || {}) };
}

export async function saveLiveSyncSettings(patch) {
  const cur = await getLiveSyncSettings();
  const next = { ...cur, ...patch };
  await setSetting(LIVE_SYNC_SETTINGS, next);
  emitStatus(next);
  return next;
}

export function isApplyingRemoteSync() {
  return applyingRemote;
}

async function supabaseFetch(cfg, path, { method = 'GET', body, headers = {} } = {}) {
  const url = buildSupabaseRestUrl(cfg.supabaseUrl, path);
  const res = await fetch(url, {
    method,
    headers: buildSupabaseHeaders(cfg.anonKey, headers),
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errJson = await res.json();
      detail = errJson.message || errJson.error || errJson.hint || detail;
    } catch { /* ignore */ }
    throw new Error(`Supabase sync: ${detail || res.status}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function tableOf(collection) {
  return COLLECTION_TABLE[collection];
}

async function enqueue(op) {
  await db.syncQueue.add({
    ...op,
    createdAt: new Date().toISOString(),
    status: 'pending',
  });
  const pending = await db.syncQueue.where('status').equals('pending').count();
  await saveLiveSyncSettings({ pendingCount: pending });
  scheduleFlush();
}

export async function enqueueUpsert(collection, localKey) {
  if (!isSyncCollection(collection) || applyingRemote) return;
  if (collection === 'settings') {
    const skip = new Set([
      'liveSync', 'supabaseBackup', 'deviceId', 'backupSettings',
      'recipePortionPresetsSynced',
    ]);
    if (skip.has(String(localKey))) return;
  }
  const live = await getLiveSyncSettings();
  if (!live.enabled) return;
  await enqueue({ type: 'upsert', collection, localKey: String(localKey) });
}

export async function enqueueDelete(collection, localKey) {
  if (!isSyncCollection(collection) || applyingRemote) return;
  const live = await getLiveSyncSettings();
  if (!live.enabled) return;
  await enqueue({ type: 'delete', collection, localKey: String(localKey) });
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushSyncQueue().catch((err) => console.warn('sync flush', err));
  }, 400);
}

async function readLocalRecord(collection, localKey) {
  const table = db[collection];
  if (!table) return null;
  if (collection === 'settings') return table.get(localKey);
  const id = Number(localKey);
  if (!Number.isFinite(id)) return null;
  return table.get(id);
}

async function pushUpsert(cfg, collection, localKey, deviceId) {
  const row = await readLocalRecord(collection, localKey);
  if (!row) return;
  const updatedAt = new Date().toISOString();
  const syncId = await ensureSyncId(collection, localKey, { updatedAt });
  const payload = await remapFksToSyncIds(collection, row);
  if (collection === 'settings') payload.key = row.key;
  const cloudRow = {
    id: syncId,
    kitchen_id: KITCHEN_ID || BACKUP_SCOPE_ID,
    payload,
    updated_at: updatedAt,
    deleted_at: null,
    device_id: deviceId,
  };
  const table = tableOf(collection);
  await supabaseFetch(cfg, `/${table}?on_conflict=id`, {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: cloudRow,
  });
  await upsertMeta({ collection, localKey, syncId, updatedAt, deletedAt: null });
}

async function pushDelete(cfg, collection, localKey, deviceId) {
  const updatedAt = new Date().toISOString();
  let syncId = await markMetaDeleted(collection, localKey, updatedAt);
  if (!syncId) syncId = await ensureSyncId(collection, localKey, { updatedAt });
  const table = tableOf(collection);
  await supabaseFetch(cfg, `/${table}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: {
      id: syncId,
      kitchen_id: KITCHEN_ID,
      payload: {},
      updated_at: updatedAt,
      deleted_at: updatedAt,
      device_id: deviceId,
    },
  });
}

export async function flushSyncQueue() {
  const live = await getLiveSyncSettings();
  if (!live.enabled) return { flushed: 0 };
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) return { flushed: 0 };

  const deviceId = await getOrCreateDeviceId();
  const pending = await db.syncQueue.where('status').equals('pending').sortBy('createdAt');
  let flushed = 0;
  for (const item of pending) {
    try {
      if (item.type === 'delete') {
        await pushDelete(cfg, item.collection, item.localKey, deviceId);
      } else {
        await pushUpsert(cfg, item.collection, item.localKey, deviceId);
      }
      await db.syncQueue.update(item.id, { status: 'done' });
      flushed++;
    } catch (err) {
      await db.syncQueue.update(item.id, { status: 'error', error: String(err.message || err) });
      await saveLiveSyncSettings({ lastError: String(err.message || err) });
      emitStatus({ lastError: String(err.message || err) });
      break;
    }
  }
  await db.syncQueue.where('status').equals('done').delete();
  const pendingCount = await db.syncQueue.where('status').equals('pending').count();
  await saveLiveSyncSettings({
    pendingCount,
    lastPushAt: flushed ? new Date().toISOString() : live.lastPushAt,
    lastError: flushed ? null : live.lastError,
  });
  return { flushed };
}

async function applyRemoteRow(collection, cloudRow, deviceId) {
  if (!cloudRow?.id) return false;
  if (cloudRow.device_id && cloudRow.device_id === deviceId) {
    // Still apply deletes/updates from same device after reinstall; allow always for simplicity
  }

  const syncId = cloudRow.id;
  const remoteUpdated = cloudRow.updated_at;
  const existingMeta = await getMetaBySyncId(syncId);

  if (cloudRow.deleted_at) {
    if (existingMeta) {
      const local = await readLocalRecord(collection, existingMeta.localKey);
      if (local) {
        if (collection === 'settings') await db.settings.delete(existingMeta.localKey);
        else await db[collection].delete(Number(existingMeta.localKey));
      }
      await upsertMeta({
        collection,
        localKey: existingMeta.localKey,
        syncId,
        updatedAt: remoteUpdated,
        deletedAt: cloudRow.deleted_at,
      });
    }
    return true;
  }

  if (existingMeta && !shouldApplyRemote(existingMeta.updatedAt, remoteUpdated)) {
    return false;
  }

  const payload = await remapFksToLocalIds(collection, cloudRow.payload || {});

  if (collection === 'settings') {
    const key = payload.key || existingMeta?.localKey;
    if (!key) return false;
    applyingRemote = true;
    try {
      await db.settings.put({ key, value: payload.value });
      await upsertMeta({ collection, localKey: key, syncId, updatedAt: remoteUpdated });
    } finally {
      applyingRemote = false;
    }
    return true;
  }

  applyingRemote = true;
  try {
    if (existingMeta) {
      const localId = Number(existingMeta.localKey);
      const { id: _drop, ...rest } = payload;
      await db[collection].update(localId, rest);
      await upsertMeta({
        collection,
        localKey: existingMeta.localKey,
        syncId,
        updatedAt: remoteUpdated,
      });
    } else {
      const { id: _drop, ...rest } = payload;
      const newId = await db[collection].add(rest);
      await upsertMeta({
        collection,
        localKey: String(newId),
        syncId,
        updatedAt: remoteUpdated,
      });
    }
  } finally {
    applyingRemote = false;
  }
  return true;
}

export async function pullCollection(collection, { since } = {}) {
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) return 0;
  const table = tableOf(collection);
  let path = `/${table}?kitchen_id=eq.${encodeURIComponent(KITCHEN_ID)}&select=*&order=updated_at.asc`;
  if (since) {
    path += `&updated_at=gt.${encodeURIComponent(since)}`;
  }
  const rows = await supabaseFetch(cfg, path);
  if (!Array.isArray(rows) || !rows.length) return 0;
  const deviceId = await getOrCreateDeviceId();
  let applied = 0;
  for (const row of rows) {
    const ok = await applyRemoteRow(collection, row, deviceId);
    if (ok) applied++;
  }
  return applied;
}

export async function pullAllCollections({ full = false } = {}) {
  const live = await getLiveSyncSettings();
  if (!live.enabled) return { applied: 0 };
  const since = full ? null : live.lastPullAt;
  let applied = 0;
  const pullStarted = new Date().toISOString();
  try {
    for (const collection of orderedCollections()) {
      applied += await pullCollection(collection, { since });
    }
    await saveLiveSyncSettings({ lastPullAt: pullStarted, lastError: null });
  } catch (err) {
    await saveLiveSyncSettings({ lastError: String(err.message || err) });
    throw err;
  }
  return { applied };
}

/** One-time / on-demand: push all local rows to cloud (seed). */
export async function seedLocalDataToSupabase({ force = false } = {}) {
  const live = await getLiveSyncSettings();
  if (live.seedDone && !force) return { seeded: 0, skipped: true };
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) throw new Error('Supabase לא מוגדר');

  const deviceId = await getOrCreateDeviceId();
  let seeded = 0;
  for (const collection of orderedCollections()) {
    const table = db[collection];
    if (!table) continue;
    const rows = await table.toArray();
    for (const row of rows) {
      const localKey = localKeyOf(collection, row);
      if (!localKey) continue;
      await pushUpsert(cfg, collection, localKey, deviceId);
      seeded++;
    }
  }
  await saveLiveSyncSettings({
    lastPushAt: new Date().toISOString(),
    lastError: null,
  });
  return { seeded };
}

/** Install Dexie middleware to enqueue local mutations. */
export function installLiveSyncMiddleware() {
  if (db._liveSyncInstalled) return;
  db._liveSyncInstalled = true;

  db.use({
    stack: 'dbcore',
    name: 'LiveSyncMiddleware',
    create(downlevelDatabase) {
      return {
        ...downlevelDatabase,
        table(tableName) {
          const table = downlevelDatabase.table(tableName);
          if (!isSyncCollection(tableName)) return table;
          return {
            ...table,
            mutate(req) {
              return table.mutate(req).then(async (res) => {
                if (applyingRemote) return res;
                try {
                  const live = await getLiveSyncSettings();
                  if (!live.enabled) return res;

                  if (req.type === 'add') {
                    const keys = res.results || [];
                    for (const k of keys) {
                      await enqueueUpsert(tableName, localKeyOf(tableName, { id: k, key: k }));
                    }
                  } else if (req.type === 'put') {
                    const values = req.values || [];
                    for (const v of values) {
                      await enqueueUpsert(tableName, localKeyOf(tableName, v));
                    }
                  } else if (req.type === 'delete') {
                    const keys = req.keys || [];
                    for (const k of keys) {
                      await enqueueDelete(tableName, String(k));
                    }
                  } else if (req.type === 'deleteRange') {
                    // Full re-seed on next pull/push cycle is safer; skip
                  }
                } catch (err) {
                  console.warn('live sync enqueue', err);
                }
                return res;
              });
            },
          };
        },
      };
    },
  });
}

export async function startLiveSync() {
  if (started) return;
  started = true;
  installLiveSyncMiddleware();

  const live = await getLiveSyncSettings();
  if (!live.enabled) return;

  const tick = async () => {
    try {
      await flushSyncQueue();
      await pullAllCollections({ full: false });
    } catch (err) {
      console.warn('live sync tick', err);
    }
  };

  await tick();
  if (!live.seedDone) {
    try {
      const cfg = await getSupabaseBackupConfig();
      const sample = await supabaseFetch(
        cfg,
        `/sync_products?select=id&limit=1`,
      );
      const cloudHasData = Array.isArray(sample) && sample.length > 0;
      if (cloudHasData) {
        await pullAllCollections({ full: true });
        await seedLocalDataToSupabase({ force: true });
      } else {
        await seedLocalDataToSupabase({ force: true });
        await pullAllCollections({ full: true });
      }
      await saveLiveSyncSettings({ seedDone: true });
    } catch (err) {
      console.warn('live sync seed', err);
      await saveLiveSyncSettings({ lastError: String(err.message || err) });
    }
  }

  pullTimer = setInterval(tick, 5000);
  window.addEventListener('online', () => tick());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
}

export async function stopLiveSync() {
  if (pullTimer) clearInterval(pullTimer);
  pullTimer = null;
  started = false;
}

export async function setLiveSyncEnabled(enabled) {
  await saveLiveSyncSettings({ enabled: !!enabled });
  if (enabled) {
    started = false;
    await startLiveSync();
  } else {
    await stopLiveSync();
  }
}

export async function getLiveSyncStatus() {
  const [live, cfg, deviceId, pending] = await Promise.all([
    getLiveSyncSettings(),
    getSupabaseBackupConfig(),
    getOrCreateDeviceId(),
    db.syncQueue?.where?.('status')?.equals?.('pending')?.count?.() ?? 0,
  ]);
  return {
    ...live,
    pendingCount: pending || live.pendingCount || 0,
    deviceId,
    kitchenId: KITCHEN_ID,
    supabaseConfigured: !!(cfg.supabaseUrl && cfg.anonKey),
    online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  };
}

/** Keep snapshot backups optional; live sync does not require primary-only. */
export async function ensureLiveSyncDefaults() {
  const cfg = await getSupabaseBackupConfig();
  if (cfg.liveSyncEnabled == null) {
    await saveSupabaseBackupConfig({ liveSyncEnabled: true });
  }
  const live = await getLiveSyncSettings();
  if (live.enabled == null) {
    await saveLiveSyncSettings({ enabled: true });
  }
  return getLiveSyncStatus();
}
