import { db, getProductionRun, getFlowStepsForFlow } from './db.js?v=555';
import { ValidationError, sanitizeName, sanitizeProductId } from './validators.js?v=555';
import { todayISO } from './utils.js?v=555';
import {
  getRecipe,
  getRecipeCostingIngredients,
  recipeTotalWeightGrams,
  scaleIngredientsToTargetGrams,
  computeRecipeMaterialsCostFiltered,
} from './kitchen-db.js?v=555';
import {
  addDaysToISO,
  expiryStatus,
  formatProcessBatchCode,
  isProcessBatchCode,
  isProcessFlow,
  isProcessRun,
  julianDayCode,
  kgFromOutputPercent,
  percentFromKg,
  processRemainingKg,
  rollingCostPerKg,
  roundQty,
  sumKg,
  validateProcessWeights,
  processFlowConflict,
  processFlowConflictMessage,
  yieldOutsideBand,
  yieldPercent,
} from './process-materials-math.js?v=555';

export {
  expiryStatus,
  formatProcessBatchCode,
  isProcessBatchCode,
  isProcessFlow,
  isProcessRun,
  processRemainingKg,
  rollingCostPerKg,
};

const DEFAULT_STEPS = [
  { name: 'הכנת חומרים', tracksYield: false },
  { name: 'עיבוד', tracksYield: true },
  { name: 'סיום', tracksYield: false },
];

function newRowId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listProcessFlows() {
  const flows = await db.flows.toArray();
  return flows
    .filter((flow) => isProcessFlow(flow))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'he'));
}

export async function createProcessFlow({
  name,
  recipeId = null,
  shelfLifeDays = null,
  expectedYieldPct = null,
  linkedProductFlowIds = [],
} = {}) {
  const cleanName = sanitizeName(name, 60);
  if (!String(name || '').trim()) throw new ValidationError('שם החומר לא תקין');
  if (!cleanName) throw new ValidationError('השם ארוך מ־60 תווים');
  const flows = await listProcessFlows();
  const conflict = processFlowConflict(flows, { name: cleanName, recipeId });
  if (conflict) throw new ValidationError(processFlowConflictMessage(conflict));
  const maxOrder = flows.reduce((max, flow) => Math.max(max, flow.sortOrder ?? 0), 0);
  const days = Number(shelfLifeDays);
  const expected = Number(expectedYieldPct);
  const links = [...new Set((linkedProductFlowIds || []).map((id) => Number(id)).filter(Boolean))];
  const flowId = await db.transaction('rw', db.flows, db.flowSteps, async () => {
    const id = await db.flows.add({
      categoryId: null,
      categoryGroupId: null,
      name: cleanName,
      sortOrder: maxOrder + 1,
      isDefault: false,
      flowKind: 'process',
      recipeId: recipeId ? Number(recipeId) : null,
      shelfLifeDays: Number.isFinite(days) && days > 0 ? Math.round(days) : null,
      expectedYieldPct: Number.isFinite(expected) && expected > 0 ? roundQty(expected, 1) : null,
      linkedProductFlowIds: links,
    });
    for (let i = 0; i < DEFAULT_STEPS.length; i += 1) {
      const step = DEFAULT_STEPS[i];
      await db.flowSteps.add({
        flowId: id,
        categoryId: null,
        categoryGroupId: null,
        name: step.name,
        sortOrder: i + 1,
        tracksPortions: false,
        tracksProduction: false,
        tracksYield: step.tracksYield,
        portionUnit: null,
        portionSize: null,
      });
    }
    return id;
  });
  return flowId;
}

