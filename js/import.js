const COL_ALIASES = {
  category: ['קטגוריה', 'category', 'cat'],
  product: ['מוצר', 'סוג', 'product', 'name', 'שם', 'סוג מוצר'],
  price: ['מחיר', 'price', 'מחיר ליחידה'],
  date: ['תאריך', 'date', 'יום'],
  quantity: ['כמות', 'quantity', 'qty', 'יחידות', 'כמות יצור', 'יצור'],
};

function cellStr(val) {
  if (val == null) return '';
  return String(val).trim();
}

function normalizeHeader(h) {
  const clean = cellStr(h).toLowerCase().replace(/^\ufeff/, '');
  for (const [key, aliases] of Object.entries(COL_ALIASES)) {
    if (aliases.some((a) => clean === a.toLowerCase())) return key;
  }
  return clean;
}

function colType(val) {
  const v = cellStr(val).toLowerCase();
  for (const [key, aliases] of Object.entries(COL_ALIASES)) {
    if (key === 'category' || key === 'price') continue;
    if (aliases.some((a) => a.toLowerCase() === v)) return key;
  }
  return null;
}

function isKnownHeader(val) {
  return colType(val) !== null || normalizeHeader(val) !== cellStr(val).toLowerCase();
}

function parseCSVLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((s) => s.replace(/^"|"$/g, '').trim());
}

function detectDelimiter(line) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && counts[ch] !== undefined) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function textToGrid(text) {
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delimiter = detectDelimiter(lines[0]);
  return lines.map((l) => parseCSVLine(l, delimiter));
}

async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('לא ניתן לטעון תמיכה ב-Excel'));
    document.head.appendChild(s);
  });
  return window.XLSX;
}

async function fileToGrid(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await loadXLSX();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  }
  const text = await file.text();
  return textToGrid(text);
}

