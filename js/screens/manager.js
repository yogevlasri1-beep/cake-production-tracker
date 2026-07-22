import {
  getManagerDepartments, addManagerDepartment, updateManagerDepartment, deleteManagerDepartment,
  getProducts, getProductsCatalogLayout,
  getManagerPlan, upsertManagerPlan, getManagerPlanItems,
  addManagerPlanItem, addManagerPlanProductWithChecklists, addManagerPlanFlowChecklists,
  updateManagerPlanItem, deleteManagerPlanItem, clearManagerPlanItems, deleteManagerPlanItemsByKind,
  importActiveRunToDailyPlan, resolveFlowsForProduct,
  getPortionPresetsForProduct, getAllFlowsOverview, getFlowStepsForFlow,
  collectPlanProductFlowsForExport,
  getActiveProductionRuns, ensureRunPreparationChecks, ensureRunCleaningChecks,
  getManagerTasks, addManagerTask, updateManagerTask, deleteManagerTask, setImprovementOrder,
  getManagerIncidents, addManagerIncident, updateManagerIncident, deleteManagerIncident,
  getManagerShiftNotes, addManagerShiftNote, deleteManagerShiftNote,
  getManagerDashboardStats,
  getManagerResponsibilityAreas, addManagerResponsibilityArea, updateManagerResponsibilityArea, deleteManagerResponsibilityArea,
  getManagerEmployees, addManagerEmployee, updateManagerEmployee, deleteManagerEmployee,
  getDepartmentCleaningLists, getDepartmentCleaningTasks,
  addDepartmentCleaningList, updateDepartmentCleaningList, deleteDepartmentCleaningList,
  addDepartmentCleaningTask, updateDepartmentCleaningTask, deleteDepartmentCleaningTask, setDepartmentCleaningTaskOrder,
} from '../db.js?v=347';
import {
  todayISO, formatDate, formatDateHebrew, escapeHtml, showToast,
  weekStartISO, weekDayLabels, addDaysISO, progressBar, currentMonth, monthLabel, formatDecimal,
} from '../utils.js?v=347';
import { openModal, closeModal } from '../modal.js?v=347';
import { renderTargets } from './targets.js?v=347';
import { renderPurchasingInManager } from './purchasing.js?v=347';
import { forceAppUpdate } from '../sw-register.js?v=347';
import { bindFlowChecklistDragLists, bindImprovementDragLists } from '../product-drag.js?v=347';
import {
  buildDailyPlanExportHtml, organizeDailyPlanForExport,
  buildDailyPlanBodyHtml, buildDailyPlanFlowsPageHtml, saveDailyPlanAsHtml, printDailyPlanHtml,
} from '../daily-plan-export.js?v=347';

function syncManagerPlanNavigation(container) {
  const today = todayISO();
  if (container.dataset.planDate && container.dataset.planDate < today) {
    container.dataset.planDate = today;
  }
  const storedWeek = container.dataset.weekStart;
  if (storedWeek && addDaysISO(storedWeek, 6) < today) {
    container.dataset.weekStart = weekStartISO(today);
    delete container.dataset.planWeekDay;
  }
}

const TABS = [
  { id: 'overview', label: 'סקירה', icon: '📊' },
  { id: 'daily', label: 'תוכנית יומית', icon: '📅' },
  { id: 'weekly', label: 'תוכנית שבועית', icon: '🗓' },
  { id: 'team', label: 'צוות', icon: '👥' },
  { id: 'cleaning', label: 'ניקוי מחלקות', icon: '🧹' },
  { id: 'tasks', label: 'משימות', icon: '✅' },
  { id: 'improvements', label: 'שיפור העסק', icon: '💡' },
  { id: 'purchasing', label: 'רכישות לשיפור העסק', icon: '🛒' },
  { id: 'incidents', label: 'תקלות', icon: '⚠️' },
  { id: 'notes', label: 'משמרות', icon: '📝' },
  { id: 'targets', label: 'יעדים', icon: '🎯' },
];

const ACTIVE_RUNS_HIDDEN_KEY = 'yitzurActiveRunsHidden';
const ACTIVE_RUNS_DISMISSED_KEY = 'yitzurActiveRunsDismissed';

function getActiveRunsHidden() {
  return localStorage.getItem(ACTIVE_RUNS_HIDDEN_KEY) === '1';
}

function setActiveRunsHidden(hidden) {
  localStorage.setItem(ACTIVE_RUNS_HIDDEN_KEY, hidden ? '1' : '0');
}

function getDismissedRunIds() {
  try {
    return new Set((JSON.parse(localStorage.getItem(ACTIVE_RUNS_DISMISSED_KEY) || '[]')).map(Number));
  } catch {
    return new Set();
  }
}

function setDismissedRunIds(set) {
  localStorage.setItem(ACTIVE_RUNS_DISMISSED_KEY, JSON.stringify([...set]));
}

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
  syncManagerPlanNavigation(container);
  const today = todayISO();
  const stats = await getManagerDashboardStats(today);
  const [allTasks, allIncidents, rawPlanItems] = await Promise.all([
    getManagerTasks(),
    getManagerIncidents(),
    getManagerPlanItems('daily', today),
  ]);
  const planItems = rawPlanItems.filter((i) => i.anchorDate === today);
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
            <span>${item.itemKind === 'portion' ? '🍽 ' : item.itemKind === 'flow_step' ? '📋 ' : item.itemKind === 'flow_preparation' ? '✅ ' : item.itemKind === 'flow_cleaning' ? '🧹 ' : item.itemKind === 'product' ? '📦 ' : ''}${escapeHtml(item.label)}${item.portionName && item.itemKind === 'product' ? ` · ${escapeHtml(item.portionName)}` : ''}${item.quantity ? ` · ${formatDecimal(item.quantity)}${item.itemKind === 'portion' || item.portionPresetId ? ' מנות' : ''}` : ''}</span>
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
  container.querySelector('[data-quick="improvement"]')?.addEventListener('click', () => {
    container.dataset.managerTab = 'improvements';
    openImprovementModal(container);
  });
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

