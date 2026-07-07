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
  purchasing: {
    id: 'purchasing',
    label: 'מנהל קניות',
    icon: '🛒',
    defaultScreen: 'purchasing',
  },
};

const STORAGE_KEY = 'appWorkspace';

export function getSavedWorkspace() {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return WORKSPACES[id] ? id : 'production';
  } catch {
    return 'production';
  }
}

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
