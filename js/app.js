import { initDB } from './db.js?v=99';
import { renderHome, homeMeta } from './screens/home.js?v=99';
import { renderRecord, recordMeta } from './screens/record.js?v=99';
import { renderProducts, productsMeta } from './screens/products.js?v=99';
import { renderManager, managerMeta } from './screens/manager.js?v=99';
import { renderProcess, processMeta } from './screens/process.js?v=99';
import { renderReports, reportsMeta } from './screens/reports.js?v=99';
import { renderBackup, backupMeta } from './screens/backup.js?v=99';
import { initIOSInstallPrompt } from './ios-install.js?v=99';
import { initNetworkCheck } from './network.js?v=99';
import { registerServiceWorker } from './sw-register.js?v=99';
import { APP_VERSION } from './version.js?v=99';
import './modal.js?v=99';

const SCREENS = {
  home: { render: renderHome, meta: homeMeta },
  record: { render: renderRecord, meta: recordMeta },
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
  if (screen === 'home') {
    delete main.dataset.homeCategoryHistory;
    delete main.dataset.view;
    delete main.dataset.runId;
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
        const { forceAppUpdate, detectRemoteVersion } = await import('./sw-register.js?v=99');
        const remote = await detectRemoteVersion();
        if (remote && remote !== APP_VERSION) {
          if (confirm(`גרסה ${remote} זמינה (מותקנת: ${APP_VERSION}). לעדכן?`)) await forceAppUpdate();
        } else {
          await forceAppUpdate();
        }
      });
      import('./sw-register.js?v=99').then(async ({ detectRemoteVersion }) => {
        const remote = await detectRemoteVersion();
        if (remote && remote !== APP_VERSION) {
          versionEl.textContent = `גרסה ${APP_VERSION} ← ${remote} זמין`;
          versionEl.style.color = '#dc2626';
          versionEl.style.fontWeight = '700';
        }
      }).catch(() => {});
    }

    await initDB();

    const { initAutoBackupSystem, promptRestoreIfNeeded } = await import('./backup-service.js?v=99');
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
