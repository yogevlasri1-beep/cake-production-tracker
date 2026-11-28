import {
  db, getSetting, setSetting, isDatabaseEmpty,
} from './db.js?v=559';
import {
  createBackupPayload, formatBackupSummary, parseBackupFile, restoreBackupFromFile,
  restoreBackupPayload, describeBackupRestorePreview, countBackupRuns,
} from './backup.js?v=559';
import { planRestoreBackupReplaceCloud } from './sync/cloud-first.js?v=559';
import { downloadBlob } from './download.js?v=559';
import { ValidationError } from './validators.js?v=559';
import { openModal, closeModal } from './modal.js?v=559';
import { escapeHtml, showToast } from './utils.js?v=559';
import {
  pickDefaultBackupFolder as pickFolderBridge,
  writeBackupJsonToFolder,
  listBackupFolderFiles,
  readBackupJsonFromFolder,
  clearDefaultBackupFolder,
  pruneExternalBackupFiles,
  supportsFolderPicker,
  isNativeApp,
} from './backup-folder-bridge.js?v=559';
import {
  uploadBackupToSupabase,
  listSupabaseBackups,
  restoreSupabaseBackup,
  fetchSupabaseBackupPayload,
  getSupabaseBackupConfig,
  isSupabaseBackupConfigured,
  testSupabaseBackupConnection,
  saveSupabaseBackupConfig,
  getOrCreateDeviceId,
  fetchLatestSupabaseBackup,
  ensureSupabaseDefaults,
  getBackupScopeId,
  isPrimaryBackupDevice,
  isThisPrimaryBackupDevice,
} from './supabase-backup.js?v=559';
import {
  MAX_PINNED_BACKUPS,
  MAX_ROTATING_LOCAL,
  MAX_SAFETY_BACKUPS,
  backupKindLabel,
  catalogDriftWarning,
  catalogHealthFromCounts,
  formatCatalogHealth,
  isProtectedBackupKind,
  mergeRestorePoints,
  protectedBackupFileName,
  safetyKindForAction,
  selectBackupsToPrune,
} from './backup-guard.js?v=559';

const SETTINGS_KEY = 'backupSettings';
const FILE_HANDLE_KEY = 'backupFileHandle';

const DEFAULT_SETTINGS = {
  autoEnabled: true,
  autoIntervalHours: 24,
  maxLocalSnapshots: 1,
  lastAutoAt: null,
  lastManualAt: null,
  lastExternalAt: null,
  externalLocationLabel: null,
  locationType: null,
};

let changeBackupTimer = null;
let autoBackupRunning = false;

function debounce(fn, ms) {
  return (...args) => {
    clearTimeout(changeBackupTimer);
    changeBackupTimer = setTimeout(() => fn(...args), ms);
  };
}

function backupFilename(stamp = new Date()) {
  const d = stamp;
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `yitzur-gibuy-${date}-${time}.json`;
}

export function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function supportsDirectoryPicker() {
  return typeof window.showDirectoryPicker === 'function';
}

export function supportsSaveFilePicker() {
  return typeof window.showSaveFilePicker === 'function';
}

export function supportsBackupLocationPicker() {
  return supportsFolderPicker();
}

/** באייפון — בחירת קובץ JSON מ«קבצים» */
export function pickJsonFileFromDevice() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    const cleanup = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      cleanup();
      if (file) resolve(file);
      else reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    });
    input.addEventListener('cancel', () => {
      cleanup();
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    });
    input.click();
  });
}

export function hasDefaultBackupFolder(settings) {
  return !!settings?.externalLocationLabel;
}

export function canWriteToDefaultFolder(settings) {
  return !!(settings?.externalLocationLabel && (supportsFolderPicker()));
}

