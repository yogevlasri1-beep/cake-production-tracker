-- Repair stored product raw-material costs after recipe-cost mode was enabled.
--
-- The old update path copied the price of a full linked recipe into the
-- product, ignoring the component weight and other recipes in its composition.
-- Recalculate every recipe-priced product from its actual composition. Recipe
-- totals include "add-on after preparation" child recipes.

with recipe_family as (
  select r.id::text as recipe_id,
         coalesce(nullif(r.payload->>'parentRecipeId', ''), r.id::text) as costing_recipe_id
  from sync_recipes r
  where r.deleted_at is null
),
ingredient_costs as (
  select rf.costing_recipe_id as recipe_id,
         case
           when coalesce(i.payload->>'unitKind', '') = 'g'
             or i.payload->>'unit' = 'גרם'
             then coalesce((i.payload->>'quantity')::numeric, 0)
           else coalesce((i.payload->>'quantity')::numeric, 0) * 1000
         end as weight_g,
         case
           when coalesce(
             i.payload->>'priceSource',
             case when nullif(i.payload->>'rawMaterialId', '') is not null
               then 'supplier' else 'max' end
           ) <> 'supplier' then 0
           when coalesce(i.payload->>'unitKind', '') = 'g'
             or i.payload->>'unit' = 'גרם' then
               coalesce((i.payload->>'quantity')::numeric, 0) / 1000
               * case
                   when coalesce((m.payload->>'processedPricePerKg')::numeric, 0) > 0
                     then (m.payload->>'processedPricePerKg')::numeric
                   when coalesce((m.payload->>'packageWeightGrams')::numeric, 0) > 0
                     then coalesce((m.payload->>'unitPrice')::numeric, 0)
                       / ((m.payload->>'packageWeightGrams')::numeric / 1000)
                   else coalesce((m.payload->>'unitPrice')::numeric, 0)
                 end
           when coalesce(i.payload->>'unitKind', '') = 'kg' then
               coalesce((i.payload->>'quantity')::numeric, 0)
               * case
                   when coalesce((m.payload->>'processedPricePerKg')::numeric, 0) > 0
                     then (m.payload->>'processedPricePerKg')::numeric
                   when coalesce((m.payload->>'packageWeightGrams')::numeric, 0) > 0
                     then coalesce((m.payload->>'unitPrice')::numeric, 0)
                       / ((m.payload->>'packageWeightGrams')::numeric / 1000)
                   else coalesce((m.payload->>'unitPrice')::numeric, 0)
                 end
           else coalesce((i.payload->>'quantity')::numeric, 0)
             * coalesce((m.payload->>'unitPrice')::numeric, 0)
         end as supplier_cost
  from sync_recipe_ingredients i
  join recipe_family rf
    on rf.recipe_id = nullif(i.payload->>'recipeId', '')
  left join sync_raw_materials m
    on m.id::text = nullif(i.payload->>'rawMaterialId', '')
   and m.deleted_at is null
  where i.deleted_at is null
),
recipe_totals as (
  select recipe_id,
         sum(weight_g) as total_g,
         sum(supplier_cost) as supplier_cost
  from ingredient_costs
  group by recipe_id
),
product_calc as (
  select c.payload->>'productId' as product_id,
         round(sum(
           rt.supplier_cost
           * case
               when coalesce((c.payload->>'weightGrams')::numeric, 0) > 0
                 and rt.total_g > 0
                 then (c.payload->>'weightGrams')::numeric / rt.total_g
               else 1
             end
         ), 3) as calculated_cost
  from sync_product_recipe_components c
  join recipe_totals rt
    on rt.recipe_id = c.payload->>'recipeId'
  where c.deleted_at is null
  group by c.payload->>'productId'
)
update sync_products p
set payload = jsonb_set(
      coalesce(p.payload, '{}'::jsonb),
      '{rawMaterialsCost}',
      to_jsonb(coalesce(pc.calculated_cost, 0))
    ),
    updated_at = now()
from product_calc pc
where p.deleted_at is null
  and p.id::text = pc.product_id
  and coalesce(p.payload->>'rawMaterialsCostSource', 'recipes') = 'recipes'
  and abs(
    coalesce((p.payload->>'rawMaterialsCost')::numeric, 0)
    - coalesce(pc.calculated_cost, 0)
  ) > 0.001;
