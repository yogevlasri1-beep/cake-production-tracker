import { showToast } from './utils.js?v=331';
import { isStandaloneApp } from './sw-register.js?v=331';

export async function pingServer(timeoutMs = 5000) {
  if (!navigator.onLine) {
    return { ok: false, reason: 'offline', message: 'אין חיבור לאינטרנט' };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${location.origin}/?ping=${Date.now()}`, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) return { ok: true, reason: null, message: 'מחובר' };
    return { ok: false, reason: 'server', message: 'השרver לא מגיב' };
  } catch {
    return {
      ok: false,
      reason: 'server',
      message: 'לא ניתן להתחבר לשרver',
    };
  }
}

export function isLocalHost() {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

export function isPrivateNetworkHost() {
  const h = location.hostname;
  return /^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local');
}

/** בדיקת Mac-server רלוונטית רק כשפותחים מ-Wi‑Fi מקומי (לא מהאייקון ולא מ-GitHub Pages) */
export function needsMacServerCheck() {
  if (isStandaloneApp()) return false;
  if (!isPrivateNetworkHost()) return false;
  return true;
}

let bannerEl = null;

function ensureBanner() {
  if (bannerEl) return bannerEl;
  bannerEl = document.createElement('div');
  bannerEl.id = 'network-banner';
  bannerEl.className = 'network-banner hidden';
  bannerEl.innerHTML = `
    <div class="network-banner-inner">
      <span id="network-banner-text"></span>
      <button type="button" id="network-retry" class="network-retry">נסה שוב</button>
    </div>`;
  document.body.prepend(bannerEl);
  document.getElementById('network-retry').addEventListener('click', () => checkAndShowBanner(true));
  return bannerEl;
}

function showStandaloneOfflineBanner(offline) {
  const banner = ensureBanner();
  const text = document.getElementById('network-banner-text');
  if (!text) return;

  if (offline) {
    text.textContent = 'מצב לא מקוון — הנתונים נשמרים מקומית על האייפון';
    banner.classList.remove('hidden');
    banner.classList.add('network-banner-offline');
  } else {
    banner.classList.add('hidden');
    banner.classList.remove('network-banner-offline');
  }
}

export async function checkAndShowBanner(force = false) {
  if (isStandaloneApp()) {
    showStandaloneOfflineBanner(!navigator.onLine);
    return { ok: navigator.onLine, reason: navigator.onLine ? null : 'offline' };
  }

  if (!needsMacServerCheck()) return { ok: true };

  const status = await pingServer();
  const banner = ensureBanner();

  if (status.ok) {
    banner.classList.add('hidden');
    return status;
  }

  const text = document.getElementById('network-banner-text');
  if (text) {
    text.textContent = `${status.message} · ${location.origin} — פתח מהאייקון במסך הבית לעבודה בלי Mac`;
  }
  banner.classList.remove('hidden');

  if (force) showToast('עדיין לא מחובר — פתח מהאייקון במסך הבית');
  return status;
}

export async function initNetworkCheck() {
  await checkAndShowBanner();

  if (isStandaloneApp()) {
    window.addEventListener('online', () => {
      showStandaloneOfflineBanner(false);
      showToast('חזר חיבור לאינטרנט');
    });
    window.addEventListener('offline', () => {
      showStandaloneOfflineBanner(true);
    });
    return;
  }

  if (!needsMacServerCheck()) return;

  window.addEventListener('online', () => checkAndShowBanner());
  window.addEventListener('offline', () => checkAndShowBanner());

  setInterval(() => checkAndShowBanner(), 60000);
}
