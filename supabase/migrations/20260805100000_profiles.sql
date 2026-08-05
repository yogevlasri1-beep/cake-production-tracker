-- Per-user profile: role drives future UI gating (not enforced yet — PR1 is infrastructure only).
-- Roles are assigned manually via SQL for now — there is no client INSERT/UPDATE policy.

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  kitchen_id text NOT NULL DEFAULT 'yitzur',
  role text NOT NULL DEFAULT 'production' CHECK (role IN ('production', 'quality', 'manager', 'admin')),
  display_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- A signed-in user may read their own profile row only.
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

GRANT SELECT ON public.profiles TO authenticated;

-- Auto-create a profile (role=production) whenever a new auth user signs up.
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role)
  VALUES (NEW.id, 'production')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_profile();

-- Backfill profiles for auth users that already exist (invited before this migration).
INSERT INTO public.profiles (id, role)
SELECT u.id, 'production'
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- לשדרוג משתמש קיים לתפקיד מסוים — הריצו ידנית ב-SQL editor של Supabase:
--   UPDATE public.profiles SET role = 'manager', updated_at = now() WHERE id = '<user-uuid>';
-- או לפי אימייל:
--   UPDATE public.profiles SET role = 'manager', updated_at = now()
--   WHERE id = (SELECT id FROM auth.users WHERE email = 'someone@example.com');
-- תפקידים אפשריים: production | quality | manager | admin
