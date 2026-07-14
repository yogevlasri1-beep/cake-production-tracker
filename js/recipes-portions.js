import {
  getPortionPresetsCatalog, updatePortionPresetLink, setPortionPresetCatalogOrder,
  PORTION_LINK_PRODUCT, PORTION_LINK_CATEGORY, PORTION_LINK_GROUP,
} from './db.js?v=299';
import {
  getRecipe, formatRecipeQuantity, syncAllRecipePortionPresets, getRecipesCatalogLayout,
} from './kitchen-db.js?v=299';
import { defaultColorForIndex } from './chart.js?v=299';
import { escapeHtml, showToast } from './utils.js?v=299';
import { openModal, closeModal } from './modal.js?v=299';

function wirePortionIngredientsButtons(root, { onSaved } = {}) {
  import('../portion-ingredients.js?v=299').then(({ bindPortionIngredientsButtons }) => {
    bindPortionIngredientsButtons(root, { onSaved });
  }).catch((err) => {
    console.warn('portion-ingredients load failed', err);
  });
}

const PORTION_SECTIONS_KEY = 'yitzurPortionSectionsOpen';
const PORTION_RECIPE_GROUPS_KEY = 'yitzurPortionRecipeGroupsOpen';

function getPortionSectionsOpen() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(PORTION_SECTIONS_KEY) || '{}');
    return {
      recipe: raw.recipe !== false,
      flow: raw.flow !== false,
    };
  } catch {
    return { recipe: true, flow: true };
  }
}

function setPortionSectionOpen(id, open) {
  const state = getPortionSectionsOpen();
  state[id] = open;
  sessionStorage.setItem(PORTION_SECTIONS_KEY, JSON.stringify(state));
}

function getPortionRecipeGroupsOpen(defaultIds = []) {
  const raw = sessionStorage.getItem(PORTION_RECIPE_GROUPS_KEY);
  if (raw == null) return new Set(defaultIds.map(Number).filter(Boolean));
  try {
    const parsed = JSON.parse(raw);
    return new Set((Array.isArray(parsed) ? parsed : []).map(Number).filter(Boolean));
  } catch {
    return new Set(defaultIds.map(Number).filter(Boolean));
  }
}

function setPortionRecipeGroupsOpen(ids) {
  sessionStorage.setItem(PORTION_RECIPE_GROUPS_KEY, JSON.stringify([...ids]));
}

function categoryChipStyle(color) {
  const c = color || '#2563eb';
  return `background:${c}22;border-color:${c};color:${c}`;
}

function portionPresetLabel(p) {
  const extra = p.extra ? ` · ${p.extra}` : '';
  return `${p.name} (${p.weight} ק"ג${extra})`;
}

function buildGroupCheckboxesHTML(productCatalog, selectedIds = []) {
  const selected = new Set(selectedIds.map(Number));
  const groups = productCatalog.groups || [];
  if (!groups.length) return '<p class="form-hint">אין קטגוריות כלליות</p>';
  return `<div class="portion-link-checklist">${groups.map((group) => `
    <label class="checkbox-label portion-link-pick">
      <input type="checkbox" class="portion-link-cb" data-link-type="${PORTION_LINK_GROUP}" value="${group.id}"${selected.has(group.id) ? ' checked' : ''}>
      <span>${escapeHtml(group.name)}</span>
    </label>`).join('')}</div>`;
}

function buildCategoryCheckboxesHTML(productCatalog, selectedIds = []) {
  const selected = new Set(selectedIds.map(Number));
  const parts = [];
  for (const group of productCatalog.groups || []) {
    for (const cat of group.categories || []) {
      parts.push(`
        <label class="checkbox-label portion-link-pick">
          <input type="checkbox" class="portion-link-cb" data-link-type="${PORTION_LINK_CATEGORY}" value="${cat.id}"${selected.has(cat.id) ? ' checked' : ''}>
          <span>${escapeHtml(`${group.name} › ${cat.name}`)}</span>
        </label>`);
    }
  }
  for (const cat of productCatalog.ungrouped || []) {
    parts.push(`
      <label class="checkbox-label portion-link-pick">
        <input type="checkbox" class="portion-link-cb" data-link-type="${PORTION_LINK_CATEGORY}" value="${cat.id}"${selected.has(cat.id) ? ' checked' : ''}>
        <span>${escapeHtml(cat.name)}</span>
      </label>`);
  }
  return parts.length
    ? `<div class="portion-link-checklist">${parts.join('')}</div>`
    : '<p class="form-hint">אין קטגוריות</p>';
}

