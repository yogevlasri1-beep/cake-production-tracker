import { db } from '../db.js?v=352';
import { COLLECTION_FKS, newSyncId } from './collections.js?v=352';

export function localKeyOf(collection, recordOrId) {
  if (collection === 'settings') {
    if (recordOrId && typeof recordOrId === 'object') return String(recordOrId.key || '');
    return String(recordOrId || '');
  }
  if (recordOrId && typeof recordOrId === 'object') return String(recordOrId.id ?? '');
  return String(recordOrId ?? '');
}

export async function getMetaByLocal(collection, localKey) {
  const key = String(localKey);
  if (!key) return null;
  return db.syncMeta.get([collection, key]);
}

export async function getMetaBySyncId(syncId) {
  if (!syncId) return null;
  return db.syncMeta.where('syncId').equals(syncId).first();
}

export async function ensureSyncId(collection, localKey, { updatedAt } = {}) {
  const key = String(localKey);
  if (!key) return null;
  const existing = await getMetaByLocal(collection, key);
  if (existing?.syncId) {
    if (updatedAt && updatedAt !== existing.updatedAt) {
      await db.syncMeta.put({ ...existing, updatedAt, deletedAt: null });
    }
    return existing.syncId;
  }
  const syncId = newSyncId();
  const now = updatedAt || new Date().toISOString();
  await db.syncMeta.put({
    collection,
    localKey: key,
    syncId,
    updatedAt: now,
    deletedAt: null,
  });
  return syncId;
}

export async function upsertMeta({ collection, localKey, syncId, updatedAt, deletedAt = null }) {
  await db.syncMeta.put({
    collection,
    localKey: String(localKey),
    syncId,
    updatedAt: updatedAt || new Date().toISOString(),
    deletedAt,
  });
}

export async function markMetaDeleted(collection, localKey, updatedAt) {
  const existing = await getMetaByLocal(collection, localKey);
  if (!existing) return null;
  const ts = updatedAt || new Date().toISOString();
  await db.syncMeta.put({ ...existing, updatedAt: ts, deletedAt: ts });
  return existing.syncId;
}

/** Replace numeric FK local ids with sync UUIDs for upload. */
export async function remapFksToSyncIds(collection, row) {
  const fks = COLLECTION_FKS[collection] || {};
  const out = { ...row };
  delete out.id;
  if (collection === 'settings') delete out.key;
  for (const [field, targetCollection] of Object.entries(fks)) {
    const val = out[field];
    if (val == null || val === '' || val === 0) {
      out[field] = null;
      continue;
    }
    out[field] = await ensureSyncId(targetCollection, val);
  }
  return out;
}

/** Replace FK sync UUIDs with local ids for applying remote rows. */
export async function remapFksToLocalIds(collection, payload) {
  const fks = COLLECTION_FKS[collection] || {};
  const out = { ...payload };
  for (const [field, targetCollection] of Object.entries(fks)) {
    const val = out[field];
    if (val == null || val === '') {
      out[field] = null;
      continue;
    }
    if (typeof val === 'number' || (/^\d+$/.test(String(val)))) {
      // Already local-ish; keep if meta exists, else keep number
      continue;
    }
    const meta = await getMetaBySyncId(String(val));
    if (meta && meta.collection === targetCollection) {
      out[field] = collection === 'settings' ? meta.localKey : Number(meta.localKey) || meta.localKey;
    } else {
      out[field] = null;
    }
  }
  return out;
}
