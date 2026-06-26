import {
  getRecipeGroups, getRecipeSubCategories, getRecipes, getRecipe, getRecipesCatalogLayout,
  addRecipeGroup, addRecipeSubCategory, importRecipeGroupsFromProducts,
  importRecipeSubCategoriesFromProducts, deleteRecipeGroup, deleteRecipeSubCategory,
  addRecipe, updateRecipe, deleteRecipe, addRecipeIngredient, deleteRecipeIngredient,
  updateRecipeIngredient, syncProductCostFromRecipe, getRawMaterials,
  setRecipeOrder, setRecipeGroupOrder, setRecipeSubCategoryOrder,
  importParsedRecipes, scaleRecipeIngredients,
  findOrCreateWordImportCategory, IMPORT_WORD_GROUP, IMPORT_WORD_SUB,
  RECIPE_WEIGHT_UNITS, normalizeRecipeUnitKind,
} from '../kitchen-db.js';
import { getProducts, getProductsCatalogLayout, getCategoryGroups, getCategories } from '../db.js';
import { parseRecipesFromDocxFile, buildRecipeBookHtml } from '../recipe-import.js';
import { escapeHtml, showToast, formatMoney } from '../utils.js';
import { openModal, closeModal } from '../modal.js';
import {
  bindRecipeDragLists, bindCategoryDragList, bindCategoryGroupDragList,
} from '../product-drag.js';
import { defaultColorForIndex } from '../chart.js';

const EXPANDED_RECIPE_GROUPS_KEY = 'yitzurExpandedRecipeGroups';
const EXPANDED_RECIPE_CATS_KEY = 'yitzurExpandedRecipeCategories';

function loadExpandedRecipeGroups() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(EXPANDED_RECIPE_GROUPS_KEY) || '[]').map(Number));
  } catch {
    return new Set();
  }
}

function loadExpandedRecipeCategories() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(EXPANDED_RECIPE_CATS_KEY) || '[]').map(Number));
  } catch {
    return new Set();
  }
}

let expandedRecipeGroups = loadExpandedRecipeGroups();
let expandedRecipeCategories = loadExpandedRecipeCategories();

function saveExpandedRecipeGroups() {
  sessionStorage.setItem(EXPANDED_RECIPE_GROUPS_KEY, JSON.stringify([...expandedRecipeGroups]));
}

function saveExpandedRecipeCategories() {
  sessionStorage.setItem(EXPANDED_RECIPE_CATS_KEY, JSON.stringify([...expandedRecipeCategories]));
}

function categoryChipStyle(color) {
  const c = color || '#2563eb';
  return `background:${c}22;border-color:${c};color:${c}`;
}

function formatLinkedProducts(linkedProductIds, productMap) {
  if (!linkedProductIds?.length) return 'ללא מוצר';
  const names = linkedProductIds.map((id) => productMap.get(id)?.name).filter(Boolean);
  return names.length ? `🔗 ${names.join(', ')}` : 'ללא מוצר';
}

function toggleRecipeGroupCard(card) {
  const id = Number(card.dataset.groupId);
  if (card.classList.toggle('is-expanded')) expandedRecipeGroups.add(id);
  else expandedRecipeGroups.delete(id);
  saveExpandedRecipeGroups();
  const toggle = card.querySelector('.category-group-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', card.classList.contains('is-expanded') ? 'true' : 'false');
}

function toggleRecipeCategoryCard(card) {
  const id = Number(card.dataset.categoryId);
  if (card.classList.toggle('is-expanded')) expandedRecipeCategories.add(id);
  else expandedRecipeCategories.delete(id);
  saveExpandedRecipeCategories();
  const toggle = card.querySelector('.category-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', card.classList.contains('is-expanded') ? 'true' : 'false');
}

function expandRecipeCategory(categoryId) {
  expandedRecipeCategories.add(Number(categoryId));
  saveExpandedRecipeCategories();
}

