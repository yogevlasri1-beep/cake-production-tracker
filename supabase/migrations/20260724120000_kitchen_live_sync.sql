-- Live sync tables for cake-production-tracker
-- One Postgres table per Dexie collection. Payload is jsonb (Dexie row without local id).
-- kitchen_id = 'yitzur' (single shared kitchen). RLS allows anon read/write for that kitchen.
-- Conflict policy: last-write-wins via updated_at.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION public.create_kitchen_sync_table(table_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS public.%I (
      id uuid PRIMARY KEY,
      kitchen_id text NOT NULL DEFAULT %L,
      payload jsonb NOT NULL DEFAULT %L::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      device_id text
    )', table_name, 'yitzur', '{}');

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (kitchen_id, updated_at DESC)',
    table_name || '_kitchen_updated_idx',
    table_name
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (kitchen_id) WHERE deleted_at IS NULL',
    table_name || '_kitchen_live_idx',
    table_name
  );

  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_kitchen_all', table_name);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated
       USING (kitchen_id = %L) WITH CHECK (kitchen_id = %L)',
    table_name || '_kitchen_all',
    table_name,
    'yitzur',
    'yitzur'
  );

  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', table_name);

  BEGIN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'sync_category_groups',
    'sync_categories',
    'sync_products',
    'sync_production_entries',
    'sync_targets',
    'sync_process_logs',
    'sync_activity_presets',
    'sync_flows',
    'sync_flow_steps',
    'sync_flow_portion_presets',
    'sync_group_portion_presets',
    'sync_portion_preset_links',
    'sync_portion_preset_ingredient_settings',
    'sync_group_preparations',
    'sync_checklist_tasks',
    'sync_flow_checklist_items',
    'sync_flow_cleaning_tasks',
    'sync_production_runs',
    'sync_run_step_states',
    'sync_product_preparations',
    'sync_run_preparation_checks',
    'sync_run_cleaning_checks',
    'sync_recipe_groups',
    'sync_recipe_categories',
    'sync_recipes',
    'sync_recipe_ingredients',
    'sync_recipe_product_links',
    'sync_recipe_product_category_links',
    'sync_recipe_product_group_links',
    'sync_product_recipe_components',
    'sync_product_flow_links',
    'sync_baking_profiles',
    'sync_baking_profile_products',
    'sync_baking_profile_scopes',
    'sync_production_machines',
    'sync_production_machine_fields',
    'sync_production_machine_products',
    'sync_production_machine_product_values',
    'sync_supplier_categories',
    'sync_suppliers',
    'sync_raw_materials',
    'sync_raw_material_price_history',
    'sync_supplier_shortages',
    'sync_weekly_production_plans',
    'sync_weekly_production_plan_items',
    'sync_manager_plans',
    'sync_manager_plan_items',
    'sync_manager_tasks',
    'sync_manager_incidents',
    'sync_manager_shift_notes',
    'sync_manager_responsibility_areas',
    'sync_manager_employees',
    'sync_manager_departments',
    'sync_department_cleaning_lists',
    'sync_department_cleaning_tasks',
    'sync_purchase_categories',
    'sync_purchase_items',
    'sync_app_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    PERFORM public.create_kitchen_sync_table(t);
  END LOOP;
END $$;

-- Cursor / sync state helper (optional server-side; clients also store locally)
CREATE TABLE IF NOT EXISTS public.sync_kitchen_meta (
  kitchen_id text PRIMARY KEY DEFAULT 'yitzur',
  schema_version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sync_kitchen_meta (kitchen_id, schema_version)
VALUES ('yitzur', 1)
ON CONFLICT (kitchen_id) DO NOTHING;

ALTER TABLE public.sync_kitchen_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_kitchen_meta_all ON public.sync_kitchen_meta;
CREATE POLICY sync_kitchen_meta_all ON public.sync_kitchen_meta FOR ALL TO anon, authenticated
  USING (kitchen_id = 'yitzur') WITH CHECK (kitchen_id = 'yitzur');
GRANT SELECT, INSERT, UPDATE ON public.sync_kitchen_meta TO anon, authenticated;
