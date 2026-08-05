-- Promote existing solo/owner accounts to manager so the side menu shows all workspaces.
-- Safe to re-run. New staff users should be set explicitly to 'production' or 'quality'.

UPDATE public.profiles
SET role = 'manager', updated_at = now()
WHERE role = 'production';

-- Or for one email only:
-- UPDATE public.profiles SET role = 'manager', updated_at = now()
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'yogev.lasri1@gmail.com');
