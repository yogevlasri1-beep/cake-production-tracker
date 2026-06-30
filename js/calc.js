import { sanitizeQuantity, sanitizePortionSize, roundMoney } from './validators.js?v=206';

export { roundMoney };

export function buildProductMap(products) {
  const map = new Map();
  for (const p of products || []) {
    if (p?.id == null) continue;
    map.set(Number(p.id), p);
    map.set(String(p.id), p);
  }
  return map;
}

export function mapGetById(map, id) {
  if (id == null || !map) return undefined;
  return map.get(Number(id)) ?? map.get(String(id)) ?? map.get(id);
}

export function mapLookup(obj, id) {
  if (obj == null || id == null) return 0;
  const n = Number(id);
  const val = obj[n] ?? obj[String(n)] ?? obj[id];
  return Number(val) || 0;
}

export function productUnitCost(product) {
  return roundMoney(
    (Number(product?.rawMaterialsCost) || 0)
    + (Number(product?.packagingCost) || 0)
    + (Number(product?.additionalCosts) || 0),
  );
}

/** ערך שורת ייצור לפי סוג תמחור */
export function productLineValue(product, qty) {
  const q = Number(qty) || 0;
  const price = Number(product?.unitPrice) || 0;
  if (product?.priceUnit === 'kg' || product?.priceUnit === 'kg_with_units') return roundMoney(q * price);
  if (product?.priceUnit === 'kg_units') {
    const uw = Number(product?.unitWeightKg) || 0;
    return roundMoney(q * uw * price);
  }
  return roundMoney(q * price);
}

export function entryQuantityForProduct(raw, product) {
  if (product?.priceUnit === 'kg' || product?.priceUnit === 'kg_with_units') {
    return sanitizePortionSize(raw, { min: 0.001, max: 100_000 });
  }
  return sanitizeQuantity(raw, { allowZero: false });
}

/** סיכום כמות, עלות ייצור וערך ללקוח לקטגוריה */
export function sumCategoryTotals(categoryId, products, byProduct) {
  let qty = 0;
  let value = 0;
  let cost = 0;
  let costRaw = 0;
  let costPack = 0;
  let costExtra = 0;
  const cid = Number(categoryId);
  for (const p of products || []) {
    if (Number(p.categoryId) !== cid) continue;
    const q = mapLookup(byProduct, p.id);
    qty += q;
    value += productLineValue(p, q);
    costRaw += q * (Number(p.rawMaterialsCost) || 0);
    costPack += q * (Number(p.packagingCost) || 0);
    costExtra += q * (Number(p.additionalCosts) || 0);
    cost += q * productUnitCost(p);
  }
  return {
    qty,
    value: roundMoney(value),
    cost: roundMoney(cost),
    costRaw: roundMoney(costRaw),
    costPack: roundMoney(costPack),
    costExtra: roundMoney(costExtra),
  };
}

export function productProductionValue(product, byProduct) {
  const qty = mapLookup(byProduct, product?.id);
  return { qty, value: productLineValue(product, qty) };
}

export function productProductionCost(product, byProduct) {
  const qty = mapLookup(byProduct, product?.id);
  const raw = roundMoney(qty * (Number(product?.rawMaterialsCost) || 0));
  const pack = roundMoney(qty * (Number(product?.packagingCost) || 0));
  const extra = roundMoney(qty * (Number(product?.additionalCosts) || 0));
  return {
    qty,
    costRaw: raw,
    costPack: pack,
    costExtra: extra,
    cost: roundMoney(raw + pack + extra),
  };
}

/** סדר תצוגה בדוחות: קטגוריה (sortOrder) → מוצר (sortOrder) */
export function compareReportProducts(a, b, categories = []) {
  const catOrder = new Map(
    categories.map((c, i) => [Number(c.id), Number(c.sortOrder) || i + 1]),
  );
  const catA = catOrder.get(Number(a.categoryId)) ?? 9999;
  const catB = catOrder.get(Number(b.categoryId)) ?? 9999;
  if (catA !== catB) return catA - catB;
  return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
    || Number(a.id) - Number(b.id);
}

export function sortProductsForReport(products, categories = []) {
  return (products || []).slice().sort((a, b) => compareReportProducts(a, b, categories));
}

/** אחוז התקדמות — יעד 0 = 0% (לא 100%) */
export function pct(current, target) {
  const cur = Number(current) || 0;
  const tgt = Number(target) || 0;
  if (tgt <= 0) return 0;
  if (!Number.isFinite(cur)) return 0;
  return Math.round((cur / tgt) * 100);
}

export function pctDisplay(current, target) {
  const tgt = Number(target) || 0;
  if (tgt <= 0) return '—';
  return `${pct(current, target)}%`;
}

export function progressClass(pctValue) {
  if (pctValue >= 100) return 'good';
  if (pctValue >= 80) return 'warn';
  return 'bad';
}

export function progressBadge(pctValue) {
  if (pctValue >= 100) return { cls: 'badge-success', text: 'הושג' };
  if (pctValue >= 80) return { cls: 'badge-warning', text: 'קרוב' };
  return { cls: 'badge-danger', text: 'חסר' };
}

