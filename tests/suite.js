import { test, testAsync, assertEqual, assertOk, assertApprox, flushTests } from './runner.js?v=273';
import {
  isValidISODate, sanitizeQuantity, sanitizeMoney, sanitizeName, sanitizeRecipeQuantity, roundMoney,
} from '../js/validators.js?v=273';
import {
  pct, pctDisplay, computeProductionTotals, computeReportRows,
  computeProcessSummary, weekRange, monthRange, sumEntryQuantities,
  qtyForCategoryOnDate, addDaysISO, simulateMergeEntries, sumEntriesForProducts,
  auditProductionData, sumCategoryTotals, buildProductMap, sortProductsForReport,
} from '../js/calc.js?v=273';
import { parseDate, parseQuantity, detectAndParse, parseImportFile } from '../js/import.js?v=273';
import { enrichBackupData, summarizeBackupData, formatBackupSummary } from '../js/backup.js?v=273';
import {
  buildSupabaseRestUrl,
  buildSupabaseHeaders,
  parseSupabaseBackupRow,
  normalizeSupabaseUrl,
  isPrimaryBackupDevice,
  canUploadToSupabase,
} from '../js/supabase-backup.js?v=273';
import { isAutoBackupDue } from '../js/backup-service.js?v=273';
import { normalizeRecipeImportKey, resolveRecipeBaking, normalizeBakingProfileFields, computePricePerKg, computePackagePrice, packageWeightKgFromGrams, packageWeightGramsFromKg, rawMaterialPricingFromPerKg, normalizeMaterialKey, pickHighestPricedMaterial, buildMaterialsByNameKey, resolveRecipeIngredientMaterial, computeIngredientLineCost, getIngredientPriceSource, isProductRecipesCostSource, getMaterialPurchasePricePerKg, getMaterialEffectivePricePerKg, getRecipeProductYieldInfo, scaleRecipeIngredientsForProductCount, recipeScaleRatioForProductCount, scaleRecipeIngredients, scaleIngredientsToTargetGrams, recipeTotalWeightGrams, buildRecipePortionPresetFields, formatSubdivisionWeight, gramsFromSubdivisionKg } from '../js/kitchen-db.js?v=273';
import {
  parsePackageWeightGrams, isSkipSheetName, detectSupplierSheetFormat, parseSupplierSheetRows,
  parseQuantityUnit, detectHeaderlessPriceListFormat, parseHeaderlessPriceListRows,
} from '../js/supplier-import.js?v=273';
import { parseRecipesFromDocumentXml } from '../js/recipe-import.js?v=273';
import { isFlowsReportType, isManagerReportType, normalizeReportType, groupRunsByFlow, filterProductionHistoryEntries, productIdsForHistoryScope, sortProductionHistoryEntries, managerRecordInDateRange, filterManagerTasksByRange } from '../js/screens/reports.js?v=273';

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
    assertOk(!isProductRecipesCostSource({}));
    assertOk(!isProductRecipesCostSource({ rawMaterialsCostSource: 'manual' }));
    assertOk(isProductRecipesCostSource({ rawMaterialsCostSource: 'recipes' }));
    assertOk(!isProductRecipesCostSource({ rawMaterialsCostSource: 'invalid' }));
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
    const { getBackupScopeId, BACKUP_SCOPE_ID } = await import('../js/supabase-backup.js?v=273');
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

  test('reports flows — isFlowsReportType מזהה שני סוגי דוח', () => {
    assertOk(isFlowsReportType('flows-detail'));
    assertOk(isFlowsReportType('flows-summary'));
    assertOk(isFlowsReportType('flows'));
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

  await flushTests();
}
