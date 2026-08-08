import { test, testAsync, assertEqual, assertOk, assertApprox, flushTests } from './runner.js?v=450';
import {
  isValidISODate, sanitizeQuantity, sanitizeMoney, sanitizeName, sanitizeRecipeQuantity, roundMoney,
} from '../js/validators.js?v=450';
import {
  pct, pctDisplay, computeProductionTotals, computeReportRows,
  computeProcessSummary, weekRange, monthRange, sumEntryQuantities,
  qtyForCategoryOnDate, addDaysISO, simulateMergeEntries, sumEntriesForProducts,
  auditProductionData, sumCategoryTotals, buildProductMap, sortProductsForReport,
} from '../js/calc.js?v=450';
import { parseDate, parseQuantity, detectAndParse, parseImportFile } from '../js/import.js?v=450';
import { enrichBackupData, summarizeBackupData, formatBackupSummary } from '../js/backup.js?v=450';
import {
  buildSupabaseRestUrl,
  buildSupabaseHeaders,
  parseSupabaseBackupRow,
  normalizeSupabaseUrl,
  isPrimaryBackupDevice,
  canUploadToSupabase,
} from '../js/supabase-backup.js?v=450';
import { isAutoBackupDue } from '../js/backup-service.js?v=450';
import { normalizeRecipeImportKey, resolveRecipeBaking, normalizeBakingProfileFields, computePricePerKg, computePackagePrice, packageWeightKgFromGrams, packageWeightGramsFromKg, rawMaterialPricingFromPerKg, normalizeMaterialKey, pickHighestPricedMaterial, pickRecipeDefaultMaterial, buildMaterialsByNameKey, resolveRecipeIngredientMaterial, computeIngredientLineCost, getIngredientPriceSource, isProductRecipesCostSource, getMaterialPurchasePricePerKg, getMaterialEffectivePricePerKg, isFreeMaterial, getRecipeProductYieldInfo, scaleRecipeIngredientsForProductCount, recipeScaleRatioForProductCount, scaleRecipeIngredients, scaleIngredientsToTargetGrams, recipeTotalWeightGrams, buildRecipePortionPresetFields, formatSubdivisionWeight, gramsFromSubdivisionKg, buildMergedMaterialSynonyms, materialFieldFillPatch, shouldPreserveMaterialAsSupplierOffer, classifyMaterialsForMerge, pickMergeRecipeDefaultId, getMaterialPortionProductIds, buildProductProfileCompleteness, inferAllergensFromName, sanitizeProductAllergenIds, sanitizeProductAllergensMode, productAllergenLabel } from '../js/kitchen-db.js?v=450';
import { shouldApplyRemote, orderedCollections, COLLECTION_TABLE, SYNC_ORDER, isSyncCollection, rowFingerprint, rowDedupeFingerprint, POLYMORPHIC_FKS } from '../js/sync/collections.js?v=450';
import {
  parsePackageWeightGrams, isSkipSheetName, detectSupplierSheetFormat, parseSupplierSheetRows,
  parseQuantityUnit, detectHeaderlessPriceListFormat, parseHeaderlessPriceListRows,
  detectImportPriceBasis, applyImportPriceBasis, previewImportPriceBasis,
  PRICE_BASIS_PACKAGE, PRICE_BASIS_PER_KG,
} from '../js/supplier-import.js?v=450';
import { parseRecipesFromDocumentXml } from '../js/recipe-import.js?v=450';
import { isFlowsReportType, isManagerReportType, normalizeReportType, groupRunsByFlow, filterProductionHistoryEntries, productIdsForHistoryScope, sortProductionHistoryEntries, managerRecordInDateRange, filterManagerTasksByRange } from '../js/screens/reports.js?v=450';
import { runStepsAllCompleted, findNextIncompleteStepIndex, parseNumericBatchNumber, computeNextBatchNumber } from '../js/db.js?v=450';
import { haccpRoleLabel, HACCP_STEPS, evaluateCcpDecisionTree, formatCriticalLimit, haccpMonitorMethodLabel, haccpMonitorFrequencyLabel, haccpProductDispositionLabel, haccpVerificationMethodLabel, haccpVerificationFrequencyLabel, haccpDocKindLabel, haccpDocFormatLabel, haccpPrpTopicLabel, haccpPrpStatusLabel, HACCP_PRP_TOPICS, haccpMonitorLogResultLabel, buildHaccpTeamRoleCoverage } from '../js/haccp-db.js?v=450';
import { buildHaccpPlanPrintHtml } from '../js/haccp-print.js?v=450';
import { WORKSPACES } from '../js/workspaces.js?v=450';
import { userRoleLabel, userStatusLabel } from '../js/auth.js?v=450';
import { sanitizeAuditPayload, auditActionLabel, auditEntityLabel, formatAuditSnapshotSummary } from '../js/audit.js?v=450';
import {
  allowedWorkspaces, canAccessWorkspace, canAccessScreen, canAccessHaccpStep, canAccessRecipeTab, canAccessBackupFull, canManageAccounts,
  canEditRecipes, canManageFlows, canAdjustInventory,
  sanitizeWorkspaceAccess, defaultWorkspacesForRole, workspaceLabel,
} from '../js/permissions.js?v=450';
import { lotTraceEmptyHint } from '../js/lot-trace.js?v=450';

