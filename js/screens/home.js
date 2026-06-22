import {
  getCategories, getProducts, getEntriesForMonth, getEntriesForDate,
  getProductionTotals, getTarget, getEntriesInRange, getProcessLogsForDate,
  getProcessLogsForMonth, getEntriesForCategory, getCategoryGroups,
  getActiveProductionRuns,
} from '../db.js?v=94';
import {
  progressBar, pct, progressBadge, formatMoney, currentMonth, monthLabel,
  todayISO, formatDateHebrew, escapeHtml, formatDate,
} from '../utils.js?v=94';
import { renderProductionChart, renderCategoryPieChart, defaultColorForIndex } from '../chart.js?v=94';
import {
  buildProductMap, sumCategoryTotals, productProductionValue, mapGetById,
  compareReportProducts,
} from '../calc.js?v=94';

function homeRunTitle(run, catMap, productMap, groupMap) {
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

function homeTimelineSlot(step, role, emptyLabel) {
  const labels = { done: 'הושלם', active: 'פעיל', next: 'הבא' };
  return `
    <div class="home-flow-slot home-flow-slot--${role}${step ? '' : ' home-flow-slot--empty'}">
      <span class="home-flow-slot-role">${labels[role]}</span>
      <span class="home-flow-slot-name">${step ? escapeHtml(step.stepName) : escapeHtml(emptyLabel)}</span>
    </div>`;
}

function buildHomeFlowTimeline(run) {
  const idx = run.currentStepIndex;
  const done = idx > 0 ? run.steps[idx - 1] : null;
  const active = run.steps[idx] || null;
  const next = idx < run.steps.length - 1 ? run.steps[idx + 1] : null;

  return `
    <div class="home-flow-timeline-track">
      ${homeTimelineSlot(done, 'done', 'תחילה')}
      ${homeTimelineSlot(active, 'active', '—')}
      ${homeTimelineSlot(next, 'next', '—')}
    </div>`;
}

function buildActiveFlowsSection(activeRuns, catMap, productMap, groupMap) {
  if (!activeRuns.length) return '';

  return `
    <div class="section-header" style="margin-top:0">
      <h2>תזרימי יצור פעילים</h2>
    </div>
    ${activeRuns.map((run) => `
      <div class="card home-flow-card" data-run-id="${run.id}">
        <div class="home-flow-card-header">
          <div>
            <div class="home-flow-card-title">${run.batchNumber ? `אצווה ${escapeHtml(run.batchNumber)} · ` : ''}${homeRunTitle(run, catMap, productMap, groupMap)}</div>
            <div class="home-flow-card-meta">${runDatesLabel(run)} · שלב ${idxDisplay(run)}</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm home-flow-open" data-run-id="${run.id}" data-run-date="${run.date}">פתח</button>
        </div>
        ${buildHomeFlowTimeline(run)}
      </div>`).join('')}`;
}

function idxDisplay(run) {
  return `${run.currentStepIndex + 1}/${run.steps.length}`;
}

function categoryChipStyle(color, id) {
  const c = color || defaultColorForIndex((Number(id) || 1) - 1);
  return `background:color-mix(in srgb, ${c} 14%, white);color:${c};border:1px solid color-mix(in srgb, ${c} 28%, transparent)`;
}

function parseMonthValue(value) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    const { year, month } = currentMonth();
    return { year, month, iso: `${year}-${String(month).padStart(2, '0')}` };
  }
  const [year, month] = value.split('-').map(Number);
  return { year, month, iso: value };
}

function monthFromDay(dayIso) {
  return dayIso.slice(0, 7);
}

function monthKeyFromDate(iso) {
  return iso?.slice(0, 7) || '';
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthEndIso(year, month) {
  const last = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function sortCategoryHistoryEntries(entries, productMap, categories) {
  return (entries || []).slice().sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    const pa = mapGetById(productMap, a.productId);
    const pb = mapGetById(productMap, b.productId);
    return compareReportProducts(pa || {}, pb || {}, categories);
  });
}

