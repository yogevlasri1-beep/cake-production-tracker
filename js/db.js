export const db = new Dexie('CakeProduction');

db.version(1).stores({
  categories: '++id, name, sortOrder',
  products: '++id, categoryId, name, active',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
});

db.version(2).stores({
  categories: '++id, name, sortOrder',
  products: '++id, categoryId, name, active',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
}).upgrade(async (tx) => {
  await tx.table('products').toCollection().modify((p) => {
    if (p.rawMaterialsCost == null) p.rawMaterialsCost = 0;
    if (p.packagingCost == null) p.packagingCost = 0;
    if (p.additionalCosts == null) p.additionalCosts = 0;
  });
});

db.version(3).stores({
  categories: '++id, name, sortOrder',
  products: '++id, categoryId, name, active',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
}).upgrade(async (tx) => {
  const count = await tx.table('activityPresets').count();
  if (count === 0) {
    const defaults = ['הכנת בצק', 'שקילות', 'אריזה', 'אפייה', 'קישוט', 'ערבוב', 'קירור'];
    await tx.table('activityPresets').bulkAdd(defaults.map((name) => ({ categoryId: 0, name })));
  }
});

db.version(4).stores({
  categories: '++id, name, sortOrder',
  products: '++id, categoryId, name, active',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
}).upgrade(async (tx) => {
  await tx.table('processLogs').toCollection().modify((log) => {
    if (log.quantity == null) log.quantity = null;
  });
});

export async function initDB() {
  await db.open();
}

export async function getCategories() {
  return db.categories.orderBy('sortOrder').toArray();
}

export async function getProducts(activeOnly = false) {
  let q = db.products.toCollection();
  const all = await q.toArray();
  return activeOnly ? all.filter((p) => p.active) : all;
}

export async function getProductsByCategory() {
  const [categories, products] = await Promise.all([getCategories(), getProducts()]);
  const map = new Map(categories.map((c) => [c.id, { ...c, products: [] }]));
  for (const p of products) {
    map.get(p.categoryId)?.products.push(p);
  }
  return [...map.values()];
}

export async function addCategory(name) {
  const maxOrder = await db.categories.orderBy('sortOrder').last();
  return db.categories.add({ name, sortOrder: (maxOrder?.sortOrder ?? 0) + 1 });
}

export async function updateCategory(id, name) {
  return db.categories.update(id, { name });
}

export async function getProduct(id) {
  return db.products.get(id);
}

export async function deleteCategory(id, { cascade = false } = {}) {
  const products = await db.products.where('categoryId').equals(id).toArray();
  if (products.length > 0 && !cascade) {
    const err = new Error('HAS_PRODUCTS');
    err.productCount = products.length;
    throw err;
  }

  await db.transaction('rw', db.products, db.productionEntries, db.targets, db.categories, async () => {
    for (const p of products) {
      await db.productionEntries.where('productId').equals(p.id).delete();
      const prodTargets = await db.targets.where('scope').equals('product').toArray();
      for (const t of prodTargets.filter((x) => x.scopeId === p.id)) {
        await db.targets.delete(t.id);
      }
    }
    await db.products.where('categoryId').equals(id).delete();
    const catTargets = await db.targets.where('scope').equals('category').toArray();
    for (const t of catTargets.filter((x) => x.scopeId === id)) {
      await db.targets.delete(t.id);
    }
    await db.categories.delete(id);
  });
}

export async function resetAllData() {
  await db.transaction('rw', db.categories, db.products, db.productionEntries, db.targets, db.processLogs, db.activityPresets, async () => {
    await db.productionEntries.clear();
    await db.processLogs.clear();
    await db.products.clear();
    await db.categories.clear();
    await db.targets.clear();
    const defaults = ['הכנת בצק', 'שקילות', 'אריזה', 'אפייה', 'קישוט', 'ערבוב', 'קירור'];
    await db.activityPresets.clear();
    await db.activityPresets.bulkAdd(defaults.map((name) => ({ categoryId: 0, name })));
  });
}

function productDefaults(fields) {
  return {
    categoryId: fields.categoryId,
    name: fields.name,
    unitPrice: Number(fields.unitPrice) || 0,
    rawMaterialsCost: Number(fields.rawMaterialsCost) || 0,
    packagingCost: Number(fields.packagingCost) || 0,
    additionalCosts: Number(fields.additionalCosts) || 0,
    active: fields.active !== false,
  };
}

export async function addProduct(fields) {
  return db.products.add(productDefaults(fields));
}

export async function updateProduct(id, data) {
  const patch = { ...data };
  for (const key of ['unitPrice', 'rawMaterialsCost', 'packagingCost', 'additionalCosts']) {
    if (key in patch) patch[key] = Number(patch[key]) || 0;
  }
  return db.products.update(id, patch);
}

export async function toggleProductActive(id) {
  const p = await db.products.get(id);
  return db.products.update(id, { active: !p.active });
}

export async function addProductionEntry({ date, productId, quantity }) {
  return db.productionEntries.add({ date, productId: Number(productId), quantity: Number(quantity) });
}

export async function updateProductionEntry(id, data) {
  return db.productionEntries.update(id, data);
}

export async function deleteProductionEntry(id) {
  return db.productionEntries.delete(id);
}

export async function getEntriesForDate(date) {
  return db.productionEntries.where('date').equals(date).toArray();
}

export async function getEntriesForMonth(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const all = await db.productionEntries.toArray();
  return all.filter((e) => e.date.startsWith(prefix));
}

