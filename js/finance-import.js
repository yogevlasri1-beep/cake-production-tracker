/**
 * אשף ייבוא כספים — פענוח קובץ ומיפוי עמודות.
 * לא מפענח פורמט קשיח של חשבשבת. התקופה לא נגזרת מהקובץ.
 */
import { getSetting, setSetting, ValidationError } from './db.js?v=485';
import { loadXLSX } from './xlsx-loader.js?v=485';
import {
  FINANCE_REPORT_TYPES,
  parseFinanceAmount,
  requireManualPeriod,
  listFinanceAccountMap,
  upsertFinanceAccount,
  replaceFinanceImportBatch,
  signedAmountForCategory,
  isIgnoredCategory,
} from './finance-db.js?v=485';

export const FINANCE_COLUMN_ROLES = {
  accountCode: 'accountCode',
  accountName: 'accountName',
  amount: 'amount',
  date: 'date',
  description: 'description',
  ignore: 'ignore',
};

export const FINANCE_COLUMN_ROLE_LABELS = {
  accountCode: 'קוד חשבון',
  accountName: 'שם חשבון',
  amount: 'סכום',
  date: 'תאריך (רק ב-rawRow)',
  description: 'תיאור',
  ignore: 'התעלם',
};

export const FINANCE_ENCODINGS = {
  utf8: 'utf-8',
  windows1255: 'windows-1255',
};

const COLUMN_MAP_SETTING = 'financeColumnMappingByReportType';

const ROLE_ALIASES = {
  accountCode: ['קוד חשבון', 'קודחשבון', 'מספר חשבון', 'חשבון', 'קוד', 'account', 'account code', 'code'],
  accountName: ['שם חשבון', 'שםחשבון', 'שם', 'תיאור חשבון', 'account name', 'name'],
  amount: ['סכום', 'יתרה', 'יתרת חובה', 'יתרת זכות', 'amount', 'balance', 'חובה', 'זכות'],
  date: ['תאריך', 'date', 'תקופה'],
  description: ['תיאור', 'פרטים', 'description', 'אסמכתא', 'הערה'],
};

