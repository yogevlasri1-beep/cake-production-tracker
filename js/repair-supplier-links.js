/** קישור ספקים לפי שם — רק שמות עם ספק אחד ברור מגיבוי 1.9. בלי מחיר, בלי מחיקה. */

export function normMaterialName(name) {
  return String(name || '').replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ');
}

export function hasNumericSupplierId(value) {
  if (value == null || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && String(n) === String(value).trim();
}

/** שם מנורמל → ספק + קטגוריה. ממרח בטעם שוקולד הריק לא כאן — יש שורה מקושרת. */
export const UNAMBIGUOUS_SUPPLIER_LINKS = {
  'תמצית לימון': { supplierId: 53, supplierCategoryId: 26, supplierName: 'בדור' },
  'ביצים מעורב': { supplierId: 46, supplierCategoryId: 26, supplierName: 'ביצי צאם' },
  'אגוזי מלך שבורים': { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  'מחית תפו"ע ללא סוכר': { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  'ממרח אגוזים': { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  'מרגרינה': { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  'מרגרינה דנית פרימיום': { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  'פוטסיום סורבט': { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  'פרימקס': { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  'קקאו': { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  'ריבה צהובה': { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  "שוקוצ'פס": { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  'בר בכפר': { supplierId: 42, supplierCategoryId: 26, supplierName: 'כפר תבור' },
  'גבינה כחושה': { supplierId: 42, supplierCategoryId: 26, supplierName: 'כפר תבור' },
  'חמאה': { supplierId: 42, supplierCategoryId: 26, supplierName: 'כפר תבור' },
  'סוכר': { supplierId: 43, supplierCategoryId: 26, supplierName: 'לויאני' },
  'סוכר חום דביק': { supplierId: 43, supplierCategoryId: 26, supplierName: 'לויאני' },
  'קוקוס': { supplierId: 43, supplierCategoryId: 26, supplierName: 'לויאני' },
  'קוקוס יקר': { supplierId: 43, supplierCategoryId: 26, supplierName: 'לויאני' },
  'ריבה בטעם תות': { supplierId: 43, supplierCategoryId: 26, supplierName: 'לויאני' },
  'כוס חדפ חם לבן': { supplierId: 18, supplierCategoryId: 25, supplierName: 'מ.ר כלים' },
  'כפית קשיח שחור': { supplierId: 18, supplierCategoryId: 25, supplierName: 'מ.ר כלים' },
  'כפפות ניטריל L': { supplierId: 18, supplierCategoryId: 25, supplierName: 'מ.ר כלים' },
  'כפפות ניטריל M': { supplierId: 18, supplierCategoryId: 25, supplierName: 'מ.ר כלים' },
  'נייר טואלט': { supplierId: 18, supplierCategoryId: 25, supplierName: 'מ.ר כלים' },
  'נייר תעשייתי': { supplierId: 18, supplierCategoryId: 25, supplierName: 'מ.ר כלים' },
  'סטרץ לעטיפת משטחים בגליל': { supplierId: 18, supplierCategoryId: 25, supplierName: 'מ.ר כלים' },
  'סמרטוט ריצפה לבנה': { supplierId: 18, supplierCategoryId: 25, supplierName: 'מ.ר כלים' },
  'צלחת פלסטיק קשיח קרם': { supplierId: 18, supplierCategoryId: 25, supplierName: 'מ.ר כלים' },
  'שישיית קונטרול': { supplierId: 18, supplierCategoryId: 25, supplierName: 'מ.ר כלים' },
  'שקיות אשפה שחורות': { supplierId: 18, supplierCategoryId: 25, supplierName: 'מ.ר כלים' },
  'סוכר לבן': { supplierId: 41, supplierCategoryId: 26, supplierName: 'מזרחי' },
  'קמח': { supplierId: 41, supplierCategoryId: 26, supplierName: 'מזרחי' },
  'מים': { supplierId: 55, supplierCategoryId: 26, supplierName: 'מים' },
  'אבקת אפייה': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'אבקת סוכר': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'אבקת פונדנט': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'אגוז מוסקט': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'אגוזי מלך': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'ברקת -תחליף ביצים': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'גליצרין': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'גרנטה': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'דבש טהור': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'חומץ': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'מאפינס שוקולד': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'מאפינס תפוז': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'מזרה בטעם שוקולד': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'מזרה סוכריות ארוך מקרונים': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'מחית תפוח ללא סוכר': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'ממרח בטעם אגוזים': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'ממרח קינמון': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'ממרח שוקולד': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'ממרח שוקולד אקספלור': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'מרגרינה מעדינה': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'מרק עוף': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'משפר כללי': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'נייר אפיה 60/60': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'סוכר אינוורטי': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'סוכר וניל': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'עמילן נמס': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'פודינג וניל': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'פלפל לבן': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'ציפורן': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'קורנפלור': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'קינמון': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'קסנטן': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'קפה': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'קרם פטסייר': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'קרם קינמון': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'רוטב פיצה': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'שבבי תפו"א': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'שק זילוף': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'תבלין ציפורן': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'תבנית קרטון 808': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'תחליף סוכר': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'תרכיז תפוחים': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'תפוחים': { supplierId: 44, supplierCategoryId: 26, supplierName: 'פלחפוח' },
  'סולת': { supplierId: 51, supplierCategoryId: 26, supplierName: 'שטיבל' },
  'קמח מלא': { supplierId: 51, supplierCategoryId: 26, supplierName: 'שטיבל' },
  'גלוטן': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'מחית אוכמניות': { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  'מחית דובדבן': { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  'מחית תפוחים': { supplierId: 39, supplierCategoryId: 26, supplierName: 'פוליבה' },
  'מלח': { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  'ממרח חלבה': { supplierId: 43, supplierCategoryId: 26, supplierName: 'לויאני' },
  'פרג': { supplierId: 52, supplierCategoryId: 26, supplierName: 'א.ג.מ סחר מזון' },
  'צימוק לבן': { supplierId: 43, supplierCategoryId: 26, supplierName: 'לויאני' },
  'שומן קוקוס': { supplierId: 40, supplierCategoryId: 26, supplierName: 'השלושה' },
  'שומשום': { supplierId: 43, supplierCategoryId: 26, supplierName: 'לויאני' },
  'שמן סויה': { supplierId: 43, supplierCategoryId: 26, supplierName: 'לויאני' },
  'שמן סויה 16 ק"ג': { supplierId: 41, supplierCategoryId: 26, supplierName: 'מזרחי' },
  'שמרים יבשים': { supplierId: 43, supplierCategoryId: 26, supplierName: 'לויאני' },
};

export function planSupplierLinkRepair(materials, suppliers) {
  const supById = new Map((suppliers || []).map((s) => [Number(s.id), s]));
  const preview = [];
  const toFix = [];
  for (const m of materials || []) {
    const name = normMaterialName(m.name);
    const plan = UNAMBIGUOUS_SUPPLIER_LINKS[name];
    if (!plan) continue;
    if (hasNumericSupplierId(m.supplierId)) {
      preview.push({ action: 'skip-has-supplier', id: m.id, name, supplierName: plan.supplierName });
      continue;
    }
    if (!supById.has(Number(plan.supplierId))) {
      preview.push({ action: 'skip-missing-supplier', id: m.id, name, supplierName: plan.supplierName });
      continue;
    }
    preview.push({ action: 'link', id: m.id, name, supplierName: plan.supplierName });
    toFix.push({
      id: m.id,
      supplierId: plan.supplierId,
      supplierCategoryId: plan.supplierCategoryId,
    });
  }
  return { toFix, preview, linkCount: toFix.length };
}

export async function applySupplierLinkRepair({ db, getLiveSyncSettings }) {
  const live = await getLiveSyncSettings();
  if (live?.enabled !== false) {
    return { ok: false, reason: 'live-sync-on', linked: 0 };
  }
  const [materials, suppliers] = await Promise.all([
    db.rawMaterials.toArray(),
    db.suppliers.toArray(),
  ]);
  const { toFix } = planSupplierLinkRepair(materials, suppliers);
  for (const row of toFix) {
    await db.rawMaterials.update(row.id, {
      supplierId: row.supplierId,
      supplierCategoryId: row.supplierCategoryId,
    });
  }
  const after = await db.rawMaterials.toArray();
  const withSupplier = after.filter((m) => hasNumericSupplierId(m.supplierId)).length;
  return {
    ok: true,
    linked: toFix.length,
    materials: after.length,
    withSupplier,
    noSupplier: after.length - withSupplier,
  };
}
