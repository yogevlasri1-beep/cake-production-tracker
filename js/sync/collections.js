/** Registry of Dexie collections ↔ Supabase sync_* tables and FK fields. */

export const KITCHEN_ID = 'yitzur';

/** Dexie collection name → cloud table (without schema). */
export const COLLECTION_TABLE = {
  categoryGroups: 'sync_category_groups',
  categories: 'sync_categories',
  products: 'sync_products',
  productionEntries: 'sync_production_entries',
  targets: 'sync_targets',
  processLogs: 'sync_process_logs',
  activityPresets: 'sync_activity_presets',
  flows: 'sync_flows',
  flowSteps: 'sync_flow_steps',
  flowPortionPresets: 'sync_flow_portion_presets',
  groupPortionPresets: 'sync_group_portion_presets',
  portionPresetLinks: 'sync_portion_preset_links',
  portionPresetIngredientSettings: 'sync_portion_preset_ingredient_settings',
  groupPreparations: 'sync_group_preparations',
  checklistTasks: 'sync_checklist_tasks',
  flowChecklistItems: 'sync_flow_checklist_items',
  flowCleaningTasks: 'sync_flow_cleaning_tasks',
  productionRuns: 'sync_production_runs',
  runStepStates: 'sync_run_step_states',
  productPreparations: 'sync_product_preparations',
  runPreparationChecks: 'sync_run_preparation_checks',
  runCleaningChecks: 'sync_run_cleaning_checks',
  recipeGroups: 'sync_recipe_groups',
  recipeCategories: 'sync_recipe_categories',
  recipes: 'sync_recipes',
  recipeIngredients: 'sync_recipe_ingredients',
  recipeProductLinks: 'sync_recipe_product_links',
  recipeProductCategoryLinks: 'sync_recipe_product_category_links',
  recipeProductGroupLinks: 'sync_recipe_product_group_links',
  productRecipeComponents: 'sync_product_recipe_components',
  productFlowLinks: 'sync_product_flow_links',
  bakingProfiles: 'sync_baking_profiles',
  bakingProfileProducts: 'sync_baking_profile_products',
  bakingProfileScopes: 'sync_baking_profile_scopes',
  productionMachines: 'sync_production_machines',
  productionMachineFields: 'sync_production_machine_fields',
  productionMachineProducts: 'sync_production_machine_products',
  productionMachineProductValues: 'sync_production_machine_product_values',
  supplierCategories: 'sync_supplier_categories',
  suppliers: 'sync_suppliers',
  rawMaterials: 'sync_raw_materials',
  rawMaterialPriceHistory: 'sync_raw_material_price_history',
  supplierShortages: 'sync_supplier_shortages',
  weeklyProductionPlans: 'sync_weekly_production_plans',
  weeklyProductionPlanItems: 'sync_weekly_production_plan_items',
  managerPlans: 'sync_manager_plans',
  managerPlanItems: 'sync_manager_plan_items',
  managerTasks: 'sync_manager_tasks',
  managerIncidents: 'sync_manager_incidents',
  managerShiftNotes: 'sync_manager_shift_notes',
  managerResponsibilityAreas: 'sync_manager_responsibility_areas',
  managerEmployees: 'sync_manager_employees',
  managerDepartments: 'sync_manager_departments',
  departmentCleaningLists: 'sync_department_cleaning_lists',
  departmentCleaningTasks: 'sync_department_cleaning_tasks',
  purchaseCategories: 'sync_purchase_categories',
  purchaseItems: 'sync_purchase_items',
  settings: 'sync_app_settings',
};

