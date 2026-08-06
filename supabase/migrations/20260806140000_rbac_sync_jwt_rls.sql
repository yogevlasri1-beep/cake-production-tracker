-- RBAC שלב 4: סנכרון רק עם JWT של משתמש פעיל (status=active).
-- מבטל גישת anon לטבלאות sync_* / sync_kitchen_meta.
-- חשוב: לפרוס קודם את גרסת האפליקציה ששולחת Bearer של המשתמש, ואז להריץ מיגרציה זו.

CREATE OR REPLACE FUNCTION public.is_active_kitchen_user()
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
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_kitchen_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_kitchen_user() TO authenticated;

-- מעדכן את ה-helper ליצירת טבלאות עתידיות
CREATE OR REPLACE FUNCTION public.create_kitchen_sync_table(table_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS public.%I (
      id uuid PRIMARY KEY,
      kitchen_id text NOT NULL DEFAULT %L,
      payload jsonb NOT NULL DEFAULT %L::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      device_id text
    )', table_name, 'yitzur', '{}');

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (kitchen_id, updated_at DESC)',
    table_name || '_kitchen_updated_idx',
    table_name
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (kitchen_id) WHERE deleted_at IS NULL',
    table_name || '_kitchen_live_idx',
    table_name
  );

  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_kitchen_all', table_name);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
       USING (kitchen_id = %L AND public.is_active_kitchen_user())
       WITH CHECK (kitchen_id = %L AND public.is_active_kitchen_user())',
    table_name || '_kitchen_all',
    table_name,
    'yitzur',
    'yitzur'
  );

  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);

  BEGIN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END;
$$;

-- מחיל על כל טבלאות הסנכרון הקיימות (חוץ מיומן audit שכבר authenticated-only)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname LIKE 'sync_%'
      AND c.relname <> 'sync_audit_log'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tablename || '_kitchen_all', r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (kitchen_id = %L AND public.is_active_kitchen_user())
         WITH CHECK (kitchen_id = %L AND public.is_active_kitchen_user())',
      r.tablename || '_kitchen_all',
      r.tablename,
      'yitzur',
      'yitzur'
    );
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', r.tablename);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', r.tablename);
  END LOOP;
END $$;

-- sync_kitchen_meta
DROP POLICY IF EXISTS sync_kitchen_meta_all ON public.sync_kitchen_meta;
CREATE POLICY sync_kitchen_meta_all ON public.sync_kitchen_meta
  FOR ALL TO authenticated
  USING (kitchen_id = 'yitzur' AND public.is_active_kitchen_user())
  WITH CHECK (kitchen_id = 'yitzur' AND public.is_active_kitchen_user());
REVOKE ALL ON TABLE public.sync_kitchen_meta FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.sync_kitchen_meta TO authenticated;

-- app_backups (אם קיימת) — אותה מדיניות
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'app_backups' AND c.relkind = 'r'
  ) THEN
    EXECUTE 'ALTER TABLE public.app_backups ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS app_backups_all ON public.app_backups';
    EXECUTE 'DROP POLICY IF EXISTS app_backups_kitchen_all ON public.app_backups';
    -- מדיניות גנרית: משתמש פעיל בלבד (גיבויים הם ל-kitchen משותף)
    BEGIN
      EXECUTE $p$
        CREATE POLICY app_backups_active_users ON public.app_backups
          FOR ALL TO authenticated
          USING (public.is_active_kitchen_user())
          WITH CHECK (public.is_active_kitchen_user())
      $p$;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    EXECUTE 'REVOKE ALL ON TABLE public.app_backups FROM anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_backups TO authenticated';
  END IF;
END $$;
