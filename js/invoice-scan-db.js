import { db } from './db.js?v=553';
import { addRawMaterial, updateRawMaterial, setRawMaterialPrice, ensureRoleSupplierCategories } from './kitchen-db.js?v=553';
import { planMaterialUpgrade, invoiceComparablePrices } from './invoice-match.js?v=553';
import { todayISO } from './utils.js?v=553';

export async function listInvoiceScans({ supplierId = null } = {}) {
  const rows = await db.invoiceScans?.toArray?.() ?? [];
  const filtered = supplierId
    ? rows.filter((row) => String(row.supplierId || '') === String(supplierId))
    : rows;
  return filtered.sort((a, b) => String(b.scannedAt || '').localeCompare(String(a.scannedAt || '')));
}

export async function getInvoiceScan(id) {
  const scan = await db.invoiceScans.get(Number(id));
  if (!scan) return null;
  const lines = await db.invoiceScanLines.where('scanId').equals(Number(id)).toArray();
  lines.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return { ...scan, lines };
}

export async function saveInvoiceScan({
  supplierId = null,
  supplierName = '',
  invoiceNumber = '',
  invoiceDate = '',
  notes = '',
  thumbnail = '',
  fileName = '',
  lines = [],
} = {}) {
  const scannedAt = new Date().toISOString();
  const scanId = await db.invoiceScans.add({
    supplierId: supplierId ? Number(supplierId) : null,
    supplierName: String(supplierName || '').trim(),
    invoiceNumber: String(invoiceNumber || '').trim(),
    invoiceDate: String(invoiceDate || '').trim(),
    notes: String(notes || '').trim(),
    thumbnail: String(thumbnail || '').slice(0, 120000),
    fileName: String(fileName || '').trim(),
    scannedAt,
    lineCount: (lines || []).length,
  });
  let sortOrder = 0;
  for (const line of lines || []) {
    sortOrder += 1;
    await db.invoiceScanLines.add({
      scanId,
      sortOrder,
      materialId: line.materialId ? Number(line.materialId) : null,
      name: line.name || '',
      sku: line.sku || '',
      quantity: Number(line.quantity) || 0,
      unit: line.unit || '',
      packageWeightKg: line.packageWeightKg || null,
      unitPrice: Number(line.unitPrice) || 0,
      lineTotal: Number(line.lineTotal) || 0,
      priceBasis: line.priceBasis || '',
      action: line.action || 'skip',
      itemRole: line.itemRole || '',
      status: line.action === 'skip' || line.action === 'review' ? 'skipped' : 'applied',
      priceStatus: line.price?.status || '',
      notes: line.notes || '',
    });
  }
  return scanId;
}

export async function categoryIdForInvoiceRole(role, fallbackId = null) {
  const byRole = await ensureRoleSupplierCategories();
  const cat = byRole.get(role) || byRole.get('raw');
  return cat?.id || fallbackId || null;
}

export async function applyInvoiceLine(line, {
  supplierId = null,
  supplierCategoryId = null,
  recategorize = false,
  updatePrice = false,
} = {}) {
  const action = line?.action;
  if (!action || action === 'skip' || action === 'review') return { skipped: true };

  let materialId = line.materialId ? Number(line.materialId) : null;
  if (action === 'create') {
    const initial = invoiceComparablePrices(line, {});
    const role = line.itemRole || 'raw';
    const defaultUnit = role === 'packaging' ? 'חבילה' : (role === 'cleaning' ? "יח'" : 'ק"ג');
    materialId = await addRawMaterial({
      name: line.name,
      sku: line.sku || '',
      unit: line.unit || defaultUnit,
      unitPrice: Number(initial.invoicePackage) || 0,
      supplierId,
      supplierCategoryId,
      packageWeightGrams: Number(line.packageWeightKg) > 0 ? Math.round(Number(line.packageWeightKg) * 1000) : null,
      synonyms: line.synonymHint ? [line.synonymHint] : [],
    });
  }

  if (!materialId) return { skipped: true };

  const material = await db.rawMaterials.get(materialId);
  if (!material) return { skipped: true };

  if (supplierId && !material.supplierId && (action === 'link' || action === 'assign' || action === 'create')) {
    try {
      await updateRawMaterial(materialId, { supplierId });
    } catch { /* ignore */ }
  }

  if (recategorize && supplierCategoryId && Number(material.supplierCategoryId) !== Number(supplierCategoryId)) {
    try {
      await updateRawMaterial(materialId, { supplierCategoryId: Number(supplierCategoryId) });
    } catch { /* ignore */ }
  }

  const patch = planMaterialUpgrade(material, line);
  patch.invoiceScannedAt = new Date().toISOString();
  if (Object.keys(patch).length) await updateRawMaterial(materialId, patch);

  if (updatePrice) {
    const stored = Number(material.unitPrice) || 0;
    const next = Number(line.price?.invoicePackage);
    if (next > 0 && Math.abs(next - stored) > 0.05) {
      await setRawMaterialPrice(materialId, next, todayISO());
    }
  }

  return { materialId };
}
