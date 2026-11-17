/**
 * מצב שחזור: נעילה בענן כדי שמכשיר אחר לא ידחוף קטלוג ישן בזמן שחזור.
 * קובץ טהור — בלי IndexedDB ובלי רשת.
 */

export const RESTORE_LOCK_KEY = 'restoreLock';
export const RESTORE_LOCK_TTL_MS = 20 * 60 * 1000;
export const RESTORE_LOCK_GRACE_MS = 12 * 1000;
export const OTHER_DEVICE_STALE_MS = 90 * 1000;
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

export function deviceHeartbeatKey(deviceId) {
  return `deviceHeartbeat:${String(deviceId || '').slice(0, 64)}`;
}

export function isHeartbeatKey(key) {
  return String(key || '').startsWith('deviceHeartbeat:');
}

export function restoreLockUntilMs(lock) {
  if (!lock || typeof lock !== 'object') return 0;
  if (lock.until) {
    const until = Date.parse(lock.until);
    if (Number.isFinite(until)) return until;
  }
  const at = Date.parse(lock.at);
  if (!Number.isFinite(at)) return 0;
  return at + RESTORE_LOCK_TTL_MS;
}

export function restoreLockIsActive(lock, { now = Date.now() } = {}) {
  if (!lock || typeof lock !== 'object') return false;
  if (lock.status && lock.status !== 'active') return false;
  const until = restoreLockUntilMs(lock);
  return until > now;
}

export function isRestoreLockHolder(lock, deviceId) {
  return !!(lock?.deviceId && deviceId && String(lock.deviceId) === String(deviceId));
}

export function latestOtherDeviceAt(heartbeats = [], deviceId = '') {
  let latest = 0;
  for (const row of heartbeats || []) {
    if (!row) continue;
    if (deviceId && String(row.deviceId) === String(deviceId)) continue;
    const t = Date.parse(row.at || row.updatedAt || '');
    if (Number.isFinite(t) && t > latest) latest = t;
  }
  return latest || 0;
}

function minutesAgoLabel(msAgo) {
  const minutes = Math.max(1, Math.round(msAgo / 60000));
  return minutes === 1 ? 'בדקה האחרונה' : `לפני ${minutes} דקות`;
}

export function planRestoreLockAcquire({
  existingLock = null,
  deviceId = '',
  otherDeviceSeenAt = '',
  now = Date.now(),
  staleMs = OTHER_DEVICE_STALE_MS,
} = {}) {
  if (restoreLockIsActive(existingLock, { now }) && !isRestoreLockHolder(existingLock, deviceId)) {
    return {
      ok: false,
      reason: 'lock-held',
      message: 'מכשיר אחר באמצע שחזור. חכו שיסתיים, בלי לגעת באייפון.',
    };
  }
  if (otherDeviceSeenAt) {
    const seen = Date.parse(otherDeviceSeenAt);
    if (Number.isFinite(seen) && now - seen < staleMs) {
      return {
        ok: false,
        reason: 'other-device-active',
        message: `האייפון עדיין פתוח (${minutesAgoLabel(now - seen)}). סגרו לגמרי — החלקה למעלה — חכו דקה, ונסו שוב.`,
      };
    }
  }
  if (!deviceId) {
    return { ok: false, reason: 'no-device', message: 'אין מזהה מכשיר. נסו שוב.' };
  }
  return {
    ok: true,
    lock: {
      at: new Date(now).toISOString(),
      until: new Date(now + RESTORE_LOCK_TTL_MS).toISOString(),
      deviceId: String(deviceId),
      status: 'active',
    },
  };
}

export function otherDeviceWroteAfterLock({
  heartbeats = [],
  writeHits = [],
  lockAt = '',
  deviceId = '',
} = {}) {
  const lockMs = Date.parse(lockAt);
  if (!Number.isFinite(lockMs)) return false;
  if (writeHits.length) return true;
  return latestOtherDeviceAt(heartbeats, deviceId) > lockMs;
}

export function planRestoreLockRelease(lock, deviceId, { now = Date.now() } = {}) {
  if (restoreLockIsActive(lock, { now }) && !isRestoreLockHolder(lock, deviceId)) {
    return { ok: false, reason: 'not-holder' };
  }
  return {
    ok: true,
    lock: {
      ...(lock && typeof lock === 'object' ? lock : {}),
      deviceId: deviceId || lock?.deviceId || '',
      status: 'done',
      until: new Date(now).toISOString(),
      releasedAt: new Date(now).toISOString(),
    },
  };
}

/** מכשיר אחר בזמן נעילה: בלי דחיפה ובלי משיכה (הענן באמצע ריקון). */
export function planLiveSyncDuringRestoreLock({
  lock = null,
  deviceId = '',
  now = Date.now(),
} = {}) {
  const active = restoreLockIsActive(lock, { now });
  if (!active) return { frozen: false, holder: false };
  const holder = isRestoreLockHolder(lock, deviceId);
  return { frozen: !holder, holder };
}

export function formatRestoreModeWarning(lock, { now = Date.now() } = {}) {
  if (!restoreLockIsActive(lock, { now })) return null;
  return 'מצב שחזור פעיל. לא לערוך קטלוג ולא להתחיל תהליך עד שהשחזור נגמר.';
}

export function cloudTableWipePath(table, kitchenId, { preserveRestoreLock = false } = {}) {
  const base = `/${table}?kitchen_id=eq.${encodeURIComponent(kitchenId)}`;
  if (preserveRestoreLock && table === 'sync_app_settings') {
    return `${base}&payload->>key=neq.${encodeURIComponent(RESTORE_LOCK_KEY)}`;
  }
  return base;
}
