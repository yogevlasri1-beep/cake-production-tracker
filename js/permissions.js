// מטריצת הרשאות לפי תפקיד.
// כרגע (משתמש יחיד / שלב הטמעה): כל התפקידים רואים את כל העמדות בתפריט.
// הגבלות עדינות נשארות בתוך HACCP/מתכונים/גיבוי לפי role.
// כשיתווספו עובדים — אפשר לצמצם כאן מחדש את WORKSPACE_ACCESS.

const ALL_WORKSPACES = ['production', 'suppliers', 'recipes', 'manager', 'haccp'];

const WORKSPACE_ACCESS = {
  production: ALL_WORKSPACES,
  quality: ALL_WORKSPACES,
  manager: ALL_WORKSPACES,
  admin: ALL_WORKSPACES,
};

// שלבי HACCP הנגישים ל-production — שאר התפקידים רואים הכל
const HACCP_PRODUCTION_STEPS = new Set(['overview', 'monitor_log']);

// טאבי מתכונים — production רק צופה, בלי עריכה ובנייה
const RECIPES_PRODUCTION_TABS = new Set(['browse', 'baking', 'ratio', 'machines', 'portions']);

export const PERMISSION_DENIED_MESSAGE = 'אין הרשאה למסך זה';

export function allowedWorkspaces(role) {
  return WORKSPACE_ACCESS[role] || ALL_WORKSPACES;
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
