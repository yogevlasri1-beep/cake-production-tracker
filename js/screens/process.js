import {
  getProductsCatalogLayout, getCategoryGroups, getProducts, getAllFlowsOverview,
  getFlowsForCategory, getFlowsForGroup, getFlowStepsForFlow, resolveFlows, resolveFlowSteps,
  resolveFlowsForCategorySelection,
  createFlow, updateFlow, deleteFlow,
  addFlowStepToFlow, updateFlowStep, deleteFlowStep,
  setFlowStepOrderForFlow, copyDefaultFlowStepsToFlow,
  getFlowPortionPresets, addFlowPortionPreset, updateFlowPortionPreset, deleteFlowPortionPreset,
  startProductionRun, getProductionRun, getProductionRunsForDate, getActiveProductionRuns,
  completeRunStep, updateRunStepFields, deleteProductionRun, updateProductionRunDates,
  addRunStepPortionBatch, updateRunStepPortionBatch, deleteRunStepPortionBatch,
  getStepPortionBatches, getStepPortionTotal,
  getRunSettings, setRunSettings,
} from '../db.js?v=99';
import { todayISO, formatDate, showToast, escapeHtml } from '../utils.js?v=99';
import { openModal, closeModal } from '../modal.js?v=99';
import { requestAutoBackupNow } from '../backup-service.js?v=99';

function parseIdList(str) {
  try {
    return JSON.parse(str || '[]').map(Number).filter(Boolean);
  } catch {
    return [];
  }
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
              <span class="flow-portion-batch-date">${formatDate(b.date)}</span>
              ${b.name ? `
                <span class="flow-portion-batch-name">${escapeHtml(b.name)}</span>
                ${b.weight != null ? `<span class="flow-portion-batch-weight">${b.weight} ק"ג</span>` : ''}
                ${b.extra ? `<span class="flow-portion-batch-extra">${escapeHtml(b.extra)}</span>` : ''}
              ` : ''}
              ${editable ? `
                <label class="flow-portion-batch-count-edit">
                  × <input type="number" class="flow-portion-batch-count-input" min="1" step="1" inputmode="numeric"
                    value="${b.count}" data-step="${stepIndex}" data-batch="${batchIndex}" aria-label="מספר מנות">
                </label>
                <button type="button" class="btn btn-danger btn-sm flow-portion-batch-del" data-step="${stepIndex}" data-batch="${batchIndex}" title="הסר">🗑</button>
              ` : `
                <span class="flow-portion-batch-count">× ${b.count}</span>
              `}
              ${b.note ? `<span class="flow-portion-batch-note">${escapeHtml(b.note)}</span>` : ''}
            </li>`).join('')}
        </ul>
        ${total != null ? `<p class="flow-portion-batch-total">סה"כ: <strong>${total}</strong> מנות</p>` : ''}
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
            <input type="number" class="flow-portion-add-count" min="1" step="1" inputmode="numeric" placeholder="5">
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
          <input type="number" id="step-${stepIndex}-portion-count" min="1" step="1" value="" placeholder="אופציונלי — לדוגמה: 5">
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