export async function getBackupSettings() {
  const saved = await getSetting(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}

export async function saveBackupSettings(patch) {
  const current = await getBackupSettings();
  const next = { ...current, ...patch };
  await setSetting(SETTINGS_KEY, next);
  return next;
}

/** בחירת תיקיית ברירת מחדל — פותח «קבצים» / בוחר תיקייה */
export async function chooseDefaultBackupFolder() {
  if (!supportsFolderPicker()) {
    throw new ValidationError('UNSUPPORTED');
  }
  const result = await pickFolderBridge();
  return { type: 'directory', name: result.name };
}

export async function chooseBackupLocation() {
  return chooseDefaultBackupFolder();
}

export async function clearBackupLocation() {
  await setSetting(FILE_HANDLE_KEY, null);
  await clearDefaultBackupFolder().catch(() => {});
  await saveBackupSettings({ externalLocationLabel: null, locationType: null });
}

async function writePayloadToExternal(payload, kind) {
  const settings = await getBackupSettings();
  if (!settings.externalLocationLabel) return false;
  try {
    const extraName = protectedBackupFileName(kind, payload?.exportedAt);
    await writeBackupJsonToFolder(payload, extraName ? { extraName } : {});
    return true;
  } catch (err) {
    console.warn('Folder backup write failed', err);
    return false;
  }
}

export async function listExternalBackupFiles() {
  try {
    return await listBackupFolderFiles();
  } catch {
    return [];
  }
}

export async function restoreFromExternalPath(path) {
  const json = await readBackupJsonFromFolder(path);
  const file = new File([json], path, { type: 'application/json' });
  return restoreBackupFromFile(file);
}

export async function restoreFromExternalHandle(entryHandle) {
  if (entryHandle?.nativePath) {
    return restoreFromExternalPath(entryHandle.nativePath);
  }
  const file = await entryHandle.getFile();
  return restoreBackupFromFile(file);
}

function localBackupPruneRows(rows) {
  return (rows || []).map((row) => ({
    id: row.id,
    kind: row.kind,
    exportedAt: row.createdAt,
  }));
}

async function pruneLocalSnapshots() {
  const existing = await db.localBackups.toArray();
  const dropIds = selectBackupsToPrune(localBackupPruneRows(existing), {
    maxPinned: MAX_PINNED_BACKUPS,
    maxSafety: MAX_SAFETY_BACKUPS,
    maxRotating: MAX_ROTATING_LOCAL,
  });
  if (dropIds.length) await db.localBackups.bulkDelete(dropIds);
  return dropIds.length;
}

async function saveLocalSnapshot(payload, kind) {
  const counts = payload.counts || {};
  const row = {
    createdAt: payload.exportedAt,
    kind,
    summary: formatBackupSummary(counts),
    payloadJson: JSON.stringify(payload),
    entryCount: counts.productionEntries || 0,
    products: counts.products || 0,
    flows: counts.flows || 0,
    categories: counts.categories || 0,
  };
  await db.localBackups.add(row);
  await pruneLocalSnapshots();
}

/** מוחק גיבויים רגילים ישנים. נקודות טובות וצילומי ביטחון נשארים. */
export async function keepOnlyLatestBackup() {
  const localDeleted = await pruneLocalSnapshots();

  let externalDeleted = 0;
  try {
    externalDeleted = await pruneExternalBackupFiles();
  } catch {
    /* no folder */
  }

  await saveBackupSettings({ maxLocalSnapshots: 1 });
  const kept = await db.localBackups.count();
  return { localDeleted, externalDeleted, kept };
}

export async function listLocalSnapshots(limit = 10) {
  return db.localBackups.orderBy('createdAt').reverse().limit(limit).toArray();
}

/** אין עותק JSON רגיל על המכשיר — שומרים אחד, בלי להעלות לענן. נקודה טובה לא מחליפה עותק אחרון. */
export function shouldSaveLastLocalCopy(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return true;
  return snapshots.every((row) => isProtectedBackupKind(row?.kind));
}

export async function ensureLastLocalCopy({ force = false } = {}) {
  const existing = await listLocalSnapshots(1);
  if (!force && !shouldSaveLastLocalCopy(existing)) {
    return { saved: false, kept: true };
  }
  const payload = await createBackupPayload();
  await saveLocalSnapshot(payload, force ? 'restore' : 'working');
  return { saved: true, kept: false };
}

export async function restoreLocalSnapshot(id) {
  const row = await db.localBackups.get(Number(id));
  if (!row?.payloadJson) throw new ValidationError('גיבוי מקומי לא נמצא');
  const payload = JSON.parse(row.payloadJson);
  await restoreBackupPayload(payload.data);
  return {
    exportedAt: payload.exportedAt,
    counts: payload.counts,
    summary: row.summary,
  };
}

export async function readLocalSnapshotForRestore(id) {
  const row = await db.localBackups.get(Number(id));
  if (!row?.payloadJson) throw new ValidationError('גיבוי מקומי לא נמצא');
  const payload = JSON.parse(row.payloadJson);
  const data = payload.data;
  if (!data || typeof data !== 'object') throw new ValidationError('קובץ הגיבוי לא תקין');
  return {
    data,
    name: formatWhenOrSummary(row),
    meta: {
      exportedAt: payload.exportedAt || row.createdAt || '',
      appVersion: payload.appVersion || '',
      counts: payload.counts || {},
    },
  };
}

function formatWhenOrSummary(row) {
  if (row?.createdAt) {
    try {
      return new Date(row.createdAt).toLocaleString('he-IL');
    } catch { /* fall through */ }
  }
  return row?.summary || 'גיבוי מקומי';
}

/** ייצוא קובץ JSON — Share באייפון / הורדה בדפדפן */
export async function exportBackupToFile(existingPayload) {
  const payload = existingPayload || await createBackupPayload();
  const filename = backupFilename(new Date(payload.exportedAt || Date.now()));
  const blob = new Blob(
    [JSON.stringify(payload, null, 2)],
    { type: 'application/json;charset=utf-8' },
  );
  const method = await downloadBlob(blob, filename);
  return { payload, filename, method };
}

/** הורדה חוזרת של הגיבוי הפנימי האחרון כקובץ */
export async function downloadLatestBackupFile() {
  const snapshots = await listLocalSnapshots(1);
  if (!snapshots[0]?.payloadJson) {
    throw new ValidationError('אין גיבוי — לחץ «גיבוי ושמור קובץ»');
  }
  return exportBackupToFile(JSON.parse(snapshots[0].payloadJson));
}

export function isAutoBackupDue(settings, now = Date.now()) {
  if (!settings?.autoEnabled) return false;
  const last = settings.lastAutoAt ? new Date(settings.lastAutoAt).getTime() : 0;
  if (!last) return true;

  const intervalMs = Math.max(1, Number(settings.autoIntervalHours) || 24) * 3600000;
  if (now - last >= intervalMs) return true;

  const lastDay = new Date(last);
  const nowDay = new Date(now);
  const sameCalendarDay = lastDay.getFullYear() === nowDay.getFullYear()
    && lastDay.getMonth() === nowDay.getMonth()
    && lastDay.getDate() === nowDay.getDate();
  return !sameCalendarDay;
}

export async function runBackup({ kind = 'manual', shareToFiles = false } = {}) {
  const deviceId = await getOrCreateDeviceId();
  const supabaseCfg = await getSupabaseBackupConfig();
  let payload = await createBackupPayload();
  const filename = backupFilename(new Date(payload.exportedAt));

  const result = {
    payload,
    filename,
    local: true,
    external: false,
    shared: false,
    downloaded: false,
    fileExport: false,
    supabase: false,
  };

  try {
    const cloud = await uploadBackupToSupabase(payload, kind);
    result.supabase = cloud.uploaded === true;
  } catch (err) {
    console.warn('Supabase backup failed', err);
    result.supabaseError = err.message;
  }

  payload = {
    ...payload,
    exportMeta: {
      deviceId,
      kind,
      syncedToSupabase: result.supabase === true,
      supabaseProjectUrl: supabaseCfg.supabaseUrl || null,
      savedToFolder: false,
    },
  };
  result.payload = payload;

  await saveLocalSnapshot(payload, kind);

  try {
    result.external = await writePayloadToExternal(payload, kind);
    if (result.external) {
      payload.exportMeta.savedToFolder = true;
      result.payload = payload;
      await saveBackupSettings({ lastExternalAt: payload.exportedAt });
    }
  } catch (err) {
    console.warn('External backup failed', err);
  }

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });

  const iosPwa = isIOSDevice() && !isNativeApp();
  const shouldExportFile = shareToFiles || (kind === 'manual' && iosPwa);

  if (shouldExportFile) {
    const method = await downloadBlob(blob, filename);
    result.shared = method === 'share';
    result.downloaded = method === 'download';
    result.fileExport = method === 'share' || method === 'download';
    if (method === 'share') {
      await saveBackupSettings({ lastExternalAt: payload.exportedAt });
    }
  }

  const patch = kind === 'auto'
    ? { lastAutoAt: payload.exportedAt }
    : { lastManualAt: payload.exportedAt };
  await saveBackupSettings(patch);

  return result;
}