export async function updateProcessFlow(flowId, patch = {}) {
  const fid = sanitizeProductId(flowId);
  const flow = fid ? await db.flows.get(fid) : null;
  if (!flow || !isProcessFlow(flow)) throw new ValidationError('תזרים חומר לא נמצא');
  const next = {};
  if (patch.name != null) {
    const clean = sanitizeName(patch.name, 60);
    if (!String(patch.name || '').trim()) throw new ValidationError('שם החומר לא תקין');
    if (!clean) throw new ValidationError('השם ארוך מ־60 תווים');
    next.name = clean;
  }
  if ('recipeId' in patch) next.recipeId = patch.recipeId ? Number(patch.recipeId) : null;
  const conflict = processFlowConflict(await listProcessFlows(), {
    name: next.name || flow.name,
    recipeId: 'recipeId' in next ? next.recipeId : flow.recipeId,
    exceptId: fid,
  });
  if (conflict) throw new ValidationError(processFlowConflictMessage(conflict));
  if ('shelfLifeDays' in patch) {
    const days = Number(patch.shelfLifeDays);
    next.shelfLifeDays = Number.isFinite(days) && days > 0 ? Math.round(days) : null;
  }
  if ('expectedYieldPct' in patch) {
    const expected = Number(patch.expectedYieldPct);
    next.expectedYieldPct = Number.isFinite(expected) && expected > 0 ? roundQty(expected, 1) : null;
  }
  if ('linkedProductFlowIds' in patch) {
    next.linkedProductFlowIds = [...new Set((patch.linkedProductFlowIds || []).map((id) => Number(id)).filter(Boolean))];
  }
  if (Object.keys(next).length) await db.flows.update(fid, next);
  return fid;
}

export async function deleteProcessFlow(flowId) {
  const fid = sanitizeProductId(flowId);
  const flow = fid ? await db.flows.get(fid) : null;
  if (!flow || !isProcessFlow(flow)) return;
  const runs = await db.productionRuns.where('flowId').equals(fid).toArray();
  if (runs.some((run) => run.status === 'active')) {
    throw new ValidationError('יש אצווה פעילה בתזרים הזה. סיים אותה לפני מחיקה');
  }
  await db.flowSteps.where('flowId').equals(fid).delete();
  await db.flows.delete(fid);
}

async function nextProcessSequence(date) {
  const julian = julianDayCode(date);
  const prefix = `P-${julian}-`;
  const runs = await db.productionRuns.toArray();
  let max = 0;
  for (const run of runs) {
    const code = String(run.processBatchCode || run.batchNumber || '');
    if (!code.startsWith(prefix)) continue;
    const seq = Number(code.slice(prefix.length));
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return max + 1;
}

async function estimateInputCost(flow, inputKg) {
  if (!flow?.recipeId || !(Number(inputKg) > 0)) return null;
  const recipe = await getRecipe(Number(flow.recipeId));
  if (!recipe) return null;
  const ingredients = await getRecipeCostingIngredients(recipe);
  const totalG = recipeTotalWeightGrams(ingredients);
  const scaled = totalG > 0
    ? scaleIngredientsToTargetGrams(ingredients, Number(inputKg) * 1000)
    : ingredients;
  const total = await computeRecipeMaterialsCostFiltered(scaled);
  return total > 0 ? roundQty(total, 2) : null;
}

export async function startProcessRun({
  flowId,
  opening = false,
  outputKg = null,
  inputCost = null,
  expiresAt = null,
  supplierLots = '',
} = {}) {
  const fid = sanitizeProductId(flowId);
  const flow = fid ? await db.flows.get(fid) : null;
  if (!flow || !isProcessFlow(flow)) throw new ValidationError('תזרים חומר לא נמצא');
  const steps = await getFlowStepsForFlow(fid);
  if (!steps.length) throw new ValidationError('אין שלבים בתזרים');
  const startedAt = new Date().toISOString();
  const runDate = todayISO();
  const shelfDays = Number(flow.shelfLifeDays);
  const expiry = expiresAt || (shelfDays > 0 ? addDaysToISO(runDate, shelfDays) : null);
  const openingOut = opening ? Number(outputKg) : null;
  if (opening && !(openingOut > 0)) throw new ValidationError('לאצווה שכבר במקרר צריך משקל');
  const manualCost = inputCost != null && inputCost !== '' ? Number(inputCost) : null;

  return db.transaction('rw', db.productionRuns, db.runStepStates, async () => {
    const code = formatProcessBatchCode(runDate, await nextProcessSequence(runDate));
    const id = await db.productionRuns.add({
      date: runDate,
      batchNumber: code,
      processBatchCode: code,
      flowKind: 'process',
      categoryId: null,
      categoryIds: [],
      productId: null,
      categoryGroupId: null,
      flowId: fid,
      flowName: flow.name,
      recipeId: flow.recipeId || null,
      scopeMode: 'process',
      portionUnit: null,
      portionSize: null,
      portionCount: null,
      status: 'active',
      currentStepIndex: 0,
      startedAt,
      completedAt: null,
      runPortionLogs: [],
      materialProcessingLogs: [],
      openingStock: !!opening,
      inputKg: opening ? roundQty(openingOut) : null,
      outputKg: opening ? roundQty(openingOut) : null,
      yieldPct: opening ? 100 : null,
      inputCost: opening && Number.isFinite(manualCost) && manualCost >= 0 ? roundQty(manualCost, 2) : null,
      costPerKg: opening && Number.isFinite(manualCost) && manualCost >= 0 && openingOut > 0
        ? roundQty(manualCost / openingOut, 2)
        : null,
      expiresAt: expiry,
      supplierLots: String(supplierLots || '').trim().slice(0, 500),
      processAllocations: [],
      processWaste: [],
      processUseCopies: [],
    });

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      await db.runStepStates.add({
        runId: id,
        stepIndex: i,
        stepName: step.name,
        status: i === 0 ? 'active' : 'pending',
        startedAt: i === 0 ? startedAt : null,
        completedAt: null,
        notes: '',
        issues: '',
        improvements: '',
        tracksPortions: false,
        tracksProduction: false,
        tracksYield: !!step.tracksYield,
        portionUnit: null,
        portionSize: null,
        portionCount: null,
        portionBatches: [],
        productionEntryIds: [],
      });
    }
    return id;
  });
}

