import { loadFFlate } from './docx-loader.js';

const UNIT_KG = /^(ק"ג|ק״ג|קג|kg|קילו)$/i;
const UNIT_G = /^(גרם|ג'|ג׳|gr|g)$/i;
const UNIT_L = /^(ליטר|ל'|ל׳|liter|l|lt)$/i;
const QTY_UNIT_RE = /([\d.,]+)\s*(ק"ג|ק״ג|קג|kg|קילו|גרם|ג'|ג׳|gr|g|ליטר|ל'|ל׳|l)\b/i;
const NAME_QTY_UNIT_RE = /^(.+?)\s+([\d.,]+)\s*(ק"ג|ק״ג|קג|kg|קילו|גרם|ג'|ג׳|gr|g|ליטר|ל'|ל׳|l)\s*$/i;
const UNIT_QTY_NAME_RE = /^(ק"ג|ק״ג|קג|kg|קילו|גרם|ג'|ג׳|gr|g|ליטר|ל'|ל׳|l)\s+([\d.,]+)\s+(.+)$/i;
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

export function normalizeImportUnit(raw) {
  const u = String(raw || '').trim().toLowerCase();
  if (UNIT_G.test(u) || u === 'g') return 'g';
  if (UNIT_L.test(u)) return 'l';
  if (UNIT_KG.test(u) || u === 'kg') return 'kg';
  return 'kg';
}

function unitLabel(kind) {
  if (kind === 'g') return 'גרם';
  if (kind === 'l') return 'ליטר';
  return 'ק"ג';
}

function parseQtyUnitText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^([\d.,]+)\s*(.*)$/);
  if (!m) return null;
  const qty = parseNumber(m[1]);
  if (qty == null) return null;
  const unitRaw = m[2].trim() || 'ק"ג';
  const unitKind = normalizeImportUnit(unitRaw);
  return { quantity: qty, unit: unitLabel(unitKind), unitKind };
}

function parseIngredientLine(line) {
  const trimmed = line.trim().replace(/^[-•*]\s*/, '');
  if (!trimmed) return null;

  let m = trimmed.match(STRUCTURED_RE);
  if (m) {
    const qty = parseNumber(m[2]);
    if (qty == null) return null;
    const unitKind = normalizeImportUnit(m[3] || 'kg');
    return { name: m[1].trim(), quantity: qty, unit: unitLabel(unitKind), unitKind };
  }

  m = trimmed.match(NAME_QTY_UNIT_RE);
  if (m) {
    const qty = parseNumber(m[2]);
    if (qty == null) return null;
    const unitKind = normalizeImportUnit(m[3]);
    return { name: m[1].trim(), quantity: qty, unit: unitLabel(unitKind), unitKind };
  }

  m = trimmed.match(UNIT_QTY_NAME_RE);
  if (m) {
    const qty = parseNumber(m[2]);
    if (qty == null) return null;
    const unitKind = normalizeImportUnit(m[1]);
    return { name: m[3].trim(), quantity: qty, unit: unitLabel(unitKind), unitKind };
  }

  m = trimmed.match(QTY_UNIT_RE);
  if (m) {
    const idx = trimmed.indexOf(m[0]);
    const name = (trimmed.slice(0, idx) + trimmed.slice(idx + m[0].length)).trim();
    const qty = parseNumber(m[1]);
    if (!name || qty == null) return null;
    const unitKind = normalizeImportUnit(m[2]);
    return { name, quantity: qty, unit: unitLabel(unitKind), unitKind };
  }

  return null;
}

function paragraphText(p) {
  return [...p.getElementsByTagName('w:t')].map((t) => t.textContent || '').join('').trim();
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
  let qtyCol = 0;
  let nameCol = 1;
  const qtyIdx = cells.findIndex((c) => /כמות|quantity/i.test(c));
  const nameIdx = cells.findIndex((c) => /חומר|גלם|material|מרכיב/i.test(c));
  if (qtyIdx >= 0) qtyCol = qtyIdx;
  if (nameIdx >= 0) nameCol = nameIdx;
  if (qtyCol === nameCol) {
    qtyCol = 0;
    nameCol = 1;
  }
  return { qtyCol, nameCol };
}

function isTitleRow(cells) {
  const nonEmpty = cells.map((c) => c.trim()).filter(Boolean);
  if (!nonEmpty.length) return false;
  if (nonEmpty.length === 1) {
    const text = nonEmpty[0];
    return text.length <= 120 && !parseQtyUnitText(text) && !parseIngredientLine(text);
  }
  return nonEmpty.every((c) => !parseQtyUnitText(c) && !parseIngredientLine(c) && !/^[\d.,]+$/.test(c));
}

function guessQtyNameColumns(cells, fallback = { qtyCol: 0, nameCol: 1 }) {
  if (cells.length < 2) return fallback;
  let bestQty = -1;
  let bestName = -1;
  for (let i = 0; i < cells.length; i++) {
    const text = cells[i].trim();
    if (!text) continue;
    const asQty = parseQtyUnitText(text) || (/^[\d.,]+/.test(text) && parseNumber(text.match(/^[\d.,]+/)?.[0]));
    if (asQty || /^[\d.,]/.test(text)) bestQty = i;
    else if (/[א-תa-z]/i.test(text)) bestName = i;
  }
  if (bestQty >= 0 && bestName >= 0 && bestQty !== bestName) {
    return { qtyCol: bestQty, nameCol: bestName };
  }
  if (bestName >= 0 && bestQty < 0) {
    return { qtyCol: bestName === 0 ? 1 : 0, nameCol: bestName };
  }
  return fallback;
}

function parseRowIngredient(cells, qtyCol, nameCol) {
  let qtyText = cells[qtyCol] || '';
  let nameText = cells[nameCol] || '';

  if (!nameText?.trim() && cells.length >= 2) {
    const guessed = guessQtyNameColumns(cells);
    qtyText = cells[guessed.qtyCol] || '';
    nameText = cells[guessed.nameCol] || '';
  }

  if (!nameText?.trim()) {
    const joined = cells.filter(Boolean).join(' ').trim();
    return parseIngredientLine(joined);
  }

  if (qtyText && /[\d.,]/.test(qtyText)) {
    const parsed = parseQtyUnitText(qtyText);
    if (parsed) return { name: nameText.trim(), ...parsed };
  }

  const combined = `${nameText} ${qtyText}`.trim();
  let ing = parseIngredientLine(combined) || parseIngredientLine(nameText);
  if (ing && nameText && !ing.name) ing.name = nameText.trim();
  if (ing && !ing.name) ing.name = nameText.trim();
  return ing;
}

function getTableRows(table) {
  return [...table.querySelectorAll('w\\:tr, tr')];
}

function getRowCells(row) {
  return [...row.querySelectorAll('w\\:tc, tc')].map(cellText);
}

function parseRecipeTable(table, title) {
  const rows = getTableRows(table);
  if (!rows.length) return null;

  const ingredients = [];
  let qtyCol = 0;
  let nameCol = 1;
  let headerDone = false;
  let recipeTitle = title?.trim() || '';
  let startRow = 0;

  const firstCells = getRowCells(rows[0]);
  if (firstCells.length && isTitleRow(firstCells) && !isHeaderRow(firstCells)) {
    recipeTitle = recipeTitle || firstCells.filter((c) => c.trim()).join(' ').trim();
    startRow = 1;
  }

  for (let ri = startRow; ri < rows.length; ri++) {
    const cells = getRowCells(rows[ri]);
    if (!cells.length) continue;

    if (!headerDone && isHeaderRow(cells)) {
      ({ qtyCol, nameCol } = detectColumns(cells));
      headerDone = true;
      continue;
    }
    headerDone = true;

    if (isTotalRow(cells)) continue;

    if (isTitleRow(cells) && !ingredients.length) {
      recipeTitle = cells.filter((c) => c.trim()).join(' ').trim();
      continue;
    }

    const guessed = guessQtyNameColumns(cells, { qtyCol, nameCol });
    qtyCol = guessed.qtyCol;
    nameCol = guessed.nameCol;

    const ing = parseRowIngredient(cells, qtyCol, nameCol);
    if (ing?.name && ing.quantity != null) ingredients.push(ing);
  }

  if (!recipeTitle) recipeTitle = 'מתכון ללא שם';
  return {
    title: recipeTitle,
    groupName: '',
    subName: '',
    ingredients,
    notes: '',
  };
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
  let pendingTitle = null;
  let pendingGroup = '';
  let pendingSub = '';

  const blocks = collectBlocksInOrder(body);

  for (const block of blocks) {
    if (isParagraphTag(block)) {
      const text = paragraphText(block);
      if (!text) continue;

      const groupM = text.match(GROUP_HEADER_RE);
      if (groupM) {
        pendingGroup = groupM[1].trim();
        continue;
      }
      const subM = text.match(SUB_HEADER_RE);
      if (subM) {
        pendingSub = subM[1].trim();
        continue;
      }
      const recipeM = text.match(RECIPE_HEADER_RE);
      if (recipeM) {
        pendingTitle = recipeM[1].trim();
        continue;
      }
      if (SKIP_TITLE_RE.test(text)) continue;
      if (parseIngredientLine(text)) continue;
      if (text.length <= 120) pendingTitle = text;
      continue;
    }

    if (isTableTag(block)) {
      const recipe = parseRecipeTable(block, pendingTitle);
      pendingTitle = null;
      if (recipe) {
        recipe.groupName = pendingGroup;
        recipe.subName = pendingSub;
        recipes.push(recipe);
      }
    }
  }

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
  const blocks = String(text || '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const recipes = [];
  let pendingGroup = '';
  let pendingSub = '';

  for (const block of blocks) {
    const blockLines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!blockLines.length) continue;

    let title = null;
    let groupName = pendingGroup;
    let subName = pendingSub;
    const ingredients = [];
    const noteLines = [];

    for (const line of blockLines) {
      const groupM = line.match(GROUP_HEADER_RE);
      if (groupM) {
        groupName = groupM[1].trim();
        pendingGroup = groupName;
        continue;
      }
      const subM = line.match(SUB_HEADER_RE);
      if (subM) {
        subName = subM[1].trim();
        pendingSub = subName;
        continue;
      }
      const recipeM = line.match(RECIPE_HEADER_RE);
      if (recipeM) {
        title = recipeM[1].trim();
        continue;
      }
      const ing = parseIngredientLine(line);
      if (ing) {
        ingredients.push(ing);
        continue;
      }
      if (!title && !ingredients.length && blockLines.length === 1) {
        title = line;
        continue;
      }
      noteLines.push(line);
    }

    if (!title && ingredients.length) {
      title = blockLines[0];
      for (let i = 1; i < blockLines.length; i++) {
        const ing = parseIngredientLine(blockLines[i]);
        if (!ing) noteLines.push(blockLines[i]);
      }
    }

    if (!title) continue;

    recipes.push({
      title,
      groupName: groupName || '',
      subName: subName || '',
      ingredients,
      notes: noteLines.join('\n').trim(),
    });
  }

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
    throw new Error('לא נמצאו מתכונים — ודא שיש טבלאות עם עמודות "כמות" ו"חומר גלם"');
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
            body += `<li><span class="ing-name">${escapeHtml(ing.name)}</span> — <strong>${ing.quantity}</strong> ${escapeHtml(ing.unit)}</li>`;
          }
          body += '</ul>';
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
