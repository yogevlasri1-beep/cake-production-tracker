import { db, ValidationError } from './db.js?v=432';
import { sanitizeName, sanitizeProductId } from './validators.js?v=432';
import { logAuditEvent } from './audit.js?v=432';

/** שלבי מפת הדרכים לפי מדריך משרד הבריאות */
export const HACCP_STEPS = [
  { id: 'overview', label: 'סקירה', chapter: '1–2', status: 'available' },
  { id: 'prp', label: 'תכניות קדם (PRP)', chapter: '2', status: 'available' },
  { id: 'team', label: 'צוות HACCP', chapter: '3.1', status: 'available' },
  { id: 'product', label: 'תיאור המוצר', chapter: '3.2', status: 'available' },
  { id: 'intended_use', label: 'שימוש מיועד', chapter: '3.3', status: 'available' },
  { id: 'flow', label: 'תרשים זרימה', chapter: '3.4', status: 'available' },
  { id: 'flow_verify', label: 'אימות תרשים בשטח', chapter: '3.5', status: 'available' },
  { id: 'hazard', label: 'ניתוח גורמי סיכון', chapter: '5.1', status: 'available' },
  { id: 'ccp', label: 'נקודות בקרה קריטיות (CCP)', chapter: '5.2', status: 'available' },
  { id: 'limits', label: 'גבולות בקרה קריטיים', chapter: '5.3', status: 'available' },
  { id: 'monitoring', label: 'ניטור', chapter: '5.4', status: 'available' },
  { id: 'monitor_log', label: 'יומן ניטור', chapter: '5.4+', status: 'available' },
  { id: 'corrective', label: 'פעולות מתקנות', chapter: '5.5', status: 'available' },
  { id: 'verification', label: 'אימות מערכת', chapter: '5.6', status: 'available' },
  { id: 'documentation', label: 'תיעוד ורישום', chapter: '5.7', status: 'available' },
];

/**
 * סדר אשף בניית תכנית (ללא סקירה / יומן תפעולי).
 * נעילה באשף: שלב הבא נפתח אחרי שסעיף המוכנות של הקודם מסומן כהושלם.
 */
export const HACCP_WIZARD_STEPS = [
  'team',
  'prp',
  'product',
  'intended_use',
  'flow',
  'flow_verify',
  'hazard',
  'ccp',
  'limits',
  'monitoring',
  'corrective',
  'verification',
  'documentation',
];

/** תבנית צוות מאפייה בסיסית (רק אם אין חברים בכלל) */
export const BAKERY_TEAM_TEMPLATE = [
  {
    name: 'מוביל איכות',
    role: 'quality',
    isLeader: true,
    authorityNotes: 'אישור פעולות מתקנות וחריגות CCP',
  },
  {
    name: 'אחראי ייצור',
    role: 'production',
    isLeader: false,
    authorityNotes: 'ביצוע ניטור בשטח ורישום יומן',
  },
];

/** שימוש מיועד — ברירת מחדל למאפייה קמעונאית (תבנית כללית) */
export const BAKERY_INTENDED_USE_TEMPLATE = {
  targetAudience: 'צרכנים פרטיים הרוכשים מוצרי מאפה טריים / ארוזים',
  consumptionModes: ['ready_to_eat'],
  channels: ['retail', 'foodservice'],
  sensitiveGroups: ['general', 'children', 'allergy'],
  sensitiveNotes: 'מוצרים עשויים להכיל אלרגנים נפוצים (גלוטן, ביצים, חלב, אגוזים) — יש לסמן על התווית',
  consumerInstructions: 'לאחסן לפי הוראות האריזה. מוצרים רגישים לקירור — לשמור בקירור עד הצריכה',
  potentialMisuse: 'אחסון מחוץ לטמפרטורה הנדרשת / צריכה אחרי תום תוקף',
  notSuitableFor: 'צרכנים עם אלרגיה לאלרגנים המסומנים על האריזה',
  notes: 'טיוטת מאפייה — יש להתאים למשפחת המוצרים הספציפית',
};

/**
 * תבניות מאפייה לפי סוג מוצר — שימוש מיועד + תיאור מוצר + תרשים ברירת מחדל.
 * id `general` שומר תאימות לאחור עם BAKERY_INTENDED_USE_TEMPLATE.
 */
export const HACCP_BAKERY_TEMPLATES = [
  {
    id: 'general',
    label: 'מאפייה כללית',
    intendedUse: { ...BAKERY_INTENDED_USE_TEMPLATE },
    productDefaults: {
      shelfLife: 'לפי סוג המוצר והאריזה — יש לקבוע לכל פריט',
      storageConditions: 'טמפרטורת חדר קרירה / קירור לפי המוצר',
      processTechs: ['baking', 'cooling'],
      notes: 'טיוטת תבנית מאפייה כללית',
    },
    flowSteps: null,
  },
  {
    id: 'cakes',
    label: 'עוגות וקינוחים',
    intendedUse: {
      targetAudience: 'צרכנים פרטיים ואירועים — עוגות וקינוחים מוכנים לאכילה',
      consumptionModes: ['ready_to_eat'],
      channels: ['retail', 'catering', 'foodservice'],
      sensitiveGroups: ['general', 'children', 'allergy'],
      sensitiveNotes: 'אלרגנים נפוצים: גלוטן, ביצים, חלב, אגוזים — סימון חובה על האריזה/תווית',
      consumerInstructions: 'לאחסן בקירור אם המוצר מכיל קרם/גבינה. לצרוך עד תאריך התפוגה',
      potentialMisuse: 'השארה מחוץ לקירור במוצרים רגישים / חיתוך בכלים מזוהמים',
      notSuitableFor: 'אלרגיים לאלרגנים המסומנים',
      notes: 'תבנית עוגות — להתאים למתכוני המשפחה',
    },
    productDefaults: {
      shelfLife: 'עוגות יבשות: עד מספר ימים באריזה; עם קרם: לפי קירור ותנאי אחסון',
      storageConditions: 'קירור למוצרים עם קרם/גבינה; יבש לארוזים יציבים',
      processTechs: ['baking', 'cooling', 'freezing'],
      packaging: 'אריזה אישית / קופסה — הגנה ממגע ומזהמים',
      notes: 'טיוטת תבנית עוגות וקינוחים',
    },
    flowSteps: [
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
    ],
  },
  {
    id: 'doughs',
    label: 'לחמים ובצקים',
    intendedUse: {
      targetAudience: 'צרכנים וקמעונאים — לחם ובצקים טריים / קפואים',
      consumptionModes: ['ready_to_eat', 'cook_before'],
      channels: ['retail', 'wholesale', 'foodservice'],
      sensitiveGroups: ['general', 'allergy'],
      sensitiveNotes: 'גלוטן כאלרגן עיקרי; אפשרות לזיהום צולב בקו ייצור',
      consumerInstructions: 'לחם טרי — לאחסן במקום יבש; בצק קפוא — לפי הוראות הפשרה ואפייה',
      potentialMisuse: 'הפשרה חוזרת / אפייה חלקית / אחסון לח',
      notSuitableFor: 'אלרגיים לגלוטן (ולשאר אלרגנים מסומנים)',
      notes: 'תבנית לחמים ובצקים',
    },
    productDefaults: {
      shelfLife: 'לחם טרי: יום–יומיים; קפוא: לפי תנאי הקפאה',
      storageConditions: 'טמפרטורת חדר יבשה ללחם; הקפאה לבצקים קפואים',
      processTechs: ['proofing', 'baking', 'cooling', 'freezing'],
      notes: 'טיוטת תבנית לחמים ובצקים',
    },
    flowSteps: [
      { name: 'קבלת קמחים וחומרי גלם', stepKind: 'receiving' },
      { name: 'אחסון חומרי גלם', stepKind: 'storage_raw' },
      { name: 'שקילה והכנה', stepKind: 'prep' },
      { name: 'לישה / ערבוב', stepKind: 'mixing' },
      { name: 'התפחה', stepKind: 'proofing' },
      { name: 'עיצוב', stepKind: 'forming' },
      { name: 'אפייה', stepKind: 'baking' },
      { name: 'קירור', stepKind: 'cooling' },
      { name: 'אריזה', stepKind: 'packaging' },
      { name: 'אחסון / הפצה', stepKind: 'shipping' },
    ],
  },
  {
    id: 'creams',
    label: 'קרמים ומילויים',
    intendedUse: {
      targetAudience: 'שימוש פנימי כרכיב / מכירה כמילוי מוכן',
      consumptionModes: ['ingredient', 'ready_to_eat'],
      channels: ['internal', 'foodservice', 'retail'],
      sensitiveGroups: ['general', 'children', 'allergy', 'pregnant'],
      sensitiveNotes: 'מוצרים רגישים לקירור — סיכון מיקרוביולוגי גבוה יחסית',
      consumerInstructions: 'לשמור בקירור ברציפות; לא להפשיר ולהקפיא שוב',
      potentialMisuse: 'השארה בטמפרטורת חדר / ערבוב בכלים לא מחוטים',
      notSuitableFor: 'שימוש אחרי חריגת טמפרטורה או תום תוקף',
      notes: 'תבנית קרמים ומילויים — דגש על שרשרת קירור',
    },
    productDefaults: {
      shelfLife: 'קצר — לפי מתכון ותנאי קירור (ימים בודדים בקירור)',
      storageConditions: 'קירור ≤5°C ברציפות; הקפאה אם מוגדר במתכון',
      processTechs: ['cooling', 'freezing'],
      packaging: 'מיכל סגור / שקית — מניעת זיהום צולב',
      notes: 'טיוטת תבנית קרמים ומילויים',
    },
    flowSteps: [
      { name: 'קבלת חומרי גלם (קירור)', stepKind: 'receiving' },
      { name: 'אחסון מקורר', stepKind: 'storage_raw' },
      { name: 'הכנה ושקילה', stepKind: 'prep' },
      { name: 'הכנת קרם / מילוי', stepKind: 'mixing' },
      { name: 'קירור מהיר', stepKind: 'cooling' },
      { name: 'אריזה', stepKind: 'packaging' },
      { name: 'אחסון מקורר מוגמר', stepKind: 'storage_finished' },
      { name: 'הפצה בקירור', stepKind: 'shipping' },
    ],
  },
];

export function getHaccpBakeryTemplate(templateId = 'general') {
  const id = String(templateId || 'general').trim();
  return HACCP_BAKERY_TEMPLATES.find((t) => t.id === id) || HACCP_BAKERY_TEMPLATES[0];
}

export function haccpBakeryTemplateLabel(templateId) {
  return getHaccpBakeryTemplate(templateId).label;
}

/** נושאי תכניות קדם מהמדריך */
export const HACCP_PRP_TOPICS = [
  { id: 'suppliers', label: 'בקרת ספקים' },
  { id: 'raw_materials', label: 'בקרת חומרי גלם' },
  { id: 'traceability', label: 'שמירת עקיבות' },
  { id: 'allergens', label: 'ניהול אלרגנים' },
  { id: 'shelf_life', label: 'קביעת חיי מדף' },
  { id: 'packaging', label: 'בקרת חומרי אריזה' },
  { id: 'env_temp', label: 'בקרת טמפרטורה של סביבת העבודה והאחסון' },
  { id: 'hygiene', label: 'היגיינת עובדים' },
  { id: 'cleaning', label: 'בקרת ניקיון וחיטוי מבנה וציוד' },
  { id: 'maintenance', label: 'תחזוקת ציוד ותשתיות' },
  { id: 'calibration', label: 'כיול, אימות ובדיקת ציוד מדידה' },
  { id: 'water_air', label: 'בקרת מים ואוויר' },
  { id: 'pest', label: 'בקרת מזיקים ואטימות מבנה' },
  { id: 'waste', label: 'ניהול פסולת' },
];

export const HACCP_PRP_STATUSES = [
  { id: 'not_started', label: 'טרם הוגדר' },
  { id: 'in_progress', label: 'בתהליך' },
  { id: 'implemented', label: 'מיושם' },
  { id: 'needs_review', label: 'דורש עדכון' },
];

export function haccpPrpTopicLabel(id) {
  return HACCP_PRP_TOPICS.find((t) => t.id === id)?.label || id || '—';
}

export function haccpPrpStatusLabel(id) {
  return HACCP_PRP_STATUSES.find((s) => s.id === id)?.label || id || '—';
}

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
    const id = await db.haccpTeamMembers.add({
      name: cleanName,
      role: sanitizeRole(role),
      isLeader: leader,
      authorityNotes: String(authorityNotes || '').trim().slice(0, 500),
      active: active !== false,
      sortOrder,
    });
    logAuditEvent({
      entityTable: 'haccpTeamMembers',
      entityId: id,
      action: 'create',
      snapshot: { name: cleanName, role: sanitizeRole(role), isLeader: leader },
    });
    return id;
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
    await db.haccpTeamMembers.update(mid, next);
    logAuditEvent({
      entityTable: 'haccpTeamMembers',
      entityId: mid,
      action: 'update',
      snapshot: { ...row, ...next },
    });
  });
}