function buildCategoryHistoryHTML(entries, productMap, categories, category) {
  const sorted = sortCategoryHistoryEntries(entries, productMap, categories);
  if (sorted.length === 0) {
    return '<p class="report-empty">אין רישומי ייצור לקטגוריה זו</p>';
  }

  let html = '';
  let lastMonth = '';
  let lastDate = '';

  for (const entry of sorted) {
    const product = mapGetById(productMap, entry.productId);
    const { qty, value } = productProductionValue(product || { id: entry.productId }, { [entry.productId]: entry.quantity });
    const monthKey = monthKeyFromDate(entry.date);

    if (monthKey !== lastMonth) {
      lastMonth = monthKey;
      lastDate = '';
      const [y, m] = monthKey.split('-').map(Number);
      html += `<div class="history-month-divider">${escapeHtml(monthLabel(y, m))}</div>`;
    }

    if (entry.date !== lastDate) {
      lastDate = entry.date;
      html += `<div class="history-date-label">${escapeHtml(formatDateHebrew(entry.date))}</div>`;
    }

    html += `
      <div class="list-item">
        <div class="list-item-info">
          <div class="list-item-name">${escapeHtml(product?.name || 'מוצר לא ידוע')}</div>
          <div class="list-item-meta">${formatDate(entry.date)} · ${qty} יח' · ${formatMoney(value)}</div>
        </div>
      </div>`;
  }

  const byProduct = {};
  for (const entry of sorted) {
    byProduct[entry.productId] = (byProduct[entry.productId] || 0) + entry.quantity;
  }
  const catTotals = sumCategoryTotals(category.id, [...productMap.values()], byProduct);

  return `
    <p class="history-summary">
      סה"כ ${sorted.length} רישומים · ${catTotals.qty} יח' · ${formatMoney(catTotals.value)}
    </p>
    ${html}`;
}

async function renderCategoryHistory(container, categoryId) {
  const [categories, allProducts, entries] = await Promise.all([
    getCategories(),
    getProducts(),
    getEntriesForCategory(categoryId),
  ]);

  const category = categories.find((c) => Number(c.id) === Number(categoryId));
  if (!category) {
    delete container.dataset.homeCategoryHistory;
    return renderHome(container);
  }

  const productMap = buildProductMap(allProducts);
  const body = buildCategoryHistoryHTML(entries, productMap, categories, category);

  document.getElementById('page-title').textContent = category.name;
  document.getElementById('page-subtitle').textContent = 'היסטוריית ייצור';

  container.innerHTML = `
    <button type="button" class="btn btn-secondary btn-sm history-back-btn" id="history-back">← חזרה לבית</button>
    <div class="card history-card">
      <div class="section-header" style="margin-bottom:8px">
        <span class="category-chip" style="${categoryChipStyle(category.color, category.id)}">${escapeHtml(category.name)}</span>
      </div>
      ${body}
    </div>`;

  document.getElementById('history-back')?.addEventListener('click', () => {
    delete container.dataset.homeCategoryHistory;
    renderHome(container);
  });
}

