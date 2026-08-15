-- תיקון FKs אחרי soft-delete של קטגוריות ספקים כפולות
-- מריץ remap של sync_suppliers.categoryId ו-sync_raw_materials.supplierCategoryId
-- מקטגוריות שנמחקו (deleted_at) אל ה-survivor החי לפי תפקיד (חומ״ג / אריזות / ניקיון / ייבוא).
-- דורש את הפונקציה public.sync_remap_payload_fk ממיגרציה קודמת.

DO $$
DECLARE
  r record;
  keep_id uuid;
BEGIN
  -- לכל קטגוריה שנמחקה: מצא survivor חי באותו kitchen + אותו תפקיד, ו-remap
  FOR r IN
    SELECT
      d.id AS drop_id,
      d.kitchen_id,
      COALESCE(d.payload->>'name', '') AS drop_name,
      COALESCE((d.payload->>'isPackaging')::boolean, false) AS drop_pack,
      COALESCE((d.payload->>'isCleaning')::boolean, false) AS drop_clean
    FROM public.sync_supplier_categories d
    WHERE d.deleted_at IS NOT NULL
  LOOP
    keep_id := NULL;

    IF r.drop_clean OR r.drop_name ~ 'ניקיון' THEN
      SELECT id INTO keep_id
      FROM public.sync_supplier_categories
      WHERE kitchen_id = r.kitchen_id
        AND deleted_at IS NULL
        AND (
          COALESCE((payload->>'isCleaning')::boolean, false) = true
          OR COALESCE(payload->>'name', '') ~ 'ניקיון'
        )
      ORDER BY updated_at ASC, id ASC
      LIMIT 1;
    ELSIF r.drop_pack OR r.drop_name ~ '^אריז' THEN
      SELECT id INTO keep_id
      FROM public.sync_supplier_categories
      WHERE kitchen_id = r.kitchen_id
        AND deleted_at IS NULL
        AND (
          COALESCE((payload->>'isPackaging')::boolean, false) = true
          OR COALESCE(payload->>'name', '') ~ '^אריז'
        )
      ORDER BY updated_at ASC, id ASC
      LIMIT 1;
    ELSIF r.drop_name ~ '^חומרי[[:space:]]*גלם' THEN
      SELECT id INTO keep_id
      FROM public.sync_supplier_categories
      WHERE kitchen_id = r.kitchen_id
        AND deleted_at IS NULL
        AND COALESCE(payload->>'name', '') ~ '^חומרי[[:space:]]*גלם'
      ORDER BY
        CASE WHEN COALESCE(payload->>'name', '') = 'חומרי גלם' THEN 0 ELSE 1 END,
        updated_at ASC, id ASC
      LIMIT 1;
    ELSIF r.drop_name ~ 'יי?בוא' AND r.drop_name ~ 'מתכו' THEN
      SELECT id INTO keep_id
      FROM public.sync_supplier_categories
      WHERE kitchen_id = r.kitchen_id
        AND deleted_at IS NULL
        AND COALESCE(payload->>'name', '') ~ 'יי?בוא'
        AND COALESCE(payload->>'name', '') ~ 'מתכו'
      ORDER BY updated_at ASC, id ASC
      LIMIT 1;
    END IF;

    -- fallback: כל קטגוריה חיה באותו kitchen
    IF keep_id IS NULL THEN
      SELECT id INTO keep_id
      FROM public.sync_supplier_categories
      WHERE kitchen_id = r.kitchen_id
        AND deleted_at IS NULL
      ORDER BY updated_at ASC, id ASC
      LIMIT 1;
    END IF;

    IF keep_id IS NOT NULL AND keep_id <> r.drop_id THEN
      PERFORM public.sync_remap_payload_fk('sync_suppliers', 'categoryId', r.drop_id, keep_id);
      PERFORM public.sync_remap_payload_fk('sync_raw_materials', 'supplierCategoryId', r.drop_id, keep_id);
    END IF;
  END LOOP;
END $$;
