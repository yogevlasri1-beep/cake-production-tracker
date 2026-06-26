import {
  getProductsCatalogLayout, getCategoryGroups, getProducts, getCategories, getAllFlowsOverview,
  getFlowsForCategory, getFlowsForGroup, getFlowStepsForFlow, resolveFlows, resolveFlowSteps,
  resolveFlowsForCategorySelection,
  createFlow, updateFlow, deleteFlow, duplicateFlow,
  addFlowStepToFlow, updateFlowStep, deleteFlowStep,
  setFlowStepOrderForFlow, copyDefaultFlowStepsToFlow, ensureFlowProductionStep,
  getFlowPortionPresets, getGroupPortionPresets, addGroupPortionPreset, updateGroupPortionPreset, deleteGroupPortionPreset,
  startProductionRun, getProductionRun, getProductionRunsForDate, getActiveProductionRuns,
  completeRunStep, updateRunStepFields, deleteProductionRun, updateProductionRunDetails,
  addRunStepPortionBatch, updateRunStepPortionBatch, deleteRunStepPortionBatch,
  getStepPortionBatches, getStepPortionTotal,
  getRunSettings, setRunSettings,
  getEntriesForDate, addRunStepProductionEntry, updateProductionEntry, removeRunStepProductionEntry,
} from '../db.js?v=113';
import { todayISO, formatDate, showToast, escapeHtml, formatPortionCount, formatProductQuantity, productRecordUsesKg } from '../utils.js?v=113';
import { openModal, closeModal } from '../modal.js?v=113';
import { requestAutoBackupNow } from '../backup-service.js?v=113';
import { renderSheetsStatusHTML, bindSheetsStatusEvents } from '../sheets-flow.js?v=113';

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
    container.dataset.selectedGroup = String(flow.groupId || '');
    container.dataset.selectedCategories = JSON.stringify([flow.categoryId]);
  } else {
    const gid = flow.categoryGroupId || flow.groupId;
    container.dataset.selectedGroup = String(gid || '');
    const cats = layout.allCategories.filter((c) => Number(c.groupId) === Number(gid));
    container.dataset.selectedCategories = JSON.stringify(cats.map((c) => c.id));
  }
}

function renderFlowPickListHTML(flows, selectedFlowId, { emptyMessage } = {}) {
  const selectable = flows.filter((f) => f.stepCount > 0);
  if (!selectable.length) {
    return `<p class="form-hint">${emptyMessage || 'אין תזרימים עם שלבים — הגדר ב«נהל תזרים»'}</p>`;
  }
  return `
    <div class="flow-pick-list">
      ${selectable.map((f) => `
        <button type="button" class="manage-flow-pick start-flow-pick${String(f.id) === String(selectedFlowId) ? ' is-active' : ''}"
          data-flow-id="${f.id}"
          data-target-type="${f.targetType}"
          data-group-id="${f.groupId || f.categoryGroupId || ''}"
          data-category-id="${f.categoryId || ''}">
          <span class="manage-flow-pick-name">${escapeHtml(f.name)}${f.isDefault ? ' ★' : ''}</span>
          <span class="manage-flow-pick-meta">${escapeHtml(f.groupName ? `${f.groupName} · ` : '')}${escapeHtml(f.targetLabel)} · ${f.stepCount} שלבים</span>
        </button>`).join('')}
    </div>`;
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
    return `${total} מנות · ${names.join(', ')}`;
  }
  if (step.portionSize == null) return `${total} מנות`;
  const unit = step.portionUnit === 'weight' ? 'ק"ג' : "יח'";
  const size = step.portionUnit === 'weight' ? Number(step.portionSize) : step.portionSize;
  return `${total} מנות × ${size} ${unit}`;
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
  };
}

