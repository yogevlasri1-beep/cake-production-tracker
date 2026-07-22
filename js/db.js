import {
  ValidationError,
  isValidISODate,
  sanitizeQuantity,
  sanitizePortionCount,
  sanitizePortionSize,
  sanitizeMoney,
  sanitizeName,
  sanitizeTargetQuantity,
  sanitizeProductId,
  sanitizeCategoryColor,
  productNameKey,
} from './validators.js?v=340';
import { computeProductionTotals, sumEntriesForProducts } from './calc.js?v=340';
import { defaultColorForIndex } from './chart.js?v=340';
import { localDateTimeISO, parseLocalDateTimeIso } from './utils.js?v=340';

export { ValidationError };

export const PRODUCTION_STEP_NAME = 'תיעוד ייצור';

export const db = new Dexie('CakeProduction');

/** רק טבלאות קיימות בסכמה — מונע NotFoundError בטרנזקציות */
export function pickDbTables(...names) {
  return names.map((name) => db[name]).filter(Boolean);
}

const PRODUCTION_DB_TABLES = [
  'productionRuns', 'runStepStates', 'settings', 'runPreparationChecks', 'runCleaningChecks',
  'flows', 'flowSteps', 'flowCleaningTasks', 'flowChecklistItems', 'checklistTasks',
];

/** בדיקה שטבלאות תזרים קיימות בפועל ב-IndexedDB */
export async function assertProductionDbReady() {
  const missing = [];
  for (const name of PRODUCTION_DB_TABLES) {
    try {
      await db.table(name).count();
    } catch {
      missing.push(name);
    }
  }
  if (missing.length) {
    throw new ValidationError(
      `מסד נתונים פגום (חסר: ${missing.join(', ')}). לחץ על מספר הגרסה למעלה לעדכון, או עבור ל«גיבוי» לשחזור.`,
    );
  }
}

db.version(1).stores({
  categories: '++id, name, sortOrder',
  products: '++id, categoryId, name, active',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
});

db.version(2).stores({
  categories: '++id, name, sortOrder',
  products: '++id, categoryId, name, active',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
}).upgrade(async (tx) => {
  await tx.table('products').toCollection().modify((p) => {
    if (p.rawMaterialsCost == null) p.rawMaterialsCost = 0;
    if (p.packagingCost == null) p.packagingCost = 0;
    if (p.additionalCosts == null) p.additionalCosts = 0;
  });
});

db.version(3).stores({
  categories: '++id, name, sortOrder',
  products: '++id, categoryId, name, active',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
}).upgrade(async (tx) => {
  const count = await tx.table('activityPresets').count();
  if (count === 0) {
    const defaults = ['הכנת בצק', 'שקילות', 'אריזה', 'אפייה', 'קישוט', 'ערבוב', 'קירור'];
    await tx.table('activityPresets').bulkAdd(defaults.map((name) => ({ categoryId: 0, name })));
  }
});

db.version(4).stores({
  categories: '++id, name, sortOrder',
  products: '++id, categoryId, name, active',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
}).upgrade(async (tx) => {
  await tx.table('processLogs').toCollection().modify((log) => {
    if (log.quantity == null) log.quantity = null;
  });
});

db.version(5).stores({
  categories: '++id, name, sortOrder',
  products: '++id, categoryId, name, active',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
}).upgrade(async (tx) => {
  let i = 0;
  await tx.table('categories').toCollection().modify((cat) => {
    if (!cat.color) cat.color = defaultColorForIndex(i++);
  });
});

db.version(6).stores({
  categories: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
}).upgrade(async (tx) => {
  const products = await tx.table('products').toArray();
  const byCategory = new Map();
  for (const p of products) {
    if (!byCategory.has(p.categoryId)) byCategory.set(p.categoryId, []);
    byCategory.get(p.categoryId).push(p);
  }
  for (const group of byCategory.values()) {
    group.sort((a, b) => a.id - b.id);
    for (let i = 0; i < group.length; i++) {
      await tx.table('products').update(group[i].id, { sortOrder: i + 1 });
    }
  }
});

db.version(7).stores({
  categories: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
});

db.version(8).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
}).upgrade(async (tx) => {
  await tx.table('categories').toCollection().modify((cat) => {
    if (cat.groupId == null) cat.groupId = null;
  });
});

db.version(9).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flowSteps: '++id, categoryId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
});

db.version(10).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flowSteps: '++id, categoryId, categoryGroupId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
});

db.version(11).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
}).upgrade(async (tx) => {
  const steps = await tx.table('flowSteps').toArray();
  if (!steps.length) return;

  const groups = new Map();
  for (const step of steps) {
    const key = step.categoryId
      ? `c:${step.categoryId}`
      : step.categoryGroupId
        ? `g:${step.categoryGroupId}`
        : null;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(step);
  }

  const stepsTable = tx.table('flowSteps');
  const flowsTable = tx.table('flows');
  for (const [key, groupSteps] of groups) {
    const isCategory = key.startsWith('c:');
    const targetId = Number(key.slice(2));
    const flowId = await flowsTable.add({
      categoryId: isCategory ? targetId : null,
      categoryGroupId: isCategory ? null : targetId,
      name: 'ברירת מחדל',
      sortOrder: 1,
      isDefault: true,
    });
    for (const step of groupSteps) {
      await stepsTable.update(step.id, { flowId });
    }
  }
});

db.version(12).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
});

db.version(13).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
});

db.version(14).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
}).upgrade(async (tx) => {
  await tx.table('runStepStates').toCollection().modify((s) => {
    if (!Array.isArray(s.portionBatches)) s.portionBatches = [];
    if (s.tracksPortions && s.portionCount != null && s.portionBatches.length === 0) {
      const date = s.completedAt ? String(s.completedAt).slice(0, 10) : new Date().toISOString().slice(0, 10);
      s.portionBatches = [{
        count: s.portionCount,
        date,
        recordedAt: s.completedAt || new Date().toISOString(),
        note: '',
      }];
    }
  });
});

db.version(15).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
});

db.version(16).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
}).upgrade(async (tx) => {
  const products = await tx.table('products').toArray();
  for (const p of products) {
    if (p.priceUnit !== 'kg' && p.priceUnit !== 'unit') {
      await tx.table('products').update(p.id, { priceUnit: 'unit' });
    }
  }
});

db.version(17).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
});

