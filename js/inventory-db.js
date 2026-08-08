import { db, ValidationError } from './db.js?v=450';
import {
  getRawMaterials,
  getSupplierCategories,
  getSuppliers,
  addSupplierShortage,
  computeWeeklyMaterialNeeds,
  updateSupplierShortage,
  getRecipe,
  getRecipeSubRecipes,
  getPortionPresetIngredientsFormData,
  resolveRecipeIngredientMaterial,
  buildMaterialsByNameKey,
} from './kitchen-db.js?v=450';
import { localDateTimeISO, roundDecimal } from './utils.js?v=450';
import { logAuditEvent } from './audit.js?v=450';

function sanitizeStockQty(val, { allowNegative = false } = {}) {
  if (val === '' || val == null) return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  if (!allowNegative && n < 0) return null;
  return Math.round(n * 1000) / 1000;
}

async function currentUserStamp() {
  try {
    const { getCurrentUserEmail, getCurrentUserDisplayName } = await import('./auth.js?v=450');
    return {
      userEmail: getCurrentUserEmail() || '',
      userName: getCurrentUserDisplayName() || '',
    };
  } catch {
    return { userEmail: '', userName: '' };
  }
}

export async function getInventoryBalances() {
  const rows = await db.inventoryBalances.toArray();
  rows.sort((a, b) => a.id - b.id);
  return rows;
}

export async function getInventoryBalanceForMaterial(rawMaterialId) {
  const mid = Number(rawMaterialId);
  if (!mid) return null;
  return (await db.inventoryBalances.where('rawMaterialId').equals(mid).first()) || null;
}

export async function getInventoryStockRows({ search = '', categoryId = null, lowOnly = false } = {}) {
  const [materials, balances, categories, suppliers] = await Promise.all([
    getRawMaterials(),
    getInventoryBalances(),
    getSupplierCategories(),
    getSuppliers(),
  ]);
  const balMap = new Map(balances.map((b) => [b.rawMaterialId, b]));
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const supMap = new Map(suppliers.map((s) => [s.id, s]));
  const q = String(search || '').trim().toLocaleLowerCase('he');
  const catFilter = categoryId ? Number(categoryId) : null;

  const rows = [];
  for (const mat of materials) {
    if (catFilter && Number(mat.supplierCategoryId) !== catFilter) continue;
    if (q) {
      const name = String(mat.name || '').toLocaleLowerCase('he');
      const syn = String(mat.synonyms || '').toLocaleLowerCase('he');
      if (!name.includes(q) && !syn.includes(q)) continue;
    }
    const bal = balMap.get(mat.id) || null;
    const qtyOnHand = bal ? Number(bal.qtyOnHand) || 0 : 0;
    const minQty = bal?.minQty != null ? Number(bal.minQty) : null;
    const isLow = minQty != null && qtyOnHand <= minQty;
    if (lowOnly && !isLow) continue;
    rows.push({
      material: mat,
      balance: bal,
      qtyOnHand,
      minQty,
      isLow,
      unit: bal?.unit || mat.unit || '',
      categoryName: catMap.get(mat.supplierCategoryId)?.name || 'ללא קטגוריה',
      supplierId: mat.supplierId ? Number(mat.supplierId) : null,
      supplierName: mat.supplierId ? (supMap.get(mat.supplierId)?.name || '') : '',
      isPackaging: !!catMap.get(mat.supplierCategoryId)?.isPackaging,
      isCleaning: !!catMap.get(mat.supplierCategoryId)?.isCleaning,
      lastAdjustedAt: bal?.lastAdjustedAt || null,
      lastAdjustmentReason: bal?.lastAdjustmentReason || '',
    });
  }

  rows.sort((a, b) => {
    if (a.isLow !== b.isLow) return a.isLow ? -1 : 1;
    const sa = a.supplierName || '\uffff';
    const sb = b.supplierName || '\uffff';
    const bySup = sa.localeCompare(sb, 'he');
    if (bySup) return bySup;
    const kindRank = (r) => (r.isPackaging ? 1 : r.isCleaning ? 2 : 0);
    const kr = kindRank(a) - kindRank(b);
    if (kr) return kr;
    return String(a.material.name || '').localeCompare(String(b.material.name || ''), 'he');
  });
  return rows;
}

