import { db, ValidationError } from './db.js?v=400';
import { sanitizeName, sanitizeProductId } from './validators.js?v=400';

/** שלבי מפת הדרכים לפי מדריך משרד הבריאות */
export const HACCP_STEPS = [
  { id: 'overview', label: 'סקירה', chapter: '1–2', status: 'available' },
  { id: 'prp', label: 'תכניות קדם (PRP)', chapter: '2', status: 'preview' },
  { id: 'team', label: 'צוות HACCP', chapter: '3.1', status: 'available' },
  { id: 'product', label: 'תיאור המוצר', chapter: '3.2', status: 'available' },
  { id: 'intended_use', label: 'שימוש מיועד', chapter: '3.3', status: 'available' },
  { id: 'flow', label: 'תרשים זרימה', chapter: '3.4', status: 'available' },
  { id: 'flow_verify', label: 'אימות תרשים בשטח', chapter: '3.5', status: 'available' },
  { id: 'hazard', label: 'ניתוח גורמי סיכון', chapter: '5.1', status: 'available' },
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
  await db.transaction(
    'rw',
    db.haccpPlans,
    db.haccpProductDescriptions,
    db.haccpIntendedUses,
    db.haccpFlowSteps,
    db.haccpFlowVerifications,
    db.haccpHazards,
    async () => {
      const descs = await db.haccpProductDescriptions.where('planId').equals(pid).toArray();
      for (const d of descs) await db.haccpProductDescriptions.delete(d.id);
      const uses = await db.haccpIntendedUses.where('planId').equals(pid).toArray();
      for (const u of uses) await db.haccpIntendedUses.delete(u.id);
      const hazards = await db.haccpHazards.where('planId').equals(pid).toArray();
      for (const h of hazards) await db.haccpHazards.delete(h.id);
      const steps = await db.haccpFlowSteps.where('planId').equals(pid).toArray();
      for (const s of steps) await db.haccpFlowSteps.delete(s.id);
      const verifs = await db.haccpFlowVerifications.where('planId').equals(pid).toArray();
      for (const v of verifs) await db.haccpFlowVerifications.delete(v.id);
      await db.haccpPlans.delete(pid);
    },
  );
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

/** אופן צריכה צפוי — לפי הגדרת שימוש מיועד במדריך */
export const HACCP_CONSUMPTION_MODES = [
  { id: 'ready_to_eat', label: 'מוכן לאכילה כפי שהוא' },
  { id: 'heat_before', label: 'דורש חימום לפני אכילה' },
  { id: 'cook_before', label: 'דורש בישול / אפייה נוספת' },
  { id: 'ingredient', label: 'משמש כרכיב במוצר אחר' },
];

/** ערוצי הפצה / צריכה */
export const HACCP_USE_CHANNELS = [
  { id: 'retail', label: 'קמעונאות / צרכן פרטי' },
  { id: 'wholesale', label: 'סיטונאות' },
  { id: 'catering', label: 'קייטרינג / מוסדות' },
  { id: 'foodservice', label: 'מסעדות / בתי קפה' },
  { id: 'internal', label: 'שימוש פנימי במפעל' },
];

/** אוכלוסיות רגישות — דגש מיוחד לפי המדריך */
export const HACCP_SENSITIVE_GROUPS = [
  { id: 'general', label: 'אוכלוסייה כללית' },
  { id: 'children', label: 'ילדים' },
  { id: 'infants', label: 'תינוקות / פעוטות' },
  { id: 'elderly', label: 'קשישים' },
  { id: 'pregnant', label: 'נשים הרות' },
  { id: 'immunocompromised', label: 'מדוכאי חיסון' },
  { id: 'allergy', label: 'רגישים לאלרגנים' },
];

function emptyIntendedUse(planId) {
  return {
    planId,
    consumptionModes: [],
    targetAudience: '',
    sensitiveGroups: [],
    sensitiveNotes: '',
    channels: [],
    consumerInstructions: '',
    potentialMisuse: '',
    notSuitableFor: '',
    notes: '',
  };
}

function normalizeIntendedUse(row, planId) {
  const base = emptyIntendedUse(planId);
  if (!row) return base;
  return {
    ...base,
    id: row.id,
    planId,
    consumptionModes: sanitizeIdList(row.consumptionModes, HACCP_CONSUMPTION_MODES),
    targetAudience: sanitizeTextField(row.targetAudience, 2000),
    sensitiveGroups: sanitizeIdList(row.sensitiveGroups, HACCP_SENSITIVE_GROUPS),
    sensitiveNotes: sanitizeTextField(row.sensitiveNotes, 2000),
    channels: sanitizeIdList(row.channels, HACCP_USE_CHANNELS),
    consumerInstructions: sanitizeTextField(row.consumerInstructions, 2000),
    potentialMisuse: sanitizeTextField(row.potentialMisuse, 2000),
    notSuitableFor: sanitizeTextField(row.notSuitableFor, 2000),
    notes: sanitizeTextField(row.notes, 2000),
  };
}

export async function getHaccpIntendedUse(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return emptyIntendedUse(null);
  const row = await db.haccpIntendedUses.where('planId').equals(pid).first();
  return normalizeIntendedUse(row, pid);
}

export async function saveHaccpIntendedUse(planId, fields = {}) {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית לפי משפחת מוצרים');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');

  const next = normalizeIntendedUse({ ...fields, planId: pid }, pid);
  delete next.id;

  const existing = await db.haccpIntendedUses.where('planId').equals(pid).first();
  if (existing) {
    await db.haccpIntendedUses.update(existing.id, next);
    if (['team', 'product'].includes(plan.currentStep) || plan.status === 'draft') {
      await db.haccpPlans.update(pid, { currentStep: 'intended_use', status: 'in_progress' });
    }
    return existing.id;
  }
  const id = await db.haccpIntendedUses.add(next);
  await db.haccpPlans.update(pid, { currentStep: 'intended_use', status: 'in_progress' });
  return id;
}