export function sumEntryQuantities(entries) {
  let total = 0;
  for (const e of entries || []) {
    const q = sanitizeQuantity(e.quantity, { allowZero: false });
    if (q != null) total += q;
  }
  return total;
}

export function computeProductionTotals(entries, productMap) {
  const byProduct = {};
  const byCategory = {};
  const byCategoryValue = {};
  let total = 0;
  let totalValue = 0;
  let totalCost = 0;
  let skipped = 0;

  for (const e of entries || []) {
    const product = mapGetById(productMap, e.productId);
    const qty = product ? entryQuantityForProduct(e.quantity, product) : sanitizeQuantity(e.quantity, { allowZero: false });
    if (qty == null) {
      skipped++;
      continue;
    }
    if (!product) {
      skipped++;
      continue;
    }
    const unitCost = productUnitCost(product);
    const lineValue = productLineValue(product, qty);
    const prodId = Number(e.productId);
    const catId = Number(product.categoryId);
    byProduct[prodId] = (byProduct[prodId] || 0) + qty;
    byCategory[catId] = (byCategory[catId] || 0) + qty;
    byCategoryValue[catId] = (byCategoryValue[catId] || 0) + lineValue;
    total += qty;
    totalValue += lineValue;
    totalCost += qty * unitCost;
  }

  for (const id of Object.keys(byCategoryValue)) {
    byCategoryValue[id] = roundMoney(byCategoryValue[id]);
  }

  return {
    byProduct,
    byCategory,
    byCategoryValue,
    total,
    totalValue: roundMoney(totalValue),
    totalCost: roundMoney(totalCost),
    skipped,
  };
}

export function computeReportRows(entries, categories, products, productMap, catMap) {
  const byProduct = {};
  for (const e of entries || []) {
    const p = mapGetById(productMap, e.productId);
    const qty = p ? entryQuantityForProduct(e.quantity, p) : sanitizeQuantity(e.quantity, { allowZero: false });
    if (qty == null) continue;
    const prodId = Number(e.productId);
    byProduct[prodId] = (byProduct[prodId] || 0) + qty;
  }

  const detailRows = (entries || [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.productId - b.productId)
    .map((e) => {
      const p = mapGetById(productMap, e.productId);
      const qty = p ? entryQuantityForProduct(e.quantity, p) : sanitizeQuantity(e.quantity, { allowZero: false });
      if (!p || qty == null) return null;
      return [e.date, catMap.get(p.categoryId) || '', p.name, qty, productLineValue(p, qty)];
    })
    .filter(Boolean);

  const summaryRows = categories.map((c) => {
    const { qty, value: val } = sumCategoryTotals(c.id, products, byProduct);
    return [c.name, qty, val];
  }).filter((r) => r[1] > 0);

  const totalQty = detailRows.reduce((s, r) => s + r[3], 0);
  const totalVal = roundMoney(detailRows.reduce((s, r) => s + r[4], 0));

  const productSummary = sortProductsForReport(products, categories)
    .map((p) => {
      const { qty, value: val } = productProductionValue(p, byProduct);
      return {
        cat: catMap.get(p.categoryId) || '',
        name: p.name,
        qty,
        val,
      };
    })
    .filter((r) => r.qty > 0);

  return { detailRows, summaryRows, totalQty, totalVal, productSummary };
}

export function computeProcessSummary(processLogs, catMap) {
  const map = {};
  for (const log of processLogs || []) {
    const key = `${log.categoryId}|${log.activity}`;
    if (!map[key]) {
      map[key] = { category: catMap.get(log.categoryId) || '', activity: log.activity, qty: 0, count: 0 };
    }
    const q = log.quantity > 0 ? Math.round(Number(log.quantity)) : 0;
    if (Number.isFinite(q)) map[key].qty += q;
    map[key].count += 1;
  }
  return Object.values(map).sort((a, b) => a.category.localeCompare(b.category, 'he'));
}

export function addDaysISO(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** שבוע לוח שנה: ראשון–שבת שמכיל את התאריך שנבחר */
export function weekRange(anchorIso) {
  if (!anchorIso) {
    return { from: '', to: '', dates: [], label: '' };
  }
  const anchor = anchorIso;
  const d = new Date(`${anchor}T12:00:00`);
  if (isNaN(d.getTime())) {
    return { from: anchor, to: anchor, dates: [anchor], label: anchor };
  }
  const sundayOffset = d.getDay();
  const from = addDaysISO(anchor, -sundayOffset);
  const dates = [];
  const labels = [];
  for (let i = 0; i < 7; i++) {
    const iso = addDaysISO(from, i);
    if (!iso) continue;
    dates.push(iso);
    const day = new Date(`${iso}T12:00:00`);
    labels.push(day.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }));
  }
  if (!dates.length) return { from: anchor, to: anchor, dates: [anchor], label: anchor };
  const to = dates[dates.length - 1];
  return { from, to, dates, label: `${labels[0]} – ${labels[labels.length - 1]}` };
}

