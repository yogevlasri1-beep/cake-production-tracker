/** טוען fflate לפענוח קובצי Word (.docx) */
export async function loadFFlate() {
  if (globalThis.fflate) return globalThis.fflate;
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-fflate-loader]');
    if (existing) {
      existing.addEventListener('load', () => resolve(globalThis.fflate));
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = 'js/vendor/fflate.min.js';
    s.dataset.fflateLoader = '1';
    s.onload = () => resolve(globalThis.fflate);
    s.onerror = () => reject(new Error('לא ניתן לטעון ספריית fflate'));
    document.head.appendChild(s);
  });
}
