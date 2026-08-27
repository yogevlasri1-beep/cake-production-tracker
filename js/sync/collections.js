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
  recipeVersions: 'sync_recipe_versions',
  recipeIngredients: 'sync_recipe_ingredients',
  recipeProductLinks: 'sync_recipe_product_links',
  recipeProductCategoryLinks: 'sync_recipe_product_category_links',
  recipeProductGroupLinks: 'sync_recipe_product_group_links',
  productRecipeComponents: 'sync_product_recipe_components',
  productPortionComponents: 'sync_product_portion_components',
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
  inventoryBalances: 'sync_inventory_balances',
  inventoryMovements: 'sync_inventory_movements',
  activeLots: 'sync_active_lots',
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
  haccpTeamMembers: 'sync_haccp_team_members',
  haccpPlans: 'sync_haccp_plans',
  haccpProductDescriptions: 'sync_haccp_product_descriptions',
  haccpIntendedUses: 'sync_haccp_intended_uses',
  haccpFlowSteps: 'sync_haccp_flow_steps',
  haccpFlowVerifications: 'sync_haccp_flow_verifications',
  haccpHazards: 'sync_haccp_hazards',
  haccpCcps: 'sync_haccp_ccps',
  haccpCriticalLimits: 'sync_haccp_critical_limits',
  haccpMonitoring: 'sync_haccp_monitoring',
  haccpCorrectiveActions: 'sync_haccp_corrective_actions',
  haccpVerificationProcs: 'sync_haccp_verification_procs',
  haccpDocuments: 'sync_haccp_documents',
  haccpPrpControls: 'sync_haccp_prp_controls',
  haccpMonitoringLogs: 'sync_haccp_monitoring_logs',
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
  // flowPreparationId stores checklistTasks.id (legacy name kept for compatibility)
  runPreparationChecks: { runId: 'productionRuns', flowPreparationId: 'checklistTasks' },
  runCleaningChecks: { runId: 'productionRuns', flowCleaningTaskId: 'flowCleaningTasks' },
  managerPlanItems: {
    flowId: 'flows',
    flowPreparationId: 'checklistTasks',
    flowCleaningTaskId: 'flowCleaningTasks',
    flowStepId: 'flowSteps',
    productId: 'products',
    categoryId: 'categories',
    categoryGroupId: 'categoryGroups',
    employeeId: 'managerEmployees',
  },
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
  recipeVersions: { recipeId: 'recipes' },
  recipeIngredients: { recipeId: 'recipes', recipeVersionId: 'recipeVersions', rawMaterialId: 'rawMaterials' },
  recipeProductLinks: { recipeId: 'recipes', productId: 'products' },
  recipeProductCategoryLinks: { recipeId: 'recipes', categoryId: 'categories' },
  recipeProductGroupLinks: { recipeId: 'recipes', groupId: 'categoryGroups' },
  productRecipeComponents: { productId: 'products', recipeId: 'recipes' },
  productPortionComponents: { productId: 'products', rawMaterialId: 'rawMaterials' },
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
  inventoryBalances: { rawMaterialId: 'rawMaterials' },
  inventoryMovements: { rawMaterialId: 'rawMaterials' },
  activeLots: { rawMaterialId: 'rawMaterials' },
  supplierShortages: { supplierId: 'suppliers', rawMaterialId: 'rawMaterials' },
  weeklyProductionPlanItems: { planId: 'weeklyProductionPlans', productId: 'products' },
  managerEmployees: { responsibilityAreaId: 'managerResponsibilityAreas' },
  departmentCleaningTasks: { listId: 'departmentCleaningLists' },
  purchaseItems: { categoryId: 'purchaseCategories' },
  haccpPlans: { categoryGroupId: 'categoryGroups' },
  haccpProductDescriptions: { planId: 'haccpPlans' },
  haccpIntendedUses: { planId: 'haccpPlans' },
  haccpFlowSteps: { planId: 'haccpPlans' },
  haccpFlowVerifications: { planId: 'haccpPlans' },
  haccpHazards: { planId: 'haccpPlans', flowStepId: 'haccpFlowSteps' },
  haccpCcps: { planId: 'haccpPlans', flowStepId: 'haccpFlowSteps', hazardId: 'haccpHazards' },
  haccpCriticalLimits: { planId: 'haccpPlans', ccpId: 'haccpCcps' },
  haccpMonitoring: { planId: 'haccpPlans', ccpId: 'haccpCcps', limitId: 'haccpCriticalLimits' },
  haccpCorrectiveActions: { planId: 'haccpPlans', ccpId: 'haccpCcps', limitId: 'haccpCriticalLimits' },
  haccpVerificationProcs: { planId: 'haccpPlans', ccpId: 'haccpCcps' },
  haccpDocuments: { planId: 'haccpPlans' },
  haccpPrpControls: { planId: 'haccpPlans' },
  haccpMonitoringLogs: { planId: 'haccpPlans', ccpId: 'haccpCcps', monitoringId: 'haccpMonitoring', limitId: 'haccpCriticalLimits' },
};