export async function saveProcessWeights(runId, {
  inputKg,
  outputKg,
  confirmed = false,
  supplierLots = null,
  expiresAt = null,
} = {}) {
  const run = await getProductionRun(runId, { normalize: false });
  if (!run || !isProcessRun(run)) throw new ValidationError('אצוות חומר לא נמצאה');
  const allocated = (sumKg(run.processAllocations) || 0) + (sumKg(run.processWaste) || 0);
  const problem = validateProcessWeights({ inputKg, outputKg, allocatedKg: allocated });
  if (problem) throw new ValidationError(problem);
  const flow = run.flowId ? await db.flows.get(run.flowId) : null;
  const actual = yieldPercent(inputKg, outputKg);
  const carriedFlat = (run.openingStock || (run.mixedFrom || []).length > 0)
    && Math.abs(Number(inputKg) - Number(outputKg)) <= 0.0005;
  const outside = !carriedFlat && yieldOutsideBand(actual, flow?.expectedYieldPct);
  if (outside && !confirmed) {
    const err = new ValidationError(
      `תפוקה ${actual}% רחוקה מהרגיל ${flow.expectedYieldPct}%. אשר כדי לשמור`,
    );
    err.code = 'yield-confirm';
    throw err;
  }
  const carriedCost = run.openingStock || (run.mixedFrom || []).length > 0;
  const cost = carriedCost
    ? (run.inputCost != null ? Number(run.inputCost) : null)
    : await estimateInputCost(flow, inputKg);
  const output = roundQty(outputKg);
  const patch = {
    inputKg: roundQty(inputKg),
    outputKg: output,
    yieldPct: actual,
    yieldOutside: outside,
    inputCost: cost,
    costPerKg: cost != null && output > 0 ? roundQty(cost / output, 2) : null,
  };
  if (supplierLots != null) patch.supplierLots = String(supplierLots || '').trim().slice(0, 500);
  if (expiresAt !== null && expiresAt !== undefined) patch.expiresAt = expiresAt || null;
  await db.productionRuns.update(run.id, patch);
  return patch;
}

function allocationRow(source, product, kg, pct) {
  return {
    id: newRowId(),
    productRunId: product?.id || null,
    productFlowId: product?.flowId || null,
    productBatchNumber: product?.batchNumber || '',
    productFlowName: product?.flowName || '',
    pct,
    kg,
    createdAt: new Date().toISOString(),
  };
}

/**
 * שיוך יחיד. נשמר על אצוות החומר, ועותק להצגה נשמר על תזרים המוצר.
 * אין ניפוק מלאי ואין מנת מתכון נוספת.
 */
