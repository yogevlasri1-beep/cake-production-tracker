import {
  getCategories, getProducts, getEntriesForDate, getEntriesForMonth,
  getEntriesInRange, getProductionTotals, getProcessLogsInRange,
  getProcessLogsForDate, getProcessLogsForMonth, getProductionRunsInRange, getAllProductionRuns,
  getCategoryGroups, getAllFlowsOverview, getRunProductionEntries,
  getStepPortionBatches, getStepPortionTotal, formatPortionBatchSummary,
  computeRunMetrics, aggregateRunsMetrics, getProductsCatalogLayout,
  collectRunIngredientBatchTracking, getFlowStepsForFlow, getFlowPortionPresets,
  getLinkedProductsForFlow, getCandidateProductsForFlow,
  getManagerDepartments, getManagerTasks, getManagerIncidents,
  getManagerShiftNotes, getManagerEmployees, getManagerResponsibilityAreas,
  getDepartmentCleaningLists, getDepartmentCleaningTasks, getTargets,
} from '../db.js?v=349';
import {
  todayISO, formatDate, formatDateHebrew, formatMoney, currentMonth,
  showToast, escapeHtml, formatPortionCount, formatPortionWeightKg, formatDecimal, formatDuration, runDurationMs, stepDurationMs, formatDateTime, formatProductQuantity,
  addDaysISO,
} from '../utils.js?v=349';
import {
  exportProductionExcel, exportProcessExcel, exportCombinedExcel,
  summarizeProcessLogs, monthRange, weekRange,
} from '../export.js?v=349';
import { openModal, closeModal } from '../modal.js?v=349';
import {
  renderSheetsStatusHTML, bindSheetsStatusEvents, exportReportToSheets,
  openSheetsSetupModal,
} from '../sheets-flow.js?v=349';
import { isSheetsConfigured } from '../google-sheets.js?v=349';
import {
  buildProductMap, sumCategoryTotals, productProductionValue, productProductionCost,
  mapGetById, sortProductsForReport, compareReportProducts,
} from '../calc.js?v=349';
import { defaultColorForIndex } from '../chart.js?v=349';
import { saveReportPageAsHtml, printReportElement } from '../report-page-export.js?v=349';
import {
  getPurchaseCategories, getPurchaseItems, PURCHASE_STATUS_LABELS,
} from '../purchasing-db.js?v=349';

const MANAGER_PRIORITY_LABELS = { low: 'נמוך', medium: 'בינוני', high: 'גבוה' };
const MANAGER_TASK_STATUS = { open: 'פתוח', progress: 'בתהליך', done: 'הושלם' };
const MANAGER_INCIDENT_SEVERITY = { minor: 'קל', major: 'חמור', critical: 'קריטי' };
const MANAGER_INCIDENT_STATUS = { open: 'פתוח', investigating: 'בבדיקה', resolved: 'טופל' };
const MANAGER_URGENCY_LABELS = { red: 'דחוף', yellow: 'בינוני', green: 'נמוך' };
const MANAGER_NOTE_KIND_LABELS = { shift: 'משמרת', briefing: 'תדרוך', checklist: 'צ׳קליסט' };

export function isFlowsReportType(type) {
  return type === 'flows-detail' || type === 'flows-summary' || type === 'flows'
    || type === 'flows-forecast-summary' || type === 'flows-forecast-detail';
}

export function isFlowsForecastReportType(type) {
  return type === 'flows-forecast-summary' || type === 'flows-forecast-detail';
}

export function isManagerReportType(type) {
  return type === 'manager';
}

export function isProductsReportType(type) {
  return String(type || '').startsWith('products-');
}

export function isPortionsReportType(type) {
  return type === 'portions' || type === 'portions-type' || type === 'portions-batches';
}

export function isPnlReportType(type) {
  return String(type || '').startsWith('pnl');
}

export function normalizeReportType(type) {
  if (type === 'flows') return 'flows-summary';
  return type || 'day';
}

function reportSectionForType(type) {
  const t = normalizeReportType(type);
  if (isFlowsReportType(t)) return 'flows';
  if (isProductsReportType(t)) return 'products';
  if (isPortionsReportType(t)) return 'portions';
  if (isManagerReportType(t)) return 'manager';
  if (isPnlReportType(t)) return 'pnl';
  return 'production';
}

const REPORT_COLLAPSE_STORAGE = 'yitzur-reports-collapse-v1';

function getReportCollapseState() {
  try {
    return JSON.parse(sessionStorage.getItem(REPORT_COLLAPSE_STORAGE) || '{}');
  } catch {
    return {};
  }
}

function isReportSectionOpen(key, defaultOpen = false) {
  const state = getReportCollapseState();
  if (state[key] == null) return defaultOpen;
  return !!state[key];
}

function setReportSectionOpen(key, open) {
  const state = getReportCollapseState();
  state[key] = !!open;
  try {
    sessionStorage.setItem(REPORT_COLLAPSE_STORAGE, JSON.stringify(state));
  } catch { /* ignore */ }
}

function renderCollapsibleReportSection(key, titleHtml, bodyHtml, {
  defaultOpen = false,
  forceOpen = false,
  className = '',
} = {}) {
  const open = forceOpen || isReportSectionOpen(key, defaultOpen);
  return `
    <details class="card report-section-collapse ${className}" data-report-collapse="${escapeHtml(key)}" ${open ? 'open' : ''}>
      <summary class="card-title report-section-collapse-summary">
        <span class="report-section-collapse-label">${titleHtml}</span>
        <span class="report-section-collapse-chevron" aria-hidden="true"></span>
      </summary>
      <div class="report-section-collapse-body">${bodyHtml}</div>
    </details>`;
}

function renderReportSectionActionsHTML({ canExport, hints = [] } = {}) {
  return `
    <div class="report-section-actions">
      ${hints.map((h) => `<p class="report-hint">${escapeHtml(h)}</p>`).join('')}
      <div class="report-section-actions-row">
        <button type="button" class="btn btn-primary report-section-view-btn" ${canExport ? '' : 'disabled'}>
          👁 צפה בדוח
        </button>
        <button type="button" class="btn btn-secondary report-section-download-btn" ${canExport ? '' : 'disabled'}>
          💾 הורד כקובץ
        </button>
      </div>
    </div>`;
}

