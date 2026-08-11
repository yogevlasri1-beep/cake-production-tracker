/**
 * Continuous multi-device sync: IndexedDB ↔ Supabase sync_* tables.
 * Last-write-wins by updated_at. Soft-delete via deleted_at.
 */
import { db, getSetting, setSetting } from './db.js?v=463';
import {
  getSupabaseBackupConfig,
  saveSupabaseBackupConfig,
  buildSupabaseRestUrl,
  buildSupabaseHeaders,
  resolveSupabaseUserAccessToken,
  getOrCreateDeviceId,
  BACKUP_SCOPE_ID,
} from './supabase-backup.js?v=463';
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
} from './sync/collections.js?v=463';
import {
  ensureSyncId,
  getMetaByLocal,
  getMetaBySyncId,
  localKeyOf,
  markMetaDeleted,
  remapFksToLocalIds,
  remapFksToSyncIds,
  upsertMeta,
} from './sync/id-map.js?v=463';
import { repairRecipeProductLinksFromComposition } from './kitchen-db.js?v=463';

const LIVE_SYNC_SETTINGS = 'liveSync';
const DEFAULT_LIVE = {
  enabled: true,
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
    /row-level security|rls|permission denied|not authorized|42501|jwt expired|invalid jwt|pgrst301/i.test(raw)
    || (/403|401/.test(raw) && /supabase/i.test(raw))
  ) {
    return {
      kind: 'rls',
      message: 'אין הרשאת כתיבה לענן (משתמש לא מאושר או הרשאה חסרה). אם החשבון חדש — המתן לאישור מנהל בעמדת חשבונות.',
      technical: raw,
    };
  }
  if (/failed to fetch|networkerror|net::|offline|timeout|econnrefused|load failed/i.test(raw)
      || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return {
      kind: 'network',
      message: 'בעיית רשת — לא ניתן להתחבר לענן כרגע. הבדוק חיבור ונסה «סנכרן עכשיו».',
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
  const classified = classifyLiveSyncError(live.lastError || live.lastErrorKind);
  if (classified.kind && classified.kind !== 'other') return classified.message;
  if (live.lastErrorKind === 'pending') {
    return classifyLiveSyncError('pending').message;
  }
  return classified.message || String(live.lastError || '');
}

/** Bump when rowFingerprint / rowDedupeFingerprint rules change so devices re-run local dedupe. */
const DEDUPE_VERSION = 13;

/**
 * Bump to force one full re-pull on every device. Needed after a bug wrote bad
 * foreign keys locally: the cloud rows are correct, so a full pull repairs them.
 * v3 also re-pushes polymorphic FKs that were uploaded as raw local numerics.
 * v7: new devices seeded empty supplier-category defaults that diverged from cloud names.
 * v8: after cloud SQL cleanup of seed categories — full re-pull + material cross-category dedupe.
 * v9: merge «חומרי גלם»/«חומרי גלם יבשים» + re-pull after unique packaging/cleaning indexes.
 */
const REPAIR_VERSION = 9;

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
  const accessToken = await resolveSupabaseUserAccessToken();
  const res = await fetch(url, {
    method,
    headers: buildSupabaseHeaders(cfg.anonKey, {
      ...headers,
      ...(accessToken ? { accessToken } : {}),
    }),
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
  // 'error' items are retried too: a transient failure (network blip, a not-yet-
  // approved account rejected by RLS) must not permanently strand that one write —
  // it used to be marked 'error' and never picked up again, silently dropping it
  // while the rest of the queue kept flushing normally.
  const pending = await db.syncQueue.where('status').anyOf('pending', 'error').sortBy('createdAt');
  let flushed = 0;
  let lastErr = null;
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
      lastErr = String(err.message || err);
      await db.syncQueue.update(item.id, { status: 'error', error: lastErr });
      // Keep trying the remaining queued rows — one bad/rejected row (e.g. an
      // unapproved account hitting RLS) should not block unrelated writes behind it.
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
const LOOSE_MATCH_COLLECTIONS = new Set(['supplierCategories', 'rawMaterials']);

async function findLocalByFingerprint(collection, row, { syncId = null } = {}) {
  if (!row || !db[collection]) return null;
  const strictFp = rowFingerprint(collection, row);
  const looseFp = LOOSE_MATCH_COLLECTIONS.has(collection) ? rowDedupeFingerprint(collection, row) : '';
  if (!strictFp && !looseFp) return null;
  const rows = await db[collection].toArray();
  const strictMatches = [];
  const looseMatches = [];
  for (const r of rows) {
    if (strictFp && rowFingerprint(collection, r) === strictFp) strictMatches.push(r);
    else if (looseFp && looseFp !== strictFp && rowDedupeFingerprint(collection, r) === looseFp) looseMatches.push(r);
  }
  for (const candidate of [...strictMatches, ...looseMatches]) {
    const meta = await getMetaByLocal(collection, candidate.id);
    // A local row already claimed by another cloud row must not be reused: two cloud
    // rows can share a fingerprint (same product and date, no run), and only one
    // mapping fits per local row, so the second one would vanish without a trace.
    if (!meta?.syncId || meta.syncId === syncId) return candidate;
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
  return { removed };
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
export { supplierCategoryRoleKey, supplierCategoryCanonicalName };

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
              || (role === 'raw' && /יבשים/.test(String(keep.name || ''))))) {
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
          || /ניקיון/.test(keepName)) {
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
  applyingRemote = true;
  try {
    await db[collection].delete(row.id);
  } finally {
    applyingRemote = false;
  }
  if (dropMeta?.syncId) {
    await markMetaDeleted(collection, dropKey, new Date().toISOString());
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

  if (existingMeta?.deletedAt) {
    // Tombstone local — never resurrect from cloud until a newer non-deleted remote wins.
    if (!shouldApplyRemote(existingMeta.updatedAt, remoteUpdated)) return false;
  }

  if (existingMeta && !shouldApplyRemote(existingMeta.updatedAt, remoteUpdated)) {
    // Local mapping is newer (or equal). If the row is still here, keep it.
    // If the row is missing, it was deleted locally — do NOT recreate from older cloud data
    // (this used to revive materials right after merge/absorb).
    return false;
  }

  // Pending local delete not yet flushed — don't undo a merge mid-sync.
  if (existingMeta) {
    const pendingDelete = await db.syncQueue
      .where('status')
      .equals('pending')
      .filter((op) => (
        op.type === 'delete'
        && op.collection === collection
        && String(op.localKey) === String(existingMeta.localKey)
      ))
      .first();
    if (pendingDelete) return false;
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
    const match = await findLocalByFingerprint(collection, payload, { syncId });
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
    await saveLiveSyncSettings({ lastPullAt: pullStarted, lastError: null, lastErrorKind: null });
  } catch (err) {
    const classified = classifyLiveSyncError(err);
    await saveLiveSyncSettings({
      lastError: classified.message || String(err.message || err),
      lastErrorKind: classified.kind,
    });
    throw err;
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
      const updatedAt = new Date().toISOString();
      // Writes the local↔cloud mapping, so a failed chunk keeps the same id on retry.
      const syncId = await ensureSyncId(collection, localKey, { updatedAt });
      if (!syncId) continue;
      const payload = await remapFksToSyncIds(collection, row);
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
      await supabaseFetch(cfg, `/${tableName}?on_conflict=id`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: chunk,
      });
      seeded += chunk.length;
    }
  }

  await saveLiveSyncSettings({
    lastPushAt: new Date().toISOString(),
    lastError: null,
    lastErrorKind: null,
  });
  return { seeded };
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

  if (!live.seedDone) {
    try {
      const cfg = await getSupabaseBackupConfig();
      const sample = await supabaseFetch(cfg, `/sync_products?select=id&limit=1`);
      const cloudHasData = Array.isArray(sample) && sample.length > 0;
      if (cloudHasData) {
        // Cloud already has data: pull+match by fingerprint. Do NOT re-seed everything
        // (that created duplicate UUID rows across devices).
        await pullAllCollections({ full: true });
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
  if (live.enabled == null) {
    await saveLiveSyncSettings({ enabled: true });
  }
  return getLiveSyncStatus();
}
