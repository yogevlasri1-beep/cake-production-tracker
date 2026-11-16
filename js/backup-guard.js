/**
 * נקודות שמורות וצילום לפני פעולה מסוכנת.
 * בלי זה גיבוי אוטומטי נמחק אחרי כמה ימים, ואין לאן לחזור אחרי שבירה.
 */

export const BACKUP_KIND_GOOD = 'good';
export const BACKUP_KIND_SAFETY = 'safety';

export const MAX_PINNED_BACKUPS = 20;
export const MAX_SAFETY_BACKUPS = 5;
export const MAX_ROTATING_CLOUD = 10;
export const MAX_ROTATING_LOCAL = 1;

export function isPinnedBackupKind(kind) {
  const k = String(kind || '');
  return k === BACKUP_KIND_GOOD || k.startsWith('good:');
}

export function isSafetyBackupKind(kind) {
  const k = String(kind || '');
  return k === BACKUP_KIND_SAFETY || k.startsWith('safety-') || k.startsWith('safety:');
}

export function isProtectedBackupKind(kind) {
  return isPinnedBackupKind(kind) || isSafetyBackupKind(kind);
}

export function safetyKindForAction(action) {
  const map = {
    restore: 'safety-restore',
    dedupe: 'safety-dedupe',
    reseed: 'safety-reseed',
    wipe: 'safety-wipe',
    reset: 'safety-reset',
    repair: 'safety-repair',
  };
  return map[action] || BACKUP_KIND_SAFETY;
}

export function backupKindLabel(kind) {
  if (isPinnedBackupKind(kind)) return 'נקודה טובה';
  if (kind === 'safety-restore') return 'לפני שחזור';
  if (kind === 'safety-dedupe') return 'לפני ניקוי כפילויות';
  if (kind === 'safety-reseed') return 'לפני העלאה מלאה';
  if (kind === 'safety-wipe') return 'לפני ריקון ענן';
  if (kind === 'safety-reset') return 'לפני איפוס סנכרון';
  if (kind === 'safety-repair') return 'לפני תיקון ספקים';
  if (isSafetyBackupKind(kind)) return 'לפני פעולה';
  if (kind === 'auto') return 'אוטומטי';
  if (kind === 'working' || kind === 'restore') return 'עותק אחרון';
  return 'ידני';
}

export function protectedBackupFileName(kind, stamp = new Date()) {
  const d = stamp instanceof Date ? stamp : new Date(stamp || Date.now());
  if (Number.isNaN(d.getTime())) return null;
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  if (isPinnedBackupKind(kind)) return `yitzur-nekuda-${date}-${time}.json`;
  if (isSafetyBackupKind(kind)) return `yitzur-safety-${date}-${time}.json`;
  return null;
}

export function isProtectedBackupFileName(name) {
  const n = String(name || '');
  return n.startsWith('yitzur-nekuda-') || n.startsWith('yitzur-safety-');
}

function rowTimeMs(row) {
  const ms = Date.parse(row?.exportedAt || row?.createdAt || 0);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * מוחק רק עודפים. נקודות טובות נשארות, צילומי ביטחון נשארים במכסה,
 * וגיבויים רגילים מסתובבים.
 */
export function selectBackupsToPrune(rows, {
  maxPinned = MAX_PINNED_BACKUPS,
  maxSafety = MAX_SAFETY_BACKUPS,
  maxRotating = MAX_ROTATING_CLOUD,
} = {}) {
  const list = (rows || []).filter((row) => row && row.id != null);
  const pinned = [];
  const safety = [];
  const rotating = [];
  for (const row of list) {
    if (isPinnedBackupKind(row.kind)) pinned.push(row);
    else if (isSafetyBackupKind(row.kind)) safety.push(row);
    else rotating.push(row);
  }
  const newestFirst = (a, b) => rowTimeMs(b) - rowTimeMs(a);
  pinned.sort(newestFirst);
  safety.sort(newestFirst);
  rotating.sort(newestFirst);
  return [
    ...pinned.slice(Math.max(0, Number(maxPinned) || 0)),
    ...safety.slice(Math.max(0, Number(maxSafety) || 0)),
    ...rotating.slice(Math.max(0, Number(maxRotating) || 0)),
  ].map((row) => row.id);
}

export function catalogHealthFromCounts(counts = {}) {
  return {
    products: Number(counts.products) || 0,
    flows: Number(counts.flows) || 0,
    categories: Number(counts.categories) || 0,
    productionEntries: Number(counts.productionEntries) || 0,
  };
}

export function formatCatalogHealth(health) {
  const h = catalogHealthFromCounts(health);
  return `${h.flows} תזרימים · ${h.products} מוצרים · ${h.categories} קטגוריות · ${h.productionEntries} רישומי ייצור`;
}

/**
 * אזהרה אם המצב הנוכחי רחוק מהנקודה הטובה — כפילויות או רשימה שהתרוקנה.
 */
export function catalogDriftWarning(current, baseline) {
  const now = catalogHealthFromCounts(current);
  const good = catalogHealthFromCounts(baseline);
  if (!good.flows && !good.products) return null;
  if (good.flows > 0 && now.flows === 0) {
    return `אין תזרימים. בנקודה הטובה היו ${good.flows}.`;
  }
  if (good.products > 0 && now.products === 0) {
    return `אין מוצרים. בנקודה הטובה היו ${good.products}.`;
  }
  if (good.flows > 0 && now.flows >= good.flows * 2) {
    return `מספר התזרימים קפץ מ-${good.flows} ל-${now.flows}. ייתכן כפילויות.`;
  }
  if (good.products > 0 && now.products <= Math.floor(good.products * 0.5)) {
    return `מספר המוצרים ירד מ-${good.products} ל-${now.products}.`;
  }
  return null;
}

export function mergeRestorePoints(localRows, cloudRows) {
  const byTime = new Map();
  for (const row of localRows || []) {
    const exportedAt = row.createdAt || row.exportedAt;
    if (!exportedAt) continue;
    byTime.set(String(exportedAt), {
      source: 'local',
      id: row.id,
      kind: row.kind,
      exportedAt,
      summary: row.summary || '',
      products: Number(row.products) || 0,
      flows: Number(row.flows) || 0,
      categories: Number(row.categories) || 0,
      productionEntries: Number(row.entryCount || row.productionEntries) || 0,
    });
  }
  for (const row of cloudRows || []) {
    const exportedAt = row.exportedAt;
    if (!exportedAt) continue;
    const key = String(exportedAt);
    const prev = byTime.get(key);
    byTime.set(key, {
      source: 'supabase',
      id: row.id,
      kind: row.kind,
      exportedAt,
      summary: row.summary || prev?.summary || '',
      localId: prev?.source === 'local' ? prev.id : null,
      products: Number(row.products || prev?.products) || 0,
      flows: Number(row.flows || prev?.flows) || 0,
      categories: Number(row.categories || prev?.categories) || 0,
      productionEntries: Number(row.productionEntries || prev?.productionEntries) || 0,
    });
  }
  const all = [...byTime.values()].sort((a, b) => rowTimeMs(b) - rowTimeMs(a));
  return {
    goods: all.filter((row) => isPinnedBackupKind(row.kind)),
    safeties: all.filter((row) => isSafetyBackupKind(row.kind)),
  };
}