db.version(18).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
}).upgrade(async (tx) => {
  const presets = await tx.table('flowPortionPresets').toArray();
  if (!presets.length) return;
  const flows = await tx.table('flows').toArray();
  const categories = await tx.table('categories').toArray();
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const seen = new Set();
  for (const p of presets) {
    const flow = flows.find((f) => f.id === p.flowId);
    if (!flow) continue;
    let gid = flow.categoryGroupId || null;
    if (!gid && flow.categoryId) gid = catMap.get(flow.categoryId)?.groupId || null;
    if (!gid) continue;
    const key = `${gid}|${p.name}|${p.weight}|${p.extra || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await tx.table('groupPortionPresets').add({
      categoryGroupId: gid,
      name: p.name,
      weight: p.weight,
      extra: p.extra || '',
      sortOrder: p.sortOrder ?? 0,
    });
  }
});

db.version(19).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
}).upgrade(async (tx) => {
  await tx.table('flowSteps').toCollection().modify((s) => {
    if (s.tracksProduction === undefined) s.tracksProduction = false;
  });
  await tx.table('runStepStates').toCollection().modify((s) => {
    if (s.tracksProduction === undefined) s.tracksProduction = false;
    if (!Array.isArray(s.productionEntryIds)) s.productionEntryIds = [];
  });
});

db.version(20).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
}).upgrade(async (tx) => {
  const flows = await tx.table('flows').toArray();
  for (const flow of flows) {
    await ensureFlowProductionStepInTx(tx, flow.id);
  }
});

db.version(21).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async (tx) => {
  const count = await tx.table('managerDepartments').count();
  if (count > 0) return;
  for (const d of DEFAULT_MANAGER_DEPARTMENTS) {
    await tx.table('managerDepartments').add({ ...d, active: true });
  }
});

db.version(22).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async (tx) => {
  await tx.table('runStepStates').toCollection().modify((s) => {
    if (
      s.stepName === PRODUCTION_STEP_NAME
      || (Array.isArray(s.productionEntryIds) && s.productionEntryIds.length > 0)
    ) {
      s.tracksProduction = true;
    }
  });
});

db.version(23).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, productPreparationId, [runId+productPreparationId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
});

db.version(24).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  flowPreparations: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
});

db.version(25).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  flowPreparations: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeCategories: '++id, name, sortOrder',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async (tx) => {
  const recipeCats = await tx.table('recipeCategories').count();
  if (recipeCats === 0) {
    const defaults = ['מפעל', 'מאפייה', 'פרטי', 'מהאינטרנט', 'אחר'];
    await tx.table('recipeCategories').bulkAdd(
      defaults.map((name, i) => ({ name, sortOrder: i + 1 })),
    );
  }
  const supplierCats = await tx.table('supplierCategories').count();
  if (supplierCats === 0) {
    const defaults = ['חומרי גלם יבשים', 'חלב ומוצריו', 'ירקות ופירות', 'אריזה', 'אחר'];
    await tx.table('supplierCategories').bulkAdd(
      defaults.map((name, i) => ({ name, sortOrder: i + 1 })),
    );
  }
});

db.version(26).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  flowPreparations: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async (tx) => {
  const groups = await tx.table('recipeGroups').count();
  if (groups > 0) return;

  const olds = await tx.table('recipeCategories').toArray();
  if (!olds.length) return;

  const recipes = await tx.table('recipes').toArray();
  const catMap = new Map();

  await tx.table('recipeCategories').clear();

  for (const old of olds.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)) {
    const groupId = await tx.table('recipeGroups').add({
      name: old.name,
      sortOrder: old.sortOrder ?? 0,
      linkedCategoryGroupId: null,
    });
    const subId = await tx.table('recipeCategories').add({
      groupId,
      name: 'ראשי',
      sortOrder: 1,
      linkedCategoryId: null,
    });
    catMap.set(old.id, subId);
  }

  for (const recipe of recipes) {
    const newCatId = catMap.get(recipe.categoryId);
    if (newCatId) {
      await tx.table('recipes').update(recipe.id, { categoryId: newCatId });
    }
  }
});

db.version(27).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  flowPreparations: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async (tx) => {
  const links = await tx.table('recipeProductLinks').count();
  if (links > 0) return;
  const recipes = await tx.table('recipes').toArray();
  for (const r of recipes) {
    if (r.linkedProductId) {
      await tx.table('recipeProductLinks').add({ recipeId: r.id, productId: r.linkedProductId });
    }
  }
});

db.version(28).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  flowPreparations: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async () => {
  const { repairRecipeCategoryPlacement } = await import('./kitchen-db.js');
  await repairRecipeCategoryPlacement();
});

db.version(29).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  flowPreparations: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async () => {
  const { migrateToRecipeTypeCatalog } = await import('./kitchen-db.js');
  await migrateToRecipeTypeCatalog();
});

db.version(30).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  flowPreparations: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async () => {
  const { backfillRawMaterialPriceHistory } = await import('./kitchen-db.js');
  await backfillRawMaterialPriceHistory();
});

db.version(31).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  flowPreparations: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  bakingProfiles: '++id, name, sortOrder',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
});

db.version(32).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  flowPreparations: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  bakingProfiles: '++id, name, sortOrder',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
});

db.version(33).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  flowPreparations: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
});

db.version(34).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async (tx) => {
  await migrateFlowPreparationsToGroup(tx);
});

db.version(35).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
});

db.version(36).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
});

db.version(37).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
});

db.version(38).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async (tx) => {
  const cats = await tx.table('supplierCategories').toArray();
  for (const cat of cats) {
    if (cat.name === 'אריזה' && !cat.isPackaging) {
      await tx.table('supplierCategories').update(cat.id, { isPackaging: true });
    }
  }
});

db.version(39).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
});

db.version(40).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async (tx) => {
  const runs = await tx.table('productionRuns').toArray();
  const runById = new Map(runs.map((r) => [r.id, r]));
  const steps = await tx.table('runStepStates').orderBy('runId').toArray();
  const byRun = new Map();
  for (const s of steps) {
    if (!byRun.has(s.runId)) byRun.set(s.runId, []);
    byRun.get(s.runId).push(s);
  }
  for (const [, runSteps] of byRun) {
    runSteps.sort((a, b) => a.stepIndex - b.stepIndex);
    const run = runById.get(runSteps[0]?.runId);
    for (let i = 0; i < runSteps.length; i++) {
      const step = runSteps[i];
      if (step.startedAt) continue;
      let startedAt = null;
      if (i === 0) startedAt = run?.startedAt || null;
      else if (runSteps[i - 1]?.completedAt) startedAt = runSteps[i - 1].completedAt;
      else if (step.status === 'active') startedAt = run?.startedAt || null;
      if (startedAt) await tx.table('runStepStates').update(step.id, { startedAt });
    }
  }
});

db.version(41).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
});

db.version(42).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async (tx) => {
  const linkTable = tx.table('flowChecklistItems');
  if (await linkTable.count() > 0) return;

  const [groupPreps, flows, categories] = await Promise.all([
    tx.table('groupPreparations').toArray(),
    tx.table('flows').toArray(),
    tx.table('categories').toArray(),
  ]);
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const checklistTable = tx.table('checklistTasks');
  const taskKeyToId = new Map();
  const oldPrepIdToTaskId = new Map();

  for (const prep of groupPreps.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)) {
    const scopeKey = `${prep.categoryGroupId}|${prep.categoryId || ''}|${prep.name}`;
    let taskId = taskKeyToId.get(scopeKey);
    if (!taskId) {
      taskId = await checklistTable.add({
        categoryGroupId: prep.categoryGroupId,
        name: prep.name,
        sortOrder: prep.sortOrder ?? 0,
      });
      taskKeyToId.set(scopeKey, taskId);
    }
    oldPrepIdToTaskId.set(prep.id, taskId);
  }

  for (const flow of flows) {
    let gid = flow.categoryGroupId || null;
    const cid = flow.categoryId || null;
    if (cid) {
      const cat = catMap.get(cid);
      gid = cat?.groupId || gid;
    }
    if (!gid) continue;

    const scopePreps = groupPreps.filter((p) => {
      if (p.categoryGroupId !== gid) return false;
      if (cid) return p.categoryId === cid;
      return !p.categoryId;
    });

    let sortOrder = 0;
    const linked = new Set();
    for (const prep of scopePreps.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)) {
      const taskId = oldPrepIdToTaskId.get(prep.id);
      if (!taskId || linked.has(taskId)) continue;
      await linkTable.add({ flowId: flow.id, checklistTaskId: taskId, sortOrder: sortOrder++ });
      linked.add(taskId);
    }
  }

  const checks = await tx.table('runPreparationChecks').toArray();
  for (const check of checks) {
    if (check.flowPreparationId && oldPrepIdToTaskId.has(check.flowPreparationId)) {
      await tx.table('runPreparationChecks').update(check.id, {
        flowPreparationId: oldPrepIdToTaskId.get(check.flowPreparationId),
      });
    }
  }
});

async function migrateRecipeProductScopeLinks(tx) {
  const catLinkTable = tx.table('recipeProductCategoryLinks');
  const groupLinkTable = tx.table('recipeProductGroupLinks');
  if (await catLinkTable.count() > 0 || await groupLinkTable.count() > 0) return;

  const recipes = await tx.table('recipes').toArray();
  for (const r of recipes) {
    const patch = {};
    if (r.linkedProductCategoryId) {
      await catLinkTable.add({ recipeId: r.id, categoryId: r.linkedProductCategoryId });
      patch.linkedProductCategoryId = null;
    }
    if (r.linkedProductGroupId) {
      await groupLinkTable.add({ recipeId: r.id, groupId: r.linkedProductGroupId });
      patch.linkedProductGroupId = null;
    }
    if (Object.keys(patch).length) await tx.table('recipes').update(r.id, patch);
  }
}

db.version(43).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async (tx) => {
  await migrateRecipeProductScopeLinks(tx);
});

db.version(44).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async () => {
  const { syncAllRecipePortionPresets } = await import('./kitchen-db.js');
  await syncAllRecipePortionPresets();
});

db.version(45).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
}).upgrade(async (tx) => {
  const tasks = await tx.table('checklistTasks').toArray();
  if (tasks.some((t) => t.categoryId)) return;

  const [links, flows, groupPreps] = await Promise.all([
    tx.table('flowChecklistItems').toArray(),
    tx.table('flows').toArray(),
    tx.table('groupPreparations').toArray(),
  ]);
  const flowMap = new Map(flows.map((f) => [f.id, f]));

  for (const prep of groupPreps) {
    if (!prep.categoryId) continue;
    for (const task of tasks) {
      if (task.categoryGroupId === prep.categoryGroupId
        && task.name === prep.name
        && !task.categoryId) {
        await tx.table('checklistTasks').update(task.id, { categoryId: prep.categoryId });
      }
    }
  }

  const refreshed = await tx.table('checklistTasks').toArray();
  const taskCatVotes = new Map();
  for (const link of links) {
    const flow = flowMap.get(link.flowId);
    if (!flow?.categoryId) continue;
    const votes = taskCatVotes.get(link.checklistTaskId) || new Set();
    votes.add(flow.categoryId);
    taskCatVotes.set(link.checklistTaskId, votes);
  }
  for (const task of refreshed) {
    if (task.categoryId) continue;
    const votes = taskCatVotes.get(task.id);
    if (votes?.size === 1) {
      await tx.table('checklistTasks').update(task.id, { categoryId: [...votes][0] });
    }
  }
});

db.version(46).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
});

function shiftISODate(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

db.version(47).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, categoryGroupId, [recipeId+categoryGroupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
}).upgrade(async (tx) => {
  const migrated = await tx.table('settings').get('weekStartSundayMigrated');
  if (migrated?.value === '1') return;

  const planItems = await tx.table('managerPlanItems').toArray();
  for (const item of planItems) {
    if (item.planType !== 'weekly') continue;
    await tx.table('managerPlanItems').update(item.id, {
      anchorDate: shiftISODate(item.anchorDate, -1),
      dayOffset: ((Number(item.dayOffset) || 0) + 1) % 7,
    });
  }

  const managerPlans = await tx.table('managerPlans').toArray();
  const weeklyPlans = managerPlans.filter((p) => p.planType === 'weekly');
  const anchorMap = new Map(weeklyPlans.map((p) => [p.anchorDate, p]));
  for (const plan of weeklyPlans) {
    const newAnchor = shiftISODate(plan.anchorDate, -1);
    if (newAnchor === plan.anchorDate) continue;
    const existing = anchorMap.get(newAnchor);
    if (existing && existing.id !== plan.id) {
      if (!existing.notes && plan.notes) {
        await tx.table('managerPlans').update(existing.id, { notes: plan.notes });
      }
      await tx.table('managerPlans').delete(plan.id);
      anchorMap.delete(plan.anchorDate);
    } else {
      await tx.table('managerPlans').update(plan.id, { anchorDate: newAnchor });
      anchorMap.delete(plan.anchorDate);
      anchorMap.set(newAnchor, { ...plan, anchorDate: newAnchor });
    }
  }

  const productionPlans = await tx.table('weeklyProductionPlans').toArray();
  const weekMap = new Map(productionPlans.map((p) => [p.weekStart, p]));
  for (const plan of productionPlans) {
    const newWeekStart = shiftISODate(plan.weekStart, -1);
    if (newWeekStart === plan.weekStart) continue;
    const existing = weekMap.get(newWeekStart);
    if (existing && existing.id !== plan.id) {
      const items = await tx.table('weeklyProductionPlanItems').where('planId').equals(plan.id).toArray();
      for (const item of items) {
        const dup = await tx.table('weeklyProductionPlanItems')
          .where('[planId+productId]')
          .equals([existing.id, item.productId])
          .first();
        if (dup) {
          await tx.table('weeklyProductionPlanItems').delete(item.id);
        } else {
          await tx.table('weeklyProductionPlanItems').update(item.id, { planId: existing.id });
        }
      }
      await tx.table('weeklyProductionPlans').delete(plan.id);
      weekMap.delete(plan.weekStart);
    } else {
      await tx.table('weeklyProductionPlans').update(plan.id, { weekStart: newWeekStart });
      weekMap.delete(plan.weekStart);
      weekMap.set(newWeekStart, { ...plan, weekStart: newWeekStart });
    }
  }

  await tx.table('settings').put({ key: 'weekStartSundayMigrated', value: '1' });
});

db.version(48).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
}).upgrade(async (tx) => {
  await tx.table('products').toCollection().modify((p) => {
    if (p.rawMaterialsCostSource == null) p.rawMaterialsCostSource = 'manual';
  });
});

db.version(49).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
});

db.version(50).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
}).upgrade(async (tx) => {
  const recipes = await tx.table('recipes').toArray();
  for (const r of recipes) {
    await tx.table('recipes').update(r.id, { yieldPortions: 1, showTotalAsPortions: false });
  }
});

db.version(51).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
}).upgrade(async () => {
  /* סנכרון מנות מתכונים — ב-initDB אחרי פתיחה מוצלחת */
});

db.version(52).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
});

db.version(53).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
  purchaseCategories: '++id, catKey, sortOrder',
  purchaseItems: '++id, categoryId, name, sortOrder, active',
}).upgrade(async (tx) => {
  const count = await tx.table('purchaseCategories').count();
  if (!count) {
    await tx.table('purchaseCategories').bulkAdd([
      { catKey: 'accessories', name: 'אביזרים', sortOrder: 1 },
      { catKey: 'machines', name: 'מכונות', sortOrder: 2 },
    ]);
  }
});

db.version(54).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt, sortOrder',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
  purchaseCategories: '++id, catKey, sortOrder',
  purchaseItems: '++id, categoryId, name, sortOrder, active',
}).upgrade(async (tx) => {
  const improvements = (await tx.table('managerTasks').toArray()).filter((r) => r.kind === 'improvement');
  const byDept = new Map();
  for (const row of improvements) {
    const d = row.department || 'general';
    if (!byDept.has(d)) byDept.set(d, []);
    byDept.get(d).push(row);
  }
  for (const list of byDept.values()) {
    list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      || (b.createdAt || '').localeCompare(a.createdAt || '')
      || b.id - a.id);
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const patch = { sortOrder: i + 1 };
      if (!row.urgencyColor) {
        patch.urgencyColor = row.priority === 'high' ? 'red' : row.priority === 'low' ? 'green' : 'yellow';
      }
      await tx.table('managerTasks').update(row.id, patch);
    }
  }
});

db.version(55).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  productionMachines: '++id, name, sortOrder',
  productionMachineFields: '++id, machineId, name, measureKind, unit, sortOrder',
  productionMachineProducts: '++id, machineId, productId, recipeId, [machineId+productId]',
  productionMachineProductValues: '++id, assignmentId, fieldId, [assignmentId+fieldId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt, sortOrder',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
  purchaseCategories: '++id, catKey, sortOrder',
  purchaseItems: '++id, categoryId, name, sortOrder, active',
});

db.version(56).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  productionMachines: '++id, name, sortOrder',
  productionMachineFields: '++id, machineId, name, measureKind, unit, sortOrder',
  productionMachineProducts: '++id, machineId, targetType, productId, categoryId, categoryGroupId, recipeId, [machineId+targetType+productId], [machineId+targetType+categoryId], [machineId+targetType+categoryGroupId]',
  productionMachineProductValues: '++id, assignmentId, fieldId, [assignmentId+fieldId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt, sortOrder',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
  purchaseCategories: '++id, catKey, sortOrder',
  purchaseItems: '++id, categoryId, name, sortOrder, active',
}).upgrade(async (tx) => {
  const table = tx.table('productionMachineProducts');
  await table.toCollection().modify((row) => {
    if (!row.targetType) row.targetType = row.productId ? 'product' : 'product';
  });
});

db.version(57).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, linkTargetType, linkProductId, linkCategoryId, linkCategoryGroupId, catalogSortOrder, sortOrder',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  productionMachines: '++id, name, sortOrder',
  productionMachineFields: '++id, machineId, name, measureKind, unit, sortOrder',
  productionMachineProducts: '++id, machineId, targetType, productId, categoryId, categoryGroupId, recipeId, [machineId+targetType+productId], [machineId+targetType+categoryId], [machineId+targetType+categoryGroupId]',
  productionMachineProductValues: '++id, assignmentId, fieldId, [assignmentId+fieldId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt, sortOrder',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
  purchaseCategories: '++id, catKey, sortOrder',
  purchaseItems: '++id, categoryId, name, sortOrder, active',
}).upgrade(async (tx) => {
  const table = tx.table('groupPortionPresets');
  let order = 1;
  const rows = await table.toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  for (const row of rows) {
    if (row.catalogSortOrder == null) {
      await table.update(row.id, { catalogSortOrder: order++ });
    }
  }
});

db.version(58).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, linkTargetType, linkProductId, linkCategoryId, linkCategoryGroupId, catalogSortOrder, sortOrder',
  portionPresetLinks: '++id, portionPresetId, linkType, targetId, sortOrder, [portionPresetId+linkType+targetId]',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  productionMachines: '++id, name, sortOrder',
  productionMachineFields: '++id, machineId, name, measureKind, unit, sortOrder',
  productionMachineProducts: '++id, machineId, targetType, productId, categoryId, categoryGroupId, recipeId, [machineId+targetType+productId], [machineId+targetType+categoryId], [machineId+targetType+categoryGroupId]',
  productionMachineProductValues: '++id, assignmentId, fieldId, [assignmentId+fieldId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt, sortOrder',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
  purchaseCategories: '++id, catKey, sortOrder',
  purchaseItems: '++id, categoryId, name, sortOrder, active',
}).upgrade(async (tx) => {
  const presets = await tx.table('groupPortionPresets').toArray();
  const linkTable = tx.table('portionPresetLinks');
  for (const preset of presets) {
    if (!preset.linkTargetType) continue;
    let linkType = preset.linkTargetType;
    const targetId = Number(
      preset.linkProductId || preset.linkCategoryId || preset.linkCategoryGroupId,
    );
    if (!targetId) continue;
    const dup = await linkTable
      .where('[portionPresetId+linkType+targetId]')
      .equals([preset.id, linkType, targetId])
      .first();
    if (!dup) {
      await linkTable.add({
        portionPresetId: preset.id,
        linkType,
        targetId,
        sortOrder: 1,
      });
    }
    await tx.table('groupPortionPresets').update(preset.id, {
      linkTargetType: null,
      linkProductId: null,
      linkCategoryId: null,
      linkCategoryGroupId: null,
    });
  }
});

db.version(59).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, linkTargetType, linkProductId, linkCategoryId, linkCategoryGroupId, catalogSortOrder, sortOrder',
  portionPresetLinks: '++id, portionPresetId, linkType, targetId, sortOrder, [portionPresetId+linkType+targetId]',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  productionMachines: '++id, name, sortOrder',
  productionMachineFields: '++id, machineId, name, measureKind, unit, sortOrder',
  productionMachineProducts: '++id, machineId, targetType, productId, categoryId, categoryGroupId, recipeId, [machineId+targetType+productId], [machineId+targetType+categoryId], [machineId+targetType+categoryGroupId]',
  productionMachineProductValues: '++id, assignmentId, fieldId, [assignmentId+fieldId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, active, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt, sortOrder',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
  purchaseCategories: '++id, catKey, sortOrder',
  purchaseItems: '++id, categoryId, name, sortOrder, active',
}).upgrade(async (tx) => {
  const mats = await tx.table('rawMaterials').toArray();
  for (const m of mats) {
    if (m.active == null) await tx.table('rawMaterials').update(m.id, { active: false });
  }
});

db.version(60).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, linkTargetType, linkProductId, linkCategoryId, linkCategoryGroupId, catalogSortOrder, sortOrder',
  portionPresetLinks: '++id, portionPresetId, linkType, targetId, sortOrder, [portionPresetId+linkType+targetId]',
  portionPresetIngredientSettings: '++id, portionPresetId, recipeIngredientId, [portionPresetId+recipeIngredientId]',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  productionMachines: '++id, name, sortOrder',
  productionMachineFields: '++id, machineId, name, measureKind, unit, sortOrder',
  productionMachineProducts: '++id, machineId, targetType, productId, categoryId, categoryGroupId, recipeId, [machineId+targetType+productId], [machineId+targetType+categoryId], [machineId+targetType+categoryGroupId]',
  productionMachineProductValues: '++id, assignmentId, fieldId, [assignmentId+fieldId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, active, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt, sortOrder',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
  purchaseCategories: '++id, catKey, sortOrder',
  purchaseItems: '++id, categoryId, name, sortOrder, active',
});

db.version(61).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, linkTargetType, linkProductId, linkCategoryId, linkCategoryGroupId, catalogSortOrder, sortOrder',
  portionPresetLinks: '++id, portionPresetId, linkType, targetId, sortOrder, [portionPresetId+linkType+targetId]',
  portionPresetIngredientSettings: '++id, portionPresetId, recipeIngredientId, [portionPresetId+recipeIngredientId]',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  productFlowLinks: '++id, productId, flowId, sortOrder, [productId+flowId], [flowId+productId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  productionMachines: '++id, name, sortOrder',
  productionMachineFields: '++id, machineId, name, measureKind, unit, sortOrder',
  productionMachineProducts: '++id, machineId, targetType, productId, categoryId, categoryGroupId, recipeId, [machineId+targetType+productId], [machineId+targetType+categoryId], [machineId+targetType+categoryGroupId]',
  productionMachineProductValues: '++id, assignmentId, fieldId, [assignmentId+fieldId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, active, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt, sortOrder',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
  purchaseCategories: '++id, catKey, sortOrder',
  purchaseItems: '++id, categoryId, name, sortOrder, active',
});

db.version(62).stores({
  categories: '++id, name, sortOrder, groupId',
  categoryGroups: '++id, name, sortOrder',
  products: '++id, categoryId, name, active, sortOrder',
  productionEntries: '++id, date, productId, runId, [date+productId]',
  targets: '++id, scope, scopeId, period, [scope+scopeId+period]',
  processLogs: '++id, date, categoryId, activity',
  activityPresets: '++id, categoryId, name',
  flows: '++id, categoryId, categoryGroupId, name, sortOrder',
  flowSteps: '++id, flowId, categoryId, categoryGroupId, sortOrder',
  flowPortionPresets: '++id, flowId, sortOrder',
  groupPortionPresets: '++id, categoryGroupId, sourceRecipeId, linkTargetType, linkProductId, linkCategoryId, linkCategoryGroupId, catalogSortOrder, sortOrder',
  portionPresetLinks: '++id, portionPresetId, linkType, targetId, sortOrder, [portionPresetId+linkType+targetId]',
  portionPresetIngredientSettings: '++id, portionPresetId, recipeIngredientId, [portionPresetId+recipeIngredientId]',
  groupPreparations: '++id, categoryGroupId, categoryId, name, sortOrder',
  checklistTasks: '++id, categoryGroupId, categoryId, name, sortOrder',
  flowChecklistItems: '++id, flowId, checklistTaskId, sortOrder, [flowId+checklistTaskId]',
  flowCleaningTasks: '++id, flowId, name, sortOrder',
  productionRuns: '++id, date, categoryId, productId, status, flowId',
  runStepStates: '++id, runId, stepIndex, [runId+stepIndex]',
  productPreparations: '++id, productId, name, sortOrder',
  runPreparationChecks: '++id, runId, flowPreparationId, [runId+flowPreparationId]',
  runCleaningChecks: '++id, runId, flowCleaningTaskId, [runId+flowCleaningTaskId]',
  recipeGroups: '++id, name, sortOrder, linkedCategoryGroupId',
  recipeCategories: '++id, groupId, name, sortOrder, linkedCategoryId',
  recipes: '++id, categoryId, parentRecipeId, name, linkedProductId, linkedProductCategoryId, linkedProductGroupId, sortOrder, bakingProfileId',
  recipeIngredients: '++id, recipeId, rawMaterialId, sortOrder',
  recipeProductLinks: '++id, recipeId, productId, [recipeId+productId]',
  recipeProductCategoryLinks: '++id, recipeId, categoryId, [recipeId+categoryId]',
  recipeProductGroupLinks: '++id, recipeId, groupId, [recipeId+groupId]',
  productRecipeComponents: '++id, productId, recipeId, sortOrder, [productId+recipeId]',
  productFlowLinks: '++id, productId, flowId, sortOrder, [productId+flowId], [flowId+productId]',
  bakingProfiles: '++id, name, sortOrder',
  bakingProfileProducts: '++id, bakingProfileId, productId, sortOrder, [bakingProfileId+productId]',
  bakingProfileScopes: '++id, bakingProfileId, scopeType, scopeId, sortOrder, [bakingProfileId+scopeType+scopeId], [scopeType+scopeId]',
  productionMachines: '++id, name, sortOrder',
  productionMachineFields: '++id, machineId, name, measureKind, unit, sortOrder',
  productionMachineProducts: '++id, machineId, targetType, productId, categoryId, categoryGroupId, recipeId, [machineId+targetType+productId], [machineId+targetType+categoryId], [machineId+targetType+categoryGroupId]',
  productionMachineProductValues: '++id, assignmentId, fieldId, [assignmentId+fieldId]',
  supplierCategories: '++id, name, sortOrder',
  suppliers: '++id, categoryId, name, sortOrder',
  rawMaterials: '++id, supplierCategoryId, name, supplierId, active, sortOrder',
  rawMaterialPriceHistory: '++id, rawMaterialId, effectiveDate, [rawMaterialId+effectiveDate]',
  supplierShortages: '++id, supplierId, rawMaterialId, sortOrder',
  weeklyProductionPlans: '++id, weekStart',
  weeklyProductionPlanItems: '++id, planId, productId, [planId+productId]',
  settings: 'key',
  localBackups: '++id, createdAt, kind',
  managerPlans: '++id, planType, anchorDate, [planType+anchorDate]',
  managerPlanItems: '++id, planType, anchorDate, [planType+anchorDate], sortOrder',
  managerTasks: '++id, department, kind, status, priority, dueDate, createdAt, sortOrder',
  managerIncidents: '++id, department, status, severity, occurredAt, createdAt',
  managerShiftNotes: '++id, date, department, kind, createdAt',
  managerResponsibilityAreas: '++id, name, sortOrder',
  managerEmployees: '++id, name, responsibilityAreaId, active, sortOrder',
  managerDepartments: '++id, deptKey, sortOrder, active',
  departmentCleaningLists: '++id, name, sortOrder',
  departmentCleaningTasks: '++id, listId, name, sortOrder, [listId+name]',
  purchaseCategories: '++id, catKey, sortOrder',
  purchaseItems: '++id, categoryId, name, sortOrder, active',
});

async function migrateFlowPreparationsToGroup(tx) {
  const groupTable = tx.table('groupPreparations');
  if (await groupTable.count() > 0) return;
  const oldTable = tx.table('flowPreparations');
  const oldPreps = await oldTable.toArray();
  if (!oldPreps.length) return;

  const [flows, categories] = await Promise.all([
    tx.table('flows').toArray(),
    tx.table('categories').toArray(),
  ]);
  const flowMap = new Map(flows.map((f) => [f.id, f]));
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const seen = new Map();
  const idRemap = new Map();

  for (const prep of oldPreps.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)) {
    const flow = flowMap.get(prep.flowId);
    if (!flow) continue;
    let categoryGroupId = null;
    let categoryId = null;
    if (flow.categoryId) {
      categoryId = flow.categoryId;
      categoryGroupId = catMap.get(flow.categoryId)?.groupId || null;
    } else {
      categoryGroupId = flow.categoryGroupId || null;
    }
    if (!categoryGroupId) continue;

    const key = `${categoryGroupId}|${categoryId || ''}|${prep.name}`;
    if (seen.has(key)) {
      idRemap.set(prep.id, seen.get(key));
      continue;
    }
    const newId = await groupTable.add({
      categoryGroupId,
      categoryId: categoryId || null,
      name: prep.name,
      sortOrder: prep.sortOrder ?? 0,
    });
    seen.set(key, newId);
    idRemap.set(prep.id, newId);
  }

  const checks = await tx.table('runPreparationChecks').toArray();
  for (const check of checks) {
    if (check.flowPreparationId && idRemap.has(check.flowPreparationId)) {
      await tx.table('runPreparationChecks').update(check.id, {
        flowPreparationId: idRemap.get(check.flowPreparationId),
      });
    }
  }
}

async function migrateImportedFlowPreparationsToGroup(tx, payload) {
  const groupTable = tx.table('groupPreparations');
  const idRemap = new Map();
  if (await groupTable.count() > 0) return idRemap;
  const oldPreps = payload?.flowPreparations || [];
  if (!oldPreps.length) return idRemap;

  const flows = payload?.flows?.length
    ? payload.flows
    : await tx.table('flows').toArray();
  const categories = payload?.categories?.length
    ? payload.categories
    : await tx.table('categories').toArray();
  const flowMap = new Map(flows.map((f) => [f.id, f]));
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const seen = new Map();

  for (const prep of oldPreps.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)) {
    const flow = flowMap.get(prep.flowId);
    if (!flow) continue;
    let categoryGroupId = null;
    let categoryId = null;
    if (flow.categoryId) {
      categoryId = flow.categoryId;
      categoryGroupId = catMap.get(flow.categoryId)?.groupId || null;
    } else {
      categoryGroupId = flow.categoryGroupId || null;
    }
    if (!categoryGroupId) continue;

    const key = `${categoryGroupId}|${categoryId || ''}|${prep.name}`;
    if (seen.has(key)) {
      idRemap.set(prep.id, seen.get(key));
      continue;
    }
    const newId = await groupTable.add({
      categoryGroupId,
      categoryId: categoryId || null,
      name: prep.name,
      sortOrder: prep.sortOrder ?? 0,
    });
    seen.set(key, newId);
    idRemap.set(prep.id, newId);
  }
  return idRemap;
}

async function migrateLegacyRecipeCategoriesIfNeeded(tx) {
  const groups = await tx.table('recipeGroups').count();
  if (groups > 0) return;
  const olds = await tx.table('recipeCategories').toArray();
  if (!olds.length || olds[0].groupId != null) return;
  const recipes = await tx.table('recipes').toArray();
  const catMap = new Map();
  await tx.table('recipeCategories').clear();
  for (const old of olds.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)) {
    const groupId = await tx.table('recipeGroups').add({
      name: old.name,
      sortOrder: old.sortOrder ?? 0,
      linkedCategoryGroupId: null,
    });
    const subId = await tx.table('recipeCategories').add({
      groupId,
      name: 'ראשי',
      sortOrder: 1,
      linkedCategoryId: null,
    });
    catMap.set(old.id, subId);
  }
  for (const recipe of recipes) {
    const newCatId = catMap.get(recipe.categoryId);
    if (newCatId) await tx.table('recipes').update(recipe.id, { categoryId: newCatId });
  }
}

async function resolveCategoryGroupIdForFlow(flowId) {
  const flow = await db.flows.get(Number(flowId));
  if (!flow) return null;
  if (flow.categoryGroupId) return flow.categoryGroupId;
  if (flow.categoryId) {
    const cat = await db.categories.get(flow.categoryId);
    return cat?.groupId || null;
  }
  return null;
}

async function migrateImportedFlowPresetsToGroup(tx) {
  const groupTable = tx.table('groupPortionPresets');
  const existing = await groupTable.count();
  if (existing > 0) return;
  const presets = await tx.table('flowPortionPresets').toArray();
  if (!presets.length) return;
  const flows = await tx.table('flows').toArray();
  const categories = await tx.table('categories').toArray();
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const seen = new Set();
  for (const p of presets) {
    const flow = flows.find((f) => f.id === p.flowId);
    if (!flow) continue;
    let gid = flow.categoryGroupId || null;
    if (!gid && flow.categoryId) gid = catMap.get(flow.categoryId)?.groupId || null;
    if (!gid) continue;
    const key = `${gid}|${p.name}|${p.weight}|${p.extra || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await groupTable.add({
      categoryGroupId: gid,
      name: p.name,
      weight: p.weight,
      extra: p.extra || '',
      sortOrder: p.sortOrder ?? 0,
    });
  }
}

function sanitizeProductPriceUnit(raw) {
  if (raw === 'kg' || raw === 'kg_units' || raw === 'kg_with_units') return raw;
  return 'unit';
}

export function sanitizeRawMaterialsCostSource(raw) {
  if (raw === 'recipes') return 'recipes';
  return 'manual';
}

function sanitizeUnitWeightKg(raw, priceUnit) {
  if (priceUnit !== 'kg_units' && priceUnit !== 'kg_with_units') return null;
  return sanitizePortionSize(raw, { min: 0.001, max: 100_000 });
}

function sanitizeProductQuantity(raw, product, { allowZero = false } = {}) {
  if (product?.priceUnit === 'kg' || product?.priceUnit === 'kg_with_units') {
    const min = allowZero ? 0 : 0.001;
    const n = sanitizePortionSize(raw, { min, max: 100_000 });
    if (n == null && allowZero && (raw === 0 || raw === '0')) return 0;
    return n;
  }
  return sanitizeQuantity(raw, { allowZero });
}

function compareGroups(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

function compareProducts(a, b) {
  if (a.categoryId !== b.categoryId) return a.categoryId - b.categoryId;
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

export async function initDB() {
  await db.open();
  await assertProductionDbReady();
  try {
    const { ensurePurchaseCategories } = await import('./purchasing-db.js');
    await ensurePurchaseCategories();
  } catch (err) {
    console.warn('purchase categories', err);
  }
  try {
    const synced = await getSetting('recipePortionPresetsSynced');
    if (!synced) {
      const { syncAllRecipePortionPresets } = await import('./kitchen-db.js');
      await syncAllRecipePortionPresets();
      await setSetting('recipePortionPresetsSynced', true);
    }
  } catch (err) {
    console.warn('recipe portion preset sync', err);
  }
}

export async function getSetting(key) {
  const row = await db.settings.get(key);
  return row?.value ?? null;
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

const RUN_SETTINGS_KEY = 'runSettings';
const DEFAULT_RUN_SETTINGS = { autoBatchEnabled: true, nextBatchNumber: 1 };

export async function getRunSettings() {
  const raw = await getSetting(RUN_SETTINGS_KEY);
  return { ...DEFAULT_RUN_SETTINGS, ...(raw || {}) };
}

export async function setRunSettings(patch) {
  const current = await getRunSettings();
  await setSetting(RUN_SETTINGS_KEY, { ...current, ...patch });
}

export async function isDatabaseEmpty() {
  const [categories, entries] = await Promise.all([
    db.categories.count(),
    db.productionEntries.count(),
  ]);
  return categories === 0 && entries === 0;
}

export async function getCategories() {
  return db.categories.orderBy('sortOrder').toArray();
}

export async function getProducts(activeOnly = false) {
  const all = await db.products.toCollection().toArray();
  all.sort(compareProducts);
  return activeOnly ? all.filter((p) => p.active) : all;
}

export async function getCategoryGroups() {
  return db.categoryGroups.orderBy('sortOrder').toArray();
}

export async function getProductsByCategory() {
  const layout = await getProductsCatalogLayout();
  return [...layout.ungrouped, ...layout.groups.flatMap((g) => g.categories)];
}

export async function getProductsCatalogLayout() {
  const [groups, categories, products] = await Promise.all([
    getCategoryGroups(),
    getCategories(),
    getProducts(),
  ]);
  const map = new Map(categories.map((c) => [c.id, { ...c, products: [] }]));
  for (const p of products) {
    map.get(p.categoryId)?.products.push(p);
  }
  for (const cat of map.values()) {
    cat.products.sort(compareProducts);
  }
  const allCategories = categories.map((c) => map.get(c.id)).filter(Boolean);
  const grouped = groups.map((group) => ({
    ...group,
    categories: allCategories.filter((c) => Number(c.groupId) === Number(group.id)),
  }));
  const ungrouped = allCategories.filter((c) => !c.groupId);
  return { groups: grouped, ungrouped, allCategories };
}

export async function addCategoryGroup(name, color = null) {
  const clean = sanitizeName(name);
  if (!clean) throw new ValidationError('שם קטגוריה כללית לא תקין');
  const maxOrder = await db.categoryGroups.orderBy('sortOrder').last();
  const count = await db.categoryGroups.count();
  const resolvedColor = sanitizeCategoryColor(color) || defaultColorForIndex(count);
  return db.categoryGroups.add({
    name: clean,
    sortOrder: (maxOrder?.sortOrder ?? 0) + 1,
    color: resolvedColor,
  });
}

export async function updateCategoryGroup(id, { name, color } = {}) {
  const patch = {};
  if (name != null) {
    const clean = sanitizeName(name);
    if (!clean) throw new ValidationError('שם קטגוריה כללית לא תקין');
    patch.name = clean;
  }
  if (color !== undefined) {
    const resolved = sanitizeCategoryColor(color);
    if (color && !resolved) throw new ValidationError('צבע לא תקין');
    patch.color = resolved || defaultColorForIndex(Number(id) || 0);
  }
  if (!Object.keys(patch).length) return;
  return db.categoryGroups.update(id, patch);
}

export async function deleteCategoryGroup(id) {
  const gid = Number(id);
  await db.transaction('rw', db.categoryGroups, db.categories, async () => {
    await db.categories.where('groupId').equals(gid).modify({ groupId: null });
    await db.categoryGroups.delete(gid);
  });
}

export async function setCategoryGroupOrder(groupIds) {
  if (!Array.isArray(groupIds) || !groupIds.length) return;
  await db.transaction('rw', db.categoryGroups, async () => {
    for (let i = 0; i < groupIds.length; i++) {
      const id = sanitizeProductId(groupIds[i]);
      if (!id) continue;
      const group = await db.categoryGroups.get(id);
      if (group) await db.categoryGroups.update(id, { sortOrder: i + 1 });
    }
  });
}

export async function setCategoriesInGroup(groupId, categoryIds) {
  const gid = groupId ? Number(groupId) : null;
  if (!gid) throw new ValidationError('קבוצה לא תקינה');
  const ids = new Set((categoryIds || []).map(Number).filter(Boolean));
  await db.transaction('rw', db.categories, async () => {
    const current = await db.categories.where('groupId').equals(gid).toArray();
    for (const cat of current) {
      if (!ids.has(cat.id)) await db.categories.update(cat.id, { groupId: null });
    }
    for (const cid of ids) {
      await db.categories.update(cid, { groupId: gid });
    }
  });
}

export async function setCategoryOrderInContainer(groupId, categoryIds) {
  if (!Array.isArray(categoryIds) || !categoryIds.length) return;
  const gid = groupId ? Number(groupId) : null;
  await db.transaction('rw', db.categories, async () => {
    for (let i = 0; i < categoryIds.length; i++) {
      const id = sanitizeProductId(categoryIds[i]);
      if (!id) continue;
      const cat = await db.categories.get(id);
      if (!cat) continue;
      if (gid && Number(cat.groupId) !== gid) continue;
      if (!gid && cat.groupId) continue;
      await db.categories.update(id, { sortOrder: i + 1 });
    }
  });
}

export async function addCategory(name, color = null, groupId = null) {
  const clean = sanitizeName(name);
  if (!clean) throw new ValidationError('שם קטגוריה לא תקין');
  const maxOrder = await db.categories.orderBy('sortOrder').last();
  const count = await db.categories.count();
  const resolvedColor = sanitizeCategoryColor(color) || defaultColorForIndex(count);
  const gid = groupId ? sanitizeProductId(groupId) : null;
  return db.categories.add({
    name: clean,
    sortOrder: (maxOrder?.sortOrder ?? 0) + 1,
    color: resolvedColor,
    groupId: gid || null,
  });
}

export async function updateCategory(id, { name, color, groupId } = {}) {
  const patch = {};
  if (name != null) {
    const clean = sanitizeName(name);
    if (!clean) throw new ValidationError('שם קטגוריה לא תקין');
    patch.name = clean;
  }
  if (color !== undefined) {
    const resolved = sanitizeCategoryColor(color);
    if (color && !resolved) throw new ValidationError('צבע לא תקין');
    patch.color = resolved || defaultColorForIndex(Number(id) || 0);
  }
  if (groupId !== undefined) {
    patch.groupId = groupId ? sanitizeProductId(groupId) : null;
  }
  if (!Object.keys(patch).length) return;
  return db.categories.update(id, patch);
}

export async function getProduct(id) {
  return db.products.get(id);
}

export async function deleteCategory(id, { cascade = false } = {}) {
  const products = await db.products.where('categoryId').equals(id).toArray();
  if (products.length > 0 && !cascade) {
    const err = new Error('HAS_PRODUCTS');
    err.productCount = products.length;
    throw err;
  }

  await db.transaction('rw', db.products, db.productionEntries, db.targets, db.categories, async () => {
    for (const p of products) {
      await db.productionEntries.where('productId').equals(p.id).delete();
      const prodTargets = await db.targets.where('scope').equals('product').toArray();
      for (const t of prodTargets.filter((x) => x.scopeId === p.id)) {
        await db.targets.delete(t.id);
      }
    }
    await db.products.where('categoryId').equals(id).delete();
    const catTargets = await db.targets.where('scope').equals('category').toArray();
    for (const t of catTargets.filter((x) => x.scopeId === id)) {
      await db.targets.delete(t.id);
    }
    await db.categories.delete(id);
  });
}

export async function resetAllData() {
  await db.transaction('rw', db.categories, db.categoryGroups, db.products, db.productionEntries, db.targets, db.processLogs, db.activityPresets, db.flows, db.flowSteps, db.flowPortionPresets, db.groupPortionPresets, db.groupPreparations, db.flowCleaningTasks, db.productionRuns, db.runStepStates, db.productPreparations, db.runPreparationChecks, db.runCleaningChecks, db.recipeGroups, db.recipeCategories, db.recipes, db.recipeIngredients, db.recipeProductLinks, db.recipeProductCategoryLinks, db.recipeProductGroupLinks, db.productRecipeComponents, db.supplierCategories, db.suppliers, db.rawMaterials, db.rawMaterialPriceHistory, db.weeklyProductionPlans, db.weeklyProductionPlanItems, db.managerPlans, db.managerPlanItems, db.managerTasks, db.managerIncidents, db.managerShiftNotes, db.managerResponsibilityAreas, db.managerEmployees, db.managerDepartments, db.departmentCleaningLists, db.departmentCleaningTasks, async () => {
    await db.weeklyProductionPlanItems.clear();
    await db.weeklyProductionPlans.clear();
    await db.productRecipeComponents.clear();
    await db.recipeIngredients.clear();
    await db.recipeProductCategoryLinks.clear();
    await db.recipeProductGroupLinks.clear();
    await db.recipeProductLinks.clear();
    await db.recipes.clear();
    await db.recipeCategories.clear();
    await db.recipeGroups.clear();
    await db.rawMaterialPriceHistory?.clear?.();
    await db.rawMaterials.clear();
    await db.suppliers.clear();
    await db.supplierCategories.clear();
    await db.productionEntries.clear();
    await db.processLogs.clear();
    await db.flowPortionPresets.clear();
    await db.groupPortionPresets.clear();
    await db.groupPreparations.clear();
    await db.flowCleaningTasks.clear();
    await db.flowSteps.clear();
    await db.flows.clear();
    await db.runPreparationChecks.clear();
    await db.runCleaningChecks.clear();
    await db.runStepStates.clear();
    await db.productionRuns.clear();
    await db.managerPlanItems.clear();
    await db.managerPlans.clear();
    await db.managerTasks.clear();
    await db.managerIncidents.clear();
    await db.managerShiftNotes.clear();
    await db.managerEmployees.clear();
    await db.managerResponsibilityAreas.clear();
    await db.managerDepartments.clear();
    await db.departmentCleaningTasks?.clear?.();
    await db.departmentCleaningLists?.clear?.();
    await db.products.clear();
    await db.categories.clear();
    await db.categoryGroups.clear();
    await db.targets.clear();
    const defaults = ['הכנת בצק', 'שקילות', 'אריזה', 'אפייה', 'קישוט', 'ערבוב', 'קירור'];
    await db.activityPresets.clear();
    await db.activityPresets.bulkAdd(defaults.map((name) => ({ categoryId: 0, name })));
    for (const d of DEFAULT_MANAGER_DEPARTMENTS) {
      await db.managerDepartments.add({ ...d, active: true });
    }
    const recipeDefaults = ['מפעל', 'מאפייה', 'פרטי', 'מהאינטרנט', 'אחר'];
    for (let i = 0; i < recipeDefaults.length; i++) {
      const groupId = await db.recipeGroups.add({ name: recipeDefaults[i], sortOrder: i + 1, linkedCategoryGroupId: null });
      await db.recipeCategories.add({ groupId, name: 'ראשי', sortOrder: 1, linkedCategoryId: null });
    }
    const supplierDefaults = ['חומרי גלם יבשים', 'חלב ומוצריו', 'ירקות ופירות', 'אריזה', 'אחר'];
    await db.supplierCategories.bulkAdd(supplierDefaults.map((name, i) => ({ name, sortOrder: i + 1 })));
  });
}

const SETTINGS_SKIP_EXPORT = new Set(['backupFileHandle', 'backupDirectoryHandle']);

function compareCategories(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

function stripProductForImport(raw) {
  return {
    id: raw.id,
    categoryId: raw.categoryId,
    name: raw.name,
    active: raw.active !== false,
    sortOrder: raw.sortOrder ?? 0,
    unitPrice: sanitizeMoney(raw.unitPrice),
    priceUnit: sanitizeProductPriceUnit(raw.priceUnit),
    rawMaterialsCost: sanitizeMoney(raw.rawMaterialsCost),
    rawMaterialsCostSource: sanitizeRawMaterialsCostSource(raw.rawMaterialsCostSource),
    packagingCost: sanitizeMoney(raw.packagingCost),
    additionalCosts: sanitizeMoney(raw.additionalCosts),
  };
}

function stripCategoryForImport(raw, index) {
  return {
    id: raw.id,
    name: raw.name,
    sortOrder: raw.sortOrder ?? index + 1,
    color: sanitizeCategoryColor(raw.color) || defaultColorForIndex(index),
    groupId: raw.groupId ? Number(raw.groupId) : null,
  };
}

function stripCategoryGroupForImport(raw, index) {
  return {
    id: raw.id,
    name: raw.name,
    sortOrder: raw.sortOrder ?? index + 1,
    color: sanitizeCategoryColor(raw.color) || defaultColorForIndex(index),
  };
}

export async function exportAllData() {
  const [
    categories,
    categoryGroups,
    products,
    productionEntries,
    targets,
    processLogs,
    activityPresets,
    flowSteps,
    flows,
    flowPortionPresets,
    groupPortionPresets,
    portionPresetLinks,
    portionPresetIngredientSettings,
    groupPreparations,
    checklistTasks,
    flowChecklistItems,
    flowCleaningTasks,
    productionRuns,
    runStepStates,
    productPreparations,
    runPreparationChecks,
    runCleaningChecks,
    settingsRows,
    managerPlans,
    managerPlanItems,
    managerTasks,
    managerIncidents,
    managerShiftNotes,
    managerResponsibilityAreas,
    managerEmployees,
    managerDepartments,
    departmentCleaningLists,
    departmentCleaningTasks,
    recipeGroups,
    recipeCategories,
    recipes,
    recipeIngredients,
    recipeProductLinks,
    recipeProductCategoryLinks,
    recipeProductGroupLinks,
    supplierCategories,
    suppliers,
    rawMaterials,
    rawMaterialPriceHistory,
    supplierShortages,
    weeklyProductionPlans,
    weeklyProductionPlanItems,
    bakingProfiles,
    bakingProfileProducts,
    bakingProfileScopes,
    productRecipeComponents,
    productFlowLinks,
    productionMachines,
    productionMachineFields,
    productionMachineProducts,
    productionMachineProductValues,
    purchaseCategories,
    purchaseItems,
  ] = await Promise.all([
    db.categories.toArray(),
    db.categoryGroups.toArray(),
    db.products.toArray(),
    db.productionEntries.toArray(),
    db.targets.toArray(),
    db.processLogs.toArray(),
    db.activityPresets.toArray(),
    db.flowSteps.toArray(),
    db.flows.toArray(),
    db.flowPortionPresets.toArray(),
    db.groupPortionPresets.toArray(),
    db.portionPresetLinks?.toArray?.() ?? Promise.resolve([]),
    db.portionPresetIngredientSettings?.toArray?.() ?? Promise.resolve([]),
    db.groupPreparations.toArray(),
    db.checklistTasks?.toArray?.() ?? Promise.resolve([]),
    db.flowChecklistItems?.toArray?.() ?? Promise.resolve([]),
    db.flowCleaningTasks?.toArray?.() ?? Promise.resolve([]),
    db.productionRuns.toArray(),
    db.runStepStates.toArray(),
    db.productPreparations.toArray(),
    db.runPreparationChecks.toArray(),
    db.runCleaningChecks?.toArray?.() ?? Promise.resolve([]),
    db.settings.toArray(),
    db.managerPlans.toArray(),
    db.managerPlanItems.toArray(),
    db.managerTasks.toArray(),
    db.managerIncidents.toArray(),
    db.managerShiftNotes.toArray(),
    db.managerResponsibilityAreas.toArray(),
    db.managerEmployees.toArray(),
    db.managerDepartments?.toArray?.() ?? Promise.resolve([]),
    db.departmentCleaningLists?.toArray?.() ?? Promise.resolve([]),
    db.departmentCleaningTasks?.toArray?.() ?? Promise.resolve([]),
    db.recipeGroups.toArray(),
    db.recipeCategories.toArray(),
    db.recipes.toArray(),
    db.recipeIngredients.toArray(),
    db.recipeProductLinks.toArray(),
    db.recipeProductCategoryLinks?.toArray?.() ?? Promise.resolve([]),
    db.recipeProductGroupLinks?.toArray?.() ?? Promise.resolve([]),
    db.supplierCategories.toArray(),
    db.suppliers.toArray(),
    db.rawMaterials.toArray(),
    db.rawMaterialPriceHistory?.toArray?.() ?? Promise.resolve([]),
    db.supplierShortages?.toArray?.() ?? Promise.resolve([]),
    db.weeklyProductionPlans.toArray(),
    db.weeklyProductionPlanItems.toArray(),
    db.bakingProfiles?.toArray?.() ?? Promise.resolve([]),
    db.bakingProfileProducts?.toArray?.() ?? Promise.resolve([]),
    db.bakingProfileScopes?.toArray?.() ?? Promise.resolve([]),
    db.productRecipeComponents?.toArray?.() ?? Promise.resolve([]),
    db.productFlowLinks?.toArray?.() ?? Promise.resolve([]),
    db.productionMachines?.toArray?.() ?? Promise.resolve([]),
    db.productionMachineFields?.toArray?.() ?? Promise.resolve([]),
    db.productionMachineProducts?.toArray?.() ?? Promise.resolve([]),
    db.productionMachineProductValues?.toArray?.() ?? Promise.resolve([]),
    db.purchaseCategories?.toArray?.() ?? Promise.resolve([]),
    db.purchaseItems?.toArray?.() ?? Promise.resolve([]),
  ]);
  return {
    categories: categories.slice().sort(compareCategories),
    categoryGroups: categoryGroups.slice().sort(compareGroups),
    products: products.slice().sort(compareProducts),
    productionEntries,
    targets,
    processLogs,
    activityPresets,
    flowSteps,
    flows,
    flowPortionPresets,
    groupPortionPresets,
    portionPresetLinks,
    portionPresetIngredientSettings,
    groupPreparations,
    checklistTasks,
    flowChecklistItems,
    flowCleaningTasks,
    productionRuns,
    runStepStates,
    productPreparations,
    runPreparationChecks,
    runCleaningChecks,
    managerPlans,
    managerPlanItems,
    managerTasks,
    managerIncidents,
    managerShiftNotes,
    managerResponsibilityAreas,
    managerEmployees,
    managerDepartments,
    departmentCleaningLists,
    departmentCleaningTasks,
    recipeGroups,
    recipeCategories,
    recipes,
    recipeIngredients,
    recipeProductLinks,
    recipeProductCategoryLinks,
    recipeProductGroupLinks,
    supplierCategories,
    suppliers,
    rawMaterials,
    rawMaterialPriceHistory,
    supplierShortages,
    weeklyProductionPlans,
    weeklyProductionPlanItems,
    bakingProfiles,
    bakingProfileProducts,
    bakingProfileScopes,
    productRecipeComponents,
    productFlowLinks,
    productionMachines,
    productionMachineFields,
    productionMachineProducts,
    productionMachineProductValues,
    purchaseCategories,
    purchaseItems,
    settings: settingsRows
      .filter((row) => row?.key && !SETTINGS_SKIP_EXPORT.has(row.key))
      .map((row) => ({ key: row.key, value: row.value })),
  };
}

export async function importAllData(payload) {
  const tables = [
    'categories',
    'products',
    'productionEntries',
    'targets',
    'processLogs',
    'activityPresets',
  ];
  for (const key of tables) {
    if (!Array.isArray(payload[key])) {
      throw new ValidationError(`נתוני גיבוי לא תקינים: ${key}`);
    }
  }
  if (!Array.isArray(payload.categoryGroups)) {
    payload.categoryGroups = [];
  }
  if (!Array.isArray(payload.flowSteps)) payload.flowSteps = [];
  if (!Array.isArray(payload.flows)) payload.flows = [];
  if (!Array.isArray(payload.flowPortionPresets)) payload.flowPortionPresets = [];
  if (!Array.isArray(payload.groupPortionPresets)) payload.groupPortionPresets = [];
  if (!Array.isArray(payload.portionPresetLinks)) payload.portionPresetLinks = [];
  if (!Array.isArray(payload.portionPresetIngredientSettings)) payload.portionPresetIngredientSettings = [];
  if (!Array.isArray(payload.groupPreparations)) payload.groupPreparations = [];
  if (!Array.isArray(payload.flowPreparations)) payload.flowPreparations = [];
  if (!Array.isArray(payload.productionRuns)) payload.productionRuns = [];
  if (!Array.isArray(payload.runStepStates)) payload.runStepStates = [];
  if (!Array.isArray(payload.productPreparations)) payload.productPreparations = [];
  if (!Array.isArray(payload.runPreparationChecks)) payload.runPreparationChecks = [];
  if (!Array.isArray(payload.flowCleaningTasks)) payload.flowCleaningTasks = [];
  if (!Array.isArray(payload.checklistTasks)) payload.checklistTasks = [];
  if (!Array.isArray(payload.flowChecklistItems)) payload.flowChecklistItems = [];
  if (!Array.isArray(payload.runCleaningChecks)) payload.runCleaningChecks = [];
  if (!Array.isArray(payload.weeklyProductionPlanItems)) payload.weeklyProductionPlanItems = [];
  if (!Array.isArray(payload.recipeGroups)) payload.recipeGroups = [];
  if (!Array.isArray(payload.recipeProductLinks)) payload.recipeProductLinks = [];
  if (!Array.isArray(payload.recipeProductCategoryLinks)) payload.recipeProductCategoryLinks = [];
  if (!Array.isArray(payload.recipeProductGroupLinks)) payload.recipeProductGroupLinks = [];
  if (!Array.isArray(payload.recipeCategories)) payload.recipeCategories = [];
  if (!Array.isArray(payload.recipes)) payload.recipes = [];
  if (!Array.isArray(payload.recipeIngredients)) payload.recipeIngredients = [];
  if (!Array.isArray(payload.supplierCategories)) payload.supplierCategories = [];
  if (!Array.isArray(payload.suppliers)) payload.suppliers = [];
  if (!Array.isArray(payload.rawMaterials)) payload.rawMaterials = [];
  if (!Array.isArray(payload.rawMaterialPriceHistory)) payload.rawMaterialPriceHistory = [];
  if (!Array.isArray(payload.supplierShortages)) payload.supplierShortages = [];
  if (!Array.isArray(payload.weeklyProductionPlans)) payload.weeklyProductionPlans = [];
  if (!Array.isArray(payload.managerPlans)) payload.managerPlans = [];
  if (!Array.isArray(payload.managerPlanItems)) payload.managerPlanItems = [];
  if (!Array.isArray(payload.purchaseCategories)) payload.purchaseCategories = [];
  if (!Array.isArray(payload.purchaseItems)) payload.purchaseItems = [];
  if (!Array.isArray(payload.managerTasks)) payload.managerTasks = [];
  if (!Array.isArray(payload.managerIncidents)) payload.managerIncidents = [];
  if (!Array.isArray(payload.managerShiftNotes)) payload.managerShiftNotes = [];
  if (!Array.isArray(payload.managerResponsibilityAreas)) payload.managerResponsibilityAreas = [];
  if (!Array.isArray(payload.managerEmployees)) payload.managerEmployees = [];
  if (!Array.isArray(payload.managerDepartments)) payload.managerDepartments = [];
  if (!Array.isArray(payload.departmentCleaningLists)) payload.departmentCleaningLists = [];
  if (!Array.isArray(payload.departmentCleaningTasks)) payload.departmentCleaningTasks = [];
  if (!Array.isArray(payload.bakingProfiles)) payload.bakingProfiles = [];
  if (!Array.isArray(payload.bakingProfileProducts)) payload.bakingProfileProducts = [];
  if (!Array.isArray(payload.bakingProfileScopes)) payload.bakingProfileScopes = [];
  if (!Array.isArray(payload.productRecipeComponents)) payload.productRecipeComponents = [];
  if (!Array.isArray(payload.productFlowLinks)) payload.productFlowLinks = [];
  if (!Array.isArray(payload.productionMachines)) payload.productionMachines = [];
  if (!Array.isArray(payload.productionMachineFields)) payload.productionMachineFields = [];
  if (!Array.isArray(payload.productionMachineProducts)) payload.productionMachineProducts = [];
  if (!Array.isArray(payload.productionMachineProductValues)) payload.productionMachineProductValues = [];

  if (!payload.flows.length && payload.flowSteps.length) {
    payload.flows = migrateLegacyFlowStepsToFlows(payload.flowSteps);
  }

  const categoryGroups = payload.categoryGroups
    .slice()
    .sort(compareGroups)
    .map(stripCategoryGroupForImport);
  const categories = payload.categories
    .slice()
    .sort(compareCategories)
    .map(stripCategoryForImport);
  const products = payload.products
    .slice()
    .sort(compareProducts)
    .map(stripProductForImport);

  await db.transaction(
    'rw',
    ...pickDbTables(
      'categories', 'categoryGroups', 'products', 'productionEntries', 'targets', 'processLogs',
      'activityPresets', 'flowSteps', 'flows', 'flowPortionPresets', 'groupPortionPresets', 'portionPresetLinks', 'portionPresetIngredientSettings',
      'groupPreparations', 'checklistTasks', 'flowChecklistItems', 'flowCleaningTasks',
      'productionRuns', 'runStepStates', 'productPreparations', 'runPreparationChecks',
      'runCleaningChecks', 'settings', 'managerPlans', 'managerPlanItems', 'managerTasks',
      'managerIncidents', 'managerShiftNotes', 'managerResponsibilityAreas', 'managerEmployees',
      'managerDepartments', 'departmentCleaningLists', 'departmentCleaningTasks',
      'recipeGroups', 'recipeProductLinks', 'recipeProductCategoryLinks', 'recipeProductGroupLinks',
      'recipeCategories', 'recipes', 'recipeIngredients', 'supplierCategories', 'suppliers',
      'rawMaterials', 'rawMaterialPriceHistory', 'supplierShortages', 'weeklyProductionPlans',
      'weeklyProductionPlanItems', 'bakingProfiles', 'bakingProfileProducts', 'bakingProfileScopes',
      'productRecipeComponents',
      'productFlowLinks',
      'productionMachines', 'productionMachineFields', 'productionMachineProducts', 'productionMachineProductValues',
      'purchaseCategories', 'purchaseItems',
    ),
    async (tx) => {
      await db.productionEntries.clear();
      await db.processLogs.clear();
      await db.weeklyProductionPlanItems.clear();
      await db.weeklyProductionPlans.clear();
      await db.productRecipeComponents.clear();
      await db.productFlowLinks?.clear?.();
      await db.productionMachineProductValues?.clear?.();
      await db.productionMachineProducts?.clear?.();
      await db.productionMachineFields?.clear?.();
      await db.productionMachines?.clear?.();
      await db.purchaseItems?.clear?.();
      await db.purchaseCategories?.clear?.();
      await db.recipeIngredients.clear();
      await db.recipeProductLinks.clear();
      await db.recipeProductCategoryLinks.clear();
      await db.recipeProductGroupLinks.clear();
      await db.recipes.clear();
      await db.recipeCategories.clear();
      await db.recipeGroups.clear();
      await db.bakingProfileProducts?.clear?.();
      await db.bakingProfileScopes?.clear?.();
      await db.bakingProfiles?.clear?.();
      await db.rawMaterialPriceHistory?.clear?.();
      await db.rawMaterials.clear();
      await db.supplierShortages?.clear?.();
      await db.suppliers.clear();
      await db.supplierCategories.clear();
      await db.runPreparationChecks.clear();
      await db.runCleaningChecks?.clear?.();
      await db.runStepStates.clear();
      await db.productionRuns.clear();
      await db.flowPortionPresets.clear();
      await db.groupPortionPresets.clear();
      await db.portionPresetLinks?.clear?.();
      await db.portionPresetIngredientSettings?.clear?.();
      await db.groupPreparations.clear();
      await db.flowCleaningTasks?.clear?.();
      await db.flowChecklistItems?.clear?.();
      await db.checklistTasks?.clear?.();
      await db.flowSteps.clear();
      await db.flows.clear();
      await db.managerPlanItems.clear();
      await db.managerPlans.clear();
      await db.managerTasks.clear();
      await db.managerIncidents.clear();
      await db.managerShiftNotes.clear();
      await db.managerEmployees.clear();
      await db.managerResponsibilityAreas.clear();
      await db.departmentCleaningTasks?.clear?.();
      await db.departmentCleaningLists?.clear?.();
      await db.productPreparations.clear();
      await db.products.clear();
      await db.categories.clear();
      await db.categoryGroups.clear();
      await db.targets.clear();
      await db.activityPresets.clear();

      if (categoryGroups.length) await db.categoryGroups.bulkPut(categoryGroups);
      if (categories.length) await db.categories.bulkPut(categories);
      if (products.length) await db.products.bulkPut(products);
      if (payload.productionEntries.length) await db.productionEntries.bulkPut(payload.productionEntries);
      if (payload.targets.length) await db.targets.bulkPut(payload.targets);
      if (payload.processLogs.length) await db.processLogs.bulkPut(payload.processLogs);
      if (payload.flows.length) await db.flows.bulkPut(payload.flows);
      if (payload.flowSteps.length) await db.flowSteps.bulkPut(payload.flowSteps);
      if (payload.flowPortionPresets.length) await db.flowPortionPresets.bulkPut(payload.flowPortionPresets);
      if (payload.groupPortionPresets.length) {
        await db.groupPortionPresets.bulkPut(payload.groupPortionPresets);
      }
      if (payload.portionPresetLinks?.length) {
        await db.portionPresetLinks.bulkPut(payload.portionPresetLinks);
      } else {
        await migrateImportedFlowPresetsToGroup(tx);
      }
      if (payload.portionPresetIngredientSettings?.length) {
        await db.portionPresetIngredientSettings.bulkPut(payload.portionPresetIngredientSettings);
      }
      if (payload.groupPreparations.length) {
        await db.groupPreparations.bulkPut(payload.groupPreparations);
      } else if (payload.flowPreparations.length) {
        const prepIdRemap = await migrateImportedFlowPreparationsToGroup(tx, payload);
        if (prepIdRemap.size && payload.runPreparationChecks.length) {
          payload.runPreparationChecks = payload.runPreparationChecks.map((check) => {
            if (!check.flowPreparationId || !prepIdRemap.has(check.flowPreparationId)) return check;
            return { ...check, flowPreparationId: prepIdRemap.get(check.flowPreparationId) };
          });
        }
      }
      if (payload.productionRuns.length) await db.productionRuns.bulkPut(payload.productionRuns);
      if (payload.runStepStates.length) await db.runStepStates.bulkPut(payload.runStepStates);
      if (payload.productPreparations.length) await db.productPreparations.bulkPut(payload.productPreparations);
      if (payload.runPreparationChecks.length) await db.runPreparationChecks.bulkPut(payload.runPreparationChecks);
      if (payload.flowCleaningTasks.length) await db.flowCleaningTasks.bulkPut(payload.flowCleaningTasks);
      if (payload.checklistTasks.length) await db.checklistTasks.bulkPut(payload.checklistTasks);
      if (payload.flowChecklistItems.length) await db.flowChecklistItems.bulkPut(payload.flowChecklistItems);
      if (payload.runCleaningChecks.length) await db.runCleaningChecks.bulkPut(payload.runCleaningChecks);
      if (payload.recipeGroups.length) await db.recipeGroups.bulkPut(payload.recipeGroups);
      if (payload.recipeCategories.length) await db.recipeCategories.bulkPut(payload.recipeCategories);
      if (payload.recipes.length) await db.recipes.bulkPut(payload.recipes);
      if (payload.recipeIngredients.length) await db.recipeIngredients.bulkPut(payload.recipeIngredients);
      if (payload.recipeProductLinks.length) await db.recipeProductLinks.bulkPut(payload.recipeProductLinks);
      if (payload.recipeProductCategoryLinks.length) {
        await db.recipeProductCategoryLinks.bulkPut(payload.recipeProductCategoryLinks);
      }
      if (payload.recipeProductGroupLinks.length) {
        await db.recipeProductGroupLinks.bulkPut(payload.recipeProductGroupLinks);
      }
      await migrateRecipeProductScopeLinks(tx);
      if (payload.bakingProfiles?.length) await db.bakingProfiles.bulkPut(payload.bakingProfiles);
      if (payload.bakingProfileProducts?.length) {
        await db.bakingProfileProducts.bulkPut(payload.bakingProfileProducts);
      }
      if (payload.bakingProfileScopes?.length) {
        await db.bakingProfileScopes.bulkPut(payload.bakingProfileScopes);
      }
      if (payload.productRecipeComponents?.length) {
        await db.productRecipeComponents.bulkPut(payload.productRecipeComponents);
      }
      if (payload.productFlowLinks?.length) {
        await db.productFlowLinks.bulkPut(payload.productFlowLinks);
      }
      if (payload.productionMachines?.length) await db.productionMachines.bulkPut(payload.productionMachines);
      if (payload.productionMachineFields?.length) {
        await db.productionMachineFields.bulkPut(payload.productionMachineFields);
      }
      if (payload.productionMachineProducts?.length) {
        await db.productionMachineProducts.bulkPut(payload.productionMachineProducts);
      }
      if (payload.productionMachineProductValues?.length) {
        await db.productionMachineProductValues.bulkPut(payload.productionMachineProductValues);
      }
      if (payload.purchaseCategories?.length) {
        await db.purchaseCategories.bulkPut(payload.purchaseCategories);
      } else {
        await db.purchaseCategories.bulkAdd([
          { catKey: 'accessories', name: 'אביזרים', sortOrder: 1 },
          { catKey: 'machines', name: 'מכונות', sortOrder: 2 },
        ]);
      }
      if (payload.purchaseItems?.length) await db.purchaseItems.bulkPut(payload.purchaseItems);
      await migrateLegacyRecipeCategoriesIfNeeded(tx);
      if (payload.supplierCategories.length) await db.supplierCategories.bulkPut(payload.supplierCategories);
      if (payload.suppliers.length) await db.suppliers.bulkPut(payload.suppliers);
      if (payload.rawMaterials.length) await db.rawMaterials.bulkPut(payload.rawMaterials);
      if (payload.supplierShortages?.length) await db.supplierShortages.bulkPut(payload.supplierShortages);
      if (payload.rawMaterialPriceHistory?.length) await db.rawMaterialPriceHistory.bulkPut(payload.rawMaterialPriceHistory);
      if (payload.weeklyProductionPlans.length) await db.weeklyProductionPlans.bulkPut(payload.weeklyProductionPlans);
      if (payload.weeklyProductionPlanItems.length) {
        await db.weeklyProductionPlanItems.bulkPut(payload.weeklyProductionPlanItems);
      }
      if (payload.managerPlans.length) await db.managerPlans.bulkPut(payload.managerPlans);
      if (payload.managerPlanItems.length) await db.managerPlanItems.bulkPut(payload.managerPlanItems);
      if (payload.managerTasks.length) await db.managerTasks.bulkPut(payload.managerTasks);
      if (payload.managerIncidents.length) await db.managerIncidents.bulkPut(payload.managerIncidents);
      if (payload.managerShiftNotes.length) await db.managerShiftNotes.bulkPut(payload.managerShiftNotes);
      if (payload.managerResponsibilityAreas.length) {
        await db.managerResponsibilityAreas.bulkPut(payload.managerResponsibilityAreas);
      }
      if (payload.managerEmployees.length) await db.managerEmployees.bulkPut(payload.managerEmployees);
      if (payload.managerDepartments.length) {
        await db.managerDepartments.bulkPut(payload.managerDepartments);
      } else {
        for (const d of DEFAULT_MANAGER_DEPARTMENTS) {
          await db.managerDepartments.add({ ...d, active: true });
        }
      }
      if (payload.departmentCleaningLists?.length) {
        await db.departmentCleaningLists.bulkPut(payload.departmentCleaningLists);
      }
      if (payload.departmentCleaningTasks?.length) {
        await db.departmentCleaningTasks.bulkPut(payload.departmentCleaningTasks);
      }
      if (payload.activityPresets.length) {
        await db.activityPresets.bulkPut(payload.activityPresets);
      } else {
        const defaults = ['הכנת בצק', 'שקילות', 'אריזה', 'אפייה', 'קישוט', 'ערבוב', 'קירור'];
        await db.activityPresets.bulkAdd(defaults.map((name) => ({ categoryId: 0, name })));
      }

      if (Array.isArray(payload.settings)) {
        for (const row of payload.settings) {
          if (!row?.key || SETTINGS_SKIP_EXPORT.has(row.key)) continue;
          await db.settings.put({ key: row.key, value: row.value });
        }
      }
    }
  );
  const { repairRecipeCategoryPlacement } = await import('./kitchen-db.js');
  await repairRecipeCategoryPlacement();
}

function productDefaults(fields) {
  const name = sanitizeName(fields.name);
  if (!name) throw new ValidationError('שם מוצר לא תקין');
  const categoryId = sanitizeProductId(fields.categoryId);
  if (!categoryId) throw new ValidationError('קטגוריה לא תקינה');
  return {
    categoryId,
    name,
    unitPrice: sanitizeMoney(fields.unitPrice),
    priceUnit: sanitizeProductPriceUnit(fields.priceUnit),
    unitWeightKg: sanitizeUnitWeightKg(fields.unitWeightKg, sanitizeProductPriceUnit(fields.priceUnit)),
    rawMaterialsCost: sanitizeMoney(fields.rawMaterialsCost),
    rawMaterialsCostSource: sanitizeRawMaterialsCostSource(fields.rawMaterialsCostSource),
    packagingCost: sanitizeMoney(fields.packagingCost),
    additionalCosts: sanitizeMoney(fields.additionalCosts),
    active: fields.active !== false,
  };
}

export async function addProduct(fields) {
  const data = productDefaults(fields);
  const inCategory = await db.products.where('categoryId').equals(data.categoryId).toArray();
  const maxOrder = inCategory.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0);
  return db.products.add({ ...data, sortOrder: maxOrder + 1 });
}

export async function updateProduct(id, data) {
  const patch = { ...data };
  if ('name' in patch) {
    const name = sanitizeName(patch.name);
    if (!name) throw new ValidationError('שם מוצר לא תקין');
    patch.name = name;
  }
  if ('categoryId' in patch) {
    const cid = sanitizeProductId(patch.categoryId);
    if (!cid) throw new ValidationError('קטגוריה לא תקינה');
    patch.categoryId = cid;
    const existing = await db.products.get(id);
    if (existing && existing.categoryId !== cid) {
      const inNew = await db.products.where('categoryId').equals(cid).toArray();
      const maxOrder = inNew.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0);
      patch.sortOrder = maxOrder + 1;
    }
  }
  for (const key of ['unitPrice', 'rawMaterialsCost', 'packagingCost', 'additionalCosts']) {
    if (key in patch) patch[key] = sanitizeMoney(patch[key]);
  }
  if ('rawMaterialsCostSource' in patch) {
    patch.rawMaterialsCostSource = sanitizeRawMaterialsCostSource(patch.rawMaterialsCostSource);
  }
  if ('priceUnit' in patch) patch.priceUnit = sanitizeProductPriceUnit(patch.priceUnit);
  if ('unitWeightKg' in patch || 'priceUnit' in patch) {
    const existing = await db.products.get(id);
    const unit = patch.priceUnit ?? existing?.priceUnit;
    if ('unitWeightKg' in patch) {
      patch.unitWeightKg = sanitizeUnitWeightKg(patch.unitWeightKg, unit);
    } else if (unit !== 'kg_units' && unit !== 'kg_with_units') {
      patch.unitWeightKg = null;
    }
  }
  return db.products.update(id, patch);
}

export async function setCategoryOrder(categoryIds) {
  if (!Array.isArray(categoryIds) || !categoryIds.length) return;

  await db.transaction('rw', db.categories, async () => {
    for (let i = 0; i < categoryIds.length; i++) {
      const id = sanitizeProductId(categoryIds[i]);
      if (!id) continue;
      const cat = await db.categories.get(id);
      if (cat) await db.categories.update(id, { sortOrder: i + 1 });
    }
  });
}

export async function setProductOrderInCategory(categoryId, productIds) {
  const cid = sanitizeProductId(categoryId);
  if (!cid) throw new ValidationError('קטגוריה לא תקינה');
  if (!Array.isArray(productIds) || !productIds.length) return;

  await db.transaction('rw', db.products, async () => {
    for (let i = 0; i < productIds.length; i++) {
      const pid = sanitizeProductId(productIds[i]);
      if (!pid) continue;
      const product = await db.products.get(pid);
      if (product?.categoryId === cid) {
        await db.products.update(pid, { sortOrder: i + 1 });
      }
    }
  });
}

export async function setCategoryUnitPrice(categoryId, unitPrice, priceUnit = 'unit') {
  const cid = sanitizeProductId(categoryId);
  if (!cid) throw new ValidationError('קטגוריה לא תקינה');
  const price = sanitizeMoney(unitPrice);
  const unit = sanitizeProductPriceUnit(priceUnit);

  const products = await db.products.where('categoryId').equals(cid).toArray();
  await db.transaction('rw', db.products, async () => {
    for (const p of products) {
      await db.products.update(p.id, { unitPrice: price, priceUnit: unit });
    }
  });
  return products.length;
}

export async function moveProductInCategory(productId, direction) {
  const product = await db.products.get(productId);
  if (!product) throw new ValidationError('מוצר לא נמצא');
  if (direction !== 'up' && direction !== 'down') return false;

  const siblings = (await db.products.where('categoryId').equals(product.categoryId).toArray())
    .sort(compareProducts);
  const idx = siblings.findIndex((p) => p.id === productId);
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || targetIdx < 0 || targetIdx >= siblings.length) return false;

  const other = siblings[targetIdx];
  await db.transaction('rw', db.products, async () => {
    const orderA = product.sortOrder ?? idx + 1;
    const orderB = other.sortOrder ?? targetIdx + 1;
    await db.products.update(product.id, { sortOrder: orderB });
    await db.products.update(other.id, { sortOrder: orderA });
  });
  return true;
}

export async function toggleProductActive(id) {
  const p = await db.products.get(id);
  return db.products.update(id, { active: !p.active });
}

export async function addProductionEntry({ date, productId, quantity, runId, stepIndex }, { merge = false } = {}) {
  if (!isValidISODate(date)) throw new ValidationError('תאריך לא תקין');
  const pid = sanitizeProductId(productId);
  if (!pid) throw new ValidationError('מוצר לא תקין');
  const product = await db.products.get(pid);
  if (!product) throw new ValidationError('מוצר לא נמצא');
  const qty = sanitizeProductQuantity(quantity, product);
  if (qty === null) {
    const msg = product.priceUnit === 'kg' || product.priceUnit === 'kg_with_units'
      ? 'משקל חייב להיות מספר חיובי (ק"ג)'
      : 'כמות חייבת להיות מספר שלם חיובי';
    throw new ValidationError(msg);
  }

  if (merge) {
    const existing = await db.productionEntries
      .where('[date+productId]')
      .equals([date, pid])
      .first();
    if (existing) {
      const patch = { quantity: (existing.quantity || 0) + qty };
      const rid = sanitizeProductId(runId);
      if (rid) patch.runId = rid;
      if (stepIndex != null && !Number.isNaN(Number(stepIndex))) patch.stepIndex = Number(stepIndex);
      await db.productionEntries.update(existing.id, patch);
      return existing.id;
    }
  }

  const record = { date, productId: pid, quantity: qty };
  const rid = sanitizeProductId(runId);
  if (rid) record.runId = rid;
  if (stepIndex != null && !Number.isNaN(Number(stepIndex))) record.stepIndex = Number(stepIndex);
  return db.productionEntries.add(record);
}

export async function updateProductionEntry(id, data) {
  const patch = { ...data };
  if ('quantity' in patch) {
    const entry = await db.productionEntries.get(id);
    const product = entry ? await db.products.get(entry.productId) : null;
    const qty = sanitizeProductQuantity(patch.quantity, product);
    if (qty === null) {
      throw new ValidationError(product?.priceUnit === 'kg' || product?.priceUnit === 'kg_with_units'
        ? 'משקל חייב להיות מספר חיובי (ק"ג)'
        : 'כמות חייבת להיות מספר שלם חיובי');
    }
    patch.quantity = qty;
  }
  if ('date' in patch && !isValidISODate(patch.date)) {
    throw new ValidationError('תאריך לא תקין');
  }
  return db.productionEntries.update(id, patch);
}

export async function deleteProductionEntry(id) {
  return db.productionEntries.delete(id);
}

/** מוחק רישום ייצור ומנתק אותו מכל שלבי תהליך */
export async function deleteProductionEntryFully(id) {
  const eid = Number(id);
  if (!eid) return;
  const entry = await db.productionEntries.get(eid);
  if (!entry) return;

  const rid = sanitizeProductId(entry.runId);
  const steps = rid
    ? await db.runStepStates.where('runId').equals(rid).toArray()
    : await db.runStepStates.toArray();

  for (const step of steps) {
    if (!(step.productionEntryIds || []).includes(eid)) continue;
    await db.runStepStates.update(step.id, {
      productionEntryIds: (step.productionEntryIds || []).filter((x) => x !== eid),
    });
  }

  await db.productionEntries.delete(eid);
}

async function collectProductionEntryIdsForRun(runId) {
  const rid = sanitizeProductId(runId);
  if (!rid) return new Set();

  const entryIds = new Set();
  const run = await getProductionRun(rid, { normalize: false });
  if (run) {
    for (const step of run.steps) {
      for (const id of step.productionEntryIds || []) entryIds.add(Number(id));
    }
  }

  try {
    const indexed = await db.productionEntries.where('runId').equals(rid).toArray();
    indexed.forEach((e) => entryIds.add(e.id));
  } catch {
    /* index may be missing on very old DB */
  }

  const legacy = await db.productionEntries.filter((e) => Number(e.runId) === rid).toArray();
  legacy.forEach((e) => entryIds.add(e.id));

  return entryIds;
}

export async function addRunStepProductionEntry(runId, stepIndex, { date, productId, quantity }) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  if (run.status !== 'active') throw new ValidationError('התהליך לא פעיל');
  const step = run.steps[stepIndex];
  if (!step) throw new ValidationError('שלב לא תקין');
  if (!step.tracksProduction) {
    if (step.stepName === PRODUCTION_STEP_NAME || (step.productionEntryIds?.length > 0)) {
      await db.runStepStates.update(step.id, { tracksProduction: true });
      step.tracksProduction = true;
    } else {
      throw new ValidationError('שלב זה אינו שלב תיעוד ייצור');
    }
  }

  const entryId = await addProductionEntry({ date, productId, quantity, runId, stepIndex });
  const ids = [...(step.productionEntryIds || []), entryId];
  await db.runStepStates.update(step.id, { productionEntryIds: ids });
  return entryId;
}

export async function removeRunStepProductionEntry(runId, stepIndex, entryId) {
  await deleteProductionEntryFully(Number(entryId));
}

export async function getRunProductionEntries(runId) {
  const rid = sanitizeProductId(runId);
  if (!rid) return [];
  const run = await getProductionRun(rid);
  const seen = new Set();
  const entries = [];

  const byRunId = await db.productionEntries.filter((e) => Number(e.runId) === rid).toArray();
  for (const e of byRunId) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      entries.push(e);
    }
  }

  if (run) {
    for (const step of run.steps) {
      for (const eid of step.productionEntryIds || []) {
        if (seen.has(eid)) continue;
        const e = await db.productionEntries.get(eid);
        if (e) {
          seen.add(e.id);
          entries.push(e);
        }
      }
    }
  }

  entries.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return entries;
}

