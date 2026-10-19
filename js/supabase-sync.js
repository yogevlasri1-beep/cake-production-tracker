/**
 * Continuous multi-device sync: IndexedDB ↔ Supabase sync_* tables.
 * Last-write-wins by updated_at. Soft-delete via deleted_at.
 */
import { db, getSetting, setSetting } from './db.js?v=509';
import {
  getSupabaseBackupConfig,
  saveSupabaseBackupConfig,
  buildSupabaseRestUrl,
  buildSupabaseHeaders,
  resolveSupabaseUserAccessToken,
  getOrCreateDeviceId,
  BACKUP_SCOPE_ID,
} from './supabase-backup.js?v=509';
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
  supplierCategoryRoleKey,
  supplierCategoryCanonicalName,
} from './sync/collections.js?v=509';
import {
  applyCloudFirstToCloudRow,
  canUploadLocalDatabase,
  CLOUD_CUTOVER_KEY,
  cloudCutoverMarkerPresent,
  cutoverRowUpdatedAt,
  isCloudFirstEnabled,
  isCutoverDevice,
  planLiveSyncAlwaysOn,
  planManualLiveSync,
  planProductionLabelPush,
  toCloudUpdatedAt,
  localDatabaseHasRecords,
  entriesWithLocalProducts,
  pickProductionProductId,
  planAdoptCloudFirst,
  planAppendOnlyPush,
  planCloudJoin,
  planCutoverSnapshot,
  planDemoteForeignCutover,
  planProductionHistoryPull,
  planProductionHistoryUpload,
  PRODUCTION_HISTORY_COLLECTIONS,
  PRODUCTION_HISTORY_REV_KEY,
  PRODUCTION_LABEL_VERSION,
  PRODUCTION_PULL_VERSION,
  productionHistoryMarkerAt,
} from './sync/cloud-first.js?v=509';
import {
  ensureSyncId,
  getMetaByLocal,
  getMetaBySyncId,
  localKeyOf,
  markMetaDeleted,
  remapFksToLocalIds,
  remapFksToSyncIds,
  upsertMeta,
} from './sync/id-map.js?v=509';
import { repairRecipeProductLinksFromComposition, ensureRoleSupplierCategories, inferRawMaterialSupplierRole, coerceSupplierNumericFks, reconcileRawMaterialPricesFromHistory } from './kitchen-db.js?v=509';
import {
  AUTH_RECONNECT_MESSAGE,
  AUTH_OFFLINE_MESSAGE,
  isTransientAuthError,
  forceRefreshSession,
} from './auth.js?v=509';

const LIVE_SYNC_SETTINGS = 'liveSync';
const DEFAULT_LIVE = {
  enabled: true,
  /** כבוי עד יום המעבר. כשדולק — הענן מנצח, ומכשיר ריק לא מעלה. */
  cloudFirst: false,
  cutoverDevice: false,
  lastPullAt: null,
  lastPushAt: null,
  lastError: null,
  lastErrorKind: null,
  seedDone: false,
  dedupeDone: false,
  dedupeVersion: 0,
  repairVersion: 0,
  pendingCount: 0,
};

/**
 * ממיין הודעת שגיאת סנכרון להודעה ידידותית בעברית.
 * kind: pending | rejected | rls | auth | network | other
 */
export function classifyLiveSyncError(err) {
  const raw = String(err?.message || err || '').trim();
  const lower = raw.toLowerCase();
  if (!raw) return { kind: null, message: null, technical: null };

  if (/pending|ממתין לאישור/.test(lower) || /status['":\s]*pending/.test(lower)) {
    return {
      kind: 'pending',
      message: 'החשבון ממתין לאישור מנהל — עד אז הסנכרון לענן חסום. בקש ממנהל לאשר בעמדת חשבונות.',
      technical: raw,
    };
  }
  if (/rejected|נדחה/.test(lower)) {
    return {
      kind: 'rejected',
      message: 'החשבון נדחה — אין הרשאת סנכרון. פנה למנהל המערכת.',
      technical: raw,
    };
  }
  if (
    /jwt expired|invalid jwt|pgrst301|token.*expired/i.test(raw)
    || /\b401\b/.test(raw)
    || raw === AUTH_RECONNECT_MESSAGE
  ) {
    return {
      kind: 'auth',
      message: AUTH_RECONNECT_MESSAGE,
      technical: raw,
    };
  }
  if (
    /row-level security|rls|permission denied|not authorized|42501/i.test(raw)
    || (/\b403\b/.test(raw) && /supabase/i.test(raw))
  ) {
    return {
      kind: 'rls',
      message: 'אין הרשאת כתיבה לענן (משתמש לא מאושר או הרשאה חסרה). אם החשבון חדש — המתן לאישור מנהל בעמדת חשבונות.',
      technical: raw,
    };
  }
  if (/failed to fetch|networkerror|net::|offline|timeout|econnrefused|load failed|אין חיבור/i.test(raw)
      || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return {
      kind: 'network',
      message: `${AUTH_OFFLINE_MESSAGE} — הסנכרון ינסה שוב כשהרשת תחזור.`,
      technical: raw,
    };
  }
  return {
    kind: 'other',
    message: raw.replace(/^Supabase:\s*/i, '') || 'שגיאת סנכרון',
    technical: raw,
  };
}

export function formatLiveSyncErrorForUi(live) {
  if (!live?.lastError && !live?.lastErrorKind) return '';
  if (live.lastErrorKind === 'auth') return AUTH_RECONNECT_MESSAGE;
  const classified = classifyLiveSyncError(live.lastError || live.lastErrorKind);
  if (classified.kind && classified.kind !== 'other') return classified.message;
  if (live.lastErrorKind === 'pending') {
    return classifyLiveSyncError('pending').message;
  }
  return classified.message || String(live.lastError || '');
}

/**
 * Bump when rowFingerprint / rowDedupeFingerprint rules change so devices re-run local dedupe.
 * v17: rebalance materials/suppliers wrongly dumped into אריזות back to חומ״ג/ניקיון.
 * v18: coerce string FKs + unassigned-material fingerprint includes category.
 */
const DEDUPE_VERSION = 18;

/**
 * Bump to force one full re-pull on every device. Needed after a bug wrote bad
 * foreign keys locally: the cloud rows are correct, so a full pull repairs them.
 * v3 also re-pushes polymorphic FKs that were uploaded as raw local numerics.
 * v7: new devices seeded empty supplier-category defaults that diverged from cloud names.
 * v8: after cloud SQL cleanup of seed categories — full re-pull + material cross-category dedupe.
 * v9: merge «חומרי גלם»/«חומרי גלם יבשים» + re-pull after unique packaging/cleaning indexes.
 * v10: coerce string FKs + reconcile unitPrice from price history after pull.
 * v11: paginate pulls — PostgREST silently capped each table at 1000 rows, so a
 * new computer could keep lastPullAt and never receive the rest of the catalog.
 * v12: timestamps and the pull cursor now follow the server clock. Rows that an
 * earlier device-clock mismatch made other devices skip are recovered by one full pull.
 */
const REPAIR_VERSION = 12;

let applyingRemote = false;
let flushTimer = null;
let pullTimer = null;
let started = false;
let authHalted = false;
let liveSyncOnlineHandler = null;
let liveSyncVisibilityHandler = null;
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

function stopLiveSyncTimers() {
  if (pullTimer) {
    clearInterval(pullTimer);
    pullTimer = null;
  }
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (liveSyncOnlineHandler) {
    window.removeEventListener('online', liveSyncOnlineHandler);
    liveSyncOnlineHandler = null;
  }
  if (liveSyncVisibilityHandler) {
    document.removeEventListener('visibilitychange', liveSyncVisibilityHandler);
    liveSyncVisibilityHandler = null;
  }
}

export function isLiveSyncAuthHalted() {
  return authHalted;
}

export async function haltLiveSyncForAuth() {
  authHalted = true;
  stopLiveSyncTimers();
  started = false;
  await saveLiveSyncSettings({
    lastError: AUTH_RECONNECT_MESSAGE,
    lastErrorKind: 'auth',
  });
  try {
    const { showToast } = await import('./utils.js?v=509');
    showToast(AUTH_RECONNECT_MESSAGE);
  } catch { /* ignore */ }
}

function isAuthExpiredResponse(status, detail) {
  const text = String(detail || '');
  return Number(status) === 401 || /jwt expired|invalid jwt|pgrst301/i.test(text);
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

/**
 * Server clock minus device clock, measured from the Date header of every Supabase
 * response. updated_at and the pull cursor used to come from each device's own
 * clock: a computer running a few minutes fast asked the cloud only for rows
 * "newer than its future", and one running slow wrote rows that other devices had
 * already skipped past — either way changes silently never arrived.
 */
let serverClockOffsetMs = 0;
let serverClockMeasured = false;
/** Date has 1-second resolution plus request latency; smaller drift is noise. */
const CLOCK_SKEW_IGNORE_MS = 3000;

export function noteServerClock(serverDateHeader, localNowMs = Date.now()) {
  const serverMs = serverDateHeader ? Date.parse(serverDateHeader) : NaN;
  if (!Number.isFinite(serverMs)) return serverClockOffsetMs;
  const offset = serverMs - localNowMs;
  serverClockOffsetMs = Math.abs(offset) < CLOCK_SKEW_IGNORE_MS ? 0 : offset;
  serverClockMeasured = true;
  return serverClockOffsetMs;
}

export function getServerClockOffsetMs() {
  return serverClockOffsetMs;
}

/** "Now" on the server's clock — every timestamp written to the cloud uses this. */
export function syncNowISO() {
  return new Date(Date.now() + serverClockOffsetMs).toISOString();
}

async function supabaseFetch(cfg, path, { method = 'GET', body, headers = {}, allowAuthRetry = true } = {}) {
  if (authHalted) {
    throw new Error(AUTH_RECONNECT_MESSAGE);
  }
  const url = buildSupabaseRestUrl(cfg.supabaseUrl, path);
  const accessToken = await resolveSupabaseUserAccessToken();
  const res = await fetch(url, {
    method,
    headers: buildSupabaseHeaders(cfg.anonKey, {
      ...headers,
      ...(accessToken ? { accessToken } : {}),
    }),
    body: body != null ? JSON.stringify(body) : undefined,
  });
  try { noteServerClock(res.headers?.get?.('Date')); } catch { /* ignore */ }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errJson = await res.json();
      detail = errJson.message || errJson.error || errJson.hint || detail;
    } catch { /* ignore */ }
    const expired = isAuthExpiredResponse(res.status, detail);
    if (expired && allowAuthRetry) {
      try {
        await forceRefreshSession();
      } catch (err) {
        if (isTransientAuthError(err)) {
          throw new Error('Failed to fetch');
        }
        await haltLiveSyncForAuth();
        throw new Error(AUTH_RECONNECT_MESSAGE);
      }
      return supabaseFetch(cfg, path, { method, body, headers, allowAuthRetry: false });
    }
    if (expired && !allowAuthRetry) {
      await haltLiveSyncForAuth();
      throw new Error(AUTH_RECONNECT_MESSAGE);
    }
    throw new Error(`Supabase sync: ${detail || res.status}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function tableOf(collection) {
  return COLLECTION_TABLE[collection];
}

/** 'error' items are retried on every flush (see flushSyncQueue), so they still count as backlog. */
async function countQueueBacklog() {
  return db.syncQueue.where('status').anyOf('pending', 'error').count();
}

async function enqueue(op) {
  await db.syncQueue.add({
    ...op,
    createdAt: new Date().toISOString(),
    status: 'pending',
  });
  await saveLiveSyncSettings({ pendingCount: await countQueueBacklog() });
  scheduleFlush();
}

const LOCAL_ONLY_SETTINGS = new Set([
  'liveSync', 'supabaseBackup', 'deviceId', 'backupSettings',
  'recipePortionPresetsSynced',
]);

/** מפתח הגדרה מסונכרן — אות בדיקה בין מכשירים/משתמשים */
export const SYNC_PROBE_KEY = 'syncProbe';

/**
 * שולח אות בדיקה לענן דרך settings (מסונכרן לכל המכשירים באותו kitchen).
 * אחרי שליחה: במכשיר השני לחץ «סנכרן עכשיו» / «בדוק אות» ווודא שהזמן/הערה מופיעים.
 */
export async function sendSyncProbe({ note = '', email = '' } = {}) {
  const deviceId = await getOrCreateDeviceId();
  const value = {
    at: new Date().toISOString(),
    note: String(note || 'בדיקת סנכרון').trim().slice(0, 80) || 'בדיקת סנכרון',
    deviceId: String(deviceId || '').slice(0, 64),
    email: String(email || '').trim().slice(0, 120),
  };
  await setSetting(SYNC_PROBE_KEY, value);
  const pushed = await flushSyncQueue();
  return { value, pushed };
}

/** מושך מהענן ומחזיר את אות הבדיקה האחרון (אם יש) */
export async function refreshAndReadSyncProbe() {
  const pulled = await pullAllCollections({ full: false });
  const value = await getSetting(SYNC_PROBE_KEY);
  return { value, pulled };
}

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

/** Cloud row for the current local state, or null when the local row is gone. */
async function buildUpsertCloudRow(collection, localKey, deviceId) {
  const row = await readLocalRecord(collection, localKey);
  if (!row) return null;
  const source = await labelSyncRow(collection, row);
  const updatedAt = toCloudUpdatedAt(source.updatedAt || source.updated_at, syncNowISO());
  const syncId = await ensureSyncId(collection, localKey, { updatedAt });
  if (!syncId) return null;
  const payload = await remapFksToSyncIds(collection, source);
  if (collection === 'settings') payload.key = row.key;
  return {
    id: syncId,
    kitchen_id: KITCHEN_ID || BACKUP_SCOPE_ID,
    payload,
    updated_at: updatedAt,
    deleted_at: null,
    device_id: deviceId,
  };
}

async function buildDeleteCloudRow(collection, localKey, deviceId) {
  const updatedAt = syncNowISO();
  let syncId = await markMetaDeleted(collection, localKey, updatedAt);
  if (!syncId) syncId = await ensureSyncId(collection, localKey, { updatedAt });
  if (!syncId) return null;
  return {
    id: syncId,
    kitchen_id: KITCHEN_ID || BACKUP_SCOPE_ID,
    payload: {},
    updated_at: updatedAt,
    deleted_at: updatedAt,
    device_id: deviceId,
  };
}

async function cloudFirstFlags() {
  try {
    const live = await getLiveSyncSettings();
    return { on: isCloudFirstEnabled(live), cutover: live?.cutoverDevice === true };
  } catch {
    return { on: false, cutover: false };
  }
}

async function fetchRemoteCloudRow(cfg, collection, id) {
  const safeId = String(id || '').replace(/[^0-9a-fA-F-]/g, '');
  if (!safeId) return null;
  const rows = await supabaseFetch(
    cfg,
    `/${tableOf(collection)}?id=eq.${safeId}&select=id,payload,updated_at,deleted_at&limit=1`,
  );
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

async function postCloudRows(cfg, collection, body, { replace = false, skippedIds = null } = {}) {
  const rowsIn = Array.isArray(body) ? body : (body ? [body] : []);
  if (replace) {
    if (!rowsIn.length) return 0;
    await supabaseFetch(cfg, `/${tableOf(collection)}?on_conflict=id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: rowsIn,
    });
    return rowsIn.length;
  }
  let payload = body;
  const flags = await cloudFirstFlags();
  if (flags.on) {
    const rows = rowsIn;
    const sending = [];
    for (const row of rows) {
      if (!row) continue;
      if (row.deleted_at) {
        const gate = planAppendOnlyPush({
          collection,
          cutoverDevice: flags.cutover,
          remoteExists: true,
        });
        if (gate.send) sending.push(row);
        else if (skippedIds) skippedIds.add(row.id);
        continue;
      }
      const remote = await fetchRemoteCloudRow(cfg, collection, row.id);
      const gate = planAppendOnlyPush({
        collection,
        cutoverDevice: flags.cutover,
        remoteExists: !!(remote && !remote.deleted_at),
      });
      if (!gate.send) {
        if (skippedIds) skippedIds.add(row.id);
        continue;
      }
      // שורה בלי חותמת נשלחת רק כשאין מולה שורה חיה בענן.
      const localRow = (!row.updated_at && (flags.cutover || !remote || remote.deleted_at))
        ? { ...row, updated_at: syncNowISO() }
        : row;
      const decided = applyCloudFirstToCloudRow(collection, localRow, remote);
      if (decided.send && decided.cloudRow) sending.push(decided.cloudRow);
    }
    if (!sending.length) return 0;
    payload = Array.isArray(body) ? sending : sending[0];
    await supabaseFetch(cfg, `/${tableOf(collection)}?on_conflict=id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: payload,
    });
    return sending.length;
  }
  await supabaseFetch(cfg, `/${tableOf(collection)}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: payload,
  });
  return Array.isArray(body) ? body.length : (body ? 1 : 0);
}

