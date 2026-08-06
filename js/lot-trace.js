/**
 * מעקב אצוות / Lot traceability — חיפוש דו-כיווני:
 * אצוות ייצור ↔ מספרי מנה על אריזות חומרי גלם.
 */
import {
  db,
  getAllProductionRuns,
  collectRunIngredientBatchTracking,
  computeRunMetrics,
  getProducts,
  getCategories,
} from './db.js?v=426';

function norm(s) {
  return String(s || '').trim().toLocaleLowerCase('he');
}

function matchesQuery(value, q) {
  if (!q) return false;
  const v = norm(value);
  return v === q || v.includes(q);
}

/**
 * @param {string} query
 */
export async function searchLotTrace(query) {
  const q = norm(query);
  if (!q) {
    return { query: '', productionHits: [], materialHits: [], inventoryHits: [] };
  }

  let movements = [];
  try {
    movements = db.inventoryMovements ? await db.inventoryMovements.toArray() : [];
  } catch {
    movements = [];
  }

  const [runs, products, categories] = await Promise.all([
    getAllProductionRuns(),
    getProducts(),
    getCategories(),
  ]);
  const productMap = new Map((products || []).map((p) => [p.id, p]));
  const catMap = new Map((categories || []).map((c) => [c.id, c]));

  const productionHits = [];
  const materialHits = [];
  const inventoryHits = [];

  for (const run of runs || []) {
    const tracking = collectRunIngredientBatchTracking(run);
    const runBatchMatch = matchesQuery(run.batchNumber, q);
    const materialMatches = tracking.filter((t) => matchesQuery(t.packagingBatchNumber, q));
    if (!runBatchMatch && !materialMatches.length) continue;

    let entries = [];
    try {
      entries = await db.productionEntries.where('runId').equals(run.id).toArray();
    } catch {
      entries = [];
    }
    const metrics = computeRunMetrics(run, entries);
    const materials = tracking.map((t) => ({
      ingredientName: t.ingredientName,
      packagingBatchNumber: t.packagingBatchNumber,
      supplierName: t.supplierName || '',
      portionName: t.portionName || '',
      matched: matchesQuery(t.packagingBatchNumber, q),
    }));
    const productLines = (entries || []).map((e) => {
      const p = productMap.get(e.productId);
      return {
        name: p?.name || `מוצר #${e.productId}`,
        quantity: Number(e.quantity) || 0,
      };
    });

    const scopeLabel = describeRunScope(run, catMap, productMap);

    if (runBatchMatch) {
      productionHits.push({
        runId: run.id,
        date: run.date || '',
        batchNumber: run.batchNumber || '',
        status: run.status || '',
        flowName: run.flowName || (run.flowId ? `תזרים #${run.flowId}` : 'ללא תזרים'),
        scopeLabel,
        startedAt: run.startedAt || '',
        completedAt: run.completedAt || '',
        portionCount: metrics?.portionCount || 0,
        productionQty: metrics?.productionQty || 0,
        materials,
        productLines,
      });
    }

    for (const m of materialMatches) {
      materialHits.push({
        packagingBatchNumber: m.packagingBatchNumber,
        ingredientName: m.ingredientName,
        supplierName: m.supplierName || '',
        portionName: m.portionName || '',
        runId: run.id,
        runDate: run.date || '',
        runBatchNumber: run.batchNumber || '',
        flowName: run.flowName || (run.flowId ? `תזרים #${run.flowId}` : 'ללא תזרים'),
        scopeLabel,
        runStatus: run.status || '',
        productLines,
      });
    }
  }

  for (const m of movements || []) {
    const pkg = String(m.packagingBatchNumber || '').trim();
    const runBatch = String(m.runBatchNumber || '').trim();
    const batchMatch = matchesQuery(pkg, q) || matchesQuery(runBatch, q)
      || (Array.isArray(m.ingredientBatches)
        && m.ingredientBatches.some((b) => matchesQuery(b.packagingBatchNumber, q)));
    if (!batchMatch) continue;
    inventoryHits.push({
      movementId: m.id,
      at: m.at || '',
      kind: m.kind || '',
      delta: m.delta,
      unit: m.unit || '',
      materialName: m.materialName || `חומר #${m.rawMaterialId}`,
      packagingBatchNumber: pkg,
      runBatchNumber: runBatch,
      productionRunId: m.productionRunId || null,
      reason: m.reason || '',
    });
  }

  productionHits.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  materialHits.sort((a, b) => String(b.runDate).localeCompare(String(a.runDate)));
  inventoryHits.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return { query: String(query || '').trim(), productionHits, materialHits, inventoryHits };
}

function describeRunScope(run, catMap, productMap) {
  if (run.productId && productMap.get(run.productId)) {
    return productMap.get(run.productId).name;
  }
  const ids = run.categoryIds?.length
    ? run.categoryIds
    : (run.categoryId ? [run.categoryId] : []);
  const names = ids.map((id) => catMap.get(Number(id))?.name).filter(Boolean);
  return names.join(', ');
}

export function lotTraceEmptyHint() {
  return 'חפש מספר אצווה של תזרים, או מספר מנה שנרשם על אריזת חומר גלם.';
}
