import { APP_VERSION } from './version.js?v=107';

const SW_URL = `./sw.js?v=${APP_VERSION}`;

export function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

let updateBannerEl = null;
let pendingUpdate = false;

function ensureUpdateBanner() {
  if (updateBannerEl) return updateBannerEl;
  updateBannerEl = document.createElement('div');
  updateBannerEl.id = 'app-update-banner';
  updateBannerEl.className = 'app-update-banner hidden';
  updateBannerEl.innerHTML = `
    <div class="app-update-inner">
      <span id="app-update-text">גרסה חדשה זמינה</span>
      <button type="button" id="app-update-btn" class="btn btn-primary btn-sm">עדכן עכשיו</button>
      <button type="button" id="app-update-dismiss" class="app-update-dismiss" aria-label="סגור">×</button>
    </div>`;
  document.body.prepend(updateBannerEl);
  document.getElementById('app-update-btn')?.addEventListener('click', () => applyAppUpdate());
  document.getElementById('app-update-dismiss')?.addEventListener('click', () => {
    updateBannerEl?.classList.add('hidden');
  });
  return updateBannerEl;
}

export function showUpdateBanner(latestVersion) {
  pendingUpdate = true;
  const banner = ensureUpdateBanner();
  const text = document.getElementById('app-update-text');
  if (text) {
    text.textContent = latestVersion && latestVersion !== APP_VERSION
      ? `גרסה ${latestVersion} זמינה (מותקנת: ${APP_VERSION})`
      : 'גרסה חדשה זמינה — לחץ לעדכון';
  }
  banner.classList.remove('hidden');
}

export async function applyAppUpdate() {
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 800);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
  }
  const url = new URL(location.href);
  url.searchParams.set('v', APP_VERSION);
  url.searchParams.delete('force-update');
  location.replace(url.toString());
}

export async function forceAppUpdate() {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }
  if (window.caches) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  const url = new URL(location.href);
  url.searchParams.delete('force-update');
  url.searchParams.set('v', APP_VERSION);
  location.replace(url.toString());
}

function watchRegistration(reg) {
  if (reg.waiting && navigator.serviceWorker.controller) {
    showUpdateBanner();
    return;
  }

  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state !== 'installed' || !navigator.serviceWorker.controller) return;
      if (isStandaloneApp()) {
        showUpdateBanner();
        return;
      }
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
  });
}

export async function checkForAppUpdate() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    await reg.update();
    if (reg.waiting) {
      showUpdateBanner();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** בדיקה מול שרver — האם יש גרסה חדשה יותר מהמותקנת */
export async function detectRemoteVersion() {
  try {
    const res = await fetch(`./js/version.js?check=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/APP_VERSION\s*=\s*['"](\d+)['"]/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function initAppUpdateCheck() {
  if (!('serviceWorker' in navigator)) return;

  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || isStandaloneApp()) return;
    reloaded = true;
    window.location.reload();
  });

  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: './' });
    watchRegistration(reg);
    await checkForAppUpdate();

    const remote = await detectRemoteVersion();
    if (remote && remote !== APP_VERSION) {
      showUpdateBanner(remote);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkForAppUpdate();
        detectRemoteVersion().then((v) => {
          if (v && v !== APP_VERSION) showUpdateBanner(v);
        });
      }
    });

    setInterval(() => {
      checkForAppUpdate();
    }, 3 * 60 * 1000);
  } catch (err) {
    console.warn('Service Worker registration failed', err);
  }
}

export async function registerServiceWorker() {
  await initAppUpdateCheck();
  return !!navigator.serviceWorker?.controller || ('serviceWorker' in navigator);
}

export function hasPendingUpdate() {
  return pendingUpdate;
}