export async function getEntriesForDate(date) {
  return db.productionEntries.where('date').equals(date).toArray();
}

export async function getEntriesForMonth(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const all = await db.productionEntries.toArray();
  return all.filter((e) => e.date.startsWith(prefix));
}

export async function getEntriesInRange(from, to) {
  const all = await db.productionEntries.toArray();
  return all.filter((e) => e.date >= from && e.date <= to);
}

export async function getEntriesForCategory(categoryId) {
  const cid = Number(categoryId);
  if (!cid) return [];
  const productIds = new Set(
    (await db.products.where('categoryId').equals(cid).primaryKeys()),
  );
  if (productIds.size === 0) return [];
  const all = await db.productionEntries.toArray();
  return all.filter((e) => productIds.has(e.productId));
}

export async function getTargets() {
  return db.targets.toArray();
}

function normalizeScopeId(scope, scopeId) {
  return (scope === 'total' || scope === 'money') ? 0 : Number(scopeId);
}

export async function upsertTarget({ scope, scopeId, period, quantity }) {
  const qty = scope === 'money'
    ? sanitizeMoney(quantity)
    : sanitizeTargetQuantity(quantity);
  if (qty === null) throw new ValidationError('יעד לא תקין');
  const sid = normalizeScopeId(scope, scopeId);
  const existing = await db.targets
    .where('[scope+scopeId+period]')
    .equals([scope, sid, period])
    .first();

  if (existing) {
    return db.targets.update(existing.id, { quantity: qty });
  }
  return db.targets.add({ scope, scopeId: sid, period, quantity: qty });
}

export async function getTarget(scope, scopeId, period) {
  const sid = normalizeScopeId(scope, scopeId);
  const t = await db.targets
    .where('[scope+scopeId+period]')
    .equals([scope, sid, period])
    .first();
  return t?.quantity ?? 0;
}

export async function getProductionTotals(entries, productMap) {
  return computeProductionTotals(entries, productMap);
}

export async function findOrCreateCategory(name) {
  const trimmed = name.trim();
  const existing = (await getCategories()).find((c) => c.name === trimmed);
  if (existing) return existing.id;
  return addCategory(trimmed);
}

export async function findOrCreateProduct(categoryId, name, unitPrice = 0) {
  const key = productNameKey(name);
  if (!key) throw new ValidationError('שם מוצר לא תקין');
  const existing = (await getProducts()).find(
    (p) => p.categoryId === categoryId && productNameKey(p.name) === key
  );
  if (existing) {
    if (unitPrice > 0 && existing.unitPrice !== unitPrice) {
      await db.products.update(existing.id, { unitPrice: Number(unitPrice) });
    }
    return existing.id;
  }
  const clean = sanitizeName(name);
  return addProduct({ categoryId, name: clean, unitPrice: unitPrice || 0 });
}

export async function findDuplicateProductGroups() {
  const [products, categories] = await Promise.all([getProducts(), getCategories()]);
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const byKey = new Map();

  for (const p of products) {
    const key = `${p.categoryId}|${productNameKey(p.name)}`;
    if (!productNameKey(p.name)) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }

  const groups = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const enriched = await Promise.all(list.map(async (p) => {
      const entries = await db.productionEntries.where('productId').equals(p.id).toArray();
      const totalQty = entries.reduce((s, e) => s + (e.quantity || 0), 0);
      return { ...p, entryCount: entries.length, totalQty };
    }));
    enriched.sort((a, b) => b.totalQty - a.totalQty || b.entryCount - a.entryCount || a.id - b.id);
    groups.push({
      categoryId: list[0].categoryId,
      categoryName: catMap.get(list[0].categoryId) || '',
      name: enriched[0].name,
      products: enriched,
    });
  }

  return groups.sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'he') || a.name.localeCompare(b.name, 'he'));
}

export async function mergeProducts(keepProductId, mergeProductIds, options = {}) {
  const { newName, requireSameNameKey = true } = options;
  const keepId = sanitizeProductId(keepProductId);
  if (!keepId) throw new ValidationError('מוצר לשמירה לא תקין');

  const mergeIds = [...new Set((mergeProductIds || [])
    .map(sanitizeProductId)
    .filter((id) => id && id !== keepId))];
  if (!mergeIds.length) return { merged: 0, keepProductId: keepId };

  const keep = await db.products.get(keepId);
  if (!keep) throw new ValidationError('מוצר לא נמצא');

  const allIds = [keepId, ...mergeIds];
  const entriesBefore = await db.productionEntries.toArray();
  const qtyBefore = sumEntriesForProducts(entriesBefore, allIds);

  let merged = 0;

  await db.transaction('rw', db.products, db.productionEntries, db.targets, async () => {
    for (const mid of mergeIds) {
      const dup = await db.products.get(mid);
      if (!dup || dup.categoryId !== keep.categoryId) continue;
      if (requireSameNameKey && productNameKey(dup.name) !== productNameKey(keep.name)) continue;

      const entries = await db.productionEntries.where('productId').equals(mid).toArray();
      for (const e of entries) {
        const sameDay = await db.productionEntries
          .where('[date+productId]')
          .equals([e.date, keepId])
          .first();
        if (sameDay) {
          await db.productionEntries.update(sameDay.id, {
            quantity: (sameDay.quantity || 0) + (e.quantity || 0),
          });
          await db.productionEntries.delete(e.id);
        } else {
          await db.productionEntries.update(e.id, { productId: keepId });
        }
      }

      const patch = {};
      if ((dup.unitPrice || 0) > (keep.unitPrice || 0)) patch.unitPrice = dup.unitPrice;
      if ((dup.rawMaterialsCost || 0) > (keep.rawMaterialsCost || 0)) patch.rawMaterialsCost = dup.rawMaterialsCost;
      if ((dup.packagingCost || 0) > (keep.packagingCost || 0)) patch.packagingCost = dup.packagingCost;
      if ((dup.additionalCosts || 0) > (keep.additionalCosts || 0)) patch.additionalCosts = dup.additionalCosts;
      if (dup.active && !keep.active) patch.active = true;
      if (Object.keys(patch).length) {
        await db.products.update(keepId, patch);
        Object.assign(keep, patch);
      }

      const prodTargets = await db.targets.where('scope').equals('product').toArray();
      for (const t of prodTargets.filter((x) => x.scopeId === mid)) {
        await db.targets.delete(t.id);
      }

      await db.products.delete(mid);
      merged++;
    }

    if (newName != null && newName !== '') {
      const clean = sanitizeName(newName);
      if (!clean) throw new ValidationError('שם מוצר לא תקין');
      await db.products.update(keepId, { name: clean });
    }
  });

  if (merged > 0) {
    const entriesAfter = await db.productionEntries.toArray();
    const qtyAfter = sumEntriesForProducts(entriesAfter, [keepId]);
    if (qtyBefore !== qtyAfter) {
      throw new ValidationError(`פער בכמויות אחרי איחוד: לפני ${qtyBefore}, אחרי ${qtyAfter}`);
    }
  }

  return { merged, keepProductId: keepId, qtyBefore, qtyAfter: merged > 0 ? qtyBefore : 0 };
}

export async function getProductsWithEntryStats(activeOnly = false) {
  const [products, entries] = await Promise.all([
    getProducts(activeOnly),
    db.productionEntries.toArray(),
  ]);
  const stats = new Map();
  for (const e of entries) {
    if (!stats.has(e.productId)) stats.set(e.productId, { entryCount: 0, totalQty: 0 });
    const s = stats.get(e.productId);
    s.entryCount += 1;
    s.totalQty += e.quantity || 0;
  }
  return products.map((p) => ({
    ...p,
    entryCount: stats.get(p.id)?.entryCount || 0,
    totalQty: stats.get(p.id)?.totalQty || 0,
  }));
}

export async function mergeSelectedProducts(productIds, newName) {
  const ids = [...new Set((productIds || []).map(sanitizeProductId).filter(Boolean))];
  if (ids.length < 2) throw new ValidationError('יש לבחור לפחות 2 מוצרים');

  const allStats = await getProductsWithEntryStats();
  const statsMap = new Map(allStats.map((p) => [p.id, p]));
  const selected = ids.map((id) => statsMap.get(id)).filter(Boolean);
  if (selected.length !== ids.length) throw new ValidationError('אחד המוצרים לא נמצא');

  const categoryId = selected[0].categoryId;
  if (selected.some((p) => p.categoryId !== categoryId)) {
    throw new ValidationError('כל המוצרים חייבים להיות באותה קטגוריה');
  }

  selected.sort(
    (a, b) => b.totalQty - a.totalQty || b.entryCount - a.entryCount || a.id - b.id
  );

  const keepId = selected[0].id;
  const mergeIds = ids.filter((id) => id !== keepId);
  const cleanName = sanitizeName(newName);
  if (!cleanName) throw new ValidationError('שם מוצר לא תקין');

  const result = await mergeProducts(keepId, mergeIds, {
    requireSameNameKey: false,
    newName: cleanName,
  });
  if (!result.merged) throw new ValidationError('לא ניתן לאחד את המוצרים שנבחרו');

  return { ...result, name: cleanName };
}

