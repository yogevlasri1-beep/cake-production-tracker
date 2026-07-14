/**
 * API אחיד — בחירת תיקייה ב«קבצים» (iOS native) או Chrome/Mac
 */
import { getSetting, setSetting } from './db.js?v=298';

const SETTINGS_KEY = 'backupSettings';

let folderApi = null;

export function isNativeApp() {
  try {
    return window.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function supportsWebDirectoryPicker() {
  return typeof window.showDirectoryPicker === 'function';
}

export function supportsFolderPicker() {
  return isNativeApp() || supportsWebDirectoryPicker();
}

async function patchBackupSettings(patch) {
  const saved = await getSetting(SETTINGS_KEY);
  await setSetting(SETTINGS_KEY, { ...(saved || {}), ...patch });
}

async function getFolderAPI() {
  if (folderApi) return folderApi;
  if (isNativeApp()) {
    const { registerPlugin } = await import('@capacitor/core');
    folderApi = registerPlugin('BackupFolder');
    return folderApi;
  }
  const { default: BackupFolderWeb } = await import('./backup-folder-web.js');
  folderApi = new BackupFolderWeb();
  return folderApi;
}

/** פותח בוחר תיקיות — Files באייפון / Finder ב-Chrome */
export async function pickDefaultBackupFolder() {
  const api = await getFolderAPI();
  try {
    const { folder } = await api.pickFolder();
    if (!folder?.name) throw new Error('לא נבחרה תיקייה');
    await patchBackupSettings({
      externalLocationLabel: folder.name,
      locationType: isNativeApp() ? 'native-directory' : 'directory',
    });
    return { name: folder.name, folder };
  } catch (err) {
    if (err?.code === 'CANCELLED' || err?.message?.includes('cancel')) {
      throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    }
    if (err?.message === 'FOLDER_PICKER_UNSUPPORTED') {
      throw new Error('UNSUPPORTED');
    }
    throw err;
  }
}

export async function writeBackupJsonToFolder(payload) {
  const api = await getFolderAPI();
  const json = JSON.stringify(payload, null, 2);
  await api.writeFile({ path: 'yitzur-gibuy-latest.json', data: json });
  await pruneExternalBackupFiles();
  return true;
}

const BACKUP_FILE_PREFIX = 'yitzur-gibuy-';
const LATEST_BACKUP_FILE = 'yitzur-gibuy-latest.json';

/** מוחק קבצי גיבוי ישנים בתיקייה — משאיר רק latest */
export async function pruneExternalBackupFiles() {
  const settings = await getSetting(SETTINGS_KEY);
  if (!settings?.externalLocationLabel) return 0;

  const api = await getFolderAPI();
  const { entries } = await api.readdir();
  let deleted = 0;
  for (const entry of entries || []) {
    if (entry.isDir || !entry.name?.endsWith('.json')) continue;
    if (entry.name === LATEST_BACKUP_FILE) continue;
    if (!entry.name.startsWith(BACKUP_FILE_PREFIX)) continue;
    try {
      await api.deleteFile({ path: entry.name });
      deleted += 1;
    } catch {
      /* skip */
    }
  }
  return deleted;
}

export async function listBackupFolderFiles() {
  const api = await getFolderAPI();
  const { entries } = await api.readdir();
  return (entries || [])
    .filter((e) => !e.isDir && e.name?.endsWith('.json'))
    .map((e) => ({
      name: e.name,
      size: e.size || 0,
      modified: e.mtime ? e.mtime * 1000 : 0,
      nativePath: e.name,
    }))
    .sort((a, b) => b.modified - a.modified);
}

export async function readBackupJsonFromFolder(path) {
  const api = await getFolderAPI();
  const { data } = await api.readFile({ path });
  return data;
}

export async function clearDefaultBackupFolder() {
  folderApi = null;
  const api = await getFolderAPI();
  if (api.clearFolder) await api.clearFolder();
}
