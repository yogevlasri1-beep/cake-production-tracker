/**
 * כספים — שכבת נתונים מקומית בלבד (שלב 1).
 *
 * אין FK לטבלאות ייצור / מוצרים / מתכונים.
 * סנכרון לענן: עדיין לא מחובר ל-SYNC_ORDER. קודם SQL ידני, ורק אז פרסום.
 *
 * כלל סימן (חובה, נאכף בייבוא — לא לפי הסימן בחשבשבת):
 *   הכנסה  → amount חיובי  (+|סכום|)
 *   הוצאה  → amount שלילי  (-|סכום|)
 *   ignore → השורה לא נשמרת
 *   rawRow שומר את הסכום המקורי מהקובץ.
 * סיכום רוו"ה: sum(amount) — חיובי = רווח, שלילי = הפסד.
 * סה"כ הוצאות בדוח: סכום הערכים המוחלטים של שורות הוצאה.
 *
 * periodStart / periodEnd: רק מבורר תאריכים ידני באשף. לא נגזרים מהקובץ.
 *
 * גרעין ייבוא: מאזן בוחן חודשי (~100–300 שורות), לא תנועות בודדות.
 */
import { db, ValidationError } from './db.js?v=477';
import { isValidISODate, sanitizeName } from './validators.js?v=477';

export const FINANCE_BACKUP_KEYS = ['financeAccountMap', 'financeImports', 'financeLines'];

export const FINANCE_IMPORT_GRAIN = 'trial_balance_monthly';
export const FINANCE_IMPORT_SOFT_MAX_LINES = 300;
export const FINANCE_IMPORT_HARD_MAX_LINES = 800;

export const FINANCE_CATEGORIES = {
  materials: 'materials',
  packaging: 'packaging',
  payroll: 'payroll',
  energy: 'energy',
  rent: 'rent',
  freight: 'freight',
  maintenance: 'maintenance',
  admin: 'admin',
  depreciation: 'depreciation',
  income: 'income',
  other: 'other',
  ignore: 'ignore',
};

export const FINANCE_CATEGORY_LABELS = {
  materials: 'חומרי גלם',
  packaging: 'אריזה',
  payroll: 'שכר',
  energy: 'אנרגיה',
  rent: 'שכירות',
  freight: 'הובלות',
  maintenance: 'תחזוקה',
  admin: 'הנהלה',
  depreciation: 'פחת',
  income: 'הכנסות',
  other: 'אחר',
  ignore: 'התעלם',
};

export const FINANCE_BEHAVIORS = {
  fixed: 'fixed',
  variable: 'variable',
};

export const FINANCE_REPORT_TYPES = {
  trial_balance: 'trial_balance',
  payroll: 'payroll',
};

export const FINANCE_SOURCES = {
  hashavshevet: 'hashavshevet',
  payroll: 'payroll',
  other: 'other',
};

const EXPENSE_CATEGORIES = new Set([
  FINANCE_CATEGORIES.materials,
  FINANCE_CATEGORIES.packaging,
  FINANCE_CATEGORIES.payroll,
  FINANCE_CATEGORIES.energy,
  FINANCE_CATEGORIES.rent,
  FINANCE_CATEGORIES.freight,
  FINANCE_CATEGORIES.maintenance,
  FINANCE_CATEGORIES.admin,
  FINANCE_CATEGORIES.depreciation,
  FINANCE_CATEGORIES.other,
]);

export function isFinanceCategory(category) {
  return Object.prototype.hasOwnProperty.call(FINANCE_CATEGORIES, String(category || ''));
}

export function isIncomeCategory(category) {
  return category === FINANCE_CATEGORIES.income;
}

export function isExpenseCategory(category) {
  return EXPENSE_CATEGORIES.has(category);
}

export function isIgnoredCategory(category) {
  return category === FINANCE_CATEGORIES.ignore;
}

export function backupHasFinanceTables(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.__financeBackupPresent === true) return true;
  if (payload.__financeBackupPresent === false) return false;
  return FINANCE_BACKUP_KEYS.every(
    (key) => Object.prototype.hasOwnProperty.call(payload, key) && Array.isArray(payload[key]),
  );
}