export async function getInventoryMovements({
  rawMaterialId = null,
  search = '',
  limit = 200,
} = {}) {
  let rows;
  const mid = rawMaterialId ? Number(rawMaterialId) : null;
  if (mid) {
    rows = await db.inventoryMovements.where('rawMaterialId').equals(mid).toArray();
  } else {
    rows = await db.inventoryMovements.toArray();
  }
  rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')) || (b.id - a.id));

  const q = String(search || '').trim().toLocaleLowerCase('he');
  if (q) {
    rows = rows.filter((r) => {
      const name = String(r.materialName || '').toLocaleLowerCase('he');
      const reason = String(r.reason || '').toLocaleLowerCase('he');
      const email = String(r.userEmail || '').toLocaleLowerCase('he');
      const pkg = String(r.packagingBatchNumber || '').toLocaleLowerCase('he');
      const runBatch = String(r.runBatchNumber || '').toLocaleLowerCase('he');
      const batchNums = Array.isArray(r.ingredientBatches)
        ? r.ingredientBatches.map((b) => String(b.packagingBatchNumber || '').toLocaleLowerCase('he')).join(' ')
        : '';
      return name.includes(q) || reason.includes(q) || email.includes(q)
        || pkg.includes(q) || runBatch.includes(q) || batchNums.includes(q);
    });
  }
  if (limit > 0) rows = rows.slice(0, limit);
  return rows;
}

/** מפחית ניפוק ממנות פעילות (FIFO — הישנה ביותר קודם), סוגר מנה שהגיעה ל-0. בלי מנות תואמות — לא קורה כלום. */
async function consumeActiveLotsFifo(rawMaterialId, qtyToConsume) {
  if (!(qtyToConsume > 0) || !db.activeLots) return;
  let remaining = qtyToConsume;
  const lots = (await db.activeLots.where('rawMaterialId').equals(rawMaterialId).toArray())
    .filter((l) => l.status !== 'closed' && (Number(l.qtyOnHand) || 0) > 0)
    .sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')));
  for (const lot of lots) {
    if (remaining <= 0) break;
    const onHand = Number(lot.qtyOnHand) || 0;
    const take = Math.min(onHand, remaining);
    const nextQty = Math.round((onHand - take) * 1000) / 1000;
    const patch = { qtyOnHand: nextQty };
    if (nextQty <= 0) {
      patch.status = 'closed';
      patch.closedAt = localDateTimeISO();
    }
    await db.activeLots.update(lot.id, patch);
    remaining = Math.round((remaining - take) * 1000) / 1000;
  }
}

