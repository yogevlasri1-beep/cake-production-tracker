-- Per-user workspace permissions (optional overrides on top of role defaults).
-- NULL = follow role matrix in the app; JSON array = explicit workspace ids.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS workspace_access jsonb;

COMMENT ON COLUMN public.profiles.workspace_access IS
  'Optional list of workspace ids the user may open. NULL = use role defaults.';
