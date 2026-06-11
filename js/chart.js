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

export function colorForCategory(index) {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

let chartInstance = null;

async function loadChartJS() {
  if (window.Chart) return window.Chart;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
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
    backgroundColor: colorForCategory(i),
    borderRadius: 4,
    borderSkipped: false,
  }));
}

function buildDayData(entries, categories, productMap) {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayEntries = entries.filter((e) => e.date === todayIso);
  const labels = categories.map((c) => c.name);
  const data = categories.map((cat) => qtyForCategoryOnDate(todayEntries, productMap, cat.id, todayIso));

  return {
    labels,
    datasets: [{
      label: 'כמות ייצור',
      data,
      backgroundColor: categories.map((_, i) => colorForCategory(i)),
      borderRadius: 8,
    }],
    summary: `היום (${dayLabel(todayIso)}): ${sumEntries(todayEntries)} יחידות`,
    showLegend: true,
    stacked: false,
  };
}

function buildWeekData(entries, categories, productMap) {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
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

function buildMonthData(entries, categories, productMap) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
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

function buildYearData(entries, categories, productMap) {
  const year = new Date().getFullYear();
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

export async function renderProductionChart(canvas, summaryEl, period, entries, productMap, categories) {
  if (!canvas) return;

  const Chart = await loadChartJS();
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const activeCategories = categories.length ? categories : [{ id: 0, name: 'כללי' }];

  let chartData;
  if (period === 'day') chartData = buildDayData(entries, activeCategories, productMap);
  else if (period === 'month') chartData = buildMonthData(entries, activeCategories, productMap);
  else if (period === 'year') chartData = buildYearData(entries, activeCategories, productMap);
  else chartData = buildWeekData(entries, activeCategories, productMap);

  if (summaryEl) summaryEl.textContent = chartData.summary;

  const hasData = chartData.datasets.some((ds) => ds.data.some((v) => v > 0));
  if (!hasData && summaryEl) {
    summaryEl.textContent += ' · אין נתונים — רשום ייצור במסך "ייצור"';
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

export function destroyChart() {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
}
