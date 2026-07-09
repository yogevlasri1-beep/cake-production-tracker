import {
  getCategories, getProducts, getEntriesForDate, getEntriesForMonth,
  getEntriesInRange, getProductionTotals, getProcessLogsInRange,
  getProcessLogsForDate, getProcessLogsForMonth, getProductionRunsInRange,
  getCategoryGroups, getAllFlowsOverview, getRunProductionEntries,
  getStepPortionBatches, getStepPortionTotal, formatPortionBatchSummary,
  computeRunMetrics, aggregateRunsMetrics, getProductsCatalogLayout,
  getManagerDepartments, getManagerTasks, getManagerIncidents,
  getManagerShiftNotes, getManagerEmployees, getManagerResponsibilityAreas,
  getDepartmentCleaningLists, getDepartmentCleaningTasks, getTargets,
} from '../db.js?v=279';
import {
  todayISO, formatDate, formatDateHebrew, formatMoney, currentMonth,
  showToast, escapeHtml, formatPortionCount, formatPortionWeightKg, formatDecimal, formatDuration, runDurationMs, stepDurationMs, formatDateTime, formatProductQuantity,
  addDaysISO,
} from '../utils.js?v=279';
import {
  exportProductionExcel, exportProcessExcel, exportCombinedExcel,
  summarizeProcessLogs, monthRange, weekRange,
} from '../export.js?v=279';
import { openModal, closeModal } from '../modal.js?v=279';
import {
  renderSheetsStatusHTML, bindSheetsStatusEvents, exportReportToSheets,
  openSheetsSetupModal,
} from '../sheets-flow.js?v=279';
import { isSheetsConfigured } from '../google-sheets.js?v=279';
import {
  buildProductMap, sumCategoryTotals, productProductionValue, productProductionCost,
  mapGetById, sortProductsForReport, compareReportProducts,
} from '../calc.js?v=279';
import { defaultColorForIndex } from '../chart.js?v=279';
import { saveReportPageAsHtml, printReportElement } from '../report-page-export.js?v=279';
import {
  getPurchaseCategories, getPurchaseItems, PURCHASE_STATUS_LABELS,
} from '../purchasing-db.js?v=279';

const MANAGER_PRIORITY_LABELS = { low: 'נמוך', medium: 'בינוני', high: 'גבוה' };
const MANAGER_TASK_STATUS = { open: 'פתוח', progress: 'בתהליך', done: 'הושלם' };
const MANAGER_INCIDENT_SEVERITY = { minor: 'קל', major: 'חמור', critical: 'קריטי' };
const MANAGER_INCIDENT_STATUS = { open: 'פתוח', investigating: 'בבדיקה', resolved: 'טופל' };
const MANAGER_URGENCY_LABELS = { red: 'דחוף', yellow: 'בינוני', green: 'נמוך' };
const MANAGER_NOTE_KIND_LABELS = { shift: 'משמרת', briefing: 'תדרוך', checklist: 'צ׳קליסט' };

export function isFlowsReportType(type) {
  return type === 'flows-detail' || type === 'flows-summary' || type === 'flows';
}

export function isManagerReportType(type) {
  return type === 'manager';
}

export function normalizeReportType(type) {
  if (type === 'flows') return 'flows-summary';
  return type || 'day';
}

export const PRODUCTION_HISTORY_SCOPES = ['product', 'category', 'group'];

export function productIdsForHistoryScope(scopeType, scopeId, products, categories) {
  const id = Number(scopeId);
  if (!id) return null;
  if (scopeType === 'product') return new Set([id]);
  if (scopeType === 'category') {
    return new Set(products.filter((p) => Number(p.categoryId) === id).map((p) => p.id));
  }
  if (scopeType === 'group') {
    const catIds = new Set(
      categories.filter((c) => Number(c.groupId) === id).map((c) => c.id),
    );
    return new Set(products.filter((p) => catIds.has(p.categoryId)).map((p) => p.id));
  }
  return null;
}

export function filterProductionHistoryEntries(entries, {
  scopeType, scopeId, products, categories, from, to, allTime,
}) {
  const productIds = productIdsForHistoryScope(scopeType, scopeId, products, categories);
  if (!productIds || productIds.size === 0) return [];
  let filtered = (entries || []).filter((e) => productIds.has(e.productId));
  if (!allTime && from && to) {
    if (from > to) [from, to] = [to, from];
    filtered = filtered.filter((e) => e.date >= from && e.date <= to);
  }
  return filtered;
}

export function sortProductionHistoryEntries(entries, productMap, categories) {
  return (entries || []).slice().sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    const pa = mapGetById(productMap, a.productId);
    const pb = mapGetById(productMap, b.productId);
    return compareReportProducts(pa || {}, pb || {}, categories);
  });
}

export function groupRunsByFlow(productionRuns) {
  const byFlow = new Map();
  const noFlowRuns = [];
  for (const run of productionRuns) {
    const fid = Number(run.flowId);
    if (!fid) {
      noFlowRuns.push(run);
      continue;
    }
    if (!byFlow.has(fid)) byFlow.set(fid, []);
    byFlow.get(fid).push(run);
  }
  return { byFlow, noFlowRuns };
}

export function managerRecordInDateRange(isoOrDate, from, to) {
  if (!isoOrDate || !from || !to) return false;
  const d = String(isoOrDate).slice(0, 10);
  return d >= from && d <= to;
}

export function filterManagerTasksByRange(tasks, from, to) {
  return (tasks || []).filter((t) =>
    managerRecordInDateRange(t.createdAt, from, to)
    || managerRecordInDateRange(t.dueDate, from, to)
    || managerRecordInDateRange(t.completedAt, from, to));
}

async function collectShiftNotesInRange(from, to) {
  const notes = [];
  let cursor = from;
  while (cursor <= to) {
    const dayNotes = await getManagerShiftNotes(cursor);
    notes.push(...dayNotes);
    cursor = addDaysISO(cursor, 1);
  }
  return notes.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

async function fetchManagerReportData(from, to, { categories, productMap } = {}) {
  const [
    departments, allTasks, incidents, employees, areas,
    cleaningLists, targets, purchaseCategories,
  ] = await Promise.all([
    getManagerDepartments(),
    getManagerTasks(),
    getManagerIncidents(),
    getManagerEmployees(),
    getManagerResponsibilityAreas(),
    getDepartmentCleaningLists(),
    getTargets(),
    getPurchaseCategories(),
  ]);

  const deptMap = new Map(departments.map((d) => [d.deptKey, d]));
  const areaMap = new Map(areas.map((a) => [a.id, a.name]));
  const catMap = new Map((categories || []).map((c) => [c.id, c.name]));

  const tasks = filterManagerTasksByRange(allTasks.filter((t) => t.kind === 'task'), from, to);
  const improvements = filterManagerTasksByRange(allTasks.filter((t) => t.kind === 'improvement'), from, to);
  const filteredIncidents = incidents.filter((i) => managerRecordInDateRange(i.occurredAt, from, to));
  const shiftNotes = await collectShiftNotesInRange(from, to);

  const cleaning = await Promise.all(cleaningLists.map(async (list) => ({
    list,
    tasks: await getDepartmentCleaningTasks(list.id),
  })));

  const purchases = await Promise.all(purchaseCategories.map(async (cat) => ({
    category: cat,
    items: await getPurchaseItems(cat.id),
  })));

  const targetRows = (targets || []).map((t) => {
    let label = '';
    if (t.scope === 'total') label = 'יעד כולל';
    else if (t.scope === 'money') label = 'יעד כסף';
    else if (t.scope === 'category') label = catMap.get(Number(t.scopeId)) || `קטגוריה #${t.scopeId}`;
    else if (t.scope === 'product') label = mapGetById(productMap, t.scopeId)?.name || `מוצר #${t.scopeId}`;
    return { ...t, label };
  });

  return {
    departments, deptMap, areaMap, tasks, improvements, incidents: filteredIncidents,
    shiftNotes, employees, areas, cleaning, targets: targetRows, purchases,
  };
}

function managerDeptLabel(deptMap, key) {
  const d = deptMap.get(key);
  return d ? `${d.icon || ''} ${d.label}`.trim() : key;
}

function renderManagerReportSection(title, bodyHtml, emptyHint = 'אין נתונים') {
  const inner = bodyHtml || `<p class="report-empty">${emptyHint}</p>`;
  return `
    <section class="report-manager-section">
      <h4 class="report-preview-heading">${escapeHtml(title)}</h4>
      ${inner}
    </section>`;
}

function renderManagerTable(headers, rows) {
  if (!rows.length) return '';
  return `
    <div class="report-table-wrap">
      <table class="report-table report-manager-table">
        <thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

function buildManagerReportHTML(data, ctx) {
  const { deptMap, areaMap } = data;

  const tasksHtml = renderManagerTable(
    ['משימה', 'מחלקה', 'סטטוס', 'דחיפות', 'יעד', 'נוצר'],
    data.tasks.map((t) => `<tr>
      <td class="report-cell-text">${escapeHtml(t.title)}${t.body ? `<div class="form-hint">${escapeHtml(t.body)}</div>` : ''}</td>
      <td>${escapeHtml(managerDeptLabel(deptMap, t.department))}</td>
      <td>${MANAGER_TASK_STATUS[t.status] || t.status}</td>
      <td>${MANAGER_PRIORITY_LABELS[t.priority] || t.priority}</td>
      <td>${t.dueDate ? formatDate(t.dueDate) : '—'}</td>
      <td>${t.createdAt ? formatDate(String(t.createdAt).slice(0, 10)) : '—'}</td>
    </tr>`),
  );

  const improvementsHtml = renderManagerTable(
    ['רעיון', 'מחלקה', 'דחיפות', 'סטטוס', 'נוצר'],
    data.improvements.map((t) => `<tr>
      <td class="report-cell-text">${escapeHtml(t.title)}${t.body ? `<div class="form-hint">${escapeHtml(t.body)}</div>` : ''}</td>
      <td>${escapeHtml(managerDeptLabel(deptMap, t.department))}</td>
      <td>${MANAGER_URGENCY_LABELS[t.urgencyColor] || MANAGER_PRIORITY_LABELS[t.priority] || '—'}</td>
      <td>${MANAGER_TASK_STATUS[t.status] || t.status}</td>
      <td>${t.createdAt ? formatDate(String(t.createdAt).slice(0, 10)) : '—'}</td>
    </tr>`),
  );

  const incidentsHtml = renderManagerTable(
    ['תקלה', 'מחלקה', 'חומרה', 'סטטוס', 'תאריך'],
    data.incidents.map((i) => `<tr>
      <td class="report-cell-text">${escapeHtml(i.title)}${i.description ? `<div class="form-hint">${escapeHtml(i.description)}</div>` : ''}</td>
      <td>${escapeHtml(managerDeptLabel(deptMap, i.department))}</td>
      <td>${MANAGER_INCIDENT_SEVERITY[i.severity] || i.severity}</td>
      <td>${MANAGER_INCIDENT_STATUS[i.status] || i.status}</td>
      <td>${i.occurredAt ? formatDate(i.occurredAt) : '—'}</td>
    </tr>`),
  );

  const notesHtml = renderManagerTable(
    ['תאריך', 'מחלקה', 'סוג', 'תוכן'],
    data.shiftNotes.map((n) => `<tr>
      <td>${formatDate(n.date)}</td>
      <td>${escapeHtml(managerDeptLabel(deptMap, n.department))}</td>
      <td>${MANAGER_NOTE_KIND_LABELS[n.kind] || n.kind}</td>
      <td class="report-cell-text">${escapeHtml(n.content)}</td>
    </tr>`),
  );

  const teamHtml = `
    ${data.departments.length ? `<p class="form-hint"><strong>מחלקות:</strong> ${data.departments.map((d) => `${d.icon || ''} ${escapeHtml(d.label)}`).join(' · ')}</p>` : ''}
    ${renderManagerTable(
    ['עובד', 'תחום אחריות', 'סטטוס'],
    data.employees.map((e) => `<tr>
      <td>${escapeHtml(e.name)}</td>
      <td>${escapeHtml(areaMap.get(e.responsibilityAreaId) || '—')}</td>
      <td>${e.active === false ? 'לא פעיל' : 'פעיל'}</td>
    </tr>`),
  )}
    ${data.areas.length ? `<p class="form-hint" style="margin-top:8px"><strong>תחומי אחריות:</strong> ${data.areas.map((a) => escapeHtml(a.name)).join(' · ')}</p>` : ''}`;

  const cleaningHtml = data.cleaning.length
    ? data.cleaning.map(({ list, tasks }) => `
      <div class="report-manager-cleaning-block">
        <strong>${escapeHtml(list.name)}</strong>
        ${list.notes ? `<p class="form-hint">${escapeHtml(list.notes)}</p>` : ''}
        ${tasks.length
    ? `<ul class="report-manager-list">${tasks.map((t) => `<li>${escapeHtml(t.name)}</li>`).join('')}</ul>`
    : '<p class="form-hint">אין משימות ברשימה</p>'}
      </div>`).join('')
    : '';

  const targetsHtml = renderManagerTable(
    ['יעד', 'תקופה', 'כמות'],
    data.targets.map((t) => `<tr>
      <td>${escapeHtml(t.label)}</td>
      <td>${t.period === 'monthly' ? 'חודשי' : 'יומי'}</td>
      <td class="report-cell-num">${t.scope === 'money' ? formatMoney(t.quantity) : formatDecimal(t.quantity)}</td>
    </tr>`),
  );

  const purchasesHtml = data.purchases.some((p) => p.items.length)
    ? data.purchases.map(({ category, items }) => items.length ? `
      <div class="report-manager-purchase-block">
        <strong>${escapeHtml(category.name)}</strong>
        ${renderManagerTable(
    ['פריט', 'ספק', 'כמות', 'מחיר', 'סטטוס'],
    items.map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.supplier || '—')}</td>
      <td class="report-cell-num">${item.quantity != null ? `${formatDecimal(item.quantity)}${item.unit ? ` ${escapeHtml(item.unit)}` : ''}` : '—'}</td>
      <td class="report-cell-num">${item.unitPrice != null ? formatMoney(item.unitPrice) : '—'}</td>
      <td>${PURCHASE_STATUS_LABELS[item.status] || item.status}</td>
    </tr>`),
  )}
      </div>` : '').join('')
    : '';

  return `
    <p class="form-hint report-manager-intro">דוח עמדת מנהל · ${escapeHtml(ctx.label)} · ללא תוכנית יומית ושבועית</p>
    ${renderManagerReportSection('✅ משימות', tasksHtml, 'אין משימות בתקופה')}
    ${renderManagerReportSection('💡 שיפור העסק', improvementsHtml, 'אין נקודות שיפור בתקופה')}
    ${renderManagerReportSection('⚠️ תקלות', incidentsHtml, 'אין תקלות בתקופה')}
    ${renderManagerReportSection('📝 הערות משמרת', notesHtml, 'אין הערות משמרת בתקופה')}
    ${renderManagerReportSection('👥 צוות ומחלקות', teamHtml, 'אין נתוני צוות')}
    ${renderManagerReportSection('🧹 ניקוי מחלקות', cleaningHtml, 'אין רשימות ניקוי')}
    ${renderManagerReportSection('🎯 יעדים', targetsHtml, 'לא הוגדרו יעדים')}
    ${renderManagerReportSection('🛒 רכישות לשיפור העסק', purchasesHtml, 'אין פריטי רכישה')}`;
}

