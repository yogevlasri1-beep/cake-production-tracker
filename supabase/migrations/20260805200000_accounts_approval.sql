-- Account approval workflow: status + email on profiles, manager/admin can list & update.
-- New signups start as pending/production until an account admin approves them.

-- Existing rows must stay usable: add as active first, then flip default for new inserts.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS status text;

UPDATE public.profiles
SET status = 'active'
WHERE status IS NULL OR status = '';

ALTER TABLE public.profiles
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.profiles
  ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_status_check
      CHECK (status IN ('pending', 'active', 'rejected'));
  END IF;
END $$;

-- Backfill email from auth.users
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND (p.email IS NULL OR p.email = '');

-- Owner: active manager
UPDATE public.profiles p
SET
  role = 'manager',
  status = 'active',
  email = COALESCE(p.email, u.email),
  updated_at = now()
FROM auth.users u
WHERE p.id = u.id
  AND lower(u.email) = lower('yogev.lasri1@gmail.com');

CREATE OR REPLACE FUNCTION public.is_account_manager()
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
      AND role IN ('manager', 'admin')
      AND status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_account_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_manager() TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_role text := 'production';
  new_status text := 'pending';
BEGIN
  IF lower(COALESCE(NEW.email, '')) = lower('yogev.lasri1@gmail.com') THEN
    new_role := 'manager';
    new_status := 'active';
  END IF;

  INSERT INTO public.profiles (id, role, email, status)
  VALUES (NEW.id, new_role, NEW.email, new_status)
  ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, public.profiles.email),
        updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_profile();

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_account_manager());

DROP POLICY IF EXISTS profiles_update_managers ON public.profiles;
CREATE POLICY profiles_update_managers ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_account_manager())
  WITH CHECK (public.is_account_manager());

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
