/**
 * Continuous multi-device sync: IndexedDB ↔ Supabase sync_* tables.
 * Last-write-wins by updated_at. Soft-delete via deleted_at.
 */
import { db, getSetting, setSetting } from './db.js?v=354';
import {
  getSupabaseBackupConfig,
  saveSupabaseBackupConfig,
  buildSupabaseRestUrl,
  buildSupabaseHeaders,
  getOrCreateDeviceId,
  BACKUP_SCOPE_ID,
} from './supabase-backup.js?v=354';
import {
  COLLECTION_TABLE,
  COLLECTION_FKS,
  KITCHEN_ID,
  isSyncCollection,
  orderedCollections,
  shouldApplyRemote,
  rowFingerprint,
} from './sync/collections.js?v=354';
import {
  ensureSyncId,
  getMetaByLocal,
  getMetaBySyncId,
  localKeyOf,
  markMetaDeleted,
  remapFksToLocalIds,
  remapFksToSyncIds,
  upsertMeta,
} from './sync/id-map.js?v=354';

const LIVE_SYNC_SETTINGS = 'liveSync';
const DEFAULT_LIVE = {
  enabled: true,
  lastPullAt: null,
  lastPushAt: null,
  lastError: null,
  seedDone: false,
  dedupeDone: false,
  dedupeVersion: 0,
  pendingCount: 0,
};

/** Bump when rowFingerprint rules change so devices re-run local dedupe. */
const DEDUPE_VERSION = 2;

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

async function findLocalByFingerprint(collection, fingerprint) {
  if (!fingerprint || !db[collection]) return null;
  const rows = await db[collection].toArray();
  return rows.find((r) => rowFingerprint(collection, r) === fingerprint) || null;
}

/** Retarget FK fields that point at fromLocalId → toLocalId within one device. */
async function retargetLocalForeignKeys(targetCollection, fromLocalId, toLocalId) {
  const from = Number(fromLocalId);
  const to = Number(toLocalId);
  if (!from || !to || from === to) return;
  for (const [collection, fks] of Object.entries(COLLECTION_FKS)) {
    const fields = Object.entries(fks).filter(([, dep]) => dep === targetCollection).map(([f]) => f);
    if (!fields.length || !db[collection]) continue;
    const rows = await db[collection].toArray();
    for (const row of rows) {
      const patch = {};
      for (const field of fields) {
        if (Number(row[field]) === from) patch[field] = to;
      }
      if (Object.keys(patch).length) {
        applyingRemote = true;
        try {
          await db[collection].update(row.id, patch);
        } finally {
          applyingRemote = false;
        }
      }
    }
  }
}

/**
 * One-time local dedupe: same fingerprint → keep lowest id, delete rest, retarget FKs.
 */
export async function dedupeLocalSyncCollections() {
  let removed = 0;
  for (const collection of orderedCollections()) {
    if (collection === 'settings' || !db[collection]) continue;
    const rows = await db[collection].toArray();
    const groups = new Map();
    for (const row of rows) {
      const fp = rowFingerprint(collection, row);
      if (!fp) continue;
      if (!groups.has(fp)) groups.set(fp, []);
      groups.get(fp).push(row);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => (a.id - b.id));
      const keep = list[0];
      for (const drop of list.slice(1)) {
        await retargetLocalForeignKeys(collection, drop.id, keep.id);
        const dropKey = localKeyOf(collection, drop);
        const dropMeta = await getMetaByLocal(collection, dropKey);
        applyingRemote = true;
        try {
          await db[collection].delete(drop.id);
        } finally {
          applyingRemote = false;
        }
        if (dropMeta?.syncId) {
          await markMetaDeleted(collection, dropKey, new Date().toISOString());
          await enqueue({ type: 'delete', collection, localKey: dropKey });
        } else {
          await db.syncMeta.where('[collection+localKey]').equals([collection, dropKey]).delete();
        }
        removed++;
      }
    }
  }
  return { removed };
}

async function applyRemoteRow(collection, cloudRow, deviceId) {
  if (!cloudRow?.id) return false;

  const syncId = cloudRow.id;
  const remoteUpdated = cloudRow.updated_at;
  let existingMeta = await getMetaBySyncId(syncId);

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

  // Match existing local row by fingerprint to avoid duplicates from multi-device seed
  if (!existingMeta) {
    const fp = rowFingerprint(collection, payload);
    const match = await findLocalByFingerprint(collection, fp);
    if (match) {
      existingMeta = {
        collection,
        localKey: String(match.id),
        syncId,
        updatedAt: remoteUpdated,
      };
    }
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

  // One-time per fingerprint version: remove local duplicates created by the
  // old pull-before-seed bug (v2 also covers production runs / step states).
  // Runs AFTER the first pull so cloud-side dedupe deletions land first;
  // otherwise two devices could each tombstone the other's kept copy.
  if (!live.dedupeDone || (live.dedupeVersion || 0) < DEDUPE_VERSION) {
    try {
      const result = await dedupeLocalSyncCollections();
      await saveLiveSyncSettings({ dedupeDone: true, dedupeVersion: DEDUPE_VERSION });
      if (result.removed) console.info('live sync local dedupe removed', result.removed);
    } catch (err) {
      console.warn('live sync local dedupe', err);
    }
  }

  if (!live.seedDone) {
    try {
      const cfg = await getSupabaseBackupConfig();
      const sample = await supabaseFetch(cfg, `/sync_products?select=id&limit=1`);
      const cloudHasData = Array.isArray(sample) && sample.length > 0;
      if (cloudHasData) {
        // Cloud already has data: pull+match by fingerprint. Do NOT re-seed everything
        // (that created duplicate UUID rows across devices).
        await pullAllCollections({ full: true });
        await seedOrphanLocalRows();
      } else {
        await seedLocalDataToSupabase({ force: true });
        await pullAllCollections({ full: true });
      }
      await saveLiveSyncSettings({ seedDone: true, dedupeDone: true, dedupeVersion: DEDUPE_VERSION });
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

/** Push only local rows that are not yet linked to a cloud syncId. */
async function seedOrphanLocalRows() {
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) return { seeded: 0 };
  const deviceId = await getOrCreateDeviceId();
  let seeded = 0;
  for (const collection of orderedCollections()) {
    const table = db[collection];
    if (!table) continue;
    const rows = await table.toArray();
    for (const row of rows) {
      const localKey = localKeyOf(collection, row);
      if (!localKey) continue;
      const meta = await getMetaByLocal(collection, localKey);
      if (meta?.syncId && !meta.deletedAt) continue;
      await pushUpsert(cfg, collection, localKey, deviceId);
      seeded++;
    }
  }
  return { seeded };
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
