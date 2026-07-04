import {
  getProductsCatalogLayout, getCategoryGroups, getProducts, getCategories, getAllFlowsOverview,
  getFlowsForCategory, getFlowsForGroup, getFlowStepsForFlow, resolveFlows, resolveFlowSteps,
  resolveFlowsForCategorySelection,
  createFlow, updateFlow, deleteFlow, duplicateFlow,
  addFlowStepToFlow, updateFlowStep, deleteFlowStep,
  setFlowStepOrderForFlow, copyDefaultFlowStepsToFlow, ensureFlowProductionStep,
  getFlowPortionPresets, getGroupPortionPresets, addGroupPortionPreset, updateGroupPortionPreset, deleteGroupPortionPreset,
  getFlowPreparations, addFlowPreparation, deleteFlowPreparation, importFlowPreparationsFromActivityPresets,
  startProductionRun, getProductionRun, getProductionRunsForDate, getActiveProductionRuns,
  getAllProductionRuns,
  getProductionRunsForFlow, getFlowProductsHistory, getFlow,
  completeRunStep, updateRunStepFields, deleteProductionRun, updateProductionRunDetails, reopenRunStep,
  syncProductionRunWithFlow, syncAllActiveProductionRuns,
  addRunStepPortionBatch, updateRunStepPortionBatch, deleteRunStepPortionBatch,
  getStepPortionBatches, getStepPortionTotal,
  getRunSettings, setRunSettings,
  getRunProductionEntries, addRunStepProductionEntry, updateProductionEntry, removeRunStepProductionEntry,
  resolveProductionStepIndex,
  ensureRunPreparationChecks, setRunPreparationChecked, addRunPreparationFromFlow,
} from '../db.js?v=219';
import { todayISO, formatDate, showToast, escapeHtml, formatPortionCount, formatProductQuantity, productRecordUsesKg, formatDuration, runDurationMs, stepDurationMs, isoToDateInput, isoToTimeInput, formatDateTime, formatDecimal } from '../utils.js?v=219';
import { openModal, closeModal } from '../modal.js?v=219';
import { requestAutoBackupNow } from '../backup-service.js?v=219';
import { renderSheetsStatusHTML, bindSheetsStatusEvents } from '../sheets-flow.js?v=219';

function parseIdList(str) {
  try {
    return JSON.parse(str || '[]').map(Number).filter(Boolean);
  } catch {
    return [];
  }
}

function applyFlowSelectionToStart(container, flow, layout) {
  container.dataset.selectedFlowId = String(flow.id);
  container.dataset.scopeType = 'category';
  container.dataset.selectedProduct = '';
  if (flow.targetType === 'category' && flow.categoryId) {
    const cat = layout.allCategories.find((c) => c.id === flow.categoryId);
    container.dataset.selectedGroup = String(flow.groupId || flow.categoryGroupId || cat?.groupId || '');
    container.dataset.selectedCategories = JSON.stringify([flow.categoryId]);
  } else {
    const gid = flow.categoryGroupId || flow.groupId;
    container.dataset.selectedGroup = String(gid || '');
    const cats = layout.allCategories.filter((c) => Number(c.groupId) === Number(gid));
    container.dataset.selectedCategories = JSON.stringify(cats.map((c) => c.id));
  }
}

function resolveStartGroupContext(container, ctx, {
  selectedCategories: inputCategories,
  groupId: inputGroupId,
  scopeType,
  productId,
  selectedFlowId,
  allFlowsOverview,
} = {}) {
  const selectedCategories = inputCategories ?? parseIdList(container.dataset.selectedCategories);
  let groupId = inputGroupId ?? container.dataset.selectedGroup ?? '';

  if (!groupId && selectedCategories.length) {
    const cat = ctx.layout.allCategories.find((c) => c.id === selectedCategories[0]);
    if (cat?.groupId) groupId = String(cat.groupId);
  }
  if (!groupId && selectedFlowId && allFlowsOverview?.length) {
    const flow = allFlowsOverview.find((f) => String(f.id) === String(selectedFlowId));
    groupId = String(flow?.groupId || flow?.categoryGroupId || '');
  }

  const groupCategories = groupId
    ? ctx.layout.allCategories.filter((c) => Number(c.groupId) === Number(groupId))
    : [];

  let scopeMode = 'group';
  if (scopeType === 'product') {
    if (productId) scopeMode = 'product';
  } else if (selectedCategories.length) {
    if (groupCategories.length) {
      const allGroupIds = groupCategories.map((c) => c.id);
      const allSelected = allGroupIds.every((id) => selectedCategories.includes(id));
      if (allSelected) scopeMode = 'group';
      else if (selectedCategories.length === 1) scopeMode = 'category';
      else scopeMode = 'categories';
    } else if (selectedCategories.length === 1) {
      scopeMode = 'category';
    } else {
      scopeMode = 'categories';
    }
  }

  return { groupId, selectedCategories, groupCategories, scopeMode };
}

function syncStartStateFromDOM(container) {
  const root = container || document;
  const activeFlow = root.querySelector?.('.start-flow-pick.is-active');
  if (activeFlow?.dataset.flowId) {
    container.dataset.selectedFlowId = activeFlow.dataset.flowId;
  }
  const groupSel = root.querySelector?.('#start-group');
  if (groupSel?.value) {
    container.dataset.selectedGroup = groupSel.value;
  }
  const checked = [...(root.querySelectorAll?.('.start-cat-check:checked') || [])];
  if (checked.length) {
    container.dataset.selectedCategories = JSON.stringify(
      checked.map((el) => Number(el.value)).filter(Boolean),
    );
  }
  const productSel = root.querySelector?.('#start-product');
  if (productSel?.value) {
    container.dataset.selectedProduct = productSel.value;
  }
}

function computeCanStartRun({
  scopeType,
  productId,
  selectedFlowId,
  stepCount,
  groupId,
  selectedCategories,
  selectedFlowOverview,
}) {
  if (!selectedFlowId || stepCount <= 0) return false;
  if (scopeType === 'product') return !!productId;
  if (groupId || selectedCategories.length) return true;
  if (selectedFlowOverview?.targetType === 'group') {
    return !!(selectedFlowOverview.categoryGroupId || selectedFlowOverview.groupId);
  }
  if (selectedFlowOverview?.categoryId) return true;
  return false;
}

function readStartViewState(container, ctx, allFlowsOverview) {
  syncStartStateFromDOM(container);
  const scopeType = container.dataset.scopeType || 'category';
  const productId = container.dataset.selectedProduct || '';
  const selectedFlowId = container.dataset.selectedFlowId || '';
  const date = document.getElementById('start-date')?.value
    || container.dataset.selectedDate
    || todayISO();
  const {
    groupId,
    selectedCategories,
    groupCategories,
    scopeMode,
  } = resolveStartGroupContext(container, ctx, {
    scopeType,
    productId,
    selectedFlowId,
    allFlowsOverview,
  });

  return {
    groupId,
    scopeType,
    selectedCategories,
    productId,
    selectedFlowId,
    date,
    scopeMode,
    groupCategories,
  };
}

function flowStillValidForGroup(flow, groupId) {
  if (!flow || !groupId) return false;
  const flowGroupId = String(flow.groupId || flow.categoryGroupId || '');
  return flowGroupId === String(groupId);
}