export async function runAutoBackupIfDue(force = false) {
  if (autoBackupRunning) return null;
  const settings = await getBackupSettings();
  if (!settings.autoEnabled) return null;
  if (!force && !isAutoBackupDue(settings)) return null;

  autoBackupRunning = true;
  try {
    return await runBackup({ kind: 'auto', shareToFiles: false });
  } finally {
    autoBackupRunning = false;
  }
}

export function requestAutoBackupNow() {
  return runAutoBackupIfDue(true);
}

const scheduleChangeBackup = debounce(() => {
  runAutoBackupIfDue(false).catch((err) => console.warn('Auto backup', err));
}, 45000);

function installDbChangeHooks() {
  const tables = [
    'categories', 'categoryGroups', 'products', 'productionEntries', 'targets',
    'managerPlans', 'managerPlanItems', 'managerTasks', 'managerIncidents', 'managerShiftNotes',
    'managerResponsibilityAreas', 'managerEmployees', 'managerDepartments',
    'departmentCleaningLists', 'departmentCleaningTasks',
    'managerResponsibilityAreas', 'managerEmployees',
    'processLogs', 'activityPresets', 'flows', 'flowSteps', 'flowPortionPresets', 'groupPortionPresets', 'portionPresetIngredientSettings', 'groupPreparations', 'checklistTasks', 'flowChecklistItems', 'flowCleaningTasks', 'productionRuns', 'runStepStates', 'productPreparations', 'runPreparationChecks', 'runCleaningChecks',
    'recipeGroups', 'recipeCategories', 'recipes', 'recipeIngredients', 'recipeProductLinks',     'recipeProductCategoryLinks', 'recipeProductGroupLinks', 'productRecipeComponents', 'productPortionComponents', 'productFlowLinks', 'supplierCategories', 'suppliers', 'rawMaterials', 'weeklyProductionPlans', 'weeklyProductionPlanItems',
    'purchaseCategories', 'purchaseItems',
    'settings',
  ];
  for (const name of tables) {
    if (!db[name]) continue;
    db[name].hook('creating', scheduleChangeBackup);
    db[name].hook('updating', scheduleChangeBackup);
    db[name].hook('deleting', scheduleChangeBackup);
  }
}