async function buildCategorySections(categories, allProducts, activeProducts, totals, targetPeriod, periodLabel, isDay) {
  let html = '';
  for (const cat of categories) {
    const { qty, value: catValue } = sumCategoryTotals(cat.id, allProducts, totals.byProduct);
    if (qty === 0) continue;
    const catTarget = await getTarget('category', cat.id, targetPeriod);
    const catPct = pct(qty, catTarget);
    const catBadge = progressBadge(catPct);
    const targetLabel = targetPeriod === 'daily' ? 'יעד יומי' : 'יעד חודשי';

    const productLines = activeProducts
      .filter((p) => p.categoryId === cat.id)
      .map((p) => {
        const { qty: pQty, value: pVal } = productProductionValue(p, totals.byProduct);
        if (pQty === 0) return '';
        return `<div class="list-item">
          <span class="list-item-name">${escapeHtml(p.name)}</span>
          <strong>${pQty} · ${formatMoney(pVal)}</strong>
        </div>`;
      })
      .filter(Boolean)
      .join('');

    html += `
      <div class="card home-cat-card" data-cat-id="${cat.id}" role="button" tabindex="0" aria-label="היסטוריית ייצור — ${escapeHtml(cat.name)}">
        <div class="section-header home-cat-header">
          <span class="category-chip" style="${categoryChipStyle(cat.color, cat.id)}">${escapeHtml(cat.name)}</span>
          <div style="text-align:left">
            <strong style="font-size:1.1rem;color:var(--primary);display:block">${qty} יח' · ${formatMoney(catValue)}</strong>
            <span class="home-cat-open-hint">לחץ לצפייה בהיסטוריה ›</span>
          </div>
        </div>
        ${catTarget > 0 ? `
          <div style="margin-bottom:10px">
            <span class="badge ${catBadge.cls}">${catBadge.text} · ${catPct}% מהיעד</span>
          </div>
          ${progressBar(qty, catTarget, targetLabel)}
        ` : ''}
        ${productLines || `<p style="color:var(--text-muted);font-size:0.85rem;padding:8px 0">${periodLabel}</p>`}
      </div>`;
  }
  return html;
}

function buildProcessSection(processLogs, catMap, viewMode, periodLabel) {
  if (processLogs.length === 0) return '';

  const sorted = [...processLogs].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  const renderLog = (log) => `
    <div class="list-item">
      <div class="list-item-info">
        <div class="list-item-name">${escapeHtml(log.activity)}${log.quantity ? ` · ${log.quantity}` : ''}</div>
        <div class="list-item-meta">
          <span class="category-chip">${escapeHtml(catMap.get(log.categoryId) || '')}</span>
          ${log.notes ? ` · ${escapeHtml(log.notes)}` : ''}
        </div>
      </div>
    </div>`;

  if (viewMode === 'day') {
    return `
      <div class="section-header" style="margin-top:8px">
        <h2>תיעוד תהליכים — ${periodLabel}</h2>
      </div>
      <div class="card process-card">${sorted.map(renderLog).join('')}</div>`;
  }

  let body = '';
  let lastDate = '';
  for (const log of sorted) {
    if (log.date !== lastDate) {
      lastDate = log.date;
      body += `<div class="process-date-label">${formatDateHebrew(log.date)}</div>`;
    }
    body += renderLog(log);
  }

  return `
    <div class="section-header" style="margin-top:8px">
      <h2>תיעוד תהליכים — ${periodLabel}</h2>
    </div>
    <div class="card process-card">${body}</div>`;
}