export async function runAllTests() {
  /* validators */
  test('isValidISODate — תקין', () => assertOk(isValidISODate('2026-06-11')));
  test('isValidISODate — לא תקין', () => assertOk(!isValidISODate('2026-13-01')));
  test('sanitizeQuantity — שלם חיובי', () => assertEqual(sanitizeQuantity('50'), 50));
  test('sanitizeQuantity — דוחה 0', () => assertEqual(sanitizeQuantity('0'), null));
  test('sanitizeQuantity — דוחה שלילי', () => assertEqual(sanitizeQuantity('-3'), null));
  test('sanitizeQuantity — מעגל', () => assertEqual(sanitizeQuantity('12.7'), 13));
  test('sanitizeMoney — שלילי → 0', () => assertEqual(sanitizeMoney(-5), 0));
  test('sanitizeMoney — עיגול', () => assertApprox(sanitizeMoney('10.556'), 10.56));
  test('sanitizeName — ריק', () => assertEqual(sanitizeName('   '), null));
  test('sanitizeName — תקין', () => assertEqual(sanitizeName('  שטרודל  '), 'שטרודל'));

  test('isProductRecipesCostSource — manual/recipes', () => {
    assertOk(isProductRecipesCostSource({}));
    assertOk(!isProductRecipesCostSource({ rawMaterialsCostSource: 'manual' }));
    assertOk(isProductRecipesCostSource({ rawMaterialsCostSource: 'recipes' }));
    assertOk(isProductRecipesCostSource({ rawMaterialsCostSource: 'invalid' }));
  });

  test('buildProductProfileCompleteness — חובה מול רשות', () => {
    const empty = buildProductProfileCompleteness({
      product: { unitPrice: 0, priceUnit: 'unit' },
      components: [],
      linkedRecipes: [],
      bakingProfile: null,
      totalWeightGrams: 0,
      portionPresets: [],
      linkedFlows: [],
    });
    assertOk(empty.percent < 100);
    assertOk(empty.missingRequired.some((i) => i.id === 'composition'));
    assertOk(empty.missingRequired.some((i) => i.id === 'price'));
    assertOk(empty.missingRequired.some((i) => i.id === 'baking'));
    assertOk(!empty.missingRequired.some((i) => i.id === 'packaging'));
    assertOk(!empty.missingRequired.some((i) => i.id === 'allergens'));
    assertOk(!empty.missingRequired.some((i) => i.id === 'shelf_life'));

    const ready = buildProductProfileCompleteness({
      product: {
        unitPrice: 25,
        priceUnit: 'kg_units',
        unitWeightKg: 0.8,
        packagingMaterialId: 1,
        unitsPerCarton: 12,
        shelfLife: '5 ימים',
        storageConditions: 'קירור',
      },
      components: [{ kind: 'recipe', recipeId: 1 }],
      linkedRecipes: [{ id: 1, name: 'בצק' }],
      bakingProfile: { id: 2, name: 'תנור 180' },
      totalWeightGrams: 800,
      portionPresets: [{ id: 9, name: 'מנת קרם' }],
      linkedFlows: [{ flow: { id: 3 } }],
      allergenIds: ['gluten', 'eggs'],
    });
    assertEqual(ready.percent, 100);
    assertOk(ready.ready);
    assertEqual(ready.missingRequired.length, 0);
    assertOk(ready.items.find((i) => i.id === 'portion_presets')?.done);
    assertOk(ready.items.find((i) => i.id === 'allergens')?.done);
    assertOk(ready.items.find((i) => i.id === 'shelf_life')?.done);
  });

  test('inferAllergensFromName — רמזי עברית', () => {
    assertOk(inferAllergensFromName('קמח חיטה').includes('gluten'));
    assertOk(inferAllergensFromName('חמאה 82%').includes('milk'));
    assertOk(inferAllergensFromName('ביצים גדולות').includes('eggs'));
    assertOk(inferAllergensFromName('טחינה גולמית').includes('sesame'));
    assertEqual(inferAllergensFromName('סוכר לבן').length, 0);
  });

  test('sanitizeProductAllergenIds / mode / label', () => {
    assertEqual(
      sanitizeProductAllergenIds(['gluten', 'eggs', 'bogus', 'gluten']).join(','),
      'gluten,eggs',
    );
    assertEqual(sanitizeProductAllergensMode('manual'), 'manual');
    assertEqual(sanitizeProductAllergensMode('anything'), 'auto');
    assertOk(productAllergenLabel('milk').includes('חלב'));
  });

  test('computePricePerKg — 1kg package', () => assertApprox(computePricePerKg(25, 1000), 25));
  test('computePricePerKg — 500g package', () => assertApprox(computePricePerKg(10, 500), 20));
  test('computePricePerKg — missing weight', () => assertEqual(computePricePerKg(10, null), null));

  test('computePackagePrice — 25/kg × 1kg', () => assertApprox(computePackagePrice(25, 1), 25));
  test('computePackagePrice — 20/kg × 0.5kg', () => assertApprox(computePackagePrice(20, 0.5), 10));
  test('computePackagePrice — missing qty', () => assertEqual(computePackagePrice(20, null), null));

  test('packageWeightKgFromGrams — 1000g', () => assertApprox(packageWeightKgFromGrams(1000), 1));
  test('packageWeightGramsFromKg — 2.5kg', () => assertApprox(packageWeightGramsFromKg(2.5), 2500));

  test('rawMaterialPricingFromPerKg — converts to storage fields', () => {
    const pricing = rawMaterialPricingFromPerKg({ pricePerKg: 30, packageWeightKg: 2 });
    assertApprox(pricing.unitPrice, 60);
    assertApprox(pricing.packageWeightGrams, 2000);
  });

  test('getRecipeProductYieldInfo — 10kg recipe, 100g unit → 100 products', () => {
    const recipe = { portionWeightGrams: 100, yieldPortions: 1 };
    const ingredients = [{ name: 'קמח', quantity: 10, unitKind: 'kg', unit: 'ק"ג' }];
    const info = getRecipeProductYieldInfo(recipe, ingredients);
    assertOk(info.units);
    assertApprox(info.units.totalUnits, 100);
    assertApprox(info.units.unitsPerPortion, 100);
    assertEqual(info.yieldP, 1);
  });

  test('getRecipeProductYieldInfo — 70kg recipe, 3kg subdivision', () => {
    const recipe = { portionWeightGrams: gramsFromSubdivisionKg(3), yieldPortions: 5 };
    const ingredients = [{ name: 'בצק', quantity: 70, unitKind: 'kg', unit: 'ק"ג' }];
    const info = getRecipeProductYieldInfo(recipe, ingredients);
    assertOk(info.units);
    assertApprox(info.units.totalUnits, 70000 / 3000);
    assertEqual(info.yieldP, 1);
  });

  test('formatSubdivisionWeight — kg and grams', () => {
    assertEqual(formatSubdivisionWeight(3000), '3 ק"ג');
    assertEqual(formatSubdivisionWeight(250), '250 גרם');
  });

  test('buildRecipePortionPresetFields — whole recipe as portion with subdivision', () => {
    const recipe = { name: 'בצק', portionWeightGrams: 3000, yieldPortions: 4 };
    const ingredients = [{ name: 'קמח', quantity: 70, unitKind: 'kg', unit: 'ק"ג' }];
    const preset = buildRecipePortionPresetFields(recipe, ingredients);
    assertOk(preset);
    assertApprox(preset.weight, 70);
    assertOk(preset.extra.includes('יחידות × 3 ק"ג'));
  });

  test('scaleRecipeIngredientsForProductCount — doubles qty for 2× products', () => {
    const recipe = { portionWeightGrams: 100, yieldPortions: 1 };
    const ingredients = [{ name: 'קמח', quantity: 5, unitKind: 'kg', unit: 'ק"ג' }];
    const scaled = scaleRecipeIngredientsForProductCount(ingredients, recipe, 100);
    assertOk(scaled);
    assertApprox(scaled[0].scaledQuantity, 10);
  });

  test('scaleRecipeIngredients — anchor 50→65 scales all ingredients', () => {
    const ingredients = [
      { id: 1, name: 'קמח', quantity: 50, unitKind: 'kg', unit: 'ק"ג' },
      { id: 2, name: 'סוכר', quantity: 10, unitKind: 'kg', unit: 'ק"ג' },
    ];
    const scaled = scaleRecipeIngredients(ingredients, 1, 65);
    assertApprox(scaled[0].scaledQuantity, 65);
    assertApprox(scaled[1].scaledQuantity, 13);
  });

  test('scaleIngredientsToTargetGrams — 10 units × 3kg from 70kg recipe', () => {
    const recipe = { portionWeightGrams: gramsFromSubdivisionKg(3) };
    const ingredients = [
      { name: 'קמח', quantity: 50, unitKind: 'kg', unit: 'ק"ג' },
      { name: 'מים', quantity: 20, unitKind: 'l', unit: 'ליטר' },
    ];
    const targetG = 10 * recipe.portionWeightGrams;
    const scaled = scaleIngredientsToTargetGrams(ingredients, targetG);
    assertApprox(recipeTotalWeightGrams(scaled, { useScaled: true }), targetG);
    assertApprox(scaled[0].scaledQuantity, 50 * (targetG / 70000));
  });

  test('recipeScaleRatioForProductCount — 70kg / 3kg unit, target 10 units', () => {
    const recipe = { portionWeightGrams: gramsFromSubdivisionKg(3) };
    const ingredients = [{ name: 'בצק', quantity: 70, unitKind: 'kg', unit: 'ק"ג' }];
    const ratio = recipeScaleRatioForProductCount(recipe, ingredients, 10);
    assertApprox(ratio, 10 / (70000 / 3000));
    const scaled = scaleRecipeIngredientsForProductCount(ingredients, recipe, 10);
    assertApprox(scaled[0].scaledQuantity, 30);
  });

  test('buildRecipePortionPresetFields — מנה = משקל מתכון מלא', () => {
    const recipe = { name: 'בצק', portionWeightGrams: 3000 };
    const ingredients = [{ name: 'קמח', quantity: 70, unitKind: 'kg', unit: 'ק"ג' }];
    const preset = buildRecipePortionPresetFields(recipe, ingredients);
    assertOk(preset);
    assertApprox(preset.weight, 70);
    assertOk(preset.extra.includes('3 ק"ג'));
  });

  test('buildRecipePortionPresetFields — עוגת דבש mixed kg/g/l matches recipe total', () => {
    const recipe = { name: 'עוגת דבש', yieldPortions: 1 };
    const ingredients = [
      { name: 'מתק', quantity: 4.5, unitKind: 'kg' },
      { name: 'סוכר', quantity: 7.5, unitKind: 'kg' },
      { name: 'קמח', quantity: 12, unitKind: 'kg' },
      { name: 'מים', quantity: 6, unitKind: 'l' },
      { name: 'ביצים', quantity: 6, unitKind: 'l' },
      { name: 'שמן סויה', quantity: 7, unitKind: 'l' },
      { name: 'סודה לשתיה', quantity: 420, unitKind: 'g' },
      { name: 'ציפורן', quantity: 50, unitKind: 'g' },
      { name: 'קינמון', quantity: 100, unitKind: 'g' },
      { name: 'דבש טבעי', quantity: 500, unitKind: 'g' },
      { name: 'ריבה', quantity: 2, unitKind: 'kg' },
      { name: 'פוטסיום סורבט', quantity: 200, unitKind: 'g' },
      { name: 'גליצרין', quantity: 400, unitKind: 'g' },
    ];
    const expectedKg = recipeTotalWeightGrams(ingredients) / 1000;
    assertApprox(expectedKg, 46.67);
    const preset = buildRecipePortionPresetFields(recipe, ingredients);
    assertOk(preset);
    assertApprox(preset.weight, expectedKg);
    assertOk(preset.weight < 100, 'portion weight must be recipe kg, not stale inflated value');
  });


  test('getMaterialEffectivePricePerKg — processed overrides purchase', () => {
    const mat = { unitPrice: 50, packageWeightGrams: 1000, processedPricePerKg: 60 };
    assertApprox(getMaterialPurchasePricePerKg(mat), 50);
    assertApprox(getMaterialEffectivePricePerKg(mat), 60);
  });

  test('normalizeMaterialKey — dedupe logic', () => {
    const mats = [
      { id: 1, name: 'קמח', supplierId: 1 },
      { id: 2, name: '  קמח ', supplierId: 2 },
      { id: 3, name: 'סוכר', supplierId: 1 },
    ];
    const byKey = new Map();
    for (const m of mats) {
      const key = normalizeMaterialKey(m.name);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(m);
    }
    assertEqual(byKey.size, 2);
    assertEqual(byKey.get(normalizeMaterialKey('קמח')).length, 2);
  });

  test('parsePackageWeightGrams — kg', () => assertEqual(parsePackageWeightGrams('1 ק"ג'), 1000));
  test('parsePackageWeightGrams — grams', () => assertEqual(parsePackageWeightGrams('250 גרם'), 250));

  test('isSkipSheetName — skips default sheets', () => {
    assertOk(isSkipSheetName('גיליון1'));
    assertOk(isSkipSheetName('Sheet1'));
    assertOk(!isSkipSheetName('פוליבה'));
  });

  test('detectSupplierSheetFormat — finds מוצר header', () => {
    const rows = [['מוצר', 'כמות שבועית', 'פוליבה'], ['אגוז מלך', 'ק"ג 1', '21']];
    const meta = detectSupplierSheetFormat(rows);
    assertOk(meta);
    assertEqual(meta.headerRowIndex, 0);
  });

  test('detectSupplierSheetFormat — חומר גלם alias + title rows', () => {
    const rows = [
      ['רשימת מחירים'],
      ['חומר גלם', 'כמות', 'ספק א'],
      ['קמח', '1 ק"ג', '5'],
    ];
    const meta = detectSupplierSheetFormat(rows);
    assertOk(meta);
    assertEqual(meta.headerRowIndex, 1);
  });

  test('parseSupplierSheetRows — current + history', () => {
    const rows = [
      ['מוצר', 'כמות שבועית', 'פוליבה', 'מחיר', 'עודכן בתאריך', 'מחיר', 'עודכן בתאריך'],
      ['אגוז מלך', 'ק"ג 1', '21', '15', '24/2/22', '18.5', '6/12/23'],
    ];
    const meta = detectSupplierSheetFormat(rows);
    const entries = parseSupplierSheetRows(rows, 'פוליבה', meta);
    assertEqual(entries.length, 3);
    assertEqual(entries[0].materialName, 'אגוז מלך');
    assertEqual(entries[0].supplierName, 'פוליבה');
    assertEqual(entries[0].price, 21);
    assertEqual(entries[1].price, 15);
    assertEqual(entries[1].effectiveDate, '2022-02-24');
    assertEqual(entries[2].price, 18.5);
    assertEqual(entries[2].effectiveDate, '2023-12-06');
  });

  test('parseSupplierSheetRows — material without price still imported', () => {
    const rows = [
      ['מוצר', 'כמות שבועית', 'ספק'],
      ['שמן', 'ליטר', ''],
    ];
    const meta = detectSupplierSheetFormat(rows);
    const entries = parseSupplierSheetRows(rows, 'ספק', meta);
    assertEqual(entries.length, 1);
    assertEqual(entries[0].materialName, 'שמן');
    assertEqual(entries[0].price, null);
  });

  test('parseSupplierSheetRows — history without date uses today', () => {
    const rows = [
      ['מוצר', 'כמות', 'ספק'],
      ['חמאה', 'ק"ג', '', '12', ''],
    ];
    const meta = detectSupplierSheetFormat(rows);
    const entries = parseSupplierSheetRows(rows, 'ספק', meta);
    assertEqual(entries.length, 2);
    assertEqual(entries[0].price, 12);
    assertEqual(entries[1].price, 12);
  });

  test('parseSupplierSheetRows — empty current price uses latest history', () => {
    const rows = [
      ['מוצר', 'כמות', 'ספק', 'מחיר', 'תאריך'],
      ['סוכר', 'ק"ג', '', '10', '1/1/24', '12', '1/6/24'],
    ];
    const meta = detectSupplierSheetFormat(rows);
    const entries = parseSupplierSheetRows(rows, 'ספק', meta);
    const current = entries.find((e) => e.effectiveDate === new Date().toISOString().slice(0, 10));
    assertOk(current);
    assertEqual(current.price, 12);
  });

  test('parseQuantityUnit — carton and bag', () => {
    assertEqual(parseQuantityUnit('קרטון 1').unit, 'קרטון');
    assertEqual(parseQuantityUnit('שק 1').unit, 'שק');
    assertEqual(parseQuantityUnit('ק"ג 1').packageWeightGrams, 1000);
  });

  test('detectHeaderlessPriceListFormat — no headers, name col B', () => {
    const rows = [
      ['', '11/5/25'],
      ['', 'סוכר', '3.1', '2.7'],
      ['', 'שמן לליטר', '6.14'],
      ['', 'אגוזי מלך', '27'],
    ];
    const meta = detectHeaderlessPriceListFormat(rows);
    assertOk(meta);
    assertEqual(meta.nameCol, 1);
    assertEqual(meta.priceStartCol, 2);
    assertEqual(meta.sheetDate, '2025-05-11');
  });

  test('parseHeaderlessPriceListRows — per kg + dual prices', () => {
    const rows = [
      ['', '11/5/25'],
      ['', 'סוכר', '3.1', '2.7'],
      ['', 'גלוטן', '6'],
    ];
    const meta = detectHeaderlessPriceListFormat(rows);
    const entries = parseHeaderlessPriceListRows(rows, 'פוליבה', meta);
    assertEqual(entries.filter((e) => e.materialName === 'סוכר').length, 2);
    const sugarCurrent = entries.find((e) => e.materialName === 'סוכר' && e.price === 3.1);
    assertOk(sugarCurrent);
    assertEqual(sugarCurrent.unit, 'ק"ג');
    assertEqual(sugarCurrent.packageWeightGrams, 1000);
    assertEqual(sugarCurrent.supplierName, 'פוליבה');
    const sugarOld = entries.find((e) => e.materialName === 'סוכר' && e.price === 2.7);
    assertOk(sugarOld);
    assertEqual(sugarOld.effectiveDate, '2025-05-11');
  });

  test('pickHighestPricedMaterial — recipe pricing', () => {
    const offers = [
      { id: 1, name: 'סוכר', unitPrice: 3, packageWeightGrams: 1000, supplierId: 1 },
      { id: 2, name: 'סוכר', unitPrice: 5, packageWeightGrams: 1000, supplierId: 2 },
    ];
    const best = pickHighestPricedMaterial(offers);
    assertEqual(best.id, 2);
    const byName = buildMaterialsByNameKey(offers);
    const matById = new Map(offers.map((m) => [m.id, m]));
    const ing = { name: 'סוכר', quantity: 2, unitKind: 'kg', priceSource: 'max' };
    const { mat, priceSource } = resolveRecipeIngredientMaterial(ing, { matById, byNameKey: byName });
    assertEqual(priceSource, 'max');
    assertEqual(mat.id, 2);
    assertEqual(computeIngredientLineCost(ing, mat), 10);
    assertEqual(getIngredientPriceSource({ priceSource: 'supplier', rawMaterialId: 1 }), 'supplier');
  });

  test('pickRecipeDefaultMaterial — ברירת מחדל לספק במתכונים', () => {
    const offers = [
      { id: 1, name: 'סוכר', unitPrice: 3, packageWeightGrams: 1000, supplierId: 1, isRecipeDefault: true },
      { id: 2, name: 'סוכר', unitPrice: 5, packageWeightGrams: 1000, supplierId: 2 },
    ];
    assertEqual(pickRecipeDefaultMaterial(offers).id, 1);
    const byName = buildMaterialsByNameKey(offers);
    const matById = new Map(offers.map((m) => [m.id, m]));
    const auto = resolveRecipeIngredientMaterial(
      { name: 'סוכר', quantity: 1, unitKind: 'kg', priceSource: 'max' },
      { matById, byNameKey: byName },
    );
    assertEqual(auto.mat.id, 1);
    assertEqual(auto.usedRecipeDefault, true);
    assertEqual(computeIngredientLineCost({ name: 'סוכר', quantity: 2, unitKind: 'kg' }, auto.mat), 6);
    const pinned = resolveRecipeIngredientMaterial(
      { name: 'סוכר', quantity: 1, unitKind: 'kg', priceSource: 'supplier', rawMaterialId: 2 },
      { matById, byNameKey: byName },
    );
    assertEqual(pinned.mat.id, 2);
    assertEqual(pinned.priceSource, 'supplier');
  });

  test('detectImportPriceBasis — מזהה מחירון שרשם מחיר לק"ג', () => {
    // מחירון 28.6: מספרים קטנים מול אריזות גדולות, ולכן המחיר לק"ג יוצא אגורות
    const perKgSheet = [
      { materialName: 'מלח', price: 1.8, packageWeightGrams: 12000 },
      { materialName: 'שומן קוקוס', price: 11, packageWeightGrams: 25000 },
      { materialName: 'עמילן נמס', price: 15, packageWeightGrams: 15000 },
      { materialName: 'קרם פטסייר', price: 17.9, packageWeightGrams: 8000 },
    ];
    assertEqual(detectImportPriceBasis(perKgSheet), PRICE_BASIS_PER_KG);

    const packageSheet = [
      { materialName: 'ביצים מעורב', price: 277.5, packageWeightGrams: 15000 },
      { materialName: 'סולת', price: 132.5, packageWeightGrams: 25000 },
      { materialName: 'קוקוס', price: 635.6, packageWeightGrams: 45400 },
      { materialName: 'מחית תפוחים', price: 136, packageWeightGrams: 17000 },
    ];
    assertEqual(detectImportPriceBasis(packageSheet), PRICE_BASIS_PACKAGE);

    // בלי מספיק שורות משמעותיות נשארים בהתנהגות הקיימת
    assertEqual(detectImportPriceBasis([{ materialName: 'סוכר', price: 2.7 }]), PRICE_BASIS_PACKAGE);
    assertEqual(detectImportPriceBasis([]), PRICE_BASIS_PACKAGE);
  });

  test('applyImportPriceBasis — מחיר לק"ג הופך למחיר אריזה', () => {
    const entries = [
      { materialName: 'מלח', price: 1.8, packageWeightGrams: 12000 },
      { materialName: 'מרגרינה', price: 6.9, packageWeightGrams: null },
      { materialName: 'ריק', price: null, packageWeightGrams: 5000 },
    ];
    const converted = applyImportPriceBasis(entries, PRICE_BASIS_PER_KG);
    assertEqual(converted[0].price, 21.6);
    assertEqual(converted[1].price, 6.9);
    assertEqual(converted[2].price, null);
    assertEqual(applyImportPriceBasis(entries, PRICE_BASIS_PACKAGE)[0].price, 1.8);

    const sample = previewImportPriceBasis(entries, PRICE_BASIS_PER_KG)[0];
    assertEqual(sample.pricePerKg, 1.8);
    assertEqual(sample.packagePrice, 21.6);
    assertEqual(previewImportPriceBasis(entries, PRICE_BASIS_PACKAGE)[0].pricePerKg, 0.15);
  });

  test('computeIngredientLineCost — שורה בליטרים מתומחרת לפי המחיר לק"ג', () => {
    const mat = { id: 1, name: 'ביצים מעורב', unitPrice: 277.5, packageWeightGrams: 15000 };
    assertEqual(computeIngredientLineCost({ quantity: 6, unitKind: 'l' }, mat), 111);
    assertEqual(computeIngredientLineCost({ quantity: 6, unit: 'ליטר' }, mat), 111);
    assertEqual(computeIngredientLineCost({ quantity: 1.5, unitKind: 'kg' }, mat), 27.75);
    assertEqual(computeIngredientLineCost({ quantity: 500, unitKind: 'g' }, mat), 9.25);
    const noPackage = { id: 2, name: 'מרגרינה', unitPrice: 6.9, packageWeightGrams: null };
    assertEqual(computeIngredientLineCost({ quantity: 2, unitKind: 'l' }, noPackage), 13.8);
  });

  test('isFreeMaterial — מים וקרח הם עלות אפס ולא מחיר חסר', () => {
    const water = { id: 1, name: 'מים', unitPrice: 0, isFree: true };
    assertOk(isFreeMaterial(water));
    assertEqual(getMaterialEffectivePricePerKg(water), 0);
    assertEqual(computeIngredientLineCost({ quantity: 20, unitKind: 'l' }, water), 0);
    const missing = { id: 2, name: 'גזר', unitPrice: 0 };
    assertOk(!isFreeMaterial(missing));
    assertEqual(getMaterialEffectivePricePerKg(missing), null);
    const priced = { id: 3, name: 'סוכר', unitPrice: 67.5, packageWeightGrams: 25000, isFree: true };
    assertEqual(getMaterialEffectivePricePerKg(priced), 0);
  });

  test('buildMergedMaterialSynonyms — שמות שונים הופכים למילים נרדפות', () => {
    const keep = { id: 1, name: 'סוכר', synonyms: ['סכר'] };
    const others = [
      { id: 2, name: 'סוכר לבן', synonyms: ['white sugar'] },
      { id: 3, name: 'סוכר', synonyms: [] },
    ];
    const syns = buildMergedMaterialSynonyms(keep, others);
    assertOk(syns.includes('סוכר לבן'));
    assertOk(syns.includes('סכר'));
    assertOk(syns.includes('white sugar'));
    assertOk(!syns.some((s) => normalizeMaterialKey(s) === 'סוכר'));
    const bySyn = buildMaterialsByNameKey([
      { id: 1, name: 'סוכר', unitPrice: 4, packageWeightGrams: 1000, synonyms: ['סוכר לבן'] },
    ]);
    assertEqual(bySyn.get('סוכר לבן')?.[0]?.id, 1);
  });

  test('shouldPreserveMaterialAsSupplierOffer — רק ספק אחר עם מחיר כשיש ליעד ספק', () => {
    const keep = { id: 1, name: 'סוכר', supplierId: 10, unitPrice: 20, packageWeightGrams: 1000 };
    assertOk(shouldPreserveMaterialAsSupplierOffer(keep, {
      id: 2, name: 'סוכר לבן', supplierId: 20, unitPrice: 18, packageWeightGrams: 25000,
    }));
    assertOk(!shouldPreserveMaterialAsSupplierOffer(keep, {
      id: 3, name: 'סוכר בלי מחיר', supplierId: 20, unitPrice: 0,
    }));
    assertOk(!shouldPreserveMaterialAsSupplierOffer(keep, {
      id: 4, name: 'סוכר אותו ספק', supplierId: 10, unitPrice: 22,
    }));
    assertOk(!shouldPreserveMaterialAsSupplierOffer(keep, {
      id: 5, name: 'סוכר בלי ספק', supplierId: null, unitPrice: 15,
    }));
    // בלי ספק ביעד — קודם סופגים ליעד (לא משאירים הכל כהצעות)
    assertOk(!shouldPreserveMaterialAsSupplierOffer(
      { id: 1, name: 'סוכר', supplierId: null, unitPrice: 0 },
      { id: 6, name: 'סוכר פוליבה', supplierId: 30, unitPrice: 12, packageWeightGrams: 5000 },
    ));
  });

  test('classifyMaterialsForMerge — יעד בלי ספק סופג הצעה ראשונה ואז שומר ספקים אחרים', () => {
    const keep = { id: 1, name: 'סוכר', supplierId: null, unitPrice: 0 };
    const a = { id: 2, name: 'סוכר א', supplierId: 10, unitPrice: 12, packageWeightGrams: 1000 };
    const b = { id: 3, name: 'סוכר ב', supplierId: 20, unitPrice: 15, packageWeightGrams: 5000 };
    const c = { id: 4, name: 'סוכר ג', supplierId: 20, unitPrice: 14, packageWeightGrams: 5000 };
    const d = { id: 5, name: 'בלי מחיר', supplierId: 30, unitPrice: 0 };
    const { absorbIntoKeep, preserve, absorbIntoOffer } = classifyMaterialsForMerge(keep, [a, b, c, d]);
    assertOk(absorbIntoKeep.some((m) => m.id === 2), 'ההצעה הראשונה נספגת ליעד');
    assertOk(absorbIntoKeep.some((m) => m.id === 5), 'בלי מחיר נספג');
    assertEqual(preserve.length, 1);
    assertEqual(preserve[0].id, 3);
    assertEqual(absorbIntoOffer.length, 1);
    assertEqual(absorbIntoOffer[0].mat.id, 4);
    assertEqual(absorbIntoOffer[0].target.id, 3);
  });

  test('materialFieldFillPatch — לא דורס יעד ולא מעתיק אריזה מספק אחר כששומרים הצעות', () => {
    const keep = {
      id: 1, name: 'סוכר', supplierId: 10, unitPrice: 20, packageWeightGrams: 1000, unit: 'ק"ג',
    };
    const others = [
      { id: 2, name: 'סוכר לבן', supplierId: 20, unitPrice: 50, packageWeightGrams: 25000, unit: 'שק' },
      { id: 3, name: 'סוכר כפול', supplierId: 10, unitPrice: 0, packageWeightGrams: null, processedPricePerKg: 8 },
    ];
    const preserved = materialFieldFillPatch(keep, others, { preserveCrossSupplierOffers: true });
    assertOk(preserved.unitPrice == null, 'לא לדרוס מחיר יעד ממחיר ספק אחר');
    assertOk(preserved.packageWeightGrams == null, 'לא להעתיק אריזה מספק אחר כשיש ליעד');
    assertEqual(preserved.processedPricePerKg, 8);

    const emptyKeep = { id: 1, name: 'סוכר', supplierId: 10, unitPrice: 0, packageWeightGrams: null };
    const fill = materialFieldFillPatch(emptyKeep, [
      { id: 2, supplierId: 10, unitPrice: 14, packageWeightGrams: 5000 },
      { id: 3, supplierId: 20, unitPrice: 99, packageWeightGrams: 99999 },
    ], { preserveCrossSupplierOffers: true });
    assertEqual(fill.unitPrice, 14);
    assertEqual(fill.packageWeightGrams, 5000);
  });

  test('pickMergeRecipeDefaultId — ברירת מחדל נשארת על ההצעה ששרדה', () => {
    const keep = { id: 1, name: 'סוכר', isRecipeDefault: false };
    const offerDefault = { id: 2, name: 'סוכר לבן', isRecipeDefault: true, supplierId: 20, unitPrice: 10 };
    const absorbed = { id: 3, name: 'סכר', isRecipeDefault: false };
    assertEqual(
      pickMergeRecipeDefaultId(keep, [offerDefault, absorbed], { preservedIds: [2] }),
      2,
    );
    assertEqual(
      pickMergeRecipeDefaultId({ ...keep, isRecipeDefault: true }, [offerDefault], { preservedIds: [2] }),
      1,
    );
    assertEqual(
      pickMergeRecipeDefaultId(keep, [{ ...offerDefault, id: 3, isRecipeDefault: true }], { preservedIds: [] }),
      1,
      'ברירת מחדל שנספגה → עוברת ליעד',
    );
  });

  test('resolveRecipeIngredientMaterial — אחרי איחוד ברירת מחדל מופיעה במתכון', () => {
    const offers = [
      { id: 1, name: 'סוכר', unitPrice: 10, packageWeightGrams: 1000, synonyms: ['סוכר לבן'], isRecipeDefault: false },
      { id: 2, name: 'סוכר', unitPrice: 7, packageWeightGrams: 1000, synonyms: ['סוכר לבן'], isRecipeDefault: true },
    ];
    const matById = new Map(offers.map((m) => [m.id, m]));
    const byNameKey = buildMaterialsByNameKey(offers);
    const resolved = resolveRecipeIngredientMaterial(
      { name: 'סוכר לבן', quantity: 1, unit: 'ק"ג', priceSource: 'max' },
      { matById, byNameKey },
    );
    assertEqual(resolved.mat?.id, 2, 'ברירת מחדל גוברת על מחיר גבוה יותר');
    assertOk(resolved.usedRecipeDefault);
  });

  test('getMaterialPortionProductIds — מערך מוצרים עם נפילה לשדה הישן', () => {
    assertEqual(getMaterialPortionProductIds(null).length, 0);
    assertEqual(getMaterialPortionProductIds({ portionProductId: 7 }).join(','), '7');
    assertEqual(getMaterialPortionProductIds({ portionProductIds: [3, 5, 3], portionProductId: 7 }).join(','), '3,5');
    assertEqual(getMaterialPortionProductIds({ portionProductIds: [], portionProductId: 9 }).join(','), '9');
    assertEqual(getMaterialPortionProductIds({ portionProductIds: [null, 'x', 4] }).join(','), '4');
  });

  test('rowFingerprint — מרכיב מתכון כולל חומר גלם (למניעת מיזוג ב-pull)', () => {
    const a = rowFingerprint('recipeIngredients', { recipeId: 5, name: 'קמח', sortOrder: 1, rawMaterialId: 10 });
    const b = rowFingerprint('recipeIngredients', { recipeId: 5, name: 'קמח', sortOrder: 1, rawMaterialId: 99 });
    assertOk(a !== b, 'different material must not match during pull');
  });

  test('rowDedupeFingerprint — מרכיב מתכון מתעלם מחומר גלם', () => {
    const a = rowDedupeFingerprint('recipeIngredients', { recipeId: 5, name: 'קמח', sortOrder: 1, rawMaterialId: 10 });
    const b = rowDedupeFingerprint('recipeIngredients', { recipeId: 5, name: 'קמח', sortOrder: 1, rawMaterialId: 99 });
    assertEqual(a, b, 'same line with different material must be a duplicate for dedupe');
    const c = rowDedupeFingerprint('recipeIngredients', { recipeId: 5, name: 'קמח', sortOrder: 2, rawMaterialId: 10 });
    assertOk(a !== c, 'different sortOrder is a different line');
  });

  test('rowFingerprint — קישורי מנות וסקופים של אפייה', () => {
    assertEqual(
      rowFingerprint('portionPresetLinks', { portionPresetId: 3, linkType: 'product', targetId: 42 }),
      'portionPresetLinks|3|product|42',
    );
    assertEqual(
      rowFingerprint('bakingProfileScopes', { bakingProfileId: 2, scopeType: 'category', scopeId: 7 }),
      'bakingProfileScopes|2|category|7',
    );
    assertEqual(rowFingerprint('portionPresetLinks', { linkType: 'product', targetId: 42 }), '');
  });

  test('rowFingerprint — שיוך מוצר לתזרים מנרמל id מספרי', () => {
    assertEqual(
      rowFingerprint('productFlowLinks', { productId: 5, flowId: 3 }),
      'productFlowLinks|5|3',
    );
    assertEqual(
      rowFingerprint('productFlowLinks', { productId: '5', flowId: '3' }),
      rowFingerprint('productFlowLinks', { productId: 5, flowId: 3 }),
    );
  });

  test('rowFingerprint — לכל טבלת קישור יש מזהה השוואה', () => {
    const rows = {
      targets: { scope: 'product', scopeId: 4, period: '2026-07' },
      processLogs: { date: '2026-07-21', categoryId: 2, activity: 'ניקיון' },
      activityPresets: { name: 'שטיפה', categoryId: 2 },
      flowPortionPresets: { flowId: 3, name: 'מנה', sortOrder: 1 },
      groupPortionPresets: { name: 'מנה', categoryGroupId: 1, sourceRecipeId: 8 },
      groupPreparations: { name: 'הכנה', categoryGroupId: 1, categoryId: 2 },
      checklistTasks: { name: 'בדיקה', categoryGroupId: 1, categoryId: 2 },
      flowChecklistItems: { flowId: 3, checklistTaskId: 9 },
      flowCleaningTasks: { flowId: 3, name: 'ניקוי תנור' },
      productPreparations: { productId: 5, name: 'הפשרה' },
      bakingProfileProducts: { bakingProfileId: 2, productId: 5 },
      productionMachineFields: { machineId: 1, name: 'טמפרטורה' },
      productionMachineProducts: { machineId: 1, targetType: 'product', productId: 5 },
      productionMachineProductValues: { assignmentId: 4, fieldId: 6 },
      supplierShortages: { supplierId: 2, rawMaterialId: 11 },
      weeklyProductionPlanItems: { planId: 3, productId: 5 },
      managerPlans: { planType: 'weekly', anchorDate: '2026-07-20' },
      managerPlanItems: {
        planType: 'weekly', anchorDate: '2026-07-20', dayOffset: 1, itemKind: 'text', label: 'לבדוק מלאי',
      },
      managerTasks: { createdAt: '2026-07-21T08:00:00', department: 'bakery', title: 'לתקן מיקסר' },
      managerIncidents: { createdAt: '2026-07-21T08:00:00', department: 'bakery', title: 'תקלה' },
      managerShiftNotes: { createdAt: '2026-07-21T08:00:00', date: '2026-07-21', department: 'bakery' },
      managerEmployees: { name: 'דנה', responsibilityAreaId: 3 },
      departmentCleaningTasks: { listId: 2, name: 'רצפה' },
      purchaseItems: { name: 'שקיות', categoryId: 4 },
    };
    for (const [collection, row] of Object.entries(rows)) {
      assertOk(isSyncCollection(collection), `${collection} אמור להיות בטבלאות הסנכרון`);
      assertOk(rowFingerprint(collection, row), `${collection} חייב מזהה השוואה`);
    }
  });

  test('rowFingerprint — טבלאות ניהול מפרידות בין שורות שונות', () => {
    const task = { createdAt: '2026-07-21T08:00:00', department: 'bakery', title: 'לתקן מיקסר' };
    assertOk(
      rowFingerprint('managerTasks', task)
        !== rowFingerprint('managerTasks', { ...task, createdAt: '2026-07-21T09:00:00' }),
      'שתי משימות בשעות שונות אינן אותה שורה',
    );
    assertOk(
      rowFingerprint('managerTasks', task) !== rowFingerprint('managerIncidents', task),
      'משימה ותקלה לא מתמזגות',
    );
    const item = {
      planType: 'weekly', anchorDate: '2026-07-20', dayOffset: 1, itemKind: 'text', label: 'לבדוק מלאי',
    };
    assertOk(
      rowFingerprint('managerPlanItems', item)
        !== rowFingerprint('managerPlanItems', { ...item, dayOffset: 2 }),
      'אותו טקסט ביום אחר אינו אותה שורה',
    );
    assertEqual(rowFingerprint('managerTasks', { department: 'bakery', title: 'ללא זמן' }), '');
  });

  test('rowDedupeFingerprint — משימות צ׳קליסט לפי שם+קבוצה+קטגוריה', () => {
    const a = rowDedupeFingerprint('checklistTasks', {
      name: 'הכנת בצק', categoryGroupId: 1, categoryId: 5,
    });
    const b = rowDedupeFingerprint('checklistTasks', {
      name: ' הכנת בצק ', categoryGroupId: 1, categoryId: 5,
    });
    assertEqual(a, b);
    assertOk(
      rowDedupeFingerprint('checklistTasks', {
        name: 'הכנת בצק', categoryGroupId: 1, categoryId: 5,
      }) !== rowDedupeFingerprint('checklistTasks', {
        name: 'הכנת בצק', categoryGroupId: 1, categoryId: 9,
      }),
    );
  });

  test('rowDedupeFingerprint — צ׳קליסט ריצה לפי שם ולא לפי id משימה', () => {
    const a = rowDedupeFingerprint('runPreparationChecks', {
      runId: 3, flowPreparationId: 10, name: 'הכנת בצק',
    });
    const b = rowDedupeFingerprint('runPreparationChecks', {
      runId: 3, flowPreparationId: 99, name: 'הכנת בצק',
    });
    assertEqual(a, b);
  });

  test('rowDedupeFingerprint — רישומי ייצור מתעלמים מ-runId', () => {
    const withRun = rowDedupeFingerprint('productionEntries', {
      date: '2026-07-21', productId: 5, quantity: 1050, runId: 9,
    });
    const nullRun = rowDedupeFingerprint('productionEntries', {
      date: '2026-07-21', productId: 5, quantity: 1050, runId: null,
    });
    assertEqual(withRun, nullRun);
    assertEqual(withRun, 'productionEntries|2026-07-21|5|1050');
    assertEqual(
      rowDedupeFingerprint('productionEntries', {
        date: '2026-07-21', productId: 5, quantity: '1050', runId: null,
      }),
      withRun,
    );
    assertOk(
      rowFingerprint('productionEntries', {
        date: '2026-07-21', productId: 5, quantity: 1050, runId: 9,
      }) !== rowFingerprint('productionEntries', {
        date: '2026-07-21', productId: 5, quantity: 1050, runId: null,
      }),
      'pull-match fingerprint still distinguishes runId',
    );
  });

  test('isValidISODate — סינון חודש דורש תאריך מלא', () => {
    assertOk(isValidISODate('2026-07-01'));
    assertOk(!isValidISODate('2026-07'));
    assertOk(!isValidISODate('2026-07-1'));
    const prefix = '2026-07';
    const dates = ['2026-07-01', '2026-06-30', '2026-07', 'bad'];
    const filtered = dates.filter((d) => isValidISODate(d) && d.startsWith(prefix));
    assertEqual(filtered.join(','), '2026-07-01');
  });

  test('POLYMORPHIC_FKS — מיפוי יעדים לפי סוג', () => {
    assertEqual(POLYMORPHIC_FKS.portionPresetLinks.targets.product, 'products');
    assertEqual(POLYMORPHIC_FKS.portionPresetLinks.targets.category, 'categories');
    assertEqual(POLYMORPHIC_FKS.portionPresetLinks.targets.group, 'categoryGroups');
    assertEqual(POLYMORPHIC_FKS.bakingProfileScopes.idField, 'scopeId');
    assertEqual(POLYMORPHIC_FKS.bakingProfileScopes.typeField, 'scopeType');
  });

  test('shouldApplyRemote — last-write-wins', () => {
    assertOk(shouldApplyRemote(null, '2026-07-24T10:00:00.000Z'));
    assertOk(shouldApplyRemote('2026-07-24T09:00:00.000Z', '2026-07-24T10:00:00.000Z'));
    assertOk(!shouldApplyRemote('2026-07-24T11:00:00.000Z', '2026-07-24T10:00:00.000Z'));
    assertOk(shouldApplyRemote('2026-07-24T10:00:00.000Z', '2026-07-24T10:00:00.000Z'));
  });

  test('sync collections registry — כל האוספים ממופים לטבלה', () => {
    const ordered = orderedCollections();
    assertOk(ordered.length >= 40);
    assertOk(isSyncCollection('rawMaterials'));
    assertOk(isSyncCollection('products'));
    assertEqual(COLLECTION_TABLE.rawMaterials, 'sync_raw_materials');
    assertEqual(COLLECTION_TABLE.settings, 'sync_app_settings');
    for (const c of ordered) {
      assertOk(!!COLLECTION_TABLE[c], `missing table for ${c}`);
    }
  });

  test('HACCP — workspace מלא כולל PRP ויומן ניטור', () => {
    assertEqual(WORKSPACES.haccp?.defaultScreen, 'haccp');
    assertOk(HACCP_STEPS.some((s) => s.id === 'prp' && s.status === 'available'));
    assertOk(HACCP_STEPS.some((s) => s.id === 'hazard' && s.status === 'available'));
    assertOk(HACCP_STEPS.some((s) => s.id === 'ccp' && s.status === 'available'));
    assertOk(HACCP_STEPS.some((s) => s.id === 'limits' && s.status === 'available'));
    assertOk(HACCP_STEPS.some((s) => s.id === 'monitoring' && s.status === 'available'));
    assertOk(HACCP_STEPS.some((s) => s.id === 'monitor_log' && s.status === 'available'));
    assertOk(HACCP_STEPS.some((s) => s.id === 'corrective' && s.status === 'available'));
    assertOk(HACCP_STEPS.some((s) => s.id === 'verification' && s.status === 'available'));
    assertOk(HACCP_STEPS.some((s) => s.id === 'documentation' && s.status === 'available'));
    assertOk(HACCP_PRP_TOPICS.length >= 10);
    assertOk(HACCP_PRP_TOPICS.every((t) => t.id && t.label));
    assertOk(isSyncCollection('haccpHazards'));
    assertOk(isSyncCollection('haccpCcps'));
    assertOk(isSyncCollection('haccpCriticalLimits'));
    assertOk(isSyncCollection('haccpMonitoring'));
    assertOk(isSyncCollection('haccpMonitoringLogs'));
    assertOk(isSyncCollection('haccpCorrectiveActions'));
    assertOk(isSyncCollection('haccpVerificationProcs'));
    assertOk(isSyncCollection('haccpDocuments'));
    assertOk(isSyncCollection('haccpPrpControls'));
    assertEqual(COLLECTION_TABLE.haccpCcps, 'sync_haccp_ccps');
    assertEqual(COLLECTION_TABLE.haccpCriticalLimits, 'sync_haccp_critical_limits');
    assertEqual(COLLECTION_TABLE.haccpMonitoring, 'sync_haccp_monitoring');
    assertEqual(COLLECTION_TABLE.haccpMonitoringLogs, 'sync_haccp_monitoring_logs');
    assertEqual(COLLECTION_TABLE.haccpCorrectiveActions, 'sync_haccp_corrective_actions');
    assertEqual(COLLECTION_TABLE.haccpVerificationProcs, 'sync_haccp_verification_procs');
    assertEqual(COLLECTION_TABLE.haccpDocuments, 'sync_haccp_documents');
    assertEqual(COLLECTION_TABLE.haccpPrpControls, 'sync_haccp_prp_controls');
    assertEqual(
      rowFingerprint('haccpCcps', {
        planId: 7,
        flowStepId: 3,
        name: 'אפייה',
        code: 'CCP-1',
        decision: 'ccp',
        hazardId: 9,
      }),
      'haccpCcps|7|3|CCP-1|ccp|9',
    );
    assertEqual(
      rowFingerprint('haccpCriticalLimits', {
        planId: 7,
        ccpId: 2,
        parameter: 'core_temp',
        operator: 'gte',
        value: '75',
        valueText: '',
      }),
      'haccpCriticalLimits|7|2|core_temp|gte|75|',
    );
    assertEqual(
      rowFingerprint('haccpMonitoring', {
        planId: 7,
        ccpId: 2,
        limitId: 5,
        what: 'טמפרטורת ליבה',
        method: 'thermometer',
        frequency: 'every_batch',
      }),
      'haccpMonitoring|7|2|5|טמפרטורת ליבה|thermometer|every_batch',
    );
    assertEqual(
      rowFingerprint('haccpMonitoringLogs', {
        planId: 7,
        ccpId: 2,
        recordedAt: '2026-08-04T10:30',
        result: 'ok',
        value: '76',
        batchCode: 'A1',
      }),
      'haccpMonitoringLogs|7|2|2026-08-04T10:30|ok|76|a1',
    );
    assertEqual(
      rowFingerprint('haccpCorrectiveActions', {
        planId: 7,
        ccpId: 2,
        limitId: 5,
        deviation: 'חריגה מטמפרטורה',
        immediateAction: 'עצירת תהליך',
        productDisposition: 'hold_evaluate',
      }),
      'haccpCorrectiveActions|7|2|5|חריגה מטמפרטורה|עצירת תהליך|hold_evaluate',
    );
    assertEqual(
      rowFingerprint('haccpVerificationProcs', {
        planId: 7,
        ccpId: null,
        method: 'records_review',
        activity: 'סקירת רשומות ניטור',
        frequency: 'weekly',
      }),
      'haccpVerificationProcs|7||records_review|סקירת רשומות ניטור|weekly',
    );
    assertEqual(
      rowFingerprint('haccpDocuments', {
        planId: 7,
        docKind: 'monitoring',
        title: 'טופס ניטור CCP',
        retentionYears: 2,
      }),
      'haccpDocuments|7|monitoring|טופס ניטור ccp|2',
    );
    assertEqual(
      rowFingerprint('haccpPrpControls', {
        planId: 7,
        topicId: 'hygiene',
        status: 'implemented',
        procedureSummary: 'הדרכת היגיינה וצ׳קליסט כניסה',
      }),
      'haccpPrpControls|7|hygiene|implemented|הדרכת היגיינה וצ׳קליסט כניסה',
    );
    assertEqual(
      formatCriticalLimit({ parameter: 'core_temp', operator: 'gte', value: '75', unit: '°C' }),
      'טמפרטורת ליבה: ≥ 75 °C',
    );
    assertEqual(haccpMonitorMethodLabel('thermometer'), 'מדידת טמפרטורה (מדחום / גשוש)');
    assertEqual(haccpMonitorFrequencyLabel('every_batch'), 'כל אצווה / כל ייצור');
    assertEqual(haccpProductDispositionLabel('hold_evaluate'), 'החזקה / הערכה (מעוכב)');
    assertEqual(haccpVerificationMethodLabel('observation'), 'תצפית ישירה');
    assertEqual(haccpVerificationFrequencyLabel('after_deviation'), 'בעקבות חריגה / פעולה מתקנת');
    assertEqual(haccpDocKindLabel('calibration'), 'יומן כיול ציוד מדידה');
    assertEqual(haccpDocFormatLabel('both'), 'נייר + דיגיטלי');
    assertEqual(haccpMonitorLogResultLabel('deviation'), 'חריגה');
    assertEqual(haccpPrpTopicLabel('allergens'), 'ניהול אלרגנים');
    assertEqual(haccpPrpStatusLabel('implemented'), 'מיושם');
  });

  test('userRoleLabel — תרגום תפקידים לעברית', () => {
    assertEqual(userRoleLabel('production'), 'ייצור');
    assertEqual(userRoleLabel('quality'), 'איכות');
    assertEqual(userRoleLabel('manager'), 'מנהל');
    assertEqual(userRoleLabel('admin'), 'מנהל מערכת');
    assertEqual(userRoleLabel('unknown'), 'ייצור');
  });

  test('userStatusLabel — סטטוס חשבון', () => {
    assertEqual(userStatusLabel('pending'), 'ממתין לאישור');
    assertEqual(userStatusLabel('active'), 'פעיל');
    assertEqual(userStatusLabel('rejected'), 'נדחה');
  });

  test('permissions — allowedWorkspaces לפי תפקיד + עמדת חשבונות', () => {
    assertEqual(allowedWorkspaces('production').sort().join(','), 'haccp,lots,productCatalog,production,recipes');
    assertEqual(allowedWorkspaces('quality').sort().join(','), 'haccp,inventory,lots,productCatalog,production,recipes,suppliers');
    assertEqual(allowedWorkspaces('manager').sort().join(','), 'accounts,haccp,inventory,lots,manager,productCatalog,production,recipes,suppliers');
    assertEqual(allowedWorkspaces('admin').sort().join(','), 'accounts,haccp,inventory,lots,manager,productCatalog,production,recipes,suppliers');
    assertEqual(allowedWorkspaces('unknown-role').sort().join(','), 'haccp,lots,productCatalog,production,recipes');
  });

  test('permissions — workspace_access מותאם גובר על תפקיד', () => {
    assertEqual(
      allowedWorkspaces('production', ['inventory', 'suppliers', 'bogus']).sort().join(','),
      'inventory,suppliers',
    );
    assertOk(canAccessWorkspace('production', 'inventory', ['inventory', 'production']));
    assertOk(!canAccessWorkspace('production', 'recipes', ['inventory', 'production']));
    assertOk(canAccessWorkspace('production', 'recipes', null));
  });

  test('permissions — sanitizeWorkspaceAccess', () => {
    assertEqual(sanitizeWorkspaceAccess(null), null);
    assertEqual(sanitizeWorkspaceAccess([]), null);
    assertEqual(sanitizeWorkspaceAccess(['production', 'production', 'nope']).join(','), 'production');
    assertEqual(defaultWorkspacesForRole('quality').includes('inventory'), true);
    assertEqual(workspaceLabel('haccp'), 'HACCP');
  });

  test('permissions — canAccessWorkspace וחשבונות למנהל בלבד', () => {
    assertOk(canAccessWorkspace('production', 'production'));
    assertOk(canAccessWorkspace('production', 'recipes'));
    assertOk(canAccessWorkspace('production', 'haccp'));
    assertOk(canAccessWorkspace('production', 'lots'));
    assertOk(!canAccessWorkspace('production', 'inventory'));
    assertOk(!canAccessWorkspace('production', 'suppliers'));
    assertOk(!canAccessWorkspace('production', 'manager'));
    assertOk(!canAccessWorkspace('production', 'accounts'));

    assertOk(canAccessWorkspace('quality', 'suppliers'));
    assertOk(canAccessWorkspace('quality', 'lots'));
    assertOk(canAccessWorkspace('quality', 'inventory'));
    assertOk(!canAccessWorkspace('quality', 'manager'));
    assertOk(!canAccessWorkspace('quality', 'accounts'));

    assertOk(canAccessWorkspace('manager', 'manager'));
    assertOk(canAccessWorkspace('manager', 'suppliers'));
    assertOk(canAccessWorkspace('manager', 'accounts'));
    assertOk(canAccessWorkspace('manager', 'lots'));
    assertOk(canAccessWorkspace('manager', 'inventory'));
    assertOk(canAccessWorkspace('admin', 'accounts'));
  });

  test('permissions — canManageAccounts', () => {
    assertOk(!canManageAccounts('production'));
    assertOk(!canManageAccounts('quality'));
    assertOk(canManageAccounts('manager'));
    assertOk(canManageAccounts('admin'));
  });

  test('workspaces — עמדת accounts ו-lots ו-inventory קיימות', () => {
    assertEqual(WORKSPACES.accounts?.defaultScreen, 'accounts');
    assertEqual(WORKSPACES.accounts?.label, 'חשבונות');
    assertEqual(WORKSPACES.lots?.defaultScreen, 'lots');
    assertEqual(WORKSPACES.lots?.label, 'מעקב אצוות');
    assertEqual(WORKSPACES.inventory?.defaultScreen, 'inventory');
    assertEqual(WORKSPACES.inventory?.label, 'מלאי');
  });

  test('lotTraceEmptyHint — טקסט הדרכה', () => {
    assertOk(lotTraceEmptyHint().includes('אצווה'));
  });

  test('sync — inventoryBalances במפה', () => {
    assertEqual(COLLECTION_TABLE.inventoryBalances, 'sync_inventory_balances');
    assertEqual(COLLECTION_TABLE.inventoryMovements, 'sync_inventory_movements');
    assertOk(SYNC_ORDER.includes('inventoryBalances'));
    assertOk(SYNC_ORDER.includes('inventoryMovements'));
  });

  test('inventoryMovementKindLabel', async () => {
    const { inventoryMovementKindLabel, formatWhatsAppGapOrderText } = await import('../js/inventory-db.js?v=450');
    assertEqual(inventoryMovementKindLabel('receive'), 'קבלה');
    assertEqual(inventoryMovementKindLabel('issue'), 'ניפוק');
    assertEqual(inventoryMovementKindLabel('set'), 'הגדרה');
    const text = formatWhatsAppGapOrderText({
      weekStart: '2026-08-02',
      rows: [{ name: 'קמח', gap: 3, orderQty: 3, unit: 'ק\"ג', needed: 10, qtyOnHand: 7, supplierCategoryName: 'יבשים' }],
    });
    assertOk(text.includes('קמח'));
    assertOk(text.includes('להזמין 3'));
  });

  test('receiveShortageToInventory — דורש מזהה', async () => {
    const { receiveShortageToInventory } = await import('../js/inventory-db.js?v=450');
    let threw = false;
    try {
      await receiveShortageToInventory(null);
    } catch (e) {
      threw = true;
      assertOk(String(e.message || e).includes('לא תקין') || String(e.message || e).includes('חוסר'));
    }
    assertOk(threw);
  });

  test('previewProductionStockIssue — דורש מספר מנות', async () => {
    const { previewProductionStockIssue, formatProductionIssueConfirm } = await import('../js/inventory-db.js?v=450');
    let threw = false;
    try {
      await previewProductionStockIssue({ portionCount: 0 });
    } catch (e) {
      threw = true;
      assertOk(String(e.message || e).includes('מנות'));
    }
    assertOk(threw);
    const empty = await previewProductionStockIssue({ portionCount: 2, recipeId: null });
    assertEqual(empty.lines.length, 0);
    const text = formatProductionIssueConfirm({
      lines: [{ name: 'קמח', qty: 2, unit: 'ק"ג', qtyOnHand: 5, shortfall: 0 }],
      skipped: [],
      hasShortfall: false,
    });
    assertOk(text.includes('קמח'));
    assertOk(text.includes('לנפק'));
  });

  test('permissions — canAccessHaccpStep: production רק overview + monitor_log', () => {
    assertOk(canAccessHaccpStep('production', 'overview'));
    assertOk(canAccessHaccpStep('production', 'monitor_log'));
    for (const stepId of ['prp', 'team', 'product', 'intended_use', 'flow', 'flow_verify', 'hazard', 'ccp', 'limits', 'monitoring', 'corrective', 'verification', 'documentation']) {
      assertOk(!canAccessHaccpStep('production', stepId), `production should not access ${stepId}`);
    }
    for (const role of ['quality', 'manager', 'admin']) {
      for (const step of HACCP_STEPS) {
        assertOk(canAccessHaccpStep(role, step.id), `${role} should access ${step.id}`);
      }
    }
  });

  test('permissions — canAccessScreen משלב workspace + haccp step', () => {
    assertOk(canAccessScreen('production', 'haccp', 'overview'));
    assertOk(canAccessScreen('production', 'haccp', 'monitor_log'));
    assertOk(!canAccessScreen('production', 'haccp', 'ccp'));
    assertOk(!canAccessScreen('production', 'suppliers', 'suppliers'));
    assertOk(canAccessScreen('quality', 'haccp', 'ccp'));
    assertOk(canAccessScreen('manager', 'manager', 'manager'));
    assertOk(canAccessScreen('manager', 'accounts', 'accounts'));
    assertOk(!canAccessScreen('quality', 'accounts', 'accounts'));
  });

  test('permissions — canAccessRecipeTab: production ללא עריכה', () => {
    assertOk(canAccessRecipeTab('production', 'browse'));
    assertOk(canAccessRecipeTab('production', 'baking'));
    assertOk(canAccessRecipeTab('production', 'ratio'));
    assertOk(canAccessRecipeTab('production', 'machines'));
    assertOk(canAccessRecipeTab('production', 'portions'));
    assertOk(!canAccessRecipeTab('production', 'edit'));
    assertOk(canAccessRecipeTab('quality', 'edit'));
    assertOk(canAccessRecipeTab('manager', 'edit'));
    assertOk(canAccessRecipeTab('admin', 'edit'));
  });

  test('permissions — canAccessBackupFull: manager/admin בלבד', () => {
    assertOk(!canAccessBackupFull('production'));
    assertOk(!canAccessBackupFull('quality'));
    assertOk(canAccessBackupFull('manager'));
    assertOk(canAccessBackupFull('admin'));
  });

  test('permissions — canEditRecipes / canManageFlows / canAdjustInventory', () => {
    assertOk(!canEditRecipes('production'));
    assertOk(canEditRecipes('quality'));
    assertOk(canEditRecipes('manager'));
    assertOk(canEditRecipes('admin'));
    assertOk(!canManageFlows('production'));
    assertOk(canManageFlows('quality'));
    assertOk(canManageFlows('manager'));
    assertOk(!canAdjustInventory('production'));
    assertOk(canAdjustInventory('quality'));
    assertOk(canAdjustInventory('admin'));
  });

  test('audit — תוויות ישות למתכונים ותזרימים', () => {
    assertEqual(auditEntityLabel('recipes'), 'מתכונים');
    assertEqual(auditEntityLabel('flows'), 'תזרימים');
    assertEqual(auditEntityLabel('recipeVersions'), 'גרסאות מתכון');
  });

  test('HACCP — דוח הדפסת תכנית', () => {
    const html = buildHaccpPlanPrintHtml({
      plan: { id: 1, name: 'עוגות', status: 'in_progress' },
      familyName: 'עוגות',
      members: [{ name: 'דני', role: 'quality', isLeader: true, authorityNotes: '' }],
      product: { composition: 'קמח סוכר ביצים' },
      intendedUse: { targetAudience: 'כללי' },
      flowSteps: [{ id: 10, name: 'אפייה', stepKind: 'baking', description: '' }],
      flowVerifications: [],
      hazards: [],
      ccps: [{ id: 2, code: 'CCP-1', name: 'אפייה', flowStepId: 10, decision: 'ccp', hazardDescription: 'חיידקים' }],
      limits: [{ ccpId: 2, parameter: 'core_temp', operator: 'gte', value: '75', unit: '°C' }],
      monitoring: [{ ccpId: 2, what: 'טמפ׳ ליבה', method: 'thermometer', frequency: 'every_batch', responsibleRole: 'production' }],
      monitoringLogs: [{
        ccpId: 2,
        recordedAt: '2026-08-04T10:30',
        value: '76',
        unit: '°C',
        result: 'ok',
        batchCode: 'B12',
        recordedByRole: 'production',
      }],
      corrective: [],
      verification: [],
      documents: [],
      prpControls: [{ topicId: 'hygiene', status: 'implemented', procedureSummary: 'צ׳קליסט', responsibleRole: 'quality' }],
      printedAt: '2026-08-04T12:00:00',
    });
    assertOk(html.includes('תכנית HACCP — עוגות'));
    assertOk(html.includes('CCP-1'));
    assertOk(html.includes('5.3 גבולות בקרה קריטיים'));
    assertOk(html.includes('5.4+ יומן ניטור'));
    assertOk(html.includes('76'));
    assertOk(html.includes('בתוך הגבול'));
    assertOk(html.includes('ניהול אלרגנים') === false); // not in this snapshot
    assertOk(html.includes('היגיינת עובדים'));
    assertOk(html.includes('<!DOCTYPE html>'));
  });

  test('HACCP — עץ החלטות Codex ל-CCP', () => {
    assertEqual(evaluateCcpDecisionTree({ q1: 'yes' }), 'prp');
    assertEqual(evaluateCcpDecisionTree({ q1: 'no', q2: 'no' }), 'modify_process');
    assertEqual(evaluateCcpDecisionTree({ q1: 'no', q2: 'yes', q3: 'yes' }), 'later_step');
    assertEqual(evaluateCcpDecisionTree({ q1: 'no', q2: 'yes', q3: 'no', q4: 'yes' }), 'ccp');
    assertEqual(evaluateCcpDecisionTree({ q1: 'no', q2: 'yes', q3: 'no', q4: 'no' }), 'modify_process');
    assertEqual(evaluateCcpDecisionTree({ q1: 'no', q2: 'yes' }), 'incomplete');
  });

  test('buildHaccpTeamRoleCoverage — ירוק/אדום לפי עמדות', () => {
    const empty = buildHaccpTeamRoleCoverage([]);
    assertOk(empty.slots.length >= 2);
    assertOk(empty.slots.every((s) => !s.done));
    assertOk(!empty.requiredDone);

    const filled = buildHaccpTeamRoleCoverage([
      { name: 'יוגב', role: 'quality', isLeader: true, active: true },
      { name: 'דני', role: 'production', isLeader: false, active: true },
    ]);
    assertOk(filled.slots.find((s) => s.id === 'leader')?.done);
    assertOk(filled.slots.find((s) => s.id === 'quality')?.done);
    assertOk(filled.slots.find((s) => s.id === 'production')?.done);
    assertOk(filled.requiredDone);
    assertOk(!filled.slots.find((s) => s.id === 'maintenance')?.done);
    assertEqual(filled.slots.find((s) => s.id === 'quality')?.names.join(','), 'יוגב');
  });

  test('HACCP — כלי בניית תכנית מיוצאים', async () => {
    const mod = await import('../js/haccp-db.js?v=450');
    assertOk(typeof mod.buildHaccpPlanDraft === 'function');
    assertOk(typeof mod.getHaccpPlanReadiness === 'function');
    assertOk(typeof mod.cloneHaccpPlan === 'function');
    assertOk(typeof mod.suggestCorrectiveNoteForDeviation === 'function');
    assertOk(typeof mod.getHaccpWizardState === 'function');
    assertOk(typeof mod.createHaccpPlanFromBakeryTemplate === 'function');
    assertOk(typeof mod.seedBakeryTeamDefaults === 'function');
    assertOk(typeof mod.seedBakeryIntendedUse === 'function');
    assertOk(typeof mod.buildHaccpDeviationDashboard === 'function');
    assertOk(typeof mod.getHaccpDeviationDashboard === 'function');
    assertOk(typeof mod.ensureCorrectiveProcedureForCcp === 'function');
    assertOk(typeof mod.seedBakeryProductDefaults === 'function');
    assertOk(typeof mod.seedBakeryTemplateFlow === 'function');
    assertOk(typeof mod.getHaccpBakeryTemplate === 'function');
    assertOk(Array.isArray(mod.HACCP_WIZARD_STEPS));
    assertOk(Array.isArray(mod.HACCP_BAKERY_TEMPLATES));
    assertOk(mod.HACCP_BAKERY_TEMPLATES.length >= 4);
    assertEqual(mod.getHaccpBakeryTemplate('cakes').id, 'cakes');
    assertOk(mod.getHaccpBakeryTemplate('creams').flowSteps.length > 0);
    assertOk(mod.HACCP_WIZARD_STEPS.includes('team'));
    assertOk(mod.HACCP_WIZARD_STEPS.includes('documentation'));
    assertOk(!mod.HACCP_WIZARD_STEPS.includes('overview'));
    assertOk(!mod.HACCP_WIZARD_STEPS.includes('monitor_log'));
  });

  test('HACCP — תבניות מאפייה לפי סוג', async () => {
    const mod = await import('../js/haccp-db.js?v=450');
    const ids = mod.HACCP_BAKERY_TEMPLATES.map((t) => t.id).sort().join(',');
    assertEqual(ids, 'cakes,creams,doughs,general');
    for (const t of mod.HACCP_BAKERY_TEMPLATES) {
      assertOk(!!t.label);
      assertOk(!!t.intendedUse?.targetAudience);
      assertOk(!!t.productDefaults);
    }
    assertEqual(mod.haccpBakeryTemplateLabel('doughs'), 'לחמים ובצקים');
    assertEqual(mod.getHaccpBakeryTemplate('missing').id, 'general');
  });

  test('HACCP — דשבורד חריגות מסנן וממיין', async () => {
    const mod = await import('../js/haccp-db.js?v=450');
    const now = Date.parse('2026-08-06T12:00:00');
    const dash = mod.buildHaccpDeviationDashboard([
      {
        id: 1, planId: 10, ccpId: 100, result: 'ok', value: '76',
        recordedAt: '2026-08-05T10:00', correctiveNote: '',
      },
      {
        id: 2, planId: 10, ccpId: 100, result: 'deviation', value: '60', unit: '°C',
        recordedAt: '2026-08-05T11:00', correctiveNote: '', batchCode: 'B1',
      },
      {
        id: 3, planId: 11, ccpId: 101, result: 'deviation', value: '4',
        recordedAt: '2026-07-01T09:00', correctiveNote: 'הושלך',
      },
      {
        id: 4, planId: 11, ccpId: 101, result: 'deviation', value: '5',
        recordedAt: '2026-08-01T09:00', correctiveNote: 'הוחזק לבדיקה',
      },
    ], {
      plans: [{ id: 10, name: 'עוגות' }, { id: 11, name: 'לחמים' }],
      ccps: [
        { id: 100, code: 'CCP-1', name: 'אפייה' },
        { id: 101, code: 'CCP-2', name: 'קירור' },
      ],
      days: 30,
      nowMs: now,
      limit: 50,
    });
    assertEqual(dash.total, 2);
    assertEqual(dash.openWithoutCorrective, 1);
    assertEqual(dash.items[0].id, 2);
    assertEqual(dash.items[0].planName, 'עוגות');
    assertEqual(dash.items[0].ccpCode, 'CCP-1');
    assertOk(!dash.items[0].hasCorrective);
    assertEqual(dash.items[1].id, 4);
    assertOk(dash.items[1].hasCorrective);
  });

  test('HACCP — אשף נועל שלבים לפי מוכנות', async () => {
    const mod = await import('../js/haccp-db.js?v=450');
    const emptyReady = {
      items: mod.HACCP_WIZARD_STEPS.map((stepId) => ({
        stepId,
        done: false,
        label: stepId,
      })),
    };
    const empty = await mod.getHaccpWizardState(null, emptyReady);
    assertOk(empty.isUnlocked('team'));
    assertOk(empty.isUnlocked('overview'));
    assertOk(empty.isUnlocked('monitor_log'));
    assertOk(!empty.isUnlocked('prp'));
    assertOk(!empty.isUnlocked('hazard'));
    assertEqual(empty.firstIncomplete, 'team');
    assertEqual(empty.nextStepId('team'), null);

    const midReady = {
      items: mod.HACCP_WIZARD_STEPS.map((stepId) => ({
        stepId,
        done: ['team', 'prp', 'product'].includes(stepId),
        label: stepId,
      })),
    };
    const mid = await mod.getHaccpWizardState(null, midReady);
    assertOk(mid.isUnlocked('intended_use'));
    assertOk(!mid.isUnlocked('flow'));
    assertEqual(mid.firstIncomplete, 'intended_use');
    assertEqual(mid.nextStepId('product'), 'intended_use');
    assertEqual(mid.nextStepId('intended_use'), null);

    // flow_verify לא חוסם את המשך האשף
    const afterFlow = {
      items: mod.HACCP_WIZARD_STEPS.map((stepId) => ({
        stepId,
        done: ['team', 'prp', 'product', 'intended_use', 'flow'].includes(stepId),
        label: stepId,
      })),
    };
    const flowState = await mod.getHaccpWizardState(null, afterFlow);
    assertOk(flowState.isUnlocked('flow_verify'));
    assertOk(flowState.isUnlocked('hazard'));
    assertEqual(flowState.firstIncomplete, 'flow_verify');
  });

  /* pct */
  test('pct — רגיל', () => assertEqual(pct(50, 100), 50));
  test('pct — יעד 0 = 0%', () => assertEqual(pct(50, 0), 0));
  test('pct — מעל 100%', () => assertEqual(pct(150, 100), 150));
  test('pctDisplay — ללא יעד', () => assertEqual(pctDisplay(10, 0), '—'));

  /* production totals */
  test('computeProductionTotals — סכום וערך', () => {
    const productMap = new Map([[1, { id: 1, categoryId: 10, unitPrice: 5 }]]);
    const entries = [
      { productId: 1, quantity: 10, date: '2026-06-01' },
      { productId: 1, quantity: 5, date: '2026-06-02' },
    ];
    const t = computeProductionTotals(entries, productMap);
    assertEqual(t.total, 15);
    assertApprox(t.totalValue, 75);
    assertEqual(t.byCategory[10], 15);
    assertApprox(t.byCategoryValue[10], 75);
  });

  test('computeProductionTotals — מדלג מוצר חסר', () => {
    const t = computeProductionTotals([{ productId: 99, quantity: 5 }], new Map());
    assertEqual(t.total, 0);
    assertEqual(t.skipped, 1);
  });

  test('computeProductionTotals — מדלג כמות לא תקינה', () => {
    const productMap = new Map([[1, { id: 1, categoryId: 1, unitPrice: 0 }]]);
    const t = computeProductionTotals([{ productId: 1, quantity: 0 }], productMap);
    assertEqual(t.total, 0);
  });

  test('sumEntryQuantities', () => {
    assertEqual(sumEntryQuantities([{ quantity: 3 }, { quantity: 7 }]), 10);
  });

  /* report rows */
  test('computeReportRows — סיכום', () => {
    const categories = [{ id: 1, name: 'שטרודל' }];
    const products = [{ id: 1, categoryId: 1, name: 'פרג 30', unitPrice: 10 }];
    const productMap = new Map([[1, products[0]]]);
    const catMap = new Map([[1, 'שטרודל']]);
    const entries = [{ date: '2026-06-01', productId: 1, quantity: 4 }];
    const r = computeReportRows(entries, categories, products, productMap, catMap);
    assertEqual(r.totalQty, 4);
    assertApprox(r.totalVal, 40);
    assertEqual(r.summaryRows.length, 1);
    assertEqual(r.summaryRows[0][1], 4);
    assertApprox(r.summaryRows[0][2], 40);
  });

  /* process summary */
  test('computeProcessSummary', () => {
    const catMap = new Map([[1, 'מאפינס']]);
    const rows = computeProcessSummary([
      { categoryId: 1, activity: 'אפייה', quantity: 5 },
      { categoryId: 1, activity: 'אפייה', quantity: 3 },
    ], catMap);
    assertEqual(rows.length, 1);
    assertEqual(rows[0].qty, 8);
    assertEqual(rows[0].count, 2);
  });

  /* date ranges */
  test('weekRange — ראשון עד שבת', () => {
    const w = weekRange('2026-06-11');
    assertEqual(w.dates.length, 7);
    assertEqual(w.from, '2026-06-07');
    assertEqual(w.to, '2026-06-13');
  });

  test('monthRange — יוני 2026', () => {
    const m = monthRange(2026, 6);
    assertEqual(m.from, '2026-06-01');
    assertEqual(m.to, '2026-06-30');
  });

  test('addDaysISO', () => assertEqual(addDaysISO('2026-06-01', 1), '2026-06-02'));

  test('qtyForCategoryOnDate', () => {
    const productMap = new Map([[1, { categoryId: 5 }], [2, { categoryId: 6 }]]);
    const entries = [
      { date: '2026-06-01', productId: 1, quantity: 10 },
      { date: '2026-06-01', productId: 2, quantity: 3 },
    ];
    assertEqual(qtyForCategoryOnDate(entries, productMap, 5, '2026-06-01'), 10);
  });

  /* merge — שמירת כמויות */
  test('simulateMergeEntries — מאחד באותו יום', () => {
    const entries = [
      { id: 1, productId: 1, date: '2026-06-01', quantity: 10 },
      { id: 2, productId: 2, date: '2026-06-01', quantity: 5 },
      { id: 3, productId: 2, date: '2026-06-02', quantity: 7 },
    ];
    const before = sumEntryQuantities(entries);
    const after = simulateMergeEntries(entries, 1, [2]);
    assertEqual(sumEntryQuantities(after), before);
    assertEqual(after.filter((e) => e.productId === 2).length, 0);
    assertEqual(after.find((e) => e.id === 1).quantity, 15);
    assertEqual(after.find((e) => e.id === 3).productId, 1);
  });

  test('simulateMergeEntries — שלושה מוצרים שונים', () => {
    const entries = [
      { id: 1, productId: 10, date: '2026-06-01', quantity: 4 },
      { id: 2, productId: 11, date: '2026-06-01', quantity: 6 },
      { id: 3, productId: 12, date: '2026-06-03', quantity: 8 },
      { id: 4, productId: 11, date: '2026-06-03', quantity: 2 },
    ];
    const before = sumEntryQuantities(entries);
    const after = simulateMergeEntries(entries, 10, [11, 12]);
    assertEqual(sumEntryQuantities(after), before);
    assertEqual(after.length, 2);
    assertEqual(after.find((e) => e.date === '2026-06-01').quantity, 10);
    assertEqual(after.find((e) => e.date === '2026-06-03').quantity, 10);
  });

  test('sumEntriesForProducts — לפני ואחרי איחוד', () => {
    const entries = [
      { id: 1, productId: 1, date: '2026-06-01', quantity: 10 },
      { id: 2, productId: 2, date: '2026-06-02', quantity: 5 },
    ];
    const before = sumEntriesForProducts(entries, [1, 2]);
    const after = simulateMergeEntries(entries, 1, [2]);
    assertEqual(sumEntriesForProducts(after, [1]), before);
  });

  test('auditProductionData — נתונים תקינים', () => {
    const categories = [{ id: 1, name: 'עוגות' }];
    const products = [
      { id: 1, categoryId: 1, name: 'שוקולד', unitPrice: 20 },
      { id: 2, categoryId: 1, name: 'וניל', unitPrice: 15 },
    ];
    const entries = [
      { id: 1, productId: 1, date: '2026-06-01', quantity: 10 },
      { id: 2, productId: 2, date: '2026-06-02', quantity: 5 },
    ];
    const audit = auditProductionData(products, entries, categories);
    assertOk(audit.ok, audit.issues.map((i) => i.kind).join(', '));
    assertEqual(audit.totals.total, 15);
    assertApprox(audit.totals.totalValue, 275);
  });

  test('auditProductionData — מזהה רישום יתום', () => {
    const products = [{ id: 1, categoryId: 1, name: 'א', unitPrice: 10 }];
    const entries = [{ id: 1, productId: 99, date: '2026-06-01', quantity: 5 }];
    const audit = auditProductionData(products, entries, []);
    assertOk(!audit.ok);
    assertEqual(audit.issues[0].kind, 'orphan_entry');
  });

  test('auditProductionData — מזהה כפילות יום+מוצר', () => {
    const products = [{ id: 1, categoryId: 1, name: 'א', unitPrice: 10 }];
    const entries = [
      { id: 1, productId: 1, date: '2026-06-01', quantity: 5 },
      { id: 2, productId: 1, date: '2026-06-01', quantity: 3 },
    ];
    const audit = auditProductionData(products, entries, []);
    assertOk(!audit.ok);
    assertOk(audit.issues.some((i) => i.kind === 'duplicate_date_product'));
  });

  test('auditProductionData — אחרי איחוד אין כפילויות', () => {
    const products = [{ id: 1, categoryId: 1, name: 'מאוחד', unitPrice: 10 }];
    const before = [
      { id: 1, productId: 1, date: '2026-06-01', quantity: 10 },
      { id: 2, productId: 2, date: '2026-06-01', quantity: 5 },
      { id: 3, productId: 2, date: '2026-06-02', quantity: 7 },
    ];
    const merged = simulateMergeEntries(before, 1, [2]);
    const audit = auditProductionData(products, merged, [{ id: 1, name: 'ק' }]);
    assertOk(audit.ok);
    assertEqual(audit.totals.total, 22);
  });

  test('computeProductionTotals — ערך אחרי איחוד (מחיר יחיד)', () => {
    const products = [{ id: 1, categoryId: 1, name: 'מאוחד', unitPrice: 10 }];
    const merged = simulateMergeEntries([
      { id: 1, productId: 1, date: '2026-06-01', quantity: 10 },
      { id: 2, productId: 2, date: '2026-06-01', quantity: 5 },
    ], 1, [2]);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const t = computeProductionTotals(merged, productMap);
    assertEqual(t.total, 15);
    assertApprox(t.totalValue, 150);
  });

  /* import parsing */
  test('parseDate — DD/MM/YY', () => assertEqual(parseDate('29/04/25'), '2025-04-29'));
  test('parseDate — ISO', () => assertEqual(parseDate('2026-06-11'), '2026-06-11'));
  test('parseQuantity — פסיקים', () => assertEqual(parseQuantity('1,234'), 1234));
  test('parseQuantity — ריק', () => assertEqual(parseQuantity(''), 0));

  test('detectAndParse — פורמט שטרודל (כמות|מוצר|תאריך)', () => {
    const grid = [
      ['כמות', 'מוצר: 30 ס"מ', 'תאריך', '', '', 'כמות', 'מוצר: 40 ס"מ', 'תאריך'],
      ['120', 'שטרודל פרג 30', '29/04/25', '', '', '29', 'שטרודל פרג 40', '29/04/25'],
    ];
    const parsed = detectAndParse(grid, 'שטרודל');
    assertOk(parsed && parsed.rows.length >= 2, 'should parse rows');
    assertEqual(parsed.rows[0].category, 'שטרודל');
    assertEqual(parsed.rows[0].quantity, 120);
    assertOk(parsed.rows[0].date);
  });

  test('sumCategoryTotals — כמות וערך', () => {
    const products = [
      { id: 1, categoryId: 10, unitPrice: 5 },
      { id: 2, categoryId: 10, unitPrice: 20 },
      { id: 3, categoryId: 11, unitPrice: 10 },
    ];
    const byProduct = { 1: 4, 2: 1, 3: 2 };
    const cat10 = sumCategoryTotals(10, products, byProduct);
    assertEqual(cat10.qty, 5);
    assertApprox(cat10.value, 40);
    const cat11 = sumCategoryTotals(11, products, byProduct);
    assertEqual(cat11.qty, 2);
    assertApprox(cat11.value, 20);
  });

  test('computeProductionTotals — productId כמחרוזת', () => {
    const productMap = buildProductMap([{ id: 1, categoryId: 10, unitPrice: 8 }]);
    const t = computeProductionTotals([{ productId: '1', quantity: 3 }], productMap);
    assertEqual(t.total, 3);
    assertApprox(t.totalValue, 24);
    assertApprox(t.byCategoryValue[10], 24);
  });

  test('enrichBackupData — קטלוג מלא וערך ייצור', () => {
    const enriched = enrichBackupData({
      categories: [{ id: 1, name: 'שטרודל', sortOrder: 2 }],
      products: [{
        id: 10,
        categoryId: 1,
        name: 'פרג 30',
        unitPrice: 12.5,
        rawMaterialsCost: 3,
        rawMaterialsCostSource: 'manual',
        packagingCost: 1,
        sortOrder: 1,
      }],
      productionEntries: [{ productId: 10, quantity: 4, date: '2026-06-01' }],
      targets: [],
      processLogs: [],
      activityPresets: [],
    });
    assertEqual(enriched.categories[0].color.startsWith('#'), true);
    assertEqual(enriched.products[0].unitPrice, 12.5);
    assertEqual(enriched.products[0].rawMaterialsCostSource, 'manual');
    assertEqual(enriched.products[0].sortOrder, 1);
    assertEqual(enriched.products[0].categoryName, 'שטרודל');
    assertEqual(enriched.products[0].productionQty, 4);
    assertApprox(enriched.products[0].productionValue, 50);
  });

  test('computeReportRows — מוצר לפי ק"ג', () => {
    const categories = [{ id: 1, name: 'בצק' }];
    const products = [{ id: 1, categoryId: 1, name: 'בצק פריך', unitPrice: 20, priceUnit: 'kg' }];
    const productMap = buildProductMap(products);
    const catMap = new Map([[1, 'בצק']]);
    const entries = [{ date: '2026-06-01', productId: 1, quantity: 2.5 }];
    const r = computeReportRows(entries, categories, products, productMap, catMap);
    assertEqual(r.totalQty, 2.5);
    assertApprox(r.totalVal, 50);
  });

  test('summarizeBackupData — כולל כל טבלאות הגיבוי', () => {
    const data = enrichBackupData({
      categories: [{ id: 1, name: 'א' }],
      categoryGroups: [],
      products: [],
      productionEntries: [],
      targets: [],
      processLogs: [],
      activityPresets: [],
      flows: [{ id: 1 }],
      flowSteps: [{ id: 1 }],
      flowPreparations: [{ id: 1 }, { id: 2 }],
      groupPreparations: [{ id: 1 }, { id: 2 }],
      productPreparations: [{ id: 1 }],
      runPreparationChecks: [{ id: 1 }],
      productionRuns: [{ id: 1 }],
      runStepStates: [{ id: 1 }],
      recipeGroups: [],
      recipeCategories: [],
      recipes: [{ id: 1 }],
      recipeIngredients: [{ id: 1 }, { id: 2 }, { id: 3 }],
      recipeProductLinks: [{ id: 1 }],
      recipeProductCategoryLinks: [{ id: 1 }],
      recipeProductGroupLinks: [{ id: 1 }],
      supplierCategories: [{ id: 1 }],
      suppliers: [{ id: 1 }],
      rawMaterials: [{ id: 1 }],
      rawMaterialPriceHistory: [{ id: 1 }, { id: 2 }],
      weeklyProductionPlans: [{ id: 1 }],
      weeklyProductionPlanItems: [{ id: 1 }, { id: 2 }],
    });
    const counts = summarizeBackupData(data);
    assertEqual(counts.groupPreparations, 2);
    assertEqual(counts.flowPreparations, 2);
    assertEqual(counts.productPreparations, 1);
    assertEqual(counts.runPreparationChecks, 1);
    assertEqual(counts.recipeIngredients, 3);
    assertEqual(counts.recipeProductLinks, 1);
    assertEqual(counts.recipeProductCategoryLinks, 1);
    assertEqual(counts.recipeProductGroupLinks, 1);
    assertEqual(counts.supplierCategories, 1);
    assertEqual(counts.rawMaterialPriceHistory, 2);
    assertEqual(counts.weeklyProductionPlans, 1);
    assertEqual(counts.weeklyProductionPlanItems, 2);
    const summary = formatBackupSummary(counts);
    assertOk(summary.includes('הכנות תזרים'));
    assertOk(summary.includes('היסטוריית מחירים'));
  });

  test('enrichBackupData — כולל נתוני מנהל', () => {
    const raw = {
      categories: [{ id: 1, name: 'א' }],
      categoryGroups: [],
      products: [],
      productionEntries: [],
      targets: [],
      processLogs: [],
      activityPresets: [],
      flows: [],
      flowSteps: [],
      managerPlans: [{ id: 1 }],
      managerTasks: [{ id: 1 }, { id: 2 }],
    };
    const d = enrichBackupData(raw);
    assertEqual(d.managerPlans.length, 1);
    assertEqual(d.managerTasks.length, 2);
  });

  test('buildSupabaseRestUrl — מנרמל כתובת', () => {
    assertEqual(
      buildSupabaseRestUrl('https://abc.supabase.co/', '/app_backups'),
      'https://abc.supabase.co/rest/v1/app_backups',
    );
    assertEqual(normalizeSupabaseUrl('https://abc.supabase.co///'), 'https://abc.supabase.co');
  });

  test('buildSupabaseHeaders — כולל apikey ו-Authorization', () => {
    const h = buildSupabaseHeaders('test-key');
    assertEqual(h.apikey, 'test-key');
    assertEqual(h.Authorization, 'Bearer test-key');
  });

  test('buildSupabaseHeaders — JWT משתמש גובר על anon', () => {
    const h = buildSupabaseHeaders('anon-key', { accessToken: 'user-jwt' });
    assertEqual(h.apikey, 'anon-key');
    assertEqual(h.Authorization, 'Bearer user-jwt');
    assertEqual(h.accessToken, undefined);
  });

  test('parseSupabaseBackupRow — ממפה שדות', () => {
    const row = parseSupabaseBackupRow({
      id: 'uuid-1',
      device_id: 'dev-1',
      kind: 'auto',
      exported_at: '2026-07-02T12:00:00.000Z',
      summary: '1 קטגוריות',
    });
    assertEqual(row.id, 'uuid-1');
    assertEqual(row.deviceId, 'dev-1');
    assertEqual(row.kind, 'auto');
    assertEqual(row.exportedAt, '2026-07-02T12:00:00.000Z');
  });

  test('isAutoBackupDue — פעם ביום', () => {
    const morning = new Date('2026-07-02T08:00:00').getTime();
    const evening = new Date('2026-07-02T20:00:00').getTime();
    const nextDay = new Date('2026-07-03T09:00:00').getTime();
    const settings = { autoEnabled: true, autoIntervalHours: 24, lastAutoAt: new Date(morning).toISOString() };
    assertEqual(isAutoBackupDue(settings, evening), false);
    assertEqual(isAutoBackupDue(settings, nextDay), true);
    assertEqual(isAutoBackupDue({ autoEnabled: false, lastAutoAt: null }, nextDay), false);
  });

  test('getBackupScopeId — מזהה קבוע לשחזור אחרי מחיקה', async () => {
    const { getBackupScopeId, BACKUP_SCOPE_ID } = await import('../js/supabase-backup.js?v=450');
    assertEqual(getBackupScopeId(), BACKUP_SCOPE_ID);
    assertEqual(BACKUP_SCOPE_ID, 'yitzur');
  });

  test('isPrimaryBackupDevice — ברירת מחדל ומכשיר משני', () => {
    assertOk(isPrimaryBackupDevice({}));
    assertOk(isPrimaryBackupDevice({ primaryDevice: true }));
    assertOk(!isPrimaryBackupDevice({ primaryDevice: false }));
  });

  test('canUploadToSupabase — רק מכשיר ראשי מעלה', () => {
    const base = { enabled: true, supabaseUrl: 'https://x.supabase.co', anonKey: 'k' };
    assertOk(canUploadToSupabase(base));
    assertOk(!canUploadToSupabase({ ...base, primaryDevice: false }));
    assertOk(!canUploadToSupabase({ ...base, enabled: false }));
  });

  test('sortProductsForReport — סדר קטגוריה ומוצר', () => {
    const categories = [
      { id: 2, name: 'ב', sortOrder: 2 },
      { id: 1, name: 'א', sortOrder: 1 },
    ];
    const products = [
      { id: 3, categoryId: 2, name: 'ג', sortOrder: 2 },
      { id: 1, categoryId: 1, name: 'א1', sortOrder: 2 },
      { id: 2, categoryId: 1, name: 'א2', sortOrder: 1 },
      { id: 4, categoryId: 2, name: 'ד', sortOrder: 1 },
    ];
    const sorted = sortProductsForReport(products, categories).map((p) => p.id);
    assertEqual(sorted.join(','), '2,1,4,3');
  });

  await testAsync('parseImportFile — CSV', async () => {
    const csv = 'כמות,מוצר,תאריך\n50,מאפין,01/06/2026\n';
    const file = new File([csv], 't.csv', { type: 'text/csv' });
    const parsed = await parseImportFile(file);
    assertOk(parsed.rows.length >= 1);
    assertEqual(parsed.rows[0].quantity, 50);
  });

  test('normalizeRecipeImportKey — ריק לא זורק', () => {
    assertEqual(normalizeRecipeImportKey(''), '');
    assertEqual(normalizeRecipeImportKey('   '), '');
  });

  test('normalizeRecipeImportKey — מפתח עקבי', () => {
    assertEqual(normalizeRecipeImportKey('  מילוי תפוחים '), normalizeRecipeImportKey('מילוי תפוחים'));
  });

  test('sanitizeRecipeQuantity — שברים', () => {
    assertEqual(sanitizeRecipeQuantity('1.150'), 1.15);
    assertEqual(sanitizeRecipeQuantity('103.6'), 103.6);
    assertEqual(sanitizeRecipeQuantity('0.001'), 0.001);
  });

  test('sanitizeRecipeQuantity — לא מעגל לשלם', () => {
    assertEqual(sanitizeRecipeQuantity('15.5'), 15.5);
    assertEqual(sanitizeRecipeQuantity('15'), 15);
  });

  test('resolveRecipeBaking — פרופיל מחליף שדות inline', () => {
    const profile = {
      id: 1,
      name: 'בצק חמאה',
      bakeOvenType: 'large',
      bakeTempC: 180,
      bakeTimeMinutes: 25,
      bakeSteamSeconds: 30,
      bakeDryMinutes: 10,
    };
    const recipe = {
      hasBaking: true,
      bakingProfileId: 1,
      bakeTempC: 999,
      bakeTimeMinutes: 99,
    };
    const baking = resolveRecipeBaking(recipe, profile);
    assertOk(baking.hasBaking);
    assertEqual(baking.profileName, 'בצק חמאה');
    assertEqual(baking.bakeTempC, 180);
    assertEqual(baking.bakeTimeMinutes, 25);
  });

  test('normalizeBakingProfileFields — שם וטמפ׳', () => {
    const profile = normalizeBakingProfileFields({
      name: '  תנור קטן  ',
      bakeOvenType: 'small',
      bakeTempC: '170',
      bakeTimeMinutes: '20',
    });
    assertEqual(profile.name, 'תנור קטן');
    assertEqual(profile.bakeOvenType, 'small');
    assertEqual(profile.bakeTempC, 170);
    assertEqual(profile.bakeTimeMinutes, 20);
  });

  test('parseRecipesFromDocumentXml — כותרת וחומרים', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>מילוי תפוחים- עם סוכר</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>103.6 ק"ג</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>תפוחים</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>15 ק"ג</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>סוכר</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
</w:body>
</w:document>`;
    const recipes = parseRecipesFromDocumentXml(xml);
    assertEqual(recipes.length, 1);
    assertEqual(recipes[0].title, 'מילוי תפוחים- עם סוכר');
    assertEqual(recipes[0].ingredients.length, 2);
    assertEqual(recipes[0].ingredients[0].name, 'תפוחים');
  });

  test('parseRecipesFromDocumentXml — כמה מתכונים בטבלה אחת', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>מתכון א</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>5 ק"ג</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>קמח</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>מתכון ב</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>2 ק"ג</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>סוכר</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>מתכון ג</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>1 ק"ג</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>חמאה</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
</w:body>
</w:document>`;
    const recipes = parseRecipesFromDocumentXml(xml);
    assertEqual(recipes.length, 3);
    assertEqual(recipes[0].title, 'מתכון א');
    assertEqual(recipes[1].title, 'מתכון ב');
    assertEqual(recipes[2].title, 'מתכון ג');
  });

  test('parseRecipesFromDocumentXml — כותרת Word Heading לפני טבלה', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>בצק חמאה</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>5 ק"ג</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>קמח</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
</w:body>
</w:document>`;
    const recipes = parseRecipesFromDocumentXml(xml);
    assertEqual(recipes.length, 1);
    assertEqual(recipes[0].title, 'בצק חמאה');
    assertEqual(recipes[0].ingredients.length, 1);
    assertEqual(recipes[0].ingredients[0].name, 'קמח');
  });

  test('parseRecipesFromDocumentXml — כותרת בעמודת שם בטבלה', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>קרם וניל</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>3 ק"ג</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>חלב</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>1 ק"ג</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>סוכר</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
</w:body>
</w:document>`;
    const recipes = parseRecipesFromDocumentXml(xml);
    assertEqual(recipes.length, 1);
    assertEqual(recipes[0].title, 'קרם וניל');
    assertEqual(recipes[0].ingredients[0].name, 'חלב');
    assertEqual(recipes[0].ingredients[1].name, 'סוכר');
  });

  test('parseRecipesFromDocumentXml — כותרת עם שורת חומר גלם לפני טבלה', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>עוגת שוקולד</w:t></w:r></w:p>
<w:p><w:r><w:t>חומר גלם:</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>10 ק"ג</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>קמח</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
<w:p><w:r><w:t>עוגת וניל</w:t></w:r></w:p>
<w:p><w:r><w:t>חומר גלם</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>8 ק"ג</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>קמח</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
</w:body>
</w:document>`;
    const recipes = parseRecipesFromDocumentXml(xml);
    assertEqual(recipes.length, 2);
    assertEqual(recipes[0].title, 'עוגת שוקולד');
    assertEqual(recipes[1].title, 'עוגת וניל');
  });

  test('reports flows — normalizeReportType ממפה flows ישן לסיכום', () => {
    assertEqual(normalizeReportType('flows'), 'flows-summary');
    assertEqual(normalizeReportType('flows-detail'), 'flows-detail');
    assertEqual(normalizeReportType(undefined), 'day');
  });

  test('reports flows — isFlowsReportType מזהה סיכום, מפורט וחיזוי', () => {
    assertOk(isFlowsReportType('flows-detail'));
    assertOk(isFlowsReportType('flows-summary'));
    assertOk(isFlowsReportType('flows'));
    assertOk(isFlowsReportType('flows-forecast-summary'));
    assertOk(isFlowsReportType('flows-forecast-detail'));
    assertOk(!isFlowsReportType('day'));
  });

  test('reports flows — groupRunsByFlow מקבץ לפי flowId', () => {
    const runs = [
      { id: 1, flowId: 10 },
      { id: 2, flowId: 10 },
      { id: 3, flowId: 20 },
      { id: 4 },
    ];
    const { byFlow, noFlowRuns } = groupRunsByFlow(runs);
    assertEqual(byFlow.get(10).length, 2);
    assertEqual(byFlow.get(20).length, 1);
    assertEqual(noFlowRuns.length, 1);
    assertEqual(noFlowRuns[0].id, 4);
  });

  test('reports history — productIdsForHistoryScope לפי מוצר/קטגוריה/קבוצה', () => {
    const products = [
      { id: 1, categoryId: 10 },
      { id: 2, categoryId: 10 },
      { id: 3, categoryId: 20 },
    ];
    const categories = [
      { id: 10, groupId: 100 },
      { id: 20, groupId: 200 },
    ];
    assertOk(productIdsForHistoryScope('product', 2, products, categories).has(2));
    assertEqual(productIdsForHistoryScope('category', 10, products, categories).size, 2);
    assertEqual(productIdsForHistoryScope('group', 100, products, categories).size, 2);
    assertEqual(productIdsForHistoryScope('group', 999, products, categories).size, 0);
  });

  test('reports history — filterProductionHistoryEntries מסנן תאריך וסקופ', () => {
    const products = [{ id: 1, categoryId: 10 }, { id: 2, categoryId: 10 }];
    const categories = [{ id: 10, groupId: 100 }];
    const entries = [
      { id: 1, productId: 1, date: '2026-01-01', quantity: 5 },
      { id: 2, productId: 2, date: '2026-02-01', quantity: 3 },
      { id: 3, productId: 1, date: '2025-12-01', quantity: 1 },
    ];
    const all = filterProductionHistoryEntries(entries, {
      scopeType: 'category', scopeId: 10, products, categories, allTime: true,
    });
    assertEqual(all.length, 3);
    const ranged = filterProductionHistoryEntries(entries, {
      scopeType: 'product', scopeId: 1, products, categories,
      from: '2026-01-01', to: '2026-02-28', allTime: false,
    });
    assertEqual(ranged.length, 1);
    assertEqual(ranged[0].quantity, 5);
  });

  test('reports history — sortProductionHistoryEntries לפי תאריך יורד', () => {
    const products = [{ id: 1, name: 'א', categoryId: 10, sortOrder: 1 }];
    const categories = [{ id: 10, sortOrder: 1 }];
    const productMap = buildProductMap(products);
    const sorted = sortProductionHistoryEntries([
      { productId: 1, date: '2026-01-01', quantity: 1 },
      { productId: 1, date: '2026-03-01', quantity: 2 },
    ], productMap, categories);
    assertEqual(sorted[0].date, '2026-03-01');
  });

  test('reports manager — managerRecordInDateRange וסינון משימות', () => {
    assertOk(isManagerReportType('manager'));
    assertOk(managerRecordInDateRange('2026-02-15T10:00:00', '2026-02-01', '2026-02-28'));
    assertOk(!managerRecordInDateRange('2026-03-01', '2026-02-01', '2026-02-28'));
    const tasks = [
      { id: 1, createdAt: '2026-02-10', dueDate: null, completedAt: null },
      { id: 2, createdAt: '2026-01-01', dueDate: '2026-02-20', completedAt: null },
      { id: 3, createdAt: '2026-01-01', dueDate: null, completedAt: '2026-03-01' },
    ];
    const filtered = filterManagerTasksByRange(tasks, '2026-02-01', '2026-02-28');
    assertEqual(filtered.length, 2);
    assertEqual(filtered.map((t) => t.id).join(','), '1,2');
  });

  test('runStepsAllCompleted — כל השלבים הושלמו', () => {
    assertOk(runStepsAllCompleted([
      { status: 'completed' },
      { status: 'completed' },
    ]));
    assertOk(!runStepsAllCompleted([
      { status: 'completed' },
      { status: 'pending' },
    ]));
    assertOk(!runStepsAllCompleted([]));
  });

  test('findNextIncompleteStepIndex — מדלג על הושלמו ומוצא תקועים', () => {
    const steps = [
      { status: 'pending' },
      { status: 'completed' },
      { status: 'active' },
      { status: 'pending' },
    ];
    assertEqual(findNextIncompleteStepIndex(steps, 2), 3);
    assertEqual(findNextIncompleteStepIndex(steps, 3), 0);
    assertEqual(findNextIncompleteStepIndex([
      { status: 'completed' },
      { status: 'completed' },
    ], 0), -1);
  });

  test('parseNumericBatchNumber — מספרים וטקסט מעורב', () => {
    assertEqual(parseNumericBatchNumber('55'), 55);
    assertEqual(parseNumericBatchNumber(' 56 '), 56);
    assertEqual(parseNumericBatchNumber('אצווה 55'), 55);
    assertEqual(parseNumericBatchNumber(''), null);
    assertEqual(parseNumericBatchNumber('abc'), null);
  });

  test('computeNextBatchNumber — אחרי האצווה האחרונה', () => {
    assertEqual(computeNextBatchNumber(55, 1), 56);
    assertEqual(computeNextBatchNumber(55, 56), 56);
    assertEqual(computeNextBatchNumber(55, 60), 60);
    assertEqual(computeNextBatchNumber(0, 1), 1);
    assertEqual(computeNextBatchNumber(null, 1), 1);
  });

  test('sanitizeAuditPayload — מוודא שדות חובה ומנקה entityId', () => {
    const ok = sanitizeAuditPayload({ entityTable: 'haccpCcps', entityId: 5, action: 'create', snapshot: { a: 1 } });
    assertEqual(ok.entityTable, 'haccpCcps');
    assertEqual(ok.entityId, '5');
    assertEqual(ok.action, 'create');
    assertEqual(ok.snapshot.a, 1);
  });

  test('sanitizeAuditPayload — דוחה action לא חוקי או entityTable חסר', () => {
    assertEqual(sanitizeAuditPayload({ entityTable: 'x', action: 'oops' }), null);
    assertEqual(sanitizeAuditPayload({ entityTable: '', action: 'create' }), null);
    assertEqual(sanitizeAuditPayload({ entityTable: 'haccpCcps', action: 'delete', entityId: null }).entityId, null);
  });

  test('audit labels + snapshot summary', () => {
    assertEqual(auditActionLabel('create'), 'יצירה');
    assertEqual(auditActionLabel('delete'), 'מחיקה');
    assertEqual(auditEntityLabel('haccpCcps'), 'נקודות בקרה (CCP)');
    assertEqual(auditEntityLabel('haccpHazards'), 'סיכונים');
    assertEqual(auditEntityLabel('haccpPrpControls'), 'תכניות קדם (PRP)');
    assertEqual(auditEntityLabel('haccpTeamMembers'), 'צוות HACCP');
    assertEqual(auditEntityLabel('haccpCorrectiveActions'), 'פעולות מתקנות');
    assertEqual(auditEntityLabel('inventoryMovements'), 'תנועות מלאי');
    assertEqual(auditEntityLabel('profiles'), 'חשבונות');
    assertEqual(auditEntityLabel('unknownTable'), 'unknownTable');
    assertOk(formatAuditSnapshotSummary({ name: 'CCP קירור', status: 'active' }).includes('CCP קירור'));
    const inv = formatAuditSnapshotSummary({
      materialName: 'קמח', kind: 'receive', delta: 2, unit: 'ק"ג', reason: 'קבלה',
    });
    assertOk(inv.includes('קמח'));
    assertOk(inv.includes('+2'));
    const acct = formatAuditSnapshotSummary({ email: 'a@b.com', role: 'manager', status: 'active' });
    assertOk(acct.includes('a@b.com'));
    assertOk(acct.includes('manager'));
    assertEqual(formatAuditSnapshotSummary(null), '');
  });

  test('sync — recipeVersions באוסף וטביעת אצבע כוללת גרסה', () => {
    assertEqual(COLLECTION_TABLE.recipeVersions, 'sync_recipe_versions');
    assertOk(SYNC_ORDER.indexOf('recipeVersions') > SYNC_ORDER.indexOf('recipes'));
    assertOk(SYNC_ORDER.indexOf('recipeVersions') < SYNC_ORDER.indexOf('recipeIngredients'));
    const fp = rowFingerprint('recipeIngredients', {
      recipeId: 1, recipeVersionId: 9, name: 'קמח', rawMaterialId: 3, sortOrder: 1,
    });
    assertOk(fp.includes('|9|'));
  });

  await flushTests();
}