/** סוגי שלבים בתרשים זרימה HACCP */
export const HACCP_FLOW_STEP_KINDS = [
  { id: 'receiving', label: 'קבלת חומ״ג / אריזות' },
  { id: 'storage_raw', label: 'אחסון חומרי גלם' },
  { id: 'prep', label: 'הכנה / שקילה' },
  { id: 'mixing', label: 'ערבוב / לישה' },
  { id: 'proofing', label: 'התפחה' },
  { id: 'forming', label: 'עיצוב / מילוי' },
  { id: 'baking', label: 'אפייה / טיפול תרמי' },
  { id: 'cooling', label: 'קירור' },
  { id: 'freezing', label: 'הקפאה' },
  { id: 'packaging', label: 'אריזה' },
  { id: 'storage_finished', label: 'אחסון מוצר מוגמר' },
  { id: 'shipping', label: 'הפצה / משלוח' },
  { id: 'other', label: 'אחר' },
];

export const DEFAULT_HACCP_FLOW_STEPS = [
  { name: 'קבלת חומרי גלם ואריזות', stepKind: 'receiving' },
  { name: 'אחסון חומרי גלם', stepKind: 'storage_raw' },
  { name: 'הכנה ושקילה', stepKind: 'prep' },
  { name: 'ערבוב / לישה', stepKind: 'mixing' },
  { name: 'עיצוב / מילוי', stepKind: 'forming' },
  { name: 'אפייה', stepKind: 'baking' },
  { name: 'קירור', stepKind: 'cooling' },
  { name: 'אריזה', stepKind: 'packaging' },
  { name: 'אחסון מוצר מוגמר', stepKind: 'storage_finished' },
  { name: 'הפצה / משלוח', stepKind: 'shipping' },
];

export function haccpFlowStepKindLabel(kindId) {
  return HACCP_FLOW_STEP_KINDS.find((k) => k.id === kindId)?.label || kindId || '—';
}

function sanitizeFlowStepKind(kind) {
  const id = String(kind || '').trim();
  return HACCP_FLOW_STEP_KINDS.some((k) => k.id === id) ? id : 'other';
}