function normHeader(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('he')
    .replace(/["״'`]/g, '')
    .replace(/\s+/g, ' ');
}

export function decodeFinanceBytes(bytes, encoding) {
  return new TextDecoder(encoding).decode(bytes);
}

export function detectCsvEncoding(bytes) {
  const utf8 = decodeFinanceBytes(bytes, FINANCE_ENCODINGS.utf8);
  let win = utf8;
  try {
    win = decodeFinanceBytes(bytes, FINANCE_ENCODINGS.windows1255);
  } catch {
    return FINANCE_ENCODINGS.utf8;
  }
  const hebrewCount = (text) => (String(text).match(/[\u0590-\u05FF]/g) || []).length;
  const replacementCount = (text) => (String(text).match(/\uFFFD/g) || []).length;
  if (replacementCount(utf8) > 0 && hebrewCount(win) > hebrewCount(utf8)) {
    return FINANCE_ENCODINGS.windows1255;
  }
  if (hebrewCount(win) > hebrewCount(utf8) + 3) {
    return FINANCE_ENCODINGS.windows1255;
  }
  return FINANCE_ENCODINGS.utf8;
}

function splitCsvLine(line, delim) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsvText(text) {
  const cleaned = String(text || '').replace(/^\uFEFF/, '');
  const lines = cleaned.split(/\r?\n/);
  const sample = lines.slice(0, 8).join('\n');
  const comma = (sample.match(/,/g) || []).length;
  const tab = (sample.match(/\t/g) || []).length;
  const delim = tab > comma ? '\t' : ',';
  return lines
    .map((line) => splitCsvLine(line, delim).map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.some((cell) => cell !== ''));
}

export function previewRows(rows, limit = 20) {
  return (rows || []).slice(0, Math.max(0, Number(limit) || 0));
}

export function guessColumnMapping(headerRow = []) {
  const mapping = {};
  const used = new Set();
  headerRow.forEach((cell, idx) => {
    const header = normHeader(cell);
    if (!header) {
      mapping[idx] = FINANCE_COLUMN_ROLES.ignore;
      return;
    }
    let found = FINANCE_COLUMN_ROLES.ignore;
    for (const [role, aliases] of Object.entries(ROLE_ALIASES)) {
      if (used.has(role)) continue;
      if (aliases.some((alias) => header === alias || header.includes(alias))) {
        found = role;
        used.add(role);
        break;
      }
    }
    mapping[idx] = found;
  });
  return mapping;
}

export function mergeColumnMappingByReportType(existing, reportType, mapping) {
  const type = FINANCE_REPORT_TYPES[reportType] ? reportType : FINANCE_REPORT_TYPES.trial_balance;
  return { ...(existing && typeof existing === 'object' ? existing : {}), [type]: mapping };
}

export async function getSavedFinanceColumnMapping(reportType) {
  const all = await getSetting(COLUMN_MAP_SETTING);
  const type = FINANCE_REPORT_TYPES[reportType] ? reportType : FINANCE_REPORT_TYPES.trial_balance;
  const mapping = all && typeof all === 'object' ? all[type] : null;
  return mapping && typeof mapping === 'object' ? mapping : null;
}

export async function saveFinanceColumnMapping(reportType, mapping) {
  const all = await getSetting(COLUMN_MAP_SETTING);
  const next = mergeColumnMappingByReportType(all, reportType, mapping);
  await setSetting(COLUMN_MAP_SETTING, next);
  return next;
}

export function extractMappedLines(rows, startRow, columnMapping) {
  const list = Array.isArray(rows) ? rows : [];
  const start = Math.max(0, Number(startRow) || 0);
  const headers = start > 0 ? (list[start - 1] || []) : [];
  const lines = [];
  for (let i = start; i < list.length; i += 1) {
    const row = list[i] || [];
    const mapped = {};
    const rawRow = {};
    row.forEach((cell, idx) => {
      const role = columnMapping?.[idx] ?? columnMapping?.[String(idx)] ?? FINANCE_COLUMN_ROLES.ignore;
      const header = String(headers[idx] ?? '').trim();
      rawRow[header || `col${idx}`] = cell;
      if (role && role !== FINANCE_COLUMN_ROLES.ignore) mapped[role] = cell;
    });
    const accountCode = String(mapped.accountCode ?? '').trim();
    const amount = parseFinanceAmount(mapped.amount);
    if (!accountCode && amount == null) continue;
    lines.push({
      accountCode,
      accountName: String(mapped.accountName ?? '').trim(),
      amount: mapped.amount,
      date: mapped.date,
      description: mapped.description,
      rawRow,
    });
  }
  return lines;
}

export function uniqueAccountsFromLines(lines) {
  const map = new Map();
  for (const line of lines || []) {
    const code = String(line.accountCode || '').trim();
    if (!code) continue;
    if (!map.has(code)) {
      map.set(code, { accountCode: code, accountName: String(line.accountName || '').trim() });
    }
  }
  return [...map.values()];
}

export function mappingHasRequiredRoles(columnMapping) {
  const roles = Object.values(columnMapping || {});
  return roles.includes(FINANCE_COLUMN_ROLES.accountCode) && roles.includes(FINANCE_COLUMN_ROLES.amount);
}

function sheetToRows(XLSX, sheet) {
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  return aoa.map((row) => (Array.isArray(row) ? row : []).map((cell) => {
    if (cell == null) return '';
    return cell;
  }));
}

export async function parseFinanceSpreadsheet(file, { encoding } = {}) {
  if (!file) throw new ValidationError('לא נבחר קובץ');
  const name = file.name || 'file';
  const isCsv = /\.csv$/i.test(name) || String(file.type || '').includes('csv');
  if (isCsv) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectCsvEncoding(bytes);
    const enc = encoding || detected;
    const text = decodeFinanceBytes(bytes, enc);
    const rows = parseCsvText(text);
    return {
      fileName: name,
      encoding: enc,
      detectedEncoding: detected,
      sheetName: name,
      sheets: [name],
      rows,
    };
  }
  const XLSX = await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheets = wb.SheetNames || [];
  if (!sheets.length) throw new ValidationError('הקובץ לא מכיל גיליונות');
  const sheetName = sheets[0];
  const bySheet = {};
  for (const s of sheets) {
    bySheet[s] = sheetToRows(XLSX, wb.Sheets[s]);
  }
  return {
    fileName: name,
    encoding: FINANCE_ENCODINGS.utf8,
    detectedEncoding: FINANCE_ENCODINGS.utf8,
    sheetName,
    sheets,
    rows: bySheet[sheetName] || [],
    bySheet,
  };
}

export async function commitFinanceImport({
  source,
  reportType,
  periodStart,
  periodEnd,
  fileName,
  columnMapping,
  lines,
  classifications,
} = {}) {
  requireManualPeriod(periodStart, periodEnd);
  if (!mappingHasRequiredRoles(columnMapping)) {
    throw new ValidationError('יש למפות עמודות לקוד חשבון ולסכום');
  }
  const classMap = classifications && typeof classifications === 'object' ? classifications : {};
  for (const line of lines || []) {
    const code = String(line.accountCode || '').trim();
    if (!code) throw new ValidationError('יש שורה בלי קוד חשבון');
    const cls = classMap[code];
    if (!cls?.category) throw new ValidationError(`חסר סיווג לחשבון ${code}`);
  }

  const existing = await listFinanceAccountMap();
  const existingByCode = new Map(existing.map((row) => [row.accountCode, row]));
  for (const [code, cls] of Object.entries(classMap)) {
    if (isIgnoredCategory(cls.category)) continue;
    const prev = existingByCode.get(code);
    await upsertFinanceAccount({
      accountCode: code,
      accountName: cls.accountName || prev?.accountName || '',
      category: cls.category,
      behavior: cls.behavior || prev?.behavior || 'variable',
    });
  }

  const prepared = [];
  for (const line of lines || []) {
    const cls = classMap[line.accountCode];
    if (isIgnoredCategory(cls.category)) continue;
    signedAmountForCategory(cls.category, line.amount);
    prepared.push({
      ...line,
      category: cls.category,
    });
  }

  return replaceFinanceImportBatch({
    source,
    reportType,
    periodStart,
    periodEnd,
    fileName,
    columnMapping,
    lines: prepared,
  });
}
