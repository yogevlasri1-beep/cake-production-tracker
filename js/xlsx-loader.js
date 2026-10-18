import { APP_VERSION } from './version.js?v=504';

export async function loadXLSX() {
  if (window.XLSX) return window.XLSX;

  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-xlsx-loader]');
    if (existing) {
      if (window.XLSX) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Excel לא זמין')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = `js/vendor/xlsx.full.min.js?v=${APP_VERSION}`;
    s.dataset.xlsxLoader = '1';
    s.onload = resolve;
    s.onerror = () => reject(new Error('לא ניתן לטעון תמיכה ב-Excel — רענן את האפליקציה'));
    document.head.appendChild(s);
  });

  if (!window.XLSX) throw new Error('Excel לא זמין — רענן את האפליקציה');
  return window.XLSX;
}