export async function adjustInventoryStock({
  rawMaterialId,
  delta,
  setQty = null,
  minQty = undefined,
  reason = '',
  unit = '',
  lotMeta = null,
}) {
  const mid = Number(rawMaterialId);
  if (!mid) throw new ValidationError('חומר גלם לא תקין');
  const mat = await db.rawMaterials.get(mid);
  if (!mat) throw new ValidationError('חומר גלם לא נמצא');

  let existing = await getInventoryBalanceForMaterial(mid);
  const current = existing ? Number(existing.qtyOnHand) || 0 : 0;

  let nextQty;
  let appliedDelta;
  let kind = 'adjust';
  if (setQty != null && setQty !== '') {
    nextQty = sanitizeStockQty(setQty, { allowNegative: false });
    if (nextQty == null) throw new ValidationError('כמות לא תקינה');
    appliedDelta = Math.round((nextQty - current) * 1000) / 1000;
    kind = 'set';
  } else {
    const d = sanitizeStockQty(delta, { allowNegative: true });
    if (d == null || d === 0) throw new ValidationError('יש להזין שינוי כמות (+/−)');
    nextQty = Math.round((current + d) * 1000) / 1000;
    if (nextQty < 0) throw new ValidationError('המלאי לא יכול להיות שלילי');
    appliedDelta = d;
    kind = d > 0 ? 'receive' : 'issue';
  }

  const now = localDateTimeISO();
  const note = String(reason || '').trim().slice(0, 200);
  const unitVal = String(unit || existing?.unit || mat.unit || '').trim().slice(0, 24);
  const user = await currentUserStamp();

  let nextMin = existing?.minQty ?? null;
  if (minQty !== undefined) {
    if (minQty === '' || minQty == null) nextMin = null;
    else {
      nextMin = sanitizeStockQty(minQty, { allowNegative: false });
      if (nextMin == null) throw new ValidationError('כמות מינימום לא תקינה');
    }
  }

  const lotFields = {};
  if (lotMeta && typeof lotMeta === 'object') {
    const pkg = String(lotMeta.packagingBatchNumber || '').trim().slice(0, 80);
    if (pkg) lotFields.packagingBatchNumber = pkg;
    if (lotMeta.productionRunId != null) lotFields.productionRunId = Number(lotMeta.productionRunId) || null;
    if (lotMeta.runBatchNumber) lotFields.runBatchNumber = String(lotMeta.runBatchNumber).trim().slice(0, 80);
    if (Array.isArray(lotMeta.ingredientBatches) && lotMeta.ingredientBatches.length) {
      lotFields.ingredientBatches = lotMeta.ingredientBatches.slice(0, 20).map((b) => ({
        packagingBatchNumber: String(b.packagingBatchNumber || '').trim().slice(0, 80),
        name: String(b.name || '').trim().slice(0, 80),
        rawMaterialId: b.rawMaterialId ? Number(b.rawMaterialId) : null,
        supplierName: String(b.supplierName || '').trim().slice(0, 80),
      })).filter((b) => b.packagingBatchNumber);
    }
  }

  let balance;
  let movementId = null;
  const wasCreate = !existing;
  await db.transaction('rw', db.inventoryBalances, db.inventoryMovements, db.activeLots, async () => {
    if (existing) {
      await db.inventoryBalances.update(existing.id, {
        qtyOnHand: nextQty,
        minQty: nextMin,
        unit: unitVal,
        lastAdjustedAt: now,
        lastAdjustmentDelta: appliedDelta,
        lastAdjustmentReason: note,
      });
      balance = await db.inventoryBalances.get(existing.id);
    } else {
      const id = await db.inventoryBalances.add({
        rawMaterialId: mid,
        qtyOnHand: nextQty,
        minQty: nextMin,
        unit: unitVal,
        notes: '',
        lastAdjustedAt: now,
        lastAdjustmentDelta: appliedDelta,
        lastAdjustmentReason: note,
      });
      balance = await db.inventoryBalances.get(id);
    }

    if (appliedDelta !== 0) {
      movementId = await db.inventoryMovements.add({
        rawMaterialId: mid,
        materialName: mat.name || '',
        at: now,
        kind,
        delta: appliedDelta,
        qtyBefore: current,
        qtyAfter: nextQty,
        unit: unitVal,
        reason: note,
        userEmail: user.userEmail,
        userName: user.userName,
        ...lotFields,
      });
    }

    if (kind === 'issue') {
      await consumeActiveLotsFifo(mid, Math.abs(appliedDelta));
    }
  });

  if (appliedDelta !== 0) {
    logAuditEvent({
      entityTable: 'inventoryMovements',
      entityId: movementId || `${mid}:${now}`,
      action: 'create',
      snapshot: {
        materialName: mat.name || '',
        rawMaterialId: mid,
        kind,
        delta: appliedDelta,
        qtyBefore: current,
        qtyAfter: nextQty,
        unit: unitVal,
        reason: note,
        packagingBatchNumber: lotFields.packagingBatchNumber || null,
      },
    });
    logAuditEvent({
      entityTable: 'inventoryBalances',
      entityId: balance?.id || mid,
      action: wasCreate ? 'create' : 'update',
      snapshot: {
        materialName: mat.name || '',
        rawMaterialId: mid,
        qtyOnHand: nextQty,
        unit: unitVal,
        reason: note,
      },
    });
  }

  return balance;
}