async function pushUpsert(cfg, collection, localKey, deviceId) {
  const cloudRow = await buildUpsertCloudRow(collection, localKey, deviceId);
  if (!cloudRow) return;
  const sent = await postCloudRows(cfg, collection, cloudRow);
  if (!sent) return;
  await upsertMeta({ collection, localKey, syncId: cloudRow.id, updatedAt: cloudRow.updated_at, deletedAt: null });
}

async function pushDelete(cfg, collection, localKey, deviceId) {
  const cloudRow = await buildDeleteCloudRow(collection, localKey, deviceId);
  if (!cloudRow) return;
  await postCloudRows(cfg, collection, cloudRow);
}

/** Rows per batched POST when flushing the queue. */
const PUSH_BATCH_SIZE = 200;

/**
 * Only the newest queued op per row matters: the push always sends the row's
 * current local state. Returns the ops to send (oldest first) and the stale ones.
 */
export function collapseQueueItems(items) {
  const latestByRow = new Map();
  for (const item of items) latestByRow.set(`${item.collection}\u0000${item.localKey}`, item);
  const keep = new Set(latestByRow.values());
  return {
    latest: items.filter((item) => keep.has(item)),
    superseded: items.filter((item) => !keep.has(item)),
  };
}

function isWholeFlushError(err) {
  if (authHalted) return true;
  const kind = classifyLiveSyncError(err).kind;
  return kind === 'network' || kind === 'auth';
}

let flushInFlight = null;
let flushAgain = false;

export function flushSyncQueue() {
  if (flushInFlight) {
    // A write landed while a flush was running: run once more right after it.
    flushAgain = true;
    return flushInFlight;
  }
  flushInFlight = runFlush().finally(() => {
    flushInFlight = null;
    if (flushAgain) {
      flushAgain = false;
      scheduleFlush();
    }
  });
  return flushInFlight;
}

async function runFlush() {
  if (authHalted) return { flushed: 0 };
  const live = await getLiveSyncSettings();
  if (!live.enabled) return { flushed: 0 };
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) return { flushed: 0 };

  const deviceId = await getOrCreateDeviceId();
  // 'error' items are retried too: a transient failure (network blip, a not-yet-
  // approved account rejected by RLS) must not permanently strand that one write —
  // it used to be marked 'error' and never picked up again, silently dropping it
  // while the rest of the queue kept flushing normally.
  const queued = await db.syncQueue.where('status').anyOf('pending', 'error').sortBy('createdAt');
  const { latest, superseded } = collapseQueueItems(queued);
  if (superseded.length) {
    await db.syncQueue.bulkUpdate(superseded.map((item) => ({ key: item.id, changes: { status: 'done' } })));
  }

  // Group by collection: one POST carries up to PUSH_BATCH_SIZE rows instead of
  // one request per change.
  const byCollection = new Map();
  for (const item of latest) {
    if (!byCollection.has(item.collection)) byCollection.set(item.collection, []);
    byCollection.get(item.collection).push(item);
  }

  let flushed = 0;
  let lastErr = null;
  let halted = false;
  const markError = async (items, message) => {
    if (!items.length) return;
    await db.syncQueue.bulkUpdate(items.map((item) => ({ key: item.id, changes: { status: 'error', error: message } })));
  };

  for (const [collection, items] of byCollection) {
    for (let i = 0; i < items.length; i += PUSH_BATCH_SIZE) {
      const chunk = items.slice(i, i + PUSH_BATCH_SIZE);
      if (halted) {
        await markError(chunk, lastErr);
        continue;
      }
      const prepared = [];
      const nothingToSend = [];
      for (const item of chunk) {
        try {
          const cloudRow = item.type === 'delete'
            ? await buildDeleteCloudRow(collection, item.localKey, deviceId)
            : await buildUpsertCloudRow(collection, item.localKey, deviceId);
          if (cloudRow) prepared.push({ item, cloudRow });
          else nothingToSend.push(item);
        } catch (err) {
          lastErr = String(err.message || err);
          await markError([item], lastErr);
        }
      }
      if (nothingToSend.length) {
        await db.syncQueue.bulkUpdate(nothingToSend.map((item) => ({ key: item.id, changes: { status: 'done' } })));
      }
      if (!prepared.length) continue;

      const confirm = async (entries) => {
        for (const { item, cloudRow } of entries) {
          if (item.type !== 'delete') {
            await upsertMeta({
              collection, localKey: item.localKey, syncId: cloudRow.id, updatedAt: cloudRow.updated_at, deletedAt: null,
            });
          }
        }
        await db.syncQueue.bulkUpdate(entries.map(({ item }) => ({ key: item.id, changes: { status: 'done' } })));
        flushed += entries.length;
      };

      try {
        const skippedIds = new Set();
        await postCloudRows(cfg, collection, prepared.map((p) => p.cloudRow), { skippedIds });
        const skipped = prepared.filter((entry) => skippedIds.has(entry.cloudRow.id));
        const sentEntries = prepared.filter((entry) => !skippedIds.has(entry.cloudRow.id));
        if (skipped.length) {
          await db.syncQueue.bulkUpdate(skipped.map(({ item }) => ({ key: item.id, changes: { status: 'done' } })));
        }
        if (sentEntries.length) await confirm(sentEntries);
      } catch (err) {
        lastErr = String(err.message || err);
        if (isWholeFlushError(err) || prepared.length === 1) {
          await markError(prepared.map((p) => p.item), lastErr);
          if (isWholeFlushError(err)) halted = true;
          continue;
        }
        // One bad/rejected row must not block unrelated writes in the same batch:
        // retry one by one so only the failing row stays in the queue.
        for (let j = 0; j < prepared.length; j++) {
          const entry = prepared[j];
          try {
            const sent = await postCloudRows(cfg, collection, entry.cloudRow);
            if (sent) await confirm([entry]);
            else await db.syncQueue.update(entry.item.id, { status: 'done' });
          } catch (rowErr) {
            lastErr = String(rowErr.message || rowErr);
            if (isWholeFlushError(rowErr)) {
              halted = true;
              await markError(prepared.slice(j).map((p) => p.item), lastErr);
              break;
            }
            await markError([entry.item], lastErr);
          }
        }
      }
    }
  }

  await db.syncQueue.where('status').equals('done').delete();
  const pendingCount = await countQueueBacklog();
  const classified = lastErr ? classifyLiveSyncError(lastErr) : { kind: null, message: null };
  await saveLiveSyncSettings({
    pendingCount,
    lastPushAt: flushed ? new Date().toISOString() : live.lastPushAt,
    lastError: classified.message || lastErr,
    lastErrorKind: classified.kind,
  });
  if (lastErr) emitStatus({ lastError: classified.message || lastErr, lastErrorKind: classified.kind });
  return { flushed };
}

/**
 * Collections where a same-named/-role row created independently on two devices
 * (before either had synced) must converge into one row in real time, not just at
 * the next periodic dedupe pass — otherwise every such race leaves a permanent
 * duplicate (e.g. two "supplierCategories" cleaning categories, or the same raw
 * material added under two different categories on two devices).
 */
const LOOSE_MATCH_COLLECTIONS = new Set(['supplierCategories', 'suppliers', 'rawMaterials']);

