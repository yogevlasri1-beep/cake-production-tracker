import {
  getManagerDepartments, addManagerDepartment, updateManagerDepartment, deleteManagerDepartment,
  getProducts, getCategories, getAllFlowPortionPresetsWithContext,
  getAllFlowsOverview, getFlowStepsForFlow,
  getManagerPlan, upsertManagerPlan, getManagerPlanItems,
  addManagerPlanItem, addManagerPlanFlowSteps, updateManagerPlanItem, deleteManagerPlanItem,
  getManagerTasks, addManagerTask, updateManagerTask, deleteManagerTask,
  getManagerIncidents, addManagerIncident, updateManagerIncident, deleteManagerIncident,
  getManagerShiftNotes, addManagerShiftNote, deleteManagerShiftNote,
  getManagerDashboardStats,
  getManagerResponsibilityAreas, addManagerResponsibilityArea, updateManagerResponsibilityArea, deleteManagerResponsibilityArea,
  getManagerEmployees, addManagerEmployee, updateManagerEmployee, deleteManagerEmployee,
} from '../db.js?v=175';
import {
  todayISO, formatDate, formatDateHebrew, escapeHtml, showToast,
  weekStartISO, weekDayLabels, addDaysISO, progressBar, currentMonth, monthLabel,
} from '../utils.js?v=175';
import { openModal, closeModal } from '../modal.js?v=175';
import { renderTargets } from './targets.js?v=175';
import { forceAppUpdate } from '../sw-register.js?v=175';

const TABS = [
  { id: 'overview', label: 'סקירה', icon: '📊' },
  { id: 'daily', label: 'תוכנית יומית', icon: '📅' },
  { id: 'weekly', label: 'תוכנית שבועית', icon: '🗓' },
  { id: 'team', label: 'צוות', icon: '👥' },
  { id: 'tasks', label: 'משימות', icon: '✅' },
  { id: 'improvements', label: 'שיפורים', icon: '💡' },
  { id: 'incidents', label: 'תקלות', icon: '⚠️' },
  { id: 'notes', label: 'משמרות', icon: '📝' },
  { id: 'targets', label: 'יעדים', icon: '🎯' },
];

const PRIORITY_LABELS = { low: 'נמוך', medium: 'בינוני', high: 'גבוה' };
const STATUS_LABELS = { open: 'פתוח', progress: 'בתהליך', done: 'הושלם' };
const SEVERITY_LABELS = { minor: 'קל', major: 'חמור', critical: 'קריטי' };
const INCIDENT_STATUS_LABELS = { open: 'פתוח', investigating: 'בבדיקה', resolved: 'טופל' };

let managerDeptsCache = [];

function deptLabel(id) {
  return managerDeptsCache.find((d) => d.deptKey === id)?.label || id;
}

function deptIcon(id) {
  return managerDeptsCache.find((d) => d.deptKey === id)?.icon || '📋';
}

function deptOptions(selected = '') {
  return managerDeptsCache.map((d) =>
    `<option value="${d.deptKey}" ${d.deptKey === selected ? 'selected' : ''}>${d.icon} ${escapeHtml(d.label)}</option>`
  ).join('');
}

async function loadManagerDepartments() {
  managerDeptsCache = await getManagerDepartments();
  return managerDeptsCache;
}

function managerTabsHTML(active, badges = {}) {
  return `
    <div class="manager-tabs-wrap">
      <div class="manager-tabs">
        ${TABS.map((t) => `
          <button type="button" class="manager-tab${active === t.id ? ' active' : ''}" data-tab="${t.id}">
            <span class="manager-tab-icon">${t.icon}</span>
            <span class="manager-tab-label">${t.label}</span>
            ${badges[t.id] ? `<span class="manager-tab-badge">${badges[t.id]}</span>` : ''}
          </button>`).join('')}
      </div>
    </div>`;
}

function bindManagerTabs(container) {
  container.querySelectorAll('.manager-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.managerTab = btn.dataset.tab;
      renderManager(container);
    });
  });
}