export function parseFinanceAmount(raw) {
  if (raw === '' || raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim().replace(/[\s\u00a0]/g, '').replace(/[₪$€]/g, '');
  if (!s) return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function roundMoney2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * מחיל את כלל הסימן: הכנסה +, הוצאה −, לפי קטגוריה ולא לפי סימן הקובץ.
 * מחזיר null לקטגוריית ignore.
 */
export function signedAmountForCategory(category, rawAmount) {
  if (isIgnoredCategory(category)) return null;
  if (!isFinanceCategory(category)) {
    throw new ValidationError('קטגוריית חשבון לא תקינה');
  }
  const raw = parseFinanceAmount(rawAmount);
  if (raw == null) throw new ValidationError('סכום לא תקין');
  const magnitude = roundMoney2(Math.abs(raw));
  if (isIncomeCategory(category)) return magnitude;
  if (isExpenseCategory(category)) return -magnitude;
  throw new ValidationError('קטגוריית חשבון לא תקינה');
}

/** תקופה רק מבורר ידני. אף פעם לא מתאריך שנקרא מהקובץ. */
export function requireManualPeriod(periodStart, periodEnd) {
  if (!isValidISODate(periodStart) || !isValidISODate(periodEnd)) {
    throw new ValidationError(
      'יש לבחור תחילת תקופה וסוף תקופה בבורר התאריכים. התקופה לא נגזרת מהקובץ.',
    );
  }
  if (periodStart > periodEnd) {
    throw new ValidationError('תחילת התקופה מאוחרת מסופה');
  }
  return { periodStart, periodEnd };
}

export function assertImportLineBudget(rowCount) {
  const n = Number(rowCount);
  if (!Number.isInteger(n) || n < 0) {
    throw new ValidationError('מספר שורות לא תקין');
  }
  if (n > FINANCE_IMPORT_HARD_MAX_LINES) {
    throw new ValidationError(
      `ייבוא כספים הוא ברמת מאזן בוחן חודשי (עד ${FINANCE_IMPORT_HARD_MAX_LINES} שורות), לא ברמת תנועה בודדת`,
    );
  }
  return n;
}

export function incomeTotal(signedAmounts) {
  return roundMoney2(
    (signedAmounts || []).reduce((sum, amount) => (amount > 0 ? sum + amount : sum), 0),
  );
}

export function expenseTotal(signedAmounts) {
  return roundMoney2(
    (signedAmounts || []).reduce((sum, amount) => (amount < 0 ? sum + -amount : sum), 0),
  );
}

export function profitTotal(signedAmounts) {
  return roundMoney2((signedAmounts || []).reduce((sum, amount) => sum + Number(amount || 0), 0));
}

function sanitizeAccountCode(raw) {
  const code = String(raw ?? '').trim();
  if (!code || code.length > 40) return null;
  return code;
}

function sanitizeFinanceCategory(raw) {
  const category = String(raw || '').trim();
  return isFinanceCategory(category) ? category : null;
}

function sanitizeBehavior(raw) {
  const behavior = String(raw || '').trim();
  return FINANCE_BEHAVIORS[behavior] ? behavior : null;
}

function sanitizeReportType(raw) {
  const reportType = String(raw || '').trim();
  return FINANCE_REPORT_TYPES[reportType] ? reportType : null;
}

function sanitizeSource(raw) {
  const source = String(raw || '').trim();
  return FINANCE_SOURCES[source] ? source : FINANCE_SOURCES.other;
}

export async function upsertFinanceAccount({
  accountCode,
  accountName = '',
  category,
  behavior,
} = {}) {
  const code = sanitizeAccountCode(accountCode);
  if (!code) throw new ValidationError('קוד חשבון לא תקין');
  const cat = sanitizeFinanceCategory(category);
  if (!cat) throw new ValidationError('קטגוריית חשבון לא תקינה');
  const beh = sanitizeBehavior(behavior);
  if (!beh) throw new ValidationError('יש לבחור התנהגות: קבוע או משתנה');
  const name = sanitizeName(accountName, 120) || '';
  const existing = await db.financeAccountMap.where('accountCode').equals(code).first();
  const row = {
    accountCode: code,
    accountName: name,
    category: cat,
    behavior: beh,
  };
  if (existing) {
    await db.financeAccountMap.update(existing.id, row);
    return existing.id;
  }
  return db.financeAccountMap.add(row);
}

export async function replaceFinanceImportBatch({
  source,
  reportType,
  periodStart,
  periodEnd,
  fileName = '',
  columnMapping = {},
  lines = [],
} = {}) {
  const period = requireManualPeriod(periodStart, periodEnd);
  const type = sanitizeReportType(reportType);
  if (!type) throw new ValidationError('סוג דוח לא תקין');
  assertImportLineBudget(lines.length);

  const prepared = [];
  for (const line of lines) {
    const code = sanitizeAccountCode(line.accountCode);
    if (!code) throw new ValidationError('קוד חשבון חסר בשורת ייבוא');
    const category = sanitizeFinanceCategory(line.category);
    if (!category) throw new ValidationError(`חסר סיווג לחשבון ${code}`);
    const amount = signedAmountForCategory(category, line.amount);
    if (amount == null) continue;
    prepared.push({
      accountCode: code,
      accountName: sanitizeName(line.accountName, 120) || '',
      amount,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      rawRow: line.rawRow && typeof line.rawRow === 'object' ? line.rawRow : { amount: line.amount },
    });
  }
  assertImportLineBudget(prepared.length);

  return db.transaction('rw', db.financeImports, db.financeLines, async () => {
    const existing = await db.financeImports
      .where('[reportType+periodStart+periodEnd]')
      .equals([type, period.periodStart, period.periodEnd])
      .toArray();
    for (const row of existing) {
      await db.financeLines.where('importId').equals(row.id).delete();
      await db.financeImports.delete(row.id);
    }
    const importId = await db.financeImports.add({
      source: sanitizeSource(source),
      reportType: type,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      importedAt: new Date().toISOString(),
      fileName: sanitizeName(fileName, 180) || '',
      rowCount: prepared.length,
      columnMapping: columnMapping && typeof columnMapping === 'object' ? columnMapping : {},
    });
    if (prepared.length) {
      await db.financeLines.bulkAdd(prepared.map((line) => ({ ...line, importId })));
    }
    return { importId, rowCount: prepared.length, replaced: existing.length };
  });
}
