// מטריצת הרשאות לפי תפקיד.
// עמדת «חשבונות» למנהל/מנהל מערכת בלבד — אישור משתמשים ובחירת תפקיד.

const STAFF_WORKSPACES = ['production', 'suppliers', 'recipes', 'manager', 'haccp', 'lots', 'inventory'];
const ALL_WORKSPACES = [...STAFF_WORKSPACES, 'accounts'];

const WORKSPACE_ACCESS = {
  production: ['production', 'recipes', 'haccp', 'lots'],
  quality: ['production', 'suppliers', 'recipes', 'haccp', 'lots', 'inventory'],
  manager: ALL_WORKSPACES,
  admin: ALL_WORKSPACES,
};

// שלבי HACCP הנגישים ל-production — שאר התפקידים רואים הכל
const HACCP_PRODUCTION_STEPS = new Set(['overview', 'monitor_log']);

// טאבי מתכונים — production רק צופה, בלי עריכה ובנייה
const RECIPES_PRODUCTION_TABS = new Set(['browse', 'baking', 'ratio', 'machines', 'portions']);

export const PERMISSION_DENIED_MESSAGE = 'אין הרשאה למסך זה';

export function allowedWorkspaces(role) {
  return WORKSPACE_ACCESS[role] || WORKSPACE_ACCESS.production;
}

export function canAccessWorkspace(role, workspaceId) {
  return allowedWorkspaces(role).includes(workspaceId);
}

export function canAccessScreen(role, workspaceId, screenId) {
  if (!canAccessWorkspace(role, workspaceId)) return false;
  if (workspaceId === 'haccp') return canAccessHaccpStep(role, screenId);
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