async function renderOverview(container) {
  const today = todayISO();
  const stats = await getManagerDashboardStats(today);
  const [allTasks, allIncidents, planItems] = await Promise.all([
    getManagerTasks(),
    getManagerIncidents(),
    getManagerPlanItems('daily', today),
  ]);
  const tasks = allTasks.filter((t) => t.status !== 'done');
  const incidents = allIncidents.filter((i) => i.status !== 'resolved');
  const highTasks = tasks.filter((t) => t.priority === 'high').slice(0, 5);
  const recentIncidents = incidents.slice(0, 4);

  container.innerHTML = `
    ${managerTabsHTML('overview', {
      tasks: stats.openTasks || null,
      incidents: stats.openIncidents || null,
    })}
    <div class="manager-stats-grid">
      <div class="manager-stat-card">
        <div class="manager-stat-value">${stats.planPct}%</div>
        <div class="manager-stat-label">תוכנית יומית</div>
        <div class="manager-stat-sub">${stats.planDone}/${stats.planTotal} הושלמו</div>
      </div>
      <div class="manager-stat-card">
        <div class="manager-stat-value">${stats.openTasks}</div>
        <div class="manager-stat-label">משימות פתוחות</div>
        ${stats.highPriorityTasks ? `<div class="manager-stat-sub">${stats.highPriorityTasks} דחופות</div>` : ''}
      </div>
      <div class="manager-stat-card${stats.openIncidents ? ' manager-stat-warn' : ''}">
        <div class="manager-stat-value">${stats.openIncidents}</div>
        <div class="manager-stat-label">תקלות פתוחות</div>
        ${stats.criticalIncidents ? `<div class="manager-stat-sub">${stats.criticalIncidents} קריטיות</div>` : ''}
      </div>
      <div class="manager-stat-card">
        <div class="manager-stat-value">${stats.activeRuns}</div>
        <div class="manager-stat-label">תזרימים פעילים</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">ייצור היום — ${formatDateHebrew(today)}</div>
      ${progressBar(stats.productionToday, stats.dailyTarget, 'כמות כוללת')}
    </div>

    ${highTasks.length ? `
    <div class="card">
      <div class="card-title">דגשים דחופים</div>
      ${highTasks.map((t) => `
        <div class="manager-list-item">
          <span class="manager-priority manager-priority-high">!</span>
          <div class="manager-list-body">
            <strong>${escapeHtml(t.title)}</strong>
            <span class="manager-list-meta">${deptIcon(t.department)} ${deptLabel(t.department)}${t.dueDate ? ` · עד ${formatDate(t.dueDate)}` : ''}</span>
          </div>
        </div>`).join('')}
    </div>` : ''}

    ${planItems.length ? `
    <div class="card">
      <div class="card-title">תוכנית יומית — ${formatDate(today)}</div>
      ${planItems.slice(0, 6).map((item) => `
        <div class="manager-list-item">
          <span class="manager-check${item.done ? ' done' : ''}">${item.done ? '✓' : '○'}</span>
          <div class="manager-list-body">
            <span>${item.itemKind === 'portion' ? '🍽 ' : item.itemKind === 'flow_step' ? '📋 ' : ''}${escapeHtml(item.label)}${item.quantity ? ` · ${item.quantity}${item.itemKind === 'portion' ? ' מנות' : ''}` : ''}</span>
          </div>
        </div>`).join('')}
      ${planItems.length > 6 ? `<p class="form-hint">+${planItems.length - 6} נוספים</p>` : ''}
      <button type="button" class="btn btn-secondary btn-sm" data-goto-tab="daily" style="margin-top:8px">פתח תוכנית יומית</button>
    </div>` : `
    <div class="card">
      <div class="card-title">תוכנית יומית</div>
      <p class="form-hint">טרם הוגדרה תוכנית להיום</p>
      <button type="button" class="btn btn-primary btn-sm" data-goto-tab="daily">+ הכן תוכנית יומית</button>
    </div>`}

    ${recentIncidents.length ? `
    <div class="card">
      <div class="card-title">תקלות אחרונות</div>
      ${recentIncidents.map((i) => `
        <div class="manager-list-item">
          <span class="manager-severity manager-severity-${i.severity}">${SEVERITY_LABELS[i.severity]}</span>
          <div class="manager-list-body">
            <strong>${escapeHtml(i.title)}</strong>
            <span class="manager-list-meta">${deptLabel(i.department)} · ${formatDate(i.occurredAt)}</span>
          </div>
        </div>`).join('')}
    </div>` : ''}

    <div class="card manager-quick-actions">
      <div class="card-title">פעולות מהירות</div>
      <div class="manager-quick-grid">
        <button type="button" class="btn btn-secondary btn-sm" data-goto-tab="daily">📅 תוכנית יומית</button>
        <button type="button" class="btn btn-secondary btn-sm" data-goto-tab="weekly">🗓 תוכנית שבועית</button>
        <button type="button" class="btn btn-secondary btn-sm" data-goto-tab="team">🏷 מחלקות צוות</button>
        <button type="button" class="btn btn-secondary btn-sm" data-quick="task">✅ משימה חדשה</button>
        <button type="button" class="btn btn-secondary btn-sm" data-quick="incident">⚠️ דווח תקלה</button>
        <button type="button" class="btn btn-secondary btn-sm" data-goto-tab="notes">📝 הערת משמרת</button>
        <button type="button" class="btn btn-secondary btn-sm" data-goto-tab="improvements">💡 נקודת שיפור</button>
        <button type="button" class="btn btn-secondary btn-sm" id="manager-force-update">🔄 עדכן אפליקציה</button>
      </div>
    </div>`;

  bindManagerTabs(container);
  container.querySelectorAll('[data-goto-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.managerTab = btn.dataset.gotoTab;
      renderManager(container);
    });
  });
  container.querySelector('[data-quick="task"]')?.addEventListener('click', () => openTaskModal(container, 'task'));
  container.querySelector('[data-quick="incident"]')?.addEventListener('click', () => openIncidentModal(container));
  container.querySelector('[data-quick="improvement"]')?.addEventListener('click', () => openTaskModal(container, 'improvement'));
  document.getElementById('manager-force-update')?.addEventListener('click', async () => {
    const btn = document.getElementById('manager-force-update');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'מעדכן...';
    }
    try {
      showToast('מעדכן...');
      await forceAppUpdate();
    } catch {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🔄 עדכן אפליקציה';
      }
      showToast('שגיאה — נסה «גיבוי → נקה מטמון ועדכן»');
    }
  });
}

