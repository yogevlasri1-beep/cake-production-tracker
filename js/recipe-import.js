import { loadFFlate } from './docx-loader.js?v=223';
import { formatRecipeIngredientsTotal, formatRecipeQuantity } from './kitchen-db.js?v=223';

const UNIT_KG = /^(ק"ג|ק״ג|קג|kg|קילו)$/i;
const UNIT_G = /^(גרם|ג'|ג׳|gr|g)$/i;
const UNIT_L = /^(ליטר|ל'|ל׳|liter|l|lt|ל)$/i;
const UNIT_CUP = /^(כוס|כוסות|cup|cups)$/i;
const QTY_UNIT_RE = /([\d.,]+|\d+\s*\/\s*\d+)\s*(ק"ג|ק״ג|קג|kg|קילו|גרם|ג'|ג׳|gr|g|ליטר|ל'|ל׳|l|כוס|כוסות)?/i;
const NAME_QTY_UNIT_RE = /^(.+?)\s+([\d.,]+|\d+\s*\/\s*\d+)\s*(ק"ג|ק״ג|קג|kg|קילו|גרם|ג'|ג׳|gr|g|ליטר|ל'|ל׳|l|כוס|כוסות)?\s*$/i;
const UNIT_QTY_NAME_RE = /^(ק"ג|ק״ג|קג|kg|קילו|גרם|ג'|ג׳|gr|g|ליטר|ל'|ל׳|l|כוס|כוסות)\s+([\d.,]+|\d+\s*\/\s*\d+)\s+(.+)$/i;
const STRUCTURED_RE = /^(.+?)\s*[|｜]\s*([\d.,]+)\s*[|｜]\s*(kg|g|l|ק"ג|גרם|ליטר)?\s*$/i;
const RECIPE_HEADER_RE = /^(?:===?\s*)?(?:מתכון|recipe)\s*[:：]\s*(.+)$/i;
const GROUP_HEADER_RE = /^(?:קטגוריה|קבוצה|group)\s*[:：]\s*(.+)$/i;
const SUB_HEADER_RE = /^(?:תת[- ]?קטגוריה|sub)\s*[:：]\s*(.+)$/i;
const SKIP_TITLE_RE = /^ספר\s*מתכונים|^תוכן|^עמוד/i;
const TOTAL_ROW_RE = /סה["״']?כ|^total$/i;

function parseNumber(raw) {
  const n = parseFloat(String(raw || '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseFraction(raw) {
  const s = String(raw || '').trim();
  if (s.includes('/')) {
    const [a, b] = s.split('/').map((x) => parseFloat(x.trim()));
    if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b;
    return null;
  }
  return parseNumber(s);
}

export function normalizeImportUnit(raw) {
  const u = String(raw || '').trim().toLowerCase();
  if (UNIT_G.test(u) || u === 'g') return 'g';
  if (UNIT_L.test(u)) return 'l';
  if (UNIT_CUP.test(u) || /כוס/.test(u)) return 'cup';
  if (UNIT_KG.test(u) || u === 'kg') return 'kg';
  return 'kg';
}

function unitLabel(kind, rawUnit) {
  if (kind === 'g') return 'גרם';
  if (kind === 'l') return 'ליטר';
  if (kind === 'cup') return rawUnit?.trim() || 'כוס';
  return 'ק"ג';
}

function buildParsedQty(qty, unitRaw) {
  if (qty == null || !Number.isFinite(qty)) return null;
  const trimmedUnit = String(unitRaw || '').trim();
  const unitKind = normalizeImportUnit(trimmedUnit || 'ק"ג');
  return {
    quantity: Math.round(qty * 1000) / 1000,
    unit: unitLabel(unitKind, trimmedUnit),
    unitKind: unitKind === 'cup' ? 'kg' : unitKind,
  };
}

function parseQtyUnitText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  let m = trimmed.match(/^(\d+\s*\/\s*\d+)\s*(.*)$/);
  if (m) {
    const qty = parseFraction(m[1]);
    const unitRaw = m[2].trim() || 'כוס';
    return buildParsedQty(qty, unitRaw);
  }

  m = trimmed.match(/^([\d.,]+)\s*(.*)$/);
  if (!m) return null;
  const qty = parseNumber(m[1]);
  if (qty == null) return null;
  const unitRaw = m[2].trim() || 'ק"ג';
  return buildParsedQty(qty, unitRaw);
}

function looksLikeQtyCell(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (parseQtyUnitText(t)) return true;
  if (/^\d+\s*\/\s*\d+/.test(t)) return true;
  if (/^[\d.,]+\s*(ק|גר|ל|kg|g|l|כוס)/i.test(t)) return true;
  if (/^[\d.,]+$/.test(t)) return true;
  return false;
}

function looksLikeNameCell(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (looksLikeQtyCell(t)) return false;
  if (TOTAL_ROW_RE.test(t)) return false;
  if (/^(חומר\s*גלם|כמות)\s*:?\s*$/i.test(t)) return false;
  return /[א-תa-z]/i.test(t);
}

function parseIngredientLine(line) {
  const trimmed = line.trim().replace(/^[-•*]\s*/, '');
  if (!trimmed) return null;

  let m = trimmed.match(STRUCTURED_RE);
  if (m) {
    const qty = parseFraction(m[2]) ?? parseNumber(m[2]);
    if (qty == null) return null;
    return { name: m[1].trim(), ...buildParsedQty(qty, m[3] || 'kg') };
  }

  m = trimmed.match(NAME_QTY_UNIT_RE);
  if (m) {
    const qty = parseFraction(m[2]) ?? parseNumber(m[2]);
    if (qty == null) return null;
    return { name: m[1].trim(), ...buildParsedQty(qty, m[3]) };
  }

  m = trimmed.match(UNIT_QTY_NAME_RE);
  if (m) {
    const qty = parseFraction(m[2]) ?? parseNumber(m[2]);
    if (qty == null) return null;
    return { name: m[3].trim(), ...buildParsedQty(qty, m[1]) };
  }

  m = trimmed.match(QTY_UNIT_RE);
  if (m) {
    const idx = trimmed.indexOf(m[0]);
    const name = (trimmed.slice(0, idx) + trimmed.slice(idx + m[0].length)).trim();
    const qty = parseFraction(m[1]) ?? parseNumber(m[1]);
    if (!name || qty == null) return null;
    return { name, ...buildParsedQty(qty, m[2]) };
  }

  return null;
}

function paragraphText(p) {
  return [...p.getElementsByTagName('w:t')].map((t) => t.textContent || '').join('').trim();
}

function paragraphHeadingLevel(p) {
  const styleEl = p.getElementsByTagName('w:pStyle')[0];
  const style = styleEl?.getAttribute('w:val') || styleEl?.getAttribute('val') || '';
  if (/Heading1|heading\s*1|כותרת\s*1|^1$/i.test(style)) return 1;
  if (/Heading2|heading\s*2|כותרת\s*2|^2$/i.test(style)) return 2;
  if (/Heading3|heading\s*3|כותרת\s*3|^3$/i.test(style)) return 3;
  const bold = [...p.getElementsByTagName('w:r')].some((run) => {
    const b = run.getElementsByTagName('w:b')[0];
    if (!b) return false;
    const val = b.getAttribute('w:val') || b.getAttribute('val');
    return val == null || val === '1' || val === 'true';
  });
  const sizeEl = p.getElementsByTagName('w:sz')[0];
  const size = sizeEl ? Number(sizeEl.getAttribute('w:val') || sizeEl.getAttribute('val')) : 0;
  if (bold && size >= 28) return 1;
  if (bold && size >= 24) return 2;
  if (bold) return 3;
  return 0;
}

function isSkippableBetweenTitleAndTable(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^(חומר\s*גלם|מרכיבים|כמות|רכיבים|חומרים|רשימת\s*חומרים)\s*:?\s*$/i.test(t)) return true;
  if (/^[-—–_=]{2,}$/.test(t)) return true;
  return false;
}

function findNextTable(blocks, fromIndex, maxLookahead = 8) {
  let skipped = 0;
  for (let i = fromIndex + 1; i < blocks.length && skipped < maxLookahead; i++) {
    if (isTableTag(blocks[i])) return blocks[i];
    if (isParagraphTag(blocks[i])) {
      const text = paragraphText(blocks[i]);
      if (!text) continue;
      if (isSkippableBetweenTitleAndTable(text)) {
        skipped += 1;
        continue;
      }
      if (parseIngredientLine(text)) return null;
      return null;
    }
    skipped += 1;
  }
  return null;
}

function nextMeaningfulBlock(blocks, fromIndex) {
  return findNextTable(blocks, fromIndex);
}

function assignHeadingAsCategory(text, level, state) {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (level === 1) {
    state.pendingGroup = trimmed;
    state.pendingSub = '';
    return;
  }
  if (level === 2) {
    state.pendingSub = trimmed;
    return;
  }
  state.pendingSub = trimmed;
}

function cellText(cell) {
  return [...cell.getElementsByTagName('w:t')].map((t) => t.textContent || '').join('').trim();
}

function isTableTag(el) {
  return el?.localName === 'tbl' || el?.tagName === 'w:tbl';
}

function isParagraphTag(el) {
  return el?.localName === 'p' || el?.tagName === 'w:p';
}

function isHeaderRow(cells) {
  const joined = cells.join(' ');
  return /כמות|quantity/i.test(joined) && /חומר|גלם|material|מרכיב/i.test(joined);
}

function isTotalRow(cells) {
  return cells.some((c) => TOTAL_ROW_RE.test(c.trim()));
}

function detectColumns(cells) {
  let qtyCol = -1;
  let nameCol = -1;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i].trim();
    if (/^כמות\s*:?\s*$/i.test(c) || /^quantity\s*:?\s*$/i.test(c)) qtyCol = i;
    if (/חומר|גלם|material|מרכיב/i.test(c)) nameCol = i;
  }
  if (qtyCol >= 0 && nameCol >= 0 && qtyCol !== nameCol) {
    return { qtyCol, nameCol };
  }
  return guessQtyNameColumns(cells);
}

function detectColumnsFromRows(rows, startRow) {
  const scores = [];
  for (let ri = startRow; ri < rows.length; ri++) {
    const cells = getRowCells(rows[ri]);
    if (!cells.length || isTotalRow(cells) || isHeaderRow(cells)) continue;
    if (isTitleRow(cells)) continue;
    for (let ci = 0; ci < cells.length; ci++) {
      if (!scores[ci]) scores[ci] = { qty: 0, name: 0 };
      const t = cells[ci].trim();
      if (looksLikeQtyCell(t)) scores[ci].qty += 1;
      if (looksLikeNameCell(t)) scores[ci].name += 1;
    }
  }
  let bestQty = -1;
  let bestName = -1;
  let maxQty = -1;
  let maxName = -1;
  for (let i = 0; i < scores.length; i++) {
    if (!scores[i]) continue;
    if (scores[i].qty > maxQty) { maxQty = scores[i].qty; bestQty = i; }
    if (scores[i].name > maxName) { maxName = scores[i].name; bestName = i; }
  }
  if (bestQty >= 0 && bestName >= 0 && bestQty !== bestName) {
    return { qtyCol: bestQty, nameCol: bestName };
  }
  return { qtyCol: 0, nameCol: 1 };
}

function isTitleRow(cells, qtyCol = 0, nameCol = 1) {
  if (isHeaderRow(cells) || isTotalRow(cells)) return false;
  const trimmed = cells.map((c) => c.trim());
  const nonEmpty = trimmed.filter(Boolean);
  if (!nonEmpty.length) return false;

  const joined = nonEmpty.join(' ').trim();
  if (parseIngredientLine(joined)) return false;

  if (cells.length >= 2 && qtyCol !== nameCol) {
    const qtyText = (cells[qtyCol] || '').trim();
    const nameText = (cells[nameCol] || '').trim();
    if (nameText && !qtyText && nameText.length <= 120 && !parseQtyUnitText(nameText)) return true;
    if (qtyText && !nameText && !looksLikeQtyCell(qtyText) && !parseQtyUnitText(qtyText) && qtyText.length <= 120) {
      return true;
    }
  }

  if (nonEmpty.some((c) => looksLikeQtyCell(c) && parseQtyUnitText(c) && !/[א-ת]{2,}/.test(c))) return false;

  if (nonEmpty.length === 1) {
    const text = nonEmpty[0];
    if (TOTAL_ROW_RE.test(text)) return false;
    if (/^(חומר\s*גלם|כמות|מרכיב|רכיב)/i.test(text)) return false;
    return text.length <= 120 && !parseQtyUnitText(text);
  }
  return nonEmpty.every((c) => looksLikeNameCell(c));
}

function extractTitleFromRow(cells, qtyCol, nameCol) {
  const qtyText = (cells[qtyCol] || '').trim();
  const nameText = (cells[nameCol] || '').trim();
  if (nameText && !qtyText) return nameText;
  if (qtyText && !nameText && !looksLikeQtyCell(qtyText)) return qtyText;
  return cells.map((c) => c.trim()).filter(Boolean).join(' ').trim();
}

function guessQtyNameColumns(cells, fallback = { qtyCol: 0, nameCol: 1 }) {
  if (cells.length < 2) return fallback;
  let bestQty = -1;
  let bestName = -1;
  for (let i = 0; i < cells.length; i++) {
    const text = cells[i].trim();
    if (!text) continue;
    if (looksLikeQtyCell(text)) bestQty = i;
    else if (looksLikeNameCell(text)) bestName = i;
  }
  if (bestQty >= 0 && bestName >= 0 && bestQty !== bestName) {
    return { qtyCol: bestQty, nameCol: bestName };
  }
  if (bestName >= 0 && bestQty < 0) {
    return { qtyCol: bestName === 0 ? 1 : 0, nameCol: bestName };
  }
  if (bestQty >= 0 && bestName < 0) {
    return { qtyCol: bestQty, nameCol: bestQty === 0 ? 1 : 0 };
  }
  return fallback;
}

function parseRowCells(cells, qtyCol, nameCol) {
  const qtyText = (cells[qtyCol] || '').trim();
  let nameText = (cells[nameCol] || '').trim();

  if (!nameText && cells.length >= 2) {
    const otherCol = cells.findIndex((_, i) => i !== qtyCol && cells[i]?.trim());
    if (otherCol >= 0) nameText = cells[otherCol].trim();
  }

  if (!nameText) {
    return parseIngredientLine(cells.filter(Boolean).join(' ').trim());
  }

  if (qtyText && /[\d.,/]/.test(qtyText)) {
    const parsed = parseQtyUnitText(qtyText);
    if (parsed) return { name: nameText, ...parsed };
  }

  if (qtyText && /כוס/.test(qtyText)) {
    return { name: nameText, quantity: 1, unit: qtyText, unitKind: 'kg' };
  }

  const combined = `${nameText} ${qtyText}`.trim();
  let ing = parseIngredientLine(combined) || parseIngredientLine(nameText);
  if (ing && !ing.name) ing.name = nameText;
  return ing;
}

function parseRowIngredient(cells, qtyCol, nameCol) {
  let ing = parseRowCells(cells, qtyCol, nameCol);
  if ((!ing?.name || ing.quantity == null) && cells.length >= 2) {
    ing = parseRowCells(cells, nameCol, qtyCol);
  }
  if ((!ing?.name || ing.quantity == null) && cells.length >= 2) {
    const guessed = guessQtyNameColumns(cells);
    ing = parseRowCells(cells, guessed.qtyCol, guessed.nameCol)
      || parseRowCells(cells, guessed.nameCol, guessed.qtyCol);
  }
  return ing;
}

function getTableRows(table) {
  return [...table.querySelectorAll('w\\:tr, tr')];
}

function getRowCells(row) {
  return [...row.querySelectorAll('w\\:tc, tc')].map(cellText);
}

function parseRecipeTablesFromTable(table, title) {
  const rows = getTableRows(table);
  if (!rows.length) return [];

  const results = [];
  let recipeTitle = title?.trim() || '';
  let ingredients = [];
  let startRow = 0;

  const firstCells = getRowCells(rows[0]);
  if (firstCells.length && isTitleRow(firstCells) && !isHeaderRow(firstCells)) {
    recipeTitle = recipeTitle || extractTitleFromRow(firstCells, 0, 1);
    startRow = 1;
  }

  let qtyCol = 0;
  let nameCol = 1;
  let dataStart = startRow;
  for (let ri = startRow; ri < rows.length; ri++) {
    const cells = getRowCells(rows[ri]);
    if (isHeaderRow(cells)) {
      ({ qtyCol, nameCol } = detectColumns(cells));
      dataStart = ri + 1;
      break;
    }
  }
  if (dataStart === startRow) {
    ({ qtyCol, nameCol } = detectColumnsFromRows(rows, startRow));
  }

  if (startRow === 0 && firstCells.length && isTitleRow(firstCells, qtyCol, nameCol) && !isHeaderRow(firstCells)) {
    recipeTitle = recipeTitle || extractTitleFromRow(firstCells, qtyCol, nameCol);
    if (dataStart === startRow) dataStart = 1;
  }

  const flush = () => {
    if (!recipeTitle && !ingredients.length) return;
    results.push({
      title: recipeTitle || 'מתכון ללא שם',
      groupName: '',
      subName: '',
      ingredients: ingredients.slice(),
      notes: '',
    });
    ingredients = [];
  };

  for (let ri = dataStart; ri < rows.length; ri++) {
    const cells = getRowCells(rows[ri]);
    if (!cells.length) continue;
    if (isTotalRow(cells)) continue;
    if (isHeaderRow(cells)) continue;

    if (isTitleRow(cells, qtyCol, nameCol)) {
      const rowTitle = extractTitleFromRow(cells, qtyCol, nameCol);
      if (ingredients.length) {
        flush();
        recipeTitle = rowTitle;
        continue;
      }
      recipeTitle = recipeTitle || rowTitle;
      continue;
    }

    const ing = parseRowIngredient(cells, qtyCol, nameCol);
    if (ing?.name && ing.quantity != null) ingredients.push(ing);
  }

  flush();
  return results;
}

function parseRecipeTable(table, title) {
  const recipes = parseRecipeTablesFromTable(table, title);
  return recipes[0] || null;
}

function collectBlocksInOrder(root) {
  const blocks = [];
  const walk = (node) => {
    for (const child of node.children || []) {
      if (child.nodeType !== 1) continue;
      if (isParagraphTag(child) || isTableTag(child)) {
        blocks.push(child);
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return blocks;
}

export function parseRecipesFromDocumentXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) return [];

  const recipes = [];
  const state = {
    pendingTitle: null,
    pendingGroup: '',
    pendingSub: '',
    pendingIngredients: [],
  };

  const flushPendingRecipe = () => {
    if (!state.pendingTitle && !state.pendingIngredients.length) return;
    recipes.push({
      title: state.pendingTitle || 'מתכון ללא שם',
      groupName: state.pendingGroup,
      subName: state.pendingSub,
      ingredients: state.pendingIngredients.slice(),
      notes: '',
    });
    state.pendingTitle = null;
    state.pendingIngredients = [];
  };

  const blocks = collectBlocksInOrder(body);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (isParagraphTag(block)) {
      const text = paragraphText(block);
      if (!text) continue;

      const groupM = text.match(GROUP_HEADER_RE);
      if (groupM) {
        flushPendingRecipe();
        state.pendingGroup = groupM[1].trim();
        state.pendingSub = '';
        continue;
      }
      const subM = text.match(SUB_HEADER_RE);
      if (subM) {
        flushPendingRecipe();
        state.pendingSub = subM[1].trim();
        continue;
      }
      const recipeM = text.match(RECIPE_HEADER_RE);
      if (recipeM) {
        flushPendingRecipe();
        state.pendingTitle = recipeM[1].trim();
        continue;
      }
      if (SKIP_TITLE_RE.test(text)) continue;
      if (isSkippableBetweenTitleAndTable(text)) continue;

      const ingLine = parseIngredientLine(text);
      if (ingLine) {
        if (!state.pendingTitle) state.pendingTitle = state.pendingSub || null;
        state.pendingIngredients.push(ingLine);
        continue;
      }

      const nextBlock = findNextTable(blocks, i);
      const nextIsTable = nextBlock && isTableTag(nextBlock);
      if (nextIsTable && text.length <= 120) {
        flushPendingRecipe();
        state.pendingTitle = text.trim();
        continue;
      }

      if (!state.pendingIngredients.length && text.length <= 120) {
        state.pendingTitle = text;
      }
      continue;
    }

    if (isTableTag(block)) {
      const titleForTable = state.pendingTitle;
      state.pendingTitle = null;
      state.pendingIngredients = [];
      const parsed = parseRecipeTablesFromTable(block, titleForTable);
      for (const recipe of parsed) {
        recipe.groupName = state.pendingGroup;
        recipe.subName = state.pendingSub;
        recipes.push(recipe);
      }
    }
  }

  flushPendingRecipe();
  return recipes;
}

function extractTextFromDocumentXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const paragraphs = [...doc.getElementsByTagName('w:p')];
  const lines = [];

  for (const p of paragraphs) {
    const line = paragraphText(p);
    if (line) lines.push(line);
    else if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function getDocumentXml(arrayBuffer) {
  const fflate = await loadFFlate();
  const bytes = new Uint8Array(arrayBuffer);
  const files = fflate.unzipSync(bytes);
  const docXml = files['word/document.xml'];
  if (!docXml) throw new Error('קובץ Word לא תקין — חסר document.xml');
  return new TextDecoder('utf-8').decode(docXml);
}

export async function extractTextFromDocx(arrayBuffer) {
  const xml = await getDocumentXml(arrayBuffer);
  return extractTextFromDocumentXml(xml);
}

export function parseRecipesFromText(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim());
  const recipes = [];
  let pendingGroup = '';
  let pendingSub = '';
  let pendingTitle = null;
  let ingredients = [];
  let noteLines = [];

  const flushRecipe = () => {
    if (!pendingTitle && !ingredients.length) return;
    recipes.push({
      title: pendingTitle || 'מתכון ללא שם',
      groupName: pendingGroup,
      subName: pendingSub,
      ingredients: ingredients.slice(),
      notes: noteLines.join('\n').trim(),
    });
    pendingTitle = null;
    ingredients = [];
    noteLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      flushRecipe();
      continue;
    }

    const groupM = line.match(GROUP_HEADER_RE);
    if (groupM) {
      flushRecipe();
      pendingGroup = groupM[1].trim();
      pendingSub = '';
      continue;
    }
    const subM = line.match(SUB_HEADER_RE);
    if (subM) {
      flushRecipe();
      pendingSub = subM[1].trim();
      continue;
    }
    const recipeM = line.match(RECIPE_HEADER_RE);
    if (recipeM) {
      flushRecipe();
      pendingTitle = recipeM[1].trim();
      continue;
    }

    const ing = parseIngredientLine(line);
    if (ing) {
      if (!pendingTitle) pendingTitle = pendingSub || null;
      ingredients.push(ing);
      continue;
    }

    const nextLine = lines[i + 1];
    const nextIsIng = nextLine && parseIngredientLine(nextLine);
    if (!ingredients.length && line.length <= 120 && nextIsIng) {
      flushRecipe();
      pendingSub = line;
      continue;
    }

    if (!ingredients.length && line.length <= 120 && !parseIngredientLine(line)) {
      flushRecipe();
      pendingTitle = line;
      continue;
    }

    noteLines.push(line);
  }
  flushRecipe();
  return recipes;
}

export async function parseRecipesFromDocxFile(file) {
  const buf = await file.arrayBuffer();
  const xml = await getDocumentXml(buf);
  let recipes = parseRecipesFromDocumentXml(xml);
  const tableCount = (xml.match(/<w:tbl[\s>]/g) || []).length;
  if (!recipes.length) {
    const text = extractTextFromDocumentXml(xml);
    recipes = parseRecipesFromText(text);
  }
  if (!recipes.length) {
    throw new Error('לא נמצאו מתכונים — ודא שיש טבלאות עם שם מתכון ושורות כמות/חומר גלם (גם בלי כותרות עמודות)');
  }
  if (tableCount > recipes.length) {
    recipes._parseWarning = `זוהו ${tableCount} טבלאות, פורשו ${recipes.length} מתכונים — בדוק מתכונים חסרים`;
  }
  return recipes;
}

export function buildRecipeBookHtml({ groups, subCategories, recipes, recipeDetails }) {
  const subByGroup = new Map();
  for (const sub of subCategories) {
    if (!subByGroup.has(sub.groupId)) subByGroup.set(sub.groupId, []);
    subByGroup.get(sub.groupId).push(sub);
  }

  const recipesBySub = new Map();
  for (const r of recipes) {
    if (!recipesBySub.has(r.categoryId)) recipesBySub.set(r.categoryId, []);
    recipesBySub.get(r.categoryId).push(r);
  }

  const detailMap = new Map(recipeDetails.map((d) => [d.id, d]));

  let body = '';
  for (const group of groups) {
    body += `<section class="book-group"><h1>${escapeHtml(group.name)}</h1>`;
    const subs = (subByGroup.get(group.id) || []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const sub of subs) {
      const subRecipes = (recipesBySub.get(sub.id) || []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      if (!subRecipes.length) continue;
      body += `<section class="book-sub"><h2>${escapeHtml(sub.name)}</h2>`;
      for (const recipe of subRecipes) {
        const detail = detailMap.get(recipe.id);
        body += `<article class="book-recipe"><h3>${escapeHtml(recipe.name)}</h3>`;
        if (detail?.notes) body += `<p class="book-notes">${escapeHtml(detail.notes)}</p>`;
        if (detail?.ingredients?.length) {
          body += '<ul class="book-ingredients">';
          for (const ing of detail.ingredients) {
            body += `<li><span class="ing-name">${escapeHtml(ing.name)}</span> — <strong>${formatRecipeQuantity(ing.quantity)}</strong> ${escapeHtml(ing.unit)}</li>`;
          }
          body += '</ul>';
          const totalText = formatRecipeIngredientsTotal(detail.ingredients);
          if (totalText) body += `<p class="book-recipe-total"><strong>סה"כ:</strong> ${escapeHtml(totalText)}</p>`;
        }
        body += '</article>';
      }
      body += '</section>';
    }
    body += '</section>';
  }

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>ספר מתכונים</title>
  <style>
    body { font-family: "Rubik", "Arial", sans-serif; max-width: 800px; margin: 0 auto; padding: 24px; color: #1e293b; line-height: 1.6; }
    h1 { color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 8px; margin-top: 48px; }
    h1:first-child { margin-top: 0; }
    h2 { color: #475569; margin-top: 32px; }
    h3 { margin-top: 24px; color: #0f172a; }
    .book-notes { color: #64748b; font-style: italic; }
    .book-ingredients { list-style: none; padding: 0; }
    .book-ingredients li { padding: 4px 0; border-bottom: 1px solid #e2e8f0; }
    .book-recipe-total { margin-top: 8px; padding-top: 8px; border-top: 2px solid #2563eb; font-weight: 600; }
    .ing-name { font-weight: 500; }
    @media print { body { padding: 12px; } h1 { page-break-before: always; } h1:first-child { page-break-before: avoid; } }
  </style>
</head>
<body>
  <header><h1 style="border:none">📒 ספר מתכונים</h1><p>נוצר מאפליקציית מעקב יצור</p></header>
  ${body}
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
