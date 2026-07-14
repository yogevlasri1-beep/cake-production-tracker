import { exportAllData, importAllData } from './db.js?v=303';
import { APP_VERSION } from './version.js?v=303';
import { defaultColorForIndex } from './chart.js?v=303';
import { sanitizeMoney, sanitizeCategoryColor, roundMoney, sanitizeQuantity } from './validators.js?v=303';
import { productLineValue, entryQuantityForProduct } from './calc.js?v=303';
import { ValidationError } from './validators.js?v=303';

export const BACKUP_VERSION = 3;

const SUPPORTED_BACKUP_VERSIONS = new Set([1, 2, 3]);

function todayFileStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function compareCategories(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

function compareProducts(a, b) {
  if (a.categoryId !== b.categoryId) return a.categoryId - b.categoryId;
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

function buildProductionStatsByProduct(entries, productMap) {
  const stats = {};
  for (const entry of entries || []) {
    const product = productMap.get(entry.productId);
    if (!product) continue;
    const qty = entryQuantityForProduct(entry.quantity, product);
    if (qty == null) continue;
    if (!stats[entry.productId]) stats[entry.productId] = { qty: 0, value: 0 };
    stats[entry.productId].qty += qty;
    stats[entry.productId].value += productLineValue(product, qty);
  }
  for (const id of Object.keys(stats)) {
    stats[id].value = roundMoney(stats[id].value);
  }
  return stats;
}

export function normalizeBackupCategory(cat, index) {
  return {
    id: cat.id,
    name: cat.name,
    sortOrder: cat.sortOrder ?? index + 1,
    color: sanitizeCategoryColor(cat.color) || defaultColorForIndex(index),
    groupId: cat.groupId ? Number(cat.groupId) : null,
  };
}

export function normalizeBackupCategoryGroup(group, index) {
  return {
    id: group.id,
    name: group.name,
    sortOrder: group.sortOrder ?? index + 1,
    color: sanitizeCategoryColor(group.color) || defaultColorForIndex(index),
  };
}

export function normalizeBackupFlow(flow, index) {
  return {
    id: flow.id,
    categoryId: flow.categoryId ? Number(flow.categoryId) : null,
    categoryGroupId: flow.categoryGroupId ? Number(flow.categoryGroupId) : null,
    name: flow.name,
    sortOrder: flow.sortOrder ?? index + 1,
    isDefault: flow.isDefault === true,
  };
}

export function normalizeBackupFlowStep(step, index) {
  return {
    id: step.id,
    flowId: step.flowId ? Number(step.flowId) : null,
    categoryId: step.categoryId ? Number(step.categoryId) : null,
    categoryGroupId: step.categoryGroupId ? Number(step.categoryGroupId) : null,
    name: step.name,
    sortOrder: step.sortOrder ?? index + 1,
    tracksPortions: step.tracksPortions === true,
    portionUnit: step.portionUnit === 'weight' ? 'weight' : (step.portionUnit === 'units' ? 'units' : null),
    portionSize: step.portionSize != null ? Number(step.portionSize) : null,
  };
}

export function normalizeBackupProduct(product, category, stats, indexInCategory = 0) {
  const unitPrice = sanitizeMoney(product.unitPrice);
  const rawMaterialsCost = sanitizeMoney(product.rawMaterialsCost);
  const packagingCost = sanitizeMoney(product.packagingCost);
  const additionalCosts = sanitizeMoney(product.additionalCosts);
  const productionQty = stats?.qty || 0;
  const productionValue = stats?.value || 0;

  return {
    id: product.id,
    categoryId: product.categoryId,
    name: product.name,
    active: product.active !== false,
    sortOrder: product.sortOrder ?? indexInCategory + 1,
    unitPrice,
    priceUnit: product.priceUnit === 'kg' || product.priceUnit === 'kg_units' || product.priceUnit === 'kg_with_units'
      ? product.priceUnit : 'unit',
    unitWeightKg: product.unitWeightKg != null ? Number(product.unitWeightKg) : null,
    rawMaterialsCost,
    rawMaterialsCostSource: product.rawMaterialsCostSource === 'recipes' ? 'recipes' : 'manual',
    packagingCost,
    additionalCosts,
    costTotal: roundMoney(rawMaterialsCost + packagingCost + additionalCosts),
    categoryName: category?.name || '',
    categoryColor: category?.color || defaultColorForIndex(0),
    categorySortOrder: category?.sortOrder ?? 0,
    productionQty,
    productionValue,
  };
}

export function enrichBackupData(raw) {
  const categories = (raw.categories || [])
    .slice()
    .sort(compareCategories)
    .map((cat, index) => normalizeBackupCategory(cat, index));

  const categoryGroups = (raw.categoryGroups || [])
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
    .map((group, index) => normalizeBackupCategoryGroup(group, index));

  const catMap = new Map(categories.map((c) => [c.id, c]));
  const productMap = new Map((raw.products || []).map((p) => [p.id, p]));
  const productionStats = buildProductionStatsByProduct(raw.productionEntries, productMap);

  const productsByCategory = new Map();
  for (const product of raw.products || []) {
    if (!productsByCategory.has(product.categoryId)) productsByCategory.set(product.categoryId, []);
    productsByCategory.get(product.categoryId).push(product);
  }
  for (const group of productsByCategory.values()) {
    group.sort(compareProducts);
  }

  const products = [];
  for (const category of categories) {
    const group = productsByCategory.get(category.id) || [];
    group.forEach((product, index) => {
      products.push(normalizeBackupProduct(
        product,
        category,
        productionStats[product.id],
        index,
      ));
    });
  }

  const flows = (raw.flows || [])
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
    .map((flow, index) => normalizeBackupFlow(flow, index));

  const flowSteps = (raw.flowSteps || [])
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
    .map((step, index) => normalizeBackupFlowStep(step, index));

  return {
    categories,
    categoryGroups,
    products,
    productionEntries: raw.productionEntries || [],
    targets: raw.targets || [],
    processLogs: raw.processLogs || [],
    activityPresets: raw.activityPresets || [],
    flows,
    flowSteps,
    flowPortionPresets: raw.flowPortionPresets || [],
    groupPortionPresets: raw.groupPortionPresets || [],
    portionPresetLinks: raw.portionPresetLinks || [],
    portionPresetIngredientSettings: raw.portionPresetIngredientSettings || [],
    groupPreparations: raw.groupPreparations || [],
    flowPreparations: raw.flowPreparations || [],
    recipeGroups: raw.recipeGroups || [],
    recipeProductLinks: raw.recipeProductLinks || [],
    recipeProductCategoryLinks: raw.recipeProductCategoryLinks || [],
    recipeProductGroupLinks: raw.recipeProductGroupLinks || [],
    recipeCategories: raw.recipeCategories || [],
    recipes: raw.recipes || [],
    recipeIngredients: raw.recipeIngredients || [],
    bakingProfiles: raw.bakingProfiles || [],
    bakingProfileProducts: raw.bakingProfileProducts || [],
    bakingProfileScopes: raw.bakingProfileScopes || [],
    productRecipeComponents: raw.productRecipeComponents || [],
    productFlowLinks: raw.productFlowLinks || [],
    productionMachines: raw.productionMachines || [],
    productionMachineFields: raw.productionMachineFields || [],
    productionMachineProducts: raw.productionMachineProducts || [],
    productionMachineProductValues: raw.productionMachineProductValues || [],
    supplierCategories: raw.supplierCategories || [],
    suppliers: raw.suppliers || [],
    rawMaterials: raw.rawMaterials || [],
    supplierShortages: raw.supplierShortages || [],
    rawMaterialPriceHistory: raw.rawMaterialPriceHistory || [],
    weeklyProductionPlans: raw.weeklyProductionPlans || [],
    weeklyProductionPlanItems: raw.weeklyProductionPlanItems || [],
    productionRuns: raw.productionRuns || [],
    runStepStates: raw.runStepStates || [],
    productPreparations: raw.productPreparations || [],
    runPreparationChecks: raw.runPreparationChecks || [],
    flowCleaningTasks: raw.flowCleaningTasks || [],
    checklistTasks: raw.checklistTasks || [],
    flowChecklistItems: raw.flowChecklistItems || [],
    runCleaningChecks: raw.runCleaningChecks || [],
    managerPlans: raw.managerPlans || [],
    managerPlanItems: raw.managerPlanItems || [],
    managerTasks: raw.managerTasks || [],
    managerIncidents: raw.managerIncidents || [],
    managerShiftNotes: raw.managerShiftNotes || [],
    managerResponsibilityAreas: raw.managerResponsibilityAreas || [],
    managerEmployees: raw.managerEmployees || [],
    managerDepartments: raw.managerDepartments || [],
    departmentCleaningLists: raw.departmentCleaningLists || [],
    departmentCleaningTasks: raw.departmentCleaningTasks || [],
    purchaseCategories: raw.purchaseCategories || [],
    purchaseItems: raw.purchaseItems || [],
    settings: raw.settings || [],
  };
}

export function summarizeBackupData(data) {
  return {
    categories: data.categories?.length || 0,
    categoryGroups: data.categoryGroups?.length || 0,
    products: data.products?.length || 0,
    productionEntries: data.productionEntries?.length || 0,
    targets: data.targets?.length || 0,
    processLogs: data.processLogs?.length || 0,
    activityPresets: data.activityPresets?.length || 0,
    flowSteps: data.flowSteps?.length || 0,
    flows: data.flows?.length || 0,
    flowPortionPresets: data.flowPortionPresets?.length || 0,
    groupPortionPresets: data.groupPortionPresets?.length || 0,
    groupPreparations: data.groupPreparations?.length || 0,
    flowPreparations: data.flowPreparations?.length || 0,
    productionRuns: data.productionRuns?.length || 0,
    runStepStates: data.runStepStates?.length || 0,
    productPreparations: data.productPreparations?.length || 0,
    runPreparationChecks: data.runPreparationChecks?.length || 0,
    flowCleaningTasks: data.flowCleaningTasks?.length || 0,
    runCleaningChecks: data.runCleaningChecks?.length || 0,
    weeklyProductionPlans: data.weeklyProductionPlans?.length || 0,
    weeklyProductionPlanItems: data.weeklyProductionPlanItems?.length || 0,
    managerPlans: data.managerPlans?.length || 0,
    managerPlanItems: data.managerPlanItems?.length || 0,
    managerTasks: data.managerTasks?.length || 0,
    managerIncidents: data.managerIncidents?.length || 0,
    managerShiftNotes: data.managerShiftNotes?.length || 0,
    managerResponsibilityAreas: data.managerResponsibilityAreas?.length || 0,
    managerEmployees: data.managerEmployees?.length || 0,
    managerDepartments: data.managerDepartments?.length || 0,
    settings: data.settings?.length || 0,
    recipeGroups: data.recipeGroups?.length || 0,
    recipeCategories: data.recipeCategories?.length || 0,
    recipes: data.recipes?.length || 0,
    recipeIngredients: data.recipeIngredients?.length || 0,
    recipeProductLinks: data.recipeProductLinks?.length || 0,
    recipeProductCategoryLinks: data.recipeProductCategoryLinks?.length || 0,
    recipeProductGroupLinks: data.recipeProductGroupLinks?.length || 0,
    productRecipeComponents: data.productRecipeComponents?.length || 0,
    productionMachines: data.productionMachines?.length || 0,
    productionMachineFields: data.productionMachineFields?.length || 0,
    productionMachineProducts: data.productionMachineProducts?.length || 0,
    productionMachineProductValues: data.productionMachineProductValues?.length || 0,
    bakingProfiles: data.bakingProfiles?.length || 0,
    supplierCategories: data.supplierCategories?.length || 0,
    suppliers: data.suppliers?.length || 0,
    rawMaterials: data.rawMaterials?.length || 0,
    supplierShortages: data.supplierShortages?.length || 0,
    rawMaterialPriceHistory: data.rawMaterialPriceHistory?.length || 0,
    purchaseCategories: data.purchaseCategories?.length || 0,
    purchaseItems: data.purchaseItems?.length || 0,
  };
}

export function formatBackupSummary(counts) {
  const parts = [
    `${counts.categories} קטגוריות`,
    `${counts.products} מוצרים`,
    `${counts.productionEntries} רישומי ייצור`,
    `${counts.targets} יעדים`,
    `${counts.processLogs} תיעודים`,
  ];
  if (counts.categoryGroups) parts.splice(1, 0, `${counts.categoryGroups} קטגוריות כלליות`);
  if (counts.flows) parts.push(`${counts.flows} תבניות תזרים`);
  if (counts.flowSteps) parts.push(`${counts.flowSteps} שלבי תזרים`);
  const portionCount = counts.groupPortionPresets || counts.flowPortionPresets;
  if (portionCount) parts.push(`${portionCount} מנות מוכנות`);
  const prepCount = counts.groupPreparations || counts.flowPreparations;
  if (prepCount) parts.push(`${prepCount} הכנות תזרים`);
  if (counts.productionRuns) parts.push(`${counts.productionRuns} תהליכי יצור`);
  if (counts.runStepStates) parts.push(`${counts.runStepStates} שלבי תהליך`);
  if (counts.productPreparations) parts.push(`${counts.productPreparations} הכנות מוצר`);
  if (counts.runPreparationChecks) parts.push(`${counts.runPreparationChecks} בדיקות הכנה`);
  if (counts.weeklyProductionPlans || counts.weeklyProductionPlanItems) {
    parts.push(`${counts.weeklyProductionPlans || 0} תוכניות שבוע / ${counts.weeklyProductionPlanItems || 0} פריטים`);
  }
  if (counts.managerPlans || counts.managerPlanItems) {
    parts.push(`${counts.managerPlans || 0} תוכניות / ${counts.managerPlanItems || 0} פריטים`);
  }
  if (counts.managerTasks) parts.push(`${counts.managerTasks} משימות מנהל`);
  if (counts.managerIncidents) parts.push(`${counts.managerIncidents} אירועים`);
  if (counts.managerShiftNotes) parts.push(`${counts.managerShiftNotes} הערות משמרת`);
  if (counts.managerEmployees) parts.push(`${counts.managerEmployees} עובדים`);
  if (counts.settings) parts.push(`${counts.settings} הגדרות`);
  if (counts.recipes) parts.push(`${counts.recipes} מתכונים`);
  if (counts.recipeIngredients) parts.push(`${counts.recipeIngredients} רכיבי מתכון`);
  if (counts.recipeProductLinks) parts.push(`${counts.recipeProductLinks} קישורי מתכון`);
  if (counts.recipeProductCategoryLinks) parts.push(`${counts.recipeProductCategoryLinks} קישורי קטגוריה`);
  if (counts.recipeProductGroupLinks) parts.push(`${counts.recipeProductGroupLinks} קישורי קבוצה`);
  if (counts.productRecipeComponents) parts.push(`${counts.productRecipeComponents} רכיבי מוצר`);
  if (counts.productionMachines) parts.push(`${counts.productionMachines} מכונות יצור`);
  if (counts.bakingProfiles) parts.push(`${counts.bakingProfiles} פרופילי אפייה`);
  if (counts.supplierCategories) parts.push(`${counts.supplierCategories} קטגוריות ספק`);
  if (counts.purchaseItems) parts.push(`${counts.purchaseItems} פריטי קניות`);
  if (counts.suppliers) parts.push(`${counts.suppliers} ספקים`);
  if (counts.rawMaterials) parts.push(`${counts.rawMaterials} חומרי גלם`);
  if (counts.supplierShortages) parts.push(`${counts.supplierShortages} חוסרים`);
  if (counts.rawMaterialPriceHistory) parts.push(`${counts.rawMaterialPriceHistory} היסטוריית מחירים`);
  return parts.join(' · ');
}

function validateBackupPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new ValidationError('קובץ הגיבוי לא תקין');
  }
  if (!SUPPORTED_BACKUP_VERSIONS.has(raw.backupVersion)) {
    throw new ValidationError('גרסת גיבוי לא נתמכת — ייצא גיבוי חדש מהאפליקציה');
  }
  const data = raw.data;
  if (!data || typeof data !== 'object') {
    throw new ValidationError('מבנה הגיבוי לא תקין');
  }
  const tables = [
    'categories',
    'products',
    'productionEntries',
    'targets',
    'processLogs',
    'activityPresets',
  ];
  for (const key of tables) {
    if (!Array.isArray(data[key])) {
      throw new ValidationError(`חסרה טבלה בגיבוי: ${key}`);
    }
  }
  if (!Array.isArray(data.categoryGroups)) {
    data.categoryGroups = [];
  }
  if (!Array.isArray(data.flowSteps)) data.flowSteps = [];
  if (!Array.isArray(data.flows)) data.flows = [];
  if (!Array.isArray(data.flowPortionPresets)) data.flowPortionPresets = [];
  if (!Array.isArray(data.productionRuns)) data.productionRuns = [];
  if (!Array.isArray(data.runStepStates)) data.runStepStates = [];
  if (!Array.isArray(data.groupPreparations)) data.groupPreparations = [];
  if (!Array.isArray(data.flowPreparations)) data.flowPreparations = [];
  if (!Array.isArray(data.productPreparations)) data.productPreparations = [];
  if (!Array.isArray(data.runPreparationChecks)) data.runPreparationChecks = [];
  if (!Array.isArray(data.flowCleaningTasks)) data.flowCleaningTasks = [];
  if (!Array.isArray(data.checklistTasks)) data.checklistTasks = [];
  if (!Array.isArray(data.flowChecklistItems)) data.flowChecklistItems = [];
  if (!Array.isArray(data.runCleaningChecks)) data.runCleaningChecks = [];
  if (!Array.isArray(data.recipeGroups)) data.recipeGroups = [];
  if (!Array.isArray(data.recipeProductLinks)) data.recipeProductLinks = [];
  if (!Array.isArray(data.recipeProductCategoryLinks)) data.recipeProductCategoryLinks = [];
  if (!Array.isArray(data.recipeProductGroupLinks)) data.recipeProductGroupLinks = [];
  if (!Array.isArray(data.recipeCategories)) data.recipeCategories = [];
  if (!Array.isArray(data.recipes)) data.recipes = [];
  if (!Array.isArray(data.recipeIngredients)) data.recipeIngredients = [];
  if (!Array.isArray(data.bakingProfiles)) data.bakingProfiles = [];
  if (!Array.isArray(data.bakingProfileProducts)) data.bakingProfileProducts = [];
  if (!Array.isArray(data.bakingProfileScopes)) data.bakingProfileScopes = [];
  if (!Array.isArray(data.productRecipeComponents)) data.productRecipeComponents = [];
  if (!Array.isArray(data.productFlowLinks)) data.productFlowLinks = [];
  if (!Array.isArray(data.productionMachines)) data.productionMachines = [];
  if (!Array.isArray(data.productionMachineFields)) data.productionMachineFields = [];
  if (!Array.isArray(data.productionMachineProducts)) data.productionMachineProducts = [];
  if (!Array.isArray(data.productionMachineProductValues)) data.productionMachineProductValues = [];
  if (!Array.isArray(data.supplierCategories)) data.supplierCategories = [];
  if (!Array.isArray(data.suppliers)) data.suppliers = [];
  if (!Array.isArray(data.rawMaterials)) data.rawMaterials = [];
  if (!Array.isArray(data.supplierShortages)) data.supplierShortages = [];
  if (!Array.isArray(data.rawMaterialPriceHistory)) data.rawMaterialPriceHistory = [];
  if (!Array.isArray(data.weeklyProductionPlans)) data.weeklyProductionPlans = [];
  if (!Array.isArray(data.weeklyProductionPlanItems)) data.weeklyProductionPlanItems = [];
  if (!Array.isArray(data.groupPortionPresets)) data.groupPortionPresets = [];
  if (!Array.isArray(data.portionPresetLinks)) data.portionPresetLinks = [];
  if (!Array.isArray(data.portionPresetIngredientSettings)) data.portionPresetIngredientSettings = [];
  if (!Array.isArray(data.managerPlans)) data.managerPlans = [];
  if (!Array.isArray(data.managerPlanItems)) data.managerPlanItems = [];
  if (!Array.isArray(data.managerTasks)) data.managerTasks = [];
  if (!Array.isArray(data.managerIncidents)) data.managerIncidents = [];
  if (!Array.isArray(data.managerShiftNotes)) data.managerShiftNotes = [];
  if (!Array.isArray(data.managerResponsibilityAreas)) data.managerResponsibilityAreas = [];
  if (!Array.isArray(data.managerEmployees)) data.managerEmployees = [];
  if (!Array.isArray(data.managerDepartments)) data.managerDepartments = [];
  if (!Array.isArray(data.departmentCleaningLists)) data.departmentCleaningLists = [];
  if (!Array.isArray(data.departmentCleaningTasks)) data.departmentCleaningTasks = [];
  if (!Array.isArray(data.purchaseCategories)) data.purchaseCategories = [];
  if (!Array.isArray(data.purchaseItems)) data.purchaseItems = [];
  return enrichBackupData(data);
}