export async function mergeAllDuplicateProducts() {
  const groups = await findDuplicateProductGroups();
  let merged = 0;
  for (const g of groups) {
    const keepId = g.products[0].id;
    const others = g.products.slice(1).map((p) => p.id);
    const result = await mergeProducts(keepId, others);
    merged += result.merged;
  }
  return { groups: groups.length, merged };
}

export async function importProductionRows(rows) {
  let imported = 0;
  let merged = 0;
  let skipped = 0;
  let newCategories = 0;
  let newProducts = 0;

  const categoryNames = new Map((await getCategories()).map((c) => [c.name, c.id]));
  const productKeys = new Set(
    (await getProducts()).map((p) => `${p.categoryId}|${productNameKey(p.name)}`)
  );

  for (const row of rows) {
    const { date, category, product, quantity, price } = row;
    if (!isValidISODate(date)) { skipped++; continue; }
    const qty = sanitizeQuantity(quantity);
    const prodName = sanitizeName(product);
    if (!prodName || qty === null) { skipped++; continue; }

    const categoryName = (category || 'כללי').trim();
    let categoryId = categoryNames.get(categoryName);
    if (!categoryId) {
      categoryId = await findOrCreateCategory(categoryName);
      categoryNames.set(categoryName, categoryId);
      newCategories++;
    }

    const productKey = `${categoryId}|${productNameKey(prodName)}`;
    if (!productKeys.has(productKey)) {
      newProducts++;
      productKeys.add(productKey);
    }

    const productId = await findOrCreateProduct(categoryId, prodName, sanitizeMoney(price));
    const existing = await db.productionEntries
      .where('[date+productId]')
      .equals([date, productId])
      .first();
    if (existing) {
      await db.productionEntries.update(existing.id, {
        quantity: (existing.quantity || 0) + qty,
      });
      merged++;
    } else {
      await addProductionEntry({ date, productId, quantity: qty });
      imported++;
    }
  }

  return { imported, merged, skipped, newCategories, newProducts };
}

export async function importCatalogRows(rows) {
  let added = 0;
  for (const row of rows) {
    const { category, product, price } = row;
    if (!category || !product) continue;
    const categoryId = await findOrCreateCategory(category);
    const exists = (await getProducts()).some(
      (p) => p.categoryId === categoryId && productNameKey(p.name) === productNameKey(product)
    );
    await findOrCreateProduct(categoryId, product, price || 0);
    if (!exists) added++;
  }
  return { added, total: rows.length };
}

export async function getActivityPresets(categoryId) {
  const records = await getActivityPresetRecords(categoryId);
  const names = [...new Set(records.map((a) => a.name))];
  return names.sort((a, b) => a.localeCompare(b, 'he'));
}

export async function getActivityPresetRecords(categoryId) {
  const all = await db.activityPresets.toArray();
  const cid = Number(categoryId) || 0;
  if (!cid) return all.filter((a) => !a.categoryId || a.categoryId === 0);
  return all.filter((a) => !a.categoryId || a.categoryId === 0 || a.categoryId === cid);
}

export async function addActivityPreset(categoryId, name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const cid = Number(categoryId) || 0;
  const exists = (await getActivityPresetRecords(cid)).some((a) => a.name === trimmed);
  if (exists) return;
  return db.activityPresets.add({ categoryId: cid, name: trimmed });
}

export async function updateActivityPreset(id, name) {
  return db.activityPresets.update(id, { name: name.trim() });
}

export async function deleteActivityPreset(id) {
  return db.activityPresets.delete(id);
}

export async function addProcessLog({ date, categoryId, activity, notes, quantity }) {
  if (!isValidISODate(date)) throw new ValidationError('תאריך לא תקין');
  const act = sanitizeName(activity, 80);
  if (!act) throw new ValidationError('סוג הכנה לא תקין');
  const cid = sanitizeProductId(categoryId);
  if (!cid) throw new ValidationError('קטגוריה לא תקינה');
  const qtyRaw = quantity !== '' && quantity != null ? sanitizeQuantity(quantity, { allowZero: false }) : null;
  return db.processLogs.add({
    date,
    categoryId: cid,
    activity: act,
    notes: String(notes || '').trim().slice(0, 500),
    quantity: qtyRaw,
  });
}

export async function updateProcessLog(id, data) {
  const patch = { ...data };
  if ('quantity' in patch) {
    const qty = patch.quantity !== '' && patch.quantity != null ? Number(patch.quantity) : null;
    patch.quantity = qty > 0 ? qty : null;
  }
  return db.processLogs.update(id, patch);
}

export async function deleteProcessLog(id) {
  return db.processLogs.delete(id);
}

export async function getProcessLogsForDate(date) {
  return db.processLogs.where('date').equals(date).toArray();
}

export async function getProcessLogsInRange(from, to) {
  const all = await db.processLogs.toArray();
  return all.filter((e) => e.date >= from && e.date <= to);
}

export async function getProcessLogsForMonth(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const all = await db.processLogs.toArray();
  return all.filter((e) => e.date.startsWith(prefix));
}

/* ── צ׳קליסט משימות לתזרים — ספרייה + שיוך לכל תזרim ── */

async function resolveFlowCategoryGroupId(flowId) {
  const flow = await db.flows.get(Number(flowId));
  if (!flow) return null;
  if (flow.categoryGroupId) return flow.categoryGroupId;
  if (flow.categoryId) {
    const cat = await db.categories.get(flow.categoryId);
    return cat?.groupId || null;
  }
  return null;
}

function mapFlowChecklistItem(link, task) {
  return {
    id: link.id,
    linkId: link.id,
    checklistTaskId: task.id,
    name: task.name,
    sortOrder: link.sortOrder ?? task.sortOrder ?? 0,
  };
}

export async function getChecklistTaskLibrary(categoryGroupId) {
  const gid = sanitizeProductId(categoryGroupId);
  if (!gid) return [];
  const rows = await db.checklistTasks.where('categoryGroupId').equals(gid).toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function getChecklistLibraryForFlow(flowId) {
  const flow = await db.flows.get(Number(flowId));
  const gid = await resolveFlowCategoryGroupId(flowId);
  if (!gid) return [];
  const rows = await getChecklistTaskLibrary(gid);
  const cid = flow?.categoryId ? Number(flow.categoryId) : null;
  if (cid) return rows.filter((t) => Number(t.categoryId) === cid);
  return rows.filter((t) => !t.categoryId);
}

export async function getAvailableChecklistTasksForFlow(flowId) {
  const fid = sanitizeProductId(flowId);
  if (!fid) return [];
  const [library, linked] = await Promise.all([
    getChecklistLibraryForFlow(fid),
    db.flowChecklistItems.where('flowId').equals(fid).toArray(),
  ]);
  const linkedIds = new Set(linked.map((l) => l.checklistTaskId));
  return library.filter((t) => !linkedIds.has(t.id));
}

export async function getFlowPreparations(flowId) {
  const fid = sanitizeProductId(flowId);
  if (!fid) return [];
  const links = await db.flowChecklistItems.where('flowId').equals(fid).toArray();
  links.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  const result = [];
  for (const link of links) {
    const task = await db.checklistTasks.get(link.checklistTaskId);
    if (!task) continue;
    result.push(mapFlowChecklistItem(link, task));
  }
  return result;
}

async function findOrCreateChecklistTask(categoryGroupId, name, categoryId = null) {
  const gid = sanitizeProductId(categoryGroupId);
  const trimmed = sanitizeName(name, 80);
  if (!gid || !trimmed) return null;
  const cid = categoryId ? sanitizeProductId(categoryId) : null;
  const library = await getChecklistTaskLibrary(gid);
  const existing = library.find((t) => {
    if (t.name !== trimmed) return false;
    if (cid) return Number(t.categoryId) === cid;
    return !t.categoryId;
  });
  if (existing) return existing;
  const maxOrder = library.reduce((m, t) => Math.max(m, t.sortOrder ?? 0), 0);
  const taskId = await db.checklistTasks.add({
    categoryGroupId: gid,
    categoryId: cid,
    name: trimmed,
    sortOrder: maxOrder + 1,
  });
  return db.checklistTasks.get(taskId);
}

export async function linkChecklistTaskToFlow(flowId, checklistTaskId) {
  const fid = sanitizeProductId(flowId);
  const tid = sanitizeProductId(checklistTaskId);
  if (!fid || !tid) throw new ValidationError('פריט לא תקין');
  const task = await db.checklistTasks.get(tid);
  if (!task) throw new ValidationError('משימה לא נמצאה');
  const existing = await db.flowChecklistItems
    .where('[flowId+checklistTaskId]')
    .equals([fid, tid])
    .first();
  if (existing) return mapFlowChecklistItem(existing, task);

  const links = await db.flowChecklistItems.where('flowId').equals(fid).toArray();
  const maxOrder = links.reduce((m, l) => Math.max(m, l.sortOrder ?? 0), 0);
  const linkId = await db.flowChecklistItems.add({
    flowId: fid,
    checklistTaskId: tid,
    sortOrder: maxOrder + 1,
  });
  return mapFlowChecklistItem({ id: linkId, sortOrder: maxOrder + 1 }, task);
}

export async function addFlowPreparation(flowId, name) {
  const fid = sanitizeProductId(flowId);
  const flow = await db.flows.get(fid);
  const gid = await resolveFlowCategoryGroupId(fid);
  const trimmed = sanitizeName(name, 80);
  if (!fid || !gid) throw new ValidationError('תזרים לא תקין');
  if (!trimmed) throw new ValidationError('שם משימה לא תקין');
  const task = await findOrCreateChecklistTask(gid, trimmed, flow?.categoryId || null);
  if (!task) throw new ValidationError('שם משימה לא תקין');
  return linkChecklistTaskToFlow(fid, task.id);
}

export async function deleteFlowPreparation(linkId) {
  const id = sanitizeProductId(linkId);
  if (!id) return;
  await db.flowChecklistItems.delete(id);
}

export async function setFlowPreparationOrder(flowId, orderedLinkIds) {
  const fid = sanitizeProductId(flowId);
  if (!fid || !Array.isArray(orderedLinkIds)) return;
  await db.transaction('rw', db.flowChecklistItems, async () => {
    for (let i = 0; i < orderedLinkIds.length; i++) {
      const id = sanitizeProductId(orderedLinkIds[i]);
      if (id) await db.flowChecklistItems.update(id, { sortOrder: i + 1 });
    }
  });
}

/** @deprecated — use resolveFlowCategoryGroupId */
async function resolveFlowPrepScope(flowId) {
  const flow = await db.flows.get(Number(flowId));
  if (!flow) return { categoryGroupId: null, categoryId: null };
  if (flow.categoryId) {
    const cat = await db.categories.get(flow.categoryId);
    return { categoryGroupId: cat?.groupId || null, categoryId: flow.categoryId };
  }
  return { categoryGroupId: flow.categoryGroupId || null, categoryId: null };
}

/** @deprecated */
export async function getGroupPreparations(categoryGroupId, categoryId = null) {
  return getChecklistTaskLibrary(categoryGroupId);
}

async function resolveFlowCategoryIdForPresets(flowId) {
  const flow = await db.flows.get(Number(flowId));
  if (!flow) return 0;
  if (flow.categoryId) return flow.categoryId;
  if (flow.categoryGroupId) {
    const cats = await db.categories.where('groupId').equals(flow.categoryGroupId).toArray();
    cats.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
    return cats[0]?.id || 0;
  }
  return 0;
}

export async function importFlowPreparationsFromActivityPresets(flowId) {
  const fid = sanitizeProductId(flowId);
  if (!fid) throw new ValidationError('תזרים לא תקין');
  const categoryId = await resolveFlowCategoryIdForPresets(fid);
  const presets = await getActivityPresets(categoryId);
  const existing = await getFlowPreparations(fid);
  const names = new Set(existing.map((p) => p.name));
  let added = 0;
  for (const name of presets) {
    if (names.has(name)) continue;
    await addFlowPreparation(fid, name);
    names.add(name);
    added += 1;
  }
  return added;
}

async function seedRunPreparationChecksInTx(tx, runId, flowId) {
  const fid = sanitizeProductId(flowId);
  const rid = sanitizeProductId(runId);
  if (!fid || !rid) return;
  const preps = await getFlowPreparations(fid);
  for (const prep of preps) {
    await tx.table('runPreparationChecks').add({
      runId: rid,
      flowPreparationId: prep.checklistTaskId,
      name: prep.name,
      sortOrder: prep.sortOrder ?? 0,
      checked: false,
      checkedAt: null,
    });
  }
}

export async function getRunPreparationChecks(runId) {
  const rid = sanitizeProductId(runId);
  if (!rid) return [];
  const rows = await db.runPreparationChecks.where('runId').equals(rid).toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function ensureRunPreparationChecks(runId) {
  const rid = sanitizeProductId(runId);
  if (!rid) return [];
  const run = await db.productionRuns.get(rid);
  if (!run?.flowId) return [];

  const preps = await getFlowPreparations(run.flowId);
  const existing = await getRunPreparationChecks(rid);
  const byPrepId = new Map(
    existing.filter((c) => c.flowPreparationId).map((c) => [c.flowPreparationId, c]),
  );

  await db.transaction('rw', db.runPreparationChecks, async () => {
    for (const prep of preps) {
      const taskId = prep.checklistTaskId;
      const ex = byPrepId.get(taskId);
      if (ex) {
        if (ex.name !== prep.name || ex.sortOrder !== prep.sortOrder) {
          await db.runPreparationChecks.update(ex.id, { name: prep.name, sortOrder: prep.sortOrder ?? 0 });
        }
      } else {
        await db.runPreparationChecks.add({
          runId: rid,
          flowPreparationId: taskId,
          name: prep.name,
          sortOrder: prep.sortOrder ?? 0,
          checked: false,
          checkedAt: null,
        });
      }
    }
  });

  return getRunPreparationChecks(rid);
}

export async function setRunPreparationChecked(checkId, checked) {
  const id = sanitizeProductId(checkId);
  if (!id) throw new ValidationError('פריט לא תקין');
  return db.runPreparationChecks.update(id, {
    checked: !!checked,
    checkedAt: checked ? nowISO() : null,
  });
}

export async function addRunPreparationFromFlow(flowId, name, runId) {
  const prep = await addFlowPreparation(flowId, name);
  const rid = sanitizeProductId(runId);
  if (!rid || !prep) return prep?.linkId;
  const existing = await getRunPreparationChecks(rid);
  if (!existing.some((c) => c.flowPreparationId === prep.checklistTaskId)) {
    await db.runPreparationChecks.add({
      runId: rid,
      flowPreparationId: prep.checklistTaskId,
      name: prep.name,
      sortOrder: prep.sortOrder ?? 0,
      checked: false,
      checkedAt: null,
    });
  }
  return prep.linkId;
}

/* ── ניקיון לתזרים (צ׳קליסט — רשימה קבועה לכל תזרים) ── */

export async function getFlowCleaningTasks(flowId) {
  const fid = sanitizeProductId(flowId);
  if (!fid) return [];
  const rows = await db.flowCleaningTasks.where('flowId').equals(fid).toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function addFlowCleaningTask(flowId, name) {
  const fid = sanitizeProductId(flowId);
  const trimmed = sanitizeName(name, 80);
  if (!fid) throw new ValidationError('תזרים לא תקין');
  if (!trimmed) throw new ValidationError('שם משימת ניקיון לא תקין');
  const existing = await getFlowCleaningTasks(fid);
  if (existing.some((t) => t.name === trimmed)) {
    throw new ValidationError('משימת ניקיון זו כבר קיימת ברשימה');
  }
  const maxOrder = existing.reduce((m, t) => Math.max(m, t.sortOrder ?? 0), 0);
  return db.flowCleaningTasks.add({
    flowId: fid,
    name: trimmed,
    sortOrder: maxOrder + 1,
  });
}

export async function deleteFlowCleaningTask(id) {
  const taskId = sanitizeProductId(id);
  if (!taskId) return;
  await db.flowCleaningTasks.delete(taskId);
}

export async function setFlowCleaningTaskOrder(flowId, orderedTaskIds) {
  const fid = sanitizeProductId(flowId);
  if (!fid || !Array.isArray(orderedTaskIds)) return;
  await db.transaction('rw', db.flowCleaningTasks, async () => {
    for (let i = 0; i < orderedTaskIds.length; i++) {
      const id = sanitizeProductId(orderedTaskIds[i]);
      if (id) await db.flowCleaningTasks.update(id, { sortOrder: i + 1 });
    }
  });
}

export async function setDepartmentCleaningTaskOrder(listId, orderedTaskIds) {
  const lid = sanitizeProductId(listId);
  if (!lid || !Array.isArray(orderedTaskIds)) return;
  await db.transaction('rw', db.departmentCleaningTasks, async () => {
    for (let i = 0; i < orderedTaskIds.length; i++) {
      const id = sanitizeProductId(orderedTaskIds[i]);
      if (id) await db.departmentCleaningTasks.update(id, { sortOrder: i + 1 });
    }
  });
}

export async function getRunCleaningChecks(runId) {
  const rid = sanitizeProductId(runId);
  if (!rid) return [];
  const rows = await db.runCleaningChecks.where('runId').equals(rid).toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function ensureRunCleaningChecks(runId) {
  const rid = sanitizeProductId(runId);
  if (!rid) return [];
  const run = await db.productionRuns.get(rid);
  if (!run?.flowId) return [];

  const tasks = await getFlowCleaningTasks(run.flowId);
  const existing = await getRunCleaningChecks(rid);
  const byTaskId = new Map(
    existing.filter((c) => c.flowCleaningTaskId).map((c) => [c.flowCleaningTaskId, c]),
  );

  await db.transaction('rw', db.runCleaningChecks, async () => {
    for (const task of tasks) {
      const ex = byTaskId.get(task.id);
      if (ex) {
        if (ex.name !== task.name || ex.sortOrder !== task.sortOrder) {
          await db.runCleaningChecks.update(ex.id, { name: task.name, sortOrder: task.sortOrder ?? 0 });
        }
      } else {
        await db.runCleaningChecks.add({
          runId: rid,
          flowCleaningTaskId: task.id,
          name: task.name,
          sortOrder: task.sortOrder ?? 0,
          checked: false,
          checkedAt: null,
        });
      }
    }
  });

  return getRunCleaningChecks(rid);
}

export async function setRunCleaningChecked(checkId, checked) {
  const id = sanitizeProductId(checkId);
  if (!id) throw new ValidationError('פריט לא תקין');
  return db.runCleaningChecks.update(id, {
    checked: !!checked,
    checkedAt: checked ? nowISO() : null,
  });
}

export async function addRunCleaningTaskFromFlow(flowId, name, runId) {
  const taskId = await addFlowCleaningTask(flowId, name);
  const rid = sanitizeProductId(runId);
  if (!rid) return taskId;
  const task = await db.flowCleaningTasks.get(taskId);
  if (task) {
    const existing = await getRunCleaningChecks(rid);
    if (!existing.some((c) => c.flowCleaningTaskId === task.id)) {
      await db.runCleaningChecks.add({
        runId: rid,
        flowCleaningTaskId: task.id,
        name: task.name,
        sortOrder: task.sortOrder ?? 0,
        checked: false,
        checkedAt: null,
      });
    }
  }
  return taskId;
}

export function resolveFlowPlanCategoryFromFlow(flow, catMap) {
  if (flow.categoryId) {
    const cat = catMap.get(Number(flow.categoryId));
    return {
      categoryId: Number(flow.categoryId),
      categoryGroupId: cat?.groupId ? Number(cat.groupId) : (flow.categoryGroupId ? Number(flow.categoryGroupId) : null),
    };
  }
  const gid = flow.categoryGroupId || flow.groupId;
  return { categoryId: null, categoryGroupId: gid ? Number(gid) : null };
}

/* ── תזרים יצור ── */

function sanitizePortionSizeForUnit(raw, unit) {
  return unit === 'weight'
    ? sanitizePortionSize(raw)
    : sanitizeQuantity(raw, { allowZero: false });
}

function compareFlowSteps(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

function compareFlows(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

function migrateLegacyFlowStepsToFlows(flowSteps) {
  const groups = new Map();
  for (const step of flowSteps) {
    const key = step.categoryId
      ? `c:${step.categoryId}`
      : step.categoryGroupId
        ? `g:${step.categoryGroupId}`
        : null;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(step);
  }

  const flows = [];
  let nextFlowId = 1;
  for (const [key] of groups) {
    const isCategory = key.startsWith('c:');
    const targetId = Number(key.slice(2));
    const flowId = nextFlowId++;
    flows.push({
      id: flowId,
      categoryId: isCategory ? targetId : null,
      categoryGroupId: isCategory ? null : targetId,
      name: 'ברירת מחדל',
      sortOrder: 1,
      isDefault: true,
    });
    for (const step of groups.get(key)) {
      step.flowId = flowId;
    }
  }
  return flows;
}

export async function getFlowsForCategory(categoryId) {
  const cid = sanitizeProductId(categoryId);
  if (!cid) return [];
  const flows = await db.flows.where('categoryId').equals(cid).toArray();
  return flows.sort(compareFlows);
}

export async function getFlowsForGroup(categoryGroupId) {
  const gid = sanitizeProductId(categoryGroupId);
  if (!gid) return [];
  const flows = await db.flows.where('categoryGroupId').equals(gid).toArray();
  return flows.sort(compareFlows);
}

/** כל התזרימים עם יעד ומספר שלבים — לתצוגה ב«נהל תזרים» */
export async function getAllFlowsOverview() {
  const [flows, steps, categories, groups] = await Promise.all([
    db.flows.toArray(),
    db.flowSteps.toArray(),
    db.categories.toArray(),
    db.categoryGroups.toArray(),
  ]);
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));
  const stepCounts = new Map();
  for (const s of steps) {
    if (s.flowId) stepCounts.set(s.flowId, (stepCounts.get(s.flowId) || 0) + 1);
  }

  return flows
    .map((f) => {
      const isCategory = !!f.categoryId;
      const cat = isCategory ? catMap.get(f.categoryId) : null;
      const groupId = isCategory ? cat?.groupId : f.categoryGroupId;
      const groupName = groupMap.get(groupId) || '';
      const targetLabel = isCategory
        ? (cat?.name || 'קטגוריה')
        : (groupMap.get(f.categoryGroupId) || 'קבוצה');
      return {
        ...f,
        targetType: isCategory ? 'category' : 'group',
        targetLabel,
        groupId: groupId || f.categoryGroupId || null,
        categoryId: f.categoryId || null,
        groupName,
        stepCount: stepCounts.get(f.id) || 0,
      };
    })
    .sort((a, b) => {
      const gCmp = (a.groupName || '').localeCompare(b.groupName || '', 'he');
      if (gCmp) return gCmp;
      const tCmp = a.targetLabel.localeCompare(b.targetLabel, 'he');
      if (tCmp) return tCmp;
      return compareFlows(a, b);
    });
}

export async function getFlow(flowId) {
  return db.flows.get(Number(flowId));
}

export async function getFlowStepsForFlow(flowId) {
  const fid = sanitizeProductId(flowId);
  if (!fid) return [];
  const steps = await db.flowSteps.where('flowId').equals(fid).toArray();
  return steps.sort(compareFlowSteps);
}

export async function getFlowSteps(categoryId) {
  const flows = await getFlowsForCategory(categoryId);
  const flow = flows.find((f) => f.isDefault) || flows[0];
  if (!flow) return [];
  return getFlowStepsForFlow(flow.id);
}

export async function getFlowStepsForGroup(categoryGroupId) {
  const flows = await getFlowsForGroup(categoryGroupId);
  const flow = flows.find((f) => f.isDefault) || flows[0];
  if (!flow) return [];
  return getFlowStepsForFlow(flow.id);
}

export async function resolveFlows({ categoryId, categoryGroupId, scopeMode } = {}) {
  if (scopeMode === 'group') {
    return categoryGroupId ? getFlowsForGroup(categoryGroupId) : [];
  }
  if (scopeMode === 'categories') {
    return categoryGroupId ? getFlowsForGroup(categoryGroupId) : [];
  }
  if (categoryId) {
    const catFlows = await getFlowsForCategory(categoryId);
    if (catFlows.length) return catFlows;
    const cat = await db.categories.get(Number(categoryId));
    if (cat?.groupId) return getFlowsForGroup(cat.groupId);
  }
  if (categoryGroupId) return getFlowsForGroup(categoryGroupId);
  return [];
}

/** תזרימים לקטגוריות נבחרות — מעדיף תזרים ייעודי לכל קטגוריה, נופל לקבוצה */
export async function resolveFlowsForCategorySelection({ categoryIds, categoryGroupId } = {}) {
  const ids = (categoryIds || []).map(Number).filter(Boolean);
  const byId = new Map();
  for (const cid of ids) {
    for (const f of await getFlowsForCategory(cid)) {
      byId.set(f.id, f);
    }
  }
  if (byId.size) return [...byId.values()].sort(compareFlows);
  return categoryGroupId ? getFlowsForGroup(categoryGroupId) : [];
}

export async function resolveFlowSteps({ categoryId, categoryGroupId, flowId } = {}) {
  if (flowId) {
    return getFlowStepsForFlow(flowId);
  }
  if (categoryGroupId) {
    const flows = await getFlowsForGroup(categoryGroupId);
    const flow = flows.find((f) => f.isDefault) || flows[0];
    if (flow) return getFlowStepsForFlow(flow.id);
  }
  if (categoryId) {
    const catFlows = await getFlowsForCategory(categoryId);
    if (catFlows.length) {
      const flow = catFlows.find((f) => f.isDefault) || catFlows[0];
      return getFlowStepsForFlow(flow.id);
    }
    const cat = await db.categories.get(Number(categoryId));
    if (cat?.groupId) {
      return resolveFlowSteps({ categoryGroupId: cat.groupId, flowId });
    }
  }
  return [];
}

export async function createFlow({ categoryId, categoryGroupId, name, withDefaults = false }) {
  const cleanName = sanitizeName(name, 60);
  if (!cleanName) throw new ValidationError('שם תזרים לא תקין');
  const cid = categoryId ? sanitizeProductId(categoryId) : null;
  const gid = categoryGroupId ? sanitizeProductId(categoryGroupId) : null;
  if (!cid && !gid) throw new ValidationError('יעד תזרים לא תקין');

  const existing = cid ? await getFlowsForCategory(cid) : await getFlowsForGroup(gid);
  const maxOrder = existing.reduce((m, f) => Math.max(m, f.sortOrder ?? 0), 0);
  const isFirst = existing.length === 0;

  const newFlowId = await db.flows.add({
    categoryId: cid || null,
    categoryGroupId: gid || null,
    name: cleanName,
    sortOrder: maxOrder + 1,
    isDefault: isFirst,
  });

  if (withDefaults) {
    await copyDefaultFlowStepsToFlow(newFlowId);
  } else {
    await ensureFlowProductionStep(newFlowId);
  }
  return newFlowId;
}

/** שכפול תזרים — שלבים ומנות מוכנות — ליעד חדש או לאותו יעד */
export async function duplicateFlow(sourceFlowId, { name, categoryId, categoryGroupId } = {}) {
  const sourceId = sanitizeProductId(sourceFlowId);
  if (!sourceId) throw new ValidationError('תזרים מקור לא תקין');
  const source = await db.flows.get(sourceId);
  if (!source) throw new ValidationError('תזרים מקור לא נמצא');

  let cid = categoryId !== undefined
    ? (categoryId ? sanitizeProductId(categoryId) : null)
    : (source.categoryId || null);
  let gid = categoryGroupId !== undefined
    ? (categoryGroupId ? sanitizeProductId(categoryGroupId) : null)
    : (source.categoryGroupId || null);

  if (categoryId !== undefined && categoryGroupId !== undefined) {
    if (cid && gid) gid = null;
  }

  if (cid && !gid) {
    const cat = await db.categories.get(cid);
    gid = cat?.groupId || null;
  }
  if (!cid && !gid) throw new ValidationError('יעד תזרים לא תקין');

  const cleanName = sanitizeName(name, 60) || `${source.name} (עותק)`;
  const isCategoryTarget = !!cid;

  const [steps, existing] = await Promise.all([
    getFlowStepsForFlow(sourceId),
    isCategoryTarget ? getFlowsForCategory(cid) : getFlowsForGroup(gid),
  ]);
  const maxOrder = existing.reduce((m, f) => Math.max(m, f.sortOrder ?? 0), 0);

  return db.transaction('rw', db.flows, db.flowSteps, db.flowCleaningTasks, db.flowChecklistItems, async () => {
    const newFlowId = await db.flows.add({
      categoryId: isCategoryTarget ? cid : null,
      categoryGroupId: isCategoryTarget ? null : gid,
      name: cleanName,
      sortOrder: maxOrder + 1,
      isDefault: false,
    });

    for (const s of steps) {
      await db.flowSteps.add({
        flowId: newFlowId,
        categoryId: isCategoryTarget ? cid : null,
        categoryGroupId: isCategoryTarget ? null : gid,
        name: s.name,
        sortOrder: s.sortOrder ?? 0,
        tracksPortions: !!s.tracksPortions,
        tracksProduction: !!s.tracksProduction,
        portionUnit: s.portionUnit || null,
        portionSize: s.portionSize ?? null,
      });
    }

    const cleaningTasks = await getFlowCleaningTasks(sourceId);
    for (const task of cleaningTasks) {
      await db.flowCleaningTasks.add({
        flowId: newFlowId,
        name: task.name,
        sortOrder: task.sortOrder ?? 0,
      });
    }

    const checklistLinks = await db.flowChecklistItems.where('flowId').equals(sourceId).toArray();
    for (const link of checklistLinks) {
      await db.flowChecklistItems.add({
        flowId: newFlowId,
        checklistTaskId: link.checklistTaskId,
        sortOrder: link.sortOrder ?? 0,
      });
    }

    await ensureFlowProductionStep(newFlowId);

    return newFlowId;
  });
}

export async function updateFlow(flowId, { name, isDefault } = {}) {
  const fid = sanitizeProductId(flowId);
  if (!fid) throw new ValidationError('תזרים לא תקין');
  const flow = await db.flows.get(fid);
  if (!flow) throw new ValidationError('תזרים לא נמצא');

  const patch = {};
  if (name != null) {
    const clean = sanitizeName(name, 60);
    if (!clean) throw new ValidationError('שם תזרים לא תקין');
    patch.name = clean;
  }
  if (isDefault === true) patch.isDefault = true;
  if (!Object.keys(patch).length) return;

  await db.transaction('rw', db.flows, async () => {
    if (patch.isDefault) {
      const siblings = flow.categoryId
        ? await getFlowsForCategory(flow.categoryId)
        : await getFlowsForGroup(flow.categoryGroupId);
      for (const sibling of siblings) {
        if (sibling.id !== fid && sibling.isDefault) {
          await db.flows.update(sibling.id, { isDefault: false });
        }
      }
    }
    await db.flows.update(fid, patch);
  });
}

export async function deleteFlow(flowId) {
  const fid = sanitizeProductId(flowId);
  if (!fid) throw new ValidationError('תזרים לא תקין');
  const flow = await db.flows.get(fid);
  if (!flow) return;

  const siblings = flow.categoryId
    ? await getFlowsForCategory(flow.categoryId)
    : await getFlowsForGroup(flow.categoryGroupId);
  if (siblings.length <= 1) {
    throw new ValidationError('לא ניתן למחוק את התזרים האחרון');
  }

  await db.transaction('rw', db.flows, db.flowSteps, db.flowCleaningTasks, db.flowChecklistItems, async () => {
    await db.flowSteps.where('flowId').equals(fid).delete();
    await db.flowCleaningTasks.where('flowId').equals(fid).delete();
    await db.flowChecklistItems.where('flowId').equals(fid).delete();
    await db.flows.delete(fid);
    if (flow.isDefault) {
      const remaining = siblings.filter((f) => f.id !== fid);
      if (remaining.length) await db.flows.update(remaining[0].id, { isDefault: true });
    }
  });
}

async function addFlowStepRecord({ flowId, name, tracksPortions = false, tracksProduction = false, portionUnit = null, portionSize = null }) {
  const clean = sanitizeName(name, 80);
  if (!clean) throw new ValidationError('שם שלב לא תקין');
  const fid = sanitizeProductId(flowId);
  if (!fid) throw new ValidationError('תזרים לא תקין');
  const flow = await db.flows.get(fid);
  if (!flow) throw new ValidationError('תזרים לא נמצא');
  const existing = await getFlowStepsForFlow(fid);
  const maxOrder = existing.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), 0);
  const record = {
    flowId: fid,
    categoryId: flow.categoryId || null,
    categoryGroupId: flow.categoryGroupId || null,
    name: clean,
    sortOrder: maxOrder + 1,
    tracksPortions: !!tracksPortions,
    tracksProduction: !!tracksProduction,
    portionUnit: null,
    portionSize: null,
  };
  if (record.tracksPortions && (portionUnit || portionSize != null && portionSize !== '')) {
    const unit = portionUnit === 'weight' ? 'weight' : 'units';
    const pSize = sanitizePortionSizeForUnit(portionSize, unit);
    if (pSize != null) {
      record.portionUnit = unit;
      record.portionSize = pSize;
    }
  }
  return db.flowSteps.add(record);
}

export async function addFlowStepToFlow(flowId, name, { tracksPortions, tracksProduction, portionUnit, portionSize } = {}) {
  return addFlowStepRecord({ flowId, name, tracksPortions, tracksProduction, portionUnit, portionSize });
}

export async function addFlowStep(categoryId, name) {
  const flows = await getFlowsForCategory(categoryId);
  const flow = flows.find((f) => f.isDefault) || flows[0];
  if (!flow) throw new ValidationError('אין תזרים — צור תזרים חדש');
  return addFlowStepRecord({ flowId: flow.id, name });
}

export async function addFlowStepToGroup(categoryGroupId, name) {
  const flows = await getFlowsForGroup(categoryGroupId);
  const flow = flows.find((f) => f.isDefault) || flows[0];
  if (!flow) throw new ValidationError('אין תזרים — צור תזרים חדש');
  return addFlowStepRecord({ flowId: flow.id, name });
}

export async function updateFlowStep(id, { name, tracksPortions, tracksProduction, portionUnit, portionSize } = {}) {
  const existing = await db.flowSteps.get(id);
  if (!existing) throw new ValidationError('שלב לא נמצא');
  const patch = {};
  if (name != null) {
    const clean = sanitizeName(name, 80);
    if (!clean) throw new ValidationError('שם שלב לא תקין');
    patch.name = clean;
  }
  if (tracksPortions !== undefined) patch.tracksPortions = !!tracksPortions;
  if (tracksProduction !== undefined) {
    if (tracksProduction === false && existing.tracksProduction) {
      throw new ValidationError('שלב תיעוד ייצור הוא חובה בכל תזרים — לא ניתן לבטל');
    }
    patch.tracksProduction = !!tracksProduction;
  }
  if (portionUnit !== undefined) patch.portionUnit = portionUnit === 'weight' ? 'weight' : 'units';
  if (portionSize !== undefined) {
    patch.portionSize = portionSize === '' || portionSize == null
      ? null
      : sanitizePortionSizeForUnit(
        portionSize,
        (patch.portionUnit ?? existing.portionUnit) === 'weight' ? 'weight' : 'units',
      );
  }
  const willTrack = patch.tracksPortions !== undefined ? patch.tracksPortions : existing.tracksPortions;
  if (willTrack && (portionUnit !== undefined || portionSize !== undefined)) {
    const unit = (patch.portionUnit ?? existing.portionUnit) === 'weight' ? 'weight' : 'units';
    const size = patch.portionSize !== undefined ? patch.portionSize : existing.portionSize;
    if (size != null && size !== '') {
      const pSize = sanitizePortionSizeForUnit(size, unit);
      if (pSize != null) {
        patch.portionUnit = unit;
        patch.portionSize = pSize;
        patch.tracksPortions = true;
      }
    }
  } else if (tracksPortions === false) {
    patch.portionUnit = null;
    patch.portionSize = null;
    patch.tracksPortions = false;
  }
  if (!Object.keys(patch).length) return;
  return db.flowSteps.update(id, patch);
}

export async function deleteFlowStep(id) {
  const step = await db.flowSteps.get(id);
  if (step?.tracksProduction) {
    throw new ValidationError('לא ניתן למחוק את שלב תיעוד הייצור — הוא חובה בכל תזרים');
  }
  const flowId = step?.flowId;
  await db.flowSteps.delete(id);
  if (flowId) await ensureFlowProductionStep(flowId);
}

export async function getGroupPortionPresets(categoryGroupId) {
  const gid = sanitizeProductId(categoryGroupId);
  if (!gid) return [];
  const rows = await db.groupPortionPresets.where('categoryGroupId').equals(gid).toArray();
  rows.sort((a, b) => comparePortionPresets(a, b));
  return rows;
}

export const PORTION_LINK_PRODUCT = 'product';
export const PORTION_LINK_CATEGORY = 'category';
export const PORTION_LINK_GROUP = 'group';

function comparePortionPresets(a, b) {
  return (a.catalogSortOrder ?? a.sortOrder ?? 0) - (b.catalogSortOrder ?? b.sortOrder ?? 0) || a.id - b.id;
}

export function getPortionLinkKindLabel(linkTargetType) {
  if (linkTargetType === PORTION_LINK_GROUP) return 'קטגוריה כללית';
  if (linkTargetType === PORTION_LINK_CATEGORY) return 'קטגוריה';
  if (linkTargetType === PORTION_LINK_PRODUCT) return 'מוצר';
  return '';
}

function normalizePortionLinkIds(raw) {
  const uniq = (arr) => [...new Set((arr || []).map(Number).filter(Boolean))];
  return {
    productIds: uniq(raw.productIds),
    categoryIds: uniq(raw.categoryIds),
    groupIds: uniq(raw.groupIds),
  };
}

async function getPortionPresetLinksMap(portionPresetIds = null) {
  const rows = portionPresetIds?.length
    ? (await Promise.all(portionPresetIds.map((id) =>
      db.portionPresetLinks.where('portionPresetId').equals(Number(id)).toArray()))).flat()
    : await db.portionPresetLinks?.toArray?.() ?? [];
  const map = new Map();
  for (const row of rows) {
    const pid = Number(row.portionPresetId);
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid).push(row);
  }
  for (const links of map.values()) {
    links.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  }
  return map;
}

function splitPortionLinks(links = []) {
  const productIds = [];
  const categoryIds = [];
  const groupIds = [];
  for (const link of links) {
    const id = Number(link.targetId);
    if (!id) continue;
    if (link.linkType === PORTION_LINK_PRODUCT) productIds.push(id);
    else if (link.linkType === PORTION_LINK_CATEGORY) categoryIds.push(id);
    else if (link.linkType === PORTION_LINK_GROUP) groupIds.push(id);
  }
  return { productIds, categoryIds, groupIds };
}

function buildPortionLinkSummary({ productIds, categoryIds, groupIds }, maps) {
  const parts = [];
  if (groupIds.length) {
    const names = groupIds.map((id) => maps.groupMap.get(id)?.name).filter(Boolean);
    if (names.length) parts.push(`קטגוריות כלליות: ${names.join(', ')}`);
  }
  if (categoryIds.length) {
    const names = categoryIds.map((id) => maps.categoryMap.get(id)?.name).filter(Boolean);
    if (names.length) parts.push(`קטגוריות: ${names.join(', ')}`);
  }
  if (productIds.length) {
    const names = productIds.map((id) => maps.productMap.get(id)?.name).filter(Boolean);
    if (names.length) parts.push(`מוצרים: ${names.join(', ')}`);
  }
  return parts.join(' · ');
}

async function portionPresetAppliesToProduct(preset, productId, prod, cat, gid, links = []) {
  if (links.length) {
    for (const link of links) {
      const targetId = Number(link.targetId);
      if (link.linkType === PORTION_LINK_PRODUCT && targetId === productId) return true;
      if (link.linkType === PORTION_LINK_CATEGORY && targetId === prod.categoryId) return true;
      if (link.linkType === PORTION_LINK_GROUP && gid && targetId === Number(gid)) return true;
    }
    return false;
  }

  const linkType = preset.linkTargetType;
  if (linkType === PORTION_LINK_PRODUCT) {
    return Number(preset.linkProductId) === productId;
  }
  if (linkType === PORTION_LINK_CATEGORY) {
    return Number(preset.linkCategoryId) === prod.categoryId;
  }
  if (linkType === PORTION_LINK_GROUP) {
    const linkGid = Number(preset.linkCategoryGroupId || preset.categoryGroupId);
    return linkGid && Number(gid) === linkGid;
  }

  if (preset.sourceRecipeId) {
    if (gid && Number(preset.categoryGroupId) !== Number(gid)) return false;
    const { resolveRecipeLinkedProductIds, getProductRecipeComponents } = await import('./kitchen-db.js');
    const recipe = await db.recipes.get(preset.sourceRecipeId);
    if (!recipe) return false;
    const componentRecipeIds = new Set(
      (await getProductRecipeComponents(productId)).map((c) => c.recipeId),
    );
    const linkedIds = await resolveRecipeLinkedProductIds(recipe);
    return linkedIds.includes(productId) || componentRecipeIds.has(preset.sourceRecipeId);
  }

  return gid && Number(preset.categoryGroupId) === Number(gid);
}

export async function getPortionPresetsCatalog() {
  const [presets, recipes, groups, categories, products, linksMap] = await Promise.all([
    db.groupPortionPresets.toArray(),
    db.recipes.toArray(),
    db.categoryGroups.toArray(),
    db.categories.toArray(),
    db.products.toArray(),
    getPortionPresetLinksMap(),
  ]);
  const recipeMap = new Map(recipes.map((r) => [r.id, r]));
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const maps = { groupMap, categoryMap, productMap };

  return presets.slice().sort(comparePortionPresets).map((preset) => {
    const recipe = preset.sourceRecipeId ? recipeMap.get(preset.sourceRecipeId) : null;
    const parentRecipe = recipe?.parentRecipeId ? recipeMap.get(recipe.parentRecipeId) : null;
    const homeGroup = groupMap.get(Number(preset.categoryGroupId));
    const links = linksMap.get(preset.id) || [];
    const { productIds, categoryIds, groupIds } = splitPortionLinks(links);
    const hasCustomLinks = links.length > 0;
    let linkLabel = '';
    let linkPath = '';
    if (hasCustomLinks) {
      linkLabel = buildPortionLinkSummary({ productIds, categoryIds, groupIds }, maps);
      linkPath = 'שיוך מותאם — המנה תופיע למוצרים שמתאימים לאחד מהיעדים';
    } else if (preset.sourceRecipeId) {
      linkLabel = recipe?.parentRecipeId ? 'תת מתכון · לפי שיוך מתכון' : 'לפי שיוך מתכון';
      linkPath = recipe?.parentRecipeId
        ? `תת מתכון: ${recipe.name}${parentRecipe ? ` · ${parentRecipe.name}` : ''}`
        : (recipe?.name ? `מתכון: ${recipe.name}` : '');
      if (Number(preset.categoryGroupId) === 0) {
        linkLabel = recipe?.parentRecipeId ? 'תת מתכון · בקטלוג' : 'מתכון · בקטלוג';
        linkPath = (linkPath ? `${linkPath} · ` : '') + 'עדיין בלי שיוך לקבוצת מוצרים';
      }
    } else {
      linkLabel = homeGroup?.name ? `כל ${homeGroup.name}` : 'כל הקבוצה';
      linkPath = 'ברירת מחדל — כל המוצרים בקבוצת התזרים';
    }
    return {
      ...preset,
      recipeName: recipe?.name || null,
      parentRecipeName: parentRecipe?.name || null,
      isSubRecipe: !!recipe?.parentRecipeId,
      homeGroupName: Number(preset.categoryGroupId) === 0
        ? 'קטלוג מנות'
        : (homeGroup?.name || ''),
      sourceKind: preset.sourceRecipeId ? 'recipe' : 'manual',
      sourceLabel: preset.sourceRecipeId
        ? (recipe?.parentRecipeId
          ? `תת מתכון · ${recipe?.name || ''}${parentRecipe ? ` (${parentRecipe.name})` : ''}`
          : `מתכון · ${recipe?.name || ''}`)
        : `תזרים · ${homeGroup?.name || ''}`,
      hasCustomLinks,
      linkProductIds: productIds,
      linkCategoryIds: categoryIds,
      linkGroupIds: groupIds,
      linkKindLabel: hasCustomLinks ? 'שיוך מותאם' : '',
      linkLabel,
      linkPath,
    };
  });
}

export async function updatePortionPresetLink(id, link = {}) {
  const pid = Number(id);
  const existing = await db.groupPortionPresets.get(pid);
  if (!existing) throw new ValidationError('מנה לא נמצאה');

  if (link.useDefault) {
    await db.transaction('rw', db.groupPortionPresets, db.portionPresetLinks, async () => {
      await db.portionPresetLinks.where('portionPresetId').equals(pid).delete();
      await db.groupPortionPresets.update(pid, {
        linkTargetType: null,
        linkProductId: null,
        linkCategoryId: null,
        linkCategoryGroupId: null,
      });
    });
    return;
  }

  const { productIds, categoryIds, groupIds } = normalizePortionLinkIds(link);
  if (!productIds.length && !categoryIds.length && !groupIds.length) {
    throw new ValidationError('בחר לפחות קטגוריה, קטגוריה כללית או מוצר אחד');
  }

  for (const cid of categoryIds) {
    const category = await db.categories.get(cid);
    if (!category) throw new ValidationError('קטגוריה לא נמצאה');
  }
  for (const gid of groupIds) {
    const group = await db.categoryGroups.get(gid);
    if (!group) throw new ValidationError('קטגוריה כללית לא נמצאה');
  }
  for (const prodId of productIds) {
    const product = await db.products.get(prodId);
    if (!product) throw new ValidationError('מוצר לא נמצא');
  }

  const rows = [];
  let order = 1;
  for (const targetId of groupIds) rows.push({ linkType: PORTION_LINK_GROUP, targetId, sortOrder: order++ });
  for (const targetId of categoryIds) rows.push({ linkType: PORTION_LINK_CATEGORY, targetId, sortOrder: order++ });
  for (const targetId of productIds) rows.push({ linkType: PORTION_LINK_PRODUCT, targetId, sortOrder: order++ });

  await db.transaction('rw', db.groupPortionPresets, db.portionPresetLinks, async () => {
    await db.portionPresetLinks.where('portionPresetId').equals(pid).delete();
    for (const row of rows) {
      await db.portionPresetLinks.add({ portionPresetId: pid, ...row });
    }
    await db.groupPortionPresets.update(pid, {
      linkTargetType: null,
      linkProductId: null,
      linkCategoryId: null,
      linkCategoryGroupId: null,
    });
  });
}

export async function setPortionPresetCatalogOrder(orderedIds) {
  if (!Array.isArray(orderedIds) || !orderedIds.length) return;
  await db.transaction('rw', db.groupPortionPresets, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      const id = Number(orderedIds[i]);
      if (!id) continue;
      await db.groupPortionPresets.update(id, { catalogSortOrder: i + 1 });
    }
  });
}

