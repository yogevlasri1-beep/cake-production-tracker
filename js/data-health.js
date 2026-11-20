/**
 * בדיקת בריאות קטלוג מקומי: כפילויות אחרי שחזור/משיכה.
 * לא מוחק כלום — רק מזהה ומתריע.
 */
import { db } from './db.js?v=543';
import { flowNameKey, isSharedFlowName, buildCatalogNameMaps } from './sync/collections.js?v=543';

function groupBy(rows, keyOf) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = keyOf(row);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return [...grouped.values()].filter((list) => list.length > 1);
}

function dupItems(lists) {
  return lists.map((list) => ({
    name: list[0]?.name || '',
    count: list.length,
  })).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'he'));
}

/** בדיקה טהורה — לטסטים ולמסכים. */
export function inspectCatalogDuplicates({
  flows = [],
  products = [],
  categories = [],
  groups = [],
} = {}) {
  const maps = buildCatalogNameMaps(categories, groups);
  const duplicateFlows = dupItems(groupBy(flows, (flow) => {
    if (isSharedFlowName(flow?.name)) {
      const cat = maps.categoryNameOf(flow.categoryId);
      const group = maps.groupNameOf(flow.categoryGroupId || flow.groupId);
      const target = cat || group;
      if (!target) return '';
      return `shared|${flowNameKey(flow.name)}|${target}`;
    }
    return flowNameKey(flow?.name);
  }));
  const duplicateProducts = dupItems(groupBy(products, (product) => {
    const name = flowNameKey(product?.name);
    if (!name) return '';
    const cat = maps.categoryNameOf(product.categoryId);
    return cat ? `${name}|c:${cat}` : name;
  }));
  const duplicateCategories = dupItems(groupBy(categories, (cat) => {
    const name = flowNameKey(cat?.name);
    if (!name) return '';
    const group = maps.groupNameOf(cat.groupId);
    return group ? `${name}|g:${group}` : `${name}|ungrouped`;
  }));
  const categoryIds = new Set((categories || []).map((cat) => String(cat.id)));
  const groupIds = new Set((groups || []).map((group) => String(group.id)));
  const orphanProductCount = (products || []).filter((product) => (
    product?.categoryId != null && product.categoryId !== ''
    && !categoryIds.has(String(product.categoryId))
  )).length;
  const missingGroups = (categories || []).some((cat) => (
    cat?.groupId != null && cat.groupId !== '' && !groupIds.has(String(cat.groupId))
  ));
  const ok = !duplicateFlows.length && !duplicateProducts.length && !duplicateCategories.length;
  return {
    ok,
    duplicateFlows,
    duplicateProducts,
    duplicateCategories,
    extraFlowCopies: duplicateFlows.reduce((n, row) => n + row.count - 1, 0),
    extraProductCopies: duplicateProducts.reduce((n, row) => n + row.count - 1, 0),
    orphanProductCount,
    missingGroups,
  };
}

export function isCatalogUnsafe(report) {
  return !!(report && report.ok === false);
}

export function formatCatalogDuplicateWarning(report) {
  if (!report) return null;
  const bits = [];
  if (report.duplicateFlows.length) {
    const sample = report.duplicateFlows.slice(0, 3).map((row) => `«${row.name}» ×${row.count}`).join(', ');
    bits.push(`תזרימים כפולים (${sample}${report.duplicateFlows.length > 3 ? '…' : ''})`);
  }
  if (report.duplicateProducts.length) {
    bits.push(`${report.extraProductCopies} מוצרים כפולים`);
  }
  if (report.duplicateCategories.length) {
    bits.push(`${report.duplicateCategories.length} קטגוריות כפולות`);
  }
  if (report.missingGroups) bits.push('חסרות קבוצות קטגוריות');
  if (report.orphanProductCount) bits.push(`${report.orphanProductCount} מוצרים בלי קטגוריה`);
  if (!bits.length) return null;
  if (report.ok) {
    return `שימו לב: ${bits.join(' · ')}. אפשר להמשיך לעבוד.`;
  }
  return `תקלה בנתונים: ${bits.join(' · ')}. אל תתחיל תהליך חדש. גיבוי → סנכרן עכשיו. אל תלחץ «העלה שוב».`;
}

export async function inspectLocalCatalogHealth() {
  const [flows, products, categories, groups] = await Promise.all([
    db.flows ? db.flows.toArray() : [],
    db.products ? db.products.toArray() : [],
    db.categories ? db.categories.toArray() : [],
    db.categoryGroups ? db.categoryGroups.toArray() : [],
  ]);
  return inspectCatalogDuplicates({ flows, products, categories, groups });
}
