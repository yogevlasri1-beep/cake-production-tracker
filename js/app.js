import { initDB } from './db.js?v=232';
import { renderHome, homeMeta } from './screens/home.js?v=232';
import { renderProducts, productsMeta } from './screens/products.js?v=232';
import { renderManager, managerMeta } from './screens/manager.js?v=232';
import { renderProcess, processMeta } from './screens/process.js?v=232';
import { renderReports, reportsMeta } from './screens/reports.js?v=232';
import { renderBackup, backupMeta } from './screens/backup.js?v=232';
import { renderRecipes, recipesMeta, initRecipesSubNav } from './screens/recipes.js?v=232';
import { renderSuppliers, suppliersMeta, initSuppliersSubNav } from './screens/suppliers.js?v=232';
import { getSavedWorkspace, saveWorkspace, WORKSPACES } from './workspaces.js?v=232';
import { initIOSInstallPrompt } from './ios-install.js?v=232';
import { initNetworkCheck } from './network.js?v=232';
import { registerServiceWorker } from './sw-register.js?v=232';
import { APP_VERSION } from './version.js?v=232';
import { showToast } from './utils.js?v=232';
import './modal.js?v=232';

const PRODUCTION_SCREENS = {
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

const WORKSPACE_SCREENS = {
  production: PRODUCTION_SCREENS,
  suppliers: {
    suppliers: { render: renderSuppliers, meta: suppliersMeta },
  },
  recipes: {
    recipes: { render: renderRecipes, meta: recipesMeta },
  },
};

let currentWorkspace = getSavedWorkspace();
let currentScreen = 'home';

function getActiveScreens() {
  return WORKSPACE_SCREENS[currentWorkspace] || PRODUCTION_SCREENS;
}

function updateWorkspaceChrome() {
  const bottomNav = document.querySelector('.bottom-nav');
  bottomNav?.classList.toggle('bottom-nav--hidden', currentWorkspace !== 'production');

  const recipesNav = document.getElementById('recipes-sub-nav');
  recipesNav?.classList.toggle('hidden', currentWorkspace !== 'recipes');
  document.getElementById('app')?.classList.toggle('has-recipes-sub-nav', currentWorkspace === 'recipes');

  const suppliersNav = document.getElementById('suppliers-sub-nav');
  suppliersNav?.classList.toggle('hidden', currentWorkspace !== 'suppliers');
  document.getElementById('app')?.classList.toggle('has-suppliers-sub-nav', currentWorkspace === 'suppliers');

  document.querySelectorAll('.workspace-menu-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.workspace === currentWorkspace);
  });
}

function closeWorkspaceDrawer() {
  const drawer = document.getElementById('workspace-drawer');
  const btn = document.getElementById('workspace-menu-btn');
  drawer?.classList.add('hidden');
  drawer?.setAttribute('aria-hidden', 'true');
  btn?.setAttribute('aria-expanded', 'false');
}

function toggleWorkspaceDrawer() {
  const drawer = document.getElementById('workspace-drawer');
  const btn = document.getElementById('workspace-menu-btn');
  if (!drawer) return;
  const open = drawer.classList.toggle('hidden');
  drawer.setAttribute('aria-hidden', open ? 'true' : 'false');
  btn?.setAttribute('aria-expanded', open ? 'false' : 'true');
}

function openBackupScreen() {
  closeWorkspaceDrawer();
  if (currentWorkspace !== 'production') {
    currentWorkspace = 'production';
    saveWorkspace('production');
    updateWorkspaceChrome();
  }
  navigate('backup');
}

function initWorkspaceMenu() {
  document.getElementById('workspace-menu-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleWorkspaceDrawer();
  });

  document.getElementById('workspace-menu-backup')?.addEventListener('click', () => {
    openBackupScreen();
  });

  document.addEventListener('click', (e) => {
    const drawer = document.getElementById('workspace-drawer');
    const btn = document.getElementById('workspace-menu-btn');
    if (!drawer || drawer.classList.contains('hidden')) return;
    if (drawer.contains(e.target) || btn?.contains(e.target)) return;
    closeWorkspaceDrawer();
  });

  document.querySelectorAll('.workspace-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ws = btn.dataset.workspace;
      if (!WORKSPACES[ws]) return;
      currentWorkspace = ws;
      saveWorkspace(ws);
      updateWorkspaceChrome();
      closeWorkspaceDrawer();
      navigate(WORKSPACES[ws].defaultScreen);
    });
  });
}

async function navigate(screen) {
  const SCREENS = getActiveScreens();
  if (!SCREENS[screen]) {
    const fallback = WORKSPACES[currentWorkspace]?.defaultScreen || 'home';
    if (SCREENS[fallback]) return navigate(fallback);
    return;
  }
  currentScreen = screen;

  const main = document.getElementById('main-content');
  const header = document.querySelector('.app-header');
  main.classList.toggle('home-screen', screen === 'home' && currentWorkspace === 'production');
  header?.classList.toggle('app-header--centered', screen === 'home' && currentWorkspace === 'production');

  if (screen === 'home') {
    delete main.dataset.homeCategoryHistory;
    delete main.dataset.homeProductionList;
    delete main.dataset.view;
    delete main.dataset.runId;
  } else {
    delete main.dataset.homeProductionList;
  }

  if (currentWorkspace === 'production') {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.screen === screen);
    });
  }

  const { title, subtitle } = SCREENS[screen].meta();
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = subtitle || '';

  main.innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-muted)">טוען...</p>';
  await SCREENS[screen].render(main);
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (currentWorkspace !== 'production') {
      currentWorkspace = 'production';
      saveWorkspace('production');
      updateWorkspaceChrome();
    }
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
        const { forceAppUpdate } = await import('./sw-register.js?v=232');
        showToast('מעדכן...');
        await forceAppUpdate();
      });
      import('./sw-register.js?v=232').then(async ({ detectRemoteVersion }) => {
        const remote = await detectRemoteVersion();
        if (remote && remote !== APP_VERSION) {
          versionEl.textContent = `גרסה ${APP_VERSION} ← ${remote} זמין`;
          versionEl.style.color = '#dc2626';
          versionEl.style.fontWeight = '700';
        }
      }).catch(() => {});
    }

    initWorkspaceMenu();
    initRecipesSubNav();
    initSuppliersSubNav();
    updateWorkspaceChrome();

    await initDB();

    const { initAutoBackupSystem, promptRestoreIfNeeded } = await import('./backup-service.js?v=232');
    initAutoBackupSystem();
    await promptRestoreIfNeeded(navigate);

    const ws = WORKSPACES[currentWorkspace] || WORKSPACES.production;
    await navigate(ws.defaultScreen);
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
