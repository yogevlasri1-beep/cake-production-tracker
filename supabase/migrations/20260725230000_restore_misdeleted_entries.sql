-- Restore 4 production entries that step 3a of
-- 20260725220000_cleanup_orphan_children_and_dup_ingredients soft-deleted
-- because an unrelated live entry shared the same date+quantity.
-- Already applied via execute_sql; kept here for documentation / fresh DBs.

update sync_production_entries
set deleted_at = null, updated_at = now()
where id in (
  '51bc5cba-311e-4f72-a9e5-cd19f3f9794f',
  '87cee691-d6b8-40a5-bdab-cdb47d00ae76',
  'bd9e356d-422d-45fb-b66b-4d263867e0fd',
  '94a9e996-99fa-4b0d-b7d6-87c2acfb1a6d'
)
and deleted_at is not null;
