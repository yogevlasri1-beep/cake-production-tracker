import { db, ValidationError } from './db.js?v=418';
import {
  getRawMaterials,
  getSupplierCategories,
  getSuppliers,
  addSupplierShortage,
} from './kitchen-db.js?v=418';
import { localDateTimeISO } from './utils.js?v=418';

function sanitizeStockQty(val, { allowNegative = false } = {}) {
  if (val === '' || val == null) return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  if (!allowNegative && n < 0) return null;
  return Math.round(n * 1000) / 1000;
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
      supplierName: mat.supplierId ? (supMap.get(mat.supplierId)?.name || '') : '',
      lastAdjustedAt: bal?.lastAdjustedAt || null,
      lastAdjustmentReason: bal?.lastAdjustmentReason || '',
    });
  }

  rows.sort((a, b) => {
    if (a.isLow !== b.isLow) return a.isLow ? -1 : 1;
    const cat = a.categoryName.localeCompare(b.categoryName, 'he');
    if (cat) return cat;
    return String(a.material.name || '').localeCompare(String(b.material.name || ''), 'he');
  });
  return rows;
}

export async function adjustInventoryStock({
  rawMaterialId,
  delta,
  setQty = null,
  minQty = undefined,
  reason = '',
  unit = '',
}) {
  const mid = Number(rawMaterialId);
  if (!mid) throw new ValidationError('חומר גלם לא תקין');
  const mat = await db.rawMaterials.get(mid);
  if (!mat) throw new ValidationError('חומר גלם לא נמצא');

  let existing = await getInventoryBalanceForMaterial(mid);
  const current = existing ? Number(existing.qtyOnHand) || 0 : 0;

  let nextQty;
  let appliedDelta;
  if (setQty != null && setQty !== '') {
    nextQty = sanitizeStockQty(setQty, { allowNegative: false });
    if (nextQty == null) throw new ValidationError('כמות לא תקינה');
    appliedDelta = Math.round((nextQty - current) * 1000) / 1000;
  } else {
    const d = sanitizeStockQty(delta, { allowNegative: true });
    if (d == null || d === 0) throw new ValidationError('יש להזין שינוי כמות (+/−)');
    nextQty = Math.round((current + d) * 1000) / 1000;
    if (nextQty < 0) throw new ValidationError('המלאי לא יכול להיות שלילי');
    appliedDelta = d;
  }

  const now = localDateTimeISO();
  const note = String(reason || '').trim().slice(0, 200);
  const unitVal = String(unit || existing?.unit || mat.unit || '').trim().slice(0, 24);

  let nextMin = existing?.minQty ?? null;
  if (minQty !== undefined) {
    if (minQty === '' || minQty == null) nextMin = null;
    else {
      nextMin = sanitizeStockQty(minQty, { allowNegative: false });
      if (nextMin == null) throw new ValidationError('כמות מינימום לא תקינה');
    }
  }

  if (existing) {
    await db.inventoryBalances.update(existing.id, {
      qtyOnHand: nextQty,
      minQty: nextMin,
      unit: unitVal,
      lastAdjustedAt: now,
      lastAdjustmentDelta: appliedDelta,
      lastAdjustmentReason: note,
    });
    return db.inventoryBalances.get(existing.id);
  }

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
  return db.inventoryBalances.get(id);
}

export async function setInventoryMinQty(rawMaterialId, minQty) {
  return adjustInventoryStock({
    rawMaterialId,
    delta: 0,
    setQty: null,
    minQty,
    reason: 'עדכון מינימום',
  }).catch(async (err) => {
    // delta 0 fails — do a no-op set to current qty
    if (String(err?.message || '').includes('שינוי כמות')) {
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
    throw err;
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

export { sanitizeStockQty };
