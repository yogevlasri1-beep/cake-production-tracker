// RBAC שלב 3+: audit trail — כתיבה best-effort + קריאה ליומן (מנהל/admin).
// כישלון רשת/הרשאות בכתיבה לא חוסם פעולה עסקית.
import { getValidSession } from './auth.js?v=482';
import {
  getSupabaseBackupConfig,
  buildSupabaseRestUrl,
  getOrCreateDeviceId,
  getBackupScopeId,
} from './supabase-backup.js?v=482';
import { ValidationError } from './validators.js?v=482';

const AUDIT_ACTIONS = ['create', 'update', 'delete'];
const TABLE = 'sync_audit_log';

const ENTITY_LABELS = {
  haccpCcps: 'נקודות בקרה (CCP)',
  haccpCriticalLimits: 'גבולות קריטיים',
  haccpMonitoringLogs: 'יומן ניטור',
  haccpMonitoring: 'נהלי ניטור',
  haccpCorrectiveActions: 'פעולות מתקנות',
  haccpVerificationProcs: 'נהלי אימות',
  haccpDocuments: 'מסמכי HACCP',
  haccpHazards: 'סיכונים',
  haccpPrpControls: 'תכניות קדם (PRP)',
  haccpPrp: 'תכניות קדם (PRP)', // alias ישן
  haccpTeamMembers: 'צוות HACCP',
  haccpTeam: 'צוות HACCP', // alias ישן
  haccpProductDescriptions: 'תיאור מוצר HACCP',
  haccpProducts: 'תיאור מוצר HACCP', // alias ישן
  haccpIntendedUses: 'שימוש מיועד',
  haccpFlowSteps: 'שלבי תרשים זרימה',
  haccpFlowVerifications: 'אימות תרשים זרימה',
  haccpPlans: 'תכניות HACCP',
  profiles: 'חשבונות',
  inventoryBalances: 'יתרות מלאי',
  inventoryMovements: 'תנועות מלאי',
  recipes: 'מתכונים',
  recipeIngredients: 'רכיבי מתכון',
  recipeVersions: 'גרסאות מתכון',
  flows: 'תזרימים',
  flowSteps: 'שלבי תזרים',
};

const ACTION_LABELS = {
  create: 'יצירה',
  update: 'עדכון',
  delete: 'מחיקה',
};

/** מנקה ומאמת קלט ל-audit event; מחזיר null אם הקלט לא תקין */
export function sanitizeAuditPayload({ entityTable, entityId, action, snapshot } = {}) {
  const table = String(entityTable || '').trim();
  const act = AUDIT_ACTIONS.includes(action) ? action : null;
  if (!table || !act) return null;
  return {
    entityTable: table,
    entityId: entityId == null ? null : String(entityId),
    action: act,
    snapshot: snapshot != null ? snapshot : null,
  };
}

export function auditActionLabel(action) {
  return ACTION_LABELS[action] || String(action || '—');
}

export function auditEntityLabel(entityTable) {
  const key = String(entityTable || '').trim();
  if (!key) return '—';
  return ENTITY_LABELS[key] || key;
}

/** סיכום קצר מ-snapshot לתצוגה ביומן */
export function formatAuditSnapshotSummary(snapshot) {
  if (snapshot == null) return '';
  let obj = snapshot;
  if (typeof snapshot === 'string') {
    try { obj = JSON.parse(snapshot); } catch { return String(snapshot).slice(0, 120); }
  }
  if (typeof obj !== 'object' || !obj) return '';
  const parts = [];
  for (const key of [
    'materialName', 'name', 'title', 'label', 'ccpName', 'hazardName',
    'email', 'role', 'status', 'kind', 'delta', 'qtyAfter', 'reason', 'result',
  ]) {
    if (obj[key] != null && String(obj[key]).trim() !== '') {
      let val = String(obj[key]).trim();
      if (key === 'delta' && Number.isFinite(Number(obj[key]))) {
        const n = Number(obj[key]);
        val = `${n > 0 ? '+' : ''}${n}${obj.unit ? ` ${obj.unit}` : ''}`;
      } else if (key === 'qtyAfter' && Number.isFinite(Number(obj[key]))) {
        val = `יתרה ${obj[key]}${obj.unit ? ` ${obj.unit}` : ''}`;
      }
      parts.push(val);
    }
  }
  if (!parts.length && obj.id != null) parts.push(`#${obj.id}`);
  return [...new Set(parts)].slice(0, 4).join(' · ').slice(0, 180);
}

/**
 * רישום אירוע audit — fire-and-forget: לעולם לא נזרקת שגיאה החוצה,
 * ואין חובה לחכות (await) לתוצאה בצד הקורא.
 */
export async function logAuditEvent(event) {
  try {
    const payload = sanitizeAuditPayload(event);
    if (!payload) return;

    const session = await getValidSession();
    if (!session?.access_token || !session?.user?.id) return;

    const cfg = await getSupabaseBackupConfig();
    if (!cfg.supabaseUrl || !cfg.anonKey) return;
    const url = buildSupabaseRestUrl(cfg.supabaseUrl, `/${TABLE}`);
    if (!url) return;

    const deviceId = await getOrCreateDeviceId();

    await fetch(url, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        kitchen_id: getBackupScopeId(),
        entity_table: payload.entityTable,
        entity_id: payload.entityId,
        action: payload.action,
        user_id: session.user.id,
        user_email: session.user.email || null,
        snapshot: payload.snapshot,
        device_id: deviceId,
      }),
    });
  } catch {
    /* best-effort audit — כישלון רשת/הרשאות לא חוסם שום פעולה עסקית */
  }
}

/**
 * שליפת אירועי audit מהענן (מנהל/admin דרך RLS).
 * @param {{ action?: string, entityTable?: string, search?: string, limit?: number }} opts
 */
export async function fetchAuditEvents({
  action = '',
  entityTable = '',
  search = '',
  limit = 100,
} = {}) {
  const cfg = await getSupabaseBackupConfig();
  const session = await getValidSession();
  if (!cfg.supabaseUrl || !cfg.anonKey || !session?.access_token) {
    throw new ValidationError('נדרשת התחברות');
  }

  const params = new URLSearchParams();
  params.set('select', 'id,kitchen_id,entity_table,entity_id,action,user_id,user_email,at,snapshot,device_id');
  params.set('kitchen_id', `eq.${getBackupScopeId()}`);
  params.set('order', 'at.desc');
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  params.set('limit', String(lim));

  if (AUDIT_ACTIONS.includes(action)) {
    params.set('action', `eq.${action}`);
  }
  const table = String(entityTable || '').trim();
  if (table) {
    params.set('entity_table', `eq.${table}`);
  }
  const q = String(search || '').trim();
  if (q) {
    const safe = q.replace(/[,.()]/g, ' ').slice(0, 80);
    if (safe) {
      params.set(
        'or',
        `(user_email.ilike.*${safe}*,entity_table.ilike.*${safe}*,entity_id.ilike.*${safe}*)`,
      );
    }
  }

  const base = buildSupabaseRestUrl(cfg.supabaseUrl, `/${TABLE}`);
  if (!base) throw new ValidationError('כתובת Supabase לא תקינה');
  const url = `${base}?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });

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
    if (res.status === 401 || res.status === 403) {
      throw new ValidationError('אין הרשאה לקרוא את יומן הביקורת (מנהל/מנהל מערכת בלבד)');
    }
    throw new ValidationError(detail || 'לא ניתן לטעון את יומן הביקורת');
  }

  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

export function auditKnownEntityTables() {
  return Object.keys(ENTITY_LABELS);
}
