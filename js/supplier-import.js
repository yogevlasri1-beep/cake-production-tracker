import { loadXLSX } from './xlsx-loader.js';
import { todayISO } from './utils.js';

const MATERIAL_ALIASES = ['חומר גלם', 'חומר', 'מוצר', 'material', 'שם', 'פריט', 'תיאור'];
const SUPPLIER_ALIASES = ['ספק', 'supplier', 'שם ספק'];
const PRICE_ALIASES = ['מחיר', 'price', 'עלות', 'תמחור'];
const DATE_ALIASES = ['תאריך', 'date', 'יום', 'מתאריך'];
const UNIT_ALIASES = ['יחידה', 'unit', 'יח'];
const CATEGORY_ALIASES = ['קטגוריה', 'category', 'סוג'];
const WEIGHT_ALIASES = ['משקל', 'weight', 'גרם', 'משקל מוצר', 'package weight', 'משקל אריזה'];

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
  if (/^(חומר|מחיר|תאריך|יחידה|קטגוריה)/i.test(t)) return false;
  return /[א-תa-z]/i.test(t);
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
  const first = cleanCell(header[0]).toLowerCase();
  if (first && !/^(חומר|מוצר|material|פריט)/i.test(first) && parsePrice(first) == null) {
    /* first col may still be material label row below */
  }
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

  /* fallback: try wide without strict detection */
  const wideEntries = parseWideMatrix(cleaned);
  if (wideEntries.length) return { entries: wideEntries, format: 'wide' };

  return { entries: [], format: 'unknown' };
}

export async function parseSupplierFile(file) {
  const name = (file?.name || '').toLowerCase();
  let rows = [];

  if (name.endsWith('.xlsx') || name.endsWith('.xls') || file.type.includes('spreadsheet')) {
    const XLSX = await loadXLSX();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
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
      'לא זוהו נתונים — ודא שיש עמודות: חומר גלם, ספק, מחיר (ותאריך אופציונלי) או טבלה עם שמות ספקים בעמודות',
    );
  }
  return parsed;
}
