-- Deduplicate sync_* rows created by multi-device seed (approx 2x copies).
-- Keep earliest updated_at per natural key; soft-delete the rest; remap FK uuids in payloads.

CREATE OR REPLACE FUNCTION public.sync_soft_dedupe_by_name(p_table text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  n int := 0;
BEGIN
  EXECUTE format($q$
    WITH ranked AS (
      SELECT id,
        row_number() OVER (
          PARTITION BY lower(coalesce(payload->>'name',''))
          ORDER BY updated_at ASC, id ASC
        ) AS rn,
        first_value(id) OVER (
          PARTITION BY lower(coalesce(payload->>'name',''))
          ORDER BY updated_at ASC, id ASC
        ) AS keep_id
      FROM public.%I
      WHERE deleted_at IS NULL
        AND coalesce(payload->>'name','') <> ''
    ),
    doomed AS (
      SELECT id AS drop_id, keep_id FROM ranked WHERE rn > 1
    )
    UPDATE public.%I t
    SET deleted_at = now(), updated_at = now()
    FROM doomed d
    WHERE t.id = d.drop_id
    RETURNING 1
  $q$, p_table, p_table);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Remap a uuid FK field inside payload jsonb across a table
CREATE OR REPLACE FUNCTION public.sync_remap_payload_fk(
  p_table text,
  p_field text,
  p_drop uuid,
  p_keep uuid
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format(
    'UPDATE public.%I SET payload = jsonb_set(payload, ARRAY[%L], to_jsonb(%L::text), true), updated_at = now()
     WHERE deleted_at IS NULL AND payload->>%L = %L',
    p_table, p_field, p_keep::text, p_field, p_drop::text
  );
END;
$$;

DO $$
DECLARE
  r record;
  dropped int;
BEGIN
  -- 1) Parents by name
  PERFORM public.sync_soft_dedupe_by_name('sync_category_groups');
  PERFORM public.sync_soft_dedupe_by_name('sync_supplier_categories');
  PERFORM public.sync_soft_dedupe_by_name('sync_baking_profiles');
  PERFORM public.sync_soft_dedupe_by_name('sync_production_machines');
  PERFORM public.sync_soft_dedupe_by_name('sync_recipe_groups');
  PERFORM public.sync_soft_dedupe_by_name('sync_manager_responsibility_areas');
  PERFORM public.sync_soft_dedupe_by_name('sync_manager_departments');
  PERFORM public.sync_soft_dedupe_by_name('sync_department_cleaning_lists');
  PERFORM public.sync_soft_dedupe_by_name('sync_purchase_categories');

  -- Remap category group refs then dedupe categories by name
  FOR r IN
    SELECT d.id AS drop_id,
      (SELECT x.id FROM sync_category_groups x
        WHERE x.deleted_at IS NULL
          AND lower(x.payload->>'name') = lower(d.payload->>'name')
        ORDER BY x.updated_at, x.id LIMIT 1) AS keep_id
    FROM sync_category_groups d
    WHERE d.deleted_at IS NOT NULL
      AND d.deleted_at > now() - interval '1 hour'
  LOOP
    IF r.keep_id IS NULL OR r.keep_id = r.drop_id THEN CONTINUE; END IF;
    PERFORM public.sync_remap_payload_fk('sync_categories', 'groupId', r.drop_id, r.keep_id);
    PERFORM public.sync_remap_payload_fk('sync_flows', 'categoryGroupId', r.drop_id, r.keep_id);
    PERFORM public.sync_remap_payload_fk('sync_recipes', 'linkedProductGroupId', r.drop_id, r.keep_id);
    PERFORM public.sync_remap_payload_fk('sync_recipe_groups', 'linkedCategoryGroupId', r.drop_id, r.keep_id);
  END LOOP;

  PERFORM public.sync_soft_dedupe_by_name('sync_categories');
  PERFORM public.sync_soft_dedupe_by_name('sync_suppliers');
  PERFORM public.sync_soft_dedupe_by_name('sync_recipe_categories');

  -- Remap recently soft-deleted suppliers into live same-name supplier
  FOR r IN
    SELECT d.id AS drop_id,
      (SELECT x.id FROM sync_suppliers x
        WHERE x.deleted_at IS NULL
          AND lower(x.payload->>'name') = lower(d.payload->>'name')
        ORDER BY x.updated_at, x.id LIMIT 1) AS keep_id
    FROM sync_suppliers d
    WHERE d.deleted_at IS NOT NULL
      AND d.deleted_at > now() - interval '1 hour'
  LOOP
    IF r.keep_id IS NULL OR r.keep_id = r.drop_id THEN CONTINUE; END IF;
    PERFORM public.sync_remap_payload_fk('sync_raw_materials', 'supplierId', r.drop_id, r.keep_id);
    PERFORM public.sync_remap_payload_fk('sync_supplier_shortages', 'supplierId', r.drop_id, r.keep_id);
  END LOOP;

  FOR r IN
    SELECT d.id AS drop_id,
      (SELECT x.id FROM sync_categories x
        WHERE x.deleted_at IS NULL
          AND lower(x.payload->>'name') = lower(d.payload->>'name')
        ORDER BY x.updated_at, x.id LIMIT 1) AS keep_id
    FROM sync_categories d
    WHERE d.deleted_at IS NOT NULL
      AND d.deleted_at > now() - interval '1 hour'
  LOOP
    IF r.keep_id IS NULL OR r.keep_id = r.drop_id THEN CONTINUE; END IF;
    PERFORM public.sync_remap_payload_fk('sync_products', 'categoryId', r.drop_id, r.keep_id);
    PERFORM public.sync_remap_payload_fk('sync_flows', 'categoryId', r.drop_id, r.keep_id);
    PERFORM public.sync_remap_payload_fk('sync_process_logs', 'categoryId', r.drop_id, r.keep_id);
  END LOOP;

  FOR r IN
    SELECT d.id AS drop_id,
      (SELECT x.id FROM sync_supplier_categories x
        WHERE x.deleted_at IS NULL
          AND lower(x.payload->>'name') = lower(d.payload->>'name')
        ORDER BY x.updated_at, x.id LIMIT 1) AS keep_id
    FROM sync_supplier_categories d
    WHERE d.deleted_at IS NOT NULL
      AND d.deleted_at > now() - interval '1 hour'
  LOOP
    IF r.keep_id IS NULL OR r.keep_id = r.drop_id THEN CONTINUE; END IF;
    PERFORM public.sync_remap_payload_fk('sync_suppliers', 'categoryId', r.drop_id, r.keep_id);
    PERFORM public.sync_remap_payload_fk('sync_raw_materials', 'supplierCategoryId', r.drop_id, r.keep_id);
  END LOOP;

  -- Materials: by name + supplierId (after remap)
  WITH ranked AS (
    SELECT id,
      row_number() OVER (
        PARTITION BY lower(coalesce(payload->>'name','')), coalesce(payload->>'supplierId','')
        ORDER BY updated_at ASC, id ASC
      ) AS rn
    FROM sync_raw_materials
    WHERE deleted_at IS NULL AND coalesce(payload->>'name','') <> ''
  )
  UPDATE sync_raw_materials t
  SET deleted_at = now(), updated_at = now()
  FROM ranked r
  WHERE t.id = r.id AND r.rn > 1;

  -- Also collapse materials that still differ only by dead supplier uuid: same name, duplicate count
  WITH ranked AS (
    SELECT m.id,
      row_number() OVER (
        PARTITION BY lower(m.payload->>'name'), lower(coalesce(s.payload->>'name',''))
        ORDER BY m.updated_at ASC, m.id ASC
      ) AS rn
    FROM sync_raw_materials m
    LEFT JOIN sync_suppliers s
      ON s.id::text = m.payload->>'supplierId'
    WHERE m.deleted_at IS NULL AND coalesce(m.payload->>'name','') <> ''
  )
  UPDATE sync_raw_materials t
  SET deleted_at = now(), updated_at = now()
  FROM ranked r
  WHERE t.id = r.id AND r.rn > 1;

  PERFORM public.sync_soft_dedupe_by_name('sync_products');
  PERFORM public.sync_soft_dedupe_by_name('sync_recipes');
  PERFORM public.sync_soft_dedupe_by_name('sync_flows');

  -- Remap product / recipe FKs from soft-deleted dups
  FOR r IN
    SELECT d.id AS drop_id,
      (SELECT x.id FROM sync_products x
        WHERE x.deleted_at IS NULL
          AND lower(x.payload->>'name') = lower(d.payload->>'name')
        ORDER BY x.updated_at, x.id LIMIT 1) AS keep_id
    FROM sync_products d
    WHERE d.deleted_at IS NOT NULL AND d.deleted_at > now() - interval '1 hour'
  LOOP
    IF r.keep_id IS NULL OR r.keep_id = r.drop_id THEN CONTINUE; END IF;
    PERFORM public.sync_remap_payload_fk('sync_production_entries', 'productId', r.drop_id, r.keep_id);
    PERFORM public.sync_remap_payload_fk('sync_recipe_product_links', 'productId', r.drop_id, r.keep_id);
    PERFORM public.sync_remap_payload_fk('sync_product_recipe_components', 'productId', r.drop_id, r.keep_id);
  END LOOP;

  FOR r IN
    SELECT d.id AS drop_id,
      (SELECT x.id FROM sync_recipes x
        WHERE x.deleted_at IS NULL
          AND lower(x.payload->>'name') = lower(d.payload->>'name')
        ORDER BY x.updated_at, x.id LIMIT 1) AS keep_id
    FROM sync_recipes d
    WHERE d.deleted_at IS NOT NULL AND d.deleted_at > now() - interval '1 hour'
  LOOP
    IF r.keep_id IS NULL OR r.keep_id = r.drop_id THEN CONTINUE; END IF;
    PERFORM public.sync_remap_payload_fk('sync_recipe_ingredients', 'recipeId', r.drop_id, r.keep_id);
    PERFORM public.sync_remap_payload_fk('sync_recipe_product_links', 'recipeId', r.drop_id, r.keep_id);
    PERFORM public.sync_remap_payload_fk('sync_product_recipe_components', 'recipeId', r.drop_id, r.keep_id);
  END LOOP;

  FOR r IN
    SELECT d.id AS drop_id,
      (SELECT x.id FROM sync_raw_materials x
        WHERE x.deleted_at IS NULL
          AND lower(x.payload->>'name') = lower(d.payload->>'name')
        ORDER BY x.updated_at, x.id LIMIT 1) AS keep_id
    FROM sync_raw_materials d
    WHERE d.deleted_at IS NOT NULL AND d.deleted_at > now() - interval '1 hour'
  LOOP
    IF r.keep_id IS NULL OR r.keep_id = r.drop_id THEN CONTINUE; END IF;
    PERFORM public.sync_remap_payload_fk('sync_recipe_ingredients', 'rawMaterialId', r.drop_id, r.keep_id);
    PERFORM public.sync_remap_payload_fk('sync_raw_material_price_history', 'rawMaterialId', r.drop_id, r.keep_id);
  END LOOP;

  -- Ingredient dups by recipe+name+material
  WITH ranked AS (
    SELECT id,
      row_number() OVER (
        PARTITION BY
          coalesce(payload->>'recipeId',''),
          lower(coalesce(payload->>'name','')),
          coalesce(payload->>'rawMaterialId',''),
          coalesce(payload->>'sortOrder','')
        ORDER BY updated_at ASC, id ASC
      ) AS rn
    FROM sync_recipe_ingredients
    WHERE deleted_at IS NULL
  )
  UPDATE sync_recipe_ingredients t
  SET deleted_at = now(), updated_at = now()
  FROM ranked r
  WHERE t.id = r.id AND r.rn > 1;
END $$;