/**
 * Array FK fields: a field holding an array of local ids pointing at one
 * target collection. Each entry is remapped to/from a sync UUID individually.
 */
export const ARRAY_FKS = {
  rawMaterials: { portionProductIds: 'products' },
  haccpFlowVerifications: { verifierMemberIds: 'haccpTeamMembers' },
  // Remapped on the deferred second pull pass (entries are synced after steps).
  runStepStates: { productionEntryIds: 'productionEntries' },
};

/**
 * Polymorphic FK fields: the target collection depends on a sibling type field.
 * These cannot live in COLLECTION_FKS (fixed target), so the id-map remaps them
 * separately using the row's type value.
 */
export const POLYMORPHIC_FKS = {
  portionPresetLinks: {
    idField: 'targetId',
    typeField: 'linkType',
    targets: { product: 'products', category: 'categories', group: 'categoryGroups' },
  },
  bakingProfileScopes: {
    idField: 'scopeId',
    typeField: 'scopeType',
    targets: { product: 'products', category: 'categories', group: 'categoryGroups' },
  },
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
  'recipeVersions',
  'recipeIngredients',
  'rawMaterialPriceHistory',
  'inventoryBalances',
  'inventoryMovements',
  'activeLots',
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
  'productPortionComponents',
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
  'haccpTeamMembers',
  'haccpPlans',
  'haccpProductDescriptions',
  'haccpIntendedUses',
  'haccpFlowSteps',
  'haccpFlowVerifications',
  'haccpHazards',
  'haccpCcps',
  'haccpCriticalLimits',
  'haccpMonitoring',
  'haccpCorrectiveActions',
  'haccpVerificationProcs',
  'haccpDocuments',
  'haccpPrpControls',
  'haccpMonitoringLogs',
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

function normName(s) {
  return String(s || '').trim().toLocaleLowerCase('he');
}

/**
 * תפקיד קטגוריית ספק למיזוג כפילויות בין מכשירים —
 * גם כשהשם לא זהה בין מכשירים ("אריזה" מול "אריזות", "חומרי גלם" מול "חומרי גלם יבשים").
 * null = קטגוריה ייעודית (חלב/ירקות/אחר) — מתמזגת רק לפי שם מדויק.
 */
export function supplierCategoryRoleKey(cat) {
  if (!cat) return null;
  const name = String(cat.name || '').trim();
  if (cat.isCleaning || /ניקיון/.test(name)) return 'cleaning';
  if (cat.isPackaging || /^אריז/.test(name)) return 'packaging';
  // seed «חומרי גלם יבשים» מול הקטגוריה האמיתית «חומרי גלם»
  if (/^חומרי\s*גלם/.test(name)) return 'raw';
  // ייבוא ממתכונים / יבוא ממתכון — אותה קטגוריה לוגיקה
  // «מתכון» (ן סופית) ו«מתכונים» (נ רגילה) — מספיק הקידומת מתכו
  if (/יי?בוא/.test(name) && /מתכו/.test(name)) return 'import';
  return null;
}

/** שם קנוני לתצוגה אחרי מיזוג תפקיד */
export function supplierCategoryCanonicalName(role) {
  if (role === 'cleaning') return 'חומרי ניקיון';
  if (role === 'packaging') return 'אריזות';
  if (role === 'raw') return 'חומרי גלם';
  if (role === 'import') return 'ייבוא ממתכונים';
  return null;
}

/**
 * Fingerprint for dedupe / match. Uses name + FK ids as stored on the row
 * (local numeric or sync UUID — compare only within the same id-space).
 */
export function rowFingerprint(collection, row) {
  if (!row) return '';
  const n = normName(row.name);
  switch (collection) {
    case 'settings':
      return row.key ? `settings|${row.key}` : '';
    case 'categoryGroups':
    case 'supplierCategories':
    case 'bakingProfiles':
    case 'productionMachines':
    case 'recipeGroups':
    case 'managerResponsibilityAreas':
    case 'managerDepartments':
    case 'departmentCleaningLists':
    case 'purchaseCategories':
    case 'weeklyProductionPlans':
      return n ? `${collection}|${n}` : (row.weekStart ? `${collection}|${row.weekStart}` : '');
    case 'categories':
      return n ? `${collection}|${n}|${row.groupId ?? ''}` : '';
    case 'products':
      return n ? `${collection}|${n}|${row.categoryId ?? ''}` : '';
    case 'suppliers':
      return n ? `${collection}|${n}|${row.categoryId != null && row.categoryId !== '' ? Number(row.categoryId) : ''}` : '';
    case 'rawMaterials':
      return n ? `${collection}|${n}|${row.supplierId != null && row.supplierId !== '' ? Number(row.supplierId) : ''}|${row.supplierCategoryId != null && row.supplierCategoryId !== '' ? Number(row.supplierCategoryId) : ''}` : '';
    case 'recipes':
      return n ? `${collection}|${n}|${row.categoryId ?? ''}|${row.parentRecipeId ?? ''}` : '';
    case 'recipeVersions':
      return `${collection}|${row.recipeId ?? ''}|${n}|${row.sortOrder ?? ''}`;
    case 'recipeCategories':
      return n ? `${collection}|${n}|${row.groupId ?? ''}` : '';
    case 'recipeIngredients':
      // Include version + rawMaterialId so versions/suppliers don't collapse into one row.
      return `${collection}|${row.recipeId ?? ''}|${row.recipeVersionId ?? ''}|${n}|${row.rawMaterialId ?? ''}|${row.sortOrder ?? ''}`;
    case 'portionPresetLinks':
      return row.portionPresetId != null
        ? `${collection}|${row.portionPresetId}|${row.linkType ?? ''}|${row.targetId ?? ''}`
        : '';
    case 'portionPresetIngredientSettings':
      return row.portionPresetId != null
        ? `${collection}|${row.portionPresetId}|${row.recipeIngredientId ?? ''}`
        : '';
    case 'bakingProfileScopes':
      return row.bakingProfileId != null
        ? `${collection}|${row.bakingProfileId}|${row.scopeType ?? ''}|${row.scopeId ?? ''}`
        : '';
    case 'productionEntries':
      return `${collection}|${row.date ?? ''}|${Number(row.productId) || row.productId || ''}|${Number(row.runId) || row.runId || ''}|${row.isWaste ? '1' : '0'}`;
    case 'productionRuns':
      // startedAt keeps two same-day / same-flow / same-batch runs from collapsing
      // into one "active" ghost after reconnect.
      return row.date
        ? `${collection}|${row.date}|${row.batchNumber ?? ''}|${Number(row.flowId) || row.flowId || ''}|${row.startedAt ?? ''}`
        : '';
    case 'runStepStates':
      return row.runId != null
        ? `${collection}|${row.runId}|${row.stepIndex ?? ''}`
        : '';
    case 'runPreparationChecks':
      return row.runId != null
        ? `${collection}|${row.runId}|${row.flowPreparationId ?? ''}`
        : '';
    case 'runCleaningChecks':
      return row.runId != null
        ? `${collection}|${row.runId}|${row.flowCleaningTaskId ?? ''}`
        : '';
    case 'rawMaterialPriceHistory':
      return `${collection}|${row.rawMaterialId ?? ''}|${row.effectiveDate ?? ''}|${row.price ?? ''}`;
    case 'recipeProductLinks':
      return `${collection}|${row.recipeId}|${row.productId}`;
    case 'recipeProductCategoryLinks':
      return `${collection}|${row.recipeId}|${row.categoryId}`;
    case 'recipeProductGroupLinks':
      return `${collection}|${row.recipeId}|${row.groupId}`;
    case 'productRecipeComponents':
      return `${collection}|${row.productId}|${row.recipeId}`;
    case 'productPortionComponents':
      return `${collection}|${row.productId}|${row.rawMaterialId}`;
    case 'productFlowLinks':
      return `${collection}|${Number(row.productId) || ''}|${Number(row.flowId) || ''}`;
    case 'flowSteps':
      return `${collection}|${row.flowId}|${row.sortOrder ?? ''}|${n}`;
    case 'flows':
      return n ? `${collection}|${n}|${row.categoryId ?? ''}|${row.categoryGroupId ?? ''}` : '';
    case 'targets':
      return row.scope ? `${collection}|${row.scope}|${row.scopeId ?? ''}|${row.period ?? ''}` : '';
    case 'processLogs':
      return row.date ? `${collection}|${row.date}|${row.categoryId ?? ''}|${normName(row.activity)}` : '';
    case 'activityPresets':
      return n ? `${collection}|${n}|${row.categoryId ?? ''}` : '';
    case 'flowPortionPresets':
      return row.flowId != null ? `${collection}|${row.flowId}|${n}|${row.sortOrder ?? ''}` : '';
    case 'groupPortionPresets':
      return n
        ? `${collection}|${n}|${row.categoryGroupId ?? ''}|${row.sourceRecipeId ?? ''}|${row.sourceRawMaterialId ?? ''}`
        : '';
    case 'groupPreparations':
    case 'checklistTasks':
      return n ? `${collection}|${n}|${row.categoryGroupId ?? ''}|${row.categoryId ?? ''}` : '';
    case 'flowChecklistItems':
      return row.flowId != null ? `${collection}|${row.flowId}|${row.checklistTaskId ?? ''}` : '';
    case 'flowCleaningTasks':
      return row.flowId != null ? `${collection}|${row.flowId}|${n}` : '';
    case 'productPreparations':
      return row.productId != null ? `${collection}|${row.productId}|${n}` : '';
    case 'bakingProfileProducts':
      return row.bakingProfileId != null
        ? `${collection}|${row.bakingProfileId}|${row.productId ?? ''}`
        : '';
    case 'productionMachineFields':
      return row.machineId != null ? `${collection}|${row.machineId}|${n}` : '';
    case 'productionMachineProducts':
      return row.machineId != null
        ? `${collection}|${row.machineId}|${row.targetType ?? ''}|${row.productId ?? ''}|${row.categoryId ?? ''}|${row.categoryGroupId ?? ''}|${row.recipeId ?? ''}`
        : '';
    case 'productionMachineProductValues':
      return row.assignmentId != null ? `${collection}|${row.assignmentId}|${row.fieldId ?? ''}` : '';
    case 'supplierShortages':
      return row.rawMaterialId != null
        ? `${collection}|${row.supplierId ?? ''}|${row.rawMaterialId}`
        : '';
    case 'inventoryBalances':
      return row.rawMaterialId != null ? `${collection}|${row.rawMaterialId}` : '';
    case 'inventoryMovements':
      return row.at
        ? `${collection}|${row.rawMaterialId ?? ''}|${row.at}|${row.delta ?? ''}|${row.kind ?? ''}`
        : '';
    case 'activeLots':
      return row.packagingBatchNumber
        ? `${collection}|${row.rawMaterialId ?? ''}|${normName(row.packagingBatchNumber)}|${row.receivedAt ?? ''}`
        : '';
    case 'weeklyProductionPlanItems':
      return row.planId != null ? `${collection}|${row.planId}|${row.productId ?? ''}` : '';
    case 'managerPlans':
      return row.planType ? `${collection}|${row.planType}|${row.anchorDate ?? ''}` : '';
    // Manager rows carry free text under title/label rather than name, so the
    // name-only default left them without any fingerprint at all — the reason a
    // reset could push them to the cloud a second time.
    case 'managerPlanItems':
      return row.planType
        ? `${collection}|${row.planType}|${row.anchorDate ?? ''}|${row.dayOffset ?? ''}|${row.itemKind ?? ''}|${normName(row.label)}`
        : '';
    case 'managerTasks':
    case 'managerIncidents':
      return row.createdAt
        ? `${collection}|${row.createdAt}|${row.department ?? ''}|${normName(row.title)}`
        : '';
    case 'managerShiftNotes':
      return row.createdAt
        ? `${collection}|${row.createdAt}|${row.date ?? ''}|${row.department ?? ''}`
        : '';
    case 'managerEmployees':
      return n ? `${collection}|${n}|${row.responsibilityAreaId ?? ''}` : '';
    case 'departmentCleaningTasks':
      return row.listId != null ? `${collection}|${row.listId}|${n}` : '';
    case 'purchaseItems':
      return n ? `${collection}|${n}|${row.categoryId ?? ''}` : '';
    case 'haccpTeamMembers':
      return n ? `${collection}|${n}|${row.role ?? ''}` : '';
    case 'haccpPlans':
      return n ? `${collection}|${n}|${row.categoryGroupId ?? ''}` : '';
    case 'haccpProductDescriptions':
      return row.planId != null ? `${collection}|${row.planId}` : '';
    case 'haccpIntendedUses':
      return row.planId != null ? `${collection}|${row.planId}` : '';
    case 'haccpFlowSteps':
      return row.planId != null
        ? `${collection}|${row.planId}|${n}|${row.sortOrder ?? ''}`
        : '';
    case 'haccpFlowVerifications':
      return row.planId != null
        ? `${collection}|${row.planId}|${row.verifiedAt ?? ''}|${row.matchResult ?? ''}|${row.createdAt ?? ''}`
        : '';
    case 'haccpHazards':
      return row.planId != null
        ? `${collection}|${row.planId}|${row.flowStepId ?? ''}|${normName(row.description)}|${row.hazardType ?? ''}`
        : '';
    case 'haccpCcps':
      return row.planId != null
        ? `${collection}|${row.planId}|${row.flowStepId ?? ''}|${row.code || n}|${row.decision ?? ''}|${row.hazardId ?? ''}`
        : '';
    case 'haccpCriticalLimits':
      return row.planId != null
        ? `${collection}|${row.planId}|${row.ccpId ?? ''}|${row.parameter ?? ''}|${row.operator ?? ''}|${row.value ?? ''}|${row.valueText ?? ''}`
        : '';
    case 'haccpMonitoring':
      return row.planId != null
        ? `${collection}|${row.planId}|${row.ccpId ?? ''}|${row.limitId ?? ''}|${normName(row.what)}|${row.method ?? ''}|${row.frequency ?? ''}`
        : '';
    case 'haccpCorrectiveActions':
      return row.planId != null
        ? `${collection}|${row.planId}|${row.ccpId ?? ''}|${row.limitId ?? ''}|${normName(row.deviation)}|${normName(row.immediateAction)}|${row.productDisposition ?? ''}`
        : '';
    case 'haccpVerificationProcs':
      return row.planId != null
        ? `${collection}|${row.planId}|${row.ccpId ?? ''}|${row.method ?? ''}|${normName(row.activity)}|${row.frequency ?? ''}`
        : '';
    case 'haccpDocuments':
      return row.planId != null
        ? `${collection}|${row.planId}|${row.docKind ?? ''}|${normName(row.title)}|${row.retentionYears ?? ''}`
        : '';
    case 'haccpPrpControls':
      return row.planId != null
        ? `${collection}|${row.planId}|${row.topicId ?? ''}|${row.status ?? ''}|${normName(row.procedureSummary)}`
        : '';
    case 'haccpMonitoringLogs':
      return row.planId != null
        ? `${collection}|${row.planId}|${row.ccpId ?? ''}|${row.recordedAt ?? ''}|${row.result ?? ''}|${normName(row.value)}|${normName(row.batchCode)}`
        : '';
    default:
      return n ? `${collection}|${n}` : '';
  }
}

/**
 * Looser fingerprint used only by local/cloud dedupe. For recipe ingredients,
 * two copies of the same line that differ only in linked material are treated
 * as duplicates (post-merge bug); pull-match still uses rowFingerprint.
 * For production entries, keep runId so two runs of the same product/qty/date
 * are not deleted. Null-run twins are collapsed separately via
 * rowProductionEntryTwinFingerprint.
 */
export function rowDedupeFingerprint(collection, row) {
  if (!row) return '';
  if (collection === 'recipeIngredients') {
    const n = normName(row.name);
    return `${collection}|${row.recipeId ?? ''}|${row.recipeVersionId ?? ''}|${n}|${row.sortOrder ?? ''}`;
  }
  if (collection === 'productionEntries') {
    const date = row.date ?? '';
    const pid = Number(row.productId) || row.productId || '';
    const qtyNum = Number(row.quantity);
    const qty = Number.isFinite(qtyNum) ? String(qtyNum) : String(row.quantity ?? '');
    const runKey = row.runId != null && row.runId !== ''
      ? String(Number(row.runId) || row.runId)
      : 'norun';
    return date && pid !== '' ? `${collection}|${date}|${pid}|${qty}|${row.isWaste ? '1' : '0'}|${runKey}` : '';
  }
  // חומרי גלם: אותו שם+ספק = כפילות גם תחת קטגוריות שונות
  // (seed «חומרי גלם יבשים» מול «חומרי גלם» אמיתי — מחיר על הכפילות לא נראה בראשי)
  // בלי ספק — כוללים קטגוריה כדי לא למזג שני פריטים שונים באותו שם.
  if (collection === 'rawMaterials') {
    const n = normName(row.name);
    if (!n) return '';
    const sid = row.supplierId != null && row.supplierId !== '' ? Number(row.supplierId) : '';
    if (sid === '') {
      const cid = row.supplierCategoryId != null && row.supplierCategoryId !== ''
        ? Number(row.supplierCategoryId)
        : '';
      return `${collection}|${n}||${cid}`;
    }
    return `${collection}|${n}|${sid}`;
  }
  if (collection === 'suppliers') {
    const n = normName(row.name);
    if (!n) return '';
    const cid = row.categoryId != null && row.categoryId !== '' ? Number(row.categoryId) : '';
    return `${collection}|${n}|${cid}`;
  }
  // קטגוריות אריזה/ניקיון: תפקיד זהה = כפילות גם כששם הקטגוריה שונה בין מכשירים
  // ("אריזה" מול "אריזות") — קטגוריית חומ"ג רגילה עדיין דורשת שם מדויק.
  if (collection === 'supplierCategories') {
    const role = supplierCategoryRoleKey(row);
    if (role) return `${collection}|role|${role}`;
  }
  // ספריית משימות: אותו שם באותה קבוצה (+קטגוריה) = כפילות, גם אם נוצרו ממכשירים שונים
  if (collection === 'checklistTasks') {
    const n = normName(row.name);
    if (!n) return '';
    return `${collection}|${n}|${row.categoryGroupId ?? ''}|${row.categoryId ?? ''}`;
  }
  // צ׳קליסט ריצה: אותו טקסט באותו תהליך = כפילות (גם עם task id שונה)
  if (collection === 'runPreparationChecks') {
    const n = normName(row.name);
    return row.runId != null && n ? `${collection}|${row.runId}|${n}` : '';
  }
  // תוכנית יומית: אותה משימת הכנה באותו יום/תזרים
  if (collection === 'managerPlanItems' && row.itemKind === 'flow_preparation') {
    const n = normName(row.label);
    return row.planType && n
      ? `${collection}|prep|${row.planType}|${row.anchorDate ?? ''}|${row.dayOffset ?? ''}|${row.flowId ?? ''}|${n}`
      : '';
  }
  if (collection === 'managerPlanItems' && row.itemKind === 'flow_cleaning') {
    const n = normName(row.label);
    return row.planType && n
      ? `${collection}|clean|${row.planType}|${row.anchorDate ?? ''}|${row.dayOffset ?? ''}|${row.flowId ?? ''}|${n}`
      : '';
  }
  return rowFingerprint(collection, row);
}

/** Name-only fingerprint — for cloud cross-device dedupe when FK UUIDs differ. */
export function rowNameFingerprint(collection, row) {
  if (!row) return '';
  if (collection === 'settings') return row.key ? `settings|${row.key}` : '';
  const n = normName(row.name);
  if (!n && row.weekStart) return `${collection}|${row.weekStart}`;
  if (!n && row.date && collection === 'productionEntries') {
    return `${collection}|${row.date}|${normName(row.productName || '')}`;
  }
  return n ? `${collection}|name|${n}` : '';
}

/**
 * Same-day / same-product / same-qty twin of a production entry, ignoring runId.
 * Used only to drop a null-run copy when a run-linked row already exists.
 */
export function rowProductionEntryTwinFingerprint(row) {
  if (!row) return '';
  const date = row.date ?? '';
  const pid = Number(row.productId) || row.productId || '';
  const qtyNum = Number(row.quantity);
  const qty = Number.isFinite(qtyNum) ? String(qtyNum) : String(row.quantity ?? '');
  return date && pid !== '' ? `productionEntries|${date}|${pid}|${qty}|${row.isWaste ? '1' : '0'}` : '';
}

function unionIdList(localIds, remoteIds) {
  const out = [];
  const seen = new Set();
  for (const id of [...(localIds || []), ...(remoteIds || [])]) {
    if (id == null || id === '') continue;
    const n = Number(id);
    const key = Number.isFinite(n) && n !== 0 ? String(n) : String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(Number.isFinite(n) && n !== 0 ? n : id);
  }
  return out;
}

/**
 * Keep local completions when a stale cloud row would reopen a finished run/step,
 * and union productionEntryIds so an empty cloud array cannot hide ייצור.
 */
export function mergeRemoteTransactionalRow(collection, local, remote) {
  if (!remote) return remote;
  if (!local) return { ...remote };
  const out = { ...remote };
  if (collection === 'productionRuns') {
    if (local.status === 'completed' && remote.status !== 'completed') {
      out.status = 'completed';
      out.completedAt = local.completedAt || remote.completedAt || null;
      const localIdx = Number(local.currentStepIndex);
      const remoteIdx = Number(remote.currentStepIndex);
      out.currentStepIndex = Math.max(
        Number.isFinite(localIdx) ? localIdx : 0,
        Number.isFinite(remoteIdx) ? remoteIdx : 0,
      );
    }
  }
  if (collection === 'runStepStates') {
    if (local.status === 'completed' && remote.status !== 'completed') {
      out.status = 'completed';
      out.startedAt = local.startedAt || remote.startedAt || null;
      out.completedAt = local.completedAt || remote.completedAt || null;
    }
    out.productionEntryIds = unionIdList(local.productionEntryIds, remote.productionEntryIds);
  }
  return out;
}


