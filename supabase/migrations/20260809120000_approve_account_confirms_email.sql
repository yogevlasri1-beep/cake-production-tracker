-- אישור חשבון חייב גם לאשר אימייל ב-Auth — אחרת Login נכשל ב-"Email not confirmed"
-- למרות ש-profiles.status = active.
-- הרץ ב-Supabase → SQL Editor אם עדיין לא הוחל.

-- פתיחה מיידית למשתמשים שכבר אושרו בפרופיל אבל האימייל עדיין לא מאושר
UPDATE auth.users u
SET email_confirmed_at = COALESCE(u.email_confirmed_at, now())
WHERE u.email_confirmed_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = u.id
      AND p.status = 'active'
  );

-- אישור אימייל בלבד (ליצירת עובד דרך signup fallback)
CREATE OR REPLACE FUNCTION public.confirm_account_email(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'נדרשת התחברות';
  END IF;
  IF NOT public.is_account_manager() THEN
    RAISE EXCEPTION 'אין הרשאה לאשר אימייל משתמש';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'חסר מזהה משתמש';
  END IF;

  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now())
  WHERE id = p_user_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_account_email(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_account_email(uuid) TO authenticated;

-- אישור מלא: פרופיל active + אימייל מאושר ב-Auth
CREATE OR REPLACE FUNCTION public.approve_account_user(
  p_user_id uuid,
  p_role text DEFAULT NULL,
  p_workspace_access jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.profiles;
  new_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'נדרשת התחברות';
  END IF;
  IF NOT public.is_account_manager() THEN
    RAISE EXCEPTION 'אין הרשאה לאשר חשבונות';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'חסר מזהה משתמש';
  END IF;

  SELECT * INTO result FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'משתמש לא נמצא';
  END IF;

  new_role := result.role;
  IF p_role IS NOT NULL THEN
    IF p_role NOT IN ('production', 'quality', 'manager', 'admin') THEN
      RAISE EXCEPTION 'תפקיד לא חוקי';
    END IF;
    new_role := p_role;
  END IF;

  UPDATE public.profiles
  SET
    status = 'active',
    role = new_role,
    workspace_access = p_workspace_access,
    updated_at = now()
  WHERE id = p_user_id
  RETURNING * INTO result;

  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now())
  WHERE id = p_user_id;

  RETURN json_build_object(
    'id', result.id,
    'email', result.email,
    'role', result.role,
    'status', result.status,
    'display_name', result.display_name,
    'workspace_access', result.workspace_access
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_account_user(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_account_user(uuid, text, jsonb) TO authenticated;
