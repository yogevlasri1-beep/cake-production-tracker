/**
 * אותו מזהה ענן לאותו שם קטלוג אחרי שחזור.
 * בלי זה שחזור מנפיק UUID חדש, והאייפון דוחף עותק שני.
 */
import { catalogMatchKey, buildCatalogNameMaps } from './collections.js?v=541';

export const STABLE_CATALOG_COLLECTIONS = ['categoryGroups', 'categories', 'products', 'flows'];

export function catalogRowsFromCloud(cloudRows = []) {
  return (cloudRows || [])
    .filter((row) => row && !row.deleted_at && row.payload)
    .map((row) => ({ id: row.id, ...row.payload }));
}

export function pickStableSyncId({ existingSyncId = null, reuseSyncId = null } = {}) {
  return existingSyncId || reuseSyncId || null;
}

export function buildStableIdIndexFromCloud({
  groups = [],
  categories = [],
  products = [],
  flows = [],
} = {}) {
  const maps = buildCatalogNameMaps(
    catalogRowsFromCloud(categories),
    catalogRowsFromCloud(groups),
  );
  const index = new Map();
  const packs = [
    ['categoryGroups', groups],
    ['categories', categories],
    ['products', products],
    ['flows', flows],
  ];
  for (const [collection, rows] of packs) {
    const byKey = new Map();
    for (const row of rows || []) {
      if (!row?.id || row.deleted_at) continue;
      const key = catalogMatchKey(collection, row.payload || {}, maps);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, row.id);
    }
    index.set(collection, byKey);
  }
  return index;
}

export function lookupStableCloudId(index, collection, localRow, localMaps) {
  if (!index || !collection || !localRow) return null;
  const byKey = index.get(collection);
  if (!byKey) return null;
  const key = catalogMatchKey(collection, localRow, localMaps);
  if (!key) return null;
  return byKey.get(key) || null;
}

export function claimStableCloudId(usedIds, reuseSyncId) {
  if (!reuseSyncId) return null;
  if (usedIds.has(reuseSyncId)) return null;
  usedIds.add(reuseSyncId);
  return reuseSyncId;
}
