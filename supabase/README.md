# Supabase live sync

Continuous row-level sync between the PWA (IndexedDB/Dexie) and Postgres.

## Kitchen scope

- `kitchen_id` = `yitzur` (shared kitchen, anon key + RLS)
- Conflict policy: **last-write-wins** via `updated_at`
- Soft deletes via `deleted_at`

## Migration

File: `migrations/20260724120000_kitchen_live_sync.sql`

Creates one `sync_*` table per Dexie collection (jsonb `payload` + sync columns) and enables Realtime + RLS.

Applied to project `ravhjceukjsjfigcqgob`.

## App modules

- `js/sync/collections.js` — table map, FK map, order
- `js/sync/id-map.js` — localId ↔ sync UUID
- `js/supabase-sync.js` — queue, push, pull, seed, Dexie middleware

## UI

Backup screen → **סנכרון חי בין מכשירים** (on by default after publish).

## Login (Supabase Auth)

App requires sign-in at launch (`js/auth.js`, `js/screens/login.js`). Invite-only — no
in-app sign-up. Login is an identity layer only: every signed-in user still reads/writes
the same shared `yitzur` kitchen data (RLS above is unchanged, and still keyed on
`kitchen_id`, not per-user).

To add a staff account:

1. Supabase dashboard → project `ravhjceukjsjfigcqgob` → **Authentication → Providers**
   → make sure **Email** is enabled.
2. **Authentication → Users → Add user** → enter email + password.
   Mark the email as confirmed (or turn off "Confirm email" under Providers → Email if
   you'd rather staff not need to click a confirmation link).
