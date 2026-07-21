import { getSetting, setSetting } from './db.js?v=337';
import { formatBackupSummary, restoreBackupPayload } from './backup.js?v=337';
import { ValidationError } from './validators.js?v=337';

const SETTINGS_KEY = 'supabaseBackup';
const DEVICE_ID_KEY = 'deviceId';
const TABLE = 'app_backups';
const MAX_CLOUD_SNAPSHOTS = 10;

/** מזהה קבוע — כל ההתקנות / אחרי מחיקה משתמשים באותו מקום בענן */
export const BACKUP_SCOPE_ID = 'yitzur';

const BUILTIN_DEFAULTS = {
  supabaseUrl: 'https://ravhjceukjsjfigcqgob.supabase.co',
  anonKey: 'sb_publishable_sqjU-cQOQnQiqh7-_5Fi4g_6azXKnad',
};

const DEFAULT_CONFIG = {
  supabaseUrl: BUILTIN_DEFAULTS.supabaseUrl,
  anonKey: BUILTIN_DEFAULTS.anonKey,
  enabled: true,
  /** מכשיר ראשי — רק הוא מעלה גיבויים ל-Supabase; מכשירים משניים רק מקבלים */
  primaryDevice: true,
  lastSyncAt: null,
  lastSyncError: null,
  lastSyncKind: null,
};

function normalizeSupabaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

export { normalizeSupabaseUrl };

export function buildSupabaseRestUrl(baseUrl, path = '') {
  const base = normalizeSupabaseUrl(baseUrl);
  if (!base) return '';
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}/rest/v1${suffix}`;
}

export function buildSupabaseHeaders(anonKey, extra = {}) {
  const key = String(anonKey || '').trim();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function getSupabaseBackupConfig() {
  const saved = await getSetting(SETTINGS_KEY);
  return { ...DEFAULT_CONFIG, ...(saved || {}) };
}

export async function ensureSupabaseDefaults() {
  const saved = await getSetting(SETTINGS_KEY);
  if (saved?.supabaseUrl && saved?.anonKey) return getSupabaseBackupConfig();
  return saveSupabaseBackupConfig({
    supabaseUrl: BUILTIN_DEFAULTS.supabaseUrl,
    anonKey: BUILTIN_DEFAULTS.anonKey,
    enabled: true,
  });
}

export function getBackupScopeId() {
  return BACKUP_SCOPE_ID;
}

export async function saveSupabaseBackupConfig(patch) {
  const current = await getSupabaseBackupConfig();
  const next = {
    ...current,
    ...patch,
    supabaseUrl: normalizeSupabaseUrl(patch.supabaseUrl ?? current.supabaseUrl),
    anonKey: patch.anonKey != null ? String(patch.anonKey).trim() : current.anonKey,
  };
  await setSetting(SETTINGS_KEY, next);
  return next;
}

export async function isSupabaseBackupConfigured() {
  const cfg = await getSupabaseBackupConfig();
  return !!(cfg.enabled && cfg.supabaseUrl && cfg.anonKey);
}

/** מכשיר ראשי מעלה לענן; ברירת מחדל true לתאימות לאחור */
export function isPrimaryBackupDevice(cfg) {
  return cfg?.primaryDevice !== false;
}

export async function isThisPrimaryBackupDevice() {
  const cfg = await getSupabaseBackupConfig();
  return isPrimaryBackupDevice(cfg);
}

export function canUploadToSupabase(cfg) {
  return !!(cfg?.enabled && cfg?.supabaseUrl && cfg?.anonKey && isPrimaryBackupDevice(cfg));
}

export async function getOrCreateDeviceId() {
  let id = await getSetting(DEVICE_ID_KEY);
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await setSetting(DEVICE_ID_KEY, id);
  }
  return id;
}

export function parseSupabaseBackupRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.device_id || row.deviceId,
    kind: row.kind,
    exportedAt: row.exported_at || row.exportedAt,
    appVersion: row.app_version || row.appVersion,
    backupVersion: row.backup_version ?? row.backupVersion,
    summary: row.summary || '',
    payload: row.payload,
    createdAt: row.created_at || row.createdAt,
  };
}

async function supabaseFetch(cfg, path, { method = 'GET', body, headers = {} } = {}) {
  const url = buildSupabaseRestUrl(cfg.supabaseUrl, path);
  const res = await fetch(url, {
    method,
    headers: buildSupabaseHeaders(cfg.anonKey, headers),
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errJson = await res.json();
      detail = errJson.message || errJson.error || errJson.hint || detail;
    } catch {
      /* ignore */
    }
    throw new ValidationError(`Supabase: ${detail || res.status}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function testSupabaseBackupConnection(patch) {
  const cfg = patch
    ? { ...(await getSupabaseBackupConfig()), ...patch, supabaseUrl: normalizeSupabaseUrl(patch.supabaseUrl ?? (await getSupabaseBackupConfig()).supabaseUrl) }
    : await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) {
    throw new ValidationError('חסרים כתובת Supabase או מפתח anon');
  }
  await supabaseFetch(cfg, `/${TABLE}?select=id&limit=1`);
  if (patch) {
    await saveSupabaseBackupConfig({
      ...patch,
      lastSyncError: null,
    });
  }
  return { ok: true, url: cfg.supabaseUrl };
}