export async function createBackupPayload(exportMeta = null) {
  const raw = await exportAllData();
  const data = enrichBackupData(raw);
  const payload = {
    backupVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
    counts: summarizeBackupData(data),
  };
  if (exportMeta && typeof exportMeta === 'object') {
    payload.exportMeta = exportMeta;
  }
  return payload;
}

export async function downloadBackupFile() {
  const backup = await createBackupPayload();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const { downloadBlob } = await import('./download.js');
  await downloadBlob(blob, `yitzur-gibuy-${date}.json`);
  return backup;
}

export async function parseBackupFile(file) {
  if (!file) throw new ValidationError('לא נבחר קובץ');
  const name = (file.name || '').toLowerCase();
  if (!name.endsWith('.json') && file.type && !file.type.includes('json')) {
    throw new ValidationError('יש לבחור קובץ JSON של גיבוי');
  }
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new ValidationError('לא ניתן לקרוא את קובץ הגיבוי');
  }
  const data = validateBackupPayload(raw);
  return {
    data,
    meta: {
      exportedAt: raw.exportedAt || '',
      appVersion: raw.appVersion || '',
      backupVersion: raw.backupVersion || 1,
      counts: summarizeBackupData(data),
    },
  };
}

export async function restoreBackupPayload(data) {
  await importAllData(enrichBackupData(data));
}

export async function restoreBackupFromFile(file) {
  const { data, meta } = await parseBackupFile(file);
  await restoreBackupPayload(data);
  return meta;
}