export function initAutoBackupSystem() {
  ensureSupabaseDefaults().catch((err) => console.warn('Supabase defaults', err));
  installDbChangeHooks();
  setTimeout(() => {
    (async () => {
      try {
        const auto = await runAutoBackupIfDue(false);
        if (!auto) await ensureLastLocalCopy();
      } catch (err) {
        console.warn('Startup backup', err);
      }
    })();
  }, 2500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      runAutoBackupIfDue(false).catch((err) => console.warn('Visibility backup', err));
    }
  });
}

export async function getBackupHistory() {
  const [local, external, supabase] = await Promise.all([
    listLocalSnapshots(40),
    listExternalBackupFiles().catch(() => []),
    (async () => {
      if (!(await isSupabaseBackupConfigured())) return [];
      try {
        return await listSupabaseBackups(40);
      } catch (err) {
        console.warn('List Supabase backups', err);
        return [];
      }
    })(),
  ]);
  return { local, external, supabase };
}

export async function currentCatalogHealth() {
  const [products, flows, categories, productionEntries] = await Promise.all([
    db.products.count(),
    db.flows.count(),
    db.categories.count(),
    db.productionEntries.count(),
  ]);
  return catalogHealthFromCounts({ products, flows, categories, productionEntries });
}

export async function saveNamedBackup(kind, { cloudOptional = true } = {}) {
  const payload = await createBackupPayload();
  await saveLocalSnapshot(payload, kind);
  let supabase = false;
  let supabaseError = null;
  try {
    const cloud = await uploadBackupToSupabase(payload, kind);
    supabase = cloud.uploaded === true;
  } catch (err) {
    supabaseError = err.message || String(err);
    console.warn('named backup cloud', err);
    if (!cloudOptional) throw err;
  }
  try {
    await writePayloadToExternal(payload, kind);
  } catch (err) {
    console.warn('named backup folder', err);
  }
  return {
    payload,
    supabase,
    supabaseError,
    summary: formatBackupSummary(payload.counts),
    kind,
  };
}

export async function saveGoodRestorePoint() {
  return saveNamedBackup('good');
}

export async function saveSafetySnapshot(action) {
  if (await isDatabaseEmpty()) return { saved: false, reason: 'empty' };
  const result = await saveNamedBackup(safetyKindForAction(action));
  return { saved: true, ...result };
}