/** קליטת חומר גלם עם מספר מנה — עוטף adjustInventoryStock ופותח שורת "מנה פעילה" אם ניתן מספר */
export async function receiveInventoryLot({
  rawMaterialId, qty, unit = '', packagingBatchNumber = '', supplierName = '', reason = '',
}) {
  const pkg = String(packagingBatchNumber || '').trim().slice(0, 80);
  const balance = await adjustInventoryStock({
    rawMaterialId,
    delta: qty,
    unit,
    reason: reason || (pkg ? `קליטה · מנה ${pkg}` : 'קליטה'),
    lotMeta: pkg ? { packagingBatchNumber: pkg } : null,
  });
  if (pkg) {
    const qtyNum = sanitizeStockQty(qty, { allowNegative: false }) ?? 0;
    await db.activeLots.add({
      rawMaterialId: Number(rawMaterialId),
      packagingBatchNumber: pkg,
      qtyReceived: qtyNum,
      qtyOnHand: qtyNum,
      unit: String(unit || balance?.unit || '').trim().slice(0, 24),
      receivedAt: localDateTimeISO(),
      supplierName: String(supplierName || '').trim().slice(0, 80),
      status: 'open',
      notes: '',
      closedAt: null,
    });
  }
  return balance;
}

/** מנות פעילות (ברירת מחדל: פתוחות בלבד) — לבחירה בתזרים/תצוגה */
export async function listActiveLots({ rawMaterialId = null, includeClosed = false } = {}) {
  let rows = rawMaterialId
    ? await db.activeLots.where('rawMaterialId').equals(Number(rawMaterialId)).toArray()
    : await db.activeLots.toArray();
  if (!includeClosed) rows = rows.filter((r) => r.status !== 'closed');
  return rows.sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')));
}

export async function closeActiveLot(id) {
  const row = await db.activeLots.get(Number(id));
  if (!row) throw new ValidationError('מנה לא נמצאה');
  await db.activeLots.update(row.id, { status: 'closed', closedAt: localDateTimeISO() });
}

export async function reopenActiveLot(id) {
  const row = await db.activeLots.get(Number(id));
  if (!row) throw new ValidationError('מנה לא נמצאה');
  await db.activeLots.update(row.id, { status: 'open', closedAt: null });
}

export async function setInventoryMinQty(rawMaterialId, minQty) {
  const bal = await getInventoryBalanceForMaterial(rawMaterialId);
  const mat = await db.rawMaterials.get(Number(rawMaterialId));
  const current = bal ? Number(bal.qtyOnHand) || 0 : 0;
  return adjustInventoryStock({
    rawMaterialId,
    setQty: current,
    minQty,
    reason: 'עדכון מינימום',
    unit: bal?.unit || mat?.unit || '',
  });
}

export async function addInventoryItemToShortages(rawMaterialId, orderQuantity = null) {
  const mid = Number(rawMaterialId);
  const mat = await db.rawMaterials.get(mid);
  if (!mat) throw new ValidationError('חומר גלם לא נמצא');
  if (!mat.supplierId) throw new ValidationError('לחומר אין ספק משויך — שייך בספקים ואז הוסף לחוסרים');
  return addSupplierShortage({
    supplierId: mat.supplierId,
    rawMaterialId: mid,
    orderQuantity,
    unit: mat.unit || '',
    notes: 'ממלאי',
  });
}

