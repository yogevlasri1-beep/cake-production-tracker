async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('לא ניתן לייצא Excel'));
    document.head.appendChild(s);
  });
  return window.XLSX;
}

function buildReportRows(entries, categories, products, productMap, catMap) {
  const byProduct = {};
  for (const e of entries) {
    byProduct[e.productId] = (byProduct[e.productId] || 0) + e.quantity;
  }

  const detailRows = entries
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.productId - b.productId)
    .map((e) => {
      const p = productMap.get(e.productId);
      if (!p) return null;
      return [
        e.date,
        catMap.get(p.categoryId) || '',
        p.name,
        e.quantity,
        e.quantity * (p.unitPrice || 0),
      ];
    })
    .filter(Boolean);

  const summaryRows = categories.map((c) => {
    const qty = products
      .filter((p) => p.categoryId === c.id)
      .reduce((s, p) => s + (byProduct[p.id] || 0), 0);
    return [c.name, qty];
  }).filter((r) => r[1] > 0);

  const totalQty = detailRows.reduce((s, r) => s + r[3], 0);
  const totalVal = detailRows.reduce((s, r) => s + r[4], 0);

  const productSummary = products
    .map((p) => ({
      cat: catMap.get(p.categoryId) || '',
      name: p.name,
      qty: byProduct[p.id] || 0,
      val: (byProduct[p.id] || 0) * (p.unitPrice || 0),
    }))
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.qty - a.qty);

  return { detailRows, summaryRows, totalQty, totalVal, productSummary };
}

function buildProcessSummary(processLogs, catMap) {
  const map = {};
  for (const log of processLogs) {
    const key = `${log.categoryId}|${log.activity}`;
    if (!map[key]) {
      map[key] = {
        category: catMap.get(log.categoryId) || '',
        activity: log.activity,
        qty: 0,
        count: 0,
      };
    }
    map[key].qty += log.quantity || 0;
    map[key].count += 1;
  }
  return Object.values(map).sort((a, b) => a.category.localeCompare(b.category, 'he'));
}

function appendProductionSheets(XLSX, wb, { title, periodLabel, entries, categories, products, productMap, catMap }) {
  const { detailRows, summaryRows, totalQty, totalVal, productSummary } = buildReportRows(
    entries, categories, products, productMap, catMap
  );

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['★ דוח ייצור מוצרים סופיים — העיקרי ★'],
    [title],
    [periodLabel],
    [''],
    ['סיכום לפי קטגוריה', 'כמות'],
    ...summaryRows,
    [''],
    ['סה"כ יחידות', totalQty],
    ['סה"כ ערך (₪)', Math.round(totalVal * 100) / 100],
    [''],
    ['סיכום לפי מוצר', 'קטגוריה', 'כמות', 'ערך (₪)'],
    ...productSummary.map((r) => [r.name, r.cat, r.qty, Math.round(r.val * 100) / 100]),
  ]);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'ייצור — סיכום');

  const detailSheet = XLSX.utils.aoa_to_sheet([
    ['תאריך', 'קטגוריה', 'מוצר', 'כמות', 'ערך (₪)'],
    ...detailRows.map((r) => [r[0], r[1], r[2], r[3], Math.round(r[4] * 100) / 100]),
    [''],
    ['סה"כ', '', '', totalQty, Math.round(totalVal * 100) / 100],
  ]);
  XLSX.utils.book_append_sheet(wb, detailSheet, 'ייצור — פירוט');

  return { totalQty, totalVal };
}

function appendProcessSheets(XLSX, wb, { title, periodLabel, processLogs, catMap }) {
  const summary = buildProcessSummary(processLogs, catMap);
  const totalQty = processLogs.reduce((s, l) => s + (l.quantity || 0), 0);

  const detailRows = processLogs
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.activity.localeCompare(b.activity, 'he'))
    .map((log) => [
      log.date,
      catMap.get(log.categoryId) || '',
      log.activity,
      log.quantity ?? '',
      log.notes || '',
    ]);

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['תיעוד תהליכי הכנה — לשימוש פנימי'],
    [title],
    [periodLabel],
    ['(לא כולל בדוח ייצור המוצרים)'],
    [''],
    ['קטגוריה', 'סוג הכנה', 'סה"כ כמות', 'מספר רישומים'],
    ...summary.map((r) => [r.category, r.activity, r.qty || '—', r.count]),
    [''],
    ['סה"כ כמויות', totalQty || '—'],
    ['סה"כ רישומים', processLogs.length],
  ]);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'תיעוד — סיכום');

  const detailSheet = XLSX.utils.aoa_to_sheet([
    ['תאריך', 'קטגוריה', 'סוג הכנה', 'כמות', 'הערות'],
    ...detailRows,
  ]);
  XLSX.utils.book_append_sheet(wb, detailSheet, 'תיעוד — פירוט');
}

export async function exportProductionExcel(params) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  appendProductionSheets(XLSX, wb, params);
  XLSX.writeFile(wb, params.filename);
}

export async function exportProcessExcel(params) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  appendProcessSheets(XLSX, wb, params);
  XLSX.writeFile(wb, params.filename);
}

export async function exportCombinedExcel({
  productionTitle,
  processTitle,
  periodLabel,
  entries,
  categories,
  products,
  productMap,
  catMap,
  processLogs,
  filename,
}) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();

  appendProductionSheets(XLSX, wb, {
    title: productionTitle,
    periodLabel,
    entries,
    categories,
    products,
    productMap,
    catMap,
  });

  if (processLogs.length > 0) {
    appendProcessSheets(XLSX, wb, {
      title: processTitle,
      periodLabel,
      processLogs,
      catMap,
    });
  }

  XLSX.writeFile(wb, filename);
}

export function summarizeProcessLogs(processLogs, catMap) {
  return buildProcessSummary(processLogs, catMap);
}

export function weekRange(todayIso) {
  const labels = [];
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayIso + 'T12:00:00');
    d.setDate(d.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dates.push(iso);
    labels.push(d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }));
  }
  return { from: dates[0], to: dates[dates.length - 1], dates, label: `${labels[0]} – ${labels[labels.length - 1]}` };
}

export function monthRange(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
  const d = new Date(year, month - 1, 1);
  return { from, to, label: d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' }) };
}
