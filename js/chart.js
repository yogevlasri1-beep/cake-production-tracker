export const CATEGORY_COLORS = [
  'rgba(37, 99, 235, 0.88)',
  'rgba(14, 165, 233, 0.88)',
  'rgba(99, 102, 241, 0.88)',
  'rgba(6, 182, 212, 0.88)',
  'rgba(59, 130, 246, 0.88)',
  'rgba(79, 70, 229, 0.88)',
  'rgba(2, 132, 199, 0.88)',
  'rgba(56, 189, 248, 0.88)',
];

export const CATEGORY_COLOR_HEX = [
  '#2563eb', '#0ea5e9', '#6366f1', '#06b6d4',
  '#3b82f6', '#4f46e5', '#0284c7', '#38bdf8',
  '#ec4899', '#f97316', '#84cc16', '#a855f7',
];

export function defaultColorForIndex(index) {
  return CATEGORY_COLOR_HEX[Math.max(0, index) % CATEGORY_COLOR_HEX.length];
}

export function hexToRgba(hex, alpha = 0.88) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return CATEGORY_COLORS[0];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return CATEGORY_COLORS[0];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function colorForCategory(index) {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

export function categoryChartColor(category, index) {
  const hex = category?.color;
  if (hex && /^#[0-9a-f]{6}$/i.test(hex)) return hexToRgba(hex);
  return colorForCategory(index);
}

let chartInstance = null;
let pieChartInstance = null;

async function loadChartJS() {
  if (window.Chart) return window.Chart;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/chart.umd.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Chart.js failed'));
    document.head.appendChild(s);
  });
  return window.Chart;
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

function monthShort(year, month) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('he-IL', { month: 'short' });
}

function sumEntries(entries) {
  return entries.reduce((s, e) => s + e.quantity, 0);
}

function qtyForCategoryOnDate(entries, productMap, categoryId, dateIso) {
  return entries
    .filter((e) => e.date === dateIso)
    .reduce((sum, e) => {
      const p = productMap.get(e.productId);
      return p?.categoryId === categoryId ? sum + e.quantity : sum;
    }, 0);
}

function buildCategoryDatasets(entries, categories, productMap, slots) {
  return categories.map((cat, i) => ({
    label: cat.name,
    data: slots.map((slot) =>
      slot.dates.reduce((s, iso) => s + qtyForCategoryOnDate(entries, productMap, cat.id, iso), 0)
    ),
    backgroundColor: categoryChartColor(cat, i),
    borderRadius: 4,
    borderSkipped: false,
  }));
}

function todayIsoLocal() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function anchorParts(anchorIso) {
  if (anchorIso && /^\d{4}-\d{2}-\d{2}$/.test(anchorIso)) {
    const d = new Date(anchorIso + 'T12:00:00');
    return { iso: anchorIso, year: d.getFullYear(), month: d.getMonth() + 1 };
  }
  const today = new Date();
  return {
    iso: todayIsoLocal(),
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  };
}

function buildDayData(entries, categories, productMap, anchorIso) {
  const { iso: dateIso } = anchorParts(anchorIso);
  const dayEntries = entries.filter((e) => e.date === dateIso);
  const labels = categories.map((c) => c.name);
  const data = categories.map((cat) => qtyForCategoryOnDate(dayEntries, productMap, cat.id, dateIso));

  return {
    labels,
    datasets: [{
      label: 'כמות ייצור',
      data,
      backgroundColor: categories.map((cat, i) => categoryChartColor(cat, i)),
      borderRadius: 8,
    }],
    summary: `${dayLabel(dateIso)}: ${sumEntries(dayEntries)} יחידות`,
    showLegend: true,
    stacked: false,
  };
}

function buildWeekData(entries, categories, productMap, anchorIso) {
  const { iso: todayIso } = anchorParts(anchorIso);
  const slots = [];
  for (let i = 6; i >= 0; i--) {
    const iso = addDays(todayIso, -i);
    slots.push({ label: dayLabel(iso), dates: [iso] });
  }
  const total = slots.reduce(
    (s, slot) => s + sumEntries(entries.filter((e) => e.date === slot.dates[0])),
    0
  );
  return {
    labels: slots.map((s) => s.label),
    datasets: buildCategoryDatasets(entries, categories, productMap, slots),
    summary: `7 ימים אחרונים: ${total} יחידות`,
    showLegend: categories.length > 1,
    stacked: true,
  };
}

