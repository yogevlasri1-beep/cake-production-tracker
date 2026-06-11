import {
  getCategories, getProducts, getEntriesForDate, getEntriesForMonth,
  getEntriesInRange, getProductionTotals, getProcessLogsInRange,
  getProcessLogsForDate, getProcessLogsForMonth,
} from '../db.js';
import { todayISO, formatDate, formatMoney, currentMonth, showToast, escapeHtml } from '../utils.js';
import {
  exportProductionExcel, exportProcessExcel, exportCombinedExcel,
  summarizeProcessLogs, weekRange, monthRange,
} from '../export.js';

export async function renderReports(container) {
  const mode = container.dataset.mode || 'day';
  const today = todayISO();
  const { year, month } = currentMonth();

  const [categories, products] = await Promise.all([getCategories(), getProducts(true)]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  let from = today;
  let to = today;
  let label = formatDate(today);
  let reportTitle = 'דוח יומי';

  if (mode === 'day') {
    from = container.dataset.selectedDay || today;
    to = from;
    label = formatDate(from);
    reportTitle = 'דוח יומי';
  } else if (mode === 'week') {
    const week = weekRange(today);
    from = week.from;
    to = week.to;
    label = week.label;
    reportTitle = 'דוח שבועי';
  } else if (mode === 'month') {
    const mr = monthRange(year, month);
    from = mr.from;
    to = mr.to;
    label = mr.label;
    reportTitle = 'דוח חודשי';
  }

  const entries = mode === 'day'
    ? await getEntriesForDate(from)
    : mode === 'month'
      ? await getEntriesForMonth(year, month)
      : await getEntriesInRange(from, to);

  const totals = await getProductionTotals(entries, productMap);

  const processLogs = mode === 'day'
    ? await getProcessLogsForDate(from)
    : mode === 'month'
      ? await getProcessLogsForMonth(year, month)
      : await getProcessLogsInRange(from, to);

  const processSummary = summarizeProcessLogs(processLogs, catMap);
  const processTotalQty = processLogs.reduce((s, l) => s + (l.quantity || 0), 0);

  const rows = [];
  for (const p of products) {
    const qty = totals.byProduct[p.id] || 0;
    if (qty === 0 && mode === 'day') continue;
    rows.push({ product: p, qty, value: qty * (p.unitPrice || 0) });
  }
  rows.sort((a, b) => b.qty - a.qty);

  const catSummary = categories.map((c) => ({
    name: c.name,
    qty: totals.byCategory[c.id] || 0,
  })).filter((c) => c.qty > 0);

  const safeLabel = label.replace(/\//g, '-');

  container.innerHTML = `
    <div class="tabs">
      <button class="tab ${mode === 'day' ? 'active' : ''}" data-mode="day">יומי</button>
      <button class="tab ${mode === 'week' ? 'active' : ''}" data-mode="week">שבועי</button>
      <button class="tab ${mode === 'month' ? 'active' : ''}" data-mode="month">חודשי</button>
    </div>

    ${mode === 'day' ? `
      <div class="filter-row">
        <input type="date" id="report-day" value="${from}">
      </div>` : ''}

    <div class="card" style="border-right:3px solid var(--primary)">
      <div class="card-title">ייצור מוצרים סופיים — העיקרי</div>
      <button class="btn btn-primary" id="export-excel" style="width:100%">
        📊 ייצוא דוח ייצור — Excel
      </button>
    </div>

    ${mode === 'month' ? `
    <button class="btn btn-primary" id="export-combined" style="width:100%;margin-bottom:8px">
      📋 דוח חודשי משולב (ייצור + תיעוד)
    </button>` : ''}

    <button class="btn btn-secondary" id="export-process" style="width:100%;margin-bottom:14px">
      📝 דוח תיעוד הכנות — Excel (אישי)
    </button>

    <div class="stat-grid">
      <div class="stat-box">
        <div class="stat-value">${totals.total}</div>
        <div class="stat-label">ייצור מוצרים (יח')</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${formatMoney(totals.totalValue)}</div>
        <div class="stat-label">ערך מוצרים</div>
      </div>
    </div>

    ${catSummary.length > 0 ? `
      <div class="card">
        <div class="card-title">ייצור לפי קטגוריה — ${label}</div>
        ${catSummary.map((c) => `
          <div class="list-item">
            <span class="list-item-name">${c.name}</span>
            <strong>${c.qty}</strong>
          </div>`).join('')}
      </div>` : ''}

    <div class="card">
      <div class="card-title">פירוט מוצרים — ${label}</div>
      ${rows.length === 0
        ? '<p style="color:var(--text-muted);font-size:0.9rem;text-align:center;padding:16px">אין נתונים לתקופה זו</p>'
        : `<table class="report-table">
            <thead><tr><th>מוצר</th><th>קטגוריה</th><th>כמות</th><th>ערך</th></tr></thead>
            <tbody>
              ${rows.map((r) => `<tr>
                <td>${r.product.name}</td>
                <td>${catMap.get(r.product.categoryId) || ''}</td>
                <td>${r.qty}</td>
                <td>${formatMoney(r.value)}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr><td colspan="2">סה"כ</td><td>${totals.total}</td><td>${formatMoney(totals.totalValue)}</td></tr></tfoot>
          </table>`}
    </div>

    <div class="card process-card">
      <div class="card-title">תיעוד הכנות — ${label}</div>
      <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px">לשימושך · לא נכלל בייצור המוצרים${processTotalQty ? ` · סה"כ כמויות: ${processTotalQty}` : ''}</p>
      ${processLogs.length === 0
        ? '<p style="color:var(--text-muted);font-size:0.9rem;text-align:center;padding:12px">אין תיעוד לתקופה זו</p>'
        : `${processSummary.length ? `
          <table class="report-table" style="margin-bottom:12px">
            <thead><tr><th>הכנה</th><th>קטגוריה</th><th>כמות</th></tr></thead>
            <tbody>
              ${processSummary.map((r) => `<tr>
                <td>${escapeHtml(r.activity)}</td>
                <td>${escapeHtml(r.category)}</td>
                <td>${r.qty || '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>` : ''}
          ${processLogs.map((log) => `
          <div class="list-item">
            <div class="list-item-info">
              <div class="list-item-name">${escapeHtml(log.activity)}${log.quantity ? ` · ${log.quantity}` : ''}</div>
              <div class="list-item-meta">${formatDate(log.date)} · ${escapeHtml(catMap.get(log.categoryId) || '')}${log.notes ? ` · ${escapeHtml(log.notes)}` : ''}</div>
            </div>
          </div>`).join('')}`}
    </div>`;

  container.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.dataset.mode = tab.dataset.mode;
      renderReports(container);
    });
  });

  document.getElementById('report-day')?.addEventListener('change', async (e) => {
    container.dataset.selectedDay = e.target.value;
    await renderReports(container);
  });

  document.getElementById('export-excel')?.addEventListener('click', async () => {
    try {
      await exportProductionExcel({
        title: reportTitle,
        periodLabel: label,
        entries,
        categories,
        products,
        productMap,
        catMap,
        filename: `yitzur-mutzar-${mode}-${safeLabel}.xlsx`,
      });
      showToast('דוח ייצור הורד ✓');
    } catch (err) {
      showToast(err.message || 'שגיאה בייצוא');
    }
  });

  document.getElementById('export-process')?.addEventListener('click', async () => {
    try {
      await exportProcessExcel({
        title: `תיעוד הכנות — ${reportTitle}`,
        periodLabel: label,
        processLogs,
        catMap,
        filename: `yitzur-tiud-${mode}-${safeLabel}.xlsx`,
      });
      showToast('דוח תיעוד הורד ✓');
    } catch (err) {
      showToast(err.message || 'שגיאה בייצוא');
    }
  });

  document.getElementById('export-combined')?.addEventListener('click', async () => {
    try {
      await exportCombinedExcel({
        productionTitle: 'דוח ייצור מוצרים סופיים',
        processTitle: 'תיעוד תהליכי הכנה (נספח)',
        periodLabel: label,
        entries,
        categories,
        products,
        productMap,
        catMap,
        processLogs,
        filename: `yitzur-chodshi-${safeLabel}.xlsx`,
      });
      showToast('דוח משולב הורד ✓');
    } catch (err) {
      showToast(err.message || 'שגיאה בייצוא');
    }
  });
}

export function reportsMeta() {
  return { title: 'דוחות', subtitle: 'ייצור מוצרים — העיקרי' };
}
