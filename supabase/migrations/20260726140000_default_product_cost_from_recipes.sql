-- Default product raw-materials cost source = recipes (2026-07-26).
--
-- App default changed from manual → recipes. Users can still switch a product
-- back to manual entry. This migration flips all live cloud products so other
-- devices pull the new default immediately.

update sync_products
set payload = jsonb_set(
      coalesce(payload, '{}'::jsonb),
      '{rawMaterialsCostSource}',
      '"recipes"'::jsonb
    ),
    updated_at = now()
where deleted_at is null
  and coalesce(payload->>'rawMaterialsCostSource', '') is distinct from 'recipes';
