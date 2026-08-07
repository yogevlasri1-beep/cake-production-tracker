import {
  getSupabaseBackupConfig,
  buildSupabaseRestUrl,
} from './supabase-backup.js?v=434';
import {
  getValidSession,
  registerAuthUser,
  userRoleLabel,
  USER_ROLES,
} from './auth.js?v=434';
import { ValidationError } from './validators.js?v=434';
import { logAuditEvent } from './audit.js?v=434';
import {
  canManageAccounts,
  sanitizeWorkspaceAccess,
  defaultWorkspacesForRole,
} from './permissions.js?v=434';

function profileHeaders(cfg, accessToken, extra = {}) {
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

const PROFILE_SELECT = 'id,email,role,status,display_name,workspace_access,updated_at';

export async function listAccountProfiles() {
  const cfg = await getSupabaseBackupConfig();
  const session = await getValidSession();
  if (!cfg.supabaseUrl || !cfg.anonKey || !session?.access_token) {
    throw new ValidationError('נדרשת התחברות');
  }

  async function fetchProfiles(select) {
    const url = `${buildSupabaseRestUrl(cfg.supabaseUrl, '/profiles')}?select=${select}&order=updated_at.desc`;
    const res = await fetch(url, { headers: profileHeaders(cfg, session.access_token) });
    return res;
  }

  let res = await fetchProfiles(PROFILE_SELECT);
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    if (/workspace_access/i.test(raw)) {
      res = await fetchProfiles('id,email,role,status,display_name,updated_at');
    } else {
      let detail = raw;
      try {
        const j = JSON.parse(raw);
        detail = j.message || j.error_description || j.error || raw;
      } catch { /* ignore */ }
      throw new ValidationError(detail || 'לא ניתן לטעון חשבונות — ודא שהמיגרציה רצה ב-Supabase');
    }
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ValidationError(detail || 'לא ניתן לטעון חשבונות — ודא שהמיגרציה רצה ב-Supabase');
  }
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function waitForProfileRow(cfg, accessToken, userId, { attempts = 8, delayMs = 250 } = {}) {
  const url = `${buildSupabaseRestUrl(cfg.supabaseUrl, '/profiles')}?id=eq.${encodeURIComponent(userId)}&select=id`;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, { headers: profileHeaders(cfg, accessToken) });
    if (res.ok) {
      const rows = await res.json().catch(() => []);
      if (Array.isArray(rows) && rows[0]?.id) return true;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

export async function updateAccountProfile(userId, patch) {
  const cfg = await getSupabaseBackupConfig();
  const session = await getValidSession();
  if (!cfg.supabaseUrl || !cfg.anonKey || !session?.access_token) {
    throw new ValidationError('נדרשת התחברות');
  }
  if (!canManageAccounts(session.role)) {
    throw new ValidationError('אין הרשאה לנהל חשבונות');
  }
  if (!userId) throw new ValidationError('חסר מזהה משתמש');

  const body = { updated_at: new Date().toISOString() };
  if (patch.role != null) {
    if (!USER_ROLES.includes(patch.role)) throw new ValidationError('תפקיד לא חוקי');
    body.role = patch.role;
  }
  if (patch.status != null) {
    if (!['pending', 'active', 'rejected'].includes(patch.status)) {
      throw new ValidationError('סטטוס לא חוקי');
    }
    body.status = patch.status;
  }
  if (patch.display_name !== undefined) {
    body.display_name = patch.display_name ? String(patch.display_name).trim() : null;
  }
  if (patch.workspace_access !== undefined) {
    // null = חזרה לברירת מחדל לפי תפקיד; מערך = הרשאות מותאמות
    body.workspace_access = sanitizeWorkspaceAccess(patch.workspace_access);
  }

  const url = `${buildSupabaseRestUrl(cfg.supabaseUrl, '/profiles')}?id=eq.${encodeURIComponent(userId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: profileHeaders(cfg, session.access_token, { Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const hint = /workspace_access/i.test(detail)
      ? ' — הרץ ב-Supabase את המיגרציה 20260807100000_profiles_workspace_access.sql'
      : '';
    throw new ValidationError((detail || 'עדכון החשבון נכשל') + hint);
  }
  const rows = await res.json().catch(() => []);
  const updated = Array.isArray(rows) ? rows[0] : null;
  logAuditEvent({
    entityTable: 'profiles',
    entityId: userId,
    action: 'update',
    snapshot: {
      email: updated?.email || null,
      role: updated?.role ?? body.role ?? null,
      status: updated?.status ?? body.status ?? null,
      display_name: updated?.display_name ?? body.display_name ?? null,
      workspace_access: updated?.workspace_access ?? body.workspace_access ?? null,
    },
  });
  return updated;
}

/**
 * יצירת חשבון עובד מעמדת חשבונות (בלי להחליף את ה-session של המנהל).
 */
export async function createAccountUser({
  email,
  password,
  role = 'production',
  display_name = '',
  workspace_access = null,
  status = 'active',
} = {}) {
  const session = await getValidSession();
  if (!session?.access_token) throw new ValidationError('נדרשת התחברות');
  if (!canManageAccounts(session.role)) {
    throw new ValidationError('אין הרשאה ליצור חשבונות');
  }
  if (!USER_ROLES.includes(role)) throw new ValidationError('תפקיד לא חוקי');
  if (!['pending', 'active'].includes(status)) {
    throw new ValidationError('סטטוס יצירה לא חוקי');
  }

  const { userId, email: createdEmail } = await registerAuthUser(email, password);

  const cfg = await getSupabaseBackupConfig();
  const ready = await waitForProfileRow(cfg, session.access_token, userId);
  if (!ready) {
    throw new ValidationError('המשתמש נוצר אך פרופיל עדיין לא מוכן — רענן ואשר ידנית');
  }

  const access = workspace_access === undefined
    ? null
    : sanitizeWorkspaceAccess(workspace_access);

  const updated = await updateAccountProfile(userId, {
    role,
    status,
    display_name: display_name || null,
    workspace_access: access,
  });

  logAuditEvent({
    entityTable: 'profiles',
    entityId: userId,
    action: 'create',
    snapshot: {
      email: createdEmail,
      role,
      status,
      display_name: display_name || null,
      workspace_access: access,
      created_by: session.user?.email || null,
    },
  });

  return updated || {
    id: userId,
    email: createdEmail,
    role,
    status,
    display_name: display_name || null,
    workspace_access: access,
  };
}

export function roleOptionsHtml(selected) {
  return USER_ROLES.map((role) => (
    `<option value="${role}" ${role === selected ? 'selected' : ''}>${userRoleLabel(role)}</option>`
  )).join('');
}

export function effectiveWorkspaceAccess(profile) {
  const custom = sanitizeWorkspaceAccess(profile?.workspace_access);
  if (custom) return custom;
  return defaultWorkspacesForRole(profile?.role || 'production');
}
