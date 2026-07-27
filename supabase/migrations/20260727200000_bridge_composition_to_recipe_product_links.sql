-- Backfill recipe↔product links from product composition rows.
-- Product→recipe associations were saved only in sync_product_recipe_components,
-- so recipes / portions / flow UIs (which read sync_recipe_product_links) looked empty.

insert into sync_recipe_product_links (id, kitchen_id, payload, updated_at, deleted_at, device_id)
select gen_random_uuid(),
       coalesce(c.kitchen_id, 'yitzur'),
       jsonb_build_object(
         'recipeId', c.payload->>'recipeId',
         'productId', c.payload->>'productId'
       ),
       now(),
       null,
       'composition-bridge'
from sync_product_recipe_components c
where c.deleted_at is null
  and coalesce(c.payload->>'recipeId', '') <> ''
  and coalesce(c.payload->>'productId', '') <> ''
  and exists (
    select 1 from sync_recipes r
    where r.deleted_at is null and r.id::text = c.payload->>'recipeId'
  )
  and exists (
    select 1 from sync_products p
    where p.deleted_at is null and p.id::text = c.payload->>'productId'
  )
  and not exists (
    select 1 from sync_recipe_product_links l
    where l.deleted_at is null
      and l.payload->>'recipeId' = c.payload->>'recipeId'
      and l.payload->>'productId' = c.payload->>'productId'
  );
