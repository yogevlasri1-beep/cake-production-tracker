/**
 * בדיקת אינטגרציה אמיתית: Dexie/IndexedDB אמיתיים (לא mock) בדפדפן.
 * מריצה תרחיש איחוד חומרי גלם מקצה לקצה ובודקת שהמתכונים/הסינכרון לא נפגעים.
 * מריצים דרך tests/integration.html (כרום headless / דפדפן רגיל) — לעולם לא מול production.
 */
import {
  test, testAsync, assertEqual, assertOk, flushTests,
} from './runner.js?v=453';
import { db, initDB } from '../js/db.js?v=453';
import {
  addSupplierCategory, addSupplier, addRawMaterial, getRawMaterials,
  addRecipeCategory, addRecipe, addRecipeIngredient,
  setRawMaterialRecipeDefault, mergeSelectedRawMaterials,
  normalizeMaterialKey, getMaterialSynonyms, buildMaterialsByNameKey,
  resolveRecipeIngredientMaterial, getSimilarMaterialNameGroups,
} from '../js/kitchen-db.js?v=453';
import { getMetaByLocal, upsertMeta } from '../js/sync/id-map.js?v=453';
import { shouldApplyRemote } from '../js/sync/collections.js?v=453';
import { installLiveSyncMiddleware } from '../js/supabase-sync.js?v=453';

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function resetDatabase() {
  if (db.isOpen()) db.close();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('CakeProduction');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

export async function runIntegrationTests() {
  await resetDatabase();
  // כמו באפליקציה עצמה (js/app.js): ה-middleware חייב להיות מותקן לפני פתיחת ה-DB.
  installLiveSyncMiddleware();
  await initDB();

  await testAsync('mergeSelectedRawMaterials — קיבוץ בפועל: 3→2 שורות, לא פוגע במתכון', async () => {
    const catId = await addSupplierCategory('חומרי גלם בדיקה');
    const supA = await addSupplier({ categoryId: catId, name: 'ספק A בדיקה' });
    const supB = await addSupplier({ categoryId: catId, name: 'ספק B בדיקה' });

    const keepId = await addRawMaterial({
      supplierCategoryId: catId, name: 'סוכר', unit: 'ק"ג', unitPrice: 5, supplierId: supA,
    });
    const variant1Id = await addRawMaterial({
      supplierCategoryId: catId, name: 'סוכר לבן', unit: 'ק"ג', unitPrice: 6, supplierId: supB,
    });
    const variant2Id = await addRawMaterial({
      supplierCategoryId: catId, name: 'סכר', unit: 'ק"ג', unitPrice: 0,
    });

    // ברירת מחדל למתכונים על הצעת ספק B — חייבת לשרוד אחרי איחוד
    await setRawMaterialRecipeDefault(variant1Id, true);

    // מתכון עם 2 מרכיבים — אחד תואם ליעד, אחד תואם לחומר שנספג (בלי ספק)
    const recCatId = await addRecipeCategory('מתכוני בדיקה');
    const recipeId = await addRecipe({ categoryId: recCatId, name: 'עוגת בדיקה' });
    await addRecipeIngredient(recipeId, { name: 'סוכר', quantity: 100, unitKind: 'g' });
    await addRecipeIngredient(recipeId, { name: 'סכר', quantity: 50, unitKind: 'g' });

    // גם syncMeta קיים (כאילו כבר סונכרן לענן) — כדי לבדוק שהאיחוד יוצר tombstone אמיתי
    await upsertMeta({
      collection: 'rawMaterials',
      localKey: String(variant2Id),
      syncId: 'test-sync-id-variant2',
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    const before = await getRawMaterials(catId);
    assertEqual(before.length, 3, 'לפני איחוד: 3 שורות');

    const ingsBefore = await db.recipeIngredients.where('recipeId').equals(recipeId).toArray();
    assertEqual(ingsBefore.length, 2, 'לפני איחוד: 2 מרכיבים במתכון');

    const result = await mergeSelectedRawMaterials(keepId, [variant1Id, variant2Id]);
    assertOk(result?.preservedOfferIds?.includes(variant1Id), 'הצעת ספק B נשמרה כהצעה נפרדת');

    // תן לתור הסינכרון (middleware) לרשום את הפעולה אחרי commit הטרנזקציה
    await wait(50);

    const after = await getRawMaterials(catId);
    assertEqual(after.length, 2, 'אחרי איחוד: 2 שורות (יעד + הצעת ספק B) — לא 3, לא 0');

    const afterIds = new Set(after.map((m) => m.id));
    assertOk(afterIds.has(keepId), 'רשומת היעד קיימת');
    assertOk(afterIds.has(variant1Id), 'הצעת ספק B קיימת תחת שם היעד');
    assertOk(!afterIds.has(variant2Id), 'החומר בלי מחיר נספג ונעלם לגמרי');

    for (const m of after) {
      assertEqual(normalizeMaterialKey(m.name), normalizeMaterialKey('סוכר'), `שם אחיד: ${m.name}`);
    }

    const keepMat = await db.rawMaterials.get(keepId);
    const syns = getMaterialSynonyms(keepMat).map((s) => normalizeMaterialKey(s));
    assertOk(syns.includes(normalizeMaterialKey('סוכר לבן')), 'מילה נרדפת: סוכר לבן');
    assertOk(syns.includes(normalizeMaterialKey('סכר')), 'מילה נרדפת: סכר');

    // ברירת מחדל למתכונים נשארה על הצעת ספק B ששרדה
    const offerMat = await db.rawMaterials.get(variant1Id);
    assertOk(offerMat.isRecipeDefault, 'ברירת המחדל למתכונים נשמרה על ההצעה ששרדה');

    // המתכון: עדיין 2 שורות — לא נמחקו/לא נוספו מרכיבים
    const ingsAfter = await db.recipeIngredients.where('recipeId').equals(recipeId).toArray();
    assertEqual(ingsAfter.length, 2, 'אחרי איחוד: עדיין 2 מרכיבים במתכון (לא נמחק כפילות)');

    // ברירת המחדל למתכון עדיין קובעת מחיר: resolveRecipeIngredientMaterial מוצא הצעה עם מחיר
    const byNameKey = buildMaterialsByNameKey(after);
    const matById = new Map(after.map((m) => [m.id, m]));
    for (const ing of ingsAfter) {
      const { mat } = resolveRecipeIngredientMaterial(ing, { matById, byNameKey });
      assertOk(mat, `נמצא חומר להתאמת מרכיב "${ing.name}"`);
      assertOk((Number(mat.unitPrice) || 0) > 0, `למרכיב "${ing.name}" יש מחיר אחרי איחוד`);
    }
    const flourIng = ingsAfter.find((i) => normalizeMaterialKey(i.name) === normalizeMaterialKey('סוכר'));
    const { mat: resolvedDefault } = resolveRecipeIngredientMaterial(flourIng, { matById, byNameKey });
    assertEqual(resolvedDefault.id, variant1Id, 'ברירת המחדל למתכונים (הצעת ספק B) קובעת את המחיר');

    // tombstone: החומר שנספג בלי מחיר סומן כמחוק ב-syncMeta, עם updatedAt חדש יותר מכל pull ישן
    const meta = await getMetaByLocal('rawMaterials', variant2Id);
    assertOk(meta && meta.deletedAt, 'syncMeta מסומן כמחוק (tombstone) עבור החומר שנספג');
    const staleRemoteUpdatedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    assertOk(
      !shouldApplyRemote(meta.updatedAt, staleRemoteUpdatedAt),
      'pull ישן (מלפני האיחוד) לא יחייה מחדש את החומר שנספג',
    );

    // ה-middleware של הסינכרון החי אמור היה לתור מחיקה אמיתית (push) עבור החומר שנספג —
    // לא רק tombstone מקומי — כדי שגם מכשירים אחרים לא יראו אותו יותר.
    const pendingDelete = await db.syncQueue
      .where('collection').equals('rawMaterials')
      .filter((op) => op.type === 'delete' && String(op.localKey) === String(variant2Id))
      .first();
    assertOk(pendingDelete, 'נוצרה פעולת מחיקה בתור הסינכרון עבור החומר שנספג (יידחף לענן)');
  });

  await testAsync('getSimilarMaterialNameGroups — מקבץ שמות דומים, לא מציע לא-קשורים', async () => {
    await wait(100); // מוודא שתורי sync מהבדיקה הקודמת התרוקנו לפני שסוגרים/מוחקים את ה-DB
    await resetDatabase();
    installLiveSyncMiddleware();
    await initDB();

    const catId = await addSupplierCategory('חומרי גלם בדיקה 2');
    const sugarId = await addRawMaterial({ supplierCategoryId: catId, name: 'סוכר', unit: 'ק"ג', unitPrice: 5 });
    const sugarWhiteId = await addRawMaterial({
      supplierCategoryId: catId, name: 'סוכר לבן', unit: 'ק"ג', unitPrice: 6,
    });
    const sugarTypoId = await addRawMaterial({ supplierCategoryId: catId, name: 'סכר', unit: 'ק"ג', unitPrice: 0 });
    const flourId = await addRawMaterial({ supplierCategoryId: catId, name: 'קמח לבן', unit: 'ק"ג', unitPrice: 4 });
    await addRawMaterial({ supplierCategoryId: catId, name: 'שמרים', unit: 'ק"ג', unitPrice: 8 });

    const groups = await getSimilarMaterialNameGroups({ minGroupSize: 2 });
    const sugarGroup = groups.find((g) => g.materials.some((m) => m.id === sugarId));
    assertOk(sugarGroup, 'נמצאה קבוצה עם "סוכר"');
    const sugarGroupIds = new Set(sugarGroup.materials.map((m) => m.id));
    assertOk(sugarGroupIds.has(sugarWhiteId), 'סוכר לבן נכנס לאותה קבוצה (containment)');
    assertOk(sugarGroupIds.has(sugarTypoId), 'סכר (טעות כתיב) נכנס לאותה קבוצה (Levenshtein)');
    assertOk(!sugarGroupIds.has(flourId), '"קמח לבן" לא נכנס לקבוצת הסוכר (לא דומה מספיק)');
    assertOk(sugarGroup.suggestedTargetId, 'יש הצעת יעד לקבוצה');

    const flourGroup = groups.find((g) => g.materials.some((m) => m.id === flourId));
    assertOk(!flourGroup, '"קמח לבן" לבד לא יוצר קבוצה (אין עוד שם דומה)');
  });

  await testAsync('getSimilarMaterialNameGroups — יעיל על כמות גדולה (bucket, לא O(n²) איטי)', async () => {
    await wait(100); // מוודא שתורי sync מהבדיקה הקודמת התרוקנו לפני שסוגרים/מוחקים את ה-DB
    await resetDatabase();
    installLiveSyncMiddleware();
    await initDB();

    const catId = await addSupplierCategory('חומרי גלם בדיקה 3');
    const bases = ['שוקולד', 'קמח', 'סוכר', 'חמאה', 'ביצים', 'שמרים', 'מלח', 'וניל', 'קקאו', 'דבש'];
    for (let i = 0; i < 300; i++) {
      const base = bases[i % bases.length];
      // eslint-disable-next-line no-await-in-loop
      await addRawMaterial({
        supplierCategoryId: catId, name: `${base} ${i}`, unit: 'ק"ג', unitPrice: 1,
      });
    }
    const start = Date.now();
    const groups = await getSimilarMaterialNameGroups({ minGroupSize: 2 });
    const elapsed = Date.now() - start;
    assertOk(groups.length >= bases.length, `קובץ לפי בסיס משותף: ${groups.length} קבוצות`);
    assertOk(elapsed < 5000, `זמן ריצה סביר על 300 פריטים: ${elapsed}ms`);
  });

  await flushTests();
}
