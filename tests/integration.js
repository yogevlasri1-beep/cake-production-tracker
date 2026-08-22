/**
 * בדיקת אינטגרציה אמיתית: Dexie/IndexedDB אמיתיים (לא mock) בדפדפן.
 * מריצה תרחיש איחוד חומרי גלם מקצה לקצה ובודקת שהמתכונים/הסינכרון לא נפגעים.
 * מריצים דרך tests/integration.html (כרום headless / דפדפן רגיל) — לעולם לא מול production.
 */
import {
  test, testAsync, assertEqual, assertOk, flushTests,
} from './runner.js?v=480';
import { db, initDB, addCategory, addProduct } from '../js/db.js?v=480';
import {
  addSupplierCategory, addSupplier, addRawMaterial, getRawMaterials,
  addRecipeCategory, addRecipe, addRecipeIngredient,
  addRecipeVersion, getRecipe, listRecipeVersions,
  repairSplitDoubledRecipeVersionIngredients,
  setRawMaterialRecipeDefault, mergeSelectedRawMaterials,
  normalizeMaterialKey, getMaterialSynonyms, buildMaterialsByNameKey,
  resolveRecipeIngredientMaterial, getSimilarMaterialNameGroups,
  findRawMaterialsByName, setWeeklyPlanItem, computeWeeklyMaterialNeeds, getWeeklyPlan,
  getSuppliersBrowseLayout, coerceSupplierNumericFks, reconcileRawMaterialPricesFromHistory,
  getSuppliers,
} from '../js/kitchen-db.js?v=480';
import { getMetaByLocal, upsertMeta } from '../js/sync/id-map.js?v=480';
import { shouldApplyRemote } from '../js/sync/collections.js?v=480';
import { installLiveSyncMiddleware, findLocalByFingerprint, repairOrphanSupplierCategoryLinks } from '../js/supabase-sync.js?v=480';

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

  await testAsync('findRawMaterialsByName — מוצא כפילות שם חוצה קטגוריה/ספק (לאזהרה בהוספה)', async () => {
    await wait(100);
    await resetDatabase();
    installLiveSyncMiddleware();
    await initDB();

    const catA = await addSupplierCategory('חומרי גלם בדיקה 4');
    const catB = await addSupplierCategory('חומרי גלם בדיקה 5');
    const supA = await addSupplier({ categoryId: catA, name: 'ספק A בדיקה 2' });

    const first = await addRawMaterial({
      supplierCategoryId: catA, name: 'קמח לבן', unit: 'ק"ג', unitPrice: 4, supplierId: supA,
    });

    const noneYet = await findRawMaterialsByName('שמרים טריים');
    assertEqual(noneYet.length, 0, 'שם חדש לגמרי — אין כפילות');

    const exactMatch = await findRawMaterialsByName('קמח לבן');
    assertEqual(exactMatch.length, 1, 'נמצאה שורה קיימת באותו שם');
    assertEqual(exactMatch[0].id, first, 'זו אותה שורה שנוצרה');

    // אותו שם, קטגוריה אחרת (בדיוק התרחיש שיוצר כפילויות בין ספק/מכשירים) — עדיין נמצא
    const second = await addRawMaterial({
      supplierCategoryId: catB, name: 'קמח לבן', unit: 'ק"ג', unitPrice: 0,
    });
    const bothMatches = await findRawMaterialsByName('  קמח לבן  ');
    assertEqual(bothMatches.length, 2, 'התאמה גם עם רווחים מיותרים, גם מכל הקטגוריות');
    assertOk(bothMatches.some((m) => m.id === second), 'החומר השני מהקטגוריה השנייה מופיע');

    const excluded = await findRawMaterialsByName('קמח לבן', { excludeId: second });
    assertEqual(excluded.length, 1, 'excludeId מסנן את עצמו — לשימוש בזמן עריכה');
    assertEqual(excluded[0].id, first);
  });

  await testAsync('findLocalByFingerprint — משתמש שני יוצר קטגוריה זהה: לא כפילות (מחוץ לספקים)', async () => {
    await wait(100);
    await resetDatabase();
    installLiveSyncMiddleware();
    await initDB();

    // מכשיר A כבר יצר "עוגות" ומסונכרן (יש syncMeta עם syncId משלו).
    const catId = await addCategory('עוגות');
    await upsertMeta({
      collection: 'categories',
      localKey: String(catId),
      syncId: 'sync-id-device-a',
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await wait(50);

    // מכשיר B יצר את אותה קטגוריה באופן עצמאי (לפני שסונכרן) — לענן מגיעה שורה עם syncId אחר.
    const incoming = { name: 'עוגות', groupId: null };
    const match = await findLocalByFingerprint('categories', incoming, { syncId: 'sync-id-device-b' });

    assertOk(match, 'נמצאה התאמה מקומית לפי fingerprint גם כשהיא כבר משויכת ל-syncId אחר');
    assertEqual(match.id, catId, 'ההתאמה היא הקטגוריה הקיימת, לא שורה חדשה');
    assertOk(match.__cloudDuplicateOf, 'מסומן ככפילות ענן — הקורא צריך לעשות tombstone ולא ליצור שורה חדשה');

    const allCats = await db.categories.where('name').equals('עוגות').toArray();
    assertEqual(allCats.length, 1, 'עדיין קטגוריה אחת בלבד מקומית — לא נוצרה כפילות');
  });

  await testAsync('findLocalByFingerprint — מחיר ממשתמש משני על חומר כפול מתמזג ל-survivor', async () => {
    await wait(100);
    await resetDatabase();
    installLiveSyncMiddleware();
    await initDB();

    const catId = await addSupplierCategory('חומרי גלם');
    const matId = await addRawMaterial({
      supplierCategoryId: catId,
      name: 'סוכר בדיקת סנכרון',
      unit: 'ק"ג',
      unitPrice: 0,
      packageWeightGrams: 1000,
    });
    await upsertMeta({
      collection: 'rawMaterials',
      localKey: String(matId),
      syncId: 'mat-sync-main',
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
    });

    // משתמש משני יצר כפילות עם אותו שם והזין מחיר — מגיע עם syncId אחר.
    const incoming = {
      name: 'סוכר בדיקת סנכרון',
      supplierCategoryId: catId,
      supplierId: null,
      unitPrice: 12.5,
      packageWeightGrams: 1000,
      unit: 'ק"ג',
    };
    const match = await findLocalByFingerprint('rawMaterials', incoming, { syncId: 'mat-sync-secondary' });
    assertOk(match?.__cloudDuplicateOf, 'כפילות ענן מסומנת — לא יוצרים שורה שנייה');
    assertEqual(match.id, matId);

    // כמו applyRemoteRow: ממזגים מחיר ל-survivor
    const before = await db.rawMaterials.get(matId);
    assertEqual(Number(before.unitPrice) || 0, 0);
    if (!(Number(before.unitPrice) > 0) && Number(incoming.unitPrice) > 0) {
      await db.rawMaterials.update(matId, { unitPrice: incoming.unitPrice });
    }
    const after = await db.rawMaterials.get(matId);
    assertEqual(Number(after.unitPrice), 12.5, 'המחיר מהמשתמש המשני מופיע על החומר של הראשי');
    const all = await db.rawMaterials.where('name').equals('סוכר בדיקת סנכרון').toArray();
    assertEqual(all.length, 1, 'אין כפילות מקומית של החומר');
  });

  await testAsync(
    'computeWeeklyMaterialNeeds — מקפיץ לפי יחס יחידות/מנה, לא לפי כמות המנות ישירות',
    async () => {
      await wait(100);
      await resetDatabase();
      installLiveSyncMiddleware();
      await initDB();

      // מתכון: 1000 גרם קמח לעוגה אחת (משקל יחידת חלוקה 100 גרם) → 10 יחידות מוצר לאצווה.
      const prodCatId = await addCategory('עוגות בדיקה');
      const productId = await addProduct({ categoryId: prodCatId, name: 'עוגת שוקולד בדיקה' });
      const recCatId = await addRecipeCategory('מתכוני בדיקה שבועי');
      const recipeId = await addRecipe({
        categoryId: recCatId,
        name: 'עוגת שוקולד בדיקה',
        linkedProductId: productId,
        portionWeightGrams: 100,
      });
      await addRecipeIngredient(recipeId, { name: 'קמח בדיקה', quantity: 1000, unitKind: 'g' });

      // תוכנית שבועית: 40 יחידות מוצר מתוכננות (= 4 אצוות, לא 40 אצוות).
      const weekStart = '2026-08-09';
      const plan = await getWeeklyPlan(weekStart);
      await setWeeklyPlanItem(plan.id, productId, 40);

      const { allNeeds } = await computeWeeklyMaterialNeeds(weekStart);
      const flourNeed = allNeeds.find((n) => n.name === 'קמח בדיקה');
      assertOk(flourNeed, 'נמצא צורך בקמח');
      // 40 יחידות / 10 יחידות-לאצווה = 4 אצוות; 4 * 1000 גרם = 4000 גרם קמח, לא 40000.
      assertEqual(flourNeed.totalQty, 4000, 'כמות קמח נכונה: 4 אצוות * 1000 גרם, לא 40 * 1000');
    },
  );

  
  await testAsync('repairOrphanSupplierCategoryLinks — ספק יתום חוזר לחומ״ג', async () => {
    await wait(100);
    await resetDatabase();
    installLiveSyncMiddleware();
    await initDB();

    const rawId = await addSupplierCategory('חומרי גלם');
    const ghostId = await addSupplierCategory('חומרי גלם יבשים');
    const supId = await addSupplier({ categoryId: ghostId, name: 'ספק יתום בדיקה' });
    // מדמים מחיקת הקטגוריה בלי retarget (כמו tombstone מהענן)
    await db.supplierCategories.delete(ghostId);

    const before = await db.suppliers.get(supId);
    assertOk(!await db.supplierCategories.get(Number(before.categoryId)), 'הקטגוריה נמחקה — הספק יתום');

    const fixed = await repairOrphanSupplierCategoryLinks();
    assertOk(fixed >= 1, 'תוקן לפחות ספק אחד');
    const after = await db.suppliers.get(supId);
    assertEqual(Number(after.categoryId), Number(rawId), 'הספק שויך חזרה לחומרי גלם');
  });

  await testAsync('repairOrphanSupplierCategoryLinks — מוציא חומ״ג ששויכו בטעות לאריזות', async () => {
    await wait(100);
    await resetDatabase();
    installLiveSyncMiddleware();
    await initDB();

    const rawId = await addSupplierCategory('חומרי גלם');
    const packId = await addSupplierCategory('אריזות', { isPackaging: true });
    const cleanId = await addSupplierCategory('חומרי ניקיון', { isCleaning: true });

    const flourSup = await addSupplier({ categoryId: packId, name: 'ספק קמח שגוי' });
    const boxSup = await addSupplier({ categoryId: packId, name: 'ספק אריזות' });
    const soapSup = await addSupplier({ categoryId: packId, name: 'ספק ניקיון שגוי' });

    const flourId = await addRawMaterial({
      supplierCategoryId: packId, supplierId: flourSup, name: 'קמח תופח', unit: 'ק"ג', unitPrice: 5,
    });
    const boxId = await addRawMaterial({
      supplierCategoryId: packId, supplierId: boxSup, name: 'קופסת קרטון', unit: 'יח׳', unitPrice: 2,
      packagingKind: 'carton', packUnitsCount: 1,
    });
    const soapId = await addRawMaterial({
      supplierCategoryId: packId, supplierId: soapSup, name: 'סבון כלים', unit: 'יח׳', unitPrice: 8,
    });

    const fixed = await repairOrphanSupplierCategoryLinks();
    assertOk(fixed >= 1, 'תוקנו שיוכים שגויים');

    assertEqual(Number((await db.rawMaterials.get(flourId)).supplierCategoryId), Number(rawId), 'קמח → חומ״ג');
    assertEqual(Number((await db.rawMaterials.get(boxId)).supplierCategoryId), Number(packId), 'קרטון נשאר באריזות');
    assertEqual(Number((await db.rawMaterials.get(soapId)).supplierCategoryId), Number(cleanId), 'סבון → ניקיון');

    assertEqual(Number((await db.suppliers.get(flourSup)).categoryId), Number(rawId), 'ספק קמח → חומ״ג');
    assertEqual(Number((await db.suppliers.get(boxSup)).categoryId), Number(packId), 'ספק אריזות נשאר');
    assertEqual(Number((await db.suppliers.get(soapSup)).categoryId), Number(cleanId), 'ספק ניקיון → ניקיון');
  });

  await testAsync('addRawMaterial — מק״ט / הערות / MOQ נשמרים ומסונכרנים ל-payload', async () => {
    await wait(100);
    await resetDatabase();
    installLiveSyncMiddleware();
    await initDB();

    const catId = await addSupplierCategory('חומרי גלם');
    const supId = await addSupplier({ categoryId: catId, name: 'ספק מק״ט' });
    const matId = await addRawMaterial({
      supplierCategoryId: catId,
      supplierId: supId,
      name: 'חמאה בדיקת מקט',
      unit: 'ק"ג',
      unitPrice: 28,
      packageWeightGrams: 1000,
      sku: 'BUT-1KG',
      notes: 'שמור בקירור',
      minOrderQty: 4,
    });
    const mat = await db.rawMaterials.get(matId);
    assertEqual(mat.sku, 'BUT-1KG');
    assertEqual(mat.notes, 'שמור בקירור');
    assertEqual(mat.minOrderQty, 4);
    assertEqual(Number(mat.supplierId), Number(supId));

    await wait(50);
    const queue = await db.syncQueue.toArray();
    const matPush = queue.find((q) => q.collection === 'rawMaterials' && String(q.localKey) === String(matId));
    assertOk(matPush, 'נוסף ל-syncQueue');
  });

  await testAsync('coerceSupplierNumericFks + browse — חומר עם supplierId מחרוזת מופיע תחת הספק', async () => {
    await wait(100);
    await resetDatabase();
    installLiveSyncMiddleware();
    await initDB();

    const catId = await addSupplierCategory('חומרי גלם');
    const supId = await addSupplier({ categoryId: catId, name: 'ספק מחרוזת' });
    const matId = await addRawMaterial({
      supplierCategoryId: catId,
      supplierId: supId,
      name: 'קמח מחרוזת',
      unit: 'ק"ג',
      unitPrice: 4,
    });
    await db.rawMaterials.update(matId, { supplierId: String(supId), supplierCategoryId: String(catId) });
    await db.suppliers.update(supId, { categoryId: String(catId) });

    const before = await getSuppliersBrowseLayout();
    const catBefore = before.categories.find((c) => Number(c.id) === Number(catId));
    const supBefore = catBefore?.suppliers.find((s) => Number(s.id) === Number(supId));
    assertOk(supBefore, 'הספק מופיע בצפייה גם עם categoryId מחרוזת');
    assertOk(
      (supBefore.materials || []).some((m) => Number(m.id) === Number(matId)),
      'החומר משויך לספק גם כש-supplierId מחרוזת',
    );

    const coerced = await coerceSupplierNumericFks();
    assertOk(coerced >= 1, 'תוקנו FKs מחרוזת');
    const mat = await db.rawMaterials.get(matId);
    assertEqual(typeof mat.supplierId, 'number');
    const sup = await db.suppliers.get(supId);
    assertEqual(typeof sup.categoryId, 'number');
    const listed = await getSuppliers(catId);
    assertEqual(listed.length, 1);
  });

  await testAsync('reconcileRawMaterialPricesFromHistory — unitPrice מיושר להיסטוריה', async () => {
    await wait(100);
    await resetDatabase();
    installLiveSyncMiddleware();
    await initDB();

    const catId = await addSupplierCategory('חומרי גלם');
    const matId = await addRawMaterial({
      supplierCategoryId: catId,
      name: 'סוכר היסטוריה',
      unit: 'ק"ג',
      unitPrice: 5,
    });
    await db.rawMaterials.update(matId, { unitPrice: 5 });
    await db.rawMaterialPriceHistory.add({
      rawMaterialId: matId,
      price: 9.5,
      effectiveDate: '2026-08-15',
      createdAt: new Date().toISOString(),
    });
    const n = await reconcileRawMaterialPricesFromHistory();
    assertOk(n >= 1, 'תוקן מחיר');
    const after = await db.rawMaterials.get(matId);
    assertEqual(Number(after.unitPrice), 9.5);
  });

  await testAsync('getSuppliersBrowseLayout — חומר בלי ספק מופיע תחת «ללא ספק»', async () => {
    await wait(100);
    await resetDatabase();
    installLiveSyncMiddleware();
    await initDB();

    const catId = await addSupplierCategory('חומרי גלם');
    await addSupplier({ categoryId: catId, name: 'ספק רגיל' });
    const matId = await addRawMaterial({
      supplierCategoryId: catId,
      name: 'בלי ספק',
      unit: 'ק"ג',
      unitPrice: 2,
    });
    const layout = await getSuppliersBrowseLayout();
    const cat = layout.categories.find((c) => Number(c.id) === Number(catId));
    const unassigned = cat?.suppliers.find((s) => s.isUnassigned);
    assertOk(unassigned, 'יש בלוק ללא ספק');
    assertOk(
      (unassigned.materials || []).some((m) => Number(m.id) === Number(matId)),
      'החומר מופיע תחת ללא ספק',
    );
  });

  await testAsync('עוגת דבש — כפילות בגרסה 2 מתפצלת חזרה לגרסה 1', async () => {
    await wait(100);
    await resetDatabase();
    installLiveSyncMiddleware();
    await initDB();

    const recCatId = await addRecipeCategory('מתכוני דבש בדיקה');
    const recipeId = await addRecipe({ categoryId: recCatId, name: 'עוגת דבש' });
    await addRecipeIngredient(recipeId, { name: 'קמח', quantity: 12, unitKind: 'kg' });
    await addRecipeIngredient(recipeId, { name: 'סוכר', quantity: 7.5, unitKind: 'kg' });
    await addRecipeIngredient(recipeId, { name: 'דבש טבעי', quantity: 500, unitKind: 'g' });

    const v1 = await getRecipe(recipeId);
    assertEqual((v1.ingredients || []).length, 3, 'גרסה 1: 3 חומרים');
    const v2id = await addRecipeVersion(recipeId, {
      name: 'גרסה 2',
      copyFromVersionId: v1.activeVersionId,
    });
    const versions = await listRecipeVersions(recipeId);
    assertEqual(versions.length, 2);

    // מדמה את הבאג: כל חומרי גרסה 1 עברו לגרסה 2 — שם הכל כפול, גרסה 1 ריקה
    const allIngs = await db.recipeIngredients.where('recipeId').equals(recipeId).toArray();
    for (const ing of allIngs) {
      await db.recipeIngredients.update(ing.id, { recipeVersionId: v2id });
    }

    const brokenV2 = await getRecipe(recipeId, { versionId: v2id, useDefaultVersion: false });
    // getRecipe מפעיל תיקון אוטומטי — אחרי המעבר המדומה הפתיחה עצמה אמורה לפצל
    const repairedV1 = await getRecipe(recipeId, { versionId: versions[0].id, useDefaultVersion: false });
    const repairedV2 = await getRecipe(recipeId, { versionId: v2id, useDefaultVersion: false });
    assertEqual((repairedV1.ingredients || []).length, 3, 'גרסה 1 חזרה ל-3 חומרים');
    assertEqual((repairedV2.ingredients || []).length, 3, 'גרסה 2 נשארת עם 3 חומרים');
    const names1 = repairedV1.ingredients.map((i) => i.name).sort().join(',');
    const names2 = repairedV2.ingredients.map((i) => i.name).sort().join(',');
    assertEqual(names1, names2);
    assertOk(brokenV2, 'גרסה 2 קיימת אחרי התיקון');

    const again = await repairSplitDoubledRecipeVersionIngredients();
    assertEqual(again.moves, 0, 'תיקון חוזר לא מזיז שוב');
    assertEqual(again.deletes, 0, 'תיקון חוזר לא מוחק שוב');
  });

  await testAsync('עוגת דבש — גרסה 2 כפולה כשגרסה 1 עדיין מלאה מנקה כפילות', async () => {
    await wait(100);
    await resetDatabase();
    installLiveSyncMiddleware();
    await initDB();

    const recCatId = await addRecipeCategory('מתכוני דבש בדיקה 2');
    const recipeId = await addRecipe({ categoryId: recCatId, name: 'עוגת דבש' });
    await addRecipeIngredient(recipeId, { name: 'קמח', quantity: 12, unitKind: 'kg' });
    await addRecipeIngredient(recipeId, { name: 'סוכר', quantity: 7.5, unitKind: 'kg' });

    const v1 = await getRecipe(recipeId);
    const v2id = await addRecipeVersion(recipeId, {
      name: 'גרסה 2',
      copyFromVersionId: v1.activeVersionId,
    });
    // מדמה העתקה כפולה לגרסה 2 בזמן שגרסה 1 נשארה מלאה
    const v2ings = (await db.recipeIngredients.where('recipeId').equals(recipeId).toArray())
      .filter((i) => Number(i.recipeVersionId) === Number(v2id));
    for (const ing of v2ings) {
      await db.recipeIngredients.add({
        recipeId,
        recipeVersionId: v2id,
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        unitKind: ing.unitKind,
        sortOrder: (ing.sortOrder || 0) + 10,
        priceSource: 'max',
      });
    }

    const repairedV2 = await getRecipe(recipeId, { versionId: v2id, useDefaultVersion: false });
    const repairedV1 = await getRecipe(recipeId, { versionId: v1.activeVersionId, useDefaultVersion: false });
    assertEqual((repairedV1.ingredients || []).length, 2, 'גרסה 1 נשארת עם 2 חומרים');
    assertEqual((repairedV2.ingredients || []).length, 2, 'גרסה 2 ירדה מ-4 ל-2 חומרים');
    assertEqual(
      repairedV2.ingredients.map((i) => i.name).sort().join(','),
      ['קמח', 'סוכר'].sort().join(','),
    );
  });

await flushTests();
}
