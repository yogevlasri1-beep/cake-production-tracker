/**
 * Continuous multi-device sync: IndexedDB ↔ Supabase sync_* tables.
 * Last-write-wins by updated_at. Soft-delete via deleted_at.
 */
import { db, getSetting, setSetting } from './db.js?v=370';
import {
  getSupabaseBackupConfig,
  saveSupabaseBackupConfig,
  buildSupabaseRestUrl,
  buildSupabaseHeaders,
  getOrCreateDeviceId,
  BACKUP_SCOPE_ID,
} from './supabase-backup.js?v=370';
import {
  COLLECTION_TABLE,
  COLLECTION_FKS,
  ARRAY_FKS,
  POLYMORPHIC_FKS,
  KITCHEN_ID,
  isSyncCollection,
  orderedCollections,
  shouldApplyRemote,
  rowFingerprint,
  rowDedupeFingerprint,
} from './sync/collections.js?v=370';
import {
  ensureSyncId,
  getMetaByLocal,
  getMetaBySyncId,
  localKeyOf,
  markMetaDeleted,
  remapFksToLocalIds,
  remapFksToSyncIds,
  upsertMeta,
} from './sync/id-map.js?v=370';

const LIVE_SYNC_SETTINGS = 'liveSync';
const DEFAULT_LIVE = {
  enabled: true,
  lastPullAt: null,
  lastPushAt: null,
  lastError: null,
  seedDone: false,
  dedupeDone: false,
  dedupeVersion: 0,
  repairVersion: 0,
  pendingCount: 0,
};

/** Bump when rowFingerprint / rowDedupeFingerprint rules change so devices re-run local dedupe. */
const DEDUPE_VERSION = 3;

/**
 * Bump to force one full re-pull on every device. Needed after a bug wrote bad
 * foreign keys locally: the cloud rows are correct, so a full pull repairs them.
 * v3 also re-pushes polymorphic FKs that were uploaded as raw local numerics.
 */
const REPAIR_VERSION = 4;

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

const LOCAL_ONLY_SETTINGS = new Set([
  'liveSync', 'supabaseBackup', 'deviceId', 'backupSettings',
  'recipePortionPresetsSynced',
]);

function isSyncableOp(collection, localKey) {
  if (!isSyncCollection(collection)) return false;
  if (collection === 'settings' && LOCAL_ONLY_SETTINGS.has(String(localKey))) return false;
  return true;
}

async function enqueueOp(type, collection, localKey) {
  if (!isSyncableOp(collection, localKey)) return;
  const live = await getLiveSyncSettings();
  if (!live.enabled) return;
  await enqueue({ type, collection, localKey: String(localKey) });
}

export async function enqueueUpsert(collection, localKey) {
  if (applyingRemote) return;
  await enqueueOp('upsert', collection, localKey);
}

export async function enqueueDelete(collection, localKey) {
  if (applyingRemote) return;
  await enqueueOp('delete', collection, localKey);
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
    const arrayFields = Object.entries(ARRAY_FKS[collection] || {})
      .filter(([, dep]) => dep === targetCollection).map(([f]) => f);
    const poly = POLYMORPHIC_FKS[collection];
    if ((!fields.length && !arrayFields.length && !poly) || !db[collection]) continue;
    const rows = await db[collection].toArray();
    for (const row of rows) {
      const patch = {};
      for (const field of fields) {
        if (Number(row[field]) === from) patch[field] = to;
      }
      for (const field of arrayFields) {
        const vals = row[field];
        if (Array.isArray(vals) && vals.some((v) => Number(v) === from)) {
          patch[field] = [...new Set(vals.map((v) => (Number(v) === from ? to : v)))];
        }
      }
      if (poly && poly.targets[row[poly.typeField]] === targetCollection
          && Number(row[poly.idField]) === from) {
        patch[poly.idField] = to;
      }
      if (Object.keys(patch).length) {
        // Not wrapped in applyingRemote: the retarget is a real local change
        // that must reach the cloud, otherwise cloud children keep pointing at
        // the tombstoned duplicate parent.
        await db[collection].update(row.id, patch);
      }
    }
  }
}

/**
 * One-time local dedupe: same dedupe-fingerprint → keep preferred row, delete rest, retarget FKs.
 */
