/**
 * כללי סנכרון כשהענן הוא המקור היחיד.
 * עדיין לא מחובר לסנכרון החי — ההחלפה תידלק רק ביום המעבר, ממכשיר אחד.
 */

/** אירועים שרק נוספים. מכשיר ישן לא מחליף רשומה שכבר בענן. */
export const APPEND_ONLY_COLLECTIONS = new Set([
  'productionEntries',
  'processLogs',
  'inventoryMovements',
  'rawMaterialPriceHistory',
  'haccpMonitoringLogs',
]);

const META_KEYS = new Set(['id', 'syncId', 'updatedAt', 'deletedAt', 'deviceId']);

export function isAppendOnlyCollection(collection) {
  return APPEND_ONLY_COLLECTIONS.has(collection);
}

/**
 * מכשיר ריק לא מעלה כלום אם בענן כבר יש נתונים.
 * העלאה מלאה מותרת רק במכשיר המעבר, ורק כשהענן עדיין ריק.
 */
export function canUploadLocalDatabase({ cloudHasData, isCutoverDevice } = {}) {
  if (cloudHasData) return false;
  return isCutoverDevice === true;
}

function isEmptyValue(value) {
  return value == null || value === '';
}

/**
 * שדה ריק מהמכשיר לא מוחק ערך שכבר שמור בענן.
 * בשאר השדות, החותמת החדשה יותר מנצחת.
 */
export function mergeCatalogRecord(remote, incoming, { remoteUpdatedAt, incomingUpdatedAt } = {}) {
  const base = remote && typeof remote === 'object' ? { ...remote } : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  const incomingNewer = Date.parse(incomingUpdatedAt) > Date.parse(remoteUpdatedAt);
  const merged = { ...base };

  for (const [key, value] of Object.entries(next)) {
    if (META_KEYS.has(key)) continue;
    if (isEmptyValue(value) && !isEmptyValue(base[key])) continue;
    if (!incomingNewer && key in base && !isEmptyValue(base[key])) continue;
    merged[key] = value;
  }
  merged.updatedAt = incomingNewer ? incomingUpdatedAt : (remoteUpdatedAt || incomingUpdatedAt);
  return merged;
}

/**
 * מה לעשות עם שמירה מקומית.
 * online: שולחים לענן (או דוחים דריסה).
 * offline: נכנס לתור, והענן נשאר המקור עד שהשליחה מצליחה.
 */
export function planCloudFirstWrite({
  online,
  collection,
  remoteExists = false,
  remoteUpdatedAt = null,
  incomingUpdatedAt = null,
  remote = null,
  incoming = null,
} = {}) {
  if (!online) {
    return { action: 'queue', reason: 'offline' };
  }

  if (isAppendOnlyCollection(collection) && remoteExists) {
    const incomingNewer = Date.parse(incomingUpdatedAt) > Date.parse(remoteUpdatedAt);
    if (!incomingNewer) {
      return { action: 'keep-remote', reason: 'append-only-older' };
    }
  }

  if (remoteExists) {
    return {
      action: 'merge',
      reason: 'catalog-field-merge',
      row: mergeCatalogRecord(remote, incoming, { remoteUpdatedAt, incomingUpdatedAt }),
    };
  }

  return { action: 'push', reason: 'new-row', row: incoming };
}