function guessFlowStepKind(name) {
  const n = String(name || '').toLowerCase();
  if (/קבל|ספק|משלוח.?נכנס|פריק/.test(n)) return 'receiving';
  if (/אחסון.?חומ|מחסן.?חומ|קירור.?חומ/.test(n)) return 'storage_raw';
  if (/שקיל|הכנת.?חומ|הכנה/.test(n)) return 'prep';
  if (/ערבוב|ליש|מיקסר|לישה/.test(n)) return 'mixing';
  if (/התפח|תפיח|proof/.test(n)) return 'proofing';
  if (/עיצוב|מילוי|מריח|קישוט|פורם/.test(n)) return 'forming';
  if (/אפי|תנור|טיגון|טיפול.?תרמי/.test(n)) return 'baking';
  if (/קירור|צינון/.test(n)) return 'cooling';
  if (/הקפא|מקפיא/.test(n)) return 'freezing';
  if (/אריז/.test(n)) return 'packaging';
  if (/אחסון.?מוצר|מחסן.?מוגמר|מלאי.?מוגמר/.test(n)) return 'storage_finished';
  if (/הפצ|משלוח|שילוח|מכיר/.test(n)) return 'shipping';
  return 'other';
}

async function markPlanFlowInProgress(plan) {
  if (!plan?.id) return;
  const early = ['team', 'product', 'intended_use', 'overview'];
  if (early.includes(plan.currentStep) || plan.status === 'draft') {
    await db.haccpPlans.update(plan.id, { currentStep: 'flow', status: 'in_progress' });
  }
}

export async function getHaccpFlowSteps(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const rows = await db.haccpFlowSteps.where('planId').equals(pid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function addHaccpFlowStep(planId, {
  name,
  stepKind = 'other',
  description = '',
  notes = '',
  isCcpCandidate = false,
} = {}) {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית לפי משפחת מוצרים');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');
  const cleanName = sanitizeName(name, 120);
  if (!cleanName) throw new ValidationError('הזן שם שלב');

  const existing = await getHaccpFlowSteps(pid);
  const sortOrder = existing.length
    ? Math.max(...existing.map((s) => s.sortOrder ?? 0)) + 1
    : 1;

  const id = await db.haccpFlowSteps.add({
    planId: pid,
    name: cleanName,
    stepKind: sanitizeFlowStepKind(stepKind),
    description: sanitizeTextField(description, 1000),
    notes: sanitizeTextField(notes, 1000),
    isCcpCandidate: !!isCcpCandidate,
    sortOrder,
  });
  await markPlanFlowInProgress(plan);
  return id;
}

export async function updateHaccpFlowStep(id, patch = {}) {
  const sid = sanitizeProductId(id);
  if (!sid) return;
  const row = await db.haccpFlowSteps.get(sid);
  if (!row) throw new ValidationError('שלב לא נמצא');
  const next = {};
  if (patch.name !== undefined) {
    const cleanName = sanitizeName(patch.name, 120);
    if (!cleanName) throw new ValidationError('הזן שם שלב');
    next.name = cleanName;
  }
  if (patch.stepKind !== undefined) next.stepKind = sanitizeFlowStepKind(patch.stepKind);
  if (patch.description !== undefined) next.description = sanitizeTextField(patch.description, 1000);
  if (patch.notes !== undefined) next.notes = sanitizeTextField(patch.notes, 1000);
  if (patch.isCcpCandidate !== undefined) next.isCcpCandidate = !!patch.isCcpCandidate;
  if (!Object.keys(next).length) return;
  await db.haccpFlowSteps.update(sid, next);
}

export async function deleteHaccpFlowStep(id) {
  const sid = sanitizeProductId(id);
  if (!sid) return;
  await db.transaction('rw', db.haccpFlowSteps, db.haccpHazards, async () => {
    const hazards = await db.haccpHazards.where('flowStepId').equals(sid).toArray();
    for (const h of hazards) await db.haccpHazards.delete(h.id);
    await db.haccpFlowSteps.delete(sid);
  });
}

export async function moveHaccpFlowStep(planId, stepId, direction) {
  const pid = sanitizeProductId(planId);
  const sid = sanitizeProductId(stepId);
  if (!pid || !sid) return;
  const steps = await getHaccpFlowSteps(pid);
  const idx = steps.findIndex((s) => s.id === sid);
  if (idx < 0) return;
  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= steps.length) return;

  const a = steps[idx];
  const b = steps[swapWith];
  await db.transaction('rw', db.haccpFlowSteps, async () => {
    await db.haccpFlowSteps.update(a.id, { sortOrder: b.sortOrder ?? swapWith + 1 });
    await db.haccpFlowSteps.update(b.id, { sortOrder: a.sortOrder ?? idx + 1 });
  });
}

