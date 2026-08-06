import { db, ValidationError } from './db.js?v=421';
import {
  getRawMaterials,
  getSupplierCategories,
  getSuppliers,
  addSupplierShortage,
  computeWeeklyMaterialNeeds,
  updateSupplierShortage,
} from './kitchen-db.js?v=421';
import { localDateTimeISO } from './utils.js?v=421';

function sanitizeStockQty(val, { allowNegative = false } = {}) {
  if (val === '' || val == null) return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  if (!allowNegative && n < 0) return null;
  return Math.round(n * 1000) / 1000;
}

async function currentUserStamp() {
  try {
    const { getCurrentUserEmail, getCurrentUserDisplayName } = await import('./auth.js?v=421');
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
      return name.includes(q) || reason.includes(q) || email.includes(q);
    });
  }
  if (limit > 0) rows = rows.slice(0, limit);
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

  let balance;
  await db.transaction('rw', db.inventoryBalances, db.inventoryMovements, async () => {
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

    // רק אם הכמות באמת השתנתה — לא רושמים תנועה על עדכון מינימום בלבד
    if (appliedDelta !== 0) {
      await db.inventoryMovements.add({
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
      });
    }
  });

  return balance;
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
export async function receiveShortageToInventory(shortageId, { qty = null } = {}) {
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

  await adjustInventoryStock({
    rawMaterialId: row.rawMaterialId,
    delta: receiveQty,
    reason: `קבלה מחוסרים · ${label}`,
    unit,
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

export { sanitizeStockQty };