function buildReportDisplayCardHTML({
  fullTitle,
  ctx,
  needsProduct,
  needsPortionName,
  isFlowsReport,
  isFlowsSummary,
  isFlowsForecast,
  isPortionsReport,
  isPnlReport,
  isManagerReport,
  isHistoryReport,
  flowsReportHtml,
  portionsReportHtml,
  pnlReportHtml,
  managerReportHtml,
  previewHtml,
  entries,
  productMap,
  categories,
  catMap,
  groupMap,
  totals,
  rows,
  catSummary,
  processLogs,
  processSummary,
  processTotalQty,
  productionRuns,
}) {
  if (isFlowsReport) {
    return `
    <div class="card ${isFlowsSummary ? 'report-flows-summary-card' : isFlowsForecast ? 'report-flows-forecast-card' : 'report-flows-detail-card'}" style="margin:0;box-shadow:none">
      <div class="card-title">${escapeHtml(fullTitle)} — ${escapeHtml(ctx.label)}</div>
      ${flowsReportHtml}
    </div>`;
  }
  if (isPortionsReport) {
    return `
    <div class="card report-portions-only-card" style="margin:0;box-shadow:none">
      <div class="card-title">${escapeHtml(fullTitle)} — ${escapeHtml(ctx.label)}</div>
      ${needsPortionName ? '<p class="report-hint">בחר סוג מנה</p>' : portionsReportHtml}
    </div>`;
  }
  if (isPnlReport) {
    return `
    <div class="card report-pnl-card" style="margin:0;box-shadow:none">
      <div class="card-title">${escapeHtml(fullTitle)} — ${escapeHtml(ctx.label)}</div>
      ${needsProduct ? '<p class="report-hint">בחר מוצר</p>' : pnlReportHtml}
    </div>`;
  }
  if (isManagerReport) {
    return `
    <div class="card report-manager-card" style="margin:0;box-shadow:none">
      <div class="card-title">${escapeHtml(fullTitle)} — ${escapeHtml(ctx.label)}</div>
      ${managerReportHtml}
    </div>`;
  }
  if (isHistoryReport) {
    return `
    <div class="card report-history-card" style="margin:0;box-shadow:none">
      <div class="card-title">${escapeHtml(fullTitle)} — ${escapeHtml(ctx.label)}</div>
      <p class="form-hint" style="margin-bottom:10px">היסטוריית ייצור — כמויות בלבד, ללא תזרימים</p>
      ${renderProductionHistoryTableHTML(entries, productMap, categories, catMap, ctx.historyScope)}
    </div>`;
  }
  if (ctx.reportType === 'week') {
    return `
    <div class="card report-page-view" style="padding:16px;margin:0;box-shadow:none">
      ${previewHtml}
    </div>`;
  }
  return `
    <p class="stats-block-label" style="margin-top:0">${escapeHtml(fullTitle)} · ${escapeHtml(ctx.label)}</p>
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
      <div class="card" style="margin-top:12px">
        <div class="card-title">ייצור לפי קטגוריה — ${escapeHtml(ctx.label)}</div>
        ${renderCategorySummaryTable(catSummary)}
      </div>` : ''}

    <div class="card">
      <div class="card-title">פירוט מוצרים — ${escapeHtml(ctx.label)}</div>
      <p class="form-hint" style="margin-bottom:10px">עלות (חומ"ג, אריזה, נוספות) נפרדת מערך המכירה ללקוח</p>
      ${renderProductionTableHTML(rows, totals, catMap)}
    </div>

    <div class="card report-flows-card">
      <div class="card-title">תזרימי יצור — ${escapeHtml(ctx.label)}</div>
      <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px">תהליכים שהושלמו ותהליכים פעילים · שלב נוכחי</p>
      ${renderProductionRunsHTML(productionRuns, ctx, catMap, productMap, groupMap)}
    </div>

    <div class="card report-portions-card">
      <div class="card-title">🍽 תיעוד מנות — ${escapeHtml(ctx.label)}</div>
      <p class="form-hint" style="margin-bottom:10px">כל רשומות המנות מתזרימי יצור — כולל כמויות חלקיות (0.1 ומעלה)</p>
      ${renderPortionDocumentationHTML(productionRuns, catMap, productMap, groupMap)}
    </div>

    <div class="card process-card">
      <div class="card-title">תיעוד הכנות — ${escapeHtml(ctx.label)}</div>
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
    </div>`;
}

function bindReportCollapse(container) {
  container.querySelectorAll('details[data-report-collapse]').forEach((el) => {
    el.addEventListener('toggle', () => {
      setReportSectionOpen(el.dataset.reportCollapse, el.open);
    });
  });
}

/** סוגי דוח מוצרים → לוגיקת נתונים קיימת */
function productsReportDataAlias(type) {
  if (type === 'products-general' || type === 'products-period') return 'range';
  if (type === 'products-product') return 'product';
  if (type === 'products-category') return 'category';
  if (type === 'products-group') return 'products-group';
  return type;
}

function effectiveDataReportType(type) {
  const t = normalizeReportType(type);
  if (isProductsReportType(t)) return productsReportDataAlias(t);
  if (isPortionsReportType(t)) return 'portions';
  if (isPnlReportType(t)) {
    if (t === 'pnl-daily') return 'pnl-daily';
    if (t === 'pnl-monthly') return 'pnl-monthly';
    if (t === 'pnl-product') return 'pnl-product';
    return 'range';
  }
  return t;
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

function resolveReportContext(container, today, curYear, curMonth, catMap, productMap, groupMap = new Map()) {
  const reportType = normalizeReportType(container.dataset.reportType);
  const dataType = effectiveDataReportType(reportType);
  const defaultMonth = `${curYear}-${String(curMonth).padStart(2, '0')}`;

  let from = today;
  let to = today;
  let label = formatDate(today);
  let reportTitle = 'דוח יומי';
  let filterLabel = '';
  let selectedCategoryId = container.dataset.selectedCategory || '';
  let selectedProductId = container.dataset.selectedProduct || '';
  let selectedGroupId = container.dataset.selectedGroup || '';
  let selectedFlowId = container.dataset.selectedFlowId || '';
  let selectedPortionName = container.dataset.selectedPortionName || '';
  let weekDates = null;
  let weekAnchor = null;

  const applyRangeDefaults = () => {
    from = container.dataset.rangeFrom || monthStartIso(curYear, curMonth);
    to = container.dataset.rangeTo || today;
    if (from > to) [from, to] = [to, from];
    label = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
  };

  if (reportType === 'day' || (reportType === 'products-period' && container.dataset.productsPeriodMode === 'day')) {
    from = container.dataset.selectedDay || today;
    to = from;
    label = formatDate(from);
    reportTitle = reportType.startsWith('products') ? 'דוח מוצרים · יומי' : 'דוח יומי';
  } else if (reportType === 'month' || reportType === 'pnl-monthly'
    || (reportType === 'products-period' && (container.dataset.productsPeriodMode || 'month') === 'month')) {
    const selectedMonth = parseMonthValue(container.dataset.selectedMonth, curYear, curMonth);
    const mr = monthRange(selectedMonth.year, selectedMonth.month);
    from = mr.from;
    to = mr.to;
    label = mr.label;
    reportTitle = reportType === 'pnl-monthly' ? 'רווח והפסד · חודשי'
      : reportType.startsWith('products') ? 'דוח מוצרים · חודשי' : 'דוח חודשי';
  } else if (reportType === 'week'
    || (reportType === 'products-period' && container.dataset.productsPeriodMode === 'week')) {
    const anchor = container.dataset.selectedWeekDate || container.dataset.selectedWeekEnd || today;
    const wr = weekRange(anchor);
    from = wr.from;
    to = wr.to;
    weekDates = wr.dates;
    label = `${formatDate(from)} – ${formatDate(to)}`;
    reportTitle = reportType.startsWith('products') ? 'דוח מוצרים · שבועי' : 'דוח שבועי מפורט';
    weekAnchor = anchor;
  } else if (reportType === 'range' || reportType === 'products-general' || reportType === 'products-period'
    || reportType === 'portions' || reportType === 'portions-type' || reportType === 'portions-batches'
    || reportType === 'pnl' || reportType === 'pnl-period' || reportType === 'pnl-daily' || reportType === 'pnl-product') {
    applyRangeDefaults();
    if (reportType === 'products-general') reportTitle = 'דוח מוצרים · כללי';
    else if (reportType === 'products-period') reportTitle = 'דוח מוצרים · תקופה';
    else if (reportType === 'portions') reportTitle = 'דוח מנות · כללי';
    else if (reportType === 'portions-type') reportTitle = 'דוח מנות · לפי סוג';
    else if (reportType === 'portions-batches') reportTitle = 'דוח מנות · מספרי מנה חומרי גלם';
    else if (reportType === 'pnl') reportTitle = 'רווח והפסד · כללי מפורט';
    else if (reportType === 'pnl-period') reportTitle = 'רווח והפסד · תקופה';
    else if (reportType === 'pnl-daily') reportTitle = 'רווח והפסד · יומי';
    else if (reportType === 'pnl-product') reportTitle = 'רווח והפסד · לפי מוצר';
    else reportTitle = 'דוח טווח תאריכים';
  } else if (reportType === 'category' || reportType === 'products-category') {
    applyRangeDefaults();
    reportTitle = reportType === 'products-category' ? 'דוח מוצרים · לפי קטגוריה' : 'דוח לפי קטגוריה';
    filterLabel = catMap.get(Number(selectedCategoryId)) || '';
  } else if (reportType === 'product' || reportType === 'products-product') {
    applyRangeDefaults();
    reportTitle = reportType === 'products-product' ? 'דוח מוצרים · לפי סוג/מוצר' : 'דוח לפי מוצר';
    filterLabel = mapGetById(productMap, selectedProductId)?.name || '';
  } else if (reportType === 'products-group') {
    applyRangeDefaults();
    reportTitle = 'דוח מוצרים · קטגוריה כללית';
    filterLabel = groupMap.get(Number(selectedGroupId)) || '';
  } else if (reportType === 'flows-detail') {
    applyRangeDefaults();
    reportTitle = 'תזרימים מפורט';
  } else if (reportType === 'flows-summary') {
    applyRangeDefaults();
    reportTitle = 'סיכום תזרימים';
  } else if (reportType === 'flows-forecast-summary') {
    applyRangeDefaults();
    reportTitle = 'חיזוי תזרים · מסוכם';
  } else if (reportType === 'flows-forecast-detail') {
    applyRangeDefaults();
    reportTitle = 'חיזוי תזרים · מפורט';
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
      filterLabel = groupMap.get(Number(scopeId)) || container.dataset.historyGroupName || '';
    }
  } else if (reportType === 'manager') {
    applyRangeDefaults();
    reportTitle = 'דוח מנהל מפורט';
  }

  if (selectedFlowId && isFlowsReportType(reportType)) {
    filterLabel = [filterLabel, container.dataset.selectedFlowName || `תזרים #${selectedFlowId}`].filter(Boolean).join(' · ');
  }
  if (selectedPortionName && reportType === 'portions-type') {
    filterLabel = selectedPortionName;
  }
  const portionMaterialSearch = String(container.dataset.portionMaterialSearch || '').trim();
  const portionBatchNumSearch = String(container.dataset.portionBatchNumSearch || '').trim();
  const portionsBatchesMode = container.dataset.portionsBatchesMode === 'material' ? 'material' : 'all';
  if (reportType === 'portions-batches') {
    const parts = [];
    if (portionsBatchesMode === 'material') parts.push('לפי חומר גלם');
    if (portionMaterialSearch) parts.push(`חומר: ${portionMaterialSearch}`);
    if (portionBatchNumSearch) parts.push(`מספר מנה: ${portionBatchNumSearch}`);
    if (parts.length) filterLabel = parts.join(' · ');
  }

  return {
    reportType,
    dataType,
    from,
    to,
    label,
    reportTitle,
    filterLabel,
    selectedCategoryId,
    selectedProductId,
    selectedGroupId,
    selectedFlowId,
    selectedPortionName,
    defaultMonth,
    weekDates,
    weekAnchor,
    historyScope: container.dataset.historyScope || 'product',
    historyScopeId: container.dataset.historyScopeId || '',
    historyAllTime: container.dataset.historyAllTime !== '0',
    batchSearch: String(container.dataset.batchSearch || '').trim(),
    productsPeriodMode: container.dataset.productsPeriodMode || 'month',
    portionsBatchesMode,
    portionMaterialSearch,
    portionBatchNumSearch,
  };
}

