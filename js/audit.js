// RBAC שלב 3: audit trail מינימלי — תיעוד best-effort של פעולות כתיבה ל-Supabase.
// כישלון רשת/הרשאות לא אמור לחסום שום פעולה עסקית: כל שגיאה נבלעת כאן.
import { getValidSession } from './auth.js?v=412';
import { getSupabaseBackupConfig, buildSupabaseRestUrl, getOrCreateDeviceId, getBackupScopeId } from './supabase-backup.js?v=412';

const AUDIT_ACTIONS = ['create', 'update', 'delete'];
const TABLE = 'sync_audit_log';

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
