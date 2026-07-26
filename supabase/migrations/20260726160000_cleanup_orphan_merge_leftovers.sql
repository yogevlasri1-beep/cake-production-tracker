-- Cleanup leftover orphan rows after material merges (2026-07-26).
--
-- After removing duplicate ingredient lines (migration 20260726150000), two
-- live ingredient rows remain with a NULL recipeId (שמן, קמח לבן), and several
-- supplier-less raw-material records that were absorbed into a recipe-default
-- keeper via synonyms still exist as live catalog ghosts.
--
-- This does NOT merge same-name materials from different suppliers (e.g.
-- פוטסיום פוליבה vs השלושה) — those are separate supplier price records and
-- do not create doubled recipe quantities.

-- 1) Soft-delete live ingredient rows with no recipe parent.
update sync_recipe_ingredients
set deleted_at = now(),
    updated_at = now()
where deleted_at is null
  and nullif(payload->>'recipeId', '') is null;

-- 2) Soft-delete supplier-less orphan materials that are synonyms (or exact
--    name matches) of a live recipe-default keeper, and have zero live
--    ingredient references remaining.
with keepers as (
  select id,
         lower(trim(payload->>'name')) as name_key,
         coalesce(payload->'synonyms', '[]'::jsonb) as synonyms
  from sync_raw_materials
  where deleted_at is null
    and coalesce(payload->>'isRecipeDefault', '') = 'true'
),
orphan_ids as (
  select o.id
  from sync_raw_materials o
  join keepers k on (
    lower(trim(o.payload->>'name')) = k.name_key
    or lower(trim(o.payload->>'name')) = any (
      select lower(trim(s)) from jsonb_array_elements_text(k.synonyms) s
    )
  )
  where o.deleted_at is null
    and o.id <> k.id
    and nullif(o.payload->>'supplierId', '') is null
    and not exists (
      select 1
      from sync_recipe_ingredients i
      where i.deleted_at is null
        and nullif(i.payload->>'rawMaterialId', '') = o.id::text
    )
)
update sync_raw_materials m
set deleted_at = now(),
    updated_at = now()
from orphan_ids o
where m.id = o.id
  and m.deleted_at is null;