function renderRecipeItem(r, index, productMap) {
  const linked = r.linkedProductIds || (r.linkedProductId ? [r.linkedProductId] : []);
  return `
    <div class="list-item recipe-list-item" data-recipe-id="${r.id}">
      <div class="product-order-col">
        <span class="recipe-order-num product-order-num" aria-label="מיקום ${index + 1}">${index + 1}</span>
        <span class="recipe-drag-handle product-drag-handle" role="button" tabindex="0" aria-label="גרור לשינוי סדר">⠿</span>
      </div>
      <div class="list-item-info">
        <div class="list-item-name">${escapeHtml(r.name)}</div>
        <div class="list-item-meta">
          ${formatLinkedProducts(linked, productMap)}
          · ${r.yieldPortions || 1} מנות
        </div>
      </div>
      <div class="list-item-actions">
        <button type="button" class="btn btn-secondary btn-sm ratio-recipe" data-id="${r.id}" title="מחשבון יחס">⚖️</button>
        <button type="button" class="btn btn-secondary btn-sm edit-recipe" data-id="${r.id}">✏️</button>
        <button type="button" class="btn btn-danger btn-sm delete-recipe" data-id="${r.id}">🗑</button>
      </div>
    </div>`;
}

function renderRecipeSubCategoryCard(cat, catIndex, productMap) {
  const isExpanded = expandedRecipeCategories.has(cat.id);
  const color = defaultColorForIndex(cat.id);
  return `
    <div class="card category-card${isExpanded ? ' is-expanded' : ''}" data-category-id="${cat.id}">
      <div class="section-header category-card-header">
        <div class="category-header-start">
          <div class="category-order-col">
            <span class="product-order-num category-order-num" aria-label="מיקום ${catIndex + 1}">${catIndex + 1}</span>
            <span class="product-drag-handle category-drag-handle" role="button" tabindex="0" aria-label="גרור לשינוי סדר">⠿</span>
          </div>
          <button type="button" class="category-toggle" aria-expanded="${isExpanded ? 'true' : 'false'}">
            <span class="category-chevron" aria-hidden="true"></span>
            <span class="category-chip cat-chip" style="${categoryChipStyle(color)}">${escapeHtml(cat.name)}</span>
            <span class="category-summary">${cat.recipes.length} מתכונים</span>
          </button>
        </div>
        <div class="category-actions">
          <button type="button" class="btn btn-danger btn-sm btn-icon delete-recipe-sub" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" data-count="${cat.recipes.length}">🗑</button>
        </div>
      </div>
      <div class="category-products-area">
        <div class="category-products-toolbar">
          <span class="category-products-label">מתכונים (${cat.recipes.length})</span>
          <button type="button" class="btn btn-primary btn-sm add-recipe" data-cat="${cat.id}">+ מתכון</button>
        </div>
        ${cat.recipes.length === 0
    ? '<p class="category-products-empty">אין מתכונים — הוסף או ייבא מ-Word</p>'
    : `<p class="product-drag-hint">גרור ⠿ לשינוי סדר · ⚖️ מחשבון יחס</p>
           <div class="recipe-list" data-sub-id="${cat.id}">
             ${cat.recipes.map((r, i) => renderRecipeItem(r, i, productMap)).join('')}
           </div>`}
      </div>
    </div>`;
}