export async function deleteHaccpTeamMember(id) {
  const mid = sanitizeProductId(id);
  if (!mid) return;
  await db.haccpTeamMembers.delete(mid);
  logAuditEvent({ entityTable: 'haccpTeamMembers', entityId: mid, action: 'delete' });
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
  logAuditEvent({
    entityTable: 'haccpPlans',
    entityId: id,
    action: 'create',
    snapshot: { name: planName, categoryGroupId: gid, status: 'draft' },
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
  await db.haccpPlans.update(pid, next);
  logAuditEvent({
    entityTable: 'haccpPlans',
    entityId: pid,
    action: 'update',
    snapshot: { ...row, ...next },
  });
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
    db.haccpCcps,
    db.haccpCriticalLimits,
    db.haccpMonitoring,
    db.haccpCorrectiveActions,
    db.haccpVerificationProcs,
    db.haccpDocuments,
    db.haccpPrpControls,
    db.haccpMonitoringLogs,
    async () => {
      const descs = await db.haccpProductDescriptions.where('planId').equals(pid).toArray();
      for (const d of descs) await db.haccpProductDescriptions.delete(d.id);
      const uses = await db.haccpIntendedUses.where('planId').equals(pid).toArray();
      for (const u of uses) await db.haccpIntendedUses.delete(u.id);
      const logs = await db.haccpMonitoringLogs.where('planId').equals(pid).toArray();
      for (const l of logs) await db.haccpMonitoringLogs.delete(l.id);
      const prps = await db.haccpPrpControls.where('planId').equals(pid).toArray();
      for (const p of prps) await db.haccpPrpControls.delete(p.id);
      const docs = await db.haccpDocuments.where('planId').equals(pid).toArray();
      for (const d of docs) await db.haccpDocuments.delete(d.id);
      const verProcs = await db.haccpVerificationProcs.where('planId').equals(pid).toArray();
      for (const v of verProcs) await db.haccpVerificationProcs.delete(v.id);
      const corrective = await db.haccpCorrectiveActions.where('planId').equals(pid).toArray();
      for (const a of corrective) await db.haccpCorrectiveActions.delete(a.id);
      const monitoring = await db.haccpMonitoring.where('planId').equals(pid).toArray();
      for (const m of monitoring) await db.haccpMonitoring.delete(m.id);
      const limits = await db.haccpCriticalLimits.where('planId').equals(pid).toArray();
      for (const l of limits) await db.haccpCriticalLimits.delete(l.id);
      const ccps = await db.haccpCcps.where('planId').equals(pid).toArray();
      for (const c of ccps) await db.haccpCcps.delete(c.id);
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
  logAuditEvent({ entityTable: 'haccpPlans', entityId: pid, action: 'delete' });
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
    logAuditEvent({
      entityTable: 'haccpProductDescriptions',
      entityId: existing.id,
      action: 'update',
      snapshot: { planId: pid, composition: next.composition },
    });
    return existing.id;
  }
  const id = await db.haccpProductDescriptions.add(next);
  await db.haccpPlans.update(pid, { currentStep: 'product', status: 'in_progress' });
  logAuditEvent({
    entityTable: 'haccpProductDescriptions',
    entityId: id,
    action: 'create',
    snapshot: { planId: pid, composition: next.composition },
  });
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
    logAuditEvent({
      entityTable: 'haccpIntendedUses',
      entityId: existing.id,
      action: 'update',
      snapshot: { planId: pid, targetAudience: next.targetAudience },
    });
    return existing.id;
  }
  const id = await db.haccpIntendedUses.add(next);
  await db.haccpPlans.update(pid, { currentStep: 'intended_use', status: 'in_progress' });
  logAuditEvent({
    entityTable: 'haccpIntendedUses',
    entityId: id,
    action: 'create',
    snapshot: { planId: pid, targetAudience: next.targetAudience },
  });
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
  logAuditEvent({
    entityTable: 'haccpFlowSteps',
    entityId: id,
    action: 'create',
    snapshot: { planId: pid, name: cleanName, stepKind: sanitizeFlowStepKind(stepKind) },
  });
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
  logAuditEvent({
    entityTable: 'haccpFlowSteps',
    entityId: sid,
    action: 'update',
    snapshot: { ...row, ...next },
  });
}

export async function deleteHaccpFlowStep(id) {
  const sid = sanitizeProductId(id);
  if (!sid) return;
  await db.transaction(
    'rw',
    db.haccpFlowSteps,
    db.haccpHazards,
    db.haccpCcps,
    db.haccpCriticalLimits,
    db.haccpMonitoring,
    db.haccpCorrectiveActions,
    db.haccpVerificationProcs,
    db.haccpMonitoringLogs,
    async () => {
      const hazards = await db.haccpHazards.where('flowStepId').equals(sid).toArray();
      for (const h of hazards) {
        const linked = await db.haccpCcps.where('hazardId').equals(h.id).toArray();
        for (const c of linked) {
          await deleteCcpChildren(c.id);
          await db.haccpCcps.delete(c.id);
        }
        await db.haccpHazards.delete(h.id);
      }
      const stepCcps = await db.haccpCcps.where('flowStepId').equals(sid).toArray();
      for (const c of stepCcps) {
        await deleteCcpChildren(c.id);
        await db.haccpCcps.delete(c.id);
      }
      await db.haccpFlowSteps.delete(sid);
    },
  );
  logAuditEvent({ entityTable: 'haccpFlowSteps', entityId: sid, action: 'delete' });
}

async function deleteCcpChildren(ccpId) {
  const cid = sanitizeProductId(ccpId);
  if (!cid) return;
  const logs = await db.haccpMonitoringLogs.where('ccpId').equals(cid).toArray();
  for (const l of logs) await db.haccpMonitoringLogs.delete(l.id);
  const limits = await db.haccpCriticalLimits.where('ccpId').equals(cid).toArray();
  for (const l of limits) await db.haccpCriticalLimits.delete(l.id);
  const monitoring = await db.haccpMonitoring.where('ccpId').equals(cid).toArray();
  for (const m of monitoring) await db.haccpMonitoring.delete(m.id);
  const corrective = await db.haccpCorrectiveActions.where('ccpId').equals(cid).toArray();
  for (const a of corrective) await db.haccpCorrectiveActions.delete(a.id);
  const verProcs = await db.haccpVerificationProcs.where('ccpId').equals(cid).toArray();
  for (const v of verProcs) await db.haccpVerificationProcs.delete(v.id);
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
  logAuditEvent({
    entityTable: 'haccpFlowVerifications',
    entityId: id,
    action: 'create',
    snapshot: { planId: pid, verifiedAt, matchResult: sanitizeMatchResult(fields.matchResult) },
  });
  return id;
}

export async function deleteHaccpFlowVerification(id) {
  const vid = sanitizeProductId(id);
  if (!vid) return;
  await db.haccpFlowVerifications.delete(vid);
  logAuditEvent({ entityTable: 'haccpFlowVerifications', entityId: vid, action: 'delete' });
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
  logAuditEvent({
    entityTable: 'haccpHazards',
    entityId: id,
    action: 'create',
    snapshot: { planId: pid, description: cleanDesc, hazardType: sanitizeHazardType(hazardType) },
  });
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
  logAuditEvent({
    entityTable: 'haccpHazards',
    entityId: hid,
    action: 'update',
    snapshot: { ...row, ...next },
  });
}

export async function deleteHaccpHazard(id) {
  const hid = sanitizeProductId(id);
  if (!hid) return;
  await db.transaction('rw', db.haccpHazards, db.haccpCcps, async () => {
    const linked = await db.haccpCcps.where('hazardId').equals(hid).toArray();
    for (const c of linked) await db.haccpCcps.update(c.id, { hazardId: null });
    await db.haccpHazards.delete(hid);
  });
  logAuditEvent({ entityTable: 'haccpHazards', entityId: hid, action: 'delete' });
}

/** שאלות עץ החלטות CCP — Codex 2023 */
export const HACCP_CCP_TREE_QUESTIONS = [
  {
    id: 'q1',
    label: 'האם ניתן לבקר את הסיכון המשמעותי בשלב זה באמצעות תכניות קדם (PRP / GHP)?',
  },
  {
    id: 'q2',
    label: 'האם קיימים אמצעי בקרה ספציפיים לסיכון המשמעותי בשלב זה?',
  },
  {
    id: 'q3',
    label: 'האם שלב מאוחר יותר ימנע / יסלק / יפחית את הסיכון לרמה מקובלת?',
  },
  {
    id: 'q4',
    label: 'האם השלב עצמו יכול למנוע / לסלק / להפחית את הסיכון לרמה מקובלת?',
  },
];

export const HACCP_CCP_DECISIONS = [
  { id: 'ccp', label: 'CCP — נקודת בקרה קריטית' },
  { id: 'prp', label: 'מבוקר ע״י PRP (לא CCP)' },
  { id: 'later_step', label: 'יבוקר בשלב מאוחר יותר' },
  { id: 'modify_process', label: 'נדרש שינוי תהליך / אמצעי בקרה' },
  { id: 'incomplete', label: 'עץ החלטות לא הושלם' },
];

export function haccpCcpDecisionLabel(id) {
  return HACCP_CCP_DECISIONS.find((d) => d.id === id)?.label || id || '—';
}

function sanitizeYesNo(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'yes' || v === 'no') return v;
  return '';
}

/** הערכת תוצאת עץ Codex 2023 */
export function evaluateCcpDecisionTree({ q1, q2, q3, q4 } = {}) {
  const a1 = sanitizeYesNo(q1);
  const a2 = sanitizeYesNo(q2);
  const a3 = sanitizeYesNo(q3);
  const a4 = sanitizeYesNo(q4);
  if (a1 === 'yes') return 'prp';
  if (!a1) return 'incomplete';
  if (a2 === 'no') return 'modify_process';
  if (!a2) return 'incomplete';
  if (a3 === 'yes') return 'later_step';
  if (!a3) return 'incomplete';
  if (a4 === 'yes') return 'ccp';
  if (a4 === 'no') return 'modify_process';
  return 'incomplete';
}

async function markPlanCcpInProgress(plan) {
  if (!plan?.id) return;
  const early = ['team', 'product', 'intended_use', 'flow', 'flow_verify', 'hazard', 'overview'];
  if (early.includes(plan.currentStep) || plan.status === 'draft') {
    await db.haccpPlans.update(plan.id, { currentStep: 'ccp', status: 'in_progress' });
  }
}

async function nextCcpCode(planId) {
  const rows = await db.haccpCcps.where('planId').equals(planId).toArray();
  const confirmed = rows.filter((r) => r.decision === 'ccp');
  return `CCP-${confirmed.length + 1}`;
}