export function inventoryLowCount(rows) {
  return (rows || []).filter((r) => r.isLow).length;
}

export function inventoryMovementKindLabel(kind) {
  if (kind === 'receive') return 'קבלה';
  if (kind === 'issue') return 'ניפוק';
  if (kind === 'set') return 'הגדרה';
  return 'התאמה';
}

/**
 * פער הזמנה = צורך מתוכנן לשבוע − יתרה במלאי.
 * gap > 0 ⇒ חסר; gap <= 0 ⇒ מספיק / עודף.
 */
export async function computeWeeklyInventoryGaps(weekStart, { onlyShortage = true } = {}) {
  const [{ allNeeds, plan, categories: needCategories }, balances] = await Promise.all([
    computeWeeklyMaterialNeeds(weekStart),
    getInventoryBalances(),
  ]);
  const balMap = new Map(balances.map((b) => [b.rawMaterialId, b]));

  const rows = (allNeeds || []).map((need) => {
    const bal = need.rawMaterialId ? balMap.get(need.rawMaterialId) : null;
    const qtyOnHand = bal ? Number(bal.qtyOnHand) || 0 : 0;
    const needed = Number(need.totalQty) || 0;
    const gap = Math.round((needed - qtyOnHand) * 1000) / 1000;
    return {
      rawMaterialId: need.rawMaterialId,
      name: need.name,
      unit: need.unit || bal?.unit || '',
      supplierCategoryId: need.supplierCategoryId || 0,
      supplierCategoryName: need.supplierCategoryName || 'ללא קטגוריה',
      supplierId: need.supplierId || null,
      needed,
      qtyOnHand,
      gap,
      orderQty: gap > 0 ? gap : 0,
      products: need.products || [],
      hasBalance: !!bal,
    };
  });

  rows.sort((a, b) => {
    if ((a.gap > 0) !== (b.gap > 0)) return a.gap > 0 ? -1 : 1;
    const g = b.gap - a.gap;
    if (g) return g;
    return String(a.name).localeCompare(String(b.name), 'he');
  });

  const filtered = onlyShortage ? rows.filter((r) => r.gap > 0) : rows;
  const shortageCount = rows.filter((r) => r.gap > 0).length;
  const totalOrderQty = filtered.reduce((s, r) => s + (r.orderQty || 0), 0);

  return {
    weekStart,
    plan,
    rows: filtered,
    allRows: rows,
    shortageCount,
    totalOrderQty,
    needCategories,
  };
}

export function formatWhatsAppGapOrderText({ weekStart, rows }) {
  const lines = [`📋 פער מלאי להזמנה — שבוע ${weekStart}`, ''];
  const shortages = (rows || []).filter((r) => r.gap > 0);
  if (!shortages.length) {
    lines.push('אין פערים — המלאי מכסה את התוכנית השבועית.');
    return lines.join('\n');
  }
  const byCat = new Map();
  for (const row of shortages) {
    const key = row.supplierCategoryName || 'ללא קטגוריה';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(row);
  }
  for (const [cat, items] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0], 'he'))) {
    lines.push(`*${cat}*`);
    for (const item of items) {
      lines.push(`• ${item.name}: להזמין ${item.orderQty} ${item.unit} (צורך ${item.needed}, במלאי ${item.qtyOnHand})`);
    }
    lines.push('');
  }
  lines.push('_נוצר מאפליקציית מעקב יצור — פער מלאי_');
  return lines.join('\n');
}

/**
 * קבלת חוסר למלאי: מוסיף כמות ליתרה, רושם תנועת קבלה, ומסמן את החוסר כהושלם.
 */
