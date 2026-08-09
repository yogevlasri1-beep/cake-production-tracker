import { openModal, closeModal } from './modal.js?v=451';
import { showToast } from './utils.js?v=451';

let zxingLoadPromise = null;

function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingLoadPromise) {
    zxingLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './js/vendor/zxing.min.js?v=451';
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
  if (err?.name === 'NotReadableError') return 'המצלמה בשימוש באפליקציה אחרת — סגור אותה ונסה שוב';
  return 'שגיאה בפתיחת המצלמה';
}

/** נסה כמה constraints — חלק מהמכשירים נכשלים על facingMode ונותנים מסך שחור/שגיאה. */
async function openCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('getUserMedia לא נתמך'), { name: 'NotFoundError' });
  }
  const attempts = [
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    { video: { facingMode: 'environment' }, audio: false },
    { video: { facingMode: 'user' }, audio: false },
    { video: true, audio: false },
  ];
  let lastErr;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getVideoTracks()[0];
      if (track && track.readyState === 'ended') {
        stopStream(stream);
        lastErr = Object.assign(new Error('track ended'), { name: 'NotReadableError' });
        continue;
      }
      return stream;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('camera');
}

/**
 * מחבר stream לווידאו ומפעיל ניגון — חובה ב-iOS/WebKit אחרי הרשאה,
 * אחרת מקבלים ריבוע שחור למרות שההרשאה אושרה.
 */
async function bindStreamToVideo(video, stream) {
  if (!video) throw new Error('אין אלמנט וידאו');
  video.setAttribute('autoplay', '');
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.controls = false;

  if (video.srcObject !== stream) {
    video.srcObject = stream;
  }

  if (video.readyState < 1) {
    await new Promise((resolve, reject) => {
      const onMeta = () => { cleanup(); resolve(); };
      const onErr = () => { cleanup(); reject(new Error('טעינת וידאו נכשלה')); };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('error', onErr);
      };
      video.addEventListener('loadedmetadata', onMeta, { once: true });
      video.addEventListener('error', onErr, { once: true });
      // חלק מהדפדפנים כבר ב-HAVE_METADATA אחרי srcObject
      if (video.readyState >= 1) { cleanup(); resolve(); }
    });
  }

  // ניסיון play עם retry קצר — Safari לעיתים דוחה את ה-play הראשון אחרי הרשאה
  for (let i = 0; i < 3; i++) {
    try {
      if (video.paused || video.readyState < 2) {
        await video.play();
      }
      if (!video.paused && video.readyState >= 2) return;
    } catch {
      await new Promise((r) => setTimeout(r, 80 * (i + 1)));
    }
  }
  // גם אם play נכשל חלקית — נמשיך; לפעמים התצוגה עולה אחרי canplay
  try { await video.play(); } catch { /* ignore */ }
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
    if (zxingReader) {
      try { zxingReader.reset(); } catch { /* ignore */ }
      zxingReader = null;
    }
    const video = document.getElementById('barcode-scan-video');
    if (video) {
      try { video.pause(); } catch { /* ignore */ }
      try { video.srcObject = null; } catch { /* ignore */ }
    }
    stopStream(stream);
    stream = null;
  };

  openModal({
    title,
    modalClass: 'barcode-scan-modal',
    bodyHTML: `
      <div class="barcode-scan-video-wrap">
        <video id="barcode-scan-video" autoplay muted playsinline webkit-playsinline></video>
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
    stream = await openCameraStream();
  } catch (err) {
    if (statusEl) statusEl.textContent = cameraErrorMessage(err);
    showToast(cameraErrorMessage(err));
    return;
  }

  if (stopped) { stopStream(stream); stream = null; return; }

  try {
    await bindStreamToVideo(video, stream);
  } catch {
    if (statusEl) statusEl.textContent = 'המצלמה נפתחה אבל התצוגה נכשלה — נסה שוב או הקלד ידנית';
    showToast('תצוגת מצלמה נכשלה — נסה שוב');
    return;
  }

  if (stopped) return;

  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      const preferred = [
        'qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'codabar', 'data_matrix',
      ].filter((f) => formats.includes(f));
      const detector = new window.BarcodeDetector({
        formats: preferred.length ? preferred : formats,
      });
      if (statusEl) statusEl.textContent = hint;
      const tick = async () => {
        if (stopped) return;
        try {
          if (video.readyState >= 2) {
            const codes = await detector.detect(video);
            if (codes.length) { finishWithDecode(codes[0].rawValue); return; }
          }
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
    // ZXing מחכה לאירוע playing — אם הווידאו כבר מנגן ה-Promise נתקע לנצח
    try { video.pause(); } catch { /* ignore */ }
    zxingReader = new ZXing.BrowserMultiFormatReader();
    if (statusEl) statusEl.textContent = hint;
    // decodeFromStream מחבר + מנגן מחדש ואז סורק ברציפות
    await zxingReader.decodeFromStream(stream, video, (result) => {
      if (result) finishWithDecode(result.getText());
    });
  } catch {
    if (statusEl) statusEl.textContent = 'טעינת מנוע הסריקה נכשלה — הקלד ידנית';
    showToast('טעינת מנוע הסריקה נכשלה — הקלד ידנית');
  }
}
