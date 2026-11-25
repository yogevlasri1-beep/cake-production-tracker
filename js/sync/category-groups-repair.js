/**
 * מחזיר קטגוריות כלליות שנמחקו בטעות, כשתת-הקטגוריות עדיין מצביעות עליהן.
 * לא מוחק מוצרים ולא מחליף שמות של תת-קטגוריות.
 */
import { flowNameKey } from './collections.js?v=554';

/** שמות שהמשתמש הגדיר — מגיבוי 9.11.2026, לפי UUID יציב. */
export const RESTORED_GROUP_NAMES = {
  '264f7960-59db-4c33-a104-eafcfabd5777': 'בחושות',
  'ebd40187-297c-4d50-a44d-30ac747f6b1d': 'רונדו ליין',
  '83a4516b-5ede-4a9c-8232-0ceb437888fa': 'שטרודל',
};

/** שמות שהאפליקציה המציאה בגרסה 535 — לא מה שהמשתמש הגדיר. */
export const AGENT_INFERRED_GROUP_NAMES = new Set([
  'עוגות',
  'עוגות שמרים',
  'שטרודלים',
  'קטגוריה כללית',
]);

export function shouldReplaceGroupName(current, wanted) {
  const cur = String(current || '').trim();
  const next = String(wanted || '').trim();
  if (!next || cur === next) return false;
  if (!cur) return true;
  return AGENT_INFERRED_GROUP_NAMES.has(cur);
}

export function inferCategoryGroupName(childNames = [], groupId = null) {
  const known = RESTORED_GROUP_NAMES[String(groupId || '')];
  if (known) return known;
  const names = [...new Set((childNames || []).map((n) => String(n || '').trim()).filter(Boolean))];
  if (!names.length) return 'קטגוריה כללית';
  const blob = names.join(' ');
  if (names.every((n) => n.includes('שטרודל'))) return 'שטרודל';
  if (/מאפינס/.test(blob) && /פלט/.test(blob)) return 'בחושות';
  if (/קראנץ|פרסבורגר|בורקס|מאפים/.test(blob)) return 'רונדו ליין';
  return names[0];
}

function rowName(row) {
  return row?.payload?.name || row?.name || '';
}

function rowGroupId(row) {
  return row?.payload?.groupId || row?.groupId || null;
}

export function pickRestoredGroupName({ cloudName = '', childNames = [], groupId = null } = {}) {
  const known = RESTORED_GROUP_NAMES[String(groupId || '')];
  const fromCloud = String(cloudName || '').trim();
  if (known) {
    if (!fromCloud || AGENT_INFERRED_GROUP_NAMES.has(fromCloud) || fromCloud === known) return known;
    return fromCloud;
  }
  if (fromCloud && !AGENT_INFERRED_GROUP_NAMES.has(fromCloud)) return fromCloud;
  return inferCategoryGroupName(childNames, groupId);
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
  return [...buckets.values()].map((row) => ({
    ...row,
    inferredName: pickRestoredGroupName({
      cloudName: row.cloudGroup?.payload?.name,
      childNames: row.childNames,
      groupId: row.groupId,
    }),
  }));
}

/** קבוצות חיות עם שם שהאפליקציה המציאה — מחזירים לשם שהמשתמש הגדיר. */
export function planKnownCategoryGroupRenames(cloudGroups = []) {
  return (cloudGroups || []).flatMap((row) => {
    if (!row?.id || row.deleted_at) return [];
    const wanted = RESTORED_GROUP_NAMES[String(row.id)];
    if (!wanted) return [];
    const current = String(row.payload?.name || row.name || '').trim();
    if (!shouldReplaceGroupName(current, wanted)) return [];
    return [{ groupId: String(row.id), inferredName: wanted, currentName: current }];
  });
}

export function localCategoriesForGroupChildren(localCategories, childNames) {
  const wanted = new Set((childNames || []).map((n) => flowNameKey(n)).filter(Boolean));
  if (!wanted.size) return [];
  return (localCategories || []).filter((cat) => wanted.has(flowNameKey(cat?.name)));
}