function bindCategoryCardClicks(container) {
  container.querySelectorAll('.home-cat-card').forEach((card) => {
    const open = () => {
      container.dataset.homeCategoryHistory = card.dataset.catId;
      renderHome(container);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });
}

export async function renderHome(container) {
  if (container.dataset.homeCategoryHistory) {
    return renderCategoryHistory(container, container.dataset.homeCategoryHistory);
  }

  const today = todayISO();
  const { year: curY, month: curM } = currentMonth();
  const defaultMonth = `${curY}-${String(curM).padStart(2, '0')}`;

  const viewMode = container.dataset.homeViewMode || 'day';
  const selectedDay = container.dataset.homeDay || today;
  const selectedMonth = parseMonthValue(container.dataset.homeMonth || monthFromDay(selectedDay) || defaultMonth);

  const defaultChartPeriod = viewMode === 'day' ? 'day' : 'month';
  const chartPeriod = container.dataset.chartPeriod || defaultChartPeriod;

  const isDay = viewMode === 'day';
  const periodLabel = isDay
    ? formatDateHebrew(selectedDay)
    : monthLabel(selectedMonth.year, selectedMonth.month);
  const targetPeriod = isDay ? 'daily' : 'monthly';
  const dateInputValue = isDay ? selectedDay : selectedMonth.iso;

  const [categories, allProducts, entries, processLogs, groups, activeRuns] = await Promise.all([
    getCategories(),
    getProducts(),
    isDay
      ? getEntriesForDate(selectedDay)
      : getEntriesForMonth(selectedMonth.year, selectedMonth.month),
    isDay
      ? getProcessLogsForDate(selectedDay)
      : getProcessLogsForMonth(selectedMonth.year, selectedMonth.month),
    getCategoryGroups(),
    getActiveProductionRuns(),
  ]);

  const productMap = buildProductMap(allProducts);
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));
  const activeProducts = allProducts.filter((p) => p.active);
  const totals = await getProductionTotals(entries, productMap);

  const totalTarget = await getTarget('total', null, targetPeriod);
  const totalPct = pct(totals.total, totalTarget);
  const totalBadge = progressBadge(totalPct);
  const targetTitle = isDay ? 'יעד יומי' : 'יעד חודשי';
  const qtyLabel = isDay ? 'ייצור יומי (יח\')' : 'ייצור החודש (יח\')';
  const valueLabel = isDay ? 'ערך יומי' : 'ערך החודש';

  const categorySectionTitle = isDay ? 'ייצור יומי לפי קטגוריה' : 'ייצור חודשי לפי קטגוריה';
  const noProductionHint = isDay ? 'אין ייצור ביום זה' : 'אין ייצור בחודש זה';

  const categorySections = await buildCategorySections(
    categories, allProducts, activeProducts, totals, targetPeriod, periodLabel, isDay
  );

  const processSection = buildProcessSection(processLogs, catMap, viewMode, periodLabel);
  const activeFlowsSection = buildActiveFlowsSection(activeRuns, catMap, productMap, groupMap);

  document.getElementById('page-title').textContent = 'מעקב יצור';
  document.getElementById('page-subtitle').textContent = periodLabel;

  container.innerHTML = `
    <div class="card home-filter-card">
      <div class="tabs home-view-tabs">
        <button type="button" class="tab ${isDay ? 'active' : ''}" data-view="day">יום</button>
        <button type="button" class="tab ${!isDay ? 'active' : ''}" data-view="month">חודש</button>
      </div>
      <div class="form-group home-date-field">
        <label for="home-date">${isDay ? 'תאריך' : 'חודש'}</label>
        <input type="${isDay ? 'date' : 'month'}" id="home-date" value="${dateInputValue}">
      </div>
    </div>

    <p class="stats-block-label">${periodLabel}</p>
    <div class="stat-grid">
      <div class="stat-box ${isDay ? 'stat-box-day' : ''}">
        <div class="stat-value">${totals.total}</div>
        <div class="stat-label">${qtyLabel}</div>
      </div>
      <div class="stat-box ${isDay ? 'stat-box-day' : ''}">
        <div class="stat-value">${formatMoney(totals.totalValue)}</div>
        <div class="stat-label">${valueLabel}</div>
      </div>
    </div>

    ${totalTarget > 0 ? `
    <div class="card">
      <div class="card-title">${targetTitle} · ${periodLabel}
        <span class="badge ${totalBadge.cls}" style="float:left">${totalBadge.text}</span>
      </div>
      ${progressBar(totals.total, totalTarget, 'התקדמות')}
    </div>` : ''}

    <div class="section-header" style="margin-top:4px">
      <h2>${categorySectionTitle} · ${periodLabel}</h2>
    </div>
    ${categories.length === 0
      ? '<div class="empty-state"><p>הוסף קטגוריות במסך מוצרים</p></div>'
      : (categorySections || `<div class="empty-state"><p>${noProductionHint}</p></div>`)}

    ${activeFlowsSection}

    ${processSection}

    <div class="card home-charts-card">
      <div class="card-title">גרף ייצור מוצרים · ${periodLabel}</div>
      <div class="tabs tabs-wrap" id="chart-tabs">
        <button type="button" class="tab ${chartPeriod === 'day' ? 'active' : ''}" data-period="day">יום</button>
        <button type="button" class="tab ${chartPeriod === 'week' ? 'active' : ''}" data-period="week">שבוע</button>
        <button type="button" class="tab ${chartPeriod === 'month' ? 'active' : ''}" data-period="month">חודש</button>
        <button type="button" class="tab ${chartPeriod === 'year' ? 'active' : ''}" data-period="year">שנה</button>
      </div>
      <div class="chart-wrap">
        <canvas id="production-chart"></canvas>
      </div>
      <p id="chart-summary" class="chart-summary"></p>
    </div>

    <div class="card home-charts-card">
      <div class="card-title">דיאגרמת עוגה · ${periodLabel}</div>
      <div class="chart-wrap chart-wrap-pie">
        <canvas id="category-pie-chart"></canvas>
      </div>
      <p id="pie-chart-summary" class="chart-summary"></p>
    </div>

    <div class="card home-backup-card">
      <div class="home-backup-row">
        <div>
          <div class="card-title" style="margin-bottom:4px">💾 גיבוי ושחזור</div>
          <p class="form-hint" style="margin:0">גיבוי אוטומטי · בחירת מיקום · שחזור</p>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="home-open-backup">פתח</button>
      </div>
    </div>`;

  bindCategoryCardClicks(container);

  container.querySelectorAll('.home-flow-open').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const main = document.getElementById('main-content');
      if (btn.dataset.runDate) main.dataset.selectedDate = btn.dataset.runDate;
      main.dataset.view = 'run';
      main.dataset.runId = btn.dataset.runId;
      const { navigate } = await import('../app.js?v=94');
      navigate('process');
    });
  });

  document.getElementById('home-open-backup')?.addEventListener('click', async () => {
    const { navigate } = await import('../app.js?v=94');
    navigate('backup');
  });

  container.querySelectorAll('.home-view-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const next = tab.dataset.view;
      if (next === container.dataset.homeViewMode) return;
      container.dataset.homeViewMode = next;
      container.dataset.chartPeriod = next === 'day' ? 'day' : 'month';
      if (next === 'month' && !container.dataset.homeMonth) {
        container.dataset.homeMonth = monthFromDay(container.dataset.homeDay || today);
      }
      renderHome(container);
    });
  });

  document.getElementById('home-date').addEventListener('change', (e) => {
    if (isDay) {
      container.dataset.homeDay = e.target.value;
      container.dataset.homeMonth = monthFromDay(e.target.value);
    } else {
      container.dataset.homeMonth = e.target.value;
    }
    renderHome(container);
  });

  const anchorDate = isDay
    ? selectedDay
    : `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}-01`;

  let chartFrom;
  let chartTo;
  if (chartPeriod === 'year') {
    const y = isDay ? new Date(selectedDay + 'T12:00:00').getFullYear() : selectedMonth.year;
    chartFrom = `${y}-01-01`;
    chartTo = `${y}-12-31`;
  } else if (chartPeriod === 'month' || (!isDay && chartPeriod !== 'week' && chartPeriod !== 'day')) {
    chartFrom = `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}-01`;
    chartTo = monthEndIso(selectedMonth.year, selectedMonth.month);
  } else if (chartPeriod === 'week') {
    chartTo = isDay ? selectedDay : (monthEndIso(selectedMonth.year, selectedMonth.month) > today
      ? today
      : monthEndIso(selectedMonth.year, selectedMonth.month));
    chartFrom = addDays(chartTo, -6);
  } else {
    chartTo = isDay
      ? selectedDay
      : (() => {
          const end = monthEndIso(selectedMonth.year, selectedMonth.month);
          return end > today ? today : end;
        })();
    chartFrom = chartTo;
  }

  if (chartTo > today) chartTo = today;
  if (chartFrom > chartTo) chartFrom = chartTo;

  const chartEntries = await getEntriesInRange(chartFrom, chartTo);

  await renderProductionChart(
    document.getElementById('production-chart'),
    document.getElementById('chart-summary'),
    chartPeriod,
    chartEntries,
    productMap,
    categories,
    anchorDate
  );

  await renderCategoryPieChart(
    document.getElementById('category-pie-chart'),
    document.getElementById('pie-chart-summary'),
    totals,
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
  return {
    title: 'מעקב יצור',
    subtitle: '',
  };
}