function comparePlanCategories(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

function resolvePlanItemCategory(item, catMap, productMap) {
  if (item.categoryId) {
    const cat = catMap.get(Number(item.categoryId));
    return {
      categoryId: Number(item.categoryId),
      categoryGroupId: cat?.groupId ? Number(cat.groupId) : (item.categoryGroupId ? Number(item.categoryGroupId) : null),
    };
  }
  if (item.productId) {
    const prod = productMap.get(Number(item.productId));
    if (prod) {
      const cat = catMap.get(prod.categoryId);
      return { categoryId: prod.categoryId, categoryGroupId: cat?.groupId ? Number(cat.groupId) : null };
    }
  }
  if (item.categoryGroupId) {
    return { categoryId: null, categoryGroupId: Number(item.categoryGroupId) };
  }
  return { categoryId: null, categoryGroupId: null };
}

function renderGroupedPlanItemsHTML(items, layout, products) {
  if (!items.length) {
    return '<p class="form-hint">אין פריטים — הוסף מוצרים או משימות</p>';
  }
  const catMap = new Map(layout.allCategories.map((c) => [c.id, c]));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const byCat = new Map();
  const byGroup = new Map();
  const other = [];

  for (const item of items) {
    const { categoryId, categoryGroupId } = resolvePlanItemCategory(item, catMap, productMap);
    if (categoryId) {
      if (!byCat.has(categoryId)) byCat.set(categoryId, []);
      byCat.get(categoryId).push(item);
    } else if (categoryGroupId) {
      if (!byGroup.has(categoryGroupId)) byGroup.set(categoryGroupId, []);
      byGroup.get(categoryGroupId).push(item);
    } else {
      other.push(item);
    }
  }

  const sections = [];
  for (const group of layout.groups) {
    for (const cat of group.categories.slice().sort(comparePlanCategories)) {
      const catItems = byCat.get(cat.id);
      if (!catItems?.length) continue;
      sections.push(`
        <div class="manager-plan-category-section">
          <div class="manager-plan-category-heading">${escapeHtml(group.name)} › ${escapeHtml(cat.name)}</div>
          ${catItems.map((item) => planItemRow(item)).join('')}
        </div>`);
    }
    const groupItems = byGroup.get(group.id);
    if (groupItems?.length) {
      sections.push(`
        <div class="manager-plan-category-section">
          <div class="manager-plan-category-heading">${escapeHtml(group.name)}</div>
          ${groupItems.map((item) => planItemRow(item)).join('')}
        </div>`);
    }
  }
  for (const cat of layout.ungrouped.slice().sort(comparePlanCategories)) {
    const catItems = byCat.get(cat.id);
    if (!catItems?.length) continue;
    sections.push(`
      <div class="manager-plan-category-section">
        <div class="manager-plan-category-heading">${escapeHtml(cat.name)}</div>
        ${catItems.map((item) => planItemRow(item)).join('')}
      </div>`);
  }
  if (other.length) {
    sections.push(`
      <div class="manager-plan-category-section">
        <div class="manager-plan-category-heading">כללי</div>
        ${other.map((item) => planItemRow(item)).join('')}
      </div>`);
  }
  return sections.join('');
}

function renderPlanProductSelectHTML(products, layout) {
  const blocks = [];
  for (const group of layout.groups) {
    for (const cat of group.categories.slice().sort(comparePlanCategories)) {
      const catProducts = products.filter((p) => p.categoryId === cat.id);
      if (!catProducts.length) continue;
      blocks.push(`<optgroup label="${escapeHtml(`${group.name} › ${cat.name}`)}">
        ${catProducts.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
      </optgroup>`);
    }
  }
  for (const cat of layout.ungrouped.slice().sort(comparePlanCategories)) {
    const catProducts = products.filter((p) => p.categoryId === cat.id);
    if (!catProducts.length) continue;
    blocks.push(`<optgroup label="${escapeHtml(cat.name)}">
      ${catProducts.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
    </optgroup>`);
  }
  return blocks.join('');
}

function checklistDedupeKey(item) {
  if (item.itemKind === 'flow_preparation') {
    return `prep:${item.flowId || ''}:${item.flowPreparationId || item.label}`;
  }
  if (item.itemKind === 'flow_cleaning') {
    return `clean:${item.flowId || ''}:${item.flowCleaningTaskId || item.label}`;
  }
  return `other:${item.id}`;
}

const PLAN_COLLAPSE_STORAGE = 'manager-daily-plan-collapse-v1';
const PLAN_DAILY_MODE_KEY = 'manager-daily-plan-mode';

function getPlanCollapseState() {
  try {
    return JSON.parse(sessionStorage.getItem(PLAN_COLLAPSE_STORAGE) || '{}');
  } catch {
    return {};
  }
}

function isPlanSectionOpen(key, defaultOpen = true) {
  const state = getPlanCollapseState();
  if (state[key] == null) return defaultOpen;
  return !!state[key];
}

function setPlanSectionOpen(key, open) {
  const state = getPlanCollapseState();
  state[key] = !!open;
  try {
    sessionStorage.setItem(PLAN_COLLAPSE_STORAGE, JSON.stringify(state));
  } catch { /* ignore */ }
}

function getDailyPlanMode(container, { hasItems = false } = {}) {
  const fromDom = container.dataset.dailyPlanMode;
  if (fromDom === 'build' || fromDom === 'ready') return fromDom;
  try {
    const saved = sessionStorage.getItem(PLAN_DAILY_MODE_KEY);
    if (saved === 'build' || saved === 'ready') return saved;
  } catch { /* ignore */ }
  return hasItems ? 'ready' : 'build';
}

function setDailyPlanMode(container, mode) {
  const next = mode === 'ready' ? 'ready' : 'build';
  container.dataset.dailyPlanMode = next;
  try {
    sessionStorage.setItem(PLAN_DAILY_MODE_KEY, next);
  } catch { /* ignore */ }
}

function renderDailyPlanModeTabs(mode, { itemCount = 0 } = {}) {
  return `
    <div class="manager-daily-mode-tabs">
      <button type="button" class="manager-daily-mode-tab${mode === 'build' ? ' is-active' : ''}" data-daily-mode="build">
        🛠️ בניית תוכנית
      </button>
      <button type="button" class="manager-daily-mode-tab${mode === 'ready' ? ' is-active' : ''}" data-daily-mode="ready">
        📋 תוכנית מוכנה${itemCount ? ` (${itemCount})` : ''}
      </button>
    </div>`;
}

function renderCollapsiblePlanSection(key, titleHtml, bodyHtml, {
  defaultOpen = true,
  count = null,
  className = '',
  summaryClass = 'manager-plan-section-title manager-plan-collapse-summary',
} = {}) {
  const open = isPlanSectionOpen(key, defaultOpen);
  const countBadge = count != null
    ? `<span class="manager-plan-collapse-count">(${count})</span>`
    : '';
  return `
    <details class="manager-plan-collapse ${className}" data-plan-collapse="${escapeHtml(key)}" ${open ? 'open' : ''}>
      <summary class="${summaryClass}">
        <span class="manager-plan-collapse-label">${titleHtml}${countBadge ? ` ${countBadge}` : ''}</span>
        <span class="manager-plan-collapse-chevron" aria-hidden="true"></span>
      </summary>
      <div class="manager-plan-collapse-body">${bodyHtml}</div>
    </details>`;
}

function bindPlanCollapse(container) {
  container.querySelectorAll('details[data-plan-collapse]').forEach((el) => {
    el.addEventListener('toggle', () => {
      setPlanSectionOpen(el.dataset.planCollapse, el.open);
    });
  });
}

function dedupeChecklistItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = checklistDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function groupChecklistByFlow(items, { flowNames } = {}) {
  const byFlow = new Map();
  const orphans = [];
  for (const item of dedupeChecklistItems(items)) {
    const fid = item.flowId || null;
    if (fid) {
      if (!byFlow.has(fid)) byFlow.set(fid, []);
      byFlow.get(fid).push(item);
    } else {
      orphans.push(item);
    }
  }

  const groups = [...byFlow.entries()].map(([flowId, groupItems]) => ({
    flowId,
    title: flowNames?.get(flowId) || groupItems[0]?.label?.split(' · ')[0] || 'תזרים',
    items: groupItems,
  }));

  return { groups, orphans };
}

function renderPlanHighlightsHTML(plan, { editable = true } = {}) {
  if (!editable) {
    const notes = String(plan?.notes || '').trim();
    if (!notes) return '';
    const lines = notes.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    return `
      <div class="manager-plan-highlights-list">
        <div class="manager-plan-highlights-title">📝 דגשים</div>
        <ul class="manager-plan-highlights-ul">
          ${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
        </ul>
      </div>`;
  }
  return `
    <div class="form-group" style="margin-top:12px;margin-bottom:0">
      <label for="plan-notes">📝 דגשים ליום</label>
      <textarea id="plan-notes" rows="2" placeholder="הערות משמרת, הזמנות מיוחדות, דגשים לייצור...">${escapeHtml(plan?.notes || '')}</textarea>
      <button type="button" class="btn btn-secondary btn-sm" id="save-plan-notes" style="margin-top:8px">שמור דגשים</button>
    </div>`;
}

function planItemTaskName(item, flowTitle = '') {
  let label = String(item?.label || '').trim();
  if (!label) return 'משימה';
  if (flowTitle && label.startsWith(flowTitle)) {
    label = label.slice(flowTitle.length).replace(/^[\s·\-:]+/, '').trim();
  } else if (label.includes(' · ')) {
    label = label.split(' · ').slice(1).join(' · ').trim();
  }
  return label || item.label || 'משימה';
}

function planTableActionsHTML(item) {
  return `
    <td class="manager-plan-td-actions">
      <button type="button" class="btn btn-secondary btn-sm btn-icon plan-item-assignee" title="${item.assigneeName ? `אחראי: ${escapeHtml(item.assigneeName)}` : 'שיוך עובד'}">👤</button>
      <button type="button" class="btn btn-secondary btn-sm plan-item-edit" title="ערוך">✏️</button>
      <button type="button" class="btn btn-danger btn-sm plan-item-del" title="הסר מהתוכנית בלבד">🗑</button>
    </td>`;
}

function planTableRowAttrs(item) {
  return `class="manager-plan-item${item.done ? ' is-done' : ''}" data-id="${item.id}" data-kind="${escapeHtml(item.itemKind || 'text')}" data-label="${escapeHtml(item.label || '')}" data-qty="${item.quantity ?? ''}" data-assignee="${escapeHtml(item.assigneeName || '')}"`;
}

function planProductTableRow(item) {
  return `
    <tr ${planTableRowAttrs(item)}>
      <td class="manager-plan-td-name">${escapeHtml(item.label || 'מוצר')}</td>
      <td class="manager-plan-td-qty">
        <input type="number" class="plan-item-qty-input manager-plan-table-qty" min="0" step="0.001" inputmode="decimal" value="${item.quantity ?? ''}" aria-label="כמות" placeholder="—">
      </td>
      ${planTableActionsHTML(item)}
    </tr>`;
}

function planPortionTableRow(item) {
  return `
    <tr ${planTableRowAttrs(item)}>
      <td class="manager-plan-td-name">${escapeHtml(item.portionName || item.label || 'מנה')}</td>
      <td class="manager-plan-td-qty">
        <input type="number" class="plan-item-qty-input manager-plan-table-qty" min="1" step="1" inputmode="numeric" value="${item.quantity || 1}" aria-label="כמות מנות">
      </td>
      ${planTableActionsHTML(item)}
    </tr>`;
}

function planFlowTaskTableRow(item, flowTitle) {
  return `
    <tr ${planTableRowAttrs(item)}>
      <td class="manager-plan-td-flow">${escapeHtml(flowTitle || 'תזרים')}</td>
      <td class="manager-plan-td-name">${escapeHtml(planItemTaskName(item, flowTitle))}</td>
      <td class="manager-plan-td-done">
        <label class="manager-plan-check">
          <input type="checkbox" class="plan-item-done" ${item.done ? 'checked' : ''} aria-label="בוצע">
        </label>
      </td>
      ${planTableActionsHTML(item)}
    </tr>`;
}

function planManualTaskTableRow(item) {
  return `
    <tr ${planTableRowAttrs(item)}>
      <td class="manager-plan-td-name">${escapeHtml(item.label || 'משימה')}</td>
      <td class="manager-plan-td-done">
        <label class="manager-plan-check">
          <input type="checkbox" class="plan-item-done" ${item.done ? 'checked' : ''} aria-label="בוצע">
        </label>
      </td>
      ${planTableActionsHTML(item)}
    </tr>`;
}

function planSimpleTableRow(item, { showDay = false } = {}) {
  const dayLabels = weekDayLabels();
  return `
    <tr ${planTableRowAttrs(item)}>
      <td class="manager-plan-td-name">${escapeHtml(item.label || 'פריט')}</td>
      <td class="manager-plan-td-qty">${item.quantity != null ? formatDecimal(item.quantity) : '—'}</td>
      ${showDay ? `<td>${escapeHtml(dayLabels[item.dayOffset] || '')}</td>` : ''}
      <td class="manager-plan-td-done">
        <label class="manager-plan-check">
          <input type="checkbox" class="plan-item-done" ${item.done ? 'checked' : ''} aria-label="בוצע">
        </label>
      </td>
      ${planTableActionsHTML(item)}
    </tr>`;
}

function wrapPlanTable(headers, bodyRows, { clearKinds = null, clearLabel = '', dayOffset = null } = {}) {
  if (!bodyRows) return '<p class="form-hint" style="margin:0">אין פריטים</p>';
  const clearBtn = clearKinds?.length
    ? `<div class="manager-plan-table-toolbar">
        <button type="button" class="btn btn-secondary btn-sm plan-section-clear"
          data-clear-kinds="${escapeHtml(clearKinds.join(','))}"
          ${dayOffset != null ? `data-day-offset="${Number(dayOffset)}"` : ''}
          title="הסרה מהתוכנית בלבד — לא משנה תזרים או ייצור">
          🗑 ${escapeHtml(clearLabel || 'הסר הכל מהתוכנית')}
        </button>
      </div>`
    : '';
  return `
    ${clearBtn}
    <div class="manager-plan-table-wrap">
      <table class="manager-plan-table">
        <thead>
          <tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

function renderProductCentricPlanHTML(items, products, {
  dayOffset = null,
  plan = null,
  showHighlights = false,
  productFlowMap = null,
  productFlowNamesMap = null,
  flowNames = null,
} = {}) {
  let filtered = items;
  if (dayOffset != null) {
    filtered = items.filter((i) => (i.dayOffset ?? 0) === dayOffset);
  }
  if (!filtered.length && !(showHighlights && plan?.notes)) {
    return '<p class="form-hint manager-plan-empty">עדיין אין פריטים — הוסף מוצרים או מנות למעלה</p>';
  }

  const productsInPlan = filtered.filter((i) => i.itemKind === 'product');
  const portionItems = filtered.filter((i) => i.itemKind === 'portion');
  const manualItems = filtered.filter((i) => i.itemKind === 'text');
  const preparations = filtered.filter((i) => i.itemKind === 'flow_preparation');
  const cleanings = filtered.filter((i) => i.itemKind === 'flow_cleaning');
  const legacyItems = filtered.filter((i) => !['product', 'portion', 'text', 'flow_preparation', 'flow_cleaning', 'flow_ref'].includes(i.itemKind));

  const groupCtx = { flowNames };
  const prepGrouped = groupChecklistByFlow(preparations, groupCtx);
  const cleanGrouped = groupChecklistByFlow(cleanings, groupCtx);

  let html = '';

  if (productsInPlan.length) {
    html += renderCollapsiblePlanSection(
      'list-products',
      '📦 מוצרים לייצור',
      wrapPlanTable(
        ['שם מוצר', 'כמות', ''],
        productsInPlan.map((item) => planProductTableRow(item)).join(''),
        { clearKinds: ['product'], clearLabel: 'הסר מוצרים מהתוכנית', dayOffset },
      ),
      { count: productsInPlan.length, className: 'manager-plan-section', defaultOpen: true },
    );
  }

  if (portionItems.length) {
    html += renderCollapsiblePlanSection(
      'list-portions',
      '🍽 מנות להכנה',
      wrapPlanTable(
        ['שם מנה', 'כמות', ''],
        portionItems.map((item) => planPortionTableRow(item)).join(''),
        { clearKinds: ['portion'], clearLabel: 'הסר מנות מהתוכנית', dayOffset },
      ),
      { count: portionItems.length, className: 'manager-plan-section', defaultOpen: true },
    );
  }

  const prepRows = [];
  for (const group of prepGrouped.groups) {
    for (const item of group.items) prepRows.push(planFlowTaskTableRow(item, group.title));
  }
  for (const item of prepGrouped.orphans) {
    prepRows.push(planFlowTaskTableRow(item, 'הכנות'));
  }
  if (prepRows.length) {
    html += renderCollapsiblePlanSection(
      'list-flow-tasks',
      '✅ תזרימים · משימות',
      wrapPlanTable(
        ['שם תזרים', 'משימה', 'בוצע', ''],
        prepRows.join(''),
        { clearKinds: ['flow_preparation'], clearLabel: 'הסר משימות מהתוכנית', dayOffset },
      ),
      { count: preparations.length, className: 'manager-plan-section', defaultOpen: true },
    );
  }

  const cleanRows = [];
  for (const group of cleanGrouped.groups) {
    for (const item of group.items) cleanRows.push(planFlowTaskTableRow(item, group.title));
  }
  for (const item of cleanGrouped.orphans) {
    cleanRows.push(planFlowTaskTableRow(item, 'ניקיון'));
  }
  if (cleanRows.length) {
    html += renderCollapsiblePlanSection(
      'list-flow-cleaning',
      '🧹 תזרימים · נקיונות',
      wrapPlanTable(
        ['שם תזרים', 'משימה', 'בוצע', ''],
        cleanRows.join(''),
        { clearKinds: ['flow_cleaning'], clearLabel: 'הסר נקיונות מהתוכנית', dayOffset },
      ),
      { count: cleanings.length, className: 'manager-plan-section', defaultOpen: true },
    );
  }

  if (manualItems.length || (showHighlights && plan)) {
    const notes = String(plan?.notes || '').trim();
    const noteLines = notes ? notes.split(/\n+/).map((l) => l.trim()).filter(Boolean) : [];
    const manualBody = `
      ${manualItems.length
    ? wrapPlanTable(
      ['שם המשימה', 'בוצע', ''],
      manualItems.map((item) => planManualTaskTableRow(item)).join(''),
      { clearKinds: ['text'], clearLabel: 'הסר משימות ידני מהתוכנית', dayOffset },
    )
    : '<p class="form-hint" style="margin:0 0 8px">אין משימות ידניות</p>'}
      ${showHighlights ? `
        <div class="manager-plan-highlights-block">
          <div class="manager-plan-highlights-title">📝 דגשים</div>
          ${noteLines.length
    ? `<ul class="manager-plan-highlights-ul">${noteLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
    : '<p class="form-hint" style="margin:0 0 8px">אין דגשים עדיין</p>'}
          ${renderPlanHighlightsHTML(plan, { editable: true })}
        </div>` : ''}`;
    html += renderCollapsiblePlanSection(
      'list-manual',
      '📝 משימות ידני',
      manualBody,
      {
        count: manualItems.length || null,
        className: 'manager-plan-section',
        defaultOpen: true,
      },
    );
  }

  if (legacyItems.length) {
    html += renderCollapsiblePlanSection(
      'list-legacy',
      '📋 נוספים',
      wrapPlanTable(
        dayOffset == null ? ['שם', 'כמות', 'יום', 'בוצע', ''] : ['שם', 'כמות', 'בוצע', ''],
        legacyItems.map((item) => planSimpleTableRow(item, { showDay: dayOffset == null })).join(''),
      ),
      { count: legacyItems.length, className: 'manager-plan-section', defaultOpen: true },
    );
  }

  return html || '<p class="form-hint manager-plan-empty">עדיין אין פריטים — הוסף מוצרים או מנות למעלה</p>';
}

async function loadActiveRunsForPlan() {
  const runs = await getActiveProductionRuns();
  return Promise.all(runs.map(async (run) => {
    let prep = [];
    let clean = [];
    if (run.flowId) {
      try {
        prep = await ensureRunPreparationChecks(run.id);
        clean = await ensureRunCleaningChecks(run.id);
      } catch {
        prep = [];
        clean = [];
      }
    }
    return { run, prep, clean };
  }));
}

function activeRunTitle(run, productMap) {
  const prod = run.productId ? productMap.get(run.productId)?.name : '';
  const main = prod || run.flowName || 'תהליך פעיל';
  const extra = [];
  if (prod && run.flowName) extra.push(run.flowName);
  if (run.batchNumber) extra.push(`אצווה ${run.batchNumber}`);
  return extra.length ? `${main} · ${extra.join(' · ')}` : main;
}

function renderActiveRunsSectionHTML(runData, productMap) {
  const hidden = getActiveRunsHidden();
  const dismissed = getDismissedRunIds();
  const visible = runData.filter(({ run }) => !dismissed.has(run.id));
  const dismissedActive = runData.filter(({ run }) => dismissed.has(run.id));

  const toggleBtn = `<button type="button" class="btn btn-secondary btn-sm" id="toggle-active-runs">${hidden ? '👁 הצג' : '🙈 הסתר'}</button>`;

  if (hidden) {
    return renderCollapsiblePlanSection(
      'active-runs',
      `🔥 תזרימים פעילים${runData.length ? ` (${runData.length})` : ''}`,
      `<div class="filter-row" style="margin:0;justify-content:flex-end">${toggleBtn}</div>
       <p class="form-hint" style="margin:8px 0 0">מוסתר — לחץ «הצג» כדי לראות</p>`,
      {
        defaultOpen: false,
        className: 'card manager-active-runs-card',
        summaryClass: 'card-title manager-plan-collapse-summary',
      },
    );
  }

  const cards = visible.map(({ run, prep, clean }) => {
    const remainingSteps = (run.steps || []).filter((s) => s.status !== 'completed');
    const remainingPrep = prep.filter((c) => !c.checked);
    const remainingClean = clean.filter((c) => !c.checked);
    const title = activeRunTitle(run, productMap);
    const nothing = !remainingSteps.length && !remainingPrep.length && !remainingClean.length;
    const stepItem = (s) => `<div class="manager-active-run-item${s.status === 'active' ? ' is-active' : ''}">${s.status === 'active' ? '● ' : '○ '}${escapeHtml(s.stepName || 'שלב')}</div>`;
    const checkItem = (c) => `<div class="manager-active-run-item">○ ${escapeHtml(c.name)}</div>`;
    const body = `
        <div class="manager-active-run-actions" style="margin-bottom:8px">
          <button type="button" class="btn btn-primary btn-sm manager-active-run-import" data-run-id="${run.id}" title="ייבא לתוכנית בלבד — לא משנה ייצור">📥 ייבא לתוכנית</button>
          <button type="button" class="btn btn-secondary btn-sm btn-icon manager-active-run-remove" data-run-id="${run.id}" title="הסר מהרשימה" aria-label="הסר מהרשימה">✕</button>
        </div>
        ${nothing ? '<p class="form-hint" style="margin:0">כל השלבים והמשימות בוצעו — ממתין לסגירת התהליך</p>' : `
          ${remainingSteps.length ? `
          <div class="manager-active-run-group">
            <div class="manager-active-run-heading">📋 שלבים בתזרים</div>
            ${remainingSteps.map(stepItem).join('')}
          </div>` : ''}
          ${remainingPrep.length ? `
          <div class="manager-active-run-group">
            <div class="manager-active-run-heading">✅ הכנות</div>
            ${remainingPrep.map(checkItem).join('')}
          </div>` : ''}
          ${remainingClean.length ? `
          <div class="manager-active-run-group">
            <div class="manager-active-run-heading">🧹 ניקיון</div>
            ${remainingClean.map(checkItem).join('')}
          </div>` : ''}
        `}`;
    return renderCollapsiblePlanSection(
      `active-run-${run.id}`,
      `🔥 ${escapeHtml(title)}`,
      body,
      {
        defaultOpen: false,
        className: 'manager-active-run',
        summaryClass: 'manager-active-run-title manager-plan-collapse-summary',
      },
    );
  }).join('');

  const body = `
      <div class="filter-row" style="margin-bottom:8px;justify-content:flex-end">${toggleBtn}</div>
      ${runData.length
    ? '<p class="form-hint" style="margin-bottom:10px">«ייבא לתוכנית» מוסיף צ׳קליסטים לתוכנית בלבד — לא משנה תזרים או ייצור · רק בלחיצה שלך</p>'
    : '<p class="form-hint" style="margin:0">אין תזרימים פעילים כרגע.</p>'}
      ${cards}
      ${dismissedActive.length ? `
      <button type="button" class="btn btn-secondary btn-sm" id="restore-active-runs" style="margin-top:8px">➕ החזר תזרימים שהוסרו (${dismissedActive.length})</button>` : ''}`;

  return renderCollapsiblePlanSection(
    'active-runs',
    `🔥 תזרימים פעילים${runData.length ? ` (${runData.length})` : ''}`,
    body,
    {
      defaultOpen: true,
      count: runData.length || null,
      className: 'card manager-active-runs-card',
      summaryClass: 'card-title manager-plan-collapse-summary',
    },
  );
}

function bindActiveRunsSection(container, { planType = 'daily', anchorDate } = {}) {
  document.getElementById('toggle-active-runs')?.addEventListener('click', () => {
    setActiveRunsHidden(!getActiveRunsHidden());
    renderManager(container);
  });
  document.getElementById('restore-active-runs')?.addEventListener('click', () => {
    setDismissedRunIds(new Set());
    showToast('התזרימים הוחזרו ✓');
    renderManager(container);
  });
  container.querySelectorAll('.manager-active-run-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const set = getDismissedRunIds();
      set.add(Number(btn.dataset.runId));
      setDismissedRunIds(set);
      showToast('הוסר מהרשימה');
      renderManager(container);
    });
  });
  container.querySelectorAll('.manager-active-run-import').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('לייבא צ׳קליסט לתוכנית?\n\nרק לתוכנית — לא משנה את התזרים הפעיל או הייצור.')) return;
      try {
        btn.disabled = true;
        const res = await importActiveRunToDailyPlan(Number(btn.dataset.runId), {
          planType,
          anchorDate,
        });
        const parts = [];
        if (res.checklistsAdded) parts.push(`${res.checklistsAdded} משימות צ׳קליסט`);
        if (res.flowRefAdded) parts.push('תזרים לדף התזרימים');
        showToast(parts.length
          ? `נוסף לתוכנית ✓ · ${parts.join(' · ')}${res.flowName ? ` · ${res.flowName}` : ''}`
          : 'כבר בתוכנית ✓');
        renderManager(container);
      } catch (err) {
        btn.disabled = false;
        showToast(err.message || 'שגיאה בייבוא');
      }
    });
  });
}

