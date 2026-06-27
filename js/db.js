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
} from './validators.js?v=161';
import { computeProductionTotals, sumEntriesForProducts } from './calc.js?v=161';
import { defaultColorForIndex } from './chart.js?v=161';

export { ValidationError };

export const PRODUCTION_STEP_NAME = 'תיעוד ייצור';

export const db = new Dexie('CakeProduction');

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
  if (raw === 'kg' || raw === 'kg_units') return raw;
  return 'unit';
}

function sanitizeUnitWeightKg(raw, priceUnit) {
  if (priceUnit !== 'kg_units') return null;
  return sanitizePortionSize(raw, { min: 0.001, max: 100_000 });
}

function sanitizeProductQuantity(raw, product, { allowZero = false } = {}) {
  if (product?.priceUnit === 'kg') {
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
  await db.transaction('rw', db.categories, db.categoryGroups, db.products, db.productionEntries, db.targets, db.processLogs, db.activityPresets, db.flows, db.flowSteps, db.flowPortionPresets, db.groupPortionPresets, db.flowPreparations, db.productionRuns, db.runStepStates, db.productPreparations, db.runPreparationChecks, db.recipeGroups, db.recipeCategories, db.recipes, db.recipeIngredients, db.recipeProductLinks, db.supplierCategories, db.suppliers, db.rawMaterials, db.rawMaterialPriceHistory, db.weeklyProductionPlans, db.weeklyProductionPlanItems, db.managerPlans, db.managerPlanItems, db.managerTasks, db.managerIncidents, db.managerShiftNotes, db.managerResponsibilityAreas, db.managerEmployees, db.managerDepartments, async () => {
    await db.weeklyProductionPlanItems.clear();
    await db.weeklyProductionPlans.clear();
    await db.recipeIngredients.clear();
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
    await db.flowPreparations.clear();
    await db.flowSteps.clear();
    await db.flows.clear();
    await db.runPreparationChecks.clear();
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
    flowPreparations,
    productionRuns,
    runStepStates,
    productPreparations,
    runPreparationChecks,
    settingsRows,
    managerPlans,
    managerPlanItems,
    managerTasks,
    managerIncidents,
    managerShiftNotes,
    managerResponsibilityAreas,
    managerEmployees,
    managerDepartments,
    recipeGroups,
    recipeCategories,
    recipes,
    recipeIngredients,
    recipeProductLinks,
    supplierCategories,
    suppliers,
    rawMaterials,
    rawMaterialPriceHistory,
    weeklyProductionPlans,
    weeklyProductionPlanItems,
    bakingProfiles,
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
    db.flowPreparations.toArray(),
    db.productionRuns.toArray(),
    db.runStepStates.toArray(),
    db.productPreparations.toArray(),
    db.runPreparationChecks.toArray(),
    db.settings.toArray(),
    db.managerPlans.toArray(),
    db.managerPlanItems.toArray(),
    db.managerTasks.toArray(),
    db.managerIncidents.toArray(),
    db.managerShiftNotes.toArray(),
    db.managerResponsibilityAreas.toArray(),
    db.managerEmployees.toArray(),
    db.managerDepartments?.toArray?.() ?? Promise.resolve([]),
    db.recipeGroups.toArray(),
    db.recipeCategories.toArray(),
    db.recipes.toArray(),
    db.recipeIngredients.toArray(),
    db.recipeProductLinks.toArray(),
    db.supplierCategories.toArray(),
    db.suppliers.toArray(),
    db.rawMaterials.toArray(),
    db.rawMaterialPriceHistory?.toArray?.() ?? Promise.resolve([]),
    db.weeklyProductionPlans.toArray(),
    db.weeklyProductionPlanItems.toArray(),
    db.bakingProfiles?.toArray?.() ?? Promise.resolve([]),
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
    flowPreparations,
    productionRuns,
    runStepStates,
    productPreparations,
    runPreparationChecks,
    managerPlans,
    managerPlanItems,
    managerTasks,
    managerIncidents,
    managerShiftNotes,
    managerResponsibilityAreas,
    managerEmployees,
    managerDepartments,
    recipeGroups,
    recipeCategories,
    recipes,
    recipeIngredients,
    recipeProductLinks,
    supplierCategories,
    suppliers,
    rawMaterials,
    rawMaterialPriceHistory,
    weeklyProductionPlans,
    weeklyProductionPlanItems,
    bakingProfiles,
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
  if (!Array.isArray(payload.flowPreparations)) payload.flowPreparations = [];
  if (!Array.isArray(payload.productionRuns)) payload.productionRuns = [];
  if (!Array.isArray(payload.runStepStates)) payload.runStepStates = [];
  if (!Array.isArray(payload.productPreparations)) payload.productPreparations = [];
  if (!Array.isArray(payload.runPreparationChecks)) payload.runPreparationChecks = [];
  if (!Array.isArray(payload.weeklyProductionPlanItems)) payload.weeklyProductionPlanItems = [];
  if (!Array.isArray(payload.recipeGroups)) payload.recipeGroups = [];
  if (!Array.isArray(payload.recipeProductLinks)) payload.recipeProductLinks = [];
  if (!Array.isArray(payload.recipeCategories)) payload.recipeCategories = [];
  if (!Array.isArray(payload.recipes)) payload.recipes = [];
  if (!Array.isArray(payload.recipeIngredients)) payload.recipeIngredients = [];
  if (!Array.isArray(payload.supplierCategories)) payload.supplierCategories = [];
  if (!Array.isArray(payload.suppliers)) payload.suppliers = [];
  if (!Array.isArray(payload.rawMaterials)) payload.rawMaterials = [];
  if (!Array.isArray(payload.rawMaterialPriceHistory)) payload.rawMaterialPriceHistory = [];
  if (!Array.isArray(payload.weeklyProductionPlans)) payload.weeklyProductionPlans = [];
  if (!Array.isArray(payload.managerPlans)) payload.managerPlans = [];
  if (!Array.isArray(payload.managerPlanItems)) payload.managerPlanItems = [];
  if (!Array.isArray(payload.managerTasks)) payload.managerTasks = [];
  if (!Array.isArray(payload.managerIncidents)) payload.managerIncidents = [];
  if (!Array.isArray(payload.managerShiftNotes)) payload.managerShiftNotes = [];
  if (!Array.isArray(payload.managerResponsibilityAreas)) payload.managerResponsibilityAreas = [];
  if (!Array.isArray(payload.managerEmployees)) payload.managerEmployees = [];
  if (!Array.isArray(payload.managerDepartments)) payload.managerDepartments = [];
  if (!Array.isArray(payload.bakingProfiles)) payload.bakingProfiles = [];

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
    db.categories,
    db.categoryGroups,
    db.products,
    db.productionEntries,
    db.targets,
    db.processLogs,
    db.activityPresets,
    db.flowSteps,
    db.flows,
    db.flowPortionPresets,
    db.groupPortionPresets,
    db.flowPreparations,
    db.productionRuns,
    db.runStepStates,
    db.productPreparations,
    db.runPreparationChecks,
    db.settings,
    db.managerPlans,
    db.managerPlanItems,
    db.managerTasks,
    db.managerIncidents,
    db.managerShiftNotes,
    db.managerResponsibilityAreas,
    db.managerEmployees,
    db.managerDepartments,
    db.recipeGroups,
    db.recipeProductLinks,
    db.recipeCategories,
    db.recipes,
    db.recipeIngredients,
    db.supplierCategories,
    db.suppliers,
    db.rawMaterials,
    db.rawMaterialPriceHistory,
    db.weeklyProductionPlans,
    db.weeklyProductionPlanItems,
    db.bakingProfiles,
    async (tx) => {
      await db.productionEntries.clear();
      await db.processLogs.clear();
      await db.weeklyProductionPlanItems.clear();
      await db.weeklyProductionPlans.clear();
      await db.recipeIngredients.clear();
      await db.recipeProductLinks.clear();
      await db.recipes.clear();
      await db.recipeCategories.clear();
      await db.recipeGroups.clear();
      await db.bakingProfiles?.clear?.();
      await db.rawMaterialPriceHistory?.clear?.();
      await db.rawMaterials.clear();
      await db.suppliers.clear();
      await db.supplierCategories.clear();
      await db.runPreparationChecks.clear();
      await db.runStepStates.clear();
      await db.productionRuns.clear();
      await db.flowPortionPresets.clear();
      await db.groupPortionPresets.clear();
      await db.flowPreparations.clear();
      await db.flowSteps.clear();
      await db.flows.clear();
      await db.managerPlanItems.clear();
      await db.managerPlans.clear();
      await db.managerTasks.clear();
      await db.managerIncidents.clear();
      await db.managerShiftNotes.clear();
      await db.managerEmployees.clear();
      await db.managerResponsibilityAreas.clear();
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
      } else {
        await migrateImportedFlowPresetsToGroup(tx);
      }
      if (payload.flowPreparations.length) await db.flowPreparations.bulkPut(payload.flowPreparations);
      if (payload.productionRuns.length) await db.productionRuns.bulkPut(payload.productionRuns);
      if (payload.runStepStates.length) await db.runStepStates.bulkPut(payload.runStepStates);
      if (payload.productPreparations.length) await db.productPreparations.bulkPut(payload.productPreparations);
      if (payload.runPreparationChecks.length) await db.runPreparationChecks.bulkPut(payload.runPreparationChecks);
      if (payload.recipeGroups.length) await db.recipeGroups.bulkPut(payload.recipeGroups);
      if (payload.recipeCategories.length) await db.recipeCategories.bulkPut(payload.recipeCategories);
      if (payload.recipes.length) await db.recipes.bulkPut(payload.recipes);
      if (payload.recipeIngredients.length) await db.recipeIngredients.bulkPut(payload.recipeIngredients);
      if (payload.recipeProductLinks.length) await db.recipeProductLinks.bulkPut(payload.recipeProductLinks);
      if (payload.bakingProfiles?.length) await db.bakingProfiles.bulkPut(payload.bakingProfiles);
      await migrateLegacyRecipeCategoriesIfNeeded(tx);
      if (payload.supplierCategories.length) await db.supplierCategories.bulkPut(payload.supplierCategories);
      if (payload.suppliers.length) await db.suppliers.bulkPut(payload.suppliers);
      if (payload.rawMaterials.length) await db.rawMaterials.bulkPut(payload.rawMaterials);
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
  if ('priceUnit' in patch) patch.priceUnit = sanitizeProductPriceUnit(patch.priceUnit);
  if ('unitWeightKg' in patch || 'priceUnit' in patch) {
    const existing = await db.products.get(id);
    const unit = patch.priceUnit ?? existing?.priceUnit;
    if ('unitWeightKg' in patch) {
      patch.unitWeightKg = sanitizeUnitWeightKg(patch.unitWeightKg, unit);
    } else if (unit !== 'kg_units') {
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
    const msg = product.priceUnit === 'kg'
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
      throw new ValidationError(product?.priceUnit === 'kg'
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

/* ── הכנות לתזרים (צ׳קליסט) ── */

export async function getFlowPreparations(flowId) {
  const fid = sanitizeProductId(flowId);
  if (!fid) return [];
  const rows = await db.flowPreparations.where('flowId').equals(fid).toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function addFlowPreparation(flowId, name) {
  const fid = sanitizeProductId(flowId);
  const trimmed = sanitizeName(name, 80);
  if (!fid) throw new ValidationError('תזרים לא תקין');
  if (!trimmed) throw new ValidationError('שם הכנה לא תקין');
  const existing = await getFlowPreparations(fid);
  if (existing.some((p) => p.name === trimmed)) {
    throw new ValidationError('הכנה זו כבר קיימת בתזרים');
  }
  const maxOrder = existing.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0);
  return db.flowPreparations.add({ flowId: fid, name: trimmed, sortOrder: maxOrder + 1 });
}

export async function deleteFlowPreparation(id) {
  const prepId = sanitizeProductId(id);
  if (!prepId) return;
  await db.flowPreparations.delete(prepId);
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
  const preps = await tx.table('flowPreparations').where('flowId').equals(fid).toArray();
  preps.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  for (const prep of preps) {
    await tx.table('runPreparationChecks').add({
      runId: rid,
      flowPreparationId: prep.id,
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
      const ex = byPrepId.get(prep.id);
      if (ex) {
        if (ex.name !== prep.name || ex.sortOrder !== prep.sortOrder) {
          await db.runPreparationChecks.update(ex.id, { name: prep.name, sortOrder: prep.sortOrder ?? 0 });
        }
      } else {
        await db.runPreparationChecks.add({
          runId: rid,
          flowPreparationId: prep.id,
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
  const prepId = await addFlowPreparation(flowId, name);
  const rid = sanitizeProductId(runId);
  if (!rid) return prepId;
  const prep = await db.flowPreparations.get(prepId);
  if (prep) {
    const existing = await getRunPreparationChecks(rid);
    if (!existing.some((c) => c.flowPreparationId === prep.id)) {
      await db.runPreparationChecks.add({
        runId: rid,
        flowPreparationId: prep.id,
        name: prep.name,
        sortOrder: prep.sortOrder ?? 0,
        checked: false,
        checkedAt: null,
      });
    }
  }
  return prepId;
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
    const steps = await getFlowStepsForFlow(flowId);
    if (steps.length) return steps;
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

  return db.transaction('rw', db.flows, db.flowSteps, db.flowPreparations, async () => {
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

    const sourcePreps = await getFlowPreparations(sourceId);
    for (const prep of sourcePreps) {
      await db.flowPreparations.add({
        flowId: newFlowId,
        name: prep.name,
        sortOrder: prep.sortOrder ?? 0,
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

  await db.transaction('rw', db.flows, db.flowSteps, db.flowPreparations, async () => {
    await db.flowPreparations.where('flowId').equals(fid).delete();
    await db.flowSteps.where('flowId').equals(fid).delete();
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
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function getFlowPortionPresets(flowId) {
  const gid = await resolveCategoryGroupIdForFlow(flowId);
  if (!gid) return [];
  return getGroupPortionPresets(gid);
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
  return db.groupPortionPresets.delete(id);
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
  return db.transaction('rw', db.flowSteps, db.flows, (tx) => ensureFlowProductionStepInTx(tx, fid));
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
  return new Date().toISOString();
}

function isoDatePart(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

function mergeDateIntoIso(dateStr, existingIso) {
  if (!isValidISODate(dateStr)) throw new ValidationError('תאריך לא תקין');
  let time = '12:00:00';
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

function validateStepCompletedAtOrder(run, stepIndex, completedAtIso) {
  if (!completedAtIso) return;
  const t = Date.parse(completedAtIso);
  if (!Number.isFinite(t)) throw new ValidationError('תאריך/שעה לא תקינים');
  if (run.startedAt && t < Date.parse(run.startedAt)) {
    throw new ValidationError('שעת השלמה לפני תחילת התהליך');
  }
  const prev = run.steps[stepIndex - 1];
  if (prev?.completedAt && t < Date.parse(prev.completedAt)) {
    throw new ValidationError('שעת השלמה לפני השלב הקודם');
  }
  const next = run.steps[stepIndex + 1];
  if (next?.completedAt && t > Date.parse(next.completedAt)) {
    throw new ValidationError('שעת השלמה אחרי השלב הבא');
  }
  if (run.completedAt && t > Date.parse(run.completedAt)) {
    throw new ValidationError('שעת השלמה אחרי סיום התהליך');
  }
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

  const startedAt = mergeDateIntoIso(date, nowISO());

  return db.transaction('rw', db.productionRuns, db.runStepStates, db.settings, db.runPreparationChecks, async () => {
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
    });
    for (let i = 0; i < steps.length; i++) {
      const fs = steps[i];
      await db.runStepStates.add({
        runId,
        stepIndex: i,
        stepName: fs.name,
        status: i === 0 ? 'active' : 'pending',
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
      await seedRunPreparationChecksInTx(db, runId, resolvedFlowId);
    }
    if (runSettings.autoBatchEnabled) {
      const next = Math.max(1, Number(runSettings.nextBatchNumber) || 1) + 1;
      await db.settings.put({ key: RUN_SETTINGS_KEY, value: { ...runSettings, nextBatchNumber: next } });
    }
    return runId;
  });
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

export async function getActiveProductionRuns() {
  const runs = await db.productionRuns.where('status').equals('active').toArray();
  runs.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '') || b.id - a.id);
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

export async function addRunStepPortionBatch(runId, stepIndex, { presetId, count, date, note } = {}) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  const step = run.steps[stepIndex];
  if (!step) throw new ValidationError('שלב לא תקין');
  if (!step.tracksPortions) throw new ValidationError('שלב זה לא עוקב אחר מנות');

  const stepReached = step.status === 'completed'
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
  if (!batches.length && step.portionCount != null) {
    batches.push({
      count: step.portionCount,
      date: step.completedAt ? String(step.completedAt).slice(0, 10) : batchDate,
      recordedAt: step.completedAt || managerNowISO(),
      note: '',
    });
  }

  const entry = {
    count: pCount,
    date: batchDate,
    recordedAt: managerNowISO(),
    note: String(note || '').trim().slice(0, 200),
  };

  if (pid) {
    const preset = flowPresets.find((p) => p.id === pid) || await db.groupPortionPresets.get(pid);
    if (!preset) throw new ValidationError('מנה לא נמצאה');
    entry.presetId = preset.id;
    entry.name = preset.name;
    entry.weight = preset.weight;
    entry.extra = preset.extra || '';
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

export async function completeRunStep(runId, stepIndex, { notes, issues, improvements, portionUnit, portionSize, portionCount } = {}) {
  const run = await getProductionRun(runId);
  if (!run) throw new ValidationError('תהליך לא נמצא');
  if (run.status === 'completed') throw new ValidationError('התהליך כבר הושלם');
  if (stepIndex !== run.currentStepIndex) throw new ValidationError('זה לא השלב הפעיל');

  const step = run.steps[stepIndex];
  if (!step) throw new ValidationError('שלב לא תקין');

  return db.transaction('rw', db.productionRuns, db.runStepStates, async () => {
    const stepPatch = {
      status: 'completed',
      completedAt: nowISO(),
      notes: String(notes ?? step.notes ?? '').trim().slice(0, 500),
      issues: String(issues ?? step.issues ?? '').trim().slice(0, 500),
      improvements: String(improvements ?? step.improvements ?? '').trim().slice(0, 500),
    };
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
      if (pCount != null) {
        batches.push({
          count: pCount,
          date: String(stepPatch.completedAt).slice(0, 10),
          recordedAt: stepPatch.completedAt,
          note: '',
        });
      } else if (!batches.length && step.portionCount != null) {
        batches.push({
          count: step.portionCount,
          date: String(stepPatch.completedAt).slice(0, 10),
          recordedAt: stepPatch.completedAt,
          note: '',
        });
      }
      if (batches.length) {
        stepPatch.portionBatches = batches;
        stepPatch.portionCount = sumPortionBatches(batches);
      }
    }
    await db.runStepStates.update(step.id, stepPatch);

    const nextIndex = stepIndex + 1;
    const isLast = nextIndex >= run.steps.length;

    if (isLast) {
      await db.productionRuns.update(runId, {
        status: 'completed',
        currentStepIndex: nextIndex,
        completedAt: nowISO(),
      });
    } else {
      await db.productionRuns.update(runId, { currentStepIndex: nextIndex });
      const nextStep = run.steps[nextIndex];
      if (nextStep) await db.runStepStates.update(nextStep.id, { status: 'active' });
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
  completedDate, completedTime, clearCompletedAt,
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
  if (clearCompletedAt) {
    patch.completedAt = null;
  } else if (completedDate !== undefined || completedTime !== undefined) {
    const nextIso = mergeDateTimeIntoIso(
      completedDate !== undefined ? completedDate : isoDatePart(step.completedAt),
      completedTime !== undefined ? completedTime : undefined,
      step.completedAt,
    );
    validateStepCompletedAtOrder(run, stepIndex, nextIso);
    patch.completedAt = nextIso;
    if (step.status !== 'completed' && step.status !== 'active') {
      patch.status = 'completed';
    }
  }
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

  await db.transaction('rw', db.productionRuns, db.runStepStates, db.productionEntries, db.runPreparationChecks, async () => {
    for (const id of entryIds) {
      await db.productionEntries.delete(id);
    }
    await db.runPreparationChecks.where('runId').equals(rid).delete();
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
  portionPresetId = null,
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
      categoryId: null,
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
  if (patch.dayOffset !== undefined) next.dayOffset = Number(patch.dayOffset) || 0;
  if (!Object.keys(next).length) return;
  await db.managerPlanItems.update(row.id, next);
}

export async function deleteManagerPlanItem(id) {
  await db.managerPlanItems.delete(Number(id));
}

export async function getManagerTasks({ department, kind, status } = {}) {
  let rows = await db.managerTasks.orderBy('createdAt').reverse().toArray();
  if (department) rows = rows.filter((r) => r.department === department);
  if (kind) rows = rows.filter((r) => r.kind === kind);
  if (status) rows = rows.filter((r) => r.status === status);
  return rows;
}

export async function addManagerTask({
  department, kind = 'task', title, body = '',
  priority = 'medium', dueDate = null,
}) {
  const t = sanitizeName(title, 120);
  if (!t) throw new ValidationError('הזן כותרת');
  const validKind = ['task', 'improvement', 'checklist'].includes(kind) ? kind : 'task';
  const validPriority = ['low', 'medium', 'high'].includes(priority) ? priority : 'medium';
  return db.managerTasks.add({
    department: await validateManagerDepartment(department),
    kind: validKind,
    title: t,
    body: String(body || '').trim().slice(0, 1000),
    status: 'open',
    priority: validPriority,
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
  if (patch.status !== undefined) {
    const st = ['open', 'progress', 'done'].includes(patch.status) ? patch.status : row.status;
    next.status = st;
    next.completedAt = st === 'done' ? managerNowISO() : null;
  }
  if (patch.priority !== undefined && ['low', 'medium', 'high'].includes(patch.priority)) {
    next.priority = patch.priority;
  }
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
