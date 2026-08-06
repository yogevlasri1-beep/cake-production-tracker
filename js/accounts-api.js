import {
  getSupabaseBackupConfig,
  buildSupabaseRestUrl,
} from './supabase-backup.js?v=418';
import {
  getValidSession,
  userRoleLabel,
  USER_ROLES,
} from './auth.js?v=418';
import { ValidationError } from './validators.js?v=418';

function profileHeaders(cfg, accessToken, extra = {}) {
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function listAccountProfiles() {
  const cfg = await getSupabaseBackupConfig();
  const session = await getValidSession();
  if (!cfg.supabaseUrl || !cfg.anonKey || !session?.access_token) {
    throw new ValidationError('נדרשת התחברות');
  }
  const url = `${buildSupabaseRestUrl(cfg.supabaseUrl, '/profiles')}?select=id,email,role,status,display_name,updated_at&order=updated_at.desc`;
  const res = await fetch(url, { headers: profileHeaders(cfg, session.access_token) });
  if (!res.ok) {
    let detail = '';
    try {
      const raw = await res.text();
      try {
        const j = JSON.parse(raw);
        detail = j.message || j.error_description || j.error || raw;
      } catch {
        detail = raw;
      }
    } catch { /* ignore */ }
    throw new ValidationError(detail || 'לא ניתן לטעון חשבונות — ודא שהמיגרציה רצה ב-Supabase');
  }
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

export async function updateAccountProfile(userId, patch) {
  const cfg = await getSupabaseBackupConfig();
  const session = await getValidSession();
  if (!cfg.supabaseUrl || !cfg.anonKey || !session?.access_token) {
    throw new ValidationError('נדרשת התחברות');
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

  const url = `${buildSupabaseRestUrl(cfg.supabaseUrl, '/profiles')}?id=eq.${encodeURIComponent(userId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: profileHeaders(cfg, session.access_token, { Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ValidationError(detail || 'עדכון החשבון נכשל');
  }
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
}

export function roleOptionsHtml(selected) {
  return USER_ROLES.map((role) => (
    `<option value="${role}" ${role === selected ? 'selected' : ''}>${userRoleLabel(role)}</option>`
  )).join('');
}