async function fetchReportData(ctx) {
  let entries;
  let processLogs;
  const dataType = ctx.dataType || effectiveDataReportType(ctx.reportType);

  if (ctx.reportType === 'production-history' || ctx.reportType === 'manager') {
    entries = ctx.reportType === 'production-history'
      ? await getEntriesInRange('1970-01-01', todayISO())
      : [];
    processLogs = [];
    return { entries, processLogs, productionRuns: [] };
  }

  if (dataType === 'day' || ctx.reportType === 'day') {
    entries = await getEntriesForDate(ctx.from);
    processLogs = await getProcessLogsForDate(ctx.from);
  } else if (dataType === 'month' || ctx.reportType === 'month' || ctx.reportType === 'pnl-monthly'
    || (ctx.reportType === 'products-period' && ctx.productsPeriodMode === 'month')) {
    const monthIso = ctx.monthIso || `${ctx.from.slice(0, 7)}`;
    const [year, month] = monthIso.split('-').map(Number);
    entries = await getEntriesForMonth(year, month);
    processLogs = await getProcessLogsForMonth(year, month);
  } else {
    entries = await getEntriesInRange(ctx.from, ctx.to);
    processLogs = await getProcessLogsInRange(ctx.from, ctx.to);
  }

  if ((ctx.reportType === 'category' || ctx.reportType === 'products-category') && ctx.selectedCategoryId) {
    const catId = Number(ctx.selectedCategoryId);
    entries = entries.filter((e) => {
      const p = mapGetById(ctx.productMap, e.productId);
      return p?.categoryId === catId;
    });
    processLogs = processLogs.filter((log) => log.categoryId === catId);
  }

  if ((ctx.reportType === 'product' || ctx.reportType === 'products-product' || ctx.reportType === 'pnl-product')
    && ctx.selectedProductId) {
    const prodId = Number(ctx.selectedProductId);
    entries = entries.filter((e) => e.productId === prodId);
    const product = mapGetById(ctx.productMap, prodId);
    if (product) {
      processLogs = processLogs.filter((log) => log.categoryId === product.categoryId);
    } else {
      processLogs = [];
    }
  }

  let productionRuns = (ctx.batchSearch || ctx.portionBatchNumSearch)
    ? await getAllProductionRuns()
    : await getProductionRunsInRange(ctx.from, ctx.to, { includeActiveOutsideRange: true });

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

function normalizeBatchSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function runMatchesBatchSearch(run, batchSearch) {
  const q = normalizeBatchSearch(batchSearch);
  if (!q) return true;
  const batch = normalizeBatchSearch(run?.batchNumber);
  if (!batch) return false;
  return batch === q || batch.includes(q);
}

function filterProductionRuns(runs, ctx, categories) {
  let filtered = runs;
  if (ctx.batchSearch) {
    filtered = filtered.filter((r) => runMatchesBatchSearch(r, ctx.batchSearch));
  }
  if (ctx.selectedFlowId && isFlowsReportType(ctx.reportType)) {
    const fid = Number(ctx.selectedFlowId);
    filtered = filtered.filter((r) => Number(r.flowId) === fid);
  }
  if ((ctx.reportType === 'category' || ctx.reportType === 'products-category') && ctx.selectedCategoryId) {
    const catId = Number(ctx.selectedCategoryId);
    filtered = filtered.filter((r) => runMatchesCategory(r, catId, ctx.productMap, categories));
  }
  if ((ctx.reportType === 'product' || ctx.reportType === 'products-product') && ctx.selectedProductId) {
    const prodId = Number(ctx.selectedProductId);
    filtered = filtered.filter((r) => r.productId === prodId);
  }
  if (ctx.reportType === 'products-group' && ctx.selectedGroupId) {
    const gid = Number(ctx.selectedGroupId);
    filtered = filtered.filter((r) => {
      if (Number(r.categoryGroupId) === gid) return true;
      if (r.productId) {
        const p = mapGetById(ctx.productMap, r.productId);
        const cat = categories.find((c) => c.id === p?.categoryId);
        return cat && Number(cat.groupId) === gid;
      }
      if (r.categoryId) {
        const cat = categories.find((c) => c.id === r.categoryId);
        return cat && Number(cat.groupId) === gid;
      }
      return false;
    });
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

function avgOrNull(sum, count) {
  if (!count) return null;
  return sum / count;
}

function roundQty3(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
}

/** חיזוי לתזרים בודד — ממוצעים מתהליכים שהושלמו בתקופה */
async function computeFlowForecast(flowMeta, runsForFlow, productMap) {
  const completed = (runsForFlow || []).filter((r) => r.status === 'completed');
  const items = await Promise.all(completed.map(async (run) => {
    const entries = await getRunProductionEntries(run.id);
    return { run, entries, metrics: computeRunMetrics(run, entries) };
  }));

  const sampleSize = items.length;
  let portionSum = 0;
  let portionWeightSum = 0;
  let portionWeightSamples = 0;
  let productionSum = 0;
  let durationSum = 0;
  let durationSamples = 0;
  const productTotals = new Map();
  const portionTotals = new Map();
  const stepTotals = new Map();

  for (const { run, metrics } of items) {
    if (metrics.portionCount != null) portionSum += metrics.portionCount;
    if (metrics.portionWeightKg != null) {
      portionWeightSum += metrics.portionWeightKg;
      portionWeightSamples += 1;
    }
    productionSum += metrics.productionQty || 0;
    if (metrics.durationMs != null) {
      durationSum += metrics.durationMs;
      durationSamples += 1;
    }
    for (const [pid, qty] of metrics.productionByProduct || []) {
      const id = Number(pid);
      if (!id) continue;
      productTotals.set(id, (productTotals.get(id) || 0) + (Number(qty) || 0));
    }
    for (const step of run.steps || []) {
      if (!step.tracksPortions) continue;
      for (const batch of getStepPortionBatches(step)) {
        const name = String(batch.name || 'מנה').trim() || 'מנה';
        const weight = batch.weight != null ? Number(batch.weight) : null;
        const key = `${name}|${weight ?? ''}|${batch.extra || ''}`;
        if (!portionTotals.has(key)) {
          portionTotals.set(key, {
            name,
            weight: Number.isFinite(weight) ? weight : null,
            extra: batch.extra || '',
            countSum: 0,
            weightKgSum: 0,
            hasWeight: false,
          });
        }
        const row = portionTotals.get(key);
        const cnt = Number(batch.count) || 0;
        row.countSum += cnt;
        const lineKg = batch.weight != null && Number.isFinite(Number(batch.weight))
          ? Number(batch.weight) * cnt
          : null;
        if (lineKg != null) {
          row.weightKgSum += lineKg;
          row.hasWeight = true;
        }
      }
    }
    let prevCompleted = null;
    for (let i = 0; i < (run.steps || []).length; i++) {
      const step = run.steps[i];
      const name = String(step.stepName || `שלב ${i + 1}`).trim();
      const ms = stepDurationMs(step, prevCompleted, run.startedAt);
      if (step.completedAt) prevCompleted = step.completedAt;
      if (ms == null) continue;
      if (!stepTotals.has(name)) {
        stepTotals.set(name, {
          stepName: name,
          durationSum: 0,
          samples: 0,
          tracksPortions: !!step.tracksPortions,
          tracksProduction: !!step.tracksProduction,
        });
      }
      const st = stepTotals.get(name);
      st.durationSum += ms;
      st.samples += 1;
      st.tracksPortions = st.tracksPortions || !!step.tracksPortions;
      st.tracksProduction = st.tracksProduction || !!step.tracksProduction;
    }
  }

  const byProduct = [...productTotals.entries()]
    .map(([productId, totalQty]) => {
      const product = productMap.get(Number(productId));
      return {
        productId: Number(productId),
        name: product?.name || `#${productId}`,
        avgQty: roundQty3(avgOrNull(totalQty, sampleSize)),
        totalQty: roundQty3(totalQty),
      };
    })
    .filter((r) => r.avgQty != null && r.avgQty > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));

  const byPortion = [...portionTotals.values()]
    .map((row) => ({
      name: row.name,
      weight: row.weight,
      extra: row.extra,
      avgCount: roundQty3(avgOrNull(row.countSum, sampleSize)),
      avgWeightKg: row.hasWeight ? roundQty3(avgOrNull(row.weightKgSum, sampleSize)) : null,
    }))
    .filter((r) => r.avgCount != null && r.avgCount > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));

  let templateSteps = [];
  try {
    templateSteps = flowMeta?.id ? await getFlowStepsForFlow(flowMeta.id) : [];
  } catch { /* ignore */ }

  const byStepFromHistory = [...stepTotals.values()].map((st) => ({
    stepName: st.stepName,
    avgDurationMs: avgOrNull(st.durationSum, st.samples),
    samples: st.samples,
    tracksPortions: st.tracksPortions,
    tracksProduction: st.tracksProduction,
  }));

  const byStep = [];
  const usedNames = new Set();
  for (const tpl of templateSteps) {
    const hist = byStepFromHistory.find((s) => s.stepName === tpl.name);
    usedNames.add(tpl.name);
    byStep.push({
      stepName: tpl.name,
      avgDurationMs: hist?.avgDurationMs ?? null,
      samples: hist?.samples || 0,
      tracksPortions: !!tpl.tracksPortions,
      tracksProduction: !!tpl.tracksProduction,
    });
  }
  for (const hist of byStepFromHistory) {
    if (usedNames.has(hist.stepName)) continue;
    byStep.push(hist);
  }

  let linkedProducts = [];
  let portionPresets = [];
  try {
    if (flowMeta?.id) {
      const linked = await getLinkedProductsForFlow(flowMeta.id);
      linkedProducts = linked.map((row) => row.product).filter(Boolean);
      if (!linkedProducts.length) {
        linkedProducts = await getCandidateProductsForFlow(flowMeta.id);
      }
      portionPresets = await getFlowPortionPresets(flowMeta.id);
    }
  } catch { /* catalog optional */ }

  return {
    flowId: flowMeta?.id || null,
    flowName: flowMeta?.name || 'תזרים',
    targetLabel: flowMeta?.targetLabel || '',
    stepCount: flowMeta?.stepCount || templateSteps.length || 0,
    sampleSize,
    expected: {
      portionCount: roundQty3(avgOrNull(portionSum, sampleSize)),
      portionWeightKg: roundQty3(avgOrNull(portionWeightSum, portionWeightSamples)),
      productionQty: roundQty3(avgOrNull(productionSum, sampleSize)),
      durationMs: avgOrNull(durationSum, durationSamples),
      byProduct,
      byPortion,
      byStep,
    },
    catalog: {
      linkedProducts: linkedProducts.map((p) => ({ id: p.id, name: p.name })),
      portionPresets: (portionPresets || []).map((p) => ({
        id: p.id,
        name: p.name,
        weight: p.weight,
        extra: p.extra || '',
      })),
    },
  };
}

async function buildFlowsForecasts(productionRuns, flowsOverview, productMap, { selectedFlowId } = {}) {
  const flowMap = new Map((flowsOverview || []).map((f) => [Number(f.id), f]));
  const { byFlow } = groupRunsByFlow(productionRuns || []);

  let flowIds;
  if (selectedFlowId) {
    flowIds = [Number(selectedFlowId)];
  } else {
    const ids = new Set([
      ...[...byFlow.keys()].map(Number),
      ...(flowsOverview || []).map((f) => Number(f.id)),
    ]);
    flowIds = [...ids].filter(Boolean);
  }

  const forecasts = [];
  for (const flowId of flowIds) {
    const meta = flowMap.get(flowId) || {
      id: flowId,
      name: byFlow.get(flowId)?.[0]?.flowName || `תזרים #${flowId}`,
      targetLabel: '',
      stepCount: 0,
    };
    const runs = byFlow.get(flowId) || [];
    forecasts.push(await computeFlowForecast(meta, runs, productMap));
  }

  forecasts.sort((a, b) => a.flowName.localeCompare(b.flowName, 'he'));
  return forecasts;
}

function renderFlowsForecastSummaryHTML(forecasts) {
  if (!forecasts.length) {
    return '<p class="report-empty">אין תזרימים להצגה</p>';
  }
  const withHistory = forecasts.filter((f) => f.sampleSize > 0);
  return `
    <p class="form-hint" style="margin-top:0">חיזוי לפי ממוצע תהליכים שהושלמו בתקופה · ${withHistory.length} תזרימים עם היסטוריה מתוך ${forecasts.length}</p>
    <div class="report-table-wrap">
      <table class="report-table report-flows-forecast-summary-table">
        <thead><tr>
          <th>תזרים</th><th>תהליכים לחישוב</th><th>מוצרים (ממוצע)</th><th>מנות (ממוצע)</th><th>משקל מנות</th><th>זמן ממוצע</th>
        </tr></thead>
        <tbody>
          ${forecasts.map((f) => {
    const productsLine = f.expected.byProduct.length
      ? f.expected.byProduct.map((p) => `${escapeHtml(p.name)}: ${formatDecimal(p.avgQty)}`).join(' · ')
      : (f.expected.productionQty != null ? formatDecimal(f.expected.productionQty) : '—');
    return `
            <tr>
              <td class="report-cell-text">
                <strong>${escapeHtml(f.flowName)}</strong>
                ${f.targetLabel ? `<div class="form-hint">${escapeHtml(f.targetLabel)}</div>` : ''}
              </td>
              <td class="report-cell-num">${f.sampleSize}</td>
              <td class="report-cell-text">${productsLine}</td>
              <td class="report-cell-num">${f.expected.portionCount != null ? formatPortionCount(f.expected.portionCount) : '—'}</td>
              <td class="report-cell-num">${f.expected.portionWeightKg != null ? formatPortionWeightKg(f.expected.portionWeightKg) : '—'}</td>
              <td class="report-cell-num">${f.expected.durationMs != null ? formatDuration(f.expected.durationMs) : '—'}</td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>
    </div>
    ${forecasts.some((f) => f.sampleSize === 0) ? '<p class="form-hint">תזרימים ללא תהליכים שהושלמו בתקופה — אין ממוצע לחיזוי</p>' : ''}`;
}

function renderOneFlowForecastDetailHTML(f) {
  const productsHtml = f.expected.byProduct.length
    ? `<div class="report-table-wrap"><table class="report-table">
        <thead><tr><th>מוצר</th><th>ממוצע לתהליך</th><th>סה״כ בתקופה</th></tr></thead>
        <tbody>
          ${f.expected.byProduct.map((p) => `
            <tr>
              <td class="report-cell-text">${escapeHtml(p.name)}</td>
              <td class="report-cell-num"><strong>${formatDecimal(p.avgQty)}</strong></td>
              <td class="report-cell-num">${formatDecimal(p.totalQty)}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>`
    : (f.catalog.linkedProducts.length
      ? `<p class="form-hint">אין ייצור בהיסטוריה · מוצרים משויכים לתזרים: ${escapeHtml(f.catalog.linkedProducts.map((p) => p.name).join(', '))}</p>`
      : '<p class="form-hint">אין נתוני מוצרים</p>');

  const portionsHtml = f.expected.byPortion.length
    ? `<div class="report-table-wrap"><table class="report-table">
        <thead><tr><th>מנה</th><th>משקל למנה</th><th>תוספת</th><th>ממוצע כמות</th><th>ממוצע משקל</th></tr></thead>
        <tbody>
          ${f.expected.byPortion.map((p) => `
            <tr>
              <td class="report-cell-text">${escapeHtml(p.name)}</td>
              <td class="report-cell-num">${p.weight != null ? formatPortionWeightKg(p.weight) : '—'}</td>
              <td class="report-cell-text">${p.extra ? escapeHtml(p.extra) : '—'}</td>
              <td class="report-cell-num"><strong>${formatPortionCount(p.avgCount)}</strong></td>
              <td class="report-cell-num">${p.avgWeightKg != null ? formatPortionWeightKg(p.avgWeightKg) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>`
    : (f.catalog.portionPresets.length
      ? `<p class="form-hint">אין מנות בהיסטוריה · מנות מוגדרות: ${escapeHtml(f.catalog.portionPresets.map((p) => p.name).join(', '))}</p>`
      : '<p class="form-hint">אין נתוני מנות</p>');

  const timeHtml = `
    <div class="flow-metrics-grid flow-metrics-grid--secondary" style="margin-bottom:10px">
      <div class="flow-metrics-stat">
        <span class="flow-metrics-icon">⏱</span>
        <div class="flow-metrics-body">
          <span class="flow-metrics-value">${f.expected.durationMs != null ? formatDuration(f.expected.durationMs) : '—'}</span>
          <span class="flow-metrics-label">זמן ממוצע לתהליך</span>
        </div>
      </div>
      <div class="flow-metrics-stat">
        <span class="flow-metrics-icon">🍽</span>
        <div class="flow-metrics-body">
          <span class="flow-metrics-value">${f.expected.portionCount != null ? formatPortionCount(f.expected.portionCount) : '—'}</span>
          <span class="flow-metrics-label">מנות ממוצע</span>
        </div>
      </div>
      <div class="flow-metrics-stat">
        <span class="flow-metrics-icon">📦</span>
        <div class="flow-metrics-body">
          <span class="flow-metrics-value">${f.expected.productionQty != null ? formatDecimal(f.expected.productionQty) : '—'}</span>
          <span class="flow-metrics-label">מוצרים ממוצע</span>
        </div>
      </div>
    </div>
    ${f.expected.byStep.length ? `
    <div class="report-table-wrap"><table class="report-table">
      <thead><tr><th>#</th><th>שלב</th><th>זמן ממוצע</th><th>סוג</th></tr></thead>
      <tbody>
        ${f.expected.byStep.map((s, i) => `
          <tr>
            <td class="report-cell-num">${i + 1}</td>
            <td class="report-cell-text">${escapeHtml(s.stepName)}</td>
            <td class="report-cell-num">${s.avgDurationMs != null ? formatDuration(s.avgDurationMs) : '—'}</td>
            <td class="report-cell-text">${[
    s.tracksPortions ? 'מנות' : '',
    s.tracksProduction ? 'ייצור' : '',
  ].filter(Boolean).join(' · ') || '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table></div>` : '<p class="form-hint">אין פירוט זמני שלבים</p>'}`;

  return `
    <section class="report-flows-forecast-detail-section" style="margin-bottom:20px">
      <h4 class="report-preview-heading" style="margin-top:0">
        ${escapeHtml(f.flowName)}
        <span class="form-hint"> · ${f.sampleSize} תהליכים שהושלמו${f.targetLabel ? ` · ${escapeHtml(f.targetLabel)}` : ''}</span>
      </h4>
      <h5 class="report-preview-heading" style="font-size:0.95rem">📦 מוצרים</h5>
      ${productsHtml}
      <h5 class="report-preview-heading" style="font-size:0.95rem">🍽 מנות</h5>
      ${portionsHtml}
      <h5 class="report-preview-heading" style="font-size:0.95rem">⏱ זמן</h5>
      ${timeHtml}
    </section>`;
}

async function buildFlowsForecastReportHTML(productionRuns, productMap, flowsOverview, {
  mode = 'summary',
  selectedFlowId = '',
} = {}) {
  const forecasts = await buildFlowsForecasts(productionRuns, flowsOverview, productMap, {
    selectedFlowId: selectedFlowId ? Number(selectedFlowId) : null,
  });
  if (!forecasts.length) {
    return '<p class="report-empty">אין תזרימים להצגה — בחר סוג תזרים או הרחב את טווח התאריכים</p>';
  }
  if (mode === 'detail') {
    return `
      <p class="form-hint" style="margin-top:0">חיזוי מפורט לפי ממוצע תהליכים שהושלמו · מוצרים, מנות וזמן</p>
      ${forecasts.map((f) => renderOneFlowForecastDetailHTML(f)).join('')}`;
  }
  return renderFlowsForecastSummaryHTML(forecasts);
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

function renderPortionDocumentationHTML(productionRuns, catMap, productMap, groupMap, { portionName = '' } = {}) {
  const rows = [];
  for (const run of productionRuns) {
    for (const step of run.steps || []) {
      if (!step.tracksPortions) continue;
      for (const batch of getStepPortionBatches(step)) {
        if (portionName && String(batch.name || '').trim() !== portionName) continue;
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

function collectPortionNamesFromRuns(productionRuns) {
  const names = new Set();
  for (const run of productionRuns || []) {
    for (const step of run.steps || []) {
      if (!step.tracksPortions) continue;
      for (const batch of getStepPortionBatches(step)) {
        const n = String(batch.name || '').trim();
        if (n) names.add(n);
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'he'));
}

/** שורות מספרי מנה על אריזה · חומרי גלם — מכל התהליכים */
function collectIngredientBatchReportRows(productionRuns) {
  const rows = [];
  for (const run of productionRuns || []) {
    const tracking = collectRunIngredientBatchTracking(run);
    for (const t of tracking) {
      rows.push({
        ...t,
        runId: run.id,
        runDate: run.date || '',
        runBatchNumber: run.batchNumber || '',
        flowId: run.flowId || null,
        flowName: run.flowName || (run.flowId ? `תזרים #${run.flowId}` : 'ללא תזרים'),
        runStatus: run.status || '',
      });
    }
  }
  rows.sort((a, b) => {
    const d = String(b.runDate || '').localeCompare(String(a.runDate || ''));
    if (d) return d;
    return String(a.ingredientName || '').localeCompare(String(b.ingredientName || ''), 'he')
      || String(a.packagingBatchNumber || '').localeCompare(String(b.packagingBatchNumber || ''), 'he');
  });
  return rows;
}

function filterIngredientBatchReportRows(rows, { materialQuery = '', batchQuery = '' } = {}) {
  const mq = String(materialQuery || '').trim().toLocaleLowerCase('he');
  const bq = String(batchQuery || '').trim().toLocaleLowerCase('he');
  return (rows || []).filter((row) => {
    if (mq) {
      const name = String(row.ingredientName || '').toLocaleLowerCase('he');
      const supplier = String(row.supplierName || '').toLocaleLowerCase('he');
      if (!name.includes(mq) && !supplier.includes(mq)) return false;
    }
    if (bq) {
      const num = String(row.packagingBatchNumber || '').toLocaleLowerCase('he');
      if (!num.includes(bq)) return false;
    }
    return true;
  });
}

function groupIngredientBatchesByMaterial(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.rawMaterialId
      ? `id:${row.rawMaterialId}`
      : `name:${String(row.ingredientName || '').toLocaleLowerCase('he')}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        ingredientName: row.ingredientName || 'חומר גלם',
        supplierName: row.supplierName || '',
        rawMaterialId: row.rawMaterialId || null,
        numbers: [],
        rows: [],
      });
    }
    const g = map.get(key);
    g.rows.push(row);
    const num = String(row.packagingBatchNumber || '').trim();
    if (num && !g.numbers.includes(num)) g.numbers.push(num);
    if (!g.supplierName && row.supplierName) g.supplierName = row.supplierName;
  }
  return [...map.values()].sort((a, b) => a.ingredientName.localeCompare(b.ingredientName, 'he'));
}

function groupIngredientBatchesByNumber(rows) {
  const map = new Map();
  for (const row of rows) {
    const num = String(row.packagingBatchNumber || '').trim();
    if (!num) continue;
    const key = num.toLocaleLowerCase('he');
    if (!map.has(key)) {
      map.set(key, {
        packagingBatchNumber: num,
        flows: new Map(),
        ingredients: new Set(),
        rows: [],
      });
    }
    const g = map.get(key);
    g.rows.push(row);
    g.ingredients.add(row.ingredientName || 'חומר גלם');
    const flowKey = row.flowId ? String(row.flowId) : `name:${row.flowName}`;
    if (!g.flows.has(flowKey)) {
      g.flows.set(flowKey, {
        flowId: row.flowId,
        flowName: row.flowName || 'ללא תזרים',
        runDates: new Set(),
        runBatchNumbers: new Set(),
        count: 0,
      });
    }
    const flow = g.flows.get(flowKey);
    flow.count += 1;
    if (row.runDate) flow.runDates.add(row.runDate);
    if (row.runBatchNumber) flow.runBatchNumbers.add(row.runBatchNumber);
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      ingredients: [...g.ingredients].sort((a, b) => a.localeCompare(b, 'he')),
      flows: [...g.flows.values()]
        .map((f) => ({
          ...f,
          runDates: [...f.runDates].sort((a, b) => b.localeCompare(a)),
          runBatchNumbers: [...f.runBatchNumbers],
        }))
        .sort((a, b) => a.flowName.localeCompare(b.flowName, 'he')),
    }))
    .sort((a, b) => a.packagingBatchNumber.localeCompare(b.packagingBatchNumber, 'he'));
}

function renderIngredientBatchesReportHTML(productionRuns, {
  mode = 'all',
  materialQuery = '',
  batchQuery = '',
} = {}) {
  const allRows = collectIngredientBatchReportRows(productionRuns);
  const rows = filterIngredientBatchReportRows(allRows, {
    materialQuery,
    batchQuery,
  });

  if (!allRows.length) {
    return '<p class="report-empty">אין רשימות מספרי מנה לחומרי גלם בתקופה זו</p>';
  }
  if (!rows.length) {
    return `<p class="report-empty">אין תוצאות לחיפוש${materialQuery || batchQuery
      ? ` (${[materialQuery && `חומר: ${materialQuery}`, batchQuery && `מספר מנה: ${batchQuery}`].filter(Boolean).join(' · ')})`
      : ''}</p>`;
  }

  const batchGroups = batchQuery ? groupIngredientBatchesByNumber(rows) : [];

  const flowsForBatchHtml = batchQuery && batchGroups.length ? `
    <div class="report-portion-batches-flows" style="margin-bottom:16px">
      <h4 class="report-preview-heading" style="margin-top:0">תזרימים לפי מספר מנה</h4>
      ${batchGroups.map((g) => `
        <div class="report-portion-batch-flow-card" style="margin-bottom:12px;padding:10px;border:1px solid var(--border);border-radius:8px">
          <div style="font-weight:700;margin-bottom:6px">מספר מנה: <span dir="ltr">${escapeHtml(g.packagingBatchNumber)}</span></div>
          <p class="form-hint" style="margin:0 0 8px">חומרים: ${escapeHtml(g.ingredients.join(', '))}</p>
          <div class="report-table-wrap">
            <table class="report-table">
              <thead><tr><th>תזרים</th><th>אצוות תהליך</th><th>תאריכים</th><th>רשומות</th></tr></thead>
              <tbody>
                ${g.flows.map((f) => `
                  <tr>
                    <td class="report-cell-text">${escapeHtml(f.flowName)}</td>
                    <td class="report-cell-text">${f.runBatchNumbers.length ? escapeHtml(f.runBatchNumbers.join(', ')) : '—'}</td>
                    <td class="report-cell-text">${f.runDates.map((d) => formatDate(d)).join(', ') || '—'}</td>
                    <td class="report-cell-num">${f.count}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`).join('')}
    </div>` : '';

  if (mode === 'material') {
    const groups = groupIngredientBatchesByMaterial(rows);
    return `
      ${flowsForBatchHtml}
      <h4 class="report-preview-heading" style="margin-top:0">רשימה לפי חומר גלם (${groups.length})</h4>
      ${groups.map((g) => `
        <div class="report-portion-material-group" style="margin-bottom:14px">
          <div style="font-weight:700;margin-bottom:4px">${escapeHtml(g.ingredientName)}${g.supplierName ? ` · <span class="form-hint">${escapeHtml(g.supplierName)}</span>` : ''}</div>
          <p class="form-hint" style="margin:0 0 6px">מספרי מנה: ${g.numbers.length
    ? g.numbers.map((n) => `<span dir="ltr">${escapeHtml(n)}</span>`).join(' · ')
    : '—'}</p>
          <div class="report-table-wrap">
            <table class="report-table">
              <thead><tr>
                <th>מספר מנה</th><th>תזרים</th><th>מנה</th><th>תאריך</th><th>אצווה</th>
              </tr></thead>
              <tbody>
                ${g.rows.map((row) => `
                  <tr>
                    <td class="report-cell-text" dir="ltr">${escapeHtml(row.packagingBatchNumber)}</td>
                    <td class="report-cell-text">${escapeHtml(row.flowName)}</td>
                    <td class="report-cell-text">${escapeHtml(row.portionName || '—')}</td>
                    <td class="report-cell-num">${row.runDate ? formatDate(row.runDate) : '—'}</td>
                    <td class="report-cell-text">${row.runBatchNumber ? escapeHtml(row.runBatchNumber) : '—'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`).join('')}
      <p class="form-hint">סה״כ ${rows.length} רשומות · ${groups.length} חומרי גלם</p>`;
  }

  return `
    ${flowsForBatchHtml}
    <h4 class="report-preview-heading" style="margin-top:0">רשימה כוללת (${rows.length})</h4>
    <div class="report-table-wrap">
      <table class="report-table report-portion-batches-table">
        <thead><tr>
          <th>תאריך</th><th>חומר גלם</th><th>מספר מנה</th><th>תזרים</th><th>מנה</th><th>ספק</th><th>אצווה</th>
        </tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td class="report-cell-num">${row.runDate ? formatDate(row.runDate) : '—'}</td>
              <td class="report-cell-text">${escapeHtml(row.ingredientName)}</td>
              <td class="report-cell-text" dir="ltr"><strong>${escapeHtml(row.packagingBatchNumber)}</strong></td>
              <td class="report-cell-text">${escapeHtml(row.flowName)}</td>
              <td class="report-cell-text">${escapeHtml(row.portionName || '—')}</td>
              <td class="report-cell-text">${row.supplierName ? escapeHtml(row.supplierName) : '—'}</td>
              <td class="report-cell-text">${row.runBatchNumber ? escapeHtml(row.runBatchNumber) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function buildPnlProductRows(rows) {
  return rows.map((r) => ({
    ...r,
    margin: (Number(r.value) || 0) - (Number(r.cost) || 0),
  }));
}

function renderPnlTableHTML(rows, totals) {
  if (!rows.length) return '<p class="report-empty">אין נתונים לתקופה זו</p>';
  const withMargin = buildPnlProductRows(rows);
  const totalMargin = (Number(totals.totalValue) || 0) - (Number(totals.totalCost) || 0);
  return `
    <div class="report-table-wrap">
    <table class="report-table report-cost-table">
      <thead><tr>
        <th>מוצר</th><th>כמות</th><th>עלות</th><th>ערך ללקוח</th><th>רווח / הפסד</th>
      </tr></thead>
      <tbody>
        ${withMargin.map((r) => `
          <tr>
            <td class="report-cell-text">${escapeHtml(r.product.name)}</td>
            <td class="report-cell-num">${formatDecimal(r.qty)}</td>
            <td class="report-cell-num">${r.cost > 0 ? formatMoney(r.cost) : '—'}</td>
            <td class="report-cell-num">${formatMoney(r.value)}</td>
            <td class="report-cell-num ${r.margin >= 0 ? 'report-pnl-positive' : 'report-pnl-negative'}">${formatMoney(r.margin)}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot><tr>
        <td colspan="2">סה"כ</td>
        <td>${totals.totalCost > 0 ? formatMoney(totals.totalCost) : '—'}</td>
        <td>${formatMoney(totals.totalValue)}</td>
        <td class="${totalMargin >= 0 ? 'report-pnl-positive' : 'report-pnl-negative'}"><strong>${formatMoney(totalMargin)}</strong></td>
      </tr></tfoot>
    </table>
    </div>`;
}

function unitProductCost(product) {
  return (Number(product?.rawMaterialsCost) || 0)
    + (Number(product?.packagingCost) || 0)
    + (Number(product?.additionalCosts) || 0);
}

function unitProductValue(product) {
  return Number(product?.unitPrice) || 0;
}

function buildPnlDailyRows(entries, productMap) {
  const byDate = new Map();
  for (const e of entries || []) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
  return dates.map((date) => {
    let qty = 0;
    let cost = 0;
    let value = 0;
    for (const e of byDate.get(date)) {
      const p = mapGetById(productMap, e.productId);
      if (!p) continue;
      const q = Number(e.quantity) || 0;
      qty += q;
      cost += unitProductCost(p) * q;
      value += unitProductValue(p) * q;
    }
    return { date, qty, cost, value, margin: value - cost };
  });
}

function buildPnlMonthlyRows(entries, productMap) {
  const byMonth = new Map();
  for (const e of entries || []) {
    const m = String(e.date || '').slice(0, 7);
    if (!m) continue;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(e);
  }
  const months = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));
  return months.map((month) => {
    let qty = 0;
    let cost = 0;
    let value = 0;
    for (const e of byMonth.get(month)) {
      const p = mapGetById(productMap, e.productId);
      if (!p) continue;
      const q = Number(e.quantity) || 0;
      qty += q;
      cost += unitProductCost(p) * q;
      value += unitProductValue(p) * q;
    }
    return { month, qty, cost, value, margin: value - cost };
  });
}

function renderPnlPeriodBreakdownHTML(rows, { mode = 'daily' } = {}) {
  if (!rows.length) return '<p class="report-empty">אין נתונים לתקופה זו</p>';
  const isDaily = mode === 'daily';
  return `
    <div class="report-table-wrap">
    <table class="report-table report-cost-table">
      <thead><tr>
        <th>${isDaily ? 'תאריך' : 'חודש'}</th><th>כמות</th><th>עלות</th><th>ערך ללקוח</th><th>רווח / הפסד</th>
      </tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td class="report-cell-text">${isDaily ? formatDate(r.date) : escapeHtml(r.month)}</td>
            <td class="report-cell-num">${formatDecimal(r.qty)}</td>
            <td class="report-cell-num">${r.cost > 0 ? formatMoney(r.cost) : '—'}</td>
            <td class="report-cell-num">${formatMoney(r.value)}</td>
            <td class="report-cell-num ${r.margin >= 0 ? 'report-pnl-positive' : 'report-pnl-negative'}">${formatMoney(r.margin)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}

function buildPnlPreviewHTML(ctx, totals, rows, entries, productMap) {
  const margin = (Number(totals.totalValue) || 0) - (Number(totals.totalCost) || 0);
  let body = '';
  if (ctx.reportType === 'pnl-daily') {
    body = renderPnlPeriodBreakdownHTML(buildPnlDailyRows(entries, productMap), { mode: 'daily' });
  } else if (ctx.reportType === 'pnl-monthly') {
    body = renderPnlPeriodBreakdownHTML(buildPnlMonthlyRows(entries, productMap), { mode: 'monthly' });
  } else {
    body = renderPnlTableHTML(rows, totals);
  }
  return `
    <div class="report-preview">
      <p class="report-preview-meta">${escapeHtml(reportSubtitle(ctx))}</p>
      <div class="stat-grid report-preview-stats">
        <div class="stat-box">
          <div class="stat-value">${formatMoney(totals.totalCost || 0)}</div>
          <div class="stat-label">עלות</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${formatMoney(totals.totalValue)}</div>
          <div class="stat-label">הכנסה (ערך ללקוח)</div>
        </div>
        <div class="stat-box">
          <div class="stat-value ${margin >= 0 ? 'report-pnl-positive' : 'report-pnl-negative'}">${formatMoney(margin)}</div>
          <div class="stat-label">רווח / הפסד</div>
        </div>
      </div>
      <h4 class="report-preview-heading">${ctx.reportType === 'pnl-daily' ? 'פירוט יומי' : ctx.reportType === 'pnl-monthly' ? 'פירוט חודשי' : 'פירוט מוצרים'}</h4>
      ${body}
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

function renderFlowsFiltersHTML(ctx, flowsOverview = []) {
  const batchVal = escapeHtml(ctx.batchSearch || '');
  const flowOptions = (flowsOverview || []).map((f) => {
    const path = [f.groupName, f.targetLabel].filter(Boolean).join(' › ');
    return `<option value="${f.id}" ${String(f.id) === String(ctx.selectedFlowId) ? 'selected' : ''}>${escapeHtml(f.name)}${path ? ` — ${escapeHtml(path)}` : ''}</option>`;
  }).join('');
  return `
    <div class="report-filter-grid">
      <div class="form-group">
        <label for="report-from">מתאריך</label>
        <input type="date" id="report-from" value="${ctx.from}" ${ctx.batchSearch ? 'disabled' : ''}>
      </div>
      <div class="form-group">
        <label for="report-to">עד תאריך</label>
        <input type="date" id="report-to" value="${ctx.to}" ${ctx.batchSearch ? 'disabled' : ''}>
      </div>
      <div class="form-group">
        <label for="report-flow-type">סוג תזרים</label>
        <select id="report-flow-type" ${ctx.batchSearch ? 'disabled' : ''}>
          <option value="">כל התזרימים</option>
          ${flowOptions}
        </select>
      </div>
      <div class="form-group report-batch-search-group">
        <label for="report-batch-search">מספר אצווה</label>
        <div class="filter-row" style="margin:0;gap:6px">
          <input type="search" id="report-batch-search" value="${batchVal}" placeholder="למשל: 42 או A-105" inputmode="search" autocomplete="off" style="flex:1">
          <button type="button" class="btn btn-primary btn-sm" id="report-batch-search-btn">חפש</button>
          ${ctx.batchSearch ? '<button type="button" class="btn btn-secondary btn-sm" id="report-batch-clear-btn">נקה</button>' : ''}
        </div>
      </div>
    </div>
    <p class="form-hint" style="margin-top:8px;margin-bottom:0">${ctx.batchSearch
    ? `מציג תהליכים עם אצווה «${escapeHtml(ctx.batchSearch)}» מכל התקופות`
    : isFlowsForecastReportType(ctx.reportType)
      ? 'חיזוי לפי ממוצע תהליכים שהושלמו בתקופה · בחר סוג תזרים לסינון'
      : 'סנן לפי תקופה, סוג תזרים או מספר אצווה'}</p>`;
}

function renderPortionsFiltersHTML(ctx, portionNames = []) {
  const nameOptions = portionNames.map((n) =>
    `<option value="${escapeHtml(n)}" ${n === ctx.selectedPortionName ? 'selected' : ''}>${escapeHtml(n)}</option>`,
  ).join('');
  const materialVal = escapeHtml(ctx.portionMaterialSearch || '');
  const batchNumVal = escapeHtml(ctx.portionBatchNumSearch || '');
  const mode = ctx.portionsBatchesMode === 'material' ? 'material' : 'all';
  return `
    <div class="report-filter-grid">
      <div class="form-group">
        <label for="report-from">מתאריך</label>
        <input type="date" id="report-from" value="${ctx.from}" ${ctx.portionBatchNumSearch ? 'disabled' : ''}>
      </div>
      <div class="form-group">
        <label for="report-to">עד תאריך</label>
        <input type="date" id="report-to" value="${ctx.to}" ${ctx.portionBatchNumSearch ? 'disabled' : ''}>
      </div>
      ${ctx.reportType === 'portions-type' ? `
      <div class="form-group">
        <label for="report-portion-name">סוג מנה</label>
        <select id="report-portion-name" ${portionNames.length ? '' : 'disabled'}>
          <option value="">בחר מנה...</option>
          ${nameOptions}
        </select>
      </div>` : ''}
    </div>
    ${ctx.reportType === 'portions-batches' ? `
    <div class="tabs tabs-wrap report-portion-batches-mode-tabs" style="margin:10px 0">
      <button type="button" class="tab ${mode === 'all' ? 'active' : ''}" data-portions-batches-mode="all">רשימה כוללת</button>
      <button type="button" class="tab ${mode === 'material' ? 'active' : ''}" data-portions-batches-mode="material">לפי חומר גלם</button>
    </div>
    <div class="report-filter-grid">
      <div class="form-group">
        <label for="report-portion-material-search">חיפוש לפי חומר גלם</label>
        <div class="filter-row" style="margin:0;gap:6px">
          <input type="search" id="report-portion-material-search" value="${materialVal}"
            placeholder="שם חומר או ספק..." inputmode="search" autocomplete="off" style="flex:1">
          <button type="button" class="btn btn-primary btn-sm" id="report-portion-material-search-btn">חפש</button>
          ${ctx.portionMaterialSearch ? '<button type="button" class="btn btn-secondary btn-sm" id="report-portion-material-clear-btn">נקה</button>' : ''}
        </div>
      </div>
      <div class="form-group">
        <label for="report-portion-batch-num-search">חיפוש לפי מספר מנה</label>
        <div class="filter-row" style="margin:0;gap:6px">
          <input type="search" id="report-portion-batch-num-search" value="${batchNumVal}"
            placeholder="מספר על האריזה..." inputmode="search" autocomplete="off" style="flex:1">
          <button type="button" class="btn btn-primary btn-sm" id="report-portion-batch-num-search-btn">חפש</button>
          ${ctx.portionBatchNumSearch ? '<button type="button" class="btn btn-secondary btn-sm" id="report-portion-batch-num-clear-btn">נקה</button>' : ''}
        </div>
      </div>
    </div>
    <p class="form-hint" style="margin-top:8px;margin-bottom:0">${ctx.portionBatchNumSearch
    ? `מציג מספר מנה «${escapeHtml(ctx.portionBatchNumSearch)}» מכל התקופות · כולל תזרימים`
    : 'רשימות מספרי מנה שנרשמו על חומרי גלם בתהליכים · חיפוש מספר מנה סורק את כל ההיסטוריה'}</p>` : ''}`;
}

function renderProductsFiltersHTML(ctx, categories, products, groups, today, defaultMonth) {
  const alias = productsReportDataAlias(ctx.reportType);
  let html = '';
  if (ctx.reportType === 'products-period') {
    const mode = ctx.productsPeriodMode || 'month';
    html += `
      <div class="tabs tabs-wrap report-products-period-tabs" style="margin-bottom:10px">
        <button type="button" class="tab ${mode === 'day' ? 'active' : ''}" data-products-period="day">יומי</button>
        <button type="button" class="tab ${mode === 'week' ? 'active' : ''}" data-products-period="week">שבועי</button>
        <button type="button" class="tab ${mode === 'month' ? 'active' : ''}" data-products-period="month">חודשי</button>
        <button type="button" class="tab ${mode === 'range' ? 'active' : ''}" data-products-period="range">טווח</button>
      </div>`;
    if (mode === 'day') {
      html += `<div class="form-group"><label for="report-day">תאריך</label><input type="date" id="report-day" value="${ctx.from}"></div>`;
    } else if (mode === 'week') {
      html += `<div class="form-group"><label for="report-week">שבוע</label><input type="date" id="report-week" value="${ctx.weekAnchor || ctx.to}"><p class="form-hint">${formatDateHebrew(ctx.from)} – ${formatDateHebrew(ctx.to)}</p></div>`;
    } else if (mode === 'month') {
      html += `<div class="form-group"><label for="report-month">חודש</label><input type="month" id="report-month" value="${defaultMonth}"></div>`;
    } else {
      html += `
        <div class="report-filter-grid">
          <div class="form-group"><label for="report-from">מתאריך</label><input type="date" id="report-from" value="${ctx.from}"></div>
          <div class="form-group"><label for="report-to">עד תאריך</label><input type="date" id="report-to" value="${ctx.to}"></div>
        </div>`;
    }
    return html;
  }

  html += `
    <div class="report-filter-grid">
      <div class="form-group"><label for="report-from">מתאריך</label><input type="date" id="report-from" value="${ctx.from}"></div>
      <div class="form-group"><label for="report-to">עד תאריך</label><input type="date" id="report-to" value="${ctx.to}"></div>
    </div>`;

  if (alias === 'category' || ctx.reportType === 'products-category') {
    html += `
      <div class="form-group">
        <label for="report-category">קטגוריה</label>
        <select id="report-category" ${categories.length === 0 ? 'disabled' : ''}>
          <option value="">בחר קטגוריה...</option>
          ${categories.map((c) => `<option value="${c.id}" ${String(c.id) === ctx.selectedCategoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>`;
  }
  if (alias === 'product' || ctx.reportType === 'products-product') {
    html += `
      <div class="form-group">
        <label for="report-product">מוצר / סוג</label>
        <select id="report-product" ${products.length === 0 ? 'disabled' : ''}>
          <option value="">בחר מוצר...</option>
          ${products.map((p) => {
    const cat = categories.find((c) => c.id === p.categoryId);
    return `<option value="${p.id}" ${String(p.id) === ctx.selectedProductId ? 'selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(cat?.name || '')})</option>`;
  }).join('')}
        </select>
      </div>`;
  }
  if (ctx.reportType === 'products-group') {
    html += `
      <div class="form-group">
        <label for="report-group">קטגוריה כללית</label>
        <select id="report-group" ${groups.length === 0 ? 'disabled' : ''}>
          <option value="">בחר קטגוריה כללית...</option>
          ${groups.map((g) => `<option value="${g.id}" ${String(g.id) === String(ctx.selectedGroupId) ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>`;
  }
  return html;
}

function renderPnlFiltersHTML(ctx, products, categories, defaultMonth) {
  if (ctx.reportType === 'pnl-monthly') {
    return `
      <div class="form-group">
        <label for="report-month">חודש</label>
        <input type="month" id="report-month" value="${defaultMonth}">
      </div>`;
  }
  let html = `
    <div class="report-filter-grid">
      <div class="form-group"><label for="report-from">מתאריך</label><input type="date" id="report-from" value="${ctx.from}"></div>
      <div class="form-group"><label for="report-to">עד תאריך</label><input type="date" id="report-to" value="${ctx.to}"></div>
    </div>`;
  if (ctx.reportType === 'pnl-product') {
    html += `
      <div class="form-group">
        <label for="report-product">מוצר</label>
        <select id="report-product" ${products.length === 0 ? 'disabled' : ''}>
          <option value="">בחר מוצר...</option>
          ${products.map((p) => {
    const cat = categories.find((c) => c.id === p.categoryId);
    return `<option value="${p.id}" ${String(p.id) === ctx.selectedProductId ? 'selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(cat?.name || '')})</option>`;
  }).join('')}
        </select>
      </div>`;
  }
  return html;
}

function renderReportFiltersCards(ctx, categories, products, today, defaultMonth, catalog, {
  flowsOverview = [],
  groups = [],
  portionNames = [],
  activeSectionBlock = '',
} = {}) {
  const activeSection = reportSectionForType(ctx.reportType);
  const tab = (type, label, activeTypes) => {
    const active = activeTypes.includes(ctx.reportType);
    return `<button type="button" class="tab ${active ? 'active' : ''}" data-type="${type}">${label}</button>`;
  };
  const withActiveReport = (sectionKey, body) => (
    activeSection === sectionKey && activeSectionBlock
      ? `${body}${activeSectionBlock}`
      : body
  );

  const productionBody = withActiveReport('production', `
    <div class="tabs tabs-wrap report-type-tabs report-production-tabs">
      ${tab('day', 'יומי', ['day'])}
      ${tab('week', 'שבועי מפורט', ['week'])}
      ${tab('month', 'חודשי', ['month'])}
      ${tab('range', 'טווח תאריכים', ['range'])}
      ${tab('category', 'לפי קטגוריה', ['category'])}
      ${tab('product', 'לפי מוצר', ['product'])}
      ${tab('production-history', 'היסטוריית ייצור', ['production-history'])}
    </div>
    ${activeSection === 'production' && !isFlowsReportType(ctx.reportType) && ctx.reportType !== 'production-history'
    ? `<div class="report-dynamic-filters">${renderFiltersHTML({ ...ctx, defaultMonth }, categories, products, today, defaultMonth)}</div>`
    : ''}
    ${ctx.reportType === 'production-history'
    ? `<div class="report-dynamic-filters report-history-dynamic-filters">${renderProductionHistoryFiltersHTML(ctx, catalog)}</div>`
    : ''}`);

  const flowsBody = withActiveReport('flows', `
    <div class="tabs tabs-wrap report-type-tabs report-flows-tabs">
      ${tab('flows-detail', 'תזרימים מפורט', ['flows-detail'])}
      ${tab('flows-summary', 'סיכום תזרימים', ['flows-summary'])}
      ${tab('flows-forecast-summary', 'חיזוי · מסוכם', ['flows-forecast-summary'])}
      ${tab('flows-forecast-detail', 'חיזוי · מפורט', ['flows-forecast-detail'])}
    </div>
    ${isFlowsReportType(ctx.reportType)
    ? `<div class="report-dynamic-filters report-flows-dynamic-filters">${renderFlowsFiltersHTML(ctx, flowsOverview)}</div>`
    : '<p class="form-hint">בחר סוג דוח תזרימים כדי לסנן לפי תאריך, סוג תזרים, אצווה ותקופה</p>'}`);

  const productsBody = withActiveReport('products', `
    <div class="tabs tabs-wrap report-type-tabs report-products-tabs">
      ${tab('products-general', 'דוח כללי', ['products-general'])}
      ${tab('products-product', 'לפי סוג', ['products-product'])}
      ${tab('products-category', 'קטגוריה', ['products-category'])}
      ${tab('products-group', 'קטגוריה כללית', ['products-group'])}
      ${tab('products-period', 'תקופה', ['products-period'])}
    </div>
    ${isProductsReportType(ctx.reportType)
    ? `<div class="report-dynamic-filters">${renderProductsFiltersHTML(ctx, categories, products, groups, today, defaultMonth)}</div>`
    : '<p class="form-hint">בחר סוג דוח מוצרים</p>'}`);

  const portionsBody = withActiveReport('portions', `
    <div class="tabs tabs-wrap report-type-tabs report-portions-tabs">
      ${tab('portions', 'דוח כללי', ['portions'])}
      ${tab('portions-type', 'לפי סוג', ['portions-type'])}
      ${tab('portions-batches', 'מספרי מנה · חומרי גלם', ['portions-batches'])}
    </div>
    ${isPortionsReportType(ctx.reportType)
    ? `<div class="report-dynamic-filters">${renderPortionsFiltersHTML(ctx, portionNames)}</div>`
    : '<p class="form-hint">בחר דוח מנות · סנן לפי תקופה או סוג מנה</p>'}`);

  const managerBody = withActiveReport('manager', `
    <div class="tabs tabs-wrap report-type-tabs report-manager-tabs">
      ${tab('manager', 'דוח מנהל מפורט', ['manager'])}
    </div>
    ${isManagerReportType(ctx.reportType)
    ? `<div class="report-dynamic-filters report-manager-dynamic-filters">${renderManagerFiltersHTML(ctx)}</div>`
    : '<p class="form-hint">לחץ כדי לפתוח דוח מנהל מפורט</p>'}`);

  const pnlBody = withActiveReport('pnl', `
    <div class="tabs tabs-wrap report-type-tabs report-pnl-tabs">
      ${tab('pnl', 'כללי מפורט', ['pnl'])}
      ${tab('pnl-product', 'מוצר', ['pnl-product'])}
      ${tab('pnl-daily', 'יומי', ['pnl-daily'])}
      ${tab('pnl-monthly', 'חודשי', ['pnl-monthly'])}
      ${tab('pnl-period', 'תקופה', ['pnl-period'])}
    </div>
    ${isPnlReportType(ctx.reportType)
    ? `<div class="report-dynamic-filters">${renderPnlFiltersHTML(ctx, products, categories, defaultMonth)}</div>`
    : '<p class="form-hint">בחר סוג דוח רווח והפסד</p>'}`);

  return `
    ${renderCollapsibleReportSection('production', '1 · דוח ייצור', productionBody, {
    defaultOpen: activeSection === 'production',
    forceOpen: activeSection === 'production',
    className: 'report-filters-card',
  })}
    ${renderCollapsibleReportSection('flows', '2 · דוח תזרימים', flowsBody, {
    defaultOpen: activeSection === 'flows',
    forceOpen: activeSection === 'flows',
    className: 'report-flows-filters-card',
  })}
    ${renderCollapsibleReportSection('products', '3 · דוח מוצרים', productsBody, {
    defaultOpen: activeSection === 'products',
    forceOpen: activeSection === 'products',
    className: 'report-products-filters-card',
  })}
    ${renderCollapsibleReportSection('portions', '4 · דוח מנות', portionsBody, {
    defaultOpen: activeSection === 'portions',
    forceOpen: activeSection === 'portions',
    className: 'report-portions-filters-card',
  })}
    ${renderCollapsibleReportSection('manager', '5 · דוח מנהל מפורט', managerBody, {
    defaultOpen: activeSection === 'manager',
    forceOpen: activeSection === 'manager',
    className: 'report-manager-filters-card',
  })}
    ${renderCollapsibleReportSection('pnl', '6 · דוח רווח והפסד', pnlBody, {
    defaultOpen: activeSection === 'pnl',
    forceOpen: activeSection === 'pnl',
    className: 'report-pnl-filters-card',
  })}`;
}

function bindFilterEvents(container) {
  const bindTypeTabs = (selector) => {
    container.querySelectorAll(selector).forEach((tab) => {
      tab.addEventListener('click', () => {
        container.dataset.reportType = tab.dataset.type;
        const section = reportSectionForType(tab.dataset.type);
        setReportSectionOpen(section, true);
        renderReports(container);
      });
    });
  };
  bindTypeTabs('.report-production-tabs .tab');
  bindTypeTabs('.report-flows-tabs .tab');
  bindTypeTabs('.report-products-tabs .tab');
  bindTypeTabs('.report-portions-tabs .tab');
  bindTypeTabs('.report-manager-tabs .tab');
  bindTypeTabs('.report-pnl-tabs .tab');

  container.querySelectorAll('.report-products-period-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.dataset.productsPeriodMode = tab.dataset.productsPeriod;
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

  const applyBatchSearch = () => {
    const raw = document.getElementById('report-batch-search')?.value?.trim() || '';
    if (raw) container.dataset.batchSearch = raw;
    else delete container.dataset.batchSearch;
    renderReports(container);
  };
  document.getElementById('report-batch-search-btn')?.addEventListener('click', applyBatchSearch);
  document.getElementById('report-batch-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyBatchSearch();
    }
  });
  document.getElementById('report-batch-clear-btn')?.addEventListener('click', () => {
    delete container.dataset.batchSearch;
    renderReports(container);
  });

  document.getElementById('report-flow-type')?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val) {
      container.dataset.selectedFlowId = val;
      const opt = e.target.selectedOptions?.[0];
      container.dataset.selectedFlowName = opt?.textContent?.split(' — ')[0] || '';
    } else {
      delete container.dataset.selectedFlowId;
      delete container.dataset.selectedFlowName;
    }
    renderReports(container);
  });

  document.getElementById('report-portion-name')?.addEventListener('change', (e) => {
    if (e.target.value) container.dataset.selectedPortionName = e.target.value;
    else delete container.dataset.selectedPortionName;
    renderReports(container);
  });

  container.querySelectorAll('.report-portion-batches-mode-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.dataset.portionsBatchesMode = tab.dataset.portionsBatchesMode || 'all';
      renderReports(container);
    });
  });

  const applyPortionMaterialSearch = () => {
    const raw = document.getElementById('report-portion-material-search')?.value?.trim() || '';
    if (raw) container.dataset.portionMaterialSearch = raw;
    else delete container.dataset.portionMaterialSearch;
    renderReports(container);
  };
  document.getElementById('report-portion-material-search-btn')?.addEventListener('click', applyPortionMaterialSearch);
  document.getElementById('report-portion-material-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyPortionMaterialSearch();
    }
  });
  document.getElementById('report-portion-material-clear-btn')?.addEventListener('click', () => {
    delete container.dataset.portionMaterialSearch;
    renderReports(container);
  });

  const applyPortionBatchNumSearch = () => {
    const raw = document.getElementById('report-portion-batch-num-search')?.value?.trim() || '';
    if (raw) container.dataset.portionBatchNumSearch = raw;
    else delete container.dataset.portionBatchNumSearch;
    renderReports(container);
  };
  document.getElementById('report-portion-batch-num-search-btn')?.addEventListener('click', applyPortionBatchNumSearch);
  document.getElementById('report-portion-batch-num-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyPortionBatchNumSearch();
    }
  });
  document.getElementById('report-portion-batch-num-clear-btn')?.addEventListener('click', () => {
    delete container.dataset.portionBatchNumSearch;
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

  document.getElementById('report-group')?.addEventListener('change', (e) => {
    container.dataset.selectedGroup = e.target.value;
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

  const ctx = resolveReportContext(container, today, curYear, curMonth, catMap, productMap, groupMap);
  ctx.productMap = productMap;
  ctx.defaultMonth = container.dataset.selectedMonth || defaultMonth;
  if (ctx.batchSearch && isFlowsReportType(ctx.reportType)) {
    ctx.filterLabel = `אצווה ${ctx.batchSearch}`;
    ctx.label = `אצווה ${ctx.batchSearch}`;
  }
  if (ctx.portionBatchNumSearch && ctx.reportType === 'portions-batches') {
    ctx.filterLabel = `מספר מנה ${ctx.portionBatchNumSearch}`;
    ctx.label = `מספר מנה ${ctx.portionBatchNumSearch}`;
  }

  if (ctx.reportType === 'production-history' && ctx.historyScopeId) {
    if (ctx.historyScope === 'group') {
      ctx.filterLabel = groupMap.get(Number(ctx.historyScopeId)) || ctx.filterLabel;
    } else if (ctx.historyScope === 'category') {
      ctx.filterLabel = catMap.get(Number(ctx.historyScopeId)) || ctx.filterLabel;
    } else if (ctx.historyScope === 'product') {
      ctx.filterLabel = mapGetById(productMap, ctx.historyScopeId)?.name || ctx.filterLabel;
    }
  }

  if (ctx.reportType === 'month' || ctx.reportType === 'pnl-monthly'
    || (ctx.reportType === 'products-period' && (ctx.productsPeriodMode || 'month') === 'month')) {
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
  } else if (ctx.reportType === 'products-group' && ctx.selectedGroupId) {
    const ids = productIdsForHistoryScope('group', ctx.selectedGroupId, products, categories);
    entries = ids ? rawEntries.filter((e) => ids.has(e.productId)) : [];
  }

  const totals = await getProductionTotals(entries, productMap);
  const processSummary = summarizeProcessLogs(processLogs, catMap);
  const processTotalQty = processLogs.reduce((s, l) => s + (l.quantity || 0), 0);

  let relevantProducts = products;
  if ((ctx.reportType === 'category' || ctx.reportType === 'products-category') && ctx.selectedCategoryId) {
    relevantProducts = products.filter((p) => String(p.categoryId) === ctx.selectedCategoryId);
  } else if ((ctx.reportType === 'product' || ctx.reportType === 'products-product' || ctx.reportType === 'pnl-product') && ctx.selectedProductId) {
    relevantProducts = products.filter((p) => String(p.id) === ctx.selectedProductId);
  } else if (ctx.reportType === 'production-history' && ctx.historyScopeId) {
    const ids = productIdsForHistoryScope(ctx.historyScope, ctx.historyScopeId, products, categories);
    relevantProducts = ids ? products.filter((p) => ids.has(p.id)) : [];
  } else if (ctx.reportType === 'products-group' && ctx.selectedGroupId) {
    const ids = productIdsForHistoryScope('group', ctx.selectedGroupId, products, categories);
    relevantProducts = ids ? products.filter((p) => ids.has(p.id)) : [];
  }

  const rows = buildProductRows(relevantProducts, totals, categories, ctx.reportType);

  const catSummary = mapCategorySummary(
    ((ctx.reportType === 'category' || ctx.reportType === 'products-category') && ctx.selectedCategoryId)
      ? categories.filter((c) => String(c.id) === ctx.selectedCategoryId)
      : categories,
    products,
    totals,
  );

  const safeLabel = ctx.label.replace(/\//g, '-').replace(/\s+/g, '_');
  const fullTitle = ctx.filterLabel
    ? `${ctx.reportTitle} — ${ctx.filterLabel}`
    : ctx.reportTitle;

  const needsCategory = (ctx.reportType === 'category' || ctx.reportType === 'products-category') && !ctx.selectedCategoryId;
  const needsProduct = (ctx.reportType === 'product' || ctx.reportType === 'products-product' || ctx.reportType === 'pnl-product') && !ctx.selectedProductId;
  const needsGroup = ctx.reportType === 'products-group' && !ctx.selectedGroupId;
  const needsPortionName = ctx.reportType === 'portions-type' && !ctx.selectedPortionName;
  const needsHistoryScope = ctx.reportType === 'production-history' && !ctx.historyScopeId;
  const isFlowsReport = isFlowsReportType(ctx.reportType);
  const isHistoryReport = ctx.reportType === 'production-history';
  const isManagerReport = isManagerReportType(ctx.reportType);
  const isProductsReport = isProductsReportType(ctx.reportType);
  const isPortionsReport = isPortionsReportType(ctx.reportType);
  const isPnlReport = isPnlReportType(ctx.reportType);
  const isFlowsSummary = ctx.reportType === 'flows-summary';
  const isFlowsDetail = ctx.reportType === 'flows-detail';
  const isFlowsForecast = isFlowsForecastReportType(ctx.reportType);
  const canExport = isManagerReport || isFlowsReport || isHistoryReport || isPortionsReport || isPnlReport || isProductsReport
    ? !(needsHistoryScope || needsCategory || needsProduct || needsGroup || needsPortionName)
    : (!needsCategory && !needsProduct);
  const sheetsHTML = await renderSheetsStatusHTML();
  const sheetsReady = await isSheetsConfigured();
  const flowsOverview = await getAllFlowsOverview();
  const portionNames = collectPortionNamesFromRuns(productionRuns);
  const flowsReportHtml = isFlowsSummary
    ? await buildFlowsReportHTML(productionRuns, productMap, flowsOverview)
    : isFlowsDetail
      ? buildFlowsDetailReportHTML(productionRuns, ctx, catMap, productMap, groupMap, flowsOverview)
      : isFlowsForecast
        ? await buildFlowsForecastReportHTML(productionRuns, productMap, flowsOverview, {
          mode: ctx.reportType === 'flows-forecast-detail' ? 'detail' : 'summary',
          selectedFlowId: ctx.selectedFlowId || '',
        })
        : '';
  const managerData = isManagerReport
    ? await fetchManagerReportData(ctx.from, ctx.to, { categories, productMap })
    : null;
  const managerReportHtml = managerData ? buildManagerReportHTML(managerData, ctx) : '';
  const portionsReportHtml = isPortionsReport
    ? (ctx.reportType === 'portions-batches'
      ? renderIngredientBatchesReportHTML(productionRuns, {
        mode: ctx.portionsBatchesMode || 'all',
        materialQuery: ctx.portionMaterialSearch || '',
        batchQuery: ctx.portionBatchNumSearch || '',
      })
      : renderPortionDocumentationHTML(productionRuns, catMap, productMap, groupMap, {
        portionName: ctx.reportType === 'portions-type' ? (ctx.selectedPortionName || '') : '',
      }))
    : '';
  const pnlReportHtml = isPnlReport
    ? buildPnlPreviewHTML(ctx, totals, rows, entries, productMap)
    : '';
  let previewHtml = '';
  if (isManagerReport) previewHtml = managerReportHtml;
  else if (isFlowsReport) previewHtml = flowsReportHtml;
  else if (isPortionsReport) previewHtml = portionsReportHtml;
  else if (isPnlReport) previewHtml = pnlReportHtml;
  else if (isHistoryReport) previewHtml = buildProductionHistoryPreviewHTML(ctx, entries, productMap, categories, catMap);
  else if (ctx.reportType === 'week') {
    previewHtml = await buildWeeklyPreviewHTML(ctx, entries, products, categories, productMap, catMap, processLogs, processSummary, productionRuns, groupMap);
  } else {
    previewHtml = buildPreviewHTML(ctx, totals, rows, catSummary, processLogs, processSummary, catMap, productionRuns, productMap, groupMap);
  }
  const isPageView = container.dataset.reportView === 'page';

  const viewHints = [
    needsCategory ? 'בחר קטגוריה לצפייה ולהורדה' : '',
    needsProduct ? 'בחר מוצר לצפייה ולהורדה' : '',
    needsGroup ? 'בחר קטגוריה כללית לצפייה ולהורדה' : '',
    needsPortionName ? 'בחר סוג מנה לצפייה ולהורדה' : '',
    needsHistoryScope ? 'בחר מוצר, קטגוריה או קטגוריה כללית לצפייה ולהורדה' : '',
  ].filter(Boolean);

  const reportDisplayHtml = buildReportDisplayCardHTML({
    fullTitle,
    ctx,
    needsProduct,
    needsPortionName,
    isFlowsReport,
    isFlowsSummary,
    isFlowsForecast,
    isPortionsReport,
    isPnlReport,
    isManagerReport,
    isHistoryReport,
    flowsReportHtml,
    portionsReportHtml,
    pnlReportHtml,
    managerReportHtml,
    previewHtml,
    entries,
    productMap,
    categories,
    catMap,
    groupMap,
    totals,
    rows,
    catSummary,
    processLogs,
    processSummary,
    processTotalQty,
    productionRuns,
  });

  const activeSectionBlock = `
    ${renderReportSectionActionsHTML({ canExport, hints: viewHints })}
    <div class="report-section-preview" id="report-section-preview">
      ${reportDisplayHtml}
    </div>`;

  const filtersCard = renderReportFiltersCards(ctx, categories, products, today, ctx.defaultMonth, catalog, {
    flowsOverview,
    groups,
    portionNames,
    activeSectionBlock: isPageView ? '' : activeSectionBlock,
  });

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
    bindReportCollapse(container);
    bindReportPageToolbar(container, { fullTitle, ctx, safeLabel, previewHtml });
    return;
  }

  const toolsBody = `
      <div class="card sheets-primary-card" style="margin:0 0 12px;box-shadow:none">
        <div class="card-title">📊 Google Sheets</div>
        <div id="sheets-status">${sheetsHTML}</div>
      </div>
      <div class="card report-actions-card" style="margin:0 0 12px;box-shadow:none">
        <div class="card-title">ייצוא נוסף</div>
        ${viewHints.map((h) => `<p class="report-hint">${escapeHtml(h)}</p>`).join('')}
        <button type="button" class="btn btn-primary" id="open-report-page" style="width:100%;margin-bottom:8px" ${canExport ? '' : 'disabled'}>
          📄 דוח מעוצב — מסך מלא
        </button>
        <button type="button" class="btn btn-primary" id="export-sheets-report" style="width:100%;margin-bottom:8px" ${canExport && sheetsReady ? '' : 'disabled'}>
          📊 שלח דוח ל-Google Sheets
        </button>
        ${!sheetsReady ? `<button type="button" class="btn btn-secondary" id="export-sheets-setup" style="width:100%;margin-bottom:8px">🔗 חבר Google Sheets לייצוא</button>` : ''}
        <button type="button" class="btn btn-secondary" id="preview-report" style="width:100%;margin-bottom:8px" ${canExport ? '' : 'disabled'}>
          👁 צפייה מקדימה (חלון)
        </button>
        <button type="button" class="btn btn-secondary" id="tools-download-report" style="width:100%;margin-bottom:8px" ${canExport ? '' : 'disabled'}>
          💾 הורד כקובץ
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
      <div class="card report-import-card" style="margin:0 0 12px;box-shadow:none">
        <div class="card-title">ייבוא נתונים</div>
        <p class="report-hint">מומלץ: ייבוא מ-Google Sheets · או מקובץ Excel</p>
        <input type="file" id="reports-import-file" accept=".csv,.xlsx,.xls,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" hidden>
        <button type="button" class="btn btn-secondary" id="reports-import-btn" style="width:100%;margin-bottom:8px">
          📥 ייבא קובץ Excel
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="reports-template-btn" style="width:100%">
          הורד קובץ דוגמה
        </button>
      </div>
      <div class="card report-audit-card" style="margin:0;box-shadow:none">
        <div class="card-title">🔍 בדיקת תקינות חישובים</div>
        <p class="report-hint">בודק שאין רישומים יתומים, כפילויות, או פערים אחרי איחוד מוצרים</p>
        <button type="button" class="btn btn-secondary" id="run-audit" style="width:100%;margin-bottom:8px">
          הרץ בדיקת תקינות
        </button>
        <div id="audit-results"></div>
      </div>`;

  container.innerHTML = `
    ${filtersCard}

    ${renderCollapsibleReportSection('tools', 'הפקת דוחות, יבוא ובדיקה', toolsBody, {
    defaultOpen: false,
    className: 'report-tools-section',
  })}`;

  bindFilterEvents(container);
  bindReportCollapse(container);

  const openFullReportPage = () => {
    container.dataset.reportView = 'page';
    renderReports(container);
  };
  const downloadReportFile = () => {
    saveFormattedReport({ fullTitle, ctx, safeLabel, previewHtml });
  };

  container.querySelectorAll('.report-section-view-btn').forEach((btn) => {
    btn.addEventListener('click', openFullReportPage);
  });
  container.querySelectorAll('.report-section-download-btn').forEach((btn) => {
    btn.addEventListener('click', downloadReportFile);
  });
  document.getElementById('tools-download-report')?.addEventListener('click', downloadReportFile);

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

  document.getElementById('open-report-page')?.addEventListener('click', openFullReportPage);

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
      openFullReportPage();
    });
    document.getElementById('preview-save-page')?.addEventListener('click', downloadReportFile);
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
  return { title: 'דוחות', subtitle: 'ייצור · תזרימים · מוצרים · מנות · מנהל · רווח והפסד' };
}