export async function getEntriesInRange(from, to) {
  const all = await db.productionEntries.toArray();
  return all.filter((e) => e.date >= from && e.date <= to);
}

export async function getTargets() {
  return db.targets.toArray();
}

function normalizeScopeId(scope, scopeId) {
  return scope === 'total' ? 0 : Number(scopeId);
}

export async function upsertTarget({ scope, scopeId, period, quantity }) {
  const sid = normalizeScopeId(scope, scopeId);
  const existing = await db.targets
    .where('[scope+scopeId+period]')
    .equals([scope, sid, period])
    .first();

  if (existing) {
    return db.targets.update(existing.id, { quantity: Number(quantity) });
  }
  return db.targets.add({ scope, scopeId: sid, period, quantity: Number(quantity) });
}

export async function getTarget(scope, scopeId, period) {
  const sid = normalizeScopeId(scope, scopeId);
  const t = await db.targets
    .where('[scope+scopeId+period]')
    .equals([scope, sid, period])
    .first();
  return t?.quantity ?? 0;
}

export async function getProductionTotals(entries, productMap) {
  const byProduct = {};
  const byCategory = {};
  let total = 0;
  let totalValue = 0;

  for (const e of entries) {
    const product = productMap.get(e.productId);
    if (!product) continue;
    byProduct[e.productId] = (byProduct[e.productId] || 0) + e.quantity;
    byCategory[product.categoryId] = (byCategory[product.categoryId] || 0) + e.quantity;
    total += e.quantity;
    totalValue += e.quantity * product.unitPrice;
  }

  return { byProduct, byCategory, total, totalValue };
}

export async function findOrCreateCategory(name) {
  const trimmed = name.trim();
  const existing = (await getCategories()).find((c) => c.name === trimmed);
  if (existing) return existing.id;
  return addCategory(trimmed);
}

export async function findOrCreateProduct(categoryId, name, unitPrice = 0) {
  const trimmed = name.trim();
  const existing = (await getProducts()).find(
    (p) => p.categoryId === categoryId && p.name === trimmed
  );
  if (existing) {
    if (unitPrice > 0 && existing.unitPrice !== unitPrice) {
      await db.products.update(existing.id, { unitPrice: Number(unitPrice) });
    }
    return existing.id;
  }
  return addProduct({ categoryId, name: trimmed, unitPrice: unitPrice || 0 });
}

export async function importProductionRows(rows) {
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const { date, category, product, quantity, price } = row;
    if (!date || !product || !quantity) {
      skipped++;
      continue;
    }
    const categoryId = category
      ? await findOrCreateCategory(category)
      : (await getCategories())[0]?.id;
    if (!categoryId) {
      skipped++;
      continue;
    }
    const productId = await findOrCreateProduct(categoryId, product, price || 0);
    await addProductionEntry({ date, productId, quantity });
    imported++;
  }

  return { imported, skipped };
}

export async function importCatalogRows(rows) {
  let added = 0;
  for (const row of rows) {
    const { category, product, price } = row;
    if (!category || !product) continue;
    const categoryId = await findOrCreateCategory(category);
    const exists = (await getProducts()).some(
      (p) => p.categoryId === categoryId && p.name === product.trim()
    );
    await findOrCreateProduct(categoryId, product, price || 0);
    if (!exists) added++;
  }
  return { added, total: rows.length };
}

export async function getActivityPresets(categoryId) {
  const records = await getActivityPresetRecords(categoryId);
  const names = [...new Set(records.map((a) => a.name))];
  return names.sort((a, b) => a.localeCompare(b, 'he'));
}

export async function getActivityPresetRecords(categoryId) {
  const all = await db.activityPresets.toArray();
  const cid = Number(categoryId) || 0;
  if (!cid) return all.filter((a) => !a.categoryId || a.categoryId === 0);
  return all.filter((a) => !a.categoryId || a.categoryId === 0 || a.categoryId === cid);
}

export async function addActivityPreset(categoryId, name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const cid = Number(categoryId) || 0;
  const exists = (await getActivityPresetRecords(cid)).some((a) => a.name === trimmed);
  if (exists) return;
  return db.activityPresets.add({ categoryId: cid, name: trimmed });
}

export async function updateActivityPreset(id, name) {
  return db.activityPresets.update(id, { name: name.trim() });
}

export async function deleteActivityPreset(id) {
  return db.activityPresets.delete(id);
}

export async function addProcessLog({ date, categoryId, activity, notes, quantity }) {
  const qty = quantity !== '' && quantity != null ? Number(quantity) : null;
  return db.processLogs.add({
    date,
    categoryId: Number(categoryId),
    activity: activity.trim(),
    notes: (notes || '').trim(),
    quantity: qty > 0 ? qty : null,
  });
}

export async function updateProcessLog(id, data) {
  const patch = { ...data };
  if ('quantity' in patch) {
    const qty = patch.quantity !== '' && patch.quantity != null ? Number(patch.quantity) : null;
    patch.quantity = qty > 0 ? qty : null;
  }
  return db.processLogs.update(id, patch);
}

export async function deleteProcessLog(id) {
  return db.processLogs.delete(id);
}

export async function getProcessLogsForDate(date) {
  return db.processLogs.where('date').equals(date).toArray();
}

export async function getProcessLogsInRange(from, to) {
  const all = await db.processLogs.toArray();
  return all.filter((e) => e.date >= from && e.date <= to);
}

export async function getProcessLogsForMonth(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const all = await db.processLogs.toArray();
  return all.filter((e) => e.date.startsWith(prefix));
}
