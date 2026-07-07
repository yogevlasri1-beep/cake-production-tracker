export const WORKSPACES = {
  production: {
    id: 'production',
    label: 'תיעוד יצור',
    icon: '🏭',
    defaultScreen: 'home',
  },
  suppliers: {
    id: 'suppliers',
    label: 'ספקים',
    icon: '🚚',
    defaultScreen: 'suppliers',
  },
  recipes: {
    id: 'recipes',
    label: 'מתכונים',
    icon: '📒',
    defaultScreen: 'recipes',
  },
  manager: {
    id: 'manager',
    label: 'מנהל',
    icon: '👔',
    defaultScreen: 'manager',
  },
};

const STORAGE_KEY = 'appWorkspace';
const MANAGER_TAB_KEY = 'yitzurManagerTab';

export function getSavedWorkspace() {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (id === 'purchasing') {
      id = 'manager';
      localStorage.setItem(STORAGE_KEY, 'manager');
      try {
        sessionStorage.setItem(MANAGER_TAB_KEY, 'purchasing');
      } catch {
        /* ignore */
      }
    }
    return WORKSPACES[id] ? id : 'production';
  } catch {
    return 'production';
  }
}

export { MANAGER_TAB_KEY };

export function saveWorkspace(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function workspaceList() {
  return Object.values(WORKSPACES);
}