function compareProductCategories(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

function bucketFlowsForCatalog(flowsOverview, layout) {
  const flowsByCategory = new Map();
  const flowsByGroup = new Map();
  const otherFlows = [];

  for (const f of flowsOverview) {
    if (f.targetType === 'category' && f.categoryId) {
      if (!flowsByCategory.has(f.categoryId)) flowsByCategory.set(f.categoryId, []);
      flowsByCategory.get(f.categoryId).push(f);
    } else {
      const gid = f.categoryGroupId || f.groupId;
      if (gid) {
        if (!flowsByGroup.has(gid)) flowsByGroup.set(gid, []);
        flowsByGroup.get(gid).push(f);
      } else {
        otherFlows.push(f);
      }
    }
  }

  const listedGroupIds = new Set([...flowsByGroup.keys()]);
  for (const f of flowsOverview) {
    if (f.targetType === 'category' && f.categoryId) {
      if (!layout.allCategories.some((c) => c.id === f.categoryId) && !otherFlows.includes(f)) {
        otherFlows.push(f);
      }
    } else {
      const gid = f.categoryGroupId || f.groupId;
      if (gid && !listedGroupIds.has(gid) && !layout.groups.some((g) => g.id === gid) && !otherFlows.includes(f)) {
        otherFlows.push(f);
      }
    }
  }

  return { flowsByCategory, flowsByGroup, otherFlows };
}

function filterFlowsForManageTarget(allFlowsOverview, layout, { isGroupTarget, groupId, categoryId }) {
  if (isGroupTarget && groupId) {
    const gid = Number(groupId);
    return allFlowsOverview.filter((f) => {
      if (Number(f.categoryGroupId) === gid && !f.categoryId) return true;
      if (f.targetType === 'group' && Number(f.groupId || f.categoryGroupId) === gid) return true;
      if (f.targetType === 'category' && f.categoryId) {
        const cat = layout.allCategories.find((c) => c.id === f.categoryId);
        return cat && Number(cat.groupId) === gid;
      }
      return false;
    });
  }
  if (categoryId) {
    return allFlowsOverview.filter(
      (f) => f.targetType === 'category' && Number(f.categoryId) === Number(categoryId),
    );
  }
  return [];
}

function renderFlowPickButtonHTML(f, selectedFlowId, options = {}) {
  const {
    pickExtraClass = 'start-flow-pick',
    showTargetMeta = false,
  } = options;
  const extraClass = pickExtraClass ? ` ${pickExtraClass}` : '';
  const meta = showTargetMeta
    ? `${escapeHtml(f.targetLabel)} · ${f.stepCount} שלבים`
    : `${f.stepCount} שלבים`;
  return `
    <button type="button" class="manage-flow-pick${extraClass}${String(f.id) === String(selectedFlowId) ? ' is-active' : ''}"
      data-flow-id="${f.id}"
      data-target-type="${f.targetType}"
      data-group-id="${f.groupId || f.categoryGroupId || ''}"
      data-category-id="${f.categoryId || ''}">
      <span class="manage-flow-pick-name">${escapeHtml(f.name)}${f.isDefault ? ' ★' : ''}</span>
      <span class="manage-flow-pick-meta">${meta}</span>
    </button>`;
}

function renderFlowPickListHTML(flows, selectedFlowId, layout, options = {}) {
  const {
    emptyMessage,
    pickExtraClass = 'start-flow-pick',
    showTargetMeta = false,
    scopeGroupId = null,
    restrictCategoryId = null,
    requireSteps = false,
  } = options;

  const selectable = requireSteps ? flows.filter((f) => f.stepCount > 0) : flows;
  if (!selectable.length) {
    return `<p class="form-hint">${emptyMessage || 'אין תזרימים — הגדר ב«נהל תזרים»'}</p>`;
  }

  if (!layout) {
    return `
    <div class="flow-pick-list">
      ${selectable.map((f) => renderFlowPickButtonHTML(f, selectedFlowId, { pickExtraClass, showTargetMeta })).join('')}
    </div>`;
  }

  const { flowsByCategory, flowsByGroup, otherFlows } = bucketFlowsForCatalog(selectable, layout);
  const blocks = [];
  const groupsToWalk = scopeGroupId
    ? layout.groups.filter((g) => Number(g.id) === Number(scopeGroupId))
    : layout.groups;

  for (const group of groupsToWalk) {
    for (const cat of group.categories.slice().sort(compareProductCategories)) {
      if (restrictCategoryId && Number(cat.id) !== Number(restrictCategoryId)) continue;
      const catFlows = flowsByCategory.get(cat.id) || [];
      if (!catFlows.length) continue;
      blocks.push(`
        <div class="flow-pick-category-block">
          <div class="flow-pick-category-label">${escapeHtml(cat.name)}</div>
          ${catFlows.map((f) => renderFlowPickButtonHTML(f, selectedFlowId, { pickExtraClass, showTargetMeta })).join('')}
        </div>`);
    }
    if (!restrictCategoryId) {
      const groupFlows = flowsByGroup.get(group.id) || [];
      if (groupFlows.length) {
        blocks.push(`
          <div class="flow-pick-category-block">
            <div class="flow-pick-category-label">${escapeHtml(group.name)} · כל הקבוצה</div>
            ${groupFlows.map((f) => renderFlowPickButtonHTML(f, selectedFlowId, { pickExtraClass, showTargetMeta })).join('')}
          </div>`);
      }
    }
  }

  if (!scopeGroupId && !restrictCategoryId && otherFlows.length) {
    blocks.push(`
      <div class="flow-pick-category-block">
        <div class="flow-pick-category-label">אחר</div>
        ${otherFlows.map((f) => renderFlowPickButtonHTML(f, selectedFlowId, { pickExtraClass, showTargetMeta })).join('')}
      </div>`);
  }

  if (!blocks.length) {
    return `<p class="form-hint">${emptyMessage || 'אין תזרימים'}</p>`;
  }

  return `<div class="flow-pick-list flow-pick-list--grouped">${blocks.join('')}</div>`;
}

function renderFlowsOverviewGrouped(flowsOverview, layout) {
  if (!flowsOverview.length) return '';
  const { flowsByCategory, flowsByGroup, otherFlows } = bucketFlowsForCatalog(flowsOverview, layout);

  const renderFlowRow = (f) => `
    <div class="flows-overview-row">
      <button type="button" class="flows-overview-open"
        data-flow-id="${f.id}"
        data-target-type="${f.targetType}"
        data-group-id="${f.groupId || f.categoryGroupId || ''}"
        data-category-id="${f.categoryId || ''}">
        <strong>${escapeHtml(f.name)}</strong>${f.isDefault ? ' ★' : ''}
        <span class="flows-overview-open-meta"> · ${escapeHtml(f.targetLabel)} · ${f.stepCount} שלבים</span>
      </button>
      <button type="button" class="btn btn-secondary btn-sm flows-overview-history" data-flow-id="${f.id}" title="היסטוריה">📋</button>
    </div>`;

  const sections = [];
  for (const group of layout.groups) {
    const groupFlows = flowsByGroup.get(group.id) || [];
    const catSections = group.categories
      .slice()
      .sort(compareProductCategories)
      .map((cat) => {
        const catFlows = flowsByCategory.get(cat.id) || [];
        if (!catFlows.length) return '';
        return `
          <div class="flows-overview-subsection">
            <div class="flows-overview-subtitle">${escapeHtml(cat.name)}</div>
            ${catFlows.map(renderFlowRow).join('')}
          </div>`;
      })
      .filter(Boolean);

    if (!groupFlows.length && !catSections.length) continue;
    sections.push(`
      <div class="flows-overview-section">
        <div class="flows-overview-group-title">${escapeHtml(group.name)}</div>
        ${groupFlows.length ? `
          <div class="flows-overview-subsection">
            <div class="flows-overview-subtitle">תזרימי קבוצה</div>
            ${groupFlows.map(renderFlowRow).join('')}
          </div>` : ''}
        ${catSections.join('')}
      </div>`);
  }

  if (otherFlows.length) {
    sections.push(`
      <div class="flows-overview-section">
        <div class="flows-overview-group-title">אחר</div>
        ${otherFlows.map(renderFlowRow).join('')}
      </div>`);
  }

  return sections.join('');
}

function openFlowHistoryView(container, flowId) {
  container.dataset.processScrollRestore = String(container.scrollTop || 0);
  container.dataset.view = 'flow-history';
  container.dataset.flowHistoryId = String(flowId);
  renderProcess(container);
}

function restoreProcessScrollIfNeeded(container) {
  const raw = container.dataset.processScrollRestore;
  if (raw == null || raw === '') return;
  const y = Number(raw);
  delete container.dataset.processScrollRestore;
  if (!Number.isFinite(y) || y <= 0) return;
  requestAnimationFrame(() => {
    container.scrollTop = y;
  });
}

function openFlowInManageView(container, { flowId, targetType, groupId, categoryId }) {
  container.dataset.view = 'manage';
  container.dataset.manageTarget = targetType === 'category' ? 'category' : 'group';
  container.dataset.manageGroup = groupId || '';
  container.dataset.manageCategory = categoryId || '';
  container.dataset.manageFlowId = flowId || '';
  if (groupId) container.dataset.managePortionGroup = groupId;
  renderProcess(container);
}

function runTitle(run, catMap, productMap, groupMap) {
  const flowPrefix = run.flowName ? `${escapeHtml(run.flowName)} · ` : '';
  if (run.productId && productMap.get(run.productId)) {
    const p = productMap.get(run.productId);
    return `${flowPrefix}${escapeHtml(p.name)} (${escapeHtml(catMap.get(p.categoryId) || '')})`;
  }
  const ids = run.categoryIds?.length ? run.categoryIds : (run.categoryId ? [run.categoryId] : []);
  const names = ids.map((id) => catMap.get(id)).filter(Boolean);
  if (run.scopeMode === 'group' && run.categoryGroupId) {
    const gName = groupMap?.get(run.categoryGroupId) || 'קבוצה';
    return `${flowPrefix}📁 ${escapeHtml(gName)} · ${names.length} קטגוריות`;
  }
  if (names.length > 1) return `${flowPrefix}${escapeHtml(names.join(', '))}`;
  return `${flowPrefix}${escapeHtml(catMap.get(run.categoryId) || names[0] || 'קטגוריה')}`;
}

function stepVisualState(stepIndex, currentIndex, totalSteps, stepStatus) {
  if (stepStatus === 'completed' || stepIndex < currentIndex) return 'done';
  if (stepIndex === currentIndex) return 'active';
  if (stepIndex === currentIndex + 1) return 'next';
  return 'future';
}

function runStartDateIso(run) {
  if (run.startedAt) return String(run.startedAt).slice(0, 10);
  return run.date || '';
}

function formatRunTimestamp(iso, fallbackDate) {
  if (!iso) return fallbackDate ? formatDate(fallbackDate) : '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatDate(String(iso).slice(0, 10));
  const date = d.toLocaleDateString('he-IL');
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

function runDatesLabel(run) {
  const start = formatRunTimestamp(run.startedAt, run.date);
  if (run.status === 'completed' && run.completedAt) {
    return `${start} → ${formatRunTimestamp(run.completedAt)}`;
  }
  return `התחיל ${start}`;
}

function batchPrefix(batchNumber) {
  return batchNumber ? `אצווה ${escapeHtml(batchNumber)} · ` : '';
}

function stepPortionLabel(step) {
  if (!step.tracksPortions) return '';
  const total = getStepPortionTotal(step);
  if (total == null) return '';
  const batches = getStepPortionBatches(step);
  if (batches.some((b) => b.name)) {
    const names = [...new Set(batches.filter((b) => b.name).map((b) => b.name))];
    return `${formatPortionCount(total)} מנות · ${names.join(', ')}`;
  }
  if (step.portionSize == null) return `${formatPortionCount(total)} מנות`;
  const unit = step.portionUnit === 'weight' ? 'ק"ג' : "יח'";
  const size = step.portionUnit === 'weight' ? formatDecimal(step.portionSize) : step.portionSize;
  return `${formatPortionCount(total)} מנות × ${size} ${unit}`;
}

function portionPresetOptionLabel(p) {
  const extra = p.extra ? ` · ${p.extra}` : '';
  return `${p.name} (${p.weight} ק"ג${extra})`;
}

function stepPortionBatchesHTML(step, stepIndex, { canAdd = false, canEdit = false, presets = [] } = {}) {
  if (!step.tracksPortions) return '';
  const batches = getStepPortionBatches(step);
  const total = getStepPortionTotal(step);
  const hasPresets = presets.length > 0;
  const editable = canEdit || canAdd;

  return `
    <div class="flow-portion-batches" data-step-batches="${stepIndex}">
      ${batches.length ? `
        <ul class="flow-portion-batch-list">
          ${batches.map((b, batchIndex) => `
            <li class="flow-portion-batch-item" data-batch-index="${batchIndex}">
              ${!editable ? `<span class="flow-portion-batch-date">${formatDate(b.date)}</span>` : ''}
              ${b.name ? `
                <span class="flow-portion-batch-name">${escapeHtml(b.name)}</span>
                ${b.weight != null ? `<span class="flow-portion-batch-weight">${b.weight} ק"ג</span>` : ''}
                ${b.extra ? `<span class="flow-portion-batch-extra">${escapeHtml(b.extra)}</span>` : ''}
              ` : ''}
              ${editable ? `
                <label class="flow-portion-batch-count-edit">
                  × <input type="number" class="flow-portion-batch-count-input" min="0.1" step="0.1" inputmode="decimal"
                    value="${b.count}" data-step="${stepIndex}" data-batch="${batchIndex}" aria-label="מספר מנות">
                </label>
                <label class="flow-portion-batch-date-edit">
                  <input type="date" class="flow-portion-batch-date-input" value="${b.date || ''}"
                    data-step="${stepIndex}" data-batch="${batchIndex}" aria-label="תאריך">
                </label>
                <button type="button" class="btn btn-danger btn-sm flow-portion-batch-del" data-step="${stepIndex}" data-batch="${batchIndex}" title="הסר">🗑</button>
              ` : `
                <span class="flow-portion-batch-count">× ${formatPortionCount(b.count)}</span>
              `}
              ${b.note ? `<span class="flow-portion-batch-note">${escapeHtml(b.note)}</span>` : ''}
            </li>`).join('')}
        </ul>
        ${total != null ? `<p class="flow-portion-batch-total">סה"כ: <strong>${formatPortionCount(total)}</strong> מנות</p>` : ''}
      ` : `<p class="form-hint" style="margin:0">${hasPresets ? 'טרם נרשמו מנות — בחר מנה מהרשימה' : 'טרם נרשמו מנות — לחץ + להוספה'}</p>`}
      ${canAdd ? `
        <button type="button" class="btn btn-secondary btn-sm flow-portion-add-toggle" data-step="${stepIndex}">
          + הוסף מנות
        </button>
        <div class="flow-portion-add-form hidden" data-step-add-form="${stepIndex}">
          ${hasPresets ? `
            <div class="form-group" style="margin:8px 0 6px">
              <label>בחר מנה</label>
              <select class="flow-portion-add-preset">
                <option value="">בחר מנה...</option>
                ${presets.map((p) => `<option value="${p.id}">${escapeHtml(portionPresetOptionLabel(p))}</option>`).join('')}
              </select>
            </div>` : ''}
          <div class="form-group" style="margin:8px 0 6px">
            <label>כמה מנות השתמשת?</label>
            <input type="number" class="flow-portion-add-count" min="0.1" step="0.1" inputmode="decimal" placeholder="5 או 0.3">
            <p class="form-hint" style="margin-top:4px">אפשר מ-0.1 — לתוספות קטנות שלא מנצלות מנה שלמה</p>
          </div>
          <div class="form-group" style="margin-bottom:8px">
            <label>תאריך</label>
            <input type="date" class="flow-portion-add-date" value="${todayISO()}">
          </div>
          <button type="button" class="btn btn-primary btn-sm flow-portion-add-save" data-step="${stepIndex}" style="width:100%">
            שמור מנות
          </button>
        </div>` : ''}
    </div>`;
}

function flowStepPortionSummary(step) {
  if (!step.tracksPortions) return '';
  if (step.portionSize == null) return ' <span class="flow-step-portion-badge">🍽 מנות</span>';
  const unit = step.portionUnit === 'weight' ? 'ק"ג' : "יח'";
  const size = step.portionUnit === 'weight' ? Number(step.portionSize) : step.portionSize;
  return ` <span class="flow-step-portion-badge">🍽 ${size} ${unit}/מנה</span>`;
}

function flowStepPortionConfigHTML(step, idPrefix) {
  const tracks = !!step?.tracksPortions;
  return `
    <label class="group-category-option flow-portion-toggle" style="margin-top:8px">
      <input type="checkbox" id="${idPrefix}-portions" ${tracks ? 'checked' : ''}>
      <span>תיעוד מנות בשלב זה</span>
    </label>
    <p class="form-hint" style="margin-top:4px">הגדר את רשימת המנות למטה — ביצור בוחרים מנה ומזינים כמה מנות</p>`;
}

function bindFlowStepPortionConfig(_idPrefix) {
  /* checkbox only */
}

function readFlowStepPortionConfig(idPrefix) {
  return { tracksPortions: !!document.getElementById(`${idPrefix}-portions`)?.checked };
}

function stepPortionFieldsHTML(step, stepIndex, presets = []) {
  if (!step.tracksPortions) return '';
  if (presets.length) {
    return `<p class="form-hint" style="margin-bottom:8px">בחר מנה מהרשימה למטה (+ הוסף מנות)</p>`;
  }
  const unit = step.portionUnit === 'weight' ? 'weight' : 'units';
  const missingDef = step.portionSize == null;
  const sizeLabel = !missingDef
    ? (unit === 'weight' ? `${Number(step.portionSize)} ק"ג` : `${step.portionSize} יח'`)
    : '';
  return `
      <fieldset class="flow-portion-fieldset flow-step-portion-fieldset">
        <legend>מנות בשלב זה (אופציונלי)</legend>
        ${missingDef
    ? '<p class="form-hint" style="color:var(--warning);margin-bottom:8px">⚠️ הגדר מנות ב«נהל תזרים» → רשימת מנות מוכנות</p>'
    : `<p class="form-hint" style="margin-bottom:8px">מנה מוגדרת: <strong>${escapeHtml(sizeLabel)}</strong></p>`}
        <div class="form-group">
          <label for="step-${stepIndex}-portion-count">כמה מנות יצרת (הוספה)</label>
          <input type="number" id="step-${stepIndex}-portion-count" min="0.1" step="0.1" value="" placeholder="אופציונלי — 5 או 0.3">
        </div>
      </fieldset>`;
}


function readStepInlineFields(stepIndex) {
  return {
    notes: document.getElementById(`step-${stepIndex}-notes`)?.value ?? '',
    issues: document.getElementById(`step-${stepIndex}-issues`)?.value ?? '',
    improvements: document.getElementById(`step-${stepIndex}-improvements`)?.value ?? '',
    portionCount: document.getElementById(`step-${stepIndex}-portion-count`)?.value,
    startedDate: document.getElementById(`step-${stepIndex}-started-date`)?.value,
    startedTime: document.getElementById(`step-${stepIndex}-started-time`)?.value,
    completedDate: document.getElementById(`step-${stepIndex}-completed-date`)?.value,
    completedTime: document.getElementById(`step-${stepIndex}-completed-time`)?.value,
  };
}

function stepTimingFieldsHTML(step, stepIndex, { editable = true, defaultStartNow = false, defaultEndNow = false } = {}) {
  let startDate = isoToDateInput(step.startedAt);
  let startTime = isoToTimeInput(step.startedAt);
  let endDate = isoToDateInput(step.completedAt);
  let endTime = isoToTimeInput(step.completedAt);
  if (editable && defaultStartNow && !startDate) {
    startDate = todayISO();
    startTime = isoToTimeInput(new Date().toISOString());
  }
  if (editable && defaultEndNow && !endDate) {
    endDate = todayISO();
    endTime = isoToTimeInput(new Date().toISOString());
  }
  const durMs = stepDurationMs(step, null, null);
  const durLabel = durMs != null ? formatDuration(durMs) : '';
  if (!editable) {
    const startLabel = step.startedAt ? formatDateTime(step.startedAt) : '—';
    const endLabel = step.completedAt ? formatDateTime(step.completedAt) : '—';
    return `
      <div class="flow-step-timing flow-step-timing--readonly">
        <div class="flow-step-timing-line"><span class="flow-step-timing-label">התחלה</span> ${escapeHtml(startLabel)}</div>
        <div class="flow-step-timing-line"><span class="flow-step-timing-label">סיום</span> ${escapeHtml(endLabel)}</div>
        ${durLabel ? `<div class="flow-step-timing-line flow-step-timing-duration">⏱ ${escapeHtml(durLabel)}</div>` : ''}
      </div>`;
  }
  return `
    <div class="flow-step-timing" data-step-timing="${stepIndex}">
      <div class="flow-step-timing-block">
        <div class="flow-step-timing-heading">
          <span>התחלה</span>
          <button type="button" class="btn btn-secondary btn-sm flow-step-time-now" data-step="${stepIndex}" data-kind="start">עכשיו</button>
        </div>
        <div class="flow-step-datetime-row">
          <input type="date" id="step-${stepIndex}-started-date" value="${startDate}" aria-label="תאריך התחלה">
          <input type="time" id="step-${stepIndex}-started-time" value="${startTime}" aria-label="שעת התחלה">
        </div>
      </div>
      <div class="flow-step-timing-block">
        <div class="flow-step-timing-heading">
          <span>סיום</span>
          <button type="button" class="btn btn-secondary btn-sm flow-step-time-now" data-step="${stepIndex}" data-kind="end">עכשיו</button>
        </div>
        <div class="flow-step-datetime-row">
          <input type="date" id="step-${stepIndex}-completed-date" value="${endDate}" aria-label="תאריך סיום">
          <input type="time" id="step-${stepIndex}-completed-time" value="${endTime}" aria-label="שעת סיום">
        </div>
      </div>
      ${durLabel ? `<p class="flow-step-timing-duration-live">⏱ משך: ${escapeHtml(durLabel)}</p>` : ''}
    </div>`;
}

function stepDatetimeFieldsHTML(step, stepIndex, { defaultNow = false } = {}) {
  return stepTimingFieldsHTML(step, stepIndex, { editable: true, defaultStartNow: defaultNow, defaultEndNow: defaultNow });
}

function stepNotesPanelHTML(step, stepIndex, { hidden = true } = {}) {
  return `
    <div class="flow-step-notes-panel${hidden ? ' hidden' : ''}" data-step-notes="${stepIndex}">
      <div class="form-group">
        <label for="step-${stepIndex}-notes">הערות</label>
        <textarea id="step-${stepIndex}-notes" rows="2" placeholder="הערות כלליות">${escapeHtml(step.notes || '')}</textarea>
      </div>
      <div class="form-group">
        <label for="step-${stepIndex}-issues">תקלות</label>
        <textarea id="step-${stepIndex}-issues" rows="2" placeholder="תקלות שזוהו">${escapeHtml(step.issues || '')}</textarea>
      </div>
      <div class="form-group">
        <label for="step-${stepIndex}-improvements">נקודות לשיפור</label>
        <textarea id="step-${stepIndex}-improvements" rows="2" placeholder="מה אפשר לשפר">${escapeHtml(step.improvements || '')}</textarea>
      </div>
      <button type="button" class="btn btn-secondary btn-sm flow-step-notes-save-btn" data-step="${stepIndex}">שמור</button>
    </div>`;
}

function stepInlineEditHTML(step, stepIndex, { expanded = false } = {}) {
  return stepNotesPanelHTML(step, stepIndex, { hidden: !expanded });
}

function resolveRunCategoryIds(run) {
  if (run.categoryIds?.length) return run.categoryIds.map(Number).filter(Boolean);
  if (run.categoryId) return [Number(run.categoryId)];
  return [];
}

function filterCategoriesForRun(run, categories) {
  const catIds = resolveRunCategoryIds(run);
  if (catIds.length) {
    const set = new Set(catIds);
    return categories.filter((c) => set.has(c.id));
  }
  if (run.categoryGroupId) {
    return categories.filter((c) => Number(c.groupId) === Number(run.categoryGroupId));
  }
  return categories;
}

function filterProductsForRun(run, products, categories) {
  const scopedCats = filterCategoriesForRun(run, categories);
  const catSet = new Set(scopedCats.map((c) => c.id));
  let list = products.filter((p) => catSet.has(p.categoryId));
  if (run.productId) list = list.filter((p) => p.id === run.productId);
  return list;
}

function runProdCategoryKey(stepIndex) {
  return `runProdCat_${stepIndex}`;
}

async function confirmDeleteRun(container, run) {
  if (!confirm('למחוק את התהליך? כל רישומי הייצור שתועדו בו יימחקו — פעולה זו לא ניתנת לביטול.')) return;
  try {
    await deleteProductionRun(run.id);
    requestAutoBackupNow().catch(() => {});
    showToast('התהליך ורישומי הייצור נמחקו');
    container.dataset.view = 'list';
    delete container.dataset.runId;
    delete container.dataset.runEditAll;
    renderProcess(container);
  } catch (err) {
    showToast(err.message || 'שגיאה');
  }
}

function flowStepProductionSummary(step) {
  if (!step.tracksProduction) return '';
  const count = step.productionEntryIds?.length || 0;
  if (!count) return ' <span class="flow-step-production-badge">📦 ייצור</span>';
  return ` <span class="flow-step-production-badge">📦 ${count} רישומים</span>`;
}

function mergeRunListProducts(scopedProducts, runEntries, productMap) {
  const seen = new Set();
  const merged = [];
  for (const p of scopedProducts) {
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      merged.push(p);
    }
  }
  for (const e of runEntries) {
    const p = productMap.get(e.productId);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      merged.push(p);
    }
  }
  return merged;
}

