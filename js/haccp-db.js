import { db, ValidationError } from './db.js?v=396';
import { sanitizeName, sanitizeProductId } from './validators.js?v=396';

/** שלבי מפת הדרכים לפי מדריך משרד הבריאות */
export const HACCP_STEPS = [
  { id: 'overview', label: 'סקירה', chapter: '1–2', status: 'available' },
  { id: 'prp', label: 'תכניות קדם (PRP)', chapter: '2', status: 'preview' },
  { id: 'team', label: 'צוות HACCP', chapter: '3.1', status: 'available' },
  { id: 'product', label: 'תיאור המוצר', chapter: '3.2', status: 'available' },
  { id: 'intended_use', label: 'שימוש מיועד', chapter: '3.3', status: 'soon' },
  { id: 'flow', label: 'תרשים זרימה', chapter: '3.4', status: 'soon' },
  { id: 'flow_verify', label: 'אימות תרשים בשטח', chapter: '3.5', status: 'soon' },
  { id: 'hazard', label: 'ניתוח גורמי סיכון', chapter: '5.1', status: 'soon' },
  { id: 'ccp', label: 'נקודות בקרה קריטיות (CCP)', chapter: '5.2', status: 'soon' },
  { id: 'limits', label: 'גבולות בקרה קריטיים', chapter: '5.3', status: 'soon' },
  { id: 'monitoring', label: 'ניטור', chapter: '5.4', status: 'soon' },
  { id: 'corrective', label: 'פעולות מתקנות', chapter: '5.5', status: 'soon' },
  { id: 'verification', label: 'אימות מערכת', chapter: '5.6', status: 'soon' },
  { id: 'documentation', label: 'תיעוד ורישום', chapter: '5.7', status: 'soon' },
];

/** נושאי תכניות קדם מהמדריך — לתצוגה בלבד בשלב זה */
export const HACCP_PRP_TOPICS = [
  'בקרת ספקים',
  'בקרת חומרי גלם',
  'שמירת עקיבות',
  'ניהול אלרגנים',
  'קביעת חיי מדף',
  'בקרת חומרי אריזה',
  'בקרת טמפרטורה של סביבת העבודה והאחסון',
  'היגיינת עובדים',
  'בקרת ניקיון וחיטוי מבנה וציוד',
  'תחזוקת ציוד ותשתיות',
  'כיול, אימות ובדיקת ציוד מדידה',
  'בקרת מים ואוויר',
  'בקרת מזיקים ואטימות מבנה',
  'ניהול פסולת',
];

export const HACCP_TEAM_ROLES = [
  { id: 'quality', label: 'אבטחת איכות' },
  { id: 'production', label: 'ייצור' },
  { id: 'engineering', label: 'הנדסה' },
  { id: 'maintenance', label: 'תחזוקה' },
  { id: 'purchasing', label: 'רכש / לוגיסטיקה' },
  { id: 'microbiology', label: 'מיקרוביולוגיה' },
  { id: 'external', label: 'יועץ חיצוני' },
  { id: 'management', label: 'הנהלה' },
  { id: 'other', label: 'אחר' },
];

export const HACCP_PLAN_STATUSES = {
  draft: 'טיוטה',
  in_progress: 'בתהליך',
  complete: 'הושלם',
};

const ACTIVE_PLAN_SETTING_KEY = 'haccpActivePlanId';

export function haccpRoleLabel(roleId) {
  return HACCP_TEAM_ROLES.find((r) => r.id === roleId)?.label || roleId || '—';
}

function sanitizeRole(role) {
  const id = String(role || '').trim();
  return HACCP_TEAM_ROLES.some((r) => r.id === id) ? id : 'other';
}

function sanitizePlanStatus(status) {
  const s = String(status || '').trim();
  return HACCP_PLAN_STATUSES[s] ? s : 'draft';
}

function sanitizeStepId(stepId) {
  const id = String(stepId || '').trim();
  return HACCP_STEPS.some((s) => s.id === id) ? id : 'team';
}

export async function getHaccpTeamMembers({ activeOnly = false } = {}) {
  let rows = await db.haccpTeamMembers.toArray();
  if (activeOnly) rows = rows.filter((m) => m.active !== false);
  return rows.sort((a, b) => {
    if (!!b.isLeader - !!a.isLeader) return !!b.isLeader - !!a.isLeader;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
  });
}

