import { test, testAsync, assertEqual, assertOk, assertApprox, flushTests } from './runner.js';
import {
  isValidISODate, sanitizeQuantity, sanitizeMoney, sanitizeName, roundMoney,
} from '../js/validators.js?v=117';
import {
  pct, pctDisplay, computeProductionTotals, computeReportRows,
  computeProcessSummary, weekRange, monthRange, sumEntryQuantities,
  qtyForCategoryOnDate, addDaysISO, simulateMergeEntries, sumEntriesForProducts,
  auditProductionData, sumCategoryTotals, buildProductMap, sortProductsForReport,
} from '../js/calc.js?v=117';
import { parseDate, parseQuantity, detectAndParse, parseImportFile } from '../js/import.js?v=117';
import { enrichBackupData } from '../js/backup.js?v=117';

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

  await flushTests();
}