/**
 * Master-data collections where a fingerprint already claimed by another syncId
 * is treated as a cloud duplicate (tombstone incoming) instead of creating a
 * second local row. Intentionally excludes transactional rows (productionEntries,
 * inventoryMovements, processLogs, manager tasks, …) whose fingerprints can
 * legitimately collide for distinct events.
 */
const TOMBSTONE_CLAIMED_COLLECTIONS = new Set([
  'supplierCategories',
  'suppliers',
  'rawMaterials',
  'categories',
  'categoryGroups',
  'products',
  'recipes',
  'recipeCategories',
  'recipeGroups',
  'checklistTasks',
  'bakingProfiles',
  'productionMachines',
  'flows',
  'activityPresets',
  'purchaseCategories',
  'managerResponsibilityAreas',
  'managerDepartments',
  'departmentCleaningLists',
  'haccpTeamMembers',
  'haccpPlans',
]);

/**
 * Soft-delete a cloud sync row that is a logical duplicate of a local survivor.
 * Used when pull would otherwise create a second local row for the same category/material.
 */
async function tombstoneCloudDuplicate(collection, syncId, deviceId) {
  if (!syncId) return;
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) return;
  const updatedAt = syncNowISO();
  const table = tableOf(collection);
  try {
    await supabaseFetch(cfg, `/${table}?on_conflict=id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: {
        id: syncId,
        kitchen_id: KITCHEN_ID || BACKUP_SCOPE_ID,
        payload: {},
        updated_at: updatedAt,
        deleted_at: updatedAt,
        device_id: deviceId,
      },
    });
  } catch (err) {
    console.warn('live sync tombstone duplicate', collection, syncId, err);
  }
}

/**
 * Fingerprint index per collection, alive only for the duration of one pull.
 * Without it every new cloud row re-read and re-fingerprinted the whole local
 * table — quadratic, so the first pull on a new computer could take many minutes.
 * Any local write the index cannot follow drops that collection's entry.
 */
let fpCache = null;
/** במהלך משיכת תיעוד: מזהי הענן שנראו, כדי למחוק במחשב שורות שלא קיימות באייפון. */
let collectProductionEntryIds = null;
let productionProductCache = null;

function clearProductionProductCache() {
  productionProductCache = null;
}

async function productionProductsForRelink() {
  if (productionProductCache) return productionProductCache;
  const [products, categories] = await Promise.all([
    db.products.toArray(),
    db.categories.toArray(),
  ]);
  const catName = new Map(categories.map((category) => [Number(category.id), category.name || '']));
  productionProductCache = products.map((product) => ({
    id: product.id,
    name: product.name || '',
    categoryName: catName.get(Number(product.categoryId)) || '',
  }));
  return productionProductCache;
}

/** שם המוצר מהאייפון גובר על מספר מקומי שלא תואם. */
async function productionEntryNeedsCloudAgain(existingMeta) {
  const local = await readLocalRecord('productionEntries', existingMeta.localKey);
  if (!local) return true;
  const products = await productionProductsForRelink();
  const linked = products.find((product) => (
    String(product.id) === String(local.productId) || Number(product.id) === Number(local.productId)
  ));
  if (!linked) return true;
  if (!local.productName) return false;
  const picked = pickProductionProductId(products, {
    productId: local.productId,
    productName: local.productName,
    categoryName: local.categoryName,
  });
  return String(picked) !== String(local.productId);
}

async function relinkProductionEntryProduct(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const products = await productionProductsForRelink();
  const nextId = pickProductionProductId(products, {
    productId: payload.productId,
    productName: payload.productName,
    categoryName: payload.categoryName,
  });
  if (nextId == null || nextId === '') return false;
  const product = products.find((item) => String(item.id) === String(nextId) || Number(item.id) === Number(nextId));
  if (!product) return false;
  payload.productId = product.id;
  return true;
}

function invalidateFingerprintCache(collection) {
  if (fpCache) fpCache.delete(collection);
}

function fpIndexAdd(index, collection, row) {
  const strict = rowFingerprint(collection, row);
  if (strict) {
    if (!index.strict.has(strict)) index.strict.set(strict, []);
    index.strict.get(strict).push(row);
  }
  if (LOOSE_MATCH_COLLECTIONS.has(collection)) {
    const loose = rowDedupeFingerprint(collection, row);
    if (loose) {
      if (!index.loose.has(loose)) index.loose.set(loose, []);
      index.loose.get(loose).push(row);
    }
  }
}

async function fingerprintIndexFor(collection) {
  if (!fpCache) return null;
  let index = fpCache.get(collection);
  if (!index) {
    index = { strict: new Map(), loose: new Map() };
    for (const row of await db[collection].toArray()) fpIndexAdd(index, collection, row);
    fpCache.set(collection, index);
  }
  return index;
}

function fingerprintCacheAdd(collection, row) {
  const index = fpCache?.get(collection);
  if (index) fpIndexAdd(index, collection, row);
}

export async function findLocalByFingerprint(collection, row, { syncId = null } = {}) {
  if (!row || !db[collection]) return null;
  const strictFp = rowFingerprint(collection, row);
  const looseFp = LOOSE_MATCH_COLLECTIONS.has(collection) ? rowDedupeFingerprint(collection, row) : '';
  if (!strictFp && !looseFp) return null;
  let strictMatches = [];
  let looseMatches = [];
  const index = await fingerprintIndexFor(collection);
  if (index) {
    strictMatches = strictFp ? [...(index.strict.get(strictFp) || [])] : [];
    if (looseFp && looseFp !== strictFp) {
      const strictIds = new Set(strictMatches.map((r) => r.id));
      looseMatches = (index.loose.get(looseFp) || []).filter((r) => !strictIds.has(r.id));
    }
  } else {
    const rows = await db[collection].toArray();
    for (const r of rows) {
      if (strictFp && rowFingerprint(collection, r) === strictFp) strictMatches.push(r);
      else if (looseFp && looseFp !== strictFp && rowDedupeFingerprint(collection, r) === looseFp) looseMatches.push(r);
    }
  }
  for (const candidate of [...strictMatches, ...looseMatches]) {
    const meta = await getMetaByLocal(collection, candidate.id);
    if (!meta?.syncId || meta.syncId === syncId) return candidate;
  }
  // Master-data race: two devices created the same logical entity before either
  // synced. Return the local survivor so the caller can tombstone the incoming
  // cloud UUID instead of creating a second local row. Transactional collections
  // stay on the old behaviour (return null → create) to avoid deleting real events.
  if (TOMBSTONE_CLAIMED_COLLECTIONS.has(collection)) {
    const claimed = [...strictMatches, ...looseMatches][0];
    if (claimed) return { ...claimed, __cloudDuplicateOf: true };
  }
  return null;
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

/** Dedupe one collection by rowDedupeFingerprint; returns number removed. */
async function dedupeCollectionByFingerprint(collection) {
  if (collection === 'settings' || !db[collection]) return 0;
  let removed = 0;
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
      if (collection === 'checklistTasks') {
        await mergeChecklistTaskInto(keep.id, drop.id);
      } else {
        if (collection === 'rawMaterials') {
          await mergeRawMaterialPriceInto(keep, drop);
        }
        await retargetLocalForeignKeys(collection, drop.id, keep.id);
      }
      await deleteLocalDuplicateRow(collection, drop);
      removed++;
    }
  }
  return removed;
}

/** מעתיק מחיר/שדות חסרים מכפילות ל-survivor לפני מחיקה */
async function mergeRawMaterialPriceInto(keep, drop) {
  if (!keep || !drop) return;
  const patch = {};
  if (!(Number(keep.unitPrice) > 0) && Number(drop.unitPrice) > 0) {
    patch.unitPrice = drop.unitPrice;
    if (drop.unit) patch.unit = drop.unit;
    if (drop.priceUpdatedAt) patch.priceUpdatedAt = drop.priceUpdatedAt;
  }
  if (!(Number(keep.packageWeightGrams) > 0) && Number(drop.packageWeightGrams) > 0) {
    patch.packageWeightGrams = drop.packageWeightGrams;
  }
  if (!(Number(keep.processedPricePerKg) > 0) && Number(drop.processedPricePerKg) > 0) {
    patch.processedPricePerKg = drop.processedPricePerKg;
  }
  if (!sanitizeBarcodeLike(keep.barcode) && sanitizeBarcodeLike(drop.barcode)) {
    patch.barcode = drop.barcode;
  }
  if (!keep.supplierId && drop.supplierId) {
    patch.supplierId = drop.supplierId;
  }
  if (!String(keep.sku || '').trim() && String(drop.sku || '').trim()) {
    patch.sku = String(drop.sku).trim();
  }
  if (!String(keep.notes || '').trim() && String(drop.notes || '').trim()) {
    patch.notes = String(drop.notes).trim();
  }
  if (!(Number(keep.minOrderQty) > 0) && Number(drop.minOrderQty) > 0) {
    patch.minOrderQty = drop.minOrderQty;
  }
  if (!Object.keys(patch).length) return;
  await db.rawMaterials.update(keep.id, patch);
  await enqueueUpsert('rawMaterials', keep.id);
}

function sanitizeBarcodeLike(v) {
  return String(v || '').trim();
}

/**
 * One-time local dedupe: same dedupe-fingerprint → keep preferred row, delete rest, retarget FKs.
 */
export async function dedupeLocalSyncCollections() {
  let removed = 0;
  for (const collection of orderedCollections()) {
    removed += await dedupeCollectionByFingerprint(collection);
  }
  // מעבר נוסף: קישורי תזרים עם שמות משימה זהים (אחרי מיזוג ids)
  removed += await dedupeFlowChecklistLinksByName();
  // קטגוריות ספקים לפי תפקיד (אריזות / ניקיון) — גם כשהשמות שונים («אריזה» מול «אריזות»)
  removed += await dedupeSupplierCategoriesByRole();
  // אחרי מיזוג קטגוריות — ספקים/חומרים יכולים לחלוק fingerprint רק עכשיו
  removed += await dedupeCollectionByFingerprint('suppliers');
  removed += await dedupeCollectionByFingerprint('rawMaterials');
  const repaired = await repairOrphanSupplierCategoryLinks();
  return { removed, repaired };
}

/** שמות ברירת-מחדל / seed ישנים — ריקים נמחקים אחרי pull */
const FRESH_SEED_SUPPLIER_CATEGORY_NAMES = new Set([
  'חומרי גלם יבשים',
  'חלב ומוצריו',
  'ירקות ופירות',
  'אריזה',
  'אחר',
]);

// supplierCategoryRoleKey moved to ./sync/collections.js (also used by rowDedupeFingerprint
// there); re-exported below so existing imports from this module keep working.
export {
  supplierCategoryRoleKey,
  supplierCategoryCanonicalName,
  toCloudUpdatedAt,
  planManualLiveSync,
  planProductionLabelPush,
};

/**
 * מוחק קטגוריות ברירת-מחדל ריקות (גם אם כבר סונכרנו לענן) —
 * מונע דחיפת/שמירת «אריזה»/«חומרי גלם יבשים» ככפילות מול הקטגוריות האמיתיות.
 * עם syncId — soft-delete לענן דרך deleteLocalDuplicateRow.
 */
export async function pruneUnsyncedEmptySeedSupplierCategories() {
  if (!db.supplierCategories) return 0;
  const rows = await db.supplierCategories.toArray();
  let removed = 0;
  for (const cat of rows) {
    const name = String(cat.name || '').trim();
    if (!FRESH_SEED_SUPPLIER_CATEGORY_NAMES.has(name)) continue;
    const mats = await db.rawMaterials.where('supplierCategoryId').equals(cat.id).count();
    const sups = await db.suppliers.where('categoryId').equals(cat.id).count();
    if (mats > 0 || sups > 0) continue;
    await deleteLocalDuplicateRow('supplierCategories', cat);
    removed += 1;
  }
  return removed;
}

/** ציון העדפה ל-survivor של קטגוריה — יותר נתונים / שם קנוני / דגלים */
async function scoreSupplierCategorySurvivor(cat, role) {
  const mats = await db.rawMaterials.where('supplierCategoryId').equals(cat.id).count();
  const sups = await db.suppliers.where('categoryId').equals(cat.id).count();
  const canonical = supplierCategoryCanonicalName(role);
  const name = String(cat.name || '').trim();
  let score = mats * 100 + sups * 10;
  if (canonical && name === canonical) score += 50;
  if (role === 'raw' && name === 'חומרי גלם יבשים') score -= 20; // seed ישן
  if (role === 'packaging' && name === 'אריזה') score -= 10;
  if (role === 'packaging' && cat.isPackaging) score += 5;
  if (role === 'cleaning' && cat.isCleaning) score += 5;
  // id נמוך יותר = ישן יותר (טיי-ברייקר שלילי קטן)
  score -= Math.min(cat.id || 0, 1000) * 0.001;
  return score;
}

/** מאחד כפילויות אריזות/ניקיון/חומ״ג גם כשהשם לא זהה בדיוק */
async function dedupeSupplierCategoriesByRole() {
  if (!db.supplierCategories) return 0;
  const rows = await db.supplierCategories.toArray();
  const byRole = new Map();
  for (const row of rows) {
    const role = supplierCategoryRoleKey(row);
    if (!role) continue;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(row);
  }
  let removed = 0;
  for (const [role, list] of byRole.entries()) {
    if (list.length < 2) {
      // גם בודד — נרמל שם/דגלים אם צריך
      if (list.length === 1) {
        const keep = list[0];
        const patch = {};
        const canonical = supplierCategoryCanonicalName(role);
        if (role === 'cleaning' && !keep.isCleaning) {
          patch.isCleaning = true;
          patch.isPackaging = false;
        }
        if (role === 'packaging' && !keep.isPackaging) {
          patch.isPackaging = true;
          patch.isCleaning = false;
        }
        if (canonical && String(keep.name || '').trim() !== canonical
            && (FRESH_SEED_SUPPLIER_CATEGORY_NAMES.has(String(keep.name || '').trim())
              || (role === 'raw' && /יבשים/.test(String(keep.name || '')))
              || (role === 'import' && /יי?בוא/.test(String(keep.name || ''))))) {
          patch.name = canonical;
        }
        if (Object.keys(patch).length) {
          await db.supplierCategories.update(keep.id, patch);
          await enqueueUpsert('supplierCategories', keep.id);
        }
      }
      continue;
    }
    const scored = [];
    for (const row of list) {
      scored.push({ row, score: await scoreSupplierCategorySurvivor(row, role) });
    }
    scored.sort((a, b) => b.score - a.score);
    const keep = scored[0].row;
    const patch = {};
    const canonical = supplierCategoryCanonicalName(role);
    if (role === 'cleaning' && !keep.isCleaning) {
      patch.isCleaning = true;
      patch.isPackaging = false;
    }
    if (role === 'packaging' && !keep.isPackaging) {
      patch.isPackaging = true;
      patch.isCleaning = false;
    }
    if (canonical && String(keep.name || '').trim() !== canonical) {
      // רק אם השם הוא seed/וריאציה של אותו תפקיד — לא לדרוס שם מותאם אישית
      const keepName = String(keep.name || '').trim();
      if (FRESH_SEED_SUPPLIER_CATEGORY_NAMES.has(keepName)
          || /^אריז/.test(keepName)
          || /^חומרי\s*גלם/.test(keepName)
          || /ניקיון/.test(keepName)
          || (/יי?בוא/.test(keepName) && /מתכו/.test(keepName))) {
        patch.name = canonical;
      }
    }
    if (Object.keys(patch).length) {
      await db.supplierCategories.update(keep.id, patch);
      await enqueueUpsert('supplierCategories', keep.id);
    }
    for (const { row: drop } of scored.slice(1)) {
      await retargetLocalForeignKeys('supplierCategories', drop.id, keep.id);
      await deleteLocalDuplicateRow('supplierCategories', drop);
      removed += 1;
    }
  }
  return removed;
}

/**
 * מתקן שיוך קטגוריות:
 * 1) ספקים/חומרים יתומים (categoryId חסר/נמחק)
 * 2) חומרים ששויכו בטעות ל«אריזות» בלי packagingKind → חוזרים לחומ״ג
 * 3) ספקים לפי רוב תפקיד החומרים שלהם
 * ברירת מחדל תמיד חומ״ג — לעולם לא אריזות.
 */
export async function repairOrphanSupplierCategoryLinks() {
  if (!db.supplierCategories || !db.suppliers || !db.rawMaterials) return 0;

  const catsQuick = await db.supplierCategories.toArray();
  const byIdQuick = new Map(catsQuick.map((c) => [Number(c.id), c]));
  const materials = await db.rawMaterials.toArray();
  const suppliers = await db.suppliers.toArray();

  // סריקה מהירה — אם הכל כבר משויך נכון, לא נוגעים ב-DB
  let likelyNeedsWork = !catsQuick.length;
  if (!likelyNeedsWork) {
    for (const m of materials) {
      const role = inferRawMaterialSupplierRole(m, byIdQuick);
      const cat = byIdQuick.get(Number(m.supplierCategoryId));
      const curRole = supplierCategoryRoleKey(cat);
      const fakePack = role !== 'packaging' && !!m.packagingKind;
      if (!cat || curRole !== role || fakePack) {
        // import vs raw: שמר על import אם זה התפקיד
        if (role === 'raw' && curRole === 'import') continue;
        if (role === 'import' && curRole === 'import') continue;
        if (role === 'raw' && !curRole && cat && !cat.isPackaging && !cat.isCleaning) continue;
        likelyNeedsWork = true;
        break;
      }
    }
  }
  if (!likelyNeedsWork) {
    for (const s of suppliers) {
      if (!byIdQuick.has(Number(s.categoryId))) {
        likelyNeedsWork = true;
        break;
      }
    }
  }
  if (!likelyNeedsWork) return 0;

  const byRole = await ensureRoleSupplierCategories();
  const rawCat = byRole.get('raw');
  const packCat = byRole.get('packaging');
  const cleanCat = byRole.get('cleaning');
  if (!rawCat) return 0;

  const cats = await db.supplierCategories.toArray();
  const byId = new Map(cats.map((c) => [Number(c.id), c]));
  const roleCat = (role) => {
    if (role === 'packaging') return packCat || rawCat;
    if (role === 'cleaning') return cleanCat || rawCat;
    if (role === 'import') {
      const imp = cats.find((c) => supplierCategoryRoleKey(c) === 'import');
      return imp || rawCat;
    }
    return rawCat;
  };

  let fixed = 0;
  const matRoleById = new Map();
  const packNameRe = /קרטון|קופס|מגש|שקית|ניילון|מדבק|סרט|לוגו|מכסה|אלומינ|כפפ|מנשא|מיכל|תבנית|אריז|פלסטיק|פואל|פויל|רדיד/;

  for (const m of materials) {
    const role = inferRawMaterialSupplierRole(m, byId);
    matRoleById.set(m.id, role);
    const target = roleCat(role);
    if (!target) continue;
    const cid = Number(m.supplierCategoryId);
    const alreadyOk = cid === Number(target.id) && byId.has(cid);
    const clearFakePackaging = role !== 'packaging' && !!m.packagingKind
      && !packNameRe.test(String(m.name || ''));
    if (alreadyOk && !clearFakePackaging) continue;
    const patch = { supplierCategoryId: target.id };
    if (clearFakePackaging || (role === 'cleaning' && m.packagingKind)) {
      patch.packagingKind = null;
      patch.packUnitsCount = null;
      patch.packProductsPerUnit = null;
      patch.packLinkedProductId = null;
      patch.packLinkedCategoryId = null;
    }
    await db.rawMaterials.update(m.id, patch);
    await enqueueUpsert('rawMaterials', m.id);
    fixed += 1;
  }

  for (const s of suppliers) {
    const mats = materials.filter((m) => Number(m.supplierId) === Number(s.id));
    const counts = { raw: 0, packaging: 0, cleaning: 0, import: 0 };
    for (const m of mats) {
      const role = matRoleById.get(m.id) || 'raw';
      counts[role] = (counts[role] || 0) + 1;
    }
    let bestRole = 'raw';
    let bestCount = -1;
    for (const role of ['raw', 'cleaning', 'packaging', 'import']) {
      const n = counts[role] || 0;
      if (n > bestCount) {
        bestCount = n;
        bestRole = role;
      }
    }
    let target;
    if (!mats.length) {
      const cur = byId.get(Number(s.categoryId));
      const curRole = supplierCategoryRoleKey(cur);
      target = curRole ? roleCat(curRole) : rawCat;
    } else {
      target = roleCat(bestRole);
    }
    if (!target) continue;
    if (Number(s.categoryId) === Number(target.id) && byId.has(Number(s.categoryId))) continue;
    await db.suppliers.update(s.id, { categoryId: target.id });
    await enqueueUpsert('suppliers', s.id);
    fixed += 1;
  }

  return fixed;
}

/** Prefer the survivor that matches cloud cleanup (richest material link, then oldest id). */
function compareDedupeSurvivors(collection, a, b) {
  if (collection === 'recipeIngredients') {
    const aMat = a.rawMaterialId != null && a.rawMaterialId !== '' ? 1 : 0;
    const bMat = b.rawMaterialId != null && b.rawMaterialId !== '' ? 1 : 0;
    if (bMat !== aMat) return bMat - aMat;
  }
  if (collection === 'productionEntries') {
    const aRun = a.runId != null && a.runId !== '' ? 1 : 0;
    const bRun = b.runId != null && b.runId !== '' ? 1 : 0;
    if (bRun !== aRun) return bRun - aRun;
  }
  if (collection === 'runPreparationChecks' || collection === 'runCleaningChecks') {
    const aChecked = a.checked ? 1 : 0;
    const bChecked = b.checked ? 1 : 0;
    if (bChecked !== aChecked) return bChecked - aChecked;
  }
  if (collection === 'managerPlanItems') {
    const aDone = a.done ? 1 : 0;
    const bDone = b.done ? 1 : 0;
    if (bDone !== aDone) return bDone - aDone;
  }
  if (collection === 'checklistTasks') {
    // עדיפות למשימה עם categoryId (אחרי מיגרציה) על פני עותק ישן בלי קטגוריה
    const aCat = a.categoryId != null && a.categoryId !== '' ? 1 : 0;
    const bCat = b.categoryId != null && b.categoryId !== '' ? 1 : 0;
    if (bCat !== aCat) return bCat - aCat;
  }
  if (collection === 'rawMaterials') {
    // אחרי הזנת מחירים במכשיר אחר — לשמור את השורה עם מחיר
    const aPrice = Number(a.unitPrice) > 0 ? 1 : 0;
    const bPrice = Number(b.unitPrice) > 0 ? 1 : 0;
    if (bPrice !== aPrice) return bPrice - aPrice;
  }
  if (collection === 'supplierCategories') {
    const aFlag = (a.isPackaging || a.isCleaning) ? 1 : 0;
    const bFlag = (b.isPackaging || b.isCleaning) ? 1 : 0;
    if (bFlag !== aFlag) return bFlag - aFlag;
  }
  return (a.id - b.id);
}

/**
 * מיזוג משימת צ׳קליסט כפולה: מעביר קישורים/צ׳קים ל-keep, מוחק כפילויות
 * שאי אפשר לעדכן בגלל אינדקס ייחודי [flowId+checklistTaskId] / [runId+flowPreparationId].
 */
async function mergeChecklistTaskInto(keepId, dropId) {
  const keep = Number(keepId);
  const drop = Number(dropId);
  if (!keep || !drop || keep === drop) return;

  const dropLinks = await db.flowChecklistItems.where('checklistTaskId').equals(drop).toArray();
  for (const link of dropLinks) {
    const existing = await db.flowChecklistItems
      .where('[flowId+checklistTaskId]')
      .equals([link.flowId, keep])
      .first();
    if (existing) {
      await deleteLocalDuplicateRow('flowChecklistItems', link);
    } else {
      await db.flowChecklistItems.update(link.id, { checklistTaskId: keep });
      await enqueueUpsert('flowChecklistItems', link.id);
    }
  }

  const dropChecks = await db.runPreparationChecks.where('flowPreparationId').equals(drop).toArray();
  for (const check of dropChecks) {
    const existing = await db.runPreparationChecks
      .where('[runId+flowPreparationId]')
      .equals([check.runId, keep])
      .first();
    if (existing) {
      if (check.checked && !existing.checked) {
        await db.runPreparationChecks.update(existing.id, {
          checked: true,
          checkedAt: check.checkedAt || new Date().toISOString(),
        });
        await enqueueUpsert('runPreparationChecks', existing.id);
      }
      await deleteLocalDuplicateRow('runPreparationChecks', check);
    } else {
      await db.runPreparationChecks.update(check.id, { flowPreparationId: keep });
      await enqueueUpsert('runPreparationChecks', check.id);
    }
  }

  if (db.managerPlanItems) {
    const planItems = await db.managerPlanItems
      .filter((i) => Number(i.flowPreparationId) === drop)
      .toArray();
    for (const item of planItems) {
      await db.managerPlanItems.update(item.id, { flowPreparationId: keep });
      await enqueueUpsert('managerPlanItems', item.id);
    }
  }
}

async function deleteLocalDuplicateRow(collection, row) {
  const dropKey = localKeyOf(collection, row);
  const dropMeta = await getMetaByLocal(collection, dropKey);
  invalidateFingerprintCache(collection);
  applyingRemote = true;
  try {
    await db[collection].delete(row.id);
  } finally {
    applyingRemote = false;
  }
  if (dropMeta?.syncId) {
    await markMetaDeleted(collection, dropKey, syncNowISO());
    await enqueue({ type: 'delete', collection, localKey: dropKey });
  } else {
    await db.syncMeta.where('[collection+localKey]').equals([collection, dropKey]).delete();
  }
}

/**
 * אחרי מיזוג משימות: מסיר קישורי תזרים כפולים לאותו שם משימה באותו תזרים.
 */
async function dedupeFlowChecklistLinksByName() {
  let removed = 0;
  if (!db.flowChecklistItems || !db.checklistTasks) return removed;
  const links = await db.flowChecklistItems.toArray();
  const byFlow = new Map();
  for (const link of links) {
    if (!byFlow.has(link.flowId)) byFlow.set(link.flowId, []);
    byFlow.get(link.flowId).push(link);
  }
  for (const flowLinks of byFlow.values()) {
    const seen = new Map(); // normName → keep link
    const sorted = [...flowLinks].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
    for (const link of sorted) {
      const tid = Number(link.checklistTaskId);
      if (!tid) {
        await deleteLocalDuplicateRow('flowChecklistItems', link);
        removed++;
        continue;
      }
      const task = await db.checklistTasks.get(tid);
      if (!task) {
        await deleteLocalDuplicateRow('flowChecklistItems', link);
        removed++;
        continue;
      }
      const key = String(task.name || '').trim().toLocaleLowerCase('he');
      if (!key) continue;
      if (!seen.has(key)) {
        seen.set(key, link);
        continue;
      }
      await deleteLocalDuplicateRow('flowChecklistItems', link);
      removed++;
    }
  }
  return removed;
}

async function applyRemoteRow(collection, cloudRow, deviceId, {
  allowUnresolvedFks = false,
  skipUnchanged = false,
  preferRemote = false,
  protectCloud = false,
} = {}) {
  if (!cloudRow?.id) return false;

  const syncId = cloudRow.id;
  if (collectProductionEntryIds && collection === 'productionEntries' && !cloudRow.deleted_at) {
    collectProductionEntryIds.add(syncId);
  }
  const remoteUpdated = cloudRow.updated_at;
  let existingMeta = await getMetaBySyncId(syncId);

  if (cloudRow.deleted_at) {
    if (existingMeta) {
      const local = await readLocalRecord(collection, existingMeta.localKey);
      if (local) {
        // לפני מחיקת קטגוריית ספק — העבר ספקים/חומרים ל-survivor לפי תפקיד
        // (אחרת הם נעלמים מטאב «ספקים» כיתומים).
        if (collection === 'supplierCategories') {
          const dropId = Number(existingMeta.localKey);
          const role = supplierCategoryRoleKey(local);
          const cats = await db.supplierCategories.toArray();
          let survivor = null;
          if (role) {
            survivor = cats.find((c) => Number(c.id) !== dropId && supplierCategoryRoleKey(c) === role);
          }
          // אל תבחר אריזות כברירת מחדל לכל מחיקה — העדף חומ״ג
          if (!survivor) {
            survivor = cats.find((c) => Number(c.id) !== dropId && supplierCategoryRoleKey(c) === 'raw')
              || cats.find((c) => Number(c.id) !== dropId && !c.isPackaging && !c.isCleaning)
              || cats.find((c) => Number(c.id) !== dropId);
          }
          if (survivor) {
            await retargetLocalForeignKeys('supplierCategories', dropId, survivor.id);
          }
        }
        invalidateFingerprintCache(collection);
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

  // שורה שנשמרה בלי מוצר לא נספרת במסך החודש. מושכים אותה שוב גם אם החותמת זהה.
  const relinkAgain = collection === 'productionEntries'
    && existingMeta
    && !cloudRow.deleted_at
    && await productionEntryNeedsCloudAgain(existingMeta);

  if (!relinkAgain && !preferRemote && existingMeta?.deletedAt) {
    // Tombstone local — never resurrect from cloud until a newer non-deleted remote wins.
    if (!shouldApplyRemote(existingMeta.updatedAt, remoteUpdated)) return false;
  }

  if (!relinkAgain && !preferRemote && existingMeta && !shouldApplyRemote(existingMeta.updatedAt, remoteUpdated)) {
    // Local mapping is newer (or equal). If the row is still here, keep it.
    // If the row is missing, it was deleted locally — do NOT recreate from older cloud data
    // (this used to revive materials right after merge/absorb).
    return false;
  }

  // Incremental pulls overlap the previous window, and every push comes back as
  // an echo: a row this device already holds at exactly this version is a no-op.
  // (Full pulls still re-apply, that is how repair passes restore bad local FKs.)
  if (!relinkAgain && skipUnchanged && existingMeta && !existingMeta.deletedAt
      && existingMeta.syncId === syncId
      && Date.parse(existingMeta.updatedAt) === Date.parse(remoteUpdated)) {
    return false;
  }

  // Local change not yet flushed (delete or edit) — it is newer than this cloud
  // row and will win once pushed. Applying the cloud row first used to overwrite
  // the unsent edit, and the queued push then re-uploaded the old values.
  if (!relinkAgain && !preferRemote && existingMeta) {
    // רק פעולה שעוד לא נשלחה. 'error' כבר נכשלה — אל תחסום מחיר/מנה שהגיעו מהענן.
    const pendingLocal = await db.syncQueue
      .where('status')
      .equals('pending')
      .filter((op) => (
        op.collection === collection
        && String(op.localKey) === String(existingMeta.localKey)
      ))
      .first();
    if (pendingLocal) return false;
  }

  const { payload, unresolved } = await remapFksToLocalIds(collection, cloudRow.payload || {});

  if (collection === 'productionEntries') {
    const linked = await relinkProductionEntryProduct(payload);
    if (linked) {
      const idx = unresolved.indexOf('productId');
      if (idx >= 0) unresolved.splice(idx, 1);
    }
  }

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
    const match = await findLocalByFingerprint(collection, payload, { syncId });
    if (match) {
      if (match.__cloudDuplicateOf) {
        // מכשיר קורא לא מוחק שורה בענן. במשיכה הראשונה הענן מעדכן את העותק המקומי.
        if (protectCloud && !preferRemote) return true;
        if (protectCloud && preferRemote) {
          existingMeta = {
            collection,
            localKey: String(match.id),
            syncId,
            updatedAt: remoteUpdated,
          };
        } else {
          // Same logical category/material already linked to another cloud UUID.
          // Soft-delete the incoming cloud row so pull stops recreating local chips.
          await tombstoneCloudDuplicate(collection, syncId, deviceId);
          if (collection === 'rawMaterials') {
            await mergeRawMaterialPriceInto(match, payload);
          }
          return true;
        }
      }
      existingMeta = {
        collection,
        localKey: String(match.id),
        syncId,
        updatedAt: remoteUpdated,
      };
    }
  }

  if (existingMeta) invalidateFingerprintCache(collection);
  applyingRemote = true;
  try {
    if (existingMeta) {
      const localId = Number(existingMeta.localKey);
      const { id: _drop, ...rest } = payload;
      let localKey = existingMeta.localKey;
      const updated = Number.isFinite(localId) ? await db[collection].update(localId, rest) : 0;
      if (!updated) {
        // Re-create under the same local id where possible, so numeric FKs on rows
        // that survived keep resolving to it.
        const addedId = Number.isFinite(localId)
          ? await db[collection].add({ ...rest, id: localId })
          : await db[collection].add(rest);
        localKey = String(addedId);
      }
      await upsertMeta({
        collection,
        localKey,
        syncId,
        updatedAt: remoteUpdated,
      });
    } else {
      const { id: _drop, ...rest } = payload;
      const newId = await db[collection].add(rest);
      fingerprintCacheAdd(collection, { ...rest, id: newId });
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

/** PostgREST default max-rows is 1000; without paging a new device never sees the rest. */
export const PULL_PAGE_SIZE = 1000;

/**
 * Incremental pulls re-read this much before the last cursor. A row is stamped
 * just before its POST commits, so a pull running at that moment can miss it
 * while already moving the cursor past it; the overlap picks such rows up on the
 * next tick (rows already held are skipped cheaply, see skipUnchanged).
 */
export const PULL_OVERLAP_MS = 2 * 60 * 1000;
/** בלי כותרת Date (CORS) אי אפשר למדוד את שעוון השרת — חלון רחב יותר לא מפספס כתיבה. */
export const PULL_UNMEASURED_OVERLAP_MS = 15 * 60 * 1000;

/**
 * `after` = last row of the previous page (keyset paging). Offset paging skipped
 * a row whenever another device edited an earlier row mid-pull — the edited row
 * moves to the end and everything behind it shifts one place back.
 */
export function buildCollectionPullPath(collection, {
  since = null, after = null, offset = 0, limit = PULL_PAGE_SIZE,
} = {}) {
  const table = tableOf(collection);
  const safeLimit = Math.max(1, Number(limit) || PULL_PAGE_SIZE);
  let path = `/${table}?kitchen_id=eq.${encodeURIComponent(KITCHEN_ID)}&select=*&order=updated_at.asc,id.asc&limit=${safeLimit}`;
  if (after?.updatedAt && after?.id) {
    const ts = String(after.updatedAt).replace(/"/g, '');
    const id = String(after.id).replace(/[^0-9a-fA-F-]/g, '');
    path += `&or=${encodeURIComponent(`(updated_at.gt."${ts}",and(updated_at.eq."${ts}",id.gt.${id}))`)}`;
  } else {
    path += `&offset=${Math.max(0, Number(offset) || 0)}`;
  }
  if (since) path += `&updated_at=gt.${encodeURIComponent(since)}`;
  return path;
}

/** Cursor for an incremental pull: last pull minus the overlap window. */
export function incrementalPullSince(
  lastPullAt,
  serverNowMs = Date.now() + serverClockOffsetMs,
  clockMeasured = true,
) {
  const last = lastPullAt ? Date.parse(lastPullAt) : NaN;
  if (!Number.isFinite(last)) return null;
  // A cursor in the future (saved while this device's clock ran fast) would hide
  // every new row — fall back to a full pull once.
  if (last > serverNowMs + 60 * 1000) return null;
  const overlap = clockMeasured ? PULL_OVERLAP_MS : PULL_UNMEASURED_OVERLAP_MS;
  return new Date(last - overlap).toISOString();
}

const PULL_MAX_PAGES = 500;

export async function pullCollection(collection, {
  since, deferred, skipUnchanged = false, preferRemote = false, protectCloud = false,
} = {}) {
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) return 0;
  const deviceId = await getOrCreateDeviceId();
  let applied = 0;
  let after = null;
  for (let page = 0; page < PULL_MAX_PAGES; page++) {
    let rows;
    try {
      rows = await supabaseFetch(cfg, buildCollectionPullPath(collection, { since, after }));
    } catch (err) {
      if (!after) throw err;
      // עמוד המשך לפי מזהה נכשל — ממשיכים לפי מיקום כדי לא לאבד את שורות הייצור החדשות.
      rows = await supabaseFetch(cfg, buildCollectionPullPath(collection, {
        since,
        offset: page * PULL_PAGE_SIZE,
      }));
    }
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      const ok = await applyRemoteRow(collection, row, deviceId, { skipUnchanged, preferRemote, protectCloud });
      if (ok === 'defer') {
        if (deferred) deferred.push({ collection, row });
        continue;
      }
      if (ok) applied++;
    }
    if (rows.length < PULL_PAGE_SIZE) break;
    const last = rows[rows.length - 1];
    after = { updatedAt: last.updated_at, id: last.id };
  }
  return applied;
}

async function ensureServerClock(cfg) {
  if (serverClockMeasured) return;
  try {
    await supabaseFetch(cfg, '/sync_app_settings?select=id&limit=1');
  } catch { /* the pull itself will surface real errors */ }
}

let pullInFlight = null;
let pullInFlightFull = false;

/**
 * Serialised: the 15s timer, tab focus, «סנכרן עכשיו» and startup could run two
 * pulls at once, and two pulls applying the same new cloud row both found no
 * local match and both inserted it — a duplicate on the new computer.
 */
export async function pullAllCollections({ full = false, preferRemote = false } = {}) {
  if (pullInFlight) {
    if (!full || pullInFlightFull) return pullInFlight;
    try { await pullInFlight; } catch { /* run the full pull anyway */ }
    return pullAllCollections({ full, preferRemote });
  }
  pullInFlightFull = full;
  pullInFlight = runPull({ full, preferRemote }).finally(() => { pullInFlight = null; });
  return pullInFlight;
}

async function runPull({ full = false, preferRemote = false } = {}) {
  if (authHalted) return { applied: 0 };
  const live = await getLiveSyncSettings();
  if (!live.enabled) return { applied: 0 };
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) return { applied: 0 };
  await ensureServerClock(cfg);
  const since = full ? null : incrementalPullSince(
    live.lastPullAt,
    Date.now() + serverClockOffsetMs,
    serverClockMeasured,
  );
  const skipUnchanged = !!since;
  const protectCloud = isCloudFirstEnabled(live) && !isCutoverDevice(live);
  const deferred = [];
  const pullOpts = { since, deferred, skipUnchanged, preferRemote, protectCloud };
  let applied = 0;
  // Cursor = pull start on the server clock. Converted at the end, with the
  // offset measured by this pull's own responses.
  const pullStartedLocalMs = Date.now();
  fpCache = new Map();
  clearProductionProductCache();
  try {
    let pullError = null;
    for (const collection of orderedCollections()) {
      try {
        applied += await pullCollection(collection, pullOpts);
      } catch (err) {
        pullError = err;
        console.warn('live sync pull', collection, err);
      }
    }
    // Second pass: rows whose parents were only created during this pull.
    if (deferred.length) {
      const deviceId = await getOrCreateDeviceId();
      const stillDeferred = [];
      for (const { collection, row } of deferred) {
        const ok = await applyRemoteRow(collection, row, deviceId, { preferRemote, protectCloud });
        if (ok === 'defer') stillDeferred.push({ collection, row });
        else if (ok) applied++;
      }
      // Anything still unresolved is applied without touching its dangling FKs.
      for (const { collection, row } of stillDeferred) {
        const ok = await applyRemoteRow(collection, row, deviceId, { allowUnresolvedFks: true, preferRemote, protectCloud });
        if (ok && ok !== 'defer') applied++;
      }
    }
    fpCache = null;
    clearProductionProductCache();
    if (pullError) {
      const classified = classifyLiveSyncError(pullError);
      await saveLiveSyncSettings({
        lastError: classified.message || String(pullError.message || pullError),
        lastErrorKind: classified.kind,
      });
    } else {
      await saveLiveSyncSettings({
        lastPullAt: new Date(pullStartedLocalMs + serverClockOffsetMs).toISOString(),
        lastError: null,
        lastErrorKind: null,
        clockSkewMs: serverClockOffsetMs,
      });
    }
    if (applied > 0) {
      try { await coerceSupplierNumericFks(); } catch { /* ignore */ }
      try { await reconcileRawMaterialPricesFromHistory(); } catch { /* ignore */ }
      if (!collectProductionEntryIds) emitStatus({ applied });
    }
  } catch (err) {
    const classified = classifyLiveSyncError(err);
    await saveLiveSyncSettings({
      lastError: classified.message || String(err.message || err),
      lastErrorKind: classified.kind,
    });
    throw err;
  } finally {
    fpCache = null;
    clearProductionProductCache();
  }
  return { applied };
}

/**
 * One-time / on-demand: push all local rows to cloud (seed).
 * Serialised: the manual button and the automatic seed on startup can fire at
 * the same time, and two loops racing would mint two cloud ids per local row.
 */
let seedInFlight = null;

export function seedLocalDataToSupabase(options = {}) {
  if (seedInFlight) return seedInFlight;
  seedInFlight = runSeed(options).finally(() => { seedInFlight = null; });
  return seedInFlight;
}

/** Rows per POST. One request per row made a full seed take ~30 minutes. */
const SEED_CHUNK_SIZE = 200;

async function runSeed({ force = false } = {}) {
  const live = await getLiveSyncSettings();
  if (live.seedDone && !force) return { seeded: 0, skipped: true };
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) throw new Error('Supabase לא מוגדר');

  const cloudFirst = isCloudFirstEnabled(live);
  if (cloudFirst) {
    const sample = await supabaseFetch(cfg, '/sync_products?select=id&limit=1');
    const cloudHasData = Array.isArray(sample) && sample.length > 0;
    if (!canUploadLocalDatabase({ cloudHasData, isCutoverDevice: live.cutoverDevice === true })) {
      return { seeded: 0, skipped: true, reason: 'cloud-first' };
    }
  }

  const deviceId = await getOrCreateDeviceId();
  const kitchenId = KITCHEN_ID || BACKUP_SCOPE_ID;
  let seeded = 0;

  for (const collection of orderedCollections()) {
    const table = db[collection];
    if (!table) continue;
    const rows = await table.toArray();
    if (!rows.length) continue;

    const cloudRows = [];
    for (const row of rows) {
      const localKey = localKeyOf(collection, row);
      if (!localKey) continue;
      const localStamp = toCloudUpdatedAt(row.updatedAt || row.updated_at, null);
      const updatedAt = cloudFirst
        ? cutoverRowUpdatedAt(collection, localStamp, syncNowISO())
        : (localStamp || syncNowISO());
      // Writes the local↔cloud mapping, so a failed chunk keeps the same id on retry.
      // לא מוחקים את המפה: מזהה חדש על שורה שכבר בענן היה משכפל אותה.
      const syncId = await ensureSyncId(collection, localKey, updatedAt ? { updatedAt } : {});
      if (!syncId) continue;
      const source = await labelSyncRow(collection, row);
      const payload = await remapFksToSyncIds(collection, source);
      if (collection === 'settings') payload.key = row.key;
      cloudRows.push({
        id: syncId,
        kitchen_id: kitchenId,
        payload,
        updated_at: updatedAt,
        deleted_at: null,
        device_id: deviceId,
      });
    }
    if (!cloudRows.length) continue;

    const tableName = tableOf(collection);
    for (let i = 0; i < cloudRows.length; i += SEED_CHUNK_SIZE) {
      const chunk = cloudRows.slice(i, i + SEED_CHUNK_SIZE);
      if (cloudFirst) {
        // מיזוג מול מה שכבר בענן: שדה ריק לא מוחק, ואירוע ישן לא דורס מנה חדשה.
        seeded += await postCloudRows(cfg, collection, chunk);
      } else {
        await supabaseFetch(cfg, `/${tableName}?on_conflict=id`, {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: chunk,
        });
        seeded += chunk.length;
      }
    }
  }

  await saveLiveSyncSettings({
    lastPushAt: new Date().toISOString(),
    lastError: null,
    lastErrorKind: null,
  });
  return { seeded };
}

const CUTOVER_COUNT_TABLES = ['products', 'rawMaterials', 'recipes', 'productionRuns'];

/**
 * העלאה חד-פעמית. רצה רק מכפתור, עם confirm.
 * בלי confirm לא משנה הגדרות ולא שולחת כלום.
 * לא מוחקת את מפת המזהים — מזהה חדש היה משכפל שורות שכבר בענן.
 * הדגל המקומי נשאר על המכשיר הזה. הסימן cloudCutover כן עולה לענן,
 * כדי שמכשיר אחר יעבור למשיכה בלבד.
 */
export async function pushCutoverSnapshot({ confirm = false } = {}) {
  const counts = {};
  for (const name of CUTOVER_COUNT_TABLES) {
    const table = db[name];
    counts[name] = table && typeof table.count === 'function' ? await table.count() : 0;
  }
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const plan = planCutoverSnapshot({
    confirm: confirm === true,
    online,
    hasLocalData: localDatabaseHasRecords(counts),
  });
  if (!plan.push) {
    return { pushed: false, seeded: 0, blockers: plan.blockers };
  }
  await saveLiveSyncSettings({ cloudFirst: true, cutoverDevice: true });
  const result = await seedLocalDataToSupabase({ force: true });
  if (result?.skipped) {
    return {
      pushed: false,
      seeded: 0,
      blockers: [result.reason === 'cloud-first' ? 'המכשיר הזה לא הוגדר כמכשיר הגיבוי' : 'ההעלאה דולגה'],
    };
  }
  await saveLiveSyncSettings({ seedDone: true });
  let markerSynced = false;
  try {
    const deviceId = await getOrCreateDeviceId();
    await setSetting(CLOUD_CUTOVER_KEY, { at: new Date().toISOString(), deviceId });
    await enqueueUpsert('settings', CLOUD_CUTOVER_KEY);
    await flushSyncQueue();
    markerSynced = true;
  } catch (err) {
    console.warn('cutover marker', err);
  }
  return { pushed: true, seeded: result?.seeded || 0, blockers: [], markerSynced };
}

/**
 * מעלה רק תיעוד ייצור ממכשיר הגיבוי.
 * הפעם השורה מהאייפון מחליפה את מה שבענן, גם אם לענן יש חותמת חדשה יותר.
 * לא מוחק את מפת המזהים ולא רץ על מחשב אחר.
 */
export async function pushProductionHistoryFromCutover({ confirm = false } = {}) {
  const live = await getLiveSyncSettings();
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const plan = planProductionHistoryUpload({
    confirm: confirm === true,
    cutoverDevice: live.cutoverDevice === true,
    online,
  });
  if (!plan.ready) return { pushed: false, seeded: 0, entries: 0, blockers: plan.blockers };
  if (!isCloudFirstEnabled(live)) await saveLiveSyncSettings({ cloudFirst: true });
  const result = await seedNamedCollections(PRODUCTION_HISTORY_COLLECTIONS, { stampNow: true, replace: true });
  const entries = result.counts?.productionEntries || 0;
  try {
    await setSetting(PRODUCTION_HISTORY_REV_KEY, { at: new Date().toISOString(), entries });
    await enqueueUpsert('settings', PRODUCTION_HISTORY_REV_KEY);
    await flushSyncQueue();
  } catch (err) {
    console.warn('production history marker', err);
  }
  return { pushed: true, seeded: result.seeded || 0, entries, blockers: [] };
}

/** מכשיר הגיבוי מעלה שוב מנות אחרונות עם שם מוצר, כדי שהמחשב יוכל לקשר אותן. */
async function ensureProductionLabelPush() {
  const live = await getLiveSyncSettings();
  const plan = planProductionLabelPush({
    cutoverDevice: live.cutoverDevice === true,
    labelVersion: live.productionLabelVersion || 0,
  });
  if (!plan.push) return { pushed: false };
  const sinceDate = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const result = await seedNamedCollections(['productionEntries'], {
    stampNow: true,
    replace: true,
    sinceDate,
  });
  const entries = result.counts?.productionEntries || 0;
  try {
    await setSetting(PRODUCTION_HISTORY_REV_KEY, { at: syncNowISO(), entries });
    await enqueueUpsert('settings', PRODUCTION_HISTORY_REV_KEY);
    await flushSyncQueue();
  } catch (err) {
    console.warn('production label marker', err);
  }
  await saveLiveSyncSettings({ productionLabelVersion: PRODUCTION_LABEL_VERSION });
  return { pushed: true, entries };
}

async function productionEntryLabels(row) {
  const product = row?.productId != null ? await db.products.get(Number(row.productId)) : null;
  if (!product) return row;
  const category = product.categoryId != null ? await db.categories.get(Number(product.categoryId)) : null;
  return {
    ...row,
    productName: row.productName || product.name || '',
    categoryName: row.categoryName || category?.name || '',
  };
}

async function labelSyncRow(collection, row) {
  if (!row) return row;
  if (collection !== 'productionEntries' && collection !== 'productionRuns') return row;
  return productionEntryLabels(row);
}

async function seedNamedCollections(names, { stampNow = false, replace = false, sinceDate = null } = {}) {
  const live = await getLiveSyncSettings();
  const cloudFirst = isCloudFirstEnabled(live);
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) throw new Error('Supabase לא מוגדר');
  const wanted = new Set(names);
  const deviceId = await getOrCreateDeviceId();
  const kitchenId = KITCHEN_ID || BACKUP_SCOPE_ID;
  let seeded = 0;
  const counts = {};

  for (const collection of orderedCollections()) {
    if (!wanted.has(collection)) continue;
    const table = db[collection];
    if (!table) continue;
    const rows = await table.toArray();
    if (!rows.length) continue;
    const cloudRows = [];
    for (const row of rows) {
      if (sinceDate && row.date && String(row.date) < sinceDate) continue;
      const localKey = localKeyOf(collection, row);
      if (!localKey) continue;
      const localStamp = toCloudUpdatedAt(row.updatedAt || row.updated_at, null);
      const updatedAt = stampNow
        ? syncNowISO()
        : (cloudFirst
          ? cutoverRowUpdatedAt(collection, localStamp, syncNowISO())
          : (localStamp || syncNowISO()));
      const syncId = await ensureSyncId(collection, localKey, updatedAt ? { updatedAt } : {});
      if (!syncId) continue;
      const source = await labelSyncRow(collection, row);
      const payload = await remapFksToSyncIds(collection, source);
      cloudRows.push({
        id: syncId,
        kitchen_id: kitchenId,
        payload,
        updated_at: updatedAt,
        deleted_at: null,
        device_id: deviceId,
      });
    }
    if (!cloudRows.length) continue;
    const tableName = tableOf(collection);
    for (let i = 0; i < cloudRows.length; i += SEED_CHUNK_SIZE) {
      const chunk = cloudRows.slice(i, i + SEED_CHUNK_SIZE);
      const sent = (replace || cloudFirst)
        ? await postCloudRows(cfg, collection, chunk, { replace })
        : null;
      if (sent == null) {
        await supabaseFetch(cfg, `/${tableName}?on_conflict=id`, {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: chunk,
        });
      }
      const n = sent == null ? chunk.length : sent;
      seeded += n;
      counts[collection] = (counts[collection] || 0) + n;
    }
  }
  await saveLiveSyncSettings({
    lastPushAt: new Date().toISOString(),
    lastError: null,
    lastErrorKind: null,
  });
  return { seeded, counts };
}

async function readCloudCutoverMarker() {
  const local = await getSetting(CLOUD_CUTOVER_KEY);
  if (cloudCutoverMarkerPresent(local)) return local;
  const cfg = await getSupabaseBackupConfig();
  if (!cfg?.supabaseUrl || !cfg?.anonKey) return null;
  const rows = await supabaseFetch(
    cfg,
    `/sync_app_settings?select=payload,deleted_at&payload->>key=eq.${encodeURIComponent(CLOUD_CUTOVER_KEY)}&limit=5`,
  );
  if (!Array.isArray(rows)) return null;
  const hit = rows.find((row) => !row.deleted_at && cloudCutoverMarkerPresent(row?.payload?.value));
  return hit ? hit.payload.value : null;
}

/** לפני כל דחיפה: אם המעבר כבר בוצע במכשיר אחר, המכשיר הזה רק מושך. */
async function adoptCloudFirstFromMarker() {
  const live = await getLiveSyncSettings();
  const planPreview = planAdoptCloudFirst({
    cutoverDevice: isCutoverDevice(live),
    cloudFirst: isCloudFirstEnabled(live),
    markerPresent: false,
  });
  if (planPreview.reason === 'cutover-device' || planPreview.reason === 'already-on') return;
  let marker = null;
  try {
    marker = await readCloudCutoverMarker();
  } catch (err) {
    console.warn('cloud cutover marker', err);
    return;
  }
  const plan = planAdoptCloudFirst({
    cutoverDevice: isCutoverDevice(live),
    cloudFirst: isCloudFirstEnabled(live),
    markerPresent: cloudCutoverMarkerPresent(marker),
  });
  if (!plan.adopt) return;
  await saveLiveSyncSettings({ cloudFirst: true, cutoverDevice: false });
}

/** מחשב או טלפון אחר: מושך את כל הענן פעם אחת, בלי לשלוח את מה שכבר היה עליו. */
export async function ensureCloudJoinPull() {
  const live = await getLiveSyncSettings();
  const plan = planCloudJoin({
    cloudFirst: isCloudFirstEnabled(live),
    cutoverDevice: isCutoverDevice(live),
    joinPullDone: live.cloudJoinPullDone === true,
  });
  if (!plan.pullFull) return { joined: false };
  if (plan.dropQueue) {
    await db.syncQueue.clear();
    await saveLiveSyncSettings({ pendingCount: 0 });
  }
  await pullAllCollections({ full: true, preferRemote: true });
  await saveLiveSyncSettings({ cloudJoinPullDone: true, seedDone: true });
  return { joined: true };
}

async function readProductionHistoryMarker() {
  const local = await getSetting(PRODUCTION_HISTORY_REV_KEY);
  if (productionHistoryMarkerAt(local)) return local;
  const cfg = await getSupabaseBackupConfig();
  if (!cfg?.supabaseUrl || !cfg?.anonKey) return null;
  const rows = await supabaseFetch(
    cfg,
    `/sync_app_settings?select=payload,deleted_at&payload->>key=eq.${encodeURIComponent(PRODUCTION_HISTORY_REV_KEY)}&limit=5`,
  );
  if (!Array.isArray(rows)) return null;
  const hit = rows.find((row) => !row.deleted_at && productionHistoryMarkerAt(row?.payload?.value));
  if (!hit) return null;
  applyingRemote = true;
  try {
    await setSetting(PRODUCTION_HISTORY_REV_KEY, hit.payload.value);
  } finally {
    applyingRemote = false;
  }
  return hit.payload.value;
}

/** מחשב שסומן בטעות כמכשיר הגיבוי עובר למשיכה, בלי לגעת באייפון עצמו. */
async function demoteForeignCutoverDevice() {
  const live = await getLiveSyncSettings();
  if (live.cutoverDevice !== true) return;
  let marker = null;
  try {
    marker = await readCloudCutoverMarker();
  } catch (err) {
    console.warn('cloud cutover marker', err);
    return;
  }
  const plan = planDemoteForeignCutover({
    cutoverDevice: true,
    localDeviceId: await getOrCreateDeviceId(),
    markerDeviceId: marker?.deviceId || '',
  });
  if (!plan.demote) return;
  await saveLiveSyncSettings({ cloudFirst: true, cutoverDevice: false });
}

/** שומר מזהה מוצר מקומי על שורות שכבר ירדו עם שם, בלי להעלות אותן בחזרה. */
async function relinkStoredProductionEntries() {
  const products = await productionProductsForRelink();
  const entries = await db.productionEntries.toArray();
  const linked = entriesWithLocalProducts(entries, products);
  let changed = 0;
  applyingRemote = true;
  try {
    for (let i = 0; i < entries.length; i++) {
      const before = entries[i];
      const after = linked[i];
      if (!before || !after || String(before.productId) === String(after.productId)) continue;
      await db.productionEntries.update(before.id, { productId: after.productId });
      changed++;
    }
  } finally {
    applyingRemote = false;
    clearProductionProductCache();
  }
  return changed;
}

let historyPullInFlight = null;

/**
 * אחרי שהאייפון החליף את תיעוד הייצור, המחשב מושך את שורות הייצור
 * ומוחק שורות מקומיות שלא קיימות בענן — כדי שלא ייספרו פעמיים.
 * משיכה שכבר סומנה כגמורה בגרסה ישנה רצה שוב פעם אחת.
 */
export function ensureProductionHistoryPull() {
  if (historyPullInFlight) return historyPullInFlight;
  historyPullInFlight = runEnsureProductionHistoryPull().finally(() => {
    historyPullInFlight = null;
  });
  return historyPullInFlight;
}

async function runEnsureProductionHistoryPull() {
  try {
    await adoptCloudFirstFromMarker();
  } catch (err) {
    console.warn('adopt cloud first', err);
  }
  try {
    await demoteForeignCutoverDevice();
  } catch (err) {
    console.warn('demote cutover', err);
  }
  const live = await getLiveSyncSettings();
  let marker = null;
  try {
    marker = await readProductionHistoryMarker();
  } catch (err) {
    console.warn('production history marker', err);
    return { pulled: false };
  }
  const markerAt = productionHistoryMarkerAt(marker);
  const plan = planProductionHistoryPull({
    cloudFirst: isCloudFirstEnabled(live),
    cutoverDevice: isCutoverDevice(live),
    markerAt,
    pulledAt: live.productionHistoryPulledAt || '',
    entries: marker?.entries,
    pullVersion: live.productionPullVersion || 0,
    neededVersion: PRODUCTION_PULL_VERSION,
  });
  if (!plan.pullFull) return { pulled: false };
  collectProductionEntryIds = new Set();
  try {
    // רק קטגוריות, מוצרים ושורות ייצור. משיכה של כל הטבלאות נעצרת
    // אם טבלה אחרת נכשלת, ושורות הייצור (בסוף הרשימה) לא מגיעות למחשב.
    const pullResult = await pullProductionEntriesForMonth({ preferRemote: true, protectCloud: true });
    const seen = collectProductionEntryIds ? collectProductionEntryIds.size : 0;
    // משיכה ריקה לא נספרת כהצלחה — אחרת המחשב לא מנסה שוב.
    if (seen === 0) return { pulled: false, empty: true };
    await purgeProductionEntriesNotInCloud(collectProductionEntryIds);
    await relinkStoredProductionEntries();
    await saveLiveSyncSettings({
      productionHistoryPulledAt: markerAt || 'local-repair',
      productionPullVersion: PRODUCTION_PULL_VERSION,
    });
    const applied = pullResult?.applied || seen;
    queueMicrotask(() => emitStatus({ applied }));
    return { pulled: true, pullResult };
  } finally {
    collectProductionEntryIds = null;
  }
}

async function pullProductionEntriesForMonth({ preferRemote = true, protectCloud = true } = {}) {
  const deferred = [];
  const opts = { since: null, deferred, skipUnchanged: false, preferRemote, protectCloud };
  let applied = 0;
  fpCache = new Map();
  clearProductionProductCache();
  try {
    for (const collection of ['categories', 'products', ...PRODUCTION_HISTORY_COLLECTIONS]) {
      try {
        applied += await pullCollection(collection, opts);
      } catch (err) {
        console.warn('live sync pull', collection, err);
      }
    }
    const deviceId = await getOrCreateDeviceId();
    const stillDeferred = [];
    for (const item of deferred) {
      const ok = await applyRemoteRow(item.collection, item.row, deviceId, { preferRemote, protectCloud });
      if (ok === 'defer') stillDeferred.push(item);
      else if (ok) applied++;
    }
    for (const item of stillDeferred) {
      const ok = await applyRemoteRow(item.collection, item.row, deviceId, {
        allowUnresolvedFks: true, preferRemote, protectCloud,
      });
      if (ok && ok !== 'defer') applied++;
    }
  } finally {
    fpCache = null;
    clearProductionProductCache();
  }
  return { applied };
}

async function purgeProductionEntriesNotInCloud(seen) {
  if (!seen || seen.size === 0) return 0;
  const entries = await db.productionEntries.toArray();
  const drop = [];
  for (const entry of entries) {
    const meta = await getMetaByLocal('productionEntries', entry.id);
    if (meta?.syncId && seen.has(meta.syncId)) continue;
    drop.push(entry);
  }
  if (!drop.length) return 0;
  applyingRemote = true;
  try {
    for (const entry of drop) {
      await db.productionEntries.delete(entry.id);
      await db.syncMeta.where('[collection+localKey]').equals(['productionEntries', String(entry.id)]).delete();
    }
  } finally {
    applyingRemote = false;
  }
  return drop.length;
}

/**
 * Drop every local↔cloud id mapping and pending op, so the next seed uploads
 * the local database as brand new rows. Required after restoring a JSON backup
 * or wiping the cloud tables: the old mappings point at rows that no longer
 * exist, and pushing to them would resurrect stale records.
 */
export async function resetLocalSyncState() {
  await db.syncQueue.clear();
  await db.syncMeta.clear();
  // Mark the repair passes as already done: a restored backup is known-good, and
  // re-running dedupe over it is what corrupted the data in the first place.
  // seedDone stays true on purpose. A reset means "re-link this device to the
  // cloud", never "upload what is here": with the id map cleared, every local row
  // looks unlinked, and rows the fingerprint cannot identify (anything keyed by a
  // pair of ids rather than a name) would be pushed as new and duplicate the cloud.
  // lastPullAt is cleared instead, so the next tick re-pulls everything and rebuilds
  // the map from the cloud side.
  await saveLiveSyncSettings({
    seedDone: true,
    dedupeDone: true,
    dedupeVersion: DEDUPE_VERSION,
    repairVersion: REPAIR_VERSION,
    lastPullAt: null,
    lastPushAt: null,
    lastError: null,
    pendingCount: 0,
  });
  return { cleared: true };
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
                invalidateFingerprintCache(tableName);
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
                  } else if (req.type === 'update') {
                    // table.update() / Collection.modify() — used by updateRawMaterial
                    // and most in-place edits. add/put alone miss these, so price/supplier
                    // saves stayed local and lastPushAt never moved.
                    for (const k of req.keys || []) {
                      queueSyncOp({
                        type: 'upsert',
                        collection: tableName,
                        localKey: localKeyOf(tableName, k),
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

/**
 * ניקוי קל אחרי pull — מונע חזרת כפילויות.
 * מוגבל בתדירות (ברירת מחדל כל 3 דקות) כדי לא להאט טעינה/רינדור.
 */
let lastLightDedupeAt = 0;
const HIDDEN_PULL_INTERVAL_MS = 2 * 60 * 1000;
let lightDedupeInFlight = null;
const LIGHT_DEDUPE_MIN_MS = 3 * 60 * 1000;

export async function dedupeSupplierWorkspaceLight({ force = false } = {}) {
  const live = await getLiveSyncSettings().catch(() => null);
  if (isCloudFirstEnabled(live)) return { removed: 0, repaired: 0, skipped: true };
  const now = Date.now();
  if (!force && now - lastLightDedupeAt < LIGHT_DEDUPE_MIN_MS) {
    return { removed: 0, repaired: 0, skipped: true };
  }
  if (lightDedupeInFlight) return lightDedupeInFlight;

  lightDedupeInFlight = (async () => {
    try {
      let removed = 0;
      removed += await pruneUnsyncedEmptySeedSupplierCategories();
      removed += await dedupeSupplierCategoriesByRole();
      removed += await coerceSupplierNumericFks();
      // ספקים מעטים — תמיד; חומרים רק ב-force / פעם ראשונה (יקר)
      removed += await dedupeCollectionByFingerprint('suppliers');
      if (force || !lastLightDedupeAt) {
        removed += await dedupeCollectionByFingerprint('supplierCategories');
        removed += await dedupeCollectionByFingerprint('rawMaterials');
      }
      const priceFixed = await reconcileRawMaterialPricesFromHistory();
      const repaired = (await repairOrphanSupplierCategoryLinks()) + (priceFixed || 0);
      lastLightDedupeAt = Date.now();
      if (removed || repaired) {
        console.info('live sync light supplier dedupe', { removed, repaired });
        try { await flushSyncQueue(); } catch { /* ignore */ }
      }
      return { removed, repaired, skipped: false };
    } finally {
      lightDedupeInFlight = null;
    }
  })();

  return lightDedupeInFlight;
}

export async function startLiveSync() {
  if (started) return;
  const token = await resolveSupabaseUserAccessToken();
  if (authHalted && !token) return;
  const resumeAfterAuthHalt = authHalted;
  authHalted = false;
  started = true;
  if (resumeAfterAuthHalt) {
    await saveLiveSyncSettings({ lastError: null, lastErrorKind: null });
  }
  installLiveSyncMiddleware();

  let live = await getLiveSyncSettings();
  if (!live.enabled) return;
  await adoptCloudFirstFromMarker();
  live = await getLiveSyncSettings();
  await ensureCloudJoinPull();
  live = await getLiveSyncSettings();
  try {
    await ensureProductionLabelPush();
  } catch (err) {
    console.warn('production label push', err);
  }
  try {
    await ensureProductionHistoryPull();
  } catch (err) {
    console.warn('production history pull', err);
  }
  live = await getLiveSyncSettings();

  let pulledOk = false;
  let fullPulledOk = false;
  let lastHiddenPullAt = 0;
  const tick = async () => {
    if (authHalted) return;
    try {
      await flushSyncQueue();
      // A hidden tab/window still polled ~80 tables every 15 seconds. In the
      // background pull once a few minutes; returning to the window pulls at once.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        if (Date.now() - lastHiddenPullAt < HIDDEN_PULL_INTERVAL_MS) return;
        lastHiddenPullAt = Date.now();
      }
      const pulled = await pullAllCollections({ full: false });
      pulledOk = true;
      // ניקוי כבד רק כשיש עדכונים מהענן (ולא יותר מפעם ב־3 דקות)
      if ((pulled?.applied || 0) > 0 && !isCloudFirstEnabled(await getLiveSyncSettings())) {
        await dedupeSupplierWorkspaceLight();
      }
    } catch (err) {
      console.warn('live sync tick', err);
    }
  };

  // One-time per repair version: re-pull everything so foreign keys that an
  // earlier bug nulled out locally are restored from the (correct) cloud rows.
  // v3 also re-pushes polymorphic FKs that were uploaded as raw local numerics.
  if (!isCloudFirstEnabled(live) && (live.repairVersion || 0) < REPAIR_VERSION) {
    try {
      await flushSyncQueue();
      await pullAllCollections({ full: true });
      fullPulledOk = true;
      await repushPolymorphicCollections();
      await dedupeSupplierWorkspaceLight({ force: true });
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
  if (!isCloudFirstEnabled(live) && pulledOk && (!live.dedupeDone || (live.dedupeVersion || 0) < DEDUPE_VERSION)) {
    try {
      const pruned = await pruneUnsyncedEmptySeedSupplierCategories();
      if (pruned) console.info('live sync pruned empty seed supplier categories', pruned);
      const result = await dedupeLocalSyncCollections();
      const bridge = await repairRecipeProductLinksFromComposition();
      await flushSyncQueue();
      await saveLiveSyncSettings({ dedupeDone: true, dedupeVersion: DEDUPE_VERSION });
      if (result.removed) console.info('live sync local dedupe removed', result.removed);
      if (bridge.added) console.info('live sync bridged recipe-product links', bridge.added);
    } catch (err) {
      console.warn('live sync local dedupe', err);
    }
  }

  // לא קוראים כאן ל-pushCutoverSnapshot. המעבר רץ רק בקריאה מפורשת עם confirm.
  if (!live.seedDone) {
    try {
      const cfg = await getSupabaseBackupConfig();
      const sample = await supabaseFetch(cfg, `/sync_products?select=id&limit=1`);
      const cloudHasData = Array.isArray(sample) && sample.length > 0;
      if (cloudHasData) {
        // Cloud already has data: pull+match by fingerprint. Do NOT re-seed everything
        // (that created duplicate UUID rows across devices).
        // A new computer has just done the full repair pull above; once is enough.
        if (!fullPulledOk) await pullAllCollections({ full: true });
        // מחק ברירות-מחדל ריקות מקומיות לפני seedOrphan — אחרת הן נדחפות לענן ככפילות
        const pruned = await pruneUnsyncedEmptySeedSupplierCategories();
        if (pruned) console.info('live sync pruned empty seed supplier categories', pruned);
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
      const classified = classifyLiveSyncError(err);
      await saveLiveSyncSettings({
        lastError: classified.message || String(err.message || err),
        lastErrorKind: classified.kind,
      });
    }
  }

  pullTimer = setInterval(tick, 15000);
  liveSyncOnlineHandler = () => { if (!authHalted) tick(); };
  liveSyncVisibilityHandler = () => {
    if (!authHalted && document.visibilityState === 'visible') tick();
  };
  window.addEventListener('online', liveSyncOnlineHandler);
  document.addEventListener('visibilitychange', liveSyncVisibilityHandler);
}

/** Push only local rows that are not yet linked to a cloud syncId. */
async function seedOrphanLocalRows() {
  const live = await getLiveSyncSettings();
  if (isCloudFirstEnabled(live) && live.cutoverDevice !== true) {
    return { seeded: 0, skipped: true, reason: 'cloud-first' };
  }
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

export function isCloudWipeAllowed(live) {
  return live?.enabled === false;
}

/** מוחק את כל שורות הסנכרון של המטבח בענן. לא נוגע ב-Dexie המקומי. */
export async function wipeKitchenCloudTables() {
  const live = await getLiveSyncSettings();
  if (!isCloudWipeAllowed(live)) return { ok: false, reason: 'live-sync-on', deletedTables: 0 };
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) throw new Error('Supabase לא מוגדר');
  const kitchenId = KITCHEN_ID;
  const tables = [...new Set(Object.values(COLLECTION_TABLE))];
  let deletedTables = 0;
  const errors = [];
  for (const table of tables) {
    try {
      await supabaseFetch(cfg, `/${table}?kitchen_id=eq.${encodeURIComponent(kitchenId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
      deletedTables += 1;
    } catch (err) {
      const msg = String(err.message || err);
      if (/does not exist|schema cache|PGRST205|404/i.test(msg)) continue;
      errors.push(`${table}: ${msg}`);
    }
  }
  let remaining = 0;
  for (const table of ['sync_products', 'sync_raw_materials', 'sync_suppliers']) {
    try {
      const rows = await supabaseFetch(
        cfg,
        `/${table}?kitchen_id=eq.${encodeURIComponent(kitchenId)}&select=id&limit=1`,
      );
      if (Array.isArray(rows) && rows.length) remaining += 1;
    } catch { /* ignore missing tables */ }
  }
  return {
    ok: errors.length === 0 && remaining === 0,
    deletedTables,
    errors,
    remaining,
  };
}

export async function stopLiveSync() {
  if (pullTimer) clearInterval(pullTimer);
  pullTimer = null;
  started = false;
}

export async function setLiveSyncEnabled(enabled) {
  const plan = planLiveSyncAlwaysOn(enabled);
  await saveLiveSyncSettings({ enabled: plan.enabled });
  started = false;
  await startLiveSync();
}

export async function getLiveSyncStatus() {
  const [live, cfg, deviceId, pending] = await Promise.all([
    getLiveSyncSettings(),
    getSupabaseBackupConfig(),
    getOrCreateDeviceId(),
    db.syncQueue ? countQueueBacklog() : 0,
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
  const plan = planLiveSyncAlwaysOn(live.enabled);
  if (plan.restore) {
    await saveLiveSyncSettings({ enabled: true });
  }
  return getLiveSyncStatus();
}