function parseMonthValue(value, fallbackYear, fallbackMonth) {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-').map(Number);
    return { year, month, iso: value };
  }
  return {
    year: fallbackYear,
    month: fallbackMonth,
    iso: `${fallbackYear}-${String(fallbackMonth).padStart(2, '0')}`,
  };
}

function monthStartIso(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function resolveReportContext(container, today, curYear, curMonth, catMap, productMap) {
  const reportType = normalizeReportType(container.dataset.reportType);
  const defaultMonth = `${curYear}-${String(curMonth).padStart(2, '0')}`;

  let from = today;
  let to = today;
  let label = formatDate(today);
  let reportTitle = 'דוח יומי';
  let filterLabel = '';
  let selectedCategoryId = container.dataset.selectedCategory || '';
  let selectedProductId = container.dataset.selectedProduct || '';
  let weekDates = null;
  let weekAnchor = null;

  if (reportType === 'day') {
    from = container.dataset.selectedDay || today;
    to = from;
    label = formatDate(from);
    reportTitle = 'דוח יומי';
  } else if (reportType === 'month') {
    const selectedMonth = parseMonthValue(container.dataset.selectedMonth, curYear, curMonth);
    const mr = monthRange(selectedMonth.year, selectedMonth.month);
    from = mr.from;
    to = mr.to;
    label = mr.label;
    reportTitle = 'דוח חודשי';
  } else if (reportType === 'week') {
    const anchor = container.dataset.selectedWeekDate || container.dataset.selectedWeekEnd || today;
    const wr = weekRange(anchor);
    from = wr.from;
    to = wr.to;
    weekDates = wr.dates;
    label = `${formatDate(from)} – ${formatDate(to)}`;
    reportTitle = 'דוח שבועי מפורט';
    weekAnchor = anchor;
  } else if (reportType === 'range') {
    from = container.dataset.rangeFrom || monthStartIso(curYear, curMonth);
    to = container.dataset.rangeTo || today;
    if (from > to) [from, to] = [to, from];
    label = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
    reportTitle = 'דוח טווח תאריכים';
  } else if (reportType === 'category') {
    from = container.dataset.rangeFrom || monthStartIso(curYear, curMonth);
    to = container.dataset.rangeTo || today;
    if (from > to) [from, to] = [to, from];
    label = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
    reportTitle = 'דוח לפי קטגוריה';
    filterLabel = catMap.get(Number(selectedCategoryId)) || '';
  } else if (reportType === 'product') {
    from = container.dataset.rangeFrom || monthStartIso(curYear, curMonth);
    to = container.dataset.rangeTo || today;
    if (from > to) [from, to] = [to, from];
    label = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
    reportTitle = 'דוח לפי מוצר';
    filterLabel = mapGetById(productMap, selectedProductId)?.name || '';
  } else if (reportType === 'flows-detail') {
    from = container.dataset.rangeFrom || monthStartIso(curYear, curMonth);
    to = container.dataset.rangeTo || today;
    if (from > to) [from, to] = [to, from];
    label = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
    reportTitle = 'תזרימים מפורט';
  } else if (reportType === 'flows-summary') {
    from = container.dataset.rangeFrom || monthStartIso(curYear, curMonth);
    to = container.dataset.rangeTo || today;
    if (from > to) [from, to] = [to, from];
    label = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
    reportTitle = 'סיכום תזרימים';
  } else if (reportType === 'production-history') {
    const allTime = container.dataset.historyAllTime !== '0';
    from = container.dataset.historyFrom || monthStartIso(curYear, curMonth);
    to = container.dataset.historyTo || today;
    if (from > to) [from, to] = [to, from];
    label = allTime ? 'כל התקופות' : (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);
    reportTitle = 'היסטוריית ייצור';
    const scopeType = container.dataset.historyScope || 'product';
    const scopeId = container.dataset.historyScopeId || '';
    if (scopeType === 'product' && scopeId) {
      filterLabel = mapGetById(productMap, scopeId)?.name || '';
    } else if (scopeType === 'category' && scopeId) {
      filterLabel = catMap.get(Number(scopeId)) || '';
    } else if (scopeType === 'group' && scopeId) {
      filterLabel = container.dataset.historyGroupName || '';
    }
  } else if (reportType === 'manager') {
    from = container.dataset.rangeFrom || monthStartIso(curYear, curMonth);
    to = container.dataset.rangeTo || today;
    if (from > to) [from, to] = [to, from];
    label = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
    reportTitle = 'דוח עמדת מנהל';
  }

  return {
    reportType,
    from,
    to,
    label,
    reportTitle,
    filterLabel,
    selectedCategoryId,
    selectedProductId,
    defaultMonth,
    weekDates,
    weekAnchor,
    historyScope: container.dataset.historyScope || 'product',
    historyScopeId: container.dataset.historyScopeId || '',
    historyAllTime: container.dataset.historyAllTime !== '0',
  };
}

async function fetchReportData(ctx) {
  let entries;
  let processLogs;

  if (ctx.reportType === 'production-history' || ctx.reportType === 'manager') {
    entries = ctx.reportType === 'production-history'
      ? await getEntriesInRange('1970-01-01', todayISO())
      : [];
    processLogs = [];
    return { entries, processLogs, productionRuns: [] };
  }

  if (ctx.reportType === 'day') {
    entries = await getEntriesForDate(ctx.from);
    processLogs = await getProcessLogsForDate(ctx.from);
  } else if (ctx.reportType === 'month') {
    const [year, month] = ctx.monthIso.split('-').map(Number);
    entries = await getEntriesForMonth(year, month);
    processLogs = await getProcessLogsForMonth(year, month);
  } else {
    entries = await getEntriesInRange(ctx.from, ctx.to);
    processLogs = await getProcessLogsInRange(ctx.from, ctx.to);
  }

  if (ctx.reportType === 'category' && ctx.selectedCategoryId) {
    const catId = Number(ctx.selectedCategoryId);
    entries = entries.filter((e) => {
      const p = mapGetById(ctx.productMap, e.productId);
      return p?.categoryId === catId;
    });
    processLogs = processLogs.filter((log) => log.categoryId === catId);
  }

  if (ctx.reportType === 'product' && ctx.selectedProductId) {
    const prodId = Number(ctx.selectedProductId);
    entries = entries.filter((e) => e.productId === prodId);
    const product = mapGetById(ctx.productMap, prodId);
    if (product) {
      processLogs = processLogs.filter((log) => log.categoryId === product.categoryId);
    } else {
      processLogs = [];
    }
  }

  let productionRuns = await getProductionRunsInRange(ctx.from, ctx.to, { includeActiveOutsideRange: true });

  return { entries, processLogs, productionRuns };
}

function runMatchesCategory(run, catId, productMap, categories) {
  if (run.productId) {
    const p = mapGetById(productMap, run.productId);
    if (p?.categoryId === catId) return true;
  }
  if (run.categoryId === catId) return true;
  if (run.categoryIds?.includes(catId)) return true;
  if (run.scopeMode === 'group' && run.categoryGroupId) {
    const cat = categories.find((c) => c.id === catId);
    if (cat && Number(cat.groupId) === Number(run.categoryGroupId)) return true;
  }
  return false;
}

function filterProductionRuns(runs, ctx, categories) {
  let filtered = runs;
  if (ctx.reportType === 'category' && ctx.selectedCategoryId) {
    const catId = Number(ctx.selectedCategoryId);
    filtered = filtered.filter((r) => runMatchesCategory(r, catId, ctx.productMap, categories));
  }
  if (ctx.reportType === 'product' && ctx.selectedProductId) {
    const prodId = Number(ctx.selectedProductId);
    filtered = filtered.filter((r) => r.productId === prodId);
  }
  return filtered;
}

function reportRunTitle(run, catMap, productMap, groupMap) {
  const flowPrefix = run.flowName ? `${escapeHtml(run.flowName)} · ` : '';
  if (run.productId && productMap.get(run.productId)) {
    const p = productMap.get(run.productId);
    return `${flowPrefix}${escapeHtml(p.name)}`;
  }
  if (run.scopeMode === 'group' && run.categoryGroupId) {
    return `${flowPrefix}${escapeHtml(groupMap.get(run.categoryGroupId) || 'קבוצה')}`;
  }
  const ids = run.categoryIds?.length ? run.categoryIds : (run.categoryId ? [run.categoryId] : []);
  const names = ids.map((id) => catMap.get(id)).filter(Boolean);
  if (names.length > 1) return `${flowPrefix}${escapeHtml(names[0])} +${names.length - 1}`;
  return `${flowPrefix}${escapeHtml(catMap.get(run.categoryId) || names[0] || 'תהליך')}`;
}

function reportRunStepInfo(run) {
  const total = run.steps?.length || 0;
  if (!total) return { progress: '—', stepName: '—', statusLabel: run.status === 'completed' ? 'הושלם' : 'פעיל' };
  if (run.status === 'completed') {
    const last = run.steps[total - 1];
    return { progress: `${total}/${total}`, stepName: last?.stepName || '—', statusLabel: 'הושלם' };
  }
  const idx = run.currentStepIndex;
  const current = run.steps[idx];
  return { progress: `${idx + 1}/${total}`, stepName: current?.stepName || '—', statusLabel: 'פעיל' };
}

function reportRunStartDate(run) {
  if (run.startedAt) return String(run.startedAt).slice(0, 10);
  return run.date || '';
}

function reportRunEndDate(run) {
  if (run.completedAt) return String(run.completedAt).slice(0, 10);
  return '';
}

function reportRunDatesLabel(run) {
  const start = reportRunStartDate(run);
  const end = reportRunEndDate(run);
  const dur = formatDuration(runDurationMs(run));
  const durSuffix = dur !== '—' ? ` · ⏱ ${dur}${run.status === 'active' ? ' (בתהליך)' : ''}` : '';
  if (start && end) return `${formatDate(start)} → ${formatDate(end)}${durSuffix}`;
  if (start) return `${formatDate(start)}${durSuffix}`;
  return '—';
}

function reportRunDurationLabel(run) {
  const dur = runDurationMs(run);
  if (dur == null) return '—';
  return `${formatDuration(dur)}${run.status === 'active' ? ' (בתהליך)' : ''}`;
}

function reportFlowTimelineSlot(step, role, emptyLabel) {
  const labels = { done: 'הושלם', active: 'פעיל', next: 'הבא' };
  return `
    <div class="home-flow-slot home-flow-slot--${role}${step ? '' : ' home-flow-slot--empty'}">
      <span class="home-flow-slot-role">${labels[role]}</span>
      <span class="home-flow-slot-name">${step ? escapeHtml(step.stepName) : escapeHtml(emptyLabel)}</span>
    </div>`;
}

function reportFlowTimeline(run) {
  const idx = run.status === 'completed' ? run.steps.length : run.currentStepIndex;
  const done = idx > 0 ? run.steps[idx - 1] : null;
  const active = run.steps[idx] || null;
  const next = idx < run.steps.length - 1 ? run.steps[idx + 1] : null;
  return `
    <div class="home-flow-timeline-track report-flow-timeline">
      ${reportFlowTimelineSlot(done, 'done', 'תחילה')}
      ${reportFlowTimelineSlot(active, 'active', '—')}
      ${reportFlowTimelineSlot(next, 'next', '—')}
    </div>`;
}

function formatStepPortionsReport(step) {
  if (!step.tracksPortions) return '—';
  const total = getStepPortionTotal(step);
  if (total == null) return '—';
  const batches = getStepPortionBatches(step);
  if (batches.some((b) => b.name)) {
    const lines = batches.map((b) => {
      const detail = formatPortionBatchSummary(b);
      return `${formatDate(b.date)}: ${escapeHtml(detail)}`;
    }).join('<br>');
    return `<div class="portion-report-cell">
      <strong>סה"כ ${formatPortionCount(total)} מנות</strong>
      <div class="portion-batch-breakdown">${lines}</div>
    </div>`;
  }
  const sizePart = step.portionUnit === 'weight' && step.portionSize != null
    ? ` × ${step.portionSize} ק"ג`
    : '';
  if (batches.length <= 1) {
    return `${formatPortionCount(total)}${sizePart}`;
  }
  const lines = batches.map((b) => `${formatDate(b.date)}: +${formatPortionCount(b.count)}`).join('<br>');
  return `<div class="portion-report-cell">
    <strong>סה"כ ${formatPortionCount(total)}${sizePart}</strong>
    <div class="portion-batch-breakdown">${lines}</div>
  </div>`;
}

function batchLineWeightKg(batch) {
  if (batch?.weight == null) return null;
  const w = Number(batch.weight);
  const c = Number(batch.count) || 0;
  if (!Number.isFinite(w) || !Number.isFinite(c)) return null;
  return w * c;
}

function metricsProductionRows(metrics, productMap) {
  return [...(metrics?.productionByProduct || new Map()).entries()]
    .filter(([, qty]) => qty > 0)
    .map(([pid, qty]) => ({
      productId: Number(pid),
      product: mapGetById(productMap, pid),
      qty,
    }))
    .sort((a, b) => (a.product?.name || '').localeCompare(b.product?.name || '', 'he')
      || a.productId - b.productId);
}

function renderMetricsProductionRowsHTML(metrics, productMap, { compact = false } = {}) {
  const rows = metricsProductionRows(metrics, productMap);
  if (!rows.length) {
    if (metrics?.productionQty > 0) {
      return `<div class="flow-metrics-product-rows${compact ? ' flow-metrics-product-rows--compact' : ''}">
        <div class="flow-metrics-product-row">
          <span class="flow-metrics-product-name">סה״כ</span>
          <span class="flow-metrics-product-qty">${formatDecimal(metrics.productionQty)}</span>
        </div>
      </div>`;
    }
    return '—';
  }
  return `
    <div class="flow-metrics-product-rows${compact ? ' flow-metrics-product-rows--compact' : ''}">
      ${rows.map(({ product, productId, qty }) => `
        <div class="flow-metrics-product-row">
          <span class="flow-metrics-product-name">${escapeHtml(product?.name || `#${productId}`)}</span>
          <span class="flow-metrics-product-qty">${product ? formatProductQuantity(product, qty) : formatDecimal(qty)}</span>
        </div>`).join('')}
    </div>`;
}

function formatMetricsProductionLine(metrics, productMap) {
  return renderMetricsProductionRowsHTML(metrics, productMap, { compact: true });
}

function renderMetricsSummaryGrid(metrics, productMap, { title = 'סיכום כולל' } = {}) {
  return `
    <div class="flow-metrics-card flow-metrics-card--report">
      <div class="flow-metrics-title">${escapeHtml(title)}</div>
      <div class="flow-metrics-products">
        <div class="flow-metrics-products-label">ייצור · ${metrics.runCount || 0} תהליכים</div>
        ${renderMetricsProductionRowsHTML(metrics, productMap)}
      </div>
      <div class="flow-metrics-grid flow-metrics-grid--secondary">
        <div class="flow-metrics-stat">
          <span class="flow-metrics-icon">🍽</span>
          <div class="flow-metrics-body">
            <span class="flow-metrics-value">${metrics.portionCount != null ? formatPortionCount(metrics.portionCount) : '—'}</span>
            <span class="flow-metrics-label">מנות (כמות)</span>
          </div>
        </div>
        <div class="flow-metrics-stat">
          <span class="flow-metrics-icon">⚖️</span>
          <div class="flow-metrics-body">
            <span class="flow-metrics-value">${metrics.portionWeightKg != null ? formatPortionWeightKg(metrics.portionWeightKg) : '—'}</span>
            <span class="flow-metrics-label">מנות (משקל)</span>
          </div>
        </div>
        <div class="flow-metrics-stat">
          <span class="flow-metrics-icon">⏱</span>
          <div class="flow-metrics-body">
            <span class="flow-metrics-value">${metrics.durationMs != null ? formatDuration(metrics.durationMs) : '—'}${metrics.activeCount ? ' (בתהליך)' : ''}</span>
            <span class="flow-metrics-label">זמן כולל</span>
          </div>
        </div>
      </div>
    </div>`;
}

async function buildFlowsReportHTML(productionRuns, productMap, flowsOverview) {
  if (!productionRuns.length) {
    return '<p class="report-empty">אין תזרימי יצור לתקופה זו</p>';
  }

  const runsWithEntries = await Promise.all(productionRuns.map(async (run) => ({
    run,
    entries: await getRunProductionEntries(run.id),
  })));

  const { byFlow, noFlowRuns } = groupRunsByFlow(productionRuns);
  const noFlowItems = runsWithEntries.filter((item) => !Number(item.run.flowId));

  const flowMap = new Map(flowsOverview.map((f) => [f.id, f]));
  const flowRows = [...byFlow.entries()].map(([flowId, runs]) => {
    const items = runsWithEntries.filter((item) => Number(item.run.flowId) === flowId);
    return {
      flowId,
      meta: flowMap.get(flowId),
      metrics: aggregateRunsMetrics(items),
      items,
    };
  }).sort((a, b) => (a.meta?.name || '').localeCompare(b.meta?.name || '', 'he'));

  const grand = aggregateRunsMetrics(runsWithEntries);

  const tableRows = flowRows.map(({ flowId, meta, metrics, items }) => {
    const avgMs = metrics.durationMs != null && metrics.runCount
      ? metrics.durationMs / metrics.runCount
      : null;
    const flowLabel = meta?.name || items[0]?.run?.flowName || `תזרים #${flowId}`;
    return `
      <tr>
        <td class="report-cell-text"><strong>${escapeHtml(flowLabel)}</strong>
          ${meta?.targetLabel ? `<div class="form-hint">${escapeHtml(meta.targetLabel)}</div>` : ''}
        </td>
        <td class="report-cell-num">${metrics.runCount}</td>
        <td class="report-cell-num">${metrics.completedCount || 0}</td>
        <td class="report-cell-text">${formatMetricsProductionLine(metrics, productMap)}</td>
        <td class="report-cell-num">${metrics.portionCount != null ? formatPortionCount(metrics.portionCount) : '—'}</td>
        <td class="report-cell-num">${metrics.portionWeightKg != null ? formatPortionWeightKg(metrics.portionWeightKg) : '—'}</td>
        <td class="report-cell-num">${metrics.durationMs != null ? formatDuration(metrics.durationMs) : '—'}</td>
        <td class="report-cell-num">${avgMs != null ? formatDuration(avgMs) : '—'}</td>
      </tr>`;
  }).join('');

  let noFlowSection = '';
  if (noFlowRuns.length) {
    const m = aggregateRunsMetrics(noFlowItems);
    noFlowSection = `
      <h4 class="report-preview-heading">ללא תזרים מוגדר</h4>
      <div class="report-table-wrap">
        <table class="report-table">
          <tbody><tr>
            <td class="report-cell-text">תהליכים ללא flowId</td>
            <td class="report-cell-num">${m.runCount}</td>
            <td class="report-cell-num">${m.completedCount || 0}</td>
            <td class="report-cell-text">${formatMetricsProductionLine(m, productMap)}</td>
            <td class="report-cell-num">${m.portionCount != null ? formatPortionCount(m.portionCount) : '—'}</td>
            <td class="report-cell-num">${m.portionWeightKg != null ? formatPortionWeightKg(m.portionWeightKg) : '—'}</td>
            <td class="report-cell-num">${m.durationMs != null ? formatDuration(m.durationMs) : '—'}</td>
            <td class="report-cell-num">—</td>
          </tr></tbody>
        </table>
      </div>`;
  }

  return `
    ${renderMetricsSummaryGrid(grand, productMap, { title: 'סיכום כולל לכל התזרימים' })}
    <div class="report-table-wrap" style="margin-top:16px">
      <table class="report-table report-flows-summary-table">
        <thead><tr>
          <th>תזרים</th><th>תהליכים</th><th>הושלמו</th><th>ייצור</th>
          <th>מנות</th><th>משקל מנות</th><th>זמן כולל</th><th>ממוצע לתהליך</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    ${noFlowSection}`;
}

function buildFlowsDetailReportHTML(productionRuns, ctx, catMap, productMap, groupMap, flowsOverview) {
  if (!productionRuns.length) {
    return '<p class="report-empty">אין תזרימי יצור לתקופה זו</p>';
  }

  const { byFlow, noFlowRuns } = groupRunsByFlow(productionRuns);
  const flowMap = new Map(flowsOverview.map((f) => [f.id, f]));

  const flowIds = [...byFlow.keys()].sort((a, b) => {
    const nameA = flowMap.get(a)?.name || byFlow.get(a)?.[0]?.flowName || '';
    const nameB = flowMap.get(b)?.name || byFlow.get(b)?.[0]?.flowName || '';
    return nameA.localeCompare(nameB, 'he');
  });

  const sections = flowIds.map((flowId) => {
    const meta = flowMap.get(flowId);
    const runs = byFlow.get(flowId);
    const flowLabel = meta?.name || runs[0]?.flowName || `תזרים #${flowId}`;
    const stepCount = meta?.stepCount || runs[0]?.steps?.length || 0;
    const targetHint = meta?.targetLabel
      ? `<p class="form-hint" style="margin:4px 0 0">${escapeHtml(meta.targetLabel)} · ${stepCount} שלבים</p>`
      : '';
    return `
      <section class="report-flows-detail-section">
        <h4 class="report-preview-heading" style="margin-top:0">${escapeHtml(flowLabel)}${targetHint} · ${runs.length} תהליכים</h4>
        ${renderProductionRunsHTML(runs, ctx, catMap, productMap, groupMap)}
      </section>`;
  }).join('');

  const noFlowSection = noFlowRuns.length ? `
    <section class="report-flows-detail-section">
      <h4 class="report-preview-heading">ללא תזרים מוגדר · ${noFlowRuns.length} תהליכים</h4>
      ${renderProductionRunsHTML(noFlowRuns, ctx, catMap, productMap, groupMap)}
    </section>` : '';

  return sections + noFlowSection;
}

function aggregatePortionDocumentation(rows) {
  const map = new Map();
  for (const { batch } of rows) {
    const name = batch.name || 'ללא שם';
    const weight = batch.weight != null ? Number(batch.weight) : null;
    const extra = batch.extra || '';
    const key = `${name}|${weight ?? ''}|${extra}`;
    if (!map.has(key)) {
      map.set(key, { name, weight, extra, count: 0, totalWeightKg: 0, hasWeight: weight != null });
    }
    const agg = map.get(key);
    const cnt = Number(batch.count) || 0;
    agg.count += cnt;
    const lineKg = batchLineWeightKg(batch);
    if (lineKg != null) agg.totalWeightKg += lineKg;
    else agg.hasWeight = false;
  }
  return [...map.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'he') || (a.weight ?? 0) - (b.weight ?? 0));
}