function openEditPlanItemModal(container, { id, kind, label, qty, planType, anchorDate }) {
  const isFlowTask = kind === 'flow_step' || kind === 'flow_preparation' || kind === 'flow_cleaning';
  const canEditLabel = kind === 'text' || isFlowTask;
  const canEditQty = kind === 'text' || kind === 'product' || kind === 'portion';
  const canMoveDate = planType === 'daily';
  openModal({
    title: 'עריכת פריט',
    bodyHTML: `
      ${canEditLabel ? `
      <div class="form-group">
        <label for="edit-item-label">תיאור</label>
        <input type="text" id="edit-item-label" value="${escapeHtml(label)}" maxlength="120">
      </div>` : `<p class="form-hint" style="margin-bottom:12px">${escapeHtml(label)}</p>`}
      ${canEditQty ? `
      <div class="form-group">
        <label for="edit-item-qty">כמות${kind === 'portion' ? ' מנות' : ''}</label>
        <input type="number" id="edit-item-qty" min="0" step="1" inputmode="numeric" value="${qty}">
      </div>` : ''}
      ${canMoveDate ? `
      <div class="form-group">
        <label for="edit-item-date">העבר ליום (תאריך)</label>
        <input type="date" id="edit-item-date" value="${escapeHtml(anchorDate || '')}">
        <p class="form-hint" style="margin-top:4px">שינוי התאריך יעביר את המשימה ליום הנבחר</p>
      </div>` : ''}`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-edit-item">שמור</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-edit-item')?.addEventListener('click', async () => {
    const patch = {};
    const labelEl = document.getElementById('edit-item-label');
    if (labelEl) patch.label = labelEl.value.trim();
    const qtyEl = document.getElementById('edit-item-qty');
    if (qtyEl) patch.quantity = qtyEl.value;
    const dateEl = document.getElementById('edit-item-date');
    const movedDate = dateEl && dateEl.value && dateEl.value !== anchorDate ? dateEl.value : null;
    if (movedDate) patch.anchorDate = movedDate;
    try {
      await updateManagerPlanItem(id, patch);
      closeModal();
      showToast(movedDate ? `הועבר ל-${formatDate(movedDate)} ✓` : 'עודכן ✓');
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function planPortionPresetLabel(p) {
  const extra = p.extra ? ` · ${p.extra}` : '';
  return `${p.name} (${p.weight} ק"ג${extra})`;
}

function buildPlanPortionPicksHTML(presets) {
  const recipePresets = presets.filter((p) => p.sourceRecipeId || p.sourceRawMaterialId);
  const manualPresets = presets.filter((p) => !p.sourceRecipeId && !p.sourceRawMaterialId);
  const row = (p) => `
    <label class="checkbox-label plan-portion-pick">
      <input type="checkbox" class="plan-portion-cb" value="${p.id}">
      <span class="plan-portion-pick-label">${escapeHtml(planPortionPresetLabel(p))}</span>
      <input type="number" class="plan-portion-qty" min="1" step="1" inputmode="numeric" placeholder="כמות" disabled aria-label="כמות מנות">
    </label>`;
  const group = (title, list) => list.length ? `
    <div class="plan-portion-pick-group">
      <div class="plan-portion-pick-heading">${escapeHtml(title)}</div>
      ${list.map(row).join('')}
    </div>` : '';
  return group('ממתכונים', recipePresets) + group('מהרשימה שבנית', manualPresets) || presets.map(row).join('');
}

function bindPlanPortionPickers() {
  document.querySelectorAll('.plan-portion-cb').forEach((cb) => {
    const qty = cb.closest('.plan-portion-pick')?.querySelector('.plan-portion-qty');
    const sync = () => {
      if (!qty) return;
      qty.disabled = !cb.checked;
      if (!cb.checked) qty.value = '';
    };
    cb.addEventListener('change', sync);
    sync();
  });
}

function getSelectedPlanPortions(rootSelector, defaultQty) {
  const root = typeof rootSelector === 'string'
    ? document.querySelector(rootSelector)
    : rootSelector;
  const scope = root || document;
  const picks = [...scope.querySelectorAll('.plan-portion-cb:checked')];
  if (!picks.length) return [];
  return picks.map((cb) => {
    const qtyEl = cb.closest('.plan-portion-pick')?.querySelector('.plan-portion-qty');
    const qty = qtyEl?.value || defaultQty || '';
    return { portionPresetId: Number(cb.value), quantity: qty };
  });
}

function renderPlanBuildAddedListHTML(items, {
  itemKind,
  emptyHint = '',
  nameOf = (item) => item.label || '',
} = {}) {
  const rows = (items || []).filter((i) => i.itemKind === itemKind);
  if (!rows.length) {
    return emptyHint
      ? `<p class="form-hint manager-plan-build-added-empty">${escapeHtml(emptyHint)}</p>`
      : '';
  }
  return `
    <div class="manager-plan-build-added">
      <div class="manager-plan-build-added-title">מה שנוסף (${rows.length})</div>
      <ul class="manager-plan-build-added-list">
        ${rows.map((item) => {
          const name = nameOf(item);
          const qty = item.quantity != null && item.quantity !== ''
            ? `<span class="manager-plan-build-added-qty">× ${formatDecimal(item.quantity)}</span>`
            : '';
          return `
            <li class="manager-plan-build-added-item" data-id="${item.id}">
              <span class="manager-plan-build-added-name">${escapeHtml(name)}</span>
              ${qty}
              <button type="button" class="btn btn-danger btn-sm plan-item-del" data-id="${item.id}" title="הסר מהתוכנית בלבד">🗑</button>
            </li>`;
        }).join('')}
      </ul>
    </div>`;
}

function renderPlanAddProductHTML(products, layout, {
  showDay = false,
  flows = [],
  plan = null,
  showHighlights = false,
  planItems = [],
} = {}) {
  const dayLabels = weekDayLabels();
  const flowOptions = flows.length
    ? flows.map((f) => {
      const path = [f.groupName, f.targetLabel].filter(Boolean).join(' › ');
      return `<option value="${f.id}">${escapeHtml(f.name)}${path ? ` — ${escapeHtml(path)}` : ''}</option>`;
    }).join('')
    : '';
  const addCard = (key, title, body) => renderCollapsiblePlanSection(
    key,
    escapeHtml(title),
    body,
    {
      defaultOpen: false,
      className: 'card manager-plan-add-card',
      summaryClass: 'card-title manager-plan-collapse-summary',
    },
  );
  return `
    ${showDay ? `
    <div class="card manager-plan-add-card">
      <div class="form-group" style="margin:0">
        <label for="plan-day">יום בשבוע</label>
        <select id="plan-day">
          ${dayLabels.map((label, i) => `<option value="${i}">${label}</option>`).join('')}
        </select>
      </div>
    </div>` : ''}
    ${addCard('add-products', '1 · מוצרים לייצור', `
      <p class="form-hint" style="margin-bottom:12px">מוסיף רק את המוצר לתוכנית — לא משנה תזרים או ייצור</p>
      <div class="form-group">
        <label for="plan-product">מוצר</label>
        <select id="plan-product">
          <option value="">בחר מוצר...</option>
          ${renderPlanProductSelectHTML(products, layout)}
        </select>
      </div>
      <div class="filter-row">
        <input type="number" id="plan-qty" min="1" step="1" inputmode="numeric" placeholder="כמות (אופציונלי)" style="flex:1" aria-label="כמות">
        <button type="button" class="btn btn-primary btn-sm" id="add-plan-product">+ הוסף</button>
      </div>
      <label class="manager-plan-opt-check" style="display:flex;gap:8px;align-items:flex-start;margin-top:10px">
        <input type="checkbox" id="plan-product-include-checklists">
        <span>הוסף גם משימות מהתזרים המשויך (הכנות + נקיונות) — רק לתוכנית</span>
      </label>
      ${renderPlanBuildAddedListHTML(planItems, {
        itemKind: 'product',
        emptyHint: 'עדיין לא נוספו מוצרים',
        nameOf: (item) => item.label || 'מוצר',
      })}
    `)}
    ${addCard('add-portions', '2 · מנות להכנה', `
      <p class="form-hint" style="margin-bottom:12px">בחר מוצר ואז סמן אילו מנות להכין היום — בנפרד מהייצור</p>
      <div class="form-group">
        <label for="plan-portion-product">מוצר (לשיוך המנה)</label>
        <select id="plan-portion-product">
          <option value="">בחר מוצר...</option>
          ${renderPlanProductSelectHTML(products, layout)}
        </select>
      </div>
      <div class="form-group" id="plan-portion-wrap" hidden>
        <label>מנות — ניתן לבחור יותר מאחת</label>
        <div id="plan-portion-picks" class="plan-portion-pick-list"></div>
      </div>
      <div class="filter-row">
        <input type="number" id="plan-portion-qty" min="1" step="1" inputmode="numeric" placeholder="כמות ברירת מחדל" style="flex:1" aria-label="כמות מנות">
        <button type="button" class="btn btn-primary btn-sm" id="add-plan-portion">+ הוסף מנות</button>
      </div>
      ${renderPlanBuildAddedListHTML(planItems, {
        itemKind: 'portion',
        emptyHint: 'עדיין לא נוספו מנות',
        nameOf: (item) => item.portionName || item.label || 'מנה',
      })}
    `)}
    ${addCard('add-flows', '3 · תזרימים', `
      <p class="form-hint" style="margin-bottom:12px">רק אם תבחר ותלחץ «הוסף» — צ׳קליסטים יופיעו בתוכנית (לא משנה את התזרים עצמו)</p>
      <div class="filter-row">
        <select id="plan-flow" style="flex:1">
          <option value="">בחר תזרים...</option>
          ${flowOptions}
        </select>
        <button type="button" class="btn btn-primary btn-sm" id="add-plan-flow">+ הוסף</button>
      </div>
    `)}
    ${addCard('add-manual', `4 · משימה ידנית${showHighlights ? ' ודגשים' : ''}`, `
      <div class="filter-row">
        <input type="text" id="plan-text" placeholder="למשל: הזמנה מיוחדת, ניקוי מקרר..." style="flex:1">
        <button type="button" class="btn btn-secondary btn-sm" id="add-plan-text">+</button>
      </div>
      ${renderPlanBuildAddedListHTML(planItems, {
        itemKind: 'text',
        emptyHint: 'עדיין לא נוספו משימות ידניות',
        nameOf: (item) => item.label || 'משימה',
      })}
      ${showHighlights ? renderPlanHighlightsHTML(plan) : ''}
    `)}`;
}

function openAssigneeModal(container, { id, currentName = '', employees = [] }) {
  const chips = employees.length
    ? `<div class="manager-plan-assignee-chips">
        ${employees.map((e) => `
          <button type="button" class="btn btn-secondary btn-sm plan-assignee-pick" data-name="${escapeHtml(e.name)}">${escapeHtml(e.name)}</button>
        `).join('')}
      </div>`
    : '<p class="form-hint">אין עובדים ברשימה — אפשר להקליד שם חופשי או להוסיף בצוות</p>';
  openModal({
    title: 'מי אחראי?',
    bodyHTML: `
      ${chips}
      <div class="form-group" style="margin-top:12px">
        <label for="plan-assignee-name">שם עובד</label>
        <input type="text" id="plan-assignee-name" value="${escapeHtml(currentName || '')}" maxlength="40" placeholder="הקלד שם...">
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary" id="clear-plan-assignee">נקה</button>
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-plan-assignee">שמור</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.querySelectorAll('.plan-assignee-pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('plan-assignee-name');
      if (input) input.value = btn.dataset.name || '';
    });
  });
  document.getElementById('clear-plan-assignee')?.addEventListener('click', async () => {
    try {
      await updateManagerPlanItem(id, { assigneeName: null });
      closeModal();
      showToast('הוסר אחראי ✓');
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
  document.getElementById('save-plan-assignee')?.addEventListener('click', async () => {
    const name = document.getElementById('plan-assignee-name')?.value?.trim() || '';
    try {
      await updateManagerPlanItem(id, { assigneeName: name || null });
      closeModal();
      showToast(name ? `אחראי: ${name} ✓` : 'הוסר אחראי ✓');
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function planItemRow(item, { showDay = false, productFlowNamesMap = null } = {}) {
  const dayLabels = weekDayLabels();
  const isPortion = item.itemKind === 'portion';
  const isFlowStep = item.itemKind === 'flow_step';
  const assigneeBadge = item.assigneeName
    ? `<span class="manager-plan-assignee">👤 ${escapeHtml(item.assigneeName)}</span>`
    : '';
  let bodyInner;
  if (isPortion) {
    const target = item.label.includes('→') ? item.label.split('→').pop().trim() : item.label;
    bodyInner = `
        <span class="manager-plan-label">🍽 ${escapeHtml(item.portionName || item.label)}</span>
        <span class="manager-plan-portion-detail">${item.portionWeight != null ? `${item.portionWeight} ק"ג` : ''}${item.portionExtra ? ` · ${escapeHtml(item.portionExtra)}` : ''}</span>
        <span class="manager-plan-portion-target">→ ${escapeHtml(target)}</span>
        ${assigneeBadge}
        <label class="manager-plan-qty-edit">
          <input type="number" class="plan-item-qty-input" min="1" step="1" inputmode="numeric" value="${item.quantity || 1}" aria-label="כמות מנות">
          <span>מנות לייצור</span>
        </label>`;
  } else if (isFlowStep) {
    bodyInner = `
        <span class="manager-plan-label">📋 ${escapeHtml(item.label)}</span>
        ${assigneeBadge}`;
  } else if (item.itemKind === 'flow_preparation') {
    bodyInner = `
        <span class="manager-plan-label">✅ ${escapeHtml(item.label)}</span>
        ${assigneeBadge}`;
  } else if (item.itemKind === 'flow_cleaning') {
    bodyInner = `
        <span class="manager-plan-label">🧹 ${escapeHtml(item.label)}</span>
        ${assigneeBadge}`;
  } else if (item.itemKind === 'product') {
    const flowDetail = productFlowNamesMap?.get(item.productId)
      ? `<span class="manager-plan-flow-label">תזרים: ${escapeHtml(productFlowNamesMap.get(item.productId))}</span>`
      : '';
    bodyInner = `
        <span class="manager-plan-label">📦 ${escapeHtml(item.label)}</span>
        ${flowDetail}
        ${assigneeBadge}
        ${item.quantity ? `<span class="manager-plan-qty">× ${formatDecimal(item.quantity)}</span>` : ''}`;
  } else {
    bodyInner = `
        <span class="manager-plan-label">${escapeHtml(item.label)}</span>
        ${assigneeBadge}
        ${item.quantity ? `<span class="manager-plan-qty">× ${formatDecimal(item.quantity)}</span>` : ''}`;
  }
  return `
    <div class="manager-plan-item${item.done ? ' is-done' : ''}${isPortion ? ' manager-plan-item--portion' : ''}${isFlowStep ? ' manager-plan-item--flow-step' : ''}${item.itemKind === 'flow_preparation' ? ' manager-plan-item--flow-prep' : ''}${item.itemKind === 'flow_cleaning' ? ' manager-plan-item--flow-clean' : ''}${item.itemKind === 'product' ? ' manager-plan-item--product' : ''}" data-id="${item.id}" data-kind="${escapeHtml(item.itemKind || 'text')}" data-label="${escapeHtml(item.label || '')}" data-qty="${item.quantity ?? ''}" data-assignee="${escapeHtml(item.assigneeName || '')}">
      <label class="manager-plan-check">
        <input type="checkbox" class="plan-item-done" ${item.done ? 'checked' : ''}>
      </label>
      <div class="manager-plan-body">${bodyInner}
        ${showDay ? `<span class="manager-plan-day">${dayLabels[item.dayOffset] || ''}</span>` : ''}
      </div>
      <button type="button" class="btn btn-secondary btn-sm btn-icon plan-item-assignee" title="${item.assigneeName ? `אחראי: ${escapeHtml(item.assigneeName)}` : 'שיוך עובד'}">👤</button>
      <button type="button" class="btn btn-secondary btn-sm plan-item-edit" title="ערוך">✏️</button>
      <button type="button" class="btn btn-danger btn-sm plan-item-del" title="הסר">🗑</button>
    </div>`;
}

function bindPlanItems(container, planType, anchorDate, { employees = [] } = {}) {
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
      const row = btn.closest('.manager-plan-item') || btn.closest('[data-id]');
      const id = row?.dataset.id || btn.dataset.id;
      if (!id) return;
      if (!confirm('להסיר מהתוכנית?\n\nזה מסיר רק מהתוכנית — לא משנה תזרים או ייצור.')) return;
      await deleteManagerPlanItem(id);
      showToast('הוסר מהתוכנית ✓');
      renderManager(container);
    });
  });

  container.querySelectorAll('.plan-section-clear').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const kinds = String(btn.dataset.clearKinds || '').split(',').map((k) => k.trim()).filter(Boolean);
      if (!kinds.length) return;
      if (!confirm('להסיר את כל הפריטים בסעיף זה מהתוכנית?\n\nרק מהתוכנית — לא משנה תזרים או ייצור.')) return;
      try {
        const opts = {};
        if (btn.dataset.dayOffset != null && btn.dataset.dayOffset !== '') {
          opts.dayOffset = Number(btn.dataset.dayOffset);
        }
        const n = await deleteManagerPlanItemsByKind(planType, anchorDate, kinds, opts);
        showToast(n ? `הוסרו ${n} מהתוכנית ✓` : 'אין פריטים להסרה');
        renderManager(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.plan-item-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.manager-plan-item');
      openEditPlanItemModal(container, {
        id: row.dataset.id,
        kind: row.dataset.kind || 'text',
        label: row.dataset.label || '',
        qty: row.dataset.qty || '',
        planType,
        anchorDate,
      });
    });
  });

  container.querySelectorAll('.plan-item-assignee').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.manager-plan-item');
      openAssigneeModal(container, {
        id: row.dataset.id,
        currentName: row.dataset.assignee || '',
        employees,
      });
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
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('plan-portion-product')?.addEventListener('change', async (e) => {
    const productId = e.target.value;
    const wrap = document.getElementById('plan-portion-wrap');
    const picks = document.getElementById('plan-portion-picks');
    if (!wrap || !picks) return;
    if (!productId) {
      wrap.hidden = true;
      picks.innerHTML = '';
      return;
    }
    try {
      const presets = await getPortionPresetsForProduct(productId);
      if (!presets.length) {
        wrap.hidden = true;
        picks.innerHTML = '<p class="form-hint">אין מנות משויכות למוצר זה</p>';
        wrap.hidden = false;
        return;
      }
      wrap.hidden = false;
      picks.innerHTML = buildPlanPortionPicksHTML(presets);
      bindPlanPortionPickers();
    } catch {
      wrap.hidden = true;
    }
  });

  document.getElementById('add-plan-product')?.addEventListener('click', async () => {
    const productId = document.getElementById('plan-product').value;
    const qty = document.getElementById('plan-qty').value;
    const dayOffset = document.getElementById('plan-day')?.value ?? 0;
    const includeChecklists = !!document.getElementById('plan-product-include-checklists')?.checked;
    if (!productId) return showToast('בחר מוצר');
    try {
      const res = await addManagerPlanProductWithChecklists({
        planType, anchorDate, dayOffset: Number(dayOffset),
        productId,
        quantity: qty || null,
        portions: null,
        includeChecklists,
      });
      const msg = res.checklistsAdded
        ? `מוצר נוסף לתוכנית ✓ · ${res.checklistsAdded} משימות מהצ׳קליסט`
        : 'מוצר נוסף לתוכנית ✓';
      showToast(msg);
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('add-plan-portion')?.addEventListener('click', async () => {
    const productId = document.getElementById('plan-portion-product')?.value;
    const defaultQty = document.getElementById('plan-portion-qty')?.value;
    const dayOffset = document.getElementById('plan-day')?.value ?? 0;
    if (!productId) return showToast('בחר מוצר לשיוך המנה');
    const portions = getSelectedPlanPortions('#plan-portion-picks', defaultQty);
    if (!portions.length) return showToast('סמן לפחות מנה אחת');
    if (portions.some((p) => !p.quantity)) return showToast('הזן כמות לכל מנה שנבחרה');
    try {
      let added = 0;
      for (const p of portions) {
        await addManagerPlanItem({
          planType,
          anchorDate,
          dayOffset: Number(dayOffset),
          itemKind: 'portion',
          productId: Number(productId),
          portionPresetId: p.portionPresetId,
          quantity: p.quantity,
        });
        added += 1;
      }
      showToast(`נוספו ${added} מנות ✓`);
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('add-plan-flow')?.addEventListener('click', async () => {
    const flowId = document.getElementById('plan-flow')?.value;
    const dayOffset = document.getElementById('plan-day')?.value ?? 0;
    if (!flowId) return showToast('בחר תזרים');
    try {
      const res = await addManagerPlanFlowChecklists({
        planType,
        anchorDate,
        dayOffset: Number(dayOffset),
        flowId: Number(flowId),
        includeFlowRef: true,
      });
      const parts = [];
      if (res.checklistsAdded) parts.push(`${res.checklistsAdded} משימות`);
      if (res.flowRefAdded) parts.push('תזרים לדף התזרימים');
      showToast(parts.length
        ? `נוסף ✓ · ${parts.join(' · ')}${res.flowName ? ` · ${res.flowName}` : ''}`
        : 'התזרים כבר בתוכנית ✓');
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

}

async function buildPlanFlowContext(items, { dayOffset = null } = {}) {
  let filtered = items;
  if (dayOffset != null) {
    filtered = items.filter((i) => (i.dayOffset ?? 0) === dayOffset);
  }
  const productIds = [...new Set(
    filtered.filter((i) => i.itemKind === 'product').map((i) => i.productId).filter(Boolean),
  )];
  const checklistFlowIds = [...new Set(
    filtered
      .filter((i) => i.flowId && ['flow_preparation', 'flow_cleaning', 'flow_step', 'flow_ref'].includes(i.itemKind))
      .map((i) => Number(i.flowId)),
  )];
  const productFlowMap = new Map();
  const productFlowNamesMap = new Map();
  const flowNames = new Map();
  for (const pid of productIds) {
    const flows = await resolveFlowsForProduct(pid);
    if (!flows.length) continue;
    productFlowMap.set(pid, new Set(flows.map((f) => f.id)));
    for (const flow of flows) flowNames.set(flow.id, flow.name);
    productFlowNamesMap.set(pid, flows.map((f) => f.name).join(', '));
  }
  const missing = checklistFlowIds.filter((fid) => !flowNames.has(fid));
  if (missing.length) {
    const overview = await getAllFlowsOverview();
    const map = new Map(overview.map((f) => [f.id, f.name]));
    for (const fid of missing) {
      if (map.has(fid)) flowNames.set(fid, map.get(fid));
    }
  }
  return { productFlowMap, productFlowNamesMap, flowNames };
}

async function renderPlanFlowsPageHTML(items, activeRunData, productMap, flowNames, { dayOffset = null } = {}) {
  let filtered = items;
  if (dayOffset != null) {
    filtered = items.filter((i) => (i.dayOffset ?? 0) === dayOffset);
  }
  const flowRefs = filtered.filter((i) => i.itemKind === 'flow_ref');
  const runById = new Map(activeRunData.map(({ run, prep, clean }) => [run.id, { run, prep, clean }]));
  const runByFlow = new Map();
  for (const entry of activeRunData) {
    if (entry.run.flowId) runByFlow.set(entry.run.flowId, entry);
  }

  const planFlowBlocks = [];
  for (const ref of flowRefs) {
    const name = flowNames?.get(ref.flowId) || ref.label || 'תזרים';
    let steps = [];
    try {
      steps = await getFlowStepsForFlow(ref.flowId);
    } catch {
      steps = [];
    }
    const linkedRun = (ref.productionRunId && runById.get(Number(ref.productionRunId)))
      || runByFlow.get(ref.flowId)
      || null;
    const remainingSteps = linkedRun
      ? (linkedRun.run.steps || []).filter((s) => s.status !== 'completed')
      : steps;
    const stepLines = remainingSteps.length
      ? remainingSteps.map((s) => {
        const label = s.stepName || s.name || 'שלב';
        const active = s.status === 'active' ? ' is-active' : '';
        const mark = s.status === 'active' ? '● ' : (linkedRun ? '○ ' : `${(s.sortOrder || '')}. `);
        return `<div class="manager-active-run-item${active}">${mark}${escapeHtml(label)}</div>`;
      }).join('')
      : '<p class="form-hint" style="margin:0">אין שלבים</p>';

    planFlowBlocks.push(renderCollapsiblePlanSection(
      `plan-flow-ref-${ref.id}`,
      `🔄 ${escapeHtml(name)}`,
      `
        <div class="manager-active-run-head" style="justify-content:flex-end;margin-bottom:6px">
          <button type="button" class="btn btn-danger btn-sm plan-item-del" data-id="${ref.id}" title="הסר תזרים מהתוכנית">🗑</button>
        </div>
        ${linkedRun ? `<p class="form-hint" style="margin:0 0 6px">תזרים פעיל בתוכנית · ${escapeHtml(activeRunTitle(linkedRun.run, productMap))}</p>` : ''}
        <div class="manager-active-run-group">
          <div class="manager-active-run-heading">📋 שלבי התזרים</div>
          ${stepLines}
        </div>`,
      {
        className: 'manager-plan-flow-page-block',
        summaryClass: 'manager-active-run-title manager-plan-collapse-summary',
      },
    ));
  }

  const flowsInner = `
      <p class="form-hint" style="margin-top:0">כאן מופיעים תזרימים שהוספת / ייבאת במפורש · המשימות נשארות ברשימת היום · הסרה מכאן לא משנה תזרים או ייצור</p>
      ${planFlowBlocks.length
    ? planFlowBlocks.join('')
    : '<p class="form-hint">עדיין אין תזרימים בתוכנית — בחר תזרים למעלה או ייבא תזרים פעיל</p>'}
      <div class="manager-plan-flows-active-wrap">
        ${renderActiveRunsSectionHTML(activeRunData, productMap)}
      </div>`;

  return `
    <div class="card manager-plan-flows-page-card" id="active-runs-anchor">
      ${renderCollapsiblePlanSection(
    'flows-page',
    '🔄 תזרימים — דף נפרד',
    flowsInner,
    {
      summaryClass: 'manager-plan-section-title manager-plan-collapse-summary',
      count: flowRefs.length || null,
    },
  )}
    </div>`;
}

async function renderDailyPlan(container) {
  syncManagerPlanNavigation(container);
  const date = container.dataset.planDate || todayISO();
  const [plan, items, products, layout, activeRunData, employees, flows] = await Promise.all([
    getManagerPlan('daily', date),
    getManagerPlanItems('daily', date),
    getProducts(true),
    getProductsCatalogLayout(),
    loadActiveRunsForPlan(),
    getManagerEmployees({ activeOnly: true }),
    getAllFlowsOverview(),
  ]);
  const { productFlowMap, productFlowNamesMap, flowNames } = await buildPlanFlowContext(items);
  const activeRunsProductMap = new Map(products.map((p) => [p.id, p]));
  const done = items.filter((i) => i.done && i.itemKind !== 'flow_ref').length;
  const countable = items.filter((i) => i.itemKind !== 'flow_ref');
  const progressPct = countable.length ? Math.round((done / countable.length) * 100) : 0;
  const activeCount = activeRunData.length;
  const mode = getDailyPlanMode(container, { hasItems: countable.length > 0 });
  setDailyPlanMode(container, mode);

  const flowsPageHtml = await renderPlanFlowsPageHTML(
    items, activeRunData, activeRunsProductMap, flowNames,
  );

  const headerBuild = renderCollapsiblePlanSection(
    'header-build',
    '🗓️ תאריך וכלים לבנייה',
    `
      <div class="form-group" style="margin-bottom:8px">
        <label for="plan-date">תאריך</label>
        <input type="date" id="plan-date" value="${date}">
      </div>
      <p class="form-hint" style="margin-bottom:8px">${formatDateHebrew(date)}</p>
      <div class="filter-row" style="margin:0;flex-wrap:wrap">
        <button type="button" class="btn btn-secondary btn-sm" id="jump-active-runs" style="flex:1">🔥 תזרימים${activeCount ? ` (${activeCount})` : ''}</button>
        <button type="button" class="btn btn-secondary btn-sm" id="clear-daily-plan" style="flex:1" ${items.length ? '' : 'disabled'}>🗑 נקה תוכנית</button>
      </div>
      <p class="form-hint" style="margin-top:10px;margin-bottom:0">כאן בונים את היום — מוצרים, מנות, תזרימים ודגשים. התוכנית פורמלית בלבד: מה שמוסיפים/מסירים כאן לא משנה תזרים או ייצור.</p>`,
    {
      defaultOpen: true,
      className: 'card manager-plan-header-card',
      summaryClass: 'card-title manager-plan-collapse-summary',
    },
  );

  const headerReady = renderCollapsiblePlanSection(
    'header-ready',
    '📋 סיכום היום',
    `
      <div class="form-group" style="margin-bottom:8px">
        <label for="plan-date">תאריך</label>
        <input type="date" id="plan-date" value="${date}">
      </div>
      <p class="form-hint" style="margin-bottom:8px">${formatDateHebrew(date)}</p>
      ${countable.length ? `
      <div class="manager-plan-progress">
        <div class="manager-plan-progress-bar" style="width:${progressPct}%"></div>
      </div>
      <p class="form-hint manager-plan-progress-label">${done}/${countable.length} הושלמו (${progressPct}%)</p>` : `
      <p class="form-hint">התוכנית ריקה — עבור לבנייה כדי להוסיף פריטים</p>`}
      <div class="filter-row" style="margin-top:10px;margin-bottom:0">
        <button type="button" class="btn btn-secondary btn-sm" id="export-daily-plan" style="flex:1">⬇️ ייצוא לקובץ</button>
        <button type="button" class="btn btn-secondary btn-sm" id="print-daily-plan" style="flex:1">🖨️ הדפס</button>
      </div>
      <div class="filter-row" style="margin-top:8px;margin-bottom:0">
        <button type="button" class="btn btn-secondary btn-sm" id="jump-active-runs" style="flex:1">🔥 תזרימים${activeCount ? ` (${activeCount})` : ''}</button>
        <button type="button" class="btn btn-primary btn-sm" id="goto-daily-build" style="flex:1">🛠️ חזרה לבנייה</button>
      </div>`,
    {
      defaultOpen: true,
      className: 'card manager-plan-header-card',
      summaryClass: 'card-title manager-plan-collapse-summary',
    },
  );

  const listHtml = renderProductCentricPlanHTML(items, products, {
    productFlowMap,
    productFlowNamesMap,
    flowNames,
    plan,
    showHighlights: true,
  });

  const readyListCard = renderCollapsiblePlanSection(
    'ready-list',
    'רשימת היום',
    listHtml,
    {
      defaultOpen: true,
      count: countable.length || null,
      className: 'card manager-plan-list-card',
      summaryClass: 'card-title manager-plan-collapse-summary',
    },
  );

  const buildBody = `
    ${headerBuild}
    ${renderCollapsiblePlanSection(
    'build-tools',
    '➕ הוספה לתוכנית',
    renderPlanAddProductHTML(products, layout, { flows, plan, showHighlights: true, planItems: items }),
    {
      defaultOpen: true,
      className: 'card manager-plan-build-tools-card',
      summaryClass: 'card-title manager-plan-collapse-summary',
    },
  )}
    <div id="active-runs-anchor">
      ${renderActiveRunsSectionHTML(activeRunData, activeRunsProductMap)}
    </div>
    <div class="card manager-plan-goto-ready-card">
      <button type="button" class="btn btn-primary" id="goto-daily-ready" style="width:100%">
        📋 עבור לתוכנית המוכנה${countable.length ? ` (${countable.length} פריטים)` : ''}
      </button>
    </div>`;

  const readyBody = `
    ${headerReady}
    ${readyListCard}
    ${flowsPageHtml}`;

  container.innerHTML = `
    ${managerTabsHTML('daily')}
    ${renderDailyPlanModeTabs(mode, { itemCount: countable.length })}
    <div class="manager-daily-mode-panel manager-daily-mode-panel--${mode}">
      ${mode === 'build' ? buildBody : readyBody}
    </div>`;

  bindManagerTabs(container);
  bindPlanItems(container, 'daily', date, { employees });
  bindActiveRunsSection(container, { planType: 'daily', anchorDate: date });
  bindPlanCollapse(container);

  container.querySelectorAll('[data-daily-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setDailyPlanMode(container, btn.dataset.dailyMode);
      renderManager(container);
    });
  });
  document.getElementById('goto-daily-ready')?.addEventListener('click', () => {
    setDailyPlanMode(container, 'ready');
    renderManager(container);
  });
  document.getElementById('goto-daily-build')?.addEventListener('click', () => {
    setDailyPlanMode(container, 'build');
    renderManager(container);
  });

  document.getElementById('plan-date')?.addEventListener('change', (e) => {
    container.dataset.planDate = e.target.value;
    renderManager(container);
  });

  document.getElementById('jump-active-runs')?.addEventListener('click', () => {
    if (mode !== 'build') {
      setDailyPlanMode(container, 'build');
      renderManager(container);
      requestAnimationFrame(() => {
        document.getElementById('active-runs-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return;
    }
    if (getActiveRunsHidden()) {
      setActiveRunsHidden(false);
      renderManager(container);
      requestAnimationFrame(() => {
        document.getElementById('active-runs-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return;
    }
    document.getElementById('active-runs-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('clear-daily-plan')?.addEventListener('click', async () => {
    if (!items.length) return;
    if (!confirm('לנקות את כל תוכנית היום?\n\nרק התוכנית — לא משנה תזרים או ייצור.')) return;
    try {
      await clearManagerPlanItems('daily', date);
      showToast('התוכנית נוקתה ✓');
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  const exportPlan = async () => {
    const dateLabel = formatDateHebrew(date);
    const flowsData = await collectPlanProductFlowsForExport(items);
    const organized = organizeDailyPlanForExport(items, products, plan, { flowNames });
    const bodyHtml = buildDailyPlanBodyHtml(organized);
    const flowsPageExportHtml = buildDailyPlanFlowsPageHtml(flowsData);
    return { dateLabel, bodyHtml, flowsPageHtml: flowsPageExportHtml, flowsData };
  };

  document.getElementById('export-daily-plan')?.addEventListener('click', async () => {
    const { dateLabel, bodyHtml, flowsPageHtml: exportFlowsHtml } = await exportPlan();
    try {
      const result = await saveDailyPlanAsHtml({
        dateLabel,
        subtitle: formatDate(date),
        bodyHtml,
        flowsPageHtml: exportFlowsHtml,
        filename: `תוכנית-יומית-${date}.html`,
      });
      if (result !== 'cancelled') showToast('הקובץ נשמר ✓');
    } catch {
      showToast('שגיאה בייצוא');
    }
  });

  document.getElementById('print-daily-plan')?.addEventListener('click', async () => {
    const { dateLabel, bodyHtml, flowsData } = await exportPlan();
    const html = buildDailyPlanExportHtml({
      dateLabel,
      subtitle: formatDate(date),
      items,
      products,
      plan,
      flowNames,
      flowsData,
    });
    if (!printDailyPlanHtml(html)) {
      showToast('חסום חלון קופץ — אפשר הדפסה מהדפדפן');
    }
  });
}

async function renderWeeklyPlan(container) {
  const weekStart = weekStartISO(container.dataset.weekStart || todayISO());
  const dayLabels = weekDayLabels();
  const selectedDay = container.dataset.planWeekDay != null
    ? Number(container.dataset.planWeekDay)
    : Math.min(6, Math.max(0, Math.floor((Date.parse(todayISO()) - Date.parse(weekStart)) / 86400000)));
  const [plan, items, products, layout, employees, flows] = await Promise.all([
    getManagerPlan('weekly', weekStart),
    getManagerPlanItems('weekly', weekStart),
    getProducts(true),
    getProductsCatalogLayout(),
    getManagerEmployees({ activeOnly: true }),
    getAllFlowsOverview(),
  ]);
  const weekEnd = addDaysISO(weekStart, 6);
  const dayItems = items.filter((i) => (i.dayOffset ?? 0) === selectedDay);
  const { productFlowMap, productFlowNamesMap, flowNames } = await buildPlanFlowContext(items, { dayOffset: selectedDay });
  const done = dayItems.filter((i) => i.done).length;
  const progressPct = dayItems.length ? Math.round((done / dayItems.length) * 100) : 0;

  container.innerHTML = `
    ${managerTabsHTML('weekly')}
    <div class="card manager-plan-header-card">
      <div class="form-group" style="margin-bottom:8px">
        <label for="week-start">שבוע (מתחיל ביום ראשון)</label>
        <input type="date" id="week-start" value="${weekStart}">
      </div>
      <p class="form-hint">${formatDate(weekStart)} — ${formatDate(weekEnd)}</p>
    </div>

    <div class="card">
      <div class="card-title">ימי השבוע</div>
      <div class="manager-plan-week-tabs">
        ${dayLabels.map((label, i) => {
    const count = items.filter((it) => (it.dayOffset ?? 0) === i).length;
    const dayDone = items.filter((it) => (it.dayOffset ?? 0) === i && it.done).length;
    return `<button type="button" class="manager-plan-week-tab${i === selectedDay ? ' is-active' : ''}" data-day="${i}">
      <span class="manager-plan-week-tab-label">${label}</span>
      <span class="manager-plan-week-tab-meta">${count ? `${dayDone}/${count}` : '—'}</span>
    </button>`;
  }).join('')}
      </div>
    </div>

    <details class="card manager-plan-notes-details"${plan?.notes ? ' open' : ''}>
      <summary class="manager-plan-notes-summary">📝 מטרות השבוע</summary>
      <textarea id="plan-notes" rows="2" placeholder="יעדים, אירועים, הזמנות גדולות...">${escapeHtml(plan?.notes || '')}</textarea>
      <button type="button" class="btn btn-secondary btn-sm" id="save-plan-notes" style="margin-top:8px">שמור</button>
    </details>

    ${renderPlanAddProductHTML(products, layout, {
      showDay: true,
      flows,
      planItems: items.filter((i) => (i.dayOffset ?? 0) === selectedDay),
    })}

    <div class="card manager-plan-list-card">
      <div class="card-title">${dayLabels[selectedDay]} · ${formatDate(addDaysISO(weekStart, selectedDay))}</div>
      ${dayItems.length ? `
      <div class="manager-plan-progress">
        <div class="manager-plan-progress-bar" style="width:${progressPct}%"></div>
      </div>
      <p class="form-hint manager-plan-progress-label">${done}/${dayItems.length} הושלמו</p>` : ''}
      ${renderProductCentricPlanHTML(items, products, {
        dayOffset: selectedDay,
        productFlowMap,
        productFlowNamesMap,
        flowNames,
        plan,
        showHighlights: false,
      })}
    </div>

    ${items.length ? `
    <details class="card manager-plan-week-overview">
      <summary class="manager-plan-notes-summary">סיכום כל השבוע (${items.length} פריטים)</summary>
      ${dayLabels.map((label, dayOffset) => {
    const dItems = items.filter((i) => (i.dayOffset ?? 0) === dayOffset);
    if (!dItems.length) return '';
    return `
        <div class="manager-plan-week-day-block">
          <div class="manager-plan-week-day-title">${label} · ${formatDate(addDaysISO(weekStart, dayOffset))}</div>
          ${renderProductCentricPlanHTML(items, products, { dayOffset })}
        </div>`;
  }).join('')}
    </details>` : ''}`;

  bindManagerTabs(container);
  bindPlanItems(container, 'weekly', weekStart, { employees });
  bindPlanCollapse(container);

  document.getElementById('week-start')?.addEventListener('change', (e) => {
    container.dataset.weekStart = weekStartISO(e.target.value);
    renderManager(container);
  });

  container.querySelectorAll('.manager-plan-week-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.planWeekDay = btn.dataset.day;
      const daySel = document.getElementById('plan-day');
      if (daySel) daySel.value = btn.dataset.day;
      renderManager(container);
    });
  });

  const daySel = document.getElementById('plan-day');
  if (daySel) daySel.value = String(selectedDay);
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

const IMPROVEMENT_URGENCY = {
  red: { label: 'דחוף', hint: 'אדום' },
  yellow: { label: 'בינוני', hint: 'צהוב' },
  green: { label: 'נמוך', hint: 'ירוק' },
};

function improvementUrgencyColor(item) {
  if (item?.urgencyColor && IMPROVEMENT_URGENCY[item.urgencyColor]) return item.urgencyColor;
  if (item?.priority === 'high') return 'red';
  if (item?.priority === 'low') return 'green';
  return 'yellow';
}

function improvementRow(item) {
  const color = improvementUrgencyColor(item);
  const urgency = IMPROVEMENT_URGENCY[color];
  return `
    <div class="improvement-item improvement-urgency-${color}${item.status === 'done' ? ' improvement-item--done' : ''}" data-idea-id="${item.id}">
      <span class="improvement-drag-handle product-drag-handle" role="button" tabindex="0" aria-label="גרור לשינוי סדר">⠿</span>
      <span class="improvement-order-num" aria-label="מיקום">1</span>
      <span class="improvement-urgency-strip" title="${urgency.label} · ${urgency.hint}"></span>
      <div class="improvement-body">
        <div class="improvement-title">${escapeHtml(item.title)}</div>
        ${item.body ? `<div class="improvement-desc">${escapeHtml(item.body)}</div>` : ''}
        <span class="improvement-urgency-label">${urgency.hint} · ${urgency.label}</span>
      </div>
      <div class="improvement-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-action="edit" title="עריכה">✏️</button>
        <button type="button" class="btn btn-danger btn-sm" data-action="delete" title="מחק">🗑</button>
      </div>
    </div>`;
}

function urgencyColorPickerHTML(selected = 'yellow') {
  return `
    <div class="form-group">
      <label>דחיפות (צבע)</label>
      <div class="improvement-urgency-picker">
        ${Object.entries(IMPROVEMENT_URGENCY).map(([id, meta]) => `
          <label class="improvement-urgency-option improvement-urgency-option--${id}${selected === id ? ' is-selected' : ''}">
            <input type="radio" name="improvement-urgency" value="${id}" ${selected === id ? 'checked' : ''}>
            <span class="improvement-urgency-swatch"></span>
            <span>${meta.hint} ${meta.label}</span>
          </label>`).join('')}
      </div>
    </div>`;
}

function openImprovementModal(container, { taskId = null, defaultDepartment = 'production' } = {}) {
  openModal({
    title: taskId ? 'עריכת רעיון' : 'רעיון לשיפור',
    bodyHTML: `<div id="improvement-modal-loading">טוען...</div>`,
    footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-improvement">שמור</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  (async () => {
    let task = null;
    if (taskId) {
      const all = await getManagerTasks({ kind: 'improvement' });
      task = all.find((t) => t.id === taskId);
    }
    const urgency = improvementUrgencyColor(task);
    document.getElementById('improvement-modal-loading').outerHTML = `
      <div class="form-group"><label>רעיון</label><input type="text" id="improvement-title" value="${escapeHtml(task?.title || '')}" maxlength="120"></div>
      <div class="form-group"><label>פירוט</label><textarea id="improvement-body" rows="3" maxlength="1000">${escapeHtml(task?.body || '')}</textarea></div>
      <div class="form-group"><label>מחלקה</label><select id="improvement-dept">${deptOptions(task?.department || defaultDepartment)}</select></div>
      ${urgencyColorPickerHTML(urgency)}`;

    document.getElementById('save-improvement')?.addEventListener('click', async () => {
      const urgencyEl = document.querySelector('input[name="improvement-urgency"]:checked');
      const payload = {
        title: document.getElementById('improvement-title').value,
        body: document.getElementById('improvement-body').value,
        department: document.getElementById('improvement-dept').value,
        urgencyColor: urgencyEl?.value || 'yellow',
      };
      try {
        if (taskId) {
          await updateManagerTask(taskId, payload);
        } else {
          await addManagerTask({ ...payload, kind: 'improvement' });
        }
        closeModal();
        showToast('נשמר ✓');
        container.dataset.managerTab = 'improvements';
        renderManager(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });

    document.querySelectorAll('.improvement-urgency-option input').forEach((input) => {
      input.addEventListener('change', () => {
        document.querySelectorAll('.improvement-urgency-option').forEach((el) => {
          el.classList.toggle('is-selected', el.querySelector('input')?.checked);
        });
      });
    });
  })();
}

function bindImprovementBoard(container) {
  container.querySelectorAll('.improvement-item [data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.improvement-item');
      openImprovementModal(container, { taskId: Number(row?.dataset.ideaId) });
    });
  });
  container.querySelectorAll('.improvement-item [data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.improvement-item');
      if (!confirm('למחוק את הרעיון?')) return;
      await deleteManagerTask(Number(row?.dataset.ideaId));
      showToast('נמחק');
      renderManager(container);
    });
  });
  container.querySelectorAll('[data-add-improvement-dept]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openImprovementModal(container, { defaultDepartment: btn.dataset.addImprovementDept });
    });
  });
  bindImprovementDragLists(container, async (department, ids) => {
    try {
      await setImprovementOrder(department, ids);
      showToast('סדר עודכן ✓');
    } catch (err) {
      showToast(err.message || 'שגיאה');
      renderManager(container);
    }
  });
}

async function renderImprovementsBoard(container) {
  const [ideas, departments] = await Promise.all([
    getManagerTasks({ kind: 'improvement' }),
    getManagerDepartments(),
  ]);
  const byDept = new Map();
  for (const dept of departments) byDept.set(dept.deptKey, []);
  for (const idea of ideas) {
    const key = idea.department || 'general';
    if (!byDept.has(key)) byDept.set(key, []);
    byDept.get(key).push(idea);
  }

  const sections = departments.map((dept) => {
    const items = byDept.get(dept.deptKey) || [];
    return `
      <div class="card improvement-dept-card">
        <div class="improvement-dept-header">
          <h3 class="improvement-dept-title">${dept.icon} ${escapeHtml(dept.label)}</h3>
          <span class="improvement-dept-count">${items.length} רעיונות</span>
          <button type="button" class="btn btn-secondary btn-sm" data-add-improvement-dept="${escapeHtml(dept.deptKey)}">+ רעיון</button>
        </div>
        ${items.length
    ? `<p class="product-drag-hint">גרור ⠿ לשינוי סדר בתוך המחלקה</p>
           <div class="improvement-sortable" data-department="${escapeHtml(dept.deptKey)}">
             ${items.map((item) => improvementRow(item)).join('')}
           </div>`
    : '<p class="form-hint improvement-dept-empty">אין רעיונות במחלקה זו — לחץ + רעיון</p>'}
      </div>`;
  }).join('');

  container.innerHTML = `
    ${managerTabsHTML('improvements', { improvements: ideas.filter((i) => i.status !== 'done').length || null })}
    <div class="card">
      <div class="card-title">💡 רעיונות לשיפור העסק</div>
      <p class="form-hint" style="margin-bottom:0">מחולק לפי מחלקות · בחר צבע לפי דחיפות: אדום / צהוב / ירוק</p>
    </div>
    ${sections || '<div class="card"><p class="form-hint">הגדר מחלקות בלשונית צוות</p></div>'}`;

  bindManagerTabs(container);
  bindImprovementBoard(container);
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

async function renderDepartmentCleaning(container) {
  const lists = await getDepartmentCleaningLists();
  let selectedId = container.dataset.cleaningListId || '';
  if (!lists.some((l) => String(l.id) === String(selectedId))) {
    selectedId = lists[0]?.id ? String(lists[0].id) : '';
    container.dataset.cleaningListId = selectedId;
  }
  const selectedList = lists.find((l) => String(l.id) === String(selectedId)) || null;
  const tasks = selectedList ? await getDepartmentCleaningTasks(selectedList.id) : [];

  container.innerHTML = `
    ${managerTabsHTML('cleaning')}
    <div class="card">
      <div class="card-title">🧹 ניקוי מחלקות</div>
      <p class="form-hint" style="margin-bottom:12px">בנה רשימת משימות ניקוי לכל מחלקה — עריכה חופשית, כל מחלקה בנפרד</p>
      <div class="filter-row" style="margin-bottom:12px">
        <input type="text" id="new-cleaning-dept-name" placeholder="שם מחלקה (למשל: קונדיטוריה)" style="flex:1">
        <button type="button" class="btn btn-primary btn-sm" id="add-cleaning-dept-btn">+ מחלקה</button>
      </div>
      ${lists.length ? `
        <div class="manager-cleaning-dept-tabs">
          ${lists.map((l) => `
            <button type="button" class="manager-cleaning-dept-tab${String(l.id) === String(selectedId) ? ' is-active' : ''}" data-id="${l.id}">
              <span class="manager-cleaning-dept-tab-label">${escapeHtml(l.name)}</span>
              <span class="manager-cleaning-dept-tab-meta">${l.taskCount || '—'}</span>
            </button>`).join('')}
        </div>` : '<p class="form-hint">אין מחלקות — הוסף את הראשונה למעלה</p>'}
    </div>

    ${selectedList ? `
    <div class="card manager-cleaning-tasks-card">
      <div class="filter-row" style="margin-bottom:10px;align-items:flex-start">
        <div style="flex:1">
          <div class="card-title" style="margin:0">${escapeHtml(selectedList.name)}</div>
          ${selectedList.notes ? `<p class="form-hint manager-cleaning-dept-notes">${escapeHtml(selectedList.notes)}</p>` : ''}
        </div>
        <button type="button" class="btn btn-secondary btn-sm edit-cleaning-dept"
          data-id="${selectedList.id}"
          data-name="${escapeHtml(selectedList.name)}"
          data-notes="${escapeHtml(selectedList.notes || '')}">✏️</button>
        <button type="button" class="btn btn-danger btn-sm delete-cleaning-dept" data-id="${selectedList.id}">🗑</button>
      </div>

      <div class="card-title" style="font-size:0.9rem;margin:12px 0 8px">משימות ניקוי מוכנות</div>
      <p class="form-hint" style="margin-bottom:8px">גרור ⠿ לשינוי סדר</p>
      ${tasks.length ? `
        <ul class="manager-cleaning-task-list flow-checklist-sortable" data-checklist-kind="dept-clean">
          ${tasks.map((t, i) => `
            <li class="manager-cleaning-task-item flow-checklist-item" data-dept-clean-id="${t.id}">
              <span class="flow-checklist-drag-handle product-drag-handle" role="button" tabindex="0" aria-label="גרור לשינוי סדר">⠿</span>
              <span class="manager-cleaning-task-num flow-checklist-order-num">${i + 1}.</span>
              <span class="manager-cleaning-task-name">${escapeHtml(t.name)}</span>
              <button type="button" class="btn btn-secondary btn-sm edit-cleaning-task"
                data-id="${t.id}" data-name="${escapeHtml(t.name)}" title="ערוך">✏️</button>
              <button type="button" class="btn btn-danger btn-sm delete-cleaning-task" data-id="${t.id}" title="מחק">🗑</button>
            </li>`).join('')}
        </ul>` : '<p class="form-hint">אין משימות — הוסף למטה</p>'}

      <div class="filter-row" style="margin-top:12px">
        <input type="text" id="new-cleaning-task-name" placeholder="משימת ניקוי (למשל: ניקוי משטחי עבודה)" style="flex:1">
        <button type="button" class="btn btn-primary btn-sm" id="add-cleaning-task-btn">+ הוסף</button>
      </div>
    </div>` : ''}`;

  bindManagerTabs(container);

  document.getElementById('add-cleaning-dept-btn')?.addEventListener('click', async () => {
    try {
      const id = await addDepartmentCleaningList({
        name: document.getElementById('new-cleaning-dept-name')?.value,
      });
      container.dataset.cleaningListId = String(id);
      showToast('מחלקה נוספה ✓');
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  container.querySelectorAll('.manager-cleaning-dept-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.cleaningListId = btn.dataset.id;
      renderManager(container);
    });
  });

  container.querySelectorAll('.edit-cleaning-dept').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal({
        title: 'עריכת מחלקה',
        bodyHTML: `
          <div class="form-group"><label>שם מחלקה</label>
            <input type="text" id="edit-cleaning-dept-name" value="${btn.dataset.name}"></div>
          <div class="form-group"><label>הערות (אופציונלי)</label>
            <textarea id="edit-cleaning-dept-notes" rows="2">${btn.dataset.notes || ''}</textarea></div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-cleaning-dept">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('save-cleaning-dept')?.addEventListener('click', async () => {
        try {
          await updateDepartmentCleaningList(btn.dataset.id, {
            name: document.getElementById('edit-cleaning-dept-name').value,
            notes: document.getElementById('edit-cleaning-dept-notes').value,
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

  container.querySelectorAll('.delete-cleaning-dept').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק מחלקה ואת כל משימות הניקוי שלה?')) return;
      try {
        await deleteDepartmentCleaningList(btn.dataset.id);
        container.dataset.cleaningListId = '';
        showToast('נמחק');
        renderManager(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.getElementById('add-cleaning-task-btn')?.addEventListener('click', async () => {
    if (!selectedList) return;
    try {
      await addDepartmentCleaningTask(selectedList.id, document.getElementById('new-cleaning-task-name')?.value);
      showToast('משימה נוספה ✓');
      renderManager(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('new-cleaning-task-name')?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !selectedList) return;
    e.preventDefault();
    document.getElementById('add-cleaning-task-btn')?.click();
  });

  container.querySelectorAll('.edit-cleaning-task').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal({
        title: 'עריכת משימת ניקוי',
        bodyHTML: `<div class="form-group"><label>שם משימה</label>
          <input type="text" id="edit-cleaning-task-name" value="${btn.dataset.name}"></div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-cleaning-task">שמור</button>`,
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('save-cleaning-task')?.addEventListener('click', async () => {
        try {
          await updateDepartmentCleaningTask(btn.dataset.id, {
            name: document.getElementById('edit-cleaning-task-name').value,
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

  container.querySelectorAll('.delete-cleaning-task').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק משימה?')) return;
      try {
        await deleteDepartmentCleaningTask(btn.dataset.id);
        showToast('נמחק');
        renderManager(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  if (selectedList) {
    bindFlowChecklistDragLists(container, {
      onDeptCleanOrderSave: (ids) => setDepartmentCleaningTaskOrder(selectedList.id, ids),
    });
  }
}

export async function renderManager(container) {
  await loadManagerDepartments();
  syncManagerPlanNavigation(container);
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
    case 'cleaning': return renderDepartmentCleaning(container);
    case 'tasks': return renderTaskList(container, 'task');
    case 'improvements': return renderImprovementsBoard(container);
    case 'purchasing': {
      container.innerHTML = managerTabsHTML('purchasing');
      bindManagerTabs(container);
      const inner = document.createElement('div');
      inner.className = 'manager-purchasing-embed';
      container.appendChild(inner);
      await renderPurchasingInManager(inner, {
        rootContainer: container,
        refresh: () => renderManager(container),
      });
      return;
    }
    case 'incidents': return renderIncidents(container);
    case 'notes': return renderNotes(container);
    default: return renderOverview(container);
  }
}

export function managerMeta() {
  const { year, month } = currentMonth();
  return { title: 'ניהול מנהל', subtitle: monthLabel(year, month) };
}