export async function listRestorePoints() {
  const [local, supabase] = await Promise.all([
    listLocalSnapshots(40),
    (async () => {
      if (!(await isSupabaseBackupConfigured())) return [];
      try {
        return await listSupabaseBackups(40);
      } catch (err) {
        console.warn('List restore points', err);
        return [];
      }
    })(),
  ]);
  return mergeRestorePoints(local, supabase);
}

export async function readRestorePointData(point) {
  if (!point) throw new ValidationError('נקודה לא נמצאה');
  if (point.source === 'supabase' && point.id) {
    const { data, meta } = await fetchSupabaseBackupPayload(point.id);
    return {
      data,
      name: backupKindLabel(point.kind),
      meta: {
        exportedAt: meta.exportedAt || point.exportedAt || '',
        appVersion: meta.appVersion || '',
        counts: meta.counts || {},
      },
    };
  }
  return readLocalSnapshotForRestore(point.localId || point.id);
}

export async function getBackupStatus() {
  const settings = await getBackupSettings();
  const snapshots = await listLocalSnapshots(5);
  const restorePoints = await listRestorePoints();
  let catalogHealth = catalogHealthFromCounts();
  try {
    catalogHealth = await currentCatalogHealth();
  } catch (err) {
    console.warn('catalog health', err);
  }
  const driftWarning = catalogDriftWarning(catalogHealth, restorePoints.goods[0]);
  let duplicateWarning = null;
  try {
    const { inspectLocalCatalogHealth, formatCatalogDuplicateWarning } = await import('./data-health.js?v=559');
    duplicateWarning = formatCatalogDuplicateWarning(await inspectLocalCatalogHealth());
  } catch (err) {
    console.warn('catalog duplicate health', err);
  }
  let restoreModeWarning = null;
  try {
    const { formatRestoreModeWarning } = await import('./sync/restore-lock.js?v=559');
    restoreModeWarning = formatRestoreModeWarning(await getSetting('restoreLock'));
  } catch (err) {
    console.warn('restore mode warning', err);
  }
  const hasDefaultFolder = hasDefaultBackupFolder(settings);
  const supabaseConfig = await getSupabaseBackupConfig();
  const supabaseConfigured = await isSupabaseBackupConfigured();
  let supabaseBackups = [];
  if (supabaseConfigured) {
    try {
      supabaseBackups = await listSupabaseBackups(5);
    } catch (err) {
      console.warn('List Supabase backups', err);
    }
  }
  const deviceId = await getOrCreateDeviceId();
  const isPrimaryDevice = isPrimaryBackupDevice(supabaseConfig);
  let liveSync = null;
  try {
    const { getLiveSyncStatus } = await import('./supabase-sync.js?v=559');
    liveSync = await getLiveSyncStatus();
  } catch (err) {
    console.warn('live sync status', err);
  }
  return {
    settings,
    snapshots,
    restorePoints,
    catalogHealth,
    driftWarning,
    duplicateWarning,
    restoreModeWarning,
    hasDirectory: hasDefaultFolder,
    hasFileLocation: false,
    hasExternalLocation: hasDefaultFolder,
    hasDefaultFolder,
    canWriteToFolder: canWriteToDefaultFolder(settings),
    isIOSFolderLabel: false,
    supportsDirectory: supportsFolderPicker(),
    supportsSaveFile: false,
    supportsLocationPicker: supportsFolderPicker(),
    isIOS: isIOSDevice(),
    isNativeApp: isNativeApp(),
    supabaseConfig,
    supabaseConfigured,
    supabaseBackups,
    deviceId,
    backupScopeId: getBackupScopeId(),
    isPrimaryDevice,
    liveSync,
  };
}

export {
  restoreSupabaseBackup,
  fetchSupabaseBackupPayload,
  testSupabaseBackupConnection,
  saveSupabaseBackupConfig,
  uploadBackupToSupabase,
  listSupabaseBackups,
  isThisPrimaryBackupDevice,
  backupKindLabel,
  formatCatalogHealth,
};

function restoreConfirmBodyHTML({ titleName, preview }) {
  return `
    <p style="line-height:1.6;margin-bottom:10px"><strong>${escapeHtml(titleName)}</strong></p>
    <p style="line-height:1.7;white-space:pre-line;margin-bottom:12px">${escapeHtml(preview)}</p>
    <p style="line-height:1.6">
      זה מחליף את הנתונים במחשב <strong>וגם בענן</strong>.
      האייפון חייב להיות סגור לגמרי. אם הוא פתוח — השחזור ייחסם.
      זה לוקח כמה דקות — לא צריך לבדוק מהר.
    </p>`;
}