function stepInlineEditHTML(step, stepIndex, { expanded = false, includePortions = false, presets = [] } = {}) {
  return `
    <div class="flow-step-edit${expanded ? '' : ' hidden'}" data-step-edit="${stepIndex}">
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
      ${includePortions ? stepPortionFieldsHTML(step, stepIndex, presets) : ''}
      <button type="button" class="btn btn-secondary btn-sm flow-step-save-btn" data-step="${stepIndex}">שמור שינויים</button>
    </div>`;
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

function flowStepProductionSummary(step) {
  if (!step.tracksProduction) return '';
  const count = step.productionEntryIds?.length || 0;
  if (!count) return ' <span class="flow-step-production-badge">📦 ייצור</span>';
  return ` <span class="flow-step-production-badge">📦 ${count} רישומים</span>`;
}

function stepProductionPanelHTML({
  stepIndex,
  prodDate,
  selectedCategory,
  scopedCategories,
  scopedProducts,
  entriesForDate,
  catMap,
  productMap,
  canAdd,
}) {
  const filteredProducts = selectedCategory
    ? scopedProducts.filter((p) => String(p.categoryId) === selectedCategory)
    : [];
  const singleProduct = scopedProducts.length === 1 ? scopedProducts[0] : null;
  const productOptions = (selectedCategory || singleProduct
    ? (singleProduct ? scopedProducts : filteredProducts)
    : [])
    .map((p) => `<option value="${p.id}"${String(p.id) === String(singleProduct?.id || '') ? ' selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('');

  const entries = entriesForDate
    .filter((e) => scopedProducts.some((p) => p.id === e.productId))
    .sort((a, b) => b.id - a.id);

  return `
    <div class="flow-production-panel" data-step-production="${stepIndex}">
      <div class="flow-production-panel-header">
        <span class="flow-production-panel-title">📦 תיעוד ייצור</span>
        <span class="flow-production-panel-hint">כל הרישומים נשמרים לדוחות — אפשר להוסיף כמה שרוצים</span>
      </div>
      ${canAdd ? `
        <form class="flow-production-form" data-step="${stepIndex}">
          <div class="form-group">
            <label for="step-${stepIndex}-prod-date">תאריך</label>
            <input type="date" id="step-${stepIndex}-prod-date" class="flow-prod-date" value="${prodDate}" required>
          </div>
          ${!singleProduct ? `
            <div class="form-group">
              <label for="step-${stepIndex}-prod-category">קטגוריה</label>
              <select id="step-${stepIndex}-prod-category" class="flow-prod-category" required ${scopedCategories.length === 0 ? 'disabled' : ''}>
                <option value="">בחר קטגוריה...</option>
                ${scopedCategories.map((c) => `<option value="${c.id}" ${String(c.id) === selectedCategory ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="step-${stepIndex}-prod-product">מוצר</label>
              <select id="step-${stepIndex}-prod-product" class="flow-prod-product" required ${!selectedCategory || filteredProducts.length === 0 ? 'disabled' : ''}>
                <option value="">${selectedCategory ? 'בחר מוצר...' : 'קודם בחר קטגוריה'}</option>
                ${productOptions}
              </select>
            </div>` : `
            <input type="hidden" id="step-${stepIndex}-prod-product" class="flow-prod-product" value="${singleProduct.id}">
            <p class="form-hint" style="margin-bottom:8px">מוצר: <strong>${escapeHtml(singleProduct.name)}</strong></p>`}
          <div class="form-group">
            <label for="step-${stepIndex}-prod-qty" class="flow-prod-qty-label">${singleProduct && productRecordUsesKg(singleProduct) ? 'משקל (ק"ג)' : "כמות (יח')"}</label>
            <input type="number" id="step-${stepIndex}-prod-qty" class="flow-prod-qty" min="${singleProduct && productRecordUsesKg(singleProduct) ? '0.001' : '1'}" step="${singleProduct && productRecordUsesKg(singleProduct) ? '0.001' : '1'}" placeholder="${singleProduct && productRecordUsesKg(singleProduct) ? '2.5' : '50'}" required>
          </div>
          <button type="submit" class="btn btn-primary btn-sm flow-prod-submit" style="width:100%">+ הוסף רישום ייצור</button>
        </form>` : ''}
      <div class="flow-production-entries">
        <div class="flow-production-entries-title">רישומים ל-${formatDate(prodDate)}</div>
        ${entries.length === 0
    ? '<p class="form-hint" style="margin:8px 0 0">אין רישומים לתאריך זה</p>'
    : entries.map((e) => {
      const p = productMap.get(e.productId);
      return `<div class="list-item flow-production-entry" data-entry-id="${e.id}">
        <div class="list-item-info">
          <div class="list-item-name">${escapeHtml(p?.name || '—')}</div>
          <div class="list-item-meta">${escapeHtml(catMap.get(p?.categoryId) || '')}</div>
        </div>
        <div class="list-item-actions">
          <strong>${formatProductQuantity(p, e.quantity)}</strong>
          ${canAdd ? `
            <button type="button" class="btn btn-secondary btn-sm btn-icon flow-prod-edit" data-step="${stepIndex}" data-id="${e.id}" title="ערוך">✏️</button>
            <button type="button" class="btn btn-danger btn-sm btn-icon flow-prod-del" data-step="${stepIndex}" data-id="${e.id}" title="מחק">🗑</button>` : ''}
        </div>
      </div>`;
    }).join('')}
      </div>
    </div>`;
}

function renderTimelineStep(step, stepIndex, currentIndex, totalSteps, portionPresets, runStatus, editAllMode, run, productionCtx) {
  const visual = stepVisualState(stepIndex, currentIndex, totalSteps, step.status);
  const hasNotes = step.notes || step.issues || step.improvements;
  const portionText = stepPortionLabel(step);
  const timeLabel = step.completedAt
    ? new Date(step.completedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    : '';
  const isActive = visual === 'active';
  const isDone = visual === 'done';
  const reachable = isActive || isDone;
  const showPreview = hasNotes && !isActive && !editAllMode;
  const canProdAdd = step.tracksProduction && run?.status === 'active' && reachable;
  const prodPanel = step.tracksProduction && reachable && productionCtx
    ? stepProductionPanelHTML({
      stepIndex,
      prodDate: productionCtx.prodDate,
      selectedCategory: productionCtx.selectedCategories[stepIndex] || '',
      scopedCategories: productionCtx.scopedCategories,
      scopedProducts: productionCtx.scopedProducts,
      entriesForDate: productionCtx.entriesForDate,
      catMap: productionCtx.catMap,
      productMap: productionCtx.productMap,
      canAdd: canProdAdd,
    })
    : '';

  return `
    <div class="flow-step flow-step--${visual}${step.tracksProduction ? ' flow-step--production' : ''}" data-step-index="${stepIndex}">
      <div class="flow-step-marker" aria-hidden="true"></div>
      <div class="flow-step-body">
        <div class="flow-step-header">
          <span class="flow-step-num">${stepIndex + 1}</span>
          <span class="flow-step-name">${escapeHtml(step.stepName)}</span>
          ${timeLabel ? `<span class="flow-step-time">${timeLabel}</span>` : ''}
          ${flowStepProductionSummary(step)}
          ${step.tracksPortions && !portionText ? '<span class="flow-step-portion-badge">🍽 מנות</span>' : ''}
        </div>
        ${prodPanel}
        ${portionText && !isActive && !editAllMode ? `<p class="flow-step-portion-preview">🍽 ${escapeHtml(portionText)}</p>` : ''}
        ${step.tracksPortions && reachable
    ? stepPortionBatchesHTML(step, stepIndex, { canAdd: reachable, canEdit: reachable, presets: portionPresets }) : ''}
        ${showPreview ? `
          <div class="flow-step-notes-preview">
            ${step.notes ? `<span>📝 ${escapeHtml(step.notes)}</span>` : ''}
            ${step.issues ? `<span>⚠️ ${escapeHtml(step.issues)}</span>` : ''}
            ${step.improvements ? `<span>💡 ${escapeHtml(step.improvements)}</span>` : ''}
          </div>` : ''}
        ${reachable ? stepInlineEditHTML(step, stepIndex, {
    expanded: isActive || editAllMode,
    includePortions: true,
    presets: portionPresets,
  }) : ''}
        <div class="flow-step-actions">
          ${isDone && !editAllMode ? `<button type="button" class="btn btn-secondary btn-sm flow-step-edit-toggle" data-step="${stepIndex}">עריכה</button>` : ''}
          ${isActive && !editAllMode ? `<button type="button" class="btn btn-primary btn-sm flow-step-complete-btn" data-step="${stepIndex}">✓ השלם</button>` : ''}
          ${isActive && editAllMode ? `<button type="button" class="btn btn-primary btn-sm flow-step-complete-btn" data-step="${stepIndex}">✓ השלם שלב</button>` : ''}
        </div>
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

async function renderRunView(container, runId, ctx) {
  const run = await getProductionRun(runId);
  if (!run) {
    container.dataset.view = 'list';
    return renderProcess(container);
  }

  const { catMap, productMap, groupMap } = ctx;
  const currentIndex = run.status === 'completed' ? run.steps.length : run.currentStepIndex;
  const portionPresets = run.flowId ? await getFlowPortionPresets(run.flowId) : [];
  const editAllMode = container.dataset.runEditAll === '1';
  const hasProductionSteps = run.steps.some((s) => s.tracksProduction);
  const prodDate = container.dataset.runProdDate || todayISO();
  let productionCtx = null;

  if (hasProductionSteps) {
    const [products, categories, entriesForDate] = await Promise.all([
      getProducts(true),
      getCategories(),
      getEntriesForDate(prodDate),
    ]);
    const scopedCategories = filterCategoriesForRun(run, categories);
    const scopedProducts = filterProductsForRun(run, products, categories);
    const selectedCategories = {};
    run.steps.forEach((step, i) => {
      if (!step.tracksProduction) return;
      const key = runProdCategoryKey(i);
      let cat = container.dataset[key] || '';
      if (!cat && scopedCategories.length === 1) cat = String(scopedCategories[0].id);
      if (!cat && run.productId) {
        const p = productMap.get(run.productId);
        if (p) cat = String(p.categoryId);
      }
      selectedCategories[i] = cat;
    });
    productionCtx = {
      prodDate,
      selectedCategories,
      scopedCategories,
      scopedProducts,
      entriesForDate,
      catMap,
      productMap,
    };
  }

  container.innerHTML = `
    <div class="card flow-run-header-card">
      <button type="button" class="btn btn-secondary btn-sm" id="back-to-list">← חזרה</button>
      <div class="flow-run-header-info">
        <h2 class="flow-run-title">${run.batchNumber ? `אצווה ${escapeHtml(run.batchNumber)}` : runTitle(run, catMap, productMap, groupMap)}</h2>
        <p class="flow-run-subtitle">${runTitle(run, catMap, productMap, groupMap)}</p>
      </div>
      <div class="flow-run-dates">
        <div class="flow-run-dates-row">
          <span class="flow-run-dates-label">התחלה</span>
          <span class="flow-run-dates-value">${formatRunTimestamp(run.startedAt, run.date)}</span>
        </div>
        <div class="flow-run-dates-row">
          <span class="flow-run-dates-label">סיום</span>
          <span class="flow-run-dates-value">${run.completedAt ? formatRunTimestamp(run.completedAt) : '—'}</span>
        </div>
      </div>
      <div class="flow-run-header-actions filter-row" style="margin-top:12px;flex-wrap:wrap">
        <button type="button" class="btn btn-secondary btn-sm" id="toggle-edit-all">${editAllMode ? 'סיום עריכה' : '✏️ ערוך הכל'}</button>
        <button type="button" class="btn btn-secondary btn-sm" id="edit-run-details">📋 פרטי תהליך</button>
        <button type="button" class="btn btn-danger btn-sm" id="delete-run-in-view">🗑 מחק תהליך</button>
      </div>
      ${editAllMode ? '<p class="form-hint" style="margin-top:8px">מצב עריכה — כל השלבים שהגיעו אליהם פתוחים לעריכה</p>' : ''}
      <div class="flow-legend">
        <span class="flow-legend-item flow-legend-item--done">✓ בוצע</span>
        <span class="flow-legend-item flow-legend-item--active">● פעיל</span>
        <span class="flow-legend-item flow-legend-item--next">○ הבא</span>
        ${hasProductionSteps ? '<span class="flow-legend-item flow-legend-item--production">📦 ייצור</span>' : ''}
      </div>
    </div>

    <div class="flow-timeline${editAllMode ? ' flow-timeline--edit-all' : ''}">
      ${run.steps.map((step, i) => renderTimelineStep(step, i, currentIndex, run.steps.length, portionPresets, run.status, editAllMode, run, productionCtx)).join('')}
    </div>

    ${editAllMode ? `
      <div class="card">
        <button type="button" class="btn btn-primary" id="save-all-steps" style="width:100%">שמור את כל השינויים</button>
      </div>` : ''}

    ${run.status === 'completed'
      ? `<div class="card"><p class="flow-complete-msg">✓ התהליך הושלם${run.batchNumber ? ` · אצווה ${escapeHtml(run.batchNumber)}` : ''}</p></div>`
      : ''}`;

  document.getElementById('toggle-edit-all')?.addEventListener('click', () => {
    container.dataset.runEditAll = editAllMode ? '' : '1';
    container.dataset.runId = String(run.id);
    container.dataset.view = 'run';
    renderProcess(container);
  });

  document.getElementById('edit-run-details')?.addEventListener('click', () => {
    openRunDetailsModal(container, run, ctx);
  });

  document.getElementById('delete-run-in-view')?.addEventListener('click', async () => {
    if (!confirm('למחוק את התהליך הזה? פעולה זו לא ניתנת לביטול.')) return;
    try {
      await deleteProductionRun(run.id);
      requestAutoBackupNow().catch(() => {});
      showToast('התהליך נמחק');
      container.dataset.view = 'list';
      delete container.dataset.runId;
      delete container.dataset.runEditAll;
      renderProcess(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
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

  container.querySelectorAll('.flow-step-edit-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stepIndex = Number(btn.dataset.step);
      const panel = container.querySelector(`[data-step-edit="${stepIndex}"]`);
      if (!panel) return;
      const opening = panel.classList.contains('hidden');
      panel.classList.toggle('hidden');
      btn.textContent = opening ? 'סגור' : 'עריכה';
    });
  });

  container.querySelectorAll('.flow-step-save-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const stepIndex = Number(btn.dataset.step);
      try {
        await updateRunStepFields(run.id, stepIndex, readStepInlineFields(stepIndex));
        showToast('נשמר ✓');
        container.dataset.runId = String(run.id);
        container.dataset.view = 'run';
        renderProcess(container);
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
      container.dataset.runId = String(run.id);
      container.dataset.view = 'run';
      renderProcess(container);
    });
  });

  container.querySelectorAll('.flow-prod-product').forEach((select) => {
    if (select.tagName !== 'SELECT') return;
    select.addEventListener('change', () => {
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
      const entry = productionCtx.entriesForDate.find((e) => e.id === entryId);
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
            <input type="number" id="flow-edit-qty" min="${isKg ? '0.001' : '1'}" step="${isKg ? '0.001' : '1'}" value="${entry.quantity}">
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
    title: 'עריכת פרטי תהליך',
    bodyHTML: `
      <div class="form-group">
        <label for="run-batch-number">מספר אצווה</label>
        <input type="text" id="run-batch-number" value="${escapeHtml(run.batchNumber || '')}" placeholder="אופציונלי">
      </div>
      <div class="form-group">
        <label for="run-started-date">תאריך התחלה</label>
        <input type="date" id="run-started-date" value="${startDate}">
      </div>
      ${run.status === 'completed' ? `
      <div class="form-group">
        <label for="run-completed-date">תאריך סיום</label>
        <input type="date" id="run-completed-date" value="${endDate}">
      </div>` : `
      <p class="form-hint">תאריך סיום יופיע ויהיה ניתן לעריכה לאחר השלמת כל השלבים</p>`}`,
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

  const flows = targetReady
    ? (isGroupTarget
      ? await getFlowsForGroup(activeGroupId)
      : await getFlowsForCategory(activeCategoryId))
    : [];

  let activeFlowId = container.dataset.manageFlowId || '';
  if (targetReady && flows.length) {
    const flowExists = flows.some((f) => String(f.id) === String(activeFlowId));
    if (!flowExists) {
      const defaultFlow = flows.find((f) => f.isDefault) || flows[0];
      activeFlowId = String(defaultFlow.id);
      container.dataset.manageFlowId = activeFlowId;
    }
  } else {
    activeFlowId = '';
    container.dataset.manageFlowId = '';
  }

  const activeFlow = flows.find((f) => String(f.id) === String(activeFlowId)) || null;
  const portionManageGroupId = container.dataset.managePortionGroup || '';
  const portionGroupName = portionManageGroupId
    ? (groups.find((g) => String(g.id) === String(portionManageGroupId))?.name || '')
    : '';
  if (activeFlow) {
    await ensureFlowProductionStep(activeFlow.id);
  }
  const [steps, portionPresets, allFlows] = await Promise.all([
    activeFlow ? getFlowStepsForFlow(activeFlow.id) : Promise.resolve([]),
    portionManageGroupId ? getGroupPortionPresets(portionManageGroupId) : Promise.resolve([]),
    getAllFlowsOverview(),
  ]);

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
        <div class="form-group">
          <label for="manage-flow-select">תזרים</label>
          <div class="filter-row" style="margin-bottom:8px">
            <select id="manage-flow-select" style="flex:1">
              ${flows.length
                ? flows.map((f) => `<option value="${f.id}" ${String(f.id) === String(activeFlowId) ? 'selected' : ''}>${escapeHtml(f.name)}${f.isDefault ? ' ★' : ''}</option>`).join('')
                : '<option value="">אין תזרימים</option>'}
            </select>
            <button type="button" class="btn btn-primary btn-sm" id="new-flow-btn">+ חדש</button>
          </div>
          ${activeFlow ? `
            <div class="filter-row" style="margin-bottom:12px">
              <button type="button" class="btn btn-secondary btn-sm" id="rename-flow-btn">✏️ שנה שם</button>
              <button type="button" class="btn btn-secondary btn-sm" id="duplicate-flow-btn">📋 שכפל</button>
              ${!activeFlow.isDefault ? `<button type="button" class="btn btn-secondary btn-sm" id="set-default-flow-btn">★ ברירת מחדל</button>` : ''}
              ${flows.length > 1 ? `<button type="button" class="btn btn-danger btn-sm" id="delete-flow-btn">🗑 מחק</button>` : ''}
            </div>` : ''}
        </div>

        ${activeFlow ? `
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
                 <div class="list-item flow-step-manage-item" data-step-id="${s.id}">
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
        <p class="form-hint" style="margin-bottom:8px">לחץ על תזרים כדי לערוך את השלבים שלו</p>
        <div class="manage-flows-list">
          ${allFlows.map((f) => `
            <button type="button" class="manage-flow-pick${String(f.id) === String(activeFlowId) && targetReady ? ' is-active' : ''}"
              data-flow-id="${f.id}"
              data-target-type="${f.targetType}"
              data-group-id="${f.groupId || ''}"
              data-category-id="${f.categoryId || ''}">
              <span class="manage-flow-pick-name">${escapeHtml(f.name)}${f.isDefault ? ' ★' : ''}</span>
              <span class="manage-flow-pick-meta">${escapeHtml(f.targetLabel)} · ${f.stepCount} שלבים</span>
            </button>`).join('')}
        </div>
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
      container.dataset.manageTarget = btn.dataset.targetType === 'category' ? 'category' : 'group';
      container.dataset.manageGroup = btn.dataset.groupId || '';
      container.dataset.manageCategory = btn.dataset.categoryId || '';
      container.dataset.manageFlowId = btn.dataset.flowId || '';
      if (btn.dataset.groupId) container.dataset.managePortionGroup = btn.dataset.groupId;
      renderProcess(container);
    });
  });

  document.getElementById('manage-flow-select')?.addEventListener('change', (e) => {
    container.dataset.manageFlowId = e.target.value;
    renderProcess(container);
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
  const groupId = container.dataset.selectedGroup || '';
  const scopeType = container.dataset.scopeType || 'category';
  let selectedCategories = parseIdList(container.dataset.selectedCategories);
  const productId = container.dataset.selectedProduct || '';
  const date = container.dataset.selectedDate || todayISO();

  const groupCategories = groupId
    ? layout.allCategories.filter((c) => Number(c.groupId) === Number(groupId))
    : [];

  if (scopeType === 'category' && groupId && !selectedCategories.length && groupCategories.length) {
    selectedCategories = groupCategories.map((c) => c.id);
    container.dataset.selectedCategories = JSON.stringify(selectedCategories);
  }

  const filteredProducts = groupId
    ? products.filter((p) => groupCategories.some((c) => c.id === p.categoryId))
    : products;

  let selectedFlowId = container.dataset.selectedFlowId || '';
  let stepCount = 0;
  let canStart = false;
  let scopeMode = 'group';

  const selectedFlowOverview = selectedFlowId
    ? allFlowsOverview.find((f) => String(f.id) === String(selectedFlowId))
    : null;

  if (scopeType === 'product') {
    const prod = productId ? products.find((p) => p.id === Number(productId)) : null;
    if (prod) {
      scopeMode = 'product';
    }
  } else if (groupId && selectedCategories.length) {
    const allGroupIds = groupCategories.map((c) => c.id);
    const allSelected = allGroupIds.length > 0
      && allGroupIds.every((id) => selectedCategories.includes(id));

    if (allSelected) {
      scopeMode = 'group';
    } else if (selectedCategories.length === 1) {
      scopeMode = 'category';
    } else {
      scopeMode = 'categories';
    }
  }

  if (selectedFlowId) {
    const steps = await getFlowStepsForFlow(selectedFlowId);
    stepCount = steps.length;
    if (scopeType === 'product') {
      canStart = !!productId && stepCount > 0;
    } else if (groupId && selectedCategories.length) {
      canStart = stepCount > 0;
    }
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
        ${renderFlowPickListHTML(allFlowsOverview, selectedFlowId)}
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
          : groupId
            ? `<p class="form-hint" style="color:var(--warning);margin-bottom:12px">⚠️ השלם בחירת קטגוריות</p>`
            : ''}

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
    container.dataset.selectedGroup = e.target.value;
    container.dataset.selectedCategories = '[]';
    container.dataset.selectedProduct = '';
    container.dataset.selectedFlowId = '';
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
    const autoEnabled = document.getElementById('auto-batch-enabled')?.checked !== false;
    let batchNumber = '';
    if (autoEnabled) {
      const n = Math.max(1, Number(document.getElementById('next-batch-number')?.value) || 1);
      await setRunSettings({ nextBatchNumber: n, autoBatchEnabled: true });
    } else {
      batchNumber = document.getElementById('batch-number')?.value.trim() || '';
    }
    const d = document.getElementById('start-date').value;
    const flowId = selectedFlowId ? Number(selectedFlowId) : null;
    if (!flowId) return showToast('בחר תזרים מהרשימה');

    const payload = {
      date: d,
      batchNumber,
      categoryGroupId: groupId ? Number(groupId) : null,
      flowId,
      scopeMode,
    };

    if (scopeType === 'product') {
      const pid = Number(productId);
      const prod = products.find((p) => p.id === pid);
      if (!prod) return showToast('בחר מוצר');
      payload.productId = pid;
      payload.scopeMode = 'product';
    } else if (scopeMode === 'group') {
      payload.scopeMode = 'group';
    } else if (scopeMode === 'category') {
      if (selectedCategories.length !== 1) return showToast('בחר קטגוריה אחת');
      payload.categoryId = selectedCategories[0];
      payload.scopeMode = 'category';
    } else if (scopeMode === 'categories') {
      if (selectedCategories.length < 2) return showToast('בחר לפחות שתי קטגוריות, או סמן הכל');
      payload.categoryIds = selectedCategories;
      payload.scopeMode = 'categories';
    } else if (!selectedCategories.length) {
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
      container.dataset.selectedDate = d;
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

  const [activeRuns, dateRuns, flowsOverview, sheetsHTML] = await Promise.all([
    getActiveProductionRuns(),
    getProductionRunsForDate(date),
    getAllFlowsOverview(),
    renderSheetsStatusHTML(),
  ]);
  const doneRuns = dateRuns.filter((r) => r.status === 'completed');

  container.innerHTML = `
    <div class="section-header">
      <h2 style="font-size:1rem">תזרימי יצור</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
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
        ${activeRuns.map((r) => renderRunCard(r, catMap, productMap, groupMap, { listDate: date })).join('')}
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
      ${flowsOverview.slice(0, 8).map((f) => `
        <div class="list-item-meta" style="padding:6px 0;border-bottom:1px solid var(--border)">
          <strong>${escapeHtml(f.name)}</strong> · ${escapeHtml(f.targetLabel)} · ${f.stepCount} שלבים
        </div>`).join('')}
      ${flowsOverview.length > 8 ? `<p class="form-hint" style="margin-top:8px">+${flowsOverview.length - 8} נוספים — «נהל תזרים»</p>` : ''}
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
    </details>`;

  document.getElementById('flow-date')?.addEventListener('change', (e) => {
    container.dataset.selectedDate = e.target.value;
    renderProcess(container);
  });

  document.getElementById('new-run')?.addEventListener('click', () => {
    container.dataset.view = 'start';
    renderProcess(container);
  });

  document.getElementById('manage-flow')?.addEventListener('click', () => {
    container.dataset.view = 'manage';
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

  container.querySelectorAll('.delete-run').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק תהליך זה?')) return;
      await deleteProductionRun(Number(btn.dataset.id));
      showToast('נמחק');
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
}

export function processMeta() {
  return { title: 'תזרים יצור', subtitle: 'תיעוד תהליך + רישום ייצור' };
}