/** FK field → target collection (numeric local ids remapped to sync UUIDs). */
export const COLLECTION_FKS = {
  categories: { groupId: 'categoryGroups' },
  products: { categoryId: 'categories', packagingMaterialId: 'rawMaterials' },
  productionEntries: { productId: 'products', runId: 'productionRuns' },
  processLogs: { categoryId: 'categories' },
  activityPresets: { categoryId: 'categories' },
  flows: { categoryId: 'categories', categoryGroupId: 'categoryGroups' },
  flowSteps: { flowId: 'flows', categoryId: 'categories', categoryGroupId: 'categoryGroups' },
  flowPortionPresets: { flowId: 'flows' },
  groupPortionPresets: {
    categoryGroupId: 'categoryGroups',
    sourceRecipeId: 'recipes',
    sourceRawMaterialId: 'rawMaterials',
    linkProductId: 'products',
    linkCategoryId: 'categories',
    linkCategoryGroupId: 'categoryGroups',
  },
  portionPresetLinks: { portionPresetId: 'groupPortionPresets' },
  portionPresetIngredientSettings: {
    portionPresetId: 'groupPortionPresets',
    recipeIngredientId: 'recipeIngredients',
  },
  groupPreparations: { categoryGroupId: 'categoryGroups', categoryId: 'categories' },
  checklistTasks: { categoryGroupId: 'categoryGroups', categoryId: 'categories' },
  flowChecklistItems: { flowId: 'flows', checklistTaskId: 'checklistTasks' },
  flowCleaningTasks: { flowId: 'flows' },
  productionRuns: { categoryId: 'categories', productId: 'products', flowId: 'flows' },
  runStepStates: { runId: 'productionRuns' },
  productPreparations: { productId: 'products' },
  runPreparationChecks: { runId: 'productionRuns', flowPreparationId: 'groupPreparations' },
  runCleaningChecks: { runId: 'productionRuns', flowCleaningTaskId: 'flowCleaningTasks' },
  recipeGroups: { linkedCategoryGroupId: 'categoryGroups' },
  recipeCategories: { groupId: 'recipeGroups', linkedCategoryId: 'categories' },
  recipes: {
    categoryId: 'recipeCategories',
    parentRecipeId: 'recipes',
    linkedProductId: 'products',
    linkedProductCategoryId: 'categories',
    linkedProductGroupId: 'categoryGroups',
    bakingProfileId: 'bakingProfiles',
  },
  recipeIngredients: { recipeId: 'recipes', rawMaterialId: 'rawMaterials' },
  recipeProductLinks: { recipeId: 'recipes', productId: 'products' },
  recipeProductCategoryLinks: { recipeId: 'recipes', categoryId: 'categories' },
  recipeProductGroupLinks: { recipeId: 'recipes', groupId: 'categoryGroups' },
  productRecipeComponents: { productId: 'products', recipeId: 'recipes' },
  productFlowLinks: { productId: 'products', flowId: 'flows' },
  bakingProfileProducts: { bakingProfileId: 'bakingProfiles', productId: 'products' },
  bakingProfileScopes: { bakingProfileId: 'bakingProfiles' },
  productionMachineFields: { machineId: 'productionMachines' },
  productionMachineProducts: {
    machineId: 'productionMachines',
    productId: 'products',
    categoryId: 'categories',
    categoryGroupId: 'categoryGroups',
    recipeId: 'recipes',
  },
  productionMachineProductValues: {
    assignmentId: 'productionMachineProducts',
    fieldId: 'productionMachineFields',
  },
  suppliers: { categoryId: 'supplierCategories' },
  rawMaterials: {
    supplierCategoryId: 'supplierCategories',
    supplierId: 'suppliers',
    packLinkedProductId: 'products',
    packLinkedCategoryId: 'categories',
    portionProductId: 'products',
  },
  rawMaterialPriceHistory: { rawMaterialId: 'rawMaterials' },
  supplierShortages: { supplierId: 'suppliers', rawMaterialId: 'rawMaterials' },
  weeklyProductionPlanItems: { planId: 'weeklyProductionPlans', productId: 'products' },
  managerEmployees: { responsibilityAreaId: 'managerResponsibilityAreas' },
  departmentCleaningTasks: { listId: 'departmentCleaningLists' },
  purchaseItems: { categoryId: 'purchaseCategories' },
};

/**
 * Push / seed order (parents before children).
 * Collections not listed are appended at the end.
 */
export const SYNC_ORDER = [
  'categoryGroups',
  'categories',
  'supplierCategories',
  'suppliers',
  'bakingProfiles',
  'productionMachines',
  'recipeGroups',
  'recipeCategories',
  'rawMaterials',
  'products',
  'recipes',
  'recipeIngredients',
  'rawMaterialPriceHistory',
  'supplierShortages',
  'flows',
  'flowSteps',
  'flowPortionPresets',
  'flowCleaningTasks',
  'groupPreparations',
  'checklistTasks',
  'flowChecklistItems',
  'groupPortionPresets',
  'portionPresetLinks',
  'portionPresetIngredientSettings',
  'productPreparations',
  'activityPresets',
  'targets',
  'processLogs',
  'recipeProductLinks',
  'recipeProductCategoryLinks',
  'recipeProductGroupLinks',
  'productRecipeComponents',
  'productFlowLinks',
  'bakingProfileProducts',
  'bakingProfileScopes',
  'productionMachineFields',
  'productionMachineProducts',
  'productionMachineProductValues',
  'weeklyProductionPlans',
  'weeklyProductionPlanItems',
  'productionRuns',
  'runStepStates',
  'runPreparationChecks',
  'runCleaningChecks',
  'productionEntries',
  'managerResponsibilityAreas',
  'managerDepartments',
  'managerEmployees',
  'managerPlans',
  'managerPlanItems',
  'managerTasks',
  'managerIncidents',
  'managerShiftNotes',
  'departmentCleaningLists',
  'departmentCleaningTasks',
  'purchaseCategories',
  'purchaseItems',
  'settings',
];

export function orderedCollections() {
  const all = Object.keys(COLLECTION_TABLE);
  const seen = new Set();
  const out = [];
  for (const c of SYNC_ORDER) {
    if (COLLECTION_TABLE[c] && !seen.has(c)) {
      out.push(c);
      seen.add(c);
    }
  }
  for (const c of all) {
    if (!seen.has(c)) out.push(c);
  }
  return out;
}

export function isSyncCollection(name) {
  return Object.prototype.hasOwnProperty.call(COLLECTION_TABLE, name);
}

export function newSyncId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Pure last-write-wins: return true if remote should replace local. */
export function shouldApplyRemote(localUpdatedAt, remoteUpdatedAt) {
  const l = localUpdatedAt ? Date.parse(localUpdatedAt) : 0;
  const r = remoteUpdatedAt ? Date.parse(remoteUpdatedAt) : 0;
  if (Number.isNaN(r)) return false;
  if (Number.isNaN(l) || !localUpdatedAt) return true;
  return r >= l;
}