function buildProductCheckboxesHTML(productCatalog, selectedIds = []) {
  const selected = new Set(selectedIds.map(Number));
  const parts = [];
  for (const group of productCatalog.groups || []) {
    for (const cat of group.categories || []) {
      for (const p of (cat.products || []).filter((prod) => prod.active !== false)) {
        parts.push(`
          <label class="checkbox-label portion-link-pick">
            <input type="checkbox" class="portion-link-cb" data-link-type="${PORTION_LINK_PRODUCT}" value="${p.id}"${selected.has(p.id) ? ' checked' : ''}>
            <span>${escapeHtml(`${group.name} › ${cat.name} › ${p.name}`)}</span>
          </label>`);
      }
    }
  }
  for (const cat of productCatalog.ungrouped || []) {
    for (const p of (cat.products || []).filter((prod) => prod.active !== false)) {
      parts.push(`
        <label class="checkbox-label portion-link-pick">
          <input type="checkbox" class="portion-link-cb" data-link-type="${PORTION_LINK_PRODUCT}" value="${p.id}"${selected.has(p.id) ? ' checked' : ''}>
          <span>${escapeHtml(`${cat.name} › ${p.name}`)}</span>
        </label>`);
    }
  }
  return parts.length
    ? `<div class="portion-link-checklist portion-link-checklist--products">${parts.join('')}</div>`
    : '<p class="form-hint">אין מוצרים</p>';
}

function buildCustomLinkPickHTML(productCatalog, portion) {
  return `
    <div class="portion-link-section">
      <div class="portion-link-section-title">קטגוריות כלליות</div>
      ${buildGroupCheckboxesHTML(productCatalog, portion.linkGroupIds)}
    </div>
    <div class="portion-link-section">
      <div class="portion-link-section-title">קטגוריות</div>
      ${buildCategoryCheckboxesHTML(productCatalog, portion.linkCategoryIds)}
    </div>
    <div class="portion-link-section">
      <div class="portion-link-section-title">מוצרים</div>
      ${buildProductCheckboxesHTML(productCatalog, portion.linkProductIds)}
    </div>`;
}

function readSelectedPortionLinks() {
  const productIds = [];
  const categoryIds = [];
  const groupIds = [];
  document.querySelectorAll('.portion-link-cb:checked').forEach((el) => {
    const id = Number(el.value);
    if (!id) return;
    if (el.dataset.linkType === PORTION_LINK_PRODUCT) productIds.push(id);
    else if (el.dataset.linkType === PORTION_LINK_CATEGORY) categoryIds.push(id);
    else if (el.dataset.linkType === PORTION_LINK_GROUP) groupIds.push(id);
  });
  return { productIds, categoryIds, groupIds };
}