export async function addHaccpTeamMember({
  name,
  role = 'other',
  isLeader = false,
  authorityNotes = '',
  active = true,
} = {}) {
  const cleanName = sanitizeName(name, 80);
  if (!cleanName) throw new ValidationError('הזן שם חבר צוות');
  const existing = await getHaccpTeamMembers();
  const sortOrder = existing.length ? Math.max(...existing.map((m) => m.sortOrder ?? 0)) + 1 : 1;
  const leader = !!isLeader;

  return db.transaction('rw', db.haccpTeamMembers, async () => {
    if (leader) {
      const leaders = await db.haccpTeamMembers.filter((m) => m.isLeader).toArray();
      for (const row of leaders) {
        await db.haccpTeamMembers.update(row.id, { isLeader: false });
      }
    }
    return db.haccpTeamMembers.add({
      name: cleanName,
      role: sanitizeRole(role),
      isLeader: leader,
      authorityNotes: String(authorityNotes || '').trim().slice(0, 500),
      active: active !== false,
      sortOrder,
    });
  });
}

export async function updateHaccpTeamMember(id, patch = {}) {
  const mid = sanitizeProductId(id);
  if (!mid) throw new ValidationError('חבר צוות לא תקין');
  const row = await db.haccpTeamMembers.get(mid);
  if (!row) throw new ValidationError('חבר צוות לא נמצא');

  const next = {};
  if (patch.name !== undefined) {
    const cleanName = sanitizeName(patch.name, 80);
    if (!cleanName) throw new ValidationError('הזן שם חבר צוות');
    next.name = cleanName;
  }
  if (patch.role !== undefined) next.role = sanitizeRole(patch.role);
  if (patch.authorityNotes !== undefined) {
    next.authorityNotes = String(patch.authorityNotes || '').trim().slice(0, 500);
  }
  if (patch.active !== undefined) next.active = !!patch.active;
  if (patch.isLeader !== undefined) next.isLeader = !!patch.isLeader;

  if (!Object.keys(next).length) return;

  return db.transaction('rw', db.haccpTeamMembers, async () => {
    if (next.isLeader) {
      const leaders = await db.haccpTeamMembers.filter((m) => m.isLeader && m.id !== mid).toArray();
      for (const leader of leaders) {
        await db.haccpTeamMembers.update(leader.id, { isLeader: false });
      }
    }
    return db.haccpTeamMembers.update(mid, next);
  });
}

export async function deleteHaccpTeamMember(id) {
  const mid = sanitizeProductId(id);
  if (!mid) return;
  await db.haccpTeamMembers.delete(mid);
}

