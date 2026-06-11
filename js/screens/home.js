import {
  getCategories, getProducts, getEntriesForMonth,
  getProductionTotals, getTarget, getEntriesInRange, getProcessLogsForDate,
} from '../db.js';
import { progressBar, pct, progressBadge, formatMoney, currentMonth, monthLabel, todayISO, escapeHtml } from '../utils.js';
import { renderProductionChart } from '../chart.js';

export async function renderHome(container) {
  const period = container.dataset.chartPeriod || 'week';
  const { year, month } = currentMonth();
  const today = todayISO();

  const [categories, products, monthEntries, todayProcessLogs] = await Promise.all([
    getCategories(),
    getProducts(true),
    getEntriesForMonth(year, month),
    getProcessLogsForDate(today),
  ]);

  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const monthTotals = await getProductionTotals(monthEntries, productMap);

  const monthlyTotalTarget = await getTarget('total', null, 'monthly');
  const monthlyPct = pct(monthTotals.total, monthlyTotalTarget);
  const monthlyBadge = progressBadge(monthlyPct);

  let categorySections = '';
  for (const cat of categories) {
    const qty = monthTotals.byCategory[cat.id] || 0;
    const catTarget = await getTarget('category', cat.id, 'monthly');
    const catPct = pct(qty, catTarget);
    const catBadge = progressBadge(catPct);

    const catProducts = products.filter((p) => p.categoryId === cat.id);
    const productLines = catProducts
      .map((p) => {
        const pQty = monthTotals.byProduct[p.id] || 0;
        if (pQty === 0) return '';
        return `<div class="list-item">
          <span class="list-item-name">${p.name}</span>
          <strong>${pQty}</strong>
        </div>`;
      })
      .filter(Boolean)
      .join('');

    categorySections += `
      <div class="card">
        <div class="section-header">
          <span class="category-chip">${cat.name}</span>
          <strong style="font-size:1.1rem;color:var(--primary)">${qty} יח'</strong>
        </div>
        ${catTarget > 0 ? `
          <div style="margin-bottom:10px">
            <span class="badge ${catBadge.cls}">${catBadge.text} · ${catPct}% מהיעד</span>
          </div>
          ${progressBar(qty, catTarget, 'יעד חודשי')}
        ` : ''}
        ${productLines || '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px 0">אין ייצור החודש</p>'}
      </div>`;
  }

  const processSection = todayProcessLogs.length > 0 ? `
    <div class="section-header" style="margin-top:8px">
      <h2>תיעוד תהליכים — היום</h2>
    </div>
    <div class="card process-card">
      ${todayProcessLogs.map((log) => `
        <div class="list-item">
          <div class="list-item-info">
            <div class="list-item-name">${escapeHtml(log.activity)}${log.quantity ? ` · ${log.quantity}` : ''}</div>
            <div class="list-item-meta">
              <span class="category-chip">${escapeHtml(catMap.get(log.categoryId) || '')}</span>
              ${log.notes ? ` · ${escapeHtml(log.notes)}` : ''}
            </div>
          </div>
        </div>`).join('')}
    </div>` : '';

  container.innerHTML = `
    <div class="card">
      <div class="card-title">גרף ייצור מוצרים</div>
      <div class="tabs tabs-wrap" id="chart-tabs">
        <button class="tab ${period === 'day' ? 'active' : ''}" data-period="day">יום</button>
        <button class="tab ${period === 'week' ? 'active' : ''}" data-period="week">שבוע</button>
        <button class="tab ${period === 'month' ? 'active' : ''}" data-period="month">חודש</button>
        <button class="tab ${period === 'year' ? 'active' : ''}" data-period="year">שנה</button>
      </div>
      <div class="chart-wrap">
        <canvas id="production-chart"></canvas>
      </div>
      <p id="chart-summary" class="chart-summary"></p>
    </div>

    <div class="stat-grid">
      <div class="stat-box">
        <div class="stat-value">${monthTotals.total}</div>
        <div class="stat-label">ייצור החודש (יח')</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${formatMoney(monthTotals.totalValue)}</div>
        <div class="stat-label">ערך החודש</div>
      </div>
    </div>

    ${monthlyTotalTarget > 0 ? `
    <div class="card">
      <div class="card-title">יעד חודשי
        <span class="badge ${monthlyBadge.cls}" style="float:left">${monthlyBadge.text}</span>
      </div>
      ${progressBar(monthTotals.total, monthlyTotalTarget, 'התקדמות')}
    </div>` : ''}

    <div class="section-header" style="margin-top:4px">
      <h2>ייצור לפי קטגוריה</h2>
    </div>
    ${categories.length === 0
      ? '<div class="empty-state"><p>הוסף קטגוריות במסך מוצרים</p></div>'
      : categorySections}

    ${processSection}`;

  const allEntries = await getEntriesInRange('2000-01-01', todayISO());
  await renderProductionChart(
    document.getElementById('production-chart'),
    document.getElementById('chart-summary'),
    period,
    allEntries,
    productMap,
    categories
  );

  container.querySelectorAll('#chart-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.dataset.chartPeriod = tab.dataset.period;
      renderHome(container);
    });
  });
}

export function homeMeta() {
  const { year, month } = currentMonth();
  return {
    title: 'מעקב יצור',
    subtitle: monthLabel(year, month),
  };
}
