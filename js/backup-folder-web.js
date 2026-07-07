/**
 * Web / Chrome — בחירת תיקייה עם File System Access API
 */
import { getSetting, setSetting } from './db.js?v=260';

const DIR_KEY = 'backupDirectoryHandle';

async function getDirHandle() {
  return getSetting(DIR_KEY);
}

async function saveDirHandle(handle) {
  await setSetting(DIR_KEY, handle);
}

export default class BackupFolderWeb {
  async pickFolder() {
    if (typeof window.showDirectoryPicker !== 'function') {
      throw new Error('FOLDER_PICKER_UNSUPPORTED');
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'yitzur-backup' });
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('PERMISSION_DENIED');
    await saveDirHandle(handle);
    return { folder: { id: 'web', name: handle.name || 'תיקייה' } };
  }

  async writeFile({ path, data }) {
    const dir = await getDirHandle();
    if (!dir || !(await this.#ensurePerm(dir))) return;
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    const fileHandle = await dir.getFileHandle(path, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async readFile({ path }) {
    const dir = await getDirHandle();
    if (!dir || !(await this.#ensurePerm(dir))) throw new Error('NO_FOLDER');
    const fileHandle = await dir.getFileHandle(path);
    const file = await fileHandle.getFile();
    return { data: await file.text() };
  }

  async readdir() {
    const dir = await getDirHandle();
    if (!dir || !(await this.#ensurePerm(dir))) return { entries: [] };
    const entries = [];
    for await (const entry of dir.values()) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
      try {
        const file = await entry.getFile();
        entries.push({
          name: entry.name,
          isDir: false,
          size: file.size,
          mtime: Math.floor(file.lastModified / 1000),
        });
      } catch {
        entries.push({ name: entry.name, isDir: false, size: 0, mtime: 0 });
      }
    }
    return { entries };
  }

  async deleteFile({ path }) {
    const dir = await getDirHandle();
    if (!dir || !(await this.#ensurePerm(dir))) return;
    await dir.removeEntry(path);
  }

  async clearFolder() {
    await setSetting(DIR_KEY, null);
  }

  async #ensurePerm(handle) {
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') return true;
    perm = await handle.requestPermission({ mode: 'readwrite' });
    return perm === 'granted';
  }
}