function stepProductionPanelHTML({
  stepIndex,
  prodDate,
  selectedCategory,
  selectedFormProduct,
  listProductFilter,
  scopedCategories,
  scopedProducts,
  runEntries,
  catMap,
  productMap,
  canAdd,
  canManageEntries,
}) {
  const listProducts = mergeRunListProducts(scopedProducts, runEntries, productMap);
  const multiProducts = listProducts.length > 1;
  const singleProduct = listProducts.length === 1 ? listProducts[0] : (scopedProducts.length === 1 ? scopedProducts[0] : null);
  const filteredProducts = selectedCategory
    ? listProducts.filter((p) => String(p.categoryId) === selectedCategory)
    : listProducts;
  const formProducts = multiProducts ? filteredProducts : (singleProduct ? [singleProduct] : []);
  const productOptions = formProducts
    .map((p) => `<option value="${p.id}" ${String(p.id) === String(selectedFormProduct || '') ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('');

  let entries = [...runEntries];
  if (listProductFilter) {
    entries = entries.filter((e) => String(e.productId) === listProductFilter);
  }

  const formProduct = multiProducts
    ? productMap.get(Number(selectedFormProduct || formProducts[0]?.id))
    : singleProduct;
  const qtyIsKg = productRecordUsesKg(formProduct);

  const listFilterHTML = multiProducts ? `
    <div class="form-group" style="margin-bottom:8px">
      <label for="step-${stepIndex}-prod-filter">סינון רשימה לפי מוצר</label>
      <select id="step-${stepIndex}-prod-filter" class="flow-prod-list-filter" data-step="${stepIndex}">
        <option value="">הכל (${runEntries.length})</option>
        ${listProducts.map((p) => `<option value="${p.id}" ${String(p.id) === listProductFilter ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>
    </div>` : '';

  return `
    <div class="flow-production-panel" data-step-production="${stepIndex}">
      <div class="flow-production-panel-header">
        <span class="flow-production-panel-title">📦 תיעוד ייצור</span>
        <span class="flow-production-panel-hint">כל הרישומים בתהליך — כולל תאריכים שונים</span>
      </div>
      ${canAdd ? `
        <form class="flow-production-form" data-step="${stepIndex}">
          <div class="form-group">
            <label for="step-${stepIndex}-prod-date">תאריך</label>
            <input type="date" id="step-${stepIndex}-prod-date" class="flow-prod-date" value="${prodDate}" required>
          </div>
          ${multiProducts ? `
            ${scopedCategories.length > 1 ? `
            <div class="form-group">
              <label for="step-${stepIndex}-prod-category">קטגוריה</label>
              <select id="step-${stepIndex}-prod-category" class="flow-prod-category" ${scopedCategories.length === 0 ? 'disabled' : ''}>
                <option value="">כל הקטגוריות</option>
                ${scopedCategories.map((c) => `<option value="${c.id}" ${String(c.id) === selectedCategory ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
              </select>
            </div>` : ''}
            <div class="form-group">
              <label for="step-${stepIndex}-prod-product">מוצר</label>
              <select id="step-${stepIndex}-prod-product" class="flow-prod-product" required ${formProducts.length === 0 ? 'disabled' : ''}>
                <option value="">${formProducts.length ? 'בחר מוצר...' : 'אין מוצרים'}</option>
                ${productOptions}
              </select>
            </div>` : (singleProduct ? `
            <input type="hidden" id="step-${stepIndex}-prod-product" class="flow-prod-product" value="${singleProduct.id}">
            <p class="form-hint" style="margin-bottom:8px">מוצר: <strong>${escapeHtml(singleProduct.name)}</strong></p>` : `
            <p class="form-hint" style="margin-bottom:8px">אין מוצרים זמינים לתיעוד — הגדר מוצרים ב«מוצרים»</p>`)}
          <div class="form-group">
            <label for="step-${stepIndex}-prod-qty" class="flow-prod-qty-label">${qtyIsKg ? 'משקל (ק"ג)' : "כמות (יח')"}</label>
            <input type="number" id="step-${stepIndex}-prod-qty" class="flow-prod-qty" min="${qtyIsKg ? '0.001' : '1'}" step="${qtyIsKg ? '0.001' : '1'}" placeholder="${qtyIsKg ? '2.5' : '50'}" required>
          </div>
          <button type="submit" class="btn btn-primary btn-sm flow-prod-submit" style="width:100%">+ הוסף רישום ייצור</button>
        </form>` : ''}
      <div class="flow-production-entries">
        <div class="flow-production-entries-title">כל הרישומים בתהליך (${entries.length})</div>
        ${listFilterHTML}
        ${entries.length === 0
    ? '<p class="form-hint" style="margin:8px 0 0">אין רישומים עדיין</p>'
    : entries.map((e) => {
      const p = productMap.get(e.productId);
      return `<div class="list-item flow-production-entry" data-entry-id="${e.id}">
        <div class="list-item-info">
          <div class="list-item-name">${escapeHtml(p?.name || '—')}</div>
          <div class="list-item-meta">${formatDate(e.date)} · ${escapeHtml(catMap.get(p?.categoryId) || '')}</div>
        </div>
        <div class="list-item-actions">
          <strong>${formatProductQuantity(p, e.quantity)}</strong>
          ${canManageEntries ? `
            <button type="button" class="btn btn-secondary btn-sm btn-icon flow-prod-edit" data-step="${stepIndex}" data-id="${e.id}" title="ערוך">✏️</button>
            <button type="button" class="btn btn-danger btn-sm btn-icon flow-prod-del" data-step="${stepIndex}" data-id="${e.id}" title="מחק">🗑</button>` : ''}
        </div>
      </div>`;
    }).join('')}
      </div>
    </div>`;
}

function renderTimelineStep(step, stepIndex, currentIndex, totalSteps, portionPresets, runStatus, editAllMode, run, productionCtx, productionStepIdx) {
  const visual = stepVisualState(stepIndex, currentIndex, totalSteps, step.status);
  const hasNotes = step.notes || step.issues || step.improvements;
  const portionText = stepPortionLabel(step);
  const prevStep = stepIndex > 0 ? run.steps[stepIndex - 1] : null;
  const stepDurMs = stepDurationMs(step, prevStep?.completedAt, run.startedAt);
  const stepDurationLabel = stepDurMs != null ? formatDuration(stepDurMs) : '';
  const stepStartedLabel = step.startedAt ? formatDateTime(step.startedAt) : '';
  const stepCompletedLabel = step.completedAt ? formatDateTime(step.completedAt) : '';
  const isActive = visual === 'active';
  const isDone = visual === 'done';
  const stepUnlocked = stepIndex <= currentIndex || step.status === 'completed' || step.status === 'active';
  const runActive = run?.status === 'active';
  const useTopProductionPanel = productionStepIdx >= 0 && productionCtx;
  const canEditCompleted = runActive && isDone;
  const canEditFields = stepUnlocked && (isActive || editAllMode || canEditCompleted || run?.status === 'completed');
  const portionEditable = step.tracksPortions && stepUnlocked && (isActive || isDone || editAllMode);
  const showTimingFields = canEditFields;
  const defaultStartNow = isActive && !step.startedAt;
  const defaultEndNow = isActive && !step.completedAt;

  let prodPanel = '';
  if (step.tracksProduction && productionCtx) {
    if (useTopProductionPanel && stepIndex === productionStepIdx) {
      prodPanel = '<p class="flow-production-inline-hint"><a href="#flow-production-anchor">↑ טופס תיעוד ייצור — למעלה</a></p>';
    } else if (!useTopProductionPanel) {
      prodPanel = stepProductionPanelHTML({
        stepIndex,
        prodDate: productionCtx.prodDate,
        selectedCategory: productionCtx.selectedCategories[stepIndex] || '',
        selectedFormProduct: productionCtx.selectedFormProducts[stepIndex] || '',
        listProductFilter: productionCtx.listProductFilter,
        scopedCategories: productionCtx.scopedCategories,
        scopedProducts: productionCtx.scopedProducts,
        runEntries: productionCtx.runEntries,
        catMap: productionCtx.catMap,
        productMap: productionCtx.productMap,
        canAdd: runActive,
        canManageEntries: true,
      });
    }
  }

  return `
    <div class="flow-step flow-step--compact flow-step--${visual}${step.tracksProduction ? ' flow-step--production' : ''}" data-step-index="${stepIndex}">
      <div class="flow-step-marker" aria-hidden="true"></div>
      <div class="flow-step-body">
        <div class="flow-step-header">
          <span class="flow-step-num">${stepIndex + 1}</span>
          <span class="flow-step-name">${escapeHtml(step.stepName)}</span>
          ${!showTimingFields && stepStartedLabel ? `<span class="flow-step-datetime">${escapeHtml(stepStartedLabel)}</span>` : ''}
          ${!showTimingFields && !stepStartedLabel && stepCompletedLabel ? `<span class="flow-step-datetime">${escapeHtml(stepCompletedLabel)}</span>` : ''}
          ${!showTimingFields && stepDurationLabel ? `<span class="flow-step-duration">⏱ ${stepDurationLabel}</span>` : ''}
          ${flowStepProductionSummary(step)}
          ${step.tracksPortions && !portionText ? '<span class="flow-step-portion-badge">🍽</span>' : ''}
          <div class="flow-step-header-actions">
            ${canEditFields ? `
              <button type="button" class="btn btn-secondary btn-sm btn-icon flow-step-notes-btn${hasNotes ? ' has-content' : ''}" data-step="${stepIndex}" title="הערות · תקלות · שיפור" aria-label="הערות תקלות ושיפור">📝</button>` : ''}
            ${isActive && !editAllMode ? `<button type="button" class="btn btn-primary btn-sm flow-step-complete-btn" data-step="${stepIndex}">✓</button>` : ''}
            ${isActive && editAllMode ? `<button type="button" class="btn btn-primary btn-sm flow-step-complete-btn" data-step="${stepIndex}">✓ השלם</button>` : ''}
          </div>
        </div>
        ${prodPanel}
        ${showTimingFields
    ? stepTimingFieldsHTML(step, stepIndex, { editable: true, defaultStartNow, defaultEndNow })
    : (stepUnlocked ? stepTimingFieldsHTML(step, stepIndex, { editable: false }) : '')}
        ${portionText && !isActive && !editAllMode ? `<p class="flow-step-portion-preview">🍽 ${escapeHtml(portionText)}</p>` : ''}
        ${step.tracksPortions && portionEditable
    ? stepPortionBatchesHTML(step, stepIndex, { canAdd: portionEditable, canEdit: portionEditable, presets: portionPresets }) : ''}
        ${canEditFields ? stepNotesPanelHTML(step, stepIndex, { hidden: true }) : ''}
        ${(canEditCompleted || (isDone && canEditFields)) ? `
        <div class="flow-step-actions">
          ${canEditCompleted ? `<button type="button" class="btn btn-secondary btn-sm flow-step-reopen-btn" data-step="${stepIndex}">↩ חזור</button>` : ''}
          ${isDone && canEditFields ? `<button type="button" class="btn btn-secondary btn-sm flow-step-save-btn" data-step="${stepIndex}">שמור</button>` : ''}
        </div>` : ''}
      </div>
    </div>`;
}

function renderRunCard(run, catMap, productMap, groupMap, { listDate } = {}) {
  const statusLabel = run.status === 'active' ? 'פעיל' : 'הושלם';
  const statusClass = run.status === 'active' ? 'flow-run-active' : 'flow-run-done';
  const dateHint = listDate && run.date !== listDate ? ` · ${formatDate(run.date)}` : '';
  return `
    <div class="list-item flow-run-item ${statusClass}" data-run-id="${run.id}">
      <div class="list-item-info">
        <div class="list-item-name">
          ${batchPrefix(run.batchNumber)}${runTitle(run, catMap, productMap, groupMap)}
        </div>
        <div class="list-item-meta">
          <span class="flow-status-badge flow-status-badge--${run.status}">${statusLabel}</span>
          ${run.status === 'active' ? ` · שלב ${run.currentStepIndex + 1}` : ''}${dateHint}
        </div>
      </div>
      <div class="list-item-actions">
        <button type="button" class="btn btn-primary btn-sm open-run" data-id="${run.id}" data-date="${run.date}">פתח</button>
        <button type="button" class="btn btn-danger btn-sm delete-run" data-id="${run.id}">🗑</button>
      </div>
    </div>`;
}

function resolveRunCatalogCategoryId(run, productMap, layout) {
  if (run.productId) {
    const p = productMap.get(run.productId);
    if (p?.categoryId) return p.categoryId;
  }
  const ids = run.categoryIds?.length
    ? run.categoryIds.map(Number).filter(Boolean)
    : (run.categoryId ? [Number(run.categoryId)] : []);
  if (ids.length) {
    const ordered = layout.allCategories
      .filter((c) => ids.includes(c.id))
      .sort(compareProductCategories);
    return ordered[0]?.id ?? ids[0];
  }
  return null;
}

function bucketRunsForCatalog(runs, layout, productMap) {
  const runsByCategory = new Map();
  const runsByGroup = new Map();
  const otherRuns = [];

  for (const run of runs) {
    if (run.scopeMode === 'group' && run.categoryGroupId) {
      const gid = Number(run.categoryGroupId);
      if (!runsByGroup.has(gid)) runsByGroup.set(gid, []);
      runsByGroup.get(gid).push(run);
      continue;
    }
    const cid = resolveRunCatalogCategoryId(run, productMap, layout);
    if (cid) {
      if (!runsByCategory.has(cid)) runsByCategory.set(cid, []);
      runsByCategory.get(cid).push(run);
    } else if (run.categoryGroupId) {
      const gid = Number(run.categoryGroupId);
      if (!runsByGroup.has(gid)) runsByGroup.set(gid, []);
      runsByGroup.get(gid).push(run);
    } else {
      otherRuns.push(run);
    }
  }

  return { runsByCategory, runsByGroup, otherRuns };
}

function renderRunsListGroupedHTML(runs, layout, catMap, productMap, groupMap, { listDate } = {}) {
  if (!runs.length) return '';
  const { runsByCategory, runsByGroup, otherRuns } = bucketRunsForCatalog(runs, layout, productMap);
  const blocks = [];

  for (const group of layout.groups) {
    for (const cat of group.categories.slice().sort(compareProductCategories)) {
      const catRuns = runsByCategory.get(cat.id) || [];
      if (!catRuns.length) continue;
      blocks.push(`
        <div class="flow-pick-category-block run-list-category-block">
          <div class="flow-pick-category-label">${escapeHtml(cat.name)}</div>
          ${catRuns.map((r) => renderRunCard(r, catMap, productMap, groupMap, { listDate })).join('')}
        </div>`);
    }
    const groupRuns = runsByGroup.get(group.id) || [];
    if (groupRuns.length) {
      blocks.push(`
        <div class="flow-pick-category-block run-list-category-block">
          <div class="flow-pick-category-label">${escapeHtml(group.name)} · כל הקבוצה</div>
          ${groupRuns.map((r) => renderRunCard(r, catMap, productMap, groupMap, { listDate })).join('')}
        </div>`);
    }
  }

  if (otherRuns.length) {
    blocks.push(`
      <div class="flow-pick-category-block run-list-category-block">
        <div class="flow-pick-category-label">אחר</div>
        ${otherRuns.map((r) => renderRunCard(r, catMap, productMap, groupMap, { listDate })).join('')}
      </div>`);
  }

  return blocks.length
    ? `<div class="run-list-grouped">${blocks.join('')}</div>`
    : runs.map((r) => renderRunCard(r, catMap, productMap, groupMap, { listDate })).join('');
}

function groupRunsByDate(runs) {
  const groups = [];
  const indexByDate = new Map();
  for (const run of runs) {
    const date = run.date || runStartDateIso(run) || '';
    if (!indexByDate.has(date)) {
      const group = { date, runs: [] };
      indexByDate.set(date, groups.length);
      groups.push(group);
    }
    groups[indexByDate.get(date)].runs.push(run);
  }
  return groups;
}

function renderAllRunsByDateHTML(runs, layout, catMap, productMap, groupMap) {
  if (!runs.length) {
    return '<p class="form-hint" style="text-align:center;padding:12px">עדיין לא התחלת תהליכי יצור</p>';
  }
  const groups = groupRunsByDate(runs);
  return groups.map(({ date, runs: dayRuns }) => `
    <div class="flow-runs-date-group">
      <div class="flow-runs-date-label">${formatDate(date)}</div>
      ${dayRuns.map((r) => renderRunCard(r, catMap, productMap, groupMap)).join('')}
    </div>`).join('');
}

function formatRunEntriesSummary(entries, productMap) {
  if (!entries?.length) return '';
  const byProduct = new Map();
  for (const e of entries) {
    const pid = e.productId;
    byProduct.set(pid, (byProduct.get(pid) || 0) + (Number(e.quantity) || 0));
  }
  return [...byProduct.entries()]
    .map(([pid, qty]) => {
      const p = productMap.get(pid);
      const name = p?.name || `#${pid}`;
      const qtyText = p ? formatProductQuantity(p, qty) : formatDecimal(qty);
      return `${escapeHtml(name)} · ${qtyText}`;
    })
    .join(' · ');
}

async function renderFlowHistoryView(container, ctx) {
  const flowId = Number(container.dataset.flowHistoryId);
  const backView = container.dataset.flowHistoryBack || 'list';

  if (!flowId) {
    container.dataset.view = backView;
    delete container.dataset.flowHistoryId;
    delete container.dataset.flowHistoryBack;
    return renderProcess(container);
  }

  const { catMap, productMap, groupMap } = ctx;
  const allFlows = await getAllFlowsOverview();
  const flowMeta = allFlows.find((f) => f.id === flowId);
  const flow = await getFlow(flowId);

  if (!flow) {
    showToast('תזרים לא נמצא');
    container.dataset.view = backView;
    delete container.dataset.flowHistoryId;
    return renderProcess(container);
  }

  const [runs, productsHistory] = await Promise.all([
    getProductionRunsForFlow(flowId),
    getFlowProductsHistory(flowId),
  ]);

  const runsWithEntries = await Promise.all(runs.map(async (run) => ({
    run,
    entries: await getRunProductionEntries(run.id),
  })));

  const productRows = productsHistory
    .map((row) => ({ ...row, product: productMap.get(row.productId) }))
    .sort((a, b) => (a.product?.name || '').localeCompare(b.product?.name || '', 'he'));

  const flowName = flowMeta?.name || flow.name || 'תזרים';
  const targetLabel = flowMeta?.targetLabel || '';

  container.innerHTML = `
    <div class="card">
      <button type="button" class="btn btn-secondary btn-sm" id="back-from-flow-history">← חזרה</button>
      <h2 style="font-size:1rem;margin:12px 0 4px">היסטוריה · ${escapeHtml(flowName)}</h2>
      ${targetLabel ? `<p class="form-hint" style="margin-bottom:0">${escapeHtml(targetLabel)}</p>` : ''}
    </div>

    <div class="card">
      <div class="card-title">מוצרים שיוצרו (${productRows.length})</div>
      ${productRows.length === 0
    ? '<p class="form-hint" style="text-align:center;padding:12px">עדיין לא תועד ייצור בתזרים זה</p>'
    : `<div class="report-table-wrap">
          <table class="report-table">
            <thead><tr>
              <th>מוצר</th><th>סה"כ</th><th>תהליכים</th><th>אחרון</th>
            </tr></thead>
            <tbody>
              ${productRows.map((row) => {
    const p = row.product;
    const qtyText = p ? formatProductQuantity(p, row.totalQty) : formatDecimal(row.totalQty);
    return `<tr>
                  <td class="report-cell-text">${escapeHtml(p?.name || `#${row.productId}`)}</td>
                  <td class="report-cell-num"><strong>${qtyText}</strong></td>
                  <td class="report-cell-num">${row.runCount}</td>
                  <td class="report-cell-text">${row.lastDate ? formatDate(row.lastDate) : '—'}</td>
                </tr>`;
  }).join('')}
            </tbody>
          </table>
        </div>`}
    </div>

    <div class="card">
      <div class="card-title">היסטוריית תהליכים (${runs.length})</div>
      ${runs.length === 0
    ? '<p class="form-hint" style="text-align:center;padding:12px">לא הופעל תהליך בתזרים זה</p>'
    : runsWithEntries.map(({ run, entries }) => {
      const statusLabel = run.status === 'active' ? 'פעיל' : 'הושלם';
      const duration = runDurationMs(run);
      const productsLine = formatRunEntriesSummary(entries, productMap);
      return `
          <div class="list-item flow-history-run-item ${run.status === 'active' ? 'flow-run-active' : 'flow-run-done'}">
            <div class="list-item-info">
              <div class="list-item-name">
                ${batchPrefix(run.batchNumber)}${runTitle(run, catMap, productMap, groupMap)}
              </div>
              <div class="list-item-meta">
                <span class="flow-status-badge flow-status-badge--${run.status}">${statusLabel}</span>
                · ${runDatesLabel(run)}
                ${duration != null ? ` · ${formatDuration(duration)}` : ''}
              </div>
              ${entries.length ? `<div class="flow-history-run-products form-hint">📦 ${productsLine}</div>` : ''}
            </div>
            <div class="list-item-actions">
              <button type="button" class="btn btn-primary btn-sm open-run" data-id="${run.id}" data-date="${run.date}">פתח</button>
            </div>
          </div>`;
    }).join('')}
    </div>`;

  document.getElementById('back-from-flow-history')?.addEventListener('click', () => {
    container.dataset.view = backView;
    delete container.dataset.flowHistoryId;
    delete container.dataset.flowHistoryBack;
    renderProcess(container);
  });

  container.querySelectorAll('.open-run').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.date) container.dataset.selectedDate = btn.dataset.date;
      container.dataset.view = 'run';
      container.dataset.runId = btn.dataset.id;
      renderProcess(container);
    });
  });
}

function flowPreparationsPopoverHTML({ checks, flowLabel, canManageList }) {
  if (!flowLabel) {
    return `
      <div class="flow-prep-popover-inner">
        <p class="form-hint" style="margin:0">אין תזרים משויך — אין רשימת הכנות</p>
      </div>`;
  }

  const checkedCount = checks.filter((c) => c.checked).length;
  const total = checks.length;

  return `
    <div class="flow-prep-popover-inner">
      <div class="flow-prep-popover-title">🧁 הכנות — ${escapeHtml(flowLabel)}</div>
      ${total === 0
    ? `<p class="form-hint" style="margin-bottom:10px">אין הכנות בתזרים זה. הגדר ב«נהל תזרים» או הוסף למטה.</p>`
    : `<ul class="flow-prep-checklist">
          ${checks.map((c) => `
            <li class="flow-prep-item${c.checked ? ' is-checked' : ''}">
              <label class="flow-prep-label">
                <input type="checkbox" class="flow-prep-check" data-check-id="${c.id}" ${c.checked ? 'checked' : ''}>
                <span class="flow-prep-checkmark">${c.checked ? '✓' : ''}</span>
                <span class="flow-prep-name">${escapeHtml(c.name)}</span>
              </label>
            </li>`).join('')}
        </ul>`}
      ${canManageList ? `
        <div class="flow-prep-add-row filter-row" style="margin-top:12px">
          <input type="text" class="flow-prep-add-input" id="flow-prep-add-input" placeholder="הכנה חדשה (למשל: הכנת בצק)">
          <button type="button" class="btn btn-secondary btn-sm" id="flow-prep-add-btn">+ הוסף לתזרים</button>
        </div>` : ''}
    </div>`;
}

function flowPreparationsCompactButtonHTML({ checks, flowLabel }) {
  if (!flowLabel) return '';
  const checkedCount = checks.filter((c) => c.checked).length;
  const total = checks.length;
  const label = total ? `🧁 הכנות ${checkedCount}/${total}` : '🧁 הכנות';
  return `
    <div class="flow-prep-compact-wrap">
      <button type="button" class="btn btn-secondary btn-sm flow-prep-toggle" id="flow-prep-toggle" aria-expanded="false">
        ${label}
      </button>
      <div class="flow-prep-popover hidden" id="flow-prep-popover"></div>
    </div>`;
}

async function renderRunView(container, runId, ctx) {
  try {
    await syncProductionRunWithFlow(runId);
  } catch {
    /* continue with current snapshot */
  }

  const run = await getProductionRun(runId);
  if (!run) {
    container.dataset.view = 'list';
    return renderProcess(container);
  }

  const { catMap, productMap, groupMap } = ctx;

  let prepChecks = [];
  if (run.flowId) {
    try {
      prepChecks = await ensureRunPreparationChecks(run.id);
    } catch {
      prepChecks = [];
    }
  }
  const prepFlowLabel = run.flowName || (run.flowId ? 'תזרים' : null);

  const currentIndex = run.status === 'completed' ? run.steps.length : run.currentStepIndex;
  const portionPresets = run.flowId ? await getFlowPortionPresets(run.flowId) : [];
  const editAllMode = container.dataset.runEditAll === '1';
  let productionCtx = null;
  let runEntries = [];

  const [products, categories] = await Promise.all([getProducts(true), getCategories()]);
  runEntries = await getRunProductionEntries(runId);
  const productionStepIdx = resolveProductionStepIndex(run, runEntries);
  const hasProductionSteps = productionStepIdx >= 0;

  if (hasProductionSteps) {
    const scopedCategories = filterCategoriesForRun(run, categories);
    const scopedProducts = filterProductsForRun(run, products, categories);
    const selectedCategories = {};
    const selectedFormProducts = {};
    if (productionStepIdx >= 0) {
      const i = productionStepIdx;
      const key = runProdCategoryKey(i);
      let cat = container.dataset[key] || '';
      if (!cat && scopedCategories.length === 1) cat = String(scopedCategories[0].id);
      if (!cat && run.productId) {
        const p = productMap.get(run.productId);
        if (p) cat = String(p.categoryId);
      }
      selectedCategories[i] = cat;
      selectedFormProducts[i] = container.dataset[`runProdFormProduct_${i}`] || '';
    }
    productionCtx = {
      prodDate: container.dataset.runProdDate || todayISO(),
      selectedCategories,
      selectedFormProducts,
      listProductFilter: container.dataset.runProdFilter || '',
      scopedCategories,
      scopedProducts,
      runEntries,
      catMap,
      productMap,
    };
  }

  const showTopProduction = productionStepIdx >= 0 && productionCtx;
  const prepPopoverHTML = flowPreparationsPopoverHTML({
    checks: prepChecks,
    flowLabel: prepFlowLabel,
    canManageList: run.status === 'active' && !!run.flowId,
  });
  const prepButtonHTML = flowPreparationsCompactButtonHTML({
    checks: prepChecks,
    flowLabel: prepFlowLabel,
  });
  const topProductionHTML = showTopProduction
    ? stepProductionPanelHTML({
      stepIndex: productionStepIdx,
      prodDate: productionCtx.prodDate,
      selectedCategory: productionCtx.selectedCategories[productionStepIdx] || '',
      selectedFormProduct: productionCtx.selectedFormProducts[productionStepIdx] || '',
      listProductFilter: productionCtx.listProductFilter,
      scopedCategories: productionCtx.scopedCategories,
      scopedProducts: productionCtx.scopedProducts,
      runEntries: productionCtx.runEntries,
      catMap: productionCtx.catMap,
      productMap: productionCtx.productMap,
      canAdd: run.status === 'active',
      canManageEntries: true,
    })
    : '';

  const runDurMs = runDurationMs(run);
  const runDurationLabel = runDurMs != null
    ? `${formatDuration(runDurMs)}${run.status === 'active' ? ' (בתהליך)' : ''}`
    : '—';

  container.innerHTML = `
    <div class="card flow-run-header-card">
      <div class="flow-run-corner-tools">
        <button type="button" class="btn btn-secondary btn-sm btn-icon flow-run-tool-btn${editAllMode ? ' is-active' : ''}" id="toggle-edit-all" title="עריכת שלבים" aria-label="עריכת שלבים">✏️</button>
        <button type="button" class="btn btn-secondary btn-sm btn-icon flow-run-tool-btn" id="sync-run-flow" title="רענן תהליך" aria-label="רענן תהליך">🔄</button>
      </div>
      <button type="button" class="btn btn-secondary btn-sm flow-run-back-btn" id="back-to-list">← חזרה</button>
      <div class="flow-run-header-info">
        <h2 class="flow-run-title">${run.batchNumber ? `אצווה ${escapeHtml(run.batchNumber)}` : runTitle(run, catMap, productMap, groupMap)}</h2>
        <p class="flow-run-subtitle">${runTitle(run, catMap, productMap, groupMap)}</p>
      </div>
      <button type="button" class="flow-run-dates flow-run-dates--clickable" id="edit-run-details" aria-label="פרטי תהליך">
        <div class="flow-run-dates-row">
          <span class="flow-run-dates-label">התחלה</span>
          <span class="flow-run-dates-value">${formatRunTimestamp(run.startedAt, run.date)}</span>
        </div>
        <div class="flow-run-dates-row">
          <span class="flow-run-dates-label">סיום</span>
          <span class="flow-run-dates-value">${run.completedAt ? formatRunTimestamp(run.completedAt) : '—'}</span>
        </div>
        <div class="flow-run-dates-row">
          <span class="flow-run-dates-label">משך כולל</span>
          <span class="flow-run-dates-value flow-run-duration-value">⏱ ${runDurationLabel}</span>
        </div>
        <span class="flow-run-dates-hint">📋 פרטי תהליך</span>
      </button>
      <div class="flow-run-header-actions filter-row" style="margin-top:12px;flex-wrap:wrap">
        ${prepButtonHTML}
      </div>
      ${editAllMode ? '<p class="form-hint" style="margin-top:8px">מצב עריכה — כל השלבים שהגיעו אליהם פתוחים לעריכה</p>' : ''}
      <div class="flow-legend">
        <span class="flow-legend-item flow-legend-item--done">✓ בוצע</span>
        <span class="flow-legend-item flow-legend-item--active">● פעיל</span>
        <span class="flow-legend-item flow-legend-item--next">○ הבא</span>
        ${hasProductionSteps ? '<span class="flow-legend-item flow-legend-item--production">📦 ייצור</span>' : ''}
      </div>
    </div>

    ${showTopProduction ? `
    <div class="card flow-production-always-card" id="flow-production-anchor">
      <div class="flow-production-always-header">
        <span class="flow-production-always-title">📦 תיעוד ייצור${run.status === 'active' ? ' — זמין תמיד' : ''}</span>
        <span class="flow-production-always-hint">${run.status === 'active' ? 'אפשר לרשום ייצור בכל שלב בתהליך, גם לפני שמגיעים לשלב' : 'רשימת כל הרישומים בתהליך זה — ניתן לערוך ולמחוק'}</span>
      </div>
      ${topProductionHTML}
    </div>` : ''}

    <div class="flow-timeline${editAllMode ? ' flow-timeline--edit-all' : ''}">
      ${run.steps.map((step, i) => renderTimelineStep(step, i, currentIndex, run.steps.length, portionPresets, run.status, editAllMode, run, productionCtx, productionStepIdx)).join('')}
    </div>

    ${editAllMode ? `
      <div class="card">
        <button type="button" class="btn btn-primary" id="save-all-steps" style="width:100%">שמור את כל השינויים</button>
      </div>` : ''}

    ${run.status === 'completed'
      ? `<div class="card"><p class="flow-complete-msg">✓ התהליך הושלם${run.batchNumber ? ` · אצווה ${escapeHtml(run.batchNumber)}` : ''}</p></div>`
      : ''}

    <div class="card flow-run-delete-footer">
      <button type="button" class="btn btn-danger btn-sm" id="delete-run-footer" style="width:100%">🗑 מחק תהליך (כולל רישומי ייצור)</button>
    </div>`;

  const popoverEl = document.getElementById('flow-prep-popover');
  if (popoverEl) popoverEl.innerHTML = prepPopoverHTML;

  document.getElementById('flow-prep-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = document.getElementById('flow-prep-popover');
    const btn = document.getElementById('flow-prep-toggle');
    if (!pop || !btn) return;
    const isHidden = pop.classList.toggle('hidden');
    btn.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
    if (!isHidden) {
      const onDocClick = (ev) => {
        if (ev.target.closest('.flow-prep-compact-wrap')) return;
        pop.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onDocClick);
      };
      setTimeout(() => document.addEventListener('click', onDocClick), 0);
    }
  });
  document.getElementById('flow-prep-popover')?.addEventListener('click', (e) => e.stopPropagation());

  document.getElementById('toggle-edit-all')?.addEventListener('click', () => {
    container.dataset.runEditAll = editAllMode ? '' : '1';
    container.dataset.runId = String(run.id);
    container.dataset.view = 'run';
    renderProcess(container);
  });

  document.getElementById('edit-run-details')?.addEventListener('click', () => {
    openRunDetailsModal(container, run, ctx);
  });

  document.getElementById('sync-run-flow')?.addEventListener('click', async () => {
    try {
      const res = await syncProductionRunWithFlow(run.id);
      requestAutoBackupNow().catch(() => {});
      showToast(res.updated ? 'התזרים עודכן מההגדרות ✓' : 'כבר מעודכן');
      container.dataset.runId = String(run.id);
      container.dataset.view = 'run';
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('delete-run-footer')?.addEventListener('click', () => {
    confirmDeleteRun(container, run);
  });

  document.getElementById('save-all-steps')?.addEventListener('click', async () => {
    const reachableIndexes = run.steps
      .map((step, i) => ({ step, i }))
      .filter(({ step, i }) => {
        const visual = stepVisualState(i, currentIndex, run.steps.length, step.status);
        return visual === 'active' || visual === 'done';
      })
      .map(({ i }) => i);
    try {
      for (const stepIndex of reachableIndexes) {
        await updateRunStepFields(run.id, stepIndex, readStepInlineFields(stepIndex));
      }
      requestAutoBackupNow().catch(() => {});
      showToast('כל השינויים נשמרו ✓');
      container.dataset.runId = String(run.id);
      container.dataset.view = 'run';
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('back-to-list')?.addEventListener('click', () => {
    container.dataset.view = 'list';
    delete container.dataset.runId;
    renderProcess(container);
  });

  container.querySelectorAll('.flow-prep-check').forEach((input) => {
    input.addEventListener('change', async () => {
      const checkId = Number(input.dataset.checkId);
      try {
        await setRunPreparationChecked(checkId, input.checked);
        requestAutoBackupNow().catch(() => {});
        const item = input.closest('.flow-prep-item');
        const mark = item?.querySelector('.flow-prep-checkmark');
        if (item) item.classList.toggle('is-checked', input.checked);
        if (mark) mark.textContent = input.checked ? '✓' : '';
        const toggleBtn = document.getElementById('flow-prep-toggle');
        if (toggleBtn) {
          const all = container.querySelectorAll('.flow-prep-check');
          const done = [...all].filter((el) => el.checked).length;
          toggleBtn.textContent = all.length ? `🧁 הכנות ${done}/${all.length}` : '🧁 הכנות';
        }
      } catch (err) {
        input.checked = !input.checked;
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.getElementById('flow-prep-add-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('flow-prep-add-input');
    const name = input?.value?.trim();
    if (!name) return showToast('הזן שם הכנה');
    try {
      await addRunPreparationFromFlow(run.flowId, name, run.id);
      requestAutoBackupNow().catch(() => {});
      showToast('הכנה נוספה ✓');
      container.dataset.runId = String(run.id);
      container.dataset.view = 'run';
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('flow-prep-add-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('flow-prep-add-btn')?.click();
    }
  });

  container.querySelectorAll('.flow-step-complete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const stepIndex = Number(btn.dataset.step);
      try {
        await completeRunStep(run.id, stepIndex, readStepInlineFields(stepIndex));
        requestAutoBackupNow().catch(() => {});
        showToast('שלב הושלם ✓');
        container.dataset.runId = String(run.id);
        container.dataset.view = 'run';
        renderProcess(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.flow-step-reopen-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const stepIndex = Number(btn.dataset.step);
      if (!confirm('לחזור לשלב זה? השלבים שאחריו יסומנו כממתינים (הנתונים נשמרים).')) return;
      try {
        await reopenRunStep(run.id, stepIndex);
        requestAutoBackupNow().catch(() => {});
        showToast('חזרת לשלב ✓');
        container.dataset.runId = String(run.id);
        container.dataset.view = 'run';
        delete container.dataset.runEditAll;
        renderProcess(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.flow-step-notes-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stepIndex = Number(btn.dataset.step);
      const panel = container.querySelector(`[data-step-notes="${stepIndex}"]`);
      if (!panel) return;
      const opening = panel.classList.contains('hidden');
      panel.classList.toggle('hidden');
      btn.classList.toggle('is-open', opening);
      if (opening) panel.querySelector('textarea')?.focus();
    });
  });

  container.querySelectorAll('.flow-step-time-now').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stepIndex = Number(btn.dataset.step);
      const kind = btn.dataset.kind;
      const now = new Date();
      const dateVal = todayISO();
      const timeVal = isoToTimeInput(now.toISOString());
      if (kind === 'start') {
        const d = document.getElementById(`step-${stepIndex}-started-date`);
        const t = document.getElementById(`step-${stepIndex}-started-time`);
        if (d) d.value = dateVal;
        if (t) t.value = timeVal;
      } else {
        const d = document.getElementById(`step-${stepIndex}-completed-date`);
        const t = document.getElementById(`step-${stepIndex}-completed-time`);
        if (d) d.value = dateVal;
        if (t) t.value = timeVal;
      }
    });
  });

  container.querySelectorAll('.flow-step-edit-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stepIndex = Number(btn.dataset.step);
      const panel = container.querySelector(`[data-step-notes="${stepIndex}"]`);
      if (!panel) return;
      const opening = panel.classList.contains('hidden');
      panel.classList.toggle('hidden');
      btn.textContent = opening ? 'סגור' : '✏️ ערוך';
    });
  });

  async function saveStepInlineFields(stepIndex) {
    await updateRunStepFields(run.id, stepIndex, readStepInlineFields(stepIndex));
    requestAutoBackupNow().catch(() => {});
    showToast('נשמר ✓');
    container.dataset.runId = String(run.id);
    container.dataset.view = 'run';
    renderProcess(container);
  }

  container.querySelectorAll('.flow-step-save-btn, .flow-step-notes-save-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const stepIndex = Number(btn.dataset.step);
      try {
        await saveStepInlineFields(stepIndex);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.flow-portion-add-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stepIndex = btn.dataset.step;
      const form = container.querySelector(`[data-step-add-form="${stepIndex}"]`);
      if (!form) return;
      const opening = form.classList.contains('hidden');
      form.classList.toggle('hidden');
      btn.textContent = opening ? '− ביטול' : '+ הוסף מנות';
      if (opening) form.querySelector('.flow-portion-add-count')?.focus();
    });
  });

  container.querySelectorAll('.flow-portion-add-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const stepIndex = Number(btn.dataset.step);
      const wrap = container.querySelector(`[data-step-add-form="${stepIndex}"]`);
      const count = wrap?.querySelector('.flow-portion-add-count')?.value;
      const date = wrap?.querySelector('.flow-portion-add-date')?.value;
      const presetId = wrap?.querySelector('.flow-portion-add-preset')?.value || null;
      try {
        await addRunStepPortionBatch(run.id, stepIndex, { presetId, count, date });
        requestAutoBackupNow().catch(() => {});
        showToast('מנות נוספו ✓');
        container.dataset.runId = String(run.id);
        container.dataset.view = 'run';
        renderProcess(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.flow-portion-batch-count-input').forEach((input) => {
    const saveBatch = async () => {
      const stepIndex = Number(input.dataset.step);
      const batchIndex = Number(input.dataset.batch);
      try {
        await updateRunStepPortionBatch(run.id, stepIndex, batchIndex, { count: input.value });
        requestAutoBackupNow().catch(() => {});
        showToast('כמות עודכנה ✓');
        container.dataset.runId = String(run.id);
        container.dataset.view = 'run';
        renderProcess(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    };
    input.addEventListener('change', saveBatch);
  });

  container.querySelectorAll('.flow-portion-batch-date-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const stepIndex = Number(input.dataset.step);
      const batchIndex = Number(input.dataset.batch);
      try {
        await updateRunStepPortionBatch(run.id, stepIndex, batchIndex, { date: input.value });
        requestAutoBackupNow().catch(() => {});
        showToast('תאריך עודכן ✓');
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.flow-portion-batch-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const stepIndex = Number(btn.dataset.step);
      const batchIndex = Number(btn.dataset.batch);
      if (!confirm('להסיר רשומת מנות זו?')) return;
      try {
        await deleteRunStepPortionBatch(run.id, stepIndex, batchIndex);
        requestAutoBackupNow().catch(() => {});
        showToast('הוסר ✓');
        container.dataset.runId = String(run.id);
        container.dataset.view = 'run';
        renderProcess(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  bindRunProductionPanels(container, run, productionCtx);
}

function syncFlowProdQtyField(panel, productMap) {
  const productInput = panel.querySelector('.flow-prod-product');
  const qtyInput = panel.querySelector('.flow-prod-qty');
  const qtyLabel = panel.querySelector('.flow-prod-qty-label');
  if (!productInput || !qtyInput || !qtyLabel) return;
  const p = productMap.get(Number(productInput.value));
  const isKg = productRecordUsesKg(p);
  qtyLabel.textContent = isKg ? 'משקל (ק"ג)' : "כמות (יח')";
  qtyInput.min = isKg ? '0.001' : '1';
  qtyInput.step = isKg ? '0.001' : '1';
  qtyInput.placeholder = isKg ? '2.5' : '50';
}

function bindRunProductionPanels(container, run, productionCtx) {
  if (!productionCtx) return;
  const { productMap } = productionCtx;

  container.querySelectorAll('.flow-prod-date').forEach((input) => {
    input.addEventListener('change', (e) => {
      container.dataset.runProdDate = e.target.value;
      container.dataset.runId = String(run.id);
      container.dataset.view = 'run';
      renderProcess(container);
    });
  });

  container.querySelectorAll('.flow-prod-category').forEach((select) => {
    select.addEventListener('change', (e) => {
      const stepIndex = e.target.closest('[data-step-production]')?.dataset.stepProduction;
      if (stepIndex == null) return;
      container.dataset[runProdCategoryKey(stepIndex)] = e.target.value;
      delete container.dataset[`runProdFormProduct_${stepIndex}`];
      container.dataset.runId = String(run.id);
      container.dataset.view = 'run';
      renderProcess(container);
    });
  });

  container.querySelectorAll('.flow-prod-list-filter').forEach((select) => {
    select.addEventListener('change', (e) => {
      container.dataset.runProdFilter = e.target.value;
      container.dataset.runId = String(run.id);
      container.dataset.view = 'run';
      renderProcess(container);
    });
  });

  container.querySelectorAll('.flow-prod-product').forEach((select) => {
    if (select.tagName !== 'SELECT') return;
    select.addEventListener('change', () => {
      const stepIndex = select.closest('[data-step-production]')?.dataset.stepProduction;
      if (stepIndex != null) {
        container.dataset[`runProdFormProduct_${stepIndex}`] = select.value;
      }
      syncFlowProdQtyField(select.closest('.flow-production-panel'), productMap);
    });
    syncFlowProdQtyField(select.closest('.flow-production-panel'), productMap);
  });

  container.querySelectorAll('.flow-production-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const stepIndex = Number(form.dataset.step);
      const panel = form.closest('.flow-production-panel');
      const date = panel.querySelector('.flow-prod-date')?.value;
      const productId = panel.querySelector('.flow-prod-product')?.value;
      const quantity = panel.querySelector('.flow-prod-qty')?.value;
      if (!productId) return showToast('בחר קטגוריה ומוצר');
      try {
        await addRunStepProductionEntry(run.id, stepIndex, { date, productId, quantity });
        requestAutoBackupNow().catch(() => {});
        showToast('ייצור נרשם ✓');
        container.dataset.runProdDate = date;
        container.dataset.runId = String(run.id);
        container.dataset.view = 'run';
        const qtyInput = panel.querySelector('.flow-prod-qty');
        if (qtyInput) qtyInput.value = '';
        renderProcess(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.flow-prod-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const stepIndex = Number(btn.dataset.step);
      const entryId = Number(btn.dataset.id);
      if (!confirm('למחוק את הרישום?')) return;
      try {
        await removeRunStepProductionEntry(run.id, stepIndex, entryId);
        requestAutoBackupNow().catch(() => {});
        showToast('נמחק');
        container.dataset.runId = String(run.id);
        container.dataset.view = 'run';
        renderProcess(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.flow-prod-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entryId = Number(btn.dataset.id);
      const entry = productionCtx.runEntries.find((e) => e.id === entryId);
      if (!entry) return;
      const p = productMap.get(entry.productId);
      const isKg = productRecordUsesKg(p);
      openModal({
        title: 'עריכת רישום ייצור',
        bodyHTML: `
          <div class="form-group">
            <label>מוצר</label>
            <input type="text" value="${escapeHtml(p?.name || '')}" disabled>
          </div>
          <div class="form-group">
            <label for="flow-edit-qty">${isKg ? 'משקל (ק"ג)' : 'כמות (יח\')'}</label>
            <input type="number" id="flow-edit-qty" min="${isKg ? '0.001' : '1'}" step="${isKg ? '0.001' : '1'}" value="${formatDecimal(entry.quantity)}">
          </div>`,
        footerHTML: `
          <button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="flow-edit-save">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('flow-edit-save')?.addEventListener('click', async () => {
        try {
          await updateProductionEntry(entryId, { quantity: document.getElementById('flow-edit-qty').value });
          closeModal();
          showToast('עודכן ✓');
          container.dataset.runId = String(run.id);
          container.dataset.view = 'run';
          renderProcess(container);
        } catch (err) {
          showToast(err.message || 'שגיאה');
        }
      });
    });
  });
}