export async function assignProcessUse({ sourceRunId, productRunId, pct = null, kg = null } = {}) {
  const sourceId = sanitizeProductId(sourceRunId);
  const productId = sanitizeProductId(productRunId);
  if (!sourceId || !productId) throw new ValidationError('בחר אצווה ותזרים מוצר');
  let copy = null;
  await db.transaction('rw', db.productionRuns, async () => {
    const source = await db.productionRuns.get(sourceId);
    const product = await db.productionRuns.get(productId);
    if (!source || !isProcessRun(source)) throw new ValidationError('אצוות חומר לא נמצאה');
    if (!product || isProcessRun(product)) throw new ValidationError('בחר תזרים מוצר');
    const output = Number(source.outputKg);
    if (!(output > 0)) throw new ValidationError('קודם שומרים משקל אחרי עיבוד');
    let useKg = kg != null && kg !== '' ? Number(kg) : null;
    let usePct = pct != null && pct !== '' ? Number(pct) : null;
    if (usePct > 0) useKg = kgFromOutputPercent(output, usePct);
    else if (useKg > 0) usePct = percentFromKg(output, useKg);
    useKg = roundQty(useKg);
    usePct = roundQty(usePct, 1);
    if (!(useKg > 0)) throw new ValidationError('ציין אחוז או ק״ג');
    const left = processRemainingKg(source);
    if (useKg > left + 0.0005) {
      throw new ValidationError(`נשארו ${left} ק״ג באצווה ${source.processBatchCode || source.batchNumber}`);
    }
    const row = allocationRow(source, product, useKg, usePct);
    copy = {
      id: row.id,
      sourceRunId: source.id,
      sourceCode: source.processBatchCode || source.batchNumber,
      flowId: source.flowId,
      flowName: source.flowName || '',
      pct: usePct,
      kg: useKg,
      createdAt: row.createdAt,
    };
    await db.productionRuns.update(source.id, {
      processAllocations: [...(source.processAllocations || []), row],
    });
    await db.productionRuns.update(product.id, {
      processUseCopies: [...(product.processUseCopies || []), copy],
    });
  });
  return copy;
}

export async function removeProcessUse(sourceRunId, allocationId) {
  const sourceId = sanitizeProductId(sourceRunId);
  if (!sourceId || !allocationId) throw new ValidationError('השיוך לא נמצא');
  await db.transaction('rw', db.productionRuns, async () => {
    const source = await db.productionRuns.get(sourceId);
    if (!source) throw new ValidationError('אצוות חומר לא נמצאה');
    const allocs = source.processAllocations || [];
    const row = allocs.find((item) => item.id === allocationId);
    if (!row) throw new ValidationError('השיוך לא נמצא');
    await db.productionRuns.update(source.id, {
      processAllocations: allocs.filter((item) => item.id !== allocationId),
    });
    if (row.productRunId) {
      const product = await db.productionRuns.get(row.productRunId);
      if (product) {
        await db.productionRuns.update(product.id, {
          processUseCopies: (product.processUseCopies || []).filter((item) => item.id !== allocationId),
        });
      }
    }
  });
}

export async function removeProcessUseFromProduct(productRunId, allocationId) {
  const product = await getProductionRun(productRunId, { normalize: false });
  if (!product) throw new ValidationError('תהליך לא נמצא');
  const copy = (product.processUseCopies || []).find((item) => item.id === allocationId);
  if (!copy?.sourceRunId) throw new ValidationError('השיוך לא נמצא');
  await removeProcessUse(copy.sourceRunId, allocationId);
}

export async function addProcessWaste(runId, { kg, reason = '' } = {}) {
  const run = await getProductionRun(runId, { normalize: false });
  if (!run || !isProcessRun(run)) throw new ValidationError('אצוות חומר לא נמצאה');
  const amount = roundQty(kg);
  if (!(amount > 0)) throw new ValidationError('כמות שנזרקה לא תקינה');
  const left = processRemainingKg(run);
  if (left == null) throw new ValidationError('קודם שומרים משקל אחרי עיבוד');
  if (amount > left + 0.0005) throw new ValidationError(`נשארו ${left} ק״ג`);
  const row = {
    id: newRowId(),
    kg: amount,
    reason: String(reason || '').trim().slice(0, 120),
    createdAt: new Date().toISOString(),
  };
  await db.productionRuns.update(run.id, {
    processWaste: [...(run.processWaste || []), row],
  });
  return row;
}

export async function listProcessRuns() {
  const runs = await db.productionRuns.toArray();
  return runs
    .filter((run) => isProcessRun(run))
    .sort((a, b) => String(b.startedAt || b.date || '').localeCompare(String(a.startedAt || a.date || '')) || b.id - a.id);
}

export async function openProcessRunsForFlow(flowId) {
  const fid = Number(flowId);
  const runs = await listProcessRuns();
  return runs
    .filter((run) => Number(run.flowId) === fid)
    .map((run) => ({ ...run, remainingKg: processRemainingKg(run) }))
    .filter((run) => run.remainingKg == null || run.remainingKg > 0);
}

