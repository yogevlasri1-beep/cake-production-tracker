import { initDB } from './db.js?v=126';
import { renderHome, homeMeta } from './screens/home.js?v=126';
import { renderProducts, productsMeta } from './screens/products.js?v=126';
import { renderManager, managerMeta } from './screens/manager.js?v=126';
import { renderProcess, processMeta } from './screens/process.js?v=126';
import { renderReports, reportsMeta } from './screens/reports.js?v=126';
import { renderBackup, backupMeta } from './screens/backup.js?v=126';
import { initIOSInstallPrompt } from './ios-install.js?v=126';
import { initNetworkCheck } from './network.js?v=126';
import { registerServiceWorker } from './sw-register.js?v=126';
import { APP_VERSION } from './version.js?v=126';
import { showToast } from './utils.js?v=126';
import './modal.js?v=126';

const SCREENS = {
  home: { render: renderHome, meta: homeMeta },
  process: { render: renderProcess, meta: processMeta },
  products: { render: renderProducts, meta: productsMeta },
  manager: { render: renderManager, meta: managerMeta },
  reports: { render: renderReports, meta: reportsMeta },
  backup: {
    render: (container) => renderBackup(container, { navigate }),
    meta: backupMeta,
  },
};

let currentScreen = 'home';

async function navigate(screen) {
  if (!SCREENS[screen]) return;
  currentScreen = screen;

  const main = document.getElementById('main-content');
  const header = document.querySelector('.app-header');
  main.classList.toggle('home-screen', screen === 'home');
  header?.classList.toggle('app-header--centered', screen === 'home');

  if (screen === 'home') {
    delete main.dataset.homeCategoryHistory;
    delete main.dataset.homeProductionList;
    delete main.dataset.view;
    delete main.dataset.runId;
  } else {
    delete main.dataset.homeProductionList;
  }

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.screen === screen);
  });

  const { title, subtitle } = SCREENS[screen].meta();
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = subtitle || '';

  main.innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-muted)">טוען...</p>';
  await SCREENS[screen].render(main);
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const main = document.getElementById('main-content');
    if (btn.dataset.screen === 'process') {
      delete main.dataset.view;
      delete main.dataset.runId;
    }
    navigate(btn.dataset.screen);
  });
});

async function boot() {
  try {
    const versionEl = document.getElementById('app-version');
    if (versionEl) {
      versionEl.textContent = `גרסה ${APP_VERSION}`;
      versionEl.title = 'לחץ לבדיקת עדכון';
      versionEl.style.cursor = 'pointer';
      versionEl.addEventListener('click', async () => {
        const { forceAppUpdate } = await import('./sw-register.js?v=126');
        showToast('מעדכן...');
        await forceAppUpdate();
      });
      import('./sw-register.js?v=126').then(async ({ detectRemoteVersion }) => {
        const remote = await detectRemoteVersion();
        if (remote && remote !== APP_VERSION) {
          versionEl.textContent = `גרסה ${APP_VERSION} ← ${remote} זמין`;
          versionEl.style.color = '#dc2626';
          versionEl.style.fontWeight = '700';
        }
      }).catch(() => {});
    }

    await initDB();

    const { initAutoBackupSystem, promptRestoreIfNeeded } = await import('./backup-service.js?v=126');
    initAutoBackupSystem();
    await promptRestoreIfNeeded(navigate);

    await navigate('home');
    initIOSInstallPrompt();
    initNetworkCheck();

    await registerServiceWorker();
  } catch (err) {
    console.error(err);
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone;
    const offlineHint = standalone
      ? '<p style="font-size:0.85rem;color:var(--text-muted);margin-top:8px">הנתונים על המכשיר — נסה לרענן. אם לא עוזר, פתח פעם אחת עם אינטרנט ואז שוב מהאייקון.</p>'
      : (navigator.onLine === false
        ? '<p style="font-size:0.85rem;color:var(--text-muted);margin-top:8px">אין אינטרנט — התקן מהאייקון במסך הבית לעבודה בלי Mac.</p>'
        : '');
    document.getElementById('main-content').innerHTML = `
      <div class="card" style="border:2px solid var(--danger)">
        <div class="card-title">שגיאה בטעינה</div>
        <p style="font-size:0.9rem;line-height:1.5;margin-bottom:12px">${err.message || err}</p>
        ${offlineHint}
        <button class="btn btn-primary" onclick="location.reload()">רענן דף</button>
      </div>`;
  }
}

boot();

export { navigate };
