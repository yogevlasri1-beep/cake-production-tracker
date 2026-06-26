import {
  db, getSetting, setSetting, isDatabaseEmpty,
} from './db.js?v=117';
import {
  createBackupPayload, formatBackupSummary, parseBackupFile, restoreBackupFromFile,
  restoreBackupPayload,
} from './backup.js?v=117';
import { downloadBlob } from './download.js?v=117';
import { ValidationError } from './validators.js?v=117';
import { openModal, closeModal } from './modal.js?v=117';
import { escapeHtml } from './utils.js?v=117';
import {
  pickDefaultBackupFolder as pickFolderBridge,
  writeBackupJsonToFolder,
  listBackupFolderFiles,
  readBackupJsonFromFolder,
  clearDefaultBackupFolder,
  pruneExternalBackupFiles,
  supportsFolderPicker,
  isNativeApp,
} from './backup-folder-bridge.js?v=117';

const SETTINGS_KEY = 'backupSettings';
const FILE_HANDLE_KEY = 'backupFileHandle';

const DEFAULT_SETTINGS = {
  autoEnabled: true,
  autoIntervalHours: 6,
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

async function writePayloadToExternal(payload) {
  const settings = await getBackupSettings();
  if (!settings.externalLocationLabel) return false;
  try {
    await writeBackupJsonToFolder(payload);
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

async function saveLocalSnapshot(payload, kind) {
  const row = {
    createdAt: payload.exportedAt,
    kind,
    summary: formatBackupSummary(payload.counts),
    payloadJson: JSON.stringify(payload),
    entryCount: payload.counts.productionEntries || 0,
  };

  const existing = await db.localBackups.orderBy('createdAt').reverse().toArray();
  if (existing.length > 0) {
    await db.localBackups.bulkDelete(existing.map((r) => r.id));
  }
  await db.localBackups.add(row);
}

/** מוחק גיבויים ישנים — משאיר רק האחרון (מקומי + תיקייה) */
export async function keepOnlyLatestBackup() {
  const all = await db.localBackups.orderBy('createdAt').reverse().toArray();
  let localDeleted = 0;
  if (all.length > 1) {
    localDeleted = all.length - 1;
    await db.localBackups.bulkDelete(all.slice(1).map((r) => r.id));
  }

  let externalDeleted = 0;
  try {
    externalDeleted = await pruneExternalBackupFiles();
  } catch {
    /* no folder */
  }

  await saveBackupSettings({ maxLocalSnapshots: 1 });
  return { localDeleted, externalDeleted, kept: all.length > 0 ? 1 : 0 };
}

export async function listLocalSnapshots(limit = 10) {
  return db.localBackups.orderBy('createdAt').reverse().limit(limit).toArray();
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

export async function runBackup({ kind = 'manual', shareToFiles = false } = {}) {
  const payload = await createBackupPayload();
  const filename = backupFilename(new Date(payload.exportedAt));
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });

  await saveLocalSnapshot(payload, kind);

  const result = {
    payload,
    filename,
    local: true,
    external: false,
    shared: false,
    downloaded: false,
    fileExport: false,
  };

  try {
    result.external = await writePayloadToExternal(payload);
    if (result.external) {
      await saveBackupSettings({ lastExternalAt: payload.exportedAt });
    }
  } catch (err) {
    console.warn('External backup failed', err);
  }

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

export async function runAutoBackupIfDue(forceFromChange = false) {
  if (autoBackupRunning) return null;
  const settings = await getBackupSettings();
  if (!settings.autoEnabled) return null;

  const now = Date.now();
  const last = settings.lastAutoAt ? new Date(settings.lastAutoAt).getTime() : 0;
  const intervalMs = (settings.autoIntervalHours || 6) * 3600000;

  if (!forceFromChange && last && now - last < intervalMs) return null;

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
  runAutoBackupIfDue(true).catch((err) => console.warn('Auto backup', err));
}, 45000);

function installDbChangeHooks() {
  const tables = [
    'categories', 'categoryGroups', 'products', 'productionEntries', 'targets',
    'managerPlans', 'managerPlanItems', 'managerTasks', 'managerIncidents', 'managerShiftNotes',
    'managerResponsibilityAreas', 'managerEmployees',
    'processLogs', 'activityPresets', 'flows', 'flowSteps', 'flowPortionPresets', 'groupPortionPresets', 'productionRuns', 'runStepStates',
    'settings',
  ];
  for (const name of tables) {
    db[name].hook('creating', scheduleChangeBackup);
    db[name].hook('updating', scheduleChangeBackup);
    db[name].hook('deleting', scheduleChangeBackup);
  }
}

export function initAutoBackupSystem() {
  installDbChangeHooks();
  runAutoBackupIfDue(false).catch((err) => console.warn('Startup backup', err));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      runAutoBackupIfDue(false).catch((err) => console.warn('Visibility backup', err));
    }
  });
}

export async function getBackupStatus() {
  const settings = await getBackupSettings();
  const snapshots = await listLocalSnapshots(5);
  const hasDefaultFolder = hasDefaultBackupFolder(settings);
  return {
    settings,
    snapshots,
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
  };
}

export async function promptRestoreIfNeeded(navigate) {
  if (!(await isDatabaseEmpty())) return false;

  const snapshots = await listLocalSnapshots(1);
  if (!snapshots.length) return false;

  const latest = snapshots[0];
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
        אם מחקת את האפליקות — ייבא קובץ JSON מ«קבצים» במסך הגיבוי.
      </p>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">לא עכשיו</button>
      <button type="button" class="btn btn-primary" id="restore-local-latest">שחזר גיבוי</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('restore-local-latest')?.addEventListener('click', async () => {
    try {
      await restoreLocalSnapshot(latest.id);
      closeModal();
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

export { restoreBackupFromFile, parseBackupFile, formatBackupSummary };