/** מנות הרלוונטיות למוצר — לפי שיוך מפורש, מתכון או קבוצת תזרים */
export async function getPortionPresetsForProduct(productId) {
  const pid = Number(productId);
  if (!pid) return [];
  const prod = await db.products.get(pid);
  if (!prod?.categoryId) return [];
  const cat = await db.categories.get(prod.categoryId);
  const gid = cat?.groupId;

  const allPresets = await db.groupPortionPresets.toArray();
  const linksMap = await getPortionPresetLinksMap(allPresets.map((p) => p.id));
  const applicable = [];
  for (const preset of allPresets) {
    const links = linksMap.get(preset.id) || [];
    if (await portionPresetAppliesToProduct(preset, pid, prod, cat, gid, links)) {
      applicable.push(preset);
    }
  }
  applicable.sort(comparePortionPresets);
  return applicable;
}

/**
 * מזהי מוצרים / קטגוריות של מתכון — בלי הרחבת «קטגוריה כללית» לכל המוצרים.
 * לתזרים: מנות מקטגוריה כללית לא נכנסות אוטומטית.
 */
async function resolveRecipeStrictProductAndCategoryIds(recipe) {
  if (!recipe) return { productIds: [], categoryIds: [], isGroupOnly: false };
  const { inferRecipeProductLinkScope } = await import('./kitchen-db.js');
  const scope = inferRecipeProductLinkScope(recipe);
  if (scope === 'group') return { productIds: [], categoryIds: [], isGroupOnly: true };

  const productIds = (recipe.linkedProductIds?.length
    ? recipe.linkedProductIds
    : (recipe.linkedProductId ? [recipe.linkedProductId] : [])).map(Number).filter(Boolean);

  const categoryIds = (recipe.linkedProductCategoryIds?.length
    ? recipe.linkedProductCategoryIds
    : (recipe.linkedProductCategoryId ? [recipe.linkedProductCategoryId] : [])).map(Number).filter(Boolean);

  return { productIds, categoryIds, isGroupOnly: false };
}

/**
 * האם מנה רלוונטית לתזרים — רק שיוך למוצר/קטגוריה של מוצרים בתזרים,
 * לא שיוך לקטגוריה כללית בלבד.
 */
async function portionPresetAppliesToFlowProducts(preset, flowProducts, links = []) {
  if (!flowProducts?.length) return false;
  const flowProductIds = new Set(flowProducts.map((p) => Number(p.id)));
  const flowCategoryIds = new Set(flowProducts.map((p) => Number(p.categoryId)).filter(Boolean));

  if (links.length) {
    for (const link of links) {
      const targetId = Number(link.targetId);
      if (!targetId) continue;
      if (link.linkType === PORTION_LINK_PRODUCT && flowProductIds.has(targetId)) return true;
      if (link.linkType === PORTION_LINK_CATEGORY && flowCategoryIds.has(targetId)) return true;
      // PORTION_LINK_GROUP — לא נכלל בתזרים (מנות של קטגוריה כללית)
    }
    return false;
  }

  const linkType = preset.linkTargetType;
  if (linkType === PORTION_LINK_PRODUCT) {
    return flowProductIds.has(Number(preset.linkProductId));
  }
  if (linkType === PORTION_LINK_CATEGORY) {
    return flowCategoryIds.has(Number(preset.linkCategoryId));
  }
  if (linkType === PORTION_LINK_GROUP) {
    return false;
  }

  if (preset.sourceRecipeId) {
    const { getProductRecipeComponents } = await import('./kitchen-db.js');
    for (const product of flowProducts) {
      const componentRecipeIds = new Set(
        (await getProductRecipeComponents(product.id)).map((c) => c.recipeId),
      );
      if (componentRecipeIds.has(preset.sourceRecipeId)) return true;
    }

    const recipe = await db.recipes.get(preset.sourceRecipeId);
    if (!recipe) return false;
    const { productIds, categoryIds, isGroupOnly } = await resolveRecipeStrictProductAndCategoryIds(recipe);
    if (isGroupOnly) return false;
    if (productIds.some((id) => flowProductIds.has(Number(id)))) return true;
    if (categoryIds.some((id) => flowCategoryIds.has(Number(id)))) return true;
    return false;
  }

  // מנה ידנית בלי שיוך מותאם = ברירת מחדל לכל הקבוצה — לא בתזרים
  return false;
}

/** מוצרים שרלוונטיים לתזרים לצורך סינון מנות */
async function resolveFlowProductsForPortions(flowId) {
  const fid = Number(flowId);
  if (!fid) return [];
  const linked = await getLinkedProductsForFlow(fid);
  if (linked.length) {
    return linked.map((row) => row.product).filter((p) => p && p.active !== false);
  }
  return getCandidateProductsForFlow(fid);
}

/** מנות לתזרים — רק כאלה שמשויכות למוצר/קטגוריה של מוצרים שבתזרים */
export async function getFlowPortionPresets(flowId) {
  const fid = Number(flowId);
  if (!fid) return [];
  const flowProducts = await resolveFlowProductsForPortions(fid);
  if (!flowProducts.length) return [];

  const gid = await resolveCategoryGroupIdForFlow(fid);
  const candidates = gid
    ? await getGroupPortionPresets(gid)
    : (await db.groupPortionPresets.toArray()).sort(comparePortionPresets);

  // גם מנות בקטלוג (categoryGroupId=0) שמשויכות למוצר בתזרים
  const catalogPresets = gid
    ? (await db.groupPortionPresets.where('categoryGroupId').equals(0).toArray())
    : [];
  const byId = new Map();
  for (const p of [...candidates, ...catalogPresets]) byId.set(p.id, p);
  const pool = [...byId.values()];

  const linksMap = await getPortionPresetLinksMap(pool.map((p) => p.id));
  const applicable = [];
  for (const preset of pool) {
    const links = linksMap.get(preset.id) || [];
    if (await portionPresetAppliesToFlowProducts(preset, flowProducts, links)) {
      applicable.push(preset);
    }
  }
  applicable.sort(comparePortionPresets);
  return applicable;
}

export async function addGroupPortionPreset(categoryGroupId, { name, weight, extra } = {}) {
  const gid = sanitizeProductId(categoryGroupId);
  if (!gid) throw new ValidationError('קטגוריה כללית לא תקינה');
  const group = await db.categoryGroups.get(gid);
  if (!group) throw new ValidationError('קטגוריה כללית לא נמצאה');
  const cleanName = sanitizeName(name, 80);
  if (!cleanName) throw new ValidationError('שם מנה לא תקין');
  const w = sanitizePortionSize(weight);
  if (w == null) throw new ValidationError('משקל מנה לא תקין');
  const existing = await getGroupPortionPresets(gid);
  const maxOrder = existing.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0);
  return db.groupPortionPresets.add({
    categoryGroupId: gid,
    name: cleanName,
    weight: w,
    extra: String(extra || '').trim().slice(0, 120),
    sortOrder: maxOrder + 1,
  });
}

export async function updateGroupPortionPreset(id, { name, weight, extra } = {}) {
  const existing = await db.groupPortionPresets.get(id);
  if (!existing) throw new ValidationError('מנה לא נמצאה');
  if (existing.sourceRecipeId) {
    throw new ValidationError('מנה ממתכון מקושר — ערוך במסך המתכונים');
  }
  const patch = {};
  if (name != null) {
    const cleanName = sanitizeName(name, 80);
    if (!cleanName) throw new ValidationError('שם מנה לא תקין');
    patch.name = cleanName;
  }
  if (weight != null && weight !== '') {
    const w = sanitizePortionSize(weight);
    if (w == null) throw new ValidationError('משקל מנה לא תקין');
    patch.weight = w;
  }
  if (extra !== undefined) patch.extra = String(extra || '').trim().slice(0, 120);
  if (!Object.keys(patch).length) return;
  return db.groupPortionPresets.update(id, patch);
}

export async function deleteGroupPortionPreset(id) {
  const existing = await db.groupPortionPresets.get(id);
  if (existing?.sourceRecipeId) {
    throw new ValidationError('מנה ממתכון מקושר — ערוך במסך המתכונים');
  }
  await db.transaction('rw', db.groupPortionPresets, db.portionPresetLinks, db.portionPresetIngredientSettings, async () => {
    await db.portionPresetIngredientSettings?.where('portionPresetId').equals(Number(id)).delete?.();
    await db.portionPresetLinks.where('portionPresetId').equals(Number(id)).delete();
    await db.groupPortionPresets.delete(id);
  });
}

/** @deprecated use group-level APIs */
export async function addFlowPortionPreset(flowId, fields) {
  const gid = await resolveCategoryGroupIdForFlow(flowId);
  if (!gid) throw new ValidationError('לא נמצאה קטגוריה כללית לתזרים');
  return addGroupPortionPreset(gid, fields);
}

/** @deprecated use group-level APIs */
export async function updateFlowPortionPreset(id, fields) {
  return updateGroupPortionPreset(id, fields);
}

/** @deprecated use group-level APIs */
export async function deleteFlowPortionPreset(id) {
  return deleteGroupPortionPreset(id);
}

export function formatPortionBatchSummary(batch) {
  if (!batch) return '';
  if (batch.name) {
    const parts = [batch.name];
    if (batch.weight != null) parts.push(`${batch.weight} ק"ג`);
    if (batch.extra) parts.push(batch.extra);
    parts.push(`×${batch.count}`);
    return parts.join(' · ');
  }
  return `+${batch.count} מנות`;
}

export async function setFlowStepOrderForFlow(flowId, orderedIds) {
  const fid = sanitizeProductId(flowId);
  if (!fid || !Array.isArray(orderedIds)) return;
  await db.transaction('rw', db.flowSteps, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      const stepId = sanitizeProductId(orderedIds[i]);
      if (!stepId) continue;
      const step = await db.flowSteps.get(stepId);
      if (step?.flowId === fid) await db.flowSteps.update(stepId, { sortOrder: i + 1 });
    }
  });
}

export async function setFlowStepOrder(categoryId, orderedIds) {
  const flows = await getFlowsForCategory(categoryId);
  const flow = flows.find((f) => f.isDefault) || flows[0];
  if (!flow) return;
  return setFlowStepOrderForFlow(flow.id, orderedIds);
}

export async function setFlowStepOrderForGroup(categoryGroupId, orderedIds) {
  const flows = await getFlowsForGroup(categoryGroupId);
  const flow = flows.find((f) => f.isDefault) || flows[0];
  if (!flow) return;
  return setFlowStepOrderForFlow(flow.id, orderedIds);
}

const DEFAULT_FLOW_STEPS = ['הכנת חומרי גלם', 'ערבוב / הכנה', 'שקילה', 'עיצוב', 'אפייה', 'קירור', 'אריזה'];

async function ensureFlowProductionStepInTx(tx, flowId) {
  const steps = await tx.table('flowSteps').where('flowId').equals(flowId).toArray();
  steps.sort(compareFlowSteps);
  if (steps.some((s) => s.tracksProduction)) return false;
  const named = steps.find((s) => s.name === PRODUCTION_STEP_NAME);
  if (named) {
    await tx.table('flowSteps').update(named.id, { tracksProduction: true });
    return true;
  }
  const maxOrder = steps.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), 0);
  const flow = await tx.table('flows').get(flowId);
  await tx.table('flowSteps').add({
    flowId,
    categoryId: flow?.categoryId || null,
    categoryGroupId: flow?.categoryGroupId || null,
    name: PRODUCTION_STEP_NAME,
    sortOrder: maxOrder + 1,
    tracksPortions: false,
    tracksProduction: true,
    portionUnit: null,
    portionSize: null,
  });
  return true;
}

export async function ensureFlowProductionStep(flowId) {
  const fid = sanitizeProductId(flowId);
  if (!fid) return false;
  const stores = pickDbTables('flowSteps', 'flows');
  if (stores.length < 2) throw new ValidationError('מסד נתונים לא מוכן — לחץ על מספר הגרסה לעדכון');
  return db.transaction('rw', ...stores, (tx) => ensureFlowProductionStepInTx(tx, fid));
}

export async function copyDefaultFlowStepsToFlow(flowId) {
  const fid = sanitizeProductId(flowId);
  if (!fid) return 0;
  const existing = await getFlowStepsForFlow(fid);
  if (existing.length) return 0;
  for (let i = 0; i < DEFAULT_FLOW_STEPS.length; i++) {
    await addFlowStepRecord({ flowId: fid, name: DEFAULT_FLOW_STEPS[i] });
  }
  await addFlowStepRecord({ flowId: fid, name: PRODUCTION_STEP_NAME, tracksProduction: true });
  return DEFAULT_FLOW_STEPS.length + 1;
}

export async function copyDefaultFlowStepsToCategory(categoryId) {
  const cid = sanitizeProductId(categoryId);
  if (!cid) return 0;
  let flows = await getFlowsForCategory(cid);
  if (!flows.length) {
    await createFlow({ categoryId: cid, name: 'ברירת מחדל', withDefaults: true });
    return DEFAULT_FLOW_STEPS.length;
  }
  const flow = flows.find((f) => f.isDefault) || flows[0];
  return copyDefaultFlowStepsToFlow(flow.id);
}

export async function copyDefaultFlowStepsToGroup(categoryGroupId) {
  const gid = sanitizeProductId(categoryGroupId);
  if (!gid) return 0;
  let flows = await getFlowsForGroup(gid);
  if (!flows.length) {
    await createFlow({ categoryGroupId: gid, name: 'ברירת מחדל', withDefaults: true });
    return DEFAULT_FLOW_STEPS.length;
  }
  const flow = flows.find((f) => f.isDefault) || flows[0];
  return copyDefaultFlowStepsToFlow(flow.id);
}

function nowISO() {
  return localDateTimeISO();
}