export async function receiveShortageToInventory(shortageId, { qty = null, packagingBatchNumber = '', supplierName = '' } = {}) {
  const id = Number(shortageId);
  if (!id) throw new ValidationError('פריט חוסר לא תקין');
  const row = await db.supplierShortages.get(id);
  if (!row) throw new ValidationError('פריט חוסר לא נמצא');
  if (!row.rawMaterialId) {
    throw new ValidationError('לחוסר אין חומר מהמחסן — שייך חומר ואז קבל למלאי');
  }
  if (row.done) throw new ValidationError('החוסר כבר סומן כהושלם');

  const receiveQty = qty != null && qty !== ''
    ? sanitizeStockQty(qty, { allowNegative: false })
    : (row.orderQuantity != null ? sanitizeStockQty(row.orderQuantity, { allowNegative: false }) : null);
  if (receiveQty == null || receiveQty <= 0) {
    throw new ValidationError('חסרה כמות לקבלה — הזן כמות בחוסר');
  }

  const mat = await db.rawMaterials.get(Number(row.rawMaterialId));
  const unit = row.unit || mat?.unit || '';
  const label = mat?.name || row.name || 'חומר';

  await receiveInventoryLot({
    rawMaterialId: row.rawMaterialId,
    qty: receiveQty,
    unit,
    packagingBatchNumber,
    supplierName,
    reason: `קבלה מחוסרים · ${label}`,
  });
  const stamp = localDateTimeISO().slice(0, 16).replace('T', ' ');
  const receiveNote = `נקלט ${receiveQty}${unit ? ` ${unit}` : ''} · ${stamp}`;
  const prevNotes = String(row.notes || '').trim();
  await updateSupplierShortage(id, {
    done: true,
    notes: prevNotes ? `${prevNotes} · ${receiveNote}` : receiveNote,
  });
  return { shortageId: id, rawMaterialId: row.rawMaterialId, qty: receiveQty, unit };
}

/** קבלה מרובה של חוסרים פתוחים עם חומר מקושר וכמות */
export async function receiveOpenShortagesToInventory() {
  const items = await db.supplierShortages.filter((i) => !i.done && i.rawMaterialId && i.orderQuantity != null).toArray();
  let ok = 0;
  let skipped = 0;
  const errors = [];
  for (const item of items) {
    try {
      await receiveShortageToInventory(item.id);
      ok++;
    } catch (err) {
      skipped++;
      errors.push(err.message || String(err));
    }
  }
  return { ok, skipped, errors };
}

async function loadRecipeCostingIngredients(recipeId) {
  const recipe = await getRecipe(Number(recipeId));
  if (!recipe) return { recipe: null, ingredients: [] };
  const ingredients = [...(recipe.ingredients || [])];
  if (!recipe.parentRecipeId) {
    const additions = await getRecipeSubRecipes(recipe.id);
    for (const addition of additions) {
      const full = await getRecipe(addition.id);
      ingredients.push(...(full?.ingredients || []));
    }
  }
  return { recipe, ingredients };
}

/**
 * תצוגה מקדימה של ניפוק מלאי לפי מנה ממתכון / חומר גלם.
 * qty = כמות במתכון × מספר מנות (כמו פער הזמנה שבועי).
 */