export function monthRange(year, month) {
  const y = Number(year);
  const m = Number(month);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const d = new Date(y, m - 1, 1);
  return { from, to, label: d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' }) };
}

export function qtyForCategoryOnDate(entries, productMap, categoryId, dateIso) {
  let sum = 0;
  for (const e of entries || []) {
    if (e.date !== dateIso) continue;
    const p = mapGetById(productMap, e.productId);
    const q = p ? entryQuantityForProduct(e.quantity, p) : sanitizeQuantity(e.quantity, { allowZero: false });
    if (Number(p?.categoryId) === Number(categoryId) && q != null) sum += q;
  }
  return sum;
}

/** סימולציה של איחוד רישומים — לבדיקות ולאימות תקינות */
export function simulateMergeEntries(entries, keepProductId, mergeProductIds) {
  const keepId = Number(keepProductId);
  const mergeIds = new Set((mergeProductIds || []).map(Number).filter((id) => id && id !== keepId));
  let rows = (entries || []).map((e) => ({ ...e }));

  for (const mid of mergeIds) {
    const moving = rows.filter((e) => e.productId === mid);
    for (const e of moving) {
      const sameDay = rows.find((x) => x.productId === keepId && x.date === e.date && x.id !== e.id);
      if (sameDay) {
        sameDay.quantity = (sameDay.quantity || 0) + (e.quantity || 0);
        rows = rows.filter((x) => x.id !== e.id);
      } else {
        e.productId = keepId;
      }
    }
  }
  return rows;
}

export function sumEntriesForProducts(entries, productIds) {
  const ids = new Set((productIds || []).map(Number));
  return sumEntryQuantities((entries || []).filter((e) => ids.has(e.productId)));
}

/**
 * בדיקת תקינות נתוני ייצור — מזהה רישומים יתומים, כפילויות, ופערים בחישובים
 */
export function auditProductionData(products, entries, categories = []) {
  const issues = [];
  const productMap = buildProductMap(products);
  const validProductIds = new Set((products || []).map((p) => p.id));
  const catMap = new Map((categories || []).map((c) => [c.id, c.name]));

  for (const e of entries || []) {
    const qty = sanitizeQuantity(e.quantity, { allowZero: false });
    if (qty == null && e.quantity != null && e.quantity !== '') {
      issues.push({ kind: 'invalid_quantity', entryId: e.id, quantity: e.quantity });
    }
    if (!validProductIds.has(e.productId)) {
      issues.push({
        kind: 'orphan_entry',
        entryId: e.id,
        productId: e.productId,
        quantity: e.quantity,
      });
    }
  }

  const dayProductKeys = new Map();
  for (const e of entries || []) {
    if (!validProductIds.has(e.productId)) continue;
    const key = `${e.date}|${e.productId}`;
    if (dayProductKeys.has(key)) {
      issues.push({
        kind: 'duplicate_date_product',
        date: e.date,
        productId: e.productId,
        entryIds: [dayProductKeys.get(key), e.id],
      });
    } else {
      dayProductKeys.set(key, e.id);
    }
  }

  const validEntries = (entries || []).filter((e) => validProductIds.has(e.productId));
  const totals = computeProductionTotals(validEntries, productMap);
  const productSum = Object.values(totals.byProduct).reduce((s, n) => s + n, 0);
  const categorySum = Object.values(totals.byCategory).reduce((s, n) => s + n, 0);
  const rawEntryQty = sumEntryQuantities(validEntries);

  if (productSum !== totals.total) {
    issues.push({ kind: 'product_sum_mismatch', productSum, total: totals.total });
  }
  if (categorySum !== totals.total) {
    issues.push({ kind: 'category_sum_mismatch', categorySum, total: totals.total });
  }
  if (rawEntryQty !== totals.total) {
    issues.push({ kind: 'raw_qty_mismatch', rawEntryQty, total: totals.total });
  }

  for (const cat of categories || []) {
    const fromProducts = sumCategoryTotals(cat.id, products, totals.byProduct).qty;
    const fromCat = mapLookup(totals.byCategory, cat.id);
    if (fromProducts !== fromCat) {
      issues.push({
        kind: 'category_product_mismatch',
        categoryId: cat.id,
        categoryName: cat.name,
        fromProducts,
        fromCat,
      });
    }
  }

  const report = computeReportRows(validEntries, categories || [], products || [], productMap, catMap);
  if (report.totalQty !== totals.total) {
    issues.push({ kind: 'report_qty_mismatch', reportQty: report.totalQty, total: totals.total });
  }
  if (report.totalVal !== totals.totalValue) {
    issues.push({ kind: 'report_val_mismatch', reportVal: report.totalVal, totalVal: totals.totalValue });
  }

  return {
    ok: issues.length === 0,
    issues,
    totals,
    rawEntryQty,
    validEntries: validEntries.length,
    orphanEntries: (entries || []).length - validEntries.length,
  };
}