function renderRecipeGroupCard(group, groupIndex, productMap) {
  const totalRecipes = group.categories.reduce((s, c) => s + c.recipes.length, 0);
  const isExpanded = expandedRecipeGroups.has(group.id);
  const color = defaultColorForIndex(group.id);
  return `
    <div class="card category-group-card${isExpanded ? ' is-expanded' : ''}" data-group-id="${group.id}">
      <div class="section-header category-group-header">
        <div class="category-header-start">
          <div class="category-order-col">
            <span class="product-order-num category-group-order-num" aria-label="מיקום ${groupIndex + 1}">${groupIndex + 1}</span>
            <span class="product-drag-handle category-group-drag-handle" role="button" tabindex="0" aria-label="גרור">⠿</span>
          </div>
          <button type="button" class="category-toggle category-group-toggle" aria-expanded="${isExpanded ? 'true' : 'false'}">
            <span class="category-chevron" aria-hidden="true"></span>
            <span class="category-group-chip" style="${categoryChipStyle(color)}">📁 ${escapeHtml(group.name)}</span>
            <span class="category-summary">${group.categories.length} קטגוריות · ${totalRecipes} מתכונים</span>
          </button>
        </div>
        <div class="category-actions">
          <button type="button" class="btn btn-danger btn-sm btn-icon delete-recipe-group" data-id="${group.id}" data-name="${escapeHtml(group.name)}">🗑</button>
        </div>
      </div>
      <div class="category-group-body">
        ${group.categories.length === 0
    ? '<p class="category-products-empty">אין קטגוריות — הוסף קטגוריה או ייבא ממוצרים</p>'
    : `<div class="category-list" data-group-id="${group.id}">
            ${group.categories.map((cat, i) => renderRecipeSubCategoryCard(cat, i, productMap)).join('')}
          </div>`}
      </div>
    </div>`;
}

function renderRecipeCatalogHTML(layout, productMap) {
  if (!layout.allSubCategories.length) {
    return `<div class="empty-state">
      <div class="empty-state-icon">📒</div>
      <p>הוסף קטגוריה כללית וקטגוריה, או ייבא מ-Word</p>
    </div>`;
  }
  return `
    <p class="product-drag-hint">קטגוריות כלליות — לחץ לפתיחה · גרור ⠿ לשינוי סדר</p>
    <div class="category-group-list">
      ${layout.groups.map((g, i) => renderRecipeGroupCard(g, i, productMap)).join('')}
    </div>`;
}

export function recipesMeta() {
  return { title: 'מתכונים', subtitle: 'קטגוריות כמו במוצרים, קישור למוצרים וייבוא Word' };
}

