import { openModal, closeModal } from './modal.js?v=452';
import { showToast } from './utils.js?v=452';

let zxingLoadPromise = null;

function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingLoadPromise) {
    zxingLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './js/vendor/zxing.min.js?v=452';
      script.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error('ZXing לא נטען')));
      script.onerror = () => reject(new Error('טעינת ספריית הסריקה נכשלה'));
      document.head.appendChild(script);
    });
  }
  return zxingLoadPromise;
}

function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    try { track.stop(); } catch { /* ignore */ }
  });
}

function cameraErrorMessage(err) {
  if (err?.name === 'NotAllowedError') return 'אין הרשאת מצלמה — אשר גישה בהגדרות הדפדפן';
  if (err?.name === 'NotFoundError') return 'לא נמצאה מצלמה במכשיר';
  return 'שגיאה בפתיחת המצלמה';
}

/**
 * פותח מודאל סריקה במצלמה. מנסה BarcodeDetector (כרום/אנדרואיד) לפני טעינת ZXing (fallback לאייפון).
 * onDecode(text) נקרא פעם אחת עם הערך שנסרק; המודאל נסגר אוטומטית אחרי decode מוצלח.
 * @param {object} [opts]
 * @param {(text: string) => void} [opts.onDecode]
 * @param {() => void} [opts.onCancel]
 * @param {string} [opts.title] — כותרת המודאל (ברירת מחדל: סריקת מספר מנה)
 * @param {string} [opts.hint] — טקסט סטטוס התחלתי אחרי שהמצלמה עלתה
 */
export async function openBarcodeScanner({
  onDecode,
  onCancel,
  title = '📷 סריקת מספר מנה',
  hint = 'כוון את המצלמה לקוד',
} = {}) {
  let stream = null;
  let stopped = false;
  let zxingReader = null;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    stopStream(stream);
    if (zxingReader) {
      try { zxingReader.reset(); } catch { /* ignore */ }
    }
  };

  openModal({
    title,
    modalClass: 'barcode-scan-modal',
    bodyHTML: `
      <div class="barcode-scan-video-wrap">
        <video id="barcode-scan-video" autoplay playsinline muted></video>
      </div>
      <p class="form-hint" id="barcode-scan-status" style="margin-top:8px">מפעיל מצלמה...</p>
      <button type="button" class="btn btn-secondary btn-sm" id="barcode-scan-manual" style="width:100%;margin-top:8px">⌨️ הקלד ידנית במקום</button>
    `,
    footerHTML: `<button class="btn btn-secondary modal-cancel" id="barcode-scan-cancel">ביטול</button>`,
    onCloseCallback: () => {
      cleanup();
      if (onCancel) onCancel();
    },
  });

  const statusEl = document.getElementById('barcode-scan-status');
  const video = document.getElementById('barcode-scan-video');
  document.getElementById('barcode-scan-cancel')?.addEventListener('click', closeModal);
  document.getElementById('barcode-scan-manual')?.addEventListener('click', closeModal);

  const finishWithDecode = (text) => {
    if (stopped) return;
    cleanup();
    closeModal();
    if (onDecode && text) onDecode(String(text).trim());
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (err) {
    if (statusEl) statusEl.textContent = cameraErrorMessage(err);
    showToast(cameraErrorMessage(err));
    return;
  }

  if (stopped) { stopStream(stream); return; } // modal already closed while awaiting permission
  video.srcObject = stream;

  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      const detector = new window.BarcodeDetector({ formats });
      if (statusEl) statusEl.textContent = hint;
      const tick = async () => {
        if (stopped) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) { finishWithDecode(codes[0].rawValue); return; }
        } catch { /* keep trying */ }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return;
    } catch { /* fall through to ZXing */ }
  }

  if (statusEl) statusEl.textContent = 'טוען מנוע סריקה...';
  try {
    const ZXing = await loadZXing();
    if (stopped) return;
    zxingReader = new ZXing.BrowserMultiFormatReader();
    if (statusEl) statusEl.textContent = hint;
    zxingReader.decodeFromVideoElementContinuously(video, (result) => {
      if (result) finishWithDecode(result.getText());
      // NotFoundException fires continuously while nothing is detected — ignore.
    });
  } catch {
    if (statusEl) statusEl.textContent = 'טעינת מנוע הסריקה נכשלה — הקלד ידנית';
    showToast('טעינת מנוע הסריקה נכשלה — הקלד ידנית');
  }
}