function openPortionLinkForm({ portion, productCatalog, onSaved }) {
  const hasCustom = !!portion.hasCustomLinks;
  const getLinkMode = () => document.querySelector('input[name="portion-link-mode"]:checked')?.value || 'default';

  openModal({
    title: 'שיוך מנה',
    bodyHTML: `
      <p class="form-hint" style="margin-top:0">${escapeHtml(portionPresetLabel(portion))}</p>
      <div class="form-group">
        <label>סוג שיוך</label>
        <div class="machine-measure-row">
          <label class="checkbox-label">
            <input type="radio" name="portion-link-mode" value="default" ${!hasCustom ? 'checked' : ''}>
            ברירת מחדל
          </label>
          <label class="checkbox-label">
            <input type="radio" name="portion-link-mode" value="custom" ${hasCustom ? 'checked' : ''}>
            שיוך מותאם
          </label>
        </div>
      </div>
      <div id="portion-link-pick"></div>
      <p class="form-hint" id="portion-link-hint"></p>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-portion-link-form">שמור</button>`,
  });

  const updateHint = () => {
    const hint = document.getElementById('portion-link-hint');
    if (!hint) return;
    hint.textContent = getLinkMode() === 'custom'
      ? 'ניתן לבחור כמה קטגוריות וכמה מוצרים — המנה תופיע אם המוצר מתאים לאחד מהיעדים'
      : '';
  };

  const syncPick = () => {
    const mode = getLinkMode();
    const pick = document.getElementById('portion-link-pick');
    if (!pick) return;
    pick.innerHTML = mode === 'custom'
      ? buildCustomLinkPickHTML(productCatalog, portion)
      : `<p class="form-hint">${portion.sourceRecipeId
        ? 'המנה תוצג לפי שיוך המתכון למוצרים (במסך עריכת מתכון)'
        : `המנה תוצג לכל המוצרים בקבוצת התזרים «${escapeHtml(portion.homeGroupName || '')}»`}</p>`;
    updateHint();
  };

  document.querySelectorAll('input[name="portion-link-mode"]').forEach((el) => {
    el.addEventListener('change', syncPick);
  });
  syncPick();

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-portion-link-form')?.addEventListener('click', async () => {
    const mode = getLinkMode();
    try {
      if (mode === 'default') {
        await updatePortionPresetLink(portion.id, { useDefault: true });
      } else {
        const { productIds, categoryIds, groupIds } = readSelectedPortionLinks();
        await updatePortionPresetLink(portion.id, { productIds, categoryIds, groupIds });
      }
      closeModal();
      showToast('נשמר ✓');
      onSaved?.();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

/** מנה אחת לכל מתכון (אם יש כמה מפות לקבוצות — לוקחים את הראשונה בסדר) */
function indexPortionsByRecipeId(portions) {
  const map = new Map();
  const sorted = portions.slice().sort((a, b) =>
    (a.catalogSortOrder ?? a.sortOrder ?? 0) - (b.catalogSortOrder ?? b.sortOrder ?? 0)
    || a.id - b.id);
  for (const p of sorted) {
    const rid = Number(p.sourceRecipeId);
    if (!rid || map.has(rid)) continue;
    map.set(rid, p);
  }
  return map;
}

function renderPortionRow(portion, { showOrder = false, index = 0, total = 1 } = {}) {
  const scopeBadge = portion.hasCustomLinks
    ? '<span class="machine-assignment-scope">שיוך מותאם</span>'
    : '<span class="machine-assignment-scope portion-scope-default">ברירת מחדל</span>';
  const metaLine = portion.sourceKind === 'recipe'
    ? escapeHtml(portion.recipeName || portion.sourceLabel)
    : escapeHtml(portion.homeGroupName || portion.sourceLabel);
  const subBadge = portion.isSubRecipe ? '<span class="recipe-sub-badge">תת מתכון</span> ' : '';
  const orderHtml = showOrder
    ? `<div class="portion-order-actions">
        <button type="button" class="btn btn-secondary btn-sm portion-move-up" data-id="${portion.id}" title="העלה"${index === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="btn btn-secondary btn-sm portion-move-down" data-id="${portion.id}" title="הורד"${index >= total - 1 ? ' disabled' : ''}>↓</button>
      </div>`
    : '';
  return `
    <div class="portion-catalog-row list-item${portion.isSubRecipe ? ' portion-catalog-row--sub-recipe' : ''}" data-portion-id="${portion.id}">
      ${orderHtml}
      <div class="list-item-info">
        <div class="list-item-name">${subBadge}🍽 ${escapeHtml(portionPresetLabel(portion))}</div>
        <div class="list-item-meta">${metaLine}</div>
        <div class="list-item-meta portion-link-line">
          ${scopeBadge}
          <strong>${escapeHtml(portion.linkLabel)}</strong>
          ${portion.linkPath ? `<span class="form-hint"> · ${escapeHtml(portion.linkPath)}</span>` : ''}
        </div>
      </div>
      <div class="list-item-actions">
        ${portion.sourceKind === 'recipe' ? `
        <button type="button" class="btn btn-secondary btn-sm portion-ingredients-btn" data-id="${portion.id}"
          title="רכיבי מתכון">📋</button>` : ''}
        <button type="button" class="btn btn-secondary btn-sm portion-edit-link" data-id="${portion.id}" title="שיוך">🔗</button>
      </div>
    </div>`;
}

function renderSubRecipeIngredientsTable(ingredients) {
  if (!ingredients?.length) {
    return '<p class="form-hint portion-empty">אין חומרי גלם — ערוך את תת המתכון במסך מתכונים</p>';
  }
  return `
    <div class="recipe-sheet-table-wrap portion-sub-recipe-table-wrap">
      <table class="recipe-sheet-table">
        <thead>
          <tr>
            <th scope="col" class="col-num">#</th>
            <th scope="col" class="col-name">חומר גלם</th>
            <th scope="col" class="col-qty">כמות</th>
            <th scope="col" class="col-unit">יחידה</th>
          </tr>
        </thead>
        <tbody>
          ${ingredients.map((ing, i) => `
          <tr>
            <td class="col-num">${i + 1}</td>
            <td class="col-name">${escapeHtml(ing.name)}</td>
            <td class="col-qty"><span class="recipe-qty-value">${formatRecipeQuantity(ing.quantity)}</span></td>
            <td class="col-unit">${escapeHtml(ing.unit)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderSubRecipePortionCard(portion, recipe) {
  const scopeBadge = portion.hasCustomLinks
    ? '<span class="machine-assignment-scope">שיוך מותאם</span>'
    : '<span class="machine-assignment-scope portion-scope-default">ברירת מחדל</span>';
  const parentLine = portion.parentRecipeName
    ? `מתכון ראשי: ${portion.parentRecipeName}`
    : (portion.recipeName || portion.sourceLabel);
  const ingredients = recipe?.ingredients || [];
  return `
    <article class="portion-sub-recipe-card" data-portion-id="${portion.id}">
      <div class="portion-sub-recipe-card-header">
        <div class="portion-sub-recipe-card-title-block">
          <h3 class="portion-sub-recipe-card-title">
            <span class="recipe-sub-badge">תת מתכון</span>
            ${escapeHtml(portionPresetLabel(portion))}
          </h3>
          <p class="list-item-meta">${escapeHtml(parentLine)}</p>
          <div class="list-item-meta portion-link-line">
            ${scopeBadge}
            <strong>${escapeHtml(portion.linkLabel)}</strong>
            ${portion.linkPath ? `<span class="form-hint"> · ${escapeHtml(portion.linkPath)}</span>` : ''}
          </div>
        </div>
        <div class="list-item-actions portion-sub-recipe-card-actions">
          <button type="button" class="btn btn-secondary btn-sm portion-ingredients-btn" data-id="${portion.id}"
            title="רכיבי מתכון">📋</button>
          <button type="button" class="btn btn-secondary btn-sm portion-edit-link" data-id="${portion.id}" title="שיוך">🔗</button>
        </div>
      </div>
      ${renderSubRecipeIngredientsTable(ingredients)}
    </article>`;
}

function renderRecipeBlock(recipe, portionByRecipeId, subRecipeMap, usedIds) {
  const parts = [];
  const mainPortion = portionByRecipeId.get(Number(recipe.id));
  if (mainPortion) {
    usedIds.add(Number(mainPortion.sourceRecipeId));
    parts.push(`
      <div class="portion-recipe-block">
        ${renderPortionRow(mainPortion)}
      </div>`);
  }
  const subs = recipe.subRecipes || [];
  const subCards = [];
  for (const sub of subs) {
    const subPortion = portionByRecipeId.get(Number(sub.id));
    if (!subPortion) continue;
    usedIds.add(Number(subPortion.sourceRecipeId));
    const fullRecipe = subRecipeMap.get(sub.id) || null;
    subCards.push(renderSubRecipePortionCard(subPortion, fullRecipe));
  }
  if (subCards.length) {
    parts.push(`<div class="portion-sub-recipe-list">${subCards.join('')}</div>`);
  }
  return parts.join('');
}

function countPortionsInCategory(cat, portionByRecipeId) {
  let n = 0;
  for (const recipe of cat.recipes || []) {
    if (portionByRecipeId.has(Number(recipe.id))) n += 1;
    for (const sub of recipe.subRecipes || []) {
      if (portionByRecipeId.has(Number(sub.id))) n += 1;
    }
  }
  return n;
}

function renderPortionCategoryCard(cat, catIndex, portionByRecipeId, subRecipeMap, usedIds) {
  const count = countPortionsInCategory(cat, portionByRecipeId);
  if (!count) return '';
  const color = defaultColorForIndex(cat.id);
  const body = (cat.recipes || []).map((recipe) =>
    renderRecipeBlock(recipe, portionByRecipeId, subRecipeMap, usedIds)).join('');
  return `
    <div class="card portion-recipe-category-card" data-portion-recipe-cat="${cat.id}">
      <div class="portion-recipe-category-header">
        <span class="category-chip cat-chip" style="${categoryChipStyle(color)}">${escapeHtml(cat.name)}</span>
        <span class="category-summary">${count} מנות</span>
        <span class="portion-recipe-category-order" aria-hidden="true">${catIndex + 1}</span>
      </div>
      <div class="portion-recipe-category-body">
        ${body}
      </div>
    </div>`;
}

function renderPortionRecipeGroupCard(group, groupIndex, portionByRecipeId, subRecipeMap, usedIds, openGroups) {
  const catsHtml = (group.categories || []).map((cat, i) =>
    renderPortionCategoryCard(cat, i, portionByRecipeId, subRecipeMap, usedIds)).join('');
  if (!catsHtml.trim()) return '';
  const total = (group.categories || []).reduce(
    (s, c) => s + countPortionsInCategory(c, portionByRecipeId),
    0,
  );
  const isExpanded = openGroups.has(group.id);
  const color = defaultColorForIndex(group.id);
  return `
    <div class="card category-group-card portion-recipe-group-card${isExpanded ? ' is-expanded' : ''}" data-portion-recipe-group="${group.id}">
      <div class="section-header category-group-header">
        <button type="button" class="category-toggle category-group-toggle portion-recipe-group-toggle" aria-expanded="${isExpanded ? 'true' : 'false'}">
          <span class="category-chevron" aria-hidden="true"></span>
          <span class="category-group-chip" style="${categoryChipStyle(color)}">📂 ${escapeHtml(group.name)}</span>
          <span class="category-summary">${group.categories.length} קטגוריות · ${total} מנות</span>
        </button>
        <span class="portion-recipe-category-order" aria-hidden="true">${groupIndex + 1}</span>
      </div>
      <div class="category-group-body">
        <div class="portion-recipe-category-list">
          ${catsHtml}
        </div>
      </div>
    </div>`;
}

function renderOrphanRecipePortions(orphanPortions, subRecipeMap) {
  if (!orphanPortions.length) return '';
  const main = orphanPortions.filter((p) => !p.isSubRecipe);
  const subs = orphanPortions.filter((p) => p.isSubRecipe);
  return `
    <div class="card portion-recipe-category-card portion-recipe-orphans">
      <div class="portion-recipe-category-header">
        <span class="category-chip cat-chip" style="${categoryChipStyle('#94a3b8')}">אחר</span>
        <span class="category-summary">${orphanPortions.length} מנות ללא קטגוריה פעילה</span>
      </div>
      <div class="portion-recipe-category-body">
        ${main.map((p) => renderPortionRow(p)).join('')}
        ${subs.length ? `<div class="portion-sub-recipe-list">${subs.map((p) =>
    renderSubRecipePortionCard(p, subRecipeMap.get(p.sourceRecipeId) || null)).join('')}</div>` : ''}
      </div>
    </div>`;
}

function renderRecipePortionSection(layout, portionByRecipeId, subRecipeMap, open, openGroups) {
  const usedIds = new Set();
  const groupsHtml = (layout.groups || []).map((g, i) =>
    renderPortionRecipeGroupCard(g, i, portionByRecipeId, subRecipeMap, usedIds, openGroups)).join('');
  const orphans = [...portionByRecipeId.entries()]
    .filter(([rid]) => !usedIds.has(rid))
    .map(([, p]) => p);
  const totalCount = portionByRecipeId.size;
  const body = `
    <div class="portion-recipe-catalog">
      <p class="form-hint portion-recipe-order-hint">הסדר והקטגוריות זהים למסך המתכונים — לשינוי סדר ערוך במתכונים.</p>
      <div class="category-group-list portion-recipe-group-list">
        ${groupsHtml || '<p class="form-hint portion-empty">אין מנות ממתכונים</p>'}
        ${renderOrphanRecipePortions(orphans, subRecipeMap)}
      </div>
    </div>`;
  return `
    <section class="card backup-section portion-source-section portion-source-section--recipe${open ? '' : ' is-collapsed'}" data-portion-section="recipe">
      <button type="button" class="backup-section-header" aria-expanded="${open}">
        <span class="backup-section-title">📖 מנות ממתכונים <span class="portion-section-count">(${totalCount})</span></span>
      </button>
      <div class="backup-section-body">
        ${body}
      </div>
    </section>`;
}

function renderPortionSection(id, title, sectionPortions, open) {
  const body = sectionPortions.length
    ? `<div class="portion-catalog-list" data-portion-list="flow">${sectionPortions.map((p, i) =>
      renderPortionRow(p, { showOrder: true, index: i, total: sectionPortions.length })).join('')}</div>`
    : '<p class="form-hint portion-empty">אין מנות בקטגוריה זו</p>';
  return `
    <section class="card backup-section portion-source-section portion-source-section--flow${open ? '' : ' is-collapsed'}" data-portion-section="${id}">
      <button type="button" class="backup-section-header" aria-expanded="${open}">
        <span class="backup-section-title">${title} <span class="portion-section-count">(${sectionPortions.length})</span></span>
      </button>
      <div class="backup-section-body">
        ${body}
      </div>
    </section>`;
}

function bindPortionSectionToggles(container) {
  container.querySelectorAll('[data-portion-section] .backup-section-header').forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = btn.closest('[data-portion-section]');
      const id = section?.dataset.portionSection;
      if (!id) return;
      const opening = section.classList.contains('is-collapsed');
      section.classList.toggle('is-collapsed', !opening);
      btn.setAttribute('aria-expanded', String(opening));
      setPortionSectionOpen(id, opening);
    });
  });
}