function renderPortionDocumentationHTML(productionRuns, catMap, productMap, groupMap) {
  const rows = [];
  for (const run of productionRuns) {
    for (const step of run.steps || []) {
      if (!step.tracksPortions) continue;
      for (const batch of getStepPortionBatches(step)) {
        rows.push({ run, step, batch });
      }
    }
  }
  if (!rows.length) {
    return '<p class="report-empty">אין תיעוד מנות לתקופה זו</p>';
  }
  rows.sort((a, b) => {
    const d = String(b.batch.date).localeCompare(String(a.batch.date));
    if (d !== 0) return d;
    return String(b.batch.recordedAt || '').localeCompare(String(a.batch.recordedAt || ''));
  });

  const summary = aggregatePortionDocumentation(rows);
  const grandTotalKg = summary.reduce((s, row) => s + (row.hasWeight ? row.totalWeightKg : 0), 0);
  const grandHasWeight = summary.some((row) => row.hasWeight);

  return `
    ${summary.length ? `
    <div class="report-portions-summary" style="margin-bottom:16px">
      <h4 class="report-preview-heading" style="margin-top:0">סיכום משקל לפי מנה</h4>
      <div class="report-table-wrap">
        <table class="report-table report-portions-summary-table">
          <thead><tr>
            <th>מנה</th><th>משקל למנה</th><th>תוספת</th><th>סה"כ מנות</th><th>סה"כ משקל</th>
          </tr></thead>
          <tbody>
            ${summary.map((row) => `
              <tr>
                <td class="report-cell-text">${escapeHtml(row.name)}</td>
                <td class="report-cell-num">${row.weight != null ? formatPortionWeightKg(row.weight) : '—'}</td>
                <td class="report-cell-text">${row.extra ? escapeHtml(row.extra) : '—'}</td>
                <td class="report-cell-num"><strong>${formatPortionCount(row.count)}</strong></td>
                <td class="report-cell-num"><strong>${row.hasWeight ? formatPortionWeightKg(row.totalWeightKg) : '—'}</strong></td>
              </tr>`).join('')}
          </tbody>
          ${grandHasWeight ? `
          <tfoot><tr>
            <td colspan="4">סה"כ משקל (כל המנות)</td>
            <td class="report-cell-num"><strong>${formatPortionWeightKg(grandTotalKg)}</strong></td>
          </tr></tfoot>` : ''}
        </table>
      </div>
    </div>` : ''}
    <h4 class="report-preview-heading">פירוט רשומות</h4>
    <div class="report-table-wrap">
      <table class="report-table report-portions-table">
        <thead><tr>
          <th>תאריך</th><th>אצווה</th><th>יעד</th><th>שלב</th><th>מנה</th><th>משקל למנה</th><th>תוספת</th><th>כמות</th><th>סה"כ משקל</th><th>הערה</th>
        </tr></thead>
        <tbody>
          ${rows.map(({ run, step, batch }) => {
            const lineKg = batchLineWeightKg(batch);
            return `
            <tr>
              <td class="report-cell-num">${formatDate(batch.date)}</td>
              <td class="report-cell-text">${run.batchNumber ? escapeHtml(run.batchNumber) : '—'}</td>
              <td class="report-cell-text">${reportRunTitle(run, catMap, productMap, groupMap)}</td>
              <td class="report-cell-text">${escapeHtml(step.stepName)}</td>
              <td class="report-cell-text">${batch.name ? escapeHtml(batch.name) : '—'}</td>
              <td class="report-cell-num">${batch.weight != null ? formatPortionWeightKg(batch.weight) : '—'}</td>
              <td class="report-cell-text">${batch.extra ? escapeHtml(batch.extra) : '—'}</td>
              <td class="report-cell-num"><strong>${formatPortionCount(batch.count)}</strong></td>
              <td class="report-cell-num"><strong>${lineKg != null ? formatPortionWeightKg(lineKg) : '—'}</strong></td>
              <td class="report-cell-text">${batch.note ? escapeHtml(batch.note) : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderCategorySummaryTable(catSummary) {
  if (!catSummary.length) return '';
  return `
    <div class="report-table-wrap">
    <table class="report-table report-cost-table report-cat-summary-table">
      <thead><tr>
        <th>קטגוריה</th><th>כמות</th><th>חומ"ג</th><th>אריזה</th><th>נוספות</th><th>סה"כ עלות</th><th>ערך כספי</th>
      </tr></thead>
      <tbody>
        ${catSummary.map((c) => `<tr>
          <td class="report-cell-text">${escapeHtml(c.name)}</td>
          <td class="report-cell-num">${formatDecimal(c.qty)}</td>
          <td class="report-cell-num">${c.costRaw > 0 ? formatMoney(c.costRaw) : '—'}</td>
          <td class="report-cell-num">${c.costPack > 0 ? formatMoney(c.costPack) : '—'}</td>
          <td class="report-cell-num">${c.costExtra > 0 ? formatMoney(c.costExtra) : '—'}</td>
          <td class="report-cell-num">${c.cost > 0 ? formatMoney(c.cost) : '—'}</td>
          <td class="report-cell-num">${formatMoney(c.val)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}

function renderProductionStatsGrid(totals) {
  return `
    <div class="stat-grid">
      <div class="stat-box">
        <div class="stat-value">${formatDecimal(totals.total)}</div>
        <div class="stat-label">ייצור (יח')</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${formatMoney(totals.totalCost || 0)}</div>
        <div class="stat-label">עלות ייצור</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${formatMoney(totals.totalValue)}</div>
        <div class="stat-label">ערך ללקוח</div>
      </div>
    </div>`;
}

function mapCategorySummary(categories, products, totals) {
  return categories.map((c) => {
    const t = sumCategoryTotals(c.id, products, totals.byProduct);
    return {
      name: c.name,
      qty: t.qty,
      val: t.value,
      cost: t.cost,
      costRaw: t.costRaw,
      costPack: t.costPack,
      costExtra: t.costExtra,
    };
  }).filter((c) => c.qty > 0);
}

function renderReportQtyValueLabels({ showProductName = false } = {}) {
  return `
    <div class="report-qty-value-row report-qty-value-row--labels" role="row">
      ${showProductName ? '<span class="report-qty-value-label report-qty-value-label--name">מוצר</span>' : '<span class="report-qty-value-label report-qty-value-label--spacer" aria-hidden="true"></span>'}
      <span class="report-qty-value-label">כמות</span>
      <span class="report-qty-value-label">ערך כספי</span>
    </div>`;
}

function renderReportQtyValueRow({ name, qty, value, bold = false, variant }) {
  const qtyText = typeof qty === 'number' ? formatPortionCount(qty) : qty;
  const valText = formatMoney(value);
  const strongOpen = bold ? '<strong>' : '';
  const strongClose = bold ? '</strong>' : '';
  const rowVariant = variant || (name ? 'product' : 'totals');
  return `
    <div class="report-qty-value-row report-qty-value-row--${rowVariant}" role="row">
      ${name
    ? `<span class="report-qty-value-name">${escapeHtml(name)}</span>`
    : '<span class="report-qty-value-label report-qty-value-label--spacer" aria-hidden="true"></span>'}
      <span class="report-qty-value-num">${strongOpen}${escapeHtml(String(qtyText))}${strongClose}</span>
      <span class="report-qty-value-num">${strongOpen}${valText}${strongClose}</span>
    </div>`;
}

function renderProductionRunsStepsTable(run) {
  if (!run.steps?.length) return '';
  const currentIndex = run.status === 'completed' ? run.steps.length : run.currentStepIndex;
  return `
    <div class="report-table-wrap" style="margin-top:8px">
    <table class="report-table report-flow-steps-table">
      <thead><tr><th>#</th><th>שלב</th><th>סטטוס</th><th>התחלה</th><th>סיום</th><th>משך שלב</th><th>מנות</th></tr></thead>
      <tbody>
        ${run.steps.map((step, i) => {
          let status = 'ממתין';
          if (step.status === 'completed' || i < currentIndex) status = '✓ בוצע';
          else if (i === currentIndex && run.status === 'active') status = '● פעיל';
          const portions = formatStepPortionsReport(step);
          const stepDur = formatDuration(stepDurationMs(step, null, run.startedAt));
          const startedAt = step.startedAt ? formatDateTime(step.startedAt) : '—';
          const completedAt = step.completedAt ? formatDateTime(step.completedAt) : '—';
          return `<tr class="report-flow-step-row report-flow-step-row--${step.status || 'pending'}">
            <td class="report-cell-num">${i + 1}</td>
            <td class="report-cell-text">${escapeHtml(step.stepName)}</td>
            <td class="report-cell-num">${status}</td>
            <td class="report-cell-text">${startedAt}</td>
            <td class="report-cell-text">${completedAt}</td>
            <td class="report-cell-num">${stepDur}</td>
            <td class="report-cell-text">${portions}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>`;
}

function renderProductionRunsHTML(productionRuns, ctx, catMap, productMap, groupMap) {
  if (!productionRuns.length) {
    return '<p class="report-empty">אין תזרימי יצור לתקופה זו</p>';
  }

  const activeOutside = productionRuns.filter((r) => r.status === 'active' && (r.date < ctx.from || r.date > ctx.to));
  const activeCount = productionRuns.filter((r) => r.status === 'active').length;
  const doneCount = productionRuns.filter((r) => r.status === 'completed').length;

  return `
    ${activeOutside.length ? `<p class="report-hint">כולל ${activeOutside.length} תזרימים פעילים שהתחילו מחוץ לתקופה</p>` : ''}
    <p class="report-preview-note" style="margin-bottom:10px">${activeCount} פעילים · ${doneCount} הושלמו</p>
    <div class="report-table-wrap">
    <table class="report-table">
      <thead><tr><th>תאריך התחלה</th><th>תאריך סיום</th><th>משך</th><th>אצווה</th><th>תזרים / יעד</th><th>סטטוס</th><th>שלב</th></tr></thead>
      <tbody>
        ${productionRuns.map((run) => {
          const info = reportRunStepInfo(run);
          const batch = run.batchNumber ? escapeHtml(run.batchNumber) : '—';
          const startDate = reportRunStartDate(run);
          const endDate = reportRunEndDate(run);
          const dateNote = (run.date < ctx.from || run.date > ctx.to) ? ` · ${formatDate(run.date)}` : '';
          return `<tr>
            <td class="report-cell-num">${startDate ? formatDate(startDate) : '—'}${dateNote ? `<span class="report-flow-date-note">${dateNote.trim()}</span>` : ''}</td>
            <td class="report-cell-num">${endDate ? formatDate(endDate) : '—'}</td>
            <td class="report-cell-num">${reportRunDurationLabel(run)}</td>
            <td class="report-cell-text">${batch}</td>
            <td class="report-cell-text">${reportRunTitle(run, catMap, productMap, groupMap)}</td>
            <td class="report-cell-num"><span class="flow-status-badge flow-status-badge--${run.status === 'completed' ? 'completed' : 'active'}">${info.statusLabel}</span></td>
            <td class="report-cell-text">${info.progress} · ${escapeHtml(info.stepName)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>
    ${productionRuns.map((run) => {
          const info = reportRunStepInfo(run);
          return `
      <details class="report-flow-detail"${run.status === 'active' ? ' open' : ''}>
        <summary class="report-flow-detail-summary">
          ${run.batchNumber ? `אצווה ${escapeHtml(run.batchNumber)} · ` : ''}${reportRunTitle(run, catMap, productMap, groupMap)}
          · ${info.statusLabel} · ${info.progress}
          · ${reportRunDatesLabel(run)}
        </summary>
        ${run.status === 'active' ? reportFlowTimeline(run) : ''}
        ${renderProductionRunsStepsTable(run)}
      </details>`;
        }).join('')}
    ${''}`;
}

function buildProductRows(products, totals, categories, reportType) {
  const rows = [];
  for (const p of sortProductsForReport(products, categories)) {
    const { qty, value } = productProductionValue(p, totals.byProduct);
    const costs = productProductionCost(p, totals.byProduct);
    if (qty === 0 && (reportType === 'day' || reportType === 'week')) continue;
    rows.push({ product: p, qty, value, ...costs });
  }
  return rows;
}

function productCostTotals(rows) {
  return rows.reduce((acc, r) => ({
    raw: acc.raw + r.costRaw,
    pack: acc.pack + r.costPack,
    extra: acc.extra + r.costExtra,
    total: acc.total + r.cost,
  }), { raw: 0, pack: 0, extra: 0, total: 0 });
}

function compareCatalogCategories(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

function buildHistoryScopeSelectHTML(scopeType, catalog, selectedId) {
  const sel = String(selectedId || '');
  if (scopeType === 'group') {
    const groups = catalog.groups || [];
    if (!groups.length) return '<p class="form-hint">אין קטגוריות כלליות</p>';
    return `
      <select id="report-history-scope-id" style="width:100%">
        <option value="">בחר קטגוריה כללית...</option>
        ${groups.map((g) => `<option value="${g.id}" ${String(g.id) === sel ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
      </select>`;
  }
  if (scopeType === 'category') {
    const parts = ['<option value="">בחר קטגוריה...</option>'];
    const addCat = (cat, groupName) => {
      const prefix = groupName ? `${groupName} › ` : '';
      parts.push(`<option value="${cat.id}" ${String(cat.id) === sel ? 'selected' : ''}>${escapeHtml(prefix)}${escapeHtml(cat.name)}</option>`);
    };
    for (const group of catalog.groups || []) {
      for (const cat of group.categories.slice().sort(compareCatalogCategories)) addCat(cat, group.name);
    }
    for (const cat of (catalog.ungrouped || []).slice().sort(compareCatalogCategories)) addCat(cat, '');
    return `<select id="report-history-scope-id" style="width:100%">${parts.join('')}</select>`;
  }
  const parts = ['<option value="">בחר מוצר...</option>'];
  const addProduct = (p, catName, groupName) => {
    const prefix = groupName ? `${groupName} › ` : '';
    const label = catName ? `${prefix}${catName} › ${p.name}` : p.name;
    parts.push(`<option value="${p.id}" ${String(p.id) === sel ? 'selected' : ''}>${escapeHtml(label)}</option>`);
  };
  for (const group of catalog.groups || []) {
    for (const cat of group.categories.slice().sort(compareCatalogCategories)) {
      for (const p of sortProductsForReport(cat.products || [], [])) addProduct(p, cat.name, group.name);
    }
  }
  for (const cat of (catalog.ungrouped || []).slice().sort(compareCatalogCategories)) {
    for (const p of sortProductsForReport(cat.products || [], [])) addProduct(p, cat.name, '');
  }
  return `<select id="report-history-scope-id" style="width:100%">${parts.join('')}</select>`;
}

function renderProductionHistoryFiltersHTML(ctx, catalog) {
  const scopeType = ctx.historyScope || 'product';
  const scopeLabels = { product: 'מוצר', category: 'קטגוריה', group: 'קטגוריה כללית' };
  return `
    <div class="baking-scope-type-row" role="radiogroup" aria-label="סוג סינון היסטוריה" style="margin-bottom:10px">
      ${PRODUCTION_HISTORY_SCOPES.map((scope) => `
        <label class="baking-scope-type-option">
          <input type="radio" name="report-history-scope" value="${scope}"${scopeType === scope ? ' checked' : ''}>
          ${scopeLabels[scope]}
        </label>`).join('')}
    </div>
    <div class="form-group">
      <label for="report-history-scope-id">${escapeHtml(scopeLabels[scopeType] || 'בחירה')}</label>
      ${buildHistoryScopeSelectHTML(scopeType, catalog, ctx.historyScopeId)}
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="report-history-all-time" ${ctx.historyAllTime ? 'checked' : ''}>
        כל התקופות
      </label>
    </div>
    <div class="report-filter-grid${ctx.historyAllTime ? ' report-filter-grid--disabled' : ''}" id="report-history-date-grid">
      <div class="form-group">
        <label for="report-history-from">מתאריך</label>
        <input type="date" id="report-history-from" value="${ctx.from}" ${ctx.historyAllTime ? 'disabled' : ''}>
      </div>
      <div class="form-group">
        <label for="report-history-to">עד תאריך</label>
        <input type="date" id="report-history-to" value="${ctx.to}" ${ctx.historyAllTime ? 'disabled' : ''}>
      </div>
    </div>`;
}

function renderProductionHistoryTableHTML(entries, productMap, categories, catMap, scopeType) {
  const sorted = sortProductionHistoryEntries(entries, productMap, categories);
  if (!sorted.length) {
    return '<p class="report-empty">אין רישומי ייצור לבחירה זו</p>';
  }
  const showProduct = scopeType !== 'product';
  const showCategory = scopeType === 'group';
  const totalQty = sorted.reduce((s, e) => s + (Number(e.quantity) || 0), 0);

  return `
    <p class="history-summary">
      סה"כ ${sorted.length} רישומים · ${formatDecimal(totalQty)} יח'
    </p>
    <div class="report-table-wrap">
      <table class="report-table report-history-table">
        <thead><tr>
          <th>תאריך</th>
          ${showProduct ? '<th>מוצר</th>' : ''}
          ${showCategory ? '<th>קטגוריה</th>' : ''}
          <th>כמות</th>
        </tr></thead>
        <tbody>
          ${sorted.map((entry) => {
            const product = mapGetById(productMap, entry.productId);
            const qty = Number(entry.quantity) || 0;
            return `<tr>
              <td class="report-cell-num">${formatDate(entry.date)}</td>
              ${showProduct ? `<td class="report-cell-text">${escapeHtml(product?.name || 'מוצר לא ידוע')}</td>` : ''}
              ${showCategory ? `<td class="report-cell-text">${escapeHtml(catMap.get(product?.categoryId) || '')}</td>` : ''}
              <td class="report-cell-num">${product ? formatProductQuantity(product, qty) : formatDecimal(qty)}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="${1 + (showProduct ? 1 : 0) + (showCategory ? 1 : 0)}">סה"כ</td>
          <td class="report-cell-num"><strong>${formatDecimal(totalQty)}</strong></td>
        </tfoot>
      </table>
    </div>`;
}

function buildProductionHistoryPreviewHTML(ctx, entries, productMap, categories, catMap) {
  const subtitle = reportSubtitle(ctx);
  return `
    <div class="report-preview">
      <p class="report-preview-meta">${escapeHtml(subtitle)}</p>
      ${renderProductionHistoryTableHTML(entries, productMap, categories, catMap, ctx.historyScope)}
    </div>`;
}

function renderFiltersHTML(ctx, categories, products, today, defaultMonth) {
  const { reportType } = ctx;

  if (reportType === 'day') {
    return `
      <div class="form-group">
        <label for="report-day">תאריך</label>
        <input type="date" id="report-day" value="${ctx.from}">
      </div>`;
  }

  if (reportType === 'week') {
    const weekAnchor = ctx.weekAnchor || ctx.to;
    return `
      <div class="form-group">
        <label for="report-week">שבוע (ראשון – שבת)</label>
        <input type="date" id="report-week" value="${weekAnchor}">
        <p class="form-hint">${formatDateHebrew(ctx.from)} – ${formatDateHebrew(ctx.to)}</p>
      </div>`;
  }

  if (reportType === 'month') {
    return `
      <div class="form-group">
        <label for="report-month">חודש</label>
        <input type="month" id="report-month" value="${defaultMonth}">
      </div>`;
  }

  let html = `
    <div class="report-filter-grid">
      <div class="form-group">
        <label for="report-from">מתאריך</label>
        <input type="date" id="report-from" value="${ctx.from}">
      </div>
      <div class="form-group">
        <label for="report-to">עד תאריך</label>
        <input type="date" id="report-to" value="${ctx.to}">
      </div>
    </div>`;

  if (reportType === 'category') {
    const categoryOptions = categories
      .map((c) => `<option value="${c.id}" ${String(c.id) === ctx.selectedCategoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
      .join('');
    html += `
      <div class="form-group">
        <label for="report-category">קטגוריה</label>
        <select id="report-category" ${categories.length === 0 ? 'disabled' : ''}>
          <option value="">בחר קטגוריה...</option>
          ${categoryOptions}
        </select>
      </div>`;
  }

  if (reportType === 'product') {
    const productOptions = products
      .map((p) => {
        const cat = categories.find((c) => c.id === p.categoryId);
        return `<option value="${p.id}" ${String(p.id) === ctx.selectedProductId ? 'selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(cat?.name || '')})</option>`;
      })
      .join('');
    html += `
      <div class="form-group">
        <label for="report-product">מוצר</label>
        <select id="report-product" ${products.length === 0 ? 'disabled' : ''}>
          <option value="">בחר מוצר...</option>
          ${productOptions}
        </select>
      </div>`;
  }

  return html;
}

function renderProductionTableHTML(rows, totals, catMap) {
  if (rows.length === 0) {
    return '<p class="report-empty">אין נתונים לתקופה זו</p>';
  }
  const costTotals = productCostTotals(rows);
  return `
    <div class="report-table-wrap">
    <table class="report-table report-cost-table">
      <thead><tr>
        <th>מוצר</th><th>קטגוריה</th><th>כמות</th>
        <th>חומ"ג</th><th>אריזה</th><th>נוספות</th><th>סה"כ עלות</th><th>ערך ללקוח</th>
      </tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td class="report-cell-text">${escapeHtml(r.product.name)}</td>
          <td class="report-cell-text">${escapeHtml(catMap.get(r.product.categoryId) || '')}</td>
          <td class="report-cell-num">${formatDecimal(r.qty)}</td>
          <td class="report-cell-num">${r.costRaw > 0 ? formatMoney(r.costRaw) : '—'}</td>
          <td class="report-cell-num">${r.costPack > 0 ? formatMoney(r.costPack) : '—'}</td>
          <td class="report-cell-num">${r.costExtra > 0 ? formatMoney(r.costExtra) : '—'}</td>
          <td class="report-cell-num">${r.cost > 0 ? formatMoney(r.cost) : '—'}</td>
          <td class="report-cell-num">${formatMoney(r.value)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr>
        <td colspan="3">סה"כ</td>
        <td>${costTotals.raw > 0 ? formatMoney(costTotals.raw) : '—'}</td>
        <td>${costTotals.pack > 0 ? formatMoney(costTotals.pack) : '—'}</td>
        <td>${costTotals.extra > 0 ? formatMoney(costTotals.extra) : '—'}</td>
        <td>${costTotals.total > 0 ? formatMoney(costTotals.total) : '—'}</td>
        <td>${formatMoney(totals.totalValue)}</td>
      </tr></tfoot>
    </table>
    </div>`;
}

function reportSubtitle(ctx) {
  return ctx.filterLabel
    ? `${ctx.reportTitle} · ${ctx.filterLabel} · ${ctx.label}`
    : `${ctx.reportTitle} · ${ctx.label}`;
}

async function saveFormattedReport({ fullTitle, ctx, safeLabel, previewHtml }) {
  const method = await saveReportPageAsHtml({
    title: fullTitle,
    subtitle: reportSubtitle(ctx),
    bodyHtml: previewHtml,
    filename: `yitzur-doh-${ctx.reportType}-${safeLabel}.html`,
  });
  if (method === 'cancelled') showToast('בוטל');
  else if (method === 'share') showToast('נפתח Share — שמור לקבצים ✓');
  else showToast('הדוח נשמר ✓');
}

function bindReportPageToolbar(container, { fullTitle, ctx, safeLabel, previewHtml }) {
  document.getElementById('report-view-back')?.addEventListener('click', () => {
    container.dataset.reportView = 'standard';
    renderReports(container);
  });

  document.getElementById('report-save-page')?.addEventListener('click', () => {
    saveFormattedReport({ fullTitle, ctx, safeLabel, previewHtml });
  });

  document.getElementById('report-print-page')?.addEventListener('click', () => {
    printReportElement(document.getElementById('report-page-content'));
  });
}

function reportCategoryChipStyle(color, id) {
  const c = color || defaultColorForIndex((Number(id) || 1) - 1);
  return `background:color-mix(in srgb, ${c} 14%, white);color:${c};border:1px solid color-mix(in srgb, ${c} 28%, transparent)`;
}

async function buildWeeklyPreviewHTML(ctx, entries, products, categories, productMap, catMap, processLogs, processSummary, productionRuns, groupMap) {
  const subtitle = reportSubtitle(ctx);
  const totals = await getProductionTotals(entries, productMap);
  const weekDates = ctx.weekDates || [];
  const processTotalQty = processLogs.reduce((s, l) => s + (l.quantity || 0), 0);

  const daySections = [];
  for (const dateIso of weekDates) {
    const dayEntries = entries.filter((e) => e.date === dateIso);
    if (!dayEntries.length) continue;
    const dayTotals = await getProductionTotals(dayEntries, productMap);
    if (dayTotals.total === 0) continue;

    const catBlocks = categories.map((cat) => {
      const { qty, value: val } = sumCategoryTotals(cat.id, products, dayTotals.byProduct);
      if (qty === 0) return '';
      const productRows = products
        .filter((p) => p.categoryId === cat.id)
        .map((p) => {
          const { qty: pQty, value: pVal } = productProductionValue(p, dayTotals.byProduct);
          if (pQty === 0) return '';
          return renderReportQtyValueRow({ name: p.name, qty: pQty, value: pVal });
        })
        .filter(Boolean);
      const productLines = productRows.join('');

      const hasProducts = productRows.length > 0;
      return `
        <div class="card report-week-cat-card">
          <div class="report-week-cat-header">
            <span class="category-chip report-week-cat-chip" style="${reportCategoryChipStyle(cat.color, cat.id)}">${escapeHtml(cat.name)}</span>
          </div>
          <div class="report-qty-value-block">
            ${renderReportQtyValueLabels({ showProductName: hasProducts })}
            ${renderReportQtyValueRow({
        name: hasProducts ? 'סה״כ' : undefined,
        qty,
        value: val,
        bold: true,
        variant: 'totals',
      })}
            ${hasProducts ? `<div class="report-week-product-list">${productLines}</div>` : ''}
          </div>
        </div>`;
    }).filter(Boolean).join('');

    daySections.push(`
      <section class="report-week-day">
        <h4 class="report-preview-heading">${escapeHtml(formatDateHebrew(dateIso))}</h4>
        <div class="stat-grid report-preview-stats" style="margin-bottom:12px">
          <div class="stat-box">
            <div class="stat-value">${formatDecimal(dayTotals.total)}</div>
            <div class="stat-label">כמות</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">${formatMoney(dayTotals.totalValue)}</div>
            <div class="stat-label">ערך כספי</div>
          </div>
        </div>
        ${catBlocks || '<p class="report-empty">אין פירוט</p>'}
      </section>`);
  }

  const catSummary = mapCategorySummary(categories, products, totals);

  return `
    <div class="report-preview">
      <p class="report-preview-meta">${escapeHtml(subtitle)}</p>
      <div class="stat-grid report-preview-stats">
        <div class="stat-box">
          <div class="stat-value">${formatDecimal(totals.total)}</div>
          <div class="stat-label">סה"כ שבוע (יח')</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${formatMoney(totals.totalCost || 0)}</div>
          <div class="stat-label">עלות שבועית</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${formatMoney(totals.totalValue)}</div>
          <div class="stat-label">ערך ללקוח</div>
        </div>
      </div>

      ${catSummary.length ? `
        <h4 class="report-preview-heading">סיכום שבועי לפי קטגוריה</h4>
        ${renderCategorySummaryTable(catSummary)}` : ''}

      <h4 class="report-preview-heading">פירוט יומי</h4>
      ${daySections.length ? daySections.join('') : '<p class="report-empty">אין ייצור בשבוע זה</p>'}

      <h4 class="report-preview-heading">תזרימי יצור</h4>
      ${renderProductionRunsHTML(productionRuns, ctx, catMap, productMap, groupMap)}

      <h4 class="report-preview-heading">🍽 תיעוד מנות</h4>
      ${renderPortionDocumentationHTML(productionRuns, catMap, productMap, groupMap)}

      <h4 class="report-preview-heading">תיעוד הכנות</h4>
      ${processLogs.length === 0
    ? '<p class="report-empty">אין תיעוד לתקופה זו</p>'
    : `${processSummary.length ? `
          <div class="report-table-wrap">
          <table class="report-table" style="margin-bottom:12px">
            <thead><tr><th>הכנה</th><th>קטגוריה</th><th>כמות</th></tr></thead>
            <tbody>
              ${processSummary.map((r) => `<tr>
                <td class="report-cell-text">${escapeHtml(r.activity)}</td>
                <td class="report-cell-text">${escapeHtml(r.category)}</td>
                <td class="report-cell-num">${r.qty != null ? formatDecimal(r.qty) : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
          </div>` : ''}
          <p class="report-preview-note">סה"כ כמויות: ${processTotalQty ? formatDecimal(processTotalQty) : '—'} · ${processLogs.length} רישומים</p>
          ${processLogs.map((log) => `
            <div class="list-item report-preview-log">
              <div class="list-item-info">
                <div class="list-item-name">${escapeHtml(log.activity)}${log.quantity ? ` · ${formatDecimal(log.quantity)}` : ''}</div>
                <div class="list-item-meta">${formatDate(log.date)} · ${escapeHtml(catMap.get(log.categoryId) || '')}${log.notes ? ` · ${escapeHtml(log.notes)}` : ''}</div>
              </div>
            </div>`).join('')}`}
    </div>`;
}

function buildPreviewHTML(ctx, totals, rows, catSummary, processLogs, processSummary, catMap, productionRuns, productMap, groupMap) {
  const subtitle = reportSubtitle(ctx);

  const processTotalQty = processLogs.reduce((s, l) => s + (l.quantity || 0), 0);

  return `
    <div class="report-preview">
      <p class="report-preview-meta">${escapeHtml(subtitle)}</p>
      <div class="stat-grid report-preview-stats">
        <div class="stat-box">
          <div class="stat-value">${formatDecimal(totals.total)}</div>
          <div class="stat-label">ייצור (יח')</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${formatMoney(totals.totalCost || 0)}</div>
          <div class="stat-label">עלות ייצור</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${formatMoney(totals.totalValue)}</div>
          <div class="stat-label">ערך ללקוח</div>
        </div>
      </div>

      ${catSummary.length > 0 ? `
        <h4 class="report-preview-heading">ייצור לפי קטגוריה</h4>
        ${renderCategorySummaryTable(catSummary)}` : ''}

      <h4 class="report-preview-heading">פירוט מוצרים</h4>
      ${renderProductionTableHTML(rows, totals, catMap)}

      <h4 class="report-preview-heading">תזרימי יצור</h4>
      ${renderProductionRunsHTML(productionRuns, ctx, catMap, productMap, groupMap)}

      <h4 class="report-preview-heading">🍽 תיעוד מנות</h4>
      ${renderPortionDocumentationHTML(productionRuns, catMap, productMap, groupMap)}

      <h4 class="report-preview-heading">תיעוד הכנות</h4>
      ${processLogs.length === 0
        ? '<p class="report-empty">אין תיעוד לתקופה זו</p>'
        : `${processSummary.length ? `
          <div class="report-table-wrap">
          <table class="report-table" style="margin-bottom:12px">
            <thead><tr><th>הכנה</th><th>קטגוריה</th><th>כמות</th></tr></thead>
            <tbody>
              ${processSummary.map((r) => `<tr>
                <td class="report-cell-text">${escapeHtml(r.activity)}</td>
                <td class="report-cell-text">${escapeHtml(r.category)}</td>
                <td class="report-cell-num">${r.qty != null ? formatDecimal(r.qty) : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
          </div>` : ''}
          <p class="report-preview-note">סה"כ כמויות: ${processTotalQty ? formatDecimal(processTotalQty) : '—'} · ${processLogs.length} רישומים</p>
          ${processLogs.map((log) => `
            <div class="list-item report-preview-log">
              <div class="list-item-info">
                <div class="list-item-name">${escapeHtml(log.activity)}${log.quantity ? ` · ${formatDecimal(log.quantity)}` : ''}</div>
                <div class="list-item-meta">${formatDate(log.date)} · ${escapeHtml(catMap.get(log.categoryId) || '')}${log.notes ? ` · ${escapeHtml(log.notes)}` : ''}</div>
              </div>
            </div>`).join('')}`}
    </div>`;
}

function renderFlowsFiltersHTML(ctx, today, defaultMonth) {
  return `
    <div class="report-filter-grid">
      <div class="form-group">
        <label for="report-from">מתאריך</label>
        <input type="date" id="report-from" value="${ctx.from}">
      </div>
      <div class="form-group">
        <label for="report-to">עד תאריך</label>
        <input type="date" id="report-to" value="${ctx.to}">
      </div>
    </div>`;
}

function renderManagerFiltersHTML(ctx) {
  return `
    <div class="report-filter-grid">
      <div class="form-group">
        <label for="report-from">מתאריך</label>
        <input type="date" id="report-from" value="${ctx.from}">
      </div>
      <div class="form-group">
        <label for="report-to">עד תאריך</label>
        <input type="date" id="report-to" value="${ctx.to}">
      </div>
    </div>
    <p class="form-hint">משימות, שיפורים, תקלות ומשמרות לפי תאריך · צוות, ניקוי, יעדים ורכישות — מצב נוכחי</p>`;
}

function renderReportFiltersCards(ctx, categories, products, today, defaultMonth, catalog) {
  const isFlows = isFlowsReportType(ctx.reportType);
  const isHistory = ctx.reportType === 'production-history';
  const isManager = isManagerReportType(ctx.reportType);
  const productionFilters = isFlows || isHistory || isManager ? '' : renderFiltersHTML({ ...ctx, defaultMonth }, categories, products, today, defaultMonth);
  const flowsFilters = isFlows ? renderFlowsFiltersHTML(ctx, today, defaultMonth) : '';
  const historyFilters = isHistory ? renderProductionHistoryFiltersHTML(ctx, catalog) : '';
  const managerFilters = isManager ? renderManagerFiltersHTML(ctx) : '';

  return `
    <div class="card report-filters-card">
      <div class="card-title">דוח ייצור</div>
      <div class="tabs tabs-wrap report-type-tabs report-production-tabs">
        <button type="button" class="tab ${ctx.reportType === 'day' ? 'active' : ''}" data-type="day">יומי</button>
        <button type="button" class="tab ${ctx.reportType === 'week' ? 'active' : ''}" data-type="week">שבועי מפורט</button>
        <button type="button" class="tab ${ctx.reportType === 'month' ? 'active' : ''}" data-type="month">חודשי</button>
        <button type="button" class="tab ${ctx.reportType === 'range' ? 'active' : ''}" data-type="range">טווח תאריכים</button>
        <button type="button" class="tab ${ctx.reportType === 'category' ? 'active' : ''}" data-type="category">לפי קטגוריה</button>
        <button type="button" class="tab ${ctx.reportType === 'product' ? 'active' : ''}" data-type="product">לפי מוצר</button>
        <button type="button" class="tab ${ctx.reportType === 'production-history' ? 'active' : ''}" data-type="production-history">היסטוריית ייצור</button>
      </div>
      ${productionFilters ? `<div class="report-dynamic-filters">${productionFilters}</div>` : ''}
      ${historyFilters ? `<div class="report-dynamic-filters report-history-dynamic-filters">${historyFilters}</div>` : ''}
    </div>

    <div class="card report-flows-filters-card">
      <div class="card-title">דוחות תזרימים</div>
      <div class="tabs tabs-wrap report-type-tabs report-flows-tabs">
        <button type="button" class="tab ${ctx.reportType === 'flows-detail' ? 'active' : ''}" data-type="flows-detail">תזרימים מפורט</button>
        <button type="button" class="tab ${ctx.reportType === 'flows-summary' ? 'active' : ''}" data-type="flows-summary">סיכום תזרימים</button>
      </div>
      ${flowsFilters ? `<div class="report-dynamic-filters report-flows-dynamic-filters">${flowsFilters}</div>` : ''}
    </div>

    <div class="card report-manager-filters-card">
      <div class="card-title">דוחות מנהל</div>
      <div class="tabs tabs-wrap report-type-tabs report-manager-tabs">
        <button type="button" class="tab ${ctx.reportType === 'manager' ? 'active' : ''}" data-type="manager">דוח עמדת מנהל</button>
      </div>
      ${managerFilters ? `<div class="report-dynamic-filters report-manager-dynamic-filters">${managerFilters}</div>` : ''}
    </div>`;
}

function bindFilterEvents(container) {
  container.querySelectorAll('.report-production-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.dataset.reportType = tab.dataset.type;
      renderReports(container);
    });
  });

  container.querySelectorAll('.report-flows-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.dataset.reportType = tab.dataset.type;
      renderReports(container);
    });
  });

  container.querySelectorAll('.report-manager-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.dataset.reportType = tab.dataset.type;
      renderReports(container);
    });
  });

  document.getElementById('report-day')?.addEventListener('change', (e) => {
    container.dataset.selectedDay = e.target.value;
    renderReports(container);
  });

  document.getElementById('report-week')?.addEventListener('change', (e) => {
    container.dataset.selectedWeekDate = e.target.value;
    delete container.dataset.selectedWeekEnd;
    renderReports(container);
  });

  document.getElementById('report-month')?.addEventListener('change', (e) => {
    container.dataset.selectedMonth = e.target.value;
    renderReports(container);
  });

  document.getElementById('report-from')?.addEventListener('change', (e) => {
    container.dataset.rangeFrom = e.target.value;
    renderReports(container);
  });

  document.getElementById('report-to')?.addEventListener('change', (e) => {
    container.dataset.rangeTo = e.target.value;
    renderReports(container);
  });

  document.getElementById('report-category')?.addEventListener('change', (e) => {
    container.dataset.selectedCategory = e.target.value;
    renderReports(container);
  });

  document.getElementById('report-product')?.addEventListener('change', (e) => {
    container.dataset.selectedProduct = e.target.value;
    renderReports(container);
  });

  container.querySelectorAll('input[name="report-history-scope"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      container.dataset.historyScope = e.target.value;
      delete container.dataset.historyScopeId;
      renderReports(container);
    });
  });

  document.getElementById('report-history-scope-id')?.addEventListener('change', (e) => {
    container.dataset.historyScopeId = e.target.value;
    if (container.dataset.historyScope === 'group') {
      const opt = e.target.selectedOptions?.[0];
      container.dataset.historyGroupName = opt?.textContent?.trim() || '';
    }
    renderReports(container);
  });

  document.getElementById('report-history-all-time')?.addEventListener('change', (e) => {
    container.dataset.historyAllTime = e.target.checked ? '1' : '0';
    renderReports(container);
  });

  document.getElementById('report-history-from')?.addEventListener('change', (e) => {
    container.dataset.historyFrom = e.target.value;
    renderReports(container);
  });

  document.getElementById('report-history-to')?.addEventListener('change', (e) => {
    container.dataset.historyTo = e.target.value;
    renderReports(container);
  });
}

export async function renderReports(container) {
  container.dataset.reportType = normalizeReportType(container.dataset.reportType);
  const today = todayISO();
  const { year: curYear, month: curMonth } = currentMonth();
  const defaultMonth = container.dataset.selectedMonth || `${curYear}-${String(curMonth).padStart(2, '0')}`;

  const [categories, products, groups, catalog] = await Promise.all([
    getCategories(), getProducts(true), getCategoryGroups(), getProductsCatalogLayout(),
  ]);
  const productMap = buildProductMap(products);
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));

  const ctx = resolveReportContext(container, today, curYear, curMonth, catMap, productMap);
  ctx.productMap = productMap;
  ctx.defaultMonth = container.dataset.selectedMonth || defaultMonth;

  if (ctx.reportType === 'production-history' && ctx.historyScopeId) {
    if (ctx.historyScope === 'group') {
      ctx.filterLabel = groupMap.get(Number(ctx.historyScopeId)) || ctx.filterLabel;
    } else if (ctx.historyScope === 'category') {
      ctx.filterLabel = catMap.get(Number(ctx.historyScopeId)) || ctx.filterLabel;
    } else if (ctx.historyScope === 'product') {
      ctx.filterLabel = mapGetById(productMap, ctx.historyScopeId)?.name || ctx.filterLabel;
    }
  }

  if (ctx.reportType === 'month') {
    const selectedMonth = parseMonthValue(container.dataset.selectedMonth, curYear, curMonth);
    ctx.monthIso = selectedMonth.iso;
    const mr = monthRange(selectedMonth.year, selectedMonth.month);
    ctx.from = mr.from;
    ctx.to = mr.to;
    ctx.label = mr.label;
  } else {
    ctx.monthIso = defaultMonth;
  }

  const { entries: rawEntries, processLogs, productionRuns: rawProductionRuns } = await fetchReportData(ctx);
  const productionRuns = filterProductionRuns(rawProductionRuns, ctx, categories);

  let entries = rawEntries;
  if (ctx.reportType === 'production-history') {
    entries = filterProductionHistoryEntries(rawEntries, {
      scopeType: ctx.historyScope,
      scopeId: ctx.historyScopeId,
      products,
      categories,
      from: ctx.from,
      to: ctx.to,
      allTime: ctx.historyAllTime,
    });
  }

  const totals = await getProductionTotals(entries, productMap);
  const processSummary = summarizeProcessLogs(processLogs, catMap);
  const processTotalQty = processLogs.reduce((s, l) => s + (l.quantity || 0), 0);

  let relevantProducts = products;
  if (ctx.reportType === 'category' && ctx.selectedCategoryId) {
    relevantProducts = products.filter((p) => String(p.categoryId) === ctx.selectedCategoryId);
  } else if (ctx.reportType === 'product' && ctx.selectedProductId) {
    relevantProducts = products.filter((p) => String(p.id) === ctx.selectedProductId);
  } else if (ctx.reportType === 'production-history' && ctx.historyScopeId) {
    const ids = productIdsForHistoryScope(ctx.historyScope, ctx.historyScopeId, products, categories);
    relevantProducts = ids ? products.filter((p) => ids.has(p.id)) : [];
  }

  const rows = buildProductRows(relevantProducts, totals, categories, ctx.reportType);

  const catSummary = mapCategorySummary(
    ctx.reportType === 'category' && ctx.selectedCategoryId
      ? categories.filter((c) => String(c.id) === ctx.selectedCategoryId)
      : categories,
    products,
    totals,
  );

  const safeLabel = ctx.label.replace(/\//g, '-').replace(/\s+/g, '_');
  const fullTitle = ctx.filterLabel
    ? `${ctx.reportTitle} — ${ctx.filterLabel}`
    : ctx.reportTitle;

  const needsCategory = ctx.reportType === 'category' && !ctx.selectedCategoryId;
  const needsProduct = ctx.reportType === 'product' && !ctx.selectedProductId;
  const needsHistoryScope = ctx.reportType === 'production-history' && !ctx.historyScopeId;
  const isFlowsReport = isFlowsReportType(ctx.reportType);
  const isHistoryReport = ctx.reportType === 'production-history';
  const isManagerReport = isManagerReportType(ctx.reportType);
  const isFlowsSummary = ctx.reportType === 'flows-summary';
  const isFlowsDetail = ctx.reportType === 'flows-detail';
  const canExport = isManagerReport || isFlowsReport || isHistoryReport
    ? !needsHistoryScope
    : (!needsCategory && !needsProduct);
  const sheetsHTML = await renderSheetsStatusHTML();
  const sheetsReady = await isSheetsConfigured();
  const flowsOverview = isFlowsReport ? await getAllFlowsOverview() : [];
  const flowsReportHtml = isFlowsSummary
    ? await buildFlowsReportHTML(productionRuns, productMap, flowsOverview)
    : isFlowsDetail
      ? buildFlowsDetailReportHTML(productionRuns, ctx, catMap, productMap, groupMap, flowsOverview)
      : '';
  const managerData = isManagerReport
    ? await fetchManagerReportData(ctx.from, ctx.to, { categories, productMap })
    : null;
  const managerReportHtml = managerData ? buildManagerReportHTML(managerData, ctx) : '';
  const previewHtml = isManagerReport
    ? managerReportHtml
    : isFlowsReport
      ? flowsReportHtml
      : isHistoryReport
        ? buildProductionHistoryPreviewHTML(ctx, entries, productMap, categories, catMap)
        : ctx.reportType === 'week'
          ? await buildWeeklyPreviewHTML(ctx, entries, products, categories, productMap, catMap, processLogs, processSummary, productionRuns, groupMap)
          : buildPreviewHTML(ctx, totals, rows, catSummary, processLogs, processSummary, catMap, productionRuns, productMap, groupMap);
  const isPageView = container.dataset.reportView === 'page';

  const filtersCard = renderReportFiltersCards(ctx, categories, products, today, ctx.defaultMonth, catalog);

  if (isPageView) {
    container.innerHTML = `
      ${filtersCard}
      <div class="report-page-toolbar">
        <button type="button" class="btn btn-secondary btn-sm" id="report-view-back">← חזרה</button>
        <button type="button" class="btn btn-primary btn-sm" id="report-save-page">💾 שמור דוח</button>
        <button type="button" class="btn btn-secondary btn-sm" id="report-print-page">🖨 הדפס / PDF</button>
      </div>
      <div class="card report-page-view" id="report-page-content">
        <div class="report-page-header">
          <h2>${escapeHtml(fullTitle)}</h2>
          <p>${escapeHtml(reportSubtitle(ctx))}</p>
        </div>
        ${previewHtml}
      </div>`;

    bindFilterEvents(container);
    bindReportPageToolbar(container, { fullTitle, ctx, safeLabel, previewHtml });
    return;
  }

  container.innerHTML = `
    <div class="card sheets-primary-card">
      <div class="card-title">📊 Google Sheets</div>
      <div id="sheets-status">${sheetsHTML}</div>
    </div>

    ${filtersCard}

    <div class="card report-actions-card">
      <div class="card-title">הפקת דוח</div>
      ${needsCategory ? '<p class="report-hint">בחר קטגוריה לצפייה ולייצוא</p>' : ''}
      ${needsProduct ? '<p class="report-hint">בחר מוצר לצפייה ולייצוא</p>' : ''}
      ${needsHistoryScope ? '<p class="report-hint">בחר מוצר, קטגוריה או קטגוריה כללית לצפייה ולייצוא</p>' : ''}
      <button type="button" class="btn btn-primary" id="open-report-page" style="width:100%;margin-bottom:8px" ${canExport ? '' : 'disabled'}>
        📄 דוח מעוצב — כמו באפליקציה
      </button>
      <button type="button" class="btn btn-primary" id="export-sheets-report" style="width:100%;margin-bottom:8px" ${canExport && sheetsReady ? '' : 'disabled'}>
        📊 שלח דוח ל-Google Sheets
      </button>
      ${!sheetsReady ? `<button type="button" class="btn btn-secondary" id="export-sheets-setup" style="width:100%;margin-bottom:8px">🔗 חבר Google Sheets לייצוא</button>` : ''}
      <button type="button" class="btn btn-secondary" id="preview-report" style="width:100%;margin-bottom:8px" ${canExport ? '' : 'disabled'}>
        👁 צפייה מקדימה
      </button>
      <details class="excel-export-details">
        <summary class="excel-export-summary">ייצוא Excel (גיבוי)</summary>
        <button type="button" class="btn btn-secondary btn-sm" id="export-excel" style="width:100%;margin:8px 0" ${canExport ? '' : 'disabled'}>
          📊 הורד Excel — ייצור
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="export-process" style="width:100%;margin-bottom:8px" ${canExport ? '' : 'disabled'}>
          📝 הורד Excel — תיעוד
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="export-combined" style="width:100%" ${canExport ? '' : 'disabled'}>
          📋 הורד Excel — משולב
        </button>
      </details>
    </div>

    <div class="card report-import-card">
      <div class="card-title">ייבוא נתונים</div>
      <p class="report-hint">מומלץ: ייבוא מ-Google Sheets (למעלה) · או מקובץ Excel</p>
      <input type="file" id="reports-import-file" accept=".csv,.xlsx,.xls,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" hidden>
      <button type="button" class="btn btn-secondary" id="reports-import-btn" style="width:100%;margin-bottom:8px">
        📥 ייבא קובץ Excel
      </button>
      <button type="button" class="btn btn-secondary btn-sm" id="reports-template-btn" style="width:100%">
        הורד קובץ דוגמה
      </button>
    </div>

    <div class="card report-audit-card">
      <div class="card-title">🔍 בדיקת תקינות חישובים</div>
      <p class="report-hint">בודק שאין רישומים יתומים, כפילויות, או פערים אחרי איחוד מוצרים</p>
      <button type="button" class="btn btn-secondary" id="run-audit" style="width:100%;margin-bottom:8px">
        הרץ בדיקת תקינות
      </button>
      <div id="audit-results"></div>
    </div>

    <p class="stats-block-label">${fullTitle} · ${ctx.label}</p>

    ${isFlowsReport ? `
    <div class="card ${isFlowsSummary ? 'report-flows-summary-card' : 'report-flows-detail-card'}">
      <div class="card-title">${escapeHtml(fullTitle)} — ${escapeHtml(ctx.label)}</div>
      ${flowsReportHtml}
    </div>
    ` : isManagerReport ? `
    <div class="card report-manager-card">
      <div class="card-title">${escapeHtml(fullTitle)} — ${escapeHtml(ctx.label)}</div>
      ${managerReportHtml}
    </div>
    ` : isHistoryReport ? `
    <div class="card report-history-card">
      <div class="card-title">${escapeHtml(fullTitle)} — ${escapeHtml(ctx.label)}</div>
      <p class="form-hint" style="margin-bottom:10px">היסטוריית ייצור — כמויות בלבד, ללא תזרימים</p>
      ${renderProductionHistoryTableHTML(entries, productMap, categories, catMap, ctx.historyScope)}
    </div>
    ` : ctx.reportType === 'week' ? `
    <div class="card report-page-view" style="padding:16px">
      ${previewHtml}
    </div>
    ` : `
    <div class="stat-grid">
      <div class="stat-box">
        <div class="stat-value">${formatDecimal(totals.total)}</div>
        <div class="stat-label">ייצור מוצרים (יח')</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${formatMoney(totals.totalCost || 0)}</div>
        <div class="stat-label">עלות ייצור</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${formatMoney(totals.totalValue)}</div>
        <div class="stat-label">ערך ללקוח</div>
      </div>
    </div>

    ${catSummary.length > 0 ? `
      <div class="card">
        <div class="card-title">ייצור לפי קטגוריה — ${ctx.label}</div>
        ${renderCategorySummaryTable(catSummary)}
      </div>` : ''}

    <div class="card">
      <div class="card-title">פירוט מוצרים — ${ctx.label}</div>
      <p class="form-hint" style="margin-bottom:10px">עלות (חומ"ג, אריזה, נוספות) נפרדת מערך המכירה ללקוח</p>
      ${renderProductionTableHTML(rows, totals, catMap)}
    </div>

    <div class="card report-flows-card">
      <div class="card-title">תזרימי יצור — ${ctx.label}</div>
      <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px">תהליכים שהושלמו ותהליכים פעילים · שלב נוכחי</p>
      ${renderProductionRunsHTML(productionRuns, ctx, catMap, productMap, groupMap)}
    </div>

    <div class="card report-portions-card">
      <div class="card-title">🍽 תיעוד מנות — ${ctx.label}</div>
      <p class="form-hint" style="margin-bottom:10px">כל רשומות המנות מתזרימי יצור — כולל כמויות חלקיות (0.1 ומעלה)</p>
      ${renderPortionDocumentationHTML(productionRuns, catMap, productMap, groupMap)}
    </div>

    <div class="card process-card">
      <div class="card-title">תיעוד הכנות — ${ctx.label}</div>
      <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px">לשימושך · לא נכלל בייצור המוצרים${processTotalQty ? ` · סה"כ כמויות: ${formatDecimal(processTotalQty)}` : ''}</p>
      ${processLogs.length === 0
        ? '<p class="report-empty">אין תיעוד לתקופה זו</p>'
        : `${processSummary.length ? `
          <div class="report-table-wrap">
          <table class="report-table" style="margin-bottom:12px">
            <thead><tr><th>הכנה</th><th>קטגוריה</th><th>כמות</th></tr></thead>
            <tbody>
              ${processSummary.map((r) => `<tr>
                <td class="report-cell-text">${escapeHtml(r.activity)}</td>
                <td class="report-cell-text">${escapeHtml(r.category)}</td>
                <td class="report-cell-num">${r.qty != null ? formatDecimal(r.qty) : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
          </div>` : ''}
          ${processLogs.map((log) => `
          <div class="list-item">
            <div class="list-item-info">
              <div class="list-item-name">${escapeHtml(log.activity)}${log.quantity ? ` · ${formatDecimal(log.quantity)}` : ''}</div>
              <div class="list-item-meta">${formatDate(log.date)} · ${escapeHtml(catMap.get(log.categoryId) || '')}${log.notes ? ` · ${escapeHtml(log.notes)}` : ''}</div>
            </div>
          </div>`).join('')}`}
    </div>`}`;

  bindFilterEvents(container);

  bindSheetsStatusEvents(container, {
    onRefresh: () => renderReports(container),
    onImportComplete: () => renderReports(container),
  });

  document.getElementById('export-sheets-setup')?.addEventListener('click', () => {
    openSheetsSetupModal({ onSaved: () => renderReports(container) });
  });

  document.getElementById('export-sheets-report')?.addEventListener('click', async () => {
    const btn = document.getElementById('export-sheets-report');
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'שולח...'; }
    try {
      const msg = await exportReportToSheets({
        title: fullTitle,
        periodLabel: ctx.label,
        entries,
        categories,
        products: relevantProducts,
        productMap,
        catMap,
        processLogs,
      }, { openAfter: true });
      showToast(msg);
    } catch (err) {
      showToast(err.message || 'שגיאה בשליחה ל-Sheets');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  });

  const exportParams = {
    title: fullTitle,
    periodLabel: ctx.label,
    entries,
    categories,
    products: relevantProducts,
    productMap,
    catMap,
  };

  document.getElementById('open-report-page')?.addEventListener('click', () => {
    container.dataset.reportView = 'page';
    renderReports(container);
  });

  document.getElementById('preview-report')?.addEventListener('click', () => {
    openModal({
      title: 'צפייה מקדימה',
      bodyHTML: previewHtml,
      footerHTML: `
        <button type="button" class="btn btn-secondary modal-close-btn">סגור</button>
        <button type="button" class="btn btn-secondary" id="preview-open-page">📄 מסך מלא</button>
        <button type="button" class="btn btn-secondary" id="preview-save-page">💾 שמור דוח</button>
        <button type="button" class="btn btn-primary" id="preview-export">הורד Excel</button>`,
    });
    document.querySelector('.modal-close-btn')?.addEventListener('click', closeModal);
    document.getElementById('preview-open-page')?.addEventListener('click', () => {
      closeModal();
      container.dataset.reportView = 'page';
      renderReports(container);
    });
    document.getElementById('preview-save-page')?.addEventListener('click', () => {
      saveFormattedReport({ fullTitle, ctx, safeLabel, previewHtml });
    });
    document.getElementById('preview-export')?.addEventListener('click', async () => {
      try {
        const msg = await exportProductionExcel({
          ...exportParams,
          filename: `yitzur-${ctx.reportType}-${safeLabel}.xlsx`,
        });
        showToast(msg);
        closeModal();
      } catch (err) {
        showToast(err.message || 'שגיאה בייצוא');
      }
    });
  });

  document.getElementById('export-excel')?.addEventListener('click', async () => {
    try {
      const msg = await exportProductionExcel({
        ...exportParams,
        filename: `yitzur-${ctx.reportType}-${safeLabel}.xlsx`,
      });
      showToast(msg);
    } catch (err) {
      showToast(err.message || 'שגיאה בייצוא');
    }
  });

  document.getElementById('export-process')?.addEventListener('click', async () => {
    try {
      const msg = await exportProcessExcel({
        title: `תיעוד הכנות — ${fullTitle}`,
        periodLabel: ctx.label,
        processLogs,
        catMap,
        filename: `yitzur-tiud-${ctx.reportType}-${safeLabel}.xlsx`,
      });
      showToast(msg);
    } catch (err) {
      showToast(err.message || 'שגיאה בייצוא');
    }
  });

  document.getElementById('export-combined')?.addEventListener('click', async () => {
    try {
      const msg = await exportCombinedExcel({
        productionTitle: fullTitle,
        processTitle: 'תיעוד תהליכי הכנה (נספח)',
        periodLabel: ctx.label,
        entries,
        categories,
        products: relevantProducts,
        productMap,
        catMap,
        processLogs,
        filename: `yitzur-${ctx.reportType}-${safeLabel}.xlsx`,
      });
      showToast(msg);
    } catch (err) {
      showToast(err.message || 'שגיאה בייצוא');
    }
  });

  document.getElementById('reports-import-btn')?.addEventListener('click', () => {
    document.getElementById('reports-import-file')?.click();
  });

  document.getElementById('reports-template-btn')?.addEventListener('click', async () => {
    const { CSV_TEMPLATE_BLOCKS } = await import('../import.js');
    const { downloadBlob } = await import('../download.js');
    const blob = new Blob(['\ufeff' + CSV_TEMPLATE_BLOCKS], { type: 'text/csv;charset=utf-8' });
    await downloadBlob(blob, 'dugma-yitzur.csv');
    showToast('קובץ דוגמה — שמור או שתף');
  });

  document.getElementById('reports-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const { handleProductionImportFile } = await import('../import-flow.js');
    await handleProductionImportFile(file, {
      onComplete: async () => renderReports(container),
    });
  });

  document.getElementById('run-audit')?.addEventListener('click', async () => {
    const btn = document.getElementById('run-audit');
    const resultsEl = document.getElementById('audit-results');
    btn.disabled = true;
    btn.textContent = 'בודק...';
    try {
      const { runProductionAudit, formatAuditIssue } = await import('../integrity.js');
      const audit = await runProductionAudit();
      if (audit.ok) {
        resultsEl.innerHTML = `
          <div class="audit-ok">
            <strong>✓ הכל תקין</strong>
            <p>${audit.validEntries} רישומים · ${formatDecimal(audit.totals.total)} יח' · ${formatMoney(audit.totals.totalValue)}</p>
            <p class="form-hint">סכומי קטגוריה, מוצר ודוחות תואמים</p>
          </div>`;
        showToast('בדיקה עברה בהצלחה ✓');
      } else {
        resultsEl.innerHTML = `
          <div class="audit-fail">
            <strong>נמצאו ${audit.issues.length} בעיות</strong>
            <ul class="audit-issues-list">
              ${audit.issues.map((issue) => `<li>${escapeHtml(formatAuditIssue(issue))}</li>`).join('')}
            </ul>
            ${audit.orphanEntries ? `<p class="form-hint">יש ${audit.orphanEntries} רישומים יתומים — כנראה אחרי איחוד/מחיקה. ייבא גיבוי או מחק ידנית.</p>` : ''}
          </div>`;
        showToast(`נמצאו ${audit.issues.length} בעיות`);
      }
    } catch (err) {
      resultsEl.innerHTML = `<p class="audit-fail">${escapeHtml(err.message || 'שגיאה')}</p>`;
      showToast(err.message || 'שגיאה בבדיקה');
    } finally {
      btn.disabled = false;
      btn.textContent = 'הרץ בדיקת תקינות';
    }
  });
}

export function reportsMeta() {
  return { title: 'דוחות', subtitle: 'ייצור מוצרים — העיקרי' };
}
