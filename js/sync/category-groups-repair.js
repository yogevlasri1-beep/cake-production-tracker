/**
 * מחזיר קטגוריות כלליות שנמחקו בטעות, כשתת-הקטגוריות עדיין מצביעות עליהן.
 * לא מוחק מוצרים ולא מחליף שמות של תת-קטגוריות.
 */
import { flowNameKey } from './collections.js?v=535';

/** שמות שנמחקו מהענן יחד עם הקבוצה — לפי UUID יציב של המטבח. */
export const RESTORED_GROUP_NAMES = {
  '264f7960-59db-4c33-a104-eafcfabd5777': 'עוגות',
  'ebd40187-297c-4d50-a44d-30ac747f6b1d': 'עוגות שמרים',
  '83a4516b-5ede-4a9c-8232-0ceb437888fa': 'שטרודלים',
};

export function inferCategoryGroupName(childNames = [], groupId = null) {
  const known = RESTORED_GROUP_NAMES[String(groupId || '')];
  if (known) return known;
  const names = [...new Set((childNames || []).map((n) => String(n || '').trim()).filter(Boolean))];
  if (!names.length) return 'קטגוריה כללית';
  const blob = names.join(' ');
  if (names.every((n) => n.includes('שטרודל'))) return 'שטרודלים';
  if (/מאפינס/.test(blob) && /פלט/.test(blob)) return 'עוגות';
  if (/קראנץ|פרסבורגר|בורקס/.test(blob)) return 'עוגות שמרים';
  return names[0];
}

function rowName(row) {
  return row?.payload?.name || row?.name || '';
}

function rowGroupId(row) {
  return row?.payload?.groupId || row?.groupId || null;
}

/** קבוצות בענן שנמחקו, אבל קטגוריות חיות עדיין שייכות אליהן. */
export function planMissingCategoryGroupRestore({
  cloudGroups = [],
  cloudCategories = [],
} = {}) {
  const liveIds = new Set(
    (cloudGroups || []).filter((row) => row && !row.deleted_at).map((row) => String(row.id)),
  );
  const deleted = new Map(
    (cloudGroups || []).filter((row) => row?.deleted_at && row.id).map((row) => [String(row.id), row]),
  );
  const buckets = new Map();
  for (const cat of cloudCategories || []) {
    if (cat?.deleted_at) continue;
    const gid = rowGroupId(cat);
    if (!gid || liveIds.has(String(gid))) continue;
    const key = String(gid);
    if (!buckets.has(key)) {
      buckets.set(key, {
        groupId: key,
        childNames: [],
        cloudGroup: deleted.get(key) || null,
      });
    }
    const name = rowName(cat);
    if (name) buckets.get(key).childNames.push(name);
  }
  return [...buckets.values()].map((row) => {
    const fromCloud = String(row.cloudGroup?.payload?.name || '').trim();
    return {
      ...row,
      inferredName: fromCloud || inferCategoryGroupName(row.childNames, row.groupId),
    };
  });
}

export function localCategoriesForGroupChildren(localCategories, childNames) {
  const wanted = new Set((childNames || []).map((n) => flowNameKey(n)).filter(Boolean));
  if (!wanted.size) return [];
  return (localCategories || []).filter((cat) => wanted.has(flowNameKey(cat?.name)));
}
