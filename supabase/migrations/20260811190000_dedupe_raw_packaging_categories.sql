-- ניקוי כפילויות קטגוריות ספקים בענן (חומ״ג / אריזות / ניקיון)
-- הדבק ב-Supabase SQL Editor והרץ.
-- משאיר את השורה העתיקה ביותר לכל תפקיד, soft-delete לשאר.

DO $$
DECLARE
  rec record;
  keep_id uuid;
BEGIN
  -- חומרי גלם (כולל «חומרי גלם יבשים»)
  FOR rec IN
    SELECT kitchen_id
    FROM public.sync_supplier_categories
    WHERE deleted_at IS NULL
      AND COALESCE(payload->>'name', '') ~ '^חומרי[[:space:]]*גלם'
    GROUP BY kitchen_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO keep_id
    FROM public.sync_supplier_categories
    WHERE kitchen_id = rec.kitchen_id
      AND deleted_at IS NULL
      AND COALESCE(payload->>'name', '') ~ '^חומרי[[:space:]]*גלם'
    ORDER BY
      CASE WHEN COALESCE(payload->>'name', '') = 'חומרי גלם' THEN 0 ELSE 1 END,
      updated_at ASC,
      id ASC
    LIMIT 1;

    UPDATE public.sync_supplier_categories
    SET
      payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{name}', '"חומרי גלם"'::jsonb),
      updated_at = now()
    WHERE id = keep_id;

    UPDATE public.sync_supplier_categories
    SET deleted_at = now(), updated_at = now()
    WHERE kitchen_id = rec.kitchen_id
      AND deleted_at IS NULL
      AND id <> keep_id
      AND COALESCE(payload->>'name', '') ~ '^חומרי[[:space:]]*גלם';
  END LOOP;

  -- אריזה / אריזות
  FOR rec IN
    SELECT kitchen_id
    FROM public.sync_supplier_categories
    WHERE deleted_at IS NULL
      AND (
        COALESCE((payload->>'isPackaging')::boolean, false) = true
        OR COALESCE(payload->>'name', '') ~ '^אריז'
      )
    GROUP BY kitchen_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO keep_id
    FROM public.sync_supplier_categories
    WHERE kitchen_id = rec.kitchen_id
      AND deleted_at IS NULL
      AND (
        COALESCE((payload->>'isPackaging')::boolean, false) = true
        OR COALESCE(payload->>'name', '') ~ '^אריז'
      )
    ORDER BY
      CASE WHEN COALESCE(payload->>'name', '') = 'אריזות' THEN 0 ELSE 1 END,
      CASE WHEN COALESCE((payload->>'isPackaging')::boolean, false) THEN 0 ELSE 1 END,
      updated_at ASC,
      id ASC
    LIMIT 1;

    UPDATE public.sync_supplier_categories
    SET
      payload = jsonb_set(
        jsonb_set(COALESCE(payload, '{}'::jsonb), '{name}', '"אריזות"'::jsonb),
        '{isPackaging}', 'true'::jsonb
      ),
      updated_at = now()
    WHERE id = keep_id;

    UPDATE public.sync_supplier_categories
    SET deleted_at = now(), updated_at = now()
    WHERE kitchen_id = rec.kitchen_id
      AND deleted_at IS NULL
      AND id <> keep_id
      AND (
        COALESCE((payload->>'isPackaging')::boolean, false) = true
        OR COALESCE(payload->>'name', '') ~ '^אריז'
      );
  END LOOP;

  -- ניקיון
  FOR rec IN
    SELECT kitchen_id
    FROM public.sync_supplier_categories
    WHERE deleted_at IS NULL
      AND (
        COALESCE((payload->>'isCleaning')::boolean, false) = true
        OR COALESCE(payload->>'name', '') ~ 'ניקיון'
      )
    GROUP BY kitchen_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO keep_id
    FROM public.sync_supplier_categories
    WHERE kitchen_id = rec.kitchen_id
      AND deleted_at IS NULL
      AND (
        COALESCE((payload->>'isCleaning')::boolean, false) = true
        OR COALESCE(payload->>'name', '') ~ 'ניקיון'
      )
    ORDER BY
      CASE WHEN COALESCE((payload->>'isCleaning')::boolean, false) THEN 0 ELSE 1 END,
      updated_at ASC,
      id ASC
    LIMIT 1;

    UPDATE public.sync_supplier_categories
    SET
      payload = jsonb_set(
        jsonb_set(COALESCE(payload, '{}'::jsonb), '{name}', '"חומרי ניקיון"'::jsonb),
        '{isCleaning}', 'true'::jsonb
      ),
      updated_at = now()
    WHERE id = keep_id;

    UPDATE public.sync_supplier_categories
    SET deleted_at = now(), updated_at = now()
    WHERE kitchen_id = rec.kitchen_id
      AND deleted_at IS NULL
      AND id <> keep_id
      AND (
        COALESCE((payload->>'isCleaning')::boolean, false) = true
        OR COALESCE(payload->>'name', '') ~ 'ניקיון'
      );
  END LOOP;

  -- ייבוא ממתכונים (כולל וריאציות כתיב)
  FOR rec IN
    SELECT kitchen_id
    FROM public.sync_supplier_categories
    WHERE deleted_at IS NULL
      AND COALESCE(payload->>'name', '') ~ 'יי?בוא'
      AND COALESCE(payload->>'name', '') ~ 'מתכו'
    GROUP BY kitchen_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO keep_id
    FROM public.sync_supplier_categories
    WHERE kitchen_id = rec.kitchen_id
      AND deleted_at IS NULL
      AND COALESCE(payload->>'name', '') ~ 'יי?בוא'
      AND COALESCE(payload->>'name', '') ~ 'מתכו'
    ORDER BY
      CASE WHEN COALESCE(payload->>'name', '') = 'ייבוא ממתכונים' THEN 0 ELSE 1 END,
      updated_at ASC,
      id ASC
    LIMIT 1;

    UPDATE public.sync_supplier_categories
    SET
      payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{name}', '"ייבוא ממתכונים"'::jsonb),
      updated_at = now()
    WHERE id = keep_id;

    UPDATE public.sync_supplier_categories
    SET deleted_at = now(), updated_at = now()
    WHERE kitchen_id = rec.kitchen_id
      AND deleted_at IS NULL
      AND id <> keep_id
      AND COALESCE(payload->>'name', '') ~ 'יי?בוא'
      AND COALESCE(payload->>'name', '') ~ 'מתכו';
  END LOOP;

  -- כפילויות שם מדויק (גם אחרי מיזוג תפקידים)
  FOR rec IN
    SELECT kitchen_id, lower(trim(COALESCE(payload->>'name', ''))) AS nkey
    FROM public.sync_supplier_categories
    WHERE deleted_at IS NULL
      AND trim(COALESCE(payload->>'name', '')) <> ''
    GROUP BY kitchen_id, lower(trim(COALESCE(payload->>'name', '')))
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO keep_id
    FROM public.sync_supplier_categories
    WHERE kitchen_id = rec.kitchen_id
      AND deleted_at IS NULL
      AND lower(trim(COALESCE(payload->>'name', ''))) = rec.nkey
    ORDER BY updated_at ASC, id ASC
    LIMIT 1;

    UPDATE public.sync_supplier_categories
    SET deleted_at = now(), updated_at = now()
    WHERE kitchen_id = rec.kitchen_id
      AND deleted_at IS NULL
      AND id <> keep_id
      AND lower(trim(COALESCE(payload->>'name', ''))) = rec.nkey;
  END LOOP;
END $$;
