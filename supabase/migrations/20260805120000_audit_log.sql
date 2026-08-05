-- RBAC שלב 3: audit trail מינימלי — תיעוד כתיבה בטבלת רשומות HACCP.
-- טבלה עצמאית (לא דרך create_kitchen_sync_table): לא חלק ממנגנון הסנכרון sync_*,
-- כתיבה מהלקוח היא best-effort בלבד ואין קריאה חוזרת ל-Dexie.

CREATE TABLE IF NOT EXISTS public.sync_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kitchen_id text NOT NULL DEFAULT 'yitzur',
  entity_table text NOT NULL,
  entity_id text,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  user_id uuid,
  user_email text,
  at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb,
  device_id text
);

CREATE INDEX IF NOT EXISTS sync_audit_log_kitchen_at_idx
  ON public.sync_audit_log (kitchen_id, at DESC);

CREATE INDEX IF NOT EXISTS sync_audit_log_entity_idx
  ON public.sync_audit_log (entity_table, entity_id);

ALTER TABLE public.sync_audit_log ENABLE ROW LEVEL SECURITY;

-- כל משתמש מחובר יכול לכתוב אירוע audit (fire-and-forget מהלקוח).
DROP POLICY IF EXISTS sync_audit_log_insert ON public.sync_audit_log;
CREATE POLICY sync_audit_log_insert ON public.sync_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- קריאה למשתמשים מחוברים בלבד; הגבלה לפי תפקיד (manager/admin) תתווסף בשלב מאוחר יותר.
DROP POLICY IF EXISTS sync_audit_log_select ON public.sync_audit_log;
CREATE POLICY sync_audit_log_select ON public.sync_audit_log
  FOR SELECT TO authenticated
  USING (true);

-- אין UPDATE/DELETE מהלקוח — יומן audit הוא append-only.
GRANT SELECT, INSERT ON public.sync_audit_log TO authenticated;
