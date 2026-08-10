import { getSupabaseBackupConfig, normalizeSupabaseUrl, buildSupabaseRestUrl } from './supabase-backup.js?v=452';
import { ValidationError } from './validators.js?v=452';

const SESSION_KEY = 'authSession';
const REFRESH_SKEW_MS = 60_000;

export const USER_ROLES = ['production', 'quality', 'manager', 'admin'];

const USER_ROLE_LABELS = {
  production: 'ייצור',
  quality: 'איכות',
  manager: 'מנהל',
  admin: 'מנהל מערכת',
};

const USER_STATUS_LABELS = {
  pending: 'ממתין לאישור',
  active: 'פעיל',
  rejected: 'נדחה',
};

function buildAuthUrl(baseUrl, path) {
  const base = normalizeSupabaseUrl(baseUrl);
  if (!base) return '';
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}/auth/v1${suffix}`;
}

function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function toSession(tokenResponse) {
  const expiresInSec = tokenResponse.expires_in ?? 3600;
  return {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expires_at: Date.now() + expiresInSec * 1000,
    user: tokenResponse.user ? { id: tokenResponse.user.id, email: tokenResponse.user.email } : null,
  };
}

async function fetchProfile(cfg, session) {
  if (!cfg.supabaseUrl || !cfg.anonKey || !session?.access_token || !session?.user?.id) return null;
  const url = `${buildSupabaseRestUrl(cfg.supabaseUrl, '/profiles')}?id=eq.${session.user.id}&select=role,display_name,status,email,workspace_access`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch {
    return null;
  }
}

function statusDeniedMessage(status) {
  if (status === 'pending') {
    return 'החשבון ממתין לאישור מנהל. נסה שוב אחרי שיאשרו אותך בעמדת חשבונות.';
  }
  if (status === 'rejected') {
    return 'החשבון נדחה. פנה למנהל המערכת.';
  }
  return 'אין הרשאת כניסה לחשבון זה.';
}

async function attachProfile(cfg, session, { requireActive = false } = {}) {
  if (!session) return session;
  const profile = await fetchProfile(cfg, session);
  // בלי שורת profile / מיגרציה ישנה — מנהל פעיל, כדי לא לנעול את הבעלים
  const role = profile?.role || 'manager';
  const status = profile?.status || 'active';
  const next = saveSession({
    ...session,
    role,
    status,
    display_name: profile?.display_name || null,
    workspace_access: Array.isArray(profile?.workspace_access) ? profile.workspace_access : null,
  });
  if (requireActive && status !== 'active') {
    clearSession();
    throw new ValidationError(statusDeniedMessage(status));
  }
  return next;
}

async function authFetch(cfg, path, body) {
  const url = buildAuthUrl(cfg.supabaseUrl, path);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: cfg.anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json?.error_description || json?.msg || json?.error || res.statusText;
    const mapped = detail === 'Invalid login credentials'
      ? 'אימייל או סיסמה שגויים'
      : detail === 'User already registered'
        ? 'האימייל כבר רשום במערכת'
        : /email not confirmed/i.test(String(detail || ''))
          ? 'האימייל עדיין לא אושר ב-Auth. מנהל: בעמדת חשבונות לחץ «פתח כניסה» (אחרי הרצת מיגרציית האישור), או אשר ב-Authentication → Users.'
          : detail || 'שגיאת התחברות';
    throw new ValidationError(mapped);
  }
  return json;
}

export async function signIn(email, password) {
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) {
    throw new ValidationError('Supabase לא מוגדר');
  }
  const json = await authFetch(cfg, '/token?grant_type=password', {
    email: String(email || '').trim(),
    password: String(password || ''),
  });
  const session = saveSession(toSession(json));
  return attachProfile(cfg, session, { requireActive: true });
}

export async function signUp(email, password) {
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) {
    throw new ValidationError('Supabase לא מוגדר');
  }
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  if (!cleanEmail || !cleanPassword) {
    throw new ValidationError('יש למלא אימייל וסיסמה');
  }
  if (cleanEmail.includes('+')) {
    throw new ValidationError('אימייל עם + לא נתמך — השתמש בכתובת רגילה');
  }
  if (cleanPassword.length < 6) {
    throw new ValidationError('הסיסמה חייבת להכיל לפחות 6 תווים');
  }

  const json = await authFetch(cfg, '/signup', {
    email: cleanEmail,
    password: cleanPassword,
  });

  const tokenPayload = json?.access_token ? json : json?.session;
  // אם הפרויקט מחזיר session מיד — בודקים סטטוס ומוודאים שלא נכנסים לפני אישור
  if (tokenPayload?.access_token) {
    const session = saveSession(toSession(tokenPayload));
    try {
      await attachProfile(cfg, session, { requireActive: true });
      return { pending: false, session: getStoredSession() };
    } catch (err) {
      clearSession();
      if (err instanceof ValidationError) {
        return { pending: true, message: err.message };
      }
      throw err;
    }
  }

  return {
    pending: true,
    message: 'ההרשמה התקבלה. החשבון ממתין לאישור מנהל בעמדת חשבונות.',
  };
}

/**
 * יצירת משתמש Auth בלי להחליף את ה-session הנוכחי (למנהל שיוצר חשבון).
 * מחזיר { userId, email }.
 */
export async function registerAuthUser(email, password) {
  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey) {
    throw new ValidationError('Supabase לא מוגדר');
  }
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  if (!cleanEmail || !cleanPassword) {
    throw new ValidationError('יש למלא אימייל וסיסמה');
  }
  if (cleanEmail.includes('+')) {
    throw new ValidationError('אימייל עם + לא נתמך — השתמש בכתובת רגילה (למשל name@gmail.com)');
  }
  if (cleanPassword.length < 6) {
    throw new ValidationError('הסיסמה חייבת להכיל לפחות 6 תווים');
  }

  const json = await authFetch(cfg, '/signup', {
    email: cleanEmail,
    password: cleanPassword,
  });

  const user = json?.user || (json?.id ? json : null);
  const userId = user?.id || json?.id;
  if (!userId) {
    throw new ValidationError('יצירת המשתמש נכשלה — אין מזהה מהשרת');
  }
  return {
    userId,
    email: user?.email || cleanEmail,
  };
}

export async function signOut() {
  const session = getStoredSession();
  clearSession();
  if (!session?.access_token) return;
  try {
    const cfg = await getSupabaseBackupConfig();
    const url = buildAuthUrl(cfg.supabaseUrl, '/logout');
    if (url) {
      await fetch(url, {
        method: 'POST',
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
    }
  } catch {
    /* best-effort — local session already cleared */
  }
}

export { getStoredSession };

export async function getValidSession() {
  const session = getStoredSession();
  if (!session?.access_token) return null;
  if (session.expires_at - REFRESH_SKEW_MS > Date.now()) {
    if (session.role !== undefined && session.status !== undefined) {
      if (session.status !== 'active') {
        clearSession();
        return null;
      }
      return session;
    }
    const cfg = await getSupabaseBackupConfig();
    try {
      return await attachProfile(cfg, session, { requireActive: true });
    } catch {
      return null;
    }
  }

  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey || !session.refresh_token) {
    clearSession();
    return null;
  }
  try {
    const json = await authFetch(cfg, '/token?grant_type=refresh_token', {
      refresh_token: session.refresh_token,
    });
    const refreshed = saveSession(toSession(json));
    return await attachProfile(cfg, refreshed, { requireActive: true });
  } catch {
    clearSession();
    return null;
  }
}

export function getCurrentUserEmail() {
  return getStoredSession()?.user?.email || null;
}

export function getCurrentUserRole() {
  return getStoredSession()?.role || 'manager';
}

export function getCurrentUserStatus() {
  return getStoredSession()?.status || 'active';
}

export function getCurrentUserDisplayName() {
  return getStoredSession()?.display_name || null;
}

/** הרשאות עמדות מותאמות מהפרופיל (null = לפי תפקיד) */
export function getCurrentWorkspaceAccess() {
  const raw = getStoredSession()?.workspace_access;
  return Array.isArray(raw) ? raw : null;
}

export function userRoleLabel(role) {
  return USER_ROLE_LABELS[role] || USER_ROLE_LABELS.production;
}

export function userStatusLabel(status) {
  return USER_STATUS_LABELS[status] || status || '—';
}
