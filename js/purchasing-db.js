import { db, ValidationError } from './db.js?v=301';
import { sanitizeName, sanitizeMoney, sanitizeQuantity } from './validators.js?v=301';

export const PURCHASE_CATEGORY_KEYS = {
  accessories: 'accessories',
  machines: 'machines',
};

export const PURCHASE_STATUS = {
  needed: 'needed',
  ordered: 'ordered',
  received: 'received',
};

export const PURCHASE_STATUS_LABELS = {
  needed: 'לרכישה',
  ordered: 'הוזמן',
  received: 'בוצע',
};

export function isPurchaseDone(item) {
  return item?.status === PURCHASE_STATUS.received;
}

const DEFAULT_CATEGORIES = [
  { catKey: PURCHASE_CATEGORY_KEYS.accessories, name: 'אביזרים', sortOrder: 1 },
  { catKey: PURCHASE_CATEGORY_KEYS.machines, name: 'מכונות', sortOrder: 2 },
];

export async function ensurePurchaseCategories() {
  const count = await db.purchaseCategories.count();
  if (count) return;
  await db.purchaseCategories.bulkAdd(DEFAULT_CATEGORIES);
}

export async function getPurchaseCategories() {
  await ensurePurchaseCategories();
  const rows = await db.purchaseCategories.toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function getPurchaseCategoryByKey(catKey) {
  await ensurePurchaseCategories();
  return db.purchaseCategories.where('catKey').equals(String(catKey)).first();
}

export async function getPurchaseItems(categoryId) {
  const cid = Number(categoryId);
  if (!cid) return [];
  const rows = await db.purchaseItems.where('categoryId').equals(cid).toArray();
  return rows
    .filter((r) => r.active !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

function sanitizePurchaseStatus(status) {
  const s = String(status || '').trim();
  return PURCHASE_STATUS[s] ? s : PURCHASE_STATUS.needed;
}

export async function addPurchaseItem({
  categoryId, name, supplier = '', quantity = null, unit = '',
  unitPrice = null, notes = '', status = PURCHASE_STATUS.needed,
} = {}) {
  const cid = Number(categoryId);
  if (!cid) throw new ValidationError('קטגוריה לא תקינה');
  const cat = await db.purchaseCategories.get(cid);
  if (!cat) throw new ValidationError('קטגוריה לא נמצאה');
  const cleanName = sanitizeName(name, 120);
  if (!cleanName) throw new ValidationError('שם פריט לא תקין');

  const existing = await db.purchaseItems.where('categoryId').equals(cid).toArray();
  const maxOrder = existing.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);

  return db.purchaseItems.add({
    categoryId: cid,
    name: cleanName,
    supplier: sanitizeName(supplier, 80) || '',
    quantity: quantity != null && quantity !== '' ? sanitizeQuantity(quantity, { allowZero: true }) : null,
    unit: sanitizeName(unit, 20) || '',
    unitPrice: unitPrice != null && unitPrice !== '' ? sanitizeMoney(unitPrice) : null,
    notes: String(notes || '').trim().slice(0, 500),
    status: sanitizePurchaseStatus(status),
    sortOrder: maxOrder + 1,
    active: true,
  });
}

export async function updatePurchaseItem(id, patch = {}) {
  const row = await db.purchaseItems.get(Number(id));
  if (!row) throw new ValidationError('פריט לא נמצא');
  const next = {};
  if (patch.name != null) {
    const cleanName = sanitizeName(patch.name, 120);
    if (!cleanName) throw new ValidationError('שם פריט לא תקין');
    next.name = cleanName;
  }
  if (patch.supplier != null) next.supplier = sanitizeName(patch.supplier, 80) || '';
  if (patch.quantity !== undefined) {
    next.quantity = patch.quantity === '' || patch.quantity == null
      ? null
      : sanitizeQuantity(patch.quantity, { allowZero: true });
  }
  if (patch.unit != null) next.unit = sanitizeName(patch.unit, 20) || '';
  if (patch.unitPrice !== undefined) {
    next.unitPrice = patch.unitPrice === '' || patch.unitPrice == null
      ? null
      : sanitizeMoney(patch.unitPrice);
  }
  if (patch.notes != null) next.notes = String(patch.notes || '').trim().slice(0, 500);
  if (patch.status != null) next.status = sanitizePurchaseStatus(patch.status);
  if (patch.done !== undefined) next.status = patch.done ? PURCHASE_STATUS.received : PURCHASE_STATUS.needed;
  if (!Object.keys(next).length) return;
  await db.purchaseItems.update(row.id, next);
}

export async function deletePurchaseItem(id) {
  const row = await db.purchaseItems.get(Number(id));
  if (!row) return;
  await db.purchaseItems.delete(row.id);
}

export async function importPurchaseTables(payload) {
  const stores = [db.purchaseCategories, db.purchaseItems].filter(Boolean);
  if (!stores.length) return;
  await db.transaction('rw', ...stores, async () => {
    await db.purchaseCategories.clear();
    await db.purchaseItems.clear();
    const cats = Array.isArray(payload.purchaseCategories) && payload.purchaseCategories.length
      ? payload.purchaseCategories
      : DEFAULT_CATEGORIES;
    await db.purchaseCategories.bulkPut(cats);
    if (Array.isArray(payload.purchaseItems) && payload.purchaseItems.length) {
      await db.purchaseItems.bulkPut(payload.purchaseItems);
    }
  });
}