function bindPortionRecipeGroupToggles(container) {
  const openGroups = getPortionRecipeGroupsOpen();
  container.querySelectorAll('.portion-recipe-group-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('[data-portion-recipe-group]');
      const id = Number(card?.dataset.portionRecipeGroup);
      if (!id) return;
      const opening = !card.classList.contains('is-expanded');
      card.classList.toggle('is-expanded', opening);
      btn.setAttribute('aria-expanded', String(opening));
      if (opening) openGroups.add(id);
      else openGroups.delete(id);
      setPortionRecipeGroupsOpen(openGroups);
    });
  });
}

export async function renderRecipesPortions(container, { productCatalog }) {
  const rerender = () => renderRecipesPortions(container, { productCatalog });
  try {
    await syncAllRecipePortionPresets();
  } catch (err) {
    console.warn('syncAllRecipePortionPresets failed', err);
  }

  const [portions, layout] = await Promise.all([
    getPortionPresetsCatalog(),
    getRecipesCatalogLayout(),
  ]);

  const recipePortions = portions.filter((p) => p.sourceKind === 'recipe');
  const flowPortions = portions.filter((p) => p.sourceKind !== 'recipe');
  const portionByRecipeId = indexPortionsByRecipeId(recipePortions);
  const sectionsOpen = getPortionSectionsOpen();
  const openGroups = getPortionRecipeGroupsOpen((layout.groups || []).map((g) => g.id));

  const subRecipeMap = new Map();
  const subIds = [...portionByRecipeId.values()]
    .filter((p) => p.isSubRecipe)
    .map((p) => p.sourceRecipeId);
  await Promise.all(subIds.map(async (rid) => {
    if (!rid || subRecipeMap.has(rid)) return;
    const recipe = await getRecipe(rid);
    if (recipe) subRecipeMap.set(rid, recipe);
  }));

  container.innerHTML = `
    <div class="card portion-station-intro">
      <div class="card-title">מנות לייצור</div>
      <p class="form-hint" style="margin:0">מנות ממתכונים מסודרות כמו בקטלוג המתכונים (קבוצה → קטגוריה → מתכון). מנות מתזרים נשארות נפרדות.</p>
    </div>
    ${renderRecipePortionSection(layout, portionByRecipeId, subRecipeMap, sectionsOpen.recipe, openGroups)}
    ${renderPortionSection('flow', '🔄 מנות מתזרים', flowPortions, sectionsOpen.flow)}`;

  const movePortion = async (id, direction) => {
    const ids = flowPortions.map((p) => p.id);
    const idx = ids.indexOf(Number(id));
    if (idx < 0) return;
    const swap = idx + direction;
    if (swap < 0 || swap >= ids.length) return;
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    const recipeIds = [...portionByRecipeId.values()].map((p) => p.id);
    try {
      await setPortionPresetCatalogOrder([...recipeIds, ...ids]);
      showToast('סדר עודכן ✓');
      rerender();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  };

  bindPortionSectionToggles(container);
  bindPortionRecipeGroupToggles(container);

  container.querySelectorAll('.portion-move-up').forEach((btn) => {
    btn.addEventListener('click', () => movePortion(Number(btn.dataset.id), -1));
  });
  container.querySelectorAll('.portion-move-down').forEach((btn) => {
    btn.addEventListener('click', () => movePortion(Number(btn.dataset.id), 1));
  });
  container.querySelectorAll('.portion-edit-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      const portion = portions.find((p) => p.id === Number(btn.dataset.id));
      if (portion) openPortionLinkForm({ portion, productCatalog, onSaved: rerender });
    });
  });

  wirePortionIngredientsButtons(container, { onSaved: rerender });
}
