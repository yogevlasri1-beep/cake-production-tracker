const COL_ALIASES = {
  category: ['קטגוריה', 'category', 'cat', 'קט'],
  product: ['מוצר', 'סוג', 'product', 'name', 'שם', 'סוג מוצר', 'שם מוצר', 'סוג/מוצר', 'תיאור'],
  price: ['מחיר', 'price', 'מחיר ליחידה'],
  date: ['תאריך', 'date', 'יום', 'תאריך ייצור', 'יום ייצור', 'יום/תאריך'],
  quantity: ['כמות', 'quantity', 'qty', 'יחידות', 'כמות יצור', 'יצור', 'כמות יח', 'כמ', 'כ"ס', 'סה"כ'],
};

function cellStr(val) {
  if (val == null) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, '0')}-${String(val.getDate()).padStart(2, '0')}`;
  }
  return String(val).trim();
}

function cleanCell(val) {
  return cellStr(val).replace(/[\u200e\u200f\ufeff\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
}

function colType(val) {
  const v = cleanCell(val).toLowerCase();
  if (!v || v.length < 2) return null;
  for (const [key, aliases] of Object.entries(COL_ALIASES)) {
    if (key === 'category' || key === 'price') continue;
    if (aliases.some((a) => {
      const alias = a.toLowerCase();
      if (v === alias) return true;
      if (alias.length >= 2 && v.includes(alias)) return true;
      if (v.length >= 2 && alias.includes(v)) return true;
      return false;
    })) return key;
  }
  return null;
}

function normalizeHeader(h) {
  const clean = cleanCell(h).toLowerCase();
  for (const [key, aliases] of Object.entries(COL_ALIASES)) {
    if (aliases.some((a) => clean === a.toLowerCase() || clean.includes(a.toLowerCase()))) return key;
  }
  return clean;
}

function isKnownHeader(val) {
  return colType(val) !== null || normalizeHeader(val) !== cleanCell(val).toLowerCase();
}

function expandMergedCells(sheet, grid) {
  const merges = sheet['!merges'] || [];
  for (const m of merges) {
    const val = grid[m.s.r]?.[m.s.c];
    if (!cleanCell(val)) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      if (!grid[r]) grid[r] = [];
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (!cleanCell(grid[r][c])) grid[r][c] = val;
      }
    }
  }
  return grid;
}

function sheetToGrid(sheet, XLSX) {
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  return expandMergedCells(sheet, grid);
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
  const { loadXLSX: load } = await import('./xlsx-loader.js');
  return load();
}

async function fileToGrid(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await loadXLSX();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return sheetToGrid(sheet, XLSX);
  }
  const text = await file.text();
  return textToGrid(text);
}

async function fileToAllGrids(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await loadXLSX();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    return wb.SheetNames.map((sheetName) => {
      const sheet = wb.Sheets[sheetName];
      const grid = sheetToGrid(sheet, XLSX);
      return { sheetName: sheetName.trim(), grid };
    }).filter(({ grid }) => grid.length > 0);
  }
  return [{ sheetName: '', grid: await fileToGrid(file) }];
}

function applySheetCategory(parsed, sheetName) {
  if (!sheetName) return parsed;
  parsed.rows.forEach((row) => {
    if (!row.category || row.category === 'כללי') row.category = sheetName;
  });
  return parsed;
}

function parseWorkbookGrids(grids) {
  const allRows = [];
  const formats = new Set();

  for (const { sheetName, grid } of grids) {
    const detected = detectAndParse(grid, sheetName);
    if (!detected || !detected.rows || !detected.rows.length) continue;
    applySheetCategory(detected, sheetName);
    allRows.push(...detected.rows);
    formats.add(detected.label);
  }

  if (!allRows.length) return null;

  return {
    rows: allRows,
    format: grids.length > 1 ? 'multi-sheet' : 'single',
    label: formats.size === 1 ? [...formats][0] : `מספר גיליונות (${grids.length})`,
  };
}

function parseDate(raw) {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
  }
  if (typeof raw === 'number' && raw > 30000 && raw < 80000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
    return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`;
  }

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

function findHeaderRows(grid, maxRows = 30) {
  const indices = [];
  for (let r = 0; r < Math.min(maxRows, grid.length); r++) {
    const types = (grid[r] || []).map(colType);
    if (types.includes('date') && types.includes('quantity') && types.includes('product')) {
      indices.push(r);
    }
  }
  return indices;
}

function findTripletBlocks(headerRow, categoryRow) {
  const typed = (headerRow || []).map((cell, c) => ({ c, t: colType(cell) })).filter((x) => x.t);
  const products = typed.filter((x) => x.t === 'product');
  const dates = typed.filter((x) => x.t === 'date');
  const qtys = typed.filter((x) => x.t === 'quantity');
  const used = new Set();
  const blocks = [];

  for (const p of products) {
    if (used.has(`p${p.c}`)) continue;
    const date = dates
      .filter((d) => !used.has(`d${d.c}`) && Math.abs(d.c - p.c) <= 5)
      .sort((a, b) => Math.abs(a.c - p.c) - Math.abs(b.c - p.c))[0];
    const qty = qtys
      .filter((q) => !used.has(`q${q.c}`) && Math.abs(q.c - p.c) <= 5)
      .sort((a, b) => Math.abs(a.c - p.c) - Math.abs(b.c - p.c))[0];
    if (!date || !qty) continue;
    used.add(`p${p.c}`);
    used.add(`d${date.c}`);
    used.add(`q${qty.c}`);
    blocks.push({
      cols: { product: p.c, date: date.c, quantity: qty.c },
      category: resolveCategory(categoryRow, headerRow, p.c),
    });
  }
  return blocks;
}