export async function renderRecipes(container) {
  const viewMode = container.dataset.recipeView || 'manage';
  const [layout, products, productCatalog, productGroups, productCats] = await Promise.all([
    getRecipesCatalogLayout(),
    getProducts(true),
    getProductsCatalogLayout(),
    getCategoryGroups(),
    getCategories(),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));

  if (!layout.groups.length) {
    await addRecipeGroup({ name: 'כללי', linkedCategoryGroupId: null });
    return renderRecipes(container);
  }

  if (viewMode === 'book') {
    return renderRecipeBook(container, { groups: layout.groups, allSubs: layout.allSubCategories, products, productMap });
  }

  container.innerHTML = `
    <div class="card">
      <div class="filter-row" style="margin-bottom:8px">
        <div class="card-title" style="margin:0;flex:1">ניהול מתכונים</div>
        <button type="button" class="btn btn-secondary btn-sm" id="recipe-book-btn">📖 ספר</button>
        <button type="button" class="btn btn-secondary btn-sm" id="recipe-import-btn">📄 Word</button>
        <button type="button" class="btn btn-secondary btn-sm" id="manage-recipe-cats">⚙️</button>
      </div>
    </div>
    <div class="section-header products-toolbar">
      <h2>קטגוריות ומתכונים</h2>
      <div class="products-toolbar-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="add-recipe-group-btn">+ קטגוריה כללית</button>
        <button type="button" class="btn btn-primary btn-sm" id="add-recipe-sub-btn">+ קטגוריה</button>
      </div>
    </div>
    ${renderRecipeCatalogHTML(layout, productMap)}
    <input type="file" id="recipe-word-file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden>`;

  document.getElementById('recipe-book-btn')?.addEventListener('click', () => {
    container.dataset.recipeView = 'book';
    renderRecipes(container);
  });

  document.getElementById('recipe-import-btn')?.addEventListener('click', () => {
    document.getElementById('recipe-word-file')?.click();
  });

  document.getElementById('recipe-word-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = await parseRecipesFromDocxFile(file);
      const groups = await getRecipeGroups();
      const subs = await getRecipeSubCategories(groups[0]?.id);
      openImportPreview(container, parsed, { groupId: groups[0]?.id, subId: subs[0]?.id, groups, subs });
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('manage-recipe-cats')?.addEventListener('click', () => {
    openCategoryManager(container, {
      groups: layout.groups,
      productGroups,
      productCats,
      groupId: layout.groups[0]?.id,
    });
  });

  document.getElementById('add-recipe-group-btn')?.addEventListener('click', () => {
    const name = prompt('שם קטגוריה כללית:');
    if (!name?.trim()) return;
    addRecipeGroup({ name: name.trim(), linkedCategoryGroupId: null })
      .then(() => { showToast('נוסף ✓'); renderRecipes(container); })
      .catch((e) => showToast(e.message || 'שגיאה'));
  });

  document.getElementById('add-recipe-sub-btn')?.addEventListener('click', () => {
    openSubCategoryForm(container, layout.groups);
  });

  container.querySelectorAll('.category-group-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.category-group-card');
      if (card) toggleRecipeGroupCard(card);
    });
  });

  container.querySelectorAll('.category-card .category-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.category-card');
      if (card) toggleRecipeCategoryCard(card);
    });
  });

  container.querySelectorAll('.add-recipe').forEach((btn) => {
    btn.addEventListener('click', () => {
      expandRecipeCategory(Number(btn.dataset.cat));
      openRecipeForm(container, { categoryId: Number(btn.dataset.cat), productCatalog });
    });
  });

  container.querySelectorAll('.edit-recipe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const recipe = await getRecipe(Number(btn.dataset.id));
      if (recipe) openRecipeForm(container, { recipe, productCatalog });
    });
  });

  container.querySelectorAll('.ratio-recipe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const recipe = await getRecipe(Number(btn.dataset.id));
      if (recipe) openRatioCalculator(recipe);
    });
  });

  container.querySelectorAll('.delete-recipe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק מתכון?')) return;
      try {
        await deleteRecipe(Number(btn.dataset.id));
        showToast('נמחק');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.delete-recipe-group').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`למחוק קטגוריה "${btn.dataset.name}"?`)) return;
      try {
        await deleteRecipeGroup(Number(btn.dataset.id));
        showToast('נמחק');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.delete-recipe-sub').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (Number(btn.dataset.count) > 0) {
        showToast('יש מתכונים בקטגוריה — העבר או מחק קודם');
        return;
      }
      if (!confirm(`למחוק קטגוריה "${btn.dataset.name}"?`)) return;
      try {
        await deleteRecipeSubCategory(Number(btn.dataset.id));
        showToast('נמחק');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  bindRecipeDragLists(container, async (orderedIds, subId) => {
    await setRecipeOrder(subId, orderedIds);
  });

  bindCategoryGroupDragList(container, async (groupIds) => {
    await setRecipeGroupOrder(groupIds);
  });

  bindCategoryDragList(container, async (categoryIds, groupId) => {
    await setRecipeSubCategoryOrder(groupId, categoryIds);
  });
}

function openSubCategoryForm(container, groups) {
  openModal({
    title: 'קטגוריה מתכונים חדשה',
    bodyHTML: `
      <div class="form-group">
        <label>קטגוריה כללית</label>
        <select id="new-sub-group">
          ${groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>שם קטגוריה</label>
        <input type="text" id="new-sub-name" placeholder="למשל: עוגות, לקחים...">
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-recipe-sub">שמור</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-recipe-sub')?.addEventListener('click', async () => {
    const groupId = Number(document.getElementById('new-sub-group')?.value);
    const name = document.getElementById('new-sub-name')?.value.trim();
    if (!name) return showToast('הזן שם');
    try {
      await addRecipeSubCategory({ groupId, name, linkedCategoryId: null });
      closeModal();
      expandedRecipeGroups.add(groupId);
      saveExpandedRecipeGroups();
      showToast('נוסף ✓');
      renderRecipes(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function buildProductPickerHTML(productCatalog, selectedIds) {
  const selected = new Set(selectedIds || []);
  const parts = [];
  const renderCat = (cat) => {
    if (!cat.products?.length) return '';
    return `
      <div class="recipe-product-cat-block">
        <div class="form-hint" style="font-weight:600;margin:8px 0 4px">${escapeHtml(cat.name)}</div>
        ${cat.products.map((p) => `
          <label class="checkbox-label recipe-product-pick">
            <input type="checkbox" class="recipe-product-cb" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>
            ${escapeHtml(p.name)}
          </label>`).join('')}
      </div>`;
  };
  for (const group of productCatalog.groups) {
    if (!group.categories.some((c) => c.products.length)) continue;
    parts.push(`<details open><summary style="font-weight:700;margin:8px 0">${escapeHtml(group.name)}</summary>`);
    for (const cat of group.categories) parts.push(renderCat(cat));
    parts.push('</details>');
  }
  for (const cat of productCatalog.ungrouped) parts.push(renderCat(cat));
  return parts.join('') || '<p class="form-hint">אין מוצרים — הוסף במסך מוצרים</p>';
}

async function renderRecipeBook(container, { groups, allSubs, products, productMap }) {
  const allRecipes = await getRecipes(null);
  const details = await Promise.all(allRecipes.map((r) => getRecipe(r.id)));

  container.innerHTML = `
    <div class="card">
      <div class="filter-row">
        <div class="card-title" style="margin:0;flex:1">📖 ספר מתכונים</div>
        <button type="button" class="btn btn-secondary btn-sm" id="recipe-manage-btn">← ניהול</button>
        <button type="button" class="btn btn-primary btn-sm" id="export-recipe-book">⬇️ HTML</button>
        <button type="button" class="btn btn-secondary btn-sm" id="print-recipe-book">🖨️</button>
      </div>
    </div>
    <div class="card recipe-book-view" id="recipe-book-content">
      ${groups.map((group) => {
    const subs = allSubs.filter((s) => s.groupId === group.id);
    const groupRecipes = allRecipes.filter((r) => subs.some((s) => s.id === r.categoryId));
    if (!groupRecipes.length) return '';
    return `
        <section class="recipe-book-group">
          <h2 class="recipe-book-group-title">${escapeHtml(group.name)}</h2>
          ${subs.map((sub) => {
      const subRecipes = groupRecipes.filter((r) => r.categoryId === sub.id);
      if (!subRecipes.length) return '';
      return `
            <section class="recipe-book-sub">
              <h3 class="recipe-book-sub-title">${escapeHtml(sub.name)}</h3>
              ${subRecipes.map((r) => {
        const detail = details.find((d) => d.id === r.id);
        const linked = detail?.linkedProductIds || [];
        const prodNames = linked.map((id) => productMap.get(id)?.name).filter(Boolean);
        return `
                <article class="recipe-book-item">
                  <h4>${escapeHtml(r.name)}</h4>
                  ${prodNames.length ? `<p class="form-hint">מוצרים: ${prodNames.map((n) => escapeHtml(n)).join(', ')}</p>` : ''}
                  ${detail?.notes ? `<p class="recipe-book-notes">${escapeHtml(detail.notes)}</p>` : ''}
                  ${detail?.ingredients?.length ? `
                  <ul class="recipe-book-ingredients">
                    ${detail.ingredients.map((ing) => `
                      <li>${escapeHtml(ing.name)} — <strong>${ing.quantity}</strong> ${escapeHtml(ing.unit)}</li>`).join('')}
                  </ul>` : ''}
                </article>`;
      }).join('')}
            </section>`;
    }).join('')}
        </section>`;
  }).join('') || '<p class="form-hint">אין מתכונים</p>'}
    </div>`;

  document.getElementById('recipe-manage-btn')?.addEventListener('click', () => {
    container.dataset.recipeView = 'manage';
    renderRecipes(container);
  });
  document.getElementById('print-recipe-book')?.addEventListener('click', () => window.print());
  document.getElementById('export-recipe-book')?.addEventListener('click', async () => {
    const html = buildRecipeBookHtml({
      groups,
      subCategories: allSubs,
      recipes: allRecipes,
      recipeDetails: details,
    });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recipe-book.html';
    a.click();
    URL.revokeObjectURL(url);
    showToast('הורד ✓');
  });
}

function openCategoryManager(container, { groups, productGroups, productCats, groupId }) {
  getRecipeSubCategories(groupId).then((subs) => {
    openModal({
      title: 'ייבוא קטגוריות',
      bodyHTML: `
        <button type="button" class="btn btn-secondary btn-sm" id="import-groups-from-products" style="width:100%;margin-bottom:8px">
          ייבוא קטגוריות כלליות ממוצרים
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="import-subs-from-products" style="width:100%">
          ייבוא קטגוריות ממוצרים (קבוצה: ${escapeHtml(groups.find((g) => g.id === groupId)?.name || '')})
        </button>`,
      footerHTML: '<button class="btn btn-primary modal-cancel">סגור</button>',
    });
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('import-groups-from-products')?.addEventListener('click', async () => {
      try {
        const n = await importRecipeGroupsFromProducts();
        closeModal();
        showToast(n ? `יובאו ${n} ✓` : 'אין חדשות');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
    document.getElementById('import-subs-from-products')?.addEventListener('click', async () => {
      try {
        const n = await importRecipeSubCategoriesFromProducts(groupId);
        closeModal();
        showToast(n ? `יובאו ${n} ✓` : 'אין חדשות');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });
}

function openImportPreview(container, parsed, { groupId, subId, groups, subs }) {
  openModal({
    title: `ייבוא ${parsed.length} מתכונים`,
    bodyHTML: `
      <div class="form-group">
        <label>יעד (ניתן למיין אחר כך)</label>
        <select id="import-group">
          <option value="word-import" selected>${escapeHtml(IMPORT_WORD_GROUP)} · ${escapeHtml(IMPORT_WORD_SUB)}</option>
          ${groups.filter((g) => g.name !== IMPORT_WORD_GROUP).map((g) => `
            <option value="${g.id}">${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="import-add-materials" checked>
          הוסף חומרי גלם לספקים
        </label>
      </div>
      <div class="form-group" style="max-height:200px;overflow:auto">
        ${parsed.map((r) => `
          <div style="margin-bottom:8px;padding:8px;background:#f8fafc;border-radius:8px">
            <strong>${escapeHtml(r.title)}</strong> — ${(r.ingredients || []).length} חומרים
          </div>`).join('')}
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="confirm-recipe-import">ייבוא הכל</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('confirm-recipe-import')?.addEventListener('click', async () => {
    let gid = document.getElementById('import-group')?.value;
    const addRawMaterials = document.getElementById('import-add-materials')?.checked !== false;
    try {
      let sid;
      if (gid === 'word-import' || !gid) {
        const loc = await findOrCreateWordImportCategory();
        gid = loc.groupId;
        sid = loc.subCategoryId;
      } else {
        gid = Number(gid);
        const subList = await getRecipeSubCategories(gid);
        sid = subList[0]?.id;
      }
      const result = await importParsedRecipes(parsed, { groupId: gid, subCategoryId: sid, addRawMaterials });
      closeModal();
      showToast(`יובאו ${result.imported} מתכונים ✓`);
      renderRecipes(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function openRatioCalculator(recipe) {
  const ingredients = recipe.ingredients || [];
  if (!ingredients.length) return showToast('אין חומרים');
  const renderTable = (anchorId, targetQty) => {
    try {
      return scaleRecipeIngredients(ingredients, anchorId, targetQty).map((ing) => `
        <tr${ing.id === Number(anchorId) ? ' class="ratio-anchor-row"' : ''}>
          <td>${escapeHtml(ing.name)}</td>
          <td>${ing.quantity} ${escapeHtml(ing.unit)}</td>
          <td><strong>${ing.scaledQuantity}</strong> ${escapeHtml(ing.unit)}</td>
        </tr>`).join('');
    } catch {
      return '';
    }
  };
  const defaultAnchor = ingredients[0].id;
  openModal({
    title: `מחשבון יחס — ${escapeHtml(recipe.name)}`,
    bodyHTML: `
      <div class="form-group">
        <label>חומר בסיס</label>
        <select id="ratio-anchor">${ingredients.map((ing) => `
          <option value="${ing.id}">${escapeHtml(ing.name)} (${ing.quantity} ${escapeHtml(ing.unit)})</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>כמות יעד</label>
        <input type="number" id="ratio-target" min="0.001" step="0.001" value="${ingredients[0].quantity}">
      </div>
      <table class="ratio-table"><thead><tr><th>חומר</th><th>מקור</th><th>מחושב</th></tr></thead>
      <tbody id="ratio-tbody">${renderTable(defaultAnchor, ingredients[0].quantity)}</tbody></table>`,
    footerHTML: '<button class="btn btn-primary modal-cancel">סגור</button>',
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  const refresh = () => {
    const tbody = document.getElementById('ratio-tbody');
    if (!tbody) return;
    try {
      tbody.innerHTML = renderTable(
        document.getElementById('ratio-anchor')?.value,
        document.getElementById('ratio-target')?.value,
      );
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="3">${escapeHtml(err.message)}</td></tr>`;
    }
  };
  document.getElementById('ratio-anchor')?.addEventListener('change', refresh);
  document.getElementById('ratio-target')?.addEventListener('input', refresh);
}

async function openRecipeForm(container, { recipe, categoryId, productCatalog }) {
  const isEdit = !!recipe;
  const ingredients = recipe?.ingredients || [];
  const mats = await getRawMaterials();
  const catalog = productCatalog || await getProductsCatalogLayout();

  openModal({
    title: isEdit ? 'עריכת מתכון' : 'מתכון חדש',
    bodyHTML: `
      <div class="form-group">
        <label>שם מתכון</label>
        <input type="text" id="recipe-name" value="${recipe ? escapeHtml(recipe.name) : ''}">
      </div>
      <div class="form-group">
        <label>מנות למתכון (בסיס)</label>
        <input type="number" id="recipe-yield" min="0.1" step="0.1" value="${recipe?.yieldPortions ?? 1}">
      </div>
      <div class="form-group">
        <label>מוצרים מקושרים (ניתן לבחור כמה)</label>
        <div class="recipe-product-picker" style="max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px">
          ${buildProductPickerHTML(catalog, recipe?.linkedProductIds)}
        </div>
      </div>
      <div class="form-group">
        <label>הערות</label>
        <textarea id="recipe-notes" rows="2">${recipe ? escapeHtml(recipe.notes || '') : ''}</textarea>
      </div>
      ${isEdit ? `
      <div class="form-group">
        <label>חומרי גלם</label>
        ${ingredients.length ? ingredients.map((ing) => {
    const kind = ing.unitKind || normalizeRecipeUnitKind(ing.unit);
    return `
          <div class="filter-row recipe-ing-row" style="margin-bottom:6px" data-ing-id="${ing.id}">
            <span style="flex:1;font-size:0.9rem">${escapeHtml(ing.name)}</span>
            <input type="number" class="ing-qty" min="0.001" step="0.001" value="${ing.quantity}" style="width:72px">
            <select class="ing-unit" style="width:72px">
              ${RECIPE_WEIGHT_UNITS.map((u) => `
                <option value="${u.id}" ${kind === u.id ? 'selected' : ''}>${u.label}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-danger btn-sm del-ing" data-id="${ing.id}">🗑</button>
          </div>`;
  }).join('') : '<p class="form-hint">אין חומרים</p>'}
        <div class="filter-row" style="margin-top:8px">
          <select id="new-ing-mat" style="flex:1">
            <option value="">מחסן...</option>
            ${mats.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}
          </select>
          <input type="text" id="new-ing-name" placeholder="שם ידני" style="flex:1">
          <input type="number" id="new-ing-qty" min="0.001" step="0.001" placeholder="כמות" style="width:72px">
          <select id="new-ing-unit" style="width:72px">
            ${RECIPE_WEIGHT_UNITS.map((u) => `<option value="${u.id}">${u.label}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-secondary btn-sm" id="add-ing-btn">+</button>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="sync-product-cost" style="width:100%;margin-top:8px">
          🔄 עדכן מחיר חומרי גלם במוצרים המקושרים
        </button>
      </div>` : ''}`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-recipe">שמור</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  document.querySelectorAll('.recipe-ing-row').forEach((row) => {
    const ingId = Number(row.dataset.ingId);
    row.querySelector('.ing-qty')?.addEventListener('change', async (e) => {
      try { await updateRecipeIngredient(ingId, { quantity: e.target.value }); }
      catch (err) { showToast(err.message || 'שגיאה'); }
    });
    row.querySelector('.ing-unit')?.addEventListener('change', async (e) => {
      try { await updateRecipeIngredient(ingId, { unitKind: e.target.value }); }
      catch (err) { showToast(err.message || 'שגיאה'); }
    });
  });

  document.getElementById('add-ing-btn')?.addEventListener('click', async () => {
    const matId = Number(document.getElementById('new-ing-mat')?.value);
    const manualName = document.getElementById('new-ing-name')?.value.trim();
    const qty = document.getElementById('new-ing-qty')?.value;
    const unitKind = document.getElementById('new-ing-unit')?.value || 'kg';
    const mat = mats.find((m) => m.id === matId);
    const name = mat?.name || manualName;
    if (!name || !qty) return showToast('הזן שם וכמות');
    try {
      await addRecipeIngredient(recipe.id, { rawMaterialId: mat?.id || null, name, quantity: qty, unitKind });
      closeModal();
      openRecipeForm(container, { recipe: await getRecipe(recipe.id), productCatalog: catalog });
      showToast('נוסף ✓');
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.querySelectorAll('.del-ing').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteRecipeIngredient(Number(btn.dataset.id));
      closeModal();
      openRecipeForm(container, { recipe: await getRecipe(recipe.id), productCatalog: catalog });
    });
  });

  document.getElementById('sync-product-cost')?.addEventListener('click', async () => {
    try {
      const total = await syncProductCostFromRecipe(recipe.id);
      showToast(`עודכן: ${formatMoney(total)} ✓`);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('save-recipe')?.addEventListener('click', async () => {
    const linkedProductIds = [...document.querySelectorAll('.recipe-product-cb:checked')]
      .map((cb) => Number(cb.value));
    const data = {
      name: document.getElementById('recipe-name').value.trim(),
      yieldPortions: document.getElementById('recipe-yield').value,
      linkedProductIds,
      notes: document.getElementById('recipe-notes').value,
    };
    try {
      if (isEdit) {
        await updateRecipe(recipe.id, data);
      } else {
        await addRecipe({ ...data, categoryId });
      }
      closeModal();
      if (categoryId) expandRecipeCategory(categoryId);
      showToast('נשמר ✓');
      renderRecipes(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}
