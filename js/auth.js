import { getSupabaseBackupConfig, normalizeSupabaseUrl } from './supabase-backup.js?v=410';
import { ValidationError } from './validators.js?v=410';

const SESSION_KEY = 'authSession';
const REFRESH_SKEW_MS = 60_000;

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
    throw new ValidationError(detail === 'Invalid login credentials' ? 'אימייל או סיסמה שגויים' : detail || 'שגיאת התחברות');
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
  return saveSession(toSession(json));
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
  if (session.expires_at - REFRESH_SKEW_MS > Date.now()) return session;

  const cfg = await getSupabaseBackupConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey || !session.refresh_token) {
    clearSession();
    return null;
  }
  try {
    const json = await authFetch(cfg, '/token?grant_type=refresh_token', {
      refresh_token: session.refresh_token,
    });
    return saveSession(toSession(json));
  } catch {
    clearSession();
    return null;
  }
}

export function getCurrentUserEmail() {
  return getStoredSession()?.user?.email || null;
}
