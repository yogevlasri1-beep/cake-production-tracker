-- Product composition: portions from raw materials (2026-07-26).
-- Allows linking "marked as portion" raw materials into a product's
-- composition alongside recipes, with an editable weight.

SELECT public.create_kitchen_sync_table('sync_product_portion_components');