function renderTimelineStep(step, stepIndex, currentIndex, totalSteps, portionPresets = [], runStatus = 'active') {
  const visual = stepVisualState(stepIndex, currentIndex, totalSteps, step.status);
  const hasNotes = step.notes || step.issues || step.improvements;
  const portionText = stepPortionLabel(step);
  const timeLabel = step.completedAt
    ? new Date(step.completedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    : '';
  const isActive = visual === 'active';
  const isDone = visual === 'done';
  const reachable = isActive || isDone;
  const showPreview = hasNotes && !isActive;

  return `
    <div class="flow-step flow-step--${visual}" data-step-index="${stepIndex}">
      <div class="flow-step-marker" aria-hidden="true"></div>
      <div class="flow-step-body">
        <div class="flow-step-header">
          <span class="flow-step-num">${stepIndex + 1}</span>
          <span class="flow-step-name">${escapeHtml(step.stepName)}</span>
          ${timeLabel ? `<span class="flow-step-time">${timeLabel}</span>` : ''}
          ${step.tracksPortions && !portionText ? '<span class="flow-step-portion-badge">🍽 מנות</span>' : ''}
        </div>
        ${portionText && !isActive ? `<p class="flow-step-portion-preview">🍽 ${escapeHtml(portionText)}</p>` : ''}
        ${step.tracksPortions && reachable
    ? stepPortionBatchesHTML(step, stepIndex, { canAdd: reachable, canEdit: reachable, presets: portionPresets }) : ''}
        ${showPreview ? `
          <div class="flow-step-notes-preview">
            ${step.notes ? `<span>📝 ${escapeHtml(step.notes)}</span>` : ''}
            ${step.issues ? `<span>⚠️ ${escapeHtml(step.issues)}</span>` : ''}
            ${step.improvements ? `<span>💡 ${escapeHtml(step.improvements)}</span>` : ''}
          </div>` : ''}
        ${reachable ? stepInlineEditHTML(step, stepIndex, {
    expanded: isActive,
    includePortions: true,
    presets: portionPresets,
  }) : ''}
        <div class="flow-step-actions">
          ${isDone ? `<button type="button" class="btn btn-secondary btn-sm flow-step-edit-toggle" data-step="${stepIndex}">עריכה</button>` : ''}
          ${isActive ? `<button type="button" class="btn btn-primary btn-sm flow-step-complete-btn" data-step="${stepIndex}">✓ השלם</button>` : ''}
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
        <button type="button" class="btn btn-secondary btn-sm" id="edit-run-dates">✏️ ערוך תאריכים</button>
      </div>
      <div class="flow-legend">
        <span class="flow-legend-item flow-legend-item--done">✓ בוצע</span>
        <span class="flow-legend-item flow-legend-item--active">● פעיל</span>
        <span class="flow-legend-item flow-legend-item--next">○ הבא</span>
      </div>
    </div>

    <div class="flow-timeline">
      ${run.steps.map((step, i) => renderTimelineStep(step, i, currentIndex, run.steps.length, portionPresets, run.status)).join('')}
    </div>

    ${run.status === 'completed'
      ? `<div class="card"><p class="flow-complete-msg">✓ התהליך הושלם${run.batchNumber ? ` · אצווה ${escapeHtml(run.batchNumber)}` : ''}</p></div>`
      : ''}`;

  document.getElementById('edit-run-dates')?.addEventListener('click', () => {
    openRunDatesModal(container, run, ctx);
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
}

function openRunDatesModal(container, run, ctx) {
  const startDate = runStartDateIso(run) || todayISO();
  const endDate = run.completedAt ? String(run.completedAt).slice(0, 10) : '';

  openModal({
    title: 'עריכת תאריכי תהליך',
    bodyHTML: `
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
      <button class="btn btn-primary" id="save-run-dates">שמור</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  document.getElementById('save-run-dates')?.addEventListener('click', async () => {
    try {
      const startedDate = document.getElementById('run-started-date').value;
      const payload = { startedDate };
      if (run.status === 'completed') {
        payload.completedDate = document.getElementById('run-completed-date').value;
      }
      await updateProductionRunDates(run.id, payload);
      closeModal();
      showToast('תאריכים נשמרו ✓');
      container.dataset.runId = String(run.id);
      container.dataset.view = 'run';
      if (startedDate) container.dataset.selectedDate = startedDate;
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
  const [steps, portionPresets, allFlows] = await Promise.all([
    activeFlow ? getFlowStepsForFlow(activeFlow.id) : Promise.resolve([]),
    activeFlow ? getFlowPortionPresets(activeFlow.id) : Promise.resolve([]),
    getAllFlowsOverview(),
  ]);

  container.innerHTML = `
    <div class="card">
      <button type="button" class="btn btn-secondary btn-sm" id="back-from-manage">← חזרה</button>
      <h2 style="font-size:1rem;margin:12px 0 8px">הגדרת תזרימי יצור</h2>
      <p class="form-hint" style="margin-bottom:12px">צור כמה תזרימים עם שמות שונים לאותה קטגוריה — לדוגמה: עוגות גדולות, עוגות אישיות.</p>

      ${allFlows.length ? `
      <div class="manage-flows-overview">
        <div class="card-title">כל התזרימים (${allFlows.length})</div>
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
              ${!activeFlow.isDefault ? `<button type="button" class="btn btn-secondary btn-sm" id="set-default-flow-btn">★ ברירת מחדל</button>` : ''}
              ${flows.length > 1 ? `<button type="button" class="btn btn-danger btn-sm" id="delete-flow-btn">🗑 מחק</button>` : ''}
            </div>` : ''}
        </div>

        ${activeFlow ? `
        <div class="flow-new-step-card">
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
                     <div class="list-item-name">${escapeHtml(s.name)}${s.tracksPortions ? ' <span class="flow-step-portion-badge">🍽 מנות</span>' : ''}</div>
                   </div>
                   <div class="list-item-actions">
                     <button class="btn btn-secondary btn-sm edit-step" data-id="${s.id}" data-name="${escapeHtml(s.name)}" data-tracks-portions="${s.tracksPortions ? '1' : ''}" data-portion-unit="${s.portionUnit || 'units'}" data-portion-size="${s.portionSize ?? ''}">✏️</button>
                     <button class="btn btn-danger btn-sm delete-step" data-id="${s.id}">🗑</button>
                   </div>
                 </div>`).join('')}
             </div>`}
        <div class="flow-portion-presets-card" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border,#e2e8f0)">
          <div class="card-title" style="margin-bottom:8px">🍽 רשימת מנות מוכנות</div>
          <p class="form-hint" style="margin-bottom:12px">שם, משקל (ק"ג) ותוספת — בתזרים יצור בוחרים מנה ומזינים כמה מנות השתמשו</p>
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
        </div>
        ` : `
          <p class="form-hint" style="margin-bottom:12px">צור תזרים ראשון כדי להגדיר שלבים</p>
          <button type="button" class="btn btn-primary" id="create-first-flow" style="width:100%">+ צור תזרים ראשון</button>
        `}
      ` : `<p class="form-hint">${isGroupTarget ? 'בחר קטגוריה כללית להגדרת תזרימים' : 'בחר קבוצה וקטגוריה'}</p>`}
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

  container.querySelectorAll('.manage-flow-pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.manageTarget = btn.dataset.targetType === 'category' ? 'category' : 'group';
      container.dataset.manageGroup = btn.dataset.groupId || '';
      container.dataset.manageCategory = btn.dataset.categoryId || '';
      container.dataset.manageFlowId = btn.dataset.flowId || '';
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
    if (!activeFlow) return;
    try {
      await addFlowPortionPreset(activeFlow.id, {
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
          await updateFlowPortionPreset(Number(btn.dataset.id), {
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
      await deleteFlowPortionPreset(Number(btn.dataset.id));
      showToast('נמחק');
      renderProcess(container);
    });
  });

  container.querySelectorAll('.edit-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal({
        title: 'עריכת שלב',
        bodyHTML: `
          <div class="form-group"><label>שם</label><input type="text" id="edit-step-name" value="${btn.dataset.name}"></div>
          ${flowStepPortionConfigHTML({
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
            ...readFlowStepPortionConfig('edit-step'),
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

async function renderStartView(container, ctx) {
  const { layout, groups, products, catMap } = ctx;
  const runSettings = await getRunSettings();
  const groupId = container.dataset.selectedGroup || '';
  const scopeType = container.dataset.scopeType || 'category';
  const catSelectionMode = container.dataset.catSelectionMode || 'group';
  const selectedCategories = parseIdList(container.dataset.selectedCategories);
  const productId = container.dataset.selectedProduct || '';
  const date = container.dataset.selectedDate || todayISO();

  const groupCategories = groupId
    ? layout.allCategories.filter((c) => Number(c.groupId) === Number(groupId))
    : [];

  const filteredProducts = groupId
    ? products.filter((p) => groupCategories.some((c) => c.id === p.categoryId))
    : products;

  let availableFlows = [];
  let selectedFlowId = container.dataset.selectedFlowId || '';
  let stepCount = 0;
  let canStart = false;
  let scopeMode = 'group';

  if (scopeType === 'product') {
    const prod = productId ? products.find((p) => p.id === Number(productId)) : null;
    if (prod) {
      scopeMode = 'product';
      availableFlows = await resolveFlows({
        categoryId: prod.categoryId,
        categoryGroupId: groupId || null,
        scopeMode: 'product',
      });
    }
  } else if (groupId && catSelectionMode === 'group') {
    scopeMode = 'group';
    availableFlows = await resolveFlows({ categoryGroupId: groupId, scopeMode: 'group' });
  } else if (groupId && catSelectionMode === 'pick') {
    if (selectedCategories.length === 1) {
      scopeMode = 'category';
      availableFlows = await resolveFlows({
        categoryId: selectedCategories[0],
        categoryGroupId: groupId,
        scopeMode: 'category',
      });
    } else if (selectedCategories.length > 1) {
      scopeMode = 'categories';
      availableFlows = await resolveFlowsForCategorySelection({
        categoryIds: selectedCategories,
        categoryGroupId: groupId,
      });
    }
  }

  const flowCategoryId = scopeType === 'product' && productId
    ? products.find((p) => p.id === Number(productId))?.categoryId
    : (scopeMode === 'category' && selectedCategories.length === 1 ? selectedCategories[0] : null);

  if (availableFlows.length) {
    const flowExists = availableFlows.some((f) => String(f.id) === String(selectedFlowId));
    if (!flowExists) {
      const defaultFlow = availableFlows.find((f) => f.isDefault) || availableFlows[0];
      selectedFlowId = String(defaultFlow.id);
      container.dataset.selectedFlowId = selectedFlowId;
    }
    const steps = await resolveFlowSteps({
      categoryId: flowCategoryId,
      categoryGroupId: groupId || null,
      flowId: selectedFlowId,
    });
    stepCount = steps.length;
    if (scopeType === 'product') {
      canStart = !!productId && stepCount > 0;
    } else if (scopeMode === 'group') {
      canStart = groupCategories.length > 0 && stepCount > 0;
    } else if (scopeMode === 'category') {
      canStart = selectedCategories.length === 1 && stepCount > 0;
    } else if (scopeMode === 'categories') {
      canStart = selectedCategories.length > 0 && stepCount > 0;
    }
  } else {
    canStart = false;
    stepCount = 0;
  }

  const selectedFlow = availableFlows.find((f) => String(f.id) === String(selectedFlowId)) || null;
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
          <label>בחירת קטגוריות</label>
          <div class="flow-scope-tabs">
            <button type="button" class="flow-scope-tab cat-mode-tab${catSelectionMode === 'group' ? ' active' : ''}" data-mode="group">כל הקבוצה</button>
            <button type="button" class="flow-scope-tab cat-mode-tab${catSelectionMode === 'pick' ? ' active' : ''}" data-mode="pick">קטגוריות נבחרות</button>
          </div>
        </div>
        ${catSelectionMode === 'group' ? `
          <p class="form-hint" style="margin-bottom:12px">התהליך יכלול את כל ${groupCategories.length} הקטגוריות בקבוצה</p>` : `
          <div class="form-group">
            <label>סמן קטגוריות</label>
            <p class="form-hint" style="margin-bottom:8px">לתזרים ייעודי לקטגוריה — סמן קטגוריה אחת</p>
            <div class="group-category-checklist">
              ${groupCategories.map((c) => `
                <label class="group-category-option">
                  <input type="checkbox" class="start-cat-check" value="${c.id}" ${selectedCategories.includes(c.id) ? 'checked' : ''}>
                  <span>${escapeHtml(c.name)}</span>
                </label>`).join('')}
            </div>
          </div>`}
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

      ${availableFlows.length ? `
        <div class="form-group">
          <label for="start-flow">תזרים</label>
          <select id="start-flow">
            ${availableFlows.map((f) => `<option value="${f.id}" ${String(f.id) === String(selectedFlowId) ? 'selected' : ''}>${escapeHtml(f.name)}${f.isDefault ? ' ★' : ''}</option>`).join('')}
          </select>
        </div>` : ''}

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
        : groupId
          ? `<p class="form-hint" style="color:var(--warning);margin-bottom:12px">⚠️ אין תזרימים עם שלבים — הגדר ב«נהל תזרים»</p>`
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

  container.querySelectorAll('.flow-scope-tab[data-scope]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.scopeType = btn.dataset.scope;
      container.dataset.selectedProduct = '';
      container.dataset.selectedCategories = '[]';
      container.dataset.selectedFlowId = '';
      renderProcess(container);
    });
  });

  container.querySelectorAll('.cat-mode-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.catSelectionMode = btn.dataset.mode;
      container.dataset.selectedCategories = '[]';
      container.dataset.selectedFlowId = '';
      renderProcess(container);
    });
  });

  container.querySelectorAll('.start-cat-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      const ids = [...container.querySelectorAll('.start-cat-check:checked')].map((el) => Number(el.value));
      container.dataset.selectedCategories = JSON.stringify(ids);
      container.dataset.selectedFlowId = '';
      renderProcess(container);
    });
  });

  document.getElementById('start-flow')?.addEventListener('change', (e) => {
    container.dataset.selectedFlowId = e.target.value;
    renderProcess(container);
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
      if (!selectedCategories.length) return showToast('בחר לפחות קטגוריה אחת');
      payload.categoryIds = selectedCategories;
      payload.scopeMode = 'categories';
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

  const [activeRuns, dateRuns, flowsOverview] = await Promise.all([
    getActiveProductionRuns(),
    getProductionRunsForDate(date),
    getAllFlowsOverview(),
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
    </div>` : ''}`;

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
}

export function processMeta() {
  return { title: 'תזרים יצור', subtitle: 'תיעוד תהליך יצור בזמן אמת' };
}