/** מציב רשימת שלבים לפי סדר מזהים */
export async function reorderHaccpFlowSteps(planId, orderedIds) {
  const pid = sanitizeProductId(planId);
  if (!pid) return;
  const ids = Array.isArray(orderedIds)
    ? orderedIds.map((x) => sanitizeProductId(x)).filter(Boolean)
    : [];
  await db.transaction('rw', db.haccpFlowSteps, async () => {
    for (let i = 0; i < ids.length; i += 1) {
      await db.haccpFlowSteps.update(ids[i], { sortOrder: i + 1 });
    }
  });
}

/** זורע תרשים ברירת מחדל למאפייה אם אין שלבים */
export async function seedDefaultHaccpFlowSteps(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');
  const existing = await getHaccpFlowSteps(pid);
  if (existing.length) throw new ValidationError('כבר יש שלבים בתרשים — מחק או ערוך אותם');

  await db.transaction('rw', db.haccpFlowSteps, db.haccpPlans, async () => {
    for (let i = 0; i < DEFAULT_HACCP_FLOW_STEPS.length; i += 1) {
      const step = DEFAULT_HACCP_FLOW_STEPS[i];
      await db.haccpFlowSteps.add({
        planId: pid,
        name: step.name,
        stepKind: step.stepKind,
        description: '',
        notes: '',
        isCcpCandidate: false,
        sortOrder: i + 1,
      });
    }
    await markPlanFlowInProgress(plan);
  });
  return DEFAULT_HACCP_FLOW_STEPS.length;
}

/**
 * תזרימי ייצור רלוונטיים למשפחת התכנית (קבוצה + קטגוריות בתוכה).
 * משמש לייבוא שמות שלבים לתרשים HACCP — העתקה, לא קישור חי.
 */
