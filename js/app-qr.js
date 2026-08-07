/** קישור ציבורי לאפליקציה + יצירת QR להורדה / שיתוף */

export const PRODUCTION_APP_URL = 'https://yogevcakee.vercel.app/';

let loadPromise = null;

function normalizeAppUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return PRODUCTION_APP_URL;
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    let path = u.pathname || '/';
    if (path !== '/' && !path.endsWith('/')) path += '/';
    // ב-GitHub Pages השורש כולל את שם הריפו
    if (/github\.io$/i.test(u.hostname) && path === '/') {
      path = '/cake-production-tracker/';
    }
    return `${u.origin}${path}`;
  } catch {
    return PRODUCTION_APP_URL;
  }
}

/** כתובת לסריקה — תמיד פרודקשן (Vercel), כדי שכל אחד יגיע לאפליקציה החיה */
export function getAppShareUrl() {
  return PRODUCTION_APP_URL;
}

async function loadQrGenerator() {
  if (typeof window !== 'undefined' && typeof window.qrcode === 'function') {
    return window.qrcode;
  }
  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/qrcode.min.js';
      s.async = true;
      s.onload = () => {
        if (typeof window.qrcode === 'function') resolve(window.qrcode);
        else reject(new Error('ספריית QR לא נטענה'));
      };
      s.onerror = () => reject(new Error('לא ניתן לטעון ספריית QR'));
      document.head.appendChild(s);
    });
  }
  return loadPromise;
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = String(dataUrl || '').split(',');
  if (!header || data == null) throw new Error('תמונת QR לא תקינה');
  const isBase64 = /;base64/i.test(header);
  const mime = (header.match(/^data:([^;]+)/i) || [])[1] || 'image/png';
  const binary = isBase64 ? atob(data) : decodeURIComponent(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function gifDataUrlToPngBlob(gifDataUrl, { size = 512 } = {}) {
  const img = new Image();
  img.decoding = 'async';
  const loaded = new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('לא ניתן להמיר את ה-QR'));
  });
  img.src = gifDataUrl;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas לא זמין');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, size, size);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('יצירת PNG נכשלה');
  return blob;
}

export async function createAppQrDataUrl(url = getAppShareUrl(), { cellSize = 8, margin = 4 } = {}) {
  const qrcode = await loadQrGenerator();
  const target = normalizeAppUrl(url);
  const qr = qrcode(0, 'M');
  qr.addData(target);
  qr.make();
  return {
    url: target,
    dataUrl: qr.createDataURL(cellSize, margin),
  };
}

/** הורדה / Share של ה-QR כ-PNG (באייפון: שמירה לגלריה דרך Share) */
export async function downloadAppQrImage(dataUrl, filename = 'yogevcake-app-qr.png') {
  const safeName = filename.endsWith('.png') ? filename : `${filename}.png`;
  let blob;
  try {
    blob = await gifDataUrlToPngBlob(dataUrl, { size: 768 });
  } catch {
    blob = dataUrlToBlob(dataUrl);
  }
  const file = new File([blob], safeName, { type: blob.type || 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'QR לאפליקציה',
        text: 'סרוק כדי לפתוח את מעקב הייצור',
      });
      return 'share';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = safeName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }, 2000);
  return 'download';
}

export async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) throw new Error('אין מה להעתיק');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('ההעתקה נכשלה');
}
