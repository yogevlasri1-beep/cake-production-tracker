-- Remove duplicate recipe-ingredient lines left by material merges (2026-07-26).
--
-- The user merged raw materials in Suppliers:
--   שמן / שמן חם  -> שמן סויה   (2940c1cd, recipe-default keeper)
--   קמח לבן        -> קמח        (7ccbd6c8, recipe-default keeper)
--
-- Because of multi-device sync, each affected recipe ended up with TWO live
-- ingredient lines at the SAME sortOrder: the original line (pointing to the now
-- orphan material) AND a duplicate line pointing to the merge target. Both lines
-- had identical quantity + unit, so the recipe quantity was effectively doubled
-- (e.g. בצק שמרים showed both שמן and שמן סויה).
--
-- Fix: within any recipe+sortOrder that contains BOTH a merge-target line and an
-- orphan-material line, soft-delete the orphan line. The surviving line is the
-- recipe-default merged material (priced), matching the user's merge intent, and
-- the recipe returns to a single oil / flour line with the correct quantity.
--
-- Orphan lines that are the SOLE line in their recipe+sortOrder (no target
-- sibling) are intentionally left untouched — they are not duplicates.

with target_lines as (
  select nullif(i.payload->>'recipeId', '') as recipe_id,
         i.payload->>'sortOrder' as so
  from sync_recipe_ingredients i
  where i.deleted_at is null
    and i.payload->>'rawMaterialId' in (
      '2940c1cd-2ba8-4674-9b77-410028492c3e',  -- שמן סויה (keeper)
      '7ccbd6c8-0937-4535-912f-079efb35fa59'   -- קמח (keeper)
    )
)
update sync_recipe_ingredients o
set deleted_at = now(),
    updated_at = now()
from target_lines t
where o.deleted_at is null
  and nullif(o.payload->>'recipeId', '') = t.recipe_id
  and o.payload->>'sortOrder' = t.so
  and o.payload->>'rawMaterialId' in (
    '03954677-81e1-43f8-acdd-922c68dc5cf9',  -- שמן (orphan)
    '95956aa9-7bd0-43b5-ad76-093145b6bd74',  -- שמן חם (orphan)
    '8b4ed3a0-2a74-4d0c-b7b9-79954994b604'   -- קמח לבן (orphan)
  );
