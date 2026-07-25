-- Cleanup after the multi-device dedupe rounds:
-- 1. Recipes showing the same ingredient line twice (same recipe+name+sortOrder,
--    each copy linked to a different supplier-sibling material after the merge)
--    → keep the copy linked to the merge-primary material (richest price
--    history), soft-delete the other copy.
-- 2. Portion-preset ingredient settings pointing at an ingredient copy deleted
--    in step 1 → remap to the kept copy when possible.
-- 3. Production entries pointing at soft-deleted products/runs → soft-delete
--    only when a live twin exists; otherwise detach runId and keep the history.
-- 4. Live child rows whose parent is soft-deleted or missing (dedupe leftovers
--    that were never remapped in the cloud) → soft-delete.
-- 5. Exact duplicate live portion-preset links → keep the oldest.

-- 1) Duplicate recipe ingredient lines --------------------------------------
with dups as (
  select i.payload->>'recipeId' as rid,
         lower(trim(i.payload->>'name')) as nm,
         coalesce(i.payload->>'sortOrder', '') as so
  from sync_recipe_ingredients i
  where i.deleted_at is null
  group by 1, 2, 3
  having count(*) > 1
),
ranked as (
  select i.id,
    row_number() over (
      partition by i.payload->>'recipeId', lower(trim(i.payload->>'name')),
                   coalesce(i.payload->>'sortOrder', '')
      order by
        (select count(*) from sync_raw_material_price_history h
          where h.deleted_at is null
            and h.payload->>'rawMaterialId' = i.payload->>'rawMaterialId') desc,
        i.updated_at asc, i.id asc
    ) as rn
  from sync_recipe_ingredients i
  join dups d on d.rid = i.payload->>'recipeId'
    and d.nm = lower(trim(i.payload->>'name'))
    and d.so = coalesce(i.payload->>'sortOrder', '')
  where i.deleted_at is null
)
update sync_recipe_ingredients
set deleted_at = now(), updated_at = now()
where id in (select id from ranked where rn > 1);

-- 2) Remap preset ingredient settings to the kept ingredient copy ------------
with deadref as (
  select s.id as sid,
         i.payload->>'recipeId' as rid,
         lower(trim(i.payload->>'name')) as nm,
         coalesce(i.payload->>'sortOrder', '') as so,
         s.payload->>'portionPresetId' as pid
  from sync_portion_preset_ingredient_settings s
  join sync_recipe_ingredients i on i.id = nullif(s.payload->>'recipeIngredientId', '')::uuid
  where s.deleted_at is null and i.deleted_at is not null and i.payload ? 'recipeId'
),
kept as (
  select d.sid, d.pid,
    (select k.id from sync_recipe_ingredients k
      where k.deleted_at is null
        and k.payload->>'recipeId' = d.rid
        and lower(trim(k.payload->>'name')) = d.nm
        and coalesce(k.payload->>'sortOrder', '') = d.so
      limit 1) as kid
  from deadref d
)
update sync_portion_preset_ingredient_settings s
set payload = s.payload || jsonb_build_object('recipeIngredientId', k.kid::text),
    updated_at = now()
from kept k
where s.id = k.sid and k.kid is not null
  and not exists (
    select 1 from sync_portion_preset_ingredient_settings s2
    where s2.deleted_at is null and s2.id <> s.id
      and s2.payload->>'portionPresetId' = k.pid
      and s2.payload->>'recipeIngredientId' = k.kid::text);

-- 3a) Production entries whose product is soft-deleted and a live twin exists
-- NOTE: early draft matched only date+quantity (too loose) and wrongly deleted
-- 4 unique entries; those were restored in 20260725230000_restore_misdeleted_entries.
-- Keep this step product-aware if re-applied on a fresh DB.
update sync_production_entries e
set deleted_at = now(), updated_at = now()
where e.deleted_at is null
  and (e.payload->>'productId') ~ '^[0-9a-fA-F-]{36}$'
  and exists (select 1 from sync_products p
    where p.id = (e.payload->>'productId')::uuid and p.deleted_at is not null)
  and exists (select 1 from sync_production_entries t
    where t.deleted_at is null and t.id <> e.id
      and t.payload->>'date' = e.payload->>'date'
      and t.payload->>'productId' = e.payload->>'productId'
      and t.payload->>'quantity' = e.payload->>'quantity');

-- 3b) Production entries whose run is soft-deleted: delete duplicates,
--     detach the rest (keep the history row without a run link)
update sync_production_entries e
set deleted_at = now(), updated_at = now()
where e.deleted_at is null
  and (e.payload->>'runId') ~ '^[0-9a-fA-F-]{36}$'
  and exists (select 1 from sync_production_runs r
    where r.id = (e.payload->>'runId')::uuid and r.deleted_at is not null)
  and exists (
    select 1 from sync_production_entries t
    join sync_production_runs r2 on r2.id = nullif(t.payload->>'runId', '')::uuid
    where t.deleted_at is null and t.id <> e.id and r2.deleted_at is null
      and t.payload->>'date' = e.payload->>'date'
      and t.payload->>'productId' = e.payload->>'productId'
      and coalesce(t.payload->>'quantity', '') = coalesce(e.payload->>'quantity', ''));

update sync_production_entries e
set payload = e.payload || '{"runId": null}'::jsonb, updated_at = now()
where e.deleted_at is null
  and (e.payload->>'runId') ~ '^[0-9a-fA-F-]{36}$'
  and not exists (select 1 from sync_production_runs r
    where r.id = (e.payload->>'runId')::uuid and r.deleted_at is null);