function planItemRow(item, { showDay = false } = {}) {
  const dayLabels = weekDayLabels();
  const isPortion = item.itemKind === 'portion';
  const isFlowStep = item.itemKind === 'flow_step';
  let bodyInner;
  if (isPortion) {
    const target = item.label.includes('→') ? item.label.split('→').pop().trim() : item.label;
    bodyInner = `
        <span class="manager-plan-label">🍽 ${escapeHtml(item.portionName || item.label)}</span>
        <span class="manager-plan-portion-detail">${item.portionWeight != null ? `${item.portionWeight} ק"ג` : ''}${item.portionExtra ? ` · ${escapeHtml(item.portionExtra)}` : ''}</span>
        <span class="manager-plan-portion-target">→ ${escapeHtml(target)}</span>
        <label class="manager-plan-qty-edit">
          <input type="number" class="plan-item-qty-input" min="1" step="1" inputmode="numeric" value="${item.quantity || 1}" aria-label="כמות מנות">
          <span>מנות לייצור</span>
        </label>`;
  } else if (isFlowStep) {
    bodyInner = `
        <span class="manager-plan-label">📋 ${escapeHtml(item.label)}</span>`;
  } else {
    bodyInner = `
        <span class="manager-plan-label">${escapeHtml(item.label)}</span>
        ${item.quantity ? `<span class="manager-plan-qty">× ${item.quantity}</span>` : ''}`;
  }
  return `
    <div class="manager-plan-item${item.done ? ' is-done' : ''}${isPortion ? ' manager-plan-item--portion' : ''}${isFlowStep ? ' manager-plan-item--flow-step' : ''}" data-id="${item.id}">
      <label class="manager-plan-check">
        <input type="checkbox" class="plan-item-done" ${item.done ? 'checked' : ''}>
      </label>
      <div class="manager-plan-body">${bodyInner}
        ${showDay ? `<span class="manager-plan-day">${dayLabels[item.dayOffset] || ''}</span>` : ''}
      </div>
      <button type="button" class="btn btn-danger btn-sm plan-item-del" title="הסר">🗑</button>
    </div>`;
}

function bindPlanItems(container, planType, anchorDate) {
  container.querySelectorAll('.plan-item-done').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const row = cb.closest('.manager-plan-item');
      try {
        await updateManagerPlanItem(row.dataset.id, { done: cb.checked });
        renderManager(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });
  container.querySelectorAll('.plan-item-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.manager-plan-item');
      if (!confirm('למחוק פריט?')) return;
      await deleteManagerPlanItem(row.dataset.id);
      showToast('נמחק');
      renderManager(container);
    });
  });

  container.querySelectorAll('.plan-item-qty-input').forEach((input) => {
    const saveQty = async () => {
      const row = input.closest('.manager-plan-item');
      try {
        await updateManagerPlanItem(row.dataset.id, { quantity: input.value });
        showToast('כמות עודכנה ✓');
      } catch (err) {
        showToast(err.message || 'שגיאה');
        renderManager(container);
      }
    };
    input.addEventListener('change', saveQty);
    input.addEventListener('blur', saveQty);
  });

  document.getElementById('save-plan-notes')?.addEventListener('click', async () => {
    try {
      await upsertManagerPlan({
        planType,
        anchorDate,
        notes: document.getElementById('plan-notes').value,
      });
      showToast('הערות נשמרו ✓');
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('add-plan-product')?.addEventListener('click', async () => {
    const productId = document.getElementById('plan-product').value;
    const qty = document.getElementById('plan-qty').value;
    const dayOffset = document.getElementById('plan-day')?.value ?? 0;
    if (!productId) return showToast('בחר מוצר');
    try {
      await addManagerPlanItem({
        planType, anchorDate, dayOffset: Number(dayOffset),
        itemKind: 'product', productId, quantity: qty || null,
      });
      showToast('נוסף ✓');
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('add-plan-text')?.addEventListener('click', async () => {
    const label = document.getElementById('plan-text').value.trim();
    const dayOffset = document.getElementById('plan-day')?.value ?? 0;
    if (!label) return showToast('הזן תיאור');
    try {
      await addManagerPlanItem({
        planType, anchorDate, dayOffset: Number(dayOffset),
        itemKind: 'text', label,
      });
      showToast('נוסף ✓');
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('add-plan-portion')?.addEventListener('click', async () => {
    const presetId = document.getElementById('plan-portion-preset')?.value;
    const qty = document.getElementById('plan-portion-qty')?.value;
    const targetType = document.getElementById('plan-portion-target')?.value || 'product';
    const dayOffset = document.getElementById('plan-day')?.value ?? 0;
    if (!presetId) return showToast('בחר מנה');
    try {
      await addManagerPlanItem({
        planType,
        anchorDate,
        dayOffset: Number(dayOffset),
        itemKind: 'portion',
        portionPresetId: presetId,
        quantity: qty,
        productId: targetType === 'product' ? document.getElementById('plan-portion-product')?.value : null,
        categoryId: targetType === 'category' ? document.getElementById('plan-portion-category')?.value : null,
      });
      showToast('מנה נוספה לתוכנית ✓');
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

async function renderDailyPlan(container) {
  const date = container.dataset.planDate || todayISO();
  const selectedFlowId = container.dataset.planFlowId || '';
  const [plan, items, products, categories, portionPresets, flowsOverview] = await Promise.all([
    getManagerPlan('daily', date),
    getManagerPlanItems('daily', date),
    getProducts(true),
    getCategories(),
    getAllFlowPortionPresetsWithContext(),
    getAllFlowsOverview(),
  ]);
  const flowSteps = selectedFlowId
    ? await getFlowStepsForFlow(selectedFlowId)
    : [];
  const planFlowStepIds = new Set(
    items.filter((i) => i.itemKind === 'flow_step' && i.flowStepId).map((i) => i.flowStepId)
  );
  const done = items.filter((i) => i.done).length;

  container.innerHTML = `
    ${managerTabsHTML('daily')}
    <div class="card">
      <div class="form-group">
        <label for="plan-date">תאריך</label>
        <input type="date" id="plan-date" value="${date}">
      </div>
      <p class="form-hint">${formatDateHebrew(date)} · ${done}/${items.length} הושלמו</p>
    </div>

    <div class="card">
      <div class="card-title">הערות / דגשים ליום</div>
      <textarea id="plan-notes" rows="3" placeholder="דגשים, הערות משמרת, הודעות לצוות...">${escapeHtml(plan?.notes || '')}</textarea>
      <button type="button" class="btn btn-secondary btn-sm" id="save-plan-notes" style="margin-top:8px">שמור הערות</button>
    </div>

    ${flowsOverview.length ? `
    <div class="card">
      <div class="card-title">📋 משימות מתזרים יצור</div>
      <p class="form-hint" style="margin-bottom:12px">בחר תזרים, סמן שלבים, והוסף לתוכנית היומית</p>
      <div class="form-group">
        <label for="plan-flow-pick">תזרים</label>
        <select id="plan-flow-pick">
          <option value="">בחר תזרים...</option>
          ${flowsOverview.map((f) => `
            <option value="${f.id}" ${String(f.id) === String(selectedFlowId) ? 'selected' : ''}>
              ${escapeHtml(f.name)} · ${escapeHtml(f.targetLabel)} (${f.stepCount} שלבים)
            </option>`).join('')}
        </select>
      </div>
      ${selectedFlowId && flowSteps.length ? `
      <div class="plan-flow-steps-list">
        ${flowSteps.map((step, i) => {
          const inPlan = planFlowStepIds.has(step.id);
          return `
          <label class="plan-flow-step-option${inPlan ? ' is-in-plan' : ''}">
            <input type="checkbox" class="plan-flow-step-cb" value="${step.id}" ${inPlan ? 'disabled checked' : ''}>
            <span class="plan-flow-step-num">${i + 1}</span>
            <span class="plan-flow-step-name">${escapeHtml(step.name)}${step.tracksPortions ? ' 🍽' : ''}</span>
            ${inPlan ? '<span class="plan-flow-step-badge">בתוכנית</span>' : ''}
          </label>`;
        }).join('')}
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="add-plan-flow-steps" style="width:100%;margin-top:10px">
        + הוסף נבחרות לתוכנית
      </button>` : selectedFlowId ? `
      <p class="form-hint">אין שלבים בתזרים — הגדר ב«תזרים» → «נהל תזרים»</p>` : `
      <p class="form-hint">בחר תזרים כדי לראות את השלבים</p>`}
    </div>` : `
    <div class="card">
      <div class="card-title">📋 משימות מתזרים יצור</div>
      <p class="form-hint">אין תזרימים — הגדר ב«תזרים» → «נהל תזרים»</p>
    </div>`}

    ${portionPresets.length ? `
    <div class="card">
      <div class="card-title">🍽 מנות לייצור</div>
      <p class="form-hint" style="margin-bottom:12px">בחר מנה מהרשימה (מ«נהל תזרים»), כמה מנות לייצור, ושייך למוצר או קטגוריה</p>
      <div class="form-group">
        <label for="plan-portion-preset">מנה</label>
        <select id="plan-portion-preset">
          <option value="">בחר מנה...</option>
          ${portionPresets.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} · ${p.weight} ק"ג${p.extra ? ` · ${p.extra}` : ''}${p.groupName ? ` (${p.groupName})` : ''}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="plan-portion-qty">כמה מנות לייצור</label>
        <input type="number" id="plan-portion-qty" min="1" step="1" inputmode="numeric" placeholder="10">
      </div>
      <div class="form-group">
        <label for="plan-portion-target">שיוך ל</label>
        <select id="plan-portion-target">
          <option value="product">מוצר</option>
          <option value="category">קטגוריה</option>
        </select>
      </div>
      <div class="form-group" id="plan-portion-product-wrap">
        <label for="plan-portion-product">מוצר</label>
        <select id="plan-portion-product">
          <option value="">בחר מוצר...</option>
          ${products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group hidden" id="plan-portion-category-wrap">
        <label for="plan-portion-category">קטגוריה</label>
        <select id="plan-portion-category">
          <option value="">בחר קטגוריה...</option>
          ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="add-plan-portion" style="width:100%">+ הוסף מנה לתוכנית</button>
    </div>` : `
    <div class="card">
      <div class="card-title">🍽 מנות לייצור</div>
      <p class="form-hint">אין מנות מוכנות — הגדר ב«תזרים» → «נהל תזרים» → «רשימת מנות מוכנות»</p>
    </div>`}

    <div class="card">
      <div class="card-title">הוסף לתוכנית</div>
      <div class="form-group">
        <label>מוצר לייצור</label>
        <div class="filter-row">
          <select id="plan-product" style="flex:1">
            <option value="">בחר מוצר...</option>
            ${products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
          </select>
          <input type="number" id="plan-qty" min="1" placeholder="כמות" style="width:80px">
          <button type="button" class="btn btn-primary btn-sm" id="add-plan-product">+</button>
        </div>
      </div>
      <div class="form-group">
        <label>משימה / פעולה</label>
        <div class="filter-row">
          <input type="text" id="plan-text" placeholder="לדוגמה: הכנת קרם שמנת" style="flex:1">
          <button type="button" class="btn btn-primary btn-sm" id="add-plan-text">+</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">פריטים בתוכנית (${items.length})</div>
      ${items.length
        ? items.map((item) => planItemRow(item)).join('')
        : '<p class="form-hint">אין פריטים — הוסף מוצרים או משימות</p>'}
    </div>`;

  bindManagerTabs(container);
  bindPlanItems(container, 'daily', date);

  document.getElementById('plan-portion-target')?.addEventListener('change', (e) => {
    const isProduct = e.target.value === 'product';
    document.getElementById('plan-portion-product-wrap')?.classList.toggle('hidden', !isProduct);
    document.getElementById('plan-portion-category-wrap')?.classList.toggle('hidden', isProduct);
  });

  document.getElementById('plan-date')?.addEventListener('change', (e) => {
    container.dataset.planDate = e.target.value;
    renderManager(container);
  });

  document.getElementById('plan-flow-pick')?.addEventListener('change', (e) => {
    container.dataset.planFlowId = e.target.value;
    renderManager(container);
  });

  document.getElementById('add-plan-flow-steps')?.addEventListener('click', async () => {
    const flowId = document.getElementById('plan-flow-pick')?.value;
    const stepIds = [...document.querySelectorAll('.plan-flow-step-cb:checked:not(:disabled)')]
      .map((cb) => Number(cb.value));
    if (!flowId) return showToast('בחר תזרים');
    if (!stepIds.length) return showToast('סמן לפחות משימה אחת');
    try {
      const n = await addManagerPlanFlowSteps({
        planType: 'daily',
        anchorDate: date,
        flowId,
        stepIds,
      });
      showToast(`${n} משימות נוספו ✓`);
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

async function renderWeeklyPlan(container) {
  const weekStart = weekStartISO(container.dataset.weekStart || todayISO());
  const dayLabels = weekDayLabels();
  const [plan, items, products] = await Promise.all([
    getManagerPlan('weekly', weekStart),
    getManagerPlanItems('weekly', weekStart),
    getProducts(true),
  ]);
  const weekEnd = addDaysISO(weekStart, 6);

  container.innerHTML = `
    ${managerTabsHTML('weekly')}
    <div class="card">
      <div class="form-group">
        <label for="week-start">שבוע (מתחיל ביום שני)</label>
        <input type="date" id="week-start" value="${weekStart}">
      </div>
      <p class="form-hint">${formatDate(weekStart)} — ${formatDate(weekEnd)}</p>
    </div>

    <div class="card">
      <div class="card-title">מטרות השבוע</div>
      <textarea id="plan-notes" rows="3" placeholder="יעדים, אירועים, הזמנות גדולות...">${escapeHtml(plan?.notes || '')}</textarea>
      <button type="button" class="btn btn-secondary btn-sm" id="save-plan-notes" style="margin-top:8px">שמור</button>
    </div>

    <div class="card">
      <div class="card-title">הוסף לתוכנית שבועית</div>
      <div class="form-group">
        <label>יום</label>
        <select id="plan-day">
          ${dayLabels.map((label, i) => `<option value="${i}">${label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>מוצר</label>
        <div class="filter-row">
          <select id="plan-product" style="flex:1">
            <option value="">בחר מוצר...</option>
            ${products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
          </select>
          <input type="number" id="plan-qty" min="1" placeholder="כמות" style="width:80px">
          <button type="button" class="btn btn-primary btn-sm" id="add-plan-product">+</button>
        </div>
      </div>
      <div class="form-group">
        <label>משימה</label>
        <div class="filter-row">
          <input type="text" id="plan-text" placeholder="משימה ליום" style="flex:1">
          <button type="button" class="btn btn-primary btn-sm" id="add-plan-text">+</button>
        </div>
      </div>
    </div>

    ${dayLabels.map((label, dayOffset) => {
      const dayItems = items.filter((i) => i.dayOffset === dayOffset);
      if (!dayItems.length) return '';
      return `
        <div class="card">
          <div class="card-title">${label} · ${formatDate(addDaysISO(weekStart, dayOffset))}</div>
          ${dayItems.map((item) => planItemRow(item)).join('')}
        </div>`;
    }).join('')}

    ${items.length === 0 ? '<div class="card"><p class="form-hint">אין פריטים בשבוע זה</p></div>' : ''}`;

  bindManagerTabs(container);
  bindPlanItems(container, 'weekly', weekStart);
  document.getElementById('week-start')?.addEventListener('change', (e) => {
    container.dataset.weekStart = weekStartISO(e.target.value);
    renderManager(container);
  });
}

function taskRow(task) {
  return `
    <div class="manager-task-item manager-task-${task.status}" data-id="${task.id}">
      <button type="button" class="manager-task-status" data-action="cycle" title="שנה סטטוס">
        ${task.status === 'done' ? '✅' : task.status === 'progress' ? '🔄' : '⬜'}
      </button>
      <div class="manager-task-body">
        <div class="manager-task-title">${escapeHtml(task.title)}</div>
        ${task.body ? `<div class="manager-task-desc">${escapeHtml(task.body)}</div>` : ''}
        <div class="manager-task-meta">
          <span class="manager-priority manager-priority-${task.priority}">${PRIORITY_LABELS[task.priority]}</span>
          <span>${deptIcon(task.department)} ${deptLabel(task.department)}</span>
          <span>${STATUS_LABELS[task.status]}</span>
          ${task.dueDate ? `<span>עד ${formatDate(task.dueDate)}</span>` : ''}
        </div>
      </div>
      <div class="manager-task-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-action="edit">✏️</button>
        <button type="button" class="btn btn-danger btn-sm" data-action="delete">🗑</button>
      </div>
    </div>`;
}

function bindTaskList(container, kind) {
  container.querySelectorAll('.manager-task-item').forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-action="cycle"]')?.addEventListener('click', async () => {
      const task = await getManagerTasks();
      const t = task.find((x) => x.id === id);
      if (!t) return;
      const next = t.status === 'open' ? 'progress' : t.status === 'progress' ? 'done' : 'open';
      await updateManagerTask(id, { status: next });
      renderManager(container);
    });
    row.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
      openTaskModal(container, kind, id);
    });
    row.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      if (!confirm('למחוק?')) return;
      await deleteManagerTask(id);
      showToast('נמחק');
      renderManager(container);
    });
  });
}

