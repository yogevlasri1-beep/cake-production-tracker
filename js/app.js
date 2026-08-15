import { initDB } from './db.js?v=469';
import { renderHome, homeMeta } from './screens/home.js?v=469';
import { renderProducts, productsMeta } from './screens/products.js?v=469';
import { renderManager, managerMeta } from './screens/manager.js?v=469';
import { renderProcess, processMeta } from './screens/process.js?v=469';
import { renderReports, reportsMeta } from './screens/reports.js?v=469';
import { renderBackup, backupMeta } from './screens/backup.js?v=469';
import { renderRecipes, recipesMeta, initRecipesSubNav } from './screens/recipes.js?v=469';
import { renderSuppliers, suppliersMeta, initSuppliersSubNav } from './screens/suppliers.js?v=469';
import { renderHaccp, haccpMeta } from './screens/haccp.js?v=469';
import { renderAccounts, accountsMeta } from './screens/accounts.js?v=469';
import { renderLots, lotsMeta } from './screens/lots.js?v=469';
import { renderInventory, inventoryMeta } from './screens/inventory.js?v=469';
import { renderProductCatalog, productCatalogMeta } from './screens/product-catalog.js?v=469';
import { getSavedWorkspace, saveWorkspace, WORKSPACES, MANAGER_TAB_KEY } from './workspaces.js?v=469';
import { initIOSInstallPrompt } from './ios-install.js?v=469';
import { initNetworkCheck } from './network.js?v=469';
import { registerServiceWorker } from './sw-register.js?v=469';
import { APP_VERSION } from './version.js?v=469';
import { showToast } from './utils.js?v=469';
import { getCurrentUserRole, getCurrentWorkspaceAccess } from './auth.js?v=469';
import { allowedWorkspaces, canAccessWorkspace, PERMISSION_DENIED_MESSAGE } from './permissions.js?v=469';
import './modal.js?v=469';

const PRODUCTION_SCREENS = {
  home: { render: renderHome, meta: homeMeta },
  process: { render: renderProcess, meta: processMeta },
  products: { render: renderProducts, meta: productsMeta },
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
  manager: {
    manager: { render: renderManager, meta: managerMeta },
  },
  haccp: {
    haccp: { render: renderHaccp, meta: haccpMeta },
  },
  accounts: {
    accounts: { render: renderAccounts, meta: accountsMeta },
  },
  lots: {
    lots: { render: renderLots, meta: lotsMeta },
  },
  inventory: {
    inventory: { render: renderInventory, meta: inventoryMeta },
  },
  productCatalog: {
    productCatalog: { render: renderProductCatalog, meta: productCatalogMeta },
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

function applyRolePermissionsToMenu() {
  const role = getCurrentUserRole();
  const access = getCurrentWorkspaceAccess();
  const allowed = new Set(allowedWorkspaces(role, access));
  document.querySelectorAll('.workspace-menu-item[data-workspace]').forEach((btn) => {
    btn.classList.toggle('hidden', !allowed.has(btn.dataset.workspace));
  });
}

let workspaceDrawerIgnoreCloseUntil = 0;
let workspaceMenuInitialized = false;

function syncWorkspaceDrawerChrome(isOpen) {
  const header = document.querySelector('.app-header');
  header?.classList.toggle('workspace-drawer-open', !!isOpen);
}

function closeWorkspaceDrawer() {
  const drawer = document.getElementById('workspace-drawer');
  const btn = document.getElementById('workspace-menu-btn');
  drawer?.classList.add('hidden');
  drawer?.setAttribute('aria-hidden', 'true');
  btn?.setAttribute('aria-expanded', 'false');
  syncWorkspaceDrawerChrome(false);
}

function openWorkspaceDrawer() {
  const drawer = document.getElementById('workspace-drawer');
  const btn = document.getElementById('workspace-menu-btn');
  if (!drawer) return;
  drawer.classList.remove('hidden');
  drawer.setAttribute('aria-hidden', 'false');
  btn?.setAttribute('aria-expanded', 'true');
  syncWorkspaceDrawerChrome(true);
  // מונע סגירה מיידית מאותו קליק/טאץ' (בעיקר במובייל)
  workspaceDrawerIgnoreCloseUntil = Date.now() + 400;
}

function toggleWorkspaceDrawer() {
  const drawer = document.getElementById('workspace-drawer');
  if (!drawer) return;
  if (drawer.classList.contains('hidden')) openWorkspaceDrawer();
  else closeWorkspaceDrawer();
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
  if (workspaceMenuInitialized) return;
  workspaceMenuInitialized = true;

  document.getElementById('workspace-menu-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWorkspaceDrawer();
  });

  document.getElementById('workspace-menu-backup')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openBackupScreen();
  });

  document.addEventListener('click', (e) => {
    if (Date.now() < workspaceDrawerIgnoreCloseUntil) return;
    const drawer = document.getElementById('workspace-drawer');
    const btn = document.getElementById('workspace-menu-btn');
    if (!drawer || drawer.classList.contains('hidden')) return;
    if (drawer.contains(e.target) || btn?.contains(e.target)) return;
    closeWorkspaceDrawer();
  });

  document.querySelectorAll('.workspace-menu-item[data-workspace]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ws = btn.dataset.workspace;
      if (!WORKSPACES[ws]) return;
      if (!canAccessWorkspace(getCurrentUserRole(), ws, getCurrentWorkspaceAccess())) {
        showToast(PERMISSION_DENIED_MESSAGE);
        closeWorkspaceDrawer();
        return;
      }
      currentWorkspace = ws;
      saveWorkspace(ws);
      const managerTab = btn.dataset.managerTab;
      const main = document.getElementById('main-content');
      if (ws === 'manager') {
        if (managerTab) {
          try { sessionStorage.setItem(MANAGER_TAB_KEY, managerTab); } catch { /* ignore */ }
          if (main) main.dataset.managerTab = managerTab;
        } else if (main) {
          delete main.dataset.managerTab;
          try { sessionStorage.removeItem(MANAGER_TAB_KEY); } catch { /* ignore */ }
        }
      }
      updateWorkspaceChrome();
      closeWorkspaceDrawer();
      navigate(WORKSPACES[ws].defaultScreen);
    });
  });
}