export async function listProductionFlowsForHaccpPlan(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const plan = await db.haccpPlans.get(pid);
  if (!plan?.categoryGroupId) return [];
  const gid = Number(plan.categoryGroupId);
  const categories = await db.categories.where('groupId').equals(gid).toArray();
  const catIds = new Set(categories.map((c) => c.id));
  const flows = await db.flows.toArray();
  const relevant = flows.filter((f) =>
    Number(f.categoryGroupId) === gid || catIds.has(Number(f.categoryId)));
  const steps = await db.flowSteps.toArray();
  const byFlow = new Map();
  for (const s of steps) {
    if (!s.flowId) continue;
    if (!byFlow.has(s.flowId)) byFlow.set(s.flowId, []);
    byFlow.get(s.flowId).push(s);
  }
  return relevant
    .map((f) => {
      const flowSteps = (byFlow.get(f.id) || [])
        .filter((s) => !s.tracksProduction)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
      return {
        id: f.id,
        name: f.name || 'תזרים',
        stepCount: flowSteps.length,
        stepNames: flowSteps.map((s) => s.name).filter(Boolean),
      };
    })
    .filter((f) => f.stepCount > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/** מייבא שלבים מתזרים ייצור קיים (העתקה לתרשים HACCP) */
export async function importHaccpFlowFromProduction(planId, productionFlowId, { replace = false } = {}) {
  const pid = sanitizeProductId(planId);
  const fid = sanitizeProductId(productionFlowId);
  if (!pid || !fid) throw new ValidationError('בחר תכנית ותזרים');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');
  const flow = await db.flows.get(fid);
  if (!flow) throw new ValidationError('תזרים ייצור לא נמצא');

  const rawSteps = await db.flowSteps.where('flowId').equals(fid).toArray();
  const steps = rawSteps
    .filter((s) => !s.tracksProduction)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  if (!steps.length) throw new ValidationError('לתזרים אין שלבים לייבוא');

  await db.transaction('rw', db.haccpFlowSteps, db.haccpPlans, async () => {
    if (replace) {
      const existing = await db.haccpFlowSteps.where('planId').equals(pid).toArray();
      for (const s of existing) await db.haccpFlowSteps.delete(s.id);
    }
    const current = replace ? [] : await db.haccpFlowSteps.where('planId').equals(pid).toArray();
    let sortOrder = current.length
      ? Math.max(...current.map((s) => s.sortOrder ?? 0))
      : 0;
    for (const s of steps) {
      const name = sanitizeName(s.name, 120);
      if (!name) continue;
      sortOrder += 1;
      await db.haccpFlowSteps.add({
        planId: pid,
        name,
        stepKind: guessFlowStepKind(name),
        description: '',
        notes: '',
        isCcpCandidate: false,
        sortOrder,
      });
    }
    await markPlanFlowInProgress(plan);
  });
  return steps.length;
}

/** תוצאת אימות תרשים בשטח */
export const HACCP_FLOW_MATCH_RESULTS = [
  { id: 'matches', label: 'תואם למציאות בשטח' },
  { id: 'partial', label: 'תואם חלקית — נדרשו תיקונים' },
  { id: 'mismatch', label: 'לא תואם — נדרש עדכון תרשים' },
];

export function haccpFlowMatchLabel(id) {
  return HACCP_FLOW_MATCH_RESULTS.find((r) => r.id === id)?.label || id || '—';
}

function sanitizeMatchResult(raw) {
  const id = String(raw || '').trim();
  return HACCP_FLOW_MATCH_RESULTS.some((r) => r.id === id) ? id : 'matches';
}

function sanitizeDateField(raw) {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

function sanitizeMemberIdList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return [...new Set(list.map((x) => sanitizeProductId(x)).filter(Boolean))];
}

async function markPlanFlowVerifyInProgress(plan) {
  if (!plan?.id) return;
  const early = ['team', 'product', 'intended_use', 'flow', 'overview'];
  if (early.includes(plan.currentStep) || plan.status === 'draft') {
    await db.haccpPlans.update(plan.id, { currentStep: 'flow_verify', status: 'in_progress' });
  }
}

export async function getHaccpFlowVerifications(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const rows = await db.haccpFlowVerifications.where('planId').equals(pid).toArray();
  return rows.sort((a, b) => {
    const d = String(b.verifiedAt || '').localeCompare(String(a.verifiedAt || ''));
    if (d) return d;
    return (b.id || 0) - (a.id || 0);
  });
}

export async function getLatestHaccpFlowVerification(planId) {
  const rows = await getHaccpFlowVerifications(planId);
  return rows[0] || null;
}

export async function addHaccpFlowVerification(planId, fields = {}) {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית לפי משפחת מוצרים');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');

  const steps = await getHaccpFlowSteps(pid);
  if (!steps.length) {
    throw new ValidationError('אין תרשים זרימה לאימות — מלא קודם את שלב 3.4');
  }

  const verifiedAt = sanitizeDateField(fields.verifiedAt);
  if (!verifiedAt) throw new ValidationError('בחר תאריך אימות');

  const verifierMemberIds = sanitizeMemberIdList(fields.verifierMemberIds);
  const verifiedByText = sanitizeTextField(fields.verifiedByText, 500);
  if (!verifierMemberIds.length && !verifiedByText) {
    throw new ValidationError('סמן חברי צוות מאמתים או הזן שמות');
  }

  const id = await db.haccpFlowVerifications.add({
    planId: pid,
    verifiedAt,
    verifierMemberIds,
    verifiedByText,
    matchResult: sanitizeMatchResult(fields.matchResult),
    walkedOnSite: fields.walkedOnSite !== false,
    packagingIncluded: !!fields.packagingIncluded,
    allStepsPresent: !!fields.allStepsPresent,
    noUnauthorizedChanges: !!fields.noUnauthorizedChanges,
    discrepancies: sanitizeTextField(fields.discrepancies, 2000),
    correctionsMade: sanitizeTextField(fields.correctionsMade, 2000),
    notes: sanitizeTextField(fields.notes, 2000),
    stepCountSnapshot: steps.length,
    stepNamesSnapshot: steps.map((s) => s.name).join(' → ').slice(0, 2000),
    createdAt: new Date().toISOString(),
  });
  await markPlanFlowVerifyInProgress(plan);
  return id;
}

export async function deleteHaccpFlowVerification(id) {
  const vid = sanitizeProductId(id);
  if (!vid) return;
  await db.haccpFlowVerifications.delete(vid);
}

/** סוגי גורמי סיכון */
export const HACCP_HAZARD_TYPES = [
  { id: 'biological', label: 'ביולוגי' },
  { id: 'chemical', label: 'כימי' },
  { id: 'physical', label: 'פיזיקלי' },
  { id: 'allergen', label: 'אלרגן' },
];

export const HACCP_RISK_LEVELS = [
  { id: 'low', label: 'נמוך', score: 1 },
  { id: 'medium', label: 'בינוני', score: 2 },
  { id: 'high', label: 'גבוה', score: 3 },
];

export function haccpHazardTypeLabel(id) {
  return HACCP_HAZARD_TYPES.find((t) => t.id === id)?.label || id || '—';
}

export function haccpRiskLevelLabel(id) {
  return HACCP_RISK_LEVELS.find((l) => l.id === id)?.label || id || '—';
}

function sanitizeHazardType(raw) {
  const id = String(raw || '').trim();
  return HACCP_HAZARD_TYPES.some((t) => t.id === id) ? id : 'biological';
}

function sanitizeRiskLevel(raw) {
  const id = String(raw || '').trim();
  return HACCP_RISK_LEVELS.some((l) => l.id === id) ? id : 'medium';
}

export function computeHazardSignificant(likelihood, severity) {
  const score = (id) => HACCP_RISK_LEVELS.find((l) => l.id === id)?.score || 1;
  return score(likelihood) * score(severity) >= 4;
}

/** הצעות סיכונים נפוצים למאפייה לפי סוג שלב */
export const HACCP_HAZARD_SUGGESTIONS_BY_KIND = {
  receiving: [
    { hazardType: 'biological', description: 'זיהום מיקרוביאלי בחומרי גלם', source: 'ספק / הובלה', likelihood: 'medium', severity: 'high' },
    { hazardType: 'physical', description: 'גופים זרים באריזות / חומ״ג', source: 'אריזה פגומה / ספק', likelihood: 'low', severity: 'high' },
    { hazardType: 'chemical', description: 'שאריות חומרי הדברה / כימיקלים', source: 'חומרי גלם חקלאיים', likelihood: 'low', severity: 'high' },
  ],
  storage_raw: [
    { hazardType: 'biological', description: 'גידול מיקרואורגניזמים באחסון', source: 'טמפרטורה / זמן אחסון', likelihood: 'medium', severity: 'high' },
    { hazardType: 'allergen', description: 'זיהום צולב אלרגנים במחסן', source: 'אחסון משותף / שפיכה', likelihood: 'medium', severity: 'high' },
  ],
  prep: [
    { hazardType: 'biological', description: 'זיהום מצליב בהכנה', source: 'משטחים / כלים / ידיים', likelihood: 'medium', severity: 'high' },
    { hazardType: 'physical', description: 'גופים זרים בשקילה/הכנה', source: 'ציוד / אריזות', likelihood: 'low', severity: 'medium' },
  ],
  mixing: [
    { hazardType: 'biological', description: 'זיהום מבצק/מכונות', source: 'ניקיון ציוד לקוי', likelihood: 'medium', severity: 'medium' },
    { hazardType: 'allergen', description: 'ערבוב אלרגנים לא מתוכנן', source: 'שאריות במערבל', likelihood: 'medium', severity: 'high' },
  ],
  proofing: [
    { hazardType: 'biological', description: 'גידול חיידקים בהתפחה ממושכת', source: 'זמן / טמפרטורה', likelihood: 'medium', severity: 'medium' },
  ],
  forming: [
    { hazardType: 'biological', description: 'זיהום בידיים / משטחי עבודה', source: 'היגיינה', likelihood: 'medium', severity: 'high' },
    { hazardType: 'physical', description: 'גופים זרים בעיצוב/מילוי', source: 'קישוטים / כלים', likelihood: 'low', severity: 'medium' },
  ],
  baking: [
    { hazardType: 'biological', description: 'הישרדות פתוגנים באפייה לא מספקת', source: 'טמפרטורה / זמן אפייה', likelihood: 'medium', severity: 'high', isCcpCandidate: true },
  ],
  cooling: [
    { hazardType: 'biological', description: 'גידול מיקרוביאלי בקירור איטי', source: 'זמן בקשת הסכנה', likelihood: 'medium', severity: 'high', isCcpCandidate: true },
  ],
  freezing: [
    { hazardType: 'biological', description: 'הישרדות פתוגנים בהקפאה לא תקינה', source: 'טמפרטורת מקפיא', likelihood: 'low', severity: 'high' },
  ],
  packaging: [
    { hazardType: 'biological', description: 'זיהום לאחר אפייה באריזה', source: 'ידיים / משטח / אוויר', likelihood: 'medium', severity: 'high' },
    { hazardType: 'physical', description: 'גופים זרים באריזה', source: 'חומר אריזה / קו', likelihood: 'low', severity: 'medium' },
    { hazardType: 'allergen', description: 'סימון אלרגנים שגוי', source: 'תווית / החלפת מוצר', likelihood: 'low', severity: 'high' },
  ],
  storage_finished: [
    { hazardType: 'biological', description: 'גידול מיקרוביאלי באחסון מוגמר', source: 'טמפרטורה / תוקף', likelihood: 'medium', severity: 'high' },
  ],
  shipping: [
    { hazardType: 'biological', description: 'שבירת שרשרת קירור בהפצה', source: 'הובלה', likelihood: 'medium', severity: 'high' },
  ],
  other: [
    { hazardType: 'biological', description: 'זיהום מיקרוביאלי כללי', source: 'תהליך', likelihood: 'medium', severity: 'medium' },
  ],
};

async function markPlanHazardInProgress(plan) {
  if (!plan?.id) return;
  const early = ['team', 'product', 'intended_use', 'flow', 'flow_verify', 'overview'];
  if (early.includes(plan.currentStep) || plan.status === 'draft') {
    await db.haccpPlans.update(plan.id, { currentStep: 'hazard', status: 'in_progress' });
  }
}

export async function getHaccpHazards(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const rows = await db.haccpHazards.where('planId').equals(pid).toArray();
  return rows.sort((a, b) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function getHaccpHazardsForStep(flowStepId) {
  const sid = sanitizeProductId(flowStepId);
  if (!sid) return [];
  const rows = await db.haccpHazards.where('flowStepId').equals(sid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function addHaccpHazard(planId, {
  flowStepId,
  hazardType = 'biological',
  description = '',
  source = '',
  likelihood = 'medium',
  severity = 'medium',
  significant,
  controlMeasures = '',
  controlledByPrp = false,
  isCcpCandidate = false,
  justification = '',
  notes = '',
} = {}) {
  const pid = sanitizeProductId(planId);
  const sid = sanitizeProductId(flowStepId);
  if (!pid) throw new ValidationError('בחר תכנית');
  if (!sid) throw new ValidationError('בחר שלב בתרשים הזרימה');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');
  const step = await db.haccpFlowSteps.get(sid);
  if (!step || Number(step.planId) !== Number(pid)) {
    throw new ValidationError('שלב התרשים לא שייך לתכנית');
  }
  const cleanDesc = sanitizeTextField(description, 1000);
  if (!cleanDesc) throw new ValidationError('תאר את גורם הסיכון');

  const likeli = sanitizeRiskLevel(likelihood);
  const sev = sanitizeRiskLevel(severity);
  const sig = significant === undefined ? computeHazardSignificant(likeli, sev) : !!significant;

  const existing = await getHaccpHazards(pid);
  const sortOrder = existing.length
    ? Math.max(...existing.map((h) => h.sortOrder ?? 0)) + 1
    : 1;

  const id = await db.haccpHazards.add({
    planId: pid,
    flowStepId: sid,
    hazardType: sanitizeHazardType(hazardType),
    description: cleanDesc,
    source: sanitizeTextField(source, 500),
    likelihood: likeli,
    severity: sev,
    significant: sig,
    controlMeasures: sanitizeTextField(controlMeasures, 2000),
    controlledByPrp: !!controlledByPrp,
    isCcpCandidate: !!isCcpCandidate,
    justification: sanitizeTextField(justification, 2000),
    notes: sanitizeTextField(notes, 2000),
    sortOrder,
  });
  await markPlanHazardInProgress(plan);
  return id;
}

export async function updateHaccpHazard(id, patch = {}) {
  const hid = sanitizeProductId(id);
  if (!hid) return;
  const row = await db.haccpHazards.get(hid);
  if (!row) throw new ValidationError('גורם סיכון לא נמצא');
  const next = {};
  if (patch.description !== undefined) {
    const cleanDesc = sanitizeTextField(patch.description, 1000);
    if (!cleanDesc) throw new ValidationError('תאר את גורם הסיכון');
    next.description = cleanDesc;
  }
  if (patch.hazardType !== undefined) next.hazardType = sanitizeHazardType(patch.hazardType);
  if (patch.source !== undefined) next.source = sanitizeTextField(patch.source, 500);
  if (patch.likelihood !== undefined) next.likelihood = sanitizeRiskLevel(patch.likelihood);
  if (patch.severity !== undefined) next.severity = sanitizeRiskLevel(patch.severity);
  if (patch.controlMeasures !== undefined) {
    next.controlMeasures = sanitizeTextField(patch.controlMeasures, 2000);
  }
  if (patch.controlledByPrp !== undefined) next.controlledByPrp = !!patch.controlledByPrp;
  if (patch.isCcpCandidate !== undefined) next.isCcpCandidate = !!patch.isCcpCandidate;
  if (patch.justification !== undefined) next.justification = sanitizeTextField(patch.justification, 2000);
  if (patch.notes !== undefined) next.notes = sanitizeTextField(patch.notes, 2000);
  if (patch.significant !== undefined) next.significant = !!patch.significant;
  else if (next.likelihood || next.severity) {
    next.significant = computeHazardSignificant(
      next.likelihood || row.likelihood,
      next.severity || row.severity,
    );
  }
  if (patch.flowStepId !== undefined) {
    const sid = sanitizeProductId(patch.flowStepId);
    if (!sid) throw new ValidationError('שלב לא תקין');
    const step = await db.haccpFlowSteps.get(sid);
    if (!step || Number(step.planId) !== Number(row.planId)) {
      throw new ValidationError('שלב התרשים לא שייך לתכנית');
    }
    next.flowStepId = sid;
  }
  if (!Object.keys(next).length) return;
  await db.haccpHazards.update(hid, next);
}

export async function deleteHaccpHazard(id) {
  const hid = sanitizeProductId(id);
  if (!hid) return;
  await db.haccpHazards.delete(hid);
}

/** מוסיף הצעות סיכון לשלב לפי סוג השלב — מדלג על תיאורים שכבר קיימים */
export async function seedSuggestedHazardsForStep(planId, flowStepId) {
  const pid = sanitizeProductId(planId);
  const sid = sanitizeProductId(flowStepId);
  if (!pid || !sid) throw new ValidationError('בחר תכנית ושלב');
  const step = await db.haccpFlowSteps.get(sid);
  if (!step || Number(step.planId) !== Number(pid)) {
    throw new ValidationError('שלב לא נמצא בתכנית');
  }
  const suggestions = HACCP_HAZARD_SUGGESTIONS_BY_KIND[step.stepKind]
    || HACCP_HAZARD_SUGGESTIONS_BY_KIND.other;
  const existing = await getHaccpHazardsForStep(sid);
  const existingDesc = new Set(existing.map((h) => String(h.description || '').trim()));
  let added = 0;
  for (const s of suggestions) {
    if (existingDesc.has(s.description)) continue;
    await addHaccpHazard(pid, {
      flowStepId: sid,
      ...s,
      controlMeasures: '',
      controlledByPrp: !s.isCcpCandidate,
    });
    added += 1;
  }
  if (!added) throw new ValidationError('כל ההצעות לשלב זה כבר קיימות');
  return added;
}
