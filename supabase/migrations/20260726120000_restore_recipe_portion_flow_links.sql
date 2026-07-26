-- Restore recipe-portion → flow associations (2026-07-26).
--
-- Custom portionPresetLinks for recipe-sourced portions were corrupted when
-- polymorphic targetIds (local numeric IDs) were remapped to the wrong product /
-- category UUIDs. Those bad custom links override the correct recipe product /
-- category / group links, so portions appeared on the wrong flows (or none).
--
-- Fix: soft-delete all live custom links on recipe-sourced portion presets.
-- Portions then fall back to "default = לפי שיוך מתכון", which uses the intact
-- recipeProductLinks / recipeProductCategoryLinks / recipeProductGroupLinks.

update sync_portion_preset_links l
set deleted_at = now(),
    updated_at = now()
from sync_group_portion_presets p
where l.deleted_at is null
  and p.deleted_at is null
  and nullif(l.payload->>'portionPresetId', '') = p.id::text
  and nullif(p.payload->>'sourceRecipeId', '') is not null;
