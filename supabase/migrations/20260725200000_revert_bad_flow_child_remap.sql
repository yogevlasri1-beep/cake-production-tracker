-- Corrective fix for 20260725190000_dedupe_production_runs_and_history.sql.
-- Applied to the live project on 2026-07-25 via MCP (already executed — kept for documentation).
--
-- That migration remapped flow-child rows (steps, checklist items, product links,
-- baking-profile products) from the dead duplicate flows onto the surviving flows.
-- That was wrong: the surviving flows already had their own complete children, so
-- the remap injected duplicates — flows ended up with 14-18 steps instead of 7-9,
-- with clashing sortOrder values, which broke starting a production run.
--
-- Here we soft-delete only those wrongly-remapped rows. They are identified by the
-- remap timestamp window plus a corroborating condition (duplicate of an older
-- sibling, or pointing at a parent that is no longer live).

DO $$
DECLARE
  n int;
  remap_from timestamptz := '2026-07-25 16:16:00+00';
  remap_to   timestamptz := '2026-07-25 16:17:00+00';
BEGIN

-- 1) flow steps: duplicates injected into flows that already had their own steps
UPDATE sync_flow_steps t
SET deleted_at = now(), updated_at = now()
WHERE t.deleted_at IS NULL
  AND t.updated_at >= remap_from AND t.updated_at < remap_to
  AND EXISTS (
    SELECT 1 FROM sync_flow_steps o
    WHERE o.deleted_at IS NULL
      AND o.payload->>'flowId' = t.payload->>'flowId'
      AND o.updated_at < remap_from
  );
GET DIAGNOSTICS n = ROW_COUNT;
RAISE NOTICE 'flow steps reverted: %', n;

-- 2) flow checklist items: all remapped ones point at dead checklist tasks
UPDATE sync_flow_checklist_items t
SET deleted_at = now(), updated_at = now()
WHERE t.deleted_at IS NULL
  AND t.updated_at >= remap_from AND t.updated_at < remap_to
  AND NOT EXISTS (
    SELECT 1 FROM sync_checklist_tasks c
    WHERE c.id::text = t.payload->>'checklistTaskId' AND c.deleted_at IS NULL
  );
GET DIAGNOSTICS n = ROW_COUNT;
RAISE NOTICE 'checklist items reverted: %', n;

-- 3) baking profile products: all remapped ones point at dead profiles
UPDATE sync_baking_profile_products t
SET deleted_at = now(), updated_at = now()
WHERE t.deleted_at IS NULL
  AND t.updated_at >= remap_from AND t.updated_at < remap_to
  AND NOT EXISTS (
    SELECT 1 FROM sync_baking_profiles p
    WHERE p.id::text = t.payload->>'bakingProfileId' AND p.deleted_at IS NULL
  );
GET DIAGNOSTICS n = ROW_COUNT;
RAISE NOTICE 'baking profile products reverted: %', n;

-- 4) product-flow links created by the remap (mostly point at dead product or flow)
UPDATE sync_product_flow_links t
SET deleted_at = now(), updated_at = now()
WHERE t.deleted_at IS NULL
  AND t.updated_at >= remap_from AND t.updated_at < remap_to;
GET DIAGNOSTICS n = ROW_COUNT;
RAISE NOTICE 'product flow links reverted: %', n;

END $$;