export async function dedupeLocalSyncCollections() {
  let removed = 0;
  for (const collection of orderedCollections()) {
    if (collection === 'settings' || !db[collection]) continue;
    const rows = await db[collection].toArray();
    const groups = new Map();
    for (const row of rows) {
      const fp = rowDedupeFingerprint(collection, row);
      if (!fp) continue;
      if (!groups.has(fp)) groups.set(fp, []);
      groups.get(fp).push(row);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => compareDedupeSurvivors(collection, a, b));
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

/** Prefer the survivor that matches cloud cleanup (richest material link, then oldest id). */
function compareDedupeSurvivors(collection, a, b) {
  if (collection === 'recipeIngredients') {
    const aMat = a.rawMaterialId != null && a.rawMaterialId !== '' ? 1 : 0;
    const bMat = b.rawMaterialId != null && b.rawMaterialId !== '' ? 1 : 0;
    if (bMat !== aMat) return bMat - aMat;
  }
  return (a.id - b.id);
}

async function applyRemoteRow(collection, cloudRow, deviceId, { allowUnresolvedFks = false } = {}) {
  if (!cloudRow?.id) return false;

  const syncId = cloudRow.id;
  const remoteUpdated = cloudRow.updated_at;
  let existingMeta = await getMetaBySyncId(syncId);

  if (cloudRow.deleted_at) {
    if (existingMeta) {
      const local = await readLocalRecord(collection, existingMeta.localKey);
      if (local) {
        applyingRemote = true;
        try {
          if (collection === 'settings') await db.settings.delete(existingMeta.localKey);
          else await db[collection].delete(Number(existingMeta.localKey));
        } finally {
          applyingRemote = false;
        }
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

  const { payload, unresolved } = await remapFksToLocalIds(collection, cloudRow.payload || {});

  if (unresolved.length && !allowUnresolvedFks) return 'defer';

  if (unresolved.length) {
    // Last resort: keep whatever the local row already has instead of writing a
    // UUID (or null) into a numeric FK, which would orphan the row.
    const local = existingMeta ? await readLocalRecord(collection, existingMeta.localKey) : null;
    for (const field of unresolved) {
      payload[field] = local ? (local[field] ?? null) : null;
    }
  }

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

export async function pullCollection(collection, { since, deferred } = {}) {
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
    if (ok === 'defer') {
      if (deferred) deferred.push({ collection, row });
      continue;
    }
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
  const deferred = [];
  try {
    for (const collection of orderedCollections()) {
      applied += await pullCollection(collection, { since, deferred });
    }
    // Second pass: rows whose parents were only created during this pull.
    if (deferred.length) {
      const deviceId = await getOrCreateDeviceId();
      const stillDeferred = [];
      for (const { collection, row } of deferred) {
        const ok = await applyRemoteRow(collection, row, deviceId);
        if (ok === 'defer') stillDeferred.push({ collection, row });
        else if (ok) applied++;
      }
      // Anything still unresolved is applied without touching its dangling FKs.
      for (const { collection, row } of stillDeferred) {
        const ok = await applyRemoteRow(collection, row, deviceId, { allowUnresolvedFks: true });
        if (ok && ok !== 'defer') applied++;
      }
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

/**
 * Mutations observed by the middleware wait here until the surrounding Dexie
 * transaction commits. Writing to syncQueue/syncMeta from inside the mutate
 * hook would touch tables outside the transaction scope and break callers that
 * open an explicit multi-table transaction (e.g. starting a production run).
 */
const pendingOps = [];
const txPendingOps = new WeakMap();
let pendingOpsTimer = null;

function flushPendingOpsSoon() {
  if (pendingOpsTimer) return;
  pendingOpsTimer = setTimeout(async () => {
    pendingOpsTimer = null;
    const ops = pendingOps.splice(0, pendingOps.length);
    for (const op of ops) {
      try {
        await enqueueOp(op.type, op.collection, op.localKey);
      } catch (err) {
        console.warn('live sync enqueue', err);
      }
    }
  }, 0);
}

function queueSyncOp(op) {
  const tx = (typeof Dexie !== 'undefined' && Dexie.currentTransaction) || null;
  if (!tx || typeof tx.on !== 'function') {
    pendingOps.push(op);
    flushPendingOpsSoon();
    return;
  }
  let buffered = txPendingOps.get(tx);
  if (!buffered) {
    buffered = [];
    txPendingOps.set(tx, buffered);
    tx.on('complete', () => {
      txPendingOps.delete(tx);
      pendingOps.push(...buffered);
      flushPendingOpsSoon();
    });
    // On abort the writes never happened, so the buffered ops are dropped.
    tx.on('abort', () => txPendingOps.delete(tx));
  }
  buffered.push(op);
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
              return table.mutate(req).then((res) => {
                if (applyingRemote) return res;
                try {
                  if (req.type === 'add') {
                    for (const k of res.results || []) {
                      queueSyncOp({
                        type: 'upsert',
                        collection: tableName,
                        localKey: localKeyOf(tableName, { id: k, key: k }),
                      });
                    }
                  } else if (req.type === 'put') {
                    for (const v of req.values || []) {
                      queueSyncOp({
                        type: 'upsert',
                        collection: tableName,
                        localKey: localKeyOf(tableName, v),
                      });
                    }
                  } else if (req.type === 'delete') {
                    for (const k of req.keys || []) {
                      queueSyncOp({ type: 'delete', collection: tableName, localKey: String(k) });
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

/**
 * Re-push rows whose polymorphic FK (targetId/scopeId) was uploaded as a raw
 * local numeric id before the poly-remap fix, so the cloud gets real UUIDs.
 * Only rows whose target actually exists locally are pushed.
 */
async function repushPolymorphicCollections() {
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) return;
  const deviceId = await getOrCreateDeviceId();
  for (const collection of Object.keys(POLYMORPHIC_FKS)) {
    if (!db[collection]) continue;
    const poly = POLYMORPHIC_FKS[collection];
    const rows = await db[collection].toArray();
    for (const row of rows) {
      const targetCollection = poly.targets[row[poly.typeField]];
      const val = row[poly.idField];
      if (!targetCollection || val == null || !/^\d+$/.test(String(val))) continue;
      const target = db[targetCollection] ? await db[targetCollection].get(Number(val)) : null;
      if (!target) continue;
      const localKey = localKeyOf(collection, row);
      const meta = await getMetaByLocal(collection, localKey);
      if (!meta?.syncId) continue; // rows without syncId are covered by seeding
      try {
        await pushUpsert(cfg, collection, localKey, deviceId);
      } catch (err) {
        console.warn('live sync poly repush', collection, localKey, err);
      }
    }
  }
}

export async function startLiveSync() {
  if (started) return;
  started = true;
  installLiveSyncMiddleware();

  const live = await getLiveSyncSettings();
  if (!live.enabled) return;

  let pulledOk = false;
  const tick = async () => {
    try {
      await flushSyncQueue();
      await pullAllCollections({ full: false });
      pulledOk = true;
    } catch (err) {
      console.warn('live sync tick', err);
    }
  };

  // One-time per repair version: re-pull everything so foreign keys that an
  // earlier bug nulled out locally are restored from the (correct) cloud rows.
  // v3 also re-pushes polymorphic FKs that were uploaded as raw local numerics.
  if ((live.repairVersion || 0) < REPAIR_VERSION) {
    try {
      await flushSyncQueue();
      await pullAllCollections({ full: true });
      await repushPolymorphicCollections();
      await saveLiveSyncSettings({ repairVersion: REPAIR_VERSION });
      pulledOk = true;
    } catch (err) {
      console.warn('live sync repair pull', err);
    }
  }

  await tick();

  // One-time per fingerprint version: remove local duplicates created by the
  // old pull-before-seed bug (v2 also covers production runs / step states).
  // Runs only AFTER a successful pull so cloud-side dedupe deletions land
  // first; otherwise this device could tombstone the copy the cloud kept.
  if (pulledOk && (!live.dedupeDone || (live.dedupeVersion || 0) < DEDUPE_VERSION)) {
    try {
      const result = await dedupeLocalSyncCollections();
      await flushSyncQueue();
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
      // Only mark seedDone here. dedupeDone is set exclusively by the dedupe
      // block above (or when it actually runs); never claim dedupe ran if it
      // was skipped because pulledOk was false.
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
