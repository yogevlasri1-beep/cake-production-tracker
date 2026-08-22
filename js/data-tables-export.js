/** ייצוא כל טבלאות הנתונים לקובץ Excel (גיליון לכל טבלה) */

import { exportAllData } from './db.js?v=480';
import { APP_VERSION } from './version.js?v=480';
import { loadXLSX } from './xlsx-loader.js?v=480';
import { downloadBlob, toastAfterDownload } from './download.js?v=480';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_CELL_CHARS = 32000;
const SKIP_KEYS = new Set(['imageDataUrl', 'payloadJson']);

/** שם עברי לגיליון — עד 31 תווים (מגבלת Excel) */
export const DATA_TABLE_LABELS = {
  categoryGroups: 'קבוצות קטגוריה',
  categories: 'קטגוריות',
  products: 'מוצרים',
  productionEntries: 'רישומי ייצור',
  targets: 'יעדים',
  processLogs: 'תיעוד הכנות',
  activityPresets: 'סוגי הכנה',
  flows: 'תזרימי ייצור',
  flowSteps: 'שלבי תזרים',
  flowPortionPresets: 'מנות בתזרים',
  groupPortionPresets: 'מנות בקבוצה',
  portionPresetLinks: 'קישורי מנות',
  portionPresetIngredientSettings: 'מרכיבי מנה',
  groupPreparations: 'הכנות קבוצה',
  checklistTasks: 'משימות צ׳קליסט',
  flowChecklistItems: 'צ׳קליסט בתזרים',
  flowCleaningTasks: 'ניקיון בתזרים',
  productionRuns: 'תהליכי ייצור',
  runStepStates: 'מצבי שלבים',
  productPreparations: 'הכנות מוצר',
  runPreparationChecks: 'בדיקות הכנה',
  runCleaningChecks: 'בדיקות ניקיון',
  managerPlans: 'תוכניות מנהל',
  managerPlanItems: 'פריטי תוכנית מנהל',
  managerTasks: 'משימות מנהל',
  managerIncidents: 'אירועים',
  managerShiftNotes: 'הערות משמרת',
  managerResponsibilityAreas: 'תחומי אחריות',
  managerEmployees: 'עובדים',
  managerDepartments: 'מחלקות',
  departmentCleaningLists: 'רשימות ניקיון',
  departmentCleaningTasks: 'משימות ניקיון',
  recipeGroups: 'קבוצות מתכונים',
  recipeCategories: 'קטגוריות מתכון',
  recipes: 'מתכונים',
  recipeVersions: 'גרסאות מתכון',
  recipeIngredients: 'מרכיבי מתכון',
  recipeProductLinks: 'מתכון-מוצר',
  recipeProductCategoryLinks: 'מתכון-קטגוריה',
  recipeProductGroupLinks: 'מתכון-קבוצה',
  supplierCategories: 'קטגוריות ספקים',
  suppliers: 'ספקים',
  rawMaterials: 'חומרי גלם',
  rawMaterialPriceHistory: 'היסטוריית מחירים',
  supplierShortages: 'חוסרים',
  weeklyProductionPlans: 'תוכניות שבועיות',
  weeklyProductionPlanItems: 'פריטי תוכנית שבוע',
  bakingProfiles: 'פרופילי אפייה',
  bakingProfileProducts: 'אפייה-מוצר',
  bakingProfileScopes: 'היקפי אפייה',
  productRecipeComponents: 'רכיבי מתכון במוצר',
  productPortionComponents: 'רכיבי מנה במוצר',
  productFlowLinks: 'מוצר-תזרים',
  productionMachines: 'מכונות ייצור',
  productionMachineFields: 'שדות מכונה',
  productionMachineProducts: 'מכונה-מוצר',
  productionMachineProductValues: 'ערכי מכונה',
  purchaseCategories: 'קטגוריות רכש',
  purchaseItems: 'פריטי רכש',
  haccpTeamMembers: 'צוות HACCP',
  haccpPlans: 'תוכניות HACCP',
  haccpProductDescriptions: 'תיאור מוצר HACCP',
  haccpIntendedUses: 'שימוש מיועד HACCP',
  haccpFlowSteps: 'שלבי זרימה HACCP',
  haccpFlowVerifications: 'אימות זרימה HACCP',
  haccpHazards: 'סיכונים HACCP',
  haccpCcps: 'נקודות בקרה CCP',
  haccpCriticalLimits: 'גבולות קריטיים',
  haccpMonitoring: 'ניטור HACCP',
  haccpCorrectiveActions: 'פעולות מתקנות',
  haccpVerificationProcs: 'נהלי אימות HACCP',
  haccpDocuments: 'מסמכי HACCP',
  haccpPrpControls: 'בקרות PRP',
  haccpMonitoringLogs: 'יומן ניטור HACCP',
  inventoryBalances: 'יתרות מלאי',
  inventoryMovements: 'תנועות מלאי',
  activeLots: 'לוטים פעילים',
  financeAccountMap: 'סיווג חשבונות כספים',
  financeImports: 'ייבוא כספים',
  financeLines: 'שורות כספים',
  settings: 'הגדרות',
};