function extractBlockRows(grid, headerIdx, blocks) {
  const rows = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.every((cell) => !cleanCell(cell))) continue;
    const rowTypes = row.map(colType);
    if (rowTypes.includes('date') && rowTypes.includes('quantity') && rowTypes.includes('product')) break;

    for (const block of blocks) {
      const product = cleanCell(row[block.cols.product]);
      const date = parseDate(row[block.cols.date]);
      const quantity = parseQuantity(row[block.cols.quantity]);
      if (product && date && quantity > 0) {
        rows.push({ category: block.category, product, date, quantity, price: 0 });
      }
    }
  }
  return rows;
}

/** קטגוריות בעמודות: שורת קטגוריה + שורת כותרות (סוג|תאריך|כמות) × N */
function parseCategoryBlocks(grid) {
  const headerRows = findHeaderRows(grid);
  if (!headerRows.length) return null;

  const allRows = [];
  for (const headerIdx of headerRows) {
    const categoryRow = headerIdx > 0 ? grid[headerIdx - 1] : null;
    const blocks = findTripletBlocks(grid[headerIdx], categoryRow);
    if (!blocks.length) continue;
    allRows.push(...extractBlockRows(grid, headerIdx, blocks));
  }

  return allRows.length
    ? { rows: allRows, format: 'category-blocks', label: 'קטגוריות בעמודות (סוג + תאריך + כמות)' }
    : null;
}

/** קטגוריות אחת מתחת לשנייה באותו גיליון */
function parseStackedSections(grid, defaultCategory = 'כללי') {
  const rows = [];
  let currentCategory = defaultCategory;
  let i = 0;

  while (i < grid.length) {
    const row = grid[i] || [];
    const types = row.map(colType);
    const filled = row.map(cleanCell).filter(Boolean);

    if (filled.length === 1 && !colType(filled[0]) && !parseDate(filled[0]) && parseQuantity(filled[0]) === 0) {
      currentCategory = filled[0];
      i++;
      continue;
    }

    if (types.includes('date') && types.includes('quantity') && types.includes('product')) {
      const categoryRow = i > 0 ? grid[i - 1] : null;
      const blocks = findTripletBlocks(row, categoryRow).map((b) => ({
        ...b,
        category: b.category !== 'כללי' ? b.category : currentCategory,
      }));
      i++;
      while (i < grid.length) {
        const dataRow = grid[i] || [];
        if (!dataRow.some((c) => cleanCell(c))) { i++; continue; }
        const dataTypes = dataRow.map(colType);
        if (dataTypes.includes('date') && dataTypes.includes('quantity') && dataTypes.includes('product')) break;
        const one = dataRow.map(cleanCell).filter(Boolean);
        if (one.length === 1 && !colType(one[0]) && !parseDate(one[0]) && parseQuantity(one[0]) === 0) break;

        for (const block of blocks) {
          const product = cleanCell(dataRow[block.cols.product]);
          const date = parseDate(dataRow[block.cols.date]);
          const quantity = parseQuantity(dataRow[block.cols.quantity]);
          if (product && date && quantity > 0) {
            rows.push({ category: block.category, product, date, quantity, price: 0 });
          }
        }
        i++;
      }
      continue;
    }
    i++;
  }

  return rows.length
    ? { rows, format: 'stacked-sections', label: 'קטגוריות מרובות (שורה אחר שורה)' }
    : null;
}

/** גיליון עם 3 עמודות בלבד: סוג, תאריך, כמות */
function parseSimpleSheet(grid, defaultCategory = 'כללי') {
  const headerIdx = findHeaderRows(grid, 10)[0];
  if (headerIdx == null) return null;
  const blocks = findTripletBlocks(grid[headerIdx], headerIdx > 0 ? grid[headerIdx - 1] : null);
  if (!blocks.length) return null;
  const blocksWithCat = blocks.map((b) => ({
    ...b,
    category: b.category !== 'כללי' ? b.category : defaultCategory,
  }));
  const rows = extractBlockRows(grid, headerIdx, blocksWithCat);
  return rows.length
    ? { rows, format: 'simple-sheet', label: 'גיליון פשוט (סוג + תאריך + כמות)' }
    : null;
}