export async function getHaccpCcps(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const rows = await db.haccpCcps.where('planId').equals(pid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function getHaccpCcpCandidates(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const [hazards, ccps] = await Promise.all([getHaccpHazards(pid), getHaccpCcps(pid)]);
  const linkedHazardIds = new Set(
    ccps.map((c) => Number(c.hazardId)).filter((id) => Number.isFinite(id) && id > 0),
  );
  return hazards.filter((h) =>
    (h.significant || h.isCcpCandidate) && !linkedHazardIds.has(Number(h.id)));
}

export async function addHaccpCcp(planId, fields = {}) {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');

  const sid = sanitizeProductId(fields.flowStepId);
  if (!sid) throw new ValidationError('בחר שלב בתרשים');
  const step = await db.haccpFlowSteps.get(sid);
  if (!step || Number(step.planId) !== Number(pid)) {
    throw new ValidationError('שלב התרשים לא שייך לתכנית');
  }

  let hazardId = sanitizeProductId(fields.hazardId) || null;
  if (hazardId) {
    const hazard = await db.haccpHazards.get(hazardId);
    if (!hazard || Number(hazard.planId) !== Number(pid)) {
      throw new ValidationError('גורם סיכון לא שייך לתכנית');
    }
  }

  const q1 = sanitizeYesNo(fields.q1);
  const q2 = sanitizeYesNo(fields.q2);
  const q3 = sanitizeYesNo(fields.q3);
  const q4 = sanitizeYesNo(fields.q4);
  const decision = fields.decision
    ? (HACCP_CCP_DECISIONS.some((d) => d.id === fields.decision) ? fields.decision : evaluateCcpDecisionTree({ q1, q2, q3, q4 }))
    : evaluateCcpDecisionTree({ q1, q2, q3, q4 });
  if (decision === 'incomplete') {
    throw new ValidationError('השלם את כל שאלות עץ ההחלטות');
  }

  const hazardDescription = sanitizeTextField(fields.hazardDescription, 1000);
  if (!hazardDescription) throw new ValidationError('תאר את הסיכון שעבורו נקבעת ההחלטה');

  const existing = await getHaccpCcps(pid);
  const sortOrder = existing.length
    ? Math.max(...existing.map((c) => c.sortOrder ?? 0)) + 1
    : 1;

  const code = decision === 'ccp'
    ? (sanitizeTextField(fields.code, 40) || await nextCcpCode(pid))
    : sanitizeTextField(fields.code, 40);

  const ccpRow = {
    planId: pid,
    flowStepId: sid,
    hazardId,
    code,
    name: sanitizeName(fields.name || step.name, 120) || step.name,
    hazardType: sanitizeHazardType(fields.hazardType || 'biological'),
    hazardDescription,
    q1,
    q2,
    q3,
    q4,
    decision,
    controlMeasure: sanitizeTextField(fields.controlMeasure, 2000),
    justification: sanitizeTextField(fields.justification, 2000),
    notes: sanitizeTextField(fields.notes, 2000),
    sortOrder,
  };
  const id = await db.haccpCcps.add(ccpRow);
  await markPlanCcpInProgress(plan);
  logAuditEvent({ entityTable: 'haccpCcps', entityId: id, action: 'create', snapshot: ccpRow });
  return id;
}

export async function updateHaccpCcp(id, patch = {}) {
  const cid = sanitizeProductId(id);
  if (!cid) return;
  const row = await db.haccpCcps.get(cid);
  if (!row) throw new ValidationError('רשומת CCP לא נמצאה');
  const next = {};

  if (patch.flowStepId !== undefined) {
    const sid = sanitizeProductId(patch.flowStepId);
    if (!sid) throw new ValidationError('שלב לא תקין');
    const step = await db.haccpFlowSteps.get(sid);
    if (!step || Number(step.planId) !== Number(row.planId)) {
      throw new ValidationError('שלב התרשים לא שייך לתכנית');
    }
    next.flowStepId = sid;
  }
  if (patch.hazardId !== undefined) {
    const hid = sanitizeProductId(patch.hazardId);
    if (hid) {
      const hazard = await db.haccpHazards.get(hid);
      if (!hazard || Number(hazard.planId) !== Number(row.planId)) {
        throw new ValidationError('גורם סיכון לא שייך לתכנית');
      }
      next.hazardId = hid;
    } else {
      next.hazardId = null;
    }
  }
  if (patch.name !== undefined) {
    const clean = sanitizeName(patch.name, 120);
    if (!clean) throw new ValidationError('הזן שם');
    next.name = clean;
  }
  if (patch.code !== undefined) next.code = sanitizeTextField(patch.code, 40);
  if (patch.hazardType !== undefined) next.hazardType = sanitizeHazardType(patch.hazardType);
  if (patch.hazardDescription !== undefined) {
    const desc = sanitizeTextField(patch.hazardDescription, 1000);
    if (!desc) throw new ValidationError('תאר את הסיכון');
    next.hazardDescription = desc;
  }
  if (patch.q1 !== undefined) next.q1 = sanitizeYesNo(patch.q1);
  if (patch.q2 !== undefined) next.q2 = sanitizeYesNo(patch.q2);
  if (patch.q3 !== undefined) next.q3 = sanitizeYesNo(patch.q3);
  if (patch.q4 !== undefined) next.q4 = sanitizeYesNo(patch.q4);
  if (patch.controlMeasure !== undefined) next.controlMeasure = sanitizeTextField(patch.controlMeasure, 2000);
  if (patch.justification !== undefined) next.justification = sanitizeTextField(patch.justification, 2000);
  if (patch.notes !== undefined) next.notes = sanitizeTextField(patch.notes, 2000);

  const q1 = next.q1 !== undefined ? next.q1 : row.q1;
  const q2 = next.q2 !== undefined ? next.q2 : row.q2;
  const q3 = next.q3 !== undefined ? next.q3 : row.q3;
  const q4 = next.q4 !== undefined ? next.q4 : row.q4;
  if (patch.decision !== undefined) {
    next.decision = HACCP_CCP_DECISIONS.some((d) => d.id === patch.decision)
      ? patch.decision
      : evaluateCcpDecisionTree({ q1, q2, q3, q4 });
  } else if (patch.q1 !== undefined || patch.q2 !== undefined || patch.q3 !== undefined || patch.q4 !== undefined) {
    next.decision = evaluateCcpDecisionTree({ q1, q2, q3, q4 });
  }

  if (next.decision === 'ccp' && !(next.code || row.code)) {
    next.code = await nextCcpCode(row.planId);
  }

  if (!Object.keys(next).length) return;
  await db.haccpCcps.update(cid, next);
  logAuditEvent({ entityTable: 'haccpCcps', entityId: cid, action: 'update', snapshot: next });
}

export async function deleteHaccpCcp(id) {
  const cid = sanitizeProductId(id);
  if (!cid) return;
  await db.transaction(
    'rw',
    db.haccpCcps,
    db.haccpCriticalLimits,
    db.haccpMonitoring,
    db.haccpCorrectiveActions,
    db.haccpVerificationProcs,
    db.haccpMonitoringLogs,
    async () => {
      await deleteCcpChildren(cid);
      await db.haccpCcps.delete(cid);
    },
  );
  logAuditEvent({ entityTable: 'haccpCcps', entityId: cid, action: 'delete' });
}

/** יצירת קביעת CCP ממועמד מניתוח הסיכונים */
export async function addHaccpCcpFromHazard(planId, hazardId, treeAnswers = {}) {
  const hid = sanitizeProductId(hazardId);
  if (!hid) throw new ValidationError('בחר גורם סיכון');
  const hazard = await db.haccpHazards.get(hid);
  if (!hazard) throw new ValidationError('גורם סיכון לא נמצא');
  const step = await db.haccpFlowSteps.get(hazard.flowStepId);
  return addHaccpCcp(planId, {
    flowStepId: hazard.flowStepId,
    hazardId: hid,
    name: step?.name || 'CCP',
    hazardType: hazard.hazardType,
    hazardDescription: hazard.description,
    controlMeasure: hazard.controlMeasures || '',
    justification: hazard.justification || '',
    ...treeAnswers,
  });
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

/** פרמטרים נפוצים לגבול קריטי במאפייה */
export const HACCP_LIMIT_PARAMETERS = [
  { id: 'core_temp', label: 'טמפרטורת ליבה', unitHint: '°C' },
  { id: 'oven_temp', label: 'טמפרטורת תנור', unitHint: '°C' },
  { id: 'time', label: 'זמן', unitHint: 'דק׳' },
  { id: 'cooling_temp', label: 'טמפרטורת קירור', unitHint: '°C' },
  { id: 'cooling_time', label: 'זמן קירור', unitHint: 'שעות' },
  { id: 'storage_temp', label: 'טמפרטורת אחסון', unitHint: '°C' },
  { id: 'ph', label: 'ערך הגבה (pH)', unitHint: '' },
  { id: 'aw', label: 'פעילות מים (aw)', unitHint: '' },
  { id: 'visual', label: 'בדיקה ויזואלית', unitHint: '' },
  { id: 'other', label: 'אחר', unitHint: '' },
];

export const HACCP_LIMIT_OPERATORS = [
  { id: 'gte', label: '≥ לפחות' },
  { id: 'lte', label: '≤ לכל היותר' },
  { id: 'eq', label: '= בדיוק' },
  { id: 'between', label: 'בין (כולל)' },
  { id: 'text', label: 'תיאור חופשי' },
];

export function haccpLimitParameterLabel(id) {
  return HACCP_LIMIT_PARAMETERS.find((p) => p.id === id)?.label || id || '—';
}

export function haccpLimitOperatorLabel(id) {
  return HACCP_LIMIT_OPERATORS.find((o) => o.id === id)?.label || id || '—';
}

function sanitizeLimitParameter(raw) {
  const id = String(raw || '').trim();
  return HACCP_LIMIT_PARAMETERS.some((p) => p.id === id) ? id : 'other';
}

function sanitizeLimitOperator(raw) {
  const id = String(raw || '').trim();
  return HACCP_LIMIT_OPERATORS.some((o) => o.id === id) ? id : 'gte';
}

export function formatCriticalLimit(limit) {
  if (!limit) return '—';
  const param = haccpLimitParameterLabel(limit.parameter);
  if (limit.operator === 'text' || (!limit.value && limit.valueText)) {
    return `${param}: ${limit.valueText || limit.limitStatement || '—'}`;
  }
  const unit = limit.unit ? ` ${limit.unit}` : '';
  if (limit.operator === 'between') {
    return `${param}: ${limit.value ?? '—'}–${limit.valueMax ?? '—'}${unit}`;
  }
  const op = { gte: '≥', lte: '≤', eq: '=' }[limit.operator] || limit.operator;
  return `${param}: ${op} ${limit.value ?? '—'}${unit}`;
}

async function markPlanLimitsInProgress(plan) {
  if (!plan?.id) return;
  const early = ['team', 'product', 'intended_use', 'flow', 'flow_verify', 'hazard', 'ccp', 'overview'];
  if (early.includes(plan.currentStep) || plan.status === 'draft') {
    await db.haccpPlans.update(plan.id, { currentStep: 'limits', status: 'in_progress' });
  }
}

export async function getConfirmedHaccpCcps(planId) {
  const rows = await getHaccpCcps(planId);
  return rows.filter((r) => r.decision === 'ccp');
}

export async function getHaccpCriticalLimits(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const rows = await db.haccpCriticalLimits.where('planId').equals(pid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function getHaccpCriticalLimitsForCcp(ccpId) {
  const cid = sanitizeProductId(ccpId);
  if (!cid) return [];
  const rows = await db.haccpCriticalLimits.where('ccpId').equals(cid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function addHaccpCriticalLimit(planId, {
  ccpId,
  parameter = 'core_temp',
  operator = 'gte',
  value = '',
  valueMax = '',
  unit = '',
  valueText = '',
  justification = '',
  notes = '',
} = {}) {
  const pid = sanitizeProductId(planId);
  const cid = sanitizeProductId(ccpId);
  if (!pid) throw new ValidationError('בחר תכנית');
  if (!cid) throw new ValidationError('בחר CCP');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');
  const ccp = await db.haccpCcps.get(cid);
  if (!ccp || Number(ccp.planId) !== Number(pid) || ccp.decision !== 'ccp') {
    throw new ValidationError('CCP מאושר לא נמצא בתכנית');
  }

  const op = sanitizeLimitOperator(operator);
  const param = sanitizeLimitParameter(parameter);
  const cleanValue = sanitizeTextField(value, 40);
  const cleanMax = sanitizeTextField(valueMax, 40);
  const cleanText = sanitizeTextField(valueText, 500);
  const cleanUnit = sanitizeTextField(unit, 40);

  if (op === 'text') {
    if (!cleanText) throw new ValidationError('הזן תיאור הגבול הקריטי');
  } else if (op === 'between') {
    if (!cleanValue || !cleanMax) throw new ValidationError('הזן ערך מינימום ומקסימום');
  } else if (!cleanValue) {
    throw new ValidationError('הזן ערך לגבול הקריטי');
  }

  const row = {
    planId: pid,
    ccpId: cid,
    parameter: param,
    operator: op,
    value: op === 'text' ? '' : cleanValue,
    valueMax: op === 'between' ? cleanMax : '',
    unit: op === 'text' ? '' : cleanUnit,
    valueText: op === 'text' ? cleanText : '',
    justification: sanitizeTextField(justification, 2000),
    notes: sanitizeTextField(notes, 2000),
  };
  row.limitStatement = formatCriticalLimit(row);

  const existing = await getHaccpCriticalLimits(pid);
  const sortOrder = existing.length
    ? Math.max(...existing.map((l) => l.sortOrder ?? 0)) + 1
    : 1;

  const limitRow = { ...row, sortOrder };
  const id = await db.haccpCriticalLimits.add(limitRow);
  await markPlanLimitsInProgress(plan);
  logAuditEvent({ entityTable: 'haccpCriticalLimits', entityId: id, action: 'create', snapshot: limitRow });
  return id;
}

export async function updateHaccpCriticalLimit(id, patch = {}) {
  const lid = sanitizeProductId(id);
  if (!lid) return;
  const row = await db.haccpCriticalLimits.get(lid);
  if (!row) throw new ValidationError('גבול קריטי לא נמצא');
  const next = { ...row };

  if (patch.ccpId !== undefined) {
    const cid = sanitizeProductId(patch.ccpId);
    if (!cid) throw new ValidationError('CCP לא תקין');
    const ccp = await db.haccpCcps.get(cid);
    if (!ccp || Number(ccp.planId) !== Number(row.planId) || ccp.decision !== 'ccp') {
      throw new ValidationError('CCP מאושר לא נמצא');
    }
    next.ccpId = cid;
  }
  if (patch.parameter !== undefined) next.parameter = sanitizeLimitParameter(patch.parameter);
  if (patch.operator !== undefined) next.operator = sanitizeLimitOperator(patch.operator);
  if (patch.value !== undefined) next.value = sanitizeTextField(patch.value, 40);
  if (patch.valueMax !== undefined) next.valueMax = sanitizeTextField(patch.valueMax, 40);
  if (patch.unit !== undefined) next.unit = sanitizeTextField(patch.unit, 40);
  if (patch.valueText !== undefined) next.valueText = sanitizeTextField(patch.valueText, 500);
  if (patch.justification !== undefined) next.justification = sanitizeTextField(patch.justification, 2000);
  if (patch.notes !== undefined) next.notes = sanitizeTextField(patch.notes, 2000);

  if (next.operator === 'text') {
    if (!next.valueText) throw new ValidationError('הזן תיאור הגבול הקריטי');
    next.value = '';
    next.valueMax = '';
    next.unit = '';
  } else if (next.operator === 'between') {
    if (!next.value || !next.valueMax) throw new ValidationError('הזן ערך מינימום ומקסימום');
    next.valueText = '';
  } else {
    if (!next.value) throw new ValidationError('הזן ערך לגבול הקריטי');
    next.valueMax = '';
    next.valueText = '';
  }

  next.limitStatement = formatCriticalLimit(next);
  delete next.id;
  await db.haccpCriticalLimits.update(lid, next);
  logAuditEvent({ entityTable: 'haccpCriticalLimits', entityId: lid, action: 'update', snapshot: next });
}

export async function deleteHaccpCriticalLimit(id) {
  const lid = sanitizeProductId(id);
  if (!lid) return;
  await db.transaction(
    'rw',
    db.haccpCriticalLimits,
    db.haccpMonitoring,
    db.haccpCorrectiveActions,
    db.haccpMonitoringLogs,
    async () => {
      const linkedMon = await db.haccpMonitoring.where('limitId').equals(lid).toArray();
      for (const m of linkedMon) await db.haccpMonitoring.update(m.id, { limitId: null });
      const linkedCorr = await db.haccpCorrectiveActions.where('limitId').equals(lid).toArray();
      for (const a of linkedCorr) await db.haccpCorrectiveActions.update(a.id, { limitId: null });
      const linkedLogs = await db.haccpMonitoringLogs.where('limitId').equals(lid).toArray();
      for (const l of linkedLogs) await db.haccpMonitoringLogs.update(l.id, { limitId: null });
      await db.haccpCriticalLimits.delete(lid);
    },
  );
  logAuditEvent({ entityTable: 'haccpCriticalLimits', entityId: lid, action: 'delete' });
}

/** הצעות גבולות נפוצות לפי סוג שלב של ה-CCP */
export async function seedSuggestedLimitsForCcp(planId, ccpId) {
  const pid = sanitizeProductId(planId);
  const cid = sanitizeProductId(ccpId);
  if (!pid || !cid) throw new ValidationError('בחר תכנית ו-CCP');
  const ccp = await db.haccpCcps.get(cid);
  if (!ccp || Number(ccp.planId) !== Number(pid) || ccp.decision !== 'ccp') {
    throw new ValidationError('CCP מאושר לא נמצא');
  }
  const step = await db.haccpFlowSteps.get(ccp.flowStepId);
  const kind = step?.stepKind || 'other';
  const suggestionsByKind = {
    baking: [
      { parameter: 'core_temp', operator: 'gte', value: '75', unit: '°C', justification: 'השמדת פתוגנים בליבה' },
      { parameter: 'time', operator: 'gte', value: '20', unit: 'דק׳', justification: 'זמן אפייה מינימלי לפי מוצר' },
    ],
    cooling: [
      { parameter: 'cooling_temp', operator: 'lte', value: '5', unit: '°C', justification: 'יציאה מטווח הסכנה' },
      { parameter: 'cooling_time', operator: 'lte', value: '4', unit: 'שעות', justification: 'קירור מהיר מספיק' },
    ],
    freezing: [
      { parameter: 'storage_temp', operator: 'lte', value: '-18', unit: '°C', justification: 'שמירה בהקפאה' },
    ],
    storage_finished: [
      { parameter: 'storage_temp', operator: 'lte', value: '5', unit: '°C', justification: 'אחסון בקירור' },
    ],
    packaging: [
      { parameter: 'visual', operator: 'text', valueText: 'אריזה שלמה, סימון אלרגנים ותוקף תקינים', justification: 'בקרה ויזואלית באריזה' },
    ],
  };
  const suggestions = suggestionsByKind[kind] || [
    { parameter: 'other', operator: 'text', valueText: 'הגדר גבול מדיד לנקודת הבקרה', justification: '' },
  ];

  const existing = await getHaccpCriticalLimitsForCcp(cid);
  const existingKeys = new Set(existing.map((l) => `${l.parameter}|${l.operator}|${l.value}|${l.valueText}`));
  let added = 0;
  for (const s of suggestions) {
    const key = `${s.parameter}|${s.operator}|${s.value || ''}|${s.valueText || ''}`;
    if (existingKeys.has(key)) continue;
    await addHaccpCriticalLimit(pid, { ccpId: cid, ...s });
    added += 1;
  }
  if (!added) throw new ValidationError('כל ההצעות ל-CCP זה כבר קיימות');
  return added;
}

/** שיטות ניטור נפוצות */
export const HACCP_MONITOR_METHODS = [
  { id: 'thermometer', label: 'מדידת טמפרטורה (מדחום / גשוש)' },
  { id: 'timer', label: 'מדידת זמן' },
  { id: 'visual', label: 'בדיקה ויזואלית' },
  { id: 'continuous', label: 'רישום רציף / לוגר' },
  { id: 'ph_meter', label: 'מד pH' },
  { id: 'scale', label: 'שקילה' },
  { id: 'checklist', label: 'צ׳קליסט מובנה' },
  { id: 'other', label: 'אחר' },
];

export const HACCP_MONITOR_FREQUENCIES = [
  { id: 'continuous', label: 'רציף' },
  { id: 'every_batch', label: 'כל אצווה / כל ייצור' },
  { id: 'start_mid_end', label: 'תחילת / אמצע / סוף תהליך' },
  { id: 'hourly', label: 'כל שעה' },
  { id: 'each_shift', label: 'כל משמרת' },
  { id: 'daily', label: 'יומי' },
  { id: 'other', label: 'אחר' },
];

export function haccpMonitorMethodLabel(id) {
  return HACCP_MONITOR_METHODS.find((m) => m.id === id)?.label || id || '—';
}

export function haccpMonitorFrequencyLabel(id) {
  return HACCP_MONITOR_FREQUENCIES.find((f) => f.id === id)?.label || id || '—';
}

function sanitizeMonitorMethod(raw) {
  const id = String(raw || '').trim();
  return HACCP_MONITOR_METHODS.some((m) => m.id === id) ? id : 'other';
}

function sanitizeMonitorFrequency(raw) {
  const id = String(raw || '').trim();
  return HACCP_MONITOR_FREQUENCIES.some((f) => f.id === id) ? id : 'every_batch';
}

async function markPlanMonitoringInProgress(plan) {
  if (!plan?.id) return;
  const early = ['team', 'product', 'intended_use', 'flow', 'flow_verify', 'hazard', 'ccp', 'limits', 'overview'];
  if (early.includes(plan.currentStep) || plan.status === 'draft') {
    await db.haccpPlans.update(plan.id, { currentStep: 'monitoring', status: 'in_progress' });
  }
}

export async function getHaccpMonitoring(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const rows = await db.haccpMonitoring.where('planId').equals(pid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function getHaccpMonitoringForCcp(ccpId) {
  const cid = sanitizeProductId(ccpId);
  if (!cid) return [];
  const rows = await db.haccpMonitoring.where('ccpId').equals(cid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function addHaccpMonitoring(planId, {
  ccpId,
  limitId = null,
  what = '',
  method = 'thermometer',
  methodDetails = '',
  frequency = 'every_batch',
  frequencyDetails = '',
  responsibleRole = 'production',
  responsibleText = '',
  records = '',
  notes = '',
} = {}) {
  const pid = sanitizeProductId(planId);
  const cid = sanitizeProductId(ccpId);
  if (!pid) throw new ValidationError('בחר תכנית');
  if (!cid) throw new ValidationError('בחר CCP');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');
  const ccp = await db.haccpCcps.get(cid);
  if (!ccp || Number(ccp.planId) !== Number(pid) || ccp.decision !== 'ccp') {
    throw new ValidationError('CCP מאושר לא נמצא בתכנית');
  }

  let lid = sanitizeProductId(limitId) || null;
  if (lid) {
    const limit = await db.haccpCriticalLimits.get(lid);
    if (!limit || Number(limit.planId) !== Number(pid) || Number(limit.ccpId) !== Number(cid)) {
      throw new ValidationError('גבול קריטי לא שייך ל-CCP');
    }
  }

  const cleanWhat = sanitizeTextField(what, 1000);
  if (!cleanWhat) throw new ValidationError('הגדר מה מנטרים');

  const existing = await getHaccpMonitoring(pid);
  const sortOrder = existing.length
    ? Math.max(...existing.map((m) => m.sortOrder ?? 0)) + 1
    : 1;

  const id = await db.haccpMonitoring.add({
    planId: pid,
    ccpId: cid,
    limitId: lid,
    what: cleanWhat,
    method: sanitizeMonitorMethod(method),
    methodDetails: sanitizeTextField(methodDetails, 1000),
    frequency: sanitizeMonitorFrequency(frequency),
    frequencyDetails: sanitizeTextField(frequencyDetails, 500),
    responsibleRole: sanitizeRole(responsibleRole),
    responsibleText: sanitizeTextField(responsibleText, 200),
    records: sanitizeTextField(records, 1000),
    notes: sanitizeTextField(notes, 2000),
    sortOrder,
  });
  await markPlanMonitoringInProgress(plan);
  logAuditEvent({
    entityTable: 'haccpMonitoring',
    entityId: id,
    action: 'create',
    snapshot: { planId: pid, ccpId, what: sanitizeTextField(what, 500) },
  });
  return id;
}

export async function updateHaccpMonitoring(id, patch = {}) {
  const mid = sanitizeProductId(id);
  if (!mid) return;
  const row = await db.haccpMonitoring.get(mid);
  if (!row) throw new ValidationError('נוהל ניטור לא נמצא');
  const next = {};

  if (patch.ccpId !== undefined) {
    const cid = sanitizeProductId(patch.ccpId);
    if (!cid) throw new ValidationError('CCP לא תקין');
    const ccp = await db.haccpCcps.get(cid);
    if (!ccp || Number(ccp.planId) !== Number(row.planId) || ccp.decision !== 'ccp') {
      throw new ValidationError('CCP מאושר לא נמצא');
    }
    next.ccpId = cid;
  }
  if (patch.limitId !== undefined) {
    const lid = sanitizeProductId(patch.limitId);
    if (lid) {
      const limit = await db.haccpCriticalLimits.get(lid);
      const ccpId = next.ccpId || row.ccpId;
      if (!limit || Number(limit.planId) !== Number(row.planId) || Number(limit.ccpId) !== Number(ccpId)) {
        throw new ValidationError('גבול קריטי לא שייך ל-CCP');
      }
      next.limitId = lid;
    } else {
      next.limitId = null;
    }
  }
  if (patch.what !== undefined) {
    const cleanWhat = sanitizeTextField(patch.what, 1000);
    if (!cleanWhat) throw new ValidationError('הגדר מה מנטרים');
    next.what = cleanWhat;
  }
  if (patch.method !== undefined) next.method = sanitizeMonitorMethod(patch.method);
  if (patch.methodDetails !== undefined) next.methodDetails = sanitizeTextField(patch.methodDetails, 1000);
  if (patch.frequency !== undefined) next.frequency = sanitizeMonitorFrequency(patch.frequency);
  if (patch.frequencyDetails !== undefined) {
    next.frequencyDetails = sanitizeTextField(patch.frequencyDetails, 500);
  }
  if (patch.responsibleRole !== undefined) next.responsibleRole = sanitizeRole(patch.responsibleRole);
  if (patch.responsibleText !== undefined) next.responsibleText = sanitizeTextField(patch.responsibleText, 200);
  if (patch.records !== undefined) next.records = sanitizeTextField(patch.records, 1000);
  if (patch.notes !== undefined) next.notes = sanitizeTextField(patch.notes, 2000);

  if (!Object.keys(next).length) return;
  await db.haccpMonitoring.update(mid, next);
  logAuditEvent({
    entityTable: 'haccpMonitoring',
    entityId: mid,
    action: 'update',
    snapshot: { ...row, ...next },
  });
}

export async function deleteHaccpMonitoring(id) {
  const mid = sanitizeProductId(id);
  if (!mid) return;
  await db.transaction('rw', db.haccpMonitoring, db.haccpMonitoringLogs, async () => {
    const linked = await db.haccpMonitoringLogs.where('monitoringId').equals(mid).toArray();
    for (const l of linked) await db.haccpMonitoringLogs.update(l.id, { monitoringId: null });
    await db.haccpMonitoring.delete(mid);
  });
  logAuditEvent({ entityTable: 'haccpMonitoring', entityId: mid, action: 'delete' });
}

/** הצעת ניטור בסיסית לפי CCP וגבולותיו */
export async function seedSuggestedMonitoringForCcp(planId, ccpId) {
  const pid = sanitizeProductId(planId);
  const cid = sanitizeProductId(ccpId);
  if (!pid || !cid) throw new ValidationError('בחר תכנית ו-CCP');
  const ccp = await db.haccpCcps.get(cid);
  if (!ccp || Number(ccp.planId) !== Number(pid) || ccp.decision !== 'ccp') {
    throw new ValidationError('CCP מאושר לא נמצא');
  }
  const existing = await getHaccpMonitoringForCcp(cid);
  if (existing.length) throw new ValidationError('כבר קיים נוהל ניטור ל-CCP זה');

  const limits = await getHaccpCriticalLimitsForCcp(cid);
  const step = await db.haccpFlowSteps.get(ccp.flowStepId);
  const kind = step?.stepKind || 'other';

  const methodByParam = {
    core_temp: 'thermometer',
    oven_temp: 'thermometer',
    cooling_temp: 'thermometer',
    storage_temp: 'thermometer',
    time: 'timer',
    cooling_time: 'timer',
    visual: 'visual',
    ph: 'ph_meter',
    aw: 'other',
    other: 'checklist',
  };

  if (limits.length) {
    let added = 0;
    for (const limit of limits) {
      await addHaccpMonitoring(pid, {
        ccpId: cid,
        limitId: limit.id,
        what: formatCriticalLimit(limit),
        method: methodByParam[limit.parameter] || 'other',
        methodDetails: '',
        frequency: kind === 'baking' || kind === 'cooling' ? 'every_batch' : 'each_shift',
        responsibleRole: 'production',
        records: 'טופס ניטור CCP / יומן ייצור',
      });
      added += 1;
    }
    return added;
  }

  await addHaccpMonitoring(pid, {
    ccpId: cid,
    what: ccp.hazardDescription || ccp.name || 'ניטור CCP',
    method: kind === 'baking' || kind === 'cooling' ? 'thermometer' : 'checklist',
    frequency: 'every_batch',
    responsibleRole: 'production',
    records: 'טופס ניטור CCP / יומן ייצור',
  });
  return 1;
}

export const HACCP_PRODUCT_DISPOSITIONS = [
  { id: 'hold_evaluate', label: 'החזקה / הערכה (מעוכב)' },
  { id: 'rework', label: 'עיבוד מחדש / תיקון' },
  { id: 'destroy', label: 'השמדה / פסול' },
  { id: 'release_after_eval', label: 'שחרור לאחר הערכה' },
  { id: 'recall', label: 'החזרה מהשוק / Recall' },
  { id: 'return_supplier', label: 'החזרה לספק' },
  { id: 'other', label: 'אחר' },
];

export function haccpProductDispositionLabel(id) {
  return HACCP_PRODUCT_DISPOSITIONS.find((d) => d.id === id)?.label || id || '—';
}

function sanitizeProductDisposition(raw) {
  const id = String(raw || '').trim();
  return HACCP_PRODUCT_DISPOSITIONS.some((d) => d.id === id) ? id : 'hold_evaluate';
}

async function markPlanCorrectiveInProgress(plan) {
  if (!plan?.id) return;
  const early = [
    'team', 'product', 'intended_use', 'flow', 'flow_verify', 'hazard', 'ccp',
    'limits', 'monitoring', 'overview',
  ];
  if (early.includes(plan.currentStep) || plan.status === 'draft') {
    await db.haccpPlans.update(plan.id, { currentStep: 'corrective', status: 'in_progress' });
  }
}

export async function getHaccpCorrectiveActions(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const rows = await db.haccpCorrectiveActions.where('planId').equals(pid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function getHaccpCorrectiveActionsForCcp(ccpId) {
  const cid = sanitizeProductId(ccpId);
  if (!cid) return [];
  const rows = await db.haccpCorrectiveActions.where('ccpId').equals(cid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function addHaccpCorrectiveAction(planId, {
  ccpId,
  limitId = null,
  deviation = '',
  immediateAction = '',
  causeInvestigation = '',
  preventRecurrence = '',
  productControl = '',
  productDisposition = 'hold_evaluate',
  responsibleRole = 'production',
  responsibleText = '',
  notificationInstructions = '',
  records = '',
  notes = '',
} = {}) {
  const pid = sanitizeProductId(planId);
  const cid = sanitizeProductId(ccpId);
  if (!pid) throw new ValidationError('בחר תכנית');
  if (!cid) throw new ValidationError('בחר CCP');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');
  const ccp = await db.haccpCcps.get(cid);
  if (!ccp || Number(ccp.planId) !== Number(pid) || ccp.decision !== 'ccp') {
    throw new ValidationError('CCP מאושר לא נמצא בתכנית');
  }

  let lid = sanitizeProductId(limitId) || null;
  if (lid) {
    const limit = await db.haccpCriticalLimits.get(lid);
    if (!limit || Number(limit.planId) !== Number(pid) || Number(limit.ccpId) !== Number(cid)) {
      throw new ValidationError('גבול קריטי לא שייך ל-CCP');
    }
  }

  const cleanDeviation = sanitizeTextField(deviation, 1000);
  const cleanImmediate = sanitizeTextField(immediateAction, 2000);
  if (!cleanDeviation) throw new ValidationError('הגדר מה נחשב חריגה');
  if (!cleanImmediate) throw new ValidationError('הגדר פעולה מיידית להחזרת שליטה');

  const existing = await getHaccpCorrectiveActions(pid);
  const sortOrder = existing.length
    ? Math.max(...existing.map((a) => a.sortOrder ?? 0)) + 1
    : 1;

  const id = await db.haccpCorrectiveActions.add({
    planId: pid,
    ccpId: cid,
    limitId: lid,
    deviation: cleanDeviation,
    immediateAction: cleanImmediate,
    causeInvestigation: sanitizeTextField(causeInvestigation, 2000),
    preventRecurrence: sanitizeTextField(preventRecurrence, 2000),
    productControl: sanitizeTextField(productControl, 2000),
    productDisposition: sanitizeProductDisposition(productDisposition),
    responsibleRole: sanitizeRole(responsibleRole),
    responsibleText: sanitizeTextField(responsibleText, 200),
    notificationInstructions: sanitizeTextField(notificationInstructions, 1000),
    records: sanitizeTextField(records, 1000),
    notes: sanitizeTextField(notes, 2000),
    sortOrder,
  });
  await markPlanCorrectiveInProgress(plan);
  logAuditEvent({
    entityTable: 'haccpCorrectiveActions',
    entityId: id,
    action: 'create',
    snapshot: { planId: pid, ccpId, deviation: sanitizeTextField(deviation, 1000) },
  });
  return id;
}

export async function updateHaccpCorrectiveAction(id, patch = {}) {
  const aid = sanitizeProductId(id);
  if (!aid) return;
  const row = await db.haccpCorrectiveActions.get(aid);
  if (!row) throw new ValidationError('פעולה מתקנת לא נמצאה');
  const next = {};

  if (patch.ccpId !== undefined) {
    const cid = sanitizeProductId(patch.ccpId);
    if (!cid) throw new ValidationError('CCP לא תקין');
    const ccp = await db.haccpCcps.get(cid);
    if (!ccp || Number(ccp.planId) !== Number(row.planId) || ccp.decision !== 'ccp') {
      throw new ValidationError('CCP מאושר לא נמצא');
    }
    next.ccpId = cid;
  }
  if (patch.limitId !== undefined) {
    const lid = sanitizeProductId(patch.limitId);
    if (lid) {
      const limit = await db.haccpCriticalLimits.get(lid);
      const ccpId = next.ccpId || row.ccpId;
      if (!limit || Number(limit.planId) !== Number(row.planId) || Number(limit.ccpId) !== Number(ccpId)) {
        throw new ValidationError('גבול קריטי לא שייך ל-CCP');
      }
      next.limitId = lid;
    } else {
      next.limitId = null;
    }
  }
  if (patch.deviation !== undefined) {
    const clean = sanitizeTextField(patch.deviation, 1000);
    if (!clean) throw new ValidationError('הגדר מה נחשב חריגה');
    next.deviation = clean;
  }
  if (patch.immediateAction !== undefined) {
    const clean = sanitizeTextField(patch.immediateAction, 2000);
    if (!clean) throw new ValidationError('הגדר פעולה מיידית להחזרת שליטה');
    next.immediateAction = clean;
  }
  if (patch.causeInvestigation !== undefined) {
    next.causeInvestigation = sanitizeTextField(patch.causeInvestigation, 2000);
  }
  if (patch.preventRecurrence !== undefined) {
    next.preventRecurrence = sanitizeTextField(patch.preventRecurrence, 2000);
  }
  if (patch.productControl !== undefined) {
    next.productControl = sanitizeTextField(patch.productControl, 2000);
  }
  if (patch.productDisposition !== undefined) {
    next.productDisposition = sanitizeProductDisposition(patch.productDisposition);
  }
  if (patch.responsibleRole !== undefined) next.responsibleRole = sanitizeRole(patch.responsibleRole);
  if (patch.responsibleText !== undefined) {
    next.responsibleText = sanitizeTextField(patch.responsibleText, 200);
  }
  if (patch.notificationInstructions !== undefined) {
    next.notificationInstructions = sanitizeTextField(patch.notificationInstructions, 1000);
  }
  if (patch.records !== undefined) next.records = sanitizeTextField(patch.records, 1000);
  if (patch.notes !== undefined) next.notes = sanitizeTextField(patch.notes, 2000);

  if (!Object.keys(next).length) return;
  await db.haccpCorrectiveActions.update(aid, next);
  logAuditEvent({
    entityTable: 'haccpCorrectiveActions',
    entityId: aid,
    action: 'update',
    snapshot: { ...row, ...next },
  });
}

export async function deleteHaccpCorrectiveAction(id) {
  const aid = sanitizeProductId(id);
  if (!aid) return;
  await db.haccpCorrectiveActions.delete(aid);
  logAuditEvent({ entityTable: 'haccpCorrectiveActions', entityId: aid, action: 'delete' });
}

/** הצעת פעולה מתקנת בסיסית לפי CCP וגבולותיו */
export async function seedSuggestedCorrectiveForCcp(planId, ccpId) {
  const pid = sanitizeProductId(planId);
  const cid = sanitizeProductId(ccpId);
  if (!pid || !cid) throw new ValidationError('בחר תכנית ו-CCP');
  const ccp = await db.haccpCcps.get(cid);
  if (!ccp || Number(ccp.planId) !== Number(pid) || ccp.decision !== 'ccp') {
    throw new ValidationError('CCP מאושר לא נמצא');
  }
  const existing = await getHaccpCorrectiveActionsForCcp(cid);
  if (existing.length) throw new ValidationError('כבר קיימת פעולה מתקנת ל-CCP זה');

  const limits = await getHaccpCriticalLimitsForCcp(cid);
  const step = await db.haccpFlowSteps.get(ccp.flowStepId);
  const kind = step?.stepKind || 'other';

  const dispositionByKind = {
    baking: 'rework',
    cooling: 'hold_evaluate',
    storage: 'hold_evaluate',
    receiving: 'return_supplier',
  };

  if (limits.length) {
    let added = 0;
    for (const limit of limits) {
      const limitText = formatCriticalLimit(limit);
      await addHaccpCorrectiveAction(pid, {
        ccpId: cid,
        limitId: limit.id,
        deviation: `חריגה מגבול קריטי: ${limitText}`,
        immediateAction: kind === 'baking'
          ? 'עצירת המשך תהליך / הארכת אפייה לפי נוהל עד חזרה לגבול; סימון המוצר כמושהה'
          : 'עצירת התהליך, סימון המוצר כמושהה/פסול, והחזרת הפרמטר לשליטה',
        causeInvestigation: 'בדיקת ציוד, כיול, חומרי גלם ותיעוד ניטור של האצווה',
        preventRecurrence: 'תיקון הסיבה שנמצאה + הדרכת עובדים / עדכון נוהל במידת הצורך',
        productControl: 'בידוד האצווה החשודה ומניעת שחרור עד החלטת איכות',
        productDisposition: dispositionByKind[kind] || 'hold_evaluate',
        responsibleRole: 'quality',
        notificationInstructions: 'הודעה מיידית למוביל HACCP / אבטחת איכות',
        records: 'טופס פעולה מתקנת CCP',
      });
      added += 1;
    }
    return added;
  }

  await addHaccpCorrectiveAction(pid, {
    ccpId: cid,
    deviation: `חריגה מבקרת ${ccp.code || 'CCP'} — ${ccp.name || ccp.hazardDescription || ''}`,
    immediateAction: 'עצירת התהליך, סימון המוצר כמושהה, והחזרת השליטה בתהליך',
    causeInvestigation: 'חקירת סיבת החריגה (ציוד / אדם / חומר / שיטה)',
    preventRecurrence: 'תיקון הסיבה ומניעת הישנות',
    productControl: 'בידוד המוצר החשוד עד הערכה',
    productDisposition: dispositionByKind[kind] || 'hold_evaluate',
    responsibleRole: 'quality',
    notificationInstructions: 'הודעה למוביל HACCP / אבטחת איכות',
    records: 'טופס פעולה מתקנת CCP',
  });
  return 1;
}

/** שיטות אימות לפי מדריך משהב: תצפית ישירה / בדיקה מקבילה / בדיקת תיעוד (+ כיול/ביקורת) */
export const HACCP_VERIFICATION_METHODS = [
  { id: 'observation', label: 'תצפית ישירה' },
  { id: 'parallel_check', label: 'בדיקה מקבילה' },
  { id: 'records_review', label: 'בדיקת תיעוד' },
  { id: 'calibration', label: 'כיול ציוד מדידה' },
  { id: 'sampling', label: 'דיגום / בדיקה מעבדתית' },
  { id: 'audit', label: 'ביקורת פנימית / חיצונית' },
  { id: 'other', label: 'אחר' },
];

export const HACCP_VERIFICATION_FREQUENCIES = [
  { id: 'daily', label: 'יומי' },
  { id: 'weekly', label: 'שבועי' },
  { id: 'monthly', label: 'חודשי' },
  { id: 'quarterly', label: 'רבעוני' },
  { id: 'annually', label: 'שנתי' },
  { id: 'after_deviation', label: 'בעקבות חריגה / פעולה מתקנת' },
  { id: 'random', label: 'אקראי / מדגמי' },
  { id: 'other', label: 'אחר' },
];

export function haccpVerificationMethodLabel(id) {
  return HACCP_VERIFICATION_METHODS.find((m) => m.id === id)?.label || id || '—';
}

export function haccpVerificationFrequencyLabel(id) {
  return HACCP_VERIFICATION_FREQUENCIES.find((f) => f.id === id)?.label || id || '—';
}

function sanitizeVerificationMethod(raw) {
  const id = String(raw || '').trim();
  return HACCP_VERIFICATION_METHODS.some((m) => m.id === id) ? id : 'records_review';
}

function sanitizeVerificationFrequency(raw) {
  const id = String(raw || '').trim();
  return HACCP_VERIFICATION_FREQUENCIES.some((f) => f.id === id) ? id : 'monthly';
}

async function markPlanVerificationInProgress(plan) {
  if (!plan?.id) return;
  const early = [
    'team', 'product', 'intended_use', 'flow', 'flow_verify', 'hazard', 'ccp',
    'limits', 'monitoring', 'corrective', 'overview',
  ];
  if (early.includes(plan.currentStep) || plan.status === 'draft') {
    await db.haccpPlans.update(plan.id, { currentStep: 'verification', status: 'in_progress' });
  }
}

export async function getHaccpVerificationProcs(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const rows = await db.haccpVerificationProcs.where('planId').equals(pid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function addHaccpVerificationProc(planId, {
  ccpId = null,
  method = 'records_review',
  activity = '',
  frequency = 'monthly',
  frequencyDetails = '',
  responsibleRole = 'quality',
  responsibleText = '',
  records = '',
  notes = '',
} = {}) {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');

  let cid = sanitizeProductId(ccpId) || null;
  if (cid) {
    const ccp = await db.haccpCcps.get(cid);
    if (!ccp || Number(ccp.planId) !== Number(pid) || ccp.decision !== 'ccp') {
      throw new ValidationError('CCP מאושר לא נמצא בתכנית');
    }
  }

  const cleanActivity = sanitizeTextField(activity, 2000);
  if (!cleanActivity) throw new ValidationError('הגדר מה מאמתים');

  const existing = await getHaccpVerificationProcs(pid);
  const sortOrder = existing.length
    ? Math.max(...existing.map((v) => v.sortOrder ?? 0)) + 1
    : 1;

  const id = await db.haccpVerificationProcs.add({
    planId: pid,
    ccpId: cid,
    method: sanitizeVerificationMethod(method),
    activity: cleanActivity,
    frequency: sanitizeVerificationFrequency(frequency),
    frequencyDetails: sanitizeTextField(frequencyDetails, 500),
    responsibleRole: sanitizeRole(responsibleRole),
    responsibleText: sanitizeTextField(responsibleText, 200),
    records: sanitizeTextField(records, 1000),
    notes: sanitizeTextField(notes, 2000),
    sortOrder,
  });
  await markPlanVerificationInProgress(plan);
  logAuditEvent({
    entityTable: 'haccpVerificationProcs',
    entityId: id,
    action: 'create',
    snapshot: { planId: pid, activity: sanitizeTextField(activity, 2000), method },
  });
  return id;
}

export async function updateHaccpVerificationProc(id, patch = {}) {
  const vid = sanitizeProductId(id);
  if (!vid) return;
  const row = await db.haccpVerificationProcs.get(vid);
  if (!row) throw new ValidationError('נוהל אימות לא נמצא');
  const next = {};

  if (patch.ccpId !== undefined) {
    const cid = sanitizeProductId(patch.ccpId);
    if (cid) {
      const ccp = await db.haccpCcps.get(cid);
      if (!ccp || Number(ccp.planId) !== Number(row.planId) || ccp.decision !== 'ccp') {
        throw new ValidationError('CCP מאושר לא נמצא');
      }
      next.ccpId = cid;
    } else {
      next.ccpId = null;
    }
  }
  if (patch.method !== undefined) next.method = sanitizeVerificationMethod(patch.method);
  if (patch.activity !== undefined) {
    const clean = sanitizeTextField(patch.activity, 2000);
    if (!clean) throw new ValidationError('הגדר מה מאמתים');
    next.activity = clean;
  }
  if (patch.frequency !== undefined) next.frequency = sanitizeVerificationFrequency(patch.frequency);
  if (patch.frequencyDetails !== undefined) {
    next.frequencyDetails = sanitizeTextField(patch.frequencyDetails, 500);
  }
  if (patch.responsibleRole !== undefined) next.responsibleRole = sanitizeRole(patch.responsibleRole);
  if (patch.responsibleText !== undefined) {
    next.responsibleText = sanitizeTextField(patch.responsibleText, 200);
  }
  if (patch.records !== undefined) next.records = sanitizeTextField(patch.records, 1000);
  if (patch.notes !== undefined) next.notes = sanitizeTextField(patch.notes, 2000);

  if (!Object.keys(next).length) return;
  await db.haccpVerificationProcs.update(vid, next);
  logAuditEvent({
    entityTable: 'haccpVerificationProcs',
    entityId: vid,
    action: 'update',
    snapshot: { ...row, ...next },
  });
}

export async function deleteHaccpVerificationProc(id) {
  const vid = sanitizeProductId(id);
  if (!vid) return;
  await db.haccpVerificationProcs.delete(vid);
  logAuditEvent({ entityTable: 'haccpVerificationProcs', entityId: vid, action: 'delete' });
}

/** הצעות אימות בסיסיות לתכנית (לפי מדריך משהב) */
export async function seedSuggestedVerificationProcs(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');
  const existing = await getHaccpVerificationProcs(pid);
  if (existing.length) throw new ValidationError('כבר קיימים נהלי אימות לתכנית זו');

  const suggestions = [
    {
      method: 'records_review',
      activity: 'סקירת רשומות ניטור CCP, פעולות מתקנות וכיולים — שלמות, דיוק וחתימות',
      frequency: 'weekly',
      responsibleRole: 'quality',
      records: 'טופס אימות תיעוד / יומן ביקורת פנימית',
    },
    {
      method: 'observation',
      activity: 'תצפית ישירה על ביצוע ניטור ב-CCP לפי הנוהל הכתוב',
      frequency: 'monthly',
      responsibleRole: 'quality',
      records: 'טופס תצפית אימות',
    },
    {
      method: 'parallel_check',
      activity: 'בדיקה מקבילה של מדידת CCP (למשל טמפרטורה) על ידי גורם מוסמך שאינו מבצע הניטור השוטף',
      frequency: 'monthly',
      responsibleRole: 'quality',
      records: 'טופס בדיקה מקבילה',
    },
    {
      method: 'calibration',
      activity: 'כיול / אימות מדחומים וציוד מדידה המשמשים בניטור CCP',
      frequency: 'quarterly',
      responsibleRole: 'engineering',
      records: 'יומן כיולים',
    },
    {
      method: 'audit',
      activity: 'ביקורת פנימית על יישום תכנית ה-HACCP ועדכונה בעקבות שינויים',
      frequency: 'annually',
      responsibleRole: 'management',
      records: 'דוח ביקורת HACCP',
    },
    {
      method: 'records_review',
      activity: 'אימות בעקבות חריגה או פעולה מתקנת — בדיקת תיעוד ותהליך',
      frequency: 'after_deviation',
      responsibleRole: 'quality',
      records: 'טופס אימות לאחר חריגה',
    },
  ];

  let added = 0;
  for (const s of suggestions) {
    await addHaccpVerificationProc(pid, s);
    added += 1;
  }

  const ccps = await getConfirmedHaccpCcps(pid);
  for (const ccp of ccps.slice(0, 5)) {
    await addHaccpVerificationProc(pid, {
      ccpId: ccp.id,
      method: 'observation',
      activity: `אימות יישום ניטור ב-${ccp.code || 'CCP'} · ${ccp.name || ''}`,
      frequency: 'monthly',
      responsibleRole: 'quality',
      records: 'טופס אימות CCP',
    });
    added += 1;
  }
  return added;
}

/** סוגי מסמכים / רשומות לפי עקרון 7 — תיעוד ורישום */
export const HACCP_DOC_KINDS = [
  { id: 'plan', label: 'מסמך תכנית HACCP' },
  { id: 'monitoring', label: 'טופס / רשומת ניטור CCP' },
  { id: 'corrective', label: 'טופס פעולה מתקנת' },
  { id: 'verification', label: 'טופס / דוח אימות' },
  { id: 'calibration', label: 'יומן כיול ציוד מדידה' },
  { id: 'training', label: 'הדרכות עובדים' },
  { id: 'prp', label: 'רשומות תכניות קדם (PRP)' },
  { id: 'other', label: 'אחר' },
];

export const HACCP_DOC_FORMATS = [
  { id: 'paper', label: 'נייר' },
  { id: 'digital', label: 'דיגיטלי' },
  { id: 'both', label: 'נייר + דיגיטלי' },
];

export function haccpDocKindLabel(id) {
  return HACCP_DOC_KINDS.find((k) => k.id === id)?.label || id || '—';
}

export function haccpDocFormatLabel(id) {
  return HACCP_DOC_FORMATS.find((f) => f.id === id)?.label || id || '—';
}

function sanitizeDocKind(raw) {
  const id = String(raw || '').trim();
  return HACCP_DOC_KINDS.some((k) => k.id === id) ? id : 'other';
}

function sanitizeDocFormat(raw) {
  const id = String(raw || '').trim();
  return HACCP_DOC_FORMATS.some((f) => f.id === id) ? id : 'both';
}

function sanitizeRetentionYears(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(30, Math.round(n));
}

async function markPlanDocumentationInProgress(plan) {
  if (!plan?.id) return;
  const early = [
    'team', 'product', 'intended_use', 'flow', 'flow_verify', 'hazard', 'ccp',
    'limits', 'monitoring', 'corrective', 'verification', 'overview',
  ];
  if (early.includes(plan.currentStep) || plan.status === 'draft') {
    await db.haccpPlans.update(plan.id, { currentStep: 'documentation', status: 'in_progress' });
  }
}

export async function getHaccpDocuments(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const rows = await db.haccpDocuments.where('planId').equals(pid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function addHaccpDocument(planId, {
  docKind = 'monitoring',
  title = '',
  description = '',
  retentionYears = 2,
  storageLocation = '',
  format = 'both',
  responsibleRole = 'quality',
  responsibleText = '',
  notes = '',
} = {}) {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');

  const cleanTitle = sanitizeTextField(title, 200);
  if (!cleanTitle) throw new ValidationError('הגדר שם למסמך / טופס');

  const existing = await getHaccpDocuments(pid);
  const sortOrder = existing.length
    ? Math.max(...existing.map((d) => d.sortOrder ?? 0)) + 1
    : 1;

  const id = await db.haccpDocuments.add({
    planId: pid,
    docKind: sanitizeDocKind(docKind),
    title: cleanTitle,
    description: sanitizeTextField(description, 2000),
    retentionYears: sanitizeRetentionYears(retentionYears),
    storageLocation: sanitizeTextField(storageLocation, 500),
    format: sanitizeDocFormat(format),
    responsibleRole: sanitizeRole(responsibleRole),
    responsibleText: sanitizeTextField(responsibleText, 200),
    notes: sanitizeTextField(notes, 2000),
    sortOrder,
  });
  await markPlanDocumentationInProgress(plan);
  logAuditEvent({
    entityTable: 'haccpDocuments',
    entityId: id,
    action: 'create',
    snapshot: { planId: pid, title: sanitizeTextField(title, 200), docKind },
  });
  return id;
}

export async function updateHaccpDocument(id, patch = {}) {
  const did = sanitizeProductId(id);
  if (!did) return;
  const row = await db.haccpDocuments.get(did);
  if (!row) throw new ValidationError('מסמך לא נמצא');
  const next = {};

  if (patch.docKind !== undefined) next.docKind = sanitizeDocKind(patch.docKind);
  if (patch.title !== undefined) {
    const clean = sanitizeTextField(patch.title, 200);
    if (!clean) throw new ValidationError('הגדר שם למסמך / טופס');
    next.title = clean;
  }
  if (patch.description !== undefined) next.description = sanitizeTextField(patch.description, 2000);
  if (patch.retentionYears !== undefined) next.retentionYears = sanitizeRetentionYears(patch.retentionYears);
  if (patch.storageLocation !== undefined) {
    next.storageLocation = sanitizeTextField(patch.storageLocation, 500);
  }
  if (patch.format !== undefined) next.format = sanitizeDocFormat(patch.format);
  if (patch.responsibleRole !== undefined) next.responsibleRole = sanitizeRole(patch.responsibleRole);
  if (patch.responsibleText !== undefined) {
    next.responsibleText = sanitizeTextField(patch.responsibleText, 200);
  }
  if (patch.notes !== undefined) next.notes = sanitizeTextField(patch.notes, 2000);

  if (!Object.keys(next).length) return;
  await db.haccpDocuments.update(did, next);
  logAuditEvent({
    entityTable: 'haccpDocuments',
    entityId: did,
    action: 'update',
    snapshot: { ...row, ...next },
  });
}

export async function deleteHaccpDocument(id) {
  const did = sanitizeProductId(id);
  if (!did) return;
  await db.haccpDocuments.delete(did);
  logAuditEvent({ entityTable: 'haccpDocuments', entityId: did, action: 'delete' });
}

/** הצעת קטלוג תיעוד בסיסי לפי מדריך משהב (שמירה ≥ שנתיים) */
export async function seedSuggestedHaccpDocuments(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');
  const existing = await getHaccpDocuments(pid);
  if (existing.length) throw new ValidationError('כבר קיים קטלוג תיעוד לתכנית זו');

  const suggestions = [
    {
      docKind: 'plan',
      title: 'תכנית HACCP מלאה (כולל צוות, מוצר, תרשים, סיכונים, CCP)',
      description: 'מסמך התכנית המעודכן — גרסה מבוקרת',
      retentionYears: 2,
      format: 'both',
      storageLocation: 'תיקיית איכות / ענן',
      responsibleRole: 'quality',
    },
    {
      docKind: 'monitoring',
      title: 'טופסי ניטור CCP (טמפרטורה / זמן / פרמטרים מדידים)',
      description: 'רשומות ניטור שוטף עם תאריך, שעה, ערך וחתימה',
      retentionYears: 2,
      format: 'both',
      storageLocation: 'תיקיית ייצור / מערכת דיגיטלית',
      responsibleRole: 'production',
    },
    {
      docKind: 'corrective',
      title: 'טופסי פעולות מתקנות וחריגות מגבול קריטי',
      description: 'תיעוד חריגה, פעולה, גורל מוצר ואישור',
      retentionYears: 2,
      format: 'both',
      storageLocation: 'תיקיית איכות',
      responsibleRole: 'quality',
    },
    {
      docKind: 'verification',
      title: 'רשומות אימות (תצפית / בדיקה מקבילה / סקירת תיעוד)',
      description: 'תוצאות אימות תקופתי ואחרי חריגה',
      retentionYears: 2,
      format: 'both',
      storageLocation: 'תיקיית איכות',
      responsibleRole: 'quality',
    },
    {
      docKind: 'calibration',
      title: 'יומן כיול מדחומים וציוד מדידה',
      description: 'כיול / אימות תקופתי של ציוד המשמש בניטור',
      retentionYears: 2,
      format: 'both',
      storageLocation: 'תיקיית תחזוקה / איכות',
      responsibleRole: 'engineering',
    },
    {
      docKind: 'training',
      title: 'רשומות הדרכת עובדים על נהלי HACCP',
      description: 'נושאים, משתתפים ותאריכים',
      retentionYears: 2,
      format: 'digital',
      storageLocation: 'תיקיית משאבי אנוש / איכות',
      responsibleRole: 'quality',
    },
    {
      docKind: 'prp',
      title: 'רשומות תכניות קדם (ניקיון, מזיקים, ספקים, אלרגנים…)',
      description: 'תיעוד PRP התומך במערכת HACCP',
      retentionYears: 2,
      format: 'both',
      storageLocation: 'תיקיית איכות / תפעול',
      responsibleRole: 'quality',
    },
  ];

  let added = 0;
  for (const s of suggestions) {
    await addHaccpDocument(pid, s);
    added += 1;
  }
  return added;
}

function sanitizePrpTopicId(raw) {
  const id = String(raw || '').trim();
  return HACCP_PRP_TOPICS.some((t) => t.id === id) ? id : '';
}

function sanitizePrpStatus(raw) {
  const id = String(raw || '').trim();
  return HACCP_PRP_STATUSES.some((s) => s.id === id) ? id : 'not_started';
}

function sanitizeReviewDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

async function markPlanPrpInProgress(plan) {
  if (!plan?.id) return;
  if (plan.currentStep === 'overview' || plan.status === 'draft') {
    await db.haccpPlans.update(plan.id, { currentStep: 'prp', status: 'in_progress' });
  }
}

export async function getHaccpPrpControls(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const rows = await db.haccpPrpControls.where('planId').equals(pid).toArray();
  const order = new Map(HACCP_PRP_TOPICS.map((t, i) => [t.id, i]));
  return rows.sort((a, b) =>
    (order.get(a.topicId) ?? 99) - (order.get(b.topicId) ?? 99)
    || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    || a.id - b.id
  );
}

export async function addHaccpPrpControl(planId, {
  topicId = '',
  status = 'not_started',
  procedureSummary = '',
  responsibleRole = 'quality',
  responsibleText = '',
  monitoringMethod = '',
  records = '',
  lastReviewedAt = '',
  notes = '',
} = {}) {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');
  const tid = sanitizePrpTopicId(topicId);
  if (!tid) throw new ValidationError('בחר נושא PRP');

  const existing = await getHaccpPrpControls(pid);
  if (existing.some((r) => r.topicId === tid)) {
    throw new ValidationError('כבר קיימת בקרה לנושא זה');
  }

  const sortOrder = HACCP_PRP_TOPICS.findIndex((t) => t.id === tid) + 1;
  const id = await db.haccpPrpControls.add({
    planId: pid,
    topicId: tid,
    status: sanitizePrpStatus(status),
    procedureSummary: sanitizeTextField(procedureSummary, 4000),
    responsibleRole: sanitizeRole(responsibleRole),
    responsibleText: sanitizeTextField(responsibleText, 200),
    monitoringMethod: sanitizeTextField(monitoringMethod, 2000),
    records: sanitizeTextField(records, 1000),
    lastReviewedAt: sanitizeReviewDate(lastReviewedAt),
    notes: sanitizeTextField(notes, 2000),
    sortOrder,
  });
  await markPlanPrpInProgress(plan);
  logAuditEvent({
    entityTable: 'haccpPrpControls',
    entityId: id,
    action: 'create',
    snapshot: { planId: pid, topicId: tid, status: sanitizePrpStatus(status) },
  });
  return id;
}

export async function updateHaccpPrpControl(id, patch = {}) {
  const rid = sanitizeProductId(id);
  if (!rid) return;
  const row = await db.haccpPrpControls.get(rid);
  if (!row) throw new ValidationError('בקרת PRP לא נמצאה');
  const next = {};

  if (patch.topicId !== undefined) {
    const tid = sanitizePrpTopicId(patch.topicId);
    if (!tid) throw new ValidationError('נושא PRP לא תקין');
    const siblings = await getHaccpPrpControls(row.planId);
    if (siblings.some((r) => r.topicId === tid && Number(r.id) !== Number(rid))) {
      throw new ValidationError('כבר קיימת בקרה לנושא זה');
    }
    next.topicId = tid;
    next.sortOrder = HACCP_PRP_TOPICS.findIndex((t) => t.id === tid) + 1;
  }
  if (patch.status !== undefined) next.status = sanitizePrpStatus(patch.status);
  if (patch.procedureSummary !== undefined) {
    next.procedureSummary = sanitizeTextField(patch.procedureSummary, 4000);
  }
  if (patch.responsibleRole !== undefined) next.responsibleRole = sanitizeRole(patch.responsibleRole);
  if (patch.responsibleText !== undefined) {
    next.responsibleText = sanitizeTextField(patch.responsibleText, 200);
  }
  if (patch.monitoringMethod !== undefined) {
    next.monitoringMethod = sanitizeTextField(patch.monitoringMethod, 2000);
  }
  if (patch.records !== undefined) next.records = sanitizeTextField(patch.records, 1000);
  if (patch.lastReviewedAt !== undefined) next.lastReviewedAt = sanitizeReviewDate(patch.lastReviewedAt);
  if (patch.notes !== undefined) next.notes = sanitizeTextField(patch.notes, 2000);

  if (!Object.keys(next).length) return;
  await db.haccpPrpControls.update(rid, next);
  logAuditEvent({
    entityTable: 'haccpPrpControls',
    entityId: rid,
    action: 'update',
    snapshot: { ...row, ...next },
  });
}

export async function deleteHaccpPrpControl(id) {
  const rid = sanitizeProductId(id);
  if (!rid) return;
  await db.haccpPrpControls.delete(rid);
  logAuditEvent({ entityTable: 'haccpPrpControls', entityId: rid, action: 'delete' });
}

/** יצירת שלדי בקרה לכל נושאי המדריך שחסרים בתכנית */
export async function seedHaccpPrpControls(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');
  const existing = await getHaccpPrpControls(pid);
  const have = new Set(existing.map((r) => r.topicId));
  let added = 0;
  for (const topic of HACCP_PRP_TOPICS) {
    if (have.has(topic.id)) continue;
    await addHaccpPrpControl(pid, {
      topicId: topic.id,
      status: 'not_started',
      procedureSummary: '',
      responsibleRole: topic.id === 'suppliers' || topic.id === 'raw_materials' || topic.id === 'packaging'
        ? 'purchasing'
        : topic.id === 'maintenance' || topic.id === 'calibration'
          ? 'engineering'
          : 'quality',
      records: `טופס / יומן — ${topic.label}`,
    });
    added += 1;
  }
  if (!added) throw new ValidationError('כל נושאי ה-PRP כבר קיימים בתכנית');
  return added;
}

export const HACCP_MONITOR_LOG_RESULTS = [
  { id: 'ok', label: 'בתוך הגבול' },
  { id: 'deviation', label: 'חריגה' },
  { id: 'na', label: 'לא בוצע / לא רלוונטי' },
];

export function haccpMonitorLogResultLabel(id) {
  return HACCP_MONITOR_LOG_RESULTS.find((r) => r.id === id)?.label || id || '—';
}

function sanitizeMonitorLogResult(raw) {
  const id = String(raw || '').trim();
  return HACCP_MONITOR_LOG_RESULTS.some((r) => r.id === id) ? id : 'ok';
}

function sanitizeRecordedAt(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // accept datetime-local (YYYY-MM-DDTHH:mm) or ISO / date
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00`;
  return '';
}

export async function getHaccpMonitoringLogs(planId, { limit = 200 } = {}) {
  const pid = sanitizeProductId(planId);
  if (!pid) return [];
  const rows = await db.haccpMonitoringLogs.where('planId').equals(pid).toArray();
  return rows
    .sort((a, b) => String(b.recordedAt || '').localeCompare(String(a.recordedAt || '')) || b.id - a.id)
    .slice(0, Math.max(1, Number(limit) || 200));
}

/**
 * בניית דשבורד חריגות מנתונים שכבר נטענו (לבדיקות + UI).
 */
export function buildHaccpDeviationDashboard(logs, {
  plans = [],
  ccps = [],
  days = 30,
  nowMs = Date.now(),
  limit = 50,
} = {}) {
  const windowMs = Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000;
  const cutoff = nowMs - windowMs;
  const planMap = new Map((plans || []).map((p) => [Number(p.id), p]));
  const ccpMap = new Map((ccps || []).map((c) => [Number(c.id), c]));

  const parseWhen = (recordedAt) => {
    const s = String(recordedAt || '').trim();
    if (!s) return NaN;
    const iso = s.length === 16 && s.includes('T') ? `${s}:00` : s;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : NaN;
  };

  const items = (logs || [])
    .filter((l) => l && l.result === 'deviation')
    .map((l) => {
      const whenMs = parseWhen(l.recordedAt);
      const plan = planMap.get(Number(l.planId));
      const ccp = ccpMap.get(Number(l.ccpId));
      const hasCorrective = !!String(l.correctiveNote || '').trim();
      return {
        id: l.id,
        planId: l.planId,
        planName: plan?.name || 'תכנית',
        ccpId: l.ccpId,
        ccpCode: ccp?.code || 'CCP',
        ccpName: ccp?.name || ccp?.hazardDescription || '—',
        value: l.value || '',
        unit: l.unit || '',
        recordedAt: l.recordedAt || '',
        whenMs: Number.isFinite(whenMs) ? whenMs : 0,
        batchCode: l.batchCode || '',
        correctiveNote: l.correctiveNote || '',
        hasCorrective,
        recordedByText: l.recordedByText || '',
        recordedByRole: l.recordedByRole || '',
      };
    })
    .filter((item) => !item.whenMs || item.whenMs >= cutoff)
    .sort((a, b) => (b.whenMs - a.whenMs) || (Number(b.id) - Number(a.id)));

  const capped = items.slice(0, Math.max(1, Number(limit) || 50));
  const openWithoutCorrective = capped.filter((i) => !i.hasCorrective).length;
  return {
    days: Math.max(1, Number(days) || 30),
    total: capped.length,
    openWithoutCorrective,
    items: capped,
  };
}

/** דשבורד חריגות ניטור — כל התכניות או תכנית אחת */
export async function getHaccpDeviationDashboard({
  planId = null,
  days = 30,
  limit = 50,
} = {}) {
  const pid = planId ? sanitizeProductId(planId) : null;
  const [plans, logs, ccps] = await Promise.all([
    getHaccpPlans(),
    pid
      ? db.haccpMonitoringLogs.where('planId').equals(pid).toArray()
      : db.haccpMonitoringLogs.toArray(),
    db.haccpCcps.toArray(),
  ]);
  return buildHaccpDeviationDashboard(logs, { plans, ccps, days, limit });
}

/**
 * טיוטת טקסט לפעולה מתקנת לפי CCP — למילוי אוטומטי ביומן ניטור בחריגה.
 */
export async function suggestCorrectiveNoteForDeviation(ccpId) {
  const cid = sanitizeProductId(ccpId);
  if (!cid) return '';
  const actions = await getHaccpCorrectiveActionsForCcp(cid);
  if (!actions.length) return '';
  const a = actions[0];
  const parts = [
    a.immediateAction && `מיידי: ${a.immediateAction}`,
    a.productControl && `בקרת מוצר: ${a.productControl}`,
    a.notificationInstructions && `דיווח: ${a.notificationInstructions}`,
  ].filter(Boolean);
  return parts.join(' · ').slice(0, 2000);
}

export async function addHaccpMonitoringLog(planId, {
  ccpId,
  monitoringId = null,
  limitId = null,
  recordedAt = '',
  batchCode = '',
  value = '',
  unit = '',
  result = 'ok',
  recordedByRole = 'production',
  recordedByText = '',
  correctiveNote = '',
  notes = '',
} = {}) {
  const pid = sanitizeProductId(planId);
  const cid = sanitizeProductId(ccpId);
  if (!pid) throw new ValidationError('בחר תכנית');
  if (!cid) throw new ValidationError('בחר CCP');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');
  const ccp = await db.haccpCcps.get(cid);
  if (!ccp || Number(ccp.planId) !== Number(pid) || ccp.decision !== 'ccp') {
    throw new ValidationError('CCP מאושר לא נמצא בתכנית');
  }

  let mid = sanitizeProductId(monitoringId) || null;
  if (mid) {
    const mon = await db.haccpMonitoring.get(mid);
    if (!mon || Number(mon.planId) !== Number(pid) || Number(mon.ccpId) !== Number(cid)) {
      throw new ValidationError('נוהל ניטור לא שייך ל-CCP');
    }
  }

  let lid = sanitizeProductId(limitId) || null;
  if (lid) {
    const limit = await db.haccpCriticalLimits.get(lid);
    if (!limit || Number(limit.planId) !== Number(pid) || Number(limit.ccpId) !== Number(cid)) {
      throw new ValidationError('גבול קריטי לא שייך ל-CCP');
    }
  }

  const when = sanitizeRecordedAt(recordedAt);
  if (!when) throw new ValidationError('הזן תאריך ושעת מדידה');

  const cleanResult = sanitizeMonitorLogResult(result);
  const cleanValue = sanitizeTextField(value, 80);
  if (cleanResult !== 'na' && !cleanValue) {
    throw new ValidationError('הזן ערך מדידה');
  }

  let cleanCorrective = sanitizeTextField(correctiveNote, 2000);
  if (cleanResult === 'deviation' && !cleanCorrective) {
    cleanCorrective = await suggestCorrectiveNoteForDeviation(cid);
  }

  // חריגה בלי נוהל פעולה מתקנת ל-CCP → זורעים נוהל מוצע אוטומטית
  let seededCorrective = 0;
  if (cleanResult === 'deviation') {
    try {
      seededCorrective = await ensureCorrectiveProcedureForCcp(pid, cid);
      if (!cleanCorrective) {
        cleanCorrective = await suggestCorrectiveNoteForDeviation(cid);
      }
    } catch {
      seededCorrective = 0;
    }
  }

  const logRow = {
    planId: pid,
    ccpId: cid,
    monitoringId: mid,
    limitId: lid,
    recordedAt: when,
    batchCode: sanitizeTextField(batchCode, 80),
    value: cleanValue,
    unit: sanitizeTextField(unit, 40),
    result: cleanResult,
    recordedByRole: sanitizeRole(recordedByRole),
    recordedByText: sanitizeTextField(recordedByText, 200),
    correctiveNote: cleanCorrective,
    notes: sanitizeTextField(notes, 2000),
  };
  const id = await db.haccpMonitoringLogs.add(logRow);
  logAuditEvent({
    entityTable: 'haccpMonitoringLogs',
    entityId: id,
    action: 'create',
    snapshot: { ...logRow, seededCorrective },
  });
  return id;
}

/** אם ל-CCP אין נוהל פעולה מתקנת — זורע הצעה. מחזיר כמה נוספו. */
export async function ensureCorrectiveProcedureForCcp(planId, ccpId) {
  const pid = sanitizeProductId(planId);
  const cid = sanitizeProductId(ccpId);
  if (!pid || !cid) return 0;
  const existing = await getHaccpCorrectiveActionsForCcp(cid);
  if (existing.length) return 0;
  try {
    return await seedSuggestedCorrectiveForCcp(pid, cid);
  } catch (err) {
    if (/כבר/.test(err?.message || '')) return 0;
    throw err;
  }
}

export async function updateHaccpMonitoringLog(id, patch = {}) {
  const lid = sanitizeProductId(id);
  if (!lid) return;
  const row = await db.haccpMonitoringLogs.get(lid);
  if (!row) throw new ValidationError('רשומת ניטור לא נמצאה');
  const next = {};

  if (patch.ccpId !== undefined) {
    const cid = sanitizeProductId(patch.ccpId);
    if (!cid) throw new ValidationError('CCP לא תקין');
    const ccp = await db.haccpCcps.get(cid);
    if (!ccp || Number(ccp.planId) !== Number(row.planId) || ccp.decision !== 'ccp') {
      throw new ValidationError('CCP מאושר לא נמצא');
    }
    next.ccpId = cid;
  }
  if (patch.monitoringId !== undefined) {
    const mid = sanitizeProductId(patch.monitoringId);
    if (mid) {
      const mon = await db.haccpMonitoring.get(mid);
      const ccpId = next.ccpId || row.ccpId;
      if (!mon || Number(mon.planId) !== Number(row.planId) || Number(mon.ccpId) !== Number(ccpId)) {
        throw new ValidationError('נוהל ניטור לא שייך ל-CCP');
      }
      next.monitoringId = mid;
    } else {
      next.monitoringId = null;
    }
  }
  if (patch.limitId !== undefined) {
    const limitId = sanitizeProductId(patch.limitId);
    if (limitId) {
      const limit = await db.haccpCriticalLimits.get(limitId);
      const ccpId = next.ccpId || row.ccpId;
      if (!limit || Number(limit.planId) !== Number(row.planId) || Number(limit.ccpId) !== Number(ccpId)) {
        throw new ValidationError('גבול קריטי לא שייך ל-CCP');
      }
      next.limitId = limitId;
    } else {
      next.limitId = null;
    }
  }
  if (patch.recordedAt !== undefined) {
    const when = sanitizeRecordedAt(patch.recordedAt);
    if (!when) throw new ValidationError('הזן תאריך ושעת מדידה');
    next.recordedAt = when;
  }
  if (patch.batchCode !== undefined) next.batchCode = sanitizeTextField(patch.batchCode, 80);
  if (patch.value !== undefined) next.value = sanitizeTextField(patch.value, 80);
  if (patch.unit !== undefined) next.unit = sanitizeTextField(patch.unit, 40);
  if (patch.result !== undefined) next.result = sanitizeMonitorLogResult(patch.result);
  if (patch.recordedByRole !== undefined) next.recordedByRole = sanitizeRole(patch.recordedByRole);
  if (patch.recordedByText !== undefined) {
    next.recordedByText = sanitizeTextField(patch.recordedByText, 200);
  }
  if (patch.correctiveNote !== undefined) {
    next.correctiveNote = sanitizeTextField(patch.correctiveNote, 2000);
  }
  if (patch.notes !== undefined) next.notes = sanitizeTextField(patch.notes, 2000);

  const result = next.result || row.result;
  const value = next.value !== undefined ? next.value : row.value;
  if (result !== 'na' && !String(value || '').trim()) {
    throw new ValidationError('הזן ערך מדידה');
  }

  if (!Object.keys(next).length) return;
  await db.haccpMonitoringLogs.update(lid, next);
  logAuditEvent({ entityTable: 'haccpMonitoringLogs', entityId: lid, action: 'update', snapshot: next });
}

export async function deleteHaccpMonitoringLog(id) {
  const lid = sanitizeProductId(id);
  if (!lid) return;
  await db.haccpMonitoringLogs.delete(lid);
  logAuditEvent({ entityTable: 'haccpMonitoringLogs', entityId: lid, action: 'delete' });
}

/**
 * בונה טיוטת תכנית מהצעות קיימות (seeds) לפי תלות בין שלבים.
 * מדלג בשקט על שלבים שכבר מולאו; לא מוחק נתונים קיימים.
 */
export async function buildHaccpPlanDraft(planId, {
  preferProductionFlow = true,
  confirmCcpCandidates = true,
} = {}) {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית');
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');

  const steps = [];
  const run = async (label, fn) => {
    try {
      const count = await fn();
      steps.push({
        label,
        ok: true,
        skipped: false,
        count: Number.isFinite(count) ? count : 0,
        message: '',
      });
    } catch (err) {
      const message = err?.message || String(err);
      const skipped = /כבר/.test(message);
      steps.push({
        label,
        ok: skipped,
        skipped,
        count: 0,
        message,
      });
      if (!skipped) {
        // ממשיכים — טיוטה חלקית עדיפה על עצירה מוחלטת
      }
    }
  };

  await run('PRP — אתחול נושאים', () => seedHaccpPrpControls(pid));

  await run('תיאור מוצר — הרכב ממתכונים', async () => {
    const suggestion = await suggestCompositionForHaccpPlan(pid);
    if (!suggestion) throw new ValidationError('אין מתכונים/מוצרים להצעת הרכב');
    const desc = await getHaccpProductDescription(pid);
    if (String(desc.composition || '').trim()) {
      throw new ValidationError('כבר יש הרכב בתיאור המוצר');
    }
    await saveHaccpProductDescription(pid, { ...desc, composition: suggestion });
    return 1;
  });

  await run('תרשים זרימה', async () => {
    const existing = await getHaccpFlowSteps(pid);
    if (existing.length) throw new ValidationError('כבר יש שלבים בתרשים');
    if (preferProductionFlow) {
      const flows = await listProductionFlowsForHaccpPlan(pid);
      const best = flows.sort((a, b) => b.stepCount - a.stepCount)[0];
      if (best) {
        return importHaccpFlowFromProduction(pid, best.id, { replace: false });
      }
    }
    return seedDefaultHaccpFlowSteps(pid);
  });

  await run('ניתוח סיכונים — הצעות לכל שלב', async () => {
    const flowSteps = await getHaccpFlowSteps(pid);
    if (!flowSteps.length) throw new ValidationError('אין שלבי תרשים');
    let added = 0;
    for (const step of flowSteps) {
      try {
        added += await seedSuggestedHazardsForStep(pid, step.id);
      } catch (err) {
        if (!/כבר/.test(err?.message || '')) {
          /* מדלגים על שלב בודד שנכשל */
        }
      }
    }
    if (!added) throw new ValidationError('כל הצעות הסיכון כבר קיימות');
    return added;
  });

  if (confirmCcpCandidates) {
    await run('CCP — אישור מועמדים (טיוטה Codex)', async () => {
      const candidates = await getHaccpCcpCandidates(pid);
      const bakeryTree = { q1: 'no', q2: 'yes', q3: 'no', q4: 'yes' }; // → ccp
      let added = 0;
      for (const h of candidates) {
        if (!h.isCcpCandidate) continue;
        try {
          await addHaccpCcpFromHazard(pid, h.id, bakeryTree);
          added += 1;
        } catch {
          /* מדלגים אם כבר מקושר / שגיאה נקודתית */
        }
      }
      if (!added) throw new ValidationError('אין מועמדי CCP חדשים לאישור');
      return added;
    });
  }

  const confirmed = (await getHaccpCcps(pid)).filter((c) => c.decision === 'ccp');

  await run('גבולות קריטיים ל-CCP', async () => {
    let added = 0;
    for (const ccp of confirmed) {
      try {
        added += await seedSuggestedLimitsForCcp(pid, ccp.id);
      } catch (err) {
        if (!/כבר/.test(err?.message || '')) { /* skip */ }
      }
    }
    if (!added) throw new ValidationError('כבר יש גבולות או שאין CCP מאושרים');
    return added;
  });

  await run('נהלי ניטור ל-CCP', async () => {
    let added = 0;
    for (const ccp of confirmed) {
      try {
        added += await seedSuggestedMonitoringForCcp(pid, ccp.id);
      } catch (err) {
        if (!/כבר/.test(err?.message || '')) { /* skip */ }
      }
    }
    if (!added) throw new ValidationError('כבר יש נהלי ניטור או שאין CCP מאושרים');
    return added;
  });

  await run('פעולות מתקנות ל-CCP', async () => {
    let added = 0;
    for (const ccp of confirmed) {
      try {
        added += await seedSuggestedCorrectiveForCcp(pid, ccp.id);
      } catch (err) {
        if (!/כבר/.test(err?.message || '')) { /* skip */ }
      }
    }
    if (!added) throw new ValidationError('כבר יש פעולות מתקנות או שאין CCP מאושרים');
    return added;
  });

  await run('נהלי אימות', () => seedSuggestedVerificationProcs(pid));
  await run('קטלוג מסמכים', () => seedSuggestedHaccpDocuments(pid));

  await db.haccpPlans.update(pid, {
    status: 'in_progress',
    currentStep: confirmed.length ? 'limits' : 'hazard',
  });

  const readiness = await getHaccpPlanReadiness(pid);
  return {
    planId: pid,
    steps,
    addedTotal: steps.reduce((s, x) => s + (x.count || 0), 0),
    failed: steps.filter((s) => !s.ok && !s.skipped),
    readiness,
  };
}

/** ציון מוכנות תכנית להדפסה / ביקורת */
export async function getHaccpPlanReadiness(planId) {
  const pid = sanitizeProductId(planId);
  if (!pid) {
    return { planId: null, percent: 0, done: 0, total: 0, items: [] };
  }
  const plan = await db.haccpPlans.get(pid);
  if (!plan) throw new ValidationError('תכנית לא נמצאה');

  const [
    members,
    prp,
    product,
    intended,
    flowSteps,
    verifications,
    hazards,
    ccps,
    limits,
    monitoring,
    corrective,
    verificationProcs,
    documents,
  ] = await Promise.all([
    getHaccpTeamMembers(),
    getHaccpPrpControls(pid),
    getHaccpProductDescription(pid),
    getHaccpIntendedUse(pid),
    getHaccpFlowSteps(pid),
    db.haccpFlowVerifications.where('planId').equals(pid).toArray(),
    getHaccpHazards(pid),
    getHaccpCcps(pid),
    getHaccpCriticalLimits(pid),
    getHaccpMonitoring(pid),
    getHaccpCorrectiveActions(pid),
    getHaccpVerificationProcs(pid),
    getHaccpDocuments(pid),
  ]);

  const activeMembers = members.filter((m) => m.active !== false);
  const hasLeader = activeMembers.some((m) => m.isLeader);
  const confirmedCcps = ccps.filter((c) => c.decision === 'ccp');
  const limitsCovered = confirmedCcps.filter((c) =>
    limits.some((l) => Number(l.ccpId) === Number(c.id))).length;
  const monitoringCovered = confirmedCcps.filter((c) =>
    monitoring.some((m) => Number(m.ccpId) === Number(c.id))).length;
  const correctiveCovered = confirmedCcps.filter((c) =>
    corrective.some((a) => Number(a.ccpId) === Number(c.id))).length;

  const items = [
    {
      id: 'team',
      stepId: 'team',
      label: 'צוות HACCP עם מוביל',
      done: activeMembers.length >= 1 && hasLeader,
      detail: hasLeader
        ? `${activeMembers.length} פעילים`
        : (activeMembers.length ? 'חסר מוביל מערכת' : 'אין חברי צוות'),
    },
    {
      id: 'prp',
      stepId: 'prp',
      label: 'שלד PRP לכל נושאי המדריך',
      done: prp.length >= HACCP_PRP_TOPICS.length,
      detail: `${prp.length}/${HACCP_PRP_TOPICS.length} נושאים`,
    },
    {
      id: 'product',
      stepId: 'product',
      label: 'תיאור מוצר עם הרכב',
      done: !!String(product?.composition || '').trim(),
      detail: String(product?.composition || '').trim() ? 'הרכבים מולאו' : 'חסר הרכב',
    },
    {
      id: 'intended_use',
      stepId: 'intended_use',
      label: 'שימוש מיועד',
      done: !!(intended && (
        String(intended.targetAudience || '').trim()
        || (intended.consumptionModes || []).length
        || (intended.channels || []).length
      )),
      detail: intended && (
        String(intended.targetAudience || '').trim()
        || (intended.consumptionModes || []).length
        || (intended.channels || []).length
      ) ? 'הוגדר' : 'חסר',
    },
    {
      id: 'flow',
      stepId: 'flow',
      label: 'תרשים זרימה (≥3 שלבים)',
      done: flowSteps.length >= 3,
      detail: `${flowSteps.length} שלבים`,
    },
    {
      id: 'flow_verify',
      stepId: 'flow_verify',
      label: 'אימות תרשים בשטח',
      done: verifications.some((v) => v.matchResult === 'matches' || v.matchResult === 'partial')
        || verifications.length > 0,
      detail: verifications.length ? `${verifications.length} אימותים` : 'טרם אומת',
    },
    {
      id: 'hazard',
      stepId: 'hazard',
      label: 'ניתוח גורמי סיכון',
      done: hazards.length >= 1,
      detail: `${hazards.length} סיכונים`,
    },
    {
      id: 'ccp',
      stepId: 'ccp',
      label: 'לפחות CCP מאושר אחד',
      done: confirmedCcps.length >= 1,
      detail: `${confirmedCcps.length} CCP`,
    },
    {
      id: 'limits',
      stepId: 'limits',
      label: 'גבול קריטי לכל CCP',
      done: confirmedCcps.length > 0 && limitsCovered === confirmedCcps.length,
      detail: confirmedCcps.length
        ? `${limitsCovered}/${confirmedCcps.length} CCP עם גבול`
        : 'אין CCP',
    },
    {
      id: 'monitoring',
      stepId: 'monitoring',
      label: 'נוהל ניטור לכל CCP',
      done: confirmedCcps.length > 0 && monitoringCovered === confirmedCcps.length,
      detail: confirmedCcps.length
        ? `${monitoringCovered}/${confirmedCcps.length} CCP עם ניטור`
        : 'אין CCP',
    },
    {
      id: 'corrective',
      stepId: 'corrective',
      label: 'פעולה מתקנת לכל CCP',
      done: confirmedCcps.length > 0 && correctiveCovered === confirmedCcps.length,
      detail: confirmedCcps.length
        ? `${correctiveCovered}/${confirmedCcps.length} CCP עם פעולה`
        : 'אין CCP',
    },
    {
      id: 'verification',
      stepId: 'verification',
      label: 'נוהל אימות מערכת',
      done: verificationProcs.length >= 1,
      detail: `${verificationProcs.length} נהלים`,
    },
    {
      id: 'documentation',
      stepId: 'documentation',
      label: 'קטלוג מסמכים',
      done: documents.length >= 1,
      detail: `${documents.length} מסמכים`,
    },
  ];

  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return {
    planId: pid,
    planName: plan.name,
    percent,
    done,
    total,
    items,
    readyForPrint: percent >= 70 && confirmedCcps.length >= 1,
    missing: items.filter((i) => !i.done),
  };
}

/**
 * שכפול תכנית למשפחת מוצרים אחרת (בלי יומן ניטור תפעולי).
 */
export async function cloneHaccpPlan(sourcePlanId, targetCategoryGroupId, { name = '' } = {}) {
  const srcId = sanitizeProductId(sourcePlanId);
  const gid = sanitizeProductId(targetCategoryGroupId);
  if (!srcId || !gid) throw new ValidationError('בחר תכנית מקור ומשפחת יעד');
  const source = await db.haccpPlans.get(srcId);
  if (!source) throw new ValidationError('תכנית מקור לא נמצאה');
  const group = await db.categoryGroups.get(gid);
  if (!group) throw new ValidationError('משפחת מוצרים לא נמצאה');
  const existing = await db.haccpPlans.where('categoryGroupId').equals(gid).first();
  if (existing) throw new ValidationError('למשפחה זו כבר יש תכנית — מחק או בחר משפחה אחרת');

  const newPlanId = await ensureHaccpPlanForGroup(gid, {
    name: sanitizeName(name, 80) || `${source.name} (עותק)`,
  });
  // ensureHaccpPlanForGroup returns existing if present — we already guarded
  await updateHaccpPlan(newPlanId, {
    name: sanitizeName(name, 80) || `${source.name} (עותק)`,
    status: 'draft',
    currentStep: source.currentStep || 'team',
    notes: source.notes || '',
  });

  const stepMap = new Map();
  const hazardMap = new Map();
  const ccpMap = new Map();
  const limitMap = new Map();

  const [
    prp, product, intended, flowSteps, verifications, hazards, ccps,
    limits, monitoring, corrective, verProcs, docs,
  ] = await Promise.all([
    getHaccpPrpControls(srcId),
    getHaccpProductDescription(srcId),
    getHaccpIntendedUse(srcId),
    getHaccpFlowSteps(srcId),
    db.haccpFlowVerifications.where('planId').equals(srcId).toArray(),
    getHaccpHazards(srcId),
    getHaccpCcps(srcId),
    getHaccpCriticalLimits(srcId),
    getHaccpMonitoring(srcId),
    getHaccpCorrectiveActions(srcId),
    getHaccpVerificationProcs(srcId),
    getHaccpDocuments(srcId),
  ]);

  for (const row of prp) {
    const { id, planId, ...rest } = row;
    await db.haccpPrpControls.add({ ...rest, planId: newPlanId });
  }

  if (product && (product.composition || product.name || product.shelfLife)) {
    const { id, planId, ...rest } = product;
    await saveHaccpProductDescription(newPlanId, rest);
  }

  if (intended && (
    String(intended.targetAudience || '').trim()
    || (intended.consumptionModes || []).length
    || (intended.channels || []).length
  )) {
    const { id, planId, ...rest } = intended;
    const existingUse = await db.haccpIntendedUses.where('planId').equals(newPlanId).first();
    if (existingUse) await db.haccpIntendedUses.update(existingUse.id, { ...rest, planId: newPlanId });
    else await db.haccpIntendedUses.add({ ...rest, planId: newPlanId });
  }

  for (const step of flowSteps) {
    const { id, planId, ...rest } = step;
    const newId = await db.haccpFlowSteps.add({ ...rest, planId: newPlanId });
    stepMap.set(Number(id), newId);
  }

  for (const v of verifications) {
    const { id, planId, flowStepId, ...rest } = v;
    await db.haccpFlowVerifications.add({
      ...rest,
      planId: newPlanId,
      flowStepId: flowStepId ? (stepMap.get(Number(flowStepId)) || null) : null,
    });
  }

  for (const h of hazards) {
    const { id, planId, flowStepId, ...rest } = h;
    const newFlowStepId = stepMap.get(Number(flowStepId));
    if (!newFlowStepId) continue;
    const newId = await db.haccpHazards.add({
      ...rest,
      planId: newPlanId,
      flowStepId: newFlowStepId,
    });
    hazardMap.set(Number(id), newId);
  }

  for (const c of ccps) {
    const { id, planId, flowStepId, hazardId, ...rest } = c;
    const newFlowStepId = stepMap.get(Number(flowStepId));
    if (!newFlowStepId) continue;
    const newId = await db.haccpCcps.add({
      ...rest,
      planId: newPlanId,
      flowStepId: newFlowStepId,
      hazardId: hazardId ? (hazardMap.get(Number(hazardId)) || null) : null,
    });
    ccpMap.set(Number(id), newId);
  }

  for (const l of limits) {
    const { id, planId, ccpId, ...rest } = l;
    const newCcpId = ccpMap.get(Number(ccpId));
    if (!newCcpId) continue;
    const newId = await db.haccpCriticalLimits.add({
      ...rest,
      planId: newPlanId,
      ccpId: newCcpId,
    });
    limitMap.set(Number(id), newId);
  }

  for (const m of monitoring) {
    const { id, planId, ccpId, limitId, ...rest } = m;
    const newCcpId = ccpMap.get(Number(ccpId));
    if (!newCcpId) continue;
    await db.haccpMonitoring.add({
      ...rest,
      planId: newPlanId,
      ccpId: newCcpId,
      limitId: limitId ? (limitMap.get(Number(limitId)) || null) : null,
    });
  }

  for (const a of corrective) {
    const { id, planId, ccpId, limitId, ...rest } = a;
    const newCcpId = ccpMap.get(Number(ccpId));
    if (!newCcpId) continue;
    await db.haccpCorrectiveActions.add({
      ...rest,
      planId: newPlanId,
      ccpId: newCcpId,
      limitId: limitId ? (limitMap.get(Number(limitId)) || null) : null,
    });
  }

  for (const v of verProcs) {
    const { id, planId, ccpId, ...rest } = v;
    await db.haccpVerificationProcs.add({
      ...rest,
      planId: newPlanId,
      ccpId: ccpId ? (ccpMap.get(Number(ccpId)) || null) : null,
    });
  }

  for (const d of docs) {
    const { id, planId, ...rest } = d;
    await db.haccpDocuments.add({ ...rest, planId: newPlanId });
  }

  await setActiveHaccpPlanId(newPlanId);
  return newPlanId;
}

/**
 * מצב אשף: אילו שלבים פתוחים / נעולים לפי מוכנות.
 * overview ו-monitor_log תמיד פתוחים (סקירה ותפעול יומיומי).
 * flow_verify הוא המלצה חזקה אך לא חוסם את המשך ניתוח הסיכונים.
 */
export async function getHaccpWizardState(planId, readiness = null) {
  const pid = sanitizeProductId(planId);
  const ready = readiness || (pid ? await getHaccpPlanReadiness(pid) : null);
  const doneByStep = new Map();
  for (const item of ready?.items || []) {
    doneByStep.set(item.stepId, !!item.done);
  }

  /** שלבים שחוסמים את הבא אחריהם (אימות תרשים — אופציונלי לנעילה) */
  const gateDone = (stepId) => {
    if (stepId === 'flow_verify') return true;
    return !!doneByStep.get(stepId);
  };

  const unlocked = new Set(['overview', 'monitor_log']);
  let prevGateOk = true;
  for (const stepId of HACCP_WIZARD_STEPS) {
    if (prevGateOk) {
      unlocked.add(stepId);
      if (!gateDone(stepId)) prevGateOk = false;
    }
  }
  const firstIncomplete = HACCP_WIZARD_STEPS.find((id) => !doneByStep.get(id))
    || 'documentation';

  const indexOf = (id) => {
    const i = HACCP_WIZARD_STEPS.indexOf(id);
    return i >= 0 ? i : -1;
  };

  return {
    planId: pid,
    wizardSteps: [...HACCP_WIZARD_STEPS],
    unlocked: [...unlocked],
    isUnlocked(stepId) {
      return unlocked.has(stepId);
    },
    firstIncomplete,
    prevStepId(stepId) {
      const i = indexOf(stepId);
      return i > 0 ? HACCP_WIZARD_STEPS[i - 1] : null;
    },
    nextStepId(stepId) {
      const i = indexOf(stepId);
      if (i < 0 || i >= HACCP_WIZARD_STEPS.length - 1) return null;
      const next = HACCP_WIZARD_STEPS[i + 1];
      return unlocked.has(next) ? next : null;
    },
    progressIndex: Math.max(0, indexOf(firstIncomplete)),
    progressTotal: HACCP_WIZARD_STEPS.length,
    readiness: ready,
  };
}

/** זריעת צוות מאפייה בסיסי — רק כשאין חברים פעילים */
export async function seedBakeryTeamDefaults() {
  const members = await getHaccpTeamMembers();
  const active = members.filter((m) => m.active !== false);
  if (active.length) {
    throw new ValidationError('כבר יש חברי צוות');
  }
  let added = 0;
  for (const row of BAKERY_TEAM_TEMPLATE) {
    await addHaccpTeamMember({ ...row });
    added += 1;
  }
  return added;
}

/** זריעת שימוש מיועד למאפייה — רק אם השדות ריקים */
export async function seedBakeryIntendedUse(planId, templateId = 'general') {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית');
  const current = await getHaccpIntendedUse(pid);
  const hasContent = !!(
    String(current.targetAudience || '').trim()
    || (current.consumptionModes || []).length
    || (current.channels || []).length
  );
  if (hasContent) throw new ValidationError('כבר יש שימוש מיועד');
  const tmpl = getHaccpBakeryTemplate(templateId);
  await saveHaccpIntendedUse(pid, { ...(tmpl.intendedUse || BAKERY_INTENDED_USE_TEMPLATE) });
  return 1;
}

/** זריעת שדות תיאור מוצר מתבנית — רק שדות ריקים */
export async function seedBakeryProductDefaults(planId, templateId = 'general') {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית');
  const tmpl = getHaccpBakeryTemplate(templateId);
  const defaults = tmpl.productDefaults || {};
  if (!Object.keys(defaults).length) throw new ValidationError('אין ברירות מחדל למוצר בתבנית');
  const desc = await getHaccpProductDescription(pid);
  const patch = { ...desc };
  let filled = 0;
  for (const key of Object.keys(defaults)) {
    const cur = patch[key];
    const empty = Array.isArray(cur) ? !cur.length : !String(cur || '').trim();
    if (empty && defaults[key] != null && String(defaults[key]).length) {
      patch[key] = defaults[key];
      filled += 1;
    }
  }
  if (!filled) throw new ValidationError('כבר יש תיאור מוצר מתאים');
  await saveHaccpProductDescription(pid, patch);
  return filled;
}

/** זריעת תרשים מתבנית — רק אם אין שלבים ואין ייבוא ייצור מועדף */
export async function seedBakeryTemplateFlow(planId, templateId = 'general') {
  const pid = sanitizeProductId(planId);
  if (!pid) throw new ValidationError('בחר תכנית');
  const existing = await getHaccpFlowSteps(pid);
  if (existing.length) throw new ValidationError('כבר יש שלבים בתרשים');
  const tmpl = getHaccpBakeryTemplate(templateId);
  const steps = tmpl.flowSteps;
  if (!steps?.length) throw new ValidationError('לתבנית זו אין תרשים ייעודי');
  let added = 0;
  for (const step of steps) {
    await addHaccpFlowStep(pid, { ...step });
    added += 1;
  }
  return added;
}

/**
 * יצירת תכנית מתבנית מאפייה:
 * צוות בסיסי (אם חסר) → שימוש מיועד → תיאור מוצר → תרשים תבנית → buildHaccpPlanDraft.
 */
export async function createHaccpPlanFromBakeryTemplate(categoryGroupId, {
  name = '',
  templateId = 'general',
  preferProductionFlow = true,
  confirmCcpCandidates = true,
} = {}) {
  const tmpl = getHaccpBakeryTemplate(templateId);
  const planId = await ensureHaccpPlanForGroup(categoryGroupId, {
    name: name || `HACCP — ${tmpl.label}`,
  });
  const steps = [];

  const run = async (label, fn) => {
    try {
      const count = await fn();
      steps.push({
        label,
        ok: true,
        skipped: false,
        count: Number.isFinite(count) ? count : 0,
        message: '',
      });
    } catch (err) {
      const message = err?.message || String(err);
      const skipped = /כבר|אין תרשים ייעודי|אין ברירות מחדל/.test(message);
      steps.push({
        label,
        ok: skipped,
        skipped,
        count: 0,
        message,
      });
    }
  };

  await run('צוות מאפייה בסיסי', () => seedBakeryTeamDefaults());
  await run(`שימוש מיועד (${tmpl.label})`, () => seedBakeryIntendedUse(planId, tmpl.id));
  await run(`תיאור מוצר (${tmpl.label})`, () => seedBakeryProductDefaults(planId, tmpl.id));

  // תרשים ייעודי רק אם אין תזרים ייצור לייבוא (או אם preferProductionFlow=false)
  if (preferProductionFlow) {
    const flows = await listProductionFlowsForHaccpPlan(planId);
    if (!flows.length) {
      await run(`תרשים ${tmpl.label}`, () => seedBakeryTemplateFlow(planId, tmpl.id));
    }
  } else {
    await run(`תרשים ${tmpl.label}`, () => seedBakeryTemplateFlow(planId, tmpl.id));
  }

  const draft = await buildHaccpPlanDraft(planId, {
    preferProductionFlow,
    confirmCcpCandidates,
  });

  await db.haccpPlans.update(planId, {
    status: 'in_progress',
    currentStep: 'flow_verify',
    notes: `נוצר מתבנית «${tmpl.label}» — יש לאמת תרשים בשטח ולהתאים שמות צוות`,
  });

  const readiness = await getHaccpPlanReadiness(planId);
  return {
    planId,
    templateId: tmpl.id,
    templateLabel: tmpl.label,
    steps: [...steps, ...(draft.steps || [])],
    addedTotal: steps.reduce((s, x) => s + (x.count || 0), 0) + (draft.addedTotal || 0),
    failed: [
      ...steps.filter((s) => !s.ok && !s.skipped),
      ...(draft.failed || []),
    ],
    readiness,
    draft,
  };
}