async function navigate(screen) {
  if (!canAccessWorkspace(getCurrentUserRole(), currentWorkspace, getCurrentWorkspaceAccess())) {
    showToast(PERMISSION_DENIED_MESSAGE);
    currentWorkspace = 'production';
    saveWorkspace('production');
    updateWorkspaceChrome();
    return navigate(WORKSPACES.production.defaultScreen);
  }

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
    delete main.dataset.runProdDate;
    delete main.dataset.runProdDateRunId;
  } else {
    delete main.dataset.homeProductionList;
  }

  if (currentWorkspace === 'production') {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.screen === screen);
    });
  }

  const metaFn = SCREENS[screen].meta;
  const { title, subtitle } = typeof metaFn === 'function' ? metaFn() : (metaFn || {});
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
      delete main.dataset.runProdDate;
      delete main.dataset.runProdDateRunId;
    }
    navigate(btn.dataset.screen);
  });
});

async function boot() {
  const { getValidSession } = await import('./auth.js?v=469');
  const session = await getValidSession();
  if (!session) {
    const { renderLoginGate } = await import('./screens/login.js?v=469');
    renderLoginGate(() => startApp());
    return;
  }
  await startApp();
}

async function startApp() {
  try {
    const versionEl = document.getElementById('app-version');
    if (versionEl) {
      versionEl.textContent = `גרסה ${APP_VERSION}`;
      versionEl.title = 'לחץ לבדיקת עדכון';
      versionEl.style.cursor = 'pointer';
      versionEl.addEventListener('click', async () => {
        const { forceAppUpdate } = await import('./sw-register.js?v=469');
        showToast('מעדכן...');
        await forceAppUpdate();
      });
      import('./sw-register.js?v=469').then(async ({ detectRemoteVersion }) => {
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
    applyRolePermissionsToMenu();
    if (!canAccessWorkspace(getCurrentUserRole(), currentWorkspace, getCurrentWorkspaceAccess())) {
      currentWorkspace = 'production';
      saveWorkspace('production');
    }
    updateWorkspaceChrome();

    const {
      installLiveSyncMiddleware,
      startLiveSync,
      ensureLiveSyncDefaults,
    } = await import('./supabase-sync.js?v=469');
    // Dexie middleware must be registered before db.open()
    installLiveSyncMiddleware();

    await initDB();
    await ensureLiveSyncDefaults();

    const { initAutoBackupSystem, promptRestoreIfNeeded } = await import('./backup-service.js?v=469');
    initAutoBackupSystem();
    await promptRestoreIfNeeded(navigate);

    startLiveSync().catch((err) => console.warn('live sync start', err));

    const main = document.getElementById('main-content');
    const savedManagerTab = sessionStorage.getItem(MANAGER_TAB_KEY);
    if (savedManagerTab) {
      main.dataset.managerTab = savedManagerTab;
      sessionStorage.removeItem(MANAGER_TAB_KEY);
    }

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

export { navigate, navigateToWorkspace };

async function navigateToWorkspace(workspaceId, screen) {
  if (!WORKSPACES[workspaceId]) return;
  if (!canAccessWorkspace(getCurrentUserRole(), workspaceId, getCurrentWorkspaceAccess())) {
    showToast(PERMISSION_DENIED_MESSAGE);
    return;
  }
  currentWorkspace = workspaceId;
  saveWorkspace(workspaceId);
  updateWorkspaceChrome();
  closeWorkspaceDrawer();
  await navigate(screen || WORKSPACES[workspaceId].defaultScreen);
}
