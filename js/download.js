/** הורדה / שיתוף קובץ — תואם iPhone (PWA) */
export async function downloadBlob(blob, filename) {
  const safeName = filename.endsWith('.json') ? filename : `${filename}.json`;
  const file = new File([blob], safeName, { type: 'application/json' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: safeName,
        text: 'גיבוי מעקב יצור',
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
