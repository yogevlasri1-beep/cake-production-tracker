import { APP_VERSION } from './version.js?v=222';

const SW_URL = './sw.js';

export function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

let updateBannerEl = null;
let pendingUpdate = false;
let updateInProgress = false;

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
  document.getElementById('app-update-btn')?.addEventListener('click', () => {
    applyAppUpdate().catch(() => {
      hardReloadForUpdate();
    });
  });
  document.getElementById('app-update-dismiss')?.addEventListener('click', () => {
    updateBannerEl?.classList.add('hidden');
  });
  return updateBannerEl;
}

function setUpdateButtonBusy(busy) {
  const btn = document.getElementById('app-update-btn');
  if (!btn) return;
  btn.disabled = busy;
  btn.textContent = busy ? 'מעדכן...' : 'עדכן עכשיו';
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
  document.body.classList.add('has-update-banner');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration()
      .then((reg) => reg?.update())
      .catch(() => {});
  }
}

async function clearAllAppCaches() {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }
  if (window.caches) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
}

async function fetchLatestBuildFromServer() {
  const bust = Date.now();
  try {
    const res = await fetch(`./index.html?bust=${bust}`, { cache: 'no-store' });
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/__APP_BUILD__\s*=\s*['"](\d+)['"]/);
      if (match) return match[1];
    }
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch(`./js/version.js?gate=${bust}`, { cache: 'no-store' });
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/APP_VERSION\s*=\s*['"](\d+)['"]/);
      if (match) return match[1];
    }
  } catch {
    /* ignore */
  }
  return APP_VERSION;
}

async function tryActivateWaitingWorker() {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg?.waiting || !navigator.serviceWorker.controller) return false;
  reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
  return true;
}

async function hardReloadForUpdate() {
  const latest = await fetchLatestBuildFromServer();
  const url = new URL(location.href);
  url.searchParams.set('force-update', '1');
  url.searchParams.set('v', latest);
  url.searchParams.set('t', String(Date.now()));
  location.replace(url.toString());
}

/** ניקוי מטמון מ-full + טעינה מחדש */
export async function forceAppUpdate() {
  if (updateInProgress) return;
  updateInProgress = true;
  try {
    await clearAllAppCaches();
  } catch (err) {
    console.warn('forceAppUpdate cache clear failed', err);
  }
  await hardReloadForUpdate();
}

/** כפתור «עדכן עכשיו» בבאנר העליון */
export async function applyAppUpdate() {
  if (updateInProgress) return;
  updateInProgress = true;
  setUpdateButtonBusy(true);
  try {
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      } catch {
        /* continue */
      }
      await tryActivateWaitingWorker();
    }
    await clearAllAppCaches();
  } catch (err) {
    console.warn('applyAppUpdate partial fail', err);
  }
  await hardReloadForUpdate();
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
        applyAppUpdate().catch(() => forceAppUpdate());
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

/** בדיקה מול השרת — האם יש גרסה חדשה יותר מהמותקנת */
export async function detectRemoteVersion() {
  return fetchLatestBuildFromServer();
}

async function cleanupLegacyServiceWorkers() {
  if (!('serviceWorker' in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map(async (reg) => {
    const scriptUrl = reg.active?.scriptURL
      || reg.installing?.scriptURL
      || reg.waiting?.scriptURL
      || '';
    if (scriptUrl && !scriptUrl.endsWith('/sw.js')) {
      await reg.unregister();
    }
  }));
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
    const remote = await detectRemoteVersion();
    if (remote && remote !== APP_VERSION) {
      await clearAllAppCaches();
      await hardReloadForUpdate();
      return;
    }

    await cleanupLegacyServiceWorkers();
    const reg = await navigator.serviceWorker.register(SW_URL, {
      scope: './',
      updateViaCache: 'none',
    });
    watchRegistration(reg);
    await checkForAppUpdate();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      detectRemoteVersion().then(async (v) => {
        if (v && v !== APP_VERSION) {
          showUpdateBanner(v);
          if (isStandaloneApp()) {
            await applyAppUpdate().catch(() => forceAppUpdate());
          }
        }
      });
      checkForAppUpdate();
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
