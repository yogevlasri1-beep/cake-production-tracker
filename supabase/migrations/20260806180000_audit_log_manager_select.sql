-- יומן ביקורת: קריאה למנהל/מנהל מערכת בלבד; כתיבה למשתמש פעיל.
-- משלים את הערה ב-20260805120000_audit_log.sql על הגבלת SELECT לפי תפקיד.

CREATE OR REPLACE FUNCTION public.is_kitchen_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'active'
      AND role IN ('manager', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_kitchen_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_kitchen_manager() TO authenticated;

DROP POLICY IF EXISTS sync_audit_log_insert ON public.sync_audit_log;
CREATE POLICY sync_audit_log_insert ON public.sync_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    kitchen_id = 'yitzur'
    AND public.is_active_kitchen_user()
  );

DROP POLICY IF EXISTS sync_audit_log_select ON public.sync_audit_log;
CREATE POLICY sync_audit_log_select ON public.sync_audit_log
  FOR SELECT TO authenticated
  USING (
    kitchen_id = 'yitzur'
    AND public.is_kitchen_manager()
  );

REVOKE ALL ON TABLE public.sync_audit_log FROM anon;
GRANT SELECT, INSERT ON public.sync_audit_log TO authenticated;
