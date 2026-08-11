-- Unique role constraints for packaging / cleaning supplier categories (sync_* payload).
-- הרץ ב-Supabase SQL Editor אחרי ש־v460+ פרוס, ורק אם עדיין יש כפילויות בענן.
--
-- 1) מנקה כפילויות קיימות (משאיר את השורה העתיקה ביותר לכל תפקיד)
-- 2) יוצר אינדקס ייחודי חלקי: קטגוריית ניקיון אחת + קטגוריית אריזה אחת לכל kitchen_id

DO $$
DECLARE
  rec record;
  keep_id uuid;
BEGIN
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
    ORDER BY updated_at ASC, id ASC
    LIMIT 1;

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

  -- אריזה
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
    ORDER BY updated_at ASC, id ASC
    LIMIT 1;

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
END $$;

-- אינדקסים ייחודיים (אחרי ניקוי)
CREATE UNIQUE INDEX IF NOT EXISTS sync_supplier_categories_one_cleaning_per_kitchen
  ON public.sync_supplier_categories (kitchen_id)
  WHERE deleted_at IS NULL
    AND (
      COALESCE((payload->>'isCleaning')::boolean, false) = true
      OR COALESCE(payload->>'name', '') ~ 'ניקיון'
    );

CREATE UNIQUE INDEX IF NOT EXISTS sync_supplier_categories_one_packaging_per_kitchen
  ON public.sync_supplier_categories (kitchen_id)
  WHERE deleted_at IS NULL
    AND (
      COALESCE((payload->>'isPackaging')::boolean, false) = true
      OR COALESCE(payload->>'name', '') ~ '^אריז'
    );