function parseDate(raw) {
  const s = cellStr(raw);
  if (!s) return null;

  const num = parseFloat(s.replace(',', '.'));
  if (!isNaN(num) && num > 30000 && num < 80000 && !s.includes('/')) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(num) * 86400000);
    return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`;
  }

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }

  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return null;
}

function parseQuantity(raw) {
  const s = cellStr(raw).replace(/,/g, '');
  if (!s) return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}

function fillCategorySpans(categoryRow) {
  if (!categoryRow) return null;
  const filled = categoryRow.map((c) => cellStr(c));
  let last = '';
  for (let c = 0; c < filled.length; c++) {
    if (filled[c] && !isKnownHeader(filled[c])) last = filled[c];
    else if (last) filled[c] = last;
  }
  return filled;
}

function resolveCategory(categoryRow, headerRow, startCol) {
  const row = fillCategorySpans(categoryRow) || categoryRow;
  if (row) {
    for (let c = startCol; c >= 0; c--) {
      const v = cellStr(row[c]);
      if (v && !isKnownHeader(v)) return v;
    }
  }
  for (let c = startCol; c < (headerRow?.length || 0); c++) {
    const v = cellStr(headerRow[c]);
    if (v && !colType(v)) return v;
  }
  return 'כללי';
}

function resolveCategoryForCol(categoryRow, col) {
  const row = fillCategorySpans(categoryRow);
  if (!row) return 'כללי';
  const direct = cellStr(row[col]);
  if (direct && !isKnownHeader(direct)) return direct;
  return 'כללי';
}

/** קטגוריות בעמודות: שורת קטגוריה + שורת כותרות (סוג|תאריך|כמות) × N */
function parseCategoryBlocks(grid) {
  let headerIdx = -1;
  for (let r = 0; r < Math.min(8, grid.length); r++) {
    const types = grid[r].map(colType);
    if (types.includes('date') && types.includes('quantity') && types.includes('product')) {
      headerIdx = r;
      break;
    }
  }
  if (headerIdx === -1) return null;

  const categoryRow = headerIdx > 0 ? grid[headerIdx - 1] : null;
  const headerRow = grid[headerIdx];
  const blocks = [];

  for (let c = 0; c < headerRow.length; c++) {
    const triplet = {};
    for (let d = 0; d < 4 && c + d < headerRow.length; d++) {
      const t = colType(headerRow[c + d]);
      if (t && triplet[t] === undefined) triplet[t] = c + d;
    }
    if (triplet.product !== undefined && triplet.date !== undefined && triplet.quantity !== undefined) {
      const endCol = Math.max(triplet.product, triplet.date, triplet.quantity);
      blocks.push({
        cols: triplet,
        category: resolveCategory(categoryRow, headerRow, c),
        endCol,
      });
      c = endCol;
    }
  }

  if (!blocks.length) return null;

  const rows = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.every((cell) => !cellStr(cell))) continue;

    for (const block of blocks) {
      const product = cellStr(row[block.cols.product]);
      const date = parseDate(row[block.cols.date]);
      const quantity = parseQuantity(row[block.cols.quantity]);
      if (product && date && quantity > 0) {
        rows.push({ category: block.category, product, date, quantity, price: 0 });
      }
    }
  }

  return rows.length ? { rows, format: 'category-blocks', label: 'קטגוריות בעמודות (סוג + תאריך + כמות)' } : null;
}

/** שורת תאריך + עמודות מוצרים עם כמויות */
function parseWideMatrix(grid) {
  let headerIdx = -1;
  for (let r = 0; r < Math.min(8, grid.length); r++) {
    if (colType(grid[r][0]) === 'date') {
      headerIdx = r;
      break;
    }
  }
  if (headerIdx === -1) return null;

  const categoryRow = headerIdx > 0 ? grid[headerIdx - 1] : null;
  const headerRow = grid[headerIdx];
  const products = [];

  for (let c = 1; c < headerRow.length; c++) {
    const name = cellStr(headerRow[c]);
    if (!name || colType(name)) continue;
    products.push({ col: c, name, category: resolveCategoryForCol(categoryRow, c) });
  }
  if (!products.length) return null;

  const rows = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const date = parseDate(grid[r][0]);
    if (!date) continue;
    for (const prod of products) {
      const quantity = parseQuantity(grid[r][prod.col]);
      if (quantity > 0) {
        rows.push({ category: prod.category, product: prod.name, date, quantity, price: 0 });
      }
    }
  }

  return rows.length ? { rows, format: 'wide-matrix', label: 'תאריך + עמודות מוצרים' } : null;
}

/** פורמט שטוח: שורת כותרות אחת */
function parseFlatGrid(grid) {
  if (grid.length < 2) return null;
  const headers = grid[0].map(normalizeHeader);
  const hasProduct = headers.includes('product');
  const hasDate = headers.includes('date');
  const hasQty = headers.includes('quantity');
  if (!hasProduct) return null;

  const rows = [];
  for (let i = 1; i < grid.length; i++) {
    const raw = {};
    headers.forEach((h, idx) => {
      raw[h] = cellStr(grid[i][idx]);
    });
    rows.push({
      category: raw.category || '',
      product: raw.product || '',
      date: hasDate ? parseDate(raw.date) : null,
      quantity: hasQty ? parseQuantity(raw.quantity) : 0,
      price: parseFloat(raw.price) || 0,
    });
  }

  const valid = rows.filter((r) => r.product && ((r.date && r.quantity) || r.category));
  return valid.length ? { rows: valid, format: 'flat', label: 'טבלה רגילה' } : null;
}

function detectAndParse(grid) {
  const results = [parseCategoryBlocks, parseWideMatrix, parseFlatGrid]
    .map((fn) => fn(grid))
    .filter(Boolean);

  if (!results.length) return null;
  return results.sort((a, b) => b.rows.length - a.rows.length)[0];
}

export async function parseImportFile(file) {
  if (!file) throw new Error('לא נבחר קובץ');

  const ext = file.name.toLowerCase();
  if (!ext.endsWith('.csv') && !ext.endsWith('.xlsx') && !ext.endsWith('.xls') && !ext.endsWith('.txt')) {
    throw new Error('סוג קובץ לא נתמך. יש להעלות CSV או Excel (.xlsx)');
  }

  let grid;
  try {
    grid = await fileToGrid(file);
  } catch {
    throw new Error('לא ניתן לקרוא את הקובץ. ודא שהורדת CSV או Excel מ-Google Sheets');
  }

  if (!grid.length) throw new Error('הקובץ ריק');

  const detected = detectAndParse(grid);
  if (!detected || !detected.rows.length) {
    throw new Error(
      'לא הצלחתי לזהות את המבנה.\n\n' +
      'הגיליון שלך צריך להיראות כך:\n' +
      'שורה 1: שמות קטגוריות (עוגות, עוגיות...)\n' +
      'שורה 2: סוג | תאריך | כמות | סוג | תאריך | כמות\n' +
      'שורה 3+: הנתונים\n\n' +
      'או: קובץ → הורדה → CSV (לא PDF)'
    );
  }

  return detected;
}

export async function importParsedRows(parsed, { importCatalog, importProduction }) {
  const rows = parsed.rows;
  const hasProduction = rows.some((r) => r.date && r.quantity);
  const hasCatalog = rows.some((r) => r.category && r.product);

  let result = { catalog: null, production: null, format: parsed.format, label: parsed.label };

  if (importCatalog && hasCatalog) {
    const catalogRows = rows.filter((r) => r.category && r.product);
    result.catalog = await importCatalog(catalogRows);
  }

  if (importProduction && hasProduction) {
    const prodRows = rows.filter((r) => r.date && r.quantity && r.product);
    result.production = await importProduction(prodRows);
  }

  if (!result.catalog && !result.production) {
    throw new Error('לא נמצאו נתונים לייבוא בקובץ');
  }

  return result;
}

export async function importCSVFile(file, handlers) {
  const parsed = await parseImportFile(file);
  return importParsedRows(parsed, handlers);
}

export function previewText(parsed, limit = 5) {
  const sample = parsed.rows.slice(0, limit)
    .map((r) => `${r.category || '—'} · ${r.product} · ${r.date || '—'} · ${r.quantity || '—'}`)
    .join('\n');
  const categories = [...new Set(parsed.rows.map((r) => r.category).filter(Boolean))];
  return { sample, total: parsed.rows.length, categories };
}

export const CSV_TEMPLATE_BLOCKS = `עוגות,,,עוגיות,,,
סוג,תאריך,כמות,סוג,תאריך,כמות
עוגת שוקולד,01/06/2026,50,עוגיית חמאה,01/06/2026,120
עוגת גבינה,02/06/2026,30,עוגיית שוקולד,02/06/2026,80`;

export const CSV_TEMPLATE_FULL = CSV_TEMPLATE_BLOCKS;