function isoDatePart(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

function mergeDateIntoIso(dateStr, existingIso) {
  if (!isValidISODate(dateStr)) throw new ValidationError('תאריך לא תקין');
  let time = localDateTimeISO().slice(11, 19);
  if (existingIso && String(existingIso).length >= 19) {
    time = String(existingIso).slice(11, 19);
  }
  return `${dateStr}T${time}`;
}

function isoTimePart(iso) {
  if (!iso || String(iso).length < 16) return '12:00:00';
  return String(iso).slice(11, 19);
}

function mergeDateTimeIntoIso(dateStr, timeStr, existingIso) {
  const date = dateStr || isoDatePart(existingIso);
  if (!isValidISODate(date)) throw new ValidationError('תאריך לא תקין');
  let time = '12:00:00';
  if (timeStr) {
    const t = String(timeStr).trim();
    if (/^\d{2}:\d{2}$/.test(t)) time = `${t}:00`;
    else if (/^\d{2}:\d{2}:\d{2}$/.test(t)) time = t;
    else throw new ValidationError('שעה לא תקינה');
  } else if (existingIso) {
    time = isoTimePart(existingIso);
  }
  return `${date}T${time}`;
}

function resolveFlowStepsParamsFromRun(run) {
  const ids = run.categoryIds?.length ? run.categoryIds : (run.categoryId ? [run.categoryId] : []);
  return {
    categoryId: ids.length === 1 ? ids[0] : (run.categoryId || null),
    categoryGroupId: run.categoryGroupId || null,
    flowId: run.flowId || null,
  };
}

function flowStepMetaFromTemplate(tpl) {
  return {
    stepName: tpl.name,
    tracksPortions: !!tpl.tracksPortions,
    tracksProduction: !!tpl.tracksProduction,
    portionUnit: tpl.tracksPortions && tpl.portionUnit ? tpl.portionUnit : null,
    portionSize: tpl.tracksPortions && tpl.portionSize != null ? tpl.portionSize : null,
  };
}

function validateStepTimes(run, stepIndex, { startedAtIso, completedAtIso } = {}, step = {}) {
  const started = startedAtIso || step.startedAt;
  const completed = completedAtIso || step.completedAt;
  if (started) {
    const st = Date.parse(started);
    if (!Number.isFinite(st)) throw new ValidationError('שעת התחלה לא תקינה');
    if (run.startedAt && st < Date.parse(run.startedAt)) {
      throw new ValidationError('שעת התחלה לפני תחילת התהליך');
    }
  }
  if (completed) {
    const ct = Date.parse(completed);
    if (!Number.isFinite(ct)) throw new ValidationError('שעת סיום לא תקינה');
  }
  if (started && completed && Date.parse(completed) < Date.parse(started)) {
    throw new ValidationError('שעת סיום לפני שעת התחלה');
  }
}

function defaultStepStartedAt(run, stepIndex, step) {
  if (step?.startedAt) return step.startedAt;
  if (stepIndex === 0) return run.startedAt || nowISO();
  const prev = run.steps[stepIndex - 1];
  return prev?.completedAt || run.startedAt || nowISO();
}

export async function startProductionRun({
  date, batchNumber, categoryId, categoryIds, productId, categoryGroupId,
  scopeMode, portionUnit, portionSize, portionCount, flowId,
}) {
  if (!isValidISODate(date)) throw new ValidationError('תאריך לא תקין');
  const runSettings = await getRunSettings();
  let batch = String(batchNumber || '').trim().slice(0, 40);
  if (!batch && runSettings.autoBatchEnabled) {
    batch = String(Math.max(1, Number(runSettings.nextBatchNumber) || 1));
  }

  const gid = categoryGroupId ? Number(categoryGroupId) : null;
  const pid = productId ? sanitizeProductId(productId) : null;
  let resolvedCategoryIds = [];
  let resolvedCategoryId = null;
  let steps = [];

  let resolvedFlowId = flowId ? Number(flowId) : null;
  let flowName = '';

  if (scopeMode === 'product') {
    if (!pid) throw new ValidationError('בחר מוצר');
    const product = await db.products.get(pid);
    if (!product) throw new ValidationError('מוצר לא נמצא');
    resolvedCategoryId = product.categoryId;
    resolvedCategoryIds = [resolvedCategoryId];
    steps = await resolveFlowSteps({ categoryId: resolvedCategoryId, categoryGroupId: gid, flowId: resolvedFlowId });
  } else if (scopeMode === 'group') {
    if (!gid) throw new ValidationError('בחר קטגוריה כללית');
    const cats = await db.categories.where('groupId').equals(gid).toArray();
    if (!cats.length) throw new ValidationError('אין קטגוריות בקבוצה');
    resolvedCategoryIds = cats.map((c) => c.id);
    resolvedCategoryId = resolvedCategoryIds[0];
    steps = await resolveFlowSteps({ categoryGroupId: gid, flowId: resolvedFlowId });
  } else if (scopeMode === 'categories') {
    if (!gid) throw new ValidationError('בחר קטגוריה כללית');
    resolvedCategoryIds = (categoryIds || []).map(Number).filter(Boolean);
    if (!resolvedCategoryIds.length) throw new ValidationError('בחר לפחות קטגוריה אחת');
    const groupCats = await db.categories.where('groupId').equals(gid).toArray();
    const groupCatIds = new Set(groupCats.map((c) => c.id));
    if (!resolvedCategoryIds.every((id) => groupCatIds.has(id))) {
      throw new ValidationError('כל הקטגוריות חייבות להיות באותה קבוצה');
    }
    resolvedCategoryId = resolvedCategoryIds[0];
    steps = await resolveFlowSteps({
      categoryId: resolvedCategoryIds.length === 1 ? resolvedCategoryIds[0] : null,
      categoryGroupId: gid,
      flowId: resolvedFlowId,
    });
  } else {
    const cid = sanitizeProductId(categoryId);
    if (!cid) throw new ValidationError('בחר קטגוריה');
    resolvedCategoryId = cid;
    resolvedCategoryIds = [cid];
    steps = await resolveFlowSteps({ categoryId: cid, categoryGroupId: gid, flowId: resolvedFlowId });
  }

  if (!resolvedFlowId) {
    const availableFlows = await resolveFlows({
      categoryId: resolvedCategoryId,
      categoryGroupId: gid,
      scopeMode: scopeMode || 'category',
    });
    const defaultFlow = availableFlows.find((f) => f.isDefault) || availableFlows[0];
    resolvedFlowId = defaultFlow?.id || null;
    flowName = defaultFlow?.name || '';
  } else {
    const flow = await db.flows.get(resolvedFlowId);
    flowName = flow?.name || '';
  }

  if (resolvedFlowId) {
    await ensureFlowProductionStep(resolvedFlowId);
    steps = await resolveFlowSteps({
      categoryId: resolvedCategoryId,
      categoryGroupId: gid,
      flowId: resolvedFlowId,
    });
  }

  if (!steps.length) throw new ValidationError('אין שלבי תזרים — הגדר שלבים ב«נהל תזרים»');

  await assertProductionDbReady();

  const startedAt = `${date}T${localDateTimeISO().slice(11, 19)}`;
  const prepChecks = resolvedFlowId ? await getFlowPreparations(resolvedFlowId) : [];
  const cleaningTasks = resolvedFlowId ? await getFlowCleaningTasks(resolvedFlowId) : [];

  const txStores = pickDbTables(
    'productionRuns', 'runStepStates', 'settings', 'runPreparationChecks', 'runCleaningChecks',
  );
  if (txStores.length < 5) {
    throw new ValidationError('מסד נתונים לא מוכן — לחץ על מספר הגרסה למעלה לעדכון');
  }

  const runId = await db.transaction('rw', ...txStores, async () => {
    const runId = await db.productionRuns.add({
      date,
      batchNumber: batch,
      categoryId: resolvedCategoryId,
      categoryIds: resolvedCategoryIds,
      productId: pid,
      categoryGroupId: gid,
      flowId: resolvedFlowId,
      flowName,
      scopeMode: scopeMode || 'category',
      portionUnit: null,
      portionSize: null,
      portionCount: null,
      status: 'active',
      currentStepIndex: 0,
      startedAt,
      completedAt: null,
      runPortionLogs: [],
      materialProcessingLogs: [],
    });
    for (let i = 0; i < steps.length; i++) {
      const fs = steps[i];
      await db.runStepStates.add({
        runId,
        stepIndex: i,
        stepName: fs.name,
        status: i === 0 ? 'active' : 'pending',
        startedAt: i === 0 ? startedAt : null,
        completedAt: null,
        notes: '',
        issues: '',
        improvements: '',
        tracksPortions: !!fs.tracksPortions,
        tracksProduction: !!fs.tracksProduction,
        portionUnit: fs.tracksPortions && fs.portionUnit ? fs.portionUnit : null,
        portionSize: fs.tracksPortions && fs.portionSize != null ? fs.portionSize : null,
        portionCount: null,
        portionBatches: [],
        productionEntryIds: [],
      });
    }
    if (resolvedFlowId) {
      for (const prep of prepChecks) {
        await db.runPreparationChecks.add({
          runId,
          flowPreparationId: prep.checklistTaskId,
          name: prep.name,
          sortOrder: prep.sortOrder ?? 0,
          checked: false,
          checkedAt: null,
        });
      }
      for (const task of cleaningTasks) {
        await db.runCleaningChecks.add({
          runId,
          flowCleaningTaskId: task.id,
          name: task.name,
          sortOrder: task.sortOrder ?? 0,
          checked: false,
          checkedAt: null,
        });
      }
    }
    if (runSettings.autoBatchEnabled) {
      const next = Math.max(1, Number(runSettings.nextBatchNumber) || 1) + 1;
      await db.settings.put({ key: RUN_SETTINGS_KEY, value: { ...runSettings, nextBatchNumber: next } });
    }
    return runId;
  });

  // תוכנית עבודה יומית עצמאית — לא מסנכרנים אוטומטית מתזרימים/ייצור
  return runId;
}

async function normalizeRunProductionSteps(run) {
  if (!run?.steps?.length) return false;
  let changed = false;

  for (const step of run.steps) {
    const shouldTrack = step.stepName === PRODUCTION_STEP_NAME
      || (Array.isArray(step.productionEntryIds) && step.productionEntryIds.length > 0);
    if (shouldTrack && !step.tracksProduction) {
      await db.runStepStates.update(step.id, { tracksProduction: true });
      step.tracksProduction = true;
      changed = true;
    }
  }

  if (!run.steps.some((s) => s.tracksProduction) && run.flowId) {
    const flowSteps = await db.flowSteps.where('flowId').equals(run.flowId).toArray();
    flowSteps.sort(compareFlowSteps);
    const prodFlowStep = flowSteps.find((s) => s.tracksProduction || s.name === PRODUCTION_STEP_NAME);
    if (prodFlowStep) {
      const byName = run.steps.find((s) => s.stepName === prodFlowStep.name || s.stepName === PRODUCTION_STEP_NAME);
      if (byName && !byName.tracksProduction) {
        await db.runStepStates.update(byName.id, { tracksProduction: true });
        byName.tracksProduction = true;
        changed = true;
      } else if (!byName) {
        const newIndex = run.steps.length;
        const stepId = await db.runStepStates.add({
          runId: run.id,
          stepIndex: newIndex,
          stepName: prodFlowStep.name,
          status: run.status === 'completed' ? 'completed' : 'pending',
          completedAt: run.status === 'completed' ? run.completedAt : null,
          notes: '',
          issues: '',
          improvements: '',
          tracksPortions: false,
          tracksProduction: true,
          portionUnit: null,
          portionSize: null,
          portionCount: null,
          portionBatches: [],
          productionEntryIds: [],
        });
        run.steps.push({
          id: stepId,
          runId: run.id,
          stepIndex: newIndex,
          stepName: prodFlowStep.name,
          status: run.status === 'completed' ? 'completed' : 'pending',
          completedAt: run.status === 'completed' ? run.completedAt : null,
          notes: '',
          issues: '',
          improvements: '',
          tracksPortions: false,
          tracksProduction: true,
          portionUnit: null,
          portionSize: null,
          portionCount: null,
          portionBatches: [],
          productionEntryIds: [],
        });
        changed = true;
      }
    }
  }

  return changed;
}

export function resolveProductionStepIndex(run, runEntries = []) {
  if (!run?.steps?.length) return -1;
  let idx = run.steps.findIndex((s) => s.tracksProduction);
  if (idx >= 0) return idx;
  idx = run.steps.findIndex((s) => s.stepName === PRODUCTION_STEP_NAME);
  if (idx >= 0) return idx;
  idx = run.steps.findIndex((s) => (s.productionEntryIds || []).length > 0);
  if (idx >= 0) return idx;
  if (runEntries.length > 0) return run.steps.length - 1;
  return -1;
}

export async function getProductionRun(runId, { normalize = true } = {}) {
  const run = await db.productionRuns.get(runId);
  if (!run) return null;
  const steps = await db.runStepStates.where('runId').equals(runId).toArray();
  steps.sort((a, b) => a.stepIndex - b.stepIndex);
  const result = { ...run, steps };
  if (normalize) await normalizeRunProductionSteps(result);
  return result;
}

export async function getProductionRunsForDate(date) {
  const runs = await db.productionRuns.where('date').equals(date).toArray();
  runs.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '') || b.id - a.id);
  return runs;
}

/** כל תהליכי יצור של תזרים — מהחדש לישן */
export async function getProductionRunsForFlow(flowId) {
  const fid = sanitizeProductId(flowId);
  if (!fid) return [];
  const runs = await db.productionRuns.filter((r) => Number(r.flowId) === fid).toArray();
  runs.sort((a, b) => {
    const ta = a.completedAt || a.startedAt || `${a.date || ''}T00:00:00`;
    const tb = b.completedAt || b.startedAt || `${b.date || ''}T00:00:00`;
    return tb.localeCompare(ta) || (b.id - a.id);
  });
  const full = await Promise.all(runs.map((r) => getProductionRun(r.id)));
  return full.filter(Boolean);
}

/** סיכום מוצרים שיוצרו בכל תהליכי התזרים */
export async function getFlowProductsHistory(flowId) {
  const fid = sanitizeProductId(flowId);
  if (!fid) return [];
  const runs = await db.productionRuns.filter((r) => Number(r.flowId) === fid).toArray();
  const runIds = new Set(runs.map((r) => r.id));
  if (!runIds.size) return [];

  const entries = await db.productionEntries.filter((e) => runIds.has(Number(e.runId))).toArray();
  const byProduct = new Map();
  for (const e of entries) {
    const pid = Number(e.productId);
    if (!pid) continue;
    let row = byProduct.get(pid);
    if (!row) {
      row = { productId: pid, totalQty: 0, entryCount: 0, runIds: new Set(), lastDate: '' };
      byProduct.set(pid, row);
    }
    row.totalQty += Number(e.quantity) || 0;
    row.entryCount += 1;
    if (e.runId) row.runIds.add(Number(e.runId));
    if (e.date && e.date > row.lastDate) row.lastDate = e.date;
  }

  return [...byProduct.values()]
    .map((row) => ({
      productId: row.productId,
      totalQty: Math.round(row.totalQty * 1000) / 1000,
      entryCount: row.entryCount,
      runCount: row.runIds.size,
      lastDate: row.lastDate,
    }))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.productId - b.productId);
}

export async function getActiveProductionRuns() {
  const runs = await db.productionRuns.where('status').equals('active').toArray();
  runs.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '') || b.id - a.id);
  const full = await Promise.all(runs.map((r) => getProductionRun(r.id)));
  return full.filter(Boolean);
}

/** כל תהליכי היצור — ממוינים לפי תאריך (חדש → ישן) */
export async function getAllProductionRuns() {
  const runs = await db.productionRuns.toArray();
  runs.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp) return dateCmp;
    return (b.startedAt || '').localeCompare(a.startedAt || '') || b.id - a.id;
  });
  const full = await Promise.all(runs.map((r) => getProductionRun(r.id)));
  return full.filter(Boolean);
}

export async function getProductionRunsInRange(from, to, { includeActiveOutsideRange = false } = {}) {
  const all = await db.productionRuns.toArray();
  const seen = new Set();
  const runs = [];

  for (const r of all) {
    if (r.date >= from && r.date <= to) {
      seen.add(r.id);
      runs.push(r);
    }
  }
  if (includeActiveOutsideRange) {
    for (const r of all) {
      if (r.status === 'active' && !seen.has(r.id)) {
        seen.add(r.id);
        runs.push(r);
      }
    }
  }

  runs.sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === 'active') return -1;
      if (b.status === 'active') return 1;
    }
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp) return dateCmp;
    return (b.startedAt || '').localeCompare(a.startedAt || '') || b.id - a.id;
  });

  const full = await Promise.all(runs.map((r) => getProductionRun(r.id)));
  return full.filter(Boolean);
}

export function getStepPortionBatches(step) {
  if (Array.isArray(step?.portionBatches) && step.portionBatches.length) {
    return step.portionBatches;
  }
  if (step?.tracksPortions && step.portionCount != null) {
    const date = step.completedAt ? String(step.completedAt).slice(0, 10) : todayISOFromDate();
    return [{
      count: step.portionCount,
      date,
      recordedAt: step.completedAt || managerNowISO(),
      note: '',
    }];
  }
  return [];
}

export function sumPortionBatches(batches) {
  return (batches || []).reduce((sum, b) => sum + (Number(b.count) || 0), 0);
}

export function getStepPortionTotal(step) {
  const batches = getStepPortionBatches(step);
  if (batches.length) return sumPortionBatches(batches);
  return step?.portionCount != null ? Number(step.portionCount) : null;
}

export function portionBatchLineWeightKg(batch) {
  if (batch?.weight == null) return null;
  const w = Number(batch.weight);
  const c = Number(batch.count) || 0;
  if (!Number.isFinite(w) || !Number.isFinite(c)) return null;
  return w * c;
}

function runDurationMsFromRun(run) {
  const start = run?.startedAt ? Date.parse(run.startedAt) : NaN;
  if (!Number.isFinite(start)) return null;
  const end = run?.completedAt ? Date.parse(run.completedAt) : Date.now();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

/** סיכום מדדים לתהליך יצור בודד */
export function computeRunMetrics(run, entries = []) {
  let productionQty = 0;
  const productionByProduct = new Map();
  for (const e of entries) {
    const q = Number(e.quantity) || 0;
    productionQty += q;
    const pid = Number(e.productId);
    if (pid) productionByProduct.set(pid, (productionByProduct.get(pid) || 0) + q);
  }

  let portionCount = 0;
  let portionWeightKg = 0;
  let hasPortions = false;
  let hasPortionWeight = false;

  for (const step of run?.steps || []) {
    if (!step.tracksPortions) continue;
    const total = getStepPortionTotal(step);
    if (total != null && total > 0) {
      hasPortions = true;
      portionCount += total;
    }
    for (const batch of getStepPortionBatches(step)) {
      const lineKg = portionBatchLineWeightKg(batch);
      if (lineKg != null) {
        hasPortionWeight = true;
        portionWeightKg += lineKg;
      }
    }
  }

  for (const log of getRunPortionLogs(run)) {
    const c = Number(log.count) || 0;
    if (c > 0) {
      hasPortions = true;
      portionCount += c;
    }
    const w = log.weight != null ? Number(log.weight) : null;
    if (w != null && Number.isFinite(w) && c > 0) {
      hasPortionWeight = true;
      portionWeightKg += w * c;
    }
  }

  return {
    productionQty: Math.round(productionQty * 1000) / 1000,
    productionByProduct,
    portionCount: hasPortions ? Math.round(portionCount * 100) / 100 : null,
    portionWeightKg: hasPortionWeight ? Math.round(portionWeightKg * 1000) / 1000 : null,
    durationMs: runDurationMsFromRun(run),
    runCount: 1,
    activeCount: run?.status === 'active' ? 1 : 0,
    completedCount: run?.status === 'completed' ? 1 : 0,
    ingredientBatchTracking: collectRunIngredientBatchTracking(run),
    materialProcessingLogs: getRunMaterialProcessingLogs(run),
  };
}

function mergeRunMetrics(into, add) {
  into.productionQty = (into.productionQty || 0) + (add.productionQty || 0);
  for (const [pid, qty] of add.productionByProduct || []) {
    into.productionByProduct.set(pid, (into.productionByProduct.get(pid) || 0) + qty);
  }
  if (add.portionCount != null) {
    into.portionCount = (into.portionCount || 0) + add.portionCount;
    into.hasPortions = true;
  }
  if (add.portionWeightKg != null) {
    into.portionWeightKg = (into.portionWeightKg || 0) + add.portionWeightKg;
    into.hasPortionWeight = true;
  }
  if (add.durationMs != null) {
    into.durationMs = (into.durationMs || 0) + add.durationMs;
    into.timedRunCount = (into.timedRunCount || 0) + 1;
  }
  into.runCount = (into.runCount || 0) + (add.runCount || 0);
  into.activeCount = (into.activeCount || 0) + (add.activeCount || 0);
  into.completedCount = (into.completedCount || 0) + (add.completedCount || 0);
}

/** סיכום מצטבר לרשימת תהליכים */
export function aggregateRunsMetrics(runsWithEntries) {
  const merged = {
    productionQty: 0,
    productionByProduct: new Map(),
    portionCount: null,
    portionWeightKg: null,
    durationMs: null,
    hasPortions: false,
    hasPortionWeight: false,
    timedRunCount: 0,
    runCount: 0,
    activeCount: 0,
    completedCount: 0,
  };
  for (const item of runsWithEntries) {
    const run = item.run || item;
    const entries = item.entries || [];
    mergeRunMetrics(merged, computeRunMetrics(run, entries));
  }
  if (!merged.hasPortions) merged.portionCount = null;
  if (!merged.hasPortionWeight) merged.portionWeightKg = null;
  if (!merged.timedRunCount) merged.durationMs = null;
  delete merged.hasPortions;
  delete merged.hasPortionWeight;
  delete merged.timedRunCount;
  return merged;
}

export async function addRunStepPortionBatch(runId, stepIndex, { presetId, count, date, note } = {}) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  const step = run.steps[stepIndex];
  if (!step) throw new ValidationError('שלב לא תקין');
  if (!step.tracksPortions) throw new ValidationError('שלב זה לא עוקב אחר מנות');

  const stepReached = step.status === 'completed'
    || step.status === 'active'
    || stepIndex <= run.currentStepIndex
    || run.status === 'completed';
  if (!stepReached) throw new ValidationError('השלב עדיין לא הגיע ליצור');

  const pCount = sanitizePortionCount(count);
  if (pCount == null) throw new ValidationError('הזן מספר מנות תקין (מ-0.1 ומעלה)');

  const flowPresets = run.flowId ? await getFlowPortionPresets(run.flowId) : [];
  const pid = presetId ? Number(presetId) : null;
  if (flowPresets.length && !pid) throw new ValidationError('בחר מנה מהרשימה');

  const batchDate = date && isValidISODate(date) ? date : todayISOFromDate();
  const batches = Array.isArray(step.portionBatches) ? [...step.portionBatches] : [];
  // נרמול מנות ישנות בלי batches — רק אם אין כבר רשומות
  if (!batches.length && step.portionCount != null) {
    batches.push({
      count: step.portionCount,
      name: 'מנה',
      date: step.completedAt ? String(step.completedAt).slice(0, 10) : batchDate,
      recordedAt: step.completedAt || managerNowISO(),
      note: '',
    });
  }

  const entry = {
    count: pCount,
    name: 'מנה',
    date: batchDate,
    recordedAt: managerNowISO(),
    note: String(note || '').trim().slice(0, 200),
    ingredientBatches: [],
  };

  if (pid) {
    const preset = flowPresets.find((p) => p.id === pid) || await db.groupPortionPresets.get(pid);
    if (!preset) throw new ValidationError('מנה לא נמצאה');
    entry.presetId = preset.id;
    entry.name = preset.name || 'מנה';
    entry.weight = preset.weight;
    entry.extra = preset.extra || '';
    if (preset.sourceRecipeId) {
      entry.fromRecipe = true;
      entry.sourceRecipeId = Number(preset.sourceRecipeId);
    }
  }

  batches.push(entry);

  await db.runStepStates.update(step.id, {
    portionBatches: batches,
    portionCount: sumPortionBatches(batches),
  });
}

export async function updateRunStepPortionBatch(runId, stepIndex, batchIndex, { count, date, note } = {}) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  const step = run.steps[stepIndex];
  if (!step) throw new ValidationError('שלב לא תקין');
  const batches = Array.isArray(step.portionBatches) ? [...step.portionBatches] : [];
  const idx = Number(batchIndex);
  if (idx < 0 || idx >= batches.length) throw new ValidationError('רשומת מנות לא נמצאה');

  const next = { ...batches[idx] };
  if (count !== undefined) {
    const pCount = sanitizePortionCount(count);
    if (pCount == null) throw new ValidationError('הזן מספר מנות תקין (מ-0.1 ומעלה)');
    next.count = pCount;
  }
  if (date !== undefined) {
    next.date = date && isValidISODate(date) ? date : batches[idx].date;
  }
  if (note !== undefined) {
    next.note = String(note || '').trim().slice(0, 200);
  }
  batches[idx] = next;

  await db.runStepStates.update(step.id, {
    portionBatches: batches,
    portionCount: sumPortionBatches(batches),
  });
}

export async function deleteRunStepPortionBatch(runId, stepIndex, batchIndex) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  const step = run.steps[stepIndex];
  if (!step) throw new ValidationError('שלב לא תקין');
  const batches = Array.isArray(step.portionBatches) ? [...step.portionBatches] : [];
  const idx = Number(batchIndex);
  if (idx < 0 || idx >= batches.length) throw new ValidationError('רשומת מנות לא נמצאה');

  batches.splice(idx, 1);
  await db.runStepStates.update(step.id, {
    portionBatches: batches,
    portionCount: batches.length ? sumPortionBatches(batches) : null,
  });
}

function nextEmbeddedLogId(items = []) {
  let max = 0;
  for (const item of items) {
    const n = Number(item?.id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export function getRunPortionLogs(run) {
  return Array.isArray(run?.runPortionLogs) ? run.runPortionLogs : [];
}

export function getRunMaterialProcessingLogs(run) {
  return Array.isArray(run?.materialProcessingLogs) ? run.materialProcessingLogs : [];
}

/** רשימת מספרי מנה (אריזה) לסיכום מעקב חומרי גלם */
export function collectRunIngredientBatchTracking(run) {
  const rows = [];
  const pushBatch = (portionName, portionLogId, bat) => {
    const num = String(bat.packagingBatchNumber || '').trim();
    if (!num) return;
    rows.push({
      portionName: portionName || 'מנה',
      portionLogId: portionLogId || null,
      ingredientName: bat.name || 'חומר גלם',
      packagingBatchNumber: num,
      supplierName: bat.supplierName || '',
      rawMaterialId: bat.rawMaterialId || null,
      recipeIngredientId: bat.recipeIngredientId || null,
    });
  };
  for (const log of getRunPortionLogs(run)) {
    for (const bat of log.ingredientBatches || []) {
      pushBatch(log.name || 'מנה', log.id, bat);
    }
  }
  for (const step of run?.steps || []) {
    if (!step.tracksPortions) continue;
    for (const batch of getStepPortionBatches(step)) {
      for (const bat of batch.ingredientBatches || []) {
        pushBatch(batch.name || 'מנה', null, bat);
      }
    }
  }
  return rows;
}

function cleanIngredientBatchRows(batches = []) {
  const cleaned = [];
  for (const row of batches || []) {
    const recipeIngredientId = Number(row.recipeIngredientId) || null;
    const name = String(row.name || '').trim().slice(0, 120);
    const rawMaterialId = row.rawMaterialId ? Number(row.rawMaterialId) : null;
    const supplierName = String(row.supplierName || '').trim().slice(0, 80);
    const numbers = [];
    if (Array.isArray(row.packagingBatchNumbers)) {
      for (const n of row.packagingBatchNumbers) {
        const s = String(n || '').trim().slice(0, 60);
        if (s) numbers.push(s);
      }
    }
    const single = String(row.packagingBatchNumber || '').trim().slice(0, 60);
    if (single && !numbers.includes(single)) numbers.push(single);
    if (!numbers.length && !rawMaterialId) continue;
    if (!numbers.length) {
      cleaned.push({
        recipeIngredientId,
        name: name || 'חומר גלם',
        packagingBatchNumber: '',
        rawMaterialId,
        supplierName,
      });
      continue;
    }
    for (const packagingBatchNumber of numbers) {
      cleaned.push({
        recipeIngredientId,
        name: name || 'חומר גלם',
        packagingBatchNumber,
        rawMaterialId,
        supplierName,
      });
    }
  }
  return cleaned;
}

export async function saveRunPortionIngredientBatches(runId, logId, batches = []) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  const logs = [...getRunPortionLogs(run)];
  const idx = logs.findIndex((l) => Number(l.id) === Number(logId));
  if (idx < 0) throw new ValidationError('רשומת מנה לא נמצאה');

  logs[idx] = { ...logs[idx], ingredientBatches: cleanIngredientBatchRows(batches) };
  await db.productionRuns.update(runId, { runPortionLogs: logs });
}

/** שמירת רשימת מספרי מנה על רשומת מנות בשלב */
export async function saveRunStepPortionIngredientBatches(runId, stepIndex, batchIndex, batches = []) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  const step = run.steps[stepIndex];
  if (!step) throw new ValidationError('שלב לא תקין');
  const portionBatches = Array.isArray(step.portionBatches) ? [...step.portionBatches] : [];
  const idx = Number(batchIndex);
  if (idx < 0 || idx >= portionBatches.length) throw new ValidationError('רשומת מנות לא נמצאה');

  portionBatches[idx] = {
    ...portionBatches[idx],
    ingredientBatches: cleanIngredientBatchRows(batches),
  };
  await db.runStepStates.update(step.id, { portionBatches });
}

export async function addRunPortionLog(runId, { presetId, count, date, note } = {}) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');

  const pCount = sanitizePortionCount(count);
  if (pCount == null) throw new ValidationError('הזן מספר מנות תקין (מ-0.1 ומעלה)');

  const flowPresets = run.flowId ? await getFlowPortionPresets(run.flowId) : [];
  const pid = presetId ? Number(presetId) : null;
  if (flowPresets.length && !pid) throw new ValidationError('בחר מנה מהרשימה');

  const batchDate = date && isValidISODate(date) ? date : todayISOFromDate();
  const logs = [...getRunPortionLogs(run)];
  const entry = {
    id: nextEmbeddedLogId(logs),
    count: pCount,
    name: 'מנה',
    date: batchDate,
    recordedAt: managerNowISO(),
    note: String(note || '').trim().slice(0, 200),
    ingredientBatches: [],
  };

  if (pid) {
    const preset = flowPresets.find((p) => p.id === pid) || await db.groupPortionPresets.get(pid);
    if (!preset) throw new ValidationError('מנה לא נמצאה');
    entry.presetId = preset.id;
    entry.name = preset.name || 'מנה';
    entry.weight = preset.weight;
    entry.extra = preset.extra || '';
    if (preset.sourceRecipeId) {
      entry.fromRecipe = true;
      entry.sourceRecipeId = Number(preset.sourceRecipeId);
    }
  }

  logs.push(entry);
  await db.productionRuns.update(runId, { runPortionLogs: logs });
  return entry.id;
}

export async function updateRunPortionLog(runId, logId, { count, date, note } = {}) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  const logs = [...getRunPortionLogs(run)];
  const idx = logs.findIndex((l) => Number(l.id) === Number(logId));
  if (idx < 0) throw new ValidationError('רשומת מנה לא נמצאה');

  const next = { ...logs[idx] };
  if (count !== undefined) {
    const pCount = sanitizePortionCount(count);
    if (pCount == null) throw new ValidationError('הזן מספר מנות תקין (מ-0.1 ומעלה)');
    next.count = pCount;
  }
  if (date !== undefined) {
    next.date = date && isValidISODate(date) ? date : next.date;
  }
  if (note !== undefined) {
    next.note = String(note || '').trim().slice(0, 200);
  }
  logs[idx] = next;
  await db.productionRuns.update(runId, { runPortionLogs: logs });
}

export async function deleteRunPortionLog(runId, logId) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  const logs = getRunPortionLogs(run).filter((l) => Number(l.id) !== Number(logId));
  await db.productionRuns.update(runId, { runPortionLogs: logs });
}

function sanitizeKgWeight(val) {
  if (val == null || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1000) / 1000;
}

export async function addRunMaterialProcessingLog(runId, {
  rawMaterialId, materialName, supplierId, supplierName,
  weightBeforeKg, weightAfterKg, date, note,
} = {}) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');

  const before = sanitizeKgWeight(weightBeforeKg);
  const after = sanitizeKgWeight(weightAfterKg);
  if (before == null && after == null) {
    throw new ValidationError('הזן משקל לפני ו/או אחרי עיבוד');
  }

  const name = String(materialName || '').trim().slice(0, 120);
  const matId = rawMaterialId ? Number(rawMaterialId) : null;
  if (!name && !matId) throw new ValidationError('בחר או הזן חומר גלם');

  const logs = [...getRunMaterialProcessingLogs(run)];
  const entry = {
    id: nextEmbeddedLogId(logs),
    rawMaterialId: matId,
    materialName: name || 'חומר גלם',
    supplierId: supplierId ? Number(supplierId) : null,
    supplierName: String(supplierName || '').trim().slice(0, 80),
    weightBeforeKg: before,
    weightAfterKg: after,
    date: date && isValidISODate(date) ? date : todayISOFromDate(),
    recordedAt: managerNowISO(),
    note: String(note || '').trim().slice(0, 200),
  };
  logs.push(entry);
  await db.productionRuns.update(runId, { materialProcessingLogs: logs });
  return entry.id;
}

export async function updateRunMaterialProcessingLog(runId, logId, patch = {}) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  const logs = [...getRunMaterialProcessingLogs(run)];
  const idx = logs.findIndex((l) => Number(l.id) === Number(logId));
  if (idx < 0) throw new ValidationError('רשומת עיבוד לא נמצאה');

  const next = { ...logs[idx] };
  if (patch.weightBeforeKg !== undefined) next.weightBeforeKg = sanitizeKgWeight(patch.weightBeforeKg);
  if (patch.weightAfterKg !== undefined) next.weightAfterKg = sanitizeKgWeight(patch.weightAfterKg);
  if (patch.date !== undefined && patch.date && isValidISODate(patch.date)) next.date = patch.date;
  if (patch.note !== undefined) next.note = String(patch.note || '').trim().slice(0, 200);
  if (patch.materialName !== undefined) {
    const name = String(patch.materialName || '').trim().slice(0, 120);
    if (name) next.materialName = name;
  }
  if (next.weightBeforeKg == null && next.weightAfterKg == null) {
    throw new ValidationError('הזן משקל לפני ו/או אחרי עיבוד');
  }
  logs[idx] = next;
  await db.productionRuns.update(runId, { materialProcessingLogs: logs });
}

export async function deleteRunMaterialProcessingLog(runId, logId) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  const logs = getRunMaterialProcessingLogs(run).filter((l) => Number(l.id) !== Number(logId));
  await db.productionRuns.update(runId, { materialProcessingLogs: logs });
}

export async function activateRunStep(runId, stepIndex) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  if (run.status === 'completed') throw new ValidationError('התהליך הושלם');
  const idx = Number(stepIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= run.steps.length) {
    throw new ValidationError('שלב לא תקין');
  }
  const step = run.steps[idx];
  if (!step) throw new ValidationError('שלב לא תקין');
  if (step.status === 'completed') throw new ValidationError('השלב כבר הושלם');

  return db.transaction('rw', db.productionRuns, db.runStepStates, async () => {
    await db.runStepStates.update(step.id, {
      status: 'active',
      startedAt: step.startedAt || nowISO(),
    });
    const newCurrent = Math.max(run.currentStepIndex ?? 0, idx);
    await db.productionRuns.update(runId, {
      currentStepIndex: newCurrent,
      status: 'active',
      completedAt: null,
    });
  });
}

function pauseStepTimerPatch(step) {
  if (step.timerState !== 'running' || !step.timerSegmentStartedAt) {
    return { timerState: 'paused', timerElapsedMs: Number(step.timerElapsedMs) || 0, timerSegmentStartedAt: null };
  }
  const started = parseLocalDateTimeIso(step.timerSegmentStartedAt).getTime();
  const segmentMs = Number.isFinite(started) ? Math.max(0, Date.now() - started) : 0;
  return {
    timerState: 'paused',
    timerElapsedMs: (Number(step.timerElapsedMs) || 0) + segmentMs,
    timerSegmentStartedAt: null,
  };
}