export async function flowRollingAverage(flowId) {
  const fid = Number(flowId);
  const runs = (await listProcessRuns()).filter((run) => Number(run.flowId) === fid);
  return rollingCostPerKg(runs, 8);
}

export async function listExpiryNotices(today = todayISO()) {
  const runs = await listProcessRuns();
  const notices = [];
  for (const run of runs) {
    const remaining = processRemainingKg(run);
    if (remaining != null && remaining <= 0) continue;
    if (!run.expiresAt) continue;
    const status = expiryStatus(run.expiresAt, today);
    if (!status || status === 'ok') continue;
    notices.push({
      runId: run.id,
      code: run.processBatchCode || run.batchNumber,
      name: run.flowName || 'חומר בתהליך',
      expiresAt: run.expiresAt,
      status,
      remainingKg: remaining,
    });
  }
  notices.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  return notices;
}

export async function mixProcessRuns(runIdA, runIdB) {
  const a = await getProductionRun(sanitizeProductId(runIdA), { normalize: false });
  const b = await getProductionRun(sanitizeProductId(runIdB), { normalize: false });
  if (!a || !b || !isProcessRun(a) || !isProcessRun(b)) throw new ValidationError('בחר שתי אצוות חומר');
  if (Number(a.flowId) !== Number(b.flowId)) throw new ValidationError('אפשר לערבב רק אצוות של אותו חומר');
  if (Number(a.id) === Number(b.id)) throw new ValidationError('בחר שתי אצוות שונות');
  const leftA = processRemainingKg(a);
  const leftB = processRemainingKg(b);
  if (!(leftA > 0) || !(leftB > 0)) throw new ValidationError('לשתי האצוות צריכה להיות יתרה');
  const newId = await startProcessRun({ flowId: a.flowId });
  try {
    await db.transaction('rw', db.productionRuns, async () => {
      const freshA = await db.productionRuns.get(a.id);
      const freshB = await db.productionRuns.get(b.id);
      const created = await db.productionRuns.get(newId);
      const remainA = processRemainingKg(freshA);
      const remainB = processRemainingKg(freshB);
      if (!(remainA > 0) || !(remainB > 0)) throw new ValidationError('לשתי האצוות צריכה להיות יתרה');
      const kg = roundQty(remainA + remainB);
      const priceA = Number(freshA.costPerKg);
      const priceB = Number(freshB.costPerKg);
      const bothPriced = priceA > 0 && priceB > 0;
      const cost = bothPriced ? roundQty(priceA * remainA + priceB * remainB, 2) : null;
      const expires = [freshA.expiresAt, freshB.expiresAt].filter(Boolean).sort()[0] || created?.expiresAt || null;
      const code = created?.processBatchCode || created?.batchNumber || '';
      await db.productionRuns.update(newId, {
        inputKg: kg,
        outputKg: kg,
        yieldPct: 100,
        inputCost: cost,
        costPerKg: cost != null ? roundQty(cost / kg, 2) : null,
        expiresAt: expires,
        supplierLots: [freshA.supplierLots, freshB.supplierLots].filter(Boolean).join('\n').slice(0, 500),
        mixedFrom: [freshA.processBatchCode || freshA.batchNumber, freshB.processBatchCode || freshB.batchNumber],
        openingStock: false,
      });
      const stamp = new Date().toISOString();
      await db.productionRuns.update(freshA.id, {
        processAllocations: [...(freshA.processAllocations || []), {
          id: newRowId(),
          mixTargetRunId: newId,
          mixTargetCode: code,
          productRunId: null,
          productFlowName: 'ערבוב',
          pct: percentFromKg(freshA.outputKg, remainA),
          kg: remainA,
          createdAt: stamp,
        }],
      });
      await db.productionRuns.update(freshB.id, {
        processAllocations: [...(freshB.processAllocations || []), {
          id: newRowId(),
          mixTargetRunId: newId,
          mixTargetCode: code,
          productRunId: null,
          productFlowName: 'ערבוב',
          pct: percentFromKg(freshB.outputKg, remainB),
          kg: remainB,
          createdAt: stamp,
        }],
      });
    });
  } catch (err) {
    await db.runStepStates.where('runId').equals(newId).delete();
    await db.productionRuns.delete(newId);
    throw err;
  }
  return newId;
}