/** שורת תאריך + עמודות מוצרים עם כמויות */
function parseWideMatrix(grid) {
  let headerIdx = -1;
  for (let r = 0; r < Math.min(25, grid.length); r++) {
    if (colType(grid[r]?.[0]) === 'date') {
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

/** פורמט שטוח: שורת כותרות */
function parseFlatGrid(grid) {
  if (grid.length < 2) return null;

  for (let h = 0; h < Math.min(25, grid.length - 1); h++) {
    const headers = (grid[h] || []).map(normalizeHeader);
    const hasProduct = headers.includes('product');
    const hasDate = headers.includes('date');
    const hasQty = headers.includes('quantity');
    if (!hasProduct) continue;

    const rows = [];
    for (let i = h + 1; i < grid.length; i++) {
      const raw = {};
      headers.forEach((key, idx) => {
        raw[key] = cleanCell(grid[i][idx]);
      });
      if (!raw.product && !Object.values(raw).some(Boolean)) continue;
      rows.push({
        category: raw.category || '',
        product: raw.product || '',
        date: hasDate ? parseDate(raw.date) : null,
        quantity: hasQty ? parseQuantity(raw.quantity) : 0,
        price: parseFloat(raw.price) || 0,
      });
    }

    const valid = rows.filter((r) => r.product && ((r.date && r.quantity) || r.category));
    if (valid.length) {
      return { rows: valid, format: 'flat', label: 'טבלה רגילה' };
    }
  }
  return null;
}

function applyDefaultCategory(parsed, defaultCategory) {
  if (!parsed || !defaultCategory || defaultCategory === 'כללי') return parsed;
  return {
    ...parsed,
    rows: parsed.rows.map((r) => ({
      ...r,
      category: !r.category || r.category === 'כללי' ? defaultCategory : r.category,
    })),
  };
}

function detectAndParse(grid, sheetName = '') {
  const defaultCategory = String(sheetName || '').trim() || 'כללי';
  const results = [
    parseCategoryBlocks,
    (g) => parseStackedSections(g, defaultCategory),
    (g) => parseSimpleSheet(g, defaultCategory),
    parseWideMatrix,
    parseFlatGrid,
  ]
    .map((fn) => fn(grid))
    .filter(Boolean)
    .map((parsed) => applyDefaultCategory(parsed, defaultCategory));

  if (!results.length) return null;
  return results.sort((a, b) => b.rows.length - a.rows.length)[0];
}

export async function parseImportFile(file) {
  if (!file) throw new Error('לא נבחר קובץ');

  const ext = file.name.toLowerCase();
  if (!ext.endsWith('.csv') && !ext.endsWith('.xlsx') && !ext.endsWith('.xls') && !ext.endsWith('.txt')) {
    throw new Error('סוג קובץ לא נתמך. יש להעלות CSV או Excel (.xlsx)');
  }

  try {
    const grids = await fileToAllGrids(file);
    const detected = parseWorkbookGrids(grids);
    if (!detected || !detected.rows.length) {
      throw new Error('NO_FORMAT');
    }
    return detected;
  } catch (err) {
    if (err.message === 'NO_FORMAT') {
      throw new Error(FORMAT_ERROR_MSG);
    }
    throw new Error('לא ניתן לקרוא את הקובץ. ודא שהקובץ הוא CSV או Excel (.xlsx)');
  }
}

export async function importProductionFile(file, importProduction) {
  const parsed = await parseImportFile(file);
  const prodRows = parsed.rows.filter((r) => r.date && r.quantity > 0 && r.product);
  if (!prodRows.length) {
    throw new Error('לא נמצאו רישומי ייצור בקובץ (צריך: סוג, תאריך, כמות)');
  }
  const production = await importProduction(prodRows);
  return { parsed, production, importedRows: prodRows.length };
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
  const prodRows = parsed.rows.filter((r) => r.date && r.quantity > 0 && r.product);
  const sample = prodRows.slice(0, limit)
    .map((r) => `${r.category || '—'} · ${r.product} · ${r.date || '—'} · ${r.quantity || '—'}`)
    .join('\n');
  const categories = [...new Set(prodRows.map((r) => r.category).filter(Boolean))];
  const products = [...new Set(prodRows.map((r) => r.product).filter(Boolean))];
  return { sample, total: prodRows.length, categories, products };
}

export const FORMAT_ERROR_MSG =
  'לא הצלחתי לזהות את מבנה הקובץ.\n\n' +
  'הפורמט שלך צריך לכלול עמודות:\n' +
  'כמות | מוצר | תאריך\n\n' +
  '• כל קטגוריה בגיליון (טאb) נפרד — שם הגיליון = שם הקטגוריה\n' +
  '• Google Sheets → קובץ → הורדה → Excel (.xlsx)';

export const CSV_TEMPLATE_BLOCKS = `כמות,מוצר,תאריך,כמות,מוצר,תאריך
120,שטרודל פרג 30,29/04/25,29,שטרודל פרג 40,29/04/25
51,שטרודל תפוח ללא 30,30/04/25,301,שטרודל תפוח ללא 40,30/04/25`;

export const CSV_TEMPLATE_FULL = `כמות,מוצר: 30 ס"מ,תאריך,,,כמות,מוצר: 40 ס"מ,תאריך
120,שטרודל פרג 30,29/04/25,,,29,שטרודל פרג 40,29/04/25`;

export { parseDate, parseQuantity, detectAndParse };