-- 4) Orphan children of soft-deleted / missing parents -----------------------
update sync_run_step_states c set deleted_at = now(), updated_at = now()
where c.deleted_at is null and (c.payload->>'runId') ~ '^[0-9a-fA-F-]{36}$'
  and not exists (select 1 from sync_production_runs p
    where p.id = (c.payload->>'runId')::uuid and p.deleted_at is null);

update sync_run_preparation_checks c set deleted_at = now(), updated_at = now()
where c.deleted_at is null and (
  ((c.payload->>'runId') ~ '^[0-9a-fA-F-]{36}$' and not exists (
    select 1 from sync_production_runs p
    where p.id = (c.payload->>'runId')::uuid and p.deleted_at is null))
  or ((c.payload->>'flowPreparationId') ~ '^[0-9a-fA-F-]{36}$' and not exists (
    select 1 from sync_group_preparations p
    where p.id = (c.payload->>'flowPreparationId')::uuid and p.deleted_at is null)));

update sync_run_cleaning_checks c set deleted_at = now(), updated_at = now()
where c.deleted_at is null and (
  ((c.payload->>'runId') ~ '^[0-9a-fA-F-]{36}$' and not exists (
    select 1 from sync_production_runs p
    where p.id = (c.payload->>'runId')::uuid and p.deleted_at is null))
  or ((c.payload->>'flowCleaningTaskId') ~ '^[0-9a-fA-F-]{36}$' and not exists (
    select 1 from sync_flow_cleaning_tasks p
    where p.id = (c.payload->>'flowCleaningTaskId')::uuid and p.deleted_at is null)));

update sync_portion_preset_links c set deleted_at = now(), updated_at = now()
where c.deleted_at is null and (c.payload->>'portionPresetId') ~ '^[0-9a-fA-F-]{36}$'
  and not exists (select 1 from sync_group_portion_presets p
    where p.id = (c.payload->>'portionPresetId')::uuid and p.deleted_at is null);

update sync_portion_preset_ingredient_settings c set deleted_at = now(), updated_at = now()
where c.deleted_at is null and (
  ((c.payload->>'portionPresetId') ~ '^[0-9a-fA-F-]{36}$' and not exists (
    select 1 from sync_group_portion_presets p
    where p.id = (c.payload->>'portionPresetId')::uuid and p.deleted_at is null))
  or ((c.payload->>'recipeIngredientId') ~ '^[0-9a-fA-F-]{36}$' and not exists (
    select 1 from sync_recipe_ingredients p
    where p.id = (c.payload->>'recipeIngredientId')::uuid and p.deleted_at is null)));

update sync_baking_profile_scopes c set deleted_at = now(), updated_at = now()
where c.deleted_at is null and (c.payload->>'bakingProfileId') ~ '^[0-9a-fA-F-]{36}$'
  and not exists (select 1 from sync_baking_profiles p
    where p.id = (c.payload->>'bakingProfileId')::uuid and p.deleted_at is null);

update sync_product_flow_links c set deleted_at = now(), updated_at = now()
where c.deleted_at is null and (
  ((c.payload->>'productId') ~ '^[0-9a-fA-F-]{36}$' and not exists (
    select 1 from sync_products p
    where p.id = (c.payload->>'productId')::uuid and p.deleted_at is null))
  or ((c.payload->>'flowId') ~ '^[0-9a-fA-F-]{36}$' and not exists (
    select 1 from sync_flows p
    where p.id = (c.payload->>'flowId')::uuid and p.deleted_at is null)));

update sync_recipe_product_category_links c set deleted_at = now(), updated_at = now()
where c.deleted_at is null and (
  ((c.payload->>'recipeId') ~ '^[0-9a-fA-F-]{36}$' and not exists (
    select 1 from sync_recipes p
    where p.id = (c.payload->>'recipeId')::uuid and p.deleted_at is null))
  or ((c.payload->>'categoryId') ~ '^[0-9a-fA-F-]{36}$' and not exists (
    select 1 from sync_categories p
    where p.id = (c.payload->>'categoryId')::uuid and p.deleted_at is null)));

update sync_recipe_product_group_links c set deleted_at = now(), updated_at = now()
where c.deleted_at is null and (
  ((c.payload->>'recipeId') ~ '^[0-9a-fA-F-]{36}$' and not exists (
    select 1 from sync_recipes p
    where p.id = (c.payload->>'recipeId')::uuid and p.deleted_at is null))
  or ((c.payload->>'groupId') ~ '^[0-9a-fA-F-]{36}$' and not exists (
    select 1 from sync_category_groups p
    where p.id = (c.payload->>'groupId')::uuid and p.deleted_at is null)));

-- 5) Exact duplicate live portion-preset links (keep oldest) -----------------
with ranked as (
  select l.id,
    row_number() over (
      partition by l.payload->>'portionPresetId', l.payload->>'linkType', l.payload->>'targetId'
      order by l.updated_at asc, l.id asc) as rn
  from sync_portion_preset_links l
  where l.deleted_at is null
    and exists (select 1 from sync_group_portion_presets p
      where p.id = nullif(l.payload->>'portionPresetId', '')::uuid and p.deleted_at is null)
)
update sync_portion_preset_links
set deleted_at = now(), updated_at = now()
where id in (select id from ranked where rn > 1);
