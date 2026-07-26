-- Restore recipe-ingredient material links to their original (pre-sync-migration)
-- state, using the manual JSON backup from 2026-07-02 (app_backups
-- b1348017-3265-405b-920e-8e2a7091eec5) as the source of truth.
--
-- Root cause: cloud dedupe + the name-based link-restore migration relinked
-- some ingredients to a same-name "sibling" material from a different supplier
-- (flour: מזרחי → שטיבל, soy oil: פוליבה → לויאני). This migration relinks each
-- ingredient back to the live material matching the backup's (name, supplier).
--
-- NOT restored (intentionally):
--   * סוכר פוליבה → לויאני: the פוליבה sugar was merged by the user into the
--     לויאני sugar, so the original material no longer exists.
--   * Ingredients whose material simply gained a supplier (ביצים מעורב, תפוחים).
--
-- Already applied via execute_sql on 2026-07-25 (21 rows: 19 flour, 2 oil);
-- kept here for documentation.

with b as (select payload->'data' as d from app_backups where id='b1348017-3265-405b-920e-8e2a7091eec5'),
old_recipes as (select (r->>'id') as rid, r->>'name' as rname from b, jsonb_array_elements(b.d->'recipes') r),
old_mats as (select (m->>'id') as mid, m->>'name' as mname, m->>'supplierId' as sid from b, jsonb_array_elements(b.d->'rawMaterials') m),
old_sups as (select (s->>'id') as sid, s->>'name' as sname from b, jsonb_array_elements(b.d->'suppliers') s),
old_ings as (
  select lower(trim(orc.rname)) as recipe, lower(trim(i->>'name')) as ing, coalesce(i->>'sortOrder','') as so,
         lower(trim(om.mname)) as orig_mat, lower(trim(os.sname)) as orig_supplier
  from b, jsonb_array_elements(b.d->'recipeIngredients') i
  join old_recipes orc on orc.rid = i->>'recipeId'
  join old_mats om on om.mid = i->>'rawMaterialId'
  join old_sups os on os.sid = om.sid
),
targets as (
  select i.id as ing_id, lm.id as new_mat_id
  from sync_recipe_ingredients i
  join sync_recipes r on r.id = (i.payload->>'recipeId')::uuid and r.deleted_at is null
  left join sync_raw_materials cm on cm.id = nullif(i.payload->>'rawMaterialId','')::uuid
  left join sync_suppliers cs on cs.id = nullif(cm.payload->>'supplierId','')::uuid
  join old_ings o on o.recipe = lower(trim(r.payload->>'name'))
    and o.ing = lower(trim(i.payload->>'name'))
    and o.so = coalesce(i.payload->>'sortOrder','')
  join sync_raw_materials lm on lm.deleted_at is null
    and lower(trim(lm.payload->>'name')) = o.orig_mat
  join sync_suppliers ls on ls.id = nullif(lm.payload->>'supplierId','')::uuid
    and lower(trim(ls.payload->>'name')) = o.orig_supplier
  where i.deleted_at is null
    and (coalesce(lower(trim(cm.payload->>'name')),'') <> o.orig_mat
      or coalesce(lower(trim(cs.payload->>'name')),'') <> o.orig_supplier)
)
update sync_recipe_ingredients i
set payload = i.payload || jsonb_build_object('rawMaterialId', t.new_mat_id::text),
    updated_at = now()
from targets t
where i.id = t.ing_id;
