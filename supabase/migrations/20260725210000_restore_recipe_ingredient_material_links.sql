-- Restore recipe_ingredient → raw_material links that were nulled during early
-- multi-device sync (FK UUID not yet mapped locally → written as null → pushed).
-- Applied live on 2026-07-25 via MCP.
--
-- Strategy: for live ingredients with empty rawMaterialId, attach the oldest live
-- raw material whose name matches the ingredient name (case/trim insensitive).

UPDATE sync_recipe_ingredients i
SET
  payload = jsonb_set(
    coalesce(i.payload, '{}'::jsonb),
    '{rawMaterialId}',
    to_jsonb(m.id::text),
    true
  ),
  updated_at = now()
FROM (
  SELECT DISTINCT ON (lower(trim(payload->>'name')))
    id, lower(trim(payload->>'name')) AS nkey
  FROM sync_raw_materials
  WHERE deleted_at IS NULL
    AND coalesce(payload->>'name','') <> ''
  ORDER BY lower(trim(payload->>'name')), updated_at ASC, id ASC
) m
WHERE i.deleted_at IS NULL
  AND coalesce(i.payload->>'rawMaterialId','') = ''
  AND lower(trim(i.payload->>'name')) = m.nkey;