export async function runRestoreToComputerAndCloud(data, { onProgress } = {}) {
  const {
    withSyncEnqueuePaused,
    replaceCloudFromLocalBackup,
    getLiveSyncStatus,
    stopLiveSync,
    saveLiveSyncSettings,
    startLiveSync,
    acquireRestoreLock,
    releaseRestoreLock,
  } = await import('./supabase-sync.js?v=559');
  onProgress?.('שומר נקודת ביטחון...');
  try {
    await saveSafetySnapshot('restore');
  } catch (err) {
    console.warn('safety snapshot before restore', err);
    throw new ValidationError('לא נשמרה נקודת ביטחון. השחזור בוטל.');
  }
  onProgress?.('בודק שמכשירים אחרים סגורים...');
  const lockResult = await acquireRestoreLock({ onProgress });
  if (!lockResult.ok) {
    throw new ValidationError(lockResult.message || 'השחזור נחסם.');
  }
  const holdLock = !lockResult.skipped;
  try {
    onProgress?.('עוצר סנכרון...');
    await saveLiveSyncSettings({ holdPulls: true });
    await stopLiveSync();
    onProgress?.('משחזר במחשב...');
    await withSyncEnqueuePaused(() => restoreBackupPayload(data));
    try {
      await ensureLastLocalCopy({ force: true });
    } catch (err) {
      console.warn('local copy after restore', err);
    }
    const status = await getLiveSyncStatus();
    const plan = planRestoreBackupReplaceCloud({
      supabaseConfigured: status.supabaseConfigured === true,
      online: status.online !== false,
    });
    if (!plan.replaceCloud) {
      if (holdLock) await releaseRestoreLock().catch(() => {});
      if (plan.reason === 'no-supabase') {
        await saveLiveSyncSettings({ holdPulls: false });
        await startLiveSync();
      }
      return { replacedCloud: false, reason: plan.reason };
    }
    return replaceCloudFromLocalBackup({ onProgress });
  } catch (err) {
    if (holdLock) await releaseRestoreLock().catch(() => {});
    throw err;
  }
}

export function toastAfterRestore(cloud) {
  if (cloud?.replacedCloud) {
    showToast('שוחזר למחשב ולענן ✓ אפשר לפתוח את האייפון');
    return;
  }
  if (cloud?.reason === 'offline' || cloud?.reason === 'no-supabase') {
    showToast('שוחזר במחשב. הענן לא עודכן — אין חיבור');
    return;
  }
  if (cloud?.reason === 'seed-failed') {
    showToast('שוחזר במחשב. ההעלאה לענן נכשלה — אל תפתח את האייפון. לחץ «העלה את כל הדאטה המקומית»');
    return;
  }
  showToast('שוחזר במחשב. הענן לא הוחלף לגמרי — אל תפתח את האייפון עדיין');
}

export function confirmAndRestoreBackupFile(file, navigate) {
  (async () => {
    let parsed;
    try {
      showToast('קורא את קובץ הגיבוי...');
      parsed = await parseBackupFile(file);
    } catch (err) {
      showToast(err.message || 'לא ניתן לקרוא את הקובץ');
      return;
    }
    const preview = describeBackupRestorePreview({
      exportedAt: parsed.meta.exportedAt,
      appVersion: parsed.meta.appVersion,
      counts: parsed.meta.counts,
      runs: countBackupRuns(parsed.data),
    });
    openModal({
      title: 'שחזור מקובץ',
      bodyHTML: restoreConfirmBodyHTML({ titleName: file.name, preview }),
      footerHTML: `
        <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
        <button type="button" class="btn btn-primary" id="confirm-restore-file">שחזר למחשב ולענן</button>`,
    });
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('confirm-restore-file')?.addEventListener('click', async () => {
      const btn = document.getElementById('confirm-restore-file');
      btn.disabled = true;
      btn.textContent = 'משחזר...';
      try {
        const cloud = await runRestoreToComputerAndCloud(parsed.data, {
          onProgress: (msg) => { btn.textContent = msg; },
        });
        closeModal();
        toastAfterRestore(cloud);
        if (navigate) await navigate('home');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'שחזר למחשב ולענן';
        showToast(err.message || 'שגיאה');
      }
    });
  })().catch((err) => showToast(err.message || 'שגיאה'));
}