function openRunDetailsModal(container, run, ctx) {
  const startDate = runStartDateIso(run) || todayISO();
  const endDate = run.completedAt ? String(run.completedAt).slice(0, 10) : '';

  openModal({
    title: 'פרטי תהליך',
    bodyHTML: `
      <div class="form-group">
        <label for="run-batch-number">מספר אצווה</label>
        <input type="text" id="run-batch-number" value="${escapeHtml(run.batchNumber || '')}" placeholder="אופציונלי">
      </div>
      <div class="form-group">
        <label for="run-started-date">תאריך התחלה</label>
        <input type="date" id="run-started-date" value="${startDate}">
      </div>
      <div class="form-group">
        <label for="run-completed-date">תאריך סיום</label>
        <input type="date" id="run-completed-date" value="${endDate}"${run.status === 'completed' ? '' : ' disabled'}>
        ${run.status !== 'completed'
    ? '<p class="form-hint">יתמלא אוטומטית בסיום התהליך · ניתן לעריכה אחרי השלמת כל השלבים</p>'
    : ''}
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-run-details">שמור</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  document.getElementById('save-run-details')?.addEventListener('click', async () => {
    try {
      const payload = {
        batchNumber: document.getElementById('run-batch-number')?.value ?? '',
        startedDate: document.getElementById('run-started-date').value,
      };
      if (run.status === 'completed') {
        payload.completedDate = document.getElementById('run-completed-date').value;
      }
      await updateProductionRunDetails(run.id, payload);
      closeModal();
      showToast('פרטים נשמרו ✓');
      container.dataset.runId = String(run.id);
      container.dataset.view = 'run';
      if (payload.startedDate) container.dataset.selectedDate = payload.startedDate;
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}


async function renderManageView(container, ctx) {
  const manageTarget = container.dataset.manageTarget || 'group';
  const groupId = container.dataset.manageGroup || '';
  const categoryId = container.dataset.manageCategory || '';
  const { layout, groups } = ctx;

  const groupCategories = groupId
    ? layout.allCategories.filter((c) => Number(c.groupId) === Number(groupId))
    : layout.allCategories;

  const isGroupTarget = manageTarget === 'group';
  const activeGroupId = isGroupTarget ? groupId : '';
  const activeCategoryId = !isGroupTarget ? categoryId : '';
  const targetReady = isGroupTarget ? !!activeGroupId : !!activeCategoryId;

  const allFlows = await getAllFlowsOverview();
  const targetFlowsOverview = targetReady
    ? filterFlowsForManageTarget(allFlows, layout, {
      isGroupTarget,
      groupId,
      categoryId: activeCategoryId,
    })
    : [];

  let activeFlowId = container.dataset.manageFlowId || '';
  if (targetReady && targetFlowsOverview.length) {
    const flowExists = targetFlowsOverview.some((f) => String(f.id) === String(activeFlowId));
    if (!flowExists) {
      const defaultFlow = targetFlowsOverview.find((f) => f.isDefault) || targetFlowsOverview[0];
      activeFlowId = String(defaultFlow.id);
      container.dataset.manageFlowId = activeFlowId;
    }
  } else if (targetReady) {
    activeFlowId = '';
    container.dataset.manageFlowId = '';
  } else {
    activeFlowId = '';
    container.dataset.manageFlowId = '';
  }

  const activeFlow = targetFlowsOverview.find((f) => String(f.id) === String(activeFlowId)) || null;
  const portionManageGroupId = container.dataset.managePortionGroup || '';
  const portionGroupName = portionManageGroupId
    ? (groups.find((g) => String(g.id) === String(portionManageGroupId))?.name || '')
    : '';
  if (activeFlow) {
    await ensureFlowProductionStep(activeFlow.id);
  }
  const [steps, flowPreps, portionPresets] = await Promise.all([
    activeFlow ? getFlowStepsForFlow(activeFlow.id) : Promise.resolve([]),
    activeFlow ? getFlowPreparations(activeFlow.id) : Promise.resolve([]),
    portionManageGroupId ? getGroupPortionPresets(portionManageGroupId) : Promise.resolve([]),
  ]);

  const managePickOptions = {
    pickExtraClass: '',
    showTargetMeta: true,
    requireSteps: false,
  };
  const targetFlowListHTML = targetFlowsOverview.length
    ? renderFlowPickListHTML(targetFlowsOverview, activeFlowId, layout, {
      ...managePickOptions,
      scopeGroupId: isGroupTarget ? groupId : null,
      restrictCategoryId: !isGroupTarget ? categoryId : null,
      emptyMessage: 'אין תזרימים — צור תזרים חדש',
    })
    : '<p class="form-hint">אין תזרימים — לחץ «+ תזרים חדש»</p>';
  const allFlowsListHTML = allFlows.length
    ? renderFlowPickListHTML(allFlows, activeFlowId, layout, managePickOptions)
    : '';

  container.innerHTML = `
    <div class="card">
      <button type="button" class="btn btn-secondary btn-sm" id="back-from-manage">← חזרה</button>
      <h2 style="font-size:1rem;margin:12px 0 8px">הגדרת תזרימי יצור</h2>
      <p class="form-hint" style="margin-bottom:12px">צור כמה תזרימים עם שמות שונים לאותה קטגוריה — לדוגמה: עוגות גדולות, עוגות אישיות.</p>

      <div class="form-group">
        <label>סוג תזרים</label>
        <div class="flow-scope-tabs">
          <button type="button" class="flow-scope-tab manage-target-tab${isGroupTarget ? ' active' : ''}" data-target="group">קטגוריה כללית</button>
          <button type="button" class="flow-scope-tab manage-target-tab${!isGroupTarget ? ' active' : ''}" data-target="category">קטגוריה בודדת</button>
        </div>
      </div>

      <div class="form-group">
        <label for="manage-group">קטגוריה כללית</label>
        <select id="manage-group">
          <option value="">בחר קטגוריה כללית...</option>
          ${groups.map((g) => `<option value="${g.id}" ${String(g.id) === String(groupId) ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>

      ${!isGroupTarget ? `
        <div class="form-group">
          <label for="manage-category">קטגוריה</label>
          <select id="manage-category" ${!groupId ? 'disabled' : ''}>
            <option value="">${groupId ? 'בחר קטגוריה...' : 'קודם בחר קטגוריה כללית'}</option>
            ${groupCategories.map((c) => `<option value="${c.id}" ${String(c.id) === String(categoryId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>` : ''}

      ${targetReady ? `
        <div class="form-group manage-target-flows">
          <label>תזרימים${isGroupTarget && groupId ? ` · ${escapeHtml(groups.find((g) => String(g.id) === String(groupId))?.name || '')}` : ''}</label>
          <p class="form-hint" style="margin-bottom:8px">לפי קטגוריות — לחץ על תזרים לעריכה</p>
          <div class="filter-row" style="margin-bottom:10px">
            <button type="button" class="btn btn-primary btn-sm" id="new-flow-btn">+ תזרים חדש</button>
          </div>
          ${targetFlowListHTML}
          ${activeFlow ? `
            <div class="filter-row" style="margin-top:12px;margin-bottom:12px">
              <button type="button" class="btn btn-secondary btn-sm" id="rename-flow-btn">✏️ שנה שם</button>
              <button type="button" class="btn btn-secondary btn-sm" id="flow-history-btn">📋 היסטוריה</button>
              <button type="button" class="btn btn-secondary btn-sm" id="duplicate-flow-btn">📋 שכפל</button>
              ${!activeFlow.isDefault ? `<button type="button" class="btn btn-secondary btn-sm" id="set-default-flow-btn">★ ברירת מחדל</button>` : ''}
              ${targetFlowsOverview.length > 1 ? `<button type="button" class="btn btn-danger btn-sm" id="delete-flow-btn">🗑 מחק</button>` : ''}
            </div>` : ''}
        </div>

        ${activeFlow ? `
        <div class="flow-prep-manage-card">
          <div class="card-title" style="margin-bottom:6px">🧁 צ׳קליסט הכנות</div>
          <p class="form-hint" style="margin-bottom:10px">רשימה קבועה לקטגוריה כללית — נשמרת לתמיד · מופיעה בכל תהליך שמשתמש בתזרים «${escapeHtml(activeFlow.name)}»</p>
          ${flowPreps.length ? `
            <ul class="product-prep-list flow-prep-manage-list">
              ${flowPreps.map((p, i) => `
                <li class="product-prep-item" data-prep-id="${p.id}">
                  <span class="flow-prep-manage-num">${i + 1}.</span>
                  <span style="flex:1">${escapeHtml(p.name)}</span>
                  <button type="button" class="btn btn-danger btn-sm delete-flow-prep" data-id="${p.id}">🗑</button>
                </li>`).join('')}
            </ul>` : '<p class="form-hint" style="margin-bottom:8px">אין הכנות — הוסף למטה</p>'}
          <div class="filter-row" style="margin-top:10px">
            <input type="text" id="new-flow-prep-name" placeholder="למשל: הכנת בצק, שקילות...">
            <button type="button" class="btn btn-secondary btn-sm" id="add-flow-prep-btn">+ הוסף</button>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="import-flow-prep-btn" style="width:100%;margin-top:8px">ייבא מסוגי הכנה בקטגוריה</button>
        </div>

        <div class="flow-new-step-card">
          <p class="form-hint" style="margin-bottom:8px">כל תזרים כולל שלב <strong>תיעוד ייצור</strong> אוטומטי בסוף — שם מתועדים המוצרים</p>
          <div class="form-group" style="margin-bottom:8px">
            <label for="new-step-name">שלב חדש</label>
            <input type="text" id="new-step-name" placeholder="שם השלב">
          </div>
          ${flowStepPortionConfigHTML(null, 'new-step')}
          <button class="btn btn-primary btn-sm" id="add-step" style="width:100%;margin-top:8px">+ הוסף שלב</button>
        </div>
        ${steps.length === 0
          ? '<p class="form-hint">אין שלבים — הוסף שלב למעלה</p>'
          : `<p class="product-drag-hint">גרור ⠿ לשינוי סדר</p>
             <div class="flow-step-manage-list" data-flow-id="${activeFlow.id}">
               ${steps.map((s, i) => `
                 <div class="list-item flow-step-manage-item${s.tracksProduction ? ' flow-step-manage-item--production' : ''}" data-step-id="${s.id}">
                   <div class="product-order-col">
                     <span class="product-order-num">${i + 1}</span>
                     <span class="product-drag-handle flow-step-drag-handle" role="button" tabindex="0">⠿</span>
                   </div>
                   <div class="list-item-info">
                     <div class="list-item-name">${escapeHtml(s.name)}${s.tracksProduction ? ' <span class="flow-step-production-badge">📦 ייצור · חובה</span>' : ''}${s.tracksPortions ? ' <span class="flow-step-portion-badge">🍽 מנות</span>' : ''}</div>
                   </div>
                   <div class="list-item-actions">
                     <button class="btn btn-secondary btn-sm edit-step" data-id="${s.id}" data-name="${escapeHtml(s.name)}" data-tracks-portions="${s.tracksPortions ? '1' : ''}" data-tracks-production="${s.tracksProduction ? '1' : ''}" data-portion-unit="${s.portionUnit || 'units'}" data-portion-size="${s.portionSize ?? ''}">✏️</button>
                     ${s.tracksProduction ? '' : `<button class="btn btn-danger btn-sm delete-step" data-id="${s.id}">🗑</button>`}
                   </div>
                 </div>`).join('')}
             </div>`}
        ` : `
          <p class="form-hint" style="margin-bottom:12px">צור תזרים ראשון כדי להגדיר שלבים</p>
          <button type="button" class="btn btn-primary" id="create-first-flow" style="width:100%">+ צור תזרים ראשון</button>
        `}
      ` : `<p class="form-hint">${isGroupTarget ? 'בחר קטגוריה כללית להגדרת תזרימים' : 'בחר קבוצה וקטגוריה'}</p>`}

      ${allFlows.length ? `
      <div class="manage-flows-overview manage-flows-overview--bottom">
        <div class="card-title">כל התזרימים (${allFlows.length})</div>
        <p class="form-hint" style="margin-bottom:8px">לפי קטגוריות מוצרים — לחץ על תזרים כדי לערוך</p>
        ${allFlowsListHTML}
      </div>` : ''}

      <div class="flow-portion-presets-card manage-portions-section">
        <div class="card-title" style="margin-bottom:8px">🍽 מנות מוכנות</div>
        <p class="form-hint" style="margin-bottom:12px">בחר קטגוריה כללית — הרשימה משותפת לכל התזרימים באותה קבוצה</p>
        <div class="form-group">
          <label for="portion-manage-group">קטגוריה כללית</label>
          <select id="portion-manage-group">
            <option value="">בחר קטגוריה כללית...</option>
            ${groups.map((g) => `<option value="${g.id}" ${String(g.id) === String(portionManageGroupId) ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
          </select>
        </div>
        ${portionManageGroupId ? `
          ${portionGroupName ? `<p class="form-hint" style="margin-bottom:12px">מנות עבור: <strong>${escapeHtml(portionGroupName)}</strong></p>` : ''}
          ${portionPresets.length ? `
            <ul class="flow-preset-list">
              ${portionPresets.map((p) => `
                <li class="flow-preset-item list-item">
                  <div class="list-item-info">
                    <div class="list-item-name">${escapeHtml(p.name)}</div>
                    <div class="list-item-meta">${p.weight} ק"ג${p.extra ? ` · ${escapeHtml(p.extra)}` : ''}</div>
                  </div>
                  <div class="list-item-actions">
                    <button type="button" class="btn btn-secondary btn-sm edit-preset"
                      data-id="${p.id}" data-name="${escapeHtml(p.name)}"
                      data-weight="${p.weight}" data-extra="${escapeHtml(p.extra || '')}">✏️</button>
                    <button type="button" class="btn btn-danger btn-sm delete-preset" data-id="${p.id}">🗑</button>
                  </div>
                </li>`).join('')}
            </ul>` : '<p class="form-hint">אין מנות — הוסף מנה למטה</p>'}
          <div class="flow-new-preset-form" style="margin-top:12px">
            <div class="form-group">
              <label for="new-preset-name">שם מנה</label>
              <input type="text" id="new-preset-name" placeholder="לדוגמה: פרוס עוגה">
            </div>
            <div class="form-group">
              <label for="new-preset-weight">משקל (ק"ג)</label>
              <input type="number" id="new-preset-weight" min="0.001" step="0.001" inputmode="decimal" placeholder="0.12">
            </div>
            <div class="form-group">
              <label for="new-preset-extra">תוספת למנה</label>
              <input type="text" id="new-preset-extra" placeholder="לדוגמה: קרם, פירות">
            </div>
            <button type="button" class="btn btn-primary btn-sm" id="add-preset-btn" style="width:100%">+ הוסף מנה לרשימה</button>
          </div>
        ` : '<p class="form-hint">בחר קטגוריה כללית כדי לראות ולערוך מנות</p>'}
      </div>
    </div>`;

  document.getElementById('back-from-manage')?.addEventListener('click', () => {
    container.dataset.view = 'list';
    renderProcess(container);
  });

  container.querySelectorAll('.manage-target-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.manageTarget = btn.dataset.target;
      container.dataset.manageCategory = '';
      container.dataset.manageFlowId = '';
      renderProcess(container);
    });
  });

  document.getElementById('manage-group')?.addEventListener('change', (e) => {
    container.dataset.manageGroup = e.target.value;
    container.dataset.manageCategory = '';
    container.dataset.manageFlowId = '';
    renderProcess(container);
  });

  document.getElementById('manage-category')?.addEventListener('change', (e) => {
    container.dataset.manageCategory = e.target.value;
    container.dataset.manageFlowId = '';
    renderProcess(container);
  });

  document.getElementById('portion-manage-group')?.addEventListener('change', (e) => {
    container.dataset.managePortionGroup = e.target.value;
    renderProcess(container);
  });

  container.querySelectorAll('.manage-flow-pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      openFlowInManageView(container, {
        flowId: btn.dataset.flowId,
        targetType: btn.dataset.targetType,
        groupId: btn.dataset.groupId,
        categoryId: btn.dataset.categoryId,
      });
    });
  });

  document.getElementById('add-flow-prep-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('new-flow-prep-name')?.value?.trim();
    if (!name) return showToast('הזן שם הכנה');
    if (!activeFlow) return;
    try {
      await addFlowPreparation(activeFlow.id, name);
      requestAutoBackupNow().catch(() => {});
      showToast('הכנה נוספה ✓');
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('new-flow-prep-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('add-flow-prep-btn')?.click();
    }
  });

  document.getElementById('import-flow-prep-btn')?.addEventListener('click', async () => {
    if (!activeFlow) return;
    try {
      const added = await importFlowPreparationsFromActivityPresets(activeFlow.id);
      requestAutoBackupNow().catch(() => {});
      showToast(added ? `${added} הכנות יובאו ✓` : 'אין הכנות חדשות לייבוא');
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.delete-flow-prep').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק הכנה זו מהתזרים?')) return;
      try {
        await deleteFlowPreparation(Number(btn.dataset.id));
        requestAutoBackupNow().catch(() => {});
        showToast('נמחק');
        renderProcess(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.getElementById('new-flow-btn')?.addEventListener('click', () => {
    openModal({
      title: 'תזרים חדש',
      bodyHTML: `
        <div class="form-group"><label>שם התזרים</label><input type="text" id="new-flow-name" placeholder="לדוגמה: עוגות אישיות"></div>
        <label class="group-category-option"><input type="checkbox" id="new-flow-defaults" checked> הוסף שלבים ברירת מחדל</label>`,
      footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-new-flow">צור</button>`,
    });
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('save-new-flow')?.addEventListener('click', async () => {
      const name = document.getElementById('new-flow-name').value.trim();
      if (!name) return showToast('הזן שם תזרים');
      const withDefaults = document.getElementById('new-flow-defaults').checked;
      try {
        const flowId = await createFlow({
          categoryId: activeCategoryId || null,
          categoryGroupId: activeGroupId || null,
          name,
          withDefaults,
        });
        closeModal();
        container.dataset.manageFlowId = String(flowId);
        showToast('תזרים נוצר ✓');
        renderProcess(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.getElementById('create-first-flow')?.addEventListener('click', () => {
    document.getElementById('new-flow-btn')?.click();
  });

  document.getElementById('rename-flow-btn')?.addEventListener('click', () => {
    if (!activeFlow) return;
    openModal({
      title: 'שינוי שם תזרים',
      bodyHTML: `<div class="form-group"><label>שם</label><input type="text" id="rename-flow-name" value="${escapeHtml(activeFlow.name)}"></div>`,
      footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-rename-flow">שמור</button>`,
    });
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('save-rename-flow')?.addEventListener('click', async () => {
      try {
        await updateFlow(activeFlow.id, { name: document.getElementById('rename-flow-name').value });
        closeModal();
        showToast('עודכן ✓');
        renderProcess(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.getElementById('flow-history-btn')?.addEventListener('click', () => {
    if (!activeFlow) return;
    container.dataset.flowHistoryBack = 'manage';
    openFlowHistoryView(container, activeFlow.id);
  });

  document.getElementById('duplicate-flow-btn')?.addEventListener('click', () => {
    if (!activeFlow) return;
    openDuplicateFlowModal(container, ctx, activeFlow, steps.length);
  });

  document.getElementById('set-default-flow-btn')?.addEventListener('click', async () => {
    if (!activeFlow) return;
    try {
      await updateFlow(activeFlow.id, { isDefault: true });
      showToast('הוגדר כברירת מחדל ✓');
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('delete-flow-btn')?.addEventListener('click', async () => {
    if (!activeFlow || !confirm(`למחוק את התזרים «${activeFlow.name}»?`)) return;
    try {
      await deleteFlow(activeFlow.id);
      container.dataset.manageFlowId = '';
      showToast('נמחק');
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('add-step')?.addEventListener('click', async () => {
    const name = document.getElementById('new-step-name').value.trim();
    if (!name) return showToast('הזן שם שלב');
    if (!activeFlow) return showToast('בחר תזרים');
    try {
      await addFlowStepToFlow(activeFlow.id, name, readFlowStepPortionConfig('new-step'));
      showToast('נוסף ✓');
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  bindFlowStepPortionConfig('new-step');

  document.getElementById('add-preset-btn')?.addEventListener('click', async () => {
    if (!portionManageGroupId) return showToast('בחר קטגוריה כללית');
    try {
      await addGroupPortionPreset(portionManageGroupId, {
        name: document.getElementById('new-preset-name')?.value,
        weight: document.getElementById('new-preset-weight')?.value,
        extra: document.getElementById('new-preset-extra')?.value,
      });
      showToast('מנה נוספה ✓');
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.edit-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal({
        title: 'עריכת מנה',
        bodyHTML: `
          <div class="form-group"><label>שם מנה</label><input type="text" id="edit-preset-name" value="${btn.dataset.name}"></div>
          <div class="form-group"><label>משקל (ק"ג)</label><input type="number" id="edit-preset-weight" min="0.001" step="0.001" value="${btn.dataset.weight}"></div>
          <div class="form-group"><label>תוספת למנה</label><input type="text" id="edit-preset-extra" value="${btn.dataset.extra || ''}"></div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-preset">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('save-preset')?.addEventListener('click', async () => {
        try {
          await updateGroupPortionPreset(Number(btn.dataset.id), {
            name: document.getElementById('edit-preset-name').value,
            weight: document.getElementById('edit-preset-weight').value,
            extra: document.getElementById('edit-preset-extra').value,
          });
          closeModal();
          showToast('עודכן ✓');
          renderProcess(container);
        } catch (err) {
          showToast(err.message || 'שגיאה');
        }
      });
    });
  });

  container.querySelectorAll('.delete-preset').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק מנה מהרשימה?')) return;
      await deleteGroupPortionPreset(Number(btn.dataset.id));
      showToast('נמחק');
      renderProcess(container);
    });
  });

  container.querySelectorAll('.edit-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal({
        title: 'עריכת שלב',
        bodyHTML: `
          ${btn.dataset.tracksProduction ? '<p class="form-hint" style="margin-bottom:8px">שלב תיעוד ייצור — חובה בכל תזרים. ניתן לשנות שם בלבד.</p>' : ''}
          <div class="form-group"><label>שם</label><input type="text" id="edit-step-name" value="${btn.dataset.name}"></div>
          ${btn.dataset.tracksProduction ? '' : flowStepPortionConfigHTML({
            tracksPortions: !!btn.dataset.tracksPortions,
            portionUnit: btn.dataset.portionUnit || 'units',
            portionSize: btn.dataset.portionSize || '',
          }, 'edit-step')}`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-step">שמור</button>`,
      });
      bindFlowStepPortionConfig('edit-step');
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('save-step')?.addEventListener('click', async () => {
        try {
          await updateFlowStep(Number(btn.dataset.id), {
            name: document.getElementById('edit-step-name').value,
            ...(btn.dataset.tracksProduction ? {} : readFlowStepPortionConfig('edit-step')),
          });
          closeModal();
          showToast('עודכן ✓');
          renderProcess(container);
        } catch (err) {
          showToast(err.message || 'שגיאה');
        }
      });
    });
  });

  container.querySelectorAll('.delete-step').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('למחוק שלב זה?')) {
        await deleteFlowStep(Number(btn.dataset.id));
        showToast('נמחק');
        renderProcess(container);
      }
    });
  });

  if (activeFlow && steps.length) bindFlowStepDrag(container);
  restoreProcessScrollIfNeeded(container);
}

function bindFlowStepDrag(container) {
  const list = container.querySelector('.flow-step-manage-list');
  if (!list) return;
  const flowId = Number(list.dataset.flowId) || null;
  let drag = null;

  const finish = async (shouldSave) => {
    if (!drag) return;
    const { item, handle, pointerId, orderBefore } = drag;
    drag = null;
    item.classList.remove('is-dragging');
    list.classList.remove('is-sorting');
    try { handle.releasePointerCapture?.(pointerId); } catch { /* ignore */ }
    if (!shouldSave) return;
    const newOrder = [...list.querySelectorAll('.flow-step-manage-item')].map((el) => Number(el.dataset.stepId));
    if (JSON.stringify(orderBefore) === JSON.stringify(newOrder)) return;
    try {
      await setFlowStepOrderForFlow(flowId, newOrder);
    } catch {
      showToast('שגיאה בשמירת סדר');
    }
    renderProcess(container);
  };

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.flow-step-drag-handle');
    if (!handle) return;
    const item = handle.closest('.flow-step-manage-item');
    if (!item || drag) return;
    e.preventDefault();
    try { handle.setPointerCapture(e.pointerId); } catch { return; }
    drag = {
      item,
      handle,
      pointerId: e.pointerId,
      orderBefore: [...list.querySelectorAll('.flow-step-manage-item')].map((el) => Number(el.dataset.stepId)),
    };
    item.classList.add('is-dragging');
    list.classList.add('is-sorting');

    const onMove = (ev) => {
      if (!drag || ev.pointerId !== drag.pointerId) return;
      ev.preventDefault();
      const others = [...list.querySelectorAll('.flow-step-manage-item')].filter((el) => el !== drag.item);
      let insertBefore = null;
      for (const el of others) {
        const rect = el.getBoundingClientRect();
        if (ev.clientY < rect.top + rect.height / 2) { insertBefore = el; break; }
      }
      if (insertBefore) list.insertBefore(drag.item, insertBefore);
      else list.appendChild(drag.item);
    };
    const onUp = (ev) => {
      if (!drag || ev.pointerId !== drag.pointerId) return;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      finish(true);
    };
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
  });
}

function activeGroupIdFromFlow(flow) {
  return flow.groupId || flow.categoryGroupId || null;
}

async function openDuplicateFlowModal(container, ctx, sourceFlow, stepCount = 0) {
  const { layout, groups } = ctx;
  const defaultGroupId = activeGroupIdFromFlow(sourceFlow) || '';
  const groupCategories = defaultGroupId
    ? layout.allCategories.filter((c) => Number(c.groupId) === Number(defaultGroupId))
    : layout.allCategories;
  const defaultTarget = sourceFlow.targetType === 'category' ? 'category' : 'group';

  openModal({
    title: `שכפול תזרים — ${sourceFlow.name}`,
    bodyHTML: `
      <p class="form-hint" style="margin-bottom:12px">יועתקו ${stepCount} שלבים (מנות משותפות לפי קטגוריה כללית)</p>
      <div class="form-group">
        <label for="dup-flow-name">שם התזרים החדש</label>
        <input type="text" id="dup-flow-name" value="${escapeHtml(sourceFlow.name)} (עותק)">
      </div>
      <div class="form-group">
        <label for="dup-target-group">קטגוריה כללית (יעד)</label>
        <select id="dup-target-group">
          <option value="">בחר קטגוריה כללית...</option>
          ${groups.map((g) => `<option value="${g.id}" ${String(g.id) === String(defaultGroupId) ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="dup-target-type">יעד התזרים</label>
        <select id="dup-target-type">
          <option value="group" ${defaultTarget === 'group' ? 'selected' : ''}>כל הקבוצה</option>
          <option value="category" ${defaultTarget === 'category' ? 'selected' : ''}>קטגוריה בודדת</option>
        </select>
      </div>
      <div class="form-group${defaultTarget === 'category' ? '' : ' hidden'}" id="dup-category-wrap">
        <label for="dup-target-category">קטגוריה</label>
        <select id="dup-target-category">
          <option value="">בחר קטגוריה...</option>
          ${groupCategories.map((c) => `<option value="${c.id}" ${String(c.id) === String(sourceFlow.categoryId || '') ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-dup-flow">שכפל</button>`,
  });

  const syncDupCategory = () => {
    const type = document.getElementById('dup-target-type')?.value;
    document.getElementById('dup-category-wrap')?.classList.toggle('hidden', type !== 'category');
  };
  document.getElementById('dup-target-type')?.addEventListener('change', syncDupCategory);

  document.getElementById('dup-target-group')?.addEventListener('change', (e) => {
    const gid = e.target.value;
    const cats = gid
      ? layout.allCategories.filter((c) => Number(c.groupId) === Number(gid))
      : [];
    const sel = document.getElementById('dup-target-category');
    if (sel) {
      sel.innerHTML = `<option value="">בחר קטגוריה...</option>${cats.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}`;
    }
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-dup-flow')?.addEventListener('click', async () => {
    const name = document.getElementById('dup-flow-name')?.value.trim();
    const gid = Number(document.getElementById('dup-target-group')?.value);
    const targetType = document.getElementById('dup-target-type')?.value;
    const cid = targetType === 'category' ? Number(document.getElementById('dup-target-category')?.value) : null;
    if (!name) return showToast('הזן שם תזרים');
    if (!gid) return showToast('בחר קטגוריה כללית');
    if (targetType === 'category' && !cid) return showToast('בחר קטגוריה');
    try {
      const newId = await duplicateFlow(sourceFlow.id, {
        name,
        categoryGroupId: targetType === 'group' ? gid : null,
        categoryId: targetType === 'category' ? cid : null,
      });
      closeModal();
      container.dataset.manageTarget = targetType;
      container.dataset.manageGroup = String(gid);
      container.dataset.manageCategory = targetType === 'category' ? String(cid) : '';
      container.dataset.manageFlowId = String(newId);
      showToast('תזרים שוכפל ✓');
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

async function renderStartView(container, ctx) {
  const { layout, groups, products, catMap } = ctx;
  const runSettings = await getRunSettings();
  const allFlowsOverview = await getAllFlowsOverview();
  const scopeType = container.dataset.scopeType || 'category';
  const productId = container.dataset.selectedProduct || '';
  const date = container.dataset.selectedDate || todayISO();

  let {
    groupId,
    selectedCategories,
    groupCategories,
    scopeMode,
  } = resolveStartGroupContext(container, ctx, {
    scopeType,
    productId,
    selectedFlowId: container.dataset.selectedFlowId || '',
    allFlowsOverview,
  });

  if (groupId && groupId !== container.dataset.selectedGroup) {
    container.dataset.selectedGroup = groupId;
  }

  if (scopeType === 'category' && groupId && !selectedCategories.length && groupCategories.length) {
    selectedCategories = groupCategories.map((c) => c.id);
    container.dataset.selectedCategories = JSON.stringify(selectedCategories);
    ({ scopeMode } = resolveStartGroupContext(container, ctx, {
      scopeType,
      selectedCategories,
      groupId,
      allFlowsOverview,
    }));
  }

  const filteredProducts = groupId
    ? products.filter((p) => groupCategories.some((c) => c.id === p.categoryId))
    : products;

  let selectedFlowId = container.dataset.selectedFlowId || '';
  let stepCount = 0;
  let canStart = false;

  const selectedFlowOverview = selectedFlowId
    ? allFlowsOverview.find((f) => String(f.id) === String(selectedFlowId))
    : null;

  if (scopeType === 'product') {
    const prod = productId ? products.find((p) => p.id === Number(productId)) : null;
    if (prod) {
      scopeMode = 'product';
    }
  }

  if (selectedFlowId) {
    const steps = await getFlowStepsForFlow(selectedFlowId);
    stepCount = steps.length;
    canStart = computeCanStartRun({
      scopeType,
      productId,
      selectedFlowId,
      stepCount,
      groupId,
      selectedCategories,
      selectedFlowOverview,
    });
  } else if (scopeType === 'product') {
    const prod = productId ? products.find((p) => p.id === Number(productId)) : null;
    if (prod && groupId) {
      const resolved = await resolveFlows({
        categoryId: prod.categoryId,
        categoryGroupId: groupId,
        scopeMode: 'product',
      });
      if (resolved.length && !selectedFlowId) {
        selectedFlowId = String((resolved.find((f) => f.isDefault) || resolved[0]).id);
        container.dataset.selectedFlowId = selectedFlowId;
        stepCount = (await getFlowStepsForFlow(selectedFlowId)).length;
        canStart = !!productId && stepCount > 0;
      }
    }
  }

  const flowCategoryId = scopeType === 'product' && productId
    ? products.find((p) => p.id === Number(productId))?.categoryId
    : (scopeMode === 'category' && selectedCategories.length === 1 ? selectedCategories[0] : null);

  const selectedFlow = selectedFlowOverview
    || (selectedFlowId ? allFlowsOverview.find((f) => String(f.id) === String(selectedFlowId)) : null);

  const autoBatch = runSettings.autoBatchEnabled !== false;
  const nextBatch = Math.max(1, Number(runSettings.nextBatchNumber) || 1);

  container.innerHTML = `
    <div class="card">
      <button type="button" class="btn btn-secondary btn-sm" id="back-from-start">← חזרה</button>
      <h2 style="font-size:1rem;margin:12px 0">תהליך יצור חדש</h2>

      <div class="form-group">
        <label for="start-date">תאריך</label>
        <input type="date" id="start-date" value="${date}">
      </div>

      <div class="form-group">
        <label>בחר תזרים</label>
        <p class="form-hint" style="margin-bottom:8px">לחץ על תזרים מהרשימה — הקטגוריות ימולאו אוטומטית</p>
        ${renderFlowPickListHTML(allFlowsOverview, selectedFlowId, layout, { requireSteps: true })}
      </div>

      <div class="form-group">
        <label>תיעוד לפי</label>
        <div class="flow-scope-tabs">
          <button type="button" class="flow-scope-tab${scopeType === 'category' ? ' active' : ''}" data-scope="category">קטגוריות</button>
          <button type="button" class="flow-scope-tab${scopeType === 'product' ? ' active' : ''}" data-scope="product">מוצר</button>
        </div>
      </div>

      <div class="form-group">
        <label for="start-group">קטגוריה כללית *</label>
        <select id="start-group">
          <option value="">בחר קטגוריה כללית...</option>
          ${groups.map((g) => `<option value="${g.id}" ${String(g.id) === groupId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>

      ${scopeType === 'category' && groupId ? `
        <div class="form-group">
          <div class="filter-row" style="margin-bottom:8px;align-items:center">
            <label style="margin:0">קטגוריות בפס יצור</label>
            <div style="display:flex;gap:6px;margin-right:auto">
              <button type="button" class="btn btn-secondary btn-sm" id="start-cats-all">סמן הכל</button>
              <button type="button" class="btn btn-secondary btn-sm" id="start-cats-none">נקה</button>
            </div>
          </div>
          <p class="form-hint" style="margin-bottom:8px">סמן כמה קטגוריות — מגוון מוצרים על אותו תזרים יצור</p>
          <div class="group-category-checklist">
            ${groupCategories.map((c) => {
              const isSelected = selectedCategories.includes(c.id);
              return `
              <label class="group-category-option${isSelected ? ' is-selected' : ''}">
                <input type="checkbox" class="start-cat-check" value="${c.id}" ${isSelected ? 'checked' : ''}>
                <span class="group-category-option-label">${escapeHtml(c.name)}</span>
                ${isSelected ? '<span class="group-category-option-check" aria-hidden="true">✓</span>' : ''}
              </label>`;
            }).join('')}
          </div>
          ${selectedCategories.length ? `
          <div class="start-selected-cats-summary">
            <span class="start-selected-cats-title">נבחרו:</span>
            ${groupCategories
              .filter((c) => selectedCategories.includes(c.id))
              .map((c) => `<span class="start-selected-cat-chip">${escapeHtml(c.name)}</span>`)
              .join('')}
          </div>` : ''}
          <p class="form-hint" style="margin-top:8px">${selectedCategories.length} מתוך ${groupCategories.length} קטגוריות נבחרו</p>
        </div>
      ` : scopeType === 'category' ? `
        <p class="form-hint">בחר קטגוריה כללית כדי להתחיל</p>
      ` : `
        <div class="form-group">
          <label for="start-product">מוצר</label>
          <select id="start-product" ${!groupId ? 'disabled' : ''}>
            <option value="">${groupId ? 'בחר מוצר...' : 'קודם בחר קטגוריה כללית'}</option>
            ${filteredProducts.filter((p) => p.active).map((p) =>
              `<option value="${p.id}" ${String(p.id) === productId ? 'selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(catMap.get(p.categoryId) || '')})</option>`
            ).join('')}
          </select>
        </div>`}

      <div class="form-group flow-batch-settings">
        <label class="group-category-option" style="margin-bottom:8px">
          <input type="checkbox" id="auto-batch-enabled" ${autoBatch ? 'checked' : ''}>
          <span>מספר אצווה אוטומטי</span>
        </label>
        <div id="auto-batch-fields" class="${autoBatch ? '' : 'hidden'}">
          <p class="form-hint" style="margin-bottom:8px">האצווה הבאה: <strong id="next-batch-label">${nextBatch}</strong></p>
          <label for="next-batch-number">מונה אצוות (הבא בתור)</label>
          <input type="number" id="next-batch-number" min="1" step="1" value="${nextBatch}">
          <p class="form-hint">מספר האצווה יוקצה אוטומטית ויישמר בגיבוי</p>
        </div>
        <div id="manual-batch-fields" class="${autoBatch ? 'hidden' : ''}">
          <label for="batch-number">מספר אצווה (רשות)</label>
          <input type="text" id="batch-number" placeholder="לדוגמה: A-2026-042" maxlength="40">
        </div>
      </div>

      ${canStart
        ? `<p class="form-hint" style="margin-bottom:12px">${stepCount} שלבים${selectedFlow ? ` · ${escapeHtml(selectedFlow.name)}` : ''}</p>`
        : !selectedFlowId
          ? `<p class="form-hint" style="color:var(--warning);margin-bottom:12px">⚠️ בחר תזרים מהרשימה למעלה</p>`
          : stepCount <= 0
            ? `<p class="form-hint" style="color:var(--warning);margin-bottom:12px">⚠️ לתזרים אין שלבים — הוסף ב«נהל תזרים»</p>`
            : scopeType === 'product'
              ? `<p class="form-hint" style="color:var(--warning);margin-bottom:12px">⚠️ בחר מוצר</p>`
              : !groupId && !selectedCategories.length
                ? `<p class="form-hint" style="color:var(--warning);margin-bottom:12px">⚠️ בחר קטגוריה כללית או תזרים מהרשימה</p>`
                : `<p class="form-hint" style="color:var(--warning);margin-bottom:12px">⚠️ השלם בחירת קטגוריות</p>`}

      <button type="button" class="btn btn-primary" id="start-run-btn" style="width:100%" ${canStart ? '' : 'disabled'}>
        התחל תזרים יצור
      </button>
    </div>`;

  document.getElementById('back-from-start')?.addEventListener('click', () => {
    container.dataset.view = 'list';
    renderProcess(container);
  });

  document.getElementById('start-date')?.addEventListener('change', (e) => {
    container.dataset.selectedDate = e.target.value;
  });

  document.getElementById('start-group')?.addEventListener('change', (e) => {
    const newGroupId = e.target.value;
    container.dataset.selectedGroup = newGroupId;
    container.dataset.selectedCategories = '[]';
    container.dataset.selectedProduct = '';
    const currentFlowId = container.dataset.selectedFlowId;
    if (currentFlowId) {
      const flow = allFlowsOverview.find((f) => String(f.id) === String(currentFlowId));
      if (flowStillValidForGroup(flow, newGroupId)) {
        applyFlowSelectionToStart(container, flow, layout);
      } else {
        container.dataset.selectedFlowId = '';
      }
    }
    renderProcess(container);
  });

  container.querySelectorAll('.start-flow-pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      const flow = allFlowsOverview.find((f) => String(f.id) === String(btn.dataset.flowId));
      if (!flow) return;
      applyFlowSelectionToStart(container, flow, layout);
      renderProcess(container);
    });
  });

  document.getElementById('start-cats-all')?.addEventListener('click', () => {
    const ids = groupCategories.map((c) => c.id);
    container.dataset.selectedCategories = JSON.stringify(ids);
    renderProcess(container);
  });

  document.getElementById('start-cats-none')?.addEventListener('click', () => {
    container.dataset.selectedCategories = '[]';
    renderProcess(container);
  });

  container.querySelectorAll('.flow-scope-tab[data-scope]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.scopeType = btn.dataset.scope;
      container.dataset.selectedProduct = '';
      container.dataset.selectedCategories = '[]';
      container.dataset.selectedFlowId = '';
      renderProcess(container);
    });
  });

  container.querySelectorAll('.start-cat-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      const ids = [...container.querySelectorAll('.start-cat-check:checked')].map((el) => Number(el.value));
      container.dataset.selectedCategories = JSON.stringify(ids);
      renderProcess(container);
    });
  });

  document.getElementById('start-product')?.addEventListener('change', (e) => {
    container.dataset.selectedProduct = e.target.value;
    renderProcess(container);
  });

  document.getElementById('auto-batch-enabled')?.addEventListener('change', async (e) => {
    await setRunSettings({ autoBatchEnabled: e.target.checked });
    renderProcess(container);
  });

  document.getElementById('next-batch-number')?.addEventListener('change', async (e) => {
    const n = Math.max(1, Number(e.target.value) || 1);
    e.target.value = String(n);
    await setRunSettings({ nextBatchNumber: n });
    const label = document.getElementById('next-batch-label');
    if (label) label.textContent = String(n);
  });

  document.getElementById('start-run-btn')?.addEventListener('click', async () => {
    syncStartStateFromDOM(container);
    const state = readStartViewState(container, ctx, allFlowsOverview);
    let {
      groupId: startGroupId,
      scopeType: startScopeType,
      selectedCategories: startCategories,
      productId: startProductId,
      selectedFlowId: startFlowId,
      date: startDate,
      scopeMode: startScopeMode,
    } = state;

    const autoEnabled = document.getElementById('auto-batch-enabled')?.checked !== false;
    let batchNumber = '';
    if (autoEnabled) {
      const n = Math.max(1, Number(document.getElementById('next-batch-number')?.value) || 1);
      await setRunSettings({ nextBatchNumber: n, autoBatchEnabled: true });
    } else {
      batchNumber = document.getElementById('batch-number')?.value.trim() || '';
    }
    const flowId = startFlowId ? Number(startFlowId) : null;
    if (!flowId) return showToast('בחר תזרים מהרשימה');

    const flowMeta = allFlowsOverview.find((f) => f.id === flowId);
    if (!startGroupId && flowMeta) {
      startGroupId = String(flowMeta.groupId || flowMeta.categoryGroupId || '');
      if (!startCategories.length && flowMeta.categoryId) {
        startCategories = [flowMeta.categoryId];
      }
    }
    if (startScopeType !== 'product') {
      const groupCategoriesForStart = startGroupId
        ? layout.allCategories.filter((c) => Number(c.groupId) === Number(startGroupId))
        : [];
      if (startCategories.length) {
        const allSelected = groupCategoriesForStart.length > 0
          && groupCategoriesForStart.every((c) => startCategories.includes(c.id));
        if (allSelected) startScopeMode = 'group';
        else if (startCategories.length === 1) startScopeMode = 'category';
        else startScopeMode = 'categories';
      } else if (startGroupId) {
        startScopeMode = 'group';
      }
    }

    const payload = {
      date: startDate,
      batchNumber,
      categoryGroupId: startGroupId ? Number(startGroupId) : null,
      flowId,
      scopeMode: startScopeMode,
    };

    if (startScopeType === 'product') {
      const pid = Number(startProductId);
      const prod = products.find((p) => p.id === pid);
      if (!prod) return showToast('בחר מוצר');
      payload.productId = pid;
      payload.scopeMode = 'product';
      if (!startGroupId && prod.categoryId) {
        const cat = layout.allCategories.find((c) => c.id === prod.categoryId);
        if (cat?.groupId) payload.categoryGroupId = cat.groupId;
      }
    } else if (startScopeMode === 'group') {
      if (!startGroupId) return showToast('בחר קטגוריה כללית');
      payload.scopeMode = 'group';
      payload.categoryGroupId = Number(startGroupId);
    } else if (startScopeMode === 'category') {
      if (startCategories.length !== 1) return showToast('בחר קטגוריה אחת');
      payload.categoryId = startCategories[0];
      payload.scopeMode = 'category';
      if (startGroupId) payload.categoryGroupId = Number(startGroupId);
    } else if (startScopeMode === 'categories') {
      if (startCategories.length < 2) return showToast('בחר לפחות שתי קטגוריות, או סמן הכל');
      if (!startGroupId) return showToast('בחר קטגוריה כללית');
      payload.categoryIds = startCategories;
      payload.scopeMode = 'categories';
      payload.categoryGroupId = Number(startGroupId);
    } else if (!startCategories.length) {
      return showToast('בחר לפחות קטגוריה אחת');
    } else {
      return showToast('בחר קטגוריה');
    }

    try {
      const runId = await startProductionRun(payload);
      const run = await getProductionRun(runId);
      requestAutoBackupNow().catch(() => {});
      showToast(run?.batchNumber ? `תזרים התחיל · אצווה ${run.batchNumber} ✓` : 'תזרים התחיל ✓');
      container.dataset.view = 'run';
      container.dataset.runId = String(runId);
      container.dataset.selectedDate = startDate;
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

export async function renderProcess(container) {
  const view = container.dataset.view || 'list';
  const date = container.dataset.selectedDate || todayISO();

  const [layout, groups, products] = await Promise.all([
    getProductsCatalogLayout(),
    getCategoryGroups(),
    getProducts(true),
  ]);

  const catMap = new Map(layout.allCategories.map((c) => [c.id, c.name]));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));
  const ctx = { layout, groups, products, catMap, productMap, groupMap };

  if (view === 'run' && container.dataset.runId) {
    return renderRunView(container, Number(container.dataset.runId), ctx);
  }
  if (view === 'manage') {
    return renderManageView(container, ctx);
  }
  if (view === 'start') {
    return renderStartView(container, ctx);
  }
  if (view === 'flow-history') {
    return renderFlowHistoryView(container, ctx);
  }

  const [activeRuns, dateRuns, flowsOverview, allRuns, sheetsHTML] = await Promise.all([
    getActiveProductionRuns(),
    getProductionRunsForDate(date),
    getAllFlowsOverview(),
    getAllProductionRuns(),
    renderSheetsStatusHTML(),
  ]);
  syncAllActiveProductionRuns().catch(() => {});
  const doneRuns = dateRuns.filter((r) => r.status === 'completed');

  container.innerHTML = `
    <div class="section-header">
      <h2 style="font-size:1rem">תזרימי יצור</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="btn btn-secondary btn-sm" id="sync-all-active-runs">🔄 רענן פעילים</button>
        <button type="button" class="btn btn-secondary btn-sm" id="manage-flow">⚙️ נהל תזרים</button>
        <button type="button" class="btn btn-primary btn-sm" id="new-run">+ תהליך חדש</button>
      </div>
    </div>

    <p class="form-hint" style="margin-bottom:12px">רישום ייצור מתבצע בתוך התזרים — בשלב <strong>תיעוד ייצור</strong> בזמן תהליך פעיל</p>

    <div class="card">
      <div class="form-group" style="margin-bottom:0">
        <label for="flow-date">תאריך</label>
        <input type="date" id="flow-date" value="${date}">
      </div>
    </div>

    ${activeRuns.length ? `
      <div class="card">
        <div class="card-title">פעילים (${activeRuns.length})</div>
        ${renderRunsListGroupedHTML(activeRuns, layout, catMap, productMap, groupMap, { listDate: date })}
      </div>` : ''}

    <div class="card">
      <div class="card-title">${activeRuns.length ? 'הושלמו' : 'תהליכים'} — ${formatDate(date)}</div>
      ${doneRuns.length === 0 && activeRuns.length === 0
        ? '<p class="form-hint" style="text-align:center;padding:16px">אין תהליכים לתאריך זה — לחץ «תהליך חדש»</p>'
        : doneRuns.length === 0
          ? '<p class="form-hint" style="text-align:center;padding:8px">אין תהליכים שהושלמו</p>'
          : doneRuns.map((r) => renderRunCard(r, catMap, productMap, groupMap, { listDate: date })).join('')}
    </div>

    ${flowsOverview.length ? `
    <div class="card flows-overview">
      <div class="card-title">תזרימים מוגדרים (${flowsOverview.length})</div>
      <p class="form-hint" style="margin-bottom:8px">לחץ על תזרים לצפייה בשלבים · 📋 להיסטוריה</p>
      ${renderFlowsOverviewGrouped(flowsOverview, layout)}
    </div>` : ''}

    <div class="card sheets-primary-card">
      <div class="card-title">📊 Google Sheets</div>
      <div id="sheets-status">${sheetsHTML}</div>
    </div>

    <details class="card import-card">
      <summary class="import-summary">ייבוא מקובץ Excel (גיבוי)</summary>
      <p class="import-hint">
        העלה קובץ Excel או CSV עם התיעוד שלך (סוג, תאריך, כמות).
        מוצרים וקטגוריות חדשים ייווצרו אוטומטית.
      </p>
      <input type="file" id="process-import-file" accept=".csv,.xlsx,.xls,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" hidden>
      <button type="button" class="btn btn-secondary" id="process-import-btn" style="width:100%;margin-bottom:8px">
        📥 בחר קובץ Excel / CSV
      </button>
      <button type="button" class="btn btn-secondary btn-sm" id="process-template-btn" style="width:100%">
        הורד קובץ דוגמה
      </button>
    </details>

    <div class="card flow-all-runs-history">
      <div class="card-title">כל התהליכים (${allRuns.length})</div>
      <p class="form-hint" style="margin-bottom:10px">היסטוריה מלאה לפי תאריך — מהחדש לישן</p>
      ${renderAllRunsByDateHTML(allRuns, layout, catMap, productMap, groupMap)}
    </div>`;

  document.getElementById('flow-date')?.addEventListener('change', (e) => {
    container.dataset.selectedDate = e.target.value;
    renderProcess(container);
  });

  document.getElementById('sync-all-active-runs')?.addEventListener('click', async () => {
    try {
      const res = await syncAllActiveProductionRuns();
      requestAutoBackupNow().catch(() => {});
      showToast(res.updated
        ? `עודכנו ${res.updated} מתוך ${res.total} תזרימים פעילים ✓`
        : (res.total ? 'כל התזרימים הפעילים מעודכנים' : 'אין תזרימים פעילים'));
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('new-run')?.addEventListener('click', () => {
    container.dataset.view = 'start';
    renderProcess(container);
  });

  document.getElementById('manage-flow')?.addEventListener('click', () => {
    container.dataset.view = 'manage';
    renderProcess(container);
  });

  container.querySelectorAll('.flows-overview-open').forEach((btn) => {
    btn.addEventListener('click', () => {
      openFlowInManageView(container, {
        flowId: btn.dataset.flowId,
        targetType: btn.dataset.targetType,
        groupId: btn.dataset.groupId,
        categoryId: btn.dataset.categoryId,
      });
    });
  });

  container.querySelectorAll('.flows-overview-history').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      container.dataset.flowHistoryBack = 'list';
      openFlowHistoryView(container, btn.dataset.flowId);
    });
  });

  container.querySelectorAll('.open-run').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.date) container.dataset.selectedDate = btn.dataset.date;
      container.dataset.view = 'run';
      container.dataset.runId = btn.dataset.id;
      renderProcess(container);
    });
  });

  container.querySelectorAll('.delete-run').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק את התהליך? כל רישומי הייצור שתועדו בו יימחקו.')) return;
      await deleteProductionRun(Number(btn.dataset.id));
      requestAutoBackupNow().catch(() => {});
      showToast('התהליך ורישומי הייצור נמחקו');
      renderProcess(container);
    });
  });

  bindSheetsStatusEvents(container, {
    onRefresh: () => renderProcess(container),
    onImportComplete: () => renderProcess(container),
  });

  document.getElementById('process-import-btn')?.addEventListener('click', () => {
    document.getElementById('process-import-file').click();
  });

  document.getElementById('process-template-btn')?.addEventListener('click', async () => {
    const { CSV_TEMPLATE_BLOCKS } = await import('../import.js');
    const blob = new Blob(['\ufeff' + CSV_TEMPLATE_BLOCKS], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dugma-yitzur.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('process-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const { handleProductionImportFile } = await import('../import-flow.js');
    await handleProductionImportFile(file, { onComplete: () => renderProcess(container) });
  });

  restoreProcessScrollIfNeeded(container);
}

export function processMeta() {
  return { title: 'תזרים יצור', subtitle: 'תיעוד תהליך + רישום ייצור' };
}
