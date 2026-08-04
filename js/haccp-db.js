import { db, ValidationError } from './db.js?v=395';
import { sanitizeName, sanitizeProductId } from './validators.js?v=395';

/** שלבי מפת הדרכים לפי מדריך משרד הבריאות */
export const HACCP_STEPS = [
  { id: 'overview', label: 'סקירה', chapter: '1–2', status: 'available' },
  { id: 'prp', label: 'תכניות קדם (PRP)', chapter: '2', status: 'preview' },
  { id: 'team', label: 'צוות HACCP', chapter: '3.1', status: 'available' },
  { id: 'product', label: 'תיאור המוצר', chapter: '3.2', status: 'soon' },
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
  await db.haccpPlans.delete(pid);
  const active = await getActiveHaccpPlanId();
  if (active === pid) await setActiveHaccpPlanId(null);
}
