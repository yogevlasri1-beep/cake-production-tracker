import { loadFFlate } from './docx-loader.js';

const UNIT_KG = /^(ק"ג|ק״ג|קג|kg|קילו)$/i;
const UNIT_G = /^(גרם|ג'|ג׳|gr|g)$/i;
const QTY_UNIT_RE = /([\d.,]+)\s*(ק"ג|ק״ג|קג|kg|קילו|גרם|ג'|ג׳|gr|g)\b/i;
const NAME_QTY_UNIT_RE = /^(.+?)\s+([\d.,]+)\s*(ק"ג|ק״ג|קג|kg|קילו|גרם|ג'|ג׳|gr|g)\s*$/i;
const UNIT_QTY_NAME_RE = /^(ק"ג|ק״ג|קג|kg|קילו|גרם|ג'|ג׳|gr|g)\s+([\d.,]+)\s+(.+)$/i;
const STRUCTURED_RE = /^(.+?)\s*[|｜]\s*([\d.,]+)\s*[|｜]\s*(kg|g|ק"ג|גרם)?\s*$/i;
const RECIPE_HEADER_RE = /^(?:===?\s*)?(?:מתכון|recipe)\s*[:：]\s*(.+)$/i;
const GROUP_HEADER_RE = /^(?:קטגוריה|קבוצה|group)\s*[:：]\s*(.+)$/i;
const SUB_HEADER_RE = /^(?:תת[- ]?קטגוריה|sub)\s*[:：]\s*(.+)$/i;

function parseNumber(raw) {
  const n = parseFloat(String(raw || '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function normalizeImportUnit(raw) {
  const u = String(raw || '').trim().toLowerCase();
  if (UNIT_G.test(u) || u === 'g') return 'g';
  if (UNIT_KG.test(u) || u === 'kg') return 'kg';
  return 'kg';
}

function unitLabel(kind) {
  return kind === 'g' ? 'גרם' : 'ק"ג';
}

function parseIngredientLine(line) {
  const trimmed = line.trim().replace(/^[-•*]\s*/, '');
  if (!trimmed) return null;

  let m = trimmed.match(STRUCTURED_RE);
  if (m) {
    const qty = parseNumber(m[2]);
    if (qty == null) return null;
    return {
      name: m[1].trim(),
      quantity: qty,
      unit: unitLabel(normalizeImportUnit(m[3] || 'kg')),
      unitKind: normalizeImportUnit(m[3] || 'kg'),
    };
  }

  m = trimmed.match(NAME_QTY_UNIT_RE);
  if (m) {
    const qty = parseNumber(m[2]);
    if (qty == null) return null;
    return {
      name: m[1].trim(),
      quantity: qty,
      unit: unitLabel(normalizeImportUnit(m[3])),
      unitKind: normalizeImportUnit(m[3]),
    };
  }

  m = trimmed.match(UNIT_QTY_NAME_RE);
  if (m) {
    const qty = parseNumber(m[2]);
    if (qty == null) return null;
    return {
      name: m[3].trim(),
      quantity: qty,
      unit: unitLabel(normalizeImportUnit(m[1])),
      unitKind: normalizeImportUnit(m[1]),
    };
  }

  m = trimmed.match(QTY_UNIT_RE);
  if (m) {
    const idx = trimmed.indexOf(m[0]);
    const name = (trimmed.slice(0, idx) + trimmed.slice(idx + m[0].length)).trim();
    const qty = parseNumber(m[1]);
    if (!name || qty == null) return null;
    return {
      name,
      quantity: qty,
      unit: unitLabel(normalizeImportUnit(m[2])),
      unitKind: normalizeImportUnit(m[2]),
    };
  }

  return null;
}

function extractTextFromDocumentXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const paragraphs = [...doc.getElementsByTagName('w:p')];
  const lines = [];

  for (const p of paragraphs) {
    const texts = [...p.getElementsByTagName('w:t')].map((t) => t.textContent || '');
    const line = texts.join('').trim();
    if (line) lines.push(line);
    else if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractTextFromDocx(arrayBuffer) {
  const fflate = await loadFFlate();
  const bytes = new Uint8Array(arrayBuffer);
  const files = fflate.unzipSync(bytes);
  const docXml = files['word/document.xml'];
  if (!docXml) throw new Error('קובץ Word לא תקין — חסר document.xml');
  const xml = new TextDecoder('utf-8').decode(docXml);
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
  const text = await extractTextFromDocx(buf);
  const recipes = parseRecipesFromText(text);
  if (!recipes.length) {
    throw new Error('לא נמצאו מתכונים בקובץ — הפרד מתכונים בשורה ריקה או השתמש בכותרת "מתכון: שם"');
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
