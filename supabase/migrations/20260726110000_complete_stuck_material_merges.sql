-- Complete "stuck" raw-material merges (2026-07-26).
--
-- The old merge logic kept a material from a different supplier as a separate
-- same-name record ("sibling"). The user expects a merge to leave ONE record,
-- so the app code was changed to always fully merge. This migration completes
-- the three merges the user performed that left sibling pairs behind:
--   קמח:        שטיבל  -> מזרחי   (recipes originally priced by מזרחי)
--   אגוזי מלך:  פוליבה -> לויאני  (לויאני was the chosen merge target)
--   ביצים מעורב: פוליבה -> ביצי צאם (ביצי צאם was the chosen merge target)
--
-- For each pair: retarget recipe ingredients + FK refs to the kept record,
-- move price history (dropping exact duplicates), merge synonyms and the
-- recipe-default flag onto the kept record, then soft-delete the dead record.

create temporary table _mat_merge (dead uuid, keep uuid);
insert into _mat_merge values
  ('90458957-2805-498f-abb5-a192b724fb67', '7ccbd6c8-0937-4535-912f-079efb35fa59'), -- קמח שטיבל -> קמח מזרחי
  ('4b7e193d-e6a7-4cb8-943c-02d05771ac0e', '0689478b-c154-4fce-9b8f-693ab50bad97'), -- אגוזי מלך פוליבה -> לויאני
  ('73c3bd30-efa8-47de-8184-ec30430805dc', 'c592baa6-67a3-4e6e-acfc-eaae11e13092'); -- ביצים מעורב פוליבה -> ביצי צאם

-- 1) Retarget live recipe ingredients to the kept material.
update sync_recipe_ingredients i
set payload = jsonb_set(i.payload, '{rawMaterialId}', to_jsonb(m.keep::text)),
    updated_at = now()
from _mat_merge m
where i.deleted_at is null
  and nullif(i.payload->>'rawMaterialId', '') = m.dead::text;

-- 2a) Drop price-history entries of the dead record that already exist on keep.
update sync_raw_material_price_history h
set deleted_at = now(), updated_at = now()
from _mat_merge m
where h.deleted_at is null
  and nullif(h.payload->>'rawMaterialId', '') = m.dead::text
  and exists (
    select 1 from sync_raw_material_price_history k
    where k.deleted_at is null
      and nullif(k.payload->>'rawMaterialId', '') = m.keep::text
      and k.payload->>'effectiveDate' = h.payload->>'effectiveDate'
      and (k.payload->>'price')::numeric = (h.payload->>'price')::numeric
  );

-- 2b) Move the remaining price history onto the kept record.
update sync_raw_material_price_history h
set payload = jsonb_set(h.payload, '{rawMaterialId}', to_jsonb(m.keep::text)),
    updated_at = now()
from _mat_merge m
where h.deleted_at is null
  and nullif(h.payload->>'rawMaterialId', '') = m.dead::text;

-- 3) Retarget other FK references.
update sync_products p
set payload = jsonb_set(p.payload, '{packagingMaterialId}', to_jsonb(m.keep::text)),
    updated_at = now()
from _mat_merge m
where p.deleted_at is null
  and nullif(p.payload->>'packagingMaterialId', '') = m.dead::text;

update sync_supplier_shortages ss
set payload = jsonb_set(ss.payload, '{rawMaterialId}', to_jsonb(m.keep::text)),
    updated_at = now()
from _mat_merge m
where ss.deleted_at is null
  and nullif(ss.payload->>'rawMaterialId', '') = m.dead::text;

update sync_group_portion_presets gp
set payload = jsonb_set(gp.payload, '{sourceRawMaterialId}', to_jsonb(m.keep::text)),
    updated_at = now()
from _mat_merge m
where gp.deleted_at is null
  and nullif(gp.payload->>'sourceRawMaterialId', '') = m.dead::text;

-- 4) Merge synonyms (+ dead name if different) and recipe-default flag onto keep.
update sync_raw_materials k
set payload = k.payload
  || jsonb_build_object('synonyms', (
       select coalesce(jsonb_agg(distinct s), '[]'::jsonb)
       from (
         select jsonb_array_elements_text(coalesce(k.payload->'synonyms', '[]'::jsonb)) as s
         union
         select jsonb_array_elements_text(coalesce(d.payload->'synonyms', '[]'::jsonb))
         union
         select d.payload->>'name'
         where lower(trim(d.payload->>'name')) <> lower(trim(k.payload->>'name'))
       ) t
       where s is not null and trim(s) <> ''
     ))
  || case when coalesce(d.payload->>'isRecipeDefault', '') = 'true'
          then '{"isRecipeDefault": true}'::jsonb
          else '{}'::jsonb
     end,
    updated_at = now()
from _mat_merge m
join sync_raw_materials d on d.id = m.dead
where k.id = m.keep;

-- 5) Soft-delete the dead records.
update sync_raw_materials d
set deleted_at = now(), updated_at = now()
from _mat_merge m
where d.id = m.dead and d.deleted_at is null;

drop table _mat_merge;
