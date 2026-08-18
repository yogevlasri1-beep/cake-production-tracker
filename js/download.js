/** הורדה / שיתוף קובץ — תואם iPhone (PWA) */

const DEFAULT_SHARE_TEXT = 'מעקב יצור';

export function resolveDownloadFilename(filename, blob) {
  const name = String(filename || 'download').trim() || 'download';
  if (/\.[a-z0-9]{2,8}$/i.test(name)) return name;
  const type = blob?.type || '';
  if (type.includes('spreadsheet') || type.includes('excel')) return `${name}.xlsx`;
  if (type.includes('csv')) return `${name}.csv`;
  if (type.includes('html')) return `${name}.html`;
  if (type.includes('png')) return `${name}.png`;
  return `${name}.json`;
}

export async function downloadBlob(blob, filename, { shareText } = {}) {
  const safeName = resolveDownloadFilename(filename, blob);
  const type = blob.type || 'application/octet-stream';
  const file = new File([blob], safeName, { type });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: safeName,
        text: shareText || DEFAULT_SHARE_TEXT,
      });
      return 'share';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 2000);
  return 'download';
}

export function describeDownloadMethod(method) {
  if (method === 'share') return 'נפתח Share — בחר «שמירה לקבצים»';
  if (method === 'download') return 'הקובץ הורד';
  if (method === 'cancelled') return 'בוטל — לא נשמר קובץ';
  return '';
}

export function toastAfterDownload(method, successMsg) {
  if (method === 'cancelled') return successMsg;
  if (method === 'share') return `${successMsg} · נשלח לשיתוף`;
  return `${successMsg} · הקובץ הורד`;
}