export async function uploadBackupToSupabase(payload, kind = 'manual') {
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.enabled || !cfg.supabaseUrl || !cfg.anonKey) {
    return { uploaded: false, reason: 'not_configured' };
  }
  if (!isPrimaryBackupDevice(cfg)) {
    return { uploaded: false, reason: 'not_primary' };
  }

  const deviceId = await getOrCreateDeviceId();
  const scopeId = getBackupScopeId();
  const row = {
    device_id: scopeId,
    kind,
    exported_at: payload.exportedAt,
    app_version: payload.appVersion,
    backup_version: payload.backupVersion,
    summary: formatBackupSummary(payload.counts),
    payload,
  };

  try {
    await supabaseFetch(cfg, `/${TABLE}`, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: row,
    });
    await pruneSupabaseBackups(cfg, scopeId);
    await saveSupabaseBackupConfig({
      lastSyncAt: payload.exportedAt,
      lastSyncKind: kind,
      lastSyncError: null,
    });
    return { uploaded: true, deviceId, scopeId };
  } catch (err) {
    await saveSupabaseBackupConfig({
      lastSyncError: err.message || String(err),
    });
    throw err;
  }
}

async function pruneSupabaseBackups(cfg, scopeId) {
  const rows = await supabaseFetch(
    cfg,
    `/${TABLE}?device_id=eq.${encodeURIComponent(scopeId)}&select=id,exported_at&order=exported_at.desc`,
  );
  if (!Array.isArray(rows) || rows.length <= MAX_CLOUD_SNAPSHOTS) return 0;
  const toDelete = rows.slice(MAX_CLOUD_SNAPSHOTS).map((r) => r.id);
  if (!toDelete.length) return 0;
  await supabaseFetch(cfg, `/${TABLE}?id=in.(${toDelete.join(',')})`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  return toDelete.length;
}

export async function listSupabaseBackups(limit = 10) {
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) return [];
  const rows = await supabaseFetch(
    cfg,
    `/${TABLE}?select=id,device_id,kind,exported_at,app_version,backup_version,summary,created_at&order=exported_at.desc&limit=${Math.max(1, limit)}`,
  );
  return (rows || []).map(parseSupabaseBackupRow);
}

export async function fetchLatestSupabaseBackup() {
  const rows = await listSupabaseBackups(1);
  return rows[0] || null;
}

export async function fetchSupabaseBackupPayload(id) {
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) {
    throw new ValidationError('Supabase לא מוגדר');
  }
  const rows = await supabaseFetch(
    cfg,
    `/${TABLE}?id=eq.${encodeURIComponent(id)}&select=payload,summary,exported_at,kind,app_version,backup_version&limit=1`,
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.payload?.data) {
    throw new ValidationError('גיבוי Supabase לא נמצא');
  }
  return {
    data: row.payload.data,
    meta: {
      exportedAt: row.payload.exportedAt || row.exported_at,
      appVersion: row.payload.appVersion || row.app_version,
      backupVersion: row.payload.backupVersion || row.backup_version,
      counts: row.payload.counts,
      summary: row.summary,
      kind: row.kind,
    },
  };
}

export async function restoreSupabaseBackup(id) {
  const { data, meta } = await fetchSupabaseBackupPayload(id);
  await restoreBackupPayload(data);
  return meta;
}