export async function getHaccpPlans() {
  const rows = await db.haccpPlans.toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function getHaccpPlan(id) {
  const pid = sanitizeProductId(id);
  if (!pid) return null;
  return db.haccpPlans.get(pid);
}

export async function getActiveHaccpPlanId() {
  const row = await db.settings.get(ACTIVE_PLAN_SETTING_KEY);
  const id = sanitizeProductId(row?.value);
  if (!id) return null;
  const plan = await db.haccpPlans.get(id);
  return plan ? id : null;
}

export async function setActiveHaccpPlanId(id) {
  const pid = sanitizeProductId(id);
  if (!pid) {
    await db.settings.delete(ACTIVE_PLAN_SETTING_KEY);
    return null;
  }
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');
  await db.settings.put({ key: ACTIVE_PLAN_SETTING_KEY, value: pid });
  return pid;
}

export async function ensureHaccpPlanForGroup(categoryGroupId, { name } = {}) {
  const gid = sanitizeProductId(categoryGroupId);
  if (!gid) throw new ValidationError('משפחת מוצרים לא תקינה');
  const group = await db.categoryGroups.get(gid);
  if (!group) throw new ValidationError('משפחת מוצרים לא נמצאה');

  const existing = await db.haccpPlans.where('categoryGroupId').equals(gid).first();
  if (existing) {
    await setActiveHaccpPlanId(existing.id);
    return existing.id;
  }

  const planName = sanitizeName(name, 80) || sanitizeName(group.name, 80) || 'תכנית HACCP';
  const all = await getHaccpPlans();
  const sortOrder = all.length ? Math.max(...all.map((p) => p.sortOrder ?? 0)) + 1 : 1;
  const id = await db.haccpPlans.add({
    categoryGroupId: gid,
    name: planName,
    status: 'draft',
    currentStep: 'team',
    notes: '',
    sortOrder,
  });
  await setActiveHaccpPlanId(id);
  return id;
}

export async function updateHaccpPlan(id, patch = {}) {
  const pid = sanitizeProductId(id);
  if (!pid) throw new ValidationError('תכנית לא תקינה');
  const row = await db.haccpPlans.get(pid);
  if (!row) throw new ValidationError('תכנית לא נמצאה');

  const next = {};
  if (patch.name !== undefined) {
    const cleanName = sanitizeName(patch.name, 80);
    if (!cleanName) throw new ValidationError('שם תכנית לא תקין');
    next.name = cleanName;
  }
  if (patch.status !== undefined) next.status = sanitizePlanStatus(patch.status);
  if (patch.currentStep !== undefined) next.currentStep = sanitizeStepId(patch.currentStep);
  if (patch.notes !== undefined) next.notes = String(patch.notes || '').trim().slice(0, 1000);
  if (patch.categoryGroupId !== undefined) {
    const gid = sanitizeProductId(patch.categoryGroupId);
    if (!gid) throw new ValidationError('משפחת מוצרים לא תקינה');
    const group = await db.categoryGroups.get(gid);
    if (!group) throw new ValidationError('משפחת מוצרים לא נמצאה');
    next.categoryGroupId = gid;
  }
  if (!Object.keys(next).length) return;
  return db.haccpPlans.update(pid, next);
}

export async function deleteHaccpPlan(id) {
  const pid = sanitizeProductId(id);
  if (!pid) return;
  await db.transaction('rw', db.haccpPlans, db.haccpProductDescriptions, async () => {
    const descs = await db.haccpProductDescriptions.where('planId').equals(pid).toArray();
    for (const d of descs) await db.haccpProductDescriptions.delete(d.id);
    await db.haccpPlans.delete(pid);
  });
  const active = await getActiveHaccpPlanId();
  if (active === pid) await setActiveHaccpPlanId(null);
}

/** אלרגנים נפוצים לפי נספח הסימון */
export const HACCP_ALLERGENS = [
  { id: 'gluten', label: 'דגנים המכילים גלוטן' },
  { id: 'milk', label: 'חלב ומוצריו' },
  { id: 'eggs', label: 'ביצים' },
  { id: 'peanuts', label: 'בוטנים' },
  { id: 'tree_nuts', label: 'אגוזים' },
  { id: 'sesame', label: 'שומשום' },
  { id: 'soy', label: 'סויה' },
  { id: 'mustard', label: 'חרדל' },
  { id: 'celery', label: 'סלרי' },
  { id: 'lupin', label: 'תורמוס' },
  { id: 'fish', label: 'דגים' },
  { id: 'crustaceans', label: 'סרטנים' },
  { id: 'molluscs', label: 'רכיכות' },
  { id: 'sulphites', label: 'סולפיטים' },
];

/** טכנולוגיות עיבוד רלוונטיות למאפייה */
export const HACCP_PROCESS_TECHS = [
  { id: 'baking', label: 'טיפול תרמי / אפייה' },
  { id: 'proofing', label: 'התפחה' },
  { id: 'cooling', label: 'קירור' },
  { id: 'freezing', label: 'הקפאה' },
  { id: 'frying', label: 'טיגון' },
  { id: 'drying', label: 'ייבוש' },
  { id: 'mixing', label: 'ערבוב / לישה' },
  { id: 'filling', label: 'מילוי / מריחה' },
  { id: 'packaging', label: 'אריזה' },
];

function emptyProductDescription(planId) {
  return {
    planId,
    composition: '',
    waterActivity: '',
    phValue: '',
    preservatives: '',
    physicalChemicalNotes: '',
    microbiological: '',
    processTechs: [],
    packaging: '',
    shelfLife: '',
    storageConditions: '',
    distributionConditions: '',
    allergens: [],
    labelingInfo: '',
    regulatoryRequirements: '',
    notes: '',
  };
}

function sanitizeTextField(raw, max = 2000) {
  return String(raw ?? '').trim().slice(0, max);
}

function sanitizeIdList(raw, allowed) {
  const set = new Set(allowed.map((a) => a.id));
  const list = Array.isArray(raw) ? raw : [];
  return [...new Set(list.map((x) => String(x)).filter((id) => set.has(id)))];
}

function normalizeProductDescription(row, planId) {
  const base = emptyProductDescription(planId);
  if (!row) return base;
  return {
    ...base,
    id: row.id,
    planId,
    composition: sanitizeTextField(row.composition, 4000),
    waterActivity: sanitizeTextField(row.waterActivity, 40),
    phValue: sanitizeTextField(row.phValue, 40),
    preservatives: sanitizeTextField(row.preservatives, 500),
    physicalChemicalNotes: sanitizeTextField(row.physicalChemicalNotes, 2000),
    microbiological: sanitizeTextField(row.microbiological, 2000),
    processTechs: sanitizeIdList(row.processTechs, HACCP_PROCESS_TECHS),
    packaging: sanitizeTextField(row.packaging, 1000),
    shelfLife: sanitizeTextField(row.shelfLife, 500),
    storageConditions: sanitizeTextField(row.storageConditions, 1000),
    distributionConditions: sanitizeTextField(row.distributionConditions, 1000),
    allergens: sanitizeIdList(row.allergens, HACCP_ALLERGENS),
    labelingInfo: sanitizeTextField(row.labelingInfo, 2000),
    regulatoryRequirements: sanitizeTextField(row.regulatoryRequirements, 2000),
    notes: sanitizeTextField(row.notes, 2000),
  };
}

export async function getHaccpProductDescription(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return emptyProductDescription(null);
  const row = await db.haccpProductDescriptions.where('planId').equals(pid).first();
  return normalizeProductDescription(row, pid);
}

export async function saveHaccpProductDescription(planId, fields = {}) {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית לפי משפחת מוצרים');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');

  const next = normalizeProductDescription({ ...fields, planId: pid }, pid);
  delete next.id;

  const existing = await db.haccpProductDescriptions.where('planId').equals(pid).first();
  if (existing) {
    await db.haccpProductDescriptions.update(existing.id, next);
    if (plan.currentStep === 'team' || plan.status === 'draft') {
      await db.haccpPlans.update(pid, { currentStep: 'product', status: 'in_progress' });
    }
    return existing.id;
  }
  const id = await db.haccpProductDescriptions.add(next);
  await db.haccpPlans.update(pid, { currentStep: 'product', status: 'in_progress' });
  return id;
}

