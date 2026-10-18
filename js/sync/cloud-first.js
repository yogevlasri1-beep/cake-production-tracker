/**
 * כללי סנכרון כשהענן הוא המקור היחיד.
 * מחובר לסנכרון החי, אבל כבוי עד ש-cloudFirst=true (רק ביום המעבר, במכשיר אחד).
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

/** דולק רק כשההגדרה נשמרה במפורש. ברירת מחדל: כבוי. */
export function isCloudFirstEnabled(live) {
  return live?.cloudFirst === true;
}

export function isCutoverDevice(live) {
  return live?.cutoverDevice === true;
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

/**
 * לפני שליחה לענן: לא לדרוס רשומה חדשה יותר, ולא למחוק שדה מלא עם ערך ריק.
 * בלי רשומה בענן — שולחים כמו שהיא.
 */
export function applyCloudFirstToCloudRow(collection, localCloudRow, remoteCloudRow) {
  if (!localCloudRow) return { send: false, cloudRow: null };
  if (localCloudRow.deleted_at) return { send: true, cloudRow: localCloudRow };
  if (!remoteCloudRow || remoteCloudRow.deleted_at) {
    return { send: true, cloudRow: localCloudRow };
  }
  const plan = planCloudFirstWrite({
    online: true,
    collection,
    remoteExists: true,
    remoteUpdatedAt: remoteCloudRow.updated_at,
    incomingUpdatedAt: localCloudRow.updated_at,
    remote: remoteCloudRow.payload || {},
    incoming: localCloudRow.payload || {},
  });
  if (plan.action === 'keep-remote') return { send: false, cloudRow: null };
  if (plan.action === 'merge' && plan.row) {
    const { updatedAt, ...payload } = plan.row;
    return {
      send: true,
      cloudRow: {
        ...localCloudRow,
        payload,
        updated_at: updatedAt || localCloudRow.updated_at,
      },
    };
  }
  return { send: true, cloudRow: localCloudRow };
}