function openTaskModal(container, kind, taskId = null) {
  const isImprovement = kind === 'improvement';
  openModal({
    title: taskId ? 'עריכה' : (isImprovement ? 'נקודת שיפור' : 'משימה חדשה'),
    bodyHTML: `<div id="task-modal-loading">טוען...</div>`,
    footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-task">שמור</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  (async () => {
    let task = null;
    if (taskId) {
      const all = await getManagerTasks();
      task = all.find((t) => t.id === taskId);
    }
    document.getElementById('task-modal-loading').outerHTML = `
      <div class="form-group"><label>כותרת</label><input type="text" id="task-title" value="${escapeHtml(task?.title || '')}"></div>
      <div class="form-group"><label>תיאור</label><textarea id="task-body" rows="3">${escapeHtml(task?.body || '')}</textarea></div>
      <div class="form-group"><label>מחלקה</label><select id="task-dept">${deptOptions(task?.department || 'production')}</select></div>
      <div class="form-group"><label>עדיפות</label>
        <select id="task-priority">
          <option value="low" ${task?.priority === 'low' ? 'selected' : ''}>נמוך</option>
          <option value="medium" ${!task || task.priority === 'medium' ? 'selected' : ''}>בינוני</option>
          <option value="high" ${task?.priority === 'high' ? 'selected' : ''}>גבוה</option>
        </select>
      </div>
      <div class="form-group"><label>תאריך יעד</label><input type="date" id="task-due" value="${task?.dueDate || ''}"></div>`;

    document.getElementById('save-task')?.addEventListener('click', async () => {
      const payload = {
        title: document.getElementById('task-title').value,
        body: document.getElementById('task-body').value,
        department: document.getElementById('task-dept').value,
        priority: document.getElementById('task-priority').value,
        dueDate: document.getElementById('task-due').value || null,
      };
      try {
        if (taskId) {
          await updateManagerTask(taskId, payload);
        } else {
          await addManagerTask({ ...payload, kind: isImprovement ? 'improvement' : 'task' });
        }
        closeModal();
        showToast('נשמר ✓');
        container.dataset.managerTab = isImprovement ? 'improvements' : 'tasks';
        renderManager(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  })();
}

async function renderTaskList(container, kind) {
  const tab = kind === 'improvement' ? 'improvements' : 'tasks';
  const deptFilter = container.dataset.deptFilter || '';
  const tasks = await getManagerTasks({ kind, department: deptFilter || undefined });
  const openCount = tasks.filter((t) => t.status !== 'done').length;

  container.innerHTML = `
    ${managerTabsHTML(tab, { [tab]: openCount || null })}
    <div class="card">
      <div class="filter-row" style="margin-bottom:0">
        <select id="dept-filter" style="flex:1">
          <option value="">כל המחלקות</option>
          ${deptOptions(deptFilter)}
        </select>
        <button type="button" class="btn btn-primary btn-sm" id="add-task-btn">+ ${kind === 'improvement' ? 'שיפור' : 'משימה'}</button>
      </div>
    </div>
    ${tasks.length
      ? tasks.map((t) => taskRow(t)).join('')
      : `<div class="card"><p class="form-hint">אין ${kind === 'improvement' ? 'נקודות שיפור' : 'משימות'} — לחץ + להוספה</p></div>`}`;

  bindManagerTabs(container);
  bindTaskList(container, kind);
  document.getElementById('dept-filter')?.addEventListener('change', (e) => {
    container.dataset.deptFilter = e.target.value;
    renderManager(container);
  });
  document.getElementById('add-task-btn')?.addEventListener('click', () => openTaskModal(container, kind));
}

function incidentRow(inc) {
  return `
    <div class="manager-incident-item manager-incident-${inc.severity}" data-id="${inc.id}">
      <div class="manager-incident-header">
        <span class="manager-severity manager-severity-${inc.severity}">${SEVERITY_LABELS[inc.severity]}</span>
        <strong>${escapeHtml(inc.title)}</strong>
        <span class="manager-incident-status">${INCIDENT_STATUS_LABELS[inc.status]}</span>
      </div>
      ${inc.description ? `<p class="manager-incident-desc">${escapeHtml(inc.description)}</p>` : ''}
      <div class="manager-task-meta">
        <span>${deptIcon(inc.department)} ${deptLabel(inc.department)}</span>
        <span>${formatDate(inc.occurredAt)}</span>
      </div>
      ${inc.resolution ? `<p class="manager-incident-resolution"><strong>טיפול:</strong> ${escapeHtml(inc.resolution)}</p>` : ''}
      <div class="manager-task-actions" style="margin-top:8px">
        <button type="button" class="btn btn-secondary btn-sm" data-action="edit">✏️</button>
        <button type="button" class="btn btn-danger btn-sm" data-action="delete">🗑</button>
      </div>
    </div>`;
}

function openIncidentModal(container, incidentId = null) {
  openModal({
    title: incidentId ? 'עריכת תקלה' : 'דיווח תקלה / מחדל',
    bodyHTML: `<div id="inc-modal-loading">טוען...</div>`,
    footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-incident">שמור</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  (async () => {
    let inc = null;
    if (incidentId) {
      const all = await getManagerIncidents();
      inc = all.find((i) => i.id === incidentId);
    }
    document.getElementById('inc-modal-loading').outerHTML = `
      <div class="form-group"><label>כותרת</label><input type="text" id="inc-title" value="${escapeHtml(inc?.title || '')}"></div>
      <div class="form-group"><label>תיאור</label><textarea id="inc-desc" rows="3" placeholder="מה קרה? מה ההשפעה?">${escapeHtml(inc?.description || '')}</textarea></div>
      <div class="form-group"><label>מחלקה</label><select id="inc-dept">${deptOptions(inc?.department || 'production')}</select></div>
      <div class="form-group"><label>חומרה</label>
        <select id="inc-severity">
          <option value="minor" ${!inc || inc.severity === 'minor' ? 'selected' : ''}>קל</option>
          <option value="major" ${inc?.severity === 'major' ? 'selected' : ''}>חמור</option>
          <option value="critical" ${inc?.severity === 'critical' ? 'selected' : ''}>קריטי</option>
        </select>
      </div>
      <div class="form-group"><label>תאריך</label><input type="date" id="inc-date" value="${inc?.occurredAt || todayISO()}"></div>
      ${inc ? `
      <div class="form-group"><label>סטטוס</label>
        <select id="inc-status">
          <option value="open" ${inc.status === 'open' ? 'selected' : ''}>פתוח</option>
          <option value="investigating" ${inc.status === 'investigating' ? 'selected' : ''}>בבדיקה</option>
          <option value="resolved" ${inc.status === 'resolved' ? 'selected' : ''}>טופל</option>
        </select>
      </div>
      <div class="form-group"><label>טיפול / פעולה</label><textarea id="inc-resolution" rows="2">${escapeHtml(inc.resolution || '')}</textarea></div>
      <div class="form-group"><label>פעולה מנעתית</label><textarea id="inc-action" rows="2">${escapeHtml(inc.actionTaken || '')}</textarea></div>` : ''}`;

    document.getElementById('save-incident')?.addEventListener('click', async () => {
      try {
        if (incidentId) {
          await updateManagerIncident(incidentId, {
            title: document.getElementById('inc-title').value,
            description: document.getElementById('inc-desc').value,
            severity: document.getElementById('inc-severity').value,
            occurredAt: document.getElementById('inc-date').value,
            status: document.getElementById('inc-status')?.value,
            resolution: document.getElementById('inc-resolution')?.value,
            actionTaken: document.getElementById('inc-action')?.value,
          });
        } else {
          await addManagerIncident({
            title: document.getElementById('inc-title').value,
            description: document.getElementById('inc-desc').value,
            department: document.getElementById('inc-dept').value,
            severity: document.getElementById('inc-severity').value,
            occurredAt: document.getElementById('inc-date').value,
          });
        }
        closeModal();
        showToast('נשמר ✓');
        container.dataset.managerTab = 'incidents';
        renderManager(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  })();
}

async function renderIncidents(container) {
  const deptFilter = container.dataset.deptFilter || '';
  const incidents = await getManagerIncidents({ department: deptFilter || undefined });
  const openCount = incidents.filter((i) => i.status !== 'resolved').length;

  container.innerHTML = `
    ${managerTabsHTML('incidents', { incidents: openCount || null })}
    <div class="card">
      <div class="filter-row" style="margin-bottom:0">
        <select id="dept-filter" style="flex:1">
          <option value="">כל המחלקות</option>
          ${deptOptions(deptFilter)}
        </select>
        <button type="button" class="btn btn-primary btn-sm" id="add-incident">+ דווח תקלה</button>
      </div>
    </div>
    ${incidents.length
      ? incidents.map((i) => incidentRow(i)).join('')
      : '<div class="card"><p class="form-hint">אין תקלות רשומות</p></div>'}`;

  bindManagerTabs(container);
  container.querySelectorAll('.manager-incident-item').forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-action="edit"]')?.addEventListener('click', () => openIncidentModal(container, id));
    row.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      if (!confirm('למחוק?')) return;
      await deleteManagerIncident(id);
      showToast('נמחק');
      renderManager(container);
    });
  });
  document.getElementById('dept-filter')?.addEventListener('change', (e) => {
    container.dataset.deptFilter = e.target.value;
    renderManager(container);
  });
  document.getElementById('add-incident')?.addEventListener('click', () => openIncidentModal(container));
}

async function renderNotes(container) {
  const date = container.dataset.notesDate || todayISO();
  const notes = await getManagerShiftNotes(date);

  container.innerHTML = `
    ${managerTabsHTML('notes')}
    <div class="card">
      <div class="form-group">
        <label for="notes-date">תאריך</label>
        <input type="date" id="notes-date" value="${date}">
      </div>
      <p class="form-hint">${formatDateHebrew(date)}</p>
    </div>

    <div class="card">
      <div class="card-title">הוסף הערה</div>
      <div class="form-group">
        <label>סוג</label>
        <select id="note-kind">
          <option value="shift">העברת משמרת</option>
          <option value="briefing">דגשים / תדריך</option>
          <option value="checklist">רשימת ביקורת</option>
        </select>
      </div>
      <div class="form-group">
        <label>מחלקה</label>
        <select id="note-dept">${deptOptions('general')}</select>
      </div>
      <div class="form-group">
        <label>תוכן</label>
        <textarea id="note-content" rows="3" placeholder="מה חשוב שהמשמרת הבאה תדע?"></textarea>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="add-note">שמור הערה</button>
    </div>

    ${notes.length ? notes.map((n) => `
      <div class="card manager-note-card">
        <div class="manager-note-header">
          <span class="manager-note-kind">${n.kind === 'briefing' ? '📢 דגשים' : n.kind === 'checklist' ? '☑️ ביקורת' : '🔄 משמרת'}</span>
          <span>${deptIcon(n.department)} ${deptLabel(n.department)}</span>
          <button type="button" class="btn btn-danger btn-sm note-del" data-id="${n.id}">🗑</button>
        </div>
        <p class="manager-note-body">${escapeHtml(n.content)}</p>
      </div>`).join('') : '<div class="card"><p class="form-hint">אין הערות לתאריך זה</p></div>'}`;

  bindManagerTabs(container);
  document.getElementById('notes-date')?.addEventListener('change', (e) => {
    container.dataset.notesDate = e.target.value;
    renderManager(container);
  });
  document.getElementById('add-note')?.addEventListener('click', async () => {
    try {
      await addManagerShiftNote({
        date,
        department: document.getElementById('note-dept').value,
        kind: document.getElementById('note-kind').value,
        content: document.getElementById('note-content').value,
      });
      showToast('נשמר ✓');
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
  container.querySelectorAll('.note-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק?')) return;
      await deleteManagerShiftNote(Number(btn.dataset.id));
      showToast('נמחק');
      renderManager(container);
    });
  });
}

async function renderTeam(container) {
  const [areas, employees, departments] = await Promise.all([
    getManagerResponsibilityAreas(),
    getManagerEmployees(),
    getManagerDepartments(),
  ]);
  managerDeptsCache = departments;
  const areaMap = new Map(areas.map((a) => [a.id, a.name]));

  container.innerHTML = `
    ${managerTabsHTML('team')}
    <div class="card">
      <div class="card-title">מחלקות</div>
      <p class="form-hint" style="margin-bottom:10px">הגדר מחלקות לשיוך משימות, תקלות והערות משמרת</p>
      <div class="filter-row" style="margin-bottom:8px">
        <input type="text" id="new-dept-name" placeholder="שם מחלקה חדשה" style="flex:1">
        <input type="text" id="new-dept-icon" placeholder="אייקון" value="📋" maxlength="4" style="width:4rem;text-align:center">
        <button type="button" class="btn btn-primary btn-sm" id="add-dept-btn">+ הוסף</button>
      </div>
      ${departments.length ? `
        <ul class="manager-area-list">
          ${departments.map((d) => `
            <li class="manager-area-item manager-dept-item${d.isBuiltin ? ' manager-dept-item--builtin' : ''}" data-id="${d.id}">
              <span class="manager-dept-icon">${d.icon}</span>
              <span class="manager-area-name">${escapeHtml(d.label)}</span>
              ${d.isBuiltin ? '<span class="form-hint" style="margin:0;font-size:0.72rem">ברירת מחדל</span>' : `
                <button type="button" class="btn btn-secondary btn-sm dept-edit" data-id="${d.id}" data-label="${escapeHtml(d.label)}" data-icon="${d.icon}" title="ערוך">✏️</button>
                <button type="button" class="btn btn-danger btn-sm dept-del" data-id="${d.id}" title="מחק">🗑</button>`}
            </li>`).join('')}
        </ul>` : '<p class="form-hint">אין מחלקות</p>'}
    </div>

    <div class="card">
      <div class="card-title">תחומי אחריות</div>
      <p class="form-hint" style="margin-bottom:10px">הגדר תחומים (למשל: אפייה, קישוט, אריזה) ושייך לכל עובד</p>
      <div class="filter-row" style="margin-bottom:12px">
        <input type="text" id="new-area-name" placeholder="שם תחום חדש" style="flex:1">
        <button type="button" class="btn btn-primary btn-sm" id="add-area-btn">+ הוסף</button>
      </div>
      ${areas.length ? `
        <ul class="manager-area-list">
          ${areas.map((a) => `
            <li class="manager-area-item" data-id="${a.id}">
              <span class="manager-area-name">${escapeHtml(a.name)}</span>
              <button type="button" class="btn btn-danger btn-sm area-del" data-id="${a.id}" title="מחק">🗑</button>
            </li>`).join('')}
        </ul>` : '<p class="form-hint">אין תחומים — הוסף את הראשון</p>'}
    </div>

    <div class="card">
      <div class="card-title">עובדים (${employees.length})</div>
      <div class="form-group">
        <label for="new-emp-name">שם עובד</label>
        <input type="text" id="new-emp-name" placeholder="לדוגמה: יוסי">
      </div>
      <div class="form-group">
        <label for="new-emp-area">תחום אחריות</label>
        <select id="new-emp-area">
          <option value="">ללא / כללי</option>
          ${areas.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
        </select>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="add-emp-btn" style="width:100%;margin-bottom:16px">+ הוסף עובד</button>
      ${employees.length ? employees.map((emp) => `
        <div class="manager-employee-item${emp.active === false ? ' is-inactive' : ''}" data-id="${emp.id}">
          <div class="manager-employee-main">
            <strong>${escapeHtml(emp.name)}</strong>
            <span class="manager-employee-area">${escapeHtml(areaMap.get(emp.responsibilityAreaId) || 'כללי')}</span>
          </div>
          <div class="manager-employee-actions">
            <select class="emp-area-select" data-id="${emp.id}">
              <option value="">כללי</option>
              ${areas.map((a) => `<option value="${a.id}" ${emp.responsibilityAreaId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-secondary btn-sm emp-toggle" data-id="${emp.id}">${emp.active === false ? '✅' : '🚫'}</button>
            <button type="button" class="btn btn-danger btn-sm emp-del" data-id="${emp.id}">🗑</button>
          </div>
        </div>`).join('') : '<p class="form-hint">אין עובדים רשומים</p>'}
    </div>`;

  bindManagerTabs(container);

  document.getElementById('add-dept-btn')?.addEventListener('click', async () => {
    try {
      await addManagerDepartment({
        label: document.getElementById('new-dept-name')?.value,
        icon: document.getElementById('new-dept-icon')?.value,
      });
      showToast('מחלקה נוספה ✓');
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.dept-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal({
        title: 'עריכת מחלקה',
        bodyHTML: `
          <div class="form-group"><label>שם</label><input type="text" id="edit-dept-name" value="${btn.dataset.label}"></div>
          <div class="form-group"><label>אייקון</label><input type="text" id="edit-dept-icon" value="${btn.dataset.icon}" maxlength="4"></div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-dept">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('save-dept')?.addEventListener('click', async () => {
        try {
          await updateManagerDepartment(btn.dataset.id, {
            label: document.getElementById('edit-dept-name').value,
            icon: document.getElementById('edit-dept-icon').value,
          });
          closeModal();
          showToast('עודכן ✓');
          renderManager(container);
        } catch (err) {
          showToast(err.message || 'שגיאה');
        }
      });
    });
  });

  container.querySelectorAll('.dept-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק מחלקה?')) return;
      try {
        await deleteManagerDepartment(btn.dataset.id);
        showToast('נמחק');
        renderManager(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.getElementById('add-area-btn')?.addEventListener('click', async () => {
    try {
      await addManagerResponsibilityArea(document.getElementById('new-area-name').value);
      showToast('תחום נוסף ✓');
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.area-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק תחום אחריות?')) return;
      try {
        await deleteManagerResponsibilityArea(btn.dataset.id);
        showToast('נמחק');
        renderManager(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.getElementById('add-emp-btn')?.addEventListener('click', async () => {
    try {
      await addManagerEmployee({
        name: document.getElementById('new-emp-name').value,
        responsibilityAreaId: document.getElementById('new-emp-area').value || null,
      });
      showToast('עובד נוסף ✓');
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.emp-area-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await updateManagerEmployee(sel.dataset.id, { responsibilityAreaId: sel.value || null });
        showToast('עודכן ✓');
      } catch (err) {
        showToast(err.message || 'שגיאה');
        renderManager(container);
      }
    });
  });

  container.querySelectorAll('.emp-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.manager-employee-item');
      const active = row?.classList.contains('is-inactive');
      try {
        await updateManagerEmployee(btn.dataset.id, { active });
        showToast(active ? 'הופעל ✓' : 'הושבת');
        renderManager(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.emp-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק עובד?')) return;
      await deleteManagerEmployee(btn.dataset.id);
      showToast('נמחק');
      renderManager(container);
    });
  });
}

export async function renderManager(container) {
  await loadManagerDepartments();
  const tab = container.dataset.managerTab || 'overview';

  if (tab === 'targets') {
    container.innerHTML = managerTabsHTML('targets');
    bindManagerTabs(container);
    const inner = document.createElement('div');
    inner.className = 'manager-targets-embed';
    container.appendChild(inner);
    await renderTargets(inner);
    return;
  }

  switch (tab) {
    case 'daily': return renderDailyPlan(container);
    case 'weekly': return renderWeeklyPlan(container);
    case 'team': return renderTeam(container);
    case 'tasks': return renderTaskList(container, 'task');
    case 'improvements': return renderTaskList(container, 'improvement');
    case 'incidents': return renderIncidents(container);
    case 'notes': return renderNotes(container);
    default: return renderOverview(container);
  }
}

export function managerMeta() {
  const { year, month } = currentMonth();
  return { title: 'ניהול מנהל', subtitle: monthLabel(year, month) };
}
