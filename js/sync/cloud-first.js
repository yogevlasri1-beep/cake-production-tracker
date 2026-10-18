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

/** תיעוד הייצור שהעלאה הראשונה דילגה עליו כי לא הייתה לו חותמת. */
export const PRODUCTION_HISTORY_COLLECTIONS = [
  'productionRuns',
  'runStepStates',
  'runPreparationChecks',
  'runCleaningChecks',
  'productionEntries',
  'processLogs',
];

/** רק מכשיר הגיבוי, ורק אחרי אישור. לא רץ לבד. */
export function planProductionHistoryUpload({ confirm, cutoverDevice, online } = {}) {
  const blockers = [];
  if (confirm !== true) blockers.push('לא אושר');
  if (cutoverDevice !== true) blockers.push('זה לא מכשיר הגיבוי');
  if (online !== true) blockers.push('אין חיבור');
  return { ready: blockers.length === 0, blockers };
}

/** סימן שהאייפון החליף את תיעוד הייצור בענן. המחשב מושך מחדש כשהזמן משתנה. */
export const PRODUCTION_HISTORY_REV_KEY = 'productionHistoryRev';

/**
 * דור של משיכת התיעוד. מחשב שמשך בגרסה ישנה שמר את זמן הסימן
 * ודילג על המשיכה החדשה — לכן מעלים את המספר כדי למשוך פעם נוספת.
 */
export const PRODUCTION_PULL_VERSION = 2;

export function productionHistoryMarkerAt(value) {
  const at = value && typeof value === 'object' ? value.at : '';
  return typeof at === 'string' && at ? at : '';
}

/**
 * מחשב שכבר סיים את המשיכה הראשונה לא רואה תיעוד שעודכן אחר כך
 * אם הסמן שלו כבר עבר את זמן ההעלאה. לכן מושכים שוב כשיש סימן חדש,
 * או כשדור המשיכה על המכשיר ישן מהדור שבקוד.
 * מכשיר הגיבוי לא מושך כאן — אצלו הנתונים כבר מקומיים.
 */
export function planProductionHistoryPull({
  cloudFirst,
  cutoverDevice,
  markerAt,
  pulledAt,
  entries,
  pullVersion = 0,
  neededVersion = 0,
} = {}) {
  if (cloudFirst !== true || cutoverDevice === true) return { pullFull: false };
  if (Number(neededVersion) > 0 && (Number(pullVersion) || 0) < Number(neededVersion)) {
    return { pullFull: true };
  }
  // פעם ראשונה במחשב: למשוך את שורות הייצור גם אם הסימן עוד לא נקרא.
  if (!pulledAt) return { pullFull: true };
  if (markerAt && markerAt !== pulledAt && Number(entries) > 0) return { pullFull: true };
  return { pullFull: false };
}

/**
 * מחשב שסומן בטעות כמכשיר הגיבוי לא מושך תיעוד.
 * אם סימן המעבר בענן שייך למכשיר אחר — מכבים כאן את דגל הגיבוי.
 * בלי מזהה בסימן לא מנחשים.
 */
export function planDemoteForeignCutover({ cutoverDevice, localDeviceId, markerDeviceId } = {}) {
  if (cutoverDevice !== true) return { demote: false, reason: 'not-cutover' };
  if (!markerDeviceId || !localDeviceId) return { demote: false, reason: 'no-device' };
  if (String(localDeviceId) === String(markerDeviceId)) return { demote: false, reason: 'this-device' };
  return { demote: true, reason: 'other-device' };
}

/**
 * מחשב לא דורס שורת ייצור שכבר בענן. שורה חדשה (אין בענן) עדיין נשלחת.
 * ההעלאה המפורשת מהאייפון (replace) מחליפה את השורה כמו שהיא.
 */
export function planAppendOnlyPush({ collection, cutoverDevice, remoteExists, replace } = {}) {
  if (replace === true) return { send: true, reason: 'replace' };
  if (!PRODUCTION_HISTORY_COLLECTIONS.includes(collection)) return { send: true, reason: 'catalog' };
  if (cutoverDevice !== true && remoteExists === true) return { send: false, reason: 'reader-keeps-cloud' };
  return { send: true, reason: 'ok' };
}

function normLabel(value) {
  return String(value || '')
    .replace(/["'״׳“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('he');
}

function sameRecordId(a, b) {
  if (a == null || b == null || a === '' || b === '') return false;
  if (String(a) === String(b)) return true;
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

/**
 * מקשר שורת ייצור למוצר המקומי לפי שם, כשמזהה המספר מהאייפון
 * לא תואם את המספר במחשב.
 * שם אחד ברור מנצח. שני מוצרים באותו שם בלי קטגוריה מתאימה — לא מנחשים.
 */
export function pickProductionProductId(products, { productId, productName, categoryName } = {}) {
  const list = Array.isArray(products) ? products : [];
  const byId = list.find((product) => sameRecordId(product?.id, productId)) || null;
  const name = normLabel(productName);
  if (!name) return byId ? byId.id : (productId ?? null);
  if (byId && normLabel(byId.name) === name) return byId.id;
  const named = list.filter((product) => normLabel(product?.name) === name);
  const cat = normLabel(categoryName);
  const inCat = cat ? named.filter((product) => normLabel(product?.categoryName) === cat) : [];
  if (inCat.length === 1) return inCat[0].id;
  if (named.length === 1) return named[0].id;
  return byId ? byId.id : (productId ?? null);
}

/**
 * שורת ייצור עם שם מוצר נספרת גם אם המזהה שעליה הוא מספר ממכשיר אחר.
 * בלי שם, או בלי מוצר מקומי אחד ברור — השורה נשארת כמו שהיא.
 */
export function entriesWithLocalProducts(entries, products) {
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const nextId = pickProductionProductId(products, {
      productId: entry.productId,
      productName: entry.productName,
      categoryName: entry.categoryName,
    });
    if (nextId == null || nextId === '' || sameRecordId(nextId, entry.productId)) return entry;
    const known = (Array.isArray(products) ? products : []).some((product) => sameRecordId(product?.id, nextId));
    if (!known) return entry;
    return { ...entry, productId: nextId };
  });
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
export function mergeCatalogRecord(remote, incoming, { remoteUpdatedAt, incomingUpdatedAt, incomingWins = false } = {}) {
  const base = remote && typeof remote === 'object' ? { ...remote } : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  const incomingNewer = incomingWins || Date.parse(incomingUpdatedAt) > Date.parse(remoteUpdatedAt);
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
    const incomingMs = Date.parse(incomingUpdatedAt);
    const remoteMs = Date.parse(remoteUpdatedAt);
    // בלי חותמת זו לא "שורה ישנה". רישום ייצור נשמר בלי updatedAt, ואסור לדלג עליו.
    if (!Number.isFinite(incomingMs)) {
      return {
        action: 'merge',
        reason: 'append-only-unstamped',
        row: mergeCatalogRecord(remote, incoming, {
          remoteUpdatedAt,
          incomingUpdatedAt: remoteUpdatedAt,
          incomingWins: true,
        }),
      };
    }
    if (Number.isFinite(remoteMs) && incomingMs <= remoteMs) {
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
