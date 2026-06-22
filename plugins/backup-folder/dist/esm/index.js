import { registerPlugin } from '@capacitor/core';

const BackupFolder = registerPlugin('BackupFolder', {
  web: () => import('../../../js/backup-folder-web.js').then((m) => m.default),
});

export default BackupFolder;