/** מוצרים בקבוצת הקטגוריות של התכנית */
export async function getProductsForHaccpPlan(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const plan = await db.haccpPlans.get(pid);
  if (!plan?.categoryGroupId) return [];
  const categories = await db.categories.where('groupId').equals(Number(plan.categoryGroupId)).toArray();
  const catIds = new Set(categories.map((c) => c.id));
  const products = await db.products.toArray();
  return products
    .filter((p) => catIds.has(p.categoryId) && p.active !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

/**
 * מציע טקסט הרכב מתוך שמות חומרי גלם במתכונים המקושרים למוצרי המשפחה.
 * לא מחליף שמירה אוטומטית — רק הצעה למילוי.
 */
export async function suggestCompositionForHaccpPlan(planId) {
  const products = await getProductsForHaccpPlan(planId);
  if (!products.length) return '';
  const productIds = new Set(products.map((p) => p.id));
  const names = new Set();

  const components = await db.productRecipeComponents.toArray();
  const recipeIds = new Set(
    components.filter((c) => productIds.has(Number(c.productId))).map((c) => Number(c.recipeId)),
  );

  const links = await db.recipeProductLinks.toArray();
  for (const link of links) {
    if (productIds.has(Number(link.productId))) recipeIds.add(Number(link.recipeId));
  }

  const groupLinks = await db.recipeProductGroupLinks?.toArray?.() ?? [];
  const plan = await db.haccpPlans.get(sanitizeProductId(planId));
  for (const link of groupLinks) {
    if (Number(link.groupId) === Number(plan?.categoryGroupId)) recipeIds.add(Number(link.recipeId));
  }

  if (!recipeIds.size) return products.map((p) => p.name).join(', ');

  const ingredients = await db.recipeIngredients.toArray();
  for (const ing of ingredients) {
    if (!recipeIds.has(Number(ing.recipeId))) continue;
    const label = sanitizeName(ing.name, 80);
    if (label) names.add(label);
  }

  if (!names.size) return products.map((p) => p.name).join(', ');
  return [...names].sort((a, b) => a.localeCompare(b, 'he')).join(', ');
}
