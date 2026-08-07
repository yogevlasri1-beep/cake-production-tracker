# Supabase live sync

Continuous row-level sync between the PWA (IndexedDB/Dexie) and Postgres.

## Kitchen scope

- `kitchen_id` = `yitzur` (shared kitchen)
- Conflict policy: **last-write-wins** via `updated_at`
- Soft deletes via `deleted_at`
- **RBAC שלב 4:** REST sync/backup שולחים JWT של המשתמש; אחרי מיגרציה
  `20260806140000_rbac_sync_jwt_rls.sql` רק `authenticated` עם `profiles.status=active`
  יכול לקרוא/לכתוב ל-`sync_*` (גישת `anon` מבוטלת)

## Migration

Files:
- `migrations/20260724120000_kitchen_live_sync.sql` — יצירת טבלאות sync
- `migrations/20260806140000_rbac_sync_jwt_rls.sql` — נעילת anon + בדיקת משתמש פעיל

Creates one `sync_*` table per Dexie collection (jsonb `payload` + sync columns) and enables Realtime + RLS.

Applied to project `ravhjceukjsjfigcqgob`.

## App modules

- `js/sync/collections.js` — table map, FK map, order
- `js/sync/id-map.js` — localId ↔ sync UUID
- `js/supabase-sync.js` — queue, push, pull, seed, Dexie middleware

## UI

Backup screen → **סנכרון חי בין מכשירים** (on by default after publish).

## Login (Supabase Auth)

App requires sign-in at launch (`js/auth.js`, `js/screens/login.js`). Users can register
in-app; new accounts start as `pending` until a manager approves them in the **חשבונות**
workspace. Sync uses the signed-in user's JWT; all active users still share the same
`yitzur` kitchen data (not per-user tenant isolation).

To add a staff account:

1. In the app: **חשבונות** → **צור חשבון חדש** (email + password + role + workspace
   checkboxes). The account is created as `active` immediately.
2. Or login screen → **הרשמה**, then approve in **חשבונות** and set workspaces.
3. Or Supabase dashboard → **Authentication → Users → Add user** (then set role/status/
   `workspace_access` on `public.profiles`).

Per-user workspace permissions: column `profiles.workspace_access` (jsonb array of
workspace ids). `NULL` = follow the role matrix in `js/permissions.js`.

Mark the email as confirmed (or turn off "Confirm email" under Providers → Email if
you'd rather staff not need to click a confirmation link).

Migration for workspace overrides:
`migrations/20260807100000_profiles_workspace_access.sql`