function buildMonthData(entries, categories, productMap, anchorIso) {
  const { year, month } = anchorParts(anchorIso);
  const lastDay = new Date(year, month, 0).getDate();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const slots = [];
  for (let d = 1; d <= lastDay; d++) {
    const iso = `${prefix}-${String(d).padStart(2, '0')}`;
    slots.push({ label: String(d), dates: [iso] });
  }
  const total = sumEntries(entries.filter((e) => e.date.startsWith(prefix)));
  const monthName = new Date(year, month - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  return {
    labels: slots.map((s) => s.label),
    datasets: buildCategoryDatasets(entries, categories, productMap, slots),
    summary: `${monthName}: ${total} יחידות`,
    showLegend: categories.length > 1,
    stacked: true,
  };
}

function buildYearData(entries, categories, productMap, anchorIso) {
  const { year } = anchorParts(anchorIso);
  const slots = [];
  for (let m = 1; m <= 12; m++) {
    const prefix = `${year}-${String(m).padStart(2, '0')}`;
    const days = new Date(year, m, 0).getDate();
    const dates = Array.from({ length: days }, (_, d) =>
      `${prefix}-${String(d + 1).padStart(2, '0')}`
    );
    slots.push({ label: monthShort(year, m), dates });
  }

  const total = sumEntries(entries.filter((e) => e.date.startsWith(String(year))));
  return {
    labels: slots.map((s) => s.label),
    datasets: buildCategoryDatasets(entries, categories, productMap, slots),
    summary: `${year}: ${total} יחידות`,
    showLegend: categories.length > 1,
    stacked: true,
  };
}

export async function renderProductionChart(canvas, summaryEl, period, entries, productMap, categories, anchorDate) {
  if (!canvas) return;

  const Chart = await loadChartJS();
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const activeCategories = categories.length ? categories : [{ id: 0, name: 'כללי' }];

  let chartData;
  if (period === 'day') chartData = buildDayData(entries, activeCategories, productMap, anchorDate);
  else if (period === 'month') chartData = buildMonthData(entries, activeCategories, productMap, anchorDate);
  else if (period === 'year') chartData = buildYearData(entries, activeCategories, productMap, anchorDate);
  else chartData = buildWeekData(entries, activeCategories, productMap, anchorDate);

  if (summaryEl) summaryEl.textContent = chartData.summary;

  const hasData = chartData.datasets.some((ds) => ds.data.some((v) => v > 0));
  if (!hasData && summaryEl) {
    summaryEl.textContent += ' · אין נתונים — התחל תזרים ורשום ייצור בשלב «תיעוד ייצור»';
  }

  chartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: chartData.labels,
      datasets: chartData.datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: chartData.showLegend,
          position: 'bottom',
          labels: { boxWidth: 12, padding: 10, font: { size: 11 } },
        },
      },
      scales: {
        x: { stacked: chartData.stacked },
        y: {
          stacked: chartData.stacked,
          beginAtZero: true,
          ticks: { stepSize: 1 },
          grid: { color: 'rgba(37, 99, 235, 0.08)' },
          title: { display: true, text: 'יחידות', color: '#64748b' },
        },
      },
    },
  });
}

export async function renderCategoryPieChart(canvas, summaryEl, totals, categories) {
  if (!canvas) return;

  const Chart = await loadChartJS();
  if (pieChartInstance) {
    pieChartInstance.destroy();
    pieChartInstance = null;
  }

  const activeCategories = categories.length ? categories : [{ id: 0, name: 'כללי' }];
  const slices = activeCategories
    .map((cat, i) => ({
      name: cat.name,
      qty: totals.byCategory[cat.id] || 0,
      color: categoryChartColor(cat, i),
    }))
    .filter((s) => s.qty > 0);

  const total = slices.reduce((s, x) => s + x.qty, 0);

  if (summaryEl) {
    summaryEl.textContent = total > 0
      ? `סה"כ ${total} יחידות · ${slices.length} קטגוריות`
      : 'אין נתונים — התחל תזרים ורשום ייצור בשלב «תיעוד ייצור»';
  }

  pieChartInstance = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: slices.map((s) => s.name),
      datasets: [{
        data: slices.map((s) => s.qty),
        backgroundColor: slices.map((s) => s.color),
        borderWidth: 2,
        borderColor: '#ffffff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: slices.length > 0,
          position: 'bottom',
          labels: { boxWidth: 12, padding: 10, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const val = ctx.raw || 0;
              const pctVal = total > 0 ? Math.round((val / total) * 100) : 0;
              return `${ctx.label}: ${val} יח' (${pctVal}%)`;
            },
          },
        },
      },
    },
  });
}

export function destroyChart() {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  if (pieChartInstance) {
    pieChartInstance.destroy();
    pieChartInstance = null;
  }
}