export async function setStepTimerAction(runId, stepIndex, action) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  if (run.status === 'completed') throw new ValidationError('התהליך הושלם');
  const idx = Number(stepIndex);
  const step = run.steps[idx];
  if (!step) throw new ValidationError('שלב לא תקין');
  if (step.status === 'completed') throw new ValidationError('לא ניתן לנהל סטופר לשלב שהושלם');
  if (step.status !== 'active') throw new ValidationError('הפעל את השלב לפני סטופר');

  let patch = {};
  const act = String(action || '').trim();
  if (act === 'start' || act === 'resume') {
    if (step.timerState === 'running') return;
    patch = {
      timerState: 'running',
      timerElapsedMs: Number(step.timerElapsedMs) || 0,
      timerSegmentStartedAt: nowISO(),
    };
  } else if (act === 'pause') {
    if (step.timerState !== 'running') return;
    patch = pauseStepTimerPatch(step);
  } else if (act === 'reset') {
    patch = { timerState: 'off', timerElapsedMs: 0, timerSegmentStartedAt: null };
  } else {
    throw new ValidationError('פעולת סטופר לא תקינה');
  }
  return db.runStepStates.update(step.id, patch);
}

export async function completeRunStep(runId, stepIndex, {
  notes, issues, improvements, portionUnit, portionSize, portionCount,
  startedDate, startedTime, completedDate, completedTime,
} = {}) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  if (run.status === 'completed') throw new ValidationError('התהליך כבר הושלם');
  const step = run.steps[stepIndex];
  if (!step) throw new ValidationError('שלב לא תקין');
  if (step.status !== 'active' && stepIndex !== run.currentStepIndex) {
    throw new ValidationError('הפעל את השלב לפני השלמה');
  }

  let startedAt = step.startedAt || null;
  if (startedDate || startedTime) {
    startedAt = mergeDateTimeIntoIso(
      startedDate !== undefined && startedDate !== '' ? startedDate : isoDatePart(startedAt || nowISO()),
      startedTime !== undefined && startedTime !== '' ? startedTime : undefined,
      startedAt,
    );
  } else if (!startedAt) {
    startedAt = defaultStepStartedAt(run, stepIndex, step);
  }

  let completedAt = nowISO();
  if (completedDate || completedTime) {
    completedAt = mergeDateTimeIntoIso(
      completedDate !== undefined && completedDate !== '' ? completedDate : isoDatePart(completedAt),
      completedTime !== undefined && completedTime !== '' ? completedTime : undefined,
      completedAt,
    );
  }
  validateStepTimes(run, stepIndex, { startedAtIso: startedAt, completedAtIso: completedAt }, step);

  return db.transaction('rw', db.productionRuns, db.runStepStates, async () => {
    const stepPatch = {
      status: 'completed',
      startedAt,
      completedAt,
      notes: String(notes ?? step.notes ?? '').trim().slice(0, 500),
      issues: String(issues ?? step.issues ?? '').trim().slice(0, 500),
      improvements: String(improvements ?? step.improvements ?? '').trim().slice(0, 500),
    };
    if (step.timerState === 'running' || step.timerState === 'paused') {
      Object.assign(stepPatch, pauseStepTimerPatch(step));
      stepPatch.timerState = 'paused';
    }
    if (step.tracksPortions) {
      const unit = step.portionUnit === 'weight' ? 'weight' : 'units';
      const pSize = sanitizePortionSizeForUnit(step.portionSize, unit);
      const rawCount = portionCount ?? step.portionCount;
      const pCount = rawCount === '' || rawCount == null
        ? null
        : sanitizePortionCount(rawCount);
      if (pCount == null && rawCount !== '' && rawCount != null) {
        throw new ValidationError('מספר מנות לא תקין (מ-0.1 ומעלה)');
      }
      if (pSize != null) {
        stepPatch.portionUnit = unit;
        stepPatch.portionSize = pSize;
      }
      const batches = Array.isArray(step.portionBatches) ? [...step.portionBatches] : [];
      // לא מוסיפים מנה נוספת אם כבר יש רשומות batches (מונע כפילות)
      if (!batches.length) {
        if (pCount != null) {
          batches.push({
            count: pCount,
            name: 'מנה',
            date: String(stepPatch.completedAt).slice(0, 10),
            recordedAt: stepPatch.completedAt,
            note: '',
          });
        } else if (step.portionCount != null) {
          batches.push({
            count: step.portionCount,
            name: 'מנה',
            date: String(stepPatch.completedAt).slice(0, 10),
            recordedAt: stepPatch.completedAt,
            note: '',
          });
        }
      }
      if (batches.length) {
        stepPatch.portionBatches = batches;
        stepPatch.portionCount = sumPortionBatches(batches);
      }
    }
    await db.runStepStates.update(step.id, stepPatch);

    const updatedStatuses = run.steps.map((s, i) => (i === stepIndex ? 'completed' : s.status));
    const allCompleted = updatedStatuses.every((status) => status === 'completed');
    const wasSequential = stepIndex === run.currentStepIndex;

    if (allCompleted) {
      await db.productionRuns.update(runId, {
        status: 'completed',
        currentStepIndex: run.steps.length,
        completedAt: nowISO(),
      });
    } else if (wasSequential) {
      const nextIndex = stepIndex + 1;
      await db.productionRuns.update(runId, { currentStepIndex: nextIndex });
      const nextStep = run.steps[nextIndex];
      if (nextStep && nextStep.status === 'pending') {
        await db.runStepStates.update(nextStep.id, {
          status: 'active',
          startedAt: nextStep.startedAt || nowISO(),
        });
      }
    }
  });
}

export async function reopenRunStep(runId, targetStepIndex) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  if (run.status === 'completed') throw new ValidationError('התהליך הושלם — לא ניתן לחזור');
  const idx = Number(targetStepIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= run.steps.length) {
    throw new ValidationError('שלב לא תקין');
  }
  if (idx >= run.currentStepIndex) {
    throw new ValidationError('כבר בשלב זה או אחריו');
  }

  return db.transaction('rw', db.productionRuns, db.runStepStates, async () => {
    for (let i = idx; i < run.steps.length; i++) {
      const s = run.steps[i];
      await db.runStepStates.update(s.id, {
        status: i === idx ? 'active' : 'pending',
        completedAt: null,
        startedAt: i === idx ? (s.startedAt || nowISO()) : s.startedAt,
      });
    }
    await db.productionRuns.update(runId, {
      currentStepIndex: idx,
      status: 'active',
      completedAt: null,
    });
  });
}

export async function updateRunStepFields(runId, stepIndex, {
  notes, issues, improvements, portionUnit, portionSize, portionCount,
  startedDate, startedTime, completedDate, completedTime,
  clearCompletedAt, clearStartedAt,
} = {}) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  const step = run.steps[stepIndex];
  if (!step) throw new ValidationError('שלב לא תקין');
  const reached = step.status === 'completed'
    || step.status === 'active'
    || stepIndex <= run.currentStepIndex
    || run.status === 'completed';
  if (!reached) throw new ValidationError('השלב עדיין לא הגיע');
  const patch = {};
  if (notes !== undefined) patch.notes = String(notes || '').trim().slice(0, 500);
  if (issues !== undefined) patch.issues = String(issues || '').trim().slice(0, 500);
  if (improvements !== undefined) patch.improvements = String(improvements || '').trim().slice(0, 500);
  if (step.tracksPortions && portionCount !== undefined) {
    const pCount = portionCount === '' || portionCount == null
      ? null
      : sanitizePortionCount(portionCount);
    if (pCount == null && portionCount !== '' && portionCount != null) {
      throw new ValidationError('מספר מנות לא תקין (מ-0.1 ומעלה)');
    }
    if (Array.isArray(step.portionBatches) && step.portionBatches.length) {
      /* כמות מנות מנוהלת ברשימת המנות */
    } else {
      patch.portionCount = pCount;
    }
  }
  if (clearStartedAt) {
    patch.startedAt = null;
  } else if (startedDate !== undefined || startedTime !== undefined) {
    patch.startedAt = mergeDateTimeIntoIso(
      startedDate !== undefined ? startedDate : isoDatePart(step.startedAt),
      startedTime !== undefined ? startedTime : undefined,
      step.startedAt,
    );
  }
  if (clearCompletedAt) {
    patch.completedAt = null;
  } else if (completedDate !== undefined || completedTime !== undefined) {
    patch.completedAt = mergeDateTimeIntoIso(
      completedDate !== undefined ? completedDate : isoDatePart(step.completedAt),
      completedTime !== undefined ? completedTime : undefined,
      step.completedAt,
    );
    if (step.status !== 'completed' && step.status !== 'active') {
      patch.status = 'completed';
    }
  }
  const nextStarted = patch.startedAt !== undefined ? patch.startedAt : step.startedAt;
  const nextCompleted = patch.completedAt !== undefined ? patch.completedAt : step.completedAt;
  validateStepTimes(run, stepIndex, { startedAtIso: nextStarted, completedAtIso: nextCompleted }, step);
  if (!Object.keys(patch).length) return;
  return db.runStepStates.update(step.id, patch);
}

/** מסנכרן תהליך פעיל/הושלם עם הגדרות התזרim העדכניות (שלבים, דגלים, שמות) */
export async function syncProductionRunWithFlow(runId) {
  const run = await getProductionRun(runId, { normalize: false });
  if (!run) throw new ValidationError('תהליך לא נמצא');
  if (!run.flowId) return { updated: false, reason: 'no-flow' };

  await ensureFlowProductionStep(run.flowId);
  const flow = await db.flows.get(run.flowId);
  const templateSteps = await resolveFlowSteps(resolveFlowStepsParamsFromRun(run));
  if (!templateSteps.length) return { updated: false, reason: 'no-steps' };

  let changed = false;
  await db.transaction('rw', db.productionRuns, db.runStepStates, async () => {
    const existing = [...run.steps].sort((a, b) => a.stepIndex - b.stepIndex);

    if (flow?.name && flow.name !== run.flowName) {
      await db.productionRuns.update(run.id, { flowName: flow.name });
      changed = true;
    }

    for (let i = 0; i < templateSteps.length; i++) {
      const tpl = templateSteps[i];
      const meta = flowStepMetaFromTemplate(tpl);
      const ex = existing[i];

      if (ex) {
        const patch = {};
        for (const [k, v] of Object.entries(meta)) {
          if (ex[k] !== v) patch[k] = v;
        }
        if (Object.keys(patch).length) {
          await db.runStepStates.update(ex.id, patch);
          changed = true;
        }
      } else {
        let stepStatus = 'pending';
        if (run.status === 'completed') stepStatus = 'completed';
        else if (i < run.currentStepIndex) stepStatus = 'completed';
        else if (i === run.currentStepIndex) stepStatus = 'active';

        await db.runStepStates.add({
          runId: run.id,
          stepIndex: i,
          stepName: meta.stepName,
          status: stepStatus,
          startedAt: stepStatus === 'active' ? nowISO() : null,
          completedAt: stepStatus === 'completed'
            ? (run.completedAt || (i === run.currentStepIndex ? null : nowISO()))
            : null,
          notes: '',
          issues: '',
          improvements: '',
          tracksPortions: meta.tracksPortions,
          tracksProduction: meta.tracksProduction,
          portionUnit: meta.portionUnit,
          portionSize: meta.portionSize,
          portionCount: null,
          portionBatches: [],
          productionEntryIds: [],
        });
        changed = true;
      }
    }
  });

  const refreshed = await getProductionRun(runId, { normalize: false });
  if (await normalizeRunProductionSteps(refreshed)) changed = true;

  if (run.flowId) {
    const before = (await getRunPreparationChecks(runId)).length;
    const after = (await ensureRunPreparationChecks(runId)).length;
    if (after > before) changed = true;
  }

  return { updated: changed };
}

export async function syncAllActiveProductionRuns() {
  const runs = await getActiveProductionRuns();
  let updated = 0;
  for (const run of runs) {
    try {
      const res = await syncProductionRunWithFlow(run.id);
      if (res.updated) updated += 1;
    } catch {
      /* skip broken runs */
    }
  }
  return { total: runs.length, updated };
}

