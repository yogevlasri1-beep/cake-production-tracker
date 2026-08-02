import { db } from '../db.js?v=392';
import { COLLECTION_FKS, ARRAY_FKS, POLYMORPHIC_FKS, newSyncId } from './collections.js?v=392';

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
  const key = String(localKey ?? '');
  if (!key || key === 'null' || key === 'undefined' || key === 'NaN') return null;
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
    // Already a sync UUID (e.g. unresolved FK kept on the local row) — pass through.
    if (typeof val === 'string' && !/^\d+$/.test(val)) {
      out[field] = val;
      continue;
    }
    // Only remap when the target record exists — otherwise ensureSyncId would
    // mint a phantom UUID and orphan the FK in the cloud.
    const target = db[targetCollection]
      ? await db[targetCollection].get(Number(val))
      : null;
    if (!target) {
      out[field] = null;
      continue;
    }
    const syncId = await ensureSyncId(targetCollection, val);
    out[field] = syncId || null;
  }
  const arrayFks = ARRAY_FKS[collection] || {};
  for (const [field, targetCollection] of Object.entries(arrayFks)) {
    const vals = out[field];
    if (!Array.isArray(vals) || !vals.length) continue;
    const mapped = [];
    for (const val of vals) {
      if (val == null || val === '') continue;
      // Already a sync UUID — pass through.
      if (typeof val === 'string' && !/^\d+$/.test(val)) {
        mapped.push(val);
        continue;
      }
      const target = db[targetCollection]
        ? await db[targetCollection].get(Number(val))
        : null;
      if (!target) continue;
      const syncId = await ensureSyncId(targetCollection, val);
      if (syncId) mapped.push(syncId);
    }
    out[field] = mapped;
  }
  const poly = POLYMORPHIC_FKS[collection];
  if (poly) {
    const targetCollection = poly.targets[out[poly.typeField]];
    const val = out[poly.idField];
    if (targetCollection && val != null && val !== '' && /^\d+$/.test(String(val))) {
      // Only remap when the target record actually exists locally — otherwise
      // keep the raw value instead of fabricating a syncId for a ghost record.
      const target = db[targetCollection] ? await db[targetCollection].get(Number(val)) : null;
      if (target) {
        const syncId = await ensureSyncId(targetCollection, val);
        if (syncId) out[poly.idField] = syncId;
      }
    }
  }
  return out;
}

/**
 * Replace FK sync UUIDs with local ids for applying remote rows.
 * A UUID with no local mapping is reported in `unresolved` and left untouched —
 * nulling it would orphan the row (e.g. a flow step losing its flowId).
 */
export async function remapFksToLocalIds(collection, payload) {
  const fks = COLLECTION_FKS[collection] || {};
  const out = { ...payload };
  const unresolved = [];
  for (const [field, targetCollection] of Object.entries(fks)) {
    const val = out[field];
    if (val == null || val === '') {
      out[field] = null;
      continue;
    }
    if (typeof val === 'number' || (/^\d+$/.test(String(val)))) {
      // Coerce digit-strings to numbers so Dexie index equality matches local ids.
      out[field] = Number(val);
      continue;
    }
    const meta = await getMetaBySyncId(String(val));
    if (meta && meta.collection === targetCollection) {
      out[field] = collection === 'settings' ? meta.localKey : Number(meta.localKey) || meta.localKey;
    } else {
      unresolved.push(field);
    }
  }
  const arrayFks = ARRAY_FKS[collection] || {};
  for (const [field, targetCollection] of Object.entries(arrayFks)) {
    const vals = out[field];
    if (!Array.isArray(vals) || !vals.length) continue;
    const mapped = [];
    let missing = false;
    for (const val of vals) {
      if (val == null || val === '') continue;
      if (typeof val === 'number' || /^\d+$/.test(String(val))) {
        mapped.push(Number(val));
        continue;
      }
      const meta = await getMetaBySyncId(String(val));
      if (meta && meta.collection === targetCollection) {
        mapped.push(Number(meta.localKey) || meta.localKey);
      } else {
        // Keep the UUID so a later pass can still resolve it.
        mapped.push(val);
        missing = true;
      }
    }
    out[field] = mapped;
    if (missing) unresolved.push(field);
  }
  const poly = POLYMORPHIC_FKS[collection];
  if (poly) {
    const targetCollection = poly.targets[out[poly.typeField]];
    const val = out[poly.idField];
    if (targetCollection && typeof val === 'string' && !/^\d+$/.test(val)) {
      const meta = await getMetaBySyncId(val);
      if (meta && meta.collection === targetCollection) {
        out[poly.idField] = Number(meta.localKey) || meta.localKey;
      } else {
        unresolved.push(poly.idField);
      }
    }
  }
  return { payload: out, unresolved };
}
