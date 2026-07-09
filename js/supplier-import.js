import { loadXLSX } from './xlsx-loader.js?v=275';
import { todayISO } from './utils.js?v=275';

const MATERIAL_ALIASES = ['חומר גלם', 'חומר', 'מוצר', 'material', 'שם', 'פריט', 'תיאור'];
const SUPPLIER_ALIASES = ['ספק', 'supplier', 'שם ספק'];
const PRICE_ALIASES = ['מחיר', 'price', 'עלות', 'תמחור'];
const DATE_ALIASES = ['תאריך', 'date', 'יום', 'מתאריך', 'עודכן'];
const UNIT_ALIASES = ['יחידה', 'unit', 'יח', 'כמות'];
const CATEGORY_ALIASES = ['קטגוריה', 'category', 'סוג'];
const WEIGHT_ALIASES = ['משקל', 'weight', 'גרם', 'משקל מוצר', 'package weight', 'משקל אריזה'];
const QTY_WEEKLY_ALIASES = ['כמות שבועית', 'כמות', 'אריזה'];

function cleanCell(val) {
  if (val == null) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, '0')}-${String(val.getDate()).padStart(2, '0')}`;
  }
  return String(val).trim().replace(/[\u200e\u200f\ufeff\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parsePrice(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).replace(/[₪,\s]/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function parsePackageWeightGrams(raw) {
  if (raw == null || raw === '') return null;
  const s = cleanCell(raw).replace(/,/g, '');
  if (!s) return null;

  const kgMatch = s.match(/^([\d.]+)\s*(?:ק"ג|ק״ג|קג|kg|קילו)/i);
  if (kgMatch) {
    const n = Number(kgMatch[1]);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
  }

  const gMatch = s.match(/^([\d.]+)\s*(?:גרם|gr|g|ג'|ג׳)/i);
  if (gMatch) {
    const n = Number(gMatch[1]);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  const n = Number(s.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (/גרם|gr|g|ג'|ג׳/i.test(s) || n >= 100) return Math.round(n);
  if (n < 50) return Math.round(n * 1000);
  return Math.round(n);
}

export function parseEffectiveDate(raw) {
  if (!raw && raw !== 0) return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s = cleanCell(raw);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }

  m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum > 30000 && asNum < 60000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + asNum * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function headerKey(cell) {
  const c = cleanCell(cell).toLowerCase();
  if (!c) return null;
  const match = (aliases) => aliases.some((a) => c === a.toLowerCase() || c.includes(a.toLowerCase()));
  if (match(MATERIAL_ALIASES)) return 'material';
  if (match(SUPPLIER_ALIASES)) return 'supplier';
  if (match(PRICE_ALIASES)) return 'price';
  if (match(DATE_ALIASES)) return 'date';
  if (match(UNIT_ALIASES)) return 'unit';
  if (match(CATEGORY_ALIASES)) return 'category';
  if (match(WEIGHT_ALIASES)) return 'weight';
  return null;
}

function looksLikeDateHeader(cell) {
  return !!parseEffectiveDate(cell) || /^\d{1,2}[./]\d{1,2}/.test(cleanCell(cell));
}

function looksLikeSupplierName(cell) {
  const t = cleanCell(cell);
  if (!t || t.length < 2) return false;
  if (parsePrice(t) != null && !/[א-תa-z]/i.test(t)) return false;
  if (looksLikeDateHeader(t)) return false;
  if (/^(חומר|מחיר|תאריך|יחידה|קטגוריה|מוצר|כמות)/i.test(t)) return false;
  return /[א-תa-z]/i.test(t);
}

export function isSkipSheetName(name) {
  const n = cleanCell(name).toLowerCase();
  if (!n) return true;
  if (/^sheet\d*$/i.test(n)) return true;
  if (n === 'גיליון1' || n === 'גיליון' || n === 'sheet1') return true;
  return false;
}

export function parseQuantityUnit(raw) {
  const s = cleanCell(raw);
  if (!s) return { unit: 'ק"ג', packageWeightGrams: null };
  let unit = 'ק"ג';
  if (/קרטון/i.test(s)) unit = 'קרטון';
  else if (/שק/i.test(s)) unit = 'שק';
  else if (/ליטר/i.test(s)) unit = 'ליטר';
  const packageWeightGrams = parsePackageWeightGrams(s);
  return { unit, packageWeightGrams };
}

function isMaterialColumnHeader(cell) {
  const a = cleanCell(cell).toLowerCase();
  if (!a) return false;
  if (a === 'מוצר' || a.startsWith('מוצר')) return true;
  return headerKey(cell) === 'material';
}

function looksLikeMaterialName(cell) {
  const s = cleanCell(cell);
  if (!s || s.length < 2) return false;
  if (/^(סה|total|סך|סה"כ|מחיר|מוצר|חומר|כמות)/i.test(s)) return false;
  if (!/[א-תa-z]/i.test(s)) return false;
  if (parseEffectiveDate(s) && !/[א-ת]{2,}/.test(s)) return false;
  if (parsePrice(s) != null && !/[א-ת]{2,}/.test(s)) return false;
  return true;
}

function findSheetLevelDate(rows, nameCol, beforeRow = 8) {
  for (let ri = 0; ri < Math.min(rows.length, beforeRow); ri++) {
    const row = rows[ri] || [];
    const name = cleanCell(row[nameCol]);
    if (looksLikeMaterialName(name)) continue;
    for (let c = 0; c < row.length; c++) {
      const d = parseEffectiveDate(row[c]);
      if (d) return d;
    }
  }
  return null;
}

function scoreHeaderlessNameColumn(rows, nameCol) {
  let score = 0;
  let priceStartCol = -1;
  for (let ri = 0; ri < Math.min(rows.length, 40); ri++) {
    const row = rows[ri] || [];
    const name = cleanCell(row[nameCol]);
    if (!looksLikeMaterialName(name)) continue;
    for (let c = nameCol + 1; c < row.length; c++) {
      const price = parsePrice(row[c]);
      if (price == null) continue;
      if (priceStartCol === -1) priceStartCol = c;
      if (c === priceStartCol) {
        score += 1;
        break;
      }
    }
  }
  return { score, priceStartCol };
}

/** פורמט ללא כותרות: שם בטור B (או A) + מחירים — הכל לפי ק"ג */
export function detectHeaderlessPriceListFormat(rows) {
  if (detectSupplierSheetFormat(rows)) return null;

  let best = null;
  for (const nameCol of [0, 1]) {
    const { score, priceStartCol } = scoreHeaderlessNameColumn(rows, nameCol);
    if (priceStartCol < 0 || score < 2) continue;
    if (!best || score > best.score) {
      best = {
        nameCol,
        priceStartCol,
        score,
        sheetDate: findSheetLevelDate(rows, nameCol) || todayISO(),
      };
    }
  }
  return best;
}

export function parseHeaderlessPriceListRows(rows, supplierName, meta) {
  const entries = [];
  const supplier = cleanCell(supplierName);
  if (!supplier || !meta) return entries;

  const baseUnit = { unit: 'ק"ג', packageWeightGrams: 1000 };
  const sheetDate = meta.sheetDate || todayISO();

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri] || [];
    const materialName = cleanCell(row[meta.nameCol]);
    if (!looksLikeMaterialName(materialName)) continue;

    const base = {
      materialName,
      supplierName: supplier,
      ...baseUnit,
      categoryName: '',
    };

    const prices = [];
    for (let c = meta.priceStartCol; c < row.length; c++) {
      const price = parsePrice(row[c]);
      if (price != null) prices.push(price);
    }

    if (!prices.length) {
      entries.push({ ...base, price: null, effectiveDate: sheetDate });
      continue;
    }

    entries.push({ ...base, price: prices[0], effectiveDate: todayISO() });
    for (let i = 1; i < prices.length; i++) {
      entries.push({ ...base, price: prices[i], effectiveDate: sheetDate });
    }
  }
  return entries;
}

/** פורמט: גיליון לכל ספק — מוצר | כמות | מחיר נוכחי | מחיר+תאריך... */
export function detectSupplierSheetFormat(rows) {
  for (let ri = 0; ri < Math.min(rows.length, 25); ri++) {
    if (isMaterialColumnHeader(rows[ri]?.[0])) {
      return { headerRowIndex: ri };
    }
  }
  return null;
}

function parseSheetHistoryEntries(row, base) {
  const historyEntries = [];
  for (let c = 3; c < row.length; c += 2) {
    const price = parsePrice(row[c]);
    if (price == null) continue;
    const date = parseEffectiveDate(row[c + 1]) || todayISO();
    historyEntries.push({ ...base, price, effectiveDate: date });
  }
  return historyEntries;
}

export function parseSupplierSheetRows(rows, supplierName, meta) {
  const entries = [];
  const supplier = cleanCell(supplierName);
  if (!supplier || !meta) return entries;

  for (let ri = meta.headerRowIndex + 1; ri < rows.length; ri++) {
    const row = rows[ri] || [];
    const materialName = cleanCell(row[0]);
    if (!materialName || /^(סה|total|סך|סה"כ)/i.test(materialName)) continue;

    const { unit, packageWeightGrams } = parseQuantityUnit(row[1]);
    const base = {
      materialName,
      supplierName: supplier,
      unit,
      packageWeightGrams,
      categoryName: '',
    };

    const historyEntries = parseSheetHistoryEntries(row, base);
    const currentPrice = parsePrice(row[2]);

    if (currentPrice != null) {
      entries.push({ ...base, price: currentPrice, effectiveDate: todayISO() });
    } else if (historyEntries.length) {
      const latest = historyEntries.reduce((best, e) => (
        e.effectiveDate >= best.effectiveDate ? e : best
      ));
      entries.push({ ...base, price: latest.price, effectiveDate: todayISO() });
    }

    entries.push(...historyEntries);

    if (currentPrice == null && !historyEntries.length) {
      entries.push({ ...base, price: null, effectiveDate: todayISO() });
    }
  }
  return entries;
}

function detectLongFormat(rows) {
  for (let ri = 0; ri < Math.min(rows.length, 5); ri++) {
    const headers = (rows[ri] || []).map(headerKey);
    if (headers.includes('material') && headers.includes('supplier') && headers.includes('price')) {
      return { headerRow: ri, columns: headers };
    }
  }
  return null;
}

function parseLongFormat(rows, meta) {
  const entries = [];
  for (let ri = meta.headerRow + 1; ri < rows.length; ri++) {
    const row = rows[ri] || [];
    const materialName = cleanCell(row[meta.columns.indexOf('material')]);
    const supplierName = cleanCell(row[meta.columns.indexOf('supplier')]);
    const priceCol = meta.columns.indexOf('price');
    const price = priceCol >= 0 ? parsePrice(row[priceCol]) : null;
    if (!materialName || !supplierName) continue;
    entries.push({
      materialName,
      supplierName,
      price,
      effectiveDate: meta.columns.includes('date')
        ? parseEffectiveDate(row[meta.columns.indexOf('date')]) || todayISO()
        : todayISO(),
      unit: meta.columns.includes('unit')
        ? cleanCell(row[meta.columns.indexOf('unit')]) || 'ק"ג'
        : 'ק"ג',
      categoryName: meta.columns.includes('category')
        ? cleanCell(row[meta.columns.indexOf('category')]) || ''
        : '',
      packageWeightGrams: meta.columns.includes('weight')
        ? parsePackageWeightGrams(row[meta.columns.indexOf('weight')])
        : null,
    });
  }
  return entries;
}

function parseWideMatrix(rows) {
  if (rows.length < 2) return [];
  const headerRow = rows[0] || [];
  const maybeDateRow = rows[1] || [];
  const dateLikeCount = maybeDateRow.slice(1).filter((c) => looksLikeDateHeader(c)).length;
  const hasDateRow = dateLikeCount >= 2;

  const colMeta = [];
  let lastSupplier = '';
  for (let c = 1; c < headerRow.length; c++) {
    const supCell = cleanCell(headerRow[c]);
    if (supCell && looksLikeSupplierName(supCell)) lastSupplier = supCell;
    const dateCell = hasDateRow ? parseEffectiveDate(maybeDateRow[c]) : null;
    if (lastSupplier) {
      colMeta[c] = {
        supplierName: lastSupplier,
        effectiveDate: dateCell || todayISO(),
      };
    }
  }

  if (colMeta.filter(Boolean).length < 1) return [];

  const dataStart = hasDateRow ? 2 : 1;
  const entries = [];
  for (let ri = dataStart; ri < rows.length; ri++) {
    const row = rows[ri] || [];
    const materialName = cleanCell(row[0]);
    if (!materialName || /^(סה|total|סך)/i.test(materialName)) continue;
    for (let c = 1; c < row.length; c++) {
      const meta = colMeta[c];
      if (!meta) continue;
      const price = parsePrice(row[c]);
      if (price == null) continue;
      entries.push({
        materialName,
        supplierName: meta.supplierName,
        price,
        effectiveDate: meta.effectiveDate,
        unit: 'ק"ג',
        categoryName: '',
      });
    }
  }
  return entries;
}

function detectWideFormat(rows) {
  const header = rows[0] || [];
  if (header.length < 3) return false;
  const supplierCols = header.slice(1).filter((c) => looksLikeSupplierName(c)).length;
  const row1Dates = (rows[1] || []).slice(1).filter((c) => looksLikeDateHeader(c)).length;
  return supplierCols >= 1 || row1Dates >= 2;
}

export function parseSupplierRows(rows) {
  const cleaned = rows
    .map((r) => (Array.isArray(r) ? r.map(cleanCell) : []))
    .filter((r) => r.some((c) => c));

  if (!cleaned.length) return { entries: [], format: 'empty' };

  const longMeta = detectLongFormat(cleaned);
  if (longMeta) {
    const entries = parseLongFormat(cleaned, longMeta);
    return { entries, format: 'long' };
  }

  if (detectWideFormat(cleaned)) {
    const entries = parseWideMatrix(cleaned);
    if (entries.length) return { entries, format: 'wide' };
  }

  const wideEntries = parseWideMatrix(cleaned);
  if (wideEntries.length) return { entries: wideEntries, format: 'wide' };

  return { entries: [], format: 'unknown' };
}

function parseWorkbookSheets(wb, XLSX) {
  const allEntries = [];
  const sheets = [];

  for (const sheetName of wb.SheetNames) {
    if (isSkipSheetName(sheetName)) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false })
      .map((r) => (Array.isArray(r) ? r.map(cleanCell) : []))
      .filter((r) => r.some((c) => c));

    const headerMeta = detectSupplierSheetFormat(rows);
    if (headerMeta) {
      const entries = parseSupplierSheetRows(rows, sheetName, headerMeta);
      allEntries.push(...entries);
      sheets.push({ name: sheetName, entries: entries.length });
      continue;
    }

    const headerlessMeta = detectHeaderlessPriceListFormat(rows);
    if (headerlessMeta) {
      const entries = parseHeaderlessPriceListRows(rows, sheetName, headerlessMeta);
      allEntries.push(...entries);
      sheets.push({ name: sheetName, entries: entries.length });
    }
  }

  if (allEntries.length) {
    return { entries: allEntries, format: 'supplier_sheets', sheets };
  }
  return null;
}

export async function parseSupplierFile(file) {
  const name = (file?.name || '').toLowerCase();
  let rows = [];

  if (name.endsWith('.xlsx') || name.endsWith('.xls') || file.type.includes('spreadsheet')) {
    const XLSX = await loadXLSX();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });

    const multiSheet = parseWorkbookSheets(wb, XLSX);
    if (multiSheet) return multiSheet;

    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error('קובץ Excel ריק');
    rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false });
  } else {
    const text = await file.text();
    rows = text.split(/\r?\n/).map((line) => line.split(/[,;\t]/).map((c) => c.trim()));
  }

  const parsed = parseSupplierRows(rows);
  if (!parsed.entries.length) {
    throw new Error(
      'לא זוהו נתונים — גיליון לכל ספק (עם או בלי כותרות: שם + מחיר לק"ג), או עמודות: חומר גלם, ספק, מחיר',
    );
  }
  return parsed;
}