export async function previewProductionStockIssue({
  portionPresetId = null,
  recipeId = null,
  rawMaterialId = null,
  portionWeightKg = null,
  portionCount,
} = {}) {
  const count = Number(portionCount);
  if (!Number.isFinite(count) || count <= 0) {
    throw new ValidationError('מספר מנות לא תקין לניפוק');
  }

  const lines = [];
  const skipped = [];
  const byMaterial = new Map();

  const pushLine = (mid, name, qty, unit, qtyOnHand) => {
    const q = sanitizeStockQty(qty, { allowNegative: false });
    if (q == null || q <= 0) return;
    const id = Number(mid);
    if (!id) {
      skipped.push(name || 'חומר');
      return;
    }
    const prev = byMaterial.get(id);
    if (prev) {
      prev.qty = roundDecimal(prev.qty + q);
      return;
    }
    byMaterial.set(id, {
      rawMaterialId: id,
      name: name || 'חומר',
      qty: q,
      unit: unit || '',
      qtyOnHand: qtyOnHand != null ? Number(qtyOnHand) || 0 : 0,
    });
  };

  const pid = portionPresetId ? Number(portionPresetId) : null;
  if (pid) {
    const preset = await db.groupPortionPresets.get(pid);
    if (preset?.sourceRecipeId) {
      try {
        const form = await getPortionPresetIngredientsFormData(pid);
        const balances = await getInventoryBalances();
        const balMap = new Map(balances.map((b) => [b.rawMaterialId, b]));
        for (const row of form.rows || []) {
          const mid = row.rawMaterialId ? Number(row.rawMaterialId) : null;
          if (!mid) {
            skipped.push(row.name || 'חומר');
            continue;
          }
          const bal = balMap.get(mid);
          pushLine(
            mid,
            row.name,
            Number(row.quantity) * count,
            row.unit || bal?.unit || '',
            bal ? bal.qtyOnHand : 0,
          );
        }
      } catch {
        /* נופל למתכון ישיר למטה */
      }
    } else if (preset?.sourceRawMaterialId) {
      const mid = Number(preset.sourceRawMaterialId);
      const mat = await db.rawMaterials.get(mid);
      const bal = await getInventoryBalanceForMaterial(mid);
      const w = portionWeightKg != null && portionWeightKg !== ''
        ? Number(portionWeightKg)
        : Number(preset.weight);
      if (Number.isFinite(w) && w > 0) {
        pushLine(mid, mat?.name || preset.name, w * count, mat?.unit || bal?.unit || 'ק"ג', bal?.qtyOnHand ?? 0);
      } else {
        skipped.push(mat?.name || preset.name || 'חומר');
      }
    }
  }

  if (!byMaterial.size && recipeId) {
    const { ingredients } = await loadRecipeCostingIngredients(recipeId);
    const [materials, balances] = await Promise.all([getRawMaterials(), getInventoryBalances()]);
    const matById = new Map(materials.map((m) => [m.id, m]));
    const byNameKey = buildMaterialsByNameKey(materials);
    const balMap = new Map(balances.map((b) => [b.rawMaterialId, b]));
    for (const ing of ingredients) {
      const { mat } = resolveRecipeIngredientMaterial(ing, { matById, byNameKey });
      const mid = mat?.id || (ing.rawMaterialId ? Number(ing.rawMaterialId) : null);
      if (!mid) {
        skipped.push(ing.name || 'חומר');
        continue;
      }
      const bal = balMap.get(mid);
      pushLine(
        mid,
        mat?.name || ing.name,
        Number(ing.quantity) * count,
        mat?.unit || ing.unit || bal?.unit || '',
        bal?.qtyOnHand ?? 0,
      );
    }
  }

  if (!byMaterial.size && rawMaterialId && !pid) {
    const mid = Number(rawMaterialId);
    const mat = await db.rawMaterials.get(mid);
    const bal = await getInventoryBalanceForMaterial(mid);
    const w = Number(portionWeightKg);
    if (mat && Number.isFinite(w) && w > 0) {
      pushLine(mid, mat.name, w * count, mat.unit || bal?.unit || 'ק"ג', bal?.qtyOnHand ?? 0);
    }
  }

  for (const line of byMaterial.values()) {
    line.shortfall = Math.max(0, roundDecimal(line.qty - (Number(line.qtyOnHand) || 0)));
    lines.push(line);
  }
  lines.sort((a, b) => a.name.localeCompare(b.name, 'he'));

  return {
    portionCount: count,
    lines,
    skipped,
    hasShortfall: lines.some((l) => l.shortfall > 0),
  };
}