const TABLE_ORDER = Object.keys(DATA_TABLE_LABELS);

function truncateCell(text) {
  if (text.length <= MAX_CELL_CHARS) return text;
  return `${text.slice(0, MAX_CELL_CHARS - 1)}…`;
}

export function serializeCell(value, key) {
  if (key && SKIP_KEYS.has(key)) {
    if (value == null || value === '') return '';
    return 'כן';
  }
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'כן' : 'לא';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  if (typeof value === 'string') {
    if (key === 'imageDataUrl' || value.startsWith('data:')) return value ? 'כן' : '';
    return truncateCell(value);
  }
  try {
    return truncateCell(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

export function collectRowKeys(rows) {
  const keys = [];
  const seen = new Set();
  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export function rowsToAoa(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const keys = collectRowKeys(list);
  if (!keys.length) {
    return [['אין שורות בטבלה זו']];
  }
  return [
    keys,
    ...list.map((row) => keys.map((key) => serializeCell(row?.[key], key))),
  ];
}

export function uniqueSheetName(label, used) {
  const cleaned = String(label || 'sheet')
    .replace(/[\\/?*:[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'sheet';
  let name = cleaned.slice(0, 31);
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let i = 2;
  while (i < 1000) {
    const suffix = ` ${i}`;
    const candidate = `${cleaned.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    i += 1;
  }
  const fallback = `sheet ${used.size + 1}`.slice(0, 31);
  used.add(fallback);
  return fallback;
}

export function listDataTables(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const extra = Object.keys(payload).filter((key) => (
    Array.isArray(payload[key]) && !TABLE_ORDER.includes(key)
  ));
  return [...TABLE_ORDER, ...extra].map((key) => ({
    key,
    label: DATA_TABLE_LABELS[key] || key,
    rows: Array.isArray(payload[key]) ? payload[key] : [],
  }));
}

export function buildDataTablesWorkbookSpec(data, { exportedAt, appVersion } = {}) {
  const tables = listDataTables(data);
  const used = new Set();
  const contentsName = uniqueSheetName('תוכן עניינים', used);
  const when = exportedAt || new Date().toLocaleString('he-IL');
  const version = appVersion || APP_VERSION;

  const tableSheets = tables.map((table) => ({
    key: table.key,
    label: table.label,
    rowCount: table.rows.length,
    sheetName: uniqueSheetName(table.label, used),
    aoa: rowsToAoa(table.rows),
  }));

  const contentsAoa = [
    ['טבלאות נתונים — מעקב יצור'],
    ['גרסת אפליקציה', version],
    ['תאריך ייצוא', when],
    ['מספר טבלאות', tableSheets.length],
    ['סה"כ שורות', tableSheets.reduce((sum, t) => sum + t.rowCount, 0)],
    [''],
    ['#', 'שם הטבלה', 'גיליון', 'מפתח', 'מספר שורות'],
    ...tableSheets.map((table, index) => [
      index + 1,
      table.label,
      table.sheetName,
      table.key,
      table.rowCount,
    ]),
  ];

  return [
    { key: '_contents', label: 'תוכן עניינים', sheetName: contentsName, rowCount: tableSheets.length, aoa: contentsAoa },
    ...tableSheets,
  ];
}

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

function formatSheet(XLSX, sheet, { freezeHeader = false } = {}) {
  const ref = sheet['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const cols = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    let maxW = 10;
    const scanTo = Math.min(range.e.r, range.s.r + 80);
    for (let r = range.s.r; r <= scanTo; r++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      const text = cell?.w != null ? String(cell.w) : (cell?.v == null ? '' : String(cell.v));
      maxW = Math.max(maxW, displayWidth(text) + 2);
    }
    cols.push({ wch: Math.min(42, Math.ceil(maxW)) });
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
}

function todayFileStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function exportAllDataTablesExcel() {
  const data = await exportAllData();
  const specs = buildDataTablesWorkbookSpec(data, {
    exportedAt: new Date().toLocaleString('he-IL'),
    appVersion: APP_VERSION,
  });
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  for (const spec of specs) {
    const sheet = XLSX.utils.aoa_to_sheet(spec.aoa);
    formatSheet(XLSX, sheet, { freezeHeader: spec.key !== '_contents' && spec.rowCount > 0 });
    XLSX.utils.book_append_sheet(wb, sheet, spec.sheetName);
  }
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: XLSX_MIME });
  const filename = `yitzur-tables-${todayFileStamp()}.xlsx`;
  const method = await downloadBlob(blob, filename, { shareText: 'טבלאות נתונים — מעקב יצור' });
  const tableCount = specs.length - 1;
  const rowCount = specs.slice(1).reduce((sum, t) => sum + t.rowCount, 0);
  return toastAfterDownload(method, `הקובץ מוכן · ${tableCount} טבלאות · ${rowCount} שורות`);
}
