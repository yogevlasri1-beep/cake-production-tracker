-- הרץ ב-Supabase → SQL Editor (פעם אחת) כדי לפתוח משתמשים שנתקעו בלי אישור אימייל

-- 1) אשר את כל המשתמשים שחסר להם אישור אימייל
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email_confirmed_at IS NULL;

-- 2) (אופציונלי) הפעל פרופילים פקטיביים שעדיין pending
UPDATE public.profiles
SET status = 'active',
    role = COALESCE(NULLIF(role, ''), 'production'),
    updated_at = now()
WHERE status = 'pending'
  AND (
    email ILIKE 'fake%'
    OR email ILIKE 'fakesync%'
    OR email ILIKE 'fakestaff%'
  );