export function formatProductionIssueConfirm(preview) {
  const lines = preview?.lines || [];
  const parts = ['לנפק מלאי לפי המנה?'];
  for (const line of lines.slice(0, 12)) {
    const stock = `במלאי ${line.qtyOnHand}`;
    const warn = line.shortfall > 0 ? ' ⚠ חסר' : '';
    parts.push(`• ${line.name}: −${line.qty}${line.unit ? ` ${line.unit}` : ''} (${stock})${warn}`);
  }
  if (lines.length > 12) parts.push(`…ועוד ${lines.length - 12}`);
  if (preview?.skipped?.length) {
    parts.push(`(${preview.skipped.length} בלי קישור למלאי — ידולגו)`);
  }
  if (preview?.hasShortfall) {
    parts.push('יש חומרים עם יתרה נמוכה מהכמות — הניפוק ייכשל עליהם אלא אם תאשר דילוג.');
  }
  return parts.join('\n');
}

/**
 * ניפוק מלאי בפועל לפי תצוגה מקדימה / פרמטרים.
 * allowPartial: מדלג על שורות שנכשלות (מלאי שלילי) במקום לעצור.
 */
export async function issueStockFromProduction(previewOrOpts, {
  reasonLabel = 'ניפוק מייצור',
  allowPartial = true,
  lotMeta = null,
} = {}) {
  const preview = previewOrOpts?.lines
    ? previewOrOpts
    : await previewProductionStockIssue(previewOrOpts || {});
  const issued = [];
  const failed = [];

  for (const line of preview.lines || []) {
    try {
      const lineLot = lotMeta && typeof lotMeta === 'object'
        ? {
          ...lotMeta,
          // אם יש מספרי מנה פר־חומר — מעדיפים התאמה לפי rawMaterialId / שם
          packagingBatchNumber: (() => {
            const batches = Array.isArray(lotMeta.ingredientBatches) ? lotMeta.ingredientBatches : [];
            const match = batches.find((b) =>
              (b.rawMaterialId && Number(b.rawMaterialId) === Number(line.rawMaterialId))
              || (b.name && String(b.name).trim() === String(line.name || '').trim()));
            return (match?.packagingBatchNumber || lotMeta.packagingBatchNumber || '').trim();
          })(),
        }
        : null;
      await adjustInventoryStock({
        rawMaterialId: line.rawMaterialId,
        delta: -line.qty,
        reason: String(reasonLabel || 'ניפוק מייצור').slice(0, 200),
        unit: line.unit || '',
        lotMeta: lineLot,
      });
      issued.push({
        rawMaterialId: line.rawMaterialId,
        name: line.name,
        qty: line.qty,
        unit: line.unit || '',
        packagingBatchNumber: lineLot?.packagingBatchNumber || null,
      });
    } catch (err) {
      failed.push({ name: line.name, message: err.message || String(err) });
      if (!allowPartial) throw err;
    }
  }

  if (!issued.length && failed.length) {
    throw new ValidationError(failed[0].message || 'ניפוק מלאי נכשל');
  }

  return {
    issued,
    failed,
    skipped: preview.skipped || [],
    inventoryIssueLines: issued,
    inventoryIssuedAt: localDateTimeISO(),
  };
}

/** ביטול ניפוק — מחזיר כמויות ליתרה (תנועת קבלה עם סיבת ביטול) */
export async function reverseStockIssueLines(lines, { reasonLabel = 'ביטול ניפוק מייצור' } = {}) {
  const restored = [];
  for (const line of lines || []) {
    const qty = sanitizeStockQty(line.qty, { allowNegative: false });
    const mid = Number(line.rawMaterialId);
    if (!mid || qty == null || qty <= 0) continue;
    await adjustInventoryStock({
      rawMaterialId: mid,
      delta: qty,
      reason: String(reasonLabel || 'ביטול ניפוק מייצור').slice(0, 200),
      unit: line.unit || '',
    });
    restored.push({ rawMaterialId: mid, qty, unit: line.unit || '', name: line.name || '' });
  }
  return { restored };
}

export { sanitizeStockQty };
