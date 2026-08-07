// מטריצת הרשאות לפי תפקיד + אופציה להרשאות מותאמות (עמדות) למשתמש.

export const MANAGEABLE_WORKSPACES = [
  'production',
  'suppliers',
  'recipes',
  'manager',
  'haccp',
  'lots',
  'inventory',
  'productCatalog',
  'accounts',
];

const STAFF_WORKSPACES = [
  'production',
  'suppliers',
  'recipes',
  'manager',
  'haccp',
  'lots',
  'inventory',
  'productCatalog',
];
const ALL_WORKSPACES = [...STAFF_WORKSPACES, 'accounts'];

const WORKSPACE_ACCESS = {
  production: ['production', 'recipes', 'haccp', 'lots', 'productCatalog'],
  quality: ['production', 'suppliers', 'recipes', 'haccp', 'lots', 'inventory', 'productCatalog'],
  manager: ALL_WORKSPACES,
  admin: ALL_WORKSPACES,
};

const WORKSPACE_LABELS = {
  production: 'תיעוד יצור',
  suppliers: 'ספקים',
  recipes: 'מתכונים',
  manager: 'מנהל',
  haccp: 'HACCP',
  lots: 'מעקב אצוות',
  inventory: 'מלאי',
  productCatalog: 'קטלוג מוצרים',
  accounts: 'חשבונות',
};

// שלבי HACCP הנגישים ל-production — שאר התפקידים רואים הכל
const HACCP_PRODUCTION_STEPS = new Set(['overview', 'monitor_log']);

// טאבי מתכונים — production רק צופה, בלי עריכה ובנייה
const RECIPES_PRODUCTION_TABS = new Set(['browse', 'baking', 'ratio', 'machines', 'portions']);

export const PERMISSION_DENIED_MESSAGE = 'אין הרשאה למסך זה';

/** מנקה רשימת עמדות; null = השתמש בברירת מחדל של התפקיד */
export function sanitizeWorkspaceAccess(raw) {
  if (raw == null) return null;
  const list = Array.isArray(raw) ? raw : [];
  const allowed = new Set(MANAGEABLE_WORKSPACES);
  const cleaned = [...new Set(list.map((id) => String(id || '').trim()).filter((id) => allowed.has(id)))];
  return cleaned.length ? cleaned : null;
}

export function defaultWorkspacesForRole(role) {
  return [...(WORKSPACE_ACCESS[role] || WORKSPACE_ACCESS.production)];
}

export function workspaceLabel(id) {
  return WORKSPACE_LABELS[id] || id || '—';
}

/**
 * עמדות מותרות: אם יש workspaceAccess מותאם — הוא גובר; אחרת לפי תפקיד.
 * @param {string} role
 * @param {string[]|null|undefined} workspaceAccess
 */
export function allowedWorkspaces(role, workspaceAccess = null) {
  const custom = sanitizeWorkspaceAccess(workspaceAccess);
  if (custom) return custom;
  return defaultWorkspacesForRole(role);
}

export function canAccessWorkspace(role, workspaceId, workspaceAccess = null) {
  return allowedWorkspaces(role, workspaceAccess).includes(workspaceId);
}

export function canAccessScreen(role, screenWorkspaceId, screenId, workspaceAccess = null) {
  if (!canAccessWorkspace(role, screenWorkspaceId, workspaceAccess)) return false;
  if (screenWorkspaceId === 'haccp') return canAccessHaccpStep(role, screenId);
  return true;
}

export function canAccessHaccpStep(role, stepId) {
  if (role === 'production') return HACCP_PRODUCTION_STEPS.has(stepId);
  return true;
}

export function canAccessRecipeTab(role, tab) {
  if (role === 'production') return RECIPES_PRODUCTION_TABS.has(tab);
  return true;
}

export function canAccessBackupFull(role) {
  return role === 'manager' || role === 'admin';
}

export function canManageAccounts(role) {
  return role === 'manager' || role === 'admin';
}

/** עריכת מתכונים / גרסאות / חומרים — לא לייצור */
export function canEditRecipes(role) {
  return role === 'quality' || role === 'manager' || role === 'admin';
}

/** יצירה / מחיקה / שכפול תזרימים ושלבים — לא לייצור */
export function canManageFlows(role) {
  return role === 'quality' || role === 'manager' || role === 'admin';
}

/** התאמות מלאי ידניות — איכות ומעלה (ייצור לא רואה את העמדה) */
export function canAdjustInventory(role) {
  return role === 'quality' || role === 'manager' || role === 'admin';
}

/** ניהול נראות/תמונות בקטלוג מוצרים — איכות ומעלה */
export function canManageProductCatalog(role) {
  return role === 'quality' || role === 'manager' || role === 'admin';
}
