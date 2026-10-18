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
 * רק מכשיר הגיבוי מעלה את המסד, גם אם בענן כבר יש נתונים.
 * כל מכשיר אחר לא מעלה — גם כשהענן ריק.
 */
export function canUploadLocalDatabase({ isCutoverDevice } = {}) {
  return isCutoverDevice === true;
}

/**
 * מעבר לא רץ לבד. צריך אישור שזה מכשיר הגיבוי, חיבור, ונתונים עליו.
 */
export function planCloudFirstCutover({ confirmed, online, hasLocalData } = {}) {
  const blockers = [];
  if (confirmed !== true) blockers.push('לא אושר שזה מכשיר הגיבוי');
  if (online !== true) blockers.push('אין חיבור');
  if (hasLocalData !== true) blockers.push('אין נתונים על המכשיר');
  return { ready: blockers.length === 0, blockers };
}

const LOCAL_DATA_COLLECTIONS = ['products', 'rawMaterials', 'recipes', 'productionRuns'];

/** יש על המכשיר משהו שאפשר להעלות: מוצרים, חומרים, מתכונים או ריצות ייצור. */
export function localDatabaseHasRecords(counts = {}) {
  return LOCAL_DATA_COLLECTIONS.some((name) => Number(counts?.[name]) > 0);
}

/**
 * תוכנית ההעלאה החד-פעמית. לא מדליקה כלום ולא שולחת כלום.
 * setFlags ו-push נדלקים רק כשכל התנאים מתקיימים.
 */
export function planCutoverSnapshot({ confirm, online, hasLocalData } = {}) {
  const plan = planCloudFirstCutover({
    confirmed: confirm === true,
    online: online === true,
    hasLocalData: hasLocalData === true,
  });
  if (!plan.ready) {
    return { action: 'stop', setFlags: false, push: false, blockers: plan.blockers };
  }
  return { action: 'push', setFlags: true, push: true, blockers: [] };
}

/**
 * חותמת להעלאה החד-פעמית.
 * קטלוג: עכשיו, כדי שהמכשיר ימלא את הענן, ושדה ריק עדיין לא מוחק ערך.
 * אירוע (מנה, תנועת מלאי): רק חותמת שכבר על הרשומה. בלי חותמת — לא מעמידים פנים שהיא חדשה.
 */
export function cutoverRowUpdatedAt(collection, rowUpdatedAt, now) {
  if (isAppendOnlyCollection(collection)) return rowUpdatedAt || null;
  return now || null;
}

/** סימן בענן שההעלאה החד-פעמית הסתיימה. מסונכרן, בניגוד לדגל המקומי. */
export const CLOUD_CUTOVER_KEY = 'cloudCutover';

export function cloudCutoverMarkerPresent(value) {
  return !!(value && typeof value === 'object' && value.at);
}

/**
 * מכשיר שאינו מכשיר הגיבוי עובר למשיכה בלבד אחרי שהסימן הופיע.
 * מכשיר הגיבוי לא משנה את הדגלים מכאן.
 */
export function planAdoptCloudFirst({ cutoverDevice, cloudFirst, markerPresent } = {}) {
  if (cutoverDevice === true) return { adopt: false, reason: 'cutover-device' };
  if (markerPresent === true && cloudFirst !== true) return { adopt: true, reason: 'marker' };
  return { adopt: false, reason: cloudFirst === true ? 'already-on' : 'waiting' };
}

/**
 * מכשיר שנפתח אחרי המעבר מוריד את כל הענן פעם אחת, ולא שולח את העותק הישן שלו.
 * מכשיר הגיבוי לא נכנס לכאן.
 */
export function planCloudJoin({ cloudFirst, cutoverDevice, joinPullDone } = {}) {
  if (cloudFirst !== true || cutoverDevice === true || joinPullDone === true) {
    return { pullFull: false, dropQueue: false };
  }
  return { pullFull: true, dropQueue: true };
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