export async function promptRestoreIfNeeded(navigate) {
  if (!(await isDatabaseEmpty())) return false;

  const snapshots = await listLocalSnapshots(1);
  if (snapshots.length) {
    return promptRestoreFromLocal(snapshots[0], navigate);
  }

  promptRestoreFromSupabase(navigate).catch((err) => {
    console.warn('Fetch Supabase backup', err);
  });
  return false;
}

function promptRestoreFromLocal(latest, navigate) {
  openModal({
    title: 'שחזור מגיבוי מקומי',
    bodyHTML: `
      <p style="line-height:1.6;margin-bottom:10px">
        האפליקציה ריקה, אבל נמצא <strong>גיבוי מקומי</strong> על המכשיר:
      </p>
      <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:10px">
        ${new Date(latest.createdAt).toLocaleString('he-IL')} · ${escapeHtml(latest.summary)}
      </p>
      <p style="font-size:0.82rem;color:var(--primary-dark)">
        אם מחקת את האפליקציה — ייבא קובץ JSON מ«קבצים» (לחץ «ייבא מקובץ JSON»).
      </p>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">לא עכשיו</button>
      <button type="button" class="btn btn-secondary" id="restore-from-json-file">ייבא מקובץ JSON</button>
      <button type="button" class="btn btn-primary" id="restore-local-latest">שחזר גיבוי</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('restore-from-json-file')?.addEventListener('click', () => {
    closeModal();
    if (navigate) {
      navigate('backup');
      showToast('לחץ «ייבא גיבוי מקובץ JSON»');
    }
  });
  document.getElementById('restore-local-latest')?.addEventListener('click', async () => {
    try {
      const meta = await restoreLocalSnapshot(latest.id);
      closeModal();
      showToast(`שוחזר ✓ · ${formatBackupSummary(meta.counts)}`);
      if (navigate) await navigate('home');
    } catch (err) {
      closeModal();
      openModal({
        title: 'שגיאה',
        bodyHTML: `<p>${escapeHtml(err.message || 'שגיאה')}</p>`,
        footerHTML: '<button type="button" class="btn btn-primary modal-cancel">סגור</button>',
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    }
  });
  return true;
}

export async function promptRestoreFromSupabase(navigate) {
  try {
    await ensureSupabaseDefaults();
  } catch {
    return false;
  }
  if (!(await isSupabaseBackupConfigured())) return false;

  let latest;
  try {
    latest = await fetchLatestSupabaseBackup();
  } catch (err) {
    console.warn('Fetch Supabase backup', err);
    return false;
  }
  if (!latest) return false;

  openModal({
    title: 'שחזור מ-Supabase',
    bodyHTML: `
      <p style="line-height:1.6;margin-bottom:10px">
        האפליקציה ריקה (למשל אחרי מחיקה), אבל נמצא <strong>גיבוי בענן</strong>:
      </p>
      <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:10px">
        ${new Date(latest.exportedAt).toLocaleString('he-IL')} · ${escapeHtml(latest.summary || '')}
      </p>
      <p style="font-size:0.82rem;color:var(--primary-dark)">
        לשחזר את כל הנתונים — לחץ «שחזר מענן». דורש חיבור לאינטרנט.
      </p>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">לא עכשיו</button>
      <button type="button" class="btn btn-secondary" id="goto-backup-screen">היסטוריית גיבויים</button>
      <button type="button" class="btn btn-primary" id="restore-supabase-latest">שחזר מענן</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('goto-backup-screen')?.addEventListener('click', () => {
    closeModal();
    navigate?.('backup');
  });
  document.getElementById('restore-supabase-latest')?.addEventListener('click', async () => {
    const btn = document.getElementById('restore-supabase-latest');
    btn.disabled = true;
    btn.textContent = 'משחזר...';
    try {
      const meta = await restoreSupabaseBackup(latest.id);
      closeModal();
      showToast(`שוחזר מענן ✓ · ${formatBackupSummary(meta.counts)}`);
      if (navigate) await navigate('home');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'שחזר מענן';
      showToast(err.message || 'שגיאה בשחזור');
    }
  });
  return true;
}

export { restoreBackupFromFile, parseBackupFile, formatBackupSummary };
