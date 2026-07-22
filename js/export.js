import {
  computeReportRows,
  computeProcessSummary,
  weekRange,
  monthRange,
  roundMoney,
} from './calc.js?v=341';
import { loadXLSX } from './xlsx-loader.js?v=341';
import { downloadBlob, toastAfterDownload } from './download.js?v=341';

async function writeWorkbook(wb, filename) {
  const XLSX = await loadXLSX();
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob(
    [wbout],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  );
  const method = await downloadBlob(blob, filename);
  return toastAfterDownload(method, 'הדוח מוכן');
}

/** רוחב תצוגה משוער — עברית רחבה יותר מאנגלית */
function displayWidth(value) {
  const s = value == null ? '' : String(value);
  let w = 0;
  for (const ch of s) {
    if (/[\u0590-\u05FF\uFB1D-\uFB4F]/.test(ch)) w += 1.25;
    else if (ch === ' ') w += 0.45;
    else w += 1;
  }
  return w;
}

function cellText(cell) {
  if (!cell) return '';
  if (cell.w != null) return String(cell.w);
  if (cell.v == null) return '';
  if (cell.t === 'd' && cell.v instanceof Date) {
    return cell.v.toISOString().slice(0, 10);
  }
  return String(cell.v);
}

/** התאמת רוחב עמודות + RTL + הקפאת שורת כותרות בטבלאות פירוט */
function formatSheet(XLSX, sheet, { minCol = 10, maxCol = 58, freezeHeader = false } = {}) {
  const ref = sheet['!ref'];
  if (!ref) return;

  const range = XLSX.utils.decode_range(ref);
  const cols = [];

  for (let c = range.s.c; c <= range.e.c; c++) {
    let maxW = minCol;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      maxW = Math.max(maxW, displayWidth(cellText(sheet[addr])) + 2);
    }
    cols.push({ wch: Math.min(maxCol, Math.ceil(maxW)) });
  }
  sheet['!cols'] = cols;

  const views = [{ rightToLeft: true }];
  if (freezeHeader) {
    views[0].state = 'frozen';
    views[0].ySplit = 1;
    views[0].activePane = 'bottomRight';
    const filterEnd = XLSX.utils.encode_cell({ r: range.e.r, c: range.e.c });
    sheet['!autofilter'] = { ref: `A1:${filterEnd}` };
  }
  sheet['!views'] = views;

  const rowHeights = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    let lines = 1;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const text = cellText(sheet[addr]);
      const colW = cols[c - range.s.c]?.wch || minCol;
      lines = Math.max(lines, Math.ceil(displayWidth(text) / Math.max(colW - 1, 8)));
    }
    rowHeights[r] = { hpt: Math.min(72, Math.max(18, lines * 16)) };
  }
  sheet['!rows'] = rowHeights;
}

function formatSummarySheet(XLSX, sheet) {
  formatSheet(XLSX, sheet, { minCol: 14, maxCol: 52, freezeHeader: false });
}

function formatDetailSheet(XLSX, sheet) {
  formatSheet(XLSX, sheet, { minCol: 12, maxCol: 60, freezeHeader: true });
}

function appendProductionSheets(XLSX, wb, { title, periodLabel, entries, categories, products, productMap, catMap }) {
  const { detailRows, summaryRows, totalQty, totalVal, productSummary } = computeReportRows(
    entries, categories, products, productMap, catMap
  );

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['★ דוח ייצור מוצרים סופיים — העיקרי ★'],
    [title],
    [periodLabel],
    [''],
    ['סיכום לפי קטגוריה', 'כמות', 'ערך (₪)'],
    ...summaryRows,
    [''],
    ['סה"כ יחידות', totalQty],
    ['סה"כ ערך (₪)', roundMoney(totalVal)],
    [''],
    ['סיכום לפי מוצר', 'קטגוריה', 'כמות', 'ערך (₪)'],
    ...productSummary.map((r) => [r.name, r.cat, r.qty, roundMoney(r.val)]),
  ]);
  formatSummarySheet(XLSX, summarySheet);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'ייצור — סיכום');

  const detailSheet = XLSX.utils.aoa_to_sheet([
    ['תאריך', 'קטגוריה', 'מוצר', 'כמות', 'ערך (₪)'],
    ...detailRows.map((r) => [r[0], r[1], r[2], r[3], roundMoney(r[4])]),
    [''],
    ['סה"כ', '', '', totalQty, roundMoney(totalVal)],
  ]);
  formatDetailSheet(XLSX, detailSheet);
  XLSX.utils.book_append_sheet(wb, detailSheet, 'ייצור — פירוט');

  return { totalQty, totalVal };
}

function appendProcessSheets(XLSX, wb, { title, periodLabel, processLogs, catMap }) {
  const summary = computeProcessSummary(processLogs, catMap);
  const totalQty = processLogs.reduce((s, l) => s + (l.quantity > 0 ? l.quantity : 0), 0);

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
  formatSummarySheet(XLSX, summarySheet);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'תיעוד — סיכום');

  const detailSheet = XLSX.utils.aoa_to_sheet([
    ['תאריך', 'קטגוריה', 'סוג הכנה', 'כמות', 'הערות'],
    ...detailRows,
  ]);
  formatDetailSheet(XLSX, detailSheet);
  XLSX.utils.book_append_sheet(wb, detailSheet, 'תיעוד — פירוט');
}

export async function exportProductionExcel(params) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  appendProductionSheets(XLSX, wb, params);
  return writeWorkbook(wb, params.filename);
}

export async function exportProcessExcel(params) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  appendProcessSheets(XLSX, wb, params);
  return writeWorkbook(wb, params.filename);
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

  return writeWorkbook(wb, filename);
}

export function summarizeProcessLogs(processLogs, catMap) {
  return computeProcessSummary(processLogs, catMap);
}

export { weekRange, monthRange, computeReportRows, computeProcessSummary };