export async function updateProductionRunDates(runId, { startedDate, completedDate } = {}) {
  const run = await db.productionRuns.get(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');

  const patch = {};
  if (startedDate !== undefined) {
    patch.startedAt = mergeDateIntoIso(startedDate, run.startedAt);
    patch.date = startedDate;
  }
  if (completedDate !== undefined) {
    if (run.status !== 'completed') {
      throw new ValidationError('ניתן לערוך תאריך סיום רק לתהליך שהושלם');
    }
    if (completedDate === '' || completedDate == null) {
      patch.completedAt = null;
    } else {
      patch.completedAt = mergeDateIntoIso(completedDate, run.completedAt);
    }
  }

  const startIso = patch.startedAt || run.startedAt;
  const endIso = patch.completedAt !== undefined ? patch.completedAt : run.completedAt;
  if (startIso && endIso && endIso < startIso) {
    throw new ValidationError('תאריך סיום לא יכול להיות לפני תאריך התחלה');
  }

  if (!Object.keys(patch).length) return;
  await db.productionRuns.update(runId, patch);
}

export async function updateProductionRunDetails(runId, { batchNumber, startedDate, completedDate } = {}) {
  const run = await db.productionRuns.get(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');

  const patch = {};
  if (batchNumber !== undefined) {
    patch.batchNumber = String(batchNumber || '').trim().slice(0, 40);
  }
  if (startedDate !== undefined) {
    patch.startedAt = mergeDateIntoIso(startedDate, run.startedAt);
    patch.date = startedDate;
  }
  if (completedDate !== undefined) {
    if (run.status !== 'completed') {
      throw new ValidationError('ניתן לערוך תאריך סיום רק לתהליך שהושלם');
    }
    if (completedDate === '' || completedDate == null) {
      patch.completedAt = null;
    } else {
      patch.completedAt = mergeDateIntoIso(completedDate, run.completedAt);
    }
  }

  const startIso = patch.startedAt || run.startedAt;
  const endIso = patch.completedAt !== undefined ? patch.completedAt : run.completedAt;
  if (startIso && endIso && endIso < startIso) {
    throw new ValidationError('תאריך סיום לא יכול להיות לפני תאריך התחלה');
  }

  if (!Object.keys(patch).length) return;
  await db.productionRuns.update(runId, patch);
}

export async function deleteProductionRun(runId) {
  const rid = sanitizeProductId(runId);
  if (!rid) return;

  const entryIds = await collectProductionEntryIdsForRun(rid);

  await db.transaction('rw', db.productionRuns, db.runStepStates, db.productionEntries, db.runPreparationChecks, db.runCleaningChecks, async () => {
    for (const id of entryIds) {
      await db.productionEntries.delete(id);
    }
    await db.runPreparationChecks.where('runId').equals(rid).delete();
    await db.runCleaningChecks.where('runId').equals(rid).delete();
    await db.runStepStates.where('runId').equals(rid).delete();
    await db.productionRuns.delete(rid);
  });
}

// ── ניהול מנהל ──

const DEFAULT_MANAGER_DEPARTMENTS = [
  { deptKey: 'production', label: 'ייצור', icon: '🏭', isBuiltin: true, sortOrder: 1 },
  { deptKey: 'sales', label: 'מכירות', icon: '🛒', isBuiltin: true, sortOrder: 2 },
  { deptKey: 'maintenance', label: 'ניקיון ואחזקה', icon: '🧹', isBuiltin: true, sortOrder: 3 },
  { deptKey: 'general', label: 'כללי', icon: '📋', isBuiltin: true, sortOrder: 4 },
];

/** @deprecated — use getManagerDepartments() */
export const MANAGER_DEPARTMENTS = DEFAULT_MANAGER_DEPARTMENTS.map((d) => ({
  id: d.deptKey,
  label: d.label,
  icon: d.icon,
}));

let managerDeptKeysCache = null;

async function refreshManagerDeptKeysCache() {
  const rows = await db.managerDepartments?.toArray?.() || [];
  managerDeptKeysCache = new Set(rows.map((d) => d.deptKey));
  if (!managerDeptKeysCache.size) {
    managerDeptKeysCache = new Set(DEFAULT_MANAGER_DEPARTMENTS.map((d) => d.deptKey));
  }
}

async function validateManagerDepartment(dept) {
  if (!managerDeptKeysCache) await refreshManagerDeptKeysCache();
  return managerDeptKeysCache.has(dept) ? dept : 'general';
}

export async function getManagerDepartments() {
  if (!db.managerDepartments) {
    return DEFAULT_MANAGER_DEPARTMENTS.map((d, i) => ({ id: i + 1, ...d, active: true }));
  }
  const rows = await db.managerDepartments.toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  await refreshManagerDeptKeysCache();
  return rows.filter((d) => d.active !== false);
}

export async function addManagerDepartment({ label, icon } = {}) {
  const cleanLabel = sanitizeName(label, 40);
  if (!cleanLabel) throw new ValidationError('שם מחלקה לא תקין');
  const cleanIcon = String(icon || '📋').trim().slice(0, 8) || '📋';
  const existing = await db.managerDepartments.toArray();
  const maxOrder = existing.reduce((m, d) => Math.max(m, d.sortOrder ?? 0), 0);
  const deptKey = `dept_${Date.now()}`;
  const id = await db.managerDepartments.add({
    deptKey,
    label: cleanLabel,
    icon: cleanIcon,
    isBuiltin: false,
    sortOrder: maxOrder + 1,
    active: true,
  });
  await refreshManagerDeptKeysCache();
  return id;
}

export async function updateManagerDepartment(id, { label, icon } = {}) {
  const row = await db.managerDepartments.get(Number(id));
  if (!row) throw new ValidationError('מחלקה לא נמצאה');
  const patch = {};
  if (label != null) {
    const clean = sanitizeName(label, 40);
    if (!clean) throw new ValidationError('שם מחלקה לא תקין');
    patch.label = clean;
  }
  if (icon != null) patch.icon = String(icon || '📋').trim().slice(0, 8) || '📋';
  if (!Object.keys(patch).length) return;
  await db.managerDepartments.update(row.id, patch);
  await refreshManagerDeptKeysCache();
}

export async function deleteManagerDepartment(id) {
  const row = await db.managerDepartments.get(Number(id));
  if (!row) throw new ValidationError('מחלקה לא נמצאה');
  if (row.isBuiltin) throw new ValidationError('לא ניתן למחוק מחלקת ברירת מחדל');

  await db.transaction('rw', db.managerDepartments, db.managerTasks, db.managerIncidents, db.managerShiftNotes, async () => {
    const tasks = await db.managerTasks.where('department').equals(row.deptKey).toArray();
    for (const t of tasks) await db.managerTasks.update(t.id, { department: 'general' });
    const incidents = await db.managerIncidents.where('department').equals(row.deptKey).toArray();
    for (const i of incidents) await db.managerIncidents.update(i.id, { department: 'general' });
    const notes = await db.managerShiftNotes.where('department').equals(row.deptKey).toArray();
    for (const n of notes) await db.managerShiftNotes.update(n.id, { department: 'general' });
    await db.managerDepartments.delete(row.id);
  });
  await refreshManagerDeptKeysCache();
}

/* ── ניקוי מחלקות — רשימות ומשימות מוכנות ── */

export async function getDepartmentCleaningLists() {
  const [lists, tasks] = await Promise.all([
    db.departmentCleaningLists?.toArray?.() ?? Promise.resolve([]),
    db.departmentCleaningTasks?.toArray?.() ?? Promise.resolve([]),
  ]);
  const counts = new Map();
  for (const t of tasks) counts.set(t.listId, (counts.get(t.listId) || 0) + 1);
  return lists
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
    .map((l) => ({ ...l, taskCount: counts.get(l.id) || 0 }));
}

export async function getDepartmentCleaningTasks(listId) {
  const lid = sanitizeProductId(listId);
  if (!lid) return [];
  const rows = await db.departmentCleaningTasks.where('listId').equals(lid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function addDepartmentCleaningList({ name, notes } = {}) {
  const cleanName = sanitizeName(name, 60);
  if (!cleanName) throw new ValidationError('שם מחלקה לא תקין');
  const existing = await db.departmentCleaningLists.toArray();
  const maxOrder = existing.reduce((m, l) => Math.max(m, l.sortOrder ?? 0), 0);
  return db.departmentCleaningLists.add({
    name: cleanName,
    notes: String(notes || '').trim().slice(0, 500),
    sortOrder: maxOrder + 1,
  });
}

export async function updateDepartmentCleaningList(id, { name, notes } = {}) {
  const row = await db.departmentCleaningLists.get(Number(id));
  if (!row) throw new ValidationError('מחלקה לא נמצאה');
  const patch = {};
  if (name != null) {
    const clean = sanitizeName(name, 60);
    if (!clean) throw new ValidationError('שם מחלקה לא תקין');
    patch.name = clean;
  }
  if (notes !== undefined) patch.notes = String(notes || '').trim().slice(0, 500);
  if (Object.keys(patch).length) await db.departmentCleaningLists.update(row.id, patch);
}

export async function deleteDepartmentCleaningList(id) {
  const lid = sanitizeProductId(id);
  if (!lid) return;
  await db.transaction('rw', db.departmentCleaningLists, db.departmentCleaningTasks, async () => {
    await db.departmentCleaningTasks.where('listId').equals(lid).delete();
    await db.departmentCleaningLists.delete(lid);
  });
}

export async function addDepartmentCleaningTask(listId, name) {
  const lid = sanitizeProductId(listId);
  const cleanName = sanitizeName(name, 120);
  if (!lid) throw new ValidationError('מחלקה לא תקינה');
  if (!cleanName) throw new ValidationError('שם משימה לא תקין');
  const list = await db.departmentCleaningLists.get(lid);
  if (!list) throw new ValidationError('מחלקה לא נמצאה');
  const existing = await getDepartmentCleaningTasks(lid);
  const maxOrder = existing.reduce((m, t) => Math.max(m, t.sortOrder ?? 0), 0);
  return db.departmentCleaningTasks.add({
    listId: lid,
    name: cleanName,
    sortOrder: maxOrder + 1,
  });
}

export async function updateDepartmentCleaningTask(id, { name } = {}) {
  const row = await db.departmentCleaningTasks.get(Number(id));
  if (!row) throw new ValidationError('משימה לא נמצאה');
  if (name != null) {
    const clean = sanitizeName(name, 120);
    if (!clean) throw new ValidationError('שם משימה לא תקין');
    await db.departmentCleaningTasks.update(row.id, { name: clean });
  }
}

export async function deleteDepartmentCleaningTask(id) {
  const tid = sanitizeProductId(id);
  if (tid) await db.departmentCleaningTasks.delete(tid);
}

function managerNowISO() {
  return new Date().toISOString();
}

export async function getManagerPlan(planType, anchorDate) {
  return db.managerPlans.where('[planType+anchorDate]').equals([planType, anchorDate]).first();
}

export async function upsertManagerPlan({ planType, anchorDate, notes }) {
  const existing = await getManagerPlan(planType, anchorDate);
  const now = managerNowISO();
  if (existing) {
    await db.managerPlans.update(existing.id, {
      notes: notes ?? existing.notes,
      updatedAt: now,
    });
    return existing.id;
  }
  return db.managerPlans.add({
    planType,
    anchorDate,
    notes: notes || '',
    createdAt: now,
    updatedAt: now,
  });
}

export async function getManagerPlanItems(planType, anchorDate) {
  const items = await db.managerPlanItems
    .where('[planType+anchorDate]')
    .equals([planType, anchorDate])
    .toArray();
  return items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function getAllFlowPortionPresetsWithContext() {
  const [presets, groups] = await Promise.all([
    db.groupPortionPresets.toArray(),
    db.categoryGroups.toArray(),
  ]);
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));
  return presets
    .sort((a, b) => {
      const ga = groupMap.get(a.categoryGroupId) || '';
      const gb = groupMap.get(b.categoryGroupId) || '';
      return ga.localeCompare(gb, 'he') || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
    })
    .map((p) => ({
      ...p,
      groupName: groupMap.get(p.categoryGroupId) || '',
      flowName: groupMap.get(p.categoryGroupId) || '',
    }));
}

export async function addManagerPlanItem({
  planType, anchorDate, dayOffset = 0, itemKind = 'text',
  productId = null, categoryId = null, label = '', quantity = null,
  portionPresetId = null, portionName = null, portionWeight = null, portionExtra = null,
}) {
  const items = await getManagerPlanItems(planType, anchorDate);
  const sortOrder = items.length ? Math.max(...items.map((i) => i.sortOrder ?? 0)) + 1 : 1;

  if (itemKind === 'portion') {
    const pid = Number(portionPresetId);
    if (!pid) throw new ValidationError('בחר מנה מהרשימה');
    const preset = await db.groupPortionPresets.get(pid);
    if (!preset) throw new ValidationError('מנה לא נמצאה');
    const qty = sanitizeQuantity(quantity, { allowZero: false });
    if (qty == null) throw new ValidationError('הזן כמות מנות');

    const prodId = productId ? Number(productId) : null;
    const catId = categoryId ? Number(categoryId) : null;
    if (prodId && catId) throw new ValidationError('בחר מוצר או קטגוריה — לא שניהם');
    if (!prodId && !catId) throw new ValidationError('שייך למוצר או לקטגוריה');

    let targetLabel = '';
    if (prodId) {
      const prod = await db.products.get(prodId);
      if (!prod) throw new ValidationError('מוצר לא נמצא');
      targetLabel = prod.name;
    } else {
      const cat = await db.categories.get(catId);
      if (!cat) throw new ValidationError('קטגוריה לא נמצאה');
      targetLabel = cat.name;
    }

    const extraPart = preset.extra ? ` · ${preset.extra}` : '';
    const builtLabel = `${preset.name} (${preset.weight} ק"ג${extraPart}) → ${targetLabel}`;

    return db.managerPlanItems.add({
      planType,
      anchorDate,
      dayOffset: Number(dayOffset) || 0,
      itemKind: 'portion',
      productId: prodId,
      categoryId: catId,
      portionPresetId: preset.id,
      portionName: preset.name,
      portionWeight: preset.weight,
      portionExtra: preset.extra || '',
      label: builtLabel,
      quantity: qty,
      done: false,
      sortOrder,
    });
  }

  const text = sanitizeName(label || '', 120);
  if (itemKind === 'product' && productId) {
    const prod = await db.products.get(Number(productId));
    if (!prod) throw new ValidationError('מוצר לא נמצא');
    let portionMeta = {};
    if (portionPresetId) {
      const preset = await db.groupPortionPresets.get(Number(portionPresetId));
      if (!preset) throw new ValidationError('מנה לא נמצאה');
      portionMeta = {
        portionPresetId: preset.id,
        portionName: preset.name,
        portionWeight: preset.weight,
        portionExtra: preset.extra || '',
      };
    } else if (portionName) {
      portionMeta = {
        portionPresetId: portionPresetId ? Number(portionPresetId) : null,
        portionName: String(portionName || '').slice(0, 80),
        portionWeight: portionWeight != null ? Number(portionWeight) : null,
        portionExtra: String(portionExtra || '').slice(0, 120),
      };
    }
    return db.managerPlanItems.add({
      planType,
      anchorDate,
      dayOffset: Number(dayOffset) || 0,
      itemKind: 'product',
      productId: prod.id,
      categoryId: null,
      label: prod.name,
      quantity: quantity != null ? sanitizeQuantity(quantity, { allowZero: false }) : null,
      done: false,
      sortOrder,
      ...portionMeta,
    });
  }
  if (!text) throw new ValidationError('הזן תיאור');
  return db.managerPlanItems.add({
    planType,
    anchorDate,
    dayOffset: Number(dayOffset) || 0,
    itemKind: 'text',
    productId: null,
    categoryId: null,
    label: text,
    quantity: quantity != null ? sanitizeQuantity(quantity, { allowZero: true }) : null,
    done: false,
    sortOrder,
  });
}

/** תזרימים לתוכנית — ממוצרים + משורות flow_ref / צ׳קליסטים */
export async function collectPlanProductFlowsForExport(items) {
  const productItems = items
    .filter((i) => i.itemKind === 'product' && i.productId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);

  const flowOrder = [];
  const flowData = new Map();

  const ensureFlow = async (flow) => {
    if (!flow || flowData.has(flow.id)) return;
    const steps = await getFlowStepsForFlow(flow.id);
    flowData.set(flow.id, { flow, steps, products: [] });
    flowOrder.push(flow.id);
  };

  for (const item of productItems) {
    const flows = await resolveFlowsForProduct(item.productId);
    for (const flow of flows) {
      await ensureFlow(flow);
      flowData.get(flow.id).products.push({
        label: item.label,
        quantity: item.quantity,
      });
    }
  }

  const refFlowIds = [
    ...new Set(
      items
        .filter((i) => (i.itemKind === 'flow_ref' || i.itemKind === 'flow_preparation'
          || i.itemKind === 'flow_cleaning' || i.itemKind === 'flow_step') && i.flowId)
        .map((i) => Number(i.flowId)),
    ),
  ];
  for (const fid of refFlowIds) {
    if (flowData.has(fid)) continue;
    const flow = await db.flows.get(fid);
    await ensureFlow(flow);
  }

  return flowOrder.map((id) => flowData.get(id)).filter(Boolean);
}

export async function getProductFlowLinkRows(productId) {
  const pid = Number(productId);
  if (!pid || !db.productFlowLinks) return [];
  const rows = await db.productFlowLinks.where('productId').equals(pid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function getFlowProductLinkRows(flowId) {
  const fid = Number(flowId);
  if (!fid || !db.productFlowLinks) return [];
  const rows = await db.productFlowLinks.where('flowId').equals(fid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function getLinkedFlowsForProduct(productId) {
  const links = await getProductFlowLinkRows(productId);
  if (!links.length) return [];
  const flows = await Promise.all(links.map((l) => db.flows.get(l.flowId)));
  return links
    .map((link, i) => ({ link, flow: flows[i] }))
    .filter((row) => row.flow);
}

export async function getLinkedProductsForFlow(flowId) {
  const links = await getFlowProductLinkRows(flowId);
  if (!links.length) return [];
  const products = await Promise.all(links.map((l) => db.products.get(l.productId)));
  return links
    .map((link, i) => ({ link, product: products[i] }))
    .filter((row) => row.product);
}

export async function setProductFlowLinks(productId, flowIds) {
  const pid = sanitizeProductId(productId);
  if (!pid) throw new ValidationError('מוצר לא תקין');
  if (!db.productFlowLinks) return;
  const ids = [...new Set((flowIds || []).map((id) => sanitizeProductId(id)).filter(Boolean))];
  for (const fid of ids) {
    const flow = await db.flows.get(fid);
    if (!flow) throw new ValidationError('תזרים לא נמצא');
  }
  await db.transaction('rw', db.productFlowLinks, async () => {
    await db.productFlowLinks.where('productId').equals(pid).delete();
    for (let i = 0; i < ids.length; i++) {
      await db.productFlowLinks.add({ productId: pid, flowId: ids[i], sortOrder: i + 1 });
    }
  });
}

export async function setFlowProductLinks(flowId, productIds) {
  const fid = sanitizeProductId(flowId);
  if (!fid) throw new ValidationError('תזרים לא תקין');
  if (!db.productFlowLinks) return;
  const flow = await db.flows.get(fid);
  if (!flow) throw new ValidationError('תזרים לא נמצא');
  const newPids = new Set((productIds || []).map((id) => sanitizeProductId(id)).filter(Boolean));
  for (const pid of newPids) {
    const prod = await db.products.get(pid);
    if (!prod) throw new ValidationError('מוצר לא נמצא');
  }
  const existing = await db.productFlowLinks.where('flowId').equals(fid).toArray();
  const existingPids = new Set(existing.map((l) => l.productId));
  await db.transaction('rw', db.productFlowLinks, async () => {
    for (const link of existing) {
      if (!newPids.has(link.productId)) await db.productFlowLinks.delete(link.id);
    }
    for (const pid of newPids) {
      if (existingPids.has(pid)) continue;
      const productLinks = await db.productFlowLinks.where('productId').equals(pid).toArray();
      const maxOrder = productLinks.reduce((m, l) => Math.max(m, l.sortOrder ?? 0), 0);
      await db.productFlowLinks.add({ productId: pid, flowId: fid, sortOrder: maxOrder + 1 });
    }
  });
}

/** תזרימים משויכים למוצר, או לפי קטגוריה/קבוצה אם אין שיוך ישיר */
export async function resolveFlowsForProduct(productId) {
  const linked = await getLinkedFlowsForProduct(productId);
  if (linked.length) return linked.map((row) => row.flow);
  const prod = await db.products.get(Number(productId));
  if (!prod) return [];
  const cat = await db.categories.get(prod.categoryId);
  return resolveFlows({
    categoryId: prod.categoryId,
    categoryGroupId: cat?.groupId || null,
  });
}

export async function getCandidateFlowsForProduct(productId) {
  const overview = await getAllFlowsOverview();
  const prod = await db.products.get(Number(productId));
  if (!prod) return overview;
  const cat = await db.categories.get(prod.categoryId);
  const groupId = cat?.groupId || null;
  const relevant = overview.filter((f) => {
    if (f.categoryId && f.categoryId === prod.categoryId) return true;
    if (groupId && Number(f.groupId || f.categoryGroupId) === Number(groupId)) return true;
    return false;
  });
  return relevant.length ? relevant : overview;
}

export async function getCandidateProductsForFlow(flowId) {
  const fid = Number(flowId);
  const flow = await db.flows.get(fid);
  if (!flow) return [];
  let products = [];
  if (flow.categoryId) {
    products = await db.products.where('categoryId').equals(flow.categoryId).toArray();
  } else if (flow.categoryGroupId) {
    const cats = await db.categories.where('groupId').equals(flow.categoryGroupId).toArray();
    const catIds = new Set(cats.map((c) => c.id));
    products = (await db.products.toArray()).filter((p) => catIds.has(p.categoryId));
  } else {
    products = await db.products.toArray();
  }
  const linked = await getLinkedProductsForFlow(fid);
  const seen = new Set(products.map((p) => p.id));
  for (const { product } of linked) {
    if (product && !seen.has(product.id)) {
      products.push(product);
      seen.add(product.id);
    }
  }
  return products
    .filter((p) => p.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name, 'he') || a.id - b.id);
}

/** תזרים ברירת מחדל למוצר — שיוך ישיר קודם, אחרת לפי קטגוריה / קבוצה */
export async function resolveDefaultFlowForProduct(productId) {
  const flows = await resolveFlowsForProduct(productId);
  if (!flows.length) return null;
  return flows.find((f) => f.isDefault) || flows[0];
}

/** תזרים ייעודי לקטגוריה של המוצר בלבד — ללא נפילה לתזרים הכללי של הקבוצה */
export async function resolveDedicatedFlowForProduct(productId) {
  const linked = await getLinkedFlowsForProduct(productId);
  if (linked.length) return linked[0].flow;
  const prod = await db.products.get(Number(productId));
  if (!prod?.categoryId) return null;
  const flows = await getFlowsForCategory(prod.categoryId);
  if (!flows.length) return null;
  return flows.find((f) => f.isDefault) || flows[0];
}

/** הוספת מוצר לתוכנית — משימות מהתזרים רק אם includeChecklists=true (לא משנה תזרים/ייצור) */
export async function addManagerPlanProductWithChecklists({
  planType, anchorDate, dayOffset = 0, productId, quantity = null, portionPresetId = null, portions = null,
  includeChecklists = false,
} = {}) {
  const pid = Number(productId);
  if (!pid) throw new ValidationError('בחר מוצר');
  const prod = await db.products.get(pid);
  if (!prod) throw new ValidationError('מוצר לא נמצא');
  const offset = Number(dayOffset) || 0;

  let portionRows = [];
  if (Array.isArray(portions) && portions.length) {
    portionRows = portions.map((p) => ({
      portionPresetId: p.portionPresetId != null ? Number(p.portionPresetId) : null,
      quantity: p.quantity,
    }));
  } else if (portionPresetId) {
    portionRows = [{ portionPresetId: Number(portionPresetId), quantity }];
  } else {
    portionRows = [{ portionPresetId: null, quantity }];
  }

  const existing = await getManagerPlanItems(planType, anchorDate);
  const sameDay = existing.filter((i) => (i.dayOffset ?? 0) === offset);
  let productsAdded = 0;

  for (const sel of portionRows) {
    const portionMeta = {};
    const ppid = Number(sel.portionPresetId);
    if (ppid) {
      const preset = await db.groupPortionPresets.get(ppid);
      if (!preset) throw new ValidationError('מנה לא נמצאה');
      const qty = sanitizeQuantity(sel.quantity ?? quantity, { allowZero: false });
      if (qty == null) throw new ValidationError('הזן כמות מנות');
      portionMeta.portionPresetId = preset.id;
      portionMeta.portionName = preset.name;
      portionMeta.portionWeight = preset.weight;
      portionMeta.portionExtra = preset.extra || '';
      portionMeta.quantity = qty;
    } else if ((sel.quantity ?? quantity) != null && (sel.quantity ?? quantity) !== '') {
      portionMeta.quantity = sanitizeQuantity(sel.quantity ?? quantity, { allowZero: false });
    }

    const existingProduct = sameDay.find((i) => i.itemKind === 'product'
      && i.productId === pid
      && (i.portionPresetId ?? null) === (portionMeta.portionPresetId ?? null));

    if (existingProduct) {
      const patch = { ...portionMeta };
      if (Object.keys(patch).length) {
        await db.managerPlanItems.update(existingProduct.id, patch);
      }
    } else {
      await addManagerPlanItem({
        planType,
        anchorDate,
        dayOffset: offset,
        itemKind: 'product',
        productId: pid,
        quantity: portionMeta.quantity ?? null,
        portionPresetId: portionMeta.portionPresetId ?? null,
        portionName: portionMeta.portionName ?? null,
        portionWeight: portionMeta.portionWeight ?? null,
        portionExtra: portionMeta.portionExtra ?? null,
      });
      productsAdded += 1;
    }
  }

  if (!includeChecklists) {
    return { checklistsAdded: 0, hasFlow: false, productsAdded, skippedChecklists: true };
  }

  const flows = await resolveFlowsForProduct(pid);
  if (!flows.length) return { checklistsAdded: 0, hasFlow: false, productsAdded };

  const cat = await db.categories.get(prod.categoryId);
  const categoryGroupId = cat?.groupId || null;
  let checklistsAdded = 0;
  const flowNames = [];

  for (const flow of flows) {
    const [preps, cleaningTasks] = await Promise.all([
      getFlowPreparations(flow.id),
      getFlowCleaningTasks(flow.id),
    ]);

    const freshSameDay = (await getManagerPlanItems(planType, anchorDate))
      .filter((i) => (i.dayOffset ?? 0) === offset);
    const existingPrepKeys = new Set(
      freshSameDay
        .filter((i) => i.itemKind === 'flow_preparation' && i.flowId === flow.id)
        .map((i) => i.flowPreparationId),
    );
    const existingCleanKeys = new Set(
      freshSameDay
        .filter((i) => i.itemKind === 'flow_cleaning' && i.flowId === flow.id)
        .map((i) => i.flowCleaningTaskId),
    );

    const fresh = await getManagerPlanItems(planType, anchorDate);
    let sortOrder = fresh.length ? Math.max(...fresh.map((i) => i.sortOrder ?? 0)) + 1 : 1;
    const rows = [];

    for (const prep of preps) {
      if (existingPrepKeys.has(prep.checklistTaskId)) continue;
      rows.push({
        planType,
        anchorDate,
        dayOffset: offset,
        itemKind: 'flow_preparation',
        flowId: flow.id,
        flowPreparationId: prep.checklistTaskId,
        productId: pid,
        categoryId: prod.categoryId,
        categoryGroupId: categoryGroupId || flow.categoryGroupId || null,
        label: prep.name,
        quantity: null,
        done: false,
        sortOrder: sortOrder++,
      });
    }

    for (const task of cleaningTasks) {
      if (existingCleanKeys.has(task.id)) continue;
      rows.push({
        planType,
        anchorDate,
        dayOffset: offset,
        itemKind: 'flow_cleaning',
        flowId: flow.id,
        flowCleaningTaskId: task.id,
        productId: pid,
        categoryId: prod.categoryId,
        categoryGroupId: categoryGroupId || flow.categoryGroupId || null,
        label: task.name,
        quantity: null,
        done: false,
        sortOrder: sortOrder++,
      });
    }

    if (rows.length) {
      await db.managerPlanItems.bulkAdd(rows);
      checklistsAdded += rows.length;
    }
    flowNames.push(flow.name);
  }

  return {
    checklistsAdded,
    hasFlow: true,
    flowName: flowNames.join(', '),
    productsAdded,
  };
}

/** הוספת שלבי תזרים נבחרים לתוכנית יומית/שבועית */
export async function addManagerPlanFlowSteps({
  planType, anchorDate, dayOffset = 0, flowId, stepIds = [],
}) {
  const fid = Number(flowId);
  if (!fid) throw new ValidationError('בחר תזרים');
  const flow = await db.flows.get(fid);
  if (!flow) throw new ValidationError('תזרים לא נמצא');

  const selected = [...new Set(stepIds.map(Number).filter(Boolean))];
  if (!selected.length) throw new ValidationError('בחר לפחות משימה אחת');

  const [steps, existing] = await Promise.all([
    getFlowStepsForFlow(fid),
    getManagerPlanItems(planType, anchorDate),
  ]);
  const existingStepIds = new Set(
    existing.filter((i) => i.itemKind === 'flow_step' && i.flowStepId).map((i) => i.flowStepId)
  );

  let sortOrder = existing.length ? Math.max(...existing.map((i) => i.sortOrder ?? 0)) + 1 : 1;
  let categoryId = flow.categoryId || null;
  let categoryGroupId = flow.categoryGroupId || null;
  if (categoryId && !categoryGroupId) {
    const cat = await db.categories.get(categoryId);
    categoryGroupId = cat?.groupId || null;
  }
  const rows = [];
  for (const sid of selected) {
    if (existingStepIds.has(sid)) continue;
    const step = steps.find((s) => s.id === sid);
    if (!step) continue;
    rows.push({
      planType,
      anchorDate,
      dayOffset: Number(dayOffset) || 0,
      itemKind: 'flow_step',
      flowId: fid,
      flowStepId: sid,
      productId: null,
      categoryId,
      categoryGroupId,
      label: `${flow.name} · ${step.name}`,
      quantity: null,
      done: false,
      sortOrder: sortOrder++,
    });
  }
  if (!rows.length) throw new ValidationError('כל המשימות שנבחרו כבר בתוכנית');
  await db.managerPlanItems.bulkAdd(rows);
  return rows.length;
}

/** סנכרון אוטומטי של משימות מתזרימים לתוכנית — idempotent */
export async function syncDailyPlanFromFlows({ planType = 'daily', anchorDate, dayOffset = 0 } = {}) {
  if (!isValidISODate(anchorDate)) return 0;
  const [flowsOverview, existingItems] = await Promise.all([
    getAllFlowsOverview(),
    getManagerPlanItems(planType, anchorDate),
  ]);

  const existingStepIds = new Set(
    existingItems.filter((i) => i.itemKind === 'flow_step' && i.flowStepId).map((i) => i.flowStepId),
  );
  const existingPrepIds = new Set(
    existingItems.filter((i) => i.itemKind === 'flow_preparation' && i.flowPreparationId).map((i) => i.flowPreparationId),
  );

  let sortOrder = existingItems.length
    ? Math.max(...existingItems.map((i) => i.sortOrder ?? 0)) + 1
    : 1;
  const rows = [];

  for (const flow of flowsOverview) {
    const categoryId = flow.categoryId || null;
    const categoryGroupId = flow.groupId || flow.categoryGroupId || null;
    const [steps, preps] = await Promise.all([
      getFlowStepsForFlow(flow.id),
      getFlowPreparations(flow.id),
    ]);

    for (const step of steps) {
      if (step.tracksProduction) continue;
      if (existingStepIds.has(step.id)) continue;
      rows.push({
        planType,
        anchorDate,
        dayOffset: Number(dayOffset) || 0,
        itemKind: 'flow_step',
        flowId: flow.id,
        flowStepId: step.id,
        productId: null,
        categoryId,
        categoryGroupId,
        label: `${flow.name} · ${step.name}`,
        quantity: null,
        done: false,
        sortOrder: sortOrder++,
      });
      existingStepIds.add(step.id);
    }

    for (const prep of preps) {
      if (existingPrepIds.has(prep.checklistTaskId)) continue;
      rows.push({
        planType,
        anchorDate,
        dayOffset: Number(dayOffset) || 0,
        itemKind: 'flow_preparation',
        flowId: flow.id,
        flowPreparationId: prep.checklistTaskId,
        productId: null,
        categoryId,
        categoryGroupId,
        label: `${flow.name} · ${prep.name}`,
        quantity: null,
        done: false,
        sortOrder: sortOrder++,
      });
      existingPrepIds.add(prep.checklistTaskId);
    }
  }

  if (rows.length) await db.managerPlanItems.bulkAdd(rows);
  return rows.length;
}

export async function updateManagerPlanItem(id, patch) {
  const row = await db.managerPlanItems.get(Number(id));
  if (!row) throw new ValidationError('פריט לא נמצא');
  const next = {};
  if (patch.label !== undefined) next.label = sanitizeName(patch.label, 120);
  if (patch.quantity !== undefined) {
    const allowZero = row.itemKind !== 'portion';
    next.quantity = patch.quantity === '' || patch.quantity == null
      ? null
      : sanitizeQuantity(patch.quantity, { allowZero });
    if (row.itemKind === 'portion' && next.quantity == null && patch.quantity !== '' && patch.quantity != null) {
      throw new ValidationError('כמות מנות לא תקינה');
    }
  }
  if (patch.done !== undefined) next.done = !!patch.done;
  if (patch.assigneeName !== undefined) {
    next.assigneeName = patch.assigneeName == null || patch.assigneeName === ''
      ? null
      : sanitizeName(String(patch.assigneeName), 40);
  }
  if (patch.dayOffset !== undefined) next.dayOffset = Number(patch.dayOffset) || 0;
  if (patch.anchorDate !== undefined && patch.anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(patch.anchorDate)) {
    next.anchorDate = patch.anchorDate;
  }
  if (!Object.keys(next).length) return;
  await db.managerPlanItems.update(row.id, next);
}

export async function deleteManagerPlanItem(id) {
  const row = await db.managerPlanItems.get(Number(id));
  if (!row) return;
  // מחיקה מהתוכנית בלבד — לא נוגעים בתזרים / ייצור / צ׳קליסטים אמיתיים
  if (row.itemKind === 'flow_ref' && row.flowId) {
    const siblings = await getManagerPlanItems(row.planType, row.anchorDate);
    const sameDay = siblings.filter((i) => (i.dayOffset ?? 0) === (row.dayOffset ?? 0));
    const linked = sameDay.filter((i) => i.id !== row.id
      && i.flowId === row.flowId
      && (i.itemKind === 'flow_preparation' || i.itemKind === 'flow_cleaning' || i.itemKind === 'flow_step'));
    await db.transaction('rw', db.managerPlanItems, async () => {
      for (const l of linked) await db.managerPlanItems.delete(l.id);
      await db.managerPlanItems.delete(row.id);
    });
    return;
  }
  await db.managerPlanItems.delete(Number(id));
}

/** מחיקת קבוצת פריטים מהתוכנית לפי סוג — רק תוכנית */
export async function deleteManagerPlanItemsByKind(planType, anchorDate, itemKinds, { dayOffset = null, flowId = null } = {}) {
  if (!isValidISODate(anchorDate)) throw new ValidationError('תאריך לא תקין');
  const kinds = new Set(Array.isArray(itemKinds) ? itemKinds : [itemKinds]);
  let rows = await getManagerPlanItems(planType, anchorDate);
  if (dayOffset != null) rows = rows.filter((i) => (i.dayOffset ?? 0) === Number(dayOffset));
  if (flowId) rows = rows.filter((i) => Number(i.flowId) === Number(flowId));
  const toDelete = rows.filter((i) => kinds.has(i.itemKind));
  if (!toDelete.length) return 0;
  await db.transaction('rw', db.managerPlanItems, async () => {
    for (const row of toDelete) await db.managerPlanItems.delete(row.id);
  });
  return toDelete.length;
}

/** מחיקת כל פריטי תוכנית ליום/שבוע מסוים — לבנייה מחדש */
export async function clearManagerPlanItems(planType, anchorDate) {
  if (!isValidISODate(anchorDate)) throw new ValidationError('תאריך לא תקין');
  const rows = await getManagerPlanItems(planType, anchorDate);
  if (!rows.length) return 0;
  await db.transaction('rw', db.managerPlanItems, async () => {
    for (const row of rows) await db.managerPlanItems.delete(row.id);
  });
  return rows.length;
}

/**
 * הוספת צ׳קליסטים (הכנות + נקיונות) מתזרים לתוכנית,
 * ובנוסף שורת «תזרים» (flow_ref) שמוצגת בסקשן נפרד למטה.
 */
export async function addManagerPlanFlowChecklists({
  planType = 'daily',
  anchorDate,
  dayOffset = 0,
  flowId,
  productionRunId = null,
  includeFlowRef = true,
} = {}) {
  if (!isValidISODate(anchorDate)) throw new ValidationError('תאריך לא תקין');
  const fid = Number(flowId);
  if (!fid) throw new ValidationError('בחר תזרים');
  const flow = await db.flows.get(fid);
  if (!flow) throw new ValidationError('תזרים לא נמצא');

  const offset = Number(dayOffset) || 0;
  const [preps, cleaningTasks, existing] = await Promise.all([
    getFlowPreparations(fid),
    getFlowCleaningTasks(fid),
    getManagerPlanItems(planType, anchorDate),
  ]);
  const sameDay = existing.filter((i) => (i.dayOffset ?? 0) === offset);
  const existingPrep = new Set(
    sameDay.filter((i) => i.itemKind === 'flow_preparation' && i.flowId === fid)
      .map((i) => i.flowPreparationId),
  );
  const existingClean = new Set(
    sameDay.filter((i) => i.itemKind === 'flow_cleaning' && i.flowId === fid)
      .map((i) => i.flowCleaningTaskId),
  );
  const hasFlowRef = sameDay.some((i) => i.itemKind === 'flow_ref' && i.flowId === fid);

  let categoryId = flow.categoryId || null;
  let categoryGroupId = flow.categoryGroupId || null;
  if (categoryId && !categoryGroupId) {
    const cat = await db.categories.get(categoryId);
    categoryGroupId = cat?.groupId || null;
  }

  let sortOrder = existing.length ? Math.max(...existing.map((i) => i.sortOrder ?? 0)) + 1 : 1;
  const rows = [];

  for (const prep of preps) {
    if (existingPrep.has(prep.checklistTaskId)) continue;
    rows.push({
      planType,
      anchorDate,
      dayOffset: offset,
      itemKind: 'flow_preparation',
      flowId: fid,
      flowPreparationId: prep.checklistTaskId,
      productId: null,
      categoryId,
      categoryGroupId,
      label: prep.name,
      quantity: null,
      done: false,
      sortOrder: sortOrder++,
    });
  }
  for (const task of cleaningTasks) {
    if (existingClean.has(task.id)) continue;
    rows.push({
      planType,
      anchorDate,
      dayOffset: offset,
      itemKind: 'flow_cleaning',
      flowId: fid,
      flowCleaningTaskId: task.id,
      productId: null,
      categoryId,
      categoryGroupId,
      label: task.name,
      quantity: null,
      done: false,
      sortOrder: sortOrder++,
    });
  }

  let flowRefAdded = false;
  if (includeFlowRef && !hasFlowRef) {
    rows.push({
      planType,
      anchorDate,
      dayOffset: offset,
      itemKind: 'flow_ref',
      flowId: fid,
      productionRunId: productionRunId ? Number(productionRunId) : null,
      productId: null,
      categoryId,
      categoryGroupId,
      label: flow.name,
      quantity: null,
      done: false,
      sortOrder: sortOrder++,
    });
    flowRefAdded = true;
  } else if (includeFlowRef && hasFlowRef && productionRunId) {
    const ref = sameDay.find((i) => i.itemKind === 'flow_ref' && i.flowId === fid);
    if (ref && !ref.productionRunId) {
      await db.managerPlanItems.update(ref.id, { productionRunId: Number(productionRunId) });
    }
  }

  if (rows.length) await db.managerPlanItems.bulkAdd(rows);

  return {
    checklistsAdded: rows.length - (flowRefAdded ? 1 : 0),
    flowRefAdded,
    flowName: flow.name,
    flowId: fid,
  };
}

/**
 * ייבוא תזרים פעיל לתוכנית — רק צ׳קליסטים (הכנות + נקיונות) + שורת תזרים.
 * לא מייבא מוצרים / מנות.
 */
export async function importActiveRunToDailyPlan(runId, { planType = 'daily', anchorDate } = {}) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  if (run.status !== 'active') throw new ValidationError('ניתן לייבא רק תזרים פעיל');
  if (!run.flowId) throw new ValidationError('לתהליך אין תזרים משויך');
  const date = anchorDate && isValidISODate(anchorDate) ? anchorDate : (run.date || todayISOFromDate());

  const res = await addManagerPlanFlowChecklists({
    planType,
    anchorDate: date,
    dayOffset: 0,
    flowId: run.flowId,
    productionRunId: run.id,
    includeFlowRef: true,
  });

  return {
    productsAdded: 0,
    checklistsAdded: res.checklistsAdded,
    portionsAdded: 0,
    flowRefAdded: res.flowRefAdded,
    flowName: res.flowName || run.flowName || '',
    date,
  };
}

export async function getManagerTasks({ department, kind, status } = {}) {
  let rows = await db.managerTasks.toArray();
  if (department) rows = rows.filter((r) => r.department === department);
  if (kind) rows = rows.filter((r) => r.kind === kind);
  if (status) rows = rows.filter((r) => r.status === status);
  if (kind === 'improvement') {
    return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      || (b.createdAt || '').localeCompare(a.createdAt || '')
      || a.id - b.id);
  }
  return rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id - a.id);
}

const IMPROVEMENT_URGENCY_COLORS = new Set(['red', 'yellow', 'green']);

function sanitizeImprovementUrgency(color) {
  const c = String(color || '').trim();
  return IMPROVEMENT_URGENCY_COLORS.has(c) ? c : 'yellow';
}

function priorityFromUrgency(color) {
  if (color === 'red') return 'high';
  if (color === 'green') return 'low';
  return 'medium';
}

export async function setImprovementOrder(department, orderedIds) {
  const dept = await validateManagerDepartment(department);
  if (!Array.isArray(orderedIds)) return;
  for (let i = 0; i < orderedIds.length; i++) {
    const id = Number(orderedIds[i]);
    if (!id) continue;
    const row = await db.managerTasks.get(id);
    if (!row || row.kind !== 'improvement' || row.department !== dept) continue;
    await db.managerTasks.update(id, { sortOrder: i + 1 });
  }
}

export async function addManagerTask({
  department, kind = 'task', title, body = '',
  priority = 'medium', dueDate = null, urgencyColor = null,
} = {}) {
  const t = sanitizeName(title, 120);
  if (!t) throw new ValidationError('הזן כותרת');
  const validKind = ['task', 'improvement', 'checklist'].includes(kind) ? kind : 'task';
  const dept = await validateManagerDepartment(department);
  let validPriority = ['low', 'medium', 'high'].includes(priority) ? priority : 'medium';
  let urgency = null;
  let sortOrder = null;
  if (validKind === 'improvement') {
    urgency = sanitizeImprovementUrgency(urgencyColor || (validPriority === 'high' ? 'red' : validPriority === 'low' ? 'green' : 'yellow'));
    validPriority = priorityFromUrgency(urgency);
    const siblings = await db.managerTasks.where('kind').equals('improvement').filter((r) => r.department === dept).toArray();
    sortOrder = siblings.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0) + 1;
  }
  return db.managerTasks.add({
    department: dept,
    kind: validKind,
    title: t,
    body: String(body || '').trim().slice(0, 1000),
    status: 'open',
    priority: validPriority,
    urgencyColor: urgency,
    sortOrder,
    dueDate: dueDate && isValidISODate(dueDate) ? dueDate : null,
    createdAt: managerNowISO(),
    completedAt: null,
  });
}

export async function updateManagerTask(id, patch) {
  const row = await db.managerTasks.get(Number(id));
  if (!row) throw new ValidationError('משימה לא נמצאה');
  const next = {};
  if (patch.title !== undefined) next.title = sanitizeName(patch.title, 120);
  if (patch.body !== undefined) next.body = String(patch.body || '').trim().slice(0, 1000);
  if (patch.department !== undefined) next.department = await validateManagerDepartment(patch.department);
  if (patch.status !== undefined) {
    const st = ['open', 'progress', 'done'].includes(patch.status) ? patch.status : row.status;
    next.status = st;
    next.completedAt = st === 'done' ? managerNowISO() : null;
  }
  if (patch.priority !== undefined && ['low', 'medium', 'high'].includes(patch.priority)) {
    next.priority = patch.priority;
  }
  if (patch.urgencyColor !== undefined) {
    next.urgencyColor = sanitizeImprovementUrgency(patch.urgencyColor);
    next.priority = priorityFromUrgency(next.urgencyColor);
  }
  if (patch.sortOrder !== undefined) next.sortOrder = Number(patch.sortOrder) || 0;
  if (patch.dueDate !== undefined) {
    next.dueDate = patch.dueDate && isValidISODate(patch.dueDate) ? patch.dueDate : null;
  }
  if (!Object.keys(next).length) return;
  await db.managerTasks.update(row.id, next);
}

export async function deleteManagerTask(id) {
  await db.managerTasks.delete(Number(id));
}

export async function getManagerIncidents({ department, status } = {}) {
  let rows = await db.managerIncidents.orderBy('occurredAt').reverse().toArray();
  if (department) rows = rows.filter((r) => r.department === department);
  if (status) rows = rows.filter((r) => r.status === status);
  return rows;
}

export async function addManagerIncident({
  department, title, description = '', severity = 'minor', occurredAt,
}) {
  const t = sanitizeName(title, 120);
  if (!t) throw new ValidationError('הזן כותרת');
  const sev = ['minor', 'major', 'critical'].includes(severity) ? severity : 'minor';
  const when = occurredAt && isValidISODate(occurredAt) ? occurredAt : todayISOFromDate();
  return db.managerIncidents.add({
    department: await validateManagerDepartment(department),
    title: t,
    description: String(description || '').trim().slice(0, 2000),
    severity: sev,
    status: 'open',
    occurredAt: when,
    createdAt: managerNowISO(),
    resolvedAt: null,
    resolution: '',
    actionTaken: '',
  });
}

function todayISOFromDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function updateManagerIncident(id, patch) {
  const row = await db.managerIncidents.get(Number(id));
  if (!row) throw new ValidationError('אירוע לא נמצא');
  const next = {};
  if (patch.title !== undefined) next.title = sanitizeName(patch.title, 120);
  if (patch.description !== undefined) next.description = String(patch.description || '').trim().slice(0, 2000);
  if (patch.severity !== undefined && ['minor', 'major', 'critical'].includes(patch.severity)) {
    next.severity = patch.severity;
  }
  if (patch.status !== undefined) {
    const st = ['open', 'investigating', 'resolved'].includes(patch.status) ? patch.status : row.status;
    next.status = st;
    if (st === 'resolved') next.resolvedAt = managerNowISO();
  }
  if (patch.resolution !== undefined) next.resolution = String(patch.resolution || '').trim().slice(0, 2000);
  if (patch.actionTaken !== undefined) next.actionTaken = String(patch.actionTaken || '').trim().slice(0, 2000);
  if (patch.occurredAt !== undefined && isValidISODate(patch.occurredAt)) next.occurredAt = patch.occurredAt;
  if (!Object.keys(next).length) return;
  await db.managerIncidents.update(row.id, next);
}

export async function deleteManagerIncident(id) {
  await db.managerIncidents.delete(Number(id));
}

export async function getManagerShiftNotes(date) {
  const rows = await db.managerShiftNotes.where('date').equals(date).toArray();
  return rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function addManagerShiftNote({ date, department, kind = 'shift', content }) {
  const text = String(content || '').trim().slice(0, 2000);
  if (!text) throw new ValidationError('הזן תוכן');
  const validKind = ['shift', 'briefing', 'checklist'].includes(kind) ? kind : 'shift';
  return db.managerShiftNotes.add({
    date: date && isValidISODate(date) ? date : todayISOFromDate(),
    department: await validateManagerDepartment(department),
    kind: validKind,
    content: text,
    createdAt: managerNowISO(),
  });
}

export async function deleteManagerShiftNote(id) {
  await db.managerShiftNotes.delete(Number(id));
}

export async function getManagerDashboardStats(today) {
  const [
    tasks, incidents, planItems, activeRuns, entries, products,
  ] = await Promise.all([
    db.managerTasks.toArray(),
    db.managerIncidents.toArray(),
    getManagerPlanItems('daily', today),
    db.productionRuns.where('status').equals('active').count(),
    getEntriesForDate(today),
    getProducts(true),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const totals = await getProductionTotals(entries, productMap);
  const totalTarget = await getTarget('total', 0, 'daily');
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const openIncidents = incidents.filter((i) => i.status !== 'resolved');
  const planDone = planItems.filter((i) => i.done).length;
  return {
    openTasks: openTasks.length,
    highPriorityTasks: openTasks.filter((t) => t.priority === 'high').length,
    openIncidents: openIncidents.length,
    criticalIncidents: openIncidents.filter((i) => i.severity === 'critical').length,
    planTotal: planItems.length,
    planDone,
    planPct: planItems.length ? Math.round((planDone / planItems.length) * 100) : 0,
    activeRuns,
    productionToday: totals.total,
    dailyTarget: totalTarget,
  };
}

// ── צוות ותחומי אחריות ──

export async function getManagerResponsibilityAreas() {
  const rows = await db.managerResponsibilityAreas.toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function addManagerResponsibilityArea(name) {
  const label = sanitizeName(name, 80);
  if (!label) throw new ValidationError('הזן שם תחום אחריות');
  const existing = await getManagerResponsibilityAreas();
  const sortOrder = existing.length ? Math.max(...existing.map((r) => r.sortOrder ?? 0)) + 1 : 1;
  return db.managerResponsibilityAreas.add({ name: label, sortOrder });
}

export async function updateManagerResponsibilityArea(id, name) {
  const label = sanitizeName(name, 80);
  if (!label) throw new ValidationError('הזן שם תחום אחריות');
  const row = await db.managerResponsibilityAreas.get(Number(id));
  if (!row) throw new ValidationError('תחום לא נמצא');
  return db.managerResponsibilityAreas.update(row.id, { name: label });
}

export async function deleteManagerResponsibilityArea(id) {
  const rid = Number(id);
  const employees = await db.managerEmployees.where('responsibilityAreaId').equals(rid).count();
  if (employees > 0) throw new ValidationError('יש עובדים משויכים — העבר אותם לפני מחיקה');
  await db.managerResponsibilityAreas.delete(rid);
}

export async function getManagerEmployees({ activeOnly = false } = {}) {
  let rows = await db.managerEmployees.toArray();
  if (activeOnly) rows = rows.filter((e) => e.active !== false);
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export async function addManagerEmployee({ name, responsibilityAreaId }) {
  const label = sanitizeName(name, 80);
  if (!label) throw new ValidationError('הזן שם עובד');
  const areaId = responsibilityAreaId ? Number(responsibilityAreaId) : null;
  if (areaId) {
    const area = await db.managerResponsibilityAreas.get(areaId);
    if (!area) throw new ValidationError('תחום אחריות לא נמצא');
  }
  const existing = await getManagerEmployees();
  const sortOrder = existing.length ? Math.max(...existing.map((e) => e.sortOrder ?? 0)) + 1 : 1;
  return db.managerEmployees.add({
    name: label,
    responsibilityAreaId: areaId,
    active: true,
    sortOrder,
  });
}

export async function updateManagerEmployee(id, patch) {
  const row = await db.managerEmployees.get(Number(id));
  if (!row) throw new ValidationError('עובד לא נמצא');
  const next = {};
  if (patch.name !== undefined) {
    const label = sanitizeName(patch.name, 80);
    if (!label) throw new ValidationError('הזן שם עובד');
    next.name = label;
  }
  if (patch.responsibilityAreaId !== undefined) {
    const areaId = patch.responsibilityAreaId ? Number(patch.responsibilityAreaId) : null;
    if (areaId) {
      const area = await db.managerResponsibilityAreas.get(areaId);
      if (!area) throw new ValidationError('תחום אחריות לא נמצא');
    }
    next.responsibilityAreaId = areaId;
  }
  if (patch.active !== undefined) next.active = !!patch.active;
  if (!Object.keys(next).length) return;
  return db.managerEmployees.update(row.id, next);
}

export async function deleteManagerEmployee(id) {
  await db.managerEmployees.delete(Number(id));
}
